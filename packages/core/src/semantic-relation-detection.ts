import {
  CONTEXTUAL_RESOLVE_PHRASES,
  DIRECT_RESOLVE_PHRASES,
  ESCALATE_PHRASES,
  ISSUE_SIGNAL_PHRASES,
  NEGATED_ESCALATE_PHRASES,
  NEGATED_REPEAT_PHRASES,
  NEGATED_RESOLVE_PHRASES,
  REPEAT_PHRASES,
  SUPERSEDE_PHRASES,
} from "./semantic-patterns.js";
import { readImperativeSupersessionRelationEvents } from "./semantic-imperative-supersession-relation.js";
import { dedupeRelationHints } from "./semantic-relation-hint-dedupe.js";
import { readResolutionPolarity } from "./semantic-resolution-polarity.js";
import type { SemanticRelationHint } from "./semantic-types.js";
import { normalizeSemanticLexicalText } from "./semantic-text.js";

type SemanticSignalPolarity = "asserted" | "negated";
type RelationSignalKind = Exclude<SemanticRelationHint["kind"], "same_issue">;
type RelationSignalPolarity = SemanticSignalPolarity | "modal" | "prospective";
type SemanticSignalClause = { tokens: string[]; isQuestion: boolean };
type RelationSignalEvent = {
  kind: RelationSignalKind;
  order: number;
  polarity: RelationSignalPolarity;
  direct?: boolean;
};

const RESURFACING_RELATION_KIND_ORDER = new Map<RelationSignalKind, number>([
  ["repeats", 0],
  ["supersedes", 1],
  ["escalates", 2],
]);

export function detectSemanticRelationHints(text: string): SemanticRelationHint[] {
  const events = readRelationSignalEvents(text);
  const hasIssueSignal =
    hasAnyAssertedSemanticSignal(text, ISSUE_SIGNAL_PHRASES, []) ||
    events.some(
      (event) =>
        event.polarity === "asserted" &&
        (event.kind === "escalates" || event.kind === "supersedes"),
    );
  const latestByKind = latestRelationEventsByKind(events);
  const assertedEvents = [...latestByKind.values()]
    .sort((left, right) => left.order - right.order)
    .filter(
      (event) =>
        event.polarity === "asserted" &&
        (event.kind === "resolves" || hasIssueSignal) &&
        (event.kind !== "resolves" || event.direct || hasIssueSignal),
    );
  const latestAsserted = assertedEvents.at(-1);

  if (latestAsserted === undefined) {
    return [];
  }

  if (latestAsserted.kind === "resolves") {
    return [{ kind: "same_issue" }, { kind: "resolves" }];
  }

  const latestResolved = latestByKind.get("resolves");
  const latestResolvedOrder =
    latestResolved?.polarity === "asserted" ? latestResolved.order : undefined;
  const resurfacingHints = assertedEvents
    .filter(
      (event) =>
        event.kind !== "resolves" &&
        (latestResolvedOrder === undefined || event.order > latestResolvedOrder),
    )
    .sort(compareResurfacingRelationEvents)
    .map((event): SemanticRelationHint => ({ kind: event.kind }));

  if (resurfacingHints.length === 0) {
    return [];
  }

  return dedupeRelationHints([{ kind: "same_issue" }, ...resurfacingHints]);
}

function compareResurfacingRelationEvents(
  left: RelationSignalEvent,
  right: RelationSignalEvent,
): number {
  return (
    (RESURFACING_RELATION_KIND_ORDER.get(left.kind) ?? Number.MAX_SAFE_INTEGER) -
      (RESURFACING_RELATION_KIND_ORDER.get(right.kind) ?? Number.MAX_SAFE_INTEGER) ||
    left.order - right.order
  );
}

function hasAnyAssertedSemanticSignal(
  value: string,
  cues: readonly string[],
  negatedCues: readonly string[],
): boolean {
  for (const event of readSemanticSignalEvents(value, cues, negatedCues)) {
    if (event.polarity === "asserted") {
      return true;
    }
  }
  return false;
}

function readSemanticSignalEvents(
  value: string,
  cues: readonly string[],
  negatedCues: readonly string[],
): Array<{ polarity: SemanticSignalPolarity }> {
  const events: Array<{ polarity: SemanticSignalPolarity }> = [];
  for (const { tokens } of readSemanticSignalClauses(value)) {
    const negatedRanges = negatedCues.flatMap((phrase) =>
      readSemanticPhraseRanges(tokens, tokenizeSemanticSignalText(phrase)),
    );
    const clauseEvents: Array<{ start: number; polarity: SemanticSignalPolarity }> =
      negatedRanges.map((range) => ({ start: range.start, polarity: "negated" }));

    for (const cue of cues) {
      for (const range of readSemanticPhraseRanges(tokens, tokenizeSemanticSignalText(cue))) {
        clauseEvents.push({
          start: range.start,
          polarity:
            isRangeCovered(range, negatedRanges) || hasLocalSemanticNegation(tokens, range.start)
              ? "negated"
              : "asserted",
        });
      }
    }

    clauseEvents
      .sort((left, right) => left.start - right.start)
      .forEach((event) => events.push({ polarity: event.polarity }));
  }

  return events;
}

function readRelationSignalEvents(value: string): RelationSignalEvent[] {
  const events: RelationSignalEvent[] = [];
  let nextOrder = 0;

  for (const clause of readSemanticSignalClauses(value)) {
    const clauseEvents = [
      ...readPhraseRelationEvents(clause, "repeats", REPEAT_PHRASES, NEGATED_REPEAT_PHRASES),
      ...readResolutionRelationEvents(clause),
      ...readPhraseRelationEvents(clause, "supersedes", SUPERSEDE_PHRASES, []),
      ...readImperativeSupersessionRelationEvents(clause),
      ...readPhraseRelationEvents(clause, "escalates", ESCALATE_PHRASES, NEGATED_ESCALATE_PHRASES),
    ].sort((left, right) => left.start - right.start || left.end - right.end);

    for (const event of clauseEvents) {
      events.push({
        kind: event.kind,
        order: nextOrder,
        polarity: event.polarity,
        ...(event.direct !== undefined ? { direct: event.direct } : {}),
      });
      nextOrder += 1;
    }
  }

  return events;
}

function latestRelationEventsByKind(
  events: readonly RelationSignalEvent[],
): Map<RelationSignalKind, RelationSignalEvent> {
  const latest = new Map<RelationSignalKind, RelationSignalEvent>();
  for (const event of events) {
    latest.set(event.kind, event);
  }
  return latest;
}

function readPhraseRelationEvents(
  clause: SemanticSignalClause,
  kind: RelationSignalKind,
  cues: readonly string[],
  negatedCues: readonly string[],
): Array<RelationSignalEvent & { start: number; end: number }> {
  const negatedRanges = negatedCues.flatMap((phrase) =>
    readSemanticPhraseRanges(clause.tokens, tokenizeSemanticSignalText(phrase)),
  );
  const events: Array<RelationSignalEvent & { start: number; end: number }> = negatedRanges.map(
    (range) => ({
      ...range,
      kind,
      order: 0,
      polarity: "negated",
    }),
  );

  for (const cue of cues) {
    for (const range of readSemanticPhraseRanges(clause.tokens, tokenizeSemanticSignalText(cue))) {
      events.push({
        ...range,
        kind,
        order: 0,
        polarity:
          isRangeCovered(range, negatedRanges) ||
          hasLocalSemanticNegation(clause.tokens, range.start)
            ? "negated"
            : "asserted",
      });
    }
  }

  return events;
}

function readResolutionRelationEvents(
  clause: SemanticSignalClause,
): Array<RelationSignalEvent & { start: number; end: number }> {
  const negatedRanges = NEGATED_RESOLVE_PHRASES.flatMap((phrase) =>
    readSemanticPhraseRanges(clause.tokens, tokenizeSemanticSignalText(phrase)),
  );
  const events: Array<RelationSignalEvent & { start: number; end: number }> = negatedRanges.map(
    (range) => ({
      ...range,
      kind: "resolves",
      order: 0,
      polarity: "negated",
    }),
  );

  for (const cue of DIRECT_RESOLVE_PHRASES) {
    for (const range of readSemanticPhraseRanges(clause.tokens, tokenizeSemanticSignalText(cue))) {
      events.push({
        ...range,
        kind: "resolves",
        order: 0,
        polarity: isRangeCovered(range, negatedRanges)
          ? "negated"
          : readResolutionPolarity(clause, range.start),
        direct: true,
      });
    }
  }

  for (const cue of CONTEXTUAL_RESOLVE_PHRASES) {
    for (const range of readSemanticPhraseRanges(clause.tokens, tokenizeSemanticSignalText(cue))) {
      events.push({
        ...range,
        kind: "resolves",
        order: 0,
        polarity: isRangeCovered(range, negatedRanges)
          ? "negated"
          : readResolutionPolarity(clause, range.start),
        direct: false,
      });
    }
  }

  return events;
}

function readSemanticSignalClauses(value: string): SemanticSignalClause[] {
  const clauses: SemanticSignalClause[] = [];
  let start = 0;

  for (const match of value.matchAll(/[!?;:]+|\.+(?=\s|$)|\b(?:but|however|yet)\b/gi)) {
    const end = match.index;
    const clause = toSemanticSignalClause(value.slice(start, end), match[0].includes("?"));
    if (clause !== null) {
      clauses.push(clause);
    }
    start = end + match[0].length;
  }

  const finalClause = toSemanticSignalClause(value.slice(start), false);
  if (finalClause !== null) {
    clauses.push(finalClause);
  }

  return clauses;
}

function toSemanticSignalClause(value: string, isQuestion: boolean): SemanticSignalClause | null {
  const tokens = tokenizeSemanticSignalText(value);
  if (tokens.length === 0) {
    return null;
  }

  return { tokens, isQuestion };
}

function tokenizeSemanticSignalText(value: string): string[] {
  return normalizeSemanticLexicalText(value).match(/[a-z0-9]+/g) ?? [];
}

function readSemanticPhraseRanges(
  tokens: readonly string[],
  phraseTokens: readonly string[],
): Array<{ start: number; end: number }> {
  if (phraseTokens.length === 0 || phraseTokens.length > tokens.length) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (let index = 0; index <= tokens.length - phraseTokens.length; index += 1) {
    if (phraseTokens.every((token, offset) => tokens[index + offset] === token)) {
      ranges.push({ start: index, end: index + phraseTokens.length });
    }
  }
  return ranges;
}

function isRangeCovered(
  range: { start: number; end: number },
  coveringRanges: ReadonlyArray<{ start: number; end: number }>,
): boolean {
  return coveringRanges.some(
    (coveringRange) => range.start >= coveringRange.start && range.end <= coveringRange.end,
  );
}

function hasLocalSemanticNegation(tokens: readonly string[], cueStart: number): boolean {
  const local = tokens.slice(Math.max(0, cueStart - 4), cueStart);
  return (
    local.includes("not") ||
    local.includes("never") ||
    local.at(-1) === "no" ||
    hasTokenSequence(local, ["did", "not"]) ||
    hasTokenSequence(local, ["didn", "t"])
  );
}

function hasTokenSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }
  return false;
}
