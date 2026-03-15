export const APERTURE_STATE_SCHEMA_VERSION = 1;
export const MARKDOWN_SCHEMA_VERSION = APERTURE_STATE_SCHEMA_VERSION;

export const JUDGMENT_DEFAULTS = {
  ambiguity: {
    nonBlockingActivationThreshold: 180,
    promotionMargin: 20,
  },
  queuePlanner: {
    minimumDwellMs: 30_000,
    streamContinuityMargin: 20,
    conflictingInterruptMargin: 10,
    statusBurstWindowMs: 60_000,
    urgentBacklogWindowMs: 90_000,
    deferredEscalationThreshold: 3,
    returnedEscalationThreshold: 2,
    escalationScoreSlack: 10,
    highContextQueueMargin: 8,
    mediumContextQueueMargin: 4,
    actionableEpisodeEvidenceThreshold: 4,
    actionableEpisodeScoreSlack: 15,
  },
  pressureForecast: {
    visibleInterruptiveBoost: {
      elevatedCount: 1,
      highCount: 2,
    },
    recentDemand: {
      elevatedCount: 5,
      highCount: 8,
    },
    responseLatencyMs: {
      elevated: 8_000,
      high: 15_000,
    },
    deferredPressure: {
      elevatedSuppressedCount: 1,
      highSuppressedCount: 2,
      elevatedDeferredCount: 2,
      highDeferredCount: 4,
    },
    slowClearance: {
      presentedCount: 4,
      responseRate: 0.3,
    },
    scoreBands: {
      elevatedLevel: 2,
      highLevel: 5,
      risingRisk: 3,
      highRisk: 6,
    },
  },
  attentionBudget: {
    thresholdOffset: {
      elevated: 6,
      high: 12,
    },
    recentDecisions: {
      elevatedCount: 4,
      highCount: 8,
    },
    responseLatencyMs: {
      elevated: 8_000,
      high: 15_000,
    },
    deferredCount: {
      elevated: 2,
      high: 4,
    },
    interruptiveVisible: {
      elevated: 1,
      high: 2,
    },
    scoreBands: {
      elevatedScore: 2,
      highScore: 5,
    },
  },
  episodeEvidence: {
    blockingBoost: 4,
    recurringEpisodeBoost: 1,
    persistentEpisodeBoost: 1,
    highSignalBoost: 2,
    multiModeBoost: 1,
    stackingBoost: 1,
    actionableThreshold: 4,
  },
} as const;
