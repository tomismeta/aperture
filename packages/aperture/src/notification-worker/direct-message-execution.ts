import {
  WORKER_DIRECT_PROTOCOL_VERSION,
  directMessageRequestId,
  type WorkerDirectAcknowledgement,
  type WorkerDirectMessage,
} from "../worker-direct-message.js";
import type { OmpAttentionSocketServerOptions } from "./direct-server.js";
import { FocusRegistrationError } from "./focus/types.js";
import { OmpSessionCapacityError } from "./session-liveness.js";

const FOCUS_PROCESSING_TIMEOUT_MS = 2_250;

type DirectMessageHandlers = Pick<
  OmpAttentionSocketServerOptions,
  "handleAttention" | "registerFocus" | "revokeFocus" | "heartbeatSession"
>;

export async function executeDirectMessage(
  message: WorkerDirectMessage,
  options: DirectMessageHandlers,
  activeOperations: Set<AbortController>,
  workerGeneration: string,
): Promise<WorkerDirectAcknowledgement> {
  try {
    const operation = async (signal: AbortSignal) => {
      if (message.type === "omp.attention-event") {
        await options.handleAttention(message, signal);
        return undefined;
      }
      if (message.type === "omp.session-heartbeat") {
        if (!options.heartbeatSession) {
          throw new Error("Aperture session heartbeat is unavailable");
        }
        await options.heartbeatSession(message, signal);
        return undefined;
      }
      if (message.type === "focus.register") {
        return options.registerFocus(message, signal);
      }
      await options.revokeFocus(message, signal);
      return undefined;
    };
    const recovery =
      message.type === "focus.register" || message.type === "focus.revoke"
        ? await withDeadline(operation, FOCUS_PROCESSING_TIMEOUT_MS, activeOperations)
        : await withAbort(operation, activeOperations);
    return {
      schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
      status: "accepted",
      requestId: directMessageRequestId(message),
      ...(message.type === "focus.register" && recovery ? { recovery } : {}),
      ...(message.type === "focus.register" ? { workerGeneration } : {}),
    };
  } catch (error) {
    if (error instanceof OmpSessionCapacityError) {
      return {
        schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
        status: "rejected",
        requestId: directMessageRequestId(message),
        code: "capacity",
      };
    }
    if (message.type === "focus.register" && error instanceof FocusRegistrationError) {
      return {
        schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
        status: "rejected",
        requestId: message.requestId,
        code: error.code,
      };
    }
    const code =
      error instanceof Error && error.message === "Aperture attention engine failed"
        ? "attention_engine_failed"
        : error instanceof Error && error.message === "Aperture direct message processing timed out"
          ? "processing_timeout"
          : "processing_failed";
    return {
      schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
      status: "rejected",
      requestId: directMessageRequestId(message),
      code,
    };
  }
}

async function withAbort<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  activeOperations: Set<AbortController>,
): Promise<T> {
  const controller = new AbortController();
  activeOperations.add(controller);
  try {
    return await operation(controller.signal);
  } finally {
    activeOperations.delete(controller);
  }
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  activeOperations: Set<AbortController>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutError = new Error("Aperture direct message processing timed out");
  activeOperations.add(controller);
  let operationSettled = false;
  const pending = Promise.resolve()
    .then(() => operation(controller.signal))
    .finally(() => {
      operationSettled = true;
      activeOperations.delete(controller);
    });
  let timer!: NodeJS.Timeout;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
    timer.unref();
  });
  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
    if (!operationSettled) void pending.catch(() => undefined);
  }
}
