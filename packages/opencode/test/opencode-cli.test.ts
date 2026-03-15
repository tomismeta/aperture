import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cwd = join(import.meta.dirname, "..", "..", "..");
const tsxCli = join(cwd, "node_modules", "tsx", "dist", "cli.mjs");

test("opencode connect persists a global profile and disconnect removes it", async () => {
  const home = await mkdtemp(join(tmpdir(), "aperture-opencode-cli-"));
  const env = {
    ...process.env,
    HOME: home,
    OPENCODE_SERVER_PASSWORD: "secret",
  };

  await execFileAsync(process.execPath, [
    tsxCli,
    "scripts/opencode-connect.ts",
    "--global",
    "--name",
    "workspace",
    "--url",
    "http://127.0.0.1:4096/",
    "--username",
    "opencode",
    "--password-env",
    "OPENCODE_SERVER_PASSWORD",
    "--directory",
    "/tmp/project",
  ], { cwd, env });

  const configPath = join(home, ".aperture", "opencode.json");
  const saved = JSON.parse(await readFile(configPath, "utf8")) as {
    profiles: Array<Record<string, unknown>>;
  };
  assert.equal(saved.profiles.length, 1);
  assert.deepEqual(saved.profiles[0], {
    id: "workspace",
    baseUrl: "http://127.0.0.1:4096",
    enabled: true,
    createdAt: saved.profiles[0]?.createdAt,
    updatedAt: saved.profiles[0]?.updatedAt,
    auth: {
      username: "opencode",
      passwordEnv: "OPENCODE_SERVER_PASSWORD",
    },
    scope: {
      directory: "/tmp/project",
    },
  });

  await execFileAsync(process.execPath, [
    tsxCli,
    "scripts/opencode-disconnect.ts",
    "--global",
    "--name",
    "workspace",
  ], { cwd, env });

  const removed = await readFile(configPath, "utf8").catch(() => null);
  assert.equal(removed, null);
});

test("opencode connect reports invalid URLs clearly", async () => {
  const home = await mkdtemp(join(tmpdir(), "aperture-opencode-cli-"));

  await assert.rejects(
    execFileAsync(process.execPath, [
      tsxCli,
      "scripts/opencode-connect.ts",
      "--global",
      "--url",
      "not-a-url",
    ], {
      cwd,
      env: {
        ...process.env,
        HOME: home,
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
      assert.match(stderr, /Invalid OpenCode URL: not-a-url/);
      return true;
    },
  );
});

test("opencode connect ignores missing flag values instead of treating the next flag as data", async () => {
  const home = await mkdtemp(join(tmpdir(), "aperture-opencode-cli-"));
  const env = {
    ...process.env,
    HOME: home,
  };

  await execFileAsync(process.execPath, [
    tsxCli,
    "scripts/opencode-connect.ts",
    "--global",
    "--name",
    "--url",
    "http://127.0.0.1:4096",
  ], { cwd, env });

  const configPath = join(home, ".aperture", "opencode.json");
  const saved = JSON.parse(await readFile(configPath, "utf8")) as {
    profiles: Array<Record<string, unknown>>;
  };
  assert.equal(saved.profiles[0]?.id, "default");
});
