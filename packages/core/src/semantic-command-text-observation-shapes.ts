import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
} from "./semantic-observation-shapes.js";
import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";
import { looksLikeObservationReferenceWrapper } from "./semantic-observation-reference-wrapper-shapes.js";
import { looksLikeBareDiagnosticObservationBody } from "./semantic-bare-diagnostic-observation-shapes.js";
import { readTestOutputObservation } from "./semantic-test-output-observation-shapes.js";
import { looksLikeUnifiedDiffObservation } from "./semantic-unified-diff-observation-shapes.js";
import { looksLikeLinterOutputObservation } from "./semantic-linter-output-observation-shapes.js";

export type CommandTextObservation = {
  shape: "source" | "diff" | "readback" | "test" | "linter";
  consequenceBaseline: "low" | "medium" | "high";
};

export function readCommandTextObservation(value: string): CommandTextObservation | null {
  const text = readCommandObservationBody(value);
  if (
    text.length === 0 ||
    looksLikeObservationReferenceWrapper(text) ||
    looksLikeBareDiagnosticObservationBody(text) ||
    looksLikePlainExpectedActualDiffFixture(text) ||
    looksLikeShortSourceLiteralWrapper(text) ||
    looksLikeEmbeddedPatchString(text)
  ) {
    return null;
  }

  const testOutput = readTestOutputObservation(text);
  if (testOutput !== null) {
    return { shape: "test", consequenceBaseline: testOutput.consequenceBaseline };
  }

  if (looksLikeWarningOnlyLinterOutputObservation(text)) {
    return { shape: "linter", consequenceBaseline: "high" };
  }

  if (/^\s*diff --git\b/i.test(text) && !looksLikeUnifiedDiffObservation(text)) {
    return null;
  }

  if (looksLikeUnifiedDiffObservation(text)) {
    return { shape: "diff", consequenceBaseline: "high" };
  }

  if (looksLikeStrongRawSourceObservation(text)) {
    return { shape: "source", consequenceBaseline: "high" };
  }

  if (looksLikePlainReadObservation(text)) {
    return {
      shape: "readback",
      consequenceBaseline: looksLikeBuildOrLogObservation(text) ? "medium" : "high",
    };
  }

  return null;
}

function readCommandObservationBody(value: string): string {
  const text = stripObservationStatusPrefix(value);
  return readExplicitObservationTranscriptBody(text) ?? text;
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/i, "");
}

function looksLikeShortSourceLiteralWrapper(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return (
    lines.length <= 3 &&
    /^\s*(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=\s*["'`][\s\S]*["'`]\s*;?\s*(?:\r?\n\s*return\b[\s\S]*)?$/i.test(
      text,
    )
  );
}

function looksLikeEmbeddedPatchString(text: string): boolean {
  return /^\s*(?:const|let|var)\s+[a-z_$][a-z0-9_$]*\s*=\s*["'`][\s\S]*\bdiff --git\b/i.test(text);
}

function looksLikePlainExpectedActualDiffFixture(text: string): boolean {
  return /^\s*---\s+expected\b[\s\S]*^\s*\+\+\+\s+actual\b/im.test(text);
}

function looksLikeWarningOnlyLinterOutputObservation(text: string): boolean {
  return (
    looksLikeLinterOutputObservation(text) &&
    /\bwarning\b/i.test(text) &&
    !/(?:^|[\r\n]|\s)(?:error|fatal)\b/i.test(text) &&
    !/\b(?:\[[^\]]*error[^\]]*]|level:\s*error)\b/i.test(text)
  );
}
