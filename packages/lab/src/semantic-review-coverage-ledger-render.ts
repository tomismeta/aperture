import type { SemanticReviewCandidateReport } from "./semantic-review-candidate-types.js";
import type { SemanticReviewNoveltySummary } from "./semantic-review-coverage-ledger-types.js";

export function renderCoverageLedgerMarkdown(report: SemanticReviewCandidateReport): string[] {
  const coverage = report.coverage;
  return [
    "## Engine Coverage",
    "",
    `Shape schema: ${coverage.shapeSchemaVersion}`,
    `Profile: ${coverage.baseline.profileId}@${coverage.baseline.profileVersion}`,
    `Profile digest: ${coverage.baseline.profileDigest}`,
    `Signature set digest: ${coverage.baseline.signatureSetDigest ?? "none"}`,
    `Authority: ${coverage.baseline.authority}`,
    `Observed steps: ${formatCount(coverage.observations.stepCount)}`,
    `Semantic comparable: ${formatCount(coverage.observations.semanticComparableCount)}`,
    `Judgment comparable: ${formatCount(coverage.observations.judgmentComparableCount)}`,
    `Missing semantic snapshots: ${formatCount(coverage.observations.missingSemanticCount)}`,
    `Missing judgment snapshots: ${formatCount(coverage.observations.missingJudgmentCount)}`,
    `Semantic abstentions: ${formatCount(coverage.observations.semanticAbstainedCount)}`,
    "",
    ...renderNovelty("Structural Signatures", coverage.corpusNovelty.structuralSignature),
    "",
    ...renderNovelty("Failed Task Signatures", coverage.corpusNovelty.failureSignature),
    "",
    "### Kernel Baseline Comparison",
    "",
    `Status: ${coverage.corpusComparison.status}`,
    ...(coverage.corpusComparison.reason ? [`Reason: ${coverage.corpusComparison.reason}`] : []),
    ...renderBaselineComparison("Structural", coverage.corpusComparison.structuralSignature),
    "",
    ...renderBaselineComparison("Failed Task", coverage.corpusComparison.failureSignature),
    "",
    "## Judgment Coverage",
    "",
    "### Decision Kinds",
    "",
    ...renderCounts(coverage.judgment.decisionKindCounts),
    "",
    "### Result Lanes",
    "",
    ...renderCounts(coverage.judgment.resultLaneCounts),
    "",
    "### Consequences",
    "",
    ...renderCounts(coverage.semantic.consequenceCounts),
    "",
    "### Reason Code Families",
    "",
    ...renderCounts(coverage.judgment.reasonCodeFamilyCounts),
  ];
}

function renderBaselineComparison(
  label: string,
  comparison: NonNullable<
    SemanticReviewCandidateReport["coverage"]["corpusComparison"]["structuralSignature"]
  > | null,
): string[] {
  if (comparison === null) {
    return [];
  }
  return [
    "",
    `${label}: covered_observations=${formatCount(comparison.coveredObservationCount)}, novel_observations=${formatCount(comparison.novelObservationCount)}, novel_signatures=${formatCount(comparison.novelSignatureCount)}`,
    ...comparison.topNovelSignatures.map(
      (entry) =>
        `- novel count=${formatCount(entry.count)} ${entry.signature} first=${entry.firstExample.bundlePath}#step-${entry.firstExample.stepIndex}`,
    ),
  ];
}

function renderNovelty(title: string, summary: SemanticReviewNoveltySummary): string[] {
  return [
    `### ${title}`,
    "",
    `Observed: ${formatCount(summary.observedCount)}`,
    `Unique: ${formatCount(summary.uniqueSignatureCount)}`,
    `Duplicate observations: ${formatCount(summary.duplicateObservationCount)}`,
    `Repeated signatures: ${formatCount(summary.repeatedSignatureCount)}`,
    `Max signature count: ${formatCount(summary.maxSignatureCount)}`,
    "",
    ...renderTopSignatures(summary),
  ];
}

function renderTopSignatures(summary: SemanticReviewNoveltySummary): string[] {
  if (summary.topSignatures.length === 0) {
    return ["- (none)"];
  }
  return summary.topSignatures.map(
    (entry) =>
      `- count=${formatCount(entry.count)} ${entry.signature} first=${entry.firstExample.bundlePath}#step-${entry.firstExample.stepIndex}`,
  );
}

function renderCounts(counts: Record<string, number>): string[] {
  const entries = Object.entries(counts);
  return entries.length === 0
    ? ["- (none)"]
    : entries.map(([key, count]) => `- ${key}: ${formatCount(count)}`);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
