import type { Writable } from "node:stream";

import type { NotificationWorkerIdentity } from "./adapter.js";
import { NotificationWorkerEngine } from "./engine.js";
import { startOmpAttentionSocketServer, type OmpAttentionSocketServer } from "./direct-server.js";
import { FocusCoordinator } from "./focus/focus-coordinator.js";
import {
  APERTURE_NOTIFICATION_WORKER_LIMITS,
  NotificationWorkerProtocolError,
  notificationWorkerHello,
  parseNotificationWorkerInput,
  serializeNotificationWorkerOutput,
  type NotificationWorkerError,
  type NotificationWorkerOutput,
} from "./protocol.js";
import {
  OMP_SESSION_LIVENESS,
  OmpSessionLiveness,
  type OmpSessionLivenessOptions,
} from "./session-liveness.js";
import { removeLegacyNotificationWorkerState } from "./state-store.js";

export type NotificationWorkerMode = "notification" | "omp-only";

export type NotificationWorkerStdioOptions = {
  packageVersion: string;
  identities: NotificationWorkerIdentity[];
  stateDir: string;
  mode?: NotificationWorkerMode;
  socketPath?: string;
  input?: NodeJS.ReadableStream;
  output?: Writable;
  diagnostic?: Writable;
  now?: () => number;
  sessionLiveness?: OmpSessionLivenessOptions;
  sessionLivenessSweepMilliseconds?: number;
};

export async function runNotificationWorkerStdio(
  options: NotificationWorkerStdioOptions,
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diagnostic = options.diagnostic ?? process.stderr;
  const mode = options.mode ?? "notification";
  let stopping = false;
  let lastProjection = "";
  let socketServer: OmpAttentionSocketServer | undefined;
  let focusCoordinator: FocusCoordinator | undefined;
  let abortPendingWrite: (() => void) | undefined;
  let sessionSweepTimer: NodeJS.Timeout | undefined;
  let sessionExpiryPending = false;
  let markDirectReady!: () => void;
  const directReady = new Promise<void>((resolve) => {
    markDirectReady = resolve;
  });
  const setStopping = (): void => {
    if (stopping) return;
    stopping = true;
    abortPendingWrite?.();
  };
  const stop = (): void => {
    setStopping();
    if ("destroy" in input && typeof input.destroy === "function") input.destroy();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let operationQueue = Promise.resolve();
  const wallNow = options.now ?? Date.now;

  const write = async (message: NotificationWorkerOutput): Promise<void> => {
    if (stopping) throw new Error("Aperture worker is stopping");
    const line = serializeNotificationWorkerOutput(message);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error | null): void => {
        if (settled) return;
        settled = true;
        if (abortPendingWrite === abort) abortPendingWrite = undefined;
        if (error) reject(error);
        else resolve();
      };
      const abort = (): void => finish(new Error("Aperture worker is stopping"));
      abortPendingWrite = abort;
      try {
        output.write(line, finish);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Aperture worker output failed"));
      }
    });
  };
  const writeError = async (code: string, message: string, recoverable: boolean): Promise<void> => {
    const error: NotificationWorkerError = {
      type: "error",
      code: boundedErrorText(code, APERTURE_NOTIFICATION_WORKER_LIMITS.errorCodeCharacters),
      message: boundedErrorText(
        message,
        APERTURE_NOTIFICATION_WORKER_LIMITS.errorMessageCharacters,
      ),
      recoverable,
    };
    await write(error);
  };
  const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  try {
    await write(notificationWorkerHello(options.packageVersion, mode === "notification"));
    await write({ type: "engine", state: "restoring", acceptedSources: options.identities.length });

    const engineOptions = {
      identities: options.identities,
      stateDir: options.stateDir,
      ...(options.now ? { now: options.now } : {}),
    };
    if (mode === "omp-only") await removeLegacyNotificationWorkerState(options.stateDir);
    const restored =
      mode === "omp-only"
        ? await NotificationWorkerEngine.restoreOmpOnly(engineOptions)
        : await NotificationWorkerEngine.restore(engineOptions);
    const sessionLiveness = new OmpSessionLiveness(options.sessionLiveness);
    const overflowSessions = sessionLiveness.seed(restored.engine.activeOmpSessionIds());
    if (overflowSessions.length > 0) {
      await restored.engine.expireOmpSessions(overflowSessions, new Date(wallNow()).toISOString());
    }
    if (restored.recoveredCorruptState) {
      await writeError(
        "corrupt_state_recovered",
        "Aperture recovered from an invalid local worker state file.",
        true,
      );
    }

    const emitSnapshot = async (): Promise<void> => {
      const snapshot = restored.engine.snapshot();
      const fingerprint = JSON.stringify({
        sources: snapshot.sources,
        totals: snapshot.totals,
        view: snapshot.view,
      });
      if (fingerprint === lastProjection) return;
      await write(snapshot);
      lastProjection = fingerprint;
    };
    const expireDeadSessions = (): void => {
      if (stopping || sessionExpiryPending) return;
      const candidates = sessionLiveness.expired();
      if (candidates.length === 0) return;
      sessionExpiryPending = true;
      void serialize(async () => {
        const expired = candidates.filter((candidate) => sessionLiveness.stillExpired(candidate));
        if (expired.length === 0) return;
        const changed = await restored.engine.expireOmpSessions(
          expired.map((candidate) => candidate.sessionId),
          new Date(wallNow()).toISOString(),
        );
        sessionLiveness.commitExpired(expired);
        if (changed) await emitSnapshot();
      })
        .catch(() => {
          diagnostic.write("Aperture could not expire a dead OMP session\n");
        })
        .finally(() => {
          sessionExpiryPending = false;
        });
    };
    sessionSweepTimer = setInterval(
      expireDeadSessions,
      options.sessionLivenessSweepMilliseconds ?? OMP_SESSION_LIVENESS.sweepMilliseconds,
    );
    sessionSweepTimer.unref?.();
    const coordinator = new FocusCoordinator({
      ...(options.now ? { now: options.now } : {}),
      onDiagnostic: (stage) => {
        diagnostic.write(`Aperture focus ${stage}\n`);
      },
      onInvalidated: (publicHandle) => {
        void serialize(async () => {
          if (restored.engine.removeFocusHandle(publicHandle)) await emitSnapshot();
        });
      },
    });
    focusCoordinator = coordinator;
    if (options.socketPath) {
      try {
        socketServer = await startOmpAttentionSocketServer({
          socketPath: options.socketPath,
          diagnostic,
          registerFocus: async (registration, signal) => {
            await directReady;
            if (signal.aborted) throw new Error("Aperture worker is stopping");
            return coordinator.register(registration, signal);
          },
          revokeFocus: async (revocation, signal) => {
            await directReady;
            if (signal.aborted) throw new Error("Aperture worker is stopping");
            await coordinator.revoke(revocation, signal);
          },
          heartbeatSession: async (heartbeat, signal) => {
            await directReady;
            signal.throwIfAborted();
            sessionLiveness.observe(heartbeat.sessionId);
          },
          handleAttention: async (event, signal) => {
            await directReady;
            signal.throwIfAborted();
            if (event.classification !== "session_shutdown") {
              sessionLiveness.observe(event.sessionId);
            }
            await serialize(async () => {
              if (stopping || signal.aborted) throw new Error("Aperture worker is stopping");
              const navigation = coordinator.navigationFor(event.focus?.handle);
              try {
                await restored.engine.handleOmpAttention(event, navigation, signal);
                if (event.classification === "session_shutdown") {
                  sessionLiveness.forget(event.sessionId);
                }
              } catch {
                throw new Error("Aperture attention engine failed");
              }
              try {
                await emitSnapshot();
              } catch {
                diagnostic.write(
                  "Aperture committed direct attention but could not emit its snapshot\n",
                );
              }
            });
          },
        });
      } catch {
        await writeError(
          "direct_transport_unavailable",
          "Aperture could not safely open the direct OMP transport.",
          true,
        );
      }
    }
    await write({
      type: "engine",
      state: options.identities.length > 0 ? "ready" : "degraded",
      acceptedSources: restored.engine.getAcceptedSourceCount(),
    });
    await emitSnapshot();
    markDirectReady();

    for await (const decoded of boundedJsonLines(
      input,
      APERTURE_NOTIFICATION_WORKER_LIMITS.inputLineBytes,
    )) {
      if (stopping) break;
      if ("error" in decoded) {
        await serialize(() => writeError("invalid_input", decoded.error, true));
        continue;
      }
      try {
        const shouldContinue = await serialize(async () => {
          const event = parseNotificationWorkerInput(decoded.line);
          if (
            mode === "omp-only" &&
            (event.type === "notification.observed" ||
              event.type === "notification.updated" ||
              event.type === "notification.closed")
          ) {
            throw new NotificationWorkerProtocolError(
              "generic notification input is disabled in OMP-only mode",
            );
          }
          if (event.type === "focus.activate") {
            const result = await coordinator.activate(event.handle);
            await write({ type: "focus.result", requestId: event.requestId, result });
            return true;
          }
          const keepRunning = await restored.engine.handle(event);
          if (keepRunning) await emitSnapshot();
          return keepRunning;
        });
        if (!shouldContinue || stopping) break;
      } catch (error) {
        if (error instanceof NotificationWorkerProtocolError) {
          await serialize(() => writeError("invalid_input", error.message, true));
          continue;
        }
        diagnostic.write("Aperture notification worker fatal error\n");
        await serialize(() =>
          writeError(
            "worker_failure",
            "Aperture could not safely process the notification event.",
            false,
          ),
        );
        break;
      }
    }
  } catch (error) {
    if (!stopping) throw error;
  } finally {
    setStopping();
    clearInterval(sessionSweepTimer);
    markDirectReady();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await closeWorkerResources(socketServer, focusCoordinator, operationQueue);
    // The input stream owns its lifecycle; signal handling only requests its destruction.
  }
}
async function closeWorkerResources(
  socketServer: OmpAttentionSocketServer | undefined,
  focusCoordinator: FocusCoordinator | undefined,
  operationQueue: Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled([
    socketServer?.close() ?? Promise.resolve(),
    focusCoordinator?.close() ?? Promise.resolve(),
    operationQueue,
  ]);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (failure) throw failure.reason;
}

type DecodedLine = { line: string } | { error: string };

async function* boundedJsonLines(
  input: NodeJS.ReadableStream,
  maximumBytes: number,
): AsyncGenerator<DecodedLine> {
  const iterable = input as NodeJS.ReadableStream & AsyncIterable<Buffer | string>;
  if (typeof iterable[Symbol.asyncIterator] !== "function") {
    throw new Error("notification worker input stream is not async iterable");
  }
  let fragments: Buffer[] = [];
  let bytes = 0;
  let discarding = false;
  for await (const chunk of iterable) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    while (offset < buffer.length) {
      const newline = buffer.indexOf(0x0a, offset);
      const end = newline === -1 ? buffer.length : newline;
      const fragment = buffer.subarray(offset, end);
      if (discarding) {
        if (newline !== -1) discarding = false;
      } else if (bytes + fragment.length + (newline === -1 ? 0 : 1) > maximumBytes) {
        fragments = [];
        bytes = 0;
        discarding = newline === -1;
        yield { error: "notification worker input exceeded the byte limit" };
      } else {
        if (fragment.length > 0) fragments.push(fragment);
        bytes += fragment.length;
        if (newline !== -1) {
          yield { line: decodeLine(fragments, bytes) };
          fragments = [];
          bytes = 0;
        }
      }
      if (newline === -1) break;
      offset = newline + 1;
    }
  }
  if (!discarding && bytes > 0) {
    if (bytes + 1 > maximumBytes) {
      yield { error: "notification worker input exceeded the byte limit" };
    } else {
      yield { line: decodeLine(fragments, bytes) };
    }
  }
}

function decodeLine(fragments: Buffer[], bytes: number): string {
  const line = fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, bytes);
  return line.at(-1) === 0x0d ? line.subarray(0, -1).toString("utf8") : line.toString("utf8");
}

function boundedErrorText(value: string, maximum: number): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const characters = Array.from(normalized);
  if (characters.length <= maximum) return normalized;
  return `${characters.slice(0, Math.max(0, maximum - 1)).join("")}…`;
}
