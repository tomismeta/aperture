import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import {
  looksLikeStructuredToolOutputEnvelope,
  readStructuredToolOutputObservation,
} from "./semantic-structured-output.js";
import { readTruncatedStructuredToolOutputEnvelope } from "./semantic-truncated-structured-output.js";
export type SemanticStructuredOutputOwnership = "unsupported" | "native" | "exact";
export function readSemanticStructuredOutputOwnership(
  toolFamily: string | undefined,
): SemanticStructuredOutputOwnership {
  return isSemanticCommandExecutionToolFamily(toolFamily) || toolFamily === "edit"
    ? "native"
    : STRUCTURED_OUTPUT_EXCLUSIONS.has(toolFamily ?? "")
      ? "unsupported"
      : "exact";
}
export function resolveSemanticStructuredOutputEnvelope(
  summary: string | undefined,
  ownership: SemanticStructuredOutputOwnership,
) {
  const structured = looksLikeStructuredToolOutputEnvelope(summary);
  if (ownership === "unsupported") return { kind: structured ? "unsupported" : "raw" } as const;
  const valid = readStructuredToolOutputObservation(summary, {
    coerceStringExitCode: ownership === "native",
  });
  if (valid !== null) return { kind: "valid" as const, output: valid };
  if (!structured) return { kind: "raw" as const };
  if (ownership === "exact") return { kind: "invalid" as const };
  const recovered = readTruncatedStructuredToolOutputEnvelope(summary);
  return recovered === null
    ? { kind: "invalid" as const }
    : { kind: "recovered" as const, output: recovered };
}
const STRUCTURED_OUTPUT_EXCLUSIONS = new Set(["read", "search", "web", "write"]);
