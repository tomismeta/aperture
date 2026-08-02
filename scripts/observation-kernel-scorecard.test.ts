import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EventEvaluator } from "../packages/core/src/event-evaluator.js";
import { projectObservationJudgmentContract } from "../packages/core/src/judgment-observation-contract.js";
import { normalizeSourceEvent } from "../packages/core/src/semantic-normalizer.js";
import type { SourceEvent } from "../packages/core/src/source-event.js";
import {
  buildObservationKernelScorecard,
  digestKernelCanonicalJson,
  parseObservationKernelScorecard,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/index.js";
import { runObservationKernelScorecardCommand } from "./observation-kernel-scorecard.ts";

test("observation kernel scorecard covers the normalized observation contract", () => {
  const scorecard = buildObservationKernelScorecard();

  assert.equal(scorecard.passed, true);
  assert.equal(scorecard.summary.fixtures.total, 14);
  assert.equal(scorecard.summary.fixtures.withObservation, 14);
  assert.equal(scorecard.summary.observations.total, 16);
  assert.equal(scorecard.summary.observations.unique, 16);
  assert.equal(
    new Set(scorecard.observations.map((observation) => observation.semanticDigest)).size,
    scorecard.summary.observations.unique,
  );
  assert.ok(scorecard.observations.every((observation) => observation.judgmentDigest.length > 0));
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
      (observation) => observation.fixtureId === "context-host-tool-family-parity",
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
});

test("observation kernel proves host-context judgment parity", () => {
  for (const caseSpec of OBSERVATION_KERNEL_HOST_CONTEXT_PARITY_CASES) {
    const direct = readObservationJudgmentParity(caseSpec.direct);
    const context = readObservationJudgmentParity(caseSpec.context);

    assert.equal(direct.judgmentDigest, context.judgmentDigest, caseSpec.id);
    assert.equal(direct.toolFamily, caseSpec.toolFamily, caseSpec.id);
    assert.equal(context.toolFamily, caseSpec.toolFamily, caseSpec.id);
    assert.equal(direct.statusConflictKind, caseSpec.statusConflictKind, caseSpec.id);
    assert.equal(context.statusConflictKind, caseSpec.statusConflictKind, caseSpec.id);
  }
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

const OBSERVATION_KERNEL_HOST_CONTEXT_PARITY_CASES = [
  parityCase(
    "command",
    "command_success_observation",
    "Your command ran successfully and did not produce any output.",
    "exec_command",
  ),
  parityCase(
    "read",
    "payload_observation",
    "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import annotations",
    "read",
  ),
  parityCase(
    "search",
    "search_output_observation",
    'Web search results for "aperture": /repo/README.md: Aperture overview',
    "search",
  ),
  parityCase(
    "structured",
    "execution_success_observation",
    '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/pkg/lib.rs:10:fn main() {}"}',
    "custom_runner",
  ),
] as const;

function parityCase(id: string, statusConflictKind: string, summary: string, toolFamily: string) {
  return {
    id,
    toolFamily,
    statusConflictKind,
    direct: failedTaskEvent(`direct:${id}`, summary, { toolFamily }),
    context: failedTaskEvent(`context:${id}`, summary, { contextToolFamily: toolFamily }),
  };
}

function readObservationJudgmentParity(event: SourceEvent): {
  judgmentDigest: string;
  toolFamily: string | null;
  statusConflictKind: string | null;
} {
  const result = new EventEvaluator().evaluate(normalizeSourceEvent(event));
  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    throw new Error(`Expected candidate for ${event.id}`);
  }
  const observation = result.candidate.judgmentInput.observation;
  assert.notEqual(observation, undefined);
  if (observation === undefined) {
    throw new Error(`Expected observation for ${event.id}`);
  }
  const judgment = projectObservationJudgmentContract(observation);
  return {
    judgmentDigest: digestKernelCanonicalJson(judgment),
    toolFamily: observation.ownership.toolFamily ?? null,
    statusConflictKind: judgment.statusConflictKind,
  };
}

function failedTaskEvent(
  id: string,
  summary: string,
  options: { toolFamily?: string; contextToolFamily?: string },
): SourceEvent {
  return {
    id: `evt:observation:host-context-parity:${id}`,
    taskId: `task:observation:host-context-parity:${id}`,
    timestamp: "2026-04-22T18:30:00.000Z",
    type: "task.updated",
    title: `${options.toolFamily ?? "tool"} failure`,
    summary,
    status: "failed",
    ...(options.toolFamily !== undefined ? { toolFamily: options.toolFamily } : {}),
    ...(options.contextToolFamily !== undefined
      ? {
          context: {
            items: [{ id: "tool_family", label: "Tool family", value: options.contextToolFamily }],
          },
        }
      : {}),
  };
}
