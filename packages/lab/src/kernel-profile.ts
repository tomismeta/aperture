import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "./artifact-versions.js";

export const KERNEL_PROFILE_ID = "aperture.kernel.profile.v2" as const;
export const KERNEL_PROFILE_VERSION = 2 as const;
export const KERNEL_REASON_CODE_GRAMMAR_VERSION = 1 as const;
export const KERNEL_CANONICALIZATION_VERSION = 1 as const;

export const KERNEL_PROFILE_SCENARIO_IDS = [
  "golden:kernel:activate-decision-record",
  "golden:kernel:ambient-decision-record",
  "golden:kernel:attention-decision-record",
  "golden:kernel:auto-approve-decision-record",
  "golden:kernel:current-frame-queue-decision-record",
  "golden:kernel:decorative-urgency-status-decision-record",
  "golden:kernel:low-confidence-failure-decision-record",
  "golden:kernel:resurfacing-continuity-decision-record",
] as const;

export const KERNEL_REQUIRED_SINGLETON_REASON_CODE_FAMILIES = [
  "route:",
  "lane:",
  "policy:minimum_lane:",
  "pressure:level:",
  "pressure:overload:",
  "evidence:operator_presence:",
  "evidence:current_frame:",
  "evidence:current_episode:",
] as const;

export const KERNEL_PROFILE = {
  id: KERNEL_PROFILE_ID,
  version: KERNEL_PROFILE_VERSION,
  decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
  reasonCodeGrammarVersion: KERNEL_REASON_CODE_GRAMMAR_VERSION,
  canonicalizationVersion: KERNEL_CANONICALIZATION_VERSION,
  scenarioIds: KERNEL_PROFILE_SCENARIO_IDS,
  requiredSingletonReasonCodeFamilies: KERNEL_REQUIRED_SINGLETON_REASON_CODE_FAMILIES,
} as const;
