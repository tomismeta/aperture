import { spawn } from "node:child_process";

import { buildDefaultFStopHarnessCommand } from "./fstop-harness.js";

export type FStopProvider = "generic" | "hermes" | "openclaw";
export type FStopRole = "optimizer" | "reviewer";

type RoleConfig = {
  genericCommandEnv: string;
  hermesCommandEnv: string;
  missingGenericCommandMessage: string;
  openClawCommandEnv: string;
};

type RoleExecution = {
  command: string;
  kind: "command";
};

export type FStopRolePromptOptions = {
  command?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  provider: FStopProvider;
};

const ROLE_CONFIGS: Record<FStopRole, RoleConfig> = {
  optimizer: {
    genericCommandEnv: "APERTURE_OPTIMIZER_COMMAND",
    hermesCommandEnv: "APERTURE_HERMES_OPTIMIZER_COMMAND",
    openClawCommandEnv: "APERTURE_OPENCLAW_OPTIMIZER_COMMAND",
    missingGenericCommandMessage:
      "No optimizer command configured. Set APERTURE_OPTIMIZER_COMMAND, APERTURE_HERMES_OPTIMIZER_COMMAND, or APERTURE_OPENCLAW_OPTIMIZER_COMMAND, or pass --command.",
  },
  reviewer: {
    genericCommandEnv: "APERTURE_REVIEWER_COMMAND",
    hermesCommandEnv: "APERTURE_HERMES_REVIEWER_COMMAND",
    openClawCommandEnv: "APERTURE_OPENCLAW_REVIEWER_COMMAND",
    missingGenericCommandMessage:
      "No reviewer command configured. Set APERTURE_REVIEWER_COMMAND, APERTURE_HERMES_REVIEWER_COMMAND, or APERTURE_OPENCLAW_REVIEWER_COMMAND, or pass --command.",
  },
};

export async function runFStopRolePrompt(
  role: FStopRole,
  prompt: string,
  options: FStopRolePromptOptions,
): Promise<string> {
  const config = ROLE_CONFIGS[role];
  const execution = resolveRoleExecution(role, config, options);

  return await executePromptCommand(
    execution.command,
    prompt,
    `${capitalize(role)} adapter command`,
    `${capitalize(role)} adapter command produced no stdout.`,
    options.cwd,
    options.env,
  );
}

export async function executePromptCommand(
  command: string,
  prompt: string,
  commandErrorLabel: string,
  noStdoutMessage: string,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      cwd,
      env,
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
        reject(new Error(`${commandErrorLabel} failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`));
        return;
      }
      if (!stdout.trim()) {
        reject(new Error(noStdoutMessage));
        return;
      }
      resolve(stdout);
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function resolveRoleExecution(
  role: FStopRole,
  config: RoleConfig,
  options: FStopRolePromptOptions,
): RoleExecution {
  const env = options.env ?? process.env;
  const repoCwd = options.cwd ?? process.cwd();
  if (options.command?.trim()) {
    return {
      kind: "command",
      command: options.command,
    };
  }
  if (options.provider === "hermes") {
    return {
      kind: "command",
      command: env[config.hermesCommandEnv]?.trim()
        || buildDefaultFStopHarnessCommand("hermes", role, repoCwd),
    };
  }
  if (options.provider === "openclaw") {
    return {
      kind: "command",
      command: env[config.openClawCommandEnv]?.trim()
        || buildDefaultFStopHarnessCommand("openclaw", role, repoCwd),
    };
  }

  const genericCommand = env[config.genericCommandEnv]?.trim()
    || env[config.hermesCommandEnv]?.trim()
    || env[config.openClawCommandEnv]?.trim()
    || failMissingGenericCommand(config);
  return {
    kind: "command",
    command: genericCommand,
  };
}

function failMissingGenericCommand(config: RoleConfig): never {
  throw new Error(config.missingGenericCommandMessage);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
