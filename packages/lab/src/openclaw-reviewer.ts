import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

export type OpenClawReviewOptions = {
  agent?: string;
  bin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  sessionId?: string;
  thinking?: string;
  timeoutSeconds?: number;
};

type OpenClawAgentEnvelope = {
  payloads?: Array<{
    mediaUrl?: string | null;
    text?: string | null;
  }>;
};

export async function runOpenClawReview(
  prompt: string,
  options: OpenClawReviewOptions = {},
): Promise<string> {
  const bin = options.bin?.trim() || process.env.APERTURE_OPENCLAW_BIN?.trim() || "openclaw";
  const agent = options.agent?.trim() || process.env.APERTURE_OPENCLAW_AGENT?.trim();
  const sessionId = options.sessionId?.trim()
    || process.env.APERTURE_OPENCLAW_REVIEW_SESSION_ID?.trim()
    || `aperture-review-${randomUUID()}`;
  const thinking = options.thinking?.trim()
    || process.env.APERTURE_OPENCLAW_REVIEW_THINKING?.trim()
    || "low";
  const timeoutSeconds = normalizeTimeoutSeconds(
    options.timeoutSeconds,
    process.env.APERTURE_OPENCLAW_REVIEW_TIMEOUT,
  );

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

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
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
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const combined = [stderr, stdout].filter(Boolean).join("\n");
      if (code !== 0) {
        reject(new Error(`OpenClaw reviewer command failed with exit code ${code}: ${combined.trim()}`));
        return;
      }

      try {
        resolve(parseOpenClawReviewerOutput(combined));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function parseOpenClawReviewerOutput(output: string): string {
  const jsonText = extractFirstJsonObject(output);
  const parsed = JSON.parse(jsonText) as OpenClawAgentEnvelope;
  const text = (parsed.payloads ?? [])
    .map((payload) => payload.text?.trim())
    .filter((value): value is string => Boolean(value))
    .at(-1);
  if (!text) {
    throw new Error("OpenClaw reviewer response did not include a text payload.");
  }

  return text;
}

export function extractFirstJsonObject(text: string): string {
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") {
      continue;
    }

    const end = findBalancedJsonEnd(text, start);
    if (end < 0) {
      continue;
    }

    const candidate = text.slice(start, end + 1);
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error("Unable to locate a valid JSON object in the OpenClaw reviewer output.");
}

function findBalancedJsonEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }

      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function normalizeTimeoutSeconds(
  explicit: number | undefined,
  envValue: string | undefined,
): number {
  if (typeof explicit === "number" && Number.isFinite(explicit) && explicit > 0) {
    return Math.round(explicit);
  }

  const parsed = Number.parseInt(envValue ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 300;
}
