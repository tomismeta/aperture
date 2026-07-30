import {
  isCLikeCommentOnlyLine,
  readCLikeLine,
  readClippedCLikeLine,
} from "./semantic-c-like-source-line-shapes.js";
import { looksLikeClippedCLikeArgumentContext } from "./semantic-c-like-source-observation-shapes.js";
import { looksLikeClippedSourceLocationObservation } from "./semantic-source-observation-shapes.js";

export function looksLikeRecoveredCommandSourceObservation(value: string): boolean {
  return (
    looksLikeClippedSourceLocationObservation(value) ||
    looksLikeClippedCLikeArgumentContext(value) ||
    looksLikeClippedCLikeStreamSourceContext(value)
  );
}

function looksLikeClippedCLikeStreamSourceContext(value: string): boolean {
  const text = value.trim();
  if (!/\.\.\.\s*$/.test(text) || !/(?:^|[\r\n])\s*std::c(?:out|err|log)\s*<</.test(text)) {
    return false;
  }

  const parsed = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isCLikeCommentOnlyLine(line))
    .map((line) => readCLikeLine(line) ?? readClippedCLikeLine(line))
    .filter((line) => line !== null);

  return (
    parsed.length >= 3 &&
    parsed.filter((line) => line.strongAnchor).length >= 2 &&
    parsed.some((line) => line.nontrivialAnchor)
  );
}
