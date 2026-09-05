import type { Stats } from "node:fs";
import { chmod, lstat, mkdir } from "node:fs/promises";
import path from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;

export type OwnedStateRoot = {
  path: string;
  uid: number;
  identity: Stats;
};

export async function prepareOwnedStateRoot(
  rootDir: string,
  uid = currentUid(),
): Promise<OwnedStateRoot> {
  assertAbsoluteStateRoot(rootDir);
  const existing = await nearestExistingDirectory(rootDir);
  await assertPathComponents(existing, rootDir, uid);
  await createMissingComponents(existing, rootDir, uid);
  const identity = await lstat(rootDir);
  assertPrivateOwnedDirectory(identity, uid);
  return { path: rootDir, uid, identity };
}

export async function assertOwnedStateRoot(root: OwnedStateRoot): Promise<void> {
  const current = await lstat(root.path);
  assertPrivateOwnedDirectory(current, root.uid);
  if (!sameIdentity(current, root.identity)) {
    throw new Error("Aperture worker state root changed during operation");
  }
}

export function assertPrivateOwnedFile(metadata: Stats, uid: number): void {
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Aperture worker state file is unsafe");
  }
  if (metadata.uid !== uid) {
    throw new Error("Aperture worker state file has a different owner");
  }
  if ((metadata.mode & 0o777) !== 0o600 || metadata.nlink !== 1) {
    throw new Error("Aperture worker state file is not private");
  }
}

export function sameStateIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertAbsoluteStateRoot(rootDir: string): void {
  if (!path.isAbsolute(rootDir) || rootDir.includes("\0") || path.normalize(rootDir) !== rootDir) {
    throw new Error("Aperture worker state root must be an absolute canonical path");
  }
  if (path.basename(rootDir) === "." || path.basename(rootDir) === "..") {
    throw new Error("Aperture worker state root is invalid");
  }
}

async function nearestExistingDirectory(rootDir: string): Promise<string> {
  let candidate = rootDir;
  for (;;) {
    try {
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error("Aperture worker state path component is unsafe");
      }
      return candidate;
    } catch (error) {
      if (!hasCode(error, "ENOENT")) throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw new Error("Aperture worker state root has no safe parent");
      candidate = parent;
    }
  }
}

async function assertPathComponents(existing: string, rootDir: string, uid: number): Promise<void> {
  const absoluteRoot = path.parse(rootDir).root;
  let current = absoluteRoot;
  const relative = path.relative(absoluteRoot, existing);
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      if (metadata.uid !== 0) {
        throw new Error("Aperture worker state path component is unsafe");
      }
      continue;
    }
    if (!metadata.isDirectory()) {
      throw new Error("Aperture worker state path component is unsafe");
    }
  }
  if (existing === rootDir) {
    const metadata = await lstat(existing);
    if (metadata.uid !== uid) {
      throw new Error("Aperture worker state root has a different owner");
    }
    if ((metadata.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
      await chmod(existing, PRIVATE_DIRECTORY_MODE);
    }
  }
}

async function createMissingComponents(
  existing: string,
  rootDir: string,
  uid: number,
): Promise<void> {
  let current = existing;
  for (const component of path.relative(existing, rootDir).split(path.sep).filter(Boolean)) {
    const parent = await lstat(current);
    if (parent.isSymbolicLink() || !parent.isDirectory() || parent.uid !== uid) {
      throw new Error("Aperture worker state parent is unsafe");
    }
    current = path.join(current, component);
    try {
      await mkdir(current, { mode: PRIVATE_DIRECTORY_MODE });
    } catch (error) {
      if (!hasCode(error, "EEXIST")) throw error;
    }
    const created = await lstat(current);
    assertPrivateOwnedDirectory(created, uid);
  }
}

function assertPrivateOwnedDirectory(metadata: Stats, uid: number): void {
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Aperture worker state root is unsafe");
  }
  if (metadata.uid !== uid) {
    throw new Error("Aperture worker state root has a different owner");
  }
  if ((metadata.mode & 0o777) !== PRIVATE_DIRECTORY_MODE) {
    throw new Error("Aperture worker state root is not private");
  }
}

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Aperture worker state requires POSIX user ownership");
  return uid;
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
