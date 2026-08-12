import type { ObservationSemantics } from "./observation-semantics.js";
import type { EditOutputOutcome } from "./semantic-edit-output-shapes.js";
import type { ExplicitObservationTranscript } from "./semantic-observation-transcript-shapes.js";
import {
  type PayloadSyntaxObservation,
  readCommandOutputPayloadObservation,
  readReadOutputPayloadObservation,
  readStructuredOutputPayloadObservation,
} from "./semantic-payload-observation-shapes.js";
import type { TaskFailureStructuredOutputEnvelope } from "./semantic-task-failure-structured-output.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";

type TaskFailureObservationGrammarInput = {
  commandObservationTranscript: ExplicitObservationTranscript | null;
  editOutputOutcome: EditOutputOutcome | null;
  missingToolObservationTranscript: ExplicitObservationTranscript | null;
  readAbbreviatedFileViewObservation: ExplicitObservationTranscript | null;
  toolUseRejectionOutcome: { executionEvidence: "absent" | "unspecified" } | null;
  commandExecutionToolFamily: boolean;
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  structuredOutputZeroExitSuccess: boolean;
  summary: string;
  toolFamily: string | undefined;
};

type ObservationOrigin = ObservationSemantics["provenance"]["origin"];
type ObservationSubject = ObservationSemantics["subject"];

export type TaskFailureObservationSyntax =
  | (TaskFailurePayloadObservationSyntax & { kind: "payload" })
  | {
      kind: "outcome";
      origin: ObservationOrigin;
      subject: ObservationSubject;
      consequenceBaseline: ObservationSemantics["consequenceBaseline"];
      toolFamily?: string;
    }
  | {
      kind: "control";
      origin: ObservationOrigin;
      recoveryHint: NonNullable<ObservationSemantics["recoveryHint"]>;
      executionEvidence: "absent" | "unspecified";
      toolFamily?: string;
    };

type TaskFailurePayloadObservationSyntax = {
  origin: ObservationOrigin;
  fallbackSubject: ObservationSubject;
  payload: PayloadSyntaxObservation;
  toolFamily?: string;
};

export function readTaskFailureObservationSyntax(
  input: TaskFailureObservationGrammarInput,
): TaskFailureObservationSyntax | null {
  if (input.missingToolObservationTranscript) {
    return transcriptObservation(input.missingToolObservationTranscript);
  }
  if (input.commandObservationTranscript) {
    return transcriptObservation(input.commandObservationTranscript, input.toolFamily);
  }
  if (input.toolUseRejectionOutcome) {
    return {
      kind: "control",
      origin: "status_text",
      recoveryHint: "await_authorization",
      executionEvidence: input.toolUseRejectionOutcome.executionEvidence,
      ...(input.toolFamily !== undefined ? { toolFamily: input.toolFamily } : {}),
    };
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
  const payloadObservationSyntax = readTaskFailurePayloadObservationSyntax({
    summary: input.summary,
    structuredOutputEnvelope: input.structuredOutputEnvelope,
    toolFamily: input.toolFamily,
  });
  if (payloadObservationSyntax !== null) {
    return { kind: "payload", ...payloadObservationSyntax };
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
): TaskFailureObservationSyntax {
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
): TaskFailureObservationSyntax {
  return {
    kind: "payload",
    origin,
    fallbackSubject: subject,
    payload: { source: subject === "source", consequenceBaseline },
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  };
}

function outcomeObservation(
  origin: ObservationOrigin,
  subject: ObservationSubject,
  consequenceBaseline: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
): TaskFailureObservationSyntax {
  return {
    kind: "outcome",
    origin,
    subject,
    consequenceBaseline,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  };
}

export function readTaskFailurePayloadObservationSyntax(input: {
  summary: string;
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  toolFamily: string | undefined;
}): TaskFailurePayloadObservationSyntax | null {
  if (input.toolFamily === "read") {
    const readObservation = syntaxObservation(
      readReadOutputPayloadObservation(input.summary),
      "read_output",
      "document",
      "read",
    );
    if (readObservation !== null) return readObservation;
  }

  if (
    isSemanticCommandExecutionToolFamily(input.toolFamily) &&
    input.structuredOutputEnvelope.kind === "raw"
  ) {
    return syntaxObservation(
      readCommandOutputPayloadObservation(input.summary),
      "command_output",
      "document",
      input.toolFamily,
    );
  }

  const envelope = input.structuredOutputEnvelope;
  if (envelope.kind !== "valid" && envelope.kind !== "recovered") return null;

  return syntaxObservation(
    readStructuredOutputPayloadObservation({
      commandExecutionToolFamily: isSemanticCommandExecutionToolFamily(input.toolFamily),
      exitCode: envelope.output.exitCode,
      output: envelope.output.output,
      recoveredEnvelope: envelope.kind === "recovered",
    }),
    "structured_output",
    "tool",
    input.toolFamily,
  );
}

function syntaxObservation(
  payload: PayloadSyntaxObservation | null,
  origin: ObservationOrigin,
  fallbackSubject: ObservationSubject,
  toolFamily?: string,
): TaskFailurePayloadObservationSyntax | null {
  return payload === null
    ? null
    : {
        origin,
        fallbackSubject,
        payload,
        ...(toolFamily !== undefined ? { toolFamily } : {}),
      };
}
