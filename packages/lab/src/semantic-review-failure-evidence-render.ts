import type { SemanticReviewCandidateReport } from "./semantic-review-candidate-types.js";
import {
  renderEvidenceLossExamples,
  renderParserGapCandidateExamples,
} from "./semantic-review-failure-evidence-compact-render.js";
import { SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS } from "./semantic-review-failure-evidence-types.js";

export function renderFailureEvidenceMarkdown(report: SemanticReviewCandidateReport): string[] {
  return [
    "## Failed Task Evidence",
    "",
    `Failed task updates: ${formatCount(report.summary.failedTaskEvidence.failedTaskUpdateCount)}`,
    `Reads as observation: ${formatCount(report.summary.failedTaskEvidence.readsAsObservationCount)}`,
    `Missing tool family: ${formatCount(report.summary.failedTaskEvidence.missingToolFamilyCount)}`,
    `Consequence baselines: low=${formatCount(report.summary.failedTaskEvidence.consequenceBaselineCounts.low)}, medium=${formatCount(report.summary.failedTaskEvidence.consequenceBaselineCounts.medium)}, high=${formatCount(report.summary.failedTaskEvidence.consequenceBaselineCounts.high)}`,
    `Failure detail: outcome_only=${formatCount(report.summary.failedTaskEvidence.failureDetailCounts.outcome_only)}, diagnostic=${formatCount(report.summary.failedTaskEvidence.failureDetailCounts.diagnostic)}, indeterminate=${formatCount(report.summary.failedTaskEvidence.failureDetailCounts.indeterminate)}, absent_evidence=${formatCount(report.summary.failedTaskEvidence.failureDetailCounts.absent_evidence)}, source_window_limit=${formatCount(report.summary.failedTaskEvidence.failureDetailCounts.source_window_limit)}`,
    "",
    "### By Kind",
    "",
    ...SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS.map(
      (kind) =>
        `- ${kind}: count=${formatCount(report.summary.failedTaskEvidence.countsByKind[kind])}, retained=${formatCount(report.summary.failedTaskEvidence.retainedExamplesByKind[kind].length)}`,
    ),
    "",
    "### By Tool Family",
    "",
    ...renderToolFamilyCounts(report),
    "",
    "### Parser Gap Candidate Event Shapes",
    "",
    ...renderParserGapCandidateEventShapeCounts(report),
    "",
    "### Evidence Loss Signals",
    "",
    ...renderEvidenceLossCounts(report),
    "",
    "### Parser Gap Candidate Examples",
    "",
    ...renderParserGapCandidateExamples(report),
    "",
    "### Evidence Loss Examples",
    "",
    ...renderEvidenceLossExamples(report),
    "",
    "### Examples",
    "",
    ...renderFailureEvidenceExamples(report),
  ];
}

function renderToolFamilyCounts(report: SemanticReviewCandidateReport): string[] {
  const entries = Object.entries(report.summary.failedTaskEvidence.countsByToolFamily);
  return entries.length === 0
    ? ["- (none)"]
    : entries.map(([toolFamily, count]) => `- ${toolFamily}: ${formatCount(count)}`);
}

function renderParserGapCandidateEventShapeCounts(report: SemanticReviewCandidateReport): string[] {
  const entries = Object.entries(
    report.summary.failedTaskEvidence.parserGapCandidateEventShapeCounts,
  );
  return entries.length === 0
    ? ["- (none)"]
    : entries.map(([shape, count]) => `- ${shape}: ${formatCount(count)}`);
}

function renderEvidenceLossCounts(report: SemanticReviewCandidateReport): string[] {
  const entries = Object.entries(report.summary.failedTaskEvidence.evidenceLossCounts).filter(
    ([, count]) => count > 0,
  );
  return entries.length === 0
    ? ["- (none)"]
    : entries.map(([kind, count]) => `- ${kind}: ${formatCount(count)}`);
}

function renderFailureEvidenceExamples(report: SemanticReviewCandidateReport): string[] {
  const lines: string[] = [];

  for (const kind of SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS) {
    lines.push(`#### ${kind}`, "");
    const examples = report.summary.failedTaskEvidence.retainedExamplesByKind[kind];
    if (examples.length === 0) {
      lines.push("- (none)", "");
      continue;
    }

    for (const example of examples) {
      lines.push(`- ${example.bundlePath}#step-${example.stepIndex}`);
      lines.push(`  session: ${example.sessionId}`);
      lines.push(`  title: ${example.title}`);
      if (example.stepLabel) {
        lines.push(`  step: ${example.stepLabel}`);
      }
      const terminalShape = example.evidence.terminalShape
        ? `, terminalShape=${example.evidence.terminalShape}`
        : "";
      const failureDetail = example.evidence.failureDetail
        ? `, detail=${example.evidence.failureDetail}`
        : "";
      lines.push(
        `  evidence: tool=${example.evidence.toolFamily ?? "none"}, observation=${String(example.evidence.readsAsObservation)}, baseline=${example.evidence.consequenceBaseline}${failureDetail}${terminalShape}`,
      );
      lines.push(`  shape: ${example.eventShape}`);
      lines.push(
        `  semantic: intent=${example.semantic.intentFrame ?? "none"}, activity=${example.semantic.activityClass ?? "none"}, tool=${example.semantic.toolFamily ?? "none"}, consequence=${example.semantic.consequence ?? "none"}, confidence=${example.semantic.confidence ?? "none"}`,
      );
      lines.push(
        `  judgment: kind=${example.judgment.decisionKind ?? "none"}, planned=${example.judgment.plannedLane ?? "none"}, result=${example.judgment.resultLane ?? "none"}`,
      );
    }
    lines.push("");
  }

  return lines;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
