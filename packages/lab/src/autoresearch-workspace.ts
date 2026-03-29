import { access, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function ensureCleanRepo(repoDir: string): Promise<void> {
  const status = await runGit(repoDir, ["status", "--short"]);
  if (status.trim()) {
    throw new Error("F-Stop campaign requires a clean source repo before it starts.");
  }
}

export async function ensureCleanWorktree(repoDir: string = process.cwd()): Promise<void> {
  const files = await listWorkingTreeFiles(repoDir);
  if (files.length > 0) {
    throw new Error(
      `Autoresearch agent run requires a clean worktree before it starts. Found changes in: ${files.join(", ")}`,
    );
  }
}

export async function listWorkingTreeFiles(repoDir: string = process.cwd()): Promise<string[]> {
  const status = await runGit(repoDir, ["status", "--short"]);
  return parseGitStatusFiles(status);
}

export function parseGitStatusFiles(statusOutput: string): string[] {
  const files = new Set<string>();
  for (const line of statusOutput.split("\n")) {
    if (!line.trim()) {
      continue;
    }

    const candidate = line.slice(3).trim();
    if (!candidate) {
      continue;
    }

    const renamed = candidate.includes(" -> ") ? candidate.split(" -> ").at(-1) : candidate;
    if (renamed) {
      files.add(renamed);
    }
  }

  return [...files].sort();
}

export async function runGit(repoDir: string, args: string[]): Promise<string> {
  const { stdout, stderr, code } = await runCommand("git", args, {
    cwd: repoDir,
  });
  if (code !== 0) {
    throw new Error(`git ${args.join(" ")} failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`);
  }
  return stdout.trim();
}

export async function spawnChecked(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    captureStdout?: boolean;
  },
): Promise<{
  stdout: string;
  stderr: string;
}> {
  const result = await runCommand(command, args, options);
  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.code}${result.stderr ? `: ${result.stderr}` : ""}`,
    );
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

export async function ensureSymlink(linkPath: string, targetPath: string): Promise<void> {
  await mkdir(path.dirname(linkPath), { recursive: true });
  await rm(linkPath, { force: true, recursive: true });
  await symlink(targetPath, linkPath);
}

export async function prepareWorktreeWorkspace(options: {
  sourceRepo: string;
  commit: string;
  repoDir: string;
}): Promise<void> {
  await mkdir(path.dirname(options.repoDir), { recursive: true });
  await removeExistingWorktree(options.sourceRepo, options.repoDir);
  await ensureSourceRepoDependencies(options.sourceRepo);
  await spawnChecked("git", ["worktree", "add", "--detach", options.repoDir, options.commit], {
    cwd: options.sourceRepo,
  });
  await linkSharedNodeModules(options.sourceRepo, options.repoDir);
}

export async function pruneWorktreeMetadata(sourceRepo: string): Promise<void> {
  await spawnChecked("git", ["worktree", "prune"], {
    cwd: sourceRepo,
  });
}

async function removeExistingWorktree(sourceRepo: string, repoDir: string): Promise<void> {
  try {
    await spawnChecked("git", ["worktree", "remove", "--force", repoDir], {
      cwd: sourceRepo,
    });
  } catch {
    // If the path is not a registered worktree yet, a plain filesystem cleanup is enough.
  }
  await rm(repoDir, { recursive: true, force: true });
  await pruneWorktreeMetadata(sourceRepo).catch(() => undefined);
}

async function ensureSourceRepoDependencies(sourceRepo: string): Promise<void> {
  const tsxCliPath = path.join(sourceRepo, "node_modules", "tsx", "dist", "cli.mjs");
  if (await pathExists(tsxCliPath)) {
    return;
  }

  await spawnChecked("pnpm", ["install", "--frozen-lockfile"], {
    cwd: sourceRepo,
  });
}

async function linkSharedNodeModules(sourceRepo: string, repoDir: string): Promise<void> {
  const sourceNodeModules = path.join(sourceRepo, "node_modules");
  const targetNodeModules = path.join(repoDir, "node_modules");
  if (!(await pathExists(sourceNodeModules))) {
    throw new Error(`Shared node_modules missing at ${sourceNodeModules}`);
  }

  await rm(targetNodeModules, { recursive: true, force: true });
  await symlink(sourceNodeModules, targetNodeModules);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    captureStdout?: boolean;
  },
): Promise<{
  stdout: string;
  stderr: string;
  code: number;
}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", options.captureStdout === false ? "ignore" : "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8").trim(),
        code: code ?? 1,
      });
    });

    if (!child.stdin) {
      reject(new Error(`${command} did not provide stdin`));
      return;
    }

    if (options.stdin !== undefined) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}
