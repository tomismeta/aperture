import path from "node:path";

import { writeTextAtomic } from "./public-corpus-manifest.js";
import {
  DEFAULT_SEMANTIC_REVIEW_CANDIDATE_RESULTS_DIR,
  SEMANTIC_REVIEW_CANDIDATE_KINDS,
  type SemanticReviewCandidateReport,
} from "./semantic-review-candidate-types.js";
import { renderFailureEvidenceMarkdown } from "./semantic-review-failure-evidence-render.js";

export function defaultSemanticReviewCandidateReportPath(
  report: Pick<SemanticReviewCandidateReport, "generatedAt">,
  directory: string = DEFAULT_SEMANTIC_REVIEW_CANDIDATE_RESULTS_DIR,
): string {
  return path.join(
    directory,
    `semantic-review-candidates-${safeTimestamp(report.generatedAt)}.json`,
  );
}

export async function writeSemanticReviewCandidateReport(
  filePath: string,
  report: SemanticReviewCandidateReport,
): Promise<void> {
  await writeTextAtomic(filePath, `${JSON.stringify(report, null, 2)}\n`);
}

export async function writeSemanticReviewCandidateMarkdown(
  filePath: string,
  report: SemanticReviewCandidateReport,
): Promise<void> {
  await writeTextAtomic(filePath, `${renderSemanticReviewCandidateMarkdown(report)}\n`);
}

export function renderSemanticReviewCandidateMarkdown(
  report: SemanticReviewCandidateReport,
): string {
  const lines = [
    "# Semantic Review Candidate Census",
    "",
    `Generated: ${report.generatedAt}`,
    `Bundles scanned: ${formatCount(report.input.scannedBundleCount)}`,
    `Files considered: ${formatCount(report.input.fileCount)}`,
    `Invalid bundle files: ${formatCount(report.input.invalidBundleCount)}`,
    `Manifest records: ${formatCount(report.input.manifestRecordCount)}`,
    `Retained per kind: ${report.selection.maxCandidatesPerKind}`,
    `Retained per session/kind: ${report.selection.maxCandidatesPerSessionPerKind}`,
    `Failure evidence examples per kind: ${report.selection.maxFailureEvidenceExamplesPerKind}`,
    `Failure evidence examples per session/kind: ${report.selection.maxFailureEvidenceExamplesPerSessionPerKind}`,
    `Promotion authority: ${report.selection.promotionAuthority}`,
    "",
    "## Summary",
    "",
    ...SEMANTIC_REVIEW_CANDIDATE_KINDS.map(
      (kind) =>
        `- ${kind}: count=${formatCount(report.summary.countsByKind[kind])}, retained=${formatCount(report.summary.retainedByKind[kind])}`,
    ),
    "",
    ...renderFailureEvidenceMarkdown(report),
    "",
    "## Shortlist",
    "",
  ];

  for (const kind of SEMANTIC_REVIEW_CANDIDATE_KINDS) {
    lines.push(`### ${kind}`, "");
    const candidates = report.candidatesByKind[kind];
    if (candidates.length === 0) {
      lines.push("- (none)", "");
      continue;
    }

    for (const candidate of candidates) {
      lines.push(
        `- ${candidate.bundlePath}#step-${candidate.stepIndex} score=${candidate.pressureScore}`,
      );
      lines.push(`  session: ${candidate.sessionId}`);
      lines.push(`  title: ${candidate.title}`);
      if (candidate.stepLabel) {
        lines.push(`  step: ${candidate.stepLabel}`);
      }
      if (candidate.publicCorpus?.offset !== undefined) {
        lines.push(`  source offset: ${candidate.publicCorpus.offset}`);
      }
      lines.push(
        `  semantic: intent=${candidate.semantic.intentFrame ?? "none"}, activity=${candidate.semantic.activityClass ?? "none"}, tool=${candidate.semantic.toolFamily ?? "none"}, consequence=${candidate.semantic.consequence ?? "none"}, confidence=${candidate.semantic.confidence ?? "none"}`,
      );
      lines.push(
        `  judgment: kind=${candidate.judgment.decisionKind ?? "none"}, planned=${candidate.judgment.plannedLane ?? "none"}, result=${candidate.judgment.resultLane ?? "none"}`,
      );
      lines.push(`  review focus: ${candidate.reviewFocusAreas.join(", ")}`);
      lines.push(`  rationale: ${candidate.reviewRationale}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function safeTimestamp(value: string): string {
  return value.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "");
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
