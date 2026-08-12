const USER_REFUSAL_PATTERN =
  /^(?:(?<user>the\s+user\s+(?:doesn['’]?t|does\s+not)\s+want\s+to\s+(?:proceed\s+with\s+this\s+tool\s+use|take\s+this\s+action(?:\s+right\s+now)?))|(?<decline>(?:authorization|permission|approval)\s+(?:was\s+)?(?:declined|denied|rejected)\s+before\s+(?:tool\s+)?(?:invocation|execution)))\b/i;
const TOOL_USE_REJECTED_PATTERN = /^(?:the\s+)?tool\s+use\s+(?:was\s+)?rejected\b/i;
const STOP_WAIT_FOR_USER_PATTERN =
  /^(?:stop\s+(?:(?:what\s+you\s+are\s+doing\s+and|and)\s+)?wait\s+for\s+(?:the\s+)?user\s+to\s+(?:tell\s+you\s+how\s+to\s+)?proceed|no\s+(?:tool\s+call|invocation|execution)\s+(?:occurred|was\s+(?:started|performed|run))\s*(?:[,;.]|\band\b)\s*no\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created)))\s*[.!?]?$/i;

export type ToolUseRejectionOutcome =
  | { kind: "authorization_control"; executionEvidence: "absent" }
  | { kind: "user_rejection"; executionEvidence: "unspecified" };

export function hasToolUseRejectionSignal(value: string): boolean {
  return (
    /\b(?:tool\s+use\s+was\s+rejected|(?:authorization|permission|approval)\s+(?:was\s+)?(?:declined|denied|rejected)\s+before\s+(?:tool\s+)?(?:invocation|execution))\b/i.test(
      value,
    ) ||
    /\buser\s+doesn['’]?t\s+want\s+to\s+proceed\b/i.test(value) ||
    /\buser\s+doesn['’]?t\s+want\s+to\s+take\s+this\s+action\s+right\s+now\b/i.test(value) ||
    /\bstop\s+what\s+you\s+are\s+doing\s+and\s+wait\b/i.test(value)
  );
}

export function readToolUseRejectionOutcome(value: string): ToolUseRejectionOutcome | null {
  const body = value
    .trim()
    .replace(/^OBSERVATION:\s*/i, "")
    .trim();
  const refusal = USER_REFUSAL_PATTERN.exec(body);

  if (!refusal) return null;

  let remainder = consumeSeparator(body.slice(refusal[0].length));
  if (/\btool\s+use\b/i.test(refusal.groups?.user ?? "")) {
    const toolUseRejection = consumeToolUseRejectionClause(remainder);
    if (toolUseRejection === null) return null;
    remainder = consumeSeparator(toolUseRejection);
  }

  if (!STOP_WAIT_FOR_USER_PATTERN.test(remainder)) return null;
  return refusal.groups?.decline
    ? { kind: "authorization_control", executionEvidence: "absent" }
    : { kind: "user_rejection", executionEvidence: "unspecified" };
}

function consumeToolUseRejectionClause(value: string): string | null {
  const match = TOOL_USE_REJECTED_PATTERN.exec(value);
  if (!match) return null;

  return consumeOptionalParenthetical(value.slice(match[0].length));
}

function consumeSeparator(value: string): string {
  return value.replace(/^\s*[,:;.!?]\s*/u, "");
}

function consumeOptionalParenthetical(value: string): string {
  const match = /^\s*\(([^()]*)\)\s*/u.exec(value);
  if (!match) return value;

  const parenthetical = match[1] ?? "";
  if (
    parenthetical.length > 240 ||
    !/(?:\beg\b|\be\.g\.|\bfor example\b|\bif\b)/i.test(parenthetical)
  ) {
    return value;
  }

  return value.slice(match[0].length);
}
