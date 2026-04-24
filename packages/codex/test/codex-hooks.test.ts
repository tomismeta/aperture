import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCodexHookCommand,
  installCodexHooks,
  mapCodexHookEvent,
  mapCodexHookResponse,
  parseCodexHookEvent,
  removeCodexHooks,
  withCodexHooksFeatureEnabled,
} from "../src/index.js";

test("maps PreToolUse hook events into approval SourceEvents", () => {
  const event = parseCodexHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    turn_id: "turn-1",
    tool_name: "Bash",
    tool_use_id: "tool-1",
    tool_input: {
      command: "pnpm test",
    },
  });

  const mapped = mapCodexHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]?.type, "human.input.requested");
  assert.equal(mapped[0]?.taskId, "codex:hook:session:session-1:turn:turn-1");
  assert.equal(
    mapped[0]?.interactionId,
    "codex:hook:preToolUse:session-1:turn-1:tool-1",
  );
  assert.equal(mapped[0]?.title, "Approve Codex command");
  assert.deepEqual(mapped[0]?.semanticHints, {
    intentFrame: "approval_request",
    activityClass: "permission_request",
    whyNow: "Codex requested approval before running a command.",
    confidence: "high",
  });
  assert.deepEqual(mapped[0]?.metadata, {
    execution: {
      surface: "terminal",
      runner: "codex",
    },
    governance: {
      approvalState: "pending",
    },
  });
});

test("maps SessionStart hook events with execution and model metadata", () => {
  const event = parseCodexHookEvent({
    session_id: "session-model-1",
    cwd: "/repo",
    hook_event_name: "SessionStart",
    source: "startup",
    model: "gpt-5.4",
  });

  const mapped = mapCodexHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.deepEqual(mapped[0]?.metadata, {
    execution: {
      surface: "terminal",
      runner: "codex",
    },
    usage: {
      model: "gpt-5.4",
    },
  });
});

test("maps UserPromptSubmit hook events into follow-up SourceEvents", () => {
  const event = parseCodexHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "UserPromptSubmit",
    turn_id: "turn-9",
    prompt: "Implement the feature and then explain the tradeoffs.",
  });

  const mapped = mapCodexHookEvent(event);
  assert.equal(mapped.length, 1);
  assert.deepEqual(mapped[0], {
    id: "codex:hook:session-1:userPromptSubmit:turn-9",
    type: "task.updated",
    taskId: "codex:hook:session:session-1:turn:turn-9",
    timestamp: mapped[0]?.timestamp,
    source: mapped[0]?.source,
    metadata: {
      execution: {
        surface: "terminal",
        runner: "codex",
      },
    },
    activityClass: "follow_up",
    semanticHints: {
      activityClass: "follow_up",
      whyNow: "Codex is continuing with the operator's latest prompt.",
      confidence: "high",
    },
    title: "Codex prompt submitted",
    summary: "Implement the feature and then explain the tradeoffs.",
    status: "running",
  });
});

test("maps held Codex hook responses back into deny-or-allow outputs", () => {
  assert.equal(
    mapCodexHookResponse({
      taskId: "codex:hook:session:session-1:turn:turn-1",
      interactionId: "codex:hook:preToolUse:session-1:turn-1:tool-1",
      response: { kind: "approved" },
    }),
    null,
  );

  assert.deepEqual(
    mapCodexHookResponse({
      taskId: "codex:hook:session:session-1:turn:turn-1",
      interactionId: "codex:hook:preToolUse:session-1:turn-1:tool-1",
      response: { kind: "rejected", reason: "Too risky." },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "Too risky.",
      },
    },
  );
});

test("installs and removes Codex hooks locally", async () => {
  const scratch = await mkdtemp(join(tmpdir(), "aperture-codex-hooks-"));

  try {
    const command = buildCodexHookCommand("/repo/scripts/codex-forward.ts", "/repo");
    const installResult = await installCodexHooks({
      global: false,
      targetRoot: scratch,
      command,
    });

    assert.equal(installResult.changed, true);
    assert.equal(installResult.featureChanged, true);

    const hooksJson = JSON.parse(await readFile(join(scratch, ".codex", "hooks.json"), "utf8")) as {
      hooks?: Record<string, unknown>;
    };
    assert.ok(hooksJson.hooks?.PreToolUse);
    assert.ok(hooksJson.hooks?.SessionStart);
    assert.ok(hooksJson.hooks?.UserPromptSubmit);
    assert.ok(hooksJson.hooks?.Stop);

    const configToml = await readFile(join(scratch, ".codex", "config.toml"), "utf8");
    assert.match(configToml, /\[features\]/);
    assert.match(configToml, /codex_hooks = true/);

    const removeResult = await removeCodexHooks({
      global: false,
      targetRoot: scratch,
      command,
    });
    assert.equal(removeResult.changed, true);

    await assert.rejects(() => readFile(join(scratch, ".codex", "hooks.json"), "utf8"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test("enables the Codex hooks feature flag in config.toml", () => {
  assert.equal(
    withCodexHooksFeatureEnabled(""),
    "[features]\ncodex_hooks = true\n",
  );

  assert.equal(
    withCodexHooksFeatureEnabled("[features]\nother = false\n"),
    "[features]\nother = false\ncodex_hooks = true\n",
  );
});
