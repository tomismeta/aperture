import {
  isCLikeCommentOnlyLine,
  readCLikeLine,
  readClippedCLikeLine,
  type CLikeLine,
} from "./semantic-c-like-source-line-shapes.js";

export function looksLikeCLikeSourceFragmentObservation(value: string): boolean {
  const text = value.trim();
  return (
    text.length > 0 &&
    !looksLikeRejectedContainer(text) &&
    (hasStrongCLikeRun(text) || hasClippedCLikeRun(text))
  );
}

function hasStrongCLikeRun(text: string): boolean {
  return hasCLikeRun(text, { allowClippedFinalLine: false, minLines: 4 });
}

function hasClippedCLikeRun(text: string): boolean {
  return (
    hasVisibleTruncationBoundary(text) &&
    hasCLikeRun(text, { allowClippedFinalLine: true, minLines: 3 })
  );
}

function hasCLikeRun(
  text: string,
  options: { allowClippedFinalLine: boolean; minLines: number },
): boolean {
  const lines = text.split(/\r?\n/);
  const lastContentIndex = readLastContentLineIndex(lines);
  let run: CLikeLine[] = [];
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || isCLikeCommentOnlyLine(line)) {
      continue;
    }

    const parsed =
      readCLikeLine(line) ??
      (options.allowClippedFinalLine && index === lastContentIndex
        ? readClippedCLikeLine(line)
        : null);
    if (parsed === null) {
      if (hasRequiredCLikeEvidence(run, options.minLines)) {
        return true;
      }
      run = [];
      continue;
    }
    run.push(parsed);
  }

  return hasRequiredCLikeEvidence(run, options.minLines);
}

function hasRequiredCLikeEvidence(run: CLikeLine[], minLines: number): boolean {
  const categories = new Set(run.map((line) => line.category));
  const strongAnchors = run.filter((line) => line.strongAnchor).length;

  return (
    run.length >= minLines &&
    categories.size >= 2 &&
    strongAnchors >= 2 &&
    run.some((line) => line.nontrivialAnchor)
  );
}

function looksLikeRejectedContainer(text: string): boolean {
  return (
    /^\s*(?:\{|\[|")/.test(text) ||
    containsLineNumberedRows(text) ||
    containsKernelTimestampLine(text) ||
    containsMarkdownStructure(text) ||
    containsSourceLocationRows(text) ||
    /(?:^|[\r\n])\s*(?:make(?:\[\d+])?:|CMake (?:Error|Warning)\b|\[\s*\d+%]\s+\S|(?:error|fatal|warning):\b|Traceback\b|[$#>]\s+\S)/i.test(
      text,
    )
  );
}

function containsKernelTimestampLine(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:\d{1,6}:\s*)?\[\s*\d+(?:\.\d+)?]\s+\S/.test(text);
}

function containsMarkdownStructure(text: string): boolean {
  return /(?:^|[\r\n])\s*(?:#{1,6}\s+\S|[-*]\s+\S|```|\|.+\|)/.test(text);
}

function containsSourceLocationRows(text: string): boolean {
  return /(?:^|[\r\n])\s*\S+\.(?:c|cc|cpp|cxx|cu|cuh|h|hpp|hh|s|asm|ts|tsx|js|jsx|py):\d+(?::\d+)?:/i.test(
    text,
  );
}

function containsLineNumberedRows(text: string): boolean {
  return /(?:^|[\r\n])\s*\d{1,6}(?:[ \t]+|:\s*)\S/.test(text);
}

function hasVisibleTruncationBoundary(text: string): boolean {
  return /\.\.\.\s*$/.test(text);
}

function readLastContentLineIndex(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length > 0 && !isCLikeCommentOnlyLine(line)) {
      return index;
    }
  }
  return -1;
}
