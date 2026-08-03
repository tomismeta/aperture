import type { ApertureEvent, EnrichedApertureEvent } from "./events.js";
import type { SourceEvent } from "./source-event.js";
import { buildAttentionJudgmentInput } from "./judgment-input.js";
import { normalizeSourceEvent } from "./semantic-normalizer.js";
import type { SemanticInterpretation } from "./semantic-types.js";
import type {
  AttentionOntologyDiagnostic,
  SemanticOntologyDiagnostic,
} from "./semantic-ontology-types.js";
export type * from "./semantic-ontology-types.js";
export function readAttentionOntologyDiagnostic(
  event: SourceEvent,
  interpretation?: SemanticInterpretation,
): AttentionOntologyDiagnostic {
  return compileAttentionOntologyDiagnostic(normalizeSourceEvent(event), interpretation);
}

function compileAttentionOntologyDiagnostic(
  normalized: EnrichedApertureEvent,
  interpretation?: SemanticInterpretation,
): AttentionOntologyDiagnostic {
  const compiled = buildAttentionJudgmentInput(
    interpretation === undefined ? normalized : { ...normalized, semantic: interpretation },
  );

  if (!compiled.ontology) {
    throw new Error("Canonical ontology compilation did not produce an ontology.");
  }

  return compiled.ontology;
}
/** @deprecated Use readAttentionOntologyDiagnostic. */
export function readSemanticOntologyDiagnostic(
  event: SourceEvent | ApertureEvent,
  interpretation?: SemanticInterpretation,
): SemanticOntologyDiagnostic {
  return compileAttentionOntologyDiagnostic(
    normalizeOntologyCompatibilityEvent(event),
    interpretation,
  );
}
/** @deprecated Use readAttentionOntologyDiagnostic. */
export function projectSemanticOntologyDiagnostic(
  event: SourceEvent | ApertureEvent,
  interpretation: SemanticInterpretation,
): SemanticOntologyDiagnostic {
  return compileAttentionOntologyDiagnostic(
    normalizeOntologyCompatibilityEvent(event),
    interpretation,
  );
}
function normalizeOntologyCompatibilityEvent(
  event: SourceEvent | ApertureEvent,
): EnrichedApertureEvent {
  return "semantic" in event
    ? (event as EnrichedApertureEvent)
    : normalizeSourceEvent(event as SourceEvent);
}
