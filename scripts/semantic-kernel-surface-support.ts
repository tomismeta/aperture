import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import ts from "typescript";

import {
  compareKernelCanonicalKey,
  digestKernelCanonicalJson,
} from "../packages/lab/src/kernel-canonical-json.js";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const execFileAsync = promisify(execFile);

export const SEMANTIC_KERNEL_SURFACE_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_KERNEL_SURFACE_PROFILE_ID = "semantic-kernel-surface" as const;
export const SEMANTIC_KERNEL_SURFACE_PROFILE_VERSION = 1 as const;

export const SEMANTIC_KERNEL_SURFACE_THRESHOLDS = {
  maximumModules: 106,
  maximumTotalLines: 9200,
  maximumMatcherSites: 586,
  maximumPhraseLiterals: 175,
  maximumExportedDetectors: 171,
  maximumFamilyModules: 29,
  maximumNormalizedObservationDirectConsumers: 5,
} as const;

export const OBSERVATION_PRIMITIVE_FILES = [
  "packages/core/src/observation-semantics.ts",
  "packages/core/src/observation-semantic-read.ts",
  "packages/core/src/normalized-observation.ts",
  "packages/core/src/task-failure-observation-grammar.ts",
  "packages/core/src/task-failure-observation-core.ts",
  "packages/core/src/task-failure-observation-normalizer.ts",
  "packages/core/src/task-failure-observation-reader.ts",
] as const;

export const TASK_FAILURE_PARSING_FILES = [
  "packages/core/src/task-failure-observation-grammar.ts",
  "packages/core/src/semantic-task-failure-signals.ts",
  "packages/core/src/semantic-evidence.ts",
  "packages/core/src/semantic-failure-detail.ts",
  "packages/core/src/semantic-edit-output-shapes.ts",
  "packages/core/src/semantic-task-failure-event-facts.ts",
  "packages/core/src/semantic-task-failure-structured-output.ts",
] as const;

export type SemanticKernelSurfaceFamily =
  | "command_test_output"
  | "diagnostics"
  | "observation_kernel_projection"
  | "observation_payload"
  | "observation_transcript"
  | "ontology_interpretation"
  | "relation_continuity"
  | "shared_lexical_parser"
  | "source_read_listing_span"
  | "task_failure_grammar";

export type SemanticKernelSurfaceConsumerScope = SemanticKernelSurfaceFamily | "core";

export type SemanticKernelSurfaceReport = {
  schemaVersion: typeof SEMANTIC_KERNEL_SURFACE_SCHEMA_VERSION;
  profile: {
    id: typeof SEMANTIC_KERNEL_SURFACE_PROFILE_ID;
    version: typeof SEMANTIC_KERNEL_SURFACE_PROFILE_VERSION;
    surfaceDigest: string;
  };
  passed: boolean;
  failures: string[];
  thresholds: typeof SEMANTIC_KERNEL_SURFACE_THRESHOLDS;
  summary: SemanticKernelSurfaceMetrics & {
    semanticModules: number;
    semanticLines: number;
    observationPrimitiveLines: number;
    taskFailureParsingLines: number;
  };
  imports: {
    crossFamilyEdges: SemanticKernelSurfaceCrossFamilyEdge[];
    crossFamilyImportEdges: SemanticKernelSurfaceConcreteCrossFamilyEdge[];
    detectorConsumersOutsideFamily: SemanticKernelSurfaceDetectorConsumer[];
    normalizedObservationDirectConsumers: string[];
  };
  families: SemanticKernelSurfaceFamilySummary[];
};

export type SemanticKernelSurfaceMetrics = {
  modules: number;
  totalLines: number;
  matcherSites: number;
  phraseMatcherCalls: number;
  regexSites: number;
  phraseLiterals: number;
  exportedDetectors: number;
  dependencyFanOut: number;
};

export type SemanticKernelSurfaceFamilySummary = SemanticKernelSurfaceMetrics & {
  id: SemanticKernelSurfaceFamily;
  files: SemanticKernelSurfaceFileSummary[];
};

export type SemanticKernelSurfaceFileSummary = SemanticKernelSurfaceMetrics & {
  path: string;
  exportedDetectorNames: string[];
  imports: string[];
  namedImports: Array<{
    path: string;
    names: string[];
    bindings: SemanticKernelSurfaceImportBinding[];
  }>;
  namedExports: Array<{
    path: string;
    names: string[];
    bindings: SemanticKernelSurfaceReExportBinding[];
  }>;
  localExports: SemanticKernelSurfaceLocalExportBinding[];
  crossFamilyImports: SemanticKernelSurfaceFamily[];
};

export type SemanticKernelSurfaceImportBinding = {
  sourceName: string;
  localName: string;
};

export type SemanticKernelSurfaceReExportBinding = {
  sourceName: string;
  exportedName: string;
};

export type SemanticKernelSurfaceLocalExportBinding = {
  localName: string;
  exportedName: string;
};

export type SemanticKernelSurfaceCrossFamilyEdge = {
  from: SemanticKernelSurfaceFamily;
  to: SemanticKernelSurfaceFamily;
  count: number;
};

export type SemanticKernelSurfaceConcreteCrossFamilyEdge = {
  consumer: string;
  consumerFamily: SemanticKernelSurfaceFamily;
  producer: string;
  producerFamily: SemanticKernelSurfaceFamily;
};

export type SemanticKernelSurfaceDetectorConsumer = {
  consumer: string;
  consumerFamily: SemanticKernelSurfaceConsumerScope;
  producer: string;
  producerFamily: SemanticKernelSurfaceFamily;
  names: string[];
};

export type SemanticKernelArchitectureMetrics = {
  semanticModuleCount: number;
  semanticLineCount: number;
  semanticMatcherSiteCount: number;
  semanticPhraseLiteralCount: number;
  observationPrimitiveLineCount: number;
  taskFailureParsingLineCount: number;
  missingManifestFiles: string[];
};

export type SemanticKernelSurfaceManifestEntry = {
  family: SemanticKernelSurfaceFamily;
  files: readonly string[];
};

type DetectorExportProvenance = {
  path: string;
  family: SemanticKernelSurfaceFamily;
};

export const SEMANTIC_KERNEL_SURFACE_MANIFEST = [
  {
    family: "observation_kernel_projection",
    files: [
      "packages/core/src/judgment-observation-contract.ts",
      "packages/core/src/judgment-observation-status-conflict.ts",
      "packages/core/src/normalized-observation.ts",
      "packages/core/src/observation-semantic-read.ts",
      "packages/core/src/observation-semantics.ts",
      "packages/core/src/observational-status-conflict.ts",
      "packages/core/src/task-failure-observation-core.ts",
      "packages/core/src/task-failure-observation-grammar.ts",
      "packages/core/src/task-failure-observation-normalizer.ts",
      "packages/core/src/task-failure-observation-reader.ts",
    ],
  },
  {
    family: "task_failure_grammar",
    files: [
      "packages/core/src/semantic-edit-output-shapes.ts",
      "packages/core/src/semantic-evidence.ts",
      "packages/core/src/semantic-failure-detail.ts",
      "packages/core/src/semantic-task-failure-event-facts.ts",
      "packages/core/src/semantic-task-failure-signals.ts",
      "packages/core/src/semantic-task-failure-structured-output.ts",
      "packages/core/src/semantic-terminal-evidence.ts",
    ],
  },
  {
    family: "observation_transcript",
    files: [
      "packages/core/src/semantic-nondiagnostic-observation-transcript-shapes.ts",
      "packages/core/src/semantic-observation-reference-wrapper-shapes.ts",
      "packages/core/src/semantic-observation-text.ts",
      "packages/core/src/semantic-observation-transcript-actual-section.ts",
      "packages/core/src/semantic-observation-transcript-body.ts",
      "packages/core/src/semantic-observation-transcript-diagnostic-boundaries.ts",
      "packages/core/src/semantic-observation-transcript-diagnostic-candidate.ts",
      "packages/core/src/semantic-observation-transcript-diagnostic-shapes.ts",
      "packages/core/src/semantic-observation-transcript-reference-shapes.ts",
      "packages/core/src/semantic-observation-transcript-shapes.ts",
      "packages/core/src/semantic-observation-transcript-types.ts",
    ],
  },
  {
    family: "source_read_listing_span",
    files: [
      "packages/core/src/semantic-abbreviated-file-view-observation-shapes.ts",
      "packages/core/src/semantic-arrow-numbered-document-span-parser.ts",
      "packages/core/src/semantic-arrow-numbered-source-span-shapes.ts",
      "packages/core/src/semantic-assembly-source-observation-shapes.ts",
      "packages/core/src/semantic-c-like-source-line-shapes.ts",
      "packages/core/src/semantic-c-like-source-observation-shapes.ts",
      "packages/core/src/semantic-clipped-read-window-shapes.ts",
      "packages/core/src/semantic-document-observation-shapes.ts",
      "packages/core/src/semantic-line-numbered-document-observation-shapes.ts",
      "packages/core/src/semantic-line-numbered-document-span-shapes.ts",
      "packages/core/src/semantic-listing-body-shapes.ts",
      "packages/core/src/semantic-listing-entry-shapes.ts",
      "packages/core/src/semantic-listing-observation-shapes.ts",
      "packages/core/src/semantic-numbered-source-observation-shapes.ts",
      "packages/core/src/semantic-numbered-source-span-shapes.ts",
      "packages/core/src/semantic-owned-read-observation-shapes.ts",
      "packages/core/src/semantic-owned-read-transport-numbering.ts",
      "packages/core/src/semantic-read-observation-shapes.ts",
      "packages/core/src/semantic-recovered-command-source-observation-shapes.ts",
      "packages/core/src/semantic-sectioned-source-observation-shapes.ts",
      "packages/core/src/semantic-single-listing-observation-shapes.ts",
      "packages/core/src/semantic-source-fixture-observation-shapes.ts",
      "packages/core/src/semantic-source-header-observation-shapes.ts",
      "packages/core/src/semantic-source-literal-wrapper-shapes.ts",
      "packages/core/src/semantic-source-observation-shapes.ts",
      "packages/core/src/semantic-source-quality.ts",
      "packages/core/src/semantic-source-statement-shapes.ts",
      "packages/core/src/semantic-tagged-file-observation-transcript-shapes.ts",
      "packages/core/src/semantic-unified-diff-observation-shapes.ts",
    ],
  },
  {
    family: "diagnostics",
    files: [
      "packages/core/src/semantic-bare-diagnostic-observation-shapes.ts",
      "packages/core/src/semantic-diagnostic-reference-shapes.ts",
      "packages/core/src/semantic-diagnostic-shapes.ts",
      "packages/core/src/semantic-location-diagnostic-shapes.ts",
      "packages/core/src/semantic-panic-diagnostic-shapes.ts",
      "packages/core/src/semantic-path-qualified-failure-diagnostic-shapes.ts",
      "packages/core/src/semantic-python-diagnostic-shapes.ts",
      "packages/core/src/semantic-runtime-error-diagnostic-shapes.ts",
      "packages/core/src/semantic-tool-output-diagnostic-shapes.ts",
    ],
  },
  {
    family: "command_test_output",
    files: [
      "packages/core/src/semantic-command-text-observation-boundaries.ts",
      "packages/core/src/semantic-command-warning-observation-shapes.ts",
      "packages/core/src/semantic-linter-output-observation-shapes.ts",
      "packages/core/src/semantic-operation-success-observation-shapes.ts",
      "packages/core/src/semantic-recovered-command-output-observation-shapes.ts",
      "packages/core/src/semantic-structured-output-ownership.ts",
      "packages/core/src/semantic-structured-output.ts",
      "packages/core/src/semantic-test-output-observation-shapes.ts",
      "packages/core/src/semantic-test-result-section-shapes.ts",
      "packages/core/src/semantic-test-runner-output-shapes.ts",
      "packages/core/src/semantic-test-section-parser.ts",
      "packages/core/src/semantic-truncated-structured-output-recovery.ts",
      "packages/core/src/semantic-truncated-structured-output.ts",
    ],
  },
  {
    family: "observation_payload",
    files: [
      "packages/core/src/semantic-observation-shapes.ts",
      "packages/core/src/semantic-owned-observation-payload-shapes.ts",
      "packages/core/src/semantic-payload-observation-shapes.ts",
      "packages/core/src/semantic-procedural-observation-shapes.ts",
      "packages/core/src/semantic-search-observation-shapes.ts",
    ],
  },
  {
    family: "relation_continuity",
    files: [
      "packages/core/src/semantic-imperative-supersession-relation.ts",
      "packages/core/src/semantic-relation-detection.ts",
      "packages/core/src/semantic-relation-hint-dedupe.ts",
      "packages/core/src/semantic-relation-judgment.ts",
      "packages/core/src/semantic-relations.ts",
    ],
  },
  {
    family: "ontology_interpretation",
    files: [
      "packages/core/src/policy/semantic-uncertainty-criterion-rule.ts",
      "packages/core/src/semantic-interpreter.ts",
      "packages/core/src/semantic-normalizer.ts",
      "packages/core/src/semantic-ontology-types.ts",
      "packages/core/src/semantic-ontology.ts",
      "packages/core/src/semantic-resolution-polarity.ts",
    ],
  },
  {
    family: "shared_lexical_parser",
    files: [
      "packages/core/src/semantic-detection.ts",
      "packages/core/src/semantic-language.ts",
      "packages/core/src/semantic-patterns.ts",
      "packages/core/src/semantic-provenance.ts",
      "packages/core/src/semantic-quoted-span.ts",
      "packages/core/src/semantic-text.ts",
      "packages/core/src/semantic-tool-family.ts",
      "packages/core/src/semantic-types.ts",
      "packages/core/src/semantic.ts",
    ],
  },
] as const satisfies readonly SemanticKernelSurfaceManifestEntry[];

const DETECTOR_PREFIXES = [
  "classify",
  "detect",
  "has",
  "infer",
  "is",
  "looksLike",
  "parse",
  "read",
] as const;

export async function buildSemanticKernelSurfaceReport(
  root = repoRoot,
): Promise<SemanticKernelSurfaceReport> {
  const manifest = buildManifestIndex();
  const directFiles = await summarizeManifestFiles(root, manifest);
  const files = applyDetectorExportProvenance(directFiles, manifest);
  const consumerFiles = await summarizeCoreConsumerFiles(root);
  const families = buildFamilySummaries(files);
  const summary = sumMetrics(files);
  const architecture = await readSemanticKernelArchitectureMetrics(root, files);
  const imports = buildImportSummary(directFiles, consumerFiles, manifest);
  const failures = collectSurfaceFailures(summary, architecture, imports, families);

  return {
    schemaVersion: SEMANTIC_KERNEL_SURFACE_SCHEMA_VERSION,
    profile: {
      id: SEMANTIC_KERNEL_SURFACE_PROFILE_ID,
      version: SEMANTIC_KERNEL_SURFACE_PROFILE_VERSION,
      surfaceDigest: digestKernelCanonicalJson(files),
    },
    passed: failures.length === 0,
    failures,
    thresholds: SEMANTIC_KERNEL_SURFACE_THRESHOLDS,
    summary: {
      ...summary,
      semanticModules: architecture.semanticModuleCount,
      semanticLines: architecture.semanticLineCount,
      observationPrimitiveLines: architecture.observationPrimitiveLineCount,
      taskFailureParsingLines: architecture.taskFailureParsingLineCount,
    },
    imports,
    families,
  };
}

export async function readSemanticKernelArchitectureMetrics(
  root = repoRoot,
  summaries?: SemanticKernelSurfaceFileSummary[],
): Promise<SemanticKernelArchitectureMetrics> {
  const manifest = buildManifestIndex();
  const files =
    summaries ??
    applyDetectorExportProvenance(await summarizeManifestFiles(root, manifest), manifest);
  const collected = await collectSemanticKernelSurfaceCandidateFiles(root);
  const manifestFiles = new Set(manifest.fileToFamily.keys());
  const missingManifestFiles = collected.filter((file) => !manifestFiles.has(file));
  const semanticFiles = await collectCoreSemanticFiles(root);

  return {
    semanticModuleCount: semanticFiles.length,
    semanticLineCount: await countAbsoluteFilesLines(semanticFiles),
    semanticMatcherSiteCount: sum(files.map((file) => file.matcherSites)),
    semanticPhraseLiteralCount: sum(files.map((file) => file.phraseLiterals)),
    observationPrimitiveLineCount: await countFilesLines(root, OBSERVATION_PRIMITIVE_FILES),
    taskFailureParsingLineCount: await countFilesLines(root, TASK_FAILURE_PARSING_FILES),
    missingManifestFiles,
  };
}

export async function inspectSemanticKernelSurfaceForTest(
  root: string,
  entries: readonly SemanticKernelSurfaceManifestEntry[],
): Promise<{
  files: SemanticKernelSurfaceFileSummary[];
  imports: SemanticKernelSurfaceReport["imports"];
}> {
  const manifest = buildManifestIndex(entries);
  const directFiles = await summarizeManifestFiles(root, manifest);
  const files = applyDetectorExportProvenance(directFiles, manifest);
  const consumerFiles = await summarizeCoreConsumerFiles(root);

  return {
    files,
    imports: buildImportSummary(directFiles, consumerFiles, manifest),
  };
}

export async function collectCoreSemanticFiles(root = repoRoot): Promise<string[]> {
  const sourceRoot = resolve(root, "packages/core/src");
  const files = await collectTypeScriptFiles(sourceRoot);
  return files
    .filter((file) => isCoreSemanticModulePath(relative(root, file).replace(/\\/g, "/")))
    .sort();
}

export async function collectSemanticMatcherGovernedFiles(root = repoRoot): Promise<string[]> {
  const files = new Set(await collectCoreSemanticFiles(root));
  files.add(resolve(root, "packages/core/src/task-failure-observation-grammar.ts"));
  return [...files].sort();
}

export async function countObservationPrimitiveLines(root = repoRoot): Promise<number> {
  return countFilesLines(root, OBSERVATION_PRIMITIVE_FILES);
}

export async function countTaskFailureParsingLines(root = repoRoot): Promise<number> {
  return countFilesLines(root, TASK_FAILURE_PARSING_FILES);
}

export function countSemanticMatcherSites(source: string): number {
  const sourceFile = ts.createSourceFile(
    "semantic-inline.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  let matcherSites = 0;

  function visit(node: ts.Node): void {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      matcherSites += 1;
    }
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === "RegExp") {
      matcherSites += 1;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "containsAnySemanticPhrase"
    ) {
      matcherSites += 1;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return matcherSites;
}

export function countSemanticPhraseLiterals(source: string): number {
  const sourceFile = ts.createSourceFile(
    "semantic-inline.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  return countSemanticPhraseLiteralsInSourceFile(sourceFile);
}

export function assertSemanticKernelSurfaceReportPassed(report: SemanticKernelSurfaceReport): void {
  if (report.passed) {
    return;
  }
  throw new Error(
    `Semantic kernel surface report failed: ${report.failures.join(", ") || "unknown failure"}`,
  );
}

export function buildSemanticKernelSurfaceComparison(
  baseline: SemanticKernelSurfaceReport,
  candidate: SemanticKernelSurfaceReport,
): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  if (baseline.schemaVersion !== candidate.schemaVersion) {
    failures.push(
      `surface_comparison:schema_version:${baseline.schemaVersion}:${candidate.schemaVersion}`,
    );
  }
  if (baseline.profile.id !== candidate.profile.id) {
    failures.push(`surface_comparison:profile_id:${baseline.profile.id}:${candidate.profile.id}`);
  }
  if (candidate.summary.modules > baseline.summary.modules) {
    failures.push(
      `surface_comparison:modules:${candidate.summary.modules}>${baseline.summary.modules}`,
    );
  }
  if (candidate.summary.totalLines > baseline.summary.totalLines) {
    failures.push(
      `surface_comparison:total_lines:${candidate.summary.totalLines}>${baseline.summary.totalLines}`,
    );
  }
  if (candidate.summary.exportedDetectors > baseline.summary.exportedDetectors) {
    failures.push(
      `surface_comparison:exported_detectors:${candidate.summary.exportedDetectors}>${baseline.summary.exportedDetectors}`,
    );
  }
  if (candidate.summary.matcherSites > baseline.summary.matcherSites) {
    failures.push(
      `surface_comparison:matcher_sites:${candidate.summary.matcherSites}>${baseline.summary.matcherSites}`,
    );
  }
  if (candidate.summary.phraseLiterals > baseline.summary.phraseLiterals) {
    failures.push(
      `surface_comparison:phrase_literals:${candidate.summary.phraseLiterals}>${baseline.summary.phraseLiterals}`,
    );
  }
  if (candidate.summary.dependencyFanOut > baseline.summary.dependencyFanOut) {
    failures.push(
      `surface_comparison:dependency_fan_out:${candidate.summary.dependencyFanOut}>${baseline.summary.dependencyFanOut}`,
    );
  }
  if (candidate.summary.semanticModules > baseline.summary.semanticModules) {
    failures.push(
      `surface_comparison:semantic_modules:${candidate.summary.semanticModules}>${baseline.summary.semanticModules}`,
    );
  }
  if (candidate.summary.semanticLines > baseline.summary.semanticLines) {
    failures.push(
      `surface_comparison:semantic_lines:${candidate.summary.semanticLines}>${baseline.summary.semanticLines}`,
    );
  }
  if (candidate.summary.observationPrimitiveLines > baseline.summary.observationPrimitiveLines) {
    failures.push(
      `surface_comparison:observation_primitive_lines:${candidate.summary.observationPrimitiveLines}>${baseline.summary.observationPrimitiveLines}`,
    );
  }
  if (candidate.summary.taskFailureParsingLines > baseline.summary.taskFailureParsingLines) {
    failures.push(
      `surface_comparison:task_failure_parsing_lines:${candidate.summary.taskFailureParsingLines}>${baseline.summary.taskFailureParsingLines}`,
    );
  }

  const baselineCrossFamilyImportCount = sum(
    baseline.imports.crossFamilyEdges.map((edge) => edge.count),
  );
  const candidateCrossFamilyImportCount = sum(
    candidate.imports.crossFamilyEdges.map((edge) => edge.count),
  );
  const baselineCrossFamilyImportCounts = new Map(
    baseline.imports.crossFamilyEdges.map((edge) => [readCrossFamilyEdgeKey(edge), edge.count]),
  );
  for (const edge of candidate.imports.crossFamilyEdges) {
    const baselineCount = baselineCrossFamilyImportCounts.get(readCrossFamilyEdgeKey(edge));
    if (baselineCount === undefined) {
      failures.push(`surface_comparison:new_cross_family_import:${edge.from}->${edge.to}`);
      continue;
    }
    if (edge.count > baselineCount) {
      failures.push(
        `surface_comparison:cross_family_import_edge:${edge.from}->${edge.to}:${edge.count}>${baselineCount}`,
      );
    }
  }
  if (candidateCrossFamilyImportCount > baselineCrossFamilyImportCount) {
    failures.push(
      `surface_comparison:cross_family_imports:${candidateCrossFamilyImportCount}>${baselineCrossFamilyImportCount}`,
    );
  }
  const baselineConcreteCrossFamilyImportEdges = new Set(
    baseline.imports.crossFamilyImportEdges.map(readConcreteCrossFamilyEdgeKey),
  );
  const candidateSurfaceFiles = new Set(
    candidate.families.flatMap((family) => family.files.map((file) => file.path)),
  );
  const isModuleConsolidation = candidate.summary.modules < baseline.summary.modules;
  const consumedImportTransfers = new Set<string>();
  for (const edge of candidate.imports.crossFamilyImportEdges) {
    const key = readConcreteCrossFamilyEdgeKey(edge);
    if (!baselineConcreteCrossFamilyImportEdges.has(key)) {
      const transferKey = readConsolidatedConcreteImportTransfer({
        baseline,
        candidate,
        candidateSurfaceFiles,
        edge,
        isModuleConsolidation,
      });
      if (transferKey === null || consumedImportTransfers.has(transferKey)) {
        failures.push(`surface_comparison:new_cross_family_import_edge:${key}`);
      } else {
        consumedImportTransfers.add(transferKey);
      }
    }
  }
  if (
    candidate.imports.crossFamilyImportEdges.length > baseline.imports.crossFamilyImportEdges.length
  ) {
    failures.push(
      `surface_comparison:cross_family_import_edges:${candidate.imports.crossFamilyImportEdges.length}>${baseline.imports.crossFamilyImportEdges.length}`,
    );
  }
  if (
    candidate.imports.detectorConsumersOutsideFamily.length >
    baseline.imports.detectorConsumersOutsideFamily.length
  ) {
    failures.push(
      `surface_comparison:detector_consumers_outside_family:${candidate.imports.detectorConsumersOutsideFamily.length}>${baseline.imports.detectorConsumersOutsideFamily.length}`,
    );
  }
  const baselineDetectorConsumers = new Set(
    baseline.imports.detectorConsumersOutsideFamily.flatMap(readDetectorConsumerKeys),
  );
  const consumedDetectorTransfers = new Set<string>();
  for (const consumer of candidate.imports.detectorConsumersOutsideFamily) {
    for (const key of readDetectorConsumerKeys(consumer)) {
      if (!baselineDetectorConsumers.has(key)) {
        const transferKey = readConsolidatedDetectorConsumerTransfer({
          baseline,
          candidate,
          candidateSurfaceFiles,
          consumer,
          key,
          isModuleConsolidation,
        });
        if (transferKey === null || consumedDetectorTransfers.has(transferKey)) {
          failures.push(`surface_comparison:new_detector_consumer:${key}`);
        } else {
          consumedDetectorTransfers.add(transferKey);
        }
      }
    }
  }
  if (
    candidate.imports.normalizedObservationDirectConsumers.length >
    baseline.imports.normalizedObservationDirectConsumers.length
  ) {
    failures.push(
      `surface_comparison:normalized_observation_direct_consumers:${candidate.imports.normalizedObservationDirectConsumers.length}>${baseline.imports.normalizedObservationDirectConsumers.length}`,
    );
  }
  const baselineNormalizedObservationDirectConsumers = new Set(
    baseline.imports.normalizedObservationDirectConsumers,
  );
  for (const consumer of candidate.imports.normalizedObservationDirectConsumers) {
    if (!baselineNormalizedObservationDirectConsumers.has(consumer)) {
      failures.push(`surface_comparison:new_normalized_observation_direct_consumer:${consumer}`);
    }
  }

  const baselineFamilies = new Map(baseline.families.map((family) => [family.id, family]));
  for (const family of candidate.families) {
    const base = baselineFamilies.get(family.id);
    if (base === undefined) {
      failures.push(`surface_comparison:new_family:${family.id}`);
      continue;
    }
    if (family.modules > base.modules) {
      failures.push(
        `surface_comparison:family_modules:${family.id}:${family.modules}>${base.modules}`,
      );
    }
    if (family.totalLines > base.totalLines) {
      failures.push(
        `surface_comparison:family_lines:${family.id}:${family.totalLines}>${base.totalLines}`,
      );
    }
    if (family.matcherSites > base.matcherSites) {
      failures.push(
        `surface_comparison:family_matcher_sites:${family.id}:${family.matcherSites}>${base.matcherSites}`,
      );
    }
    if (family.phraseLiterals > base.phraseLiterals) {
      failures.push(
        `surface_comparison:family_phrase_literals:${family.id}:${family.phraseLiterals}>${base.phraseLiterals}`,
      );
    }
    if (family.exportedDetectors > base.exportedDetectors) {
      failures.push(
        `surface_comparison:family_exported_detectors:${family.id}:${family.exportedDetectors}>${base.exportedDetectors}`,
      );
    }
    if (family.dependencyFanOut > base.dependencyFanOut) {
      failures.push(
        `surface_comparison:family_dependency_fan_out:${family.id}:${family.dependencyFanOut}>${base.dependencyFanOut}`,
      );
    }
  }

  return { passed: failures.length === 0, failures };
}

function readConsolidatedConcreteImportTransfer(input: {
  baseline: SemanticKernelSurfaceReport;
  candidate: SemanticKernelSurfaceReport;
  candidateSurfaceFiles: ReadonlySet<string>;
  edge: SemanticKernelSurfaceConcreteCrossFamilyEdge;
  isModuleConsolidation: boolean;
}): string | null {
  if (
    !input.isModuleConsolidation ||
    input.candidate.imports.crossFamilyImportEdges.length >
      input.baseline.imports.crossFamilyImportEdges.length ||
    !hasSurfaceFile(input.baseline, input.edge.consumer)
  ) {
    return null;
  }
  const candidateNames = readSurfaceDependencyNames(
    input.candidate,
    input.edge.consumer,
    input.edge.producer,
  );
  const matches = input.baseline.imports.crossFamilyImportEdges.filter(
    (baselineEdge) =>
      !input.candidateSurfaceFiles.has(baselineEdge.consumer) &&
      baselineEdge.consumerFamily === input.edge.consumerFamily &&
      baselineEdge.producer === input.edge.producer &&
      baselineEdge.producerFamily === input.edge.producerFamily &&
      sameStringList(
        readSurfaceDependencyNames(input.baseline, baselineEdge.consumer, baselineEdge.producer),
        candidateNames,
      ),
  );
  return matches.length === 1 ? readConcreteCrossFamilyEdgeKey(matches[0]!) : null;
}

function readConsolidatedDetectorConsumerTransfer(input: {
  baseline: SemanticKernelSurfaceReport;
  candidate: SemanticKernelSurfaceReport;
  candidateSurfaceFiles: ReadonlySet<string>;
  consumer: SemanticKernelSurfaceDetectorConsumer;
  key: string;
  isModuleConsolidation: boolean;
}): string | null {
  if (
    !input.isModuleConsolidation ||
    input.candidate.imports.detectorConsumersOutsideFamily.length >
      input.baseline.imports.detectorConsumersOutsideFamily.length ||
    !hasSurfaceFile(input.baseline, input.consumer.consumer)
  ) {
    return null;
  }
  const name = input.consumer.names.find((candidateName) =>
    input.key.endsWith(`:${candidateName}`),
  );
  if (name === undefined) return null;
  const matches = input.baseline.imports.detectorConsumersOutsideFamily.filter(
    (baselineConsumer) =>
      !input.candidateSurfaceFiles.has(baselineConsumer.consumer) &&
      baselineConsumer.consumerFamily === input.consumer.consumerFamily &&
      baselineConsumer.producer === input.consumer.producer &&
      baselineConsumer.producerFamily === input.consumer.producerFamily &&
      baselineConsumer.names.includes(name),
  );
  return matches.length === 1
    ? (readDetectorConsumerKeys(matches[0]!).find((key) => key.endsWith(`:${name}`)) ?? null)
    : null;
}

function hasSurfaceFile(report: SemanticKernelSurfaceReport, path: string): boolean {
  return report.families.some((family) => family.files.some((file) => file.path === path));
}

function readSurfaceDependencyNames(
  report: SemanticKernelSurfaceReport,
  consumer: string,
  producer: string,
): string[] {
  const file = report.families
    .flatMap((family) => family.files)
    .find((candidate) => candidate.path === consumer);
  if (file === undefined) return [];
  const names = [
    ...(file.namedImports.find((dependency) => dependency.path === producer)?.names ?? []),
    ...(file.namedExports.find((dependency) => dependency.path === producer)?.names ?? []),
  ];
  return [...new Set(names)].sort(compareKernelCanonicalKey);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length > 0 &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

export async function readProtectedSemanticKernelSurfaceReport(
  reportPath: string,
  baseRef = process.env.APERTURE_SEMANTIC_KERNEL_SURFACE_BASE_REF ?? "origin/main",
  root = repoRoot,
): Promise<SemanticKernelSurfaceReport | null> {
  if (baseRef.length === 0) {
    throw new Error(
      "Semantic kernel surface base ref cannot be empty. Omit APERTURE_SEMANTIC_KERNEL_SURFACE_BASE_REF to use origin/main.",
    );
  }

  const relativeReportPath = relative(root, reportPath).replace(/\\/g, "/");
  if (relativeReportPath.startsWith("..")) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("git", ["show", `${baseRef}:${relativeReportPath}`]);
    return parseSemanticKernelSurfaceReport(String(stdout));
  } catch (error) {
    if (isProtectedBaseUnavailable(error)) {
      return null;
    }
    throw error;
  }
}

export function parseSemanticKernelSurfaceReport(source: string): SemanticKernelSurfaceReport {
  const report = JSON.parse(source) as SemanticKernelSurfaceReport;
  if (
    report.schemaVersion !== SEMANTIC_KERNEL_SURFACE_SCHEMA_VERSION ||
    report.profile?.id !== SEMANTIC_KERNEL_SURFACE_PROFILE_ID ||
    !Array.isArray(report.families)
  ) {
    throw new Error("Invalid semantic kernel surface report.");
  }
  return report;
}

async function summarizeManifestFiles(
  root: string,
  manifest: ManifestIndex,
): Promise<SemanticKernelSurfaceFileSummary[]> {
  const files = await Promise.all(
    [...manifest.fileToFamily.keys()].map(async (file) => summarizeSurfaceFile(root, file)),
  );
  return files.sort((left, right) => compareKernelCanonicalKey(left.path, right.path));
}

async function summarizeCoreConsumerFiles(
  root: string,
): Promise<SemanticKernelSurfaceFileSummary[]> {
  const sourceRoot = resolve(root, "packages/core/src");
  const files = await collectTypeScriptFiles(sourceRoot);
  const summaries = await Promise.all(
    files.map(async (file) => summarizeSurfaceFile(root, relative(root, file).replace(/\\/g, "/"))),
  );
  return summaries.sort((left, right) => compareKernelCanonicalKey(left.path, right.path));
}

async function summarizeSurfaceFile(
  root: string,
  relativePath: string,
): Promise<SemanticKernelSurfaceFileSummary> {
  const source = await readFile(resolve(root, relativePath), "utf8");
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const exportedDetectorNames = new Set<string>();
  const namedImports = new Map<string, Set<string>>();
  const namedImportBindings = new Map<string, Map<string, SemanticKernelSurfaceImportBinding>>();
  const namedExports = new Map<string, Set<string>>();
  const namedExportBindings = new Map<string, Map<string, SemanticKernelSurfaceReExportBinding>>();
  const localExports: SemanticKernelSurfaceLocalExportBinding[] = [];
  let regexSites = 0;
  let phraseMatcherCalls = 0;

  function visit(node: ts.Node): void {
    if (isExportedDetectorFunction(node)) {
      exportedDetectorNames.add(node.name.text);
    }
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isDetectorName(declaration.name.text)) {
          exportedDetectorNames.add(declaration.name.text);
        }
      }
    }
    if (ts.isImportDeclaration(node)) {
      const importPath = readRelativeImportPath(root, relativePath, node);
      if (importPath !== null) {
        const names = namedImports.get(importPath) ?? new Set<string>();
        const bindingsByName = namedImportBindings.get(importPath) ?? new Map();
        for (const binding of readNamedImportBindings(node)) {
          names.add(binding.sourceName);
          bindingsByName.set(readImportBindingKey(binding), binding);
        }
        namedImports.set(importPath, names);
        namedImportBindings.set(importPath, bindingsByName);
      }
    }
    if (ts.isExportDeclaration(node)) {
      const exportPath = readRelativeExportPath(root, relativePath, node);
      const bindings = readNamedExportBindings(node);
      if (exportPath !== null) {
        const names = namedExports.get(exportPath) ?? new Set<string>();
        const bindingsByName = namedExportBindings.get(exportPath) ?? new Map();
        for (const binding of bindings) {
          names.add(binding.exportedName);
          bindingsByName.set(readReExportBindingKey(binding), binding);
        }
        namedExports.set(exportPath, names);
        namedExportBindings.set(exportPath, bindingsByName);
      } else {
        for (const binding of bindings) {
          localExports.push({
            localName: binding.sourceName,
            exportedName: binding.exportedName,
          });
        }
      }
    }
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      regexSites += 1;
    }
    if (ts.isNewExpression(node) && node.expression.getText(sourceFile) === "RegExp") {
      regexSites += 1;
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "containsAnySemanticPhrase"
    ) {
      phraseMatcherCalls += 1;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  const dependencyPaths = new Set([...namedImports.keys(), ...namedExports.keys()]);

  return {
    path: relativePath,
    modules: 1,
    totalLines: source.split("\n").length,
    matcherSites: regexSites + phraseMatcherCalls,
    phraseMatcherCalls,
    regexSites,
    phraseLiterals: countSemanticPhraseLiteralsInSourceFile(sourceFile),
    exportedDetectors: exportedDetectorNames.size,
    dependencyFanOut: dependencyPaths.size,
    exportedDetectorNames: [...exportedDetectorNames].sort(compareKernelCanonicalKey),
    imports: [...dependencyPaths].sort(compareKernelCanonicalKey),
    namedImports: [...namedImports.entries()]
      .map(([path, names]) => ({
        path,
        names: [...names].sort(compareKernelCanonicalKey),
        bindings: [...(namedImportBindings.get(path)?.values() ?? [])].sort(compareImportBinding),
      }))
      .sort((left, right) => compareKernelCanonicalKey(left.path, right.path)),
    namedExports: [...namedExports.entries()]
      .map(([path, names]) => ({
        path,
        names: [...names].sort(compareKernelCanonicalKey),
        bindings: [...(namedExportBindings.get(path)?.values() ?? [])].sort(compareReExportBinding),
      }))
      .sort((left, right) => compareKernelCanonicalKey(left.path, right.path)),
    localExports: localExports.sort(compareLocalExportBinding),
    crossFamilyImports: [],
  };
}

function applyDetectorExportProvenance(
  files: SemanticKernelSurfaceFileSummary[],
  manifest: ManifestIndex,
): SemanticKernelSurfaceFileSummary[] {
  const provenanceByFile = buildDetectorExportProvenance(files, manifest);
  return files
    .map((file) => {
      const exportedDetectorNames = [...(provenanceByFile.get(file.path)?.keys() ?? [])].sort(
        compareKernelCanonicalKey,
      );
      return {
        ...file,
        exportedDetectorNames,
        exportedDetectors: exportedDetectorNames.length,
      };
    })
    .sort((left, right) => compareKernelCanonicalKey(left.path, right.path));
}

function buildDetectorExportProvenance(
  files: SemanticKernelSurfaceFileSummary[],
  manifest: ManifestIndex,
): Map<string, Map<string, DetectorExportProvenance>> {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const provenanceByFile = new Map<string, Map<string, DetectorExportProvenance>>();

  for (const file of files) {
    const family = manifest.fileToFamily.get(file.path);
    const detectorProvenance = new Map<string, DetectorExportProvenance>();
    if (family !== undefined) {
      for (const name of file.exportedDetectorNames) {
        detectorProvenance.set(name, { path: file.path, family });
      }
    }
    provenanceByFile.set(file.path, detectorProvenance);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const file of files) {
      const fileProvenance = provenanceByFile.get(file.path);
      if (fileProvenance === undefined) {
        continue;
      }
      for (const exported of file.namedExports) {
        if (!fileByPath.has(exported.path)) {
          continue;
        }
        const sourceProvenance = provenanceByFile.get(exported.path);
        if (sourceProvenance === undefined) {
          continue;
        }
        for (const binding of exported.bindings) {
          const provenance = sourceProvenance.get(binding.sourceName);
          if (provenance !== undefined && !fileProvenance.has(binding.exportedName)) {
            fileProvenance.set(binding.exportedName, provenance);
            changed = true;
          }
        }
      }
      const localProvenance = buildLocalImportDetectorProvenance(file, provenanceByFile);
      for (const binding of file.localExports) {
        const provenance = localProvenance.get(binding.localName);
        if (provenance !== undefined && !fileProvenance.has(binding.exportedName)) {
          fileProvenance.set(binding.exportedName, provenance);
          changed = true;
        }
      }
    }
  }

  return provenanceByFile;
}

function buildFamilySummaries(
  files: SemanticKernelSurfaceFileSummary[],
): SemanticKernelSurfaceFamilySummary[] {
  const manifest = buildManifestIndex();
  const byFamily = new Map<SemanticKernelSurfaceFamily, SemanticKernelSurfaceFileSummary[]>();

  for (const file of files) {
    const family = manifest.fileToFamily.get(file.path);
    if (family === undefined) {
      continue;
    }
    const crossFamilyImports = file.imports
      .map((importPath) => manifest.fileToFamily.get(importPath))
      .filter(
        (importFamily): importFamily is SemanticKernelSurfaceFamily =>
          importFamily !== undefined && importFamily !== family,
      )
      .sort(compareKernelCanonicalKey);
    const withCrossFamilyImports = {
      ...file,
      crossFamilyImports: [...new Set(crossFamilyImports)],
    };
    byFamily.set(family, [...(byFamily.get(family) ?? []), withCrossFamilyImports]);
  }

  return [...byFamily.entries()]
    .map(([id, familyFiles]) => ({
      id,
      ...sumMetrics(familyFiles),
      files: familyFiles.sort((left, right) => compareKernelCanonicalKey(left.path, right.path)),
    }))
    .sort((left, right) => compareKernelCanonicalKey(left.id, right.id));
}

function buildImportSummary(
  files: SemanticKernelSurfaceFileSummary[],
  consumerFiles: SemanticKernelSurfaceFileSummary[],
  manifest: ManifestIndex,
): SemanticKernelSurfaceReport["imports"] {
  const detectorProvenanceByFile = buildDetectorExportProvenance(files, manifest);
  const crossFamilyEdgeCounts = new Map<string, SemanticKernelSurfaceCrossFamilyEdge>();
  const crossFamilyImportEdges: SemanticKernelSurfaceConcreteCrossFamilyEdge[] = [];
  const detectorConsumersOutsideFamily: SemanticKernelSurfaceDetectorConsumer[] = [];
  const normalizedObservationDirectConsumers = consumerFiles
    .filter((file) => file.imports.includes("packages/core/src/normalized-observation.ts"))
    .map((file) => file.path)
    .sort(compareKernelCanonicalKey);

  for (const file of consumerFiles) {
    const family = manifest.fileToFamily.get(file.path) ?? "core";
    const namesByProducer = new Map<
      string,
      {
        producer: string;
        producerFamily: SemanticKernelSurfaceFamily;
        names: Set<string>;
      }
    >();
    if (family !== "core") {
      for (const importPath of file.imports) {
        const importedFamily = manifest.fileToFamily.get(importPath);
        if (importedFamily !== undefined && importedFamily !== family) {
          crossFamilyImportEdges.push({
            consumer: file.path,
            consumerFamily: family,
            producer: importPath,
            producerFamily: importedFamily,
          });
          const key = `${family}->${importedFamily}`;
          const edge = crossFamilyEdgeCounts.get(key) ?? {
            from: family,
            to: importedFamily,
            count: 0,
          };
          edge.count += 1;
          crossFamilyEdgeCounts.set(key, edge);
        }
      }
    }
    for (const dependency of readNamedDependencies(file)) {
      const importedProvenance = detectorProvenanceByFile.get(dependency.path);
      if (importedProvenance === undefined) {
        continue;
      }
      for (const name of dependency.names) {
        const provenance = importedProvenance.get(name);
        if (provenance === undefined || provenance.family === family) {
          continue;
        }
        const key = `${provenance.path}:${provenance.family}`;
        const namesForProducer = namesByProducer.get(key) ?? {
          producer: provenance.path,
          producerFamily: provenance.family,
          names: new Set<string>(),
        };
        namesForProducer.names.add(name);
        namesByProducer.set(key, namesForProducer);
      }
    }
    for (const namesForProducer of namesByProducer.values()) {
      detectorConsumersOutsideFamily.push({
        consumer: file.path,
        consumerFamily: family,
        producer: namesForProducer.producer,
        producerFamily: namesForProducer.producerFamily,
        names: [...namesForProducer.names].sort(compareKernelCanonicalKey),
      });
    }
  }

  return {
    crossFamilyEdges: [...crossFamilyEdgeCounts.values()].sort(
      (left, right) =>
        compareKernelCanonicalKey(left.from, right.from) ||
        compareKernelCanonicalKey(left.to, right.to),
    ),
    crossFamilyImportEdges: crossFamilyImportEdges.sort(
      (left, right) =>
        compareKernelCanonicalKey(left.consumer, right.consumer) ||
        compareKernelCanonicalKey(left.producer, right.producer),
    ),
    detectorConsumersOutsideFamily: detectorConsumersOutsideFamily.sort(
      (left, right) =>
        compareKernelCanonicalKey(left.consumer, right.consumer) ||
        compareKernelCanonicalKey(left.producer, right.producer),
    ),
    normalizedObservationDirectConsumers,
  };
}

function collectSurfaceFailures(
  summary: SemanticKernelSurfaceMetrics,
  architecture: SemanticKernelArchitectureMetrics,
  imports: SemanticKernelSurfaceReport["imports"],
  families: SemanticKernelSurfaceFamilySummary[],
): string[] {
  const failures: string[] = [];
  pushMaximumFailure(failures, "modules", summary.modules, "maximumModules");
  pushMaximumFailure(failures, "total_lines", summary.totalLines, "maximumTotalLines");
  pushMaximumFailure(failures, "matcher_sites", summary.matcherSites, "maximumMatcherSites");
  pushMaximumFailure(failures, "phrase_literals", summary.phraseLiterals, "maximumPhraseLiterals");
  pushMaximumFailure(
    failures,
    "exported_detectors",
    summary.exportedDetectors,
    "maximumExportedDetectors",
  );
  pushMaximumFailure(
    failures,
    "normalized_observation_direct_consumers",
    imports.normalizedObservationDirectConsumers.length,
    "maximumNormalizedObservationDirectConsumers",
  );

  for (const file of architecture.missingManifestFiles) {
    failures.push(`surface:missing_family:${file}`);
  }
  for (const family of families) {
    if (family.modules > SEMANTIC_KERNEL_SURFACE_THRESHOLDS.maximumFamilyModules) {
      failures.push(
        `surface:family_modules:${family.id}:${family.modules}>${SEMANTIC_KERNEL_SURFACE_THRESHOLDS.maximumFamilyModules}`,
      );
    }
  }

  return failures;
}

function pushMaximumFailure(
  failures: string[],
  label: string,
  value: number,
  threshold: keyof typeof SEMANTIC_KERNEL_SURFACE_THRESHOLDS,
): void {
  const maximum = SEMANTIC_KERNEL_SURFACE_THRESHOLDS[threshold];
  if (value > maximum) {
    failures.push(`surface:${label}:${value}>${maximum}`);
  }
}

function sumMetrics(files: SemanticKernelSurfaceMetrics[]): SemanticKernelSurfaceMetrics {
  return {
    modules: sum(files.map((file) => file.modules)),
    totalLines: sum(files.map((file) => file.totalLines)),
    matcherSites: sum(files.map((file) => file.matcherSites)),
    phraseMatcherCalls: sum(files.map((file) => file.phraseMatcherCalls)),
    regexSites: sum(files.map((file) => file.regexSites)),
    phraseLiterals: sum(files.map((file) => file.phraseLiterals)),
    exportedDetectors: sum(files.map((file) => file.exportedDetectors)),
    dependencyFanOut: sum(files.map((file) => file.dependencyFanOut)),
  };
}

async function collectSemanticKernelSurfaceCandidateFiles(root: string): Promise<string[]> {
  const sourceRoot = resolve(root, "packages/core/src");
  const files = await collectTypeScriptFiles(sourceRoot);
  return files
    .map((file) => relative(root, file).replace(/\\/g, "/"))
    .filter(isSemanticKernelSurfacePath)
    .sort(compareKernelCanonicalKey);
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

function isSemanticKernelSurfacePath(path: string): boolean {
  const basename = path.split("/").at(-1) ?? "";
  return (
    /^semantic.*\.ts$/.test(basename) ||
    /^judgment-observation.*\.ts$/.test(basename) ||
    /^observation.*\.ts$/.test(basename) ||
    /^observational.*\.ts$/.test(basename) ||
    basename === "normalized-observation.ts" ||
    /^task-failure-observation.*\.ts$/.test(basename)
  );
}

function isCoreSemanticModulePath(path: string): boolean {
  const basename = path.split("/").at(-1) ?? "";
  return /^packages\/core\/src\/semantic\//.test(path) || /^semantic.*\.ts$/.test(basename);
}

async function countFilesLines(root: string, files: readonly string[]): Promise<number> {
  const lineCounts = await Promise.all(
    files.map(async (file) => (await readFile(resolve(root, file), "utf8")).split("\n").length),
  );
  return sum(lineCounts);
}

async function countAbsoluteFilesLines(files: readonly string[]): Promise<number> {
  const lineCounts = await Promise.all(
    files.map(async (file) => (await readFile(file, "utf8")).split("\n").length),
  );
  return sum(lineCounts);
}

function buildManifestIndex(
  entries: readonly SemanticKernelSurfaceManifestEntry[] = SEMANTIC_KERNEL_SURFACE_MANIFEST,
): ManifestIndex {
  const fileToFamily = new Map<string, SemanticKernelSurfaceFamily>();
  for (const entry of entries) {
    for (const file of entry.files) {
      if (fileToFamily.has(file)) {
        throw new Error(`Duplicate semantic kernel surface manifest entry: ${file}`);
      }
      fileToFamily.set(file, entry.family);
    }
  }
  return { fileToFamily };
}

type ManifestIndex = {
  fileToFamily: Map<string, SemanticKernelSurfaceFamily>;
};

function readRelativeImportPath(
  root: string,
  importer: string,
  node: ts.ImportDeclaration,
): string | null {
  if (!ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }
  const specifier = node.moduleSpecifier.text;
  if (!specifier.startsWith(".")) {
    return null;
  }
  const resolved = resolve(dirname(resolve(root, importer)), specifier).replace(/\.js$/, ".ts");
  const relativePath = relative(root, resolved).replace(/\\/g, "/");
  return relativePath.startsWith("packages/core/src/") ? relativePath : null;
}

function readRelativeExportPath(
  root: string,
  exporter: string,
  node: ts.ExportDeclaration,
): string | null {
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) {
    return null;
  }
  const specifier = node.moduleSpecifier.text;
  if (!specifier.startsWith(".")) {
    return null;
  }
  const resolved = resolve(dirname(resolve(root, exporter)), specifier).replace(/\.js$/, ".ts");
  const relativePath = relative(root, resolved).replace(/\\/g, "/");
  return relativePath.startsWith("packages/core/src/") ? relativePath : null;
}

function readNamedImportBindings(node: ts.ImportDeclaration): SemanticKernelSurfaceImportBinding[] {
  const clause = node.importClause;
  if (clause === undefined) {
    return [];
  }

  const bindings: SemanticKernelSurfaceImportBinding[] = [];
  if (clause.name !== undefined) {
    bindings.push({
      sourceName: clause.name.text,
      localName: clause.name.text,
    });
  }
  if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      bindings.push({
        sourceName: (element.propertyName ?? element.name).text,
        localName: element.name.text,
      });
    }
  }
  return bindings;
}

function readNamedExportBindings(
  node: ts.ExportDeclaration,
): SemanticKernelSurfaceReExportBinding[] {
  const clause = node.exportClause;
  if (clause === undefined || !ts.isNamedExports(clause)) {
    return [];
  }

  return clause.elements.map((element) => ({
    sourceName: (element.propertyName ?? element.name).text,
    exportedName: element.name.text,
  }));
}

function countSemanticPhraseLiteralsInSourceFile(sourceFile: ts.SourceFile): number {
  let phraseLiterals = 0;

  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && isPhraseTableName(declaration.name.text)) {
          phraseLiterals += countStringLiteralElements(declaration.initializer);
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile) === "containsAnySemanticPhrase"
    ) {
      for (const argument of node.arguments.slice(1)) {
        phraseLiterals += countStringLiteralElements(argument);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return phraseLiterals;
}

function readCrossFamilyEdgeKey(edge: SemanticKernelSurfaceCrossFamilyEdge): string {
  return `${edge.from}->${edge.to}`;
}

function readConcreteCrossFamilyEdgeKey(
  edge: SemanticKernelSurfaceConcreteCrossFamilyEdge,
): string {
  return `${edge.consumer}:${edge.consumerFamily}->${edge.producer}:${edge.producerFamily}`;
}

function readDetectorConsumerKeys(consumer: SemanticKernelSurfaceDetectorConsumer): string[] {
  return consumer.names.map(
    (name) =>
      `${consumer.consumer}:${consumer.consumerFamily}->${consumer.producer}:${consumer.producerFamily}:${name}`,
  );
}

function readNamedDependencies(file: SemanticKernelSurfaceFileSummary): Array<{
  path: string;
  names: string[];
}> {
  return [
    ...file.namedImports.map((dependency) => ({
      path: dependency.path,
      names: dependency.bindings.map((binding) => binding.sourceName),
    })),
    ...file.namedExports.map((dependency) => ({
      path: dependency.path,
      names: dependency.bindings.map((binding) => binding.sourceName),
    })),
  ];
}

function buildLocalImportDetectorProvenance(
  file: SemanticKernelSurfaceFileSummary,
  provenanceByFile: Map<string, Map<string, DetectorExportProvenance>>,
): Map<string, DetectorExportProvenance> {
  const localProvenance = new Map<string, DetectorExportProvenance>();
  for (const imported of file.namedImports) {
    const importedProvenance = provenanceByFile.get(imported.path);
    if (importedProvenance === undefined) {
      continue;
    }
    for (const binding of imported.bindings) {
      const provenance = importedProvenance.get(binding.sourceName);
      if (provenance !== undefined) {
        localProvenance.set(binding.localName, provenance);
      }
    }
  }
  return localProvenance;
}

function readImportBindingKey(binding: SemanticKernelSurfaceImportBinding): string {
  return `${binding.sourceName}:${binding.localName}`;
}

function readReExportBindingKey(binding: SemanticKernelSurfaceReExportBinding): string {
  return `${binding.sourceName}:${binding.exportedName}`;
}

function compareImportBinding(
  left: SemanticKernelSurfaceImportBinding,
  right: SemanticKernelSurfaceImportBinding,
): number {
  return (
    compareKernelCanonicalKey(left.sourceName, right.sourceName) ||
    compareKernelCanonicalKey(left.localName, right.localName)
  );
}

function compareReExportBinding(
  left: SemanticKernelSurfaceReExportBinding,
  right: SemanticKernelSurfaceReExportBinding,
): number {
  return (
    compareKernelCanonicalKey(left.sourceName, right.sourceName) ||
    compareKernelCanonicalKey(left.exportedName, right.exportedName)
  );
}

function compareLocalExportBinding(
  left: SemanticKernelSurfaceLocalExportBinding,
  right: SemanticKernelSurfaceLocalExportBinding,
): number {
  return (
    compareKernelCanonicalKey(left.localName, right.localName) ||
    compareKernelCanonicalKey(left.exportedName, right.exportedName)
  );
}

function isExportedDetectorFunction(node: ts.Node): node is ts.FunctionDeclaration & {
  name: ts.Identifier;
} {
  return (
    ts.isFunctionDeclaration(node) &&
    node.name !== undefined &&
    hasExportModifier(node) &&
    isDetectorName(node.name.text)
  );
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function isDetectorName(name: string): boolean {
  return DETECTOR_PREFIXES.some(
    (prefix) => name.startsWith(prefix) && /[A-Z]/.test(name[prefix.length] ?? ""),
  );
}

function isPhraseTableName(name: string): boolean {
  return /^[A-Z0-9_]*(?:PHRASES|NEGATIONS)$/.test(name);
}

function countStringLiteralElements(initializer: ts.Expression | undefined): number {
  const expression = unwrapExpression(initializer);
  if (!expression || !ts.isArrayLiteralExpression(expression)) {
    return 0;
  }
  return expression.elements.filter((element) => ts.isStringLiteralLike(element)).length;
}

function unwrapExpression(expression: ts.Expression | undefined): ts.Expression | undefined {
  let current = expression;
  while (current !== undefined) {
    if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
  return undefined;
}

function isProtectedBaseUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    ("code" in error || "stderr" in error) &&
    /(?:exists on disk, but not in|path .* does not exist)/i.test(
      String((error as { stderr?: unknown }).stderr ?? error.message),
    )
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
