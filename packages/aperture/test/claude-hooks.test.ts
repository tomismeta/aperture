import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import {
  countApertureHookEntries,
  installClaudeHooks,
  readSettings,
} from "../src/cli/claude-hooks.js";

test("installClaudeHooks installs the expanded Claude hook set", async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), "aperture-claude-hooks-"));

  try {
    await installClaudeHooks({
      global: false,
      targetRoot,
      quiet: true,
      command: "aperture internal hook claude-forward",
    });

    const settings = await readSettings(join(targetRoot, ".claude", "settings.local.json"));
    const hooks = settings.hooks as Record<string, unknown>;

    assert.deepEqual(Object.keys(hooks).sort(), [
      "ConfigChange",
      "CwdChanged",
      "Elicitation",
      "ElicitationResult",
      "InstructionsLoaded",
      "Notification",
      "PermissionDenied",
      "PermissionRequest",
      "PostCompact",
      "PostToolUse",
      "PostToolUseFailure",
      "PreCompact",
      "PreToolUse",
      "SessionEnd",
      "SessionStart",
      "Stop",
      "StopFailure",
      "SubagentStart",
      "SubagentStop",
      "TaskCompleted",
      "TaskCreated",
      "TeammateIdle",
      "UserPromptSubmit",
    ]);

    assert.equal(countApertureHookEntries(settings), 23);
    assert.equal("FileChanged" in hooks, false);
    assert.equal("WorktreeCreate" in hooks, false);
    assert.equal("WorktreeRemove" in hooks, false);
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
