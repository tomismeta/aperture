import type { ObservationSemantics } from "./observation-semantics.js";
import type { SourceEvidence } from "./events.js";
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
export type TaskFailureObservationSyntax = Omit<
  ObservationSemantics,
  "evidenceCertainty" | "ownership" | "provenance"
> & {
  origin: ObservationOrigin;
  owner?: ObservationSemantics["ownership"]["owner"];
  evidenceCertainty?: ObservationSemantics["evidenceCertainty"];
  toolFamily?: string;
};
type ObservationSyntaxDetails = Partial<
  Pick<TaskFailureObservationSyntax, "diagnosticClass" | "evidenceLoss" | "recoveryHint">
>;

export function compileSourceEvidenceSyntax(evidence: SourceEvidence, toolFamily?: string) {
  if (evidence.kind === "authorization")
    return observationSyntax("control", "neutral", "status_text", "tool", "low", toolFamily, {
      recoveryHint: "await_authorization",
    });
  const origin = sourceEvidenceOrigin(evidence.channel);
  if (evidence.kind === "outcome")
    return observationSyntax(
      "outcome",
      evidence.outcome,
      origin,
      evidence.subject,
      evidence.outcome === "success" ? "low" : "medium",
      toolFamily,
    );
  if (evidence.kind === "payload")
    return payloadSyntax(
      origin,
      evidence.subject,
      evidence.channel === "structured" || evidence.subject === "tool" ? "high" : "low",
      toolFamily,
    );
  const sourceLimit = evidence.diagnostic === "source_limit";
  return observationSyntax(
    "diagnostic",
    "failure",
    origin,
    sourceLimit ? "source" : evidence.subject,
    evidence.diagnostic === "runtime" ? "high" : "medium",
    toolFamily,
    {
      diagnosticClass: evidence.diagnostic,
      evidenceLoss: sourceLimit ? "partial" : "none",
      recoveryHint: sourceLimit ? "narrow_evidence_scope" : "inspect_diagnostic",
    },
  );
}

function sourceEvidenceOrigin(
  channel: Exclude<SourceEvidence, { kind: "authorization" }>["channel"],
): ObservationOrigin {
  if (channel === "command") return "command_output";
  if (channel === "read") return "read_output";
  if (channel === "structured") return "structured_output";
  return "transcript";
}

export function readTaskFailureObservationSyntax(
  input: TaskFailureObservationGrammarInput,
): TaskFailureObservationSyntax | null {
  if (input.missingToolObservationTranscript)
    return transcriptObservation(input.missingToolObservationTranscript);
  if (input.commandObservationTranscript)
    return transcriptObservation(input.commandObservationTranscript, input.toolFamily);
  if (input.toolUseRejectionOutcome)
    return observationSyntax("control", "neutral", "status_text", "tool", "low", input.toolFamily, {
      recoveryHint: "await_authorization",
    });
  if (input.editOutputOutcome === "applied")
    return payloadSyntax("semantic_evidence", "tool", "high", input.toolFamily);
  if (input.readAbbreviatedFileViewObservation) {
    return payloadSyntax(
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
  if (payloadObservationSyntax !== null) return payloadObservationSyntax;
  if (input.structuredOutputZeroExitSuccess) {
    return observationSyntax(
      "outcome",
      "success",
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
  return payloadSyntax(
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

function payloadSyntax(
  origin: ObservationOrigin,
  subject: ObservationSubject,
  consequence: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
) {
  return observationSyntax("payload", "neutral", origin, subject, consequence, toolFamily);
}

function observationSyntax(
  kind: ObservationSemantics["kind"],
  polarity: ObservationSemantics["polarity"],
  origin: ObservationOrigin,
  subject: ObservationSubject,
  consequenceBaseline: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
  details: ObservationSyntaxDetails = {},
): TaskFailureObservationSyntax {
  return {
    kind,
    polarity,
    origin,
    subject,
    evidenceLoss: "none",
    consequenceBaseline,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
    ...details,
  };
}

export function readTaskFailurePayloadObservationSyntax(input: {
  summary: string;
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  toolFamily: string | undefined;
}): TaskFailureObservationSyntax | null {
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
): TaskFailureObservationSyntax | null {
  return payload === null
    ? null
    : payloadSyntax(
        origin,
        payload.source ? "source" : fallbackSubject,
        payload.consequenceBaseline,
        toolFamily,
      );
}
