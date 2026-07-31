type ImperativeSupersessionRelationEvent = {
  start: number;
  end: number;
  kind: "supersedes";
  order: 0;
  polarity: "asserted" | "negated";
  direct?: undefined;
};

export function readImperativeSupersessionRelationEvents(input: {
  tokens: readonly string[];
  isQuestion: boolean;
}): ImperativeSupersessionRelationEvent[] {
  if (input.isQuestion) {
    return [];
  }

  const tokens = input.tokens;
  const events: ImperativeSupersessionRelationEvent[] = [];
  const imperativeStart = readClauseLeadingImperativeStart(tokens);
  if (imperativeStart === null) {
    return events;
  }

  if (tokens[imperativeStart] === "replace") {
    const withIndex = tokens.indexOf("with", imperativeStart + 1);
    return withIndex === -1
      ? []
      : [
          {
            start: imperativeStart,
            end: withIndex + 1,
            kind: "supersedes",
            order: 0,
            polarity: "asserted",
          },
        ];
  }

  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "instead" && tokens[index + 1] !== "of") {
      events.push({
        start: index,
        end: index + 1,
        kind: "supersedes",
        order: 0,
        polarity: hasLocalSemanticNegation(tokens, index) ? "negated" : "asserted",
      });
    }
  }
  return events;
}

function readClauseLeadingImperativeStart(tokens: readonly string[]): number | null {
  if (startsWithAny(tokens, [["do", "not"], ["don", "t"], ["dont"], ["never"], ["not"]])) {
    return null;
  }

  const start = tokens[0] === "please" ? 1 : 0;
  return ["use", "follow", "switch", "adopt", "replace"].includes(tokens[start] ?? "")
    ? start
    : null;
}

function hasLocalSemanticNegation(tokens: readonly string[], cueStart: number): boolean {
  const local = tokens.slice(Math.max(0, cueStart - 4), cueStart);
  return (
    local.includes("not") ||
    local.includes("never") ||
    local.at(-1) === "no" ||
    hasTokenSequence(local, ["do", "not"]) ||
    hasTokenSequence(local, ["don", "t"]) ||
    hasTokenSequence(local, ["did", "not"]) ||
    hasTokenSequence(local, ["didn", "t"])
  );
}

function startsWithAny(
  tokens: readonly string[],
  sequences: readonly (readonly string[])[],
): boolean {
  return sequences.some((sequence) => sequence.every((token, index) => tokens[index] === token));
}

function hasTokenSequence(tokens: readonly string[], sequence: readonly string[]): boolean {
  for (let index = 0; index <= tokens.length - sequence.length; index += 1) {
    if (sequence.every((token, offset) => tokens[index + offset] === token)) {
      return true;
    }
  }
  return false;
}
