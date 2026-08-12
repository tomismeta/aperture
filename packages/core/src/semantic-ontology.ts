import type { ApertureEvent, EnrichedApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import { buildAttentionJudgmentInput } from "./judgment-input.js";
import { normalizeSourceEvent } from "./semantic-normalizer.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import type { AttentionOntologyDiagnostic } from "./semantic-ontology-types.js";
export type * from "./semantic-ontology-types.js";
export function readAttentionOntologyDiagnostic(
  event: SourceEvent | ApertureEvent,
  interpretation?: SemanticInterpretation,
): AttentionOntologyDiagnostic {
  const normalized =
    "semantic" in event && event.semantic !== undefined
      ? (event as EnrichedApertureEvent)
      : normalizeSourceEvent(event as SourceEvent);
  return compileAttentionOntologyDiagnostic(normalized, interpretation);
}
function compileAttentionOntologyDiagnostic(
  normalized: EnrichedApertureEvent,
  interpretation?: SemanticInterpretation,
): AttentionOntologyDiagnostic {
  const compiled = buildAttentionJudgmentInput(
    interpretation === undefined ? normalized : { ...normalized, semantic: interpretation },
  );
  if (!compiled.ontology)
    throw new Error("Canonical ontology compilation did not produce an ontology.");
  return compiled.ontology;
}
