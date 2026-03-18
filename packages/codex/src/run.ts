import type { CodexInputItem, CodexReasoningEffort } from "./protocol.js";

export type CodexRunOptions = {
  cwd?: string;
  resumeThreadId?: string;
  model?: string;
  effort?: CodexReasoningEffort;
  summary?: string;
  personality?: string;
  prompt: string;
};

export function buildCodexRunInput(prompt: string): CodexInputItem[] {
  return [{ type: "text", text: prompt }];
}

export function parseCodexRunArgs(args: string[]): CodexRunOptions {
  let cwd: string | undefined;
  let resumeThreadId: string | undefined;
  let model: string | undefined;
  let effort: CodexReasoningEffort | undefined;
  let summary: string | undefined;
  let personality: string | undefined;
  const promptParts: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (!arg) {
      continue;
    }

    switch (arg) {
      case "--cwd":
        if (next) {
          cwd = next;
          index += 1;
        }
        continue;
      case "--resume":
      case "--thread":
        if (next) {
          resumeThreadId = next;
          index += 1;
        }
        continue;
      case "--model":
        if (next) {
          model = next;
          index += 1;
        }
        continue;
      case "--effort":
        if (next === "low" || next === "medium" || next === "high" || next === "xhigh") {
          effort = next;
          index += 1;
        }
        continue;
      case "--summary":
        if (next) {
          summary = next;
          index += 1;
        }
        continue;
      case "--personality":
        if (next) {
          personality = next;
          index += 1;
        }
        continue;
      default:
        promptParts.push(arg);
        continue;
    }
  }

  const prompt = promptParts.join(" ").trim();
  if (!prompt) {
    throw new Error(
      "Provide a Codex prompt. Example: `pnpm codex:run --cwd /path/to/repo Fix the failing test and explain the change`.",
    );
  }

  return {
    ...(cwd ? { cwd } : {}),
    ...(resumeThreadId ? { resumeThreadId } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(summary ? { summary } : {}),
    ...(personality ? { personality } : {}),
    prompt,
  };
}
