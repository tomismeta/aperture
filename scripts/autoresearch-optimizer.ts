import { spawn } from "node:child_process";

import { runOpenClawReview } from "../packages/lab/src/openclaw-reviewer.js";

type OptimizerProvider = "hermes" | "openclaw" | "generic";

type OptimizerExecution =
  | {
    command: string;
    kind: "command";
  }
  | {
    kind: "openclaw";
  };

type Options = {
  provider: OptimizerProvider;
  command?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const prompt = await readStdin();
  if (!prompt.trim()) {
    throw new Error("Optimizer adapter expected a prompt on stdin.");
  }

  const execution = resolveOptimizerExecution(options);
  const output = execution.kind === "openclaw"
    ? await runOpenClawReview(prompt, {
      cwd: process.cwd(),
      env: process.env,
      ...(process.env.APERTURE_OPENCLAW_OPTIMIZER_AGENT?.trim()
        ? { agent: process.env.APERTURE_OPENCLAW_OPTIMIZER_AGENT.trim() }
        : {}),
      ...(process.env.APERTURE_OPENCLAW_OPTIMIZER_SESSION_ID?.trim()
        ? { sessionId: process.env.APERTURE_OPENCLAW_OPTIMIZER_SESSION_ID.trim() }
        : {}),
      thinking: process.env.APERTURE_OPENCLAW_OPTIMIZER_THINKING?.trim() || "medium",
      ...(normalizeTimeout(process.env.APERTURE_OPENCLAW_OPTIMIZER_TIMEOUT) !== undefined
        ? { timeoutSeconds: normalizeTimeout(process.env.APERTURE_OPENCLAW_OPTIMIZER_TIMEOUT) }
        : {}),
    })
    : await executeCommand(execution.command, prompt);
  process.stdout.write(output);
}

function parseArgs(argv: string[]): Options {
  let provider: OptimizerProvider = "generic";
  let command: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--provider":
        provider = readProvider(argv[++index]);
        break;
      case "--command":
        command = argv[++index];
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return {
    provider,
    ...(command ? { command } : {}),
  };
}

function readProvider(value: string | undefined): OptimizerProvider {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }

  throw new Error("--provider must be one of: hermes, openclaw, generic");
}

function resolveOptimizerExecution(options: Options): OptimizerExecution {
  if (options.command?.trim()) {
    return {
      kind: "command",
      command: options.command,
    };
  }

  if (options.provider === "hermes") {
    return {
      kind: "command",
      command: readRequiredEnv("APERTURE_HERMES_OPTIMIZER_COMMAND"),
    };
  }

  if (options.provider === "openclaw") {
    const command = process.env.APERTURE_OPENCLAW_OPTIMIZER_COMMAND?.trim();
    if (command) {
      return {
        kind: "command",
        command,
      };
    }

    return { kind: "openclaw" };
  }

  const genericCommand = process.env.APERTURE_OPTIMIZER_COMMAND?.trim()
    || process.env.APERTURE_HERMES_OPTIMIZER_COMMAND?.trim()
    || process.env.APERTURE_OPENCLAW_OPTIMIZER_COMMAND?.trim()
    || failMissingGenericCommand();

  return {
    kind: "command",
    command: genericCommand,
  };
}

function failMissingGenericCommand(): never {
  throw new Error(
    "No optimizer command configured. Set APERTURE_OPTIMIZER_COMMAND, APERTURE_HERMES_OPTIMIZER_COMMAND, or APERTURE_OPENCLAW_OPTIMIZER_COMMAND, or pass --command.",
  );
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function executeCommand(command: string, prompt: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
      env: process.env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      if (code !== 0) {
        reject(new Error(`Optimizer adapter command failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error("Optimizer adapter command produced no stdout."));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function normalizeTimeout(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return undefined;
}

function printUsage(): void {
  console.log([
    "Usage: pnpm lab:autoresearch:optimizer [options]",
    "",
    "Reads an autoresearch optimizer prompt on stdin and delegates to a configured optimizer command.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>  Optimizer provider shortcut (default: generic)",
    "  --command <cmd>                       Explicit optimizer command; overrides env vars",
    "",
    "Environment:",
    "  APERTURE_OPTIMIZER_COMMAND            Generic optimizer command",
    "  APERTURE_HERMES_OPTIMIZER_COMMAND     Hermes optimizer command (required for --provider hermes)",
    "  APERTURE_OPENCLAW_OPTIMIZER_COMMAND   OpenClaw optimizer command override",
    "  APERTURE_OPENCLAW_BIN                 OpenClaw binary path override (default: openclaw)",
    "  APERTURE_OPENCLAW_OPTIMIZER_AGENT     OpenClaw agent id override (optional)",
    "  APERTURE_OPENCLAW_OPTIMIZER_SESSION_ID  OpenClaw session id override",
    "  APERTURE_OPENCLAW_OPTIMIZER_THINKING  OpenClaw thinking level (default: medium)",
    "  APERTURE_OPENCLAW_OPTIMIZER_TIMEOUT   OpenClaw timeout seconds",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
