import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, type Server } from "node:net";
import path from "node:path";

const SOCKET_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const STALE_PROBE_TIMEOUT_MS = 75;

export async function prepareSocketPath(
  socketPath: string,
  uid: number,
  probe: (socketPath: string) => Promise<boolean> = probeSocket,
): Promise<void> {
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
  const packageRoot = path.dirname(parent);
  await ensurePrivateDirectory(packageRoot, uid);
  await ensurePrivateDirectory(parent, uid);
  let existing: Stats;
  try {
    existing = await lstat(socketPath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  assertOwnedSocketMetadata(existing, uid);
  if (await probe(socketPath)) throw new Error("Aperture worker socket is already active");
  const current = await lstat(socketPath);
  assertOwnedSocketMetadata(current, uid);
  if (current.dev !== existing.dev || current.ino !== existing.ino) {
    throw new Error("Aperture worker socket changed during stale recovery");
  }
  await unlink(socketPath);
}

export function assertOwnedSocketMetadata(metadata: Stats, uid: number): void {
  if (metadata.isSymbolicLink()) throw new Error("Aperture worker socket must not be a symlink");
  if (!metadata.isSocket()) throw new Error("Aperture worker socket path is not a socket");
  if (metadata.uid !== uid) throw new Error("Aperture worker socket has a different owner");
}

export async function secureListeningSocket(socketPath: string, uid: number): Promise<Stats> {
  await chmod(socketPath, SOCKET_MODE);
  const metadata = await lstat(socketPath);
  assertOwnedSocketMetadata(metadata, uid);
  if ((metadata.mode & 0o777) !== SOCKET_MODE) {
    throw new Error("Aperture worker socket permissions are not private");
  }
  return metadata;
}

export async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export async function closeServer(server: Server, timeoutMs: number): Promise<void> {
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

export async function removeOwnedSocket(
  socketPath: string,
  uid: number,
  identity: Stats,
): Promise<void> {
  try {
    const current = await lstat(socketPath);
    assertOwnedSocketMetadata(current, uid);
    if (current.dev !== identity.dev || current.ino !== identity.ino) {
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
  try {
    await mkdir(directory, { mode: DIRECTORY_MODE });
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
  await chmod(directory, DIRECTORY_MODE);
  const mode = (await lstat(directory)).mode & 0o777;
  if (mode !== DIRECTORY_MODE) {
    throw new Error("Aperture worker socket directory is not private");
  }
}

async function probeSocket(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const timer = setTimeout(() => finish(false), STALE_PROBE_TIMEOUT_MS);
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

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
