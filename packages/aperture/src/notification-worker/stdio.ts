import type { Writable } from "node:stream";

import type { NotificationWorkerIdentity } from "./adapter.js";
import { NotificationWorkerEngine } from "./engine.js";
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
      "Aperture recovered from an invalid local notification state file.",
      true,
    );
  }
  await write({
    type: "engine",
    state: options.identities.length > 0 ? "ready" : "degraded",
    acceptedSources: restored.engine.getAcceptedSourceCount(),
  });

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
        await writeError("invalid_input", decoded.error, true);
        continue;
      }
      try {
        const event = parseNotificationWorkerInput(decoded.line);
        if (!(await restored.engine.handle(event))) break;
        if (stopping) break;
        await emitSnapshot();
      } catch (error) {
        if (error instanceof NotificationWorkerProtocolError) {
          await writeError("invalid_input", error.message, true);
          continue;
        }
        diagnostic.write("Aperture notification worker fatal error\n");
        await writeError(
          "worker_failure",
          "Aperture could not safely process the notification event.",
          false,
        );
        break;
      }
    }
  } catch (error) {
    if (!stopping) throw error;
  } finally {
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
