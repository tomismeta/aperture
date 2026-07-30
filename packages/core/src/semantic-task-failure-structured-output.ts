import {
  looksLikeStructuredToolOutputEnvelope,
  readStructuredToolOutputObservation,
  type StructuredToolOutputObservation,
} from "./semantic-structured-output.js";
import { readTruncatedStructuredToolOutputEnvelope } from "./semantic-truncated-structured-output.js";

export type TaskFailureStructuredOutputEnvelope =
  | { kind: "unsupported" }
  | { kind: "raw" }
  | { kind: "valid"; output: StructuredToolOutputObservation }
  | { kind: "recovered"; output: StructuredToolOutputObservation }
  | { kind: "invalid" };

export function readTaskFailureStructuredOutputEnvelope(
  summary: string | undefined,
  supportsStructuredToolOutput: boolean,
): TaskFailureStructuredOutputEnvelope {
  if (!supportsStructuredToolOutput) return { kind: "unsupported" };

  const valid = readStructuredToolOutputObservation(summary);
  if (valid !== null) return { kind: "valid", output: valid };

  if (!looksLikeStructuredToolOutputEnvelope(summary)) return { kind: "raw" };

  const recovered = readTruncatedStructuredToolOutputEnvelope(summary);
  return recovered === null ? { kind: "invalid" } : { kind: "recovered", output: recovered };
}
