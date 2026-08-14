import { frameIsNonAsserted, splitAssertions } from "./semantic-task-failure-assertion-scope.js";
import { successConflict } from "./semantic-failure-detail.js";
import { assertedContinuation, negatedAssertion } from "./semantic-terminal-evidence.js";
export type StructuralTaskFailureFact =
  | "absent_failure"
  | "runtime_diagnostic"
  | "source_diagnostic"
  | "source_limit"
  | "terminal_success";
export function readStructuralTaskFailureFact(input: {
  text: string;
  authoritativeText: string;
  scopeText: string;
  diagnosticScopeText?: string;
  documentPayload?: boolean;
  contradiction: boolean;
}): StructuralTaskFailureFact | null {
  const {
    text,
    authoritativeText,
    scopeText,
    diagnosticScopeText: context = scopeText,
    documentPayload = false,
    contradiction,
  } = input;
  const lower = text.toLowerCase(),
    authority = authoritativeText.toLowerCase(),
    exits = readAssertedExitCodes(text),
    contextClauses = splitAssertions(context),
    assertedText = splitAssertions(lower)
      .filter((clause) => !frameIsNonAsserted(clause))
      .join(". ");
  if (new Set(exits).size > 1) return null;
  const diagnostic =
    splitAssertions(lower).some(isDiagnosticClause) &&
    hasAny(assertedText, TERMINAL) &&
    !negatedAssertion(contextClauses, NEGATED_DIAGNOSTIC, DIRECT_DIAGNOSTIC);
  const ownedDiagnostic = COMPLETE_DIAGNOSTIC.test(lower) && OWNED_DIAGNOSTIC.test(lower);
  const acceptedDiagnostic =
    diagnostic && (!documentPayload || ownedDiagnostic || !MODAL.test(scopeText));
  const actualExecution =
    !BLOCKED_EXEC.test(lower) &&
    (splitAssertions(lower).some(isActualExecutionClause) ||
      assertedContinuation(contextClauses, isDiagnosticClause, isExecutionContextClause));
  const absent =
    !hasAny(`${lower} ${authority} ${scopeText.toLowerCase()}`, ["not a failure"]) &&
    !hasAny(lower, OUTCOME_ONLY) &&
    ((exits.some((code) => code !== 0) &&
      hasAny(lower, EMPTY_STDOUT) &&
      hasAny(lower, EMPTY_STDERR)) ||
      hasAny(authority, ABSENT_EVIDENCE));
  const range = READ_RANGE.exec(text);
  const invalidRange =
    range !== null &&
    (Number(range[1]) < 1 ||
      Number(range[1]) > Number(range[2]) ||
      Number(range[2]) >= Number(range[3]));
  const success =
    !contradiction &&
    (exits.includes(0) || hasAny(lower, ["return code zero", "exit status zero"])) &&
    hasAny(assertedText, EXECUTION) &&
    hasAny(lower, ["complete", "completed", "finished", "succeeded", "successful"]) &&
    hasAny(lower, ["complete", "terminal", "result:"]) &&
    !successConflict(assertedText) &&
    !lower.includes("diagnostic channel is missing");
  if (
    actualExecution &&
    (acceptedDiagnostic || ownedDiagnostic) &&
    (exits.length > 0 || ownedDiagnostic || acceptedDiagnostic)
  )
    return "runtime_diagnostic";
  if (absent) return "absent_failure";
  if (SOURCE_WINDOW.test(text) && !invalidRange)
    return hasAny(lower, SOURCE_DIAGNOSTIC) ? "source_diagnostic" : "source_limit";
  if (success) return "terminal_success";
  return null;
}
const hasAny = (value: string, terms: readonly string[] | RegExp): boolean =>
  terms instanceof RegExp ? terms.test(value) : terms.some((term) => value.includes(term));
const isDiagnosticClause = (value: string) =>
  !INCOMPLETE_DIAGNOSTIC.test(value) &&
  (DIRECT_DIAGNOSTIC.test(value) || COMPLETE_DIAGNOSTIC.test(value)) &&
  hasAny(value, [" at ", "diagnostic", "fatal:", "error:", "stderr", "crashed", "failed"]) &&
  !MODAL.test(value) &&
  !NEGATED_DIAGNOSTIC.test(value) &&
  !frameIsNonAsserted(value);
const isActualExecutionClause = (clause: string) =>
  ACTUAL_EXECUTION.test(clause) && !MODAL.test(clause) && !BLOCKED_EXEC.test(clause);
const isExecutionContextClause = (value: string) =>
  !frameIsNonAsserted(value) &&
  (ACTUAL_EXECUTION.test(value) || EXPECTED_EXECUTION.test(value)) &&
  !BLOCKED_EXEC.test(value);
function readAssertedExitCodes(text: string): number[] {
  return [...text.matchAll(EXIT)].flatMap((match) => {
    const clause =
      text
        .slice(0, match.index)
        .split(/[.!?;\n]/)
        .at(-1)
        ?.toLowerCase() ?? "";
    if (hasAny(clause, MODAL)) return [];
    const code = match[1] === "zero" ? 0 : Number.parseInt(match[1] ?? "", 10);
    return Number.isFinite(code) ? [code] : [];
  });
}
const EXECUTION = "command|process|subprocess|worker|execution|invocation|operation".split("|");
const ACTUAL_EXECUTION =
  /\b(?:execution|operation|invocation|command|process|subprocess|worker|tool)(?:\s+invocation)?\b[^.!?;]*\b(?:start(?:ed)?|run|ran|execute[ds]?|occurred|completed|finished|terminated|crashed|failed|exited|performed)\b/i;
const EXPECTED_EXECUTION =
  /\b(?:execution|operation|invocation|command|process|subprocess|worker|tool)(?:\s+invocation)?\b[^.!?;]*\b(?:expected\s+to|would(?:\s+have)?|could(?:\s+have)?|might|may)\s+(?:have\s+)?fail(?:ed)?\b/i;
const BLOCKED_EXEC =
  /\b(?:execution|operation|invocation|command|process|subprocess|worker|tool)(?:\s+invocation)?\b[^.!?;]*\b(?:did|was|has)\s+not\s+(?:start(?:ed)?|run|execute[ds]?|occurred|perform|produce|return)|\bnever\s+(?:started|ran|executed|occurred)|\bno\s+(?:tool\s+call|invocation|execution)\s+(?:occurred|started)\b/i;
const TERMINAL =
  "exit|return|started|ran|executed|occurred|terminated|completed|finished|ended|failed|crashed".split(
    "|",
  );
const DIRECT_DIAGNOSTIC =
  /\b(?:runtime\s+failure|runtimeerror|typeerror|referenceerror|syntaxerror|assertionerror|traceback|segmentation\s+fault|invalid\s+memory\s+access|memory\s+allocation\s+failed|out\s+of\s+memory|assertion\s+failed|command\s+not\s+found|symbol\s+lookup\s+error|library\s+load\s+error|uncaught\s+exception)\b|\b(?:fatal:|error:)\s+\S/i;
const NEGATED_DIAGNOSTIC =
  /(?:\b(?:no|without|not)\s+(?:an?\s+)?(?:runtime\s+failure|failure|error|exception|fault|crash(?:ed)?|traceback|segmentation\s+fault)\b|\b(?:den(?:y|ies|ied)|ruled\s+out|excluded|unconfirmed|cannot\s+be\s+confirmed)\b[^.!?;]*\b(?:runtime\s+failure|runtimeerror|typeerror|referenceerror|syntaxerror|assertionerror|traceback|segmentation\s+fault)\b|\b(?:runtime\s+failure|runtimeerror|typeerror|referenceerror|syntaxerror|assertionerror|traceback|segmentation\s+fault|fatal:)\b[^.!?;]*\b(?:was\s+)?(?:not|never|ruled\s+out|excluded|unconfirmed|cannot\s+be\s+confirmed)\b|\b(?:runtime\s+failure|runtimeerror|typeerror|referenceerror|syntaxerror|assertionerror|traceback|segmentation\s+fault|fatal:|error:)\b[^.!?;]*\b(?:prior|previous|example|fixture|template)\b|\b(?:if|unless|when|may|might|could(?!\s+not\b)|would|hypothetical|counterfactual|conditional|simulated)\b[^.!?;]*\b(?:runtime\s+failure|runtimeerror|typeerror|referenceerror|syntaxerror|assertionerror|traceback|segmentation\s+fault|fatal:|error:)\b|\b(?:runtime\s+failure|runtimeerror|typeerror|referenceerror|syntaxerror|assertionerror|traceback|segmentation\s+fault|fatal:|error:)\b[^.!?;]*\b(?:if|unless|when|may|might|could(?!\s+not\b)|would|hypothetical|counterfactual|conditional|simulated)\b|\b(?:hypothetical|counterfactual|conditional|simulated)\b)/i;
const COMPLETE_DIAGNOSTIC =
  /\b(?:complete stderr|complete terminal output|complete runtime diagnostic|complete diagnostic)\b/i;
const INCOMPLETE_DIAGNOSTIC =
  /\b(?:incomplete|partial|truncated|abbreviated)\s+(?:runtime\s+)?diagnostic\b/i;
const OWNED_DIAGNOSTIC =
  /(?=[\s\S]*\b(?:contains|shows|reports|emits|returned|produced|emitted)\b)(?=[\s\S]*\b(?:breach|violat|crash(?:ed)?|runtime invariant|runtimeerror|typeerror|traceback|failure|fault)\b)/i;
const ABSENT_EVIDENCE =
  /no diagnostic (?:payload|text|output|content)|failure (?:output|evidence) is explicitly empty/i;
const EMPTY_STDOUT = /stdout: empty|stdout empty|standard output field is present and empty/i;
const EMPTY_STDERR = /stderr: empty|stderr empty|standard error field is present and empty/i;
const OUTCOME_ONLY = ["outcome-only record", "outcome-only result", "outcome-only evidence"];
const MODAL =
  /\b(?:did\s+not|never|not|without|if|unless|when|may|might|could|would|expected|hypothetical)\b/i;
const EXIT =
  /\b(?:exit(?:ed)?(?:\s+with)?\s+(?:code|status)|exit[\s_-](?:code|status)|return(?:ed)?(?:\s+with)?[\s_-]?(?:code|status)|returned code)\s*(?::|is|was|reports?|returned)?\s*(-?\d+|zero)\b/gi;
const READ_RANGE =
  /\b(?:returned|showing|displaying)\s+lines?\s+(\d+)\s*(?:-|through|to)\s*(\d+)\s+of\s+(\d+)\b/i;
const SOURCE_DIAGNOSTIC =
  "permission denied|operation not permitted|no such file or directory|failed to read|could not read|unable to read|failed to open|could not open|unable to open".split(
    "|",
  );
const SOURCE_WINDOW =
  /^(?=[\s\S]*\b(?:(?:exceeds?|exceeded|larger than|too large for|over|above)\s+(?:the\s+)?(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)|(?:maximum|max|allowed|configured|read)(?:\s+(?:allowed|read|token))?\s+(?:size|tokens?|limit|window)\s+(?:is|was)?\s*(?:exceeded|reached)|(?:additional\s+source|remainder|rest|remaining\s+lines?)\s+(?:are\s+|remain\s+|was\s+)?(?:intentionally\s+)?(?:omitted|truncated|clipped|outside\s+(?:the\s+)?returned\s+view)|(?:bounded|measured)\s+partial\s+(?:source\s+)?view)\b)(?=[\s\S]*(?:^|[.!?]\s+)(?:the\s+)?(?:(?:(?:file|source|document|read)\s+)?(?:content|output|payload|window|view)|(?:returned|showing|displaying)|read\b(?:(?![.!?]\s+)[\s\S])*\b(?:content|output|payload|window|view|lines?))\b(?:(?![.!?]\s+)[\s\S])*(?:\((?:\d+(?:\.\d+)?\s*(?:kb|mb|gb|b)|\d+\s*tokens?)\)|\blines?\s+\d+(?:\s+(?:through|to)\s+|\s*-\s*)\d+\s+of\s+(?:a\s+)?\d+(?:[- ]line\s+source)?\b|\b\d+\s+lines?\s+(?:beginning|starting)\s+at\s+offset\s+\d+\s+from\s+(?:a\s+)?(?:source\s+)?(?:totaling\s+)?\d+\s+(?:total\s+)?lines?\b))[\s\S]+$/i;
