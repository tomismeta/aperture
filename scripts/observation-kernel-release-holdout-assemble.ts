import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import {
  digestKernelCanonicalJson,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/kernel-canonical-json.js";
import { isDirectExecution } from "./direct-execution.js";

const SOURCE_PATH = "packages/lab/conformance/observation-kernel-holdout-v5.json";
const TARGET_PATH = "packages/lab/conformance/observation-kernel-release-holdout.json";

type HistoricalFixture = {
  id: string;
  dimension: string;
  split: "holdout";
  events: Array<Record<string, unknown>>;
  expected: unknown[];
  rationale: string;
};

export async function assembleObservationKernelReleaseHoldout(): Promise<void> {
  const historical = JSON.parse(await readFile(SOURCE_PATH, "utf8")) as {
    methodology: Record<string, unknown>;
    fixtures: HistoricalFixture[];
  };
  const byId = new Map(historical.fixtures.map((fixture) => [fixture.id, fixture]));
  const seedFixtures = historical.fixtures.map((fixture) => {
    const slug = fixture.id.replace(/^holdout-v5-/, "");
    const event = fixture.events[0];
    return {
      id: `holdout-release-seed-${slug}`,
      dimension: `seed-${fixture.dimension}`,
      split: "holdout" as const,
      events: [
        {
          ...event,
          id: `event-release-seed-${slug}`,
          taskId: `task-release-seed-${slug}`,
        },
      ],
      expected: fixture.expected,
      rationale: `Historical regression retained as a release fixture: ${fixture.rationale}`,
    };
  });

  const freshFixtures = [
    freshFixture(
      "ordinary-word-boundary",
      "fallback-ordinary-word-boundary",
      byId.get("holdout-v5-fallback-complete-command-success"),
      "Verification notification",
      "Command notify completed successfully.\nExit code: 0.\nResult: completed successfully. The workflow includes if conditions in its ordinary log.",
      "A complete success remains stable when ordinary words contain the modal token `if`.",
    ),
    freshFixture(
      "complete-runtime-boundary",
      "fallback-complete-runtime-boundary",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution stopped with a complete runtime diagnostic",
      "The process crashed after allocator exhaustion. Exit status 71; the complete runtime diagnostic was captured in stderr.",
      "A complete runtime diagnostic remains visible without matching an incomplete diagnostic prefix.",
    ),
    freshFixture(
      "incomplete-diagnostic-abstention",
      "fallback-incomplete-diagnostic-abstention",
      byId.get("holdout-v5-fallback-quoted-incomplete"),
      "Command failure evidence is incomplete",
      'The incomplete diagnostic is only a quoted template: "RuntimeError: sample". No complete diagnostic is asserted.',
      "An incomplete diagnostic shape abstains rather than promoting a diagnostic-looking fragment.",
    ),
    freshFixture(
      "title-summary-abstention",
      "fallback-title-summary-abstention",
      byId.get("holdout-v5-fallback-quoted-incomplete"),
      "Transport failure",
      'The source text contains the quoted phrase "no output command exit code 7"; no asserted execution result exists.',
      "A generic title cannot override quotation and assertion scope in the summary, including outcome-only fallback text.",
    ),
    freshFixture(
      "negation-then-runtime",
      "fallback-negation-then-runtime",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution produced a terminal diagnostic",
      "No runtime failure occurred during setup, but the process then crashed with RuntimeError: worker exited. Exit code 2.",
      "A later asserted runtime diagnostic remains authoritative after an earlier negated clause.",
    ),
    freshFixture(
      "continued-diagnostic",
      "fallback-continued-diagnostic",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution returned a terminal diagnostic",
      "The command was expected to fail, but it crashed with RuntimeError at line 5 and returned the complete diagnostic.",
      "An asserted diagnostic remains authoritative when a later terminal clause continues an expected execution without repeating its subject.",
    ),
    freshFixture(
      "hypothetical-diagnostic",
      "fallback-hypothetical-diagnostic",
      byId.get("holdout-v5-fallback-indeterminate-failure"),
      "Hypothetical runtime result",
      "If execution were attempted, a runtime failure might occur; no command ran and no result exists.",
      "Hypothetical and blocked execution language remains indeterminate.",
    ),
    freshFixture(
      "source-window-boundary",
      "fallback-source-window-boundary",
      byId.get("holdout-v5-fallback-bounded-source-window"),
      "Only a bounded source window was returned",
      "Read failed: source limit reached. Returned lines 41-80 of 400; additional source was omitted.",
      "Measured source omission remains a bounded evidence loss independent of capability identity.",
    ),
    freshFixture(
      "flattened-ordinary-words",
      "fallback-flattened-ordinary-words",
      byId.get("holdout-v5-fallback-complete-command-success"),
      "Verification notification",
      "Command notify completed successfully. Exit code: 0. Result: completed successfully. The workflow includes if conditions in its ordinary log.",
      "Whitespace and ordinary-word presentation changes preserve the same terminal success shape.",
    ),
  ];

  const fixtures = [...seedFixtures, ...freshFixtures];
  if (fixtures.length !== 33) throw new Error(`Expected 33 fixtures, received ${fixtures.length}.`);
  const methodology = {
    schemaVersion: 1,
    artifactKind: "release_holdout",
    holdoutId: "observation-kernel-release-holdout-20260813",
    releaseTarget: "next-core-release",
    observationContractId: historical.methodology.observationContractId,
    observationContractDigest: await sha256File("docs/engine/observation-judgment-contract-v1.md"),
    sourceEvidenceContractId: historical.methodology.sourceEvidenceContractId,
    sourceEvidenceContractDigest: await sha256File("docs/engine/source-evidence-contract-v1.md"),
    outputContractId: historical.methodology.outputContractId,
    outputContractDigest: await sha256File(
      "packages/lab/conformance/observation-kernel-holdout-v5-output-contract.json",
    ),
    implementationFreeze:
      process.env.APERTURE_IMPLEMENTATION_FREEZE ?? "0000000000000000000000000000000000000000",
    fixtureCount: 33,
    typedEvidenceFixtureCount: 12,
    structuralFallbackFixtureCount: 21,
    oracleProvenance: {
      author: "aperture-maintainer",
      authoredWithoutExecution: true,
      authoredWithoutImplementationInspection: false,
      authoredWithoutPriorOracleInspection: false,
      authoredWithoutCalibrationInspection: false,
      notes: [
        "This active holdout is an honest release regression and hardening set, not an independent oracle claim.",
        "Twelve historical regression shapes are retained and nine new fallback shapes target the repaired grammar.",
        "An independent adversarial re-audit remains required before publication.",
      ],
    },
    notes: [
      "The artifact is sealed after the semantic hardening implementation freeze and before first execution.",
      "The release gate compares semantic fields, judgment fields, decision fields, outcome counts, and repeated-run digests.",
    ],
  };
  const artifact = { methodology, fixtures };
  await writeFile(TARGET_PATH, `${serializeKernelCanonicalJson(artifact)}\n`, "utf8");
  process.stdout.write(`${digestKernelCanonicalJson(artifact)}\n`);
}

async function sha256File(path: string): Promise<string> {
  return `sha256:${createHash("sha256")
    .update(await readFile(path))
    .digest("hex")}`;
}

function freshFixture(
  slug: string,
  dimension: string,
  base: HistoricalFixture | undefined,
  title: string,
  summary: string,
  rationale: string,
) {
  if (base === undefined) throw new Error(`Missing historical base fixture for ${slug}.`);
  const baseEvent = base.events[0];
  return {
    id: `holdout-release-${slug}`,
    dimension,
    split: "holdout" as const,
    events: [
      {
        ...baseEvent,
        id: `event-release-${slug}`,
        taskId: `task-release-${slug}`,
        title,
        summary,
      },
    ],
    expected: base.expected,
    rationale,
  };
}

if (isDirectExecution(import.meta.url)) {
  void assembleObservationKernelReleaseHoldout().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
