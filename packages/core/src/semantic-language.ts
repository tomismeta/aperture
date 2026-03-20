import type { AttentionActivityClass } from "./events.js";
import type { AttentionConsequenceLevel } from "./frame.js";
import type { SemanticIntentFrame } from "./semantic-types.js";

export function semanticIntentFrameForRequestKind(
  kind: "approval" | "choice" | "form",
): SemanticIntentFrame {
  switch (kind) {
    case "approval":
      return "approval_request";
    case "choice":
      return "question_request";
    case "form":
      return "form_request";
  }
}

export function semanticActivityClassForRequestKind(
  kind: "approval" | "choice" | "form",
): AttentionActivityClass {
  switch (kind) {
    case "approval":
      return "permission_request";
    case "choice":
    case "form":
      return "question_request";
  }
}

export function semanticWhyNowForRequestKind(
  kind: "approval" | "choice" | "form",
  consequence: AttentionConsequenceLevel,
): string {
  switch (kind) {
    case "approval":
      return consequence === "high"
        ? "A high-risk action needs explicit operator approval."
        : "Approval is required before work can continue.";
    case "choice":
      return "A decision is required before work can continue.";
    case "form":
      return "Additional input is required before work can continue.";
  }
}

export function semanticWhyNowForTaskStatus(
  status: "running" | "blocked" | "waiting" | "completed" | "failed",
  options?: { impliedAsk?: boolean; wasCancelled?: boolean },
): string | undefined {
  if (options?.wasCancelled) {
    return "Work was cancelled and may need review.";
  }

  switch (status) {
    case "failed":
      return "Work has failed and should be reviewed.";
    case "blocked":
      return "Work is blocked and may require operator attention.";
    case "running":
    case "waiting":
    case "completed":
      return options?.impliedAsk ? "Status text implies the operator may need to respond." : undefined;
  }
}

export function semanticReasonsForTaskStatus(
  status: "running" | "blocked" | "waiting" | "completed" | "failed",
  options?: { impliedAsk?: boolean; wasCancelled?: boolean },
): string[] {
  if (options?.wasCancelled) {
    return ["task cancellation is an explicit lifecycle fact"];
  }

  switch (status) {
    case "failed":
      return ["task status explicitly indicates failure"];
    case "blocked":
      return ["task status explicitly indicates blocked work"];
    case "running":
    case "waiting":
    case "completed":
      return options?.impliedAsk
        ? ["status wording suggests an implied operator request"]
        : ["task update carries a non-blocking lifecycle status"];
  }
}

export function semanticReasonsForLifecycle(
  type: "task_started" | "completion",
): string[] {
  switch (type) {
    case "task_started":
      return ["task start is an explicit lifecycle fact"];
    case "completion":
      return ["task completion is an explicit lifecycle fact"];
  }
}
