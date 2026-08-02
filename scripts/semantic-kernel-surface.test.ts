import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SEMANTIC_KERNEL_SURFACE_MANIFEST,
  buildSemanticKernelSurfaceComparison,
  buildSemanticKernelSurfaceReport,
  countSemanticMatcherSites,
  countSemanticPhraseLiterals,
  inspectSemanticKernelSurfaceForTest,
  readProtectedSemanticKernelSurfaceReport,
  type SemanticKernelSurfaceReport,
} from "./semantic-kernel-surface-support.ts";

test("semantic kernel surface report covers every declared family", async () => {
  const report = await buildSemanticKernelSurfaceReport();
  const expectedFamilies = SEMANTIC_KERNEL_SURFACE_MANIFEST.map((entry) => entry.family).sort();
  const actualFamilies = report.families.map((family) => family.id).sort();

  assert.equal(report.passed, true, report.failures.join(", "));
  assert.deepEqual(actualFamilies, expectedFamilies);
  assert.equal(
    report.summary.modules,
    report.families.reduce((total, family) => total + family.modules, 0),
  );
  assert.equal(report.summary.semanticModules > 0, true);
  assert.equal(report.summary.observationPrimitiveLines > 0, true);
  assert.equal(report.summary.taskFailureParsingLines > 0, true);
  assert.deepEqual(report.imports.normalizedObservationDirectConsumers, [
    "packages/core/src/judgment-input-types.ts",
    "packages/core/src/judgment-input.ts",
    "packages/core/src/observational-status-conflict-kind.ts",
    "packages/core/src/task-failure-observation-normalizer.ts",
    "packages/core/src/task-failure-observation-reader.ts",
    "packages/core/src/trace-recorder.ts",
  ]);
});

test("semantic kernel surface scanner counts matcher sites from syntax", () => {
  assert.equal(
    countSemanticMatcherSites(`
      const literal = /^error: failed$/i;
      const dynamic = new RegExp("failure", "i");
      if (containsAnySemanticPhrase(text, FAILURE_PHRASES)) return true;
      const text = "new RegExp('not syntax')";
      // /^commented$/i
    `),
    3,
  );
});

test("semantic kernel surface scanner counts governed phrase literals from syntax", () => {
  assert.equal(
    countSemanticPhraseLiterals(`
      export const FAILURE_PHRASES = [
        "cannot continue",
        'blocked on',
        // "commented phrase"
      ] as const;
      const ORDINARY_VALUES = ["not a phrase table"] as const;
      export const SAFE_NEGATIONS = ["no action needed"] satisfies readonly string[];
      containsAnySemanticPhrase(text, ["inline one", "inline two"] as const);
    `),
    5,
  );
});

test("semantic kernel surface comparison rejects semantic surface growth", async () => {
  const baseline = await buildSemanticKernelSurfaceReport();
  const candidate: SemanticKernelSurfaceReport = {
    ...baseline,
    summary: {
      ...baseline.summary,
      totalLines: baseline.summary.totalLines + 1,
      dependencyFanOut: baseline.summary.dependencyFanOut + 1,
      observationPrimitiveLines: baseline.summary.observationPrimitiveLines + 1,
    },
    imports: {
      ...baseline.imports,
      detectorConsumersOutsideFamily: [
        ...baseline.imports.detectorConsumersOutsideFamily,
        {
          consumer: "packages/core/src/semantic-interpreter.ts",
          consumerFamily: "ontology_interpretation",
          producer: "packages/core/src/semantic-detection.ts",
          producerFamily: "shared_lexical_parser",
          names: ["detectExample"],
        },
      ],
    },
    families: baseline.families.map((family, index) =>
      index === 0
        ? {
            ...family,
            matcherSites: family.matcherSites + 1,
            exportedDetectors: family.exportedDetectors + 1,
          }
        : family,
    ),
  };

  const comparison = buildSemanticKernelSurfaceComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(comparison.failures.join("\n"), /surface_comparison:total_lines/);
  assert.match(comparison.failures.join("\n"), /surface_comparison:dependency_fan_out/);
  assert.match(comparison.failures.join("\n"), /surface_comparison:observation_primitive_lines/);
  assert.match(
    comparison.failures.join("\n"),
    /surface_comparison:detector_consumers_outside_family/,
  );
  assert.match(comparison.failures.join("\n"), /surface_comparison:family_matcher_sites/);
  assert.match(comparison.failures.join("\n"), /surface_comparison:family_exported_detectors/);
});

test("semantic kernel surface comparison rejects new identities without total growth", async () => {
  const baseline = await buildSemanticKernelSurfaceReport();
  const [firstEdge, ...remainingEdges] = baseline.imports.crossFamilyEdges;
  assert.notEqual(firstEdge, undefined);
  const existingEdgeKeys = new Set(
    baseline.imports.crossFamilyEdges.map((edge) => `${edge.from}->${edge.to}`),
  );
  const families = SEMANTIC_KERNEL_SURFACE_MANIFEST.map((entry) => entry.family);
  const replacementEdge = families.flatMap((from) =>
    families
      .filter((to) => to !== from && !existingEdgeKeys.has(`${from}->${to}`))
      .map((to) => ({ from, to })),
  )[0];
  assert.ok(replacementEdge);

  const candidate: SemanticKernelSurfaceReport = {
    ...baseline,
    imports: {
      ...baseline.imports,
      crossFamilyEdges: [
        ...remainingEdges,
        {
          from: replacementEdge.from,
          to: replacementEdge.to,
          count: 1,
        },
      ],
      normalizedObservationDirectConsumers: [
        ...baseline.imports.normalizedObservationDirectConsumers.slice(1),
        "packages/core/src/aperture-core.ts",
      ],
    },
  };

  const comparison = buildSemanticKernelSurfaceComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(comparison.failures.join("\n"), /surface_comparison:new_cross_family_import/);
  assert.match(
    comparison.failures.join("\n"),
    /surface_comparison:new_normalized_observation_direct_consumer/,
  );
});

test("semantic kernel surface comparison rejects concrete import edge identity changes", async () => {
  const baseline = await buildSemanticKernelSurfaceReport();
  const [firstEdge, ...remainingEdges] = baseline.imports.crossFamilyImportEdges;
  assert.notEqual(firstEdge, undefined);

  const candidate: SemanticKernelSurfaceReport = {
    ...baseline,
    imports: {
      ...baseline.imports,
      crossFamilyImportEdges: [
        {
          ...firstEdge,
          producer: firstEdge.producer.replace(/\.ts$/, "-alternate.ts"),
        },
        ...remainingEdges,
      ],
    },
  };

  const comparison = buildSemanticKernelSurfaceComparison(baseline, candidate);

  assert.equal(comparison.passed, false);
  assert.match(comparison.failures.join("\n"), /surface_comparison:new_cross_family_import_edge/);
});

test("semantic kernel surface traces detector provenance through re-export barrels", async () => {
  const report = await buildSemanticKernelSurfaceReport();
  const observationShapeFile = report.families
    .flatMap((family) => family.files)
    .find((file) => file.path === "packages/core/src/semantic-observation-shapes.ts");
  assert.ok(observationShapeFile);
  assert.ok(
    observationShapeFile.exportedDetectorNames.includes("looksLikeStrongRawSourceObservation"),
  );

  const consumer = report.imports.detectorConsumersOutsideFamily.find(
    (entry) =>
      entry.consumer === "packages/core/src/semantic-observation-shapes.ts" &&
      entry.producer === "packages/core/src/semantic-source-observation-shapes.ts" &&
      entry.names.includes("looksLikeStrongRawSourceObservation"),
  );

  assert.ok(consumer);
  assert.equal(consumer.consumerFamily, "observation_payload");
  assert.equal(consumer.producerFamily, "source_read_listing_span");

  const barrelConsumer = report.imports.detectorConsumersOutsideFamily.find(
    (entry) =>
      entry.consumer === "packages/core/src/semantic-owned-observation-payload-shapes.ts" &&
      entry.producer === "packages/core/src/semantic-source-observation-shapes.ts" &&
      entry.names.includes("looksLikeStrongRawSourceObservation"),
  );
  assert.ok(barrelConsumer);
  assert.equal(barrelConsumer.consumerFamily, "observation_payload");
  assert.equal(barrelConsumer.producerFamily, "source_read_listing_span");
});

test("semantic kernel surface traces aliased and split re-export provenance", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-semantic-surface-"));
  const sourceRoot = join(root, "packages/core/src");
  await mkdir(sourceRoot, { recursive: true });

  await writeFile(
    join(sourceRoot, "semantic-source-alpha.ts"),
    `
      export function looksLikeSourceAlpha(value: string): boolean {
        return value.length > 0;
      }
    `,
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "semantic-barrel-direct.ts"),
    `
      export { looksLikeSourceAlpha as looksLikeDirectAlias } from "./semantic-source-alpha.js";
    `,
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "semantic-barrel-split.ts"),
    `
      import { looksLikeSourceAlpha as looksLikeSplitAlias } from "./semantic-source-alpha.js";
      export { looksLikeSplitAlias };
    `,
    "utf8",
  );
  await writeFile(
    join(sourceRoot, "semantic-consumer.ts"),
    `
      import { looksLikeDirectAlias } from "./semantic-barrel-direct.js";
      import { looksLikeSplitAlias } from "./semantic-barrel-split.js";

      export function looksLikeConsumer(value: string): boolean {
        return looksLikeDirectAlias(value) || looksLikeSplitAlias(value);
      }
    `,
    "utf8",
  );

  const inspection = await inspectSemanticKernelSurfaceForTest(root, [
    {
      family: "source_read_listing_span",
      files: ["packages/core/src/semantic-source-alpha.ts"],
    },
    {
      family: "observation_payload",
      files: [
        "packages/core/src/semantic-barrel-direct.ts",
        "packages/core/src/semantic-barrel-split.ts",
      ],
    },
    {
      family: "task_failure_grammar",
      files: ["packages/core/src/semantic-consumer.ts"],
    },
  ]);

  const filesByPath = new Map(inspection.files.map((file) => [file.path, file]));
  assert.deepEqual(
    filesByPath.get("packages/core/src/semantic-barrel-direct.ts")?.exportedDetectorNames,
    ["looksLikeDirectAlias"],
  );
  assert.deepEqual(
    filesByPath.get("packages/core/src/semantic-barrel-split.ts")?.exportedDetectorNames,
    ["looksLikeSplitAlias"],
  );

  const consumerEntry = inspection.imports.detectorConsumersOutsideFamily.find(
    (entry) =>
      entry.consumer === "packages/core/src/semantic-consumer.ts" &&
      entry.producer === "packages/core/src/semantic-source-alpha.ts",
  );
  assert.ok(consumerEntry);
  assert.deepEqual(consumerEntry.names, ["looksLikeDirectAlias", "looksLikeSplitAlias"]);
  assert.equal(consumerEntry.producerFamily, "source_read_listing_span");
});

test("semantic kernel surface protected base rejects empty ref", async () => {
  await assert.rejects(
    () => readProtectedSemanticKernelSurfaceReport("semantic-kernel-surface-v1.json", ""),
    /base ref cannot be empty/,
  );
});
