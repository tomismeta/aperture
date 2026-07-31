import type { OfflineReviewFocusArea } from "./offline-review.js";
import type { SemanticReviewCandidateKind } from "./semantic-review-candidate-types.js";

export function baseScoreForCandidateKind(kind: SemanticReviewCandidateKind): number {
  switch (kind) {
    case "queue_decision":
      return 60;
    case "blocked_attention":
      return 55;
    case "semantic_uncertainty":
      return 50;
    case "routing_ambiguity":
      return 48;
    case "high_consequence_attention":
      return 45;
    case "failure_attention":
      return 40;
    case "relation_signal":
      return 32;
    case "tool_taxonomy_gap":
      return 25;
    case "missing_why_now":
      return 10;
  }
}

export function focusAreasForCandidateKind(
  kind: SemanticReviewCandidateKind,
): OfflineReviewFocusArea[] {
  switch (kind) {
    case "missing_why_now":
      return ["summary", "status", "intentFrame", "consequence", "confidence"];
    case "high_consequence_attention":
      return ["status", "intentFrame", "consequence", "confidence"];
    case "failure_attention":
      return ["status", "intentFrame", "toolFamily", "consequence"];
    case "blocked_attention":
      return ["status", "blocking", "intentFrame", "confidence"];
    case "queue_decision":
      return ["blocking", "episode", "confidence", "consequence"];
    case "semantic_uncertainty":
      return ["intentFrame", "blocking", "confidence", "source"];
    case "routing_ambiguity":
      return ["status", "blocking", "consequence", "confidence"];
    case "tool_taxonomy_gap":
      return ["toolFamily", "intentFrame", "consequence"];
    case "relation_signal":
      return ["episode", "status", "intentFrame", "source"];
  }
}

export function rationaleForCandidateKind(kind: SemanticReviewCandidateKind): string {
  switch (kind) {
    case "missing_why_now":
      return "Semantic interpretation lacks whyNow timing language; review only if the event should explain attention timing.";
    case "high_consequence_attention":
      return "High-consequence or now-lane attention should be checked for calibrated urgency.";
    case "failure_attention":
      return "Failure events are common corpus pressure points for consequence and status interpretation.";
    case "blocked_attention":
      return "Blocked-like wording/status should be checked for blocking-vs-waiting precision.";
    case "queue_decision":
      return "Queued decisions are rare in this corpus and should be inspected for routing correctness.";
    case "semantic_uncertainty":
      return "Lower confidence or abstention identifies language that may deserve semantic parser coverage.";
    case "routing_ambiguity":
      return "Planner ambiguity should be checked for calibrated queue-vs-ambient routing without conflating it with semantic parsing.";
    case "tool_taxonomy_gap":
      return "Unknown tool families point at importer or semantic taxonomy gaps.";
    case "relation_signal":
      return "Relation hints exercise continuity semantics and should be sampled for target accuracy.";
  }
}
