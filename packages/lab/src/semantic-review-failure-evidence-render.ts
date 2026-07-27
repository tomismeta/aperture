import type { SemanticReviewCandidateReport } from "./semantic-review-candidate-types.js";
import { SEMANTIC_REVIEW_TASK_FAILURE_EVIDENCE_KINDS } from "./semantic-review-failure-evidence-types.js";

export function renderFailureEvidenceMarkdown(report: SemanticReviewCandidateReport): string[] {
  return [
    "## Failed Task Evidence",
    "",
    `Failed task updates: ${formatCount(report.summary.failedTaskEvidence.failedTaskUpdateCount)}`,
    `Reads as observation: ${formatCount(report.summary.failedTaskEvidence.readsAsObservationCount)}`,
    `Missing tool family: ${formatCount(report.summary.failedTaskEvidence.missingToolFamilyCount)}`,
    `Consequence baselines: low=${formatCount(report.summary.failedTaskEvidence.consequenceBaselineCounts.low)}, medium=${formatCount(report.summary.failedTaskEvidence.consequenceBaselineCounts.medium)}, high=${formatCount(report.summary.failedTaskEvidence.consequenceBaselineCounts.high)}`,
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
    "### Examples",
    "",
    ...renderFailureEvidenceExamples(report),
  ];
}

function renderToolFamilyCounts(report: SemanticReviewCandidateReport): string[] {
  const entries = Object.entries(report.summary.failedTaskEvidence.countsByToolFamily);
  if (entries.length === 0) {
    return ["- (none)"];
  }

  return entries.map(([toolFamily, count]) => `- ${toolFamily}: ${formatCount(count)}`);
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
      lines.push(
        `  evidence: tool=${example.evidence.toolFamily ?? "none"}, observation=${String(example.evidence.readsAsObservation)}, baseline=${example.evidence.consequenceBaseline}`,
      );
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
