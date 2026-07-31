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

  const createdPath = /^File created successfully at:\s+(\S+)$/i.exec(text)?.[1];
  if (createdPath !== undefined && looksLikeSupportedPathToken(createdPath)) {
    return { kind: "file_created", consequenceBaseline: "low" };
  }

  const editedPath = /^The file\s+(\S+)\s+has been edited\.$/i.exec(text)?.[1];
  if (editedPath !== undefined && looksLikeSupportedPathToken(editedPath)) {
    return { kind: "file_edited", consequenceBaseline: "low" };
  }

  return null;
}

export function looksLikeCompactOperationSuccessObservation(value: string): boolean {
  return readCompactOperationSuccessObservation(value) !== null;
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
    /\bnot\s+been\s+edited\b/i.test(text)
  );
}
