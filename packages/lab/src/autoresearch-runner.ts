import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";
import type {
  AutoresearchProposalCodeRecommendation,
  AutoresearchProposalIntentStatement,
  AutoresearchProposalRunStatus,
} from "./autoresearch-proposal.js";

export const AUTORESEARCH_RUNNER_RUN_SCHEMA_VERSION = 1 as const;

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
};

export type AutoresearchRunnerFeedback = {
  action: "proposal_ready" | "no_proposal" | "blocked";
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

export type AutoresearchRunnerRunStatus = "proposal_ready" | "no_proposal" | "blocked" | "invalid";

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
  };
  selectedProposal?: {
    status: AutoresearchProposalRunStatus;
    summary: {
      actionableCount: number;
      selectedSignalCount: number;
      promotedCaseCount: number;
    };
    intentStatements: readonly AutoresearchProposalIntentStatement[];
    codeRecommendations: readonly AutoresearchProposalCodeRecommendation[];
  };
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

export function renderAutoresearchRunnerRunMarkdown(
  run: AutoresearchRunnerRun,
): string {
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
      lines.push("", "## Batches", "");
      for (const attempt of run.feedback.attempts) {
        lines.push(`- batch offset ${attempt.offset}, size ${attempt.limit}: ${attempt.status}`);
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
    lines.push("", "## Selected Proposal", "");
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

  if (run.notes.length > 0) {
    lines.push("", "## Notes", "");
    lines.push(...run.notes.map((entry) => `- ${entry}`));
  }

  return `${lines.join("\n")}\n`;
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}
