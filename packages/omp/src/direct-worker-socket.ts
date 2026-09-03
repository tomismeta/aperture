import { createConnection } from "node:net";

import {
  directMessageRequestId,
  parseWorkerDirectAcknowledgement,
  serializeWorkerDirectMessage,
  WorkerDirectRejectedError,
  type WorkerDirectAcknowledgement,
  type WorkerDirectMessage,
} from "@tomismeta/aperture/worker-direct-message";

const MAXIMUM_RESPONSE_BYTES = 4 * 1024;

export type DirectSocketConnector = typeof createConnection;
export type OmpDirectDeliveryDisposition = "definitely-not-accepted" | "acceptance-unknown";

export class OmpDirectDeliveryError extends Error {
  constructor(
    readonly disposition: OmpDirectDeliveryDisposition,
    message: string,
  ) {
    super(message);
    this.name = "OmpDirectDeliveryError";
  }
}

export function ompDirectDeliveryDisposition(
  error: unknown,
): OmpDirectDeliveryDisposition | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { name?: unknown; disposition?: unknown };
  if (
    candidate.name !== "OmpDirectDeliveryError" ||
    (candidate.disposition !== "definitely-not-accepted" &&
      candidate.disposition !== "acceptance-unknown")
  ) {
    return undefined;
  }
  return candidate.disposition;
}

export async function probeDirectWorkerSocket(
  socketPath: string,
  connect: DirectSocketConnector,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ path: socketPath });
    const timeout = setTimeout(() => finish(false), timeoutMs);
    const finish = (available: boolean): void => {
      clearTimeout(timeout);
      socket.removeAllListeners();
      socket.destroy();
      resolve(available);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export async function sendDirectWorkerMessage(options: {
  socketPath: string;
  connect: DirectSocketConnector;
  connectTimeoutMs: number;
  responseTimeoutMs: number;
  message: WorkerDirectMessage;
  signal?: AbortSignal;
}): Promise<WorkerDirectAcknowledgement> {
  if (options.signal?.aborted) {
    throw new OmpDirectDeliveryError(
      "definitely-not-accepted",
      "Aperture worker delivery was aborted",
    );
  }
  const line = serializeWorkerDirectMessage(options.message);
  const requestId = directMessageRequestId(options.message);
  return new Promise<WorkerDirectAcknowledgement>((resolve, reject) => {
    const socket = options.connect({ path: options.socketPath });
    let settled = false;
    let response = Buffer.alloc(0);
    let responseTimer: NodeJS.Timeout | undefined;
    let writeStarted = false;
    const connectTimer = setTimeout(
      () =>
        finish(
          undefined,
          new OmpDirectDeliveryError(
            "definitely-not-accepted",
            "Aperture worker socket connection timed out",
          ),
        ),
      options.connectTimeoutMs,
    );

    const finish = (acknowledgement?: WorkerDirectAcknowledgement, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      options.signal?.removeEventListener("abort", abortDelivery);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else if (acknowledgement) resolve(acknowledgement);
      else reject(new Error("Aperture worker acknowledgement was missing"));
    };

    const abortDelivery = (): void => {
      finish(
        undefined,
        new OmpDirectDeliveryError(
          writeStarted ? "acceptance-unknown" : "definitely-not-accepted",
          "Aperture worker delivery was aborted",
        ),
      );
    };
    options.signal?.addEventListener("abort", abortDelivery, { once: true });
    socket.once("connect", () => {
      clearTimeout(connectTimer);
      responseTimer = setTimeout(
        () =>
          finish(
            undefined,
            new OmpDirectDeliveryError(
              "acceptance-unknown",
              "Aperture worker socket response timed out",
            ),
          ),
        options.responseTimeoutMs,
      );
      writeStarted = true;
      socket.write(line, "utf8", (error) => {
        if (error) {
          finish(
            undefined,
            new OmpDirectDeliveryError("acceptance-unknown", "Aperture worker socket write failed"),
          );
        }
      });
    });
    socket.on("data", (chunk: Buffer) => {
      if (response.byteLength + chunk.byteLength > MAXIMUM_RESPONSE_BYTES) {
        finish(
          undefined,
          new OmpDirectDeliveryError(
            "acceptance-unknown",
            "Aperture worker socket response exceeded the byte limit",
          ),
        );
        return;
      }
      response = Buffer.concat([response, chunk]);
      const newline = response.indexOf(0x0a);
      if (newline === -1) return;
      try {
        const acknowledgement = parseWorkerDirectAcknowledgement(
          response.subarray(0, newline).toString("utf8"),
        );
        if (acknowledgement.requestId !== requestId) {
          finish(
            undefined,
            new OmpDirectDeliveryError(
              "acceptance-unknown",
              "Aperture worker acknowledgement identity mismatch",
            ),
          );
          return;
        }
        if (acknowledgement.status === "rejected") {
          finish(undefined, new WorkerDirectRejectedError(acknowledgement.code));
          return;
        }
        finish(acknowledgement);
      } catch (error) {
        if (error instanceof WorkerDirectRejectedError) {
          finish(undefined, error);
          return;
        }
        finish(
          undefined,
          new OmpDirectDeliveryError(
            "acceptance-unknown",
            "Aperture worker acknowledgement was invalid",
          ),
        );
      }
    });
    socket.once("error", () =>
      finish(
        undefined,
        new OmpDirectDeliveryError(
          writeStarted ? "acceptance-unknown" : "definitely-not-accepted",
          "Aperture worker socket delivery failed",
        ),
      ),
    );
    socket.once("close", () => {
      if (!settled) {
        finish(
          undefined,
          new OmpDirectDeliveryError(
            writeStarted ? "acceptance-unknown" : "definitely-not-accepted",
            "Aperture worker socket closed before acknowledgement",
          ),
        );
      }
    });
  });
}
