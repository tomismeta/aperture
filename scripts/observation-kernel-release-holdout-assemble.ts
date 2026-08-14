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
      "continued-reference-abstention",
      "fallback-continued-reference-abstention",
      byId.get("holdout-v5-fallback-indeterminate-failure"),
      "Execution reference remains unasserted",
      "The command was expected to fail, but the documentation says that it crashed with RuntimeError at line 5.",
      "A reference frame after expected setup remains indeterminate rather than becoming terminal execution evidence.",
    ),
    freshFixture(
      "continued-diagnostic-without-envelope",
      "fallback-continued-diagnostic-without-envelope",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution returned a terminal diagnostic",
      "The command was expected to fail, but it crashed with RuntimeError at line 5.",
      "An asserted continuation remains diagnostic even without a complete-diagnostic envelope.",
    ),
    freshFixture(
      "continued-title-reference-abstention",
      "fallback-continued-title-reference-abstention",
      byId.get("holdout-v5-fallback-indeterminate-failure"),
      "The documentation says execution failed.",
      "It crashed with RuntimeError at line 5 and returned the complete diagnostic.",
      "A reference-frame title cannot license a pronoun diagnostic continuation.",
    ),
    freshFixture(
      "continued-compound-reference-abstention",
      "fallback-continued-compound-reference-abstention",
      byId.get("holdout-v5-fallback-indeterminate-failure"),
      "Execution reference remains unasserted",
      "The command was expected to fail, but the example fixture says it crashed with RuntimeError at line 5 and returned the complete diagnostic.",
      "Compound reference roles remain unasserted rather than relying on exact `example says` adjacency.",
    ),
    freshFixture(
      "continued-native-stderr",
      "fallback-continued-native-stderr",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution returned native terminal stderr",
      "The command might fail, but it crashed with fatal: checksum mismatch. Exit code 1.",
      "Explicit native fatal stderr and a nonzero exit remain a runtime diagnostic after modal setup.",
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
      "native-not-found-diagnostic",
      "fallback-native-not-found-diagnostic",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution returned native terminal stderr",
      "The command crashed with fatal: repository not found. Process exited with code 1; stderr capture complete.",
      "Native missing-target stderr remains an asserted runtime diagnostic rather than assertion negation.",
    ),
    freshFixture(
      "native-command-not-found",
      "fallback-native-command-not-found",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution returned native terminal stderr",
      "The command failed: bash: foo: command not found. Process exited with code 127; stderr capture complete.",
      "Native command lookup stderr remains an asserted runtime diagnostic.",
    ),
    freshFixture(
      "native-missing-path",
      "fallback-native-missing-path",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution returned native terminal stderr",
      "The command failed: cat: /tmp/missing.txt: No such file or directory. Process exited with code 1; stderr capture complete.",
      "Native missing-path stderr remains an asserted runtime diagnostic.",
    ),
    freshFixture(
      "previous-example-success",
      "fallback-previous-example-success",
      byId.get("holdout-v5-fallback-complete-command-success"),
      "Verification notification",
      "A previous example failed with fatal: checksum mismatch, but the current command completed successfully with exit code 0.",
      "A prior example cannot override the current complete success observation.",
    ),
    freshFixture(
      "reference-verb-abstention",
      "fallback-reference-verb-abstention",
      byId.get("holdout-v5-fallback-indeterminate-failure"),
      "Execution reference remains unasserted",
      "The command was expected to fail, but reference material describes RuntimeError: worker crashed with exit code 1.",
      "Reference prose with a descriptive verb remains unasserted and does not promote a failure.",
    ),
    freshFixture(
      "example-command-diagnostic",
      "fallback-example-command-diagnostic",
      byId.get("holdout-v5-fallback-runtime-diagnostic"),
      "Execution returned a terminal diagnostic",
      "The example command crashed with RuntimeError at line 5 and returned the complete diagnostic. Exit code 1.",
      "An executable example command remains live evidence; only reference frames abstain.",
    ),
    freshFixture(
      "source-read-leading-word",
      "fallback-source-read-leading-word",
      byId.get("holdout-v5-fallback-bounded-source-window"),
      "Only a bounded source window was returned",
      "Source read produced a measured partial view: 80 lines beginning at offset 40 from a source totaling 640 lines.",
      "A source-read leading phrase still classifies measured truncation as bounded evidence loss.",
    ),
    freshFixture(
      "log-output-leading-word",
      "fallback-log-output-leading-word",
      byId.get("holdout-v5-fallback-bounded-source-window"),
      "Only a bounded source window was returned",
      "Log output was truncated: showing lines 20 to 40 of 900; the rest was clipped at the output boundary.",
      "A log-output leading phrase still classifies measured truncation as bounded evidence loss.",
    ),
    freshFixture(
      "short-log-output-leading-word",
      "fallback-short-log-output-leading-word",
      byId.get("holdout-v5-fallback-bounded-source-window"),
      "Only a bounded source window was returned",
      "Log output was truncated: showing lines 41-80 of 400.",
      "A measured log range is bounded evidence loss even when no clipped-remainder clause is present.",
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
  if (fixtures.length !== 47) throw new Error(`Expected 47 fixtures, received ${fixtures.length}.`);
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
    fixtureCount: 47,
    typedEvidenceFixtureCount: 12,
    structuralFallbackFixtureCount: 35,
    oracleProvenance: {
      author: "aperture-maintainer",
      authoredWithoutExecution: true,
      authoredWithoutImplementationInspection: false,
      authoredWithoutPriorOracleInspection: false,
      authoredWithoutCalibrationInspection: false,
      notes: [
        "This active holdout is an honest release regression and hardening set, not an independent oracle claim.",
        "Twelve historical regression shapes are retained and twenty-three new fallback shapes target the repaired grammar.",
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
