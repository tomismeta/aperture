import { looksLikeSectionSourceObservationBody } from "./semantic-sectioned-source-observation-shapes.js";
import { readTestSections } from "./semantic-test-section-parser.js";

export function readSectionedTestOutputObservation(value: string): "success" | "concrete" | null {
  const text = value.trim();
  if (text.length === 0 || looksLikeFutureTestInstruction(text)) {
    return null;
  }
  const sections = readTestSections(text);
  if (sections === null) {
    return null;
  }

  let sawConcrete = false;
  for (const section of sections) {
    const outcome = readSectionOutcome(section);
    if (outcome === null || outcome === "failure") {
      return null;
    }
    sawConcrete ||= outcome === "concrete";
  }

  return sawConcrete ? "concrete" : "success";
}

export function looksLikeSectionedTestOutputFailure(value: string): boolean {
  const text = value.trim();
  if (text.length === 0) {
    return false;
  }

  const sections = readTestSections(text);
  return sections !== null && sections.some((section) => readSectionOutcome(section) === "failure");
}

function readSectionOutcome(body: string): "success" | "concrete" | "failure" | null {
  return looksLikeLeadingSectionFailure(body)
    ? "failure"
    : looksLikeNonResultSection(body)
      ? null
      : looksLikeSectionFailure(body)
        ? "failure"
        : looksLikeConcreteSectionOutput(body)
          ? "concrete"
          : looksLikeSectionSuccess(body)
            ? "success"
            : null;
}

function looksLikeLeadingSectionFailure(body: string): boolean {
  return /^(?:\s|[\r\n])*(?:Traceback\s+\(most recent call last\)|(?:FAIL|ERROR|FAILED)\b|[a-z0-9_.-]+\s+\.\.\.\s+(?:FAIL|ERROR)\b|AssertionError\b|[1-9]\d*\s+fail(?:ed|ures?)\b|(?:failures|errors)\s*[:=]\s*[1-9]\d*\b|exited\s+with\s+(?:code|status)\s+[1-9]\d*\b)/i.test(
    body,
  );
}

function looksLikeNonResultSection(body: string): boolean {
  return (
    looksLikeSectionSourceObservationBody(body) ||
    looksLikeFutureTestInstruction(body) ||
    /\b(?:confirm|ensure|verify|validate|make\s+sure|we\s+expect|the\s+output\s+should|review\s+requirement|requirement:|please|check\s+that|reviewer\s+should|should\s+(?:check|confirm|ensure|verify)|must\s+(?:check|ensure|confirm|verify|appear)|for\s+reference|as\s+a\s+reference|refer\s+to|reference:)\b|^\s*(?:check|validate|expect)\b/i.test(
      body,
    )
  );
}

function looksLikeSectionFailure(body: string): boolean {
  return /(?:\bTraceback\s+\(most recent call last\)|\b(?:FAIL|ERROR):|(?:^|\s)(?:FAIL|ERROR|FAILED)\b|\b[a-z0-9_.-]+\s+\.\.\.\s+(?:FAIL|ERROR)\b|\bAssertionError\b|\b[1-9]\d*\s+fail(?:ed|ures?)\b|\b(?:failures|errors)\s*[:=]\s*[1-9]\d*\b|\bexited\s+with\s+(?:code|status)\s+[1-9]\d*\b)/i.test(
    body,
  );
}

function looksLikeConcreteSectionOutput(body: string): boolean {
  return (
    /\b[a-z_][a-z0-9_.]*\([^)]{0,200}\)\s*=\s*(?:true|false|[-+]?\d+(?:\.\d+)?|["'][^"']{0,80}["']|\S{1,80})\b/i.test(
      body,
    ) || /\bProblems?\s+found:\s+(?!No\s+problems?\s+found\b)\S/i.test(body)
  );
}

function looksLikeSectionSuccess(body: string): boolean {
  return /\b(?:All\s+[a-z0-9_. _-]{1,160}\s+tests?\s+passed!?|Problems?\s+found:\s+No\s+problems?\s+found|Test\s+PASSED)\b/i.test(
    body,
  );
}

function looksLikeFutureTestInstruction(text: string): boolean {
  return /\b(?:expected\s+output|should\s+(?:say|report|end|be)|after\s+the\s+patch|before\s+(?:you\s+continue|submission)|then\s+submit|must\s+appear|final\s+response)\b/i.test(
    text,
  );
}
