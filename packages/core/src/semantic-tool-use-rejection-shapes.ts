const USER_REFUSAL_PATTERN =
  /^the\s+user\s+(?:doesn['’]?t|does\s+not)\s+want\s+to\s+(proceed\s+with\s+this\s+tool\s+use|take\s+this\s+action(?:\s+right\s+now)?)\b/i;
const TOOL_USE_REJECTED_PATTERN = /^(?:the\s+)?tool\s+use\s+(?:was\s+)?rejected\b/i;
const STOP_WAIT_FOR_USER_PATTERN =
  /^stop\b[\s\S]*\bwait\b[\s\S]*\buser\b[\s\S]*\bproceed\b\s*[.!?]?$/i;

export function hasToolUseRejectionSignal(value: string): boolean {
  return (
    /\btool\s+use\s+was\s+rejected\b/i.test(value) ||
    /\buser\s+doesn['’]?t\s+want\s+to\s+proceed\b/i.test(value) ||
    /\buser\s+doesn['’]?t\s+want\s+to\s+take\s+this\s+action\s+right\s+now\b/i.test(value) ||
    /\bstop\s+what\s+you\s+are\s+doing\s+and\s+wait\b/i.test(value)
  );
}

export function looksLikeToolUseRejectionOutcome(value: string): boolean {
  const body = value
    .trim()
    .replace(/^OBSERVATION:\s*/i, "")
    .trim();
  const refusal = USER_REFUSAL_PATTERN.exec(body);

  if (!refusal) {
    return false;
  }

  let remainder = consumeSeparator(body.slice(refusal[0].length));
  if (/\btool\s+use\b/i.test(refusal[1] ?? "")) {
    const toolUseRejection = consumeToolUseRejectionClause(remainder);
    if (toolUseRejection === null) {
      return false;
    }
    remainder = consumeSeparator(toolUseRejection);
  }

  return STOP_WAIT_FOR_USER_PATTERN.test(remainder);
}

function consumeToolUseRejectionClause(value: string): string | null {
  const match = TOOL_USE_REJECTED_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  return consumeOptionalParenthetical(value.slice(match[0].length));
}

function consumeSeparator(value: string): string {
  return value.replace(/^\s*[.!?]\s*/u, "");
}

function consumeOptionalParenthetical(value: string): string {
  const match = /^\s*\(([^()]*)\)\s*/u.exec(value);
  if (!match) {
    return value;
  }

  const parenthetical = match[1] ?? "";
  if (
    parenthetical.length > 240 ||
    !/(?:\beg\b|\be\.g\.|\bfor example\b|\bif\b)/i.test(parenthetical)
  ) {
    return value;
  }

  return value.slice(match[0].length);
}
