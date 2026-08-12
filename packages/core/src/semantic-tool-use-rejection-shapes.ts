const USER_REFUSAL_PATTERN =
  /^(?<user>the\s+user\s+(?:doesn['’]?t|does\s+not)\s+want\s+to\s+(?:proceed\s+with\s+this\s+tool\s+use|take\s+this\s+action(?:\s+right\s+now)?))\b/i;
const TOOL_USE_REJECTED_PATTERN = /^(?:the\s+)?tool\s+use\s+(?:was\s+)?rejected\b/i;
const STOP_WAIT_FOR_USER_PATTERN =
  /^(?:stop\s+(?:(?:what\s+you\s+are\s+doing\s+and|and)\s+)?wait\s+for\s+(?:the\s+)?user\s+to\s+(?:tell\s+you\s+how\s+to\s+)?proceed|no\s+(?:tool\s+call|invocation|execution)\s+(?:occurred|was\s+(?:started|performed|run))\s*(?:[,;.]|\band\b)\s*no\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created)))\s*[.!?]?$/i;

const AUTHORIZATION_CONTROL = {
  kind: "authorization_control",
  executionEvidence: "absent",
} as const;
const USER_REJECTION = { kind: "user_rejection", executionEvidence: "unspecified" } as const;
type ControlRead = {
  conflictingDiagnostic: boolean;
  outcome: typeof AUTHORIZATION_CONTROL | typeof USER_REJECTION;
};

export function readPreExecutionControl(value: string, diagnostic: boolean): ControlRead | null {
  const body = value
    .trim()
    .replace(/^OBSERVATION:\s*/i, "")
    .trim();
  if (COMPLETE_AUTHORIZATION_CONTROL.test(body)) {
    return { conflictingDiagnostic: diagnostic, outcome: AUTHORIZATION_CONTROL };
  }
  const refusal = USER_REFUSAL_PATTERN.exec(body);
  if (!refusal) return null;

  let remainder = consumeSeparator(body.slice(refusal[0].length));
  if (/\btool\s+use\b/i.test(refusal.groups?.user ?? "")) {
    const rejected = TOOL_USE_REJECTED_PATTERN.exec(remainder);
    if (rejected === null) return null;
    remainder = consumeSeparator(consumeOptionalParenthetical(remainder.slice(rejected[0].length)));
  }
  const complete = STOP_WAIT_FOR_USER_PATTERN.test(remainder);
  if (!complete && !(diagnostic && CONTRADICTORY_USER_CONTROL.test(body))) return null;
  return { conflictingDiagnostic: diagnostic, outcome: USER_REJECTION };
}

function consumeSeparator(value: string): string {
  return value.replace(/^\s*[,:;.!?]\s*/u, "");
}

function consumeOptionalParenthetical(value: string): string {
  const match = /^\s*\(([^()]*)\)\s*/u.exec(value);
  if (!match) return value;
  const parenthetical = match[1] ?? "";
  const explanatory =
    parenthetical.length <= 240 &&
    /(?:\beg\b|\be\.g\.|\bfor example\b|\bif\b)/i.test(parenthetical);
  return explanatory ? value.slice(match[0].length) : value;
}

const COMPLETE_AUTHORIZATION_CONTROL =
  /^(?:(?:authorization|permission|approval)\s+(?:is\s+|remains\s+)?(?:required|needed|pending)\s+before\s+(?:(?:the\s+)?(?:capability|tool|command)\s+)?(?:invocation|execution)|(?:authorization|permission|approval)\s+(?:was\s+)?(?:declined|denied|rejected)\s+before\s+(?:tool\s+)?(?:invocation|execution))\b(?=[\s\S]*\b(?:(?:the\s+)?(?:capability|tool|command)\s+(?:has\s+not|was\s+not|wasn['’]?t|did\s+not|didn['’]?t)\s+(?:been\s+)?(?:invoked|executed|run)|no\s+(?:capability|tool|command)?\s*(?:call|invocation|execution)\s+(?:occurred|started|was\s+(?:performed|run))|execution\s+(?:has\s+not|was\s+not|did\s+not)\s+start(?:ed)?)\b)(?=[\s\S]*\b(?:(?:an?\s+)?(?:execution\s+)?result\s+(?:is\s+absent|does\s+not\s+exist|was\s+not\s+(?:produced|created|returned))|no\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created|returned)))\b)(?![\s\S]*\b(?:(?:the\s+)?(?:capability|tool|command)\s+(?:was\s+)?(?:invoked|executed|run|ran|completed)|(?<!no )execution\s+(?:started|occurred|completed)|(?:an?|the)\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created|returned)))\b)[\s\S]+$/i;
const CONTRADICTORY_USER_CONTROL =
  /^(?=[\s\S]*\bthe\s+user\s+(?:doesn['’]?t|does\s+not)\s+want\s+to\s+(?:proceed|take\s+this\s+action)\b)(?=[\s\S]*\btool\s+use\s+(?:was\s+)?rejected\b)(?=[\s\S]*\b(?:stop|wait)\b)[\s\S]+$/i;
