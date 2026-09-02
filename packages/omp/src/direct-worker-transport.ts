import { createConnection } from "node:net";

import { FocusControlRejectedError } from "@tomismeta/aperture/focus-host";
import {
  directMessageRequestId,
  parseWorkerDirectAcknowledgement,
  serializeWorkerDirectMessage,
  type FocusRecovery,
  type FocusRegistration,
  type FocusRevocation,
  type WorkerDirectAcknowledgement,
  type WorkerDirectMessage,
} from "@tomismeta/aperture/worker-direct-message";
import { resolveOmpAttentionSocketPath } from "@tomismeta/aperture/omp-attention-event";

const CONNECT_TIMEOUT_MS = 75;
const RESPONSE_TIMEOUT_MS = 200;
const FOCUS_REGISTRATION_RESPONSE_TIMEOUT_MS = 2_000;
const MAXIMUM_RESPONSE_BYTES = 4 * 1024;

export type OmpDirectWorkerTransportOptions = {
  socketPath?: string;
  environment?: NodeJS.ProcessEnv;
  connect?: typeof createConnection;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  focusRegistrationResponseTimeoutMs?: number;
};

export class OmpDirectWorkerTransport {
  private readonly socketPath: string | undefined;
  private readonly connect: typeof createConnection;
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;
  private readonly focusRegistrationResponseTimeoutMs: number;

  constructor(options: OmpDirectWorkerTransportOptions = {}) {
    this.socketPath =
      options.socketPath ?? resolveOmpAttentionSocketPath(options.environment ?? process.env);
    this.connect = options.connect ?? createConnection;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.responseTimeoutMs = options.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS;
    this.focusRegistrationResponseTimeoutMs =
      options.focusRegistrationResponseTimeoutMs ?? FOCUS_REGISTRATION_RESPONSE_TIMEOUT_MS;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.socketPath) return false;
    return new Promise<boolean>((resolve) => {
      const socket = this.connect({ path: this.socketPath! });
      const timeout = setTimeout(() => finish(false), this.connectTimeoutMs);
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

  async send(
    message: WorkerDirectMessage,
    responseTimeoutMs = this.responseTimeoutMs,
  ): Promise<WorkerDirectAcknowledgement> {
    if (!this.socketPath) throw new Error("Aperture worker socket is unavailable");
    const line = serializeWorkerDirectMessage(message);
    const requestId = directMessageRequestId(message);
    return new Promise<WorkerDirectAcknowledgement>((resolve, reject) => {
      const socket = this.connect({ path: this.socketPath! });
      let settled = false;
      let response = Buffer.alloc(0);
      let responseTimer: NodeJS.Timeout | undefined;
      const connectTimer = setTimeout(
        () => finish(undefined, new Error("Aperture worker socket connection timed out")),
        this.connectTimeoutMs,
      );

      const finish = (acknowledgement?: WorkerDirectAcknowledgement, error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(responseTimer);
        socket.removeAllListeners();
        socket.destroy();
        if (error) reject(error);
        else if (acknowledgement) resolve(acknowledgement);
        else reject(new Error("Aperture worker acknowledgement was missing"));
      };

      socket.once("connect", () => {
        clearTimeout(connectTimer);
        responseTimer = setTimeout(
          () => finish(undefined, new Error("Aperture worker socket response timed out")),
          responseTimeoutMs,
        );
        socket.write(line, "utf8", (error) => {
          if (error) finish(undefined, new Error("Aperture worker socket write failed"));
        });
      });
      socket.on("data", (chunk: Buffer) => {
        if (response.byteLength + chunk.byteLength > MAXIMUM_RESPONSE_BYTES) {
          finish(undefined, new Error("Aperture worker socket response exceeded the byte limit"));
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
            finish(undefined, new Error("Aperture worker acknowledgement identity mismatch"));
            return;
          }
          if (acknowledgement.status === "rejected") {
            finish(undefined, new FocusControlRejectedError(acknowledgement.code));
            return;
          }
          finish(acknowledgement);
        } catch (error) {
          if (error instanceof FocusControlRejectedError) finish(undefined, error);
          else finish(undefined, new Error("Aperture worker acknowledgement was invalid"));
        }
      });
      socket.once("error", () =>
        finish(undefined, new Error("Aperture worker socket delivery failed")),
      );
      socket.once("close", () => {
        if (!settled) {
          finish(undefined, new Error("Aperture worker socket closed before acknowledgement"));
        }
      });
    });
  }

  async registerFocus(registration: FocusRegistration): Promise<FocusRecovery | undefined> {
    const acknowledgement = await this.send(registration, this.focusRegistrationResponseTimeoutMs);
    if (acknowledgement.status !== "accepted") return undefined;
    const recovery = acknowledgement.recovery;
    if (registration.target.kind === "direct-terminal") {
      if (recovery !== undefined) {
        throw new Error("Aperture worker returned unexpected direct-terminal recovery");
      }
      return undefined;
    }
    if (!recovery || recovery.kind !== registration.target.kind) {
      throw new Error("Aperture worker returned incomplete focus recovery");
    }
    return recovery;
  }

  async revokeFocus(revocation: FocusRevocation): Promise<void> {
    await this.send(revocation, this.focusRegistrationResponseTimeoutMs);
  }

  async close(): Promise<void> {}
}
