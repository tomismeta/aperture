import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");

function commandEnv(): NodeJS.ProcessEnv {
  const entries = Object.entries(process.env).filter(([key]) => {
    const normalized = key.toLowerCase();
    return !normalized.startsWith("npm_") && !normalized.startsWith("pnpm_") && normalized !== "_jsr_registry";
  });

  return Object.fromEntries(entries);
}

function run(command: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  return execFileSync(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    encoding: "utf8",
    env: {
      ...commandEnv(),
      ...extraEnv,
    },
  });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aperture-product-smoke-"));
  const packDir = path.join(tempRoot, "pack");
  const installDir = path.join(tempRoot, "install");
  const homeDir = path.join(tempRoot, "home");
  const projectDir = path.join(tempRoot, "project");

  await mkdir(packDir, { recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await mkdir(projectDir, { recursive: true });

  try {
    run("pnpm", ["run", "build"], packageRoot);

    const packJson = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], packageRoot);
    const jsonStart = packJson.indexOf("[");
    assert.notEqual(jsonStart, -1, "expected npm pack to emit JSON output");
    const packed = JSON.parse(packJson.slice(jsonStart)) as Array<{ filename: string }>;
    const tarballFilename = packed[0]?.filename;
    assert.ok(tarballFilename, "expected npm pack to produce a tarball");

    const tarballPath = path.join(packDir, tarballFilename);
    const isolatedEnv = { HOME: homeDir };
    const globalSettingsPath = path.join(homeDir, ".claude", "settings.json");
    const localSettingsPath = path.join(projectDir, ".claude", "settings.local.json");
    const globalCodexHooksPath = path.join(homeDir, ".codex", "hooks.json");
    const localCodexHooksPath = path.join(projectDir, ".codex", "hooks.json");
    const captureDir = path.join(homeDir, ".aperture", "captures");
    const productStateDir = path.join(homeDir, ".aperture");
    const projectStateDir = path.join(projectDir, ".aperture");

    await writeFile(
      path.join(installDir, "package.json"),
      `${JSON.stringify({ name: "aperture-smoke", private: true }, null, 2)}\n`,
      "utf8",
    );

    run("npm", ["install", tarballPath], installDir);

    const binPath = path.join(installDir, "node_modules", ".bin", "aperture");
    const help = run(binPath, ["help"], installDir, isolatedEnv);
    assert.match(help, /Aperture/);
    assert.match(help, /debug \[topic\]/);
    assert.match(help, /completion <shell>/);
    assert.match(help, /codex/);

    run(binPath, ["claude", "connect", "--global"], installDir, isolatedEnv);
    run(binPath, ["claude", "connect", projectDir], installDir, isolatedEnv);
    run(binPath, ["codex", "connect", "--global"], installDir, isolatedEnv);
    run(binPath, ["codex", "connect", projectDir], installDir, isolatedEnv);
    await mkdir(captureDir, { recursive: true });
    await writeFile(path.join(captureDir, "smoke-bundle.json"), "{\n  \"ok\": true\n}\n", "utf8");
    await mkdir(projectStateDir, { recursive: true });
    await writeFile(path.join(projectStateDir, "local-state.txt"), "local\n", "utf8");

    const globalSettings = await readFile(globalSettingsPath, "utf8");
    assert.match(globalSettings, /internal hook claude-forward/);
    const localSettings = await readFile(localSettingsPath, "utf8");
    assert.match(localSettings, /internal hook claude-forward/);
    const globalCodexHooks = await readFile(globalCodexHooksPath, "utf8");
    assert.match(globalCodexHooks, /internal hook codex-forward/);
    const localCodexHooks = await readFile(localCodexHooksPath, "utf8");
    assert.match(localCodexHooks, /internal hook codex-forward/);

    const doctor = run(binPath, ["doctor"], installDir, isolatedEnv);
    assert.match(doctor, /Aperture Doctor/);
    assert.match(doctor, new RegExp(homeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(doctor, /node_modules\/@tomismeta\/aperture\/dist\/cli\.js/);
    assert.match(doctor, /hooks: installed/);

    const debug = run(binPath, ["debug", "state"], installDir, isolatedEnv);
    assert.match(debug, /Product state/);
    assert.match(debug, /captures:/);
    assert.match(debug, /capture files: 1/);

    const completion = run(binPath, ["completion", "zsh"], installDir, isolatedEnv);
    assert.match(completion, /#compdef aperture/);

    const uninstallPlan = run(binPath, ["uninstall", "--project", projectDir], installDir, isolatedEnv);
    assert.match(uninstallPlan, /Aperture uninstall will remove:/);
    assert.match(uninstallPlan, /settings\.local\.json/);

    const uninstall = run(binPath, ["uninstall", "--yes", "--project", projectDir], installDir, isolatedEnv);
    assert.match(uninstall, /Aperture cleanup complete\./);
    assert.equal(await pathExists(productStateDir), false, "expected uninstall to remove ~/.aperture");
    assert.equal(await pathExists(projectStateDir), false, "expected uninstall to remove project .aperture");
    assert.equal(await pathExists(globalSettingsPath), false, "expected uninstall to remove global Claude hook file");
    assert.equal(await pathExists(localSettingsPath), false, "expected uninstall to remove local Claude hook file");
    assert.equal(await pathExists(globalCodexHooksPath), false, "expected uninstall to remove global Codex hook file");
    assert.equal(await pathExists(localCodexHooksPath), false, "expected uninstall to remove local Codex hook file");

    const installedPackage = JSON.parse(
      await readFile(path.join(installDir, "node_modules", "@tomismeta", "aperture", "package.json"), "utf8"),
    ) as { bin?: Record<string, string>; dependencies?: Record<string, string>; main?: string };
    assert.ok(installedPackage.bin?.aperture, "expected installed package to expose the aperture bin");
    assert.deepEqual(
      installedPackage.dependencies ?? {},
      {},
      "product package should not declare runtime dependencies",
    );
    assert.equal(installedPackage.main, undefined, "product package should not expose a library main");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  assert.fail(error instanceof Error ? error.stack ?? error.message : String(error));
});
