import path from "node:path";

import { SEMANTIC_REVIEW_CANDIDATE_REPORT_SCHEMA_VERSION } from "./artifact-versions.js";
import { prepareOfflineReviewArtifact } from "./offline-review.js";
import type {
  ReplayDecisionSnapshot,
  ReplayNormalizedEventSnapshot,
  ReplaySemanticSnapshot,
} from "./scenario.js";
import type { ReplaySessionBundle } from "./session-bundle.js";
import {
  loadCandidateBundleIfValid,
  resolveCandidateBundleInputs,
} from "./semantic-review-candidate-input.js";
import {
  buildSemanticReviewCandidate,
  candidateKindsForStep,
  createKindBuckets,
  createKindCounts,
  retainSemanticReviewCandidate,
  sumCandidateCounts,
} from "./semantic-review-candidate-policy.js";
import {
  SEMANTIC_REVIEW_CANDIDATE_KINDS,
  type CandidateBundleInput,
  type SemanticReviewCandidate,
  type SemanticReviewCandidateKind,
  type SemanticReviewCandidateReport,
} from "./semantic-review-candidate-types.js";

export {
  DEFAULT_SEMANTIC_REVIEW_CANDIDATE_RESULTS_DIR,
  SEMANTIC_REVIEW_CANDIDATE_KINDS,
  type CandidateBundleInput,
  type SemanticReviewCandidate,
  type SemanticReviewCandidateKind,
  type SemanticReviewCandidateReport,
} from "./semantic-review-candidate-types.js";
export {
  defaultSemanticReviewCandidateReportPath,
  renderSemanticReviewCandidateMarkdown,
  writeSemanticReviewCandidateMarkdown,
  writeSemanticReviewCandidateReport,
} from "./semantic-review-candidate-render.js";

type CandidateReportAccumulator = {
  repoRoot: string;
  maxCandidatesPerKind: number;
  maxCandidatesPerSessionPerKind: number;
  countsByKind: Record<SemanticReviewCandidateKind, number>;
  candidatesByKind: Record<SemanticReviewCandidateKind, SemanticReviewCandidate[]>;
  scannedBundleCount: number;
};

export async function createSemanticReviewCandidateReportFromPaths(options: {
  manifestPaths?: readonly string[];
  bundlePaths?: readonly string[];
  bundleDirectories?: readonly string[];
  generatedAt?: string;
  maxCandidatesPerKind?: number;
  maxCandidatesPerSessionPerKind?: number;
  repoRoot?: string;
}): Promise<SemanticReviewCandidateReport> {
  const inputs = await resolveCandidateBundleInputs({
    manifestPaths: options.manifestPaths ?? [],
    bundlePaths: options.bundlePaths ?? [],
    bundleDirectories: options.bundleDirectories ?? [],
  });
  const accumulator = createCandidateReportAccumulator(options);
  let invalidBundleCount = 0;

  for (const input of inputs.bundleInputs) {
    const bundle = await loadCandidateBundleIfValid(input);
    if (!bundle) {
      invalidBundleCount += 1;
      continue;
    }
    addBundleCandidates(accumulator, input, bundle);
  }

  return finalizeCandidateReport(accumulator, {
    ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
    manifestPaths: options.manifestPaths ?? [],
    bundlePaths: options.bundlePaths ?? [],
    bundleDirectories: options.bundleDirectories ?? [],
    fileCount: inputs.fileCount,
    invalidBundleCount,
    manifestRecordCount: inputs.manifestRecordCount,
    manifestBundleCount: inputs.manifestBundleCount,
  });
}

export function createSemanticReviewCandidateReport(
  bundles: Array<{ input: CandidateBundleInput; bundle: ReplaySessionBundle }>,
  options: {
    generatedAt?: string;
    maxCandidatesPerKind?: number;
    maxCandidatesPerSessionPerKind?: number;
    repoRoot?: string;
    manifestPaths?: readonly string[];
    bundlePaths?: readonly string[];
    bundleDirectories?: readonly string[];
    invalidBundleCount?: number;
    fileCount?: number;
    manifestRecordCount?: number;
    manifestBundleCount?: number;
  } = {},
): SemanticReviewCandidateReport {
  const maxCandidatesPerKind = options.maxCandidatesPerKind ?? 30;
  const maxCandidatesPerSessionPerKind = options.maxCandidatesPerSessionPerKind ?? 3;
  const accumulator = createCandidateReportAccumulator({
    ...(options.repoRoot !== undefined ? { repoRoot: options.repoRoot } : {}),
    maxCandidatesPerKind,
    maxCandidatesPerSessionPerKind,
  });

  for (const { input, bundle } of bundles) {
    addBundleCandidates(accumulator, input, bundle);
  }

  return finalizeCandidateReport(accumulator, {
    ...(options.generatedAt !== undefined ? { generatedAt: options.generatedAt } : {}),
    manifestPaths: options.manifestPaths ?? [],
    bundlePaths: options.bundlePaths ?? [],
    bundleDirectories: options.bundleDirectories ?? [],
    fileCount: options.fileCount ?? bundles.length,
    invalidBundleCount: options.invalidBundleCount ?? 0,
    manifestRecordCount: options.manifestRecordCount ?? 0,
    manifestBundleCount: options.manifestBundleCount ?? 0,
  });
}

function createCandidateReportAccumulator(options: {
  maxCandidatesPerKind?: number;
  maxCandidatesPerSessionPerKind?: number;
  repoRoot?: string;
}): CandidateReportAccumulator {
  const maxCandidatesPerKind = options.maxCandidatesPerKind ?? 30;
  const maxCandidatesPerSessionPerKind = options.maxCandidatesPerSessionPerKind ?? 3;
  assertPositiveInteger(maxCandidatesPerKind, "maxCandidatesPerKind");
  assertPositiveInteger(maxCandidatesPerSessionPerKind, "maxCandidatesPerSessionPerKind");

  return {
    repoRoot: options.repoRoot ?? process.cwd(),
    maxCandidatesPerKind,
    maxCandidatesPerSessionPerKind,
    countsByKind: createKindCounts(),
    candidatesByKind: createKindBuckets(),
    scannedBundleCount: 0,
  };
}

function addBundleCandidates(
  accumulator: CandidateReportAccumulator,
  input: CandidateBundleInput,
  bundle: ReplaySessionBundle,
): void {
  accumulator.scannedBundleCount += 1;
  const bundlePath = repoRelativePath(input.bundlePath, accumulator.repoRoot);
  const artifact = prepareOfflineReviewArtifact(bundle, { bundlePath });
  const normalizedByStep = new Map(
    bundle.normalizedEvents.map((entry) => [entry.stepIndex, entry]),
  );
  const semanticByStep = new Map(bundle.semanticSnapshots.map((entry) => [entry.stepIndex, entry]));
  const decisionByStep = new Map(bundle.decisionSnapshots.map((entry) => [entry.stepIndex, entry]));

  for (const step of artifact.steps) {
    const normalized = normalizedByStep.get(step.stepIndex) ?? null;
    const semantic = semanticByStep.get(step.stepIndex) ?? null;
    const decision = decisionByStep.get(step.stepIndex) ?? null;

    for (const kind of candidateKindsForStep(step, semantic, decision)) {
      accumulator.countsByKind[kind] += 1;
      accumulator.candidatesByKind[kind] = retainSemanticReviewCandidate(
        accumulator.candidatesByKind[kind],
        buildSemanticReviewCandidate(kind, {
          bundle,
          bundlePath,
          input,
          repoRoot: accumulator.repoRoot,
          step,
          normalized: normalized as ReplayNormalizedEventSnapshot | null,
          semantic: semantic as ReplaySemanticSnapshot | null,
          decision: decision as ReplayDecisionSnapshot | null,
        }),
        {
          maxCandidatesPerKind: accumulator.maxCandidatesPerKind,
          maxCandidatesPerSessionPerKind: accumulator.maxCandidatesPerSessionPerKind,
        },
      );
    }
  }
}

function finalizeCandidateReport(
  accumulator: CandidateReportAccumulator,
  options: {
    generatedAt?: string;
    manifestPaths: readonly string[];
    bundlePaths: readonly string[];
    bundleDirectories: readonly string[];
    fileCount: number;
    invalidBundleCount: number;
    manifestRecordCount: number;
    manifestBundleCount: number;
  },
): SemanticReviewCandidateReport {
  const retainedByKind = Object.fromEntries(
    SEMANTIC_REVIEW_CANDIDATE_KINDS.map((kind) => [
      kind,
      accumulator.candidatesByKind[kind].length,
    ]),
  ) as Record<SemanticReviewCandidateKind, number>;

  return {
    schemaVersion: SEMANTIC_REVIEW_CANDIDATE_REPORT_SCHEMA_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    selection: {
      maxCandidatesPerKind: accumulator.maxCandidatesPerKind,
      maxCandidatesPerSessionPerKind: accumulator.maxCandidatesPerSessionPerKind,
      retainedSort: "pressure_score_desc_path_step",
      promotionAuthority: "review_required",
    },
    input: {
      manifestPaths: [...(options.manifestPaths ?? [])].map((entry) =>
        repoRelativePath(entry, accumulator.repoRoot),
      ),
      bundlePaths: [...(options.bundlePaths ?? [])].map((entry) =>
        repoRelativePath(entry, accumulator.repoRoot),
      ),
      bundleDirectories: [...(options.bundleDirectories ?? [])].map((entry) =>
        repoRelativePath(entry, accumulator.repoRoot),
      ),
      fileCount: options.fileCount,
      scannedBundleCount: accumulator.scannedBundleCount,
      invalidBundleCount: options.invalidBundleCount,
      manifestRecordCount: options.manifestRecordCount,
      manifestBundleCount: options.manifestBundleCount,
    },
    summary: {
      candidateCount: sumCandidateCounts(accumulator.countsByKind),
      countsByKind: accumulator.countsByKind,
      retainedByKind,
    },
    candidatesByKind: accumulator.candidatesByKind,
  };
}

function repoRelativePath(filePath: string, repoRoot: string): string {
  const absolute = path.resolve(filePath);
  const relative = path.relative(repoRoot, absolute);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return absolute;
  }
  return relative;
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
}
