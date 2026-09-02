import { randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
import type { Writable } from "node:stream";

import {
  WORKER_DIRECT_LIMITS,
  directMessageRequestId,
  parseWorkerDirectMessage,
  type FocusRecovery,
  type FocusRegistration,
  type FocusRevocation,
  type WorkerDirectMessage,
} from "../worker-direct-message.js";
import type { OmpAttentionEvent } from "../omp-attention-event.js";
import { FOCUS_LIMITS, FocusRegistrationError } from "./focus/types.js";
import {
  closeServer,
  currentUid,
  listen,
  prepareSocketPath,
  removeOwnedSocket,
  secureListeningSocket,
} from "./direct-socket-lifecycle.js";

const ATTENTION_PROCESSING_TIMEOUT_MS = 500;
const FOCUS_PROCESSING_TIMEOUT_MS = 2_250;
const CONNECTION_TIMEOUT_MS = 500;

export type OmpAttentionSocketServerOptions = {
  socketPath: string;
  handleAttention: (event: OmpAttentionEvent, signal: AbortSignal) => Promise<void>;
  registerFocus: (
    registration: FocusRegistration,
    signal: AbortSignal,
  ) => Promise<FocusRecovery | undefined>;
  revokeFocus: (revocation: FocusRevocation, signal: AbortSignal) => Promise<void> | void;
  diagnostic?: Writable;
  uid?: number;
  probe?: (socketPath: string) => Promise<boolean>;
  maximumClients?: number;
  workerGeneration?: string;
  shutdownTimeoutMs?: number;
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
  const maximumClients = options.maximumClients ?? FOCUS_LIMITS.directClients;
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? FOCUS_LIMITS.shutdownMilliseconds;
  const workerGeneration = options.workerGeneration ?? randomBytes(24).toString("base64url");
  if (!/^[A-Za-z0-9_-]{32}$/.test(workerGeneration)) {
    throw new Error("Aperture worker generation was invalid");
  }
  if (!Number.isSafeInteger(maximumClients) || maximumClients < 1) {
    throw new Error("Aperture direct client limit was invalid");
  }
  if (options.probe) await prepareSocketPath(options.socketPath, uid, options.probe);
  else await prepareSocketPath(options.socketPath, uid);

  const clients = new Set<Socket>();
  const activeOperations = new Set<AbortController>();
  let closing = false;
  const server = createServer((socket) => {
    if (closing || clients.size >= maximumClients) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    void handleConnection(socket, options, diagnostic, activeOperations, workerGeneration).finally(
      () => {
        clients.delete(socket);
      },
    );
  });
  await listen(server, options.socketPath);
  const socketIdentity = await secureListeningSocket(options.socketPath, uid);

  return {
    path: options.socketPath,
    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      for (const client of clients) client.destroy();
      for (const operation of activeOperations) operation.abort();
      await closeServer(server, shutdownTimeoutMs);
      await removeOwnedSocket(options.socketPath, uid, socketIdentity);
    },
  };
}

async function handleConnection(
  socket: Socket,
  options: Pick<
    OmpAttentionSocketServerOptions,
    "handleAttention" | "registerFocus" | "revokeFocus"
  >,
  diagnostic: Writable,
  activeOperations: Set<AbortController>,
  workerGeneration: string,
): Promise<void> {
  socket.setTimeout(CONNECTION_TIMEOUT_MS);
  let buffer = Buffer.alloc(0);
  let handled = false;
  const reject = (): void => {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify({ schemaVersion: 4, status: "rejected" })}\n`);
  };

  socket.once("timeout", reject);
  socket.once("error", () => undefined);
  socket.on("data", (chunk: Buffer) => {
    if (handled) return;
    if (buffer.byteLength + chunk.byteLength > WORKER_DIRECT_LIMITS.jsonLineBytes) {
      handled = true;
      reject();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(0x0a);
    if (newline === -1) return;
    handled = true;
    socket.setTimeout(0);
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
      socket.setTimeout(0);
      void processLine(buffer.toString("utf8"));
    } else if (!handled) {
      socket.destroy();
    }
  });

  const processLine = async (line: string): Promise<void> => {
    let message: WorkerDirectMessage | undefined;
    try {
      message = parseWorkerDirectMessage(line);
      const current = message;
      const recovery = await withDeadline(
        async (signal) =>
          current.type === "omp.attention-event"
            ? options.handleAttention(current, signal).then(() => undefined)
            : current.type === "focus.register"
              ? options.registerFocus(current, signal)
              : Promise.resolve(options.revokeFocus(current, signal)).then(() => undefined),
        current.type === "omp.attention-event"
          ? ATTENTION_PROCESSING_TIMEOUT_MS
          : FOCUS_PROCESSING_TIMEOUT_MS,
        activeOperations,
      );
      if (!socket.destroyed) {
        socket.end(
          `${JSON.stringify({
            schemaVersion: 4,
            status: "accepted",
            requestId: directMessageRequestId(current),
            ...(current.type === "focus.register" && recovery ? { recovery } : {}),
            ...(current.type === "focus.register" ? { workerGeneration } : {}),
          })}\n`,
        );
      }
    } catch (error) {
      if (
        message?.type === "focus.register" &&
        error instanceof FocusRegistrationError &&
        !socket.destroyed
      ) {
        socket.end(
          `${JSON.stringify({
            schemaVersion: 4,
            status: "rejected",
            requestId: message.requestId,
            code: error.code,
          })}\n`,
        );
        return;
      }
      if (message && !socket.destroyed) {
        const code =
          error instanceof Error && error.message === "Aperture attention engine failed"
            ? "attention_engine_failed"
            : error instanceof Error && error.message === "Aperture attention snapshot failed"
              ? "attention_snapshot_failed"
              : error instanceof Error &&
                  error.message === "Aperture direct message processing timed out"
                ? "processing_timeout"
                : "processing_failed";
        socket.end(
          `${JSON.stringify({
            schemaVersion: 4,
            status: "rejected",
            requestId: directMessageRequestId(message),
            code,
          })}\n`,
        );
        return;
      }
      diagnostic.write("Aperture rejected an invalid direct OMP event\n");
      reject();
    }
  };

  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  activeOperations: Set<AbortController>,
): Promise<T> {
  const controller = new AbortController();
  activeOperations.add(controller);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("Aperture direct message processing timed out"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    activeOperations.delete(controller);
    clearTimeout(timer);
  }
}
