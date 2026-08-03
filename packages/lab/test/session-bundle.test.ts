import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
  KERNEL_DECISION_RECORD_PROJECTION_VERSION,
} from "../src/artifact-versions.js";
import type { SourceEvent } from "@tomismeta/aperture-core";
import {
  canonicalAttentionExportToScenario,
  createScenarioFromSessionBundle,
  createSessionBundle,
  createSessionBundleFromScenario,
  createSessionBundleFromCanonicalAttentionExport,
  createRuntimeSessionCaptureCursor,
  createSessionBundleFromRuntimeCapture,
  defaultHarvestedScenarioPath,
  defaultSessionBundlePath,
  loadHarvestedScenarios,
  loadReplayScenarios,
  loadSessionBundles,
  runReplayScenario,
  runSessionBundle,
  sliceRuntimeSessionCapture,
  validateSessionBundle,
  buildKernelDecisionRecordProjectionFromSnapshot,
  fingerprintKernelDecisionRecordProjection,
  isKernelDecisionRecordFingerprint,
  type CanonicalAttentionExportLike,
  type ReplayDecisionSnapshot,
  type ReplayScenario,
  type RuntimeSessionCaptureLike,
  writeReplayScenario,
  writeSessionBundle,
} from "../src/index.js";
import { validateReplayDecisionSnapshot } from "../src/validation-replay-decision.js";

function explanationSnapshot(
  value: Partial<NonNullable<RuntimeSessionCaptureLike["currentExplanation"]>>,
): NonNullable<RuntimeSessionCaptureLike["currentExplanation"]> {
  return {
    targetInteractionId: null,
    targetLane: "none",
    headline: null,
    targetMetadata: null,
    whyNow: null,
    routingAuthority: null,
    semanticImpact: null,
    semanticInfluence: [],
    coordinationReasons: [],
    plannerReasons: [],
    policyRationale: [],
    criterionRationale: [],
    continuityRationale: [],
    attentionRationale: [],
    ...value,
  };
}

test("session bundles capture replay outputs and normalized source events", () => {
  const scenario: ReplayScenario = {
    id: "bundle:source",
    title: "Source bundle replay",
    description: "Replay a source event and preserve the normalized event.",
    doctrineTags: ["semantic_normalization"],
    steps: [
      {
        kind: "publishSource",
        label: "source choice",
        event: {
          id: "src:bundle:1",
          taskId: "task:bundle",
          interactionId: "interaction:bundle:1",
          timestamp: "2026-03-21T18:30:00.000Z",
          source: {
            id: "paperclip",
            kind: "human",
            label: "Paperclip",
          },
          type: "human.input.requested",
          title: "Pick a budget override",
          summary: "A budget override is waiting.",
          request: {
            kind: "choice",
            selectionMode: "single",
            options: [
              { id: "500", label: "$500" },
              { id: "1000", label: "$1000" },
            ],
          },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:source",
    source: {
      id: "paperclip",
      kind: "plugin",
      label: "Paperclip",
      redacted: true,
    },
    exportedAt: "2026-03-21T18:31:00.000Z",
  });

  assert.equal(bundle.sessionId, "session:bundle:source");
  assert.equal(bundle.title, scenario.title);
  assert.equal(bundle.steps.length, 1);
  assert.equal(bundle.normalizedEvents.length, 1);
  assert.equal(bundle.normalizedEvents[0]?.event.type, "human.input.requested");
  assert.equal(bundle.semanticSnapshots.length, 1);
  assert.equal(bundle.decisionSnapshots.length, 1);
  assert.equal(
    bundle.decisionSnapshots[0]?.decisionRecordProjectionVersion,
    KERNEL_DECISION_RECORD_PROJECTION_VERSION,
  );
  assert.ok(
    isKernelDecisionRecordFingerprint(bundle.decisionSnapshots[0]?.decisionRecordFingerprint),
  );
  assert.equal(bundle.outcomes.finalNowInteractionId, "interaction:bundle:1");
});

test("session bundle replay clock override is not persisted as core posture", () => {
  const replayTimestamp = "2026-03-21T18:31:10.000Z";
  const scenario: ReplayScenario = {
    id: "bundle:clock",
    title: "Clocked bundle replay",
    steps: [
      {
        kind: "publishSource",
        event: {
          id: "src:bundle:clock",
          taskId: "task:bundle:clock",
          interactionId: "interaction:bundle:clock",
          timestamp: "2026-03-21T18:30:00.000Z",
          source: {
            id: "paperclip",
            kind: "human",
            label: "Paperclip",
          },
          type: "human.input.requested",
          title: "Approve deploy",
          summary: "A deploy approval is waiting.",
          request: {
            kind: "approval",
          },
        },
      },
    ],
  };

  const bundle = createSessionBundleFromScenario(scenario, {
    sessionId: "session:bundle:clock",
    exportedAt: "2026-03-21T18:31:00.000Z",
    replayTimeSource: () => Date.parse(replayTimestamp),
  });

  assert.ok(bundle.traces.length > 0);
  assert.equal(bundle.traces[0]?.timestamp, replayTimestamp);
  assert.equal(bundle.core, undefined);
  assert.ok(!JSON.stringify(bundle).includes("replayTimeSource"));
});

test("replay runner can use an initial fixed clock without a step clock", () => {
  const result = runReplayScenario(
    {
      id: "runner:fixed-clock",
      title: "Fixed replay clock",
      steps: [
        {
          kind: "publishSource",
          event: {
            id: "evt:fixed-clock",
            taskId: "task:fixed-clock",
            timestamp: "2026-03-21T18:30:00.000Z",
            type: "task.updated",
            title: "Build running",
            summary: "The build is still running.",
            status: "running",
          },
        },
      ],
    },
    {
      initialTimeMs: Date.parse("2026-03-21T20:00:00.000Z"),
    },
  );

  assert.equal(result.traces[0]?.timestamp, "2026-03-21T20:00:00.000Z");
});

test("plain replay preserves clipped-looking source events exactly", () => {
  const event: SourceEvent = {
    id: "evt:bundle:literal-ellipsis",
    taskId: "task:bundle:literal-ellipsis",
    timestamp: "2026-03-21T18:31:00.000Z",
    type: "task.updated",
    title: "bash failure",
    summary: "The command printed a literal ellipsis ... and exited with code 1",
    status: "failed",
    toolFamily: "bash",
  };
  const result = runReplayScenario({
    id: "bundle:literal-ellipsis",
    title: "Literal ellipsis replay",
    steps: [
      {
        kind: "publishSource",
        label: "literal ellipsis",
        event,
      },
    ],
  });
  const replayedEvent =
    result.steps[0]?.step.kind === "publishSource" ? result.steps[0].step.event : null;

  assert.deepEqual(replayedEvent, event);
  assert.equal(replayedEvent?.metadata, undefined);
  assert.equal(replayedEvent?.semanticHints, undefined);
});

test("current replay rehydrates clipped failed source summaries as source-quality hints", () => {
  const result = runReplayScenario(
    {
      id: "bundle:clipped-source-quality",
      title: "Clipped source-quality replay",
      steps: [
        {
          kind: "publishSource",
          label: "legacy clipped failure",
          event: {
            id: "evt:bundle:clipped-source-quality",
            taskId: "task:bundle:clipped-source-quality",
            timestamp: "2026-03-21T18:31:00.000Z",
            type: "task.updated",
            title: "bash failure",
            summary:
              '{"exit_code":1,"wall_time":"0.0510 seconds","output":"(no output)","truncated":true}',
            status: "failed",
            toolFamily: "bash",
          },
        },
      ],
    },
    { rehydrateSourceQuality: true },
  );
  const replayedEvent =
    result.steps[0]?.step.kind === "publishSource" ? result.steps[0].step.event : null;

  assert.equal(replayedEvent?.metadata?.truncated, true);
  assert.equal(replayedEvent?.semanticHints?.confidence, "low");
  assert.equal(replayedEvent?.semanticHints?.consequence, undefined);
  assert.equal(result.semantics[0]?.interpretation.consequence, "high");
  assert.equal(result.semantics[0]?.interpretation.confidence, "low");
  assert.equal(result.semantics[0]?.interpretation.provenance?.consequence, "inferred");
  assert.equal(result.semantics[0]?.interpretation.provenance?.confidence, "hint");

  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:clipped-source-quality",
    exportedAt: "2026-03-21T18:31:30.000Z",
  });
  const bundledEvent = bundle.steps[0]?.kind === "publishSource" ? bundle.steps[0].event : null;
  assert.equal(bundledEvent?.metadata?.truncated, true);
  assert.equal(bundledEvent?.semanticHints?.confidence, "low");
  assert.equal(bundledEvent?.semanticHints?.consequence, undefined);
});

test("session bundles can replay back into the same final attention outcome", () => {
  const scenario: ReplayScenario = {
    id: "bundle:roundtrip",
    title: "Roundtrip bundle replay",
    steps: [
      {
        kind: "publish",
        event: {
          id: "evt:bundle:approval",
          taskId: "task:bundle:approval",
          timestamp: "2026-03-21T18:32:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:bundle:approval",
          title: "Approve deploy",
          summary: "A deploy needs approval.",
          consequence: "high",
          request: { kind: "approval" },
        },
      },
      {
        kind: "publishSource",
        event: {
          id: "evt:bundle:status",
          type: "task.updated",
          taskId: "task:bundle:status",
          timestamp: "2026-03-21T18:32:10.000Z",
          source: { id: "custom-agent" },
          title: "Build failed",
          summary: "The latest build failed and may need a retry.",
          status: "failed",
          semanticHints: {
            confidence: "low",
          },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:roundtrip",
    exportedAt: "2026-03-21T18:33:00.000Z",
  });
  const replayed = runSessionBundle(bundle);

  assert.deepEqual(replayed.views.at(-1)?.attentionView, result.views.at(-1)?.attentionView);
  assert.deepEqual(replayed.decisions, result.decisions);
});

test("session bundles can promote into harvested scenarios with source provenance and expectations", () => {
  const scenario: ReplayScenario = {
    id: "bundle:promote",
    title: "Promote me",
    doctrineTags: ["harvested"],
    steps: [
      {
        kind: "publish",
        event: {
          id: "evt:bundle:promote",
          taskId: "task:bundle:promote",
          timestamp: "2026-03-21T18:36:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:bundle:promote",
          title: "Choose a scripting language",
          summary: "A scripting language is needed.",
          consequence: "medium",
          request: {
            kind: "choice",
            selectionMode: "single",
            options: [
              { id: "python", label: "Python" },
              { id: "bash", label: "Bash/zsh" },
            ],
          },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:promote",
    source: {
      id: "claude-code",
      kind: "adapter",
      label: "Claude Code",
      capture: {
        eventTransport: "hook+transcript",
        semanticCapture: "source+normalized+trace",
        responseBridge: "deny_plus_context",
      },
    },
    exportedAt: "2026-03-21T18:37:00.000Z",
  });

  const promoted = createScenarioFromSessionBundle(bundle, {
    id: "harvested:claude:ask-user-question-clean",
    provenance: {
      promotedAt: "2026-03-21T18:38:00.000Z",
      promotedFromBundleSessionId: bundle.sessionId,
      promotedFromPath: "/tmp/session:bundle:promote.json",
    },
  });

  assert.equal(promoted.id, "harvested:claude:ask-user-question-clean");
  assert.equal(promoted.source?.capture?.eventTransport, "hook+transcript");
  assert.equal(promoted.source?.capture?.responseBridge, "deny_plus_context");
  assert.equal(promoted.provenance?.promotedFromBundleSessionId, "session:bundle:promote");
  assert.equal(promoted.expectations?.finalNowInteractionId, "interaction:bundle:promote");
  assert.equal(promoted.expectations?.resultLaneCounts?.now, 1);
});

test("session bundles can be written to disk and loaded back", async () => {
  const scenario: ReplayScenario = {
    id: "bundle:disk",
    title: "Disk bundle replay",
    steps: [
      {
        kind: "publish",
        event: {
          id: "evt:bundle:disk",
          taskId: "task:bundle:disk",
          timestamp: "2026-03-21T18:34:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:bundle:disk",
          title: "Approve cleanup",
          summary: "Cleanup is waiting for approval.",
          consequence: "medium",
          request: { kind: "approval" },
        },
      },
    ],
  };

  const result = runReplayScenario(scenario);
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:disk",
    exportedAt: "2026-03-21T18:35:00.000Z",
  });

  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-bundles-"));
  const filePath = defaultSessionBundlePath(bundle, directory);

  await writeSessionBundle(filePath, bundle);

  const raw = JSON.parse(await readFile(filePath, "utf8")) as { sessionId: string };
  const loaded = await loadSessionBundles(directory);

  assert.equal(raw.sessionId, bundle.sessionId);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.sessionId, bundle.sessionId);
  assert.equal(loaded[0]?.outcomes.finalNowInteractionId, bundle.outcomes.finalNowInteractionId);
});

test("session bundles reject malformed schema-matching payloads on load", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-bundles-invalid-"));
  const filePath = path.join(directory, "invalid.json");

  await writeFile(
    filePath,
    `${JSON.stringify({
      schemaVersion: 1,
      sessionId: "session:invalid",
      title: "Invalid bundle",
      exportedAt: "2026-03-21T18:35:00.000Z",
      steps: [],
    })}\n`,
    "utf8",
  );

  await assert.rejects(loadSessionBundles(directory), /Invalid session bundle/);
});

test("session bundle validation requires the core structural fields", () => {
  const valid = validateSessionBundle({
    schemaVersion: 1,
    sessionId: "session:valid",
    title: "Valid bundle",
    exportedAt: "2026-03-21T18:35:00.000Z",
    steps: [],
    normalizedEvents: [],
    traces: [],
    signals: [],
    responses: [],
    viewSnapshots: [],
    semanticSnapshots: [],
    decisionSnapshots: [],
    outcomes: {
      totalSteps: 0,
      surfacedFrames: 0,
      finalNowInteractionId: null,
      finalNextCount: 0,
      finalAmbientCount: 0,
      finalNextInteractionIds: [],
      finalAmbientInteractionIds: [],
    },
  });
  const invalid = validateSessionBundle({
    schemaVersion: 1,
    sessionId: "session:invalid",
    title: "Invalid bundle",
    exportedAt: "2026-03-21T18:35:00.000Z",
    steps: [],
    traces: [],
  });

  assert.ok(valid);
  assert.equal(invalid, null);
});

test("session bundle validation accepts legacy v1 decision snapshots", () => {
  const legacySnapshot: ReplayDecisionSnapshot = {
    stepIndex: 0,
    stepKind: "publish",
    evaluationKind: "candidate",
    decisionKind: "queue",
    decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
    decisionRecordRoute: "queue",
    plannedLane: "next",
    decisionRecordCurrentFrameId: null,
    decisionRecordCurrentEpisodeId: null,
    decisionRecordOperatorPresence: "present",
    decisionRecordCandidateScore: 1,
    decisionRecordValueComponents: { priority: 1 },
    decisionRecordReasons: ["current work still outranks the new candidate"],
    decisionRecordReasonCodes: [
      "route:queue",
      "lane:next",
      "evidence:operator_presence:present",
      "evidence:current_frame:absent",
      "evidence:current_episode:absent",
      "policy:minimum_lane:next",
      "pressure:level:steady",
      "pressure:overload:low",
    ],
  };
  const projection = buildKernelDecisionRecordProjectionFromSnapshot(legacySnapshot);

  assert.ok(projection);
  assert.ok(
    validateSessionBundle({
      schemaVersion: 1,
      sessionId: "session:legacy-v1",
      title: "Legacy v1 bundle",
      exportedAt: "2026-03-21T18:35:00.000Z",
      steps: [],
      normalizedEvents: [],
      traces: [],
      signals: [],
      responses: [],
      viewSnapshots: [],
      semanticSnapshots: [],
      decisionSnapshots: [
        {
          ...legacySnapshot,
          decisionRecordFingerprint: fingerprintKernelDecisionRecordProjection(projection),
        },
      ],
      outcomes: {
        totalSteps: 0,
        surfacedFrames: 0,
        finalNowInteractionId: null,
        finalNextCount: 0,
        finalAmbientCount: 0,
        finalNextInteractionIds: [],
        finalAmbientInteractionIds: [],
      },
    }),
  );
});

test("session bundle validation rejects malformed array contents", () => {
  const invalid = validateSessionBundle({
    schemaVersion: 1,
    sessionId: "session:invalid-arrays",
    title: "Invalid array contents",
    exportedAt: "2026-03-21T18:35:00.000Z",
    steps: [42],
    normalizedEvents: [],
    traces: [],
    signals: [],
    responses: [],
    viewSnapshots: [],
    semanticSnapshots: [],
    decisionSnapshots: [],
    outcomes: {
      totalSteps: 1,
      surfacedFrames: 0,
      finalNowInteractionId: null,
      finalNextCount: 0,
      finalAmbientCount: 0,
      finalNextInteractionIds: [],
      finalAmbientInteractionIds: [],
    },
  });

  assert.equal(invalid, null);
});

test("session bundle validation rejects malformed present decision records", () => {
  const emptyView = { now: null, next: [], ambient: [] };
  const invalid = validateSessionBundle({
    schemaVersion: 1,
    sessionId: "session:invalid-decision-record",
    title: "Invalid decision record",
    exportedAt: "2026-03-21T18:35:00.000Z",
    steps: [],
    normalizedEvents: [],
    traces: [
      {
        timestamp: "2026-03-21T18:35:00.000Z",
        event: {
          id: "evt:invalid-decision-record",
          type: "task.updated",
          taskId: "task:invalid-decision-record",
          timestamp: "2026-03-21T18:35:00.000Z",
          title: "Build failed",
          status: "failed",
        },
        evaluation: { kind: "candidate" },
        coordination: { kind: "queue", resultLane: "next" },
        attentionView: emptyView,
        taskView: emptyView,
        decisionRecord: "invalid",
      },
    ],
    signals: [],
    responses: [],
    viewSnapshots: [],
    semanticSnapshots: [],
    decisionSnapshots: [],
    outcomes: {
      totalSteps: 0,
      surfacedFrames: 0,
      finalNowInteractionId: null,
      finalNextCount: 0,
      finalAmbientCount: 0,
      finalNextInteractionIds: [],
      finalAmbientInteractionIds: [],
    },
  });

  assert.equal(invalid, null);
});

test("session bundle validation rejects malformed claimScore without legacy fallback", () => {
  const emptyView = { now: null, next: [], ambient: [] };
  const invalid = validateSessionBundle({
    schemaVersion: 1,
    sessionId: "session:invalid-claim-score",
    title: "Invalid claim score",
    exportedAt: "2026-03-21T18:35:00.000Z",
    steps: [],
    normalizedEvents: [],
    traces: [
      {
        timestamp: "2026-03-21T18:35:00.000Z",
        event: {
          id: "evt:invalid-claim-score",
          type: "task.updated",
          taskId: "task:invalid-claim-score",
          timestamp: "2026-03-21T18:35:00.000Z",
          title: "Build failed",
          status: "failed",
        },
        evaluation: { kind: "candidate" },
        coordination: { kind: "queue", resultLane: "next" },
        attentionView: emptyView,
        taskView: emptyView,
        decisionRecord: {
          planning: {
            route: "queue",
            plannedLane: "next",
            reasons: [],
            reasonCodes: [
              "route:queue",
              "lane:next",
              "policy:minimum_lane:next",
              "pressure:level:steady",
              "pressure:overload:low",
              "evidence:operator_presence:present",
              "evidence:current_frame:absent",
              "evidence:current_episode:absent",
            ],
          },
          evidenceSnapshot: {
            operatorPresence: "present",
            currentFrameId: null,
            currentEpisodeId: null,
          },
          value: {
            claimScore: "bad",
            candidateScore: 1,
            breakdown: { components: { priority: 1 } },
          },
        },
      },
    ],
    signals: [],
    responses: [],
    viewSnapshots: [],
    semanticSnapshots: [],
    decisionSnapshots: [],
    outcomes: {
      totalSteps: 0,
      surfacedFrames: 0,
      finalNowInteractionId: null,
      finalNextCount: 0,
      finalAmbientCount: 0,
      finalNextInteractionIds: [],
      finalAmbientInteractionIds: [],
    },
  });

  assert.equal(invalid, null);
});

test("session bundle validation rejects malformed decision reason codes", () => {
  const emptyView = { now: null, next: [], ambient: [] };
  const invalidTraceReasonCode = validateSessionBundle({
    schemaVersion: 1,
    sessionId: "session:invalid-trace-reason-code",
    title: "Invalid trace reason code",
    exportedAt: "2026-03-21T18:35:00.000Z",
    steps: [],
    normalizedEvents: [],
    traces: [
      {
        timestamp: "2026-03-21T18:35:00.000Z",
        event: {
          id: "evt:invalid-trace-reason-code",
          type: "task.updated",
          taskId: "task:invalid-trace-reason-code",
          timestamp: "2026-03-21T18:35:00.000Z",
          title: "Build failed",
          status: "failed",
        },
        evaluation: { kind: "candidate" },
        coordination: { kind: "queue", resultLane: "next" },
        attentionView: emptyView,
        taskView: emptyView,
        decisionRecord: {
          planning: {
            route: "queue",
            plannedLane: "next",
            reasons: [],
            reasonCodes: ["route:not-a-real-route"],
          },
          evidenceSnapshot: {
            operatorPresence: "present",
            currentFrameId: null,
            currentEpisodeId: null,
          },
          value: {
            candidateScore: 1,
            breakdown: { components: { priority: 1 } },
          },
        },
      },
    ],
    signals: [],
    responses: [],
    viewSnapshots: [],
    semanticSnapshots: [],
    decisionSnapshots: [],
    outcomes: {
      totalSteps: 0,
      surfacedFrames: 0,
      finalNowInteractionId: null,
      finalNextCount: 0,
      finalAmbientCount: 0,
      finalNextInteractionIds: [],
      finalAmbientInteractionIds: [],
    },
  });
  const invalidSnapshotReasonCode = validateSessionBundle({
    schemaVersion: 1,
    sessionId: "session:invalid-snapshot-reason-code",
    title: "Invalid snapshot reason code",
    exportedAt: "2026-03-21T18:35:00.000Z",
    steps: [],
    normalizedEvents: [],
    traces: [],
    signals: [],
    responses: [],
    viewSnapshots: [],
    semanticSnapshots: [],
    decisionSnapshots: [
      {
        stepIndex: 0,
        stepKind: "publish",
        evaluationKind: "candidate",
        decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
        decisionRecordReasonCodes: ["not-even-close"],
      },
    ],
    outcomes: {
      totalSteps: 0,
      surfacedFrames: 0,
      finalNowInteractionId: null,
      finalNextCount: 0,
      finalAmbientCount: 0,
      finalNextInteractionIds: [],
      finalAmbientInteractionIds: [],
    },
  });

  assert.equal(invalidTraceReasonCode, null);
  assert.equal(invalidSnapshotReasonCode, null);
});

test("decision snapshot validation enforces v2 projection coherence", () => {
  const validSnapshot: ReplayDecisionSnapshot = {
    stepIndex: 0,
    stepKind: "publish",
    evaluationKind: "candidate",
    decisionKind: "queue",
    decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_VERSION,
    decisionRecordRoute: "queue",
    plannedLane: "next",
    resultLane: "next",
    decisionRecordCurrentFrameId: null,
    decisionRecordCurrentEpisodeId: null,
    decisionRecordOperatorPresence: "present",
    decisionRecordCandidateScore: 1,
    decisionRecordValueComponents: { priority: 1 },
    decisionRecordReasons: ["current work still outranks the new candidate"],
    decisionRecordReasonCodes: [
      "route:queue",
      "lane:next",
      "evidence:operator_presence:present",
      "evidence:current_frame:absent",
      "evidence:current_episode:absent",
      "policy:minimum_lane:next",
      "pressure:level:steady",
      "pressure:overload:low",
      "policy_gate:blocking:verdict",
    ],
  };
  const missingReasonCodes = { ...validSnapshot } as Record<string, unknown>;
  const validReasonCodes = validSnapshot.decisionRecordReasonCodes;
  const projection = buildKernelDecisionRecordProjectionFromSnapshot(validSnapshot);

  assert.ok(validReasonCodes);
  assert.ok(projection);
  const validFingerprint = fingerprintKernelDecisionRecordProjection(projection);

  delete missingReasonCodes.decisionRecordReasonCodes;

  assert.ok(validateReplayDecisionSnapshot(validSnapshot));
  assert.ok(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordFingerprint: validFingerprint,
    }),
  );
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordFingerprint:
        "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    }),
    null,
  );
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      resultLane: "now",
      decisionRecordFingerprint: validFingerprint,
    }),
    null,
  );
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordProjectionVersion: 99,
    }),
    null,
  );
  assert.ok(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordProjectionVersion: KERNEL_DECISION_RECORD_PROJECTION_V1_VERSION,
      resultLane: undefined,
    }),
  );
  assert.equal(validateReplayDecisionSnapshot(missingReasonCodes), null);
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordReasonCodes: [...validReasonCodes, validReasonCodes[0]],
    }),
    null,
  );
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordReasonCodes: [...validReasonCodes, "route:activate"],
    }),
    null,
  );
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordReasonCodes: [...validReasonCodes, "lane:now"],
    }),
    null,
  );
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordReasonCodes: [...validReasonCodes, "evidence:current_frame:present"],
    }),
    null,
  );
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordReasonCodes: [
        ...validReasonCodes.filter((reasonCode) => !reasonCode.startsWith("pressure:level:")),
        "pressure:level:elevated",
        "pressure:level:high",
      ],
    }),
    null,
  );
  assert.equal(
    validateReplayDecisionSnapshot({ ...validSnapshot, decisionRecordRoute: "activate" }),
    null,
  );
  assert.equal(validateReplayDecisionSnapshot({ ...validSnapshot, plannedLane: "ambient" }), null);
  assert.equal(validateReplayDecisionSnapshot({ ...validSnapshot, resultLane: undefined }), null);
  assert.equal(
    validateReplayDecisionSnapshot({
      ...validSnapshot,
      decisionRecordCurrentFrameId: "frame:present",
    }),
    null,
  );
});

test("session bundles load recursively from nested directories", async () => {
  const scenario: ReplayScenario = {
    id: "bundle:nested",
    title: "Nested bundle replay",
    steps: [],
  };
  const result = runReplayScenario(scenario);
  const bundle = createSessionBundle(result, {
    sessionId: "session:bundle:nested",
    exportedAt: "2026-03-21T18:35:00.000Z",
  });

  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-bundles-nested-"));
  const nestedDirectory = path.join(directory, "deep", "nested");
  await mkdir(nestedDirectory, { recursive: true });
  await writeSessionBundle(path.join(nestedDirectory, "bundle.json"), bundle);

  const loaded = await loadSessionBundles(directory);

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.sessionId, bundle.sessionId);
});

test("harvested replay scenarios can be written to disk and loaded back", async () => {
  const scenario: ReplayScenario = {
    id: "harvested:claude:clean-probe",
    title: "Claude clean probe",
    doctrineTags: ["harvested", "claude", "clean"],
    source: {
      id: "claude-code",
      kind: "adapter",
      label: "Claude Code",
      redacted: true,
      capture: {
        eventTransport: "hook+transcript",
        semanticCapture: "source+normalized+trace",
        responseBridge: "deny_plus_context",
      },
    },
    steps: [],
  };

  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-harvested-"));
  const filePath = defaultHarvestedScenarioPath(scenario, directory);

  await writeReplayScenario(filePath, scenario);

  const raw = JSON.parse(await readFile(filePath, "utf8")) as { id: string };
  const loaded = await loadHarvestedScenarios(directory);

  assert.equal(raw.id, scenario.id);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.source?.capture?.responseBridge, "deny_plus_context");
});

test("replay scenarios reject malformed files during load", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aperture-scenarios-invalid-"));
  const filePath = path.join(directory, "invalid.json");

  await writeFile(
    filePath,
    `${JSON.stringify({
      id: "scenario:invalid",
      title: "Invalid scenario",
      steps: [null],
    })}\n`,
    "utf8",
  );

  await assert.rejects(loadReplayScenarios(directory), /Invalid replay scenario/);
});

test("canonical attention exports convert into replay scenarios with final-state expectations", () => {
  const exportArtifact: CanonicalAttentionExportLike = {
    companyId: "company:paperclip",
    exportedAt: "2026-03-21T19:40:00.000Z",
    ledger: [
      {
        kind: "event",
        occurredAt: "2026-03-21T19:39:00.000Z",
        source: {
          eventType: "approval.created",
          entityId: "approval:1",
          entityType: "approval",
        },
        apertureEvent: {
          id: "evt:paperclip:approval",
          taskId: "task:paperclip:approval",
          timestamp: "2026-03-21T19:39:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:paperclip:approval",
          title: "Approve launch cutover",
          summary: "Launch cutover is waiting on a human decision.",
          consequence: "high",
          request: { kind: "approval" },
        },
      },
      {
        kind: "response",
        occurredAt: "2026-03-21T19:39:30.000Z",
        source: {
          eventType: "acknowledge-frame",
          entityId: "approval:1",
          entityType: "approval",
        },
        apertureResponse: {
          taskId: "task:paperclip:approval",
          interactionId: "interaction:paperclip:approval",
          response: { kind: "acknowledged" },
        },
      },
    ],
    reconciledSnapshot: {
      now: null,
      next: [],
      ambient: [],
      counts: {
        now: 0,
        next: 0,
        ambient: 0,
      },
    },
  };

  const scenario = canonicalAttentionExportToScenario(exportArtifact, {
    doctrineTags: ["paperclip", "replay-export"],
  });

  assert.equal(scenario.id, "canonical-attention:company:paperclip");
  assert.equal(scenario.steps.length, 2);
  assert.equal(scenario.steps[0]?.kind, "publish");
  assert.equal(scenario.steps[1]?.kind, "submit");
  assert.equal(scenario.expectations?.finalNowInteractionId, null);
  assert.equal(scenario.expectations?.resultLaneCounts?.now, 0);
  assert.deepEqual(scenario.doctrineTags, ["paperclip", "replay-export"]);
});

test("session bundles can be created from canonical attention exports", () => {
  const exportArtifact: CanonicalAttentionExportLike = {
    companyId: "company:paperclip",
    exportedAt: "2026-03-21T19:41:00.000Z",
    ledger: [
      {
        kind: "event",
        occurredAt: "2026-03-21T19:40:00.000Z",
        source: {
          eventType: "approval.created",
          entityId: "approval:1",
          entityType: "approval",
        },
        apertureEvent: {
          id: "evt:paperclip:approval",
          taskId: "task:paperclip:approval",
          timestamp: "2026-03-21T19:40:00.000Z",
          type: "human.input.requested",
          interactionId: "interaction:paperclip:approval",
          title: "Approve launch cutover",
          summary: "Launch cutover is waiting on a human decision.",
          consequence: "high",
          request: { kind: "approval" },
        },
      },
      {
        kind: "response",
        occurredAt: "2026-03-21T19:40:30.000Z",
        source: {
          eventType: "acknowledge-frame",
          entityId: "approval:1",
          entityType: "approval",
        },
        apertureResponse: {
          taskId: "task:paperclip:approval",
          interactionId: "interaction:paperclip:approval",
          response: { kind: "acknowledged" },
        },
      },
    ],
    reconciledSnapshot: {
      now: null,
      next: [],
      ambient: [],
      counts: {
        now: 0,
        next: 0,
        ambient: 0,
      },
    },
  };

  const bundle = createSessionBundleFromCanonicalAttentionExport(exportArtifact, {
    sessionId: "session:paperclip:export",
    title: "Paperclip export replay",
    source: {
      id: "paperclip",
      kind: "plugin",
      label: "Paperclip",
      redacted: true,
    },
  });

  assert.equal(bundle.sessionId, "session:paperclip:export");
  assert.equal(bundle.steps.length, 2);
  assert.equal(bundle.responses.length, 1);
  assert.equal(
    bundle.traces.some((trace) => trace.event.id === "evt:paperclip:approval"),
    true,
  );
  assert.equal(bundle.outcomes.finalNowInteractionId, null);
  assert.equal(bundle.outcomes.finalNextCount, 0);
});

test("session bundles can be created from runtime-style captures", () => {
  const capture = {
    runtimeId: "runtime:test",
    kind: "aperture",
    exportedAt: "2026-03-21T19:01:00.000Z",
    captureSteps: [
      {
        sequence: 1,
        recordedAt: "2026-03-21T19:00:00.000Z",
        kind: "publishSource" as const,
        event: {
          id: "src:runtime:bundle",
          type: "task.updated" as const,
          taskId: "task:runtime:bundle",
          timestamp: "2026-03-21T19:00:00.000Z",
          source: { id: "custom-agent" },
          title: "Build failed",
          summary: "The latest build failed and may need a retry.",
          status: "failed" as const,
          semanticHints: {
            confidence: "low" as const,
          },
        },
      },
    ],
    publishedSourceEvents: [
      {
        id: "src:runtime:bundle",
        type: "task.updated" as const,
        taskId: "task:runtime:bundle",
        timestamp: "2026-03-21T19:00:00.000Z",
        source: { id: "custom-agent" },
        title: "Build failed",
        summary: "The latest build failed and may need a retry.",
        status: "failed" as const,
        semanticHints: {
          confidence: "low" as const,
        },
      },
    ],
    submittedResponses: [],
    signals: [],
    traces: [
      {
        timestamp: "2026-03-21T19:00:00.100Z",
        event: {
          id: "src:runtime:bundle",
          type: "task.updated" as const,
          taskId: "task:runtime:bundle",
          timestamp: "2026-03-21T19:00:00.000Z",
          source: { id: "custom-agent" },
          activityClass: "tool_failure" as const,
          semantic: {
            intentFrame: "failure" as const,
            activityClass: "tool_failure" as const,
            consequence: "high" as const,
            factors: ["task.updated", "failed"],
            relationHints: [],
            confidence: "low" as const,
            reasons: ["task status explicitly indicates failed work"],
            whyNow: "Work has failed and should be reviewed.",
          },
          title: "Build failed",
          summary: "The latest build failed and may need a retry.",
          status: "failed" as const,
        },
        evaluation: {
          kind: "candidate" as const,
          original: {
            taskId: "task:runtime:bundle",
            interactionId: "interaction:task:runtime:bundle:status",
            source: { id: "custom-agent" },
            activityClass: "tool_failure" as const,
            mode: "status" as const,
            tone: "critical" as const,
            consequence: "high" as const,
            title: "Build failed",
            summary: "The latest build failed and may need a retry.",
            responseSpec: {
              kind: "acknowledge" as const,
              actions: [
                {
                  id: "acknowledge",
                  label: "Acknowledge",
                  kind: "acknowledge" as const,
                  emphasis: "primary" as const,
                },
              ],
            },
            priority: "high" as const,
            blocking: false,
            timestamp: "2026-03-21T19:00:00.000Z",
            provenance: {
              whyNow: "Work has failed and should be reviewed.",
              factors: ["task.updated", "failed"],
            },
            semanticConfidence: "low" as const,
          },
          adjusted: {
            taskId: "task:runtime:bundle",
            interactionId: "interaction:task:runtime:bundle:status",
            source: { id: "custom-agent" },
            activityClass: "tool_failure" as const,
            mode: "status" as const,
            tone: "critical" as const,
            consequence: "high" as const,
            title: "Build failed",
            summary: "The latest build failed and may need a retry.",
            responseSpec: {
              kind: "acknowledge" as const,
              actions: [
                {
                  id: "acknowledge",
                  label: "Acknowledge",
                  kind: "acknowledge" as const,
                  emphasis: "primary" as const,
                },
              ],
            },
            priority: "high" as const,
            blocking: false,
            timestamp: "2026-03-21T19:00:00.000Z",
            provenance: {
              whyNow: "Work has failed and should be reviewed.",
              factors: ["task.updated", "failed"],
            },
            semanticConfidence: "low" as const,
          },
        },
        heuristics: {
          scoreOffset: 0,
          rationale: [],
        },
        episode: null,
        policy: {
          autoApprove: false,
          mayInterrupt: true,
          requiresOperatorResponse: false,
          minimumLane: "next" as const,
          minimumLaneIsSticky: false,
          rationale: ["urgent non-blocking work may compete for interruptive attention"],
        },
        policyRules: {
          gateEvaluations: [],
          criterion: {
            criterion: {
              activationThreshold: 180,
              promotionMargin: 40,
            },
            peripheralResolution: "queue" as const,
            ambiguity: {
              kind: "interrupt" as const,
              reason: "low_signal" as const,
              resolution: "queue" as const,
            },
            rationale: [
              "low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer",
            ],
          },
          criterionEvaluations: [],
        },
        utility: {
          candidate: {
            total: 242,
            components: {
              consequence: 160,
              priority: 40,
              responseShape: 0,
              sourceTrust: 0,
              heuristicOffset: 0,
              consequenceCalibration: 0,
              toolFamilyTrust: 0,
              contextAffinity: 0,
              deferralAffinity: 0,
              continuityAffinity: 0,
            },
            rationale: [],
          },
          currentScore: null,
          currentPriority: null,
        },
        planner: {
          kind: "queue" as const,
          reasons: ["current work still outranks the new candidate"],
          continuityEvaluations: [],
        },
        coordination: {
          kind: "queue" as const,
          resultLane: "next" as const,
          candidateScore: 242,
          currentScore: null,
          currentPriority: null,
          criterion: {
            criterion: {
              activationThreshold: 180,
              promotionMargin: 40,
            },
            peripheralResolution: "queue" as const,
            ambiguity: {
              kind: "interrupt" as const,
              reason: "low_signal" as const,
              resolution: "queue" as const,
            },
            rationale: [
              "low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer",
            ],
          },
          ambiguity: {
            kind: "interrupt" as const,
            reason: "low_signal" as const,
            resolution: "queue" as const,
          },
          reasons: [
            "low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer",
          ],
          continuityEvaluations: [],
        },
        taskSummary: {
          recentSignals: 0,
          lifetimeSignals: 0,
          counts: {
            presented: 0,
            viewed: 0,
            responded: 0,
            dismissed: 0,
            deferred: 0,
            contextExpanded: 0,
            contextSkipped: 0,
            timedOut: 0,
            returned: 0,
            attentionShifted: 0,
          },
          deferred: {
            next: 0,
            suppressed: 0,
            manual: 0,
          },
          responseRate: 0,
          dismissalRate: 0,
          averageResponseLatencyMs: null,
          averageDismissalLatencyMs: null,
          lastSignalAt: null,
        },
        globalSummary: {
          recentSignals: 0,
          lifetimeSignals: 0,
          counts: {
            presented: 0,
            viewed: 0,
            responded: 0,
            dismissed: 0,
            deferred: 0,
            contextExpanded: 0,
            contextSkipped: 0,
            timedOut: 0,
            returned: 0,
            attentionShifted: 0,
          },
          deferred: {
            next: 0,
            suppressed: 0,
            manual: 0,
          },
          responseRate: 0,
          dismissalRate: 0,
          averageResponseLatencyMs: null,
          averageDismissalLatencyMs: null,
          lastSignalAt: null,
        },
        taskAttentionState: "monitoring" as const,
        globalAttentionState: "monitoring" as const,
        pressureForecast: {
          level: "light" as const,
          overloadRisk: "low" as const,
          score: 0,
          metrics: {
            recentDemand: 0,
            interruptiveVisible: 0,
            averageResponseLatencyMs: null,
            deferredCount: 0,
            suppressedCount: 0,
          },
          reasons: [],
        },
        attentionBurden: {
          level: "light" as const,
          thresholdOffset: 0,
          metrics: {
            recentDecisions: 0,
            recentResponseLatencyMs: null,
            contextExpansions: 0,
            deferRate: 0,
            fragmentation: 0,
          },
          reasons: [],
        },
        current: null,
        taskView: {
          now: null,
          next: [],
          ambient: [],
        },
        attentionView: {
          now: null,
          next: [],
          ambient: [],
        },
        result: {
          id: "frame:interaction:task:runtime:bundle:status",
          taskId: "task:runtime:bundle",
          interactionId: "interaction:task:runtime:bundle:status",
          version: 1,
          mode: "status" as const,
          tone: "critical" as const,
          consequence: "high" as const,
          title: "Build failed",
          summary: "The latest build failed and may need a retry.",
          responseSpec: {
            kind: "acknowledge" as const,
            actions: [
              {
                id: "acknowledge",
                label: "Acknowledge",
                kind: "acknowledge" as const,
                emphasis: "primary" as const,
              },
            ],
          },
          timing: {
            createdAt: "2026-03-21T19:00:00.100Z",
            updatedAt: "2026-03-21T19:00:00.100Z",
          },
          metadata: {},
          provenance: {
            whyNow: "Work has failed and should be reviewed.",
            factors: ["task.updated", "failed"],
          },
        },
      },
    ],
    attentionViewSnapshots: [
      {
        sequence: 2,
        recordedAt: "2026-03-21T19:00:00.200Z",
        attentionView: {
          now: null,
          next: [
            {
              id: "frame:interaction:task:runtime:bundle:status",
              taskId: "task:runtime:bundle",
              interactionId: "interaction:task:runtime:bundle:status",
              version: 1,
              mode: "status" as const,
              tone: "critical" as const,
              consequence: "high" as const,
              title: "Build failed",
              summary: "The latest build failed and may need a retry.",
              responseSpec: {
                kind: "acknowledge" as const,
                actions: [
                  {
                    id: "acknowledge",
                    label: "Acknowledge",
                    kind: "acknowledge" as const,
                    emphasis: "primary" as const,
                  },
                ],
              },
              timing: {
                createdAt: "2026-03-21T19:00:00.100Z",
                updatedAt: "2026-03-21T19:00:00.100Z",
              },
              metadata: {},
              provenance: {
                whyNow: "Work has failed and should be reviewed.",
                factors: ["task.updated", "failed"],
              },
            },
          ],
          ambient: [],
        },
      },
    ],
    currentAttentionView: {
      now: null,
      next: [
        {
          id: "frame:interaction:task:runtime:bundle:status",
          taskId: "task:runtime:bundle",
          interactionId: "interaction:task:runtime:bundle:status",
          version: 1,
          mode: "status" as const,
          tone: "critical" as const,
          consequence: "high" as const,
          title: "Build failed",
          summary: "The latest build failed and may need a retry.",
          responseSpec: {
            kind: "acknowledge" as const,
            actions: [
              {
                id: "acknowledge",
                label: "Acknowledge",
                kind: "acknowledge" as const,
                emphasis: "primary" as const,
              },
            ],
          },
          timing: {
            createdAt: "2026-03-21T19:00:00.100Z",
            updatedAt: "2026-03-21T19:00:00.100Z",
          },
          metadata: {},
          provenance: {
            whyNow: "Work has failed and should be reviewed.",
            factors: ["task.updated", "failed"],
          },
        },
      ],
      ambient: [],
    },
    currentExplanation: explanationSnapshot({
      targetInteractionId: "interaction:task:runtime:bundle:status",
      targetLane: "next",
      headline: "Work has failed and should be reviewed.",
      targetMetadata: {
        execution: {
          surface: "terminal",
          runner: "codex",
        },
        governance: {
          approvalState: "pending",
          approvalId: "approval:deploy-17",
        },
        usage: {
          model: "gpt-5.4",
          inputTokens: 840,
          outputTokens: 112,
        },
      },
      whyNow: "Work has failed and should be reviewed.",
      routingAuthority: "status",
    }),
  } as unknown as RuntimeSessionCaptureLike;

  const bundle = createSessionBundleFromRuntimeCapture(capture, {
    sessionId: "session:runtime:bundle",
    title: "Runtime bundle replay",
    source: {
      id: "runtime:test",
      kind: "runtime",
      label: "Runtime test",
      redacted: true,
    },
  });

  assert.equal(bundle.sessionId, "session:runtime:bundle");
  assert.equal(bundle.steps.length, 1);
  assert.equal(bundle.steps[0]?.kind, "publishSource");
  assert.equal(bundle.normalizedEvents.length, 1);
  assert.equal(bundle.semanticSnapshots[0]?.interpretation.intentFrame, "failure");
  assert.equal(bundle.decisionSnapshots[0]?.decisionKind, "queue");
  assert.equal(bundle.decisionSnapshots[0]?.decisionRecordRoute, undefined);
  assert.equal("decisionRecord" in (bundle.traces[0] ?? {}), false);
  assert.equal(bundle.outcomes.finalNextCount, 1);
  assert.equal(bundle.explanation?.headline, "Work has failed and should be reviewed.");
  assert.equal(bundle.explanation?.targetLane, "next");
  assert.equal(bundle.explanation?.targetMetadata?.execution?.runner, "codex");
  assert.equal(bundle.explanation?.targetMetadata?.governance?.approvalId, "approval:deploy-17");
  assert.equal(bundle.explanation?.routingAuthority, "status");
  assert.equal(validateSessionBundle(bundle)?.explanation?.targetMetadata?.usage?.model, "gpt-5.4");
});

test("runtime session captures can be sliced from a baseline cursor", () => {
  const baselineCapture: RuntimeSessionCaptureLike = {
    runtimeId: "runtime:test",
    kind: "aperture",
    startedAt: "2026-03-21T19:59:00.000Z",
    exportedAt: "2026-03-21T20:00:00.000Z",
    captureSteps: [
      {
        sequence: 1,
        recordedAt: "2026-03-21T19:59:00.000Z",
        kind: "publishSource",
        event: {
          id: "src:baseline",
          type: "task.updated",
          taskId: "task:baseline",
          timestamp: "2026-03-21T19:59:00.000Z",
          source: { id: "custom-agent" },
          title: "Baseline status",
          status: "running",
        },
      },
    ],
    publishedSourceEvents: [
      {
        id: "src:baseline",
        type: "task.updated",
        taskId: "task:baseline",
        timestamp: "2026-03-21T19:59:00.000Z",
        source: { id: "custom-agent" },
        title: "Baseline status",
        status: "running",
      },
    ],
    submittedResponses: [],
    signals: [],
    traces: [],
    attentionViewSnapshots: [
      {
        sequence: 1,
        recordedAt: "2026-03-21T19:59:00.000Z",
        attentionView: {
          now: null,
          next: [],
          ambient: [{ interactionId: "interaction:baseline" } as never],
        },
      },
    ],
    currentAttentionView: {
      now: null,
      next: [],
      ambient: [],
    },
    adapters: [],
    currentExplanation: explanationSnapshot({}),
  };

  const cursor = createRuntimeSessionCaptureCursor(baselineCapture);
  const currentCapture: RuntimeSessionCaptureLike = {
    ...baselineCapture,
    exportedAt: "2026-03-21T20:05:00.000Z",
    captureSteps: [
      ...baselineCapture.captureSteps,
      {
        sequence: 2,
        recordedAt: "2026-03-21T20:04:00.000Z",
        kind: "publishSource",
        event: {
          id: "src:current",
          type: "task.updated",
          taskId: "task:current",
          timestamp: "2026-03-21T20:04:00.000Z",
          source: { id: "custom-agent" },
          title: "Current failure",
          summary: "The latest build failed and may need a retry.",
          status: "failed",
          semanticHints: {
            confidence: "low",
          },
        },
      },
      {
        sequence: 3,
        recordedAt: "2026-03-21T20:04:20.000Z",
        kind: "submit",
        response: {
          taskId: "task:current",
          interactionId: "interaction:task:current:status",
          response: { kind: "acknowledged" },
        },
      },
    ],
    publishedSourceEvents: [
      ...baselineCapture.publishedSourceEvents,
      {
        id: "src:current",
        type: "task.updated",
        taskId: "task:current",
        timestamp: "2026-03-21T20:04:00.000Z",
        source: { id: "custom-agent" },
        title: "Current failure",
        summary: "The latest build failed and may need a retry.",
        status: "failed",
        semanticHints: {
          confidence: "low",
        },
      },
    ],
    submittedResponses: [
      {
        taskId: "task:current",
        interactionId: "interaction:task:current:status",
        response: { kind: "acknowledged" },
      },
    ],
    attentionViewSnapshots: [
      ...baselineCapture.attentionViewSnapshots,
      {
        sequence: 2,
        recordedAt: "2026-03-21T20:04:05.000Z",
        attentionView: {
          now: { interactionId: "interaction:current" } as never,
          next: [],
          ambient: [],
        },
      },
    ],
    currentAttentionView: {
      now: { interactionId: "interaction:current" } as never,
      next: [],
      ambient: [],
    },
    currentExplanation: explanationSnapshot({
      targetInteractionId: "interaction:current",
      targetLane: "now",
      headline: "Current failure needs review.",
      whyNow: "Current failure needs review.",
      routingAuthority: "status",
    }),
  };

  const sliced = sliceRuntimeSessionCapture(currentCapture, cursor);

  assert.equal(sliced.captureSteps.length, 2);
  assert.equal(sliced.captureSteps[0]?.kind, "publishSource");
  assert.equal(sliced.captureSteps[1]?.kind, "submit");
  assert.equal(sliced.publishedSourceEvents.length, 1);
  assert.equal(sliced.publishedSourceEvents[0]?.id, "src:current");
  assert.equal(sliced.submittedResponses.length, 1);
  assert.equal(sliced.attentionViewSnapshots.length, 1);
  assert.equal(sliced.currentAttentionView.now?.interactionId, "interaction:current");
  assert.equal(sliced.currentExplanation?.headline, "Current failure needs review.");
  assert.equal(sliced.currentExplanation?.targetInteractionId, "interaction:current");
});
