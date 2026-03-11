import { ApertureCore } from "../packages/core/src/index.ts";
import type { ClaudeCodeHookEvent } from "../packages/claude-code/src/index.ts";
import { mapClaudeCodeHookEvent } from "../packages/claude-code/src/index.ts";
import type { CodexServerRequest } from "../packages/codex/src/index.ts";
import { mapCodexServerRequest } from "../packages/codex/src/index.ts";
import type { PaperclipLiveEvent } from "../packages/paperclip/src/index.ts";
import { mapPaperclipLiveEvent } from "../packages/paperclip/src/index.ts";
import { runAttentionTui } from "../packages/tui/src/index.ts";

async function main(): Promise<void> {
  const core = new ApertureCore();
  const now = Date.now();

  // Seed signal history so the stats line appears (presented >= 5).
  // Simulates a session where the operator already handled several items.
  for (let i = 0; i < 8; i++) {
    const ts = new Date(now - (8 - i) * 60_000).toISOString();
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
      latencyMs: 200 + Math.floor(Math.random() * 400),
      timestamp: ts,
      surface: "tui",
    });
  }

  // Paperclip: hiring approval
  const paperclipEvents: PaperclipLiveEvent[] = [
    {
      id: 1,
      companyId: "company:paperclip",
      type: "activity.logged",
      createdAt: new Date(now).toISOString(),
      payload: {
        entityType: "approval",
        entityId: "approval:hire:1",
        action: "approval.created",
        details: {
          type: "hire_agent",
          requestedByAgentId: "agent:alpha",
          issueIds: ["ISS-101"],
        },
      },
    },
  ];

  // Codex: environment choice
  const codexRequests: CodexServerRequest[] = [
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
  ];

  // Claude Code: force push approval + deploy failure
  const claudeEvents: ClaudeCodeHookEvent[] = [
    {
      hook_event_name: "PreToolUse",
      session_id: "session-tui",
      cwd: "/workspace/app",
      permission_mode: "default",
      transcript_path: "/tmp/transcript.jsonl",
      tool_name: "Bash",
      tool_use_id: "tool-1",
      tool_input: {
        command: "git push --force origin main",
      },
    },
    {
      hook_event_name: "PostToolUseFailure",
      session_id: "session-tui",
      cwd: "/workspace/app",
      permission_mode: "default",
      transcript_path: "/tmp/transcript.jsonl",
      tool_name: "Bash",
      tool_use_id: "tool-2",
      tool_input: {
        command: "npm run deploy",
      },
      error: "Bash failed while pushing deployment fix.",
    },
  ];

  for (const liveEvent of paperclipEvents) {
    for (const event of mapPaperclipLiveEvent(liveEvent)) {
      core.publishConformed(event);
    }
  }

  for (const request of codexRequests) {
    for (const event of mapCodexServerRequest(request)) {
      core.publishConformed(event);
    }
  }

  for (const event of claudeEvents.flatMap((hook) => mapClaudeCodeHookEvent(hook))) {
    core.publishConformed(event);
  }

  await runAttentionTui(core, { title: "Aperture TUI Demo" });
}

void main();
