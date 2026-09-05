import type { Writable } from "node:stream";

import { startOmpAttentionSocketServer, type OmpAttentionSocketServer } from "./direct-server.js";
import { FocusCoordinator } from "./focus/focus-coordinator.js";
import { OmpWorkerEngine } from "./omp-engine.js";
import {
  OMP_WORKER_LIMITS,
  OmpWorkerProtocolError,
  ompWorkerHello,
  parseOmpWorkerInput,
  serializeOmpWorkerOutput,
  type OmpWorkerOutput,
} from "./omp-worker-protocol.js";
import {
  OMP_SESSION_LIVENESS,
  OmpSessionLiveness,
  type OmpSessionLivenessOptions,
} from "./session-liveness.js";

export type OmpWorkerStdioOptions = {
  packageVersion: string;
  stateDir: string;
  socketPath: string;
  input?: NodeJS.ReadableStream;
  output?: Writable;
  diagnostic?: Writable;
  now?: () => number;
  sessionLiveness?: OmpSessionLivenessOptions;
  sessionLivenessSweepMilliseconds?: number;
};

export async function runOmpWorkerStdio(options: OmpWorkerStdioOptions): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diagnostic = options.diagnostic ?? process.stderr;
  const wallNow = options.now ?? Date.now;
  let stopping = false;
  let lastProjection = "";
  let socketServer: OmpAttentionSocketServer | undefined;
  let focusCoordinator: FocusCoordinator | undefined;
  let abortPendingWrite: (() => void) | undefined;
  let sessionSweepTimer: NodeJS.Timeout | undefined;
  let operationQueue = Promise.resolve();
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
  const write = async (message: OmpWorkerOutput): Promise<void> => {
    if (stopping) throw new Error("Aperture worker is stopping");
    const line = serializeOmpWorkerOutput(message);
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
    await write({
      type: "error",
      code: boundedErrorText(code, OMP_WORKER_LIMITS.errorCodeCharacters),
      message: boundedErrorText(message, OMP_WORKER_LIMITS.errorMessageCharacters),
      recoverable,
    });
  };
  const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
    const result = operationQueue.then(operation, operation);
    operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await write(ompWorkerHello(options.packageVersion));
    await write({ type: "engine", state: "restoring", acceptedSources: 1 });
    const restored = await OmpWorkerEngine.restore({
      stateDir: options.stateDir,
      ...(options.now ? { now: options.now } : {}),
    });
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
      if (stopping) return;
      void serialize(async () => {
        const expired = sessionLiveness.expired();
        if (expired.length === 0) return;
        const changed = await restored.engine.expireOmpSessions(
          expired.map((candidate) => candidate.sessionId),
          new Date(wallNow()).toISOString(),
        );
        sessionLiveness.commitExpired(expired);
        if (changed) await emitSnapshot();
      }).catch(() => {
        diagnostic.write("Aperture could not expire a dead OMP session\n");
      });
    };
    sessionSweepTimer = setInterval(
      expireDeadSessions,
      options.sessionLivenessSweepMilliseconds ?? OMP_SESSION_LIVENESS.sweepMilliseconds,
    );
    sessionSweepTimer.unref?.();

    const coordinator = new FocusCoordinator({
      ...(options.now ? { now: options.now } : {}),
      onDiagnostic: (stage) => diagnostic.write(`Aperture focus ${stage}\n`),
      onInvalidated: (publicHandle) => {
        void serialize(async () => {
          const expired = await restored.engine.expireOmpCompletionByFocusHandle(
            publicHandle,
            new Date(wallNow()).toISOString(),
          );
          const navigationRemoved = restored.engine.removeFocusHandle(publicHandle);
          if (expired || navigationRemoved) await emitSnapshot();
        });
      },
    });
    focusCoordinator = coordinator;
    try {
      socketServer = await startOmpAttentionSocketServer({
        socketPath: options.socketPath,
        diagnostic,
        registerFocus: async (registration, signal) => {
          await directReady;
          signal.throwIfAborted();
          return coordinator.register(registration, signal);
        },
        revokeFocus: async (revocation, signal) => {
          await directReady;
          signal.throwIfAborted();
          await coordinator.revoke(revocation, signal);
        },
        heartbeatSession: async (heartbeat, signal) => {
          await directReady;
          await serialize(async () => {
            signal.throwIfAborted();
            sessionLiveness.observe(heartbeat.sessionId);
          });
        },
        handleAttention: async (event, signal) => {
          await directReady;
          await serialize(async () => {
            signal.throwIfAborted();
            if (event.classification !== "session_shutdown") {
              sessionLiveness.observe(event.sessionId);
            }
            const navigation = coordinator.navigationFor(event.focus?.handle);
            try {
              await restored.engine.handleOmpAttention(event, navigation, signal);
              if (event.classification !== "session_shutdown") {
                sessionLiveness.confirmReconnect(event.sessionId);
              }
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
    } catch (error) {
      await writeError(
        "direct_transport_unavailable",
        "Aperture could not safely open the direct OMP transport.",
        false,
      );
      throw error;
    }
    await write({ type: "engine", state: "ready", acceptedSources: 1 });
    await emitSnapshot();
    markDirectReady();

    for await (const decoded of boundedJsonLines(input, OMP_WORKER_LIMITS.inputLineBytes)) {
      if (stopping) break;
      if ("error" in decoded) {
        await serialize(() => writeError("invalid_input", decoded.error, true));
        continue;
      }
      try {
        const shouldContinue = await serialize(async () => {
          const event = parseOmpWorkerInput(decoded.line);
          if (event.type === "shutdown") return false;
          const result = await coordinator.activate(event.handle);
          if (result === "focused") {
            try {
              const changed = await restored.engine.resolveOmpCompletionByFocusHandle(
                event.handle,
                new Date(wallNow()).toISOString(),
              );
              if (changed) await emitSnapshot();
            } catch {
              diagnostic.write("Could not resolve completion\n");
            }
          }
          await write({ type: "focus.result", requestId: event.requestId, result });
          return true;
        });
        if (!shouldContinue || stopping) break;
      } catch (error) {
        if (error instanceof OmpWorkerProtocolError) {
          await serialize(() => writeError("invalid_input", error.message, true));
          continue;
        }
        await writeError(
          "worker_failure",
          "Aperture could not safely process the OMP control event.",
          false,
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
    throw new Error("OMP worker input stream is not async iterable");
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
        yield { error: "OMP worker input exceeded the byte limit" };
      } else {
        if (fragment.length > 0) fragments.push(fragment);
        bytes += fragment.length;
        if (newline !== -1) {
          const line = fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, bytes);
          yield {
            line:
              line.at(-1) === 0x0d ? line.subarray(0, -1).toString("utf8") : line.toString("utf8"),
          };
          fragments = [];
          bytes = 0;
        }
      }
      if (newline === -1) break;
      offset = newline + 1;
    }
  }
  if (!discarding && bytes > 0) {
    if (bytes + 1 > maximumBytes) yield { error: "OMP worker input exceeded the byte limit" };
    else {
      const line = fragments.length === 1 ? fragments[0]! : Buffer.concat(fragments, bytes);
      yield { line: line.toString("utf8") };
    }
  }
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
