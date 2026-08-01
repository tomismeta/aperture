import { looksLikeRejectedCommandTextObservation } from "./semantic-command-text-observation-boundaries.js";
import {
  looksLikeRecoveredListingObservation,
  looksLikeTruncatedRawReadListingObservation,
} from "./semantic-listing-observation-shapes.js";
import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";
import { stripObservationStatusPrefix } from "./semantic-observation-text.js";
import {
  looksLikeBuildOrLogObservation,
  looksLikeOwnedRawReadObservation,
  looksLikePlainReadObservation,
  looksLikeStrongRawSourceObservation,
  looksLikeStructuredToolOutputObservation,
} from "./semantic-observation-shapes.js";
import {
  readOwnedObservationPayload,
  type OwnedObservationPayload,
} from "./semantic-owned-observation-payload-shapes.js";
import { hasOwnedReadTerminalDiagnosticEvidence } from "./semantic-owned-read-observation-shapes.js";
import {
  OBSERVATIONAL_READBACK_PHRASES,
  PATH_LIKE_TOKEN_PATTERN,
  SOURCE_CODE_FILENAME_PATTERN,
  SOURCE_CODE_PATH_PATTERN,
} from "./semantic-patterns.js";
import { looksLikeReadTruncationProtocolObservation } from "./semantic-read-observation-shapes.js";
import { readRecoveredCommandOutputObservation } from "./semantic-recovered-command-output-observation-shapes.js";
import { readSingleOwnedListingObservation } from "./semantic-single-listing-observation-shapes.js";
import { normalizeSemanticText } from "./semantic-text.js";

export type PayloadSyntaxObservation = {
  consequenceBaseline: "low" | "medium" | "high";
  source: boolean;
};

type StructuredPayloadSyntaxInput = {
  commandExecutionToolFamily: boolean;
  exitCode: number | undefined;
  output: string;
  recoveredEnvelope: boolean;
};

export function readReadOutputPayloadObservation(value: string): PayloadSyntaxObservation | null {
  if (hasOwnedReadTerminalDiagnosticEvidence(value)) {
    return null;
  }

  const tagged = readTaggedFilePayload(value);
  if (looksLikeReadTruncationProtocolObservation(value)) {
    return payloadSyntax(false, "low");
  }
  if (tagged !== null) {
    return tagged;
  }
  if (hasReadTransportWindow(value) && looksLikeOwnedRawReadObservation(value)) {
    return payloadSyntax(true, "high");
  }
  if (looksLikeTruncatedRawReadListingObservation(value)) {
    return payloadSyntax(false, "high");
  }
  if (looksLikePlainReadObservation(value)) {
    return payloadSyntax(
      looksLikeStrongRawSourceObservation(value),
      looksLikeBuildOrLogObservation(value) ? "low" : "high",
    );
  }

  const wrapper = readReadWrapperPayload(value);
  if (wrapper !== null) {
    return wrapper;
  }

  const payload = hasReadTransportWindow(value)
    ? null
    : readOwnedObservationPayload(value, { allowReadOwnedFlattenedFilePayloads: true });
  return payload === null
    ? null
    : payloadSyntax(payload.source, readRawReadConsequenceBaseline(payload, value));
}

export function readCommandOutputPayloadObservation(
  value: string,
): PayloadSyntaxObservation | null {
  const text = readCommandObservationBody(value);
  const payload =
    text.length === 0 || looksLikeRejectedCommandTextObservation(text)
      ? null
      : readOwnedObservationPayload(text, { rejectCommandTextWrappers: true });
  return payload === null ? null : payloadSyntax(payload.source, payload.consequenceBaseline);
}

export function readStructuredOutputPayloadObservation(
  input: StructuredPayloadSyntaxInput,
): PayloadSyntaxObservation | null {
  const recovered = readRecoveredCommandOutputObservation({
    commandExecutionToolFamily: input.commandExecutionToolFamily,
    recoveredEnvelope: input.recoveredEnvelope,
    output: input.output,
  });
  const owned = readOwnedObservationPayload(input.output);
  const singleListing =
    input.commandExecutionToolFamily && input.exitCode === 0
      ? readSingleOwnedListingObservation(input.output)
      : null;
  const source =
    looksLikeStrongRawSourceObservation(input.output) ||
    recovered.source ||
    owned?.source === true ||
    singleListing?.source === true;
  const observed =
    looksLikeStructuredToolOutputObservation(input.output) ||
    recovered.any ||
    owned !== null ||
    singleListing !== null ||
    (input.recoveredEnvelope && looksLikeRecoveredListingObservation(input.output));

  return observed ? payloadSyntax(source, source ? "high" : "medium") : null;
}

function payloadSyntax(
  source: boolean,
  consequenceBaseline: PayloadSyntaxObservation["consequenceBaseline"],
): PayloadSyntaxObservation {
  return { consequenceBaseline, source };
}

function readRawReadConsequenceBaseline(
  payload: OwnedObservationPayload,
  text: string,
): PayloadSyntaxObservation["consequenceBaseline"] {
  return payload.shape === "readback" && looksLikeBuildOrLogObservation(text)
    ? "low"
    : payload.consequenceBaseline;
}

function readTaggedFilePayload(text: string): PayloadSyntaxObservation | null {
  const tagged = readTaggedFileParts(text);
  if (tagged === null) {
    return null;
  }
  if (looksLikeLowConsequenceTaggedRead(tagged.path, tagged.content)) {
    return payloadSyntax(false, "low");
  }
  if (looksLikeSourcePath(tagged.path) || looksLikeStrongRawSourceObservation(tagged.content)) {
    return payloadSyntax(true, "high");
  }
  return payloadSyntax(false, "high");
}

function readTaggedFileParts(text: string): { content: string; path: string } | null {
  const path = readTag(text.trim(), "path", 0);
  if (path === null) {
    return null;
  }
  const type = readTag(text, "type", path.end);
  const content = readTag(text, "content", type?.end ?? path.end, { allowOpenEnded: true });
  return type?.value.toLowerCase() === "file" && content !== null
    ? { content: content.value, path: path.value }
    : null;
}

function readTag(
  text: string,
  tag: string,
  fromIndex: number,
  options: { allowOpenEnded?: boolean } = {},
): { end: number; value: string } | null {
  const lower = text.toLowerCase();
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = lower.indexOf(open, fromIndex);
  if (start < 0) {
    return null;
  }
  const closeIndex = lower.indexOf(close, start + open.length);
  const end = closeIndex < 0 && options.allowOpenEnded === true ? text.length : closeIndex;
  const value = end < 0 ? "" : text.slice(start + open.length, end).trim();
  const nextIndex = closeIndex < 0 ? text.length : closeIndex + close.length;
  return value.length > 0 ? { end: nextIndex, value } : null;
}

function looksLikeLowConsequenceTaggedRead(path: string, content: string): boolean {
  const lowerPath = path.toLowerCase();
  const lowerContent = content.toLowerCase();
  return (
    lowerPath.endsWith(".log") ||
    looksLikeBuildOrLogObservation(content) ||
    ((lowerPath.endsWith("/makefile") ||
      lowerPath.endsWith("/cmakelists.txt") ||
      lowerPath.endsWith(".cmake")) &&
      ["spdx-license-identifier", "version =", "patchlevel =", "sublevel =", "project("].some(
        (token) => lowerContent.includes(token),
      ))
  );
}

function looksLikeSourcePath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return SOURCE_CODE_PATH_PATTERN.test(lowerPath) || SOURCE_CODE_FILENAME_PATTERN.test(lowerPath);
}

function readReadWrapperPayload(value: string): PayloadSyntaxObservation | null {
  const body = readExplicitObservationTranscriptBody(value) ?? value;
  const rawText = body.toLowerCase();
  const text = normalizeSemanticText(body);
  const source = looksLikeSourcePath(body) || looksLikeStrongRawSourceObservation(body);
  const metadata =
    rawText.includes("contents of") ||
    rawText.includes("content of") ||
    rawText.includes("observation path") ||
    rawText.includes("showing first") ||
    rawText.includes("showing top") ||
    (rawText.includes("top") && rawText.includes("lines"));
  const readback = OBSERVATIONAL_READBACK_PHRASES.some((phrase) => text.includes(phrase));
  if ((!source && !PATH_LIKE_TOKEN_PATTERN.test(rawText)) || (!metadata && !readback)) {
    return null;
  }

  const low = rawText.includes(".log") || looksLikeBuildOrLogObservation(body);
  return payloadSyntax(source && !low, source && !low ? "high" : "low");
}

function readCommandObservationBody(value: string): string {
  const text = stripObservationStatusPrefix(value);
  return readExplicitObservationTranscriptBody(text) ?? text;
}

function hasReadTransportWindow(text: string): boolean {
  return text.includes("\n") || text.includes("\r") || text.includes("\u2192");
}
