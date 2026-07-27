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
  const targets = readSemanticRelationTargets(relationHints);
  return targets.length === 1 ? (targets[0] ?? null) : null;
}

export function hasConflictingSemanticRelationTargets(
  relationHints: SemanticRelationHint[] | undefined,
): boolean {
  return readSemanticRelationTargets(relationHints).length > 1;
}

export function readSemanticRelationTargets(
  relationHints: SemanticRelationHint[] | undefined,
): string[] {
  const targets = new Set<string>();
  for (const hint of relationHints ?? []) {
    if (typeof hint.target === "string" && hint.target.length > 0) {
      targets.add(hint.target);
    }
  }
  return [...targets];
}
