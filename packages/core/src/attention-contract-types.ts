export type AttentionConsequenceLevel = "low" | "medium" | "high";

export type AttentionActivityClass =
  | "permission_request"
  | "question_request"
  | "follow_up"
  | "result_ready"
  | "tool_completion"
  | "tool_failure"
  | "session_status"
  | "status_update";
