import type { AttentionResponse } from "@tomismeta/aperture-core";

import type {
  ClaudeCodeHookResponse,
  ClaudeCodePreToolUseEvent,
} from "./mapping.js";

export type ParsedClaudeInteractionId =
  | {
      kind: "tool";
      sessionId: string;
      toolUseId: string;
    }
  | {
      kind: "permission";
      sessionId: string;
      permissionToken: string;
    }
  | {
      kind: "elicitation";
      sessionId: string;
      mcpServerName: string;
      elicitationId: string;
      fieldId?: string;
    };

export function mapClaudeCodeFrameResponse(
  response: AttentionResponse,
): ClaudeCodeHookResponse | null {
  const parsed = parseClaudeInteractionId(response.interactionId);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "tool") {
    switch (response.response.kind) {
      case "acknowledged":
        return null;
      case "approved":
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
          },
        };
      case "rejected":
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            ...(response.response.reason
              ? { permissionDecisionReason: response.response.reason }
              : {}),
          },
        };
      case "dismissed":
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
          },
        };
      case "option_selected":
      case "form_submitted":
      case "text_submitted":
        return null;
    }
  }

  if (parsed.kind === "permission") {
    switch (response.response.kind) {
      case "approved":
        return {
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: {
              behavior: "allow",
            },
          },
        };
      case "rejected":
        return {
          hookSpecificOutput: {
            hookEventName: "PermissionRequest",
            decision: {
              behavior: "deny",
              ...(response.response.reason ? { message: response.response.reason } : {}),
            },
          },
        };
      case "dismissed":
        return {};
      case "acknowledged":
      case "option_selected":
      case "form_submitted":
      case "text_submitted":
        return null;
    }
  }

  switch (response.response.kind) {
    case "acknowledged":
      return null;
    case "approved":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
        },
      };
    case "rejected":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "decline",
        },
      };
    case "dismissed":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "cancel",
        },
      };
    case "option_selected": {
      const content = elicitationContentFromOptionIds(parsed, response.response.optionIds);
      if (!content) {
        return null;
      }
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
          content,
        },
      };
    }
    case "text_submitted": {
      const content = parsed.fieldId
        ? { [parsed.fieldId]: response.response.text }
        : { response: response.response.text };
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
          content,
        },
      };
    }
    case "form_submitted":
      return {
        hookSpecificOutput: {
          hookEventName: "Elicitation",
          action: "accept",
          content: response.response.values,
        },
      };
  }
}

export function mapClaudeCodeAskUserQuestionResponse(
  response: AttentionResponse,
  prompt: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>,
): ClaudeCodeHookResponse | null {
  switch (response.response.kind) {
    case "acknowledged":
      return null;
    case "approved":
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      };
    case "rejected":
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          ...(response.response.reason
            ? { permissionDecisionReason: response.response.reason }
            : {}),
        },
      };
    case "dismissed":
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
        },
      };
    case "option_selected":
    case "text_submitted":
    case "form_submitted": {
      const additionalContext = askUserQuestionAdditionalContext(prompt.questions, response.response);
      if (!additionalContext) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
          },
        };
      }

      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Aperture already captured the user's answer.",
          additionalContext,
        },
      };
    }
  }
}

export function parseClaudeInteractionId(
  interactionId: string,
): ParsedClaudeInteractionId | null {
  const parts = interactionId.split(":");
  if (parts.length < 4 || parts[0] !== "claude-code") {
    return null;
  }

  if (parts[1] === "tool") {
    if (parts.length !== 4) {
      return null;
    }

    const sessionIdPart = parts[2];
    const toolUseIdPart = parts[3];
    if (!sessionIdPart || !toolUseIdPart) {
      return null;
    }

    const sessionId = safeDecode(sessionIdPart);
    const toolUseId = safeDecode(toolUseIdPart);
    if (!sessionId || !toolUseId) {
      return null;
    }

    return {
      kind: "tool",
      sessionId,
      toolUseId,
    };
  }

  if (parts[1] === "permission") {
    if (parts.length !== 4) {
      return null;
    }

    const sessionId = safeDecode(parts[2] ?? "");
    const permissionToken = safeDecode(parts[3] ?? "");
    if (!sessionId || !permissionToken) {
      return null;
    }

    return {
      kind: "permission",
      sessionId,
      permissionToken,
    };
  }

  if (parts[1] !== "elicitation" || (parts.length !== 5 && parts.length !== 6)) {
    return null;
  }

  const sessionId = safeDecode(parts[2] ?? "");
  const mcpServerName = safeDecode(parts[3] ?? "");
  const elicitationId = safeDecode(parts[4] ?? "");
  const fieldId = parts[5] ? safeDecode(parts[5]) : null;
  if (!sessionId || !mcpServerName || !elicitationId) {
    return null;
  }

  return {
    kind: "elicitation",
    sessionId,
    mcpServerName,
    elicitationId,
    ...(fieldId ? { fieldId } : {}),
  };
}

export function summarizeAskUserQuestionAnswers(
  answers: Record<string, unknown> | undefined,
): string | undefined {
  if (!answers) {
    return undefined;
  }

  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return "Claude received answers to a user question.";
  }

  return entries
    .map(([question, value]) => `${question} -> ${formatAskUserQuestionAnswer(value)}`)
    .join("; ");
}

function askUserQuestionAdditionalContext(
  questions: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"],
  response:
    | Extract<AttentionResponse["response"], { kind: "option_selected" }>
    | Extract<AttentionResponse["response"], { kind: "text_submitted" }>
    | Extract<AttentionResponse["response"], { kind: "form_submitted" }>,
): string | null {
  const answers = askUserQuestionAnswersFromResponse(questions, response);
  const entries = Object.entries(answers);
  if (entries.length === 0) {
    return null;
  }

  const rendered = entries
    .map(([question, value]) => `${JSON.stringify(question)}=${JSON.stringify(formatAskUserQuestionAnswer(value))}`)
    .join(", ");

  return `The user already answered this AskUserQuestion in Aperture. Do not ask again. Treat these answers as authoritative: ${rendered}. Continue from them directly.`;
}

function askUserQuestionAnswersFromResponse(
  questions: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"],
  response:
    | Extract<AttentionResponse["response"], { kind: "option_selected" }>
    | Extract<AttentionResponse["response"], { kind: "text_submitted" }>
    | Extract<AttentionResponse["response"], { kind: "form_submitted" }>,
): Record<string, unknown> {
  if (questions.length === 0) {
    return {};
  }

  switch (response.kind) {
    case "option_selected": {
      const question = questions[0];
      if (!question) {
        return {};
      }

      const values = response.optionIds
        .map((optionId) => askUserQuestionAnswerFromOptionId(question, optionId))
        .filter((value): value is string => typeof value === "string" && value.length > 0);
      if (values.length === 0) {
        return {};
      }

      return {
        [question.question]: question.multiSelect ? values : values[0]!,
      };
    }
    case "text_submitted":
      return {
        [questions[0]!.question]: response.text,
      };
    case "form_submitted":
      return Object.fromEntries(
        questions.flatMap((question, index) => {
          if (question.options.length > 0 && question.multiSelect) {
            const selectedOptions = question.options.flatMap((option, optionIndex) => {
              const value = response.values[`q${index}:o${optionIndex}`];
              return isTrueLike(value) ? [option.label] : [];
            });
            return selectedOptions.length > 0 ? [[question.question, selectedOptions]] : [];
          }

          const value = response.values[`q${index}`];
          return value === undefined ? [] : [[question.question, value]];
        }),
      );
  }
}

function askUserQuestionAnswerFromOptionId(
  question: NonNullable<ClaudeCodePreToolUseEvent["askUserQuestion"]>["questions"][number],
  optionId: string,
): string | null {
  const matched = /^q\d+:o(\d+):(.*)$/.exec(optionId);
  if (matched) {
    const optionIndex = Number.parseInt(matched[1] ?? "", 10);
    const fromQuestion = Number.isInteger(optionIndex) ? question.options[optionIndex]?.label : undefined;
    if (fromQuestion) {
      return fromQuestion;
    }

    return safeDecode(matched[2] ?? "");
  }

  return safeDecode(optionId);
}

function formatAskUserQuestionAnswer(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => formatAskUserQuestionAnswer(item)).join(", ");
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function isTrueLike(value: unknown): boolean {
  return value === true || value === "true";
}

function elicitationContentFromOptionIds(
  parsed: Extract<ParsedClaudeInteractionId, { kind: "elicitation" }>,
  optionIds: string[],
): Record<string, unknown> | null {
  const selected = optionIds[0];
  if (!selected) {
    return null;
  }

  const separator = selected.indexOf("=");
  if (separator === -1) {
    return parsed.fieldId ? { [parsed.fieldId]: selected } : null;
  }

  const fieldId = safeDecode(selected.slice(0, separator));
  const value = safeDecode(selected.slice(separator + 1));
  if (!fieldId || value === null) {
    return null;
  }

  if (value === "true") {
    return { [fieldId]: true };
  }
  if (value === "false") {
    return { [fieldId]: false };
  }

  return { [fieldId]: value };
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
