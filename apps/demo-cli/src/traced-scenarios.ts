import { ApertureCore, type ApertureEvent, type FrameResponse } from "@aperture/core";
import type { CodexServerRequest } from "@aperture/codex";
import { mapCodexServerRequest } from "@aperture/codex";
import { renderAttentionView, renderTrace } from "@aperture/cli";
import type { PaperclipLiveEvent } from "@aperture/paperclip";
import { mapPaperclipLiveEvent } from "@aperture/paperclip";

type Scenario = {
  id: string;
  title: string;
  run: (options: ScenarioOptions) => ScenarioReport;
};

type ScenarioOptions = {
  verbose: boolean;
};

type ScenarioReport = {
  active: string | null;
  queued: string[];
  ambient: string[];
  decisions: Record<string, number>;
  lastTaskAttentionState: string | null;
  lastGlobalAttentionState: string | null;
};

function main(): void {
  const reportMode = process.argv.includes("--report");
  const scenarios: Scenario[] = [
    {
      id: "approval-over-failure",
      title: "Blocking approval holds focus over failed status until resolved",
      run: scenarioApprovalOverFailure,
    },
    {
      id: "global-overload",
      title: "Global overload quiets low-value status across sources",
      run: scenarioGlobalOverload,
    },
    {
      id: "hesitation",
      title: "Hesitation keeps blocking work sticky when context is repeatedly expanded",
      run: scenarioHesitation,
    },
    {
      id: "mixed-queue",
      title: "Paperclip and Codex requests share one queued attention stream",
      run: scenarioMixedQueue,
    },
    {
      id: "critical-rescue",
      title: "Critical status stays visible despite quieting heuristics",
      run: scenarioCriticalRescue,
    },
  ];

  for (const scenario of scenarios) {
    console.log(`\n=== Scenario: ${scenario.id} ===`);
    console.log(scenario.title);
    const report = scenario.run({ verbose: !reportMode });
    if (reportMode) {
      console.log(renderScenarioReport(report));
    }
  }
}

function scenarioApprovalOverFailure(options: ScenarioOptions): ScenarioReport {
  const { core, traces } = createScenarioCore(options.verbose);
  const now = Date.now();

  const events = flattenPaperclipEvents([
    {
      id: 1,
      companyId: "company:paperclip",
      type: "activity.logged",
      createdAt: new Date(now).toISOString(),
      payload: {
        entityType: "approval",
        entityId: "approval:deploy:1",
        action: "approval.created",
        details: {
          type: "approve_ceo_strategy",
          requestedByAgentId: "agent:alpha",
          issueIds: ["ISS-500"],
        },
      },
    },
    {
      id: 2,
      companyId: "company:paperclip",
      type: "heartbeat.run.status",
      createdAt: new Date(now + 100).toISOString(),
      payload: {
        runId: "run:failed:1",
        agentId: "agent:beta",
        status: "failed",
        error: "Migration failed",
      },
    },
  ]);

  publishAll(core, events);
  logAttention(core, "before response", options.verbose);

  core.submit({
    taskId: "paperclip:approval:approval:deploy:1",
    interactionId: "paperclip:approval:approval:deploy:1:review",
    response: { kind: "approved" },
  });

  logAttention(core, "after approval resolved", options.verbose);
  return summarizeScenario(core, traces);
}

function scenarioGlobalOverload(options: ScenarioOptions): ScenarioReport {
  const { core, traces } = createScenarioCore(options.verbose);
  const base = Date.parse("2026-03-09T12:00:00.000Z");

  // Build recent global overload without coupling it to a specific adapter.
  seedPresented(core, "task:one", "interaction:one", base);
  seedDeferred(core, "task:one", "interaction:one", base + 1_000, "queued");
  seedDeferred(core, "task:two", "interaction:two", base + 2_000, "suppressed");
  seedDeferred(core, "task:three", "interaction:three", base + 3_000, "queued");

  publishAll(core, [
    {
      id: "evt:quiet-status",
      type: "task.updated",
      taskId: "task:quiet",
      timestamp: new Date(base + 4_000).toISOString(),
      source: { id: "codex-thread-1", kind: "codex", label: "Codex" },
      title: "Background indexing complete",
      summary: "A low-value indexing update arrived.",
      status: "running",
      progress: 75,
    },
  ]);

  logAttention(core, "after global overload", options.verbose);
  return summarizeScenario(core, traces);
}

function scenarioHesitation(options: ScenarioOptions): ScenarioReport {
  const { core, traces } = createScenarioCore(options.verbose);
  const base = Date.parse("2026-03-09T12:30:00.000Z");
  const taskId = "task:hesitation";
  const interactionId = "interaction:hesitation:approval";

  seedPresented(core, taskId, interactionId, base);
  core.recordSignal({
    kind: "context_expanded",
    taskId,
    interactionId,
    timestamp: new Date(base + 1_000).toISOString(),
    section: "provenance",
  });
  core.recordSignal({
    kind: "responded",
    taskId,
    interactionId,
    timestamp: new Date(base + 21_000).toISOString(),
    responseKind: "approved",
    latencyMs: 20_000,
  });

  publishAll(core, [
    {
      id: "evt:approval",
      type: "human.input.requested",
      taskId,
      interactionId,
      timestamp: new Date(base + 30_000).toISOString(),
      source: { id: "codex-thread-h", kind: "codex", label: "Codex" },
      title: "Approve delayed command",
      summary: "Codex needs approval for a command that usually requires more context.",
      request: { kind: "approval" },
    },
    {
      id: "evt:status",
      type: "task.updated",
      taskId,
      timestamp: new Date(base + 31_000).toISOString(),
      source: { id: "codex-thread-h", kind: "codex", label: "Codex" },
      title: "Supplemental status update",
      summary: "A low-priority status update arrived behind the approval.",
      status: "running",
      progress: 10,
    },
  ]);

  logAttention(core, "after hesitation-informed routing", options.verbose);
  return summarizeScenario(core, traces);
}

function scenarioMixedQueue(options: ScenarioOptions): ScenarioReport {
  const { core, traces } = createScenarioCore(options.verbose);
  const now = Date.now();

  const paperclipEvents = flattenPaperclipEvents([
    {
      id: 1,
      companyId: "company:paperclip",
      type: "activity.logged",
      createdAt: new Date(now).toISOString(),
      payload: {
        entityType: "approval",
        entityId: "approval:hire:2",
        action: "approval.created",
        details: {
          type: "hire_agent",
          requestedByAgentId: "agent:alpha",
          issueIds: ["ISS-101"],
        },
      },
    },
  ]);

  const codexEvents = flattenCodexRequests([
    {
      id: "req-choice",
      method: "item/tool/requestUserInput",
      params: {
        itemId: "item:input:1",
        threadId: "thread-1",
        turnId: "turn-1",
        questions: [
          {
            id: "deploy_target",
            header: "Target",
            question: "Which environment should be used?",
            options: [
              { label: "staging", description: "Preview environment" },
              { label: "production", description: "Live traffic" },
            ],
          },
        ],
      },
    },
    {
      id: "req-form",
      method: "item/tool/requestUserInput",
      params: {
        itemId: "item:input:2",
        threadId: "thread-2",
        turnId: "turn-2",
        questions: [
          {
            id: "reason",
            header: "Reason",
            question: "Why should this command continue?",
          },
        ],
      },
    },
  ]);

  publishAll(core, [...paperclipEvents, ...codexEvents]);
  logAttention(core, "after mixed-source publish", options.verbose);

  core.submit({
    taskId: "paperclip:approval:approval:hire:2",
    interactionId: "paperclip:approval:approval:hire:2:review",
    response: { kind: "approved" },
  });

  logAttention(core, "after first response promotion", options.verbose);
  return summarizeScenario(core, traces);
}

function scenarioCriticalRescue(options: ScenarioOptions): ScenarioReport {
  const { core, traces } = createScenarioCore(options.verbose);
  const base = Date.parse("2026-03-09T13:00:00.000Z");
  const taskId = "task:noisy-status";
  const interactionId = "interaction:task:noisy-status:status";

  seedPresented(core, taskId, interactionId, base);
  core.recordSignal({
    kind: "dismissed",
    taskId,
    interactionId,
    timestamp: new Date(base + 1_000).toISOString(),
    latencyMs: 1_000,
  });
  seedPresented(core, taskId, interactionId, base + 2_000);
  core.recordSignal({
    kind: "dismissed",
    taskId,
    interactionId,
    timestamp: new Date(base + 3_000).toISOString(),
    latencyMs: 1_000,
  });
  core.recordSignal({
    kind: "deferred",
    taskId,
    interactionId,
    timestamp: new Date(base + 4_000).toISOString(),
    reason: "suppressed",
  });
  core.recordSignal({
    kind: "deferred",
    taskId,
    interactionId,
    timestamp: new Date(base + 5_000).toISOString(),
    reason: "suppressed",
  });

  publishAll(core, [
    {
      id: "evt:critical-status",
      type: "task.updated",
      taskId,
      timestamp: new Date(base + 6_000).toISOString(),
      source: { id: "paperclip-run-7", kind: "paperclip", label: "Paperclip run" },
      title: "Production deployment failed",
      summary: "The latest deployment failed in production.",
      status: "failed",
    },
  ]);

  logAttention(core, "after critical rescue", options.verbose);
  return summarizeScenario(core, traces);
}

function createScenarioCore(verbose: boolean): { core: ApertureCore; traces: Array<ReturnType<typeof captureTrace>> } {
  const core = new ApertureCore();
  const traces: Array<ReturnType<typeof captureTrace>> = [];
  core.onTrace((trace) => {
    traces.push(captureTrace(trace));
    if (verbose) {
      console.log(`\n--- Trace (${trace.event.taskId}) ---\n`);
      console.log(renderTrace(trace));
    }
  });
  return { core, traces };
}

function publishAll(core: ApertureCore, events: ApertureEvent[]): void {
  for (const event of events) {
    core.publish(event);
  }
}

function logAttention(core: ApertureCore, label: string, verbose: boolean): void {
  if (!verbose) {
    return;
  }
  console.log(`\n--- Attention (${label}) ---\n`);
  console.log(renderAttentionView(core.getAttentionView()));
}

function summarizeScenario(
  core: ApertureCore,
  traces: Array<ReturnType<typeof captureTrace>>,
): ScenarioReport {
  const attentionView = core.getAttentionView();
  const decisions = traces.reduce<Record<string, number>>((counts, trace) => {
    if (!trace.decision) {
      return counts;
    }
    counts[trace.decision] = (counts[trace.decision] ?? 0) + 1;
    return counts;
  }, {});
  const lastTrace = traces.at(-1) ?? null;

  return {
    active: attentionView.active?.title ?? null,
    queued: attentionView.queued.map((frame) => frame.title),
    ambient: attentionView.ambient.map((frame) => frame.title),
    decisions,
    lastTaskAttentionState: lastTrace?.taskAttentionState ?? null,
    lastGlobalAttentionState: lastTrace?.globalAttentionState ?? null,
  };
}

function renderScenarioReport(report: ScenarioReport): string {
  const lines = ["Scenario Report"];
  lines.push(`- Active: ${report.active ?? "none"}`);
  lines.push(`- Queued: ${report.queued.length > 0 ? report.queued.join(", ") : "none"}`);
  lines.push(`- Ambient: ${report.ambient.length > 0 ? report.ambient.join(", ") : "none"}`);
  lines.push(
    `- Decisions: ${
      Object.keys(report.decisions).length > 0
        ? Object.entries(report.decisions)
            .map(([kind, count]) => `${kind}=${count}`)
            .join(", ")
        : "none"
    }`,
  );
  lines.push(`- Task attention state: ${report.lastTaskAttentionState ?? "n/a"}`);
  lines.push(`- Global attention state: ${report.lastGlobalAttentionState ?? "n/a"}`);
  return lines.join("\n");
}

function captureTrace(trace: Parameters<ApertureCore["onTrace"]>[0] extends (value: infer T) => void ? T : never): {
  decision: string | null;
  taskAttentionState: string;
  globalAttentionState: string;
} {
  return {
    decision: "coordination" in trace ? trace.coordination.kind : null,
    taskAttentionState: trace.taskAttentionState,
    globalAttentionState: trace.globalAttentionState,
  };
}

function flattenPaperclipEvents(events: PaperclipLiveEvent[]): ApertureEvent[] {
  return events.flatMap((event) => mapPaperclipLiveEvent(event));
}

function flattenCodexRequests(requests: CodexServerRequest[]): ApertureEvent[] {
  return requests.flatMap((request) => mapCodexServerRequest(request));
}

function seedPresented(core: ApertureCore, taskId: string, interactionId: string, timestampMs: number): void {
  core.recordSignal({
    kind: "presented",
    taskId,
    interactionId,
    timestamp: new Date(timestampMs).toISOString(),
  });
}

function seedDeferred(
  core: ApertureCore,
  taskId: string,
  interactionId: string,
  timestampMs: number,
  reason: "queued" | "suppressed" | "manual",
): void {
  core.recordSignal({
    kind: "deferred",
    taskId,
    interactionId,
    timestamp: new Date(timestampMs).toISOString(),
    reason,
  });
}

main();
