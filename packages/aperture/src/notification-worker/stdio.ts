import type { Writable } from "node:stream";

import type { NotificationWorkerIdentity } from "./adapter.js";
import { NotificationWorkerEngine } from "./engine.js";
import { startOmpAttentionSocketServer, type OmpAttentionSocketServer } from "./direct-server.js";
import { FocusBroker } from "./focus-broker.js";
import {
  APERTURE_NOTIFICATION_WORKER_LIMITS,
  NotificationWorkerProtocolError,
  notificationWorkerHello,
  parseNotificationWorkerInput,
  serializeNotificationWorkerOutput,
  type NotificationWorkerError,
  type NotificationWorkerOutput,
} from "./protocol.js";

export type NotificationWorkerStdioOptions = {
  packageVersion: string;
  identities: NotificationWorkerIdentity[];
  stateDir: string;
  socketPath?: string;
  input?: NodeJS.ReadableStream;
  output?: Writable;
  diagnostic?: Writable;
  now?: () => number;
};

export async function runNotificationWorkerStdio(
  options: NotificationWorkerStdioOptions,
): Promise<void> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diagnostic = options.diagnostic ?? process.stderr;
  let stopping = false;
  let lastProjection = "";
  let socketServer: OmpAttentionSocketServer | undefined;
  let operationQueue = Promise.resolve();

  const write = async (message: NotificationWorkerOutput): Promise<void> => {
    const line = serializeNotificationWorkerOutput(message);
    await new Promise<void>((resolve, reject) => {
      output.write(line, (error) => (error ? reject(error) : resolve()));
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

  await write(notificationWorkerHello(options.packageVersion));
  await write({ type: "engine", state: "restoring", acceptedSources: options.identities.length });

  const restored = await NotificationWorkerEngine.restore({
    identities: options.identities,
    stateDir: options.stateDir,
    ...(options.now ? { now: options.now } : {}),
  });
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
    lastProjection = fingerprint;
    await write(snapshot);
  };
  const focusBroker = new FocusBroker({
    ...(options.now ? { now: options.now } : {}),
    onInvalidated: (publicHandle) => {
      void serialize(async () => {
        if (restored.engine.removeFocusHandle(publicHandle)) await emitSnapshot();
      });
    },
  });


  if (options.socketPath) {
    try {
      socketServer = await startOmpAttentionSocketServer({
        socketPath: options.socketPath,
        diagnostic,
        registerFocus: (registration) => focusBroker.register(registration),
        revokeFocus: (revocation) => focusBroker.revoke(revocation),
        handleAttention: (event) =>
          serialize(async () => {
            if (stopping) throw new Error("Aperture worker is stopping");
            const navigation = focusBroker.navigationFor(event.focus?.handle);
            await restored.engine.handleOmpAttention(event, navigation);
            await emitSnapshot();
          }),
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

  const stop = () => {
    stopping = true;
    if ("destroy" in input && typeof input.destroy === "function") input.destroy();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
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
          if (event.type === "focus.activate") {
            const result = await focusBroker.activate(event.handle);
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
    stopping = true;
    await socketServer?.close();
    await focusBroker.close();
    await operationQueue;
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    // The input stream owns its lifecycle; signal handling only requests its destruction.
  }
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
