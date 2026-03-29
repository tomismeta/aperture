import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { extractJsonObjects } from "./json-utils.js";

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

function failMissingJsonObject(): never {
  throw new Error("Unable to locate a valid JSON object in the OpenClaw reviewer output.");
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
