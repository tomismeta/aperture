import { looksLikeDiagnosticReference } from "./semantic-diagnostic-reference-shapes.js";

export function looksLikeDiagnosticReferenceWrapper(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 && lines.every((line) => looksLikeReferenceWrapperLine(line));
}

export function looksLikeDiagnosticReferenceSectionBoundary(text: string): boolean {
  return (
    looksLikeDiagnosticReferenceWrapper(text) ||
    looksLikeDiagnosticReference(text) ||
    /^\s*expected(?:\s+[a-z][\w.-]{0,40})?\s*:/i.test(text)
  );
}

export function looksLikeDiagnosticReferenceBlockBoundary(text: string): boolean {
  return (
    !looksLikeInlineDiagnosticReferenceBoundary(text) &&
    looksLikeDiagnosticReference(text) &&
    !looksLikeSourceDiagnosticReferenceLine(text)
  );
}

export function looksLikeInlineDiagnosticReferenceBoundary(text: string): boolean {
  return /:\s*\S/.test(text) && !looksLikeReferenceWrapperLine(text);
}

export function looksLikeSourceOrFixtureActualWrapper(text: string): boolean {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines.at(-1) ?? "";
  return (
    /\bresult of running\s+`?cat\s+-n\b/i.test(text) ||
    /(?:^|[\r\n])\s*```\w*\s*$/i.test(text) ||
    /(?:^|[\r\n])\s*(?:(?:source|raw|literal|code|fixture|sample|example)\s+){0,3}(?:source|fixture|snippet|code|text)\s*:\s*$/i.test(
      text,
    ) ||
    /^\s*(?:const|let|var)\s+[a-z_$][\w$]*\s*=\s*`$/i.test(lastLine) ||
    /^\s*[a-z_$][\w$]*\s*=\s*(?:'''|""")$/i.test(lastLine)
  );
}

export function readReferenceBlockSkipIndex(lines: string[], index: number): number {
  let nextIndex = index + 1;
  while (nextIndex < lines.length) {
    const line = lines[nextIndex]?.trim() ?? "";
    if (line.length === 0) {
      return nextIndex;
    }
    if (looksLikeDiagnosticRecoveryBoundary(line)) {
      return nextIndex - 1;
    }
    nextIndex += 1;
  }
  return lines.length - 1;
}

function looksLikeReferenceWrapperLine(text: string): boolean {
  return /^\s*(?:for\s+(?:example|reference)|here\s+is\s+an?\s+example|in\s+(?:the\s+)?(?:docs?|documentation)|as\s+shown\s+in\s+(?:the\s+)?(?:docs?|documentation)|according\s+to(?:\s+(?:the\s+)?(?:docs?|documentation))?|(?:the\s+)?(?:docs?|documentation)|(?:the\s+)?[^\n:]{0,80}\b(?:docs?|documentation)\b[^\n:]{0,80}\b(?:displays?|format|says?|shows?)|(?:example|sample|reference|illustrative|previous|golden|baseline|canonical|fixture|desired)(?:\s+[a-z][\w.-]{0,40})?)\s*:\s*$/i.test(
    text,
  );
}

function looksLikeSourceDiagnosticReferenceLine(text: string): boolean {
  return /^\s*(?:(?:(?:const|let|var)\s+)?[a-z_$][\w$]*\s*=|(?:print|console\.log|assert(?:\.\w+)?|expect)\s*\(|(?:throw\s+)?new\s+[A-Z][A-Za-z0-9_$]{1,80}\s*\(|raise\s+[A-Z][A-Za-z0-9_$]{1,80}\s*\(|(?:[a-z_$][\w$]*\.)+[a-z_$][\w$]*\s*\(|[A-Z][A-Za-z0-9_$]{1,80}\s*\(|["'`]|\/\/|#\s*fixture\b|return\s+["'`])/i.test(
    text,
  );
}

function looksLikeDiagnosticRecoveryBoundary(text: string): boolean {
  return (
    /^(?:(?:actual|received|command|tool|test|pytest|unittest|build|compiler|typecheck|lint|linter)\s+)?(?:output|stdout|stderr|diagnostics?|errors?|failures?|results?|reports?)\s*:/i.test(
      text,
    ) ||
    looksLikeStrongReferenceRecoveryDiagnostic(text) ||
    looksLikeStrongReferenceRecoveryTestDiagnostic(text) ||
    /^\s*E\s+AssertionError\b/i.test(text)
  );
}

function looksLikeStrongReferenceRecoveryDiagnostic(text: string): boolean {
  return /(?:\btraceback\s+\(most recent call last\)|(?:^|[\r\n])\s*(?:AssertionError|ImportError|ModuleNotFoundError|ReferenceError|RuntimeError|SyntaxError|TypeError|ValueError):|(?:^|[\r\n])\s*(?:FAIL|ERROR):\s+\S|\bsegmentation fault\b|\bcommand not found\b|\bapply_patch verification failed\b)/i.test(
    text,
  );
}

function looksLikeStrongReferenceRecoveryTestDiagnostic(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:FAIL|ERROR):\s+\S|\bFAILED\s+\([^)]*\b(?:failures|errors)=[1-9]\d*|\b(?:failures|errors)=[1-9]\d*\b|\b[1-9]\d*\s+failed\b/i.test(
    text,
  );
}
