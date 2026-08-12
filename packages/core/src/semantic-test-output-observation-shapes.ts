import { readSectionedTestOutputObservation } from "./semantic-test-result-section-shapes.js";
import {
  looksLikeTestRunnerFailureDiagnostic,
  looksLikeTestRunnerProgress,
} from "./semantic-test-runner-output-shapes.js";

export type TestOutputObservation = {
  consequenceBaseline: "low" | "medium" | "high";
};

export function readTestOutputObservation(value: string): TestOutputObservation | null {
  const text = value.trim();
  if (looksLikeFailedTestOutputDiagnostic(text)) {
    return null;
  }

  const sectioned = readSectionedTestOutputObservation(text);
  if (sectioned !== null) {
    return { consequenceBaseline: sectioned === "success" ? "low" : "high" };
  }

  return looksLikeBannerTestSuccess(text) ||
    looksLikeUnittestSuccess(text) ||
    looksLikePytestSuccess(text) ||
    looksLikeCommandTestSuccess(text)
    ? { consequenceBaseline: "low" }
    : looksLikeTestRunnerProgress(text)
      ? { consequenceBaseline: "medium" }
      : null;
}

export function looksLikeSuccessfulTestOutputObservation(value: string): boolean {
  return readTestOutputObservation(value)?.consequenceBaseline === "low";
}

export function looksLikeFailedTestOutputDiagnostic(value: string): boolean {
  return (
    looksLikeTestRunnerFailureDiagnostic(value) ||
    [
      /\bFAILED\s+\([^)]*\b(?:failures|errors)=[1-9]\d*/i,
      /(?:^|[\r\n])\s*(?:FAIL|ERROR):\s+\S/i,
      /\b(?:failures|errors)=[1-9]\d*\b/i,
      /\b[1-9]\d*\s+failed\b/i,
      /\b[1-9]\d*\s+errors?\b/i,
      /(?:^|[\r\n])\s*=+\s*(?:FAILURES|ERRORS)\s*=+/i,
    ].some((pattern) => pattern.test(value))
  );
}

function looksLikeBannerTestSuccess(text: string): boolean {
  return /^\s*===\s*Testing\b[^=\r\n]{1,160}===\s*All\s+[a-z0-9_. _-]{1,160}\s+tests?\s+passed!?\s*$/i.test(
    text,
  );
}

function looksLikeUnittestSuccess(text: string): boolean {
  return /(?:^|[\r\n]|\s)Ran\s+\d+\s+tests?\s+in\s+[\d.]+s\s+OK\s*$/i.test(text);
}

function looksLikePytestSuccess(text: string): boolean {
  return /(?:^|[\r\n=])\s*=*\s*\d+\s+passed(?:,?\s+\d+\s+(?:skipped|warnings?))*\s+in\s+[\d.]+s\s*=*\s*$/i.test(
    text,
  );
}

function looksLikeCommandTestSuccess(text: string): boolean {
  return /^\s*(?:running\s+(?:command|[a-z0-9_.-]+)[^\r\n]{0,160}\s+output:\s+[\s\S]{1,1200}\b(?:test passed(?::\s+[^\r\n.]+)?|tests passed|all checks passed|all [a-z0-9_. -]{1,160} tests passed|no problems found)|(?:the\s+)?tests?\s+passed\s+with\s+(?:zero|0)\s+failures?[\s\S]{1,600}\b(?:intentionally|expectedly)\s+(?:emitted|produced|raised)\b[\s\S]{1,300}\b(?:verified|matched|asserted|confirmed)\b[\s\S]{0,160})[.!]?\s*$/i.test(
    text,
  );
}
