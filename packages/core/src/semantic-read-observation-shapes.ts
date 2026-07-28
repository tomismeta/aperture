export function looksLikeReadTruncationProtocolObservation(value: string): boolean {
  const text = value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
  const match = READ_TRUNCATION_PROTOCOL_PATTERN.exec(text);
  if (match === null) {
    return false;
  }

  const start = Number.parseInt(match[1] ?? "", 10);
  const end = Number.parseInt(match[2] ?? "", 10);
  const total = Number.parseInt(match[3] ?? "", 10);

  return (
    Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    Number.isSafeInteger(total) &&
    start >= 1 &&
    end >= start &&
    total >= end
  );
}

const READ_TRUNCATION_PROTOCOL_PATTERN =
  /^IMPORTANT:\s+The file content has been truncated\.\s+Status:\s+Showing lines\s+(\d+)-(\d+)\s+of\s+(\d+)\s+total lines\.\s+Action:\s+To read more of the file,\s+you can use the (?:'offset' and 'limit'|'start_line' and 'end_line') parameters\.?\s*$/i;
