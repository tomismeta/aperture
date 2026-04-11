import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { AUTORESEARCH_RUNNER_RUN_SCHEMA_VERSION } from "./artifact-versions.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import type {
  AutoresearchProposalCodeRecommendation,
  AutoresearchProposalIntentStatement,
  AutoresearchProposalSignal,
  AutoresearchProposalRunStatus,
} from "./autoresearch-proposal.js";
export { AUTORESEARCH_RUNNER_RUN_SCHEMA_VERSION } from "./artifact-versions.js";

export const DEFAULT_AUTORESEARCH_RUNNER_RESULTS_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "results",
  "autoresearch",
  "runner",
);
export const DEFAULT_AUTORESEARCH_RUNNER_RUNS_DIR = path.join(
  DEFAULT_AUTORESEARCH_RUNNER_RESULTS_DIR,
  "runs",
);

export type AutoresearchRunnerProposalSnapshot = {
  status: AutoresearchProposalRunStatus;
  summary: {
    actionableCount: number;
    selectedSignalCount: number;
    promotedCaseCount: number;
  };
  signals: ReadonlyArray<{
    signature: string;
    focusArea: AutoresearchProposalSignal["focusArea"];
    owner: AutoresearchProposalSignal["owner"];
    apertureValue: AutoresearchProposalSignal["apertureValue"];
    expectedValue: AutoresearchProposalSignal["expectedValue"];
    sessionCount: number;
    disagreementCount: number;
    targets: readonly string[];
    examples: readonly {
      sessionId: string;
      stepIndex: number;
      stepLabel?: string;
      confidence: AutoresearchProposalSignal["examples"][number]["confidence"];
      rationale?: string;
    }[];
  }>;
  optimizer?: {
    status: string;
    beforeMismatchCount: number;
    afterMismatchCount: number;
    beforeInvariantMismatchCount: number;
    afterInvariantMismatchCount: number;
    changedFiles: readonly string[];
    disallowedFiles: readonly string[];
    judgmentBattle?: boolean;
    releaseCheck?: boolean;
    patchPath?: string;
  };
  intentStatements: readonly AutoresearchProposalIntentStatement[];
  codeRecommendations: readonly AutoresearchProposalCodeRecommendation[];
};

export type AutoresearchRunnerRetainedOutcome =
  | "signal_only"
  | "no_change_no_edits"
  | "no_change_patch_attempted"
  | "gate_blocked"
  | "optimizer_clean"
  | "patch_ready";

export type AutoresearchRunnerFeedbackAttempt = {
  offset: number;
  limit: number;
  status: string;
  actionableCount?: number;
  selectedSignalCount?: number;
  promotedCaseCount?: number;
  optimizerStatus?: string;
  proposalPath?: string;
  batchReportPath?: string;
  optimizerRunPath?: string;
  optimizerPatchPath?: string;
  retainedOutcome?: AutoresearchRunnerRetainedOutcome;
  proposal?: AutoresearchRunnerProposalSnapshot;
};

export type AutoresearchRunnerRetainedAttempt = {
  offset: number;
  limit: number;
  status: string;
  actionableCount?: number;
  selectedSignalCount?: number;
  promotedCaseCount?: number;
  optimizerStatus?: string;
  retainedOutcome: AutoresearchRunnerRetainedOutcome;
  proposal?: string;
  batch?: string;
  optimizer?: string;
  patch?: string;
  snapshot: AutoresearchRunnerProposalSnapshot;
};

export type AutoresearchRunnerFeedback = {
  action: "proposal_ready" | "no_proposal" | "blocked" | "exhausted";
  summary: string;
  reasons: string[];
  commandsRun: string[];
  attempts: AutoresearchRunnerFeedbackAttempt[];
  selectedProposalPath?: string;
  selectedBatchReportPath?: string;
  selectedOptimizerRunPath?: string;
  selectedPatchPath?: string;
  recommendedNextStep?: string;
};

export type AutoresearchRunnerRunStatus =
  | "proposal_ready"
  | "no_proposal"
  | "blocked"
  | "exhausted"
  | "invalid";

export type AutoresearchRunnerRun = {
  schemaVersion: typeof AUTORESEARCH_RUNNER_RUN_SCHEMA_VERSION;
  generatedAt: string;
  provider: string;
  runnerCommand: string;
  status: AutoresearchRunnerRunStatus;
  artifacts: {
    selectedProposalPath?: string;
    selectedBatchReportPath?: string;
    selectedOptimizerRunPath?: string;
    selectedPatchPath?: string;
    backlogPath?: string;
    backlogMarkdownPath?: string;
  };
  selectedProposal?: AutoresearchRunnerProposalSnapshot;
  retainedAttempts?: readonly AutoresearchRunnerRetainedAttempt[];
  feedback?: AutoresearchRunnerFeedback;
  notes: string[];
};

export function defaultAutoresearchRunnerRunPath(
  generatedAt: string,
  directory = DEFAULT_AUTORESEARCH_RUNNER_RUNS_DIR,
): string {
  return path.join(directory, `autoresearch-runner-run-${safeTimestamp(generatedAt)}.json`);
}

export async function writeAutoresearchRunnerRun(
  filePath: string,
  run: AutoresearchRunnerRun,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
}

export function renderAutoresearchRunnerRunMarkdown(run: AutoresearchRunnerRun): string {
  const lines: string[] = [
    "# Aperture Lab F-Stop Run",
    "",
    `Generated: ${run.generatedAt}`,
    `Provider: ${run.provider}`,
    `Status: ${run.status}`,
    `Execution: ${run.runnerCommand}`,
    "",
    "## Artifacts",
    "",
  ];

  if (run.artifacts.selectedProposalPath) {
    lines.push(`- selected proposal: ${run.artifacts.selectedProposalPath}`);
  }
  if (run.artifacts.selectedBatchReportPath) {
    lines.push(`- selected batch report: ${run.artifacts.selectedBatchReportPath}`);
  }
  if (run.artifacts.selectedOptimizerRunPath) {
    lines.push(`- selected optimizer run: ${run.artifacts.selectedOptimizerRunPath}`);
  }
  if (run.artifacts.selectedPatchPath) {
    lines.push(`- selected patch: ${run.artifacts.selectedPatchPath}`);
  }
  if (run.artifacts.backlogPath) {
    lines.push(`- retained backlog: ${run.artifacts.backlogPath}`);
  }
  if (run.artifacts.backlogMarkdownPath) {
    lines.push(`- retained backlog markdown: ${run.artifacts.backlogMarkdownPath}`);
  }

  if (run.feedback) {
    lines.push("", "## Feedback", "");
    lines.push(`- action: ${run.feedback.action}`);
    lines.push(`- summary: ${run.feedback.summary}`);
    if (run.feedback.reasons.length > 0) {
      lines.push(...run.feedback.reasons.map((entry) => `- reason: ${entry}`));
    }
    if (run.feedback.commandsRun.length > 0) {
      lines.push("", "## Commands", "");
      lines.push(...run.feedback.commandsRun.map((command) => `- ${command}`));
    }
    if (run.feedback.attempts.length > 0) {
      lines.push("", "## Attempts", "");
      for (const attempt of run.feedback.attempts) {
        lines.push(`- offset ${attempt.offset}, limit ${attempt.limit}: ${attempt.status}`);
        if (attempt.proposalPath) {
          lines.push(`  proposal: ${attempt.proposalPath}`);
        }
        if (attempt.batchReportPath) {
          lines.push(`  batch: ${attempt.batchReportPath}`);
        }
        if (attempt.optimizerRunPath) {
          lines.push(`  optimizer: ${attempt.optimizerRunPath}`);
        }
        if (attempt.optimizerPatchPath) {
          lines.push(`  patch: ${attempt.optimizerPatchPath}`);
        }
      }
    }
    if (run.feedback.recommendedNextStep) {
      lines.push("", "## Recommended Next Step", "", `- ${run.feedback.recommendedNextStep}`);
    }
  }

  if (run.selectedProposal) {
    const selectedHeading =
      run.status === "proposal_ready" ? "## Selected Proposal" : "## Retained Intent";
    lines.push("", selectedHeading, "");
    lines.push(`- status: ${run.selectedProposal.status}`);
    lines.push(`- actionable disagreements: ${run.selectedProposal.summary.actionableCount}`);
    lines.push(`- selected signals: ${run.selectedProposal.summary.selectedSignalCount}`);
    lines.push(`- promoted cases: ${run.selectedProposal.summary.promotedCaseCount}`);

    lines.push("", "## Intent Statements", "");
    if (run.selectedProposal.intentStatements.length === 0) {
      lines.push("- (none)");
    } else {
      for (const intent of run.selectedProposal.intentStatements) {
        lines.push(`- ${intent.statement}`);
        if (intent.targets.length > 0) {
          lines.push(`  targets: ${intent.targets.join(", ")}`);
        }
      }
    }

    lines.push("", "## Code Recommendations", "");
    if (run.selectedProposal.codeRecommendations.length === 0) {
      lines.push("- (none)");
    } else {
      for (const recommendation of run.selectedProposal.codeRecommendations) {
        lines.push(`- ${recommendation.summary}`);
        if (recommendation.recommendedFiles.length > 0) {
          lines.push(`  files: ${recommendation.recommendedFiles.join(", ")}`);
        }
        if (recommendation.patchPath) {
          lines.push(`  patch: ${recommendation.patchPath}`);
        }
      }
    }
  }

  if (run.retainedAttempts && run.retainedAttempts.length > 0) {
    lines.push("", "## Retained Attempts", "");
    for (const attempt of run.retainedAttempts) {
      lines.push(
        `- offset ${attempt.offset}, limit ${attempt.limit}: ${attempt.status} (${attempt.retainedOutcome})`,
      );
      if (attempt.actionableCount !== undefined) {
        lines.push(`  actionable: ${attempt.actionableCount}`);
      }
      if (attempt.selectedSignalCount !== undefined) {
        lines.push(`  signals: ${attempt.selectedSignalCount}`);
      }
      if (attempt.promotedCaseCount !== undefined) {
        lines.push(`  promoted: ${attempt.promotedCaseCount}`);
      }
      const strongestSignal = attempt.snapshot.signals[0];
      if (strongestSignal) {
        lines.push(
          `  strongest signal: ${strongestSignal.focusArea} (${strongestSignal.owner}) ${renderValue(strongestSignal.apertureValue)} -> ${renderValue(strongestSignal.expectedValue)} across ${strongestSignal.sessionCount} session(s)`,
        );
      }
      if (attempt.snapshot.intentStatements[0]) {
        lines.push(`  intent: ${attempt.snapshot.intentStatements[0].statement}`);
      }
      if (attempt.snapshot.optimizer) {
        lines.push(
          `  optimizer: ${attempt.snapshot.optimizer.status} mismatches ${attempt.snapshot.optimizer.beforeMismatchCount} -> ${attempt.snapshot.optimizer.afterMismatchCount}`,
        );
      }
      if (attempt.patch) {
        lines.push(`  patch: ${attempt.patch}`);
      }
    }
  }

  if (run.notes.length > 0) {
    lines.push("", "## Notes", "");
    lines.push(...run.notes.map((entry) => `- ${entry}`));
  }

  return `${lines.join("\n")}\n`;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function renderValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value === null) {
    return "null";
  }
  return value;
}
