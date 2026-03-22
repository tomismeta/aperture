import { readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ClaudeCodeAskUserQuestionOption = {
  label: string;
  description?: string;
};

export type ClaudeCodeAskUserQuestionQuestion = {
  question: string;
  header?: string;
  options: ClaudeCodeAskUserQuestionOption[];
  multiSelect?: boolean;
};

export type ClaudeCodeAskUserQuestionTranscriptPayload = {
  questions: ClaudeCodeAskUserQuestionQuestion[];
  answers?: Record<string, unknown>;
};

export type ClaudeCodeTranscriptReadOptions = {
  allowedRoots?: string[];
  maxBytes?: number;
};

type TranscriptContentItem = {
  type?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
};

type TranscriptLine = {
  message?: {
    content?: TranscriptContentItem[] | string;
  };
  toolUseResult?: {
    questions?: unknown;
    answers?: unknown;
  };
};

const DEFAULT_TRANSCRIPT_ROOTS = [path.join(os.homedir(), ".claude")];
const DEFAULT_TRANSCRIPT_MAX_BYTES = 512 * 1024;

export async function readAskUserQuestionTranscriptPayload(
  transcriptPath: string,
  toolUseId: string,
  options: ClaudeCodeTranscriptReadOptions = {},
): Promise<ClaudeCodeAskUserQuestionTranscriptPayload | null> {
  const resolvedPath = await resolveAllowedTranscriptPath(
    transcriptPath,
    options.allowedRoots ?? DEFAULT_TRANSCRIPT_ROOTS,
  );
  if (!resolvedPath) {
    return null;
  }

  const maxBytes = options.maxBytes ?? DEFAULT_TRANSCRIPT_MAX_BYTES;
  let raw: string;
  try {
    const info = await stat(resolvedPath);
    if (!info.isFile() || info.size > maxBytes) {
      return null;
    }

    raw = await readFile(resolvedPath, "utf8");
  } catch {
    return null;
  }

  let questions: ClaudeCodeAskUserQuestionQuestion[] | null = null;
  let answers: Record<string, unknown> | undefined;

  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }

    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }

    const content = Array.isArray(parsed.message?.content) ? parsed.message.content : [];
    for (const item of content) {
      if (
        item?.type === "tool_use"
        && item.id === toolUseId
        && item.name === "AskUserQuestion"
      ) {
        const nextQuestions = parseAskUserQuestions(item.input);
        if (nextQuestions.length > 0) {
          questions = nextQuestions;
        }
      }

      if (item?.type === "tool_result" && item.tool_use_id === toolUseId) {
        const nextAnswers = parseAskUserAnswers(parsed.toolUseResult?.answers);
        if (nextAnswers) {
          answers = nextAnswers;
        }
      }
    }
  }

  if (!questions || questions.length === 0) {
    return null;
  }

  return answers ? { questions, answers } : { questions };
}

export function parseAskUserQuestionPayload(
  input: Record<string, unknown> | undefined,
): ClaudeCodeAskUserQuestionTranscriptPayload | null {
  const questions = parseAskUserQuestions(input);
  return questions.length > 0 ? { questions } : null;
}

function parseAskUserQuestions(input: Record<string, unknown> | undefined): ClaudeCodeAskUserQuestionQuestion[] {
  if (!input || !Array.isArray(input.questions)) {
    return [];
  }

  return input.questions.flatMap((question): ClaudeCodeAskUserQuestionQuestion[] => {
    if (!question || typeof question !== "object" || Array.isArray(question)) {
      return [];
    }

    const typed = question as Record<string, unknown>;
    if (typeof typed.question !== "string" || typed.question.length === 0) {
      return [];
    }

    const options = Array.isArray(typed.options)
      ? typed.options.flatMap((option): ClaudeCodeAskUserQuestionOption[] => {
          if (!option || typeof option !== "object" || Array.isArray(option)) {
            return [];
          }

          const typedOption = option as Record<string, unknown>;
          if (typeof typedOption.label !== "string" || typedOption.label.length === 0) {
            return [];
          }

          return [{
            label: typedOption.label,
            ...(typeof typedOption.description === "string" && typedOption.description.length > 0
              ? { description: typedOption.description }
              : {}),
          }];
        })
      : [];

    return [{
      question: typed.question,
      ...(typeof typed.header === "string" && typed.header.length > 0 ? { header: typed.header } : {}),
      options,
      ...(typeof typed.multiSelect === "boolean" ? { multiSelect: typed.multiSelect } : {}),
    }];
  });
}

function parseAskUserAnswers(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return { ...(value as Record<string, unknown>) };
}

async function resolveAllowedTranscriptPath(
  transcriptPath: string,
  allowedRoots: string[],
): Promise<string | null> {
  let resolvedPath: string;
  try {
    resolvedPath = await realpath(path.resolve(transcriptPath));
  } catch {
    return null;
  }

  for (const root of allowedRoots) {
    const resolvedRoot = await resolveAllowedRoot(root);
    if (!resolvedRoot) {
      continue;
    }

    const relative = path.relative(resolvedRoot, resolvedPath);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      return resolvedPath;
    }
  }

  return null;
}

async function resolveAllowedRoot(root: string): Promise<string | null> {
  try {
    return await realpath(path.resolve(root));
  } catch {
    return null;
  }
}
