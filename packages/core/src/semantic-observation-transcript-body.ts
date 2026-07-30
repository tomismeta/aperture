export function readExplicitObservationTranscriptBody(value: string): string | null {
  const match = /^\s*OBSERVATION:\s*([\s\S]+)$/i.exec(value);
  const body = match?.[1]?.trim() ?? "";

  return body.length > 0 && body !== "{}" ? body : null;
}
