import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildObservationKernelScorecard,
  parseObservationKernelScorecard,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/index.js";
import { runObservationKernelScorecardCommand } from "./observation-kernel-scorecard.ts";

test("observation kernel scorecard covers the normalized observation contract", () => {
  const scorecard = buildObservationKernelScorecard();

  assert.equal(scorecard.passed, true);
  assert.equal(scorecard.summary.fixtures.total, 13);
  assert.equal(scorecard.summary.fixtures.withObservation, 13);
  assert.equal(scorecard.summary.observations.total, 14);
  assert.equal(scorecard.summary.observations.unique, 14);
  assert.equal(
    new Set(scorecard.observations.map((observation) => observation.semanticDigest)).size,
    scorecard.summary.observations.unique,
  );
  assert.equal(scorecard.summary.determinism.stable, true);
  assert.equal(
    scorecard.observations.some(
      (observation) => observation.fixtureId === "structured-output-source-readback",
    ),
    true,
  );
  assert.equal(
    scorecard.observations.some((observation) => observation.fixtureId === "search-result-output"),
    true,
  );
  assert.equal(
    scorecard.observations.filter(
      (observation) => observation.fixtureId === "source-limit-recovery-flow",
    ).length,
    2,
  );
  assert.deepEqual(
    scorecard.observations
      .filter((observation) => observation.fixtureId === "source-limit-recovery-flow")
      .map((observation) => observation.sequence),
    [0, 1],
  );
  assert.deepEqual(
    scorecard.observations
      .filter((observation) => observation.fixtureId === "source-limit-recovery-flow")
      .map((observation) => observation.judgment.statusEvidence),
    ["limited_failure", "stable_observation"],
  );
  assert.notEqual(
    scorecard.observations.find(
      (observation) => observation.fixtureId === "read-source-window-limit",
    )?.semanticDigest,
    scorecard.observations.find(
      (observation) =>
        observation.fixtureId === "source-limit-recovery-flow" && observation.sequence === 0,
    )?.semanticDigest,
  );
  assert.deepEqual(
    scorecard.coverage.kinds.map((entry) => entry.id),
    ["control", "diagnostic", "outcome", "payload", "unknown"],
  );
  assert.deepEqual(
    scorecard.coverage.provenanceOrigins.map((entry) => entry.id),
    ["read_output", "semantic_evidence", "status_text", "structured_output", "transcript"],
  );
  assert.deepEqual(
    scorecard.coverage.recoveryHints.map((entry) => entry.id),
    [
      "await_authorization",
      "inspect_diagnostic",
      "inspect_original_evidence",
      "narrow_evidence_scope",
      "request_evidence",
    ],
  );
  assert.deepEqual(
    [
      ...new Set(scorecard.observations.map((observation) => observation.judgment.statusEvidence)),
    ].sort(),
    ["limited_failure", "stable_observation", "visible_diagnostic_failure", "weak_or_uncertain"],
  );
  assert.deepEqual(
    [
      ...new Set(
        scorecard.observations
          .map((observation) => observation.judgment.statusConflictKind)
          .filter((kind) => kind !== null),
      ),
    ].sort(),
    [
      "payload_observation",
      "rejected_tool_use_observation",
      "search_output_observation",
      "structured_output_observation",
    ],
  );
});

test("observation kernel scorecard check rejects stale artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-observation-kernel-"));
  const previousExitCode = process.exitCode;
  const previousStderrWrite = process.stderr.write;
  try {
    const scorecardPath = join(root, "observation-kernel-scorecard-v1.json");
    const scorecard = buildObservationKernelScorecard();

    await runObservationKernelScorecardCommand({ args: ["--write"], scorecardPath });

    const writtenScorecard = parseObservationKernelScorecard(await readFile(scorecardPath, "utf8"));
    assert.equal(writtenScorecard.profile.suiteDigest, scorecard.profile.suiteDigest);

    await writeFile(
      scorecardPath,
      `${serializeKernelCanonicalJson({
        ...scorecard,
        summary: {
          ...scorecard.summary,
          observations: {
            ...scorecard.summary.observations,
            total: scorecard.summary.observations.total - 1,
          },
        },
      })}\n`,
      "utf8",
    );

    process.exitCode = undefined;
    process.stderr.write = (() => true) as typeof process.stderr.write;
    await runObservationKernelScorecardCommand({ args: ["--check"], scorecardPath });

    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
    process.stderr.write = previousStderrWrite;
    await rm(root, { recursive: true, force: true });
  }
});
