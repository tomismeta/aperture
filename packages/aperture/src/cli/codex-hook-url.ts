import { readNumber } from "./shared.js";

export function codexHookBridgeUrl(): string {
  const host = process.env.APERTURE_CODEX_HOOK_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CODEX_HOOK_PORT) ?? 4547;
  const hookPath = process.env.APERTURE_CODEX_HOOK_PATH ?? "/hook";
  return `http://${host}:${port}${hookPath}`;
}

export function codexHookForwardUrl(): string {
  return process.env.APERTURE_CODEX_HOOK_URL ?? codexHookBridgeUrl();
}
