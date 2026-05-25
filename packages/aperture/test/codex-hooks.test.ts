import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCodexHookCommand,
  installCodexProductHooks,
  readHookConfig,
  removeCodexHooks,
} from "../src/cli/codex-hooks.js";

test("installCodexProductHooks installs opt-in Codex hooks without touching core", async () => {
  const targetRoot = await mkdtemp(join(tmpdir(), "aperture-codex-hooks-"));

  try {
    const command = buildCodexHookCommand("/repo/packages/aperture/src/cli.ts", "/repo");
    const install = await installCodexProductHooks({
      global: false,
      targetRoot,
      quiet: true,
      command,
    });

    assert.equal(install.changed, true);
    assert.equal(install.featureChanged, true);
    assert.match(command, /internal hook codex-forward/);

    const hooks = await readHookConfig(join(targetRoot, ".codex", "hooks.json"));
    assert.deepEqual(Object.keys(hooks.hooks as Record<string, unknown>).sort(), [
      "PermissionRequest",
      "PostCompact",
      "PostToolUse",
      "PreCompact",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "SubagentStart",
      "SubagentStop",
      "UserPromptSubmit",
    ]);

    const configToml = await readFile(join(targetRoot, ".codex", "config.toml"), "utf8");
    assert.match(configToml, /\[features\]/);
    assert.match(configToml, /hooks = true/);

    const remove = await removeCodexHooks({
      global: false,
      targetRoot,
      command,
    });
    assert.equal(remove.changed, true);
    await assert.rejects(() => readFile(join(targetRoot, ".codex", "hooks.json"), "utf8"));
  } finally {
    await rm(targetRoot, { recursive: true, force: true });
  }
});
