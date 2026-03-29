import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureGitHeadSnapshot,
  listWorkingTreeFiles,
  restoreGitHeadSnapshot,
  runGit,
  spawnChecked,
} from "../src/autoresearch-workspace.js";

test("restoreGitHeadSnapshot cleans dirty tracked and untracked files while keeping branch checkout", async () => {
  const repoDir = await createTempGitRepo();
  const filePath = path.join(repoDir, "example.txt");
  await writeFile(filePath, "base\n", "utf8");
  await commitAll(repoDir, "base");

  const snapshot = await captureGitHeadSnapshot(repoDir);
  assert.ok(snapshot.branch);

  await writeFile(filePath, "changed\n", "utf8");
  await writeFile(path.join(repoDir, "scratch.txt"), "temp\n", "utf8");

  await restoreGitHeadSnapshot(snapshot, repoDir);

  assert.deepEqual(await listWorkingTreeFiles(repoDir), []);
  assert.equal(await readFile(filePath, "utf8"), "base\n");
  assert.equal(await runGit(repoDir, ["symbolic-ref", "--quiet", "--short", "HEAD"]), snapshot.branch);
  assert.equal(await runGit(repoDir, ["rev-parse", "HEAD"]), snapshot.head);
});

test("restoreGitHeadSnapshot can recover a detached clean state after HEAD advances", async () => {
  const repoDir = await createTempGitRepo();
  const filePath = path.join(repoDir, "example.txt");
  await writeFile(filePath, "base\n", "utf8");
  await commitAll(repoDir, "base");

  const snapshot = await captureGitHeadSnapshot(repoDir);

  await writeFile(filePath, "committed change\n", "utf8");
  await commitAll(repoDir, "second");
  await writeFile(path.join(repoDir, "scratch.txt"), "temp\n", "utf8");

  await restoreGitHeadSnapshot(snapshot, repoDir);

  assert.deepEqual(await listWorkingTreeFiles(repoDir), []);
  assert.equal(await readFile(filePath, "utf8"), "base\n");
  assert.equal(await runGit(repoDir, ["rev-parse", "HEAD"]), snapshot.head);
  await assert.rejects(
    runGit(repoDir, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
  );
});

test("restoreGitHeadSnapshot preserves ignored runtime directories while cleaning tracked changes", async () => {
  const repoDir = await createTempGitRepo();
  const filePath = path.join(repoDir, "example.txt");
  await writeFile(path.join(repoDir, ".gitignore"), ".aperture\n", "utf8");
  await writeFile(filePath, "base\n", "utf8");
  await commitAll(repoDir, "base");

  const snapshot = await captureGitHeadSnapshot(repoDir);
  const runtimeFilePath = path.join(repoDir, ".aperture", "lab", "status.json");
  await mkdir(path.dirname(runtimeFilePath), { recursive: true });
  await writeFile(runtimeFilePath, "{\"ok\":true}\n", "utf8");
  await writeFile(filePath, "changed\n", "utf8");

  await restoreGitHeadSnapshot(snapshot, repoDir);

  assert.deepEqual(await listWorkingTreeFiles(repoDir), []);
  assert.equal(await readFile(filePath, "utf8"), "base\n");
  assert.equal(await readFile(runtimeFilePath, "utf8"), "{\"ok\":true}\n");
  assert.ok((await stat(runtimeFilePath)).isFile());
});

async function createTempGitRepo(): Promise<string> {
  const repoDir = await mkdtemp(path.join(os.tmpdir(), "aperture-autoresearch-workspace-"));
  await mkdir(repoDir, { recursive: true });
  await spawnChecked("git", ["init"], { cwd: repoDir });
  await spawnChecked("git", ["config", "user.email", "aperture@example.com"], { cwd: repoDir });
  await spawnChecked("git", ["config", "user.name", "Aperture Test"], { cwd: repoDir });
  return repoDir;
}

async function commitAll(repoDir: string, message: string): Promise<void> {
  await spawnChecked("git", ["add", "-A"], { cwd: repoDir });
  await spawnChecked("git", ["commit", "-m", message], { cwd: repoDir });
}
