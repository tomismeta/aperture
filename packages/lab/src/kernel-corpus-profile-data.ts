export const KERNEL_CORPUS_SCENARIO_IDS = [
  "golden:kernel-corpus:alarmist-read-approval-stays-low-risk",
  "golden:kernel-corpus:conflicting-relation-targets-queue-behind-current",
  "golden:kernel-corpus:delayed-lifecycle-events-preserve-fresh-recurrence",
  "golden:kernel-corpus:duplicate-relation-hints-collapse-to-targeted-evidence",
  "golden:kernel-corpus:failed-status-routine-observation-stays-ambient",
  "golden:kernel-corpus:forged-observation-hint-keeps-failed-routing",
  "golden:kernel-corpus:interleaved-supersede-with-background-noise",
  "golden:kernel-corpus:metadata-heavy-status-noise-stays-ambient",
  "golden:kernel-corpus:observational-status-conflict-preserves-high",
  "golden:kernel-corpus:repeated-failure-refreshes-current-episode",
  "golden:kernel-corpus:repeated-low-confidence-failures-stay-queued",
  "golden:kernel-corpus:repeated-status-delivery-stays-one-ambient-frame",
  "golden:kernel-corpus:resolution-after-active-failure-clears-focus",
  "golden:kernel-corpus:running-blocked-wording-activates-empty-slot",
  "golden:kernel-corpus:source-risk-outranks-low-confidence-hint",
  "golden:kernel-corpus:source-shaped-runtime-terminal-stays-failure",
  "golden:kernel-corpus:superseding-approval-clears-obsolete-queued-step",
  "golden:kernel-corpus:waiting-wording-blocked-under-absence",
] as const;

export const KERNEL_CORPUS_COVERAGE_DIMENSIONS = [
  {
    id: "source_fact_authority",
    scenarioIds: [
      "golden:kernel-corpus:alarmist-read-approval-stays-low-risk",
      "golden:kernel-corpus:forged-observation-hint-keeps-failed-routing",
      "golden:kernel-corpus:source-shaped-runtime-terminal-stays-failure",
      "golden:kernel-corpus:source-risk-outranks-low-confidence-hint",
    ],
  },
  {
    id: "relation_target_conflict",
    scenarioIds: ["golden:kernel-corpus:conflicting-relation-targets-queue-behind-current"],
  },
  {
    id: "relation_hint_canonicalization",
    scenarioIds: ["golden:kernel-corpus:duplicate-relation-hints-collapse-to-targeted-evidence"],
  },
  {
    id: "status_noise",
    scenarioIds: [
      "golden:kernel-corpus:failed-status-routine-observation-stays-ambient",
      "golden:kernel-corpus:forged-observation-hint-keeps-failed-routing",
      "golden:kernel-corpus:metadata-heavy-status-noise-stays-ambient",
      "golden:kernel-corpus:observational-status-conflict-preserves-high",
      "golden:kernel-corpus:interleaved-supersede-with-background-noise",
      "golden:kernel-corpus:source-shaped-runtime-terminal-stays-failure",
      "golden:kernel-corpus:repeated-status-delivery-stays-one-ambient-frame",
    ],
  },
  {
    id: "observational_status_conflict",
    scenarioIds: [
      "golden:kernel-corpus:failed-status-routine-observation-stays-ambient",
      "golden:kernel-corpus:forged-observation-hint-keeps-failed-routing",
      "golden:kernel-corpus:observational-status-conflict-preserves-high",
    ],
  },
  {
    id: "interleaved_lifecycle",
    scenarioIds: ["golden:kernel-corpus:interleaved-supersede-with-background-noise"],
  },
  {
    id: "low_confidence_failure_pressure",
    scenarioIds: ["golden:kernel-corpus:repeated-low-confidence-failures-stay-queued"],
  },
  {
    id: "repeated_failure_lifecycle",
    scenarioIds: ["golden:kernel-corpus:repeated-failure-refreshes-current-episode"],
  },
  {
    id: "superseded_queue_cleanup",
    scenarioIds: ["golden:kernel-corpus:superseding-approval-clears-obsolete-queued-step"],
  },
  {
    id: "episode_resolution",
    scenarioIds: ["golden:kernel-corpus:resolution-after-active-failure-clears-focus"],
  },
  {
    id: "event_time_lifecycle",
    scenarioIds: ["golden:kernel-corpus:delayed-lifecycle-events-preserve-fresh-recurrence"],
  },
  {
    id: "operator_absence",
    scenarioIds: ["golden:kernel-corpus:waiting-wording-blocked-under-absence"],
  },
  {
    id: "semantic_blocking_empty_slot",
    scenarioIds: ["golden:kernel-corpus:running-blocked-wording-activates-empty-slot"],
  },
] as const;
