const DECLINED_ACTION_PATTERN =
  /^the\s+user\s+doesn['’]?t\s+want\s+to\s+take\s+this\s+action\s+right\s+now\b([\s\S]*)$/i;
const REJECTED_TOOL_USE_PATTERN =
  /^the\s+user\s+doesn['’]?t\s+want\s+to\s+proceed\s+with\s+this\s+tool\s+use\b([\s\S]*)$/i;
const STOP_AND_WAIT_PATTERN =
  /^stop\s+what\s+you\s+are\s+doing\s+and\s+wait\s+for\s+the\s+user\s+to\s+tell\s+you\s+how\s+to\s+proceed\.$/i;

export function hasToolUseRejectionSignal(value: string): boolean {
  return (
    /\btool\s+use\s+was\s+rejected\b/i.test(value) ||
    /\buser\s+doesn['’]?t\s+want\s+to\s+proceed\b/i.test(value) ||
    /\buser\s+doesn['’]?t\s+want\s+to\s+take\s+this\s+action\s+right\s+now\b/i.test(value) ||
    /\bstop\s+what\s+you\s+are\s+doing\s+and\s+wait\b/i.test(value)
  );
}

export function looksLikeToolUseRejectionOutcome(value: string): boolean {
  const body = stripOptionalObservationPrefix(value.trim());

  return looksLikeRejectedToolUseOutcome(body) || looksLikeDeclinedActionOutcome(body);
}

function stripOptionalObservationPrefix(value: string): string {
  return value.replace(/^OBSERVATION:\s*/i, "").trim();
}

function looksLikeRejectedToolUseOutcome(value: string): boolean {
  const match = REJECTED_TOOL_USE_PATTERN.exec(value);
  return match ? looksLikeToolUseRejectionRemainder(match[1] ?? "") : false;
}

function looksLikeDeclinedActionOutcome(value: string): boolean {
  const match = DECLINED_ACTION_PATTERN.exec(value);
  return match ? STOP_AND_WAIT_PATTERN.test(consumeSeparator(match[1] ?? "")) : false;
}

function looksLikeToolUseRejectionRemainder(value: string): boolean {
  let remainder = consumeSeparator(value);
  const toolUseRejection = /^the\s+tool\s+use\s+was\s+rejected\b/i.exec(remainder);
  if (!toolUseRejection) {
    return false;
  }

  remainder = remainder.slice(toolUseRejection[0].length);
  remainder = consumeOptionalParenthetical(remainder);
  remainder = consumeSeparator(remainder);

  return STOP_AND_WAIT_PATTERN.test(remainder);
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
