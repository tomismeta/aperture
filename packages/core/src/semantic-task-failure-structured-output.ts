import {
  looksLikeStructuredToolOutputEnvelope,
  readStructuredToolOutputObservation,
  type StructuredToolOutputObservation,
} from "./semantic-structured-output.js";
import type { SemanticStructuredOutputOwnership } from "./semantic-structured-output-ownership.js";
import { readTruncatedStructuredToolOutputEnvelope } from "./semantic-truncated-structured-output.js";

export type TaskFailureStructuredOutputEnvelope =
  | { kind: "unsupported" }
  | { kind: "raw" }
  | { kind: "valid"; output: StructuredToolOutputObservation }
  | { kind: "recovered"; output: StructuredToolOutputObservation }
  | { kind: "invalid" };

export function readTaskFailureStructuredOutputEnvelope(
  summary: string | undefined,
  ownership: SemanticStructuredOutputOwnership,
): TaskFailureStructuredOutputEnvelope {
  if (ownership === "unsupported") return { kind: "unsupported" };

  const valid = readStructuredToolOutputObservation(summary, {
    coerceStringExitCode: ownership === "native",
  });
  if (valid !== null) return { kind: "valid", output: valid };

  if (!looksLikeStructuredToolOutputEnvelope(summary)) return { kind: "raw" };
  if (ownership === "exact") return { kind: "invalid" };

  const recovered = readTruncatedStructuredToolOutputEnvelope(summary);
  return recovered === null ? { kind: "invalid" } : { kind: "recovered", output: recovered };
}
