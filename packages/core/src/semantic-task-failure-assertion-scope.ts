export function compileAssertionScope(value: string | readonly string[]) {
  const fields = typeof value === "string" ? [value] : value;
  const scopedFields = fields.map((field) =>
    splitAssertions(field)
      .map((clause) => clause.trim())
      .filter((clause) => clause && !NON_ASSERTED_FRAME.test(clause)),
  );
  const actual = fields.length < 2 || !NON_ACTUAL_TITLE.test(fields[0] ?? "");
  const authoritativeFields = scopedFields.map((clauses) =>
    actual
      ? clauses.filter(
          (clause) => !NON_ASSERTED_SCOPE.test(clause) && !NON_ASSERTED_EVENT_FACT.test(clause),
        )
      : [],
  );
  const join = (fieldClauses: string[][]) => fieldClauses.flat().filter(Boolean).join(". ");
  return {
    authoritative: join(authoritativeFields),
    fields: authoritativeFields.map((clauses) => clauses.join(". ")),
    positive: join(
      authoritativeFields.map((clauses) =>
        clauses.filter((clause) => !NEGATED_ASSERTION.test(clause)),
      ),
    ),
  };
}
export function stripScopedClauses(value: string, owns: (clause: string) => boolean) {
  let suppress = false;
  const kept: string[] = [];
  for (const clause of splitAssertions(value)) {
    const owned = owns(clause);
    suppress ||= owned && compileAssertionScope(clause).authoritative.length === 0;
    if (!suppress && !owned) kept.push(clause);
    if (".!?,".includes(clause.trimEnd().at(-1) ?? "")) suppress = false;
  }
  return kept.join(". ");
}
export const splitAssertions = (value: string): string[] => value.split(ASSERTION_BOUNDARY);
const ASSERTION_BOUNDARY =
  /(?:(?<=[.!?])(?<!\beg\.)(?<!\be\.g\.)|;|(?<!\ball\s)(?<!\bnothing\s)(?<!\banything\s)\b(?:but|however)\b[,:]?|\byet\b[,:]?\s+(?=(?:the\s+)?(?:execution|command|process|operation|tool|result|no|not|never|without|neither)\b)|\b(?:and|while)\s+(?=(?:no|not|never|without|neither)\b))\s+/iu;
const NON_ACTUAL_TITLE = /^\s*(?:hypothetical|counterfactual|conditional|simulated)\b/i;
const NON_ASSERTED_FRAME =
  /^(?:["'`]|observation:\s*|for reference\b|reference (?:text|material)\b|(?:the )?(?:documentation|document|source|log|example|fixture|template)\s+(?:says|states|contains|quotes|explains)\b|expected\s+(?:result|text|output|diagnostic)\s*:|(?:hypothetical|quoted)\b|if\b|unless\b|when\b|suppose\b|one sentence says\b)/i;
const NON_ASSERTED_SCOPE =
  /\b(?:hypothetical(?:ly)?|counterfactual(?:ly)?|possible|possibly|potential|potentially|would|could|cannot|can\s+not|might|may)\b/i;
const NEGATED_ASSERTION =
  /^(?![\s\S]*\bno\s+(?:output|diagnostic|evidence)(?:\s+or\s+(?:output|diagnostic|evidence))?\s+channels?\s+(?:is|are)\s+missing\b)[\s\S]*\b(?:no|without|neither|nor|(?:not|never)\s+(?:been\s+)?(?:returned|delivered|produced|reported|observed|found|shown|contained|included|required|needed|pending|available|occur(?:red)?|exist(?:s|ed)?|start(?:ed)?|begin|begun|fail(?:ed)?|crash(?:ed)?|terminate[ds]?)|(?:is|are|was|were)\s+(?:not|never)\s+(?:an?\s+)?(?:failure|error|fault|crash)|(?:does?|did)\s+not\s+(?:represent|indicate|report|show|constitute)\s+(?:an?\s+)?(?:failure|error|fault|crash)|(?:record|diagnostic|report|source|document|text|example|fixture)\s+den(?:y|ies|ied)|den(?:y|ies)\s+that|lack(?:s|ed)?|(?:fails?|failed)\s+to\s+(?:report|show|contain|include|observe))\b/i;
const NON_ASSERTED_EVENT_FACT =
  /\b(?:no\s+(?:runtime\s+)?failure\s+(?:occurred|was\s+(?:observed|reported))|(?:runtime\s+)?failure\s+(?:did\s+not|never)\s+occur|(?:command|process|execution|operation|result|outcome)\s+(?:is|are|was|were)\s+(?:not|never)\s+(?:an?\s+)?(?:failure|error|fault|crash)|(?:command|process|execution|operation|result|outcome)\s+(?:does?|did)\s+not\s+(?:represent|indicate|report|show|constitute)\s+(?:an?\s+)?(?:failure|error|fault|crash)|(?:(?:exit|return)\s+(?:code|status)\s+(?:0|zero)|runtimeerror|traceback|segmentation\s+fault)\b[^.!?;]*\b(?:was\s+|is\s+)?(?:expected|ruled\s+out|excluded|unconfirmed|not\s+(?:returned|reported|observed|confirmed))|(?:report|record|result|outcome|diagnostic)\s+(?:rules?\s+out|excludes?)\s+(?:(?:exit|return)\s+(?:code|status)\s+(?:0|zero)|runtimeerror|traceback|segmentation\s+fault)|no\s+(?:authorization|permission|approval|decision)\s+(?:is|was)?\s*(?:required|needed|pending)|(?:authorization|permission|approval|decision)\s+(?:is|was)\s+not\s+(?:required|needed|pending)|(?:would|could|cannot|can\s+not|might|may)\b[^.!?;]*\b(?:runtime\s+failure|authorization\s+required|exit\s+(?:code|status)))\b/i;
