import type {
  ObservationOrigin,
  ObservationSemantics,
  ObservationSubject,
} from "./observation-semantics.js";
import type { EditOutputOutcome } from "./semantic-edit-output-shapes.js";
import type { ExplicitObservationTranscript } from "./semantic-observation-transcript-shapes.js";
import type { TaskFailureStructuredOutputEnvelope } from "./semantic-task-failure-structured-output.js";
import { readTaskFailurePayloadObservationSemantics } from "./task-failure-payload-observation-grammar.js";

type TaskFailureObservationGrammarInput = {
  commandObservationTranscript: ExplicitObservationTranscript | null;
  editOutputOutcome: EditOutputOutcome | null;
  missingToolObservationTranscript: ExplicitObservationTranscript | null;
  readAbbreviatedFileViewObservation: ExplicitObservationTranscript | null;
  rejectedToolUseOutcome: boolean;
  commandExecutionToolFamily: boolean;
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  structuredOutputZeroExitSuccess: boolean;
  summary: string;
  toolFamily: string | undefined;
};

export function readTaskFailureObservationSemantics(
  input: TaskFailureObservationGrammarInput,
): ObservationSemantics | null {
  if (input.missingToolObservationTranscript) {
    return transcriptObservation(input.missingToolObservationTranscript);
  }
  if (input.commandObservationTranscript) {
    return transcriptObservation(input.commandObservationTranscript, input.toolFamily);
  }
  if (input.rejectedToolUseOutcome) {
    return controlObservation("status_text", "await_authorization", input.toolFamily);
  }
  if (input.editOutputOutcome === "applied") {
    return payloadObservation("semantic_evidence", "tool", "high", input.toolFamily);
  }
  if (input.readAbbreviatedFileViewObservation) {
    return payloadObservation(
      "read_output",
      "source",
      input.readAbbreviatedFileViewObservation.consequenceBaseline,
      "read",
    );
  }
  const payloadObservationSemantics = readTaskFailurePayloadObservationSemantics({
    summary: input.summary,
    structuredOutputEnvelope: input.structuredOutputEnvelope,
    toolFamily: input.toolFamily,
  });
  if (payloadObservationSemantics !== null) {
    return payloadObservationSemantics;
  }
  if (input.structuredOutputZeroExitSuccess) {
    return outcomeObservation(
      "structured_output",
      input.commandExecutionToolFamily ? "command" : "tool",
      "low",
      input.toolFamily,
    );
  }
  return null;
}

function transcriptObservation(
  transcript: ExplicitObservationTranscript,
  toolFamily?: string,
): ObservationSemantics {
  return payloadObservation(
    "transcript",
    transcript.shape === "abbreviated_file_view"
      ? "source"
      : transcript.shape === "concrete_test_result" || transcript.shape === "successful_test"
        ? "document"
        : "tool",
    transcript.consequenceBaseline,
    toolFamily,
  );
}

function payloadObservation(
  origin: ObservationOrigin,
  subject: ObservationSubject,
  consequenceBaseline: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
): ObservationSemantics {
  return baseObservation({
    kind: "payload",
    polarity: "neutral",
    origin,
    subject,
    consequenceBaseline,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  });
}

function outcomeObservation(
  origin: ObservationOrigin,
  subject: ObservationSubject,
  consequenceBaseline: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
): ObservationSemantics {
  return baseObservation({
    kind: "outcome",
    polarity: "success",
    origin,
    subject,
    consequenceBaseline,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  });
}

function controlObservation(
  origin: ObservationOrigin,
  recoveryHint: NonNullable<ObservationSemantics["recoveryHint"]>,
  toolFamily?: string,
): ObservationSemantics {
  return {
    ...baseObservation({
      kind: "control",
      polarity: "neutral",
      origin,
      subject: "tool",
      consequenceBaseline: "low",
      ...(toolFamily !== undefined ? { toolFamily } : {}),
    }),
    recoveryHint,
  };
}

function baseObservation(input: {
  kind: ObservationSemantics["kind"];
  polarity: ObservationSemantics["polarity"];
  origin: ObservationOrigin;
  subject: ObservationSubject;
  consequenceBaseline: ObservationSemantics["consequenceBaseline"];
  toolFamily?: string;
}): ObservationSemantics {
  return {
    kind: input.kind,
    polarity: input.polarity,
    ownership: {
      owner: input.toolFamily === undefined ? "source" : "tool",
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    },
    subject: input.subject,
    evidenceLoss: "none",
    provenance: { origin: input.origin },
    consequenceBaseline: input.consequenceBaseline,
    evidenceCertainty: "determinate",
  };
}
