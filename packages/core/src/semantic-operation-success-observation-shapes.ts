import { readExplicitObservationTranscriptBody } from "./semantic-observation-transcript-body.js";

export type OperationSuccessObservation = {
  kind: "file_created" | "file_edited";
  consequenceBaseline: "low";
};

export function readExplicitOperationSuccessObservationTranscript(
  value: string | undefined,
): OperationSuccessObservation | null {
  const body = readExplicitObservationTranscriptBody(value ?? "");
  return body === null ? null : readCompactOperationSuccessObservation(body);
}

export function readCompactOperationSuccessObservation(
  value: string,
): OperationSuccessObservation | null {
  const text = value.trim();
  if (text.length === 0 || /[\r\n]/.test(text) || hasUnsafeOperationOutcomeText(text)) {
    return null;
  }

  const createdPath = readOperationPath(text, [
    /^file\s+created(?:\s+successfully)?\s+at:\s+(\S+?)(?:\.)?$/i,
    /^(?:successfully\s+)?(?:created|wrote|saved)\s+(?:new\s+)?file(?:\s+at)?:?\s+(\S+?)(?:\.)?$/i,
    /^file\s+(\S+?)\s+(?:was\s+)?(?:created|written|saved)(?:\s+successfully)?(?:\.)?$/i,
  ]);
  if (createdPath !== undefined && looksLikeSupportedPathToken(createdPath)) {
    return { kind: "file_created", consequenceBaseline: "low" };
  }

  const editedPath = readOperationPath(text, [
    /^the\s+file\s+(\S+?)\s+has\s+been\s+(?:edited|updated|modified)(?:\.)?$/i,
    /^(?:successfully\s+)?(?:edited|updated|modified)\s+file:?\s+(\S+?)(?:\.)?$/i,
    /^file\s+(\S+?)\s+(?:was|has\s+been)\s+(?:edited|updated|modified)(?:\s+successfully)?(?:\.)?$/i,
  ]);
  if (editedPath !== undefined && looksLikeSupportedPathToken(editedPath)) {
    return { kind: "file_edited", consequenceBaseline: "low" };
  }

  return null;
}

export function looksLikeCompactOperationSuccessObservation(value: string): boolean {
  return readCompactOperationSuccessObservation(value) !== null;
}

function readOperationPath(text: string, patterns: readonly RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const path = pattern.exec(text)?.[1];
    if (path !== undefined) {
      return path;
    }
  }
  return undefined;
}

function looksLikeSupportedPathToken(path: string): boolean {
  return (
    /^(?:[A-Za-z]:[\\/]|\/|\.{1,2}\/|~\/)/.test(path) &&
    !/["'`<>[\]{}]/.test(path) &&
    !/(?:^|:)\/\//.test(path) &&
    !/(?:\.\.\.|…)$/.test(path) &&
    !/[.,;:]$/.test(path)
  );
}

function hasUnsafeOperationOutcomeText(text: string): boolean {
  return (
    /(?:expected|sample|fixture|reference|example|desired|golden|baseline)\s+(?:output|result|diagnostic)s?\s*:/i.test(
      text,
    ) ||
    /^```/.test(text) ||
    /\bnot\s+(?:be\s+|been\s+|was\s+|were\s+)?(?:created|written|saved|edited|updated|modified)\b/i.test(
      text,
    )
  );
}
