import type {
  CodexInputItem,
  CodexPersonality,
  CodexReasoningEffort,
  CodexReasoningSummary,
} from "./protocol.js";

export type CodexRunOptions = {
  cwd?: string;
  resumeThreadId?: string;
  model?: string;
  effort?: CodexReasoningEffort;
  summary?: CodexReasoningSummary;
  personality?: CodexPersonality;
  prompt: string;
};

export function buildCodexRunInput(prompt: string): CodexInputItem[] {
  return [{ type: "text", text: prompt, text_elements: [] }];
}

export function parseCodexRunArgs(args: string[]): CodexRunOptions {
  let cwd: string | undefined;
  let resumeThreadId: string | undefined;
  let model: string | undefined;
  let effort: CodexReasoningEffort | undefined;
  let summary: CodexReasoningSummary | undefined;
  let personality: CodexPersonality | undefined;
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
        if (
          next === "none"
          || next === "minimal"
          || next === "low"
          || next === "medium"
          || next === "high"
          || next === "xhigh"
        ) {
          effort = next;
          index += 1;
          continue;
        }
        throw new Error("`--effort` must be one of: none, minimal, low, medium, high, xhigh.");
      case "--summary":
        if (next === "auto" || next === "concise" || next === "detailed" || next === "none") {
          summary = next;
          index += 1;
          continue;
        }
        throw new Error("`--summary` must be one of: auto, concise, detailed, none.");
      case "--personality":
        if (next === "none" || next === "friendly" || next === "pragmatic") {
          personality = next;
          index += 1;
          continue;
        }
        throw new Error("`--personality` must be one of: none, friendly, pragmatic.");
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
