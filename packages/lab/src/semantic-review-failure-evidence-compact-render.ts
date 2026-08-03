import type { SemanticReviewCandidateReport } from "./semantic-review-candidate-types.js";
import type { SemanticReviewTaskFailureEvidenceExample } from "./semantic-review-failure-evidence-types.js";

export function renderParserGapCandidateExamples(report: SemanticReviewCandidateReport): string[] {
  const entries = Object.entries(
    report.summary.failedTaskEvidence.retainedParserGapCandidateExamplesByEventShape,
  );
  if (entries.length === 0) {
    return ["- (none)"];
  }

  return entries.flatMap(([shape, examples]) => [
    `#### ${shape}`,
    "",
    ...renderCompactExamples(examples),
    "",
  ]);
}

export function renderEvidenceLossExamples(report: SemanticReviewCandidateReport): string[] {
  const entries = Object.entries(
    report.summary.failedTaskEvidence.retainedEvidenceLossExamples,
  ).filter(([, examples]) => examples.length > 0);
  if (entries.length === 0) {
    return ["- (none)"];
  }

  return entries.flatMap(([kind, examples]) => [
    `#### ${kind}`,
    "",
    ...renderCompactExamples(examples),
    "",
  ]);
}

function renderCompactExamples(
  examples: readonly SemanticReviewTaskFailureEvidenceExample[],
): string[] {
  return examples.map((example) => {
    const label = example.stepLabel ? ` step=${example.stepLabel}` : "";
    const detail = example.evidence.failureDetail
      ? ` detail=${example.evidence.failureDetail}`
      : "";
    return `- ${example.bundlePath}#step-${example.stepIndex}${label} evidence=${example.evidence.kind}${detail} shape=${example.eventShape}`;
  });
}
