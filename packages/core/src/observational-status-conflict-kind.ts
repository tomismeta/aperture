import type { TaskFailureEvidenceKind } from "./semantic-evidence.js";
import type { ObservationalStatusConflictKind } from "./observational-status-conflict.js";

export function readObservationalStatusConflictKind(
  kind: TaskFailureEvidenceKind,
): ObservationalStatusConflictKind | null {
  switch (kind) {
    case "routine_bash_success_observation":
      return "command_success_observation";
    case "structured_execution_success_observation":
      return "execution_success_observation";
    case "operation_success_observation":
    case "observational_payload":
      return "payload_observation";
    case "structured_tool_output_observation":
      return "structured_output_observation";
    case "routine_search_output":
      return "search_output_observation";
    case "rejected_tool_use_observation":
      return "rejected_tool_use_observation";
    case "empty_failure_payload":
    case "expected_diagnostic_failure":
    case "terminal_failure":
    case "unclassified_failure":
      return null;
  }
}
