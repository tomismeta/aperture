import { ApertureCore, type SourceEvent, type AttentionView } from "../packages/core/src/index.ts";
import type { ApertureTrace } from "../packages/core/src/trace.ts";
import type { ClaudeCodeHookEvent } from "../packages/claude-code/src/index.ts";
import { mapClaudeCodeHookEvent } from "../packages/claude-code/src/index.ts";
import type { OpencodeMappingContext, OpencodeSseMessage } from "../packages/opencode/src/index.ts";
import { mapOpencodeEvent } from "../packages/opencode/src/index.ts";
import { runAttentionTui } from "../packages/tui/src/index.ts";

type DemoOptions = {
  recording: boolean;
  traceEnabled: boolean;
};

type DemoStep = {
  atMs: number;
  apply: (core: ApertureCore, startedAtMs: number) => void;
};

const RECORDING_START_MS = Date.parse("2026-03-17T18:00:00.000Z");
const TRACE_LIMIT = 40;
const SEED_RESPONSE_LATENCIES_MS = [220, 260, 310, 280, 340, 290, 360, 300];
const OPENCODE_CONTEXT: OpencodeMappingContext = {
  baseUrl: "http://127.0.0.1:4096",
  scope: { directory: "/workspace/aperture-demo" },
  sourceLabel: "OpenCode",
};

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const core = new ApertureCore();
  const startedAtMs = options.recording ? RECORDING_START_MS : Date.now();
  const traceLines: string[] = [];
  const cleanup = scheduleDemo(core, startedAtMs, options.recording);

  if (options.traceEnabled) {
    core.onTrace((trace) => {
      traceLines.push(formatTrace(trace));
      if (traceLines.length > TRACE_LIMIT) {
        traceLines.shift();
      }
    });
  }

  try {
    await runAttentionTui(core, {
      title: "Aperture TUI Demo",
      reducedMotion: options.recording,
    });
  } finally {
    cleanup();
  }

  if (options.traceEnabled) {
    process.stderr.write("\nAperture trace log\n");
    process.stderr.write(`${traceLines.join("\n")}\n`);
  }
}

function readOptions(args: string[]): DemoOptions {
  const recording = args.includes("--recording") || process.env.APERTURE_DEMO_RECORDING === "1";
  const traceEnabled = args.includes("--trace") || process.env.APERTURE_TRACE === "1";
  return {
    recording,
    traceEnabled,
  };
}

function scheduleDemo(core: ApertureCore, startedAtMs: number, recording: boolean): () => void {
  const steps = buildDemoSteps();
  if (!recording) {
    for (const step of steps) {
      step.apply(core, startedAtMs);
    }
    return () => {};
  }

  const timers = steps.map((step) => setTimeout(() => {
    step.apply(core, startedAtMs);
  }, step.atMs));

  return () => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
  };
}

function buildDemoSteps(): DemoStep[] {
  return [
    {
      atMs: 3_200,
      apply: (core, startedAtMs) => {
        seedSignalHistory(core, startedAtMs, 3_200);
      },
    },
    {
      atMs: 4_000,
      apply: (core, startedAtMs) => {
        publishClaude(core, startedAtMs, 4_000, {
          hook_event_name: "PreToolUse",
          session_id: "session-demo-claude",
          cwd: "/workspace/aperture-demo",
          permission_mode: "default",
          transcript_path: "/tmp/aperture-demo-claude.jsonl",
          tool_name: "Read",
          tool_use_id: "tool-read-core",
          tool_input: {
            file_path: "/workspace/aperture-demo/packages/core/src/aperture-core.ts",
            description: "Inspect the main engine entrypoint before changing the demo flow.",
          },
        });
      },
    },
    {
      atMs: 6_200,
      apply: (core, startedAtMs) => {
        publishClaude(core, startedAtMs, 6_200, {
          hook_event_name: "PreToolUse",
          session_id: "session-demo-claude",
          cwd: "/workspace/aperture-demo",
          permission_mode: "default",
          transcript_path: "/tmp/aperture-demo-claude.jsonl",
          tool_name: "Bash",
          tool_use_id: "tool-force-push",
          tool_input: {
            command: "git push --force-with-lease origin demo",
            description: "Ship the refreshed demo branch to the shared remote.",
          },
        });
      },
    },
    {
      atMs: 8_200,
      apply: (core, startedAtMs) => {
        publishOpencode(core, startedAtMs, 8_200, {
          type: "permission.asked",
          properties: {
            id: "perm-demo-1",
            sessionID: "session-demo-open",
            title: "Create screenshots directory",
            message: "Run bash tool",
            metadata: {
              tool: "bash",
              callID: "call-demo-1",
              description: "OpenCode wants to prepare an output directory for demo assets.",
              patterns: [{ value: "mkdir -p docs/demo-assets/screenshots" }],
            },
            createdAt: timestampFor(startedAtMs, 8_200),
          },
        });
      },
    },
    {
      atMs: 9_800,
      apply: (core, startedAtMs) => {
        publishOpencode(core, startedAtMs, 9_800, {
          type: "question.asked",
          properties: {
            id: "question-demo-1",
            sessionID: "session-demo-open",
            title: "Directory",
            message: "Where should I create the new directory?",
            tool: {
              callID: "call-demo-question-1",
            },
            questions: [
              {
                header: "Directory",
                question: "Where should I create the new directory?",
                options: [
                  {
                    label: "Current directory",
                    description: "Create the folder beside the current worktree.",
                  },
                  {
                    label: "docs/demo-assets",
                    description: "Keep generated assets under the docs tree.",
                  },
                ],
              },
            ],
            createdAt: timestampFor(startedAtMs, 9_800),
          },
        });
      },
    },
    {
      atMs: 11_200,
      apply: (core, startedAtMs) => {
        publishOpencode(core, startedAtMs, 11_200, {
          type: "session.status",
          properties: {
            sessionID: "session-demo-open",
            status: {
              type: "running",
              reason: "OpenCode is applying the selected directory plan.",
            },
          },
        });
      },
    },
    {
      atMs: 12_800,
      apply: (core, startedAtMs) => {
        publishClaude(core, startedAtMs, 12_800, {
          hook_event_name: "PostToolUseFailure",
          session_id: "session-demo-claude",
          cwd: "/workspace/aperture-demo",
          permission_mode: "default",
          transcript_path: "/tmp/aperture-demo-claude.jsonl",
          tool_name: "Bash",
          tool_use_id: "tool-deploy-failure",
          tool_input: {
            command: "pnpm build && pnpm publish",
          },
          error: "Build step exited with code 1 while generating release assets.",
        });
      },
    },
    {
      atMs: 14_400,
      apply: (core, startedAtMs) => {
        publishClaude(core, startedAtMs, 14_400, {
          hook_event_name: "Stop",
          session_id: "session-demo-claude",
          cwd: "/workspace/aperture-demo",
          permission_mode: "default",
          transcript_path: "/tmp/aperture-demo-claude.jsonl",
          stop_reason: "end_turn",
          last_assistant_message: "Do you want me to generate release notes for the demo too?",
        });
      },
    },
    {
      atMs: 26_000,
      apply: (core, startedAtMs) => {
        clearVisibleDemoTasks(core, timestampFor(startedAtMs, 26_000));
      },
    },
  ];
}

function seedSignalHistory(core: ApertureCore, startedAtMs: number, offsetMs: number): void {
  for (let i = 0; i < SEED_RESPONSE_LATENCIES_MS.length; i += 1) {
    const ts = new Date(
      startedAtMs + offsetMs - (SEED_RESPONSE_LATENCIES_MS.length - i) * 60_000,
    ).toISOString();
    core.recordSignal({
      kind: "presented",
      taskId: `seed-task-${i}`,
      interactionId: `seed-interaction-${i}`,
      timestamp: ts,
      surface: "tui",
    });
    core.recordSignal({
      kind: "responded",
      taskId: `seed-task-${i}`,
      interactionId: `seed-interaction-${i}`,
      responseKind: i % 3 === 0 ? "approved" : "acknowledged",
      latencyMs: SEED_RESPONSE_LATENCIES_MS[i] ?? 250,
      timestamp: ts,
      surface: "tui",
    });
  }
}

function publishClaude(
  core: ApertureCore,
  startedAtMs: number,
  offsetMs: number,
  hook: ClaudeCodeHookEvent,
): void {
  publishEvents(
    core,
    mapClaudeCodeHookEvent(hook),
    timestampFor(startedAtMs, offsetMs),
  );
}

function publishOpencode(
  core: ApertureCore,
  startedAtMs: number,
  offsetMs: number,
  event: OpencodeSseMessage,
): void {
  publishEvents(
    core,
    mapOpencodeEvent(event, OPENCODE_CONTEXT),
    timestampFor(startedAtMs, offsetMs),
  );
}

function publishEvents(core: ApertureCore, events: SourceEvent[], timestamp: string): void {
  for (const event of events) {
    core.publish({
      ...event,
      timestamp,
    });
  }
}

function clearVisibleDemoTasks(core: ApertureCore, timestamp: string): void {
  const attentionView = core.getAttentionView();
  const taskIds = visibleTaskIds(attentionView);

  for (const taskId of taskIds) {
    core.publish({
      id: `demo:clear:${encodeURIComponent(taskId)}:${timestamp}`,
      type: "task.completed",
      taskId,
      timestamp,
    });
  }
}

function visibleTaskIds(attentionView: AttentionView): string[] {
  const taskIds = new Set<string>();

  if (attentionView.active) {
    taskIds.add(attentionView.active.taskId);
  }
  for (const frame of attentionView.queued) {
    taskIds.add(frame.taskId);
  }
  for (const frame of attentionView.ambient) {
    taskIds.add(frame.taskId);
  }

  return [...taskIds];
}

function timestampFor(startedAtMs: number, offsetMs: number): string {
  return new Date(startedAtMs + offsetMs).toISOString();
}

function formatTrace(trace: ApertureTrace): string {
  if (trace.evaluation.kind !== "candidate") {
    return `${trace.timestamp} ${trace.evaluation.kind} ${trace.event.taskId}`;
  }

  const reasons =
    trace.coordination.reasons.length > 0
      ? ` :: ${trace.coordination.reasons.join("; ")}`
      : "";

  return [
    trace.timestamp,
    trace.coordination.kind.padEnd(8, " "),
    trace.evaluation.adjusted.taskId,
    `candidate=${trace.coordination.candidateScore}`,
    `current=${trace.coordination.currentScore ?? "n/a"}`,
    reasons,
  ]
    .filter((part) => part !== "")
    .join(" ");
}

void main();
