import {
  ApertureRuntimeClient,
  ApertureRuntimeRequestError,
  discoverLocalRuntimes,
  type ApertureLocalRuntimeRegistration,
  type ApertureRuntimeClientOptions,
  type ApertureRuntimeSnapshot,
} from "@aperture/runtime";

import type { ApertureSurfaceMessage } from "./protocol.js";
import { projectSurfaceSnapshot } from "./projection.js";

export type ApertureSurfaceRuntimeClient = {
  getSnapshot(): ApertureRuntimeSnapshot;
  subscribeSnapshot(listener: (snapshot: ApertureRuntimeSnapshot) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  close(): Promise<void>;
};

export type ApertureSurfaceSessionDependencies = {
  discover(): Promise<ApertureLocalRuntimeRegistration[]>;
  connect(options: ApertureRuntimeClientOptions): Promise<ApertureSurfaceRuntimeClient>;
  delay(milliseconds: number, signal: AbortSignal): Promise<void>;
};

export type ApertureSurfaceSessionOptions = {
  label: string;
  signal: AbortSignal;
  emit(message: ApertureSurfaceMessage): Promise<void>;
  diagnostic?(code: string, error: unknown): void;
  dependencies?: Partial<ApertureSurfaceSessionDependencies>;
};

const INITIAL_RECONNECT_DELAY_MS = 250;
const MAX_RECONNECT_DELAY_MS = 5_000;

const defaultDependencies: ApertureSurfaceSessionDependencies = {
  discover: () => discoverLocalRuntimes({ kind: "aperture" }),
  connect: (options) => ApertureRuntimeClient.connect(options),
  delay: delayWithAbort,
};

const ERROR_MESSAGE_BY_CODE: Record<string, string> = {
  runtime_discovery_failed: "Aperture could not discover a local runtime.",
  runtime_connection_failed: "Aperture could not connect to the selected runtime.",
  surface_projection_failed: "Aperture could not produce a bounded surface snapshot.",
};

export async function runApertureSurfaceSession(
  options: ApertureSurfaceSessionOptions,
): Promise<void> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  let snapshotSequence = 0;
  let emission = Promise.resolve();

  const enqueue = (message: ApertureSurfaceMessage) => {
    emission = emission.then(() => options.emit(message));
    return emission;
  };

  while (!options.signal.aborted) {
    await enqueue({ type: "connection", state: "connecting" });

    let registrations: ApertureLocalRuntimeRegistration[];
    try {
      registrations = await dependencies.discover();
    } catch (error) {
      options.diagnostic?.("runtime_discovery_failed", error);
      await enqueue(surfaceError("runtime_discovery_failed"));
      await enqueue({ type: "connection", state: "disconnected", reason: "connection_failed" });
      await dependencies.delay(reconnectDelayMs, options.signal);
      reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * 2);
      continue;
    }

    const registration = registrations[0];
    if (!registration) {
      await enqueue({
        type: "connection",
        state: "disconnected",
        reason: "runtime_unavailable",
      });
      await dependencies.delay(reconnectDelayMs, options.signal);
      reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * 2);
      continue;
    }

    let client: ApertureSurfaceRuntimeClient | null = null;
    try {
      client = await dependencies.connect({
        baseUrl: registration.controlUrl,
        label: options.label,
        surfaceRole: "companion",
      });
      reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      await enqueue({
        type: "connection",
        state: "connected",
        runtimeId: registration.id,
        runtimeKind: registration.kind,
      });

      let lastProjection = "";
      let resolveDisconnect: ((error: Error | null) => void) | null = null;
      const disconnected = new Promise<Error | null>((resolve) => {
        resolveDisconnect = resolve;
      });
      const disconnect = (error: Error | null) => {
        if (!resolveDisconnect) {
          return;
        }
        const resolve = resolveDisconnect;
        resolveDisconnect = null;
        resolve(error);
      };
      const stop = () => disconnect(null);
      options.signal.addEventListener("abort", stop, { once: true });
      const unsubscribeError = client.onError((error) => disconnect(error));
      const unsubscribeSnapshot = client.subscribeSnapshot((snapshot) => {
        try {
          const projected = projectSurfaceSnapshot(snapshot, snapshotSequence + 1);
          const fingerprint = JSON.stringify({ sources: projected.sources, view: projected.view });
          if (fingerprint === lastProjection) {
            return;
          }
          lastProjection = fingerprint;
          snapshotSequence += 1;
          void enqueue({ ...projected, sequence: snapshotSequence }).catch((error) => {
            disconnect(error instanceof Error ? error : new Error(String(error)));
          });
        } catch (error) {
          options.diagnostic?.("surface_projection_failed", error);
          void enqueue(surfaceError("surface_projection_failed")).catch((outputError) => {
            disconnect(outputError instanceof Error ? outputError : new Error(String(outputError)));
          });
        }
      });

      const failure = await disconnected;
      unsubscribeSnapshot();
      unsubscribeError();
      options.signal.removeEventListener("abort", stop);
      await emission;

      if (failure && !options.signal.aborted) {
        await enqueue({
          type: "connection",
          state: "disconnected",
          reason: connectionFailureReason(failure),
        });
      }
    } catch (error) {
      if (!options.signal.aborted) {
        options.diagnostic?.("runtime_connection_failed", error);
        await enqueue(surfaceError("runtime_connection_failed"));
        await enqueue({
          type: "connection",
          state: "disconnected",
          reason: connectionFailureReason(error),
        });
      }
    } finally {
      await client?.close();
    }

    if (!options.signal.aborted) {
      await dependencies.delay(reconnectDelayMs, options.signal);
      reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * 2);
    }
  }

  await emission;
}

function connectionFailureReason(error: unknown): "authentication_failed" | "connection_failed" {
  return error instanceof ApertureRuntimeRequestError &&
    (error.status === 401 || error.status === 403)
    ? "authentication_failed"
    : "connection_failed";
}

function surfaceError(code: string): ApertureSurfaceMessage {
  return {
    type: "error",
    code,
    message: ERROR_MESSAGE_BY_CODE[code] ?? "Aperture surface operation failed.",
    recoverable: true,
  };
}

async function delayWithAbort(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}
