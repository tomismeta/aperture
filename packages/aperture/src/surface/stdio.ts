import type { Writable } from "node:stream";

import {
  apertureSurfaceHello,
  serializeApertureSurfaceMessage,
  type ApertureSurfaceMessage,
} from "./protocol.js";
import { assertApertureSurfaceMessage } from "./protocol-validator.js";
import {
  runApertureSurfaceSession,
  type ApertureSurfaceSessionDependencies,
} from "./runtime-session.js";

export type ApertureSurfaceStdioOptions = {
  packageVersion: string;
  label: string;
  signal: AbortSignal;
  stdout: Writable;
  stderr: Writable;
  dependencies?: Partial<ApertureSurfaceSessionDependencies>;
};

export async function runApertureSurfaceStdio(options: ApertureSurfaceStdioOptions): Promise<void> {
  const ignoreDiagnosticError = () => {};
  options.stderr.on("error", ignoreDiagnosticError);
  try {
    await writeJsonLine(
      options.stdout,
      apertureSurfaceHello(options.packageVersion),
      options.signal,
    );
    await runApertureSurfaceSession({
      label: options.label,
      signal: options.signal,
      emit: (message) => writeJsonLine(options.stdout, message, options.signal),
      diagnostic: (code, error) => {
        const errorName = error instanceof Error ? error.name : typeof error;
        try {
          options.stderr.write(`Aperture surface diagnostic [${code}] (${errorName})\n`);
        } catch {
          // Diagnostics must never take down the machine-readable stdout transport.
        }
      },
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
    });
  } catch (error) {
    if (!options.signal.aborted) throw error;
  } finally {
    options.stderr.off("error", ignoreDiagnosticError);
  }
}

async function writeJsonLine(
  stream: Writable,
  message: ApertureSurfaceMessage,
  signal: AbortSignal,
): Promise<void> {
  assertApertureSurfaceMessage(message);
  const line = serializeApertureSurfaceMessage(message);

  if (signal.aborted) {
    throw abortReason(signal);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onError = (error: Error) => settle(error);
    const onAbort = () => settle(abortReason(signal));

    stream.once("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      stream.write(line, (error) => {
        if (!error) {
          stream.off("error", onError);
        }
        settle(error);
      });
    } catch (error) {
      stream.off("error", onError);
      settle(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("Aperture surface stopped.");
}
