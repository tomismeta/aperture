import { readBoundedToolFamily } from "../interaction-taxonomy.js";
import type { AttentionCandidate } from "../interaction-candidate.js";
import type { JudgmentConfig } from "../judgment-config.js";
import type { AttentionPresentationFloor } from "../attention-policy.js";
import type { AttentionActivityClass } from "../events.js";

export function matchPolicyRule(
  judgmentConfig: JudgmentConfig | undefined,
  candidate: AttentionCandidate,
) {
  const policy = judgmentConfig?.policy;
  if (!policy) {
    return undefined;
  }

  const tags = policyTagsForCandidate(candidate);
  for (const tag of tags) {
    const rule = policy[tag];
    if (rule) {
      return rule;
    }
  }

  return undefined;
}

export function readAttentionPresentationFloor(value: unknown): AttentionPresentationFloor | undefined {
  switch (value) {
    case "ambient":
    case "queue":
    case "active":
      return value;
    default:
      return undefined;
  }
}

export function inferConfiguredPolicyToolFamily(candidate: AttentionCandidate): string | null {
  if (!isToolPolicyCandidate(candidate)) {
    return null;
  }

  return readBoundedToolFamily(candidate);
}

function policyTagsForCandidate(candidate: AttentionCandidate): string[] {
  const tags: string[] = [];
  if (!isToolPolicyCandidate(candidate)) {
    return tags;
  }

  const toolFamily = inferConfiguredPolicyToolFamily(candidate);
  const value = [
    candidate.title,
    candidate.summary ?? "",
    ...(candidate.context?.items?.flatMap((item) => [item.label, item.value ?? ""]) ?? []),
  ]
    .join(" ")
    .toLowerCase();

  if (candidate.consequence === "low" && toolFamily === "read") {
    tags.push("lowRiskRead");
  }

  if (candidate.consequence === "low" && toolFamily === "web") {
    tags.push("lowRiskWeb");
  }

  if (value.includes(".env") && (toolFamily === "write" || toolFamily === "edit" || toolFamily === "bash")) {
    tags.push("envWrite");
  }

  if (toolFamily === "write" || toolFamily === "edit") {
    tags.push("fileWrite");
  }

  if (toolFamily === "bash" && candidate.consequence === "high") {
    tags.push("destructiveBash");
  }

  return tags;
}

function isToolPolicyCandidate(candidate: AttentionCandidate): boolean {
  if (candidate.activityClass !== undefined) {
    return isToolPolicyActivity(candidate.activityClass);
  }

  return candidate.mode === "approval";
}

function isToolPolicyActivity(activityClass: AttentionActivityClass): boolean {
  switch (activityClass) {
    case "permission_request":
      return true;
    case "question_request":
    case "follow_up":
    case "tool_completion":
    case "tool_failure":
    case "session_status":
    case "status_update":
      return false;
    default: {
      const exhaustive: never = activityClass;
      return exhaustive;
    }
  }
}
