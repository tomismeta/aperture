export function parseTaskFailureEventFact(value: string, documentDiagnosticContradiction = false) {
  const text = readAssertedEventText(value);
  if (text.length === 0) return null;
  if (hasSourceWindowBoundary(text))
    return SOURCE_WINDOW_DIAGNOSTIC.test(text) ? "source_diagnostic" : "source_limit";
  if (COMPLETE_RUNTIME_DIAGNOSTIC.test(text)) return "runtime_diagnostic";
  if (COMPLETE_AUTHORIZATION_CONTROL.test(text)) return "authorization_control";
  if (COMPLETE_TERMINAL_SUCCESS.test(text)) return "terminal_success";
  if (COMPLETE_OUTCOME_ONLY_FAILURE.test(text)) return "outcome_failure";
  if (COMPLETE_ABSENT_FAILURE.test(text)) return "absent_failure";
  const documentDelivery = COMPLETE_DOCUMENT_DELIVERY.exec(text);
  if (documentDelivery === null) return null;
  if (documentDiagnosticContradiction) return "runtime_diagnostic";
  const documentBody = text.slice(documentDelivery[0].length).toLowerCase();
  const contains = documentBody.includes.bind(documentBody);
  if (["contains no ", "includes no ", "contains nothing", "includes nothing"].some(contains))
    return null;
  return ["contains", "includes", "explains", "quotes"].some(contains) ? "document_payload" : null;
}
function hasSourceWindowBoundary(text: string): boolean {
  return (
    SOURCE_WINDOW_SUBJECT.test(text) &&
    SOURCE_WINDOW_MEASURE.test(text) &&
    SOURCE_WINDOW_BOUNDARY.test(text)
  );
}
export function looksLikeBareNonzeroTerminalExitEvidence(value: string): boolean {
  const text = value.toLowerCase().replace(/\W+/g, " ").trim();
  return BARE_NONZERO_EXIT.some((pattern) => pattern.test(text));
}
export function readPreExecutionControl(value: string, diagnostic: boolean) {
  const body = value.replace(/^\s*(?:OBSERVATION:\s*)?/i, "").trim();
  if (parseTaskFailureEventFact(body) === "authorization_control")
    return { conflictingDiagnostic: diagnostic, outcome: AUTH_CONTROL } as const;
  const refusal = USER_REFUSAL.exec(body);
  if (refusal === null) return null;
  let remainder = trimSeparator(body.slice(refusal[0].length));
  if (refusal.groups?.user?.toLowerCase().includes("tool use")) {
    const rejected = TOOL_REJECTED.exec(remainder);
    if (rejected === null) return null;
    remainder = trimSeparator(consumeOptionalParenthetical(remainder.slice(rejected[0].length)));
  }
  if (!STOP_OR_ABSENT_RESULT.test(remainder) && !(diagnostic && CONTRADICTORY_CONTROL.test(body)))
    return null;
  return { conflictingDiagnostic: diagnostic, outcome: USER_REJECTION } as const;
}
function readAssertedEventText(value: string): string {
  return value
    .split(/(?<=[.!?])\s+/u)
    .map((clause) => clause.trim())
    .filter((clause) => clause && !NON_ASSERTED_FRAME.test(clause))
    .join(" ");
}

const trimSeparator = (value: string) => value.replace(/^\s*[,:;.!?]\s*/u, "");

function consumeOptionalParenthetical(value: string): string {
  const match = /^\s*\(([^()]*)\)\s*/u.exec(value);
  return match?.[1] !== undefined && EXPLANATORY_ASIDE.test(match[1])
    ? value.slice(match[0].length)
    : value;
}

const NON_ASSERTED_FRAME =
  /^(?:["'`]|for reference\b|reference (?:text|material)\b|(?:the )?(?:documentation|document|source|log|example|fixture)\s+(?:says|states|contains|quotes|explains)\b|(?:expected|hypothetical|quoted)\b|if\b|when\b|suppose\b|one sentence says\b)/i;
const COMPLETE_DOCUMENT_DELIVERY =
  /^(?:a|the)\s+complete\s+(?:document|source)\s+(?:read|payload)\s+(?:was\s+)?(?:returned|delivered|produced)\b/i;
const COMPLETE_RUNTIME_DIAGNOSTIC =
  /^(?=[\s\S]*\b(?:complete\s+(?:terminal|command|execution)\s+record|complete\s+(?:standard[- ]?error|stderr|terminal|execution|command)\s+output)\b)(?=[\s\S]*\b(?:execution\s+(?:did\s+start|started|occurred)|(?:command|process|subprocess)(?:\s+invocation)?\s+(?:occurred|executed|ran))\b)(?=[\s\S]*\b(?:standard[- ]?error|stderr|terminal|diagnostic)(?:\s+(?:channel|output))?\s+(?:reports?|contains?|emits?|shows?)\s+(?!no\s+(?:failure|error)\b)\S)(?![\s\S]*\b(?:completed|finished)\s+successfully\b)[\s\S]+$/i;
const COMPLETE_TERMINAL_SUCCESS =
  /^(?=[\s\S]*\b(?:complete\s+(?:command|process|terminal|execution)\s+(?:record|result|outcome)|(?:result|outcome|record)\s+is\s+(?:terminal\s+and\s+complete|complete\s+and\s+terminal))\b)(?=[\s\S]*\b(?:exit|return)\s+(?:code|status)\s+(?:is\s+|was\s+|reports?\s+)?(?:0|zero)\b)(?=[\s\S]*(?:\bno\s+(?:output|diagnostic|evidence)(?:\s+or\s+(?:output|diagnostic|evidence))?\s+channels?\s+is\s+missing\b|\b(?:standard\s+output|stdout)\b[\s\S]*\b(?:standard\s+error|stderr)\b))(?![\s\S]*\b(?:non[- ]?zero|failed|failure|crashed|runtimeerror|traceback)\b)[\s\S]+$/i;
const COMPLETE_OUTCOME_ONLY_FAILURE =
  /^(?=[\s\S]*\bcomplete\s+(?:command|process|terminal|execution)\s+(?:record|result|outcome)\b)(?=[\s\S]*\b(?:exit|return)\s+(?:code|status)\s+(?:is\s+|was\s+|reports?\s+)?-?[1-9]\d*\b)(?=[\s\S]*\b(?:output|diagnostic)(?:\s+and\s+(?:output|diagnostic))?\s+channels?\s+(?:are|were)\s+(?:not\s+part\s+of|excluded\s+from)\b)[\s\S]+$/i;
const COMPLETE_ABSENT_FAILURE =
  /^(?=[\s\S]*\b(?:command|process|execution)\s+failed\b)(?=[\s\S]*\b(?:standard\s+output|stdout)(?:\s+field)?\s+(?:is\s+)?(?:present\s+and\s+)?empty\b)(?=[\s\S]*\b(?:standard\s+error|stderr)(?:\s+field)?\s+(?:is\s+)?(?:present\s+and\s+)?empty\b)(?=[\s\S]*\bno\s+diagnostic\s+(?:payload|text|output)\s+(?:was\s+)?(?:returned|captured|present|produced)\b)[\s\S]+$/i;
const COMPLETE_AUTHORIZATION_CONTROL =
  /^(?=[\s\S]*\b(?:authorization|permission|approval)\s+(?:(?:is|was|remains)\s+)?(?:required|needed|pending|declined|denied|rejected)\b)(?=[\s\S]*\bbefore\b[\s\S]*\b(?:operation|invocation|execution|capability|tool|command)\b)(?=[\s\S]*\b(?:(?:the\s+)?(?:capability|tool|command)\s+(?:has\s+not|was\s+not|did\s+not)\s+(?:been\s+)?(?:invoked|executed|run)|execution\s+(?:has\s+not|was\s+not|did\s+not)\s+(?:start(?:ed)?|begin|begun)|no\s+(?:tool\s+call|invocation|execution)\s+(?:occurred|started|was\s+(?:performed|run)))\b)(?=[\s\S]*\b(?:no\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created|returned))|(?:an?\s+)?(?:execution\s+)?result\s+(?:is\s+absent|does\s+not\s+exist|was\s+not\s+(?:produced|created|returned)))\b)(?![\s\S]*\b(?<!no\s)execution\s+(?:did\s+start|started|occurred|completed)\b)[\s\S]+$/i;
const SOURCE_WINDOW_SUBJECT =
  /^(?:the\s+)?(?:(?:file|source|document|read)\s+)?(?:content|output|payload|window|read)\b|^(?:the\s+)?(?:returned|showing|displaying)\s+lines?\b/i;
const SOURCE_WINDOW_MEASURE =
  /\((?:\d+(?:\.\d+)?\s*(?:kb|mb|gb|b)|\d+\s*tokens?)\)|\blines?\s+\d+(?:\s+(?:through|to)\s+|\s*-\s*)\d+\s+of\s+(?:a\s+)?\d+(?:[- ]line\s+source)?\b/i;
const SOURCE_WINDOW_BOUNDARY =
  /\b(?:exceeds?|exceeded|larger than|too large for|over|above)\s+(?:the\s+)?(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\b|\b(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\s+(?:is|was)?\s*(?:exceeded|reached)\b|\b(?:remainder|rest|remaining\s+lines?)\s+(?:are\s+|remain\s+|was\s+)?(?:intentionally\s+)?(?:omitted|truncated|clipped|outside\s+(?:the\s+)?returned\s+view)\b/i;
const SOURCE_WINDOW_DIAGNOSTIC =
  /\b(?:permission denied|operation not permitted|no such file or directory|failed to (?:read|open)|could not (?:read|open)|unable to (?:read|open))\b/i;
const BARE_NONZERO_EXIT = [
  /^(?:no output|without output|no stdout no stderr|no stderr no stdout|empty stdout empty stderr|stdout empty stderr empty)\s+(?:(?:command|process|tool|subprocess)\s+)?(?:(?:exit|return)(?:ed)?\s+(?:with\s+)?(?:code|status)\s*(?:is|was)?\s*-?[1-9]\d*|(?:failed\s+with\s+)?(?:a\s+)?non[- ]?zero\s+exit)$/i,
  /^(?:the )?(?:command|process|tool|subprocess)\s+(?:exit|return)(?:ed)?\s+(?:with\s+)?(?:code|status)\s*(?:is|was)?\s*-?[1-9]\d*\s+(?:no|without)\s+(?:(?:standard|error) output|stdout|stderr|diagnostic (?:text|output))(?:\s*(?:and|or)?\s*(?:(?:standard|error) output|stdout|stderr|diagnostic (?:text|output))){1,3}\s+(?:(?:was|were)\s+)?(?:retained|captured|available|produced)$/i,
] as const;
const USER_REFUSAL =
  /^(?<user>the\s+user\s+(?:doesn['’]?t|does\s+not)\s+want\s+to\s+(?:proceed\s+with\s+this\s+tool\s+use|take\s+this\s+action(?:\s+right\s+now)?))\b/i;
const TOOL_REJECTED = /^(?:the\s+)?tool\s+use\s+(?:was\s+)?rejected\b/i;
const EXPLANATORY_ASIDE = /(?:\beg\b|\be\.g\.|\bfor example\b|\bif\b)/i;
const STOP_OR_ABSENT_RESULT =
  /^(?:stop\s+(?:(?:what\s+you\s+are\s+doing\s+and|and)\s+)?wait\s+for\s+(?:the\s+)?user\s+to\s+(?:tell\s+you\s+how\s+to\s+)?proceed|no\s+(?:tool\s+call|invocation|execution)\s+(?:occurred|was\s+(?:started|performed|run))\s*(?:[,;.]|\band\b)\s*no\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created)))\s*[.!?]?$/i;
const CONTRADICTORY_CONTROL =
  /^(?=[\s\S]*\bthe\s+user\s+(?:doesn['’]?t|does\s+not)\s+want\s+to\s+(?:proceed|take\s+this\s+action)\b)(?=[\s\S]*\btool\s+use\s+(?:was\s+)?rejected\b)(?=[\s\S]*\b(?:stop|wait)\b)[\s\S]+$/i;
const AUTH_CONTROL = { kind: "authorization_control", executionEvidence: "absent" } as const;
const USER_REJECTION = { kind: "user_rejection", executionEvidence: "unspecified" } as const;
