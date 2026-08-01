import type {
  ObservationOrigin,
  ObservationSemantics,
  ObservationSubject,
} from "./observation-semantics.js";
import type { CommandTextObservation } from "./semantic-command-text-observation-shapes.js";
import type { EditOutputOutcome } from "./semantic-edit-output-shapes.js";
import type { ExplicitObservationTranscript } from "./semantic-observation-transcript-shapes.js";

type TaskFailureObservationGrammarInput = {
  commandObservationTranscript: ExplicitObservationTranscript | null;
  editOutputOutcome: EditOutputOutcome | null;
  missingToolObservationTranscript: ExplicitObservationTranscript | null;
  rawCommandDiffObservation: boolean;
  rawCommandTextObservation: CommandTextObservation | null;
  rawReadListingObservation: boolean;
  rawReadObservationBaseline: "low" | "medium" | "high" | null;
  rawReadSourceObservation: boolean;
  readAbbreviatedFileViewObservation: ExplicitObservationTranscript | null;
  rejectedToolUseOutcome: boolean;
  structuredOutputPayloadAvailable: boolean;
  structuredOutputObservation: boolean;
  structuredOutputSourceObservation: boolean;
  structuredOutputZeroExitSuccess: boolean;
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
  if (input.rawCommandDiffObservation) {
    return payloadObservation("command_output", "source", "high", input.toolFamily);
  }
  if (input.rawCommandTextObservation) {
    return payloadObservation(
      "command_output",
      normalizeObservationSubject(input.rawCommandTextObservation.shape),
      input.rawCommandTextObservation.consequenceBaseline,
      input.toolFamily,
    );
  }
  if (input.rawReadObservationBaseline) {
    return payloadObservation(
      "read_output",
      input.rawReadSourceObservation ? "source" : "document",
      input.rawReadObservationBaseline,
      "read",
    );
  }
  if (input.readAbbreviatedFileViewObservation) {
    return payloadObservation(
      "read_output",
      "source",
      input.readAbbreviatedFileViewObservation.consequenceBaseline,
      "read",
    );
  }
  if (input.structuredOutputPayloadAvailable && input.structuredOutputObservation) {
    return payloadObservation(
      "structured_output",
      input.structuredOutputSourceObservation ? "source" : "tool",
      input.structuredOutputSourceObservation ? "high" : "medium",
      input.toolFamily,
    );
  }
  if (input.structuredOutputZeroExitSuccess) {
    return outcomeObservation("structured_output", "low", input.toolFamily);
  }
  return null;
}

export function readTaskFailureEditDiagnosticObservationSemantics(input: {
  editOutputOutcome: EditOutputOutcome | null;
  toolFamily: string | undefined;
  consequenceBaseline: ObservationSemantics["consequenceBaseline"];
}): ObservationSemantics | null {
  if (input.editOutputOutcome !== "failure") {
    return null;
  }

  return {
    ...baseObservation({
      kind: "diagnostic",
      polarity: "failure",
      origin: "semantic_evidence",
      subject: "tool",
      consequenceBaseline: input.consequenceBaseline,
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    }),
    diagnosticClass: "runtime",
    recoveryHint: "inspect_diagnostic",
  };
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
  consequenceBaseline: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
): ObservationSemantics {
  return baseObservation({
    kind: "outcome",
    polarity: "success",
    origin,
    subject: "tool",
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

function normalizeObservationSubject(subject: CommandTextObservation["shape"]): ObservationSubject {
  switch (subject) {
    case "source":
    case "diff":
      return "source";
    case "document":
    case "linter":
    case "readback":
    case "test":
      return "document";
  }
}
