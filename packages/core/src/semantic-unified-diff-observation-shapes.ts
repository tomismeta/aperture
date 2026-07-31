import { stripObservationStatusPrefix } from "./semantic-observation-text.js";

export function looksLikeUnifiedDiffObservation(value: string): boolean {
  const text = stripObservationStatusPrefix(value);
  if (text.length === 0) {
    return false;
  }

  return looksLikeGitUnifiedDiff(text);
}

function looksLikeGitUnifiedDiff(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ");
  const match =
    /^diff --git a\/(\S+) b\/(\S+) index [a-f0-9]{6,}\.\.[a-f0-9]{6,}(?: \d+)? --- a\/(\S+) \+\+\+ b\/(\S+) @@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: |$)/i.exec(
      normalized,
    );

  return match !== null && match[1] === match[3] && match[2] === match[4] && match[1] === match[2];
}
