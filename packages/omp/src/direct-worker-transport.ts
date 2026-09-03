import { createConnection } from "node:net";

import type {
  FocusRegistration,
  FocusRegistrationResult,
  FocusRevocation,
  WorkerDirectAcknowledgement,
  WorkerDirectMessage,
} from "@tomismeta/aperture/worker-direct-message";
import { resolveOmpAttentionSocketPath } from "@tomismeta/aperture/omp-attention-event";
import {
  OmpDirectDeliveryError,
  probeDirectWorkerSocket,
  sendDirectWorkerMessage,
  type DirectSocketConnector,
} from "./direct-worker-socket.js";
import { focusRegistrationResult } from "./focus-registration-response.js";

export {
  OmpDirectDeliveryError,
  ompDirectDeliveryDisposition,
  type OmpDirectDeliveryDisposition,
} from "./direct-worker-socket.js";

const CONNECT_TIMEOUT_MS = 75;
const RESPONSE_TIMEOUT_MS = 1_000;
const FOCUS_REGISTRATION_RESPONSE_TIMEOUT_MS = 2_000;

export type OmpDirectWorkerTransportOptions = {
  socketPath?: string;
  environment?: NodeJS.ProcessEnv;
  connect?: DirectSocketConnector;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  focusRegistrationResponseTimeoutMs?: number;
};

export class OmpDirectWorkerTransport {
  private readonly socketPath: string | undefined;
  private readonly connect: DirectSocketConnector;
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
    return probeDirectWorkerSocket(this.socketPath, this.connect, this.connectTimeoutMs);
  }

  async send(
    message: WorkerDirectMessage,
    responseTimeoutMs = this.responseTimeoutMs,
    signal?: AbortSignal,
  ): Promise<WorkerDirectAcknowledgement> {
    if (!this.socketPath) {
      throw new OmpDirectDeliveryError(
        "definitely-not-accepted",
        "Aperture worker socket is unavailable",
      );
    }
    return sendDirectWorkerMessage({
      socketPath: this.socketPath,
      connect: this.connect,
      connectTimeoutMs: this.connectTimeoutMs,
      responseTimeoutMs,
      message,
      ...(signal ? { signal } : {}),
    });
  }

  async registerFocus(registration: FocusRegistration): Promise<FocusRegistrationResult> {
    const acknowledgement = await this.send(registration, this.focusRegistrationResponseTimeoutMs);
    return focusRegistrationResult(registration, acknowledgement);
  }

  async revokeFocus(revocation: FocusRevocation): Promise<void> {
    await this.send(revocation, this.focusRegistrationResponseTimeoutMs);
  }

  async close(): Promise<void> {}
}
