import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import { chmod, link, lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import { createConnection, type Server } from "node:net";
import path from "node:path";

const SOCKET_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const LOCK_MODE = 0o600;
const LIFECYCLE_LOCK_NAME = ".attention.sock.lifecycle.lock";
const LIFECYCLE_OWNER_PREFIX = ".attention.sock.lifecycle.owner-";
const LIFECYCLE_OWNER_MAX_BYTES = 256;
const STALE_PROBE_TIMEOUT_MS = 75;
export const OWNED_SOCKET_CLEANUP_DEADLINE_MS = 1_500;
const OWNED_SOCKET_CLEANUP_RETRY_MS = 50;

type Clock = () => number;
type Sleep = (milliseconds: number) => Promise<void>;
type LifecycleLock = { path: string; identity: Stats };
type LifecycleOwner = { pid: number; token: string };
type LifecycleLockFailure = "unsafe" | "transient";

export type OwnedSocketCleanupResult = "absent" | "removed";
export type OwnedSocketCleanupTiming = {
  now?: Clock;
  sleep?: Sleep;
};

class LifecycleLockError extends Error {
  constructor(readonly failure: LifecycleLockFailure) {
    super(`Aperture worker socket lifecycle lock is ${failure}`);
    this.name = "LifecycleLockError";
  }
}

export class OwnedSocketCleanupError extends Error {
  constructor(
    message: string,
    readonly exitCode: 74 | 75,
  ) {
    super(message);
    this.name = "OwnedSocketCleanupError";
  }
}

export class DirectSocketStartupError extends Error {
  readonly exitCode: 74 | 75;
  readonly recoverable: boolean;

  constructor(
    message: string,
    readonly failure: LifecycleLockFailure,
  ) {
    super(message);
    this.name = "DirectSocketStartupError";
    this.recoverable = failure === "transient";
    this.exitCode = this.recoverable ? 75 : 74;
  }
}

export async function listenOnOwnedSocket(
  server: Server,
  socketPath: string,
  uid: number,
  probe: (socketPath: string) => Promise<boolean> = probeSocket,
): Promise<Stats> {
  try {
    assertCanonicalSocketPath(socketPath);
    await ensurePrivateSocketDirectories(socketPath, uid);
    const now = Date.now;
    const sleep = defaultSleep;
    const deadline = now() + OWNED_SOCKET_CLEANUP_DEADLINE_MS;
    return await withLifecycleLock(socketPath, uid, deadline, now, sleep, async () => {
      await assertPrivateSocketDirectories(socketPath, uid);
      await removeInactiveOwnedSocket(socketPath, uid, probe);
      let listening = false;
      let socketIdentity: Stats | undefined;
      try {
        try {
          await listen(server, socketPath);
        } catch (error) {
          if (hasCode(error, "EADDRINUSE")) {
            await assertPrivateSocketDirectories(socketPath, uid);
            const occupied = await lstat(socketPath);
            assertOwnedSocketMetadata(occupied, uid);
            if ((occupied.mode & 0o777) !== SOCKET_MODE) {
              throw new Error("Aperture worker socket permissions are not private");
            }
            throw new DirectSocketStartupError(
              "Aperture worker socket is already active",
              "transient",
            );
          }
          throw error;
        }
        listening = true;
        socketIdentity = await lstat(socketPath);
        assertOwnedSocketMetadata(socketIdentity, uid);
        socketIdentity = await secureListeningSocket(socketPath, uid, socketIdentity);
        return socketIdentity;
      } catch (error) {
        if (listening) {
          try {
            await closeServer(server, OWNED_SOCKET_CLEANUP_DEADLINE_MS);
          } catch {
            // The startup error remains authoritative. Identity checks below still fail closed.
          }
          if (socketIdentity) {
            await removeOwnedSocket(socketPath, uid, socketIdentity);
          }
        }
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof DirectSocketStartupError) throw error;
    throw new DirectSocketStartupError(
      error instanceof Error ? error.message : "Aperture worker socket startup is unsafe",
      error instanceof LifecycleLockError ? error.failure : "unsafe",
    );
  }
}

export async function closeOwnedSocketServer(
  server: Server,
  socketPath: string,
  uid: number,
  identity: Stats,
  timeoutMs: number,
): Promise<void> {
  assertCanonicalSocketPath(socketPath);
  let directoriesExist: boolean;
  try {
    directoriesExist = await socketDirectoriesExist(socketPath, uid);
  } catch (error) {
    await closeServer(server, timeoutMs);
    throw error;
  }
  if (!directoriesExist) {
    await closeServer(server, timeoutMs);
    return;
  }
  const now = Date.now;
  const deadline = now() + OWNED_SOCKET_CLEANUP_DEADLINE_MS;
  await withLifecycleLock(socketPath, uid, deadline, now, defaultSleep, async () => {
    await assertPrivateSocketDirectories(socketPath, uid);
    await closeServer(server, timeoutMs);
    await removeOwnedSocket(socketPath, uid, identity);
  });
}

export async function cleanupOwnedSocket(
  socketPath: string,
  uid: number = currentUid(),
  probe: (socketPath: string) => Promise<boolean> = probeSocket,
  timing: OwnedSocketCleanupTiming = {},
): Promise<OwnedSocketCleanupResult> {
  const now = timing.now ?? Date.now;
  const sleep = timing.sleep ?? defaultSleep;
  const deadline = now() + OWNED_SOCKET_CLEANUP_DEADLINE_MS;
  try {
    assertCanonicalSocketPath(socketPath);
    if (!(await socketDirectoriesExist(socketPath, uid))) return "absent";
    return await withLifecycleLock(socketPath, uid, deadline, now, sleep, async () => {
      if (!(await socketDirectoriesExist(socketPath, uid))) return "absent";
      return cleanupOwnedSocketWhileLocked(socketPath, uid, probe, deadline, now, sleep);
    });
  } catch (error) {
    if (error instanceof OwnedSocketCleanupError) throw error;
    if (error instanceof LifecycleLockError) {
      throw new OwnedSocketCleanupError(
        `Aperture worker socket cleanup state is ${error.failure}`,
        error.failure === "transient" ? 75 : 74,
      );
    }
    throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
  }
}

async function cleanupOwnedSocketWhileLocked(
  socketPath: string,
  uid: number,
  probe: (socketPath: string) => Promise<boolean>,
  deadline: number,
  now: Clock,
  sleep: Sleep,
): Promise<OwnedSocketCleanupResult> {
  let identity: Stats;
  try {
    identity = await lstat(socketPath);
  } catch (error) {
    if (isMissing(error)) return "absent";
    throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
  }
  try {
    assertOwnedSocketMetadata(identity, uid);
  } catch {
    throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
  }

  while (now() < deadline) {
    let current: Stats;
    try {
      current = await lstat(socketPath);
    } catch (error) {
      if (isMissing(error)) return "absent";
      throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
    }
    if (!sameIdentity(current, identity)) {
      await waitForRetry(deadline, now, sleep);
      continue;
    }
    try {
      assertOwnedSocketMetadata(current, uid);
    } catch {
      throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
    }

    const active = await probeSocketBeforeDeadline(socketPath, probe, deadline - now());
    if (active === undefined || active) {
      await waitForRetry(deadline, now, sleep);
      continue;
    }

    try {
      current = await lstat(socketPath);
    } catch (error) {
      if (isMissing(error)) return "absent";
      throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
    }
    if (!sameIdentity(current, identity)) {
      await waitForRetry(deadline, now, sleep);
      continue;
    }
    try {
      assertOwnedSocketMetadata(current, uid);
    } catch {
      throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
    }
    if (now() >= deadline) break;
    try {
      await unlink(socketPath);
      return "removed";
    } catch (error) {
      if (isMissing(error)) return "absent";
      throw new OwnedSocketCleanupError("Aperture worker socket cleanup state is unsafe", 74);
    }
  }
  throw new OwnedSocketCleanupError("Aperture worker socket cleanup remained transient", 75);
}

async function withLifecycleLock<T>(
  socketPath: string,
  uid: number,
  deadline: number,
  now: Clock,
  sleep: Sleep,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = await acquireLifecycleLock(socketPath, uid, deadline, now, sleep);
  try {
    return await operation();
  } finally {
    await releaseLifecycleLock(lock, uid);
  }
}

async function acquireLifecycleLock(
  socketPath: string,
  uid: number,
  deadline: number,
  now: Clock,
  sleep: Sleep,
): Promise<LifecycleLock> {
  const parent = path.dirname(socketPath);
  const lockPath = path.join(parent, LIFECYCLE_LOCK_NAME);
  while (now() < deadline) {
    const owner: LifecycleOwner = {
      pid: process.pid,
      token: randomBytes(18).toString("base64url"),
    };
    const ownerPath = path.join(parent, `${LIFECYCLE_OWNER_PREFIX}${owner.pid}-${owner.token}`);
    const handle = await open(ownerPath, "wx", LOCK_MODE);
    try {
      await handle.chmod(LOCK_MODE);
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    let linked = false;
    let linkError: unknown;
    try {
      await link(ownerPath, lockPath);
      linked = true;
    } catch (error) {
      if (!isAlreadyExists(error)) linkError = error;
    }
    await unlinkIfPresent(ownerPath);
    if (linkError) throw linkError;
    if (linked) {
      const identity = await readLifecycleLock(lockPath, uid);
      if (identity.owner.pid !== owner.pid || identity.owner.token !== owner.token) {
        throw new LifecycleLockError("unsafe");
      }
      return { path: lockPath, identity: identity.metadata };
    }

    let existing: { metadata: Stats; owner: LifecycleOwner };
    try {
      existing = await readLifecycleLock(lockPath, uid);
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    if (!(await processIsAlive(existing.owner.pid))) {
      await reclaimInactiveLifecycleLock(lockPath, existing, uid);
      continue;
    }
    await waitForRetry(deadline, now, sleep);
  }
  throw new LifecycleLockError("transient");
}

async function readLifecycleLock(
  lockPath: string,
  uid: number,
): Promise<{ metadata: Stats; owner: LifecycleOwner }> {
  const before = await lstat(lockPath);
  assertLifecycleLockMetadata(before, uid);
  if (before.size < 1 || before.size > LIFECYCLE_OWNER_MAX_BYTES) {
    throw new LifecycleLockError("unsafe");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    throw new LifecycleLockError("unsafe");
  }
  const after = await lstat(lockPath);
  assertLifecycleLockMetadata(after, uid);
  if (!sameIdentity(before, after)) throw new LifecycleLockError("unsafe");
  if (!isLifecycleOwner(parsed)) throw new LifecycleLockError("unsafe");
  return { metadata: after, owner: parsed };
}

function assertLifecycleLockMetadata(metadata: Stats, uid: number): void {
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new LifecycleLockError("unsafe");
  }
  if (
    metadata.uid !== uid ||
    (metadata.mode & 0o777) !== LOCK_MODE ||
    (metadata.nlink !== 1 && metadata.nlink !== 2)
  ) {
    throw new LifecycleLockError("unsafe");
  }
}

function isLifecycleOwner(value: unknown): value is LifecycleOwner {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const owner = value as Record<string, unknown>;
  return (
    Object.keys(owner).length === 2 &&
    Number.isSafeInteger(owner.pid) &&
    Number(owner.pid) > 0 &&
    typeof owner.token === "string" &&
    /^[A-Za-z0-9_-]{24}$/.test(owner.token)
  );
}
async function reclaimInactiveLifecycleLock(
  lockPath: string,
  existing: { metadata: Stats; owner: LifecycleOwner },
  uid: number,
): Promise<void> {
  if (existing.metadata.nlink === 2) {
    const ownerPath = path.join(
      path.dirname(lockPath),
      `${LIFECYCLE_OWNER_PREFIX}${existing.owner.pid}-${existing.owner.token}`,
    );
    let ownerMetadata: Stats;
    try {
      ownerMetadata = await lstat(ownerPath);
    } catch (error) {
      if (!isMissing(error)) throw error;
      const current = await lstat(lockPath);
      assertLifecycleLockMetadata(current, uid);
      if (!sameIdentity(current, existing.metadata)) return;
      if (current.nlink !== 1) throw new LifecycleLockError("unsafe");
      await unlinkIfSame(lockPath, current);
      return;
    }
    assertLifecycleLockMetadata(ownerMetadata, uid);
    if (ownerMetadata.nlink !== 2 || !sameIdentity(ownerMetadata, existing.metadata)) {
      throw new LifecycleLockError("unsafe");
    }
    await unlinkIfSame(ownerPath, existing.metadata);
  }

  let current: Stats;
  try {
    current = await lstat(lockPath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  assertLifecycleLockMetadata(current, uid);
  if (!sameIdentity(current, existing.metadata)) return;
  if (current.nlink !== 1) throw new LifecycleLockError("unsafe");
  await unlink(lockPath);
}

async function processIsAlive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, "ESRCH")) return false;
    if (hasCode(error, "EPERM")) return true;
    throw new LifecycleLockError("unsafe");
  }
}

async function unlinkIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function unlinkIfSame(filePath: string, identity: Stats): Promise<void> {
  let current: Stats;
  try {
    current = await lstat(filePath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (!sameIdentity(current, identity)) return;
  await unlink(filePath);
}

async function releaseLifecycleLock(lock: LifecycleLock, uid: number): Promise<void> {
  let current: Stats;
  try {
    current = await lstat(lock.path);
  } catch (error) {
    if (isMissing(error)) throw new LifecycleLockError("unsafe");
    throw error;
  }
  assertLifecycleLockMetadata(current, uid);
  if (current.nlink !== 1) throw new LifecycleLockError("unsafe");
  if (!sameIdentity(current, lock.identity)) throw new LifecycleLockError("unsafe");
  await unlink(lock.path);
}

async function waitForRetry(deadline: number, now: Clock, sleep: Sleep): Promise<void> {
  const remaining = deadline - now();
  if (remaining <= 0) return;
  await sleep(Math.min(OWNED_SOCKET_CLEANUP_RETRY_MS, remaining));
}

async function probeSocketBeforeDeadline(
  socketPath: string,
  probe: (socketPath: string) => Promise<boolean>,
  remainingMs: number,
): Promise<boolean | undefined> {
  if (remainingMs <= 0) return undefined;
  return new Promise<boolean | undefined>((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), remainingMs);
    void probe(socketPath).then(
      (active) => {
        clearTimeout(timer);
        resolve(active);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function removeInactiveOwnedSocket(
  socketPath: string,
  uid: number,
  probe: (socketPath: string) => Promise<boolean>,
): Promise<void> {
  let existing: Stats;
  try {
    existing = await lstat(socketPath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  assertOwnedSocketMetadata(existing, uid);
  if ((existing.mode & 0o777) !== SOCKET_MODE) {
    throw new Error("Aperture worker socket permissions are not private");
  }
  if (await probe(socketPath)) {
    throw new DirectSocketStartupError("Aperture worker socket is already active", "transient");
  }
  let current: Stats;
  try {
    current = await lstat(socketPath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (!sameIdentity(current, existing)) {
    throw new Error("Aperture worker socket changed during stale recovery");
  }
  assertOwnedSocketMetadata(current, uid);
  if ((current.mode & 0o777) !== SOCKET_MODE) {
    throw new Error("Aperture worker socket permissions are not private");
  }
  await unlink(socketPath);
}

function assertCanonicalSocketPath(socketPath: string): void {
  if (Buffer.byteLength(socketPath, "utf8") > 100) {
    throw new Error("Aperture worker socket path exceeded the portable Unix limit");
  }
  if (!path.isAbsolute(socketPath)) {
    throw new Error("Aperture worker socket path must be absolute");
  }
  const parent = path.dirname(socketPath);
  if (
    path.basename(socketPath) !== "attention.sock" ||
    path.basename(parent) !== "aperture" ||
    path.basename(path.dirname(parent)) !== "omarchy"
  ) {
    throw new Error("Aperture worker socket path is outside the package-owned location");
  }
}

async function ensurePrivateSocketDirectories(socketPath: string, uid: number): Promise<void> {
  const parent = path.dirname(socketPath);
  const packageRoot = path.dirname(parent);
  await assertPrivateDirectory(path.dirname(packageRoot), uid);
  await ensurePrivateDirectory(packageRoot, uid);
  await ensurePrivateDirectory(parent, uid);
}

async function assertPrivateSocketDirectories(socketPath: string, uid: number): Promise<void> {
  const parent = path.dirname(socketPath);
  for (const directory of [path.dirname(path.dirname(parent)), path.dirname(parent), parent]) {
    await assertPrivateDirectory(directory, uid);
  }
}

async function socketDirectoriesExist(socketPath: string, uid: number): Promise<boolean> {
  const parent = path.dirname(socketPath);
  for (const directory of [path.dirname(path.dirname(parent)), path.dirname(parent), parent]) {
    try {
      await assertPrivateDirectory(directory, uid);
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
  return true;
}

async function assertPrivateDirectory(directory: string, uid: number): Promise<void> {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Aperture worker socket directory is unsafe");
  }
  if (metadata.uid !== uid) {
    throw new Error("Aperture worker socket directory has a different owner");
  }
  if ((metadata.mode & 0o777) !== DIRECTORY_MODE) {
    throw new Error("Aperture worker socket directory is not private");
  }
}

export function assertOwnedSocketMetadata(metadata: Stats, uid: number): void {
  if (metadata.isSymbolicLink()) throw new Error("Aperture worker socket must not be a symlink");
  if (!metadata.isSocket()) throw new Error("Aperture worker socket path is not a socket");
  if (metadata.uid !== uid) throw new Error("Aperture worker socket has a different owner");
}

async function secureListeningSocket(
  socketPath: string,
  uid: number,
  created: Stats,
): Promise<Stats> {
  await chmod(socketPath, SOCKET_MODE);
  const metadata = await lstat(socketPath);
  assertOwnedSocketMetadata(metadata, uid);
  if (!sameIdentity(metadata, created)) {
    throw new Error("Aperture worker socket changed while securing permissions");
  }
  if ((metadata.mode & 0o777) !== SOCKET_MODE) {
    throw new Error("Aperture worker socket permissions are not private");
  }
  return metadata;
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Aperture direct server shutdown timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function removeOwnedSocket(socketPath: string, uid: number, identity: Stats): Promise<void> {
  try {
    const current = await lstat(socketPath);
    assertOwnedSocketMetadata(current, uid);
    if (!sameIdentity(current, identity)) {
      throw new Error("Aperture worker socket was replaced before shutdown");
    }
    await unlink(socketPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

export function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Aperture worker socket requires POSIX user ownership");
  return uid;
}

async function ensurePrivateDirectory(directory: string, uid: number): Promise<void> {
  let created = false;
  try {
    await mkdir(directory, { mode: DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Aperture worker socket directory is unsafe");
  }
  if (metadata.uid !== uid) {
    throw new Error("Aperture worker socket directory has a different owner");
  }
  if (created) await chmod(directory, DIRECTORY_MODE);
  await assertPrivateDirectory(directory, uid);
}

async function probeSocket(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const timer = setTimeout(
      () => finish(false, new LifecycleLockError("transient")),
      STALE_PROBE_TIMEOUT_MS,
    );
    const finish = (active: boolean, error?: Error): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else resolve(active);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ECONNREFUSED" || error.code === "ENOENT") finish(false);
      else finish(false, new Error("Aperture worker socket could not be probed safely"));
    });
  });
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function hasCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function isMissing(error: unknown): boolean {
  return hasCode(error, "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return hasCode(error, "EEXIST");
}
