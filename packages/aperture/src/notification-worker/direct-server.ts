import type { Stats } from "node:fs";
import { chmod, lstat, mkdir, unlink } from "node:fs/promises";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import type { Writable } from "node:stream";

import {
  OMP_DIRECT_LIMITS,
  directMessageRequestId,
  parseOmpDirectMessage,
  type OmpFocusRegistration,
  type OmpFocusRevocation,
} from "../omp-direct-message.js";
import type { OmpAttentionEvent } from "../omp-attention-event.js";

const SOCKET_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const CONNECTION_TIMEOUT_MS = 500;
const STALE_PROBE_TIMEOUT_MS = 75;

export type OmpAttentionSocketServerOptions = {
  socketPath: string;
  handleAttention: (event: OmpAttentionEvent) => Promise<void>;
  registerFocus: (registration: OmpFocusRegistration) => Promise<void>;
  revokeFocus: (revocation: OmpFocusRevocation) => Promise<void> | void;
  diagnostic?: Writable;
  uid?: number;
  probe?: (socketPath: string) => Promise<boolean>;
};

export type OmpAttentionSocketServer = {
  path: string;
  close(): Promise<void>;
};

export async function startOmpAttentionSocketServer(
  options: OmpAttentionSocketServerOptions,
): Promise<OmpAttentionSocketServer> {
  const diagnostic = options.diagnostic ?? process.stderr;
  const uid = options.uid ?? currentUid();
  await prepareSocketPath(options.socketPath, uid, options.probe ?? probeSocket);

  const clients = new Set<Socket>();
  let closing = false;
  const server = createServer((socket) => {
    if (closing) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    void handleConnection(socket, options, diagnostic).finally(() => {
      clients.delete(socket);
    });
  });
  await listen(server, options.socketPath);
  await chmod(options.socketPath, SOCKET_MODE);
  const socketIdentity = await validateSocketFile(options.socketPath, uid);

  return {
    path: options.socketPath,
    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      for (const client of clients) client.destroy();
      await closeServer(server);
      await removeOwnedSocket(options.socketPath, uid, socketIdentity);
    },
  };
}

export async function prepareSocketPath(
  socketPath: string,
  uid: number,
  probe: (socketPath: string) => Promise<boolean> = probeSocket,
): Promise<void> {
  if (Buffer.byteLength(socketPath, "utf8") > 100) {
    throw new Error("Aperture worker socket path exceeded the portable Unix limit");
  }
  if (!path.isAbsolute(socketPath)) throw new Error("Aperture worker socket path must be absolute");
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
  if (await probe(socketPath)) {
    throw new Error("Aperture worker socket is already active");
  }
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
  if (metadata.uid !== uid)
    throw new Error("Aperture worker socket directory has a different owner");
  await chmod(directory, DIRECTORY_MODE);
  const mode = (await lstat(directory)).mode & 0o777;
  if (mode !== DIRECTORY_MODE) throw new Error("Aperture worker socket directory is not private");
}

async function validateSocketFile(socketPath: string, uid: number): Promise<Stats> {
  const metadata = await lstat(socketPath);
  assertOwnedSocketMetadata(metadata, uid);
  if ((metadata.mode & 0o777) !== SOCKET_MODE) {
    throw new Error("Aperture worker socket permissions are not private");
  }
  return metadata;
}

async function handleConnection(
  socket: Socket,
  options: Pick<
    OmpAttentionSocketServerOptions,
    "handleAttention" | "registerFocus" | "revokeFocus"
  >,
  diagnostic: Writable,
): Promise<void> {
  socket.setTimeout(CONNECTION_TIMEOUT_MS);
  let buffer = Buffer.alloc(0);
  let handled = false;
  const reject = (): void => {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify({ schemaVersion: 2, status: "rejected" })}\n`);
  };

  socket.once("timeout", reject);
  socket.once("error", () => undefined);
  socket.on("data", (chunk: Buffer) => {
    if (handled) return;
    if (buffer.byteLength + chunk.byteLength > OMP_DIRECT_LIMITS.jsonLineBytes) {
      handled = true;
      reject();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(0x0a);
    if (newline === -1) return;
    handled = true;
    const trailing = buffer.subarray(newline + 1).toString("utf8");
    if (trailing.trim()) {
      reject();
      return;
    }
    void processLine(buffer.subarray(0, newline).toString("utf8"));
  });
  socket.once("end", () => {
    if (!handled && buffer.byteLength > 0) {
      handled = true;
      void processLine(buffer.toString("utf8"));
    } else if (!handled) {
      socket.destroy();
    }
  });

  const processLine = async (line: string): Promise<void> => {
    try {
      const message = parseOmpDirectMessage(line);
      if (message.type === "omp.attention-event") {
        await options.handleAttention(message);
      } else if (message.type === "omp.focus.register") {
        await options.registerFocus(message);
      } else {
        await options.revokeFocus(message);
      }
      if (!socket.destroyed) {
        socket.end(
          `${JSON.stringify({
            schemaVersion: 2,
            status: "accepted",
            requestId: directMessageRequestId(message),
          })}\n`,
        );
      }
    } catch {
      diagnostic.write("Aperture rejected an invalid direct OMP event\n");
      reject();
    }
  };

  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
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

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function removeOwnedSocket(socketPath: string, uid: number, identity: Stats): Promise<void> {
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

function currentUid(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("Aperture worker socket requires POSIX user ownership");
  return uid;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
