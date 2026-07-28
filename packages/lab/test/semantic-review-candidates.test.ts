import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type { TaskFailureSemanticEvidence } from "@tomismeta/aperture-core/internal";

import {
  createSemanticReviewCandidateReportFromPaths,
  createSessionBundleFromDataclawRow,
  createSessionBundleFromScenario,
  createSessionBundleFromSweSmithRow,
  digestJsonValue,
  digestPublicCorpusLedgerEntries,
  writeSessionBundle,
  type DataclawRow,
  type PublicCorpusRecordLedgerEntry,
  type PublicCorpusRunManifest,
  type ReplayScenario,
  type SemanticReviewCandidateKind,
  type SweSmithRow,
} from "../src/index.js";
import type { OfflineReviewPreparedStep } from "../src/offline-review.js";
import { candidateKindsForStep } from "../src/semantic-review-candidate-policy.js";
import { readFailureEvidenceEventShape } from "../src/semantic-review-failure-event-shapes.js";
import type { ReplayDecisionSnapshot, ReplaySemanticSnapshot } from "../src/scenario.js";

const execFile = promisify(execFileCallback);
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, "../../..");
const TSX_CLI = path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs");

const SAMPLE_ROW: SweSmithRow = {
  instance_id: "example/repo-123",
  model: "claude-3-7-sonnet-20250219",
  resolved: true,
  traj_id: "example/repo-123.run-42",
  patch:
    "diff --git a/file.py b/file.py\nindex 111..222 100644\n--- a/file.py\n+++ b/file.py\n@@\n-print('bad')\n+print('good')\n",
  messages: JSON.stringify([
    {
      role: "system",
      content: "You are a helpful assistant that can interact with a computer to solve tasks.",
      message_type: "system_prompt",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "We're solving ISSUE: MoneyWidget crashes on invalid provider responses.",
        },
      ],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "I'll reproduce the failure first.",
      action: "pytest tests/test_widget.py",
      tool_calls: [
        {
          function: {
            name: "bash",
            arguments: '{"command":"pytest tests/test_widget.py"}',
          },
        },
      ],
      message_type: "action",
    },
    {
      role: "tool",
      content: [
        {
          type: "text",
          text: "Traceback (most recent call last): TypeError: string indices must be integers",
        },
      ],
      message_type: "observation",
    },
    {
      role: "assistant",
      content: "",
      action: "submit",
      tool_calls: [
        {
          function: {
            name: "submit",
            arguments: "{}",
          },
        },
      ],
      message_type: "action",
    },
  ]),
};

const SAMPLE_DATACLAW_GLOB_ROW: DataclawRow = {
  session_id: "223e4567-e89b-12d3-a456-426614174000",
  source: "claude",
  project: "demo-project",
  model: "claude-sonnet-4",
  start_time: "2026-03-28T00:00:00.000Z",
  stats: {
    user_messages: 1,
    assistant_messages: 1,
    tool_uses: 1,
    input_tokens: 123,
    output_tokens: 45,
  },
  messages: [
    {
      role: "user",
      content: "Find the hip geometry tests before making any changes.",
      timestamp: "2026-03-28T00:00:10.000Z",
    },
    {
      role: "assistant",
      content: "I'll locate matching tests first.",
      timestamp: "2026-03-28T00:00:30.000Z",
      tool_uses: [
        {
          tool: "Glob",
          input: {
            pattern: "**/test_scaled_mm_hip.py",
          },
          output: {
            files: ["tests/test_scaled_mm_hip.py"],
          },
          status: "success",
        },
      ],
    },
  ],
};

function createDataclawReadStatusRow(options: {
  sessionId: string;
  output: unknown;
  status: string;
}): DataclawRow {
  return {
    session_id: options.sessionId,
    source: "claude",
    project: "demo-project",
    model: "claude-sonnet-4",
    start_time: "2026-03-28T00:00:00.000Z",
    stats: {
      user_messages: 1,
      assistant_messages: 1,
      tool_uses: 1,
      input_tokens: 123,
      output_tokens: 45,
    },
    messages: [
      {
        role: "user",
        content: "Inspect src/client.ts before changing behavior.",
        timestamp: "2026-03-28T00:00:10.000Z",
      },
      {
        role: "assistant",
        content: "I'll inspect the implementation first.",
        timestamp: "2026-03-28T00:00:30.000Z",
        tool_uses: [
          {
            tool: "Read",
            input: {
              file_path: "/workspace/src/client.ts",
            },
            output: options.output,
            status: options.status,
          },
        ],
      },
    ],
  };
}

function createRoutineAmbientBundle() {
  const scenario: ReplayScenario = {
    id: "routine-ambient",
    title: "Routine ambient public trajectory update",
    steps: [
      {
        kind: "publishSource",
        label: "routine read",
        event: {
          id: "evt:routine-read",
          taskId: "task:routine-read",
          timestamp: "2026-04-27T00:00:00.000Z",
          type: "task.updated",
          source: {
            id: "public:test",
            kind: "public-trajectory",
            label: "Public test",
          },
          title: "read observation",
          summary: "1→export const ok = true;",
          status: "running",
          toolFamily: "read",
        },
      },
    ],
  };

  return createSessionBundleFromScenario(scenario, {
    exportedAt: "2026-04-27T00:00:00.000Z",
    replayTimeSource: () => Date.parse("2026-04-27T00:00:00.000Z"),
  });
}

function createMetadataOnlyToolFamilyFailedBundle() {
  const scenario: ReplayScenario = {
    id: "metadata-only-tool-family",
    title: "Metadata-only tool-family failed update",
    steps: [
      {
        kind: "publishSource",
        label: "metadata-only failed update",
        event: {
          id: "evt:metadata-only",
          taskId: "task:metadata-only",
          timestamp: "2026-04-27T00:00:00.000Z",
          type: "task.updated",
          title: "done",
          summary: "completed",
          status: "failed",
          metadata: {
            toolFamily: "bash",
          },
        },
      },
    ],
  };

  return createSessionBundleFromScenario(scenario, {
    exportedAt: "2026-04-27T00:00:00.000Z",
    replayTimeSource: () => Date.parse("2026-04-27T00:00:00.000Z"),
  });
}

function createDirectPublishFailedBundle() {
  const scenario: ReplayScenario = {
    id: "direct-publish-failed-update",
    title: "Direct publish failed update",
    steps: [
      {
        kind: "publish",
        label: "direct failed update",
        event: {
          id: "evt:direct-failed",
          taskId: "task:direct-failed",
          timestamp: "2026-04-27T00:00:00.000Z",
          type: "task.updated",
          title: "bash failure",
          summary: "Process exited with code 2.",
          status: "failed",
          toolFamily: "bash",
        },
      },
    ],
  };

  return createSessionBundleFromScenario(scenario, {
    exportedAt: "2026-04-27T00:00:00.000Z",
    replayTimeSource: () => Date.parse("2026-04-27T00:00:00.000Z"),
  });
}

function createFailedReadbackBundle(options: {
  id: string;
  title: string;
  outputSummaries: string[];
}) {
  const scenario: ReplayScenario = {
    id: options.id,
    title: options.title,
    steps: options.outputSummaries.map((summary, index) => ({
      kind: "publishSource" as const,
      label: `failed readback ${index + 1}`,
      event: {
        id: `evt:${options.id}:${index}`,
        taskId: `task:${options.id}:${index}`,
        timestamp: "2026-04-27T00:00:00.000Z",
        type: "task.updated" as const,
        title: "read failure",
        summary,
        status: "failed" as const,
        toolFamily: "read",
      },
    })),
  };

  return createSessionBundleFromScenario(scenario, {
    exportedAt: "2026-04-27T00:00:00.000Z",
    replayTimeSource: () => Date.parse("2026-04-27T00:00:00.000Z"),
  });
}

function createRepeatedUnclassifiedFailedBundle(options: {
  id: string;
  title: string;
  count: number;
}) {
  const scenario: ReplayScenario = {
    id: options.id,
    title: options.title,
    steps: Array.from({ length: options.count }, (_, index) => ({
      kind: "publishSource" as const,
      label: `failed update ${index + 1}`,
      event: {
        id: `evt:${options.id}:${index}`,
        taskId: `task:${options.id}`,
        timestamp: "2026-04-27T00:00:00.000Z",
        type: "task.updated" as const,
        title: "agent status",
        summary: `No clear classifier evidence ${index + 1}.`,
        status: "failed" as const,
      },
    })),
  };

  return createSessionBundleFromScenario(scenario, {
    exportedAt: "2026-04-27T00:00:00.000Z",
    replayTimeSource: () => Date.parse("2026-04-27T00:00:00.000Z"),
  });
}

function createUnclassifiedEventShapeBundle() {
  const scenario: ReplayScenario = {
    id: "unclassified-event-shapes",
    title: "Unclassified event shape coverage",
    steps: [
      {
        kind: "publishSource",
        label: "plain unclassified",
        event: {
          id: "evt:shape:plain",
          taskId: "task:shape:plain",
          timestamp: "2026-04-27T00:00:00.000Z",
          type: "task.updated",
          title: "agent status",
          summary: "No clear classifier evidence.",
          status: "failed",
        },
      },
      {
        kind: "publishSource",
        label: "line context unclassified",
        event: {
          id: "evt:shape:line-context",
          taskId: "task:shape:line-context",
          timestamp: "2026-04-27T00:00:00.000Z",
          type: "task.updated",
          title: "agent status",
          summary: "12-| alpha 13-| beta",
          status: "failed",
        },
      },
      {
        kind: "publishSource",
        label: "malformed structured unclassified",
        event: {
          id: "evt:shape:malformed",
          taskId: "task:shape:malformed",
          timestamp: "2026-04-27T00:00:00.000Z",
          type: "task.updated",
          title: "bash failure",
          summary: '{"wall_time":"later","output":"ok"',
          status: "failed",
          toolFamily: "bash",
        },
      },
      {
        kind: "publishSource",
        label: "marked truncated unclassified",
        event: {
          id: "evt:shape:truncated",
          taskId: "task:shape:truncated",
          timestamp: "2026-04-27T00:00:00.000Z",
          type: "task.updated",
          title: "bash failure",
          summary: '{"exit_code":0,"output":"patch applied successfully","truncated":true}',
          status: "failed",
          toolFamily: "bash",
        },
      },
    ],
  };

  return createSessionBundleFromScenario(scenario, {
    exportedAt: "2026-04-27T00:00:00.000Z",
    replayTimeSource: () => Date.parse("2026-04-27T00:00:00.000Z"),
  });
}

function createUnclassifiedEvidence(toolFamily?: string): TaskFailureSemanticEvidence {
  return {
    kind: "unclassified_failure",
    ...(toolFamily ? { toolFamily } : {}),
    readsAsObservation: false,
    consequenceBaseline: "high",
    text: {
      routineSuccessObservation: false,
      terminalFailureEvidence: false,
      expectedDiagnosticFailure: false,
      observationalReadback: false,
      taggedFileObservation: false,
      readObservationPayload: false,
      searchResultOutput: false,
      sourceCodeObservation: false,
      logObservation: false,
      buildMetadataObservation: false,
    },
  };
}

function createMissingWhyNowPolicyInput(): {
  step: OfflineReviewPreparedStep;
  semantic: ReplaySemanticSnapshot;
  decision: ReplayDecisionSnapshot;
} {
  const step: OfflineReviewPreparedStep = {
    stepIndex: 0,
    stepKind: "publishSource",
    stepLabel: "routine read",
    sourceExcerpt: "read observation -- 1->export const ok = true;",
    sourceEvent: {
      type: "task.updated",
      title: "read observation",
      summary: "1->export const ok = true;",
      status: "running",
      toolFamily: "read",
    },
    normalizedEvent: {
      type: "task.updated",
      title: "read observation",
      summary: "1->export const ok = true;",
      status: "running",
      toolFamily: "read",
    },
    apertureRead: {
      ask: null,
      intentFrame: "status_update",
      toolFamily: "read",
      consequence: "low",
      blocking: null,
      episode: null,
      confidence: "high",
      source: null,
      abstained: false,
      whyNow: null,
      relationKinds: [],
    },
    apertureDecision: {
      evaluationKind: "candidate",
      decisionKind: "ambient",
      resultLane: "ambient",
      semanticInfluence: [],
    },
  };
  const semantic: ReplaySemanticSnapshot = {
    stepIndex: 0,
    stepKind: "publishSource",
    stepLabel: "routine read",
    interpretation: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "read",
      consequence: "low",
      factors: [],
      relationHints: [],
      confidence: "high",
      reasons: [],
      provenance: {},
    },
  };
  const decision: ReplayDecisionSnapshot = {
    stepIndex: 0,
    stepKind: "publishSource",
    stepLabel: "routine read",
    evaluationKind: "candidate",
    decisionKind: "ambient",
    plannedLane: "ambient",
    resultLane: "ambient",
    semanticConfidence: "high",
  };

  return { step, semantic, decision };
}

test("semantic review candidate reports shortlist deterministic review pressure", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-"));
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    maxCandidatesPerSessionPerKind: 1,
    repoRoot: tempDir,
  });

  assert.equal(report.schemaVersion, 5);
  assert.equal(report.selection.promotionAuthority, "review_required");
  assert.equal(report.selection.maxFailureEvidenceExamplesPerKind, 2);
  assert.equal(report.selection.maxFailureEvidenceExamplesPerSessionPerKind, 1);
  assert.equal(report.selection.maxUnclassifiedEventShapes, 2);
  assert.equal(report.selection.maxUnclassifiedExamplesPerEventShape, 1);
  assert.equal(report.input.scannedBundleCount, 1);
  assert.ok(report.summary.countsByKind.failure_attention > 0);
  assert.ok(report.summary.failedTaskEvidence.failedTaskUpdateCount > 0);
  assert.ok(report.summary.failedTaskEvidence.countsByKind.terminal_failure > 0);
  assert.ok(report.summary.failedTaskEvidence.retainedExamplesByKind.terminal_failure.length > 0);
  assert.ok(report.candidatesByKind.failure_attention.length <= 1);
  assert.equal(
    Object.hasOwn(report.candidatesByKind.failure_attention[0] ?? {}, "expectedValue"),
    false,
  );
  assert.deepEqual(report.candidatesByKind.failure_attention[0]?.reviewFocusAreas, [
    "status",
    "intentFrame",
    "toolFamily",
    "consequence",
  ]);
});

test("semantic review candidate reports keep missing whyNow for high-pressure semantics", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-why-now-"));
  const bundle = createRoutineAmbientBundle();
  const semantic = bundle.semanticSnapshots[0]?.interpretation;
  assert.ok(semantic);
  semantic.consequence = "high";
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(report.summary.countsByKind.missing_why_now, 1);
  assert.equal(report.candidatesByKind.missing_why_now.length, 1);
});

test("semantic review candidate reports ignore missing whyNow on routine ambient updates", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-ambient-"));
  const bundle = createRoutineAmbientBundle();
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(bundle.semanticSnapshots[0]?.interpretation.whyNow ?? null, null);
  assert.equal(bundle.decisionSnapshots[0]?.resultLane, "ambient");
  assert.equal(report.summary.countsByKind.missing_why_now, 0);
  assert.equal(report.candidatesByKind.missing_why_now.length, 0);
});

test("missing whyNow policy follows attention-bearing review pressure", () => {
  const cases: Array<{
    name: string;
    mutate: (input: {
      step: OfflineReviewPreparedStep;
      semantic: ReplaySemanticSnapshot | null;
      decision: ReplayDecisionSnapshot | null;
    }) => {
      step?: OfflineReviewPreparedStep;
      semantic?: ReplaySemanticSnapshot | null;
      decision?: ReplayDecisionSnapshot | null;
    } | void;
    expectedMissingWhyNow: boolean;
    expectedKinds?: SemanticReviewCandidateKind[];
  }> = [
    {
      name: "low consequence ambient",
      mutate: () => undefined,
      expectedMissingWhyNow: false,
    },
    {
      name: "medium consequence ambient",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.consequence = "medium";
      },
      expectedMissingWhyNow: false,
    },
    {
      name: "high consequence ambient",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.consequence = "high";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["high_consequence_attention"],
    },
    {
      name: "failed source status",
      mutate: ({ step }) => {
        assert.ok(step.normalizedEvent);
        step.normalizedEvent.status = "failed";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["failure_attention"],
    },
    {
      name: "blocked source status",
      mutate: ({ step }) => {
        assert.ok(step.normalizedEvent);
        step.normalizedEvent.status = "blocked";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["blocked_attention"],
    },
    {
      name: "semantic failure",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.intentFrame = "failure";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["failure_attention"],
    },
    {
      name: "semantic blocked work",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.intentFrame = "blocked_work";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["blocked_attention"],
    },
    {
      name: "blocking aperture read",
      mutate: ({ step }) => {
        assert.ok(step.apertureRead);
        step.apertureRead.blocking = "blocking";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["blocked_attention"],
    },
    {
      name: "queue decision",
      mutate: ({ decision }) => {
        assert.ok(decision);
        decision.decisionKind = "queue";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["queue_decision"],
    },
    {
      name: "planned now decision",
      mutate: ({ decision }) => {
        assert.ok(decision);
        decision.plannedLane = "now";
      },
      expectedMissingWhyNow: true,
    },
    {
      name: "realized next decision",
      mutate: ({ decision }) => {
        assert.ok(decision);
        decision.resultLane = "next";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["queue_decision"],
    },
    {
      name: "low confidence",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.confidence = "low";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["semantic_uncertainty"],
    },
    {
      name: "medium confidence",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.confidence = "medium";
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["semantic_uncertainty"],
    },
    {
      name: "abstention",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.abstained = true;
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["semantic_uncertainty"],
    },
    {
      name: "ambiguity",
      mutate: ({ decision }) => {
        assert.ok(decision);
        decision.ambiguity = {
          kind: "interrupt",
          reason: "low_signal",
          resolution: "ambient",
        };
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["semantic_uncertainty"],
    },
    {
      name: "relation hint",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.relationHints = [{ kind: "same_issue" }];
      },
      expectedMissingWhyNow: true,
      expectedKinds: ["relation_signal"],
    },
    {
      name: "tool taxonomy gap alone",
      mutate: ({ step, semantic }) => {
        assert.ok(semantic);
        assert.ok(step.normalizedEvent);
        semantic.interpretation.toolFamily = "python";
        step.normalizedEvent.toolFamily = "python";
      },
      expectedMissingWhyNow: false,
      expectedKinds: ["tool_taxonomy_gap"],
    },
    {
      name: "nonempty whyNow under pressure",
      mutate: ({ semantic }) => {
        assert.ok(semantic);
        semantic.interpretation.consequence = "high";
        semantic.interpretation.whyNow = "This needs attention now.";
      },
      expectedMissingWhyNow: false,
      expectedKinds: ["high_consequence_attention"],
    },
    {
      name: "missing semantic snapshot",
      mutate: ({ decision }) => {
        assert.ok(decision);
        decision.resultLane = "now";
        return { semantic: null };
      },
      expectedMissingWhyNow: false,
      expectedKinds: ["high_consequence_attention"],
    },
  ];

  for (const entry of cases) {
    const input = createMissingWhyNowPolicyInput();
    const mutation = entry.mutate(input);
    const kinds = candidateKindsForStep(
      mutation?.step ?? input.step,
      mutation?.semantic !== undefined ? mutation.semantic : input.semantic,
      mutation?.decision !== undefined ? mutation.decision : input.decision,
    );

    assert.equal(kinds.includes("missing_why_now"), entry.expectedMissingWhyNow, entry.name);
    for (const expectedKind of entry.expectedKinds ?? []) {
      assert.equal(kinds.includes(expectedKind), true, entry.name);
    }
  }
});

test("semantic review event shapes bucket unknown tools and value variants", () => {
  const first = readFailureEvidenceEventShape({
    evidence: createUnclassifiedEvidence("Vendor Alpha Tool"),
    event: {
      summary: '{"exit_code":0,"output":"alpha result","truncated":true}',
      toolFamily: "Vendor Alpha Tool",
    },
  });
  const second = readFailureEvidenceEventShape({
    evidence: createUnclassifiedEvidence("Vendor Beta Tool"),
    event: {
      summary: '{"exit_code":0,"output":"beta result","truncated":false}',
      toolFamily: "Vendor Beta Tool",
    },
  });

  assert.equal(first, second);
  assert.equal(
    first,
    "tool:other|summary:json_object:keys=exit_code,output,truncated;exit_code=number;output=text:plain:short;truncated=boolean",
  );
  assert.equal(first.includes("vendor"), false);
  assert.equal(first.includes("true"), false);
  assert.equal(first.includes("false"), false);
});

test("semantic review event shapes preserve canonical write tools", () => {
  assert.equal(
    readFailureEvidenceEventShape({
      evidence: createUnclassifiedEvidence("write"),
      event: {
        summary: "No clear classifier evidence.",
        toolFamily: "write",
      },
    }),
    "tool:write|summary:text:plain:short",
  );
});

test("semantic review event shapes use JSON-aware object value types", () => {
  assert.equal(
    readFailureEvidenceEventShape({
      evidence: createUnclassifiedEvidence("bash"),
      event: {
        summary: '{"exit_code":null,"output":null,"truncated":{"source":"hidden"},"wall_time":[1]}',
        toolFamily: "bash",
      },
    }),
    "tool:bash|summary:json_object:keys=exit_code,output,truncated,wall_time;exit_code=null;output=null;truncated=object;wall_time=array",
  );
});

test("semantic review event shapes distinguish valid JSON primitives from prose", () => {
  const cases = [
    ['"hello"', "tool:none|summary:json_string"],
    ["123", "tool:none|summary:json_number"],
    ["true", "tool:none|summary:json_boolean"],
    ["null", "tool:none|summary:json_null"],
    ["hello", "tool:none|summary:text:plain:short"],
  ] as const;

  for (const [summary, expected] of cases) {
    assert.equal(
      readFailureEvidenceEventShape({
        evidence: createUnclassifiedEvidence(),
        event: { summary, toolFamily: null },
      }),
      expected,
    );
  }
});

test("semantic review candidate reports flag unrecognized imported tool families", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-tools-"));
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  for (const normalized of bundle.normalizedEvents) {
    const event = normalized.event as { toolFamily?: string };
    if (event.toolFamily === "bash") {
      event.toolFamily = "python";
    }
  }
  for (const semantic of bundle.semanticSnapshots) {
    if (semantic.interpretation.toolFamily === "bash") {
      semantic.interpretation.toolFamily = "python";
    }
  }
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.ok(report.summary.countsByKind.tool_taxonomy_gap > 0);
  assert.equal(report.candidatesByKind.tool_taxonomy_gap[0]?.semantic.toolFamily, "python");
});

test("semantic review candidate reports treat canonical write tool family as known", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-write-"));
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  for (const normalized of bundle.normalizedEvents) {
    const event = normalized.event as { toolFamily?: string };
    if (event.toolFamily === "bash") {
      event.toolFamily = "write";
    }
  }
  for (const semantic of bundle.semanticSnapshots) {
    if (semantic.interpretation.toolFamily === "bash") {
      semantic.interpretation.toolFamily = "write";
    }
  }
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(report.summary.countsByKind.tool_taxonomy_gap, 0);
});

test("semantic review candidate reports treat canonical DataClaw Glob usage as known", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-glob-"));
  const bundle = createSessionBundleFromDataclawRow(SAMPLE_DATACLAW_GLOB_ROW);
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(
    bundle.semanticSnapshots.some((snapshot) => snapshot.interpretation.toolFamily === "search"),
    true,
  );
  assert.equal(report.summary.countsByKind.tool_taxonomy_gap, 0);
  assert.equal(report.candidatesByKind.tool_taxonomy_gap.length, 0);
});

test("semantic review candidate reports do not treat DataClaw read status mismatches as failures", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-readback-"));
  const bundles = [
    createSessionBundleFromDataclawRow(
      createDataclawReadStatusRow({
        sessionId: "323e4567-e89b-12d3-a456-426614174000",
        output: {
          text: "1→export async function request() {\n2→  return fetch('/api');\n3→}",
        },
        status: "failed",
      }),
    ),
    createSessionBundleFromDataclawRow(
      createDataclawReadStatusRow({
        sessionId: "423e4567-e89b-12d3-a456-426614174000",
        output: {
          files: [
            {
              path: "/workspace/src/client.ts",
              content: "export async function request() {\n  return fetch('/api');\n}",
            },
          ],
        },
        status: "failed",
      }),
    ),
    createSessionBundleFromDataclawRow(
      createDataclawReadStatusRow({
        sessionId: "523e4567-e89b-12d3-a456-426614174000",
        output: {
          text: '#ifndef GRAMMAR_H\n#define GRAMMAR_H\n#include <memory>\nclass Parser { const char* error = "symbol not found"; };',
        },
        status: "failed",
      }),
    ),
  ];
  const bundlePaths = await Promise.all(
    bundles.map(async (bundle, index) => {
      const bundlePath = path.join(tempDir, `bundle-${index}.json`);
      await writeSessionBundle(bundlePath, bundle);
      return bundlePath;
    }),
  );

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths,
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(
    bundles.some((bundle) =>
      bundle.semanticSnapshots.some(
        (snapshot) => snapshot.interpretation.activityClass === "tool_failure",
      ),
    ),
    false,
  );
  assert.equal(report.summary.countsByKind.failure_attention, 0);
  assert.equal(report.summary.countsByKind.high_consequence_attention, 0);
  assert.equal(report.summary.failedTaskEvidence.failedTaskUpdateCount, 0);
  assert.equal(report.summary.failedTaskEvidence.countsByKind.observational_payload, 0);
  assert.equal(report.summary.failedTaskEvidence.readsAsObservationCount, 0);
  assert.deepEqual(report.summary.failedTaskEvidence.unclassifiedEventShapeCounts, {});
});

test("semantic review evidence audit classifies failed readbacks as observational payload", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-payload-"));
  const bundle = createFailedReadbackBundle({
    id: "failed-readbacks",
    title: "Failed readback status mismatch",
    outputSummaries: [
      "Result of running cat -n /workspace/src/client.ts: 1 export const ok = true;",
      "<path>/workspace/src/client.ts</path> <type>file</type> <content>export const ok = true;</content>",
      "Observation path /workspace/src/client.ts showing first 10 lines export function request() { return true; }",
    ],
  });
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(report.summary.failedTaskEvidence.failedTaskUpdateCount, 3);
  assert.equal(report.summary.failedTaskEvidence.countsByKind.observational_payload, 3);
  assert.equal(report.summary.failedTaskEvidence.readsAsObservationCount, 3);
  assert.equal(report.summary.failedTaskEvidence.countsByToolFamily.read, 3);
  assert.equal(
    report.summary.failedTaskEvidence.retainedExamplesByKind.observational_payload.length,
    2,
  );
});

test("semantic review evidence audit ignores metadata-only tool-family routing evidence", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-metadata-"));
  const bundle = createMetadataOnlyToolFamilyFailedBundle();
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(report.summary.failedTaskEvidence.failedTaskUpdateCount, 1);
  assert.equal(report.summary.failedTaskEvidence.countsByKind.unclassified_failure, 1);
  assert.equal(report.summary.failedTaskEvidence.missingToolFamilyCount, 1);
  assert.deepEqual(report.summary.failedTaskEvidence.unclassifiedEventShapeCounts, {
    "tool:none|summary:text:plain:short": 1,
  });
  assert.equal(
    Object.hasOwn(report.summary.failedTaskEvidence.countsByToolFamily, "unknown"),
    false,
  );
  assert.equal(
    report.summary.failedTaskEvidence.retainedExamplesByKind.unclassified_failure[0]?.event
      .toolFamily,
    null,
  );
  assert.equal(
    report.summary.failedTaskEvidence.retainedExamplesByKind.unclassified_failure[0]?.eventShape,
    "tool:none|summary:text:plain:short",
  );
});

test("semantic review evidence audit clusters unclassified event shapes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-shapes-"));
  const bundle = createUnclassifiedEventShapeBundle();
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 5,
    repoRoot: tempDir,
  });

  assert.equal(report.summary.failedTaskEvidence.failedTaskUpdateCount, 4);
  assert.equal(report.summary.failedTaskEvidence.countsByKind.unclassified_failure, 4);
  assert.deepEqual(report.summary.failedTaskEvidence.unclassifiedEventShapeCounts, {
    "tool:bash|summary:json_object:keys=exit_code,output,truncated;exit_code=number;output=text:plain:short;truncated=boolean": 1,
    "tool:bash|summary:malformed_json_object:keys=output,wall_time": 1,
    "tool:none|summary:text:line_numbered_context": 1,
    "tool:none|summary:text:plain:short": 1,
  });
  assert.equal(
    report.summary.failedTaskEvidence.retainedUnclassifiedExamplesByEventShape[
      "tool:bash|summary:malformed_json_object:keys=output,wall_time"
    ]?.[0]?.event.summary,
    '{"wall_time":"later","output":"ok"',
  );
});

test("semantic review evidence audit bounds retained unclassified event-shape examples", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-shape-caps-"));
  const bundlePaths = await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const bundle = createRepeatedUnclassifiedFailedBundle({
        id: `same-shape-${index}`,
        title: `Same shape ${index}`,
        count: 1,
      });
      const bundlePath = path.join(tempDir, `bundle-${index}.json`);
      await writeSessionBundle(bundlePath, bundle);
      return bundlePath;
    }),
  );

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths,
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    maxCandidatesPerSessionPerKind: 2,
    repoRoot: tempDir,
  });

  const shape = "tool:none|summary:text:plain:short";
  assert.deepEqual(report.summary.failedTaskEvidence.unclassifiedEventShapeCounts, {
    [shape]: 4,
  });
  assert.equal(
    report.summary.failedTaskEvidence.retainedUnclassifiedExamplesByEventShape[shape]?.length,
    2,
  );
  assert.deepEqual(
    report.summary.failedTaskEvidence.retainedUnclassifiedExamplesByEventShape[shape]?.map(
      (example) => example.sessionId,
    ),
    ["same-shape-0", "same-shape-1"],
  );
});

test("semantic review evidence audit counts direct publish failed task updates", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-publish-"));
  const bundle = createDirectPublishFailedBundle();
  const bundlePath = path.join(tempDir, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [bundlePath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    repoRoot: tempDir,
  });

  assert.equal(report.summary.failedTaskEvidence.failedTaskUpdateCount, 1);
  assert.equal(report.summary.failedTaskEvidence.countsByKind.terminal_failure, 1);
  assert.equal(report.summary.failedTaskEvidence.countsByToolFamily.bash, 1);
});

test("semantic review evidence audit retains deterministic per-session examples", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-caps-"));
  const firstBundle = createRepeatedUnclassifiedFailedBundle({
    id: "first-session",
    title: "First repeated failures",
    count: 2,
  });
  const secondBundle = createRepeatedUnclassifiedFailedBundle({
    id: "second-session",
    title: "Second repeated failures",
    count: 1,
  });
  const firstPath = path.join(tempDir, "b-first.json");
  const secondPath = path.join(tempDir, "a-second.json");
  await writeSessionBundle(firstPath, firstBundle);
  await writeSessionBundle(secondPath, secondBundle);

  const report = await createSemanticReviewCandidateReportFromPaths({
    bundlePaths: [firstPath, secondPath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 2,
    maxCandidatesPerSessionPerKind: 1,
    repoRoot: tempDir,
  });

  const examples = report.summary.failedTaskEvidence.retainedExamplesByKind.unclassified_failure;
  assert.equal(report.summary.failedTaskEvidence.failedTaskUpdateCount, 3);
  assert.equal(examples.length, 2);
  assert.deepEqual(
    examples.map((example) => example.sessionId),
    ["second-session", "first-session"],
  );
  assert.deepEqual(
    examples.map((example) => example.bundlePath),
    ["a-second.json", "b-first.json"],
  );
});

test("review-candidates CLI writes JSON and markdown reports", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-cli-"));
  const bundlePath = path.join(tempDir, "bundles", "bundle.json");
  const outputPath = path.join(tempDir, "report");
  const markdownPath = path.join(tempDir, "report.md");
  await writeSessionBundle(bundlePath, createSessionBundleFromSweSmithRow(SAMPLE_ROW));

  const { stdout } = await execFile(
    process.execPath,
    [
      TSX_CLI,
      path.join(REPO_ROOT, "scripts/fstop.ts"),
      "review-candidates",
      "--bundle-dir",
      path.dirname(bundlePath),
      "--output",
      outputPath,
      "--limit-per-kind",
      "2",
      "--json",
    ],
    { cwd: REPO_ROOT },
  );

  const payload = JSON.parse(stdout) as {
    status: string;
    outputPath: string;
    markdownPath: string;
    input: Awaited<ReturnType<typeof createSemanticReviewCandidateReportFromPaths>>["input"];
    summary: Awaited<ReturnType<typeof createSemanticReviewCandidateReportFromPaths>>["summary"];
  };
  const markdown = await readFile(markdownPath, "utf8");

  assert.equal(payload.status, "ok");
  assert.equal(payload.outputPath, outputPath);
  assert.equal(payload.markdownPath, markdownPath);
  assert.equal(payload.input.scannedBundleCount, 1);
  assert.ok(payload.summary.countsByKind.failure_attention > 0);
  assert.match(markdown, /Semantic Review Candidate Census/);
  assert.match(markdown, /failure_attention/);
});

test("review-candidates CLI rejects missing path option values", async () => {
  await assert.rejects(
    execFile(
      process.execPath,
      [
        TSX_CLI,
        path.join(REPO_ROOT, "scripts/fstop.ts"),
        "review-candidates",
        "--bundle",
        "--json",
      ],
      { cwd: REPO_ROOT },
    ),
    /--bundle requires a path/,
  );
});

test("review-candidates CLI rejects colliding JSON and markdown outputs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-collision-"));
  const bundlePath = path.join(tempDir, "bundles", "bundle.json");
  const outputPath = path.join(tempDir, "report");
  await writeSessionBundle(bundlePath, createSessionBundleFromSweSmithRow(SAMPLE_ROW));

  await assert.rejects(
    execFile(
      process.execPath,
      [
        TSX_CLI,
        path.join(REPO_ROOT, "scripts/fstop.ts"),
        "review-candidates",
        "--bundle",
        bundlePath,
        "--output",
        outputPath,
        "--markdown-output",
        outputPath,
        "--json",
      ],
      { cwd: REPO_ROOT },
    ),
    /JSON and Markdown outputs must be different paths/,
  );
});

test("semantic review candidates can resolve bundles through a verified public corpus manifest", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-manifest-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "written",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
    canonicalSessionDigest: digestJsonValue({ sessionId: bundle.sessionId }),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const report = await createSemanticReviewCandidateReportFromPaths({
    manifestPaths: [manifestPath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 1,
    repoRoot: tempDir,
  });

  assert.equal(report.input.manifestRecordCount, 1);
  assert.equal(report.input.manifestBundleCount, 1);
  assert.equal(report.input.scannedBundleCount, 1);
  assert.equal(report.candidatesByKind.failure_attention[0]?.publicCorpus?.offset, 42);
  assert.equal(
    report.candidatesByKind.failure_attention[0]?.publicCorpus?.canonicalSessionDigest,
    record.canonicalSessionDigest,
  );
});

test("semantic review candidates reject manifest records whose bundle bytes drift", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-tamper-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "written",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
    canonicalSessionDigest: digestJsonValue({ sessionId: bundle.sessionId }),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeSessionBundle(bundlePath, { ...bundle, title: "tampered bundle" });

  await assert.rejects(
    createSemanticReviewCandidateReportFromPaths({
      manifestPaths: [manifestPath],
      generatedAt: "2026-04-27T00:00:00.000Z",
      maxCandidatesPerKind: 1,
      repoRoot: tempDir,
    }),
    /bundle digest mismatch/,
  );
});

test("semantic review candidates require completed manifest integrity", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-integrity-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "written",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  manifest.status = "running";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    createSemanticReviewCandidateReportFromPaths({
      manifestPaths: [manifestPath],
      generatedAt: "2026-04-27T00:00:00.000Z",
      maxCandidatesPerKind: 1,
      repoRoot: tempDir,
    }),
    /manifest is not completed/,
  );

  manifest.status = "completed";
  delete manifest.integrity.bundleSetDigest;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await assert.rejects(
    createSemanticReviewCandidateReportFromPaths({
      manifestPaths: [manifestPath],
      generatedAt: "2026-04-27T00:00:00.000Z",
      maxCandidatesPerKind: 1,
      repoRoot: tempDir,
    }),
    /lacks bundleSetDigest/,
  );
});

test("semantic review candidates do not load unverified skipped-existing records", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aperture-review-candidates-skipped-"));
  const runRoot = path.join(tempDir, "run");
  const bundleRoot = path.join(tempDir, "bundles");
  const bundle = createSessionBundleFromSweSmithRow(SAMPLE_ROW);
  const bundlePath = path.join(bundleRoot, "bundle.json");
  await writeSessionBundle(bundlePath, bundle);

  const record: PublicCorpusRecordLedgerEntry = {
    offset: 42,
    rowIndex: 0,
    recordId: "trace:42",
    sourceIdentity: "trace/source/42",
    rowDigest: digestJsonValue({ row: 42 }),
    status: "skipped_existing",
    sessionId: bundle.sessionId,
    bundlePath,
    bundleDigest: digestJsonValue(bundle),
  };
  const recordsPath = path.join(runRoot, "records.jsonl");
  const errorsPath = path.join(runRoot, "errors.jsonl");
  const manifestPath = path.join(runRoot, "manifest.json");
  await mkdir(runRoot, { recursive: true });
  await writeFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
  await writeFile(errorsPath, "", "utf8");

  const manifest = buildManifest({
    tempDir,
    runRoot,
    bundleRoot,
    manifestPath,
    recordsPath,
    errorsPath,
    recordsDigest: digestPublicCorpusLedgerEntries([record]),
    errorsDigest: digestPublicCorpusLedgerEntries([]),
    bundleSetDigest: digestJsonValue([record.bundleDigest]),
  });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const report = await createSemanticReviewCandidateReportFromPaths({
    manifestPaths: [manifestPath],
    generatedAt: "2026-04-27T00:00:00.000Z",
    maxCandidatesPerKind: 1,
    repoRoot: tempDir,
  });

  assert.equal(report.input.manifestRecordCount, 1);
  assert.equal(report.input.manifestBundleCount, 0);
  assert.equal(report.input.scannedBundleCount, 0);
});

function buildManifest(input: {
  tempDir: string;
  runRoot: string;
  bundleRoot: string;
  manifestPath: string;
  recordsPath: string;
  errorsPath: string;
  recordsDigest: `sha256:${string}`;
  errorsDigest: `sha256:${string}`;
  bundleSetDigest?: `sha256:${string}`;
}): PublicCorpusRunManifest {
  return {
    schemaVersion: 2,
    runId: "trace-commons-train-o42-m1-p1-test",
    status: "completed",
    createdAt: "2026-04-27T00:00:00.000Z",
    startedAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:01.000Z",
    completedAt: "2026-04-27T00:00:01.000Z",
    source: {
      kind: "public-trajectory",
      adapter: "trace-commons",
      dataset: "trace-commons/agent-traces",
      upstream: "trace-commons/agent-traces",
      upstreamUrl: "https://huggingface.co/datasets/trace-commons/agent-traces",
      config: "default",
      split: "train",
      requestedRevision: "live_rows_api_unpinned",
      resolvedRevision: "live_rows_api_unpinned",
      reproducibility: "digest-verifiable",
    },
    plan: {
      dataset: "trace-commons",
      split: "train",
      startOffset: 42,
      maxRows: 1,
      pageSize: 1,
      requestTimeoutSeconds: 30,
      maxResponseBytes: 67_108_864,
      maxRetries: 2,
      existing: "verify",
      mirrorRaw: false,
      dryRun: false,
      planOnly: false,
    },
    runtime: {
      runtimeRoot: input.tempDir,
      cwd: input.tempDir,
      nodeVersion: process.version,
      importerSchemaVersion: 2,
    },
    privacy: {
      classification: "public_anonymized_best_effort",
      redactionPosture: "review_required_before_promotion",
      licenseScope: "dataset_compilation_cc_by_4.0_embedded_content_may_differ",
      rawRetention: "not_mirrored",
    },
    progress: {
      nextOffset: 43,
      pagesAttempted: 1,
      pagesCompleted: 1,
      rowsFetched: 1,
      rowsImported: 1,
      rowsSkipped: 0,
      rowsFailed: 0,
      rowsDuplicated: 0,
    },
    artifacts: {
      runRoot: input.runRoot,
      manifestPath: input.manifestPath,
      recordsPath: input.recordsPath,
      errorsPath: input.errorsPath,
      bundleRoot: input.bundleRoot,
    },
    integrity: {
      recordsDigest: input.recordsDigest,
      errorsDigest: input.errorsDigest,
      bundleSetDigest:
        input.bundleSetDigest ??
        digestJsonValue([digestJsonValue(createSessionBundleFromSweSmithRow(SAMPLE_ROW))]),
    },
  };
}
