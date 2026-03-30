import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { tryReadJsonFile } from "./json-utils.js";

export type AutoresearchProcessLock = {
  kind: "service" | "sweep";
  id: string;
  root: string;
  pid: number;
  createdAt: string;
  sourceRepo: string;
};

export async function acquireAutoresearchProcessLock(
  lockPath: string,
  lock: AutoresearchProcessLock,
): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockPath), { recursive: true });

  const existing = await readAutoresearchProcessLock(lockPath);
  if (existing) {
    const alive = isAutoresearchProcessAlive(existing.pid);
    if (alive) {
      throw new Error(
        `Another F-Stop ${existing.kind} is already running: ${existing.id} (pid ${existing.pid}) at ${existing.root}`,
      );
    }
    await rm(lockPath, { force: true });
  }

  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

  return async () => {
    const current = await readAutoresearchProcessLock(lockPath);
    if (!current || (current.pid === lock.pid && current.id === lock.id && current.kind === lock.kind)) {
      await rm(lockPath, { force: true });
    }
  };
}

export async function readAutoresearchProcessLock(
  lockPath: string,
): Promise<AutoresearchProcessLock | undefined> {
  return await tryReadJsonFile<AutoresearchProcessLock>(lockPath);
}

export function isAutoresearchProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
