import { looksLikeStrongRawSourceObservation } from "./semantic-source-observation-shapes.js";

export function looksLikeAbbreviatedFileViewObservation(value: string): boolean {
  const text = value.trim().replace(/^(?:bash|edit|read|search|tool)\s+failure\s+/, "");
  const match = /^\s*<NOTE>([\s\S]{1,600}?)<\/NOTE>\s+([\s\S]+)$/i.exec(text);
  if (!match) {
    return false;
  }

  const note = match[1] ?? "";
  const payload = match[2]?.trim() ?? "";
  return (
    looksLikeAbbreviatedViewNote(note) &&
    (looksLikeStrongRawSourceObservation(payload) ||
      [...payload.matchAll(ABBREVIATED_NUMBERED_SOURCE_ROW_PATTERN)].length >= 2)
  );
}

function looksLikeAbbreviatedViewNote(note: string): boolean {
  return (
    OVERSIZED_SOURCE_SUBJECT_PATTERN.test(note) &&
    (OVERSIZED_DISPLAY_LIMIT_PATTERN.test(note) ||
      TOO_LARGE_TO_SHOW_PATTERN.test(note) ||
      VIEWER_CAPACITY_PATTERN.test(note)) &&
    PARTIAL_VIEW_PATTERN.test(note) &&
    RANGE_RECOVERY_PATTERN.test(note)
  );
}

const OVERSIZED_SOURCE_SUBJECT_PATTERN =
  /\b(?:file|source|content|output|document|payload|result|text|artifact|log)\b/i;

const OVERSIZED_DISPLAY_LIMIT_PATTERN =
  /\b(?:exceeds?|exceeded|larger\s+than|longer\s+than|over)\b[\s\S]{0,100}\b(?:display|show|render|view|viewer|capture|context|output)?[\s-]*(?:limit|limits|window|max(?:imum)?|allowed|capacity)\b/i;

const TOO_LARGE_TO_SHOW_PATTERN =
  /\btoo\s+(?:large|long)\s+to\s+(?:display|show|render|view|print|return|include)\s+(?:entirely|fully|in\s+full|completely)?\b/i;

const VIEWER_CAPACITY_PATTERN =
  /\b(?:larger|longer)\s+than\b[\s\S]{0,80}\b(?:viewer|display|view|window|context|tool|system)\b[\s\S]{0,80}\b(?:show|display|render|view|include|return|capture)\b/i;

const PARTIAL_VIEW_PATTERN =
  /\b(?:abbreviated|abridged|shortened|truncated|partial|compact|limited|excerpt|preview)\b/i;

const RANGE_RECOVERY_PATTERN =
  /\b(?:start_line|end_line|line_range|view_range|line\s+range|line\s+ranges|selected\s+lines|specific\s+lines|specific\s+portions|specific\s+sections|specific\s+ranges|fetch\s+lines|read\s+lines|show\s+lines|request\s+lines|inspect\s+lines|offset|limit|chunk|slice)\b/i;

const ABBREVIATED_NUMBERED_SOURCE_ROW_PATTERN =
  /(?:^|\s)\d{1,6}\s+(?:#|from\b|import\b|class\b|def\b|function\b|export\b|const\b|let\b|var\b|interface\b|type\b|struct\b|enum\b|static\b)/gi;
