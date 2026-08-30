import type { Writable } from "node:stream";

import {
  APERTURE_SURFACE_LIMITS,
  apertureSurfaceHello,
  type ApertureSurfaceMessage,
} from "./protocol.js";
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
  await writeJsonLine(options.stdout, apertureSurfaceHello(options.packageVersion));
  await runApertureSurfaceSession({
    label: options.label,
    signal: options.signal,
    emit: (message) => writeJsonLine(options.stdout, message),
    diagnostic: (code, error) => {
      const errorName = error instanceof Error ? error.name : typeof error;
      options.stderr.write(`Aperture surface diagnostic [${code}] (${errorName})\n`);
    },
    ...(options.dependencies ? { dependencies: options.dependencies } : {}),
  });
}

async function writeJsonLine(stream: Writable, message: ApertureSurfaceMessage): Promise<void> {
  const line = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(line, "utf8") > APERTURE_SURFACE_LIMITS.jsonLineBytes) {
    throw new Error("Aperture surface protocol line exceeded the configured byte limit.");
  }

  await new Promise<void>((resolve, reject) => {
    stream.write(line, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
