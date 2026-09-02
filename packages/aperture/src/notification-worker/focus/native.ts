import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { createConnection } from "node:net";

import { assertHerdrPaneId, type SavedTmuxOption } from "../../worker-direct-message.js";
import { abortError, throwIfAborted } from "./types.js";

const HERDR_CONNECT_TIMEOUT_MS = 100;
const HERDR_RESPONSE_TIMEOUT_MS = 300;
const HERDR_OUTPUT_BYTES = 64 * 1024;
const HYPRCTL_TIMEOUT_MS = 300;
const HYPRCTL_OUTPUT_BYTES = 128 * 1024;
const TMUX_TIMEOUT_MS = 500;
const NATIVE_OUTPUT_BYTES = 64 * 1024;
const HYPRCTL_PATH = "/usr/bin/hyprctl";
const TMUX_PATH = "/usr/bin/tmux";
const TMUX_OPERATIONS: Readonly<Record<string, true>> = {
  "display-message": true,
  "list-clients": true,
  "show-options": true,
  "set-option": true,
  "switch-client": true,
};

export type HerdrMethod =
  | "pane.current"
  | "pane.focus"
  | "session.snapshot"
  | "client.window_title.set"
  | "client.window_title.clear";

export type HerdrRequest = (
  socketPath: string,
  method: HerdrMethod,
  params: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<Record<string, unknown>>;

export type HyprctlRequest = (
  hyprlandInstance: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<unknown>;

export type TmuxRequest = (
  socketPath: string,
  args: string[],
  signal?: AbortSignal,
) => Promise<string>;

export type SocketValidator = (socketPath: string, signal?: AbortSignal) => Promise<void>;

export async function assertOwnedSocket(socketPath: string, signal?: AbortSignal): Promise<void> {
  if (signal) throwIfAborted(signal);
  const metadata = await lstat(socketPath);
  if (signal) throwIfAborted(signal);
  const uid = process.getuid?.();
  if (
    uid === undefined ||
    metadata.isSymbolicLink() ||
    !metadata.isSocket() ||
    metadata.uid !== uid
  ) {
    throw new Error("focus socket metadata was invalid");
  }
}

export async function requestHerdr(
  socketPath: string,
  method: HerdrMethod,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  await assertOwnedSocket(socketPath, signal);
  if (signal) throwIfAborted(signal);
  const requestId = randomUUID();
  const line = `${JSON.stringify({ id: requestId, method, params })}\n`;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    let buffer = Buffer.alloc(0);
    let settled = false;
    let responseTimer: NodeJS.Timeout | undefined;
    const connectTimer = setTimeout(
      () => finish(undefined, new Error("Herdr focus connection timed out")),
      HERDR_CONNECT_TIMEOUT_MS,
    );
    const onAbort = (): void => finish(undefined, abortError());
    const finish = (result?: Record<string, unknown>, error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(responseTimer);
      signal?.removeEventListener("abort", onAbort);
      socket.removeAllListeners();
      socket.destroy();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(new Error("Herdr focus request failed"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    socket.once("connect", () => {
      clearTimeout(connectTimer);
      responseTimer = setTimeout(
        () => finish(undefined, new Error("Herdr focus response timed out")),
        HERDR_RESPONSE_TIMEOUT_MS,
      );
      socket.write(line, "utf8", (error) => {
        if (error) finish(undefined, new Error("Herdr focus request failed"));
      });
    });
    socket.on("data", (chunk: Buffer) => {
      if (buffer.byteLength + chunk.byteLength > HERDR_OUTPUT_BYTES) {
        finish(undefined, new Error("Herdr focus response exceeded the byte limit"));
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      const newline = buffer.indexOf(0x0a);
      if (newline === -1) return;
      try {
        const response = asRecord(JSON.parse(buffer.subarray(0, newline).toString("utf8")));
        if (response.id !== requestId) throw new Error("Herdr response identity mismatch");
        finish(asRecord(response.result));
      } catch {
        finish(undefined, new Error("Herdr focus response was invalid"));
      }
    });
    socket.once("error", () => finish(undefined, new Error("Herdr focus request failed")));
    socket.once("close", () => {
      if (!settled) finish(undefined, new Error("Herdr focus socket closed"));
    });
  });
}

export async function requestHyprctl(
  hyprlandInstance: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<unknown> {
  const allowed =
    (args.length === 2 &&
      args[0] === "-j" &&
      (args[1] === "clients" || args[1] === "activewindow")) ||
    (args.length === 2 &&
      args[0] === "dispatch" &&
      typeof args[1] === "string" &&
      /^hl\.dsp\.focus\(\{ window = "address:0x[0-9a-fA-F]{1,16}" \}\)$/.test(args[1]));
  if (!allowed) throw new Error("Aperture rejected an unsupported compositor operation");
  if (signal) throwIfAborted(signal);
  const output = await execFileText(
    HYPRCTL_PATH,
    [...args],
    {
      timeout: HYPRCTL_TIMEOUT_MS,
      maxBuffer: HYPRCTL_OUTPUT_BYTES,
      env: { ...process.env, HYPRLAND_INSTANCE_SIGNATURE: hyprlandInstance },
    },
    signal,
  );
  if (Buffer.byteLength(output, "utf8") > HYPRCTL_OUTPUT_BYTES) {
    throw new Error("Aperture compositor response exceeded the byte limit");
  }
  if (args[0] !== "-j") return null;
  try {
    return JSON.parse(output);
  } catch {
    throw new Error("Aperture compositor response was invalid");
  }
}

export async function runTmux(
  socketPath: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  await assertOwnedSocket(socketPath, signal);
  if (!args[0] || TMUX_OPERATIONS[args[0]] !== true) {
    throw new Error("unsupported tmux operation");
  }
  return execFileText(
    TMUX_PATH,
    ["-S", socketPath, ...args],
    { timeout: TMUX_TIMEOUT_MS, maxBuffer: NATIVE_OUTPUT_BYTES },
    signal,
  );
}

export function focusedPaneFromSnapshot(result: Record<string, unknown>): string {
  if (
    result.type !== "session_snapshot" ||
    JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(["snapshot", "type"])
  ) {
    throw new Error("Herdr session snapshot envelope was invalid");
  }
  const snapshot = asRecord(result.snapshot);
  try {
    return assertHerdrPaneId(snapshot.focused_pane_id);
  } catch {
    throw new Error("Herdr focused pane was invalid");
  }
}

export function tmuxLine(output: string): string {
  const line = output.endsWith("\r\n")
    ? output.slice(0, -2)
    : output.endsWith("\n")
      ? output.slice(0, -1)
      : output;
  if (/[\r\n\u0000]/.test(line)) throw new Error("invalid tmux output");
  return line;
}

export async function readTmuxOption(
  request: TmuxRequest,
  socketPath: string,
  sessionId: string,
  option: "set-titles" | "set-titles-string",
  signal?: AbortSignal,
): Promise<string> {
  return tmuxLine(
    await request(socketPath, ["show-options", "-Av", "-t", sessionId, option], signal),
  );
}

export async function readTmuxExplicitOption(
  request: TmuxRequest,
  socketPath: string,
  sessionId: string,
  option: "set-titles" | "set-titles-string",
  signal?: AbortSignal,
): Promise<SavedTmuxOption> {
  const presentation = tmuxLine(
    await request(socketPath, ["show-options", "-q", "-t", sessionId, option], signal),
  );
  if (presentation === "") return { explicit: false, value: "" };
  const value = tmuxLine(
    await request(socketPath, ["show-options", "-qv", "-t", sessionId, option], signal),
  );
  return { explicit: true, value };
}

export async function restoreTmuxOption(
  request: TmuxRequest,
  lease: {
    socketPath: string;
    sessionId: string;
  },
  option: "set-titles" | "set-titles-string",
  saved: SavedTmuxOption,
  signal?: AbortSignal,
): Promise<void> {
  await request(
    lease.socketPath,
    saved.explicit
      ? ["set-option", "-t", lease.sessionId, option, saved.value]
      : ["set-option", "-u", "-t", lease.sessionId, option],
    signal,
  );
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Aperture focus response was invalid");
  }
  return value as Record<string, unknown>;
}

async function execFileText(
  executable: string,
  args: string[],
  options: { timeout: number; maxBuffer: number; env?: NodeJS.ProcessEnv },
  signal?: AbortSignal,
): Promise<string> {
  if (signal) throwIfAborted(signal);
  return new Promise<string>((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        timeout: options.timeout,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
        ...(options.env ? { env: options.env } : {}),
        ...(signal ? { signal } : {}),
      },
      (error, stdout) => {
        if (error) reject(new Error(`${executable} operation failed`));
        else resolve(stdout);
      },
    );
  });
}
