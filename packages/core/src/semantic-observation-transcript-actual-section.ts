export type ActualDiagnosticTranscriptSection = {
  section: string;
  preamble: string;
};

export function readActualDiagnosticTranscriptSection(text: string): string | null {
  return readActualDiagnosticTranscriptSectionParts(text)?.section ?? null;
}

export function readActualDiagnosticTranscriptSectionParts(
  text: string,
): ActualDiagnosticTranscriptSection | null {
  const match = readLineStartedActualSection(text) ?? readFlattenedExpectedActualSection(text);
  const preamble = match?.[1]?.trim() ?? "";
  const section = match?.[2]?.trim() ?? "";

  return section.length > 0 ? { section, preamble } : null;
}

function readLineStartedActualSection(text: string): RegExpExecArray | null {
  return /^([\s\S]*?)(?:^|[\r\n])\s*(?:actual|received)\s+(?:output|stdout|stderr|diagnostics?|errors?|failures?|results?|reports?)\s*:\s*([\s\S]+)$/i.exec(
    text,
  );
}

function readFlattenedExpectedActualSection(text: string): RegExpExecArray | null {
  return /^(\s*(?:expected|example|sample|reference|illustrative|previous|golden|baseline|canonical|fixture|desired)(?:\s+(?:[a-z][\w.-]{0,40}|from\s+[a-z][\w.-]{0,40})){0,3}\s+(?:output|stdout|stderr|diagnostics?|errors?|failures?|results?|reports?)(?:\s+from\s+[a-z][\w.-]{0,40})?\s*:\s+[\s\S]{0,800})\s+(?:actual|received)\s+(?:output|stdout|stderr|diagnostics?|errors?|failures?|results?|reports?)\s*:\s*([\s\S]+)$/i.exec(
    text,
  );
}
