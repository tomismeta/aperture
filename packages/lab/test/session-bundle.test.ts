import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalAttentionExportToScenario,
  createSessionBundle,
  createSessionBundleFromCanonicalAttentionExport,
  createRuntimeSessionCaptureCursor,
  createSessionBundleFromRuntimeCapture,
  defaultSessionBundlePath,
  loadSessionBundles,
  runReplayScenario,
  runSessionBundle,
  sliceRuntimeSessionCapture,
  type CanonicalAttentionExportLike,
  type ReplayScenario,
  type RuntimeSessionCaptureLike,
  writeSessionBundle,
} from "../src/index.js";

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
  assert.equal(bundle.outcomes.finalActiveInteractionId, "interaction:bundle:1");
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

  assert.deepEqual(
    replayed.views.at(-1)?.attentionView,
    result.views.at(-1)?.attentionView,
  );
  assert.deepEqual(replayed.decisions, result.decisions);
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
  assert.equal(loaded[0]?.outcomes.finalActiveInteractionId, bundle.outcomes.finalActiveInteractionId);
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
      active: null,
      queued: [],
      ambient: [],
      counts: {
        active: 0,
        queued: 0,
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
  assert.equal(scenario.expectations?.finalActiveInteractionId, null);
  assert.equal(scenario.expectations?.resultBucketCounts?.active, 0);
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
      active: null,
      queued: [],
      ambient: [],
      counts: {
        active: 0,
        queued: 0,
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
  assert.equal(bundle.traces.some((trace) => trace.event.id === "evt:paperclip:approval"), true);
  assert.equal(bundle.outcomes.finalActiveInteractionId, null);
  assert.equal(bundle.outcomes.finalQueuedCount, 0);
});

test("session bundles can be created from runtime-style captures", () => {
  const capture = {
    runtimeId: "runtime:test",
    kind: "aperture",
    exportedAt: "2026-03-21T19:01:00.000Z",
    steps: [
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
    sourceEvents: [
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
    responses: [],
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
          minimumPresentation: "queue" as const,
          minimumPresentationIsSticky: false,
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
            rationale: ["low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer"],
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
          resultBucket: "queued" as const,
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
            rationale: ["low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer"],
          },
          ambiguity: {
            kind: "interrupt" as const,
            reason: "low_signal" as const,
            resolution: "queue" as const,
          },
          reasons: ["low-confidence semantic interpretation keeps non-blocking work peripheral until the signal is clearer"],
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
            queued: 0,
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
            queued: 0,
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
          active: null,
          queued: [],
          ambient: [],
        },
        attentionView: {
          active: null,
          queued: [],
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
    viewSnapshots: [
      {
        sequence: 2,
        recordedAt: "2026-03-21T19:00:00.200Z",
        attentionView: {
          active: null,
          queued: [
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
    attentionView: {
      active: null,
      queued: [
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
  assert.equal(bundle.outcomes.finalQueuedCount, 1);
});

test("runtime session captures can be sliced from a baseline cursor", () => {
  const baselineCapture: RuntimeSessionCaptureLike = {
    runtimeId: "runtime:test",
    kind: "aperture",
    exportedAt: "2026-03-21T20:00:00.000Z",
    steps: [
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
    sourceEvents: [
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
    responses: [],
    signals: [],
    traces: [],
    viewSnapshots: [],
    attentionView: {
      active: null,
      queued: [],
      ambient: [],
    },
  };

  const cursor = createRuntimeSessionCaptureCursor(baselineCapture);
  const currentCapture: RuntimeSessionCaptureLike = {
    ...baselineCapture,
    exportedAt: "2026-03-21T20:05:00.000Z",
    steps: [
      ...baselineCapture.steps,
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
    sourceEvents: [
      ...baselineCapture.sourceEvents,
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
    responses: [
      {
        taskId: "task:current",
        interactionId: "interaction:task:current:status",
        response: { kind: "acknowledged" },
      },
    ],
    attentionView: {
      active: null,
      queued: [],
      ambient: [],
    },
  };

  const sliced = sliceRuntimeSessionCapture(currentCapture, cursor);

  assert.equal(sliced.steps.length, 2);
  assert.equal(sliced.steps[0]?.kind, "publishSource");
  assert.equal(sliced.steps[1]?.kind, "submit");
  assert.equal(sliced.sourceEvents.length, 1);
  assert.equal(sliced.sourceEvents[0]?.id, "src:current");
  assert.equal(sliced.responses.length, 1);
});
