import type { SemanticRelationHint } from "./semantic-types.js";

export function hasSemanticRelationKind(
  relationHints: SemanticRelationHint[] | undefined,
  kind: SemanticRelationHint["kind"],
): boolean {
  return (relationHints ?? []).some((hint) => hint.kind === kind);
}

export function readSemanticRelationTarget(
  relationHints: SemanticRelationHint[] | undefined,
): string | null {
  const targetHint = (relationHints ?? []).find(
    (hint) => typeof hint.target === "string" && hint.target.length > 0,
  );
  return targetHint?.target ?? null;
}
