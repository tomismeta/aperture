import type { ObservationSemantics } from "./observation-semantics.js";
import {
  type PayloadSyntaxObservation,
  readCommandOutputPayloadObservation,
  readReadOutputPayloadObservation,
  readStructuredOutputPayloadObservation,
} from "./semantic-payload-observation-shapes.js";
import type { TaskFailureStructuredOutputEnvelope } from "./semantic-task-failure-structured-output.js";
import { isSemanticCommandExecutionToolFamily } from "./semantic-tool-family.js";

type TaskFailurePayloadObservationGrammarInput = {
  summary: string;
  structuredOutputEnvelope: TaskFailureStructuredOutputEnvelope;
  toolFamily: string | undefined;
};

type ObservationOrigin = ObservationSemantics["provenance"]["origin"];
type ObservationSubject = ObservationSemantics["subject"];

export type TaskFailurePayloadObservationSyntax = {
  origin: ObservationOrigin;
  fallbackSubject: ObservationSubject;
  payload: PayloadSyntaxObservation;
  toolFamily?: string;
};

export function readTaskFailurePayloadObservationSyntax(
  input: TaskFailurePayloadObservationGrammarInput,
): TaskFailurePayloadObservationSyntax | null {
  if (input.toolFamily === "read") {
    const readObservation = syntaxObservation(
      readReadOutputPayloadObservation(input.summary),
      "read_output",
      "document",
      "read",
    );
    if (readObservation !== null) {
      return readObservation;
    }
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
  if (envelope.kind !== "valid" && envelope.kind !== "recovered") {
    return null;
  }

  const output = envelope.output;
  return syntaxObservation(
    readStructuredOutputPayloadObservation({
      commandExecutionToolFamily: isSemanticCommandExecutionToolFamily(input.toolFamily),
      exitCode: output.exitCode,
      output: output.output,
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
  if (payload === null) {
    return null;
  }

  return {
    origin,
    fallbackSubject,
    payload,
    ...(toolFamily !== undefined ? { toolFamily } : {}),
  };
}
