import { KERNEL_DECISION_RECORD_PROJECTION_VERSION } from "./artifact-versions.js";
import {
  KERNEL_CANONICALIZATION_VERSION,
  KERNEL_REASON_CODE_GRAMMAR_VERSION,
} from "./kernel-profile.js";

export const KERNEL_CORPUS_PROFILE_ID = "aperture.kernel.messy_event_corpus.v2" as const;
export const KERNEL_CORPUS_PROFILE_VERSION = 2 as const;

export const KERNEL_CORPUS_SCENARIO_IDS = [
  "golden:kernel-corpus:alarmist-read-approval-stays-low-risk",
  "golden:kernel-corpus:conflicting-relation-targets-queue-behind-current",
  "golden:kernel-corpus:interleaved-supersede-with-background-noise",
  "golden:kernel-corpus:metadata-heavy-status-noise-stays-ambient",
  "golden:kernel-corpus:resolution-after-active-failure-clears-focus",
  "golden:kernel-corpus:source-risk-outranks-low-confidence-hint",
  "golden:kernel-corpus:waiting-wording-blocked-under-absence",
] as const;

export const KERNEL_CORPUS_COVERAGE_DIMENSIONS = [
  {
    id: "source_fact_authority",
    scenarioIds: [
      "golden:kernel-corpus:alarmist-read-approval-stays-low-risk",
      "golden:kernel-corpus:source-risk-outranks-low-confidence-hint",
    ],
  },
  {
    id: "relation_target_conflict",
    scenarioIds: ["golden:kernel-corpus:conflicting-relation-targets-queue-behind-current"],
  },
  {
    id: "status_noise",
    scenarioIds: [
      "golden:kernel-corpus:metadata-heavy-status-noise-stays-ambient",
      "golden:kernel-corpus:interleaved-supersede-with-background-noise",
    ],
  },
  {
    id: "interleaved_lifecycle",
    scenarioIds: ["golden:kernel-corpus:interleaved-supersede-with-background-noise"],
  },
  {
    id: "episode_resolution",
    scenarioIds: ["golden:kernel-corpus:resolution-after-active-failure-clears-focus"],
  },
  {
    id: "operator_absence",
    scenarioIds: ["golden:kernel-corpus:waiting-wording-blocked-under-absence"],
  },
] as const;

export const KERNEL_CORPUS_PROFILE = {
  id: KERNEL_CORPUS_PROFILE_ID,
  version: KERNEL_CORPUS_PROFILE_VERSION,
  decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
  reasonCodeGrammarVersion: KERNEL_REASON_CODE_GRAMMAR_VERSION,
  canonicalizationVersion: KERNEL_CANONICALIZATION_VERSION,
  scenarioIds: KERNEL_CORPUS_SCENARIO_IDS,
  coverageDimensions: KERNEL_CORPUS_COVERAGE_DIMENSIONS,
} as const;
