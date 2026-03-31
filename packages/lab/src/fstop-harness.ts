import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, constants as fsConstants } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { extractJsonObjects } from "./json-utils.js";

export type FStopHarnessProvider = "hermes" | "openclaw";
export type FStopHarnessRole = "optimizer" | "reviewer";

type FStopHarnessOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

type HermesHarnessOptions = FStopHarnessOptions & {
  role: FStopHarnessRole;
};

type OpenClawHarnessOptions = FStopHarnessOptions & {
  agent?: string;
  bin?: string;
  role: FStopHarnessRole;
  sessionId?: string;
  thinking?: string;
  timeoutSeconds?: number;
};

type HarnessCommandResult = {
  code: number;
  stderr: string;
  stdout: string;
  timedOut: boolean;
};

type OpenClawAgentEnvelope = {
  payloads?: Array<{
    mediaUrl?: string | null;
    text?: string | null;
  }>;
};

export async function runFStopHarnessProvider(
  provider: FStopHarnessProvider,
  prompt: string,
  options: FStopHarnessOptions & {
    role: FStopHarnessRole;
  },
): Promise<string> {
  if (provider === "hermes") {
    return await runHermesHarness(prompt, options);
  }

  return await runOpenClawHarness(prompt, options);
}

export async function runHermesHarness(
  prompt: string,
  options: HermesHarnessOptions,
): Promise<string> {
  const env = options.env ?? process.env;
  const timeoutSeconds = normalizeTimeoutSeconds(
    env[options.role === "reviewer" ? "APERTURE_HERMES_REVIEW_TIMEOUT" : "APERTURE_HERMES_OPTIMIZER_TIMEOUT"],
  ) ?? normalizeTimeoutSeconds(env.APERTURE_HERMES_TIMEOUT)
    ?? defaultTimeoutSecondsForRole(options.role);
  const result = await spawnHarnessCommand(
    env.APERTURE_HERMES_BIN?.trim() || "hermes",
    [
      "chat",
      "-Q",
      "--yolo",
      "--source",
      env.APERTURE_HERMES_SOURCE?.trim() || "tool",
      "--provider",
      env.APERTURE_HERMES_PROVIDER?.trim() || "openai-codex",
      "-m",
      env.APERTURE_HERMES_MODEL?.trim() || "gpt-5.4",
      "-q",
      prompt,
    ],
    {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env,
      timeoutSeconds,
    },
  );

  if (result.code !== 0) {
    throw new Error(
      `Hermes harness failed with exit code ${result.code}${formatHarnessErrorSuffix(result, result.timedOut ? "Hermes harness timed out." : undefined)}`,
    );
  }

  const jsonText = extractLargestJsonObject(result.stdout);
  if (jsonText) {
    return jsonText;
  }

  const fallback = sanitizeHermesFallback(result.stdout);
  if (!fallback) {
    throw new Error("Hermes harness produced no usable stdout.");
  }

  return fallback;
}

export async function runOpenClawHarness(
  prompt: string,
  options: OpenClawHarnessOptions,
): Promise<string> {
  const env = options.env ?? process.env;
  const bin = await resolveOpenClawBinary({
    ...(options.bin ? { bin: options.bin } : {}),
    env,
  });
  const rolePrefix = options.role === "reviewer" ? "APERTURE_OPENCLAW_REVIEW" : "APERTURE_OPENCLAW_OPTIMIZER";
  const agent = options.agent?.trim()
    || env[options.role === "reviewer" ? "APERTURE_OPENCLAW_AGENT" : "APERTURE_OPENCLAW_OPTIMIZER_AGENT"]?.trim();
  const sessionId = options.sessionId?.trim()
    || env[`${rolePrefix}_SESSION_ID`]?.trim()
    || `aperture-${options.role}-${randomUUID()}`;
  const thinking = options.thinking?.trim()
    || env[`${rolePrefix}_THINKING`]?.trim()
    || "low";
  const timeoutSeconds = normalizeTimeoutSeconds(
    options.timeoutSeconds,
    env[`${rolePrefix}_TIMEOUT`],
  ) ?? defaultTimeoutSecondsForRole(options.role);

  const args = [
    "agent",
    "--local",
    "--session-id",
    sessionId,
    "--json",
    "--thinking",
    thinking,
    "--timeout",
    String(timeoutSeconds),
    "--message",
    prompt,
  ];
  if (agent) {
    args.splice(3, 0, "--agent", agent);
  }

  const result = await spawnHarnessCommand(bin, args, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env,
    timeoutSeconds,
  });
  const combined = [result.stderr, result.stdout].filter(Boolean).join("\n");
  if (result.code !== 0) {
    throw new Error(
      `OpenClaw harness failed with exit code ${result.code}${formatHarnessErrorSuffix(result, result.timedOut ? "OpenClaw harness timed out." : undefined)}`,
    );
  }

  return parseOpenClawReviewerOutput(combined);
}

export async function runFStopHarnessCli(argv: string[]): Promise<void> {
  const parsed = parseHarnessCliArgs(argv);
  const prompt = await readStdInText();
  if (!prompt.trim()) {
    throw new Error("F-Stop harness received an empty stdin prompt.");
  }

  const output = await runFStopHarnessProvider(parsed.provider, prompt, {
    role: parsed.role,
    cwd: process.cwd(),
    env: process.env,
  });
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

export function buildDefaultFStopHarnessCommand(
  provider: FStopHarnessProvider,
  role: FStopHarnessRole,
  cwd: string = process.cwd(),
): string {
  const tsxCli = path.join(cwd, "node_modules", "tsx", "dist", "cli.mjs");
  const scriptPath = path.join(cwd, "scripts", "fstop-harness.ts");
  return [
    shellQuote(process.execPath),
    shellQuote(tsxCli),
    shellQuote(scriptPath),
    "--provider",
    provider,
    "--role",
    role,
  ].join(" ");
}

export async function resolveOpenClawBinary(
  options: {
    bin?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  const configured = options.bin?.trim() || env.APERTURE_OPENCLAW_BIN?.trim();
  if (configured) {
    return configured;
  }

  for (const candidate of candidateOpenClawBinaryPaths(env)) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return "openclaw";
}

export function parseOpenClawReviewerOutput(output: string): string {
  const text = extractOpenClawPayloadTexts(output).at(-1);
  if (!text) {
    throw new Error("OpenClaw reviewer response did not include a text payload.");
  }
  return text;
}

export function extractFirstJsonObject(text: string): string {
  return extractJsonObjects(text)[0]
    ?? failMissingJsonObject();
}

async function spawnHarnessCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutSeconds: number;
  },
): Promise<HarnessCommandResult> {
  return await new Promise<HarnessCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 1000).unref();
    }, options.timeoutSeconds * 1000);
    timeout.unref();

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.stderr.on("data", (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        timedOut,
      });
    });
  });
}

function parseHarnessCliArgs(argv: string[]): {
  provider: FStopHarnessProvider;
  role: FStopHarnessRole;
} {
  let provider: FStopHarnessProvider | undefined;
  let role: FStopHarnessRole | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--provider") {
      provider = parseProvider(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--role") {
      role = parseRole(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown F-Stop harness argument: ${token}`);
  }

  if (!provider) {
    throw new Error("Missing required argument: --provider <hermes|openclaw>");
  }
  if (!role) {
    throw new Error("Missing required argument: --role <reviewer|optimizer>");
  }

  return { provider, role };
}

function parseProvider(value: string | undefined): FStopHarnessProvider {
  if (value === "hermes" || value === "openclaw") {
    return value;
  }
  throw new Error(`Invalid F-Stop harness provider: ${value ?? "<missing>"}`);
}

function parseRole(value: string | undefined): FStopHarnessRole {
  if (value === "reviewer" || value === "optimizer") {
    return value;
  }
  throw new Error(`Invalid F-Stop harness role: ${value ?? "<missing>"}`);
}

function extractLargestJsonObject(text: string): string | null {
  const candidates = extractJsonObjects(text);
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => right.length - left.length);
  return candidates[0] ?? null;
}

function sanitizeHermesFallback(text: string): string {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("Resume this session with:")) {
      continue;
    }
    if (line.startsWith("session_id:")) {
      continue;
    }
    if (line.startsWith("Session:")) {
      continue;
    }
    if (line.startsWith("Duration:")) {
      continue;
    }
    if (line.startsWith("Messages:")) {
      continue;
    }
    if (line.startsWith("╭") || line.startsWith("╰") || line.startsWith("│")) {
      continue;
    }
    if (line.startsWith("⚠")) {
      continue;
    }
    lines.push(raw);
  }

  return lines.join("\n").trim();
}

function extractOpenClawPayloadTexts(output: string): string[] {
  return extractJsonObjects(output)
    .flatMap((jsonText) => {
      try {
        const parsed = JSON.parse(jsonText) as OpenClawAgentEnvelope;
        return (parsed.payloads ?? [])
          .map((payload) => payload.text?.trim())
          .filter((value): value is string => Boolean(value));
      } catch {
        return [];
      }
    });
}

function candidateOpenClawBinaryPaths(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME?.trim();
  return [
    ...(home
      ? [
        path.join(home, ".local", "bin", "openclaw"),
        path.join(home, "node", "bin", "openclaw"),
      ]
      : []),
    "/usr/local/bin/openclaw",
    "/opt/homebrew/bin/openclaw",
  ];
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function failMissingJsonObject(): never {
  throw new Error("Unable to locate a valid JSON object in the OpenClaw reviewer output.");
}

function normalizeTimeoutSeconds(
  explicitOrEnv: number | string | undefined,
  envValue?: string | undefined,
): number | undefined {
  if (typeof explicitOrEnv === "number" && Number.isFinite(explicitOrEnv) && explicitOrEnv > 0) {
    return Math.round(explicitOrEnv);
  }

  const direct = Number.parseInt(typeof explicitOrEnv === "string" ? explicitOrEnv : "", 10);
  if (Number.isFinite(direct) && direct > 0) {
    return direct;
  }

  const parsed = Number.parseInt(envValue ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return undefined;
}

function defaultTimeoutSecondsForRole(role: FStopHarnessRole): number {
  return role === "reviewer" ? 300 : 1800;
}

function formatHarnessErrorSuffix(
  result: HarnessCommandResult,
  prefix?: string,
): string {
  const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  const parts = [prefix, details].filter(Boolean);
  return parts.length > 0 ? `: ${parts.join(" ")}` : "";
}

async function readStdInText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}
