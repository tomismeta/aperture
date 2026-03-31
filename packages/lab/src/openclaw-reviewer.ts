import {
  extractFirstJsonObject,
  parseOpenClawReviewerOutput,
  resolveOpenClawBinary,
  runOpenClawHarness,
} from "./fstop-harness.js";

export type OpenClawReviewOptions = {
  agent?: string;
  bin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  sessionId?: string;
  thinking?: string;
  timeoutSeconds?: number;
};

export async function runOpenClawReview(
  prompt: string,
  options: OpenClawReviewOptions = {},
): Promise<string> {
  return await runOpenClawHarness(prompt, {
    ...options,
    role: "reviewer",
  });
}

export {
  extractFirstJsonObject,
  parseOpenClawReviewerOutput,
  resolveOpenClawBinary,
};
