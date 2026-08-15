import type { ApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import { buildAttentionJudgmentInput } from "./judgment-input.js";
import { enrichApertureEvent, normalizeSourceEvent } from "./semantic-normalizer.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import type { AttentionOntologyDiagnostic } from "./semantic-ontology-types.js";
export type * from "./semantic-ontology-types.js";
export function readAttentionOntologyDiagnostic(
  event: SourceEvent | ApertureEvent,
  interpretation?: SemanticInterpretation,
): AttentionOntologyDiagnostic {
  const normalized =
    "semantic" in event && event.semantic !== undefined
      ? enrichApertureEvent(event as ApertureEvent)
      : normalizeSourceEvent(event as SourceEvent);
  const typedEvidence = normalized.type === "task.updated" && normalized.evidence !== undefined;
  const semantic =
    interpretation === undefined
      ? normalized.semantic
      : typedEvidence
        ? { ...normalized.semantic, relationHints: interpretation.relationHints }
        : interpretation;
  const compiled = buildAttentionJudgmentInput({ ...normalized, semantic });
  if (!compiled.ontology)
    throw new Error("Canonical ontology compilation did not produce an ontology.");
  return compiled.ontology;
}
