import {
  compileAssertionScope,
  splitAssertions,
  stripScopedClauses,
} from "./semantic-task-failure-assertion-scope.js";
import { readStructuralTaskFailureFact } from "./semantic-task-failure-structural-facts.js";
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
    COMPLETE_DOCUMENT_DELIVERY.test(rawEventText) &&
    splitAssertions(rawEventText).some(
      (clause) => DOCUMENT_CONTENT_CLAUSE.test(clause) && !NEGATED_DOCUMENT_CONTENT.test(clause),
    );
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
  const structuralFact = readStructuralTaskFailureFact({
    text: positiveEventText,
    authoritativeText: authoritativeEventText,
    scopeText: semanticFields.join(". "),
    diagnosticScopeText: semanticFields
      .map((field) => stripScopedClauses(field, isDocumentContentClause))
      .join(". "),
    documentPayload,
    contradiction,
  });
  if (structuralFact !== null) return structuralFact;
  const fact = EVENT_FACT_ORDER.find(
    (kind) =>
      EVENT_FACTS[kind].test(
        POSITIVE_EVENT_FACTS.includes(kind) ? positiveEventText : authoritativeEventText,
      ) &&
      (kind !== "authorization_control" ||
        (!contradiction && !hasPositiveExecution(allPositiveEventText))),
  );
  if (fact !== undefined) return fact;
  if (!documentPayload) return null;
  return "document_payload";
}
const EVENT_FACTS = {
  expected_source_diagnostic:
    /^(?=[\s\S]*\b(?:(?:complete|completed|bounded)\s+(?:diagnostic|validation)\s+(?:check|result|record)|(?:diagnostic|validation)\s+(?:check|result|record)\s+(?:is\s+)?complete)\b)(?=[\s\S]*\b(?:(?:expected|requested)\s+(?:observation|diagnostic|result)|expectedly\s+(?:failed|reported|returned))\b)(?=[\s\S]*\b(?:(?:failed|failure|invalid|error)\s+(?:source|document|syntax|parse|validation)|(?:source|document|syntax|parse)(?:\s+validation)?\s+(?:failed|failure|invalid|error))\b)[\s\S]+$/i,
  authorization_control:
    /^(?!\s*(?:observation:\s*)?(?:log:|["'`]))(?![\s\S]*\btraceback\s+follows\b)(?=[\s\S]*\b(?:authorization|permission|approval|decision)\s+(?:(?:is|was|remains)\s+)?(?:required|needed|pending|declined|denied|rejected)\b)(?=[\s\S]*(?:\bbefore\b[\s\S]*\b(?:operation|invocation|execution|capability|tool|command)\b|\b(?:required|needed)\s+(?:first|before\s+execution)\b))(?=[\s\S]*\b(?:(?:the\s+)?(?:capability|tool|command|operation)\s+(?:has\s+not|was\s+not|did\s+not)\s+(?:been\s+)?(?:invoked|executed|run|started)|execution\s+(?:has\s+not|was\s+not|did\s+not)\s+(?:start(?:ed)?|begin|begun)|no\s+(?:tool\s+call|invocation|execution)\s+(?:occurred|started|was\s+(?:performed|run)))\b)(?=[\s\S]*\b(?:no\s+(?:execution\s+)?result\s+(?:exists|was\s+(?:produced|created|returned))|(?:an?\s+)?(?:execution\s+)?result\s+(?:is\s+absent|does\s+not\s+exist|was\s+not\s+(?:produced|created|returned)))\b)[\s\S]+$/i,
  outcome_failure:
    /^(?=[\s\S]*\b(?:(?:complete|terminal)\s+(?:command|process|terminal|execution|outcome|result|record)|(?:command|process|terminal|execution|outcome|result|record)\s+(?:(?:is|was)\s+)?(?:complete|terminal)|execution\s+(?:is\s+)?complete|execution\s+(?:completed|finished)|outcome-only\s+record)\b)(?=[\s\S]*(?:\b(?:exit|return)(?:ed)?\s+(?:with\s+)?(?:code|status)?\s*(?:is\s+|was\s+|reports?\s+|returned\s+)?-?[1-9]\d*\b|\bnon[- ]?zero\s+(?:exit|return)\b))(?=[\s\S]*(?:\boutcome-only\s+(?:record|result|evidence)\b|\b(?:output|diagnostic)(?:\s+and\s+(?:output|diagnostic))?\s+(?:payloads?\s+|content\s+|channels?\s+)?(?:are|were|is|was)\s+(?:not\s+part\s+of|excluded\s+from)\b))[\s\S]+$/i,
} as const;
const EVENT_FACT_ORDER: Array<keyof typeof EVENT_FACTS> = [
  "outcome_failure",
  "expected_source_diagnostic",
  "authorization_control",
];
const POSITIVE_EVENT_FACTS: ReadonlyArray<keyof typeof EVENT_FACTS> = [
  "outcome_failure",
  "expected_source_diagnostic",
];
const DOCUMENT_CONTENT_CLAUSE =
  /^(?:(?:it|(?:the|this|that)\s+(?:returned\s+)?(?:document|source|payload))\s+|its\s+(?:contents?|body|text)\s+|(?:within|inside)\s+(?:it|(?:the|this|that)\s+(?:document|source|payload))[,;:]?\s+(?:(?:the|its)\s+(?:contents?|body|text)\s+)?|(?:a|the)\s+(?:complete|full)\s+(?:document|source)\s+(?:read|payload)\b[^.!?;]*\b)(?:contains?|includes?|quotes?|explains?|says?|states?|reports?|describes?)\b/i;
const isDocumentContentClause = (value: string) => DOCUMENT_CONTENT_CLAUSE.test(value);
const COMPLETE_DOCUMENT_DELIVERY =
  /\b(?:a|the)\s+(?:complete|full)\s+(?:document|source)\s+(?:read|payload)\b\s+(?:(?:was\s+)?(?:returned|delivered|produced)(?:\s+in\s+full)?|(?:contains?|includes?|explains?|quotes?|says?|states?|reports?|describes?))\b/i;
const QUOTED_TEXT = /(["'`])(?:\\.|(?!\1)[^\\])*\1/gu;
const NEGATED_DOCUMENT_CONTENT =
  /\b(?:(?:does?|did|is|was)\s+not\s+(?:contain|include)\w*\s+(?:an?\s+|any\s+)?(?:content|payload|body|text|document|source)|(?:contain|include)\w*\s+(?:no|nothing|neither)\s*(?:content|payload|body|text|document|source)?)\b/i;
const POSITIVE_EXECUTION =
  /\b(?:(?:execution|operation|invocation|command|process|tool)(?:\s+invocation)?\s+(?:(?:(?:did|was)\s+)?(?:(?:later|subsequently)\s+)?(?:start(?:ed)?|run|ran|execute[ds]?|occurred|completed|finished|terminated|crashed|failed|exited|performed)|(?:(?:later|subsequently)\s+)?returned\s+(?:output|a\s+result))|(?:an?\s+)?result\s+(?:was\s+)?(?:(?:later|subsequently)\s+)?(?:produced|returned))\b/i;
const hasPositiveExecution = (value: string) => POSITIVE_EXECUTION.test(value);
