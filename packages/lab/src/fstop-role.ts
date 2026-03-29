import { spawn } from "node:child_process";

import { runOpenClawReview } from "./openclaw-reviewer.js";

export type FStopProvider = "generic" | "hermes" | "openclaw";
export type FStopRole = "optimizer" | "reviewer";

type RoleConfig = {
  defaultTimeoutSeconds: number;
  genericCommandEnv: string;
  hermesCommandEnv: string;
  missingGenericCommandMessage: string;
  openClawAgentEnv?: string;
  openClawCommandEnv: string;
  openClawSessionEnv?: string;
  openClawThinkingEnv: string;
  openClawTimeoutEnv: string;
};

type RoleExecution =
  | {
    command: string;
    kind: "command";
  }
  | {
    kind: "openclaw";
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
    openClawAgentEnv: "APERTURE_OPENCLAW_OPTIMIZER_AGENT",
    openClawSessionEnv: "APERTURE_OPENCLAW_OPTIMIZER_SESSION_ID",
    openClawThinkingEnv: "APERTURE_OPENCLAW_OPTIMIZER_THINKING",
    openClawTimeoutEnv: "APERTURE_OPENCLAW_OPTIMIZER_TIMEOUT",
    defaultTimeoutSeconds: 1800,
    missingGenericCommandMessage:
      "No optimizer command configured. Set APERTURE_OPTIMIZER_COMMAND, APERTURE_HERMES_OPTIMIZER_COMMAND, or APERTURE_OPENCLAW_OPTIMIZER_COMMAND, or pass --command.",
  },
  reviewer: {
    genericCommandEnv: "APERTURE_REVIEWER_COMMAND",
    hermesCommandEnv: "APERTURE_HERMES_REVIEWER_COMMAND",
    openClawCommandEnv: "APERTURE_OPENCLAW_REVIEWER_COMMAND",
    openClawAgentEnv: "APERTURE_OPENCLAW_AGENT",
    openClawSessionEnv: "APERTURE_OPENCLAW_REVIEW_SESSION_ID",
    openClawThinkingEnv: "APERTURE_OPENCLAW_REVIEW_THINKING",
    openClawTimeoutEnv: "APERTURE_OPENCLAW_REVIEW_TIMEOUT",
    defaultTimeoutSeconds: 300,
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
  const execution = resolveRoleExecution(config, options);

  if (execution.kind === "openclaw") {
    return await runOpenClawReview(prompt, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
      ...buildOpenClawRoleOptions(config, options.env),
    });
  }

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
  config: RoleConfig,
  options: FStopRolePromptOptions,
): RoleExecution {
  const env = options.env ?? process.env;
  if (options.command?.trim()) {
    return {
      kind: "command",
      command: options.command,
    };
  }
  if (options.provider === "hermes") {
    return {
      kind: "command",
      command: readRequiredEnv(env, config.hermesCommandEnv),
    };
  }
  if (options.provider === "openclaw") {
    const command = env[config.openClawCommandEnv]?.trim();
    if (command) {
      return {
        kind: "command",
        command,
      };
    }
    return { kind: "openclaw" };
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

function buildOpenClawRoleOptions(
  config: RoleConfig,
  env: NodeJS.ProcessEnv = process.env,
) {
  const agent = config.openClawAgentEnv ? env[config.openClawAgentEnv]?.trim() : undefined;
  const sessionId = config.openClawSessionEnv ? env[config.openClawSessionEnv]?.trim() : undefined;
  return {
    ...(agent ? { agent } : {}),
    ...(sessionId ? { sessionId } : {}),
    thinking: env[config.openClawThinkingEnv]?.trim() || "low",
    timeoutSeconds: normalizeTimeout(env[config.openClawTimeoutEnv]) ?? config.defaultTimeoutSeconds,
  };
}

function failMissingGenericCommand(config: RoleConfig): never {
  throw new Error(config.missingGenericCommandMessage);
}

function readRequiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizeTimeout(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return undefined;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
