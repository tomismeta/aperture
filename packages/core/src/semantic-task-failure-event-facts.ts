import {
  compileAssertionScope,
  splitAssertions,
  stripScopedClauses,
} from "./semantic-task-failure-assertion-scope.js";

export function parseTaskFailureEventFact(
  value: string | readonly string[],
  contradiction = false,
) {
  const fields = typeof value === "string" ? [value] : value;
  const semanticFields = fields.map((field) =>
    field.replace(/^\s*OBSERVATION:\s*(?=the\s+user\b)/i, ""),
  );
  const factFields =
    fields.length > 1 && semanticFields.slice(1).some((field) => field.trim())
      ? semanticFields.slice(1)
      : semanticFields;
  const rawEventText = factFields.join(". ").replace(QUOTED_TEXT, " quoted-content ");
  const documentPayload =
    COMPLETE_DOCUMENT_DELIVERY.test(rawEventText) && hasDocumentContent(rawEventText);
  const scoped = compileAssertionScope(semanticFields);
  if (scoped.authoritative.length === 0) return documentPayload ? "document_payload" : null;
  const factScope = compileAssertionScope(
    factFields.map((field) => stripScopedClauses(field, isDocumentContentClause)),
  );
  const eventScope = compileAssertionScope(
    semanticFields.map((field) => stripScopedClauses(field, isDocumentContentClause)),
  );
  const authoritativeEventText = factScope.authoritative.replace(QUOTED_TEXT, " quoted-content ");
  const positiveEventText = factScope.positive.replace(QUOTED_TEXT, " quoted-content ");
  const allPositiveEventText = eventScope.positive.replace(QUOTED_TEXT, " quoted-content ");
  const fact = EVENT_FACT_ORDER.find(
    (kind) =>
      EVENT_FACTS[kind].test(
        POSITIVE_EVENT_FACTS.includes(kind) ? positiveEventText : authoritativeEventText,
      ) &&
      (kind !== "authorization_control" ||
        (!contradiction && !hasPositiveExecution(allPositiveEventText))),
  );
  if (fact !== undefined) return fact;
  if (SOURCE_WINDOW.test(positiveEventText))
    return SOURCE_DIAGNOSTIC.test(positiveEventText) ? "source_diagnostic" : "source_limit";
  if (!documentPayload) return null;
  if (contradiction && hasPositiveExecution(allPositiveEventText)) return "runtime_diagnostic";
  return "document_payload";
}
const isDocumentContentClause = (value: string) => DOCUMENT_CONTENT_CLAUSE.test(value);
const hasDocumentContent = (value: string) =>
  splitAssertions(value).some(
    (clause) => isDocumentContentClause(clause) && !NEGATED_DOCUMENT_CONTENT.test(clause),
  );
const EVENT_FACTS = {
  runtime_diagnostic:
    /^(?=[\s\S]*\b(?:execution(?:\s+(?:(?:later|subsequently)\s+)?(?:did\s+start|started|occurred|reached\s+a\s+terminal|completed|finished|terminated|crashed|failed)|\b[^.!?;]{0,80}\b(?:later|subsequently)\s+(?:started|ran|executed|occurred|completed|finished|terminated|crashed|failed))|(?:command|process|subprocess|worker)(?:\s+invocation)?\s+(?:occurred|executed|ran|terminated|crashed|exited|failed))\b)(?=[\s\S]*\b(?:runtime\s+failure|runtimeerror|traceback|segmentation\s+fault|(?:process|subprocess|worker|execution)(?:\s+(?:(?:ran|started)\s+and\s+|(?:later|subsequently)\s+)?(?:crashed|terminated|failed)|\b[^.!?;]{0,80}\b(?:later|subsequently)\s+(?:crashed|terminated|failed))|invalid\s+memory\s+access|(?:allocation|allocator|memory)\b[^.!?;]{0,80}\b(?:failed|failure|exhaustion|breach)|(?:error|exception|fault)\b[^.!?;]{0,60}\b(?:raised|thrown|escaped|returned))\b)(?:(?=[\s\S]*\b(?:(?:complete|full)\s+(?:(?:standard[- ]?error|stderr|terminal|execution|runtime|command)\s+)?diagnostic(?:\s+(?:channel|output|record))?|complete\s+(?:standard[- ]?error|stderr|terminal|execution|command)\s+output)\b)|(?=[\s\S]*\b(?:complete|terminal)\s+(?:command|process|terminal|execution|outcome|result|record)\b)(?=[\s\S]*\b(?:standard[- ]?error|stderr|terminal|diagnostic)(?:\s+(?:channel|output))?\s+(?:reports?|contains?|emits?|shows?|was\s+returned)\b))[\s\S]+$/i,
  expected_source_diagnostic:
    /^(?=[\s\S]*\b(?:(?:complete|completed|bounded)\s+(?:diagnostic|validation)\s+(?:check|result|record)|(?:diagnostic|validation)\s+(?:check|result|record)\s+(?:is\s+)?complete)\b)(?=[\s\S]*\b(?:(?:expected|requested)\s+(?:observation|diagnostic|result)|expectedly\s+(?:failed|reported|returned))\b)(?=[\s\S]*\b(?:(?:failed|failure|invalid|error)\s+(?:source|document|syntax|parse|validation)|(?:source|document|syntax|parse)(?:\s+validation)?\s+(?:failed|failure|invalid|error))\b)[\s\S]+$/i,
  authorization_control:
    /^(?!\s*(?:observation:\s*)?(?:log:|["'`]))(?![\s\S]*\btraceback\s+follows\b)(?=[\s\S]*\b(?:authorization|permission|approval|decision)\s+(?:(?:is|was|remains)\s+)?(?:required|needed|pending|declined|denied|rejected)\b)(?=[\s\S]*(?:\bbefore\b[\s\S]*\b(?:operation|invocation|execution|capability|tool|command)\b|\b(?:required|needed)\s+(?:first|before\s+execution)\b))(?=[\s\S]*\b(?:(?:the\s+)?(?:capability|tool|command|operation)\s+(?:has\s+not|was\s+not|did\s+not)\s+(?:been\s+)?(?:invoked|executed|run|started)|execution\s+(?:has\s+not|was\s+not|did\s+not)\s+(?:start(?:ed)?|begin|begun)|no\s+(?:tool\s+call|invocation|execution)\s+(?:occurred|started|was\s+(?:performed|run)))\b)(?=[\s\S]*\b(?:no\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created|returned))|(?:an?\s+)?(?:execution\s+)?result\s+(?:is\s+absent|does\s+not\s+exist|was\s+not\s+(?:produced|created|returned)))\b)[\s\S]+$/i,
  terminal_success:
    /^(?=[\s\S]*\b(?:(?:complete|terminal)\s+(?:command|process|terminal|execution|outcome|result|record)|(?:command|process|terminal|execution|outcome|result|record)\s+(?:(?:is|was)\s+)?(?:complete|terminal)|(?:result|outcome|record)\s+is\s+(?:terminal\s+and\s+complete|complete\s+and\s+terminal)|execution\s+(?:is\s+)?complete|execution\s+(?:completed|finished))\b)(?=[\s\S]*\b(?:exit|return)\s+(?:code|status)\s+(?:is\s+|was\s+|reports?\s+|returned\s+)?(?:0|zero)\b)(?=[\s\S]*(?:\bno\s+(?:output|diagnostic|evidence)(?:\s+or\s+(?:output|diagnostic|evidence))?\s+channels?\s+is\s+missing\b|\b(?:standard\s+output|stdout)\b[\s\S]*\b(?:standard\s+error|stderr)\b))(?![\s\S]*\b(?:non[- ]?zero|crashed|runtimeerror|traceback)\b)[\s\S]+$/i,
  absent_failure:
    /^(?=[\s\S]*\b(?:(?:command|process|execution|operation|result|outcome)?\s*(?:failed|failure)|(?:exit|return)(?:ed)?\s+(?:with\s+)?(?:code|status)?\s*(?:is\s+|was\s+|reports?\s+|returned\s+)?-?[1-9]\d*)\b)(?=[\s\S]*(?:\b(?:standard\s+output|stdout)(?:\s+field)?\s+(?:is\s+)?(?:present\s+and\s+)?(?:explicitly\s+)?empty\b[\s\S]*\b(?:standard\s+error|stderr)(?:\s+field)?\s+(?:is\s+)?(?:present\s+and\s+)?(?:explicitly\s+)?empty\b|\b(?:required|expected)\s+failure\s+(?:output|evidence)(?:\s+channel)?\s+(?:is\s+)?explicitly\s+(?:empty|absent|missing)\b))(?=[\s\S]*\bno\s+diagnostic\s+(?:payload|text|output|content)\s+(?:was\s+|is\s+)?(?:returned|captured|present|produced|supplied|provided|included)\b)[\s\S]+$/i,
  outcome_failure:
    /^(?=[\s\S]*\b(?:(?:complete|terminal)\s+(?:command|process|terminal|execution|outcome|result|record)|(?:command|process|terminal|execution|outcome|result|record)\s+(?:(?:is|was)\s+)?(?:complete|terminal)|execution\s+(?:is\s+)?complete|execution\s+(?:completed|finished)|outcome-only\s+record)\b)(?=[\s\S]*(?:\b(?:exit|return)(?:ed)?\s+(?:with\s+)?(?:code|status)?\s*(?:is\s+|was\s+|reports?\s+|returned\s+)?-?[1-9]\d*\b|\bnon[- ]?zero\s+(?:exit|return)\b))(?=[\s\S]*(?:\boutcome-only\s+(?:record|result|evidence)\b|\b(?:output|diagnostic)(?:\s+and\s+(?:output|diagnostic))?\s+(?:payloads?\s+|content\s+|channels?\s+)?(?:are|were|is|was)\s+(?:not\s+part\s+of|excluded\s+from)\b))[\s\S]+$/i,
} as const;
const EVENT_FACT_ORDER: Array<keyof typeof EVENT_FACTS> = [
  "runtime_diagnostic",
  "terminal_success",
  "absent_failure",
  "outcome_failure",
  "expected_source_diagnostic",
  "authorization_control",
];
const POSITIVE_EVENT_FACTS: ReadonlyArray<keyof typeof EVENT_FACTS> = [
  "runtime_diagnostic",
  "terminal_success",
  "outcome_failure",
  "expected_source_diagnostic",
];
const SOURCE_WINDOW =
  /^(?=[\s\S]*\b(?:(?:exceeds?|exceeded|larger than|too large for|over|above)\s+(?:the\s+)?(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)|(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\s+(?:is|was)?\s*(?:exceeded|reached)|(?:remainder|rest|remaining\s+lines?)\s+(?:are\s+|remain\s+|was\s+)?(?:intentionally\s+)?(?:omitted|truncated|clipped|outside\s+(?:the\s+)?returned\s+view)|(?:bounded|measured)\s+partial\s+(?:source\s+)?view)\b)(?=[\s\S]*(?:^|[.!?]\s+)(?:the\s+)?(?:(?:(?:file|source|document|read)\s+)?(?:content|output|payload|window|view)|(?:returned|showing|displaying)|read\b(?:(?![.!?]\s+)[\s\S])*\b(?:content|output|payload|window|view|lines?))\b(?:(?![.!?]\s+)[\s\S])*(?:\((?:\d+(?:\.\d+)?\s*(?:kb|mb|gb|b)|\d+\s*tokens?)\)|\blines?\s+\d+(?:\s+(?:through|to)\s+|\s*-\s*)\d+\s+of\s+(?:a\s+)?\d+(?:[- ]line\s+source)?\b|\b\d+\s+lines?\s+(?:beginning|starting)\s+at\s+offset\s+\d+\s+from\s+(?:a\s+)?(?:source\s+)?(?:totaling\s+)?\d+\s+(?:total\s+)?lines?\b))[\s\S]+$/i;
const SOURCE_DIAGNOSTIC =
  /\b(?:permission denied|operation not permitted|no such file or directory|(?:failed|could not|unable) to (?:read|open))\b/i;
const DOCUMENT_CONTENT_CLAUSE =
  /^(?:(?:it|(?:the|this|that)\s+(?:returned\s+)?(?:document|source|payload))\s+|its\s+(?:contents?|body|text)\s+|(?:within|inside)\s+(?:it|(?:the|this|that)\s+(?:document|source|payload))[,;:]?\s+(?:(?:the|its)\s+(?:contents?|body|text)\s+)?|(?:a|the)\s+(?:complete|full)\s+(?:document|source)\s+(?:read|payload)\b[^.!?;]*\b)(?:contains?|includes?|quotes?|explains?|says?|states?|reports?|describes?)\b/i;
const COMPLETE_DOCUMENT_DELIVERY =
  /\b(?:a|the)\s+(?:complete|full)\s+(?:document|source)\s+(?:read|payload)\b\s+(?:(?:was\s+)?(?:returned|delivered|produced)(?:\s+in\s+full)?|(?:contains?|includes?|explains?|quotes?|says?|states?|reports?|describes?))\b/i;
const QUOTED_TEXT = /(["'`])(?:\\.|(?!\1)[^\\])*\1/gu;
const NEGATED_DOCUMENT_CONTENT =
  /\b(?:(?:does?|did|is|was)\s+not\s+(?:contain|include)\w*\s+(?:an?\s+|any\s+)?(?:content|payload|body|text|document|source)|(?:contain|include)\w*\s+(?:no|nothing|neither)\s*(?:content|payload|body|text|document|source)?)\b/i;
const POSITIVE_EXECUTION =
  /\b(?:(?:execution|operation|invocation|command|process|tool)(?:\s+invocation)?\s+(?:(?:(?:did|was)\s+)?(?:(?:later|subsequently)\s+)?(?:start(?:ed)?|run|ran|execute[ds]?|occurred|completed|finished|terminated|crashed|failed|exited|performed)|(?:(?:later|subsequently)\s+)?returned\s+(?:output|a\s+result))|(?:an?\s+)?result\s+(?:was\s+)?(?:(?:later|subsequently)\s+)?(?:produced|returned))\b/i;
const hasPositiveExecution = (value: string) => POSITIVE_EXECUTION.test(value);
