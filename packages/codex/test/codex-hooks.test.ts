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

test("maps apply_patch and PermissionRequest hook events into approval SourceEvents", () => {
  const patchEvent = parseCodexHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreToolUse",
    turn_id: "turn-2",
    tool_name: "apply_patch",
    tool_use_id: "tool-patch-1",
    tool_input: {
      patch: "*** Begin Patch\n*** Update File: package.json\n*** End Patch",
    },
  });

  const patchMapped = mapCodexHookEvent(patchEvent);
  assert.equal(patchMapped[0]?.type, "human.input.requested");
  assert.equal(patchMapped[0]?.toolFamily, "write");
  assert.equal(patchMapped[0]?.title, "Approve Codex patch");

  const permissionEvent = parseCodexHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PermissionRequest",
    turn_id: "turn-2",
    tool_name: "mcp__github__create_issue",
    tool_input: {
      description: "Create a tracking issue",
    },
  });

  const permissionMapped = mapCodexHookEvent(permissionEvent);
  assert.equal(permissionMapped[0]?.type, "human.input.requested");
  assert.equal(permissionMapped[0]?.toolFamily, "mcp");
  assert.equal(permissionMapped[0]?.title, "Approve Codex MCP tool");
  assert.equal(permissionMapped[0]?.summary, "Create a tracking issue");
  assert.match(
    permissionMapped[0]?.interactionId ?? "",
    /^codex:hook:permissionRequest:session-1:turn-2:mcp__github__create_issue:/,
  );
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
    },
    title: "Codex prompt submitted",
    summary: "Implement the feature and then explain the tradeoffs.",
    status: "running",
  });
});

test("maps compact and subagent hook events into task updates", () => {
  const compactEvent = parseCodexHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "PreCompact",
    turn_id: "turn-3",
    trigger: "auto",
  });
  const compactMapped = mapCodexHookEvent(compactEvent);
  assert.equal(compactMapped[0]?.type, "task.updated");
  assert.equal(compactMapped[0]?.title, "Codex compacting context");

  const subagentEvent = parseCodexHookEvent({
    session_id: "session-1",
    cwd: "/repo",
    hook_event_name: "SubagentStart",
    turn_id: "turn-3",
    agent_id: "agent-1",
    agent_type: "review",
  });
  const subagentMapped = mapCodexHookEvent(subagentEvent);
  assert.equal(subagentMapped[0]?.type, "task.started");
  assert.equal(subagentMapped[0]?.taskId, "codex:hook:session:session-1:turn:turn-3:subagent:agent-1");
  assert.equal(subagentMapped[0]?.summary, "review");
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

  assert.deepEqual(
    mapCodexHookResponse({
      taskId: "codex:hook:session:session-1:turn:turn-1",
      interactionId: "codex:hook:permissionRequest:session-1:turn-1:Bash:abc123",
      response: { kind: "approved" },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "allow",
        },
      },
    },
  );

  assert.deepEqual(
    mapCodexHookResponse({
      taskId: "codex:hook:session:session-1:turn:turn-1",
      interactionId: "codex:hook:permissionRequest:session-1:turn-1:Bash:abc123",
      response: { kind: "rejected", reason: "No network." },
    }),
    {
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: "No network.",
        },
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
    assert.ok(hooksJson.hooks?.PermissionRequest);
    assert.ok(hooksJson.hooks?.PostToolUse);
    assert.ok(hooksJson.hooks?.SessionStart);
    assert.ok(hooksJson.hooks?.UserPromptSubmit);
    assert.ok(hooksJson.hooks?.PreCompact);
    assert.ok(hooksJson.hooks?.PostCompact);
    assert.ok(hooksJson.hooks?.SubagentStart);
    assert.ok(hooksJson.hooks?.SubagentStop);
    assert.ok(hooksJson.hooks?.Stop);
    assert.equal((hooksJson.hooks?.PreToolUse as Array<{ matcher?: string }>)[0]?.matcher, "*");
    assert.equal((hooksJson.hooks?.PermissionRequest as Array<{ matcher?: string }>)[0]?.matcher, "*");

    const configToml = await readFile(join(scratch, ".codex", "config.toml"), "utf8");
    assert.match(configToml, /\[features\]/);
    assert.match(configToml, /hooks = true/);

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
    "[features]\nhooks = true\n",
  );

  assert.equal(
    withCodexHooksFeatureEnabled("[features]\nother = false\n"),
    "[features]\nother = false\nhooks = true\n",
  );

  assert.equal(
    withCodexHooksFeatureEnabled("[features]\nhooks = false\n"),
    "[features]\nhooks = true\n",
  );

  assert.equal(
    withCodexHooksFeatureEnabled("[features]\ncodex_hooks = true\n"),
    "[features]\ncodex_hooks = true\nhooks = true\n",
  );
});
