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
  editOutputOutcome: EditOutputOutcome | null;
  observationTranscript: ExplicitObservationTranscript | null;
  preExecutionControlOutcome: { executionEvidence: "absent" | "unspecified" } | null;
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  structuredOutputZeroExitSuccess: boolean;
  summary: string;
  toolFamily: string | undefined;
};
type ObservationOrigin = ObservationSemantics["provenance"]["origin"];
type ObservationSubject = ObservationSemantics["subject"];
type SourceEvidenceChannel = Exclude<SourceEvidence, { kind: "authorization" }>["channel"];
export type TaskFailureObservationSyntax = Omit<
  ObservationSemantics,
  "evidenceCertainty" | "ownership" | "provenance"
> & {
  origin: ObservationOrigin;
  owner?: ObservationSemantics["ownership"]["owner"];
  evidenceCertainty?: ObservationSemantics["evidenceCertainty"];
  boundedSource?: true;
  toolFamily?: string;
};
type ObservationSyntaxDetails = Partial<
  Pick<TaskFailureObservationSyntax, "diagnosticClass" | "evidenceLoss" | "recoveryHint">
> & { boundedSource?: true };

export function compileSourceEvidenceSyntax(evidence: SourceEvidence, toolFamily?: string) {
  if (evidence.kind === "authorization") return controlSyntax(toolFamily);
  const origin = sourceEvidenceOrigin(evidence.channel);
  if (evidence.kind === "payload")
    return payloadSyntax(
      origin,
      evidence.subject,
      evidence.channel === "structured" || evidence.subject === "tool" ? "high" : "low",
      toolFamily,
    );
  const diagnostic = evidence.kind === "diagnostic";
  const sourceLimit = diagnostic && evidence.diagnostic === "source_limit";
  const subject = "subject" in evidence ? evidence.subject : "source";
  return observationSyntax(
    evidence.kind,
    diagnostic ? "failure" : evidence.outcome,
    origin,
    subject,
    diagnostic
      ? evidence.diagnostic === "runtime"
        ? "high"
        : "medium"
      : evidence.outcome === "success"
        ? "low"
        : "medium",
    toolFamily,
    diagnostic
      ? {
          diagnosticClass: evidence.diagnostic,
          evidenceLoss: sourceLimit ? "partial" : "none",
          recoveryHint: sourceLimit ? "narrow_evidence_scope" : "inspect_diagnostic",
        }
      : undefined,
  );
}

function sourceEvidenceOrigin(channel: SourceEvidenceChannel): ObservationOrigin {
  if (channel === "search") return "transcript";
  return channel === "transcript" ? channel : `${channel}_output`;
}

export function readTaskFailureObservationSyntax(
  input: TaskFailureObservationGrammarInput,
): TaskFailureObservationSyntax | null {
  const { summary, toolFamily } = input;
  const boundedSource = syntaxObservation(
    readReadOutputPayloadObservation(summary, "complete_bounded"),
    "read_output",
    "source",
    toolFamily,
  );
  if (boundedSource !== null) return boundedSource;
  if (input.preExecutionControlOutcome) return controlSyntax(toolFamily);
  if (input.structuredOutputEnvelope.completeObservation === "runtime_diagnostic")
    return observationSyntax(
      "diagnostic",
      "failure",
      "command_output",
      "command",
      "high",
      toolFamily,
      { diagnosticClass: "runtime", recoveryHint: "inspect_diagnostic" },
    );
  if (input.structuredOutputEnvelope.completeObservation === "terminal_success")
    return observationSyntax("outcome", "success", "command_output", "command", "low", toolFamily);
  if (input.observationTranscript)
    return transcriptObservation(input.observationTranscript, toolFamily);
  if (input.editOutputOutcome === "applied")
    return payloadSyntax("semantic_evidence", "tool", "high", toolFamily);
  const payloadObservationSyntax = readTaskFailurePayloadObservationSyntax(input);
  if (payloadObservationSyntax !== null) return payloadObservationSyntax;
  if (input.structuredOutputZeroExitSuccess) {
    return observationSyntax(
      "outcome",
      "success",
      "structured_output",
      isSemanticCommandExecutionToolFamily(toolFamily) ? "command" : "tool",
      "low",
      toolFamily,
    );
  }
  return null;
}

function transcriptObservation(
  transcript: ExplicitObservationTranscript,
  toolFamily?: string,
): TaskFailureObservationSyntax {
  const source = transcript.shape === "abbreviated_file_view";
  const document =
    transcript.shape === "concrete_test_result" || transcript.shape === "successful_test";
  return payloadSyntax(
    source && toolFamily === "read" ? "read_output" : "transcript",
    source ? "source" : document ? "document" : "tool",
    transcript.consequenceBaseline,
    toolFamily,
  );
}

function controlSyntax(toolFamily?: string) {
  return observationSyntax("control", "neutral", "status_text", "tool", "low", toolFamily, {
    recoveryHint: "await_authorization",
  });
}

function payloadSyntax(
  origin: ObservationOrigin,
  subject: ObservationSubject,
  consequence: ObservationSemantics["consequenceBaseline"],
  toolFamily?: string,
  details?: ObservationSyntaxDetails,
) {
  return observationSyntax("payload", "neutral", origin, subject, consequence, toolFamily, details);
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
  const { structuredOutputEnvelope: envelope, summary, toolFamily } = input;
  if (toolFamily === "read") {
    const readObservation = syntaxObservation(
      readReadOutputPayloadObservation(summary, "unbounded"),
      "read_output",
      "document",
      "read",
    );
    if (readObservation !== null) return readObservation;
  }
  if (isSemanticCommandExecutionToolFamily(toolFamily) && envelope.kind === "raw") {
    return syntaxObservation(
      readCommandOutputPayloadObservation(summary),
      "command_output",
      "document",
      toolFamily,
    );
  }
  if (envelope.kind !== "valid" && envelope.kind !== "recovered") return null;

  return syntaxObservation(
    readStructuredOutputPayloadObservation({
      commandExecutionToolFamily: isSemanticCommandExecutionToolFamily(toolFamily),
      exitCode: envelope.output.exitCode,
      output: envelope.output.output,
      recoveredEnvelope: envelope.kind === "recovered",
    }),
    "structured_output",
    "tool",
    toolFamily,
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
        payload.completeBoundary === true ? { boundedSource: true } : undefined,
      );
}
