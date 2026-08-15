import { normalizeSemanticText } from "./semantic-text.js";

export function looksLikeProceduralHarnessObservation(value: string): boolean {
  const text = normalizeSemanticText(value);
  if (text.length < 80 || text.length > 1800 || hasDiagnosticOrToolFailureText(text)) {
    return false;
  }

  const proceduralSignals = countMatches(text, [
    /\bplease\b/,
    /\b(?:follow|complete|perform)\s+(?:the\s+)?(?:steps?|checks?)\b/,
    /\bsteps?\s+below\b/,
    /\bif\s+you\s+(?:made|make|changed|change|ran|run)\b/,
    /\b(?:run|rerun)\s+the\s+(?:reproduction|reproducer|verification)\s+(?:script|command)\b/,
    /\breview\s+(?:your\s+)?changes\b/,
    /\b(?:verify|confirm|ensure)\s+(?:the\s+)?(?:issue|fix|changes?|behavior)\b/,
  ]);

  const harnessSignals = countMatches(text, [
    /\breproduction\s+(?:script|command)\b/,
    /\breproducer\b/,
    /\bverification\s+(?:script|command)\b/,
  ]);

  return proceduralSignals >= 2 && harnessSignals >= 1;
}

function countMatches(text: string, patterns: readonly RegExp[]): number {
  return patterns.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function hasDiagnosticOrToolFailureText(text: string): boolean {
  return [
    /\b(?:traceback|syntaxerror|typeerror|assertionerror|exceptiongroup|exception)\b/,
    /\b(?:segmentation fault|segfault|core dumped|crash(?:ed|es|ing)?|permission\s+denied)\b/,
    /\b(?:timed?\s+out|timeout|fail(?:ed|ing|s|ure)?|errors?|errored)\b/,
    /\b(?:unresolved|not\s+resolved|still\s+(?:broken|failing|does\s+not\s+work|doesn\s+t\s+work))\b/,
    /\b(?:does\s+not|did\s+not|doesn\s+t|didn\s+t)\s+pass\b/,
    /\b(?:exit\s+code\s+[1-9]\d*|(?:exited|returned)\s+(?:with\s+)?(?:code\s+)?[1-9]\d*|(?:returned|returning)\s+non[-\s]?zero)\b/,
    /(?:^|\s)(?:fail|error):\s+\S/,
    /\b(?:failures|errors)=[1-9]\d*\b/,
    /\b[1-9]\d*\s+(?:failed|errors?)\b/,
    /\bno\s+replacement\s+was\s+performed\b/,
    /\bold_str\b/,
    /\bnew_string\b/,
  ].some((pattern) => pattern.test(text));
}
