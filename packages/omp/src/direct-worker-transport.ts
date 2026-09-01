import { createConnection } from "node:net";

import {
  directMessageRequestId,
  parseOmpDirectAcknowledgement,
  serializeOmpDirectMessage,
  type OmpDirectMessage,
  type OmpFocusRegistration,
  type OmpFocusRevocation,
} from "@tomismeta/aperture/omp-direct-message";
import { resolveOmpAttentionSocketPath } from "@tomismeta/aperture/omp-attention-event";

const CONNECT_TIMEOUT_MS = 75;
const RESPONSE_TIMEOUT_MS = 200;
const MAXIMUM_RESPONSE_BYTES = 4 * 1024;

export type OmpDirectWorkerTransportOptions = {
  socketPath?: string;
  environment?: NodeJS.ProcessEnv;
  connect?: typeof createConnection;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
};

export class OmpDirectWorkerTransport {
  private readonly socketPath: string | undefined;
  private readonly connect: typeof createConnection;
  private readonly connectTimeoutMs: number;
  private readonly responseTimeoutMs: number;

  constructor(options: OmpDirectWorkerTransportOptions = {}) {
    this.socketPath =
      options.socketPath ?? resolveOmpAttentionSocketPath(options.environment ?? process.env);
    this.connect = options.connect ?? createConnection;
    this.connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.responseTimeoutMs = options.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS;
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

  async send(message: OmpDirectMessage): Promise<void> {
    if (!this.socketPath) throw new Error("Aperture worker socket is unavailable");
    const line = serializeOmpDirectMessage(message);
    const requestId = directMessageRequestId(message);
    await new Promise<void>((resolve, reject) => {
      const socket = this.connect({ path: this.socketPath! });
      let settled = false;
      let response = Buffer.alloc(0);
      let responseTimer: NodeJS.Timeout | undefined;
      const connectTimer = setTimeout(
        () => finish(new Error("Aperture worker socket connection timed out")),
        this.connectTimeoutMs,
      );

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        clearTimeout(responseTimer);
        socket.removeAllListeners();
        socket.destroy();
        if (error) reject(error);
        else resolve();
      };

      socket.once("connect", () => {
        clearTimeout(connectTimer);
        responseTimer = setTimeout(
          () => finish(new Error("Aperture worker socket response timed out")),
          this.responseTimeoutMs,
        );
        socket.write(line, "utf8", (error) => {
          if (error) finish(new Error("Aperture worker socket write failed"));
        });
      });
      socket.on("data", (chunk: Buffer) => {
        if (response.byteLength + chunk.byteLength > MAXIMUM_RESPONSE_BYTES) {
          finish(new Error("Aperture worker socket response exceeded the byte limit"));
          return;
        }
        response = Buffer.concat([response, chunk]);
        const newline = response.indexOf(0x0a);
        if (newline === -1) return;
        try {
          const acknowledgement = parseOmpDirectAcknowledgement(
            response.subarray(0, newline).toString("utf8"),
          );
          if (acknowledgement.requestId !== requestId) {
            finish(new Error("Aperture worker acknowledgement identity mismatch"));
            return;
          }
          finish();
        } catch {
          finish(new Error("Aperture worker acknowledgement was invalid"));
        }
      });
      socket.once("error", () => finish(new Error("Aperture worker socket delivery failed")));
      socket.once("close", () => {
        if (!settled) finish(new Error("Aperture worker socket closed before acknowledgement"));
      });
    });
  }
  async registerFocus(registration: OmpFocusRegistration): Promise<void> {
    await this.send(registration);
  }

  async revokeFocus(revocation: OmpFocusRevocation): Promise<void> {
    await this.send(revocation);
  }

  async close(): Promise<void> {}
}
