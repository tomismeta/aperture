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
  const previousPort = process.env.APERTURE_CODEX_HOOK_PORT;
  process.env.APERTURE_CODEX_HOOK_PORT = "46547";

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
    assert.match(command, /--url "http:\/\/127\.0\.0\.1:46547\/hook"/);

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
    if (previousPort === undefined) {
      delete process.env.APERTURE_CODEX_HOOK_PORT;
    } else {
      process.env.APERTURE_CODEX_HOOK_PORT = previousPort;
    }
    await rm(targetRoot, { recursive: true, force: true });
  }
});

test("buildCodexHookCommand captures explicit Codex hook URL overrides", () => {
  const previousUrl = process.env.APERTURE_CODEX_HOOK_URL;
  process.env.APERTURE_CODEX_HOOK_URL = "http://127.0.0.1:46548/custom-hook";

  try {
    const command = buildCodexHookCommand("/repo/packages/aperture/dist/cli.js", "/repo");
    assert.match(command, /internal hook codex-forward/);
    assert.match(command, /--url "http:\/\/127\.0\.0\.1:46548\/custom-hook"/);
  } finally {
    if (previousUrl === undefined) {
      delete process.env.APERTURE_CODEX_HOOK_URL;
    } else {
      process.env.APERTURE_CODEX_HOOK_URL = previousUrl;
    }
  }
});
