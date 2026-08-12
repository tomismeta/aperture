import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  evaluateApertureKernelEvent,
  type ApertureKernelEvent,
} from "../packages/core/src/kernel.js";
import {
  buildObservationKernelScorecard,
  digestKernelCanonicalJson,
  evaluateObservationKernelQuality,
  parseObservationKernelScorecard,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/index.js";
import { runObservationKernelScorecardCommand } from "./observation-kernel-scorecard.ts";

test("observation kernel scorecard covers the normalized observation contract", () => {
  const scorecard = buildObservationKernelScorecard();

  assert.equal(scorecard.passed, true);
  assert.equal(scorecard.summary.fixtures.total, 36);
  assert.equal(scorecard.summary.fixtures.withObservation, 36);
  assert.equal(scorecard.summary.fixtures.calibration, 16);
  assert.equal(scorecard.summary.fixtures.holdout, 20);
  assert.equal(scorecard.summary.observations.total, 38);
  assert.equal(
    new Set(scorecard.observations.map((observation) => observation.semanticDigest)).size,
    scorecard.summary.observations.unique,
  );
  assert.ok(scorecard.observations.every((observation) => observation.judgmentDigest.length > 0));
  assert.equal(scorecard.summary.determinism.stable, true);
  assert.equal(scorecard.quality.passed, true);
  assert.deepEqual(scorecard.quality.failures, []);
  assert.equal(scorecard.quality.summary.semantics.score, 1);
  assert.equal(scorecard.quality.summary.judgment.score, 1);
  assert.equal(scorecard.quality.summary.decision.score, 1);
  assert.equal(scorecard.quality.summary.exactOutcomes.score, 1);
  assert.equal(scorecard.quality.bySplit.holdout.exactOutcomes.total, 20);
  assert.equal(scorecard.quality.semanticFields.length, 13);
  assert.equal(scorecard.quality.judgmentFields.length, 8);
  assert.equal(scorecard.quality.decisionFields.length, 2);
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
      (observation) => observation.fixtureId === "explicit-tool-family-authority",
    ).length,
    2,
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
    [
      "command_output",
      "read_output",
      "semantic_evidence",
      "status_text",
      "structured_output",
      "transcript",
    ],
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
      ...new Set(scorecard.observations.map((observation) => observation.judgment.recoveryPosture)),
    ].sort(),
    [
      "authorization_required",
      "diagnostic_inspection",
      "evidence_required",
      "evidence_scope_required",
      "none",
      "original_evidence_required",
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
      "command_success_observation",
      "execution_success_observation",
      "payload_observation",
      "rejected_tool_use_observation",
      "search_output_observation",
      "structured_output_observation",
    ],
  );
  assert.deepEqual(Object.keys(scorecard.coverage).sort(), [
    "consequenceBaselines",
    "diagnosticClasses",
    "dimensions",
    "evidenceLosses",
    "evidenceStrengths",
    "kinds",
    "owners",
    "polarities",
    "provenanceAuthorities",
    "provenanceOrigins",
    "recoveryHints",
    "semanticAgreements",
    "splits",
    "subjects",
  ]);
  assert.deepEqual(Object.keys(scorecard.observations[0]?.fields ?? {}).sort(), [
    "consequenceBaseline",
    "diagnosticClass",
    "evidenceLoss",
    "evidenceStrength",
    "kind",
    "owner",
    "polarity",
    "provenanceAuthority",
    "provenanceOrigin",
    "recoveryHint",
    "semanticAgreement",
    "subject",
    "toolFamily",
  ]);
});

test("observation kernel keeps facts capability authoritative without context or metadata aliases", () => {
  for (const caseSpec of OBSERVATION_KERNEL_CAPABILITY_AUTHORITY_CASES) {
    const direct = readObservationJudgmentAuthority(caseSpec.direct);
    const context = readObservationJudgmentAuthority(caseSpec.context);
    const generic = readObservationJudgmentAuthority(caseSpec.generic);

    assert.equal(direct.capabilityFamily, caseSpec.capabilityFamily, caseSpec.id);
    assert.equal(context.topLevelCapabilityFamily, null, caseSpec.id);
    assert.equal(generic.topLevelCapabilityFamily, null, caseSpec.id);
    assert.equal(direct.statusConflictKind, caseSpec.statusConflictKind, caseSpec.id);
  }
});

test("observation kernel quality identifies semantic, judgment, and decision drift separately", () => {
  const scorecard = buildObservationKernelScorecard();
  const [first, ...rest] = scorecard.observations;
  assert.ok(first);
  if (first === undefined) return;

  const quality = evaluateObservationKernelQuality([
    {
      ...first,
      fields: { ...first.fields, polarity: "unknown" },
      judgment: { ...first.judgment, stableStatusEvidence: !first.judgment.stableStatusEvidence },
      decision: { ...first.decision, resultLane: "none" },
    },
    ...rest,
  ]);

  assert.equal(quality.passed, false);
  assert.equal(quality.summary.semantics.passed, quality.summary.semantics.total - 1);
  assert.equal(quality.summary.judgment.passed, quality.summary.judgment.total - 1);
  assert.equal(quality.summary.decision.passed, quality.summary.decision.total - 1);
  assert.ok(quality.failures.some((failure) => failure.includes(":semantics:polarity:")));
  assert.ok(
    quality.failures.some((failure) => failure.includes(":judgment:stableStatusEvidence:")),
  );
  assert.ok(quality.failures.some((failure) => failure.includes(":decision:resultLane:")));
});

test("observation kernel scorecard check rejects stale artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-observation-kernel-"));
  const previousExitCode = process.exitCode;
  const previousStderrWrite = process.stderr.write;
  try {
    const scorecardPath = join(root, "observation-kernel-scorecard-v3.json");
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

const OBSERVATION_KERNEL_CAPABILITY_AUTHORITY_CASES = [
  authorityCase(
    "command",
    "command_success_observation",
    "Your command ran successfully and did not produce any output.",
    "exec_command",
  ),
  authorityCase(
    "read",
    "payload_observation",
    "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import annotations",
    "read",
  ),
  authorityCase(
    "search",
    "search_output_observation",
    'Web search results for "aperture": /repo/README.md: Aperture overview',
    "search",
  ),
  authorityCase(
    "structured",
    "execution_success_observation",
    '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/pkg/lib.rs:10:fn main() {}"}',
    "custom_runner",
  ),
] as const;

function authorityCase(
  id: string,
  statusConflictKind: string,
  summary: string,
  capabilityFamily: string,
) {
  return {
    id,
    capabilityFamily,
    statusConflictKind,
    direct: failedTaskEvent(`direct:${id}`, summary, { capabilityFamily }),
    context: failedTaskEvent(`context:${id}`, summary, {
      contextCapabilityFamily: capabilityFamily,
    }),
    generic: failedTaskEvent(`generic:${id}`, summary, {
      metadataCapabilityFamily: capabilityFamily,
    }),
  };
}

function readObservationJudgmentAuthority(event: ApertureKernelEvent): {
  judgmentDigest: string;
  capabilityFamily: string | null;
  topLevelCapabilityFamily: string | null;
  statusConflictKind: string | null;
} {
  const result = evaluateApertureKernelEvent(event);
  assert.equal(result.evaluation.kind, "candidate");
  assert.notEqual(result.observation, null);
  assert.notEqual(result.observationJudgment, null);
  if (result.observation === null || result.observationJudgment === null) {
    throw new Error(`Expected observation for ${event.id}`);
  }
  return {
    judgmentDigest: digestKernelCanonicalJson(result.observationJudgment),
    capabilityFamily: result.observation.ownership.capabilityFamily ?? null,
    topLevelCapabilityFamily: result.event.capabilityFamily ?? null,
    statusConflictKind: result.observationJudgment.statusConflictKind,
  };
}

function failedTaskEvent(
  id: string,
  summary: string,
  options: {
    capabilityFamily?: string;
    contextCapabilityFamily?: string;
    metadataCapabilityFamily?: string;
  },
): ApertureKernelEvent {
  return {
    id: `evt:observation:capability-authority:${id}`,
    workId: `work:observation:capability-authority:${id}`,
    occurredAt: "2026-04-22T18:30:00.000Z",
    kind: "work.updated",
    title: "Host observation",
    summary,
    status: "failed",
    ...(options.capabilityFamily !== undefined
      ? { facts: { capabilityFamily: options.capabilityFamily } }
      : {}),
    ...(options.metadataCapabilityFamily === undefined
      ? {}
      : { metadata: { capabilityFamily: options.metadataCapabilityFamily } }),
    ...(options.contextCapabilityFamily !== undefined
      ? {
          context: {
            items: [
              {
                id: "capability_family",
                label: "Capability family",
                value: options.contextCapabilityFamily,
              },
            ],
          },
        }
      : {}),
  };
}
