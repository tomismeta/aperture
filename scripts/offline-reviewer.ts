import { spawn } from "node:child_process";

import { runOpenClawReview } from "../packages/lab/src/openclaw-reviewer.js";

type ReviewerProvider = "hermes" | "openclaw" | "generic";

type ReviewerExecution =
  | {
    command: string;
    kind: "command";
  }
  | {
    kind: "openclaw";
  };

type Options = {
  provider: ReviewerProvider;
  command?: string;
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const prompt = await readStdin();
  if (!prompt.trim()) {
    throw new Error("Reviewer adapter expected a prompt on stdin.");
  }

  const execution = resolveReviewerExecution(options);
  const output = execution.kind === "openclaw"
    ? await runOpenClawReview(prompt, {
      cwd: process.cwd(),
      env: process.env,
    })
    : await executeCommand(execution.command, prompt);
  process.stdout.write(output);
}

function parseArgs(argv: string[]): Options {
  let provider: ReviewerProvider = "generic";
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

function readProvider(value: string | undefined): ReviewerProvider {
  if (value === "hermes" || value === "openclaw" || value === "generic") {
    return value;
  }

  throw new Error("--provider must be one of: hermes, openclaw, generic");
}

function resolveReviewerExecution(options: Options): ReviewerExecution {
  if (options.command?.trim()) {
    return {
      kind: "command",
      command: options.command,
    };
  }

  if (options.provider === "hermes") {
    return {
      kind: "command",
      command: readRequiredEnv("APERTURE_HERMES_REVIEWER_COMMAND"),
    };
  }

  if (options.provider === "openclaw") {
    const command = process.env.APERTURE_OPENCLAW_REVIEWER_COMMAND?.trim();
    if (command) {
      return {
        kind: "command",
        command,
      };
    }

    return { kind: "openclaw" };
  }

  const genericCommand = process.env.APERTURE_REVIEWER_COMMAND?.trim()
    || process.env.APERTURE_HERMES_REVIEWER_COMMAND?.trim()
    || process.env.APERTURE_OPENCLAW_REVIEWER_COMMAND?.trim()
    || failMissingGenericCommand();

  return {
    kind: "command",
    command: genericCommand,
  };
}

function failMissingGenericCommand(): never {
  throw new Error(
    "No reviewer command configured. Set APERTURE_REVIEWER_COMMAND, APERTURE_HERMES_REVIEWER_COMMAND, or APERTURE_OPENCLAW_REVIEWER_COMMAND, or pass --command.",
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
        reject(new Error(`Reviewer adapter command failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error("Reviewer adapter command produced no stdout."));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function printUsage(): void {
  console.log([
    "Usage: pnpm lab:review:reviewer [options]",
    "",
    "Reads a reviewer prompt on stdin and delegates to a configured reviewer command.",
    "",
    "Options:",
    "  --provider <hermes|openclaw|generic>  Reviewer provider shortcut (default: generic)",
    "  --command <cmd>                       Explicit reviewer command; overrides env vars",
    "",
    "Environment:",
    "  APERTURE_REVIEWER_COMMAND            Generic reviewer command",
    "  APERTURE_HERMES_REVIEWER_COMMAND     Hermes reviewer command (required for --provider hermes)",
    "  APERTURE_OPENCLAW_REVIEWER_COMMAND   OpenClaw reviewer command override",
    "  APERTURE_OPENCLAW_BIN                OpenClaw binary path override (default: openclaw)",
    "  APERTURE_OPENCLAW_AGENT              OpenClaw agent id override (optional)",
    "  APERTURE_OPENCLAW_REVIEW_SESSION_ID  OpenClaw session id override (default: fresh per review)",
    "  APERTURE_OPENCLAW_REVIEW_THINKING    OpenClaw thinking level (default: low)",
    "  APERTURE_OPENCLAW_REVIEW_TIMEOUT     OpenClaw timeout seconds (default: 300)",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
