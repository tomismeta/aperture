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
  type WorkerDirectAcknowledgement,
} from "../worker-direct-message.js";
import type { OmpAttentionEvent } from "../omp-attention-event.js";
import { DirectReceiptLedger } from "./direct-receipt-ledger.js";
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
  maximumReceipts?: number;
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
  const maximumReceipts = options.maximumReceipts ?? WORKER_DIRECT_LIMITS.receiptRecords;
  const workerGeneration = options.workerGeneration ?? randomBytes(24).toString("base64url");
  if (!/^[A-Za-z0-9_-]{32}$/.test(workerGeneration)) {
    throw new Error("Aperture worker generation was invalid");
  }
  if (!Number.isSafeInteger(maximumClients) || maximumClients < 1) {
    throw new Error("Aperture direct client limit was invalid");
  }
  if (!Number.isSafeInteger(maximumReceipts) || maximumReceipts < 1) {
    throw new Error("Aperture direct receipt limit was invalid");
  }
  if (options.probe) await prepareSocketPath(options.socketPath, uid, options.probe);
  else await prepareSocketPath(options.socketPath, uid);

  const clients = new Set<Socket>();
  const activeOperations = new Set<AbortController>();
  const attentionReceipts = new DirectReceiptLedger(maximumReceipts);
  let closing = false;
  const server = createServer((socket) => {
    if (closing || clients.size >= maximumClients) {
      socket.destroy();
      return;
    }
    clients.add(socket);
    void handleConnection(
      socket,
      options,
      diagnostic,
      activeOperations,
      attentionReceipts,
      workerGeneration,
    ).finally(() => {
      clients.delete(socket);
    });
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
      attentionReceipts.clear();
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
  attentionReceipts: DirectReceiptLedger,
  workerGeneration: string,
): Promise<void> {
  socket.setTimeout(CONNECTION_TIMEOUT_MS);
  let buffer = Buffer.alloc(0);
  let reading = true;

  const stopReading = (): boolean => {
    if (!reading) return false;
    reading = false;
    socket.setTimeout(0);
    socket.off("timeout", rejectConnection);
    socket.off("data", acceptData);
    socket.off("end", acceptEnd);
    socket.pause();
    return true;
  };
  const respond = (response: Record<string, unknown>): void => {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(response)}\n`, () => socket.destroy());
  };
  const rejectConnection = (): void => {
    if (!stopReading()) return;
    respond({ schemaVersion: 4, status: "rejected" });
  };
  const acceptData = (chunk: Buffer): void => {
    if (!reading) return;
    if (buffer.byteLength + chunk.byteLength > WORKER_DIRECT_LIMITS.jsonLineBytes) {
      rejectConnection();
      return;
    }
    buffer = Buffer.concat([buffer, chunk]);
    const newline = buffer.indexOf(0x0a);
    if (newline === -1) return;
    const line = buffer.subarray(0, newline).toString("utf8");
    const trailing = buffer.subarray(newline + 1).toString("utf8");
    if (!stopReading()) return;
    if (trailing.trim()) {
      respond({ schemaVersion: 4, status: "rejected" });
      return;
    }
    void processLine(line);
  };
  const acceptEnd = (): void => {
    if (!reading) return;
    if (buffer.byteLength === 0) {
      stopReading();
      socket.destroy();
      return;
    }
    const line = buffer.toString("utf8");
    if (!stopReading()) return;
    void processLine(line);
  };

  socket.once("timeout", rejectConnection);
  socket.once("error", () => undefined);
  socket.on("data", acceptData);
  socket.once("end", acceptEnd);

  const processLine = async (line: string): Promise<void> => {
    let message: WorkerDirectMessage;
    try {
      message = parseWorkerDirectMessage(line);
    } catch {
      diagnostic.write("Aperture rejected an invalid direct OMP event\n");
      respond({ schemaVersion: 4, status: "rejected" });
      return;
    }

    const execute = () => executeMessage(message, options, activeOperations, workerGeneration);
    const acknowledgement =
      message.type === "omp.attention-event"
        ? await attentionReceipts.execute(message, execute)
        : await execute();
    respond(acknowledgement);
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
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error("Aperture direct message processing timed out");
    throw error;
  } finally {
    activeOperations.delete(controller);
    clearTimeout(timer);
  }
}

async function executeMessage(
  message: WorkerDirectMessage,
  options: Pick<
    OmpAttentionSocketServerOptions,
    "handleAttention" | "registerFocus" | "revokeFocus"
  >,
  activeOperations: Set<AbortController>,
  workerGeneration: string,
): Promise<WorkerDirectAcknowledgement> {
  try {
    const recovery = await withDeadline(
      async (signal) =>
        message.type === "omp.attention-event"
          ? options.handleAttention(message, signal).then(() => undefined)
          : message.type === "focus.register"
            ? options.registerFocus(message, signal)
            : Promise.resolve(options.revokeFocus(message, signal)).then(() => undefined),
      message.type === "omp.attention-event"
        ? ATTENTION_PROCESSING_TIMEOUT_MS
        : FOCUS_PROCESSING_TIMEOUT_MS,
      activeOperations,
    );
    return {
      schemaVersion: 4,
      status: "accepted",
      requestId: directMessageRequestId(message),
      ...(message.type === "focus.register" && recovery ? { recovery } : {}),
      ...(message.type === "focus.register" ? { workerGeneration } : {}),
    };
  } catch (error) {
    if (message.type === "focus.register" && error instanceof FocusRegistrationError) {
      return {
        schemaVersion: 4,
        status: "rejected",
        requestId: message.requestId,
        code: error.code,
      };
    }
    const code =
      error instanceof Error && error.message === "Aperture attention engine failed"
        ? "attention_engine_failed"
        : error instanceof Error && error.message === "Aperture attention snapshot failed"
          ? "attention_snapshot_failed"
          : error instanceof Error &&
              error.message === "Aperture direct message processing timed out"
            ? "processing_timeout"
            : "processing_failed";
    return {
      schemaVersion: 4,
      status: "rejected",
      requestId: directMessageRequestId(message),
      code,
    };
  }
}
