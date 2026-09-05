import { randomBytes } from "node:crypto";
import { createServer, type Socket } from "node:net";
import type { Writable } from "node:stream";

import {
  WORKER_DIRECT_LIMITS,
  WORKER_DIRECT_PROTOCOL_VERSION,
  parseWorkerDirectMessage,
  type FocusRecovery,
  type FocusRegistration,
  type FocusRevocation,
  type OmpSessionHeartbeat,
  type WorkerDirectMessage,
} from "../worker-direct-message.js";
import type { OmpAttentionEvent } from "../omp-attention-event.js";
import { DirectReceiptLedger } from "./direct-receipt-ledger.js";
import { executeDirectMessage } from "./direct-message-execution.js";
import { FOCUS_LIMITS } from "./focus/types.js";
import {
  closeOwnedSocketServer,
  currentUid,
  listenOnOwnedSocket,
} from "./direct-socket-lifecycle.js";

const CONNECTION_TIMEOUT_MS = 500;

export type OmpAttentionSocketServerOptions = {
  socketPath: string;
  handleAttention: (event: OmpAttentionEvent, signal: AbortSignal) => Promise<void>;
  registerFocus: (
    registration: FocusRegistration,
    signal: AbortSignal,
  ) => Promise<FocusRecovery | undefined>;
  revokeFocus: (revocation: FocusRevocation, signal: AbortSignal) => Promise<void> | void;
  heartbeatSession?: (heartbeat: OmpSessionHeartbeat, signal: AbortSignal) => Promise<void> | void;
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
  const probe = options.probe;

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
  const socketIdentity = probe
    ? await listenOnOwnedSocket(server, options.socketPath, uid, probe)
    : await listenOnOwnedSocket(server, options.socketPath, uid);

  return {
    path: options.socketPath,
    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      for (const client of clients) client.destroy();
      for (const operation of activeOperations) operation.abort();
      await closeOwnedSocketServer(
        server,
        options.socketPath,
        uid,
        socketIdentity,
        shutdownTimeoutMs,
      );
      attentionReceipts.clear();
    },
  };
}

async function handleConnection(
  socket: Socket,
  options: Pick<
    OmpAttentionSocketServerOptions,
    "handleAttention" | "registerFocus" | "revokeFocus" | "heartbeatSession"
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
    respond({ schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION, status: "rejected" });
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
      respond({ schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION, status: "rejected" });
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
      respond({ schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION, status: "rejected" });
      return;
    }

    const execute = () =>
      executeDirectMessage(message, options, activeOperations, workerGeneration);
    const acknowledgement =
      message.type === "omp.attention-event"
        ? await attentionReceipts.execute(message, execute)
        : await execute();
    respond(acknowledgement);
  };

  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
}
