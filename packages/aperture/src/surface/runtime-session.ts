import {
  ApertureRuntimeClient,
  ApertureRuntimeRequestError,
  discoverLocalRuntimes,
  type ApertureLocalRuntimeRegistration,
  type ApertureRuntimeClientOptions,
  type ApertureRuntimeSnapshot,
} from "@aperture/runtime";

import {
  APERTURE_STDIO_CAPABILITIES,
  APERTURE_SURFACE_LIMITS,
  type ApertureSurfaceMessage,
} from "./protocol.js";
import { projectSurfaceIdentifier, projectSurfaceSnapshot } from "./projection.js";

export type ApertureSurfaceRuntimeClient = {
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
const STABLE_CONNECTION_MS = 30_000;
const MAX_PENDING_CONTROL_MESSAGES = 16;

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
  const emissions = createSurfaceEmissionQueue(options.emit);
  let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  let snapshotSequence = 0;

  while (!options.signal.aborted) {
    await emissions.enqueue({ type: "connection", state: "connecting" });
    if (options.signal.aborted) break;

    let registrations: ApertureLocalRuntimeRegistration[];
    try {
      registrations = await abortable(dependencies.discover(), options.signal);
    } catch (error) {
      if (options.signal.aborted) break;
      options.diagnostic?.("runtime_discovery_failed", error);
      await emissions.enqueue(surfaceError("runtime_discovery_failed"));
      await emissions.enqueue({
        type: "connection",
        state: "disconnected",
        reason: "connection_failed",
      });
      await dependencies.delay(reconnectDelayMs, options.signal);
      reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * 2);
      continue;
    }

    const registration = selectRuntime(registrations);
    if (!registration) {
      await emissions.enqueue({
        type: "connection",
        state: "disconnected",
        reason: "runtime_unavailable",
      });
      await dependencies.delay(reconnectDelayMs, options.signal);
      reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * 2);
      continue;
    }

    let client: ApertureSurfaceRuntimeClient | null = null;
    let connectedAt: number | null = null;
    try {
      client = await connectWithAbort(
        dependencies.connect,
        {
          baseUrl: registration.controlUrl,
          label: options.label,
          surfaceRole: "companion",
          acceptsResponses: APERTURE_STDIO_CAPABILITIES.responses,
          signal: options.signal,
        },
        options.signal,
      );

      let resolveDisconnect: ((error: Error | null) => void) | null = null;
      let didDisconnect = false;
      const disconnected = new Promise<Error | null>((resolve) => {
        resolveDisconnect = resolve;
      });
      const disconnect = (error: Error | null) => {
        if (!resolveDisconnect) return;
        didDisconnect = true;
        const resolve = resolveDisconnect;
        resolveDisconnect = null;
        resolve(error);
      };
      const stop = () => disconnect(null);
      if (options.signal.aborted) {
        stop();
      } else {
        options.signal.addEventListener("abort", stop, { once: true });
      }

      const unsubscribeError = client.onError(disconnect);
      let unsubscribeSnapshot = () => {};
      try {
        if (!didDisconnect) {
          await emissions.enqueue({
            type: "connection",
            state: "connected",
            runtimeId: projectSurfaceIdentifier(
              registration.id,
              APERTURE_SURFACE_LIMITS.id,
              "runtime id",
            ),
            runtimeKind: projectSurfaceIdentifier(
              registration.kind,
              APERTURE_SURFACE_LIMITS.kind,
              "runtime kind",
            ),
          });
        }

        if (!didDisconnect && !options.signal.aborted) {
          connectedAt = Date.now();
          let lastProjection = "";
          let projectionFailed = false;
          unsubscribeSnapshot = client.subscribeSnapshot((snapshot) => {
            if (didDisconnect) return;
            try {
              const projected = projectSurfaceSnapshot(snapshot, snapshotSequence + 1);
              const fingerprint = JSON.stringify({
                sources: projected.sources,
                totals: projected.totals,
                view: projected.view,
              });
              if (!projectionFailed && fingerprint === lastProjection) return;

              projectionFailed = false;
              lastProjection = fingerprint;
              snapshotSequence += 1;
              void emissions
                .enqueue({ ...projected, sequence: snapshotSequence })
                .catch((error) =>
                  disconnect(error instanceof Error ? error : new Error(String(error))),
                );
            } catch (error) {
              lastProjection = "";
              if (projectionFailed) return;
              projectionFailed = true;
              options.diagnostic?.("surface_projection_failed", error);
              void emissions
                .enqueue(surfaceError("surface_projection_failed"))
                .catch((outputError) =>
                  disconnect(
                    outputError instanceof Error ? outputError : new Error(String(outputError)),
                  ),
                );
            }
          });
        }

        const failure = await disconnected;
        unsubscribeSnapshot();
        unsubscribeSnapshot = () => {};
        await emissions.flush();

        if (failure && !options.signal.aborted) {
          await emissions.enqueue({
            type: "connection",
            state: "disconnected",
            reason: connectionFailureReason(failure),
          });
        }
      } finally {
        unsubscribeSnapshot();
        unsubscribeError();
        options.signal.removeEventListener("abort", stop);
      }
    } catch (error) {
      if (!options.signal.aborted) {
        options.diagnostic?.("runtime_connection_failed", error);
        await emissions.enqueue(surfaceError("runtime_connection_failed"));
        await emissions.enqueue({
          type: "connection",
          state: "disconnected",
          reason: connectionFailureReason(error),
        });
      }
    } finally {
      await client?.close();
    }

    if (!options.signal.aborted) {
      if (connectedAt !== null && Date.now() - connectedAt >= STABLE_CONNECTION_MS) {
        reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      }
      await dependencies.delay(reconnectDelayMs, options.signal);
      reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * 2);
    }
  }

  if (!options.signal.aborted) {
    await emissions.flush();
  }
}

type SurfaceEmissionQueue = {
  enqueue(message: ApertureSurfaceMessage): Promise<void>;
  flush(): Promise<void>;
};

type PendingEmission = {
  order: number;
  message: ApertureSurfaceMessage;
};

function createSurfaceEmissionQueue(
  emit: (message: ApertureSurfaceMessage) => Promise<void>,
): SurfaceEmissionQueue {
  const pendingControls: PendingEmission[] = [];
  let pendingUpdate: PendingEmission | null = null;
  let nextOrder = 0;
  let current: Promise<void> | null = null;
  let failed = false;
  let failure: unknown;

  const hasPending = () => pendingControls.length > 0 || pendingUpdate !== null;
  const drain = async () => {
    while (hasPending()) {
      if (failed) throw failure;

      const control = pendingControls[0];
      const update = pendingUpdate;
      let next: PendingEmission | undefined;
      if (update && (!control || update.order < control.order)) {
        next = update;
        pendingUpdate = null;
      } else {
        next = pendingControls.shift();
      }
      if (next) await emit(next.message);
    }
  };

  const startDrain = (): Promise<void> => {
    if (current) return current;
    const task = drain()
      .catch((error) => {
        failed = true;
        failure = error;
        pendingControls.length = 0;
        pendingUpdate = null;
        throw error;
      })
      .finally(() => {
        if (current === task) current = null;
        if (!failed && hasPending()) void startDrain().catch(() => {});
      });
    current = task;
    return task;
  };

  const enqueue = (message: ApertureSurfaceMessage): Promise<void> => {
    if (failed) return Promise.reject(failure);

    const pending = { order: nextOrder, message };
    nextOrder += 1;
    if (isReplaceableSurfaceUpdate(message)) {
      pendingUpdate = pending;
    } else {
      if (pendingControls.length >= MAX_PENDING_CONTROL_MESSAGES) {
        const error = new Error("Aperture surface control-message queue exceeded its limit.");
        failed = true;
        failure = error;
        pendingControls.length = 0;
        pendingUpdate = null;
        return Promise.reject(error);
      }
      pendingControls.push(pending);
    }
    return startDrain();
  };

  return {
    enqueue,
    flush: async () => {
      while (current) await current;
      if (failed) throw failure;
      if (hasPending()) await startDrain();
    },
  };
}

function isReplaceableSurfaceUpdate(message: ApertureSurfaceMessage): boolean {
  return (
    message.type === "snapshot" ||
    (message.type === "error" && message.code === "surface_projection_failed")
  );
}

async function connectWithAbort(
  connect: ApertureSurfaceSessionDependencies["connect"],
  options: ApertureRuntimeClientOptions,
  signal: AbortSignal,
): Promise<ApertureSurfaceRuntimeClient> {
  const pending = connect(options);
  try {
    return await abortable(pending, signal);
  } catch (error) {
    if (signal.aborted) {
      void pending.then((client) => client.close()).catch(() => {});
    }
    throw error;
  }
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      complete();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));

    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Aperture surface stopped.");
}

function selectRuntime(
  registrations: ApertureLocalRuntimeRegistration[],
): ApertureLocalRuntimeRegistration | undefined {
  return [...registrations].sort(
    (left, right) =>
      right.startedAt.localeCompare(left.startedAt) || left.id.localeCompare(right.id),
  )[0];
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
