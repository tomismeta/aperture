import type { SemanticRelationHint } from "./semantic-types.js";

export function dedupeRelationHints(hints: SemanticRelationHint[]): SemanticRelationHint[] {
  const seen = new Set<string>();
  const result: SemanticRelationHint[] = [];

  for (const hint of hints) {
    const key = `${hint.kind}:${hint.target ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(hint);
  }

  return result;
}
