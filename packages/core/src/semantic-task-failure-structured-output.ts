import {
  looksLikeStructuredToolOutputEnvelope,
  readStructuredToolOutputObservation,
  type StructuredToolOutputObservation,
} from "./semantic-structured-output.js";
import type { SemanticStructuredOutputOwnership } from "./semantic-structured-output-ownership.js";
import { readTruncatedStructuredToolOutputEnvelope } from "./semantic-truncated-structured-output.js";

type CompleteObservation = "runtime_diagnostic" | "terminal_success" | null;
export type TaskFailureStructuredOutputEnvelope = (
  | { kind: "unsupported" | "raw" | "invalid" }
  | { kind: "valid" | "recovered"; output: StructuredToolOutputObservation }
) & { completeObservation: CompleteObservation };

export function readTaskFailureEvidenceEnvelope(
  summary: string | undefined,
  ownership: SemanticStructuredOutputOwnership,
): TaskFailureStructuredOutputEnvelope {
  let completeObservation: CompleteObservation = null;
  if (COMPLETE_RUNTIME_DIAGNOSTIC.test(summary ?? "")) completeObservation = "runtime_diagnostic";
  else if (COMPLETE_TERMINAL_SUCCESS.test(summary ?? "")) completeObservation = "terminal_success";
  if (ownership === "unsupported") return { completeObservation, kind: "unsupported" };
  const valid = readStructuredToolOutputObservation(summary, {
    coerceStringExitCode: ownership === "native",
  });
  if (valid !== null) return { completeObservation, kind: "valid", output: valid };
  if (!looksLikeStructuredToolOutputEnvelope(summary)) return { completeObservation, kind: "raw" };
  if (ownership === "exact") return { completeObservation, kind: "invalid" };
  const recovered = readTruncatedStructuredToolOutputEnvelope(summary);
  if (recovered === null) return { completeObservation, kind: "invalid" };
  return { completeObservation, kind: "recovered", output: recovered };
}

const COMPLETE_RUNTIME_DIAGNOSTIC =
  /^(?:the\s+)?(?:command|process|subprocess)\s+(?:invocation\s+)?(?:occurred|was\s+invoked|executed|ran)\s+and\s+(?:failed|terminated|aborted|crashed)\b(?=[\s\S]*\bcomplete\s+(?:standard[- ]?error|stderr|terminal|execution|command)\s+output\s+(?:reports?|contains?|emits?|shows?)\s+\S)(?=[\s\S]*\bno\s+(?:diagnostic|error|output)(?:\s+(?:bytes?|content|text))?\s+(?:was|were)\s+omitted\b)(?![\s\S]*\b(?:completed|finished)\s+successfully\b)(?![\s\S]*\bbegin\s+(?:source|document)\b)[\s\S]+$/i;
const COMPLETE_TERMINAL_SUCCESS =
  /^(?:the\s+)?(?:command|process|subprocess)\s+(?:invocation\s+)?(?:occurred|was\s+invoked|executed|ran)\b(?=[\s\S]*\b(?:completed|finished)\s+successfully\b)(?=[\s\S]*\b(?:exit|return)\s+(?:code|status)\s+(?:is\s+|was\s+)?(?:0|zero)\b)(?=[\s\S]*\b(?:result|outcome|record)\s+is\s+(?:terminal\s+and\s+complete|complete\s+and\s+terminal)\b)(?=[\s\S]*\bno\s+(?:output|diagnostic|evidence)(?:\s+or\s+(?:output|diagnostic|evidence))?\s+channels?\s+is\s+missing\b)(?![\s\S]*\b(?:failed|failure|crashed|runtimeerror|traceback)\b)(?![\s\S]*\bbegin\s+(?:source|document)\b)[\s\S]+$/i;
