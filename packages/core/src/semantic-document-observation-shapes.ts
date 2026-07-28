export function looksLikeMarkdownDocumentObservation(text: string): boolean {
  const normalized = stripObservationStatusPrefix(text);
  const headingCount = [...normalized.matchAll(/(?:^|[\r\n])\s{0,3}#{1,6}\s+\S/g)].length;
  const listCount = [...normalized.matchAll(/(?:^|[\r\n])\s*(?:[-*]\s+\S|\d+\.\s+\S)/g)].length;
  const hasCodeFence = /(?:^|[\r\n])\s*```/.test(normalized);

  return normalized.length >= 160 && headingCount >= 2 && (listCount >= 2 || hasCodeFence);
}

export function looksLikeStructuredMarkdownDocumentObservation(text: string): boolean {
  const normalized = stripObservationStatusPrefix(text);
  return (
    looksLikeMarkdownTableObservation(normalized) || looksLikeMarkdownDocumentObservation(text)
  );
}

function looksLikeMarkdownTableObservation(text: string): boolean {
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  return lines.some((line, index) => {
    const delimiter = lines[index + 1] ?? "";
    const bodyA = lines[index + 2] ?? "";
    const bodyB = lines[index + 3] ?? "";
    if (
      !isMarkdownTableRow(line) ||
      !/^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(delimiter) ||
      !isMarkdownTableRow(bodyA) ||
      !isMarkdownTableRow(bodyB)
    ) {
      return false;
    }

    const columnCount = countMarkdownTableColumns(line);
    return (
      columnCount >= 2 &&
      countMarkdownTableColumns(delimiter) === columnCount &&
      countMarkdownTableColumns(bodyA) === columnCount &&
      countMarkdownTableColumns(bodyB) === columnCount
    );
  });
}

function isMarkdownTableRow(line: string): boolean {
  return /^\|.+\|\s*$/.test(line);
}

function countMarkdownTableColumns(line: string): number {
  return line.replace(/^\|/, "").replace(/\|$/, "").split("|").length;
}

function stripObservationStatusPrefix(value: string): string {
  return value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
}
