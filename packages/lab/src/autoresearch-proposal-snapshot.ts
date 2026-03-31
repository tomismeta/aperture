import type { AutoresearchProposalRun } from "./autoresearch-proposal.js";
import type { AutoresearchRunnerProposalSnapshot } from "./autoresearch-runner.js";

export function projectAutoresearchProposalSnapshot(
  proposalRun: AutoresearchProposalRun,
): AutoresearchRunnerProposalSnapshot {
  return {
    status: proposalRun.status,
    summary: {
      actionableCount: proposalRun.summary.actionableCount,
      selectedSignalCount: proposalRun.summary.selectedSignalCount,
      promotedCaseCount: proposalRun.summary.promotedCaseCount,
    },
    signals: proposalRun.signals.slice(0, 5).map((signal) => ({
      signature: signal.signature,
      focusArea: signal.focusArea,
      owner: signal.owner,
      apertureValue: signal.apertureValue,
      expectedValue: signal.expectedValue,
      sessionCount: signal.sessionCount,
      disagreementCount: signal.disagreementCount,
      targets: signal.targets,
      examples: signal.examples.slice(0, 3).map((example) => ({
        sessionId: example.sessionId,
        stepIndex: example.stepIndex,
        ...(example.stepLabel ? { stepLabel: example.stepLabel } : {}),
        confidence: example.confidence,
        ...(example.rationale ? { rationale: example.rationale } : {}),
      })),
    })),
    ...(proposalRun.optimizer
      ? {
          optimizer: {
            status: proposalRun.optimizer.status,
            beforeMismatchCount: proposalRun.optimizer.beforeMismatchCount,
            afterMismatchCount: proposalRun.optimizer.afterMismatchCount,
            beforeInvariantMismatchCount: proposalRun.optimizer.beforeInvariantMismatchCount,
            afterInvariantMismatchCount: proposalRun.optimizer.afterInvariantMismatchCount,
            changedFiles: proposalRun.optimizer.changedFiles,
            disallowedFiles: proposalRun.optimizer.disallowedFiles,
            ...(proposalRun.optimizer.judgmentBattle !== undefined
              ? { judgmentBattle: proposalRun.optimizer.judgmentBattle }
              : {}),
            ...(proposalRun.optimizer.releaseCheck !== undefined
              ? { releaseCheck: proposalRun.optimizer.releaseCheck }
              : {}),
            ...(proposalRun.optimizer.patchPath
              ? { patchPath: proposalRun.optimizer.patchPath }
              : {}),
          },
        }
      : {}),
    intentStatements: proposalRun.intentStatements,
    codeRecommendations: proposalRun.codeRecommendations,
  };
}
