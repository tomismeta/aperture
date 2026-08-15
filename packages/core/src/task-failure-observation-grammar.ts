import type { EditOutputOutcome } from "./semantic-edit-output-shapes.js";
import type { ExplicitObservationTranscript } from "./semantic-observation-transcript-shapes.js";
import {
  type PayloadSyntaxObservation,
  readCommandOutputPayloadObservation,
  readReadOutputPayloadObservation,
  readStructuredOutputPayloadObservation,
} from "./semantic-payload-observation-shapes.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";
import {
  createTaskFailureObservationSyntax,
  type TaskFailureObservationSyntax,
} from "./task-failure-observation-core.js";

export {
  compileSourceEvidenceSyntax,
  type TaskFailureObservationSyntax,
} from "./task-failure-observation-core.js";

type TaskFailureEventFact =
  | "absent_failure"
  | "authorization_control"
  | "document_payload"
  | "expected_source_diagnostic"
  | "outcome_failure"
  | "runtime_diagnostic"
  | "source_diagnostic"
  | "source_limit"
  | "terminal_success";
type TaskFailureObservationGrammarInput = {
  editOutputOutcome: EditOutputOutcome | null;
  eventFact: TaskFailureEventFact | null;
  observationTranscript: ExplicitObservationTranscript | null;
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  structuredOutputZeroExitSuccess: boolean;
  summary: string;
  toolFamily: string | undefined;
};
type ObservationOrigin = TaskFailureObservationSyntax["origin"];
type ObservationSubject = TaskFailureObservationSyntax["subject"];
type ObservationSyntaxDetails = Partial<
  Pick<TaskFailureObservationSyntax, "diagnosticClass" | "evidenceLoss" | "recoveryHint">
> & { completeBoundary?: true };
type TaskFailureStructuredOutputEnvelope =
  | { kind: "unsupported" | "raw" | "invalid" }
  | { kind: "valid" | "recovered"; output: { exitCode?: number; output: string } };

export function readTaskFailureObservationSyntax(
  input: TaskFailureObservationGrammarInput,
): TaskFailureObservationSyntax | null {
  const { eventFact, summary, toolFamily } = input;
  if (eventFact !== null && eventFact !== "source_limit")
    return eventFactSyntax(eventFact, toolFamily);
  const boundedSource = syntaxObservation(
    readReadOutputPayloadObservation(summary, "complete_bounded"),
    "read_output",
    "source",
    toolFamily,
  );
  if (boundedSource !== null) return { ...boundedSource, completeBoundary: true };
  if (eventFact !== null) return eventFactSyntax(eventFact, toolFamily);
  if (input.observationTranscript)
    return transcriptObservation(input.observationTranscript, toolFamily);
  if (input.editOutputOutcome === "applied")
    return payloadSyntax("semantic_evidence", "tool", "high", toolFamily);
  const payloadObservationSyntax = readTaskFailurePayloadObservationSyntax(input);
  if (payloadObservationSyntax !== null) return payloadObservationSyntax;
  if (input.structuredOutputZeroExitSuccess) {
    return createTaskFailureObservationSyntax(
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

function eventFactSyntax(fact: TaskFailureEventFact, toolFamily?: string) {
  const source = ["source_limit", "source_diagnostic", "expected_source_diagnostic"].includes(fact);
  const diagnostic = source || fact === "runtime_diagnostic";
  const control = fact === "authorization_control";
  const payload = fact === "document_payload";
  return createTaskFailureObservationSyntax(
    control ? "control" : payload ? "payload" : diagnostic ? "diagnostic" : "outcome",
    control || payload ? "neutral" : fact === "terminal_success" ? "success" : "failure",
    control ? "status_text" : payload || source ? "read_output" : "command_output",
    control ? "tool" : payload ? "document" : source ? "source" : "command",
    fact === "runtime_diagnostic" || fact === "source_diagnostic"
      ? "high"
      : source || fact === "outcome_failure" || fact === "absent_failure"
        ? "medium"
        : "low",
    toolFamily,
    eventFactDetails(fact),
  );
}

function eventFactDetails(fact: TaskFailureEventFact): ObservationSyntaxDetails {
  if (fact === "authorization_control")
    return { completeBoundary: true, recoveryHint: "await_authorization" };
  if (fact === "runtime_diagnostic" || fact === "expected_source_diagnostic")
    return {
      completeBoundary: true,
      diagnosticClass: fact === "runtime_diagnostic" ? "runtime" : "expected",
      recoveryHint: "inspect_diagnostic",
    };
  if (fact === "source_diagnostic")
    return {
      completeBoundary: true,
      diagnosticClass: "runtime",
      recoveryHint: "inspect_diagnostic",
    };
  if (fact === "source_limit")
    return {
      completeBoundary: true,
      diagnosticClass: "source_limit",
      evidenceLoss: "partial",
      recoveryHint: "narrow_evidence_scope",
    };
  if (fact === "absent_failure")
    return { completeBoundary: true, evidenceLoss: "absent", recoveryHint: "request_evidence" };
  return { completeBoundary: true };
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

function payloadSyntax(
  origin: ObservationOrigin,
  subject: ObservationSubject,
  consequence: TaskFailureObservationSyntax["consequenceBaseline"],
  toolFamily?: string,
  details?: ObservationSyntaxDetails,
) {
  return createTaskFailureObservationSyntax(
    "payload",
    "neutral",
    origin,
    subject,
    consequence,
    toolFamily,
    details,
  );
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
        payload.completeBoundary === true ? { completeBoundary: true } : undefined,
      );
}
