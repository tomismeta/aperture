export type ObservationalStatusConflictKind =
  | "command_success_observation"
  | "structured_output_observation"
  | "payload_observation"
  | "search_output_observation"
  | "rejected_tool_use_observation";

export type ObservationalStatusConflictEvidence = {
  kind: ObservationalStatusConflictKind;
  toolFamily?: string;
  baselineConsequence: "low" | "medium" | "high";
};
