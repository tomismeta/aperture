import {
  looksLikeBuildOrLogObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
} from "./semantic-observation-shapes.js";
import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";
import { looksLikeRejectedCommandTextObservation } from "./semantic-command-text-observation-boundaries.js";
import { looksLikeWarningOnlyCommandOutputObservation } from "./semantic-command-warning-observation-shapes.js";
import { readTestOutputObservation } from "./semantic-test-output-observation-shapes.js";
import { looksLikeUnifiedDiffObservation } from "./semantic-unified-diff-observation-shapes.js";
import { looksLikeLinterOutputObservation } from "./semantic-linter-output-observation-shapes.js";

export type CommandTextObservation = {
  shape: "source" | "diff" | "readback" | "test" | "linter";
  consequenceBaseline: "low" | "medium" | "high";
};

export function readCommandTextObservation(value: string): CommandTextObservation | null {
  const text = readCommandObservationBody(value);
  if (text.length === 0 || looksLikeRejectedCommandTextObservation(text)) {
    return null;
  }

  const testOutput = readTestOutputObservation(text);
  if (testOutput !== null) {
    return { shape: "test", consequenceBaseline: testOutput.consequenceBaseline };
  }

  if (looksLikeWarningOnlyLinterOutputObservation(text)) {
    return { shape: "linter", consequenceBaseline: "high" };
  }

  if (looksLikeWarningOnlyCommandOutputObservation(text)) {
    return { shape: "readback", consequenceBaseline: "medium" };
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

function looksLikeWarningOnlyLinterOutputObservation(text: string): boolean {
  return (
    looksLikeLinterOutputObservation(text) &&
    /\bwarning\b/i.test(text) &&
    !/(?:^|[\r\n]|\s)(?:error|fatal)\b/i.test(text) &&
    !/\b(?:\[[^\]]*error[^\]]*]|level:\s*error)\b/i.test(text)
  );
}
