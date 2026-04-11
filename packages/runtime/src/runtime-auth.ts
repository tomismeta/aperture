import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { RuntimeHttpError } from "./runtime-http.js";

const DEFAULT_RUNTIME_STATE_ROOT = resolve(homedir(), ".aperture", "runtime");

export type RuntimeAuthState = {
  stateDir: string;
  tokenPath: string;
  token: string;
};

export async function initializeRuntimeAuth(runtimeId: string): Promise<RuntimeAuthState> {
  const stateDir = resolve(DEFAULT_RUNTIME_STATE_ROOT, encodeURIComponent(runtimeId));
  const tokenPath = resolve(stateDir, "token");
  const token = randomBytes(32).toString("hex");

  await mkdir(stateDir, { recursive: true });
  await writeSecretFileAtomically(tokenPath, `${token}\n`);

  return {
    stateDir,
    tokenPath,
    token,
  };
}

export async function readRuntimeAuthToken(tokenPath: string): Promise<string> {
  if (process.platform !== "win32") {
    const tokenStats = await stat(tokenPath);
    if ((tokenStats.mode & 0o077) !== 0) {
      throw new Error(`Runtime auth token file must not be group- or world-readable: ${tokenPath}`);
    }
  }
  return (await readFile(tokenPath, "utf8")).trim();
}

export function isAuthorizedRequest(
  authorizationHeader: string | string[] | undefined,
  token: string,
): boolean {
  if (authorizationHeader === undefined) {
    return false;
  }
  const joined = Array.isArray(authorizationHeader)
    ? authorizationHeader.join(",")
    : authorizationHeader;
  const match = joined.match(/^Bearer\s+(.+)$/i);
  const candidate = match?.[1]?.trim();
  if (!candidate) {
    return false;
  }
  const candidateBytes = Buffer.from(candidate, "utf8");
  const tokenBytes = Buffer.from(token, "utf8");
  if (candidateBytes.length !== tokenBytes.length) {
    return false;
  }
  return timingSafeEqual(candidateBytes, tokenBytes);
}

export function assertAllowedOrigin(
  originHeader: string | string[] | undefined,
  options: { allowBrowserOrigin?: boolean } = {},
): void {
  if (originHeader === undefined) {
    return;
  }

  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (!origin) {
    return;
  }

  if (options.allowBrowserOrigin && origin === "null") {
    return;
  }

  throw new RuntimeHttpError(
    403,
    "forbidden_origin",
    "Browser-origin requests are not allowed for this Aperture runtime route.",
  );
}

async function writeSecretFileAtomically(path: string, contents: string): Promise<void> {
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, contents, { encoding: "utf8", mode: 0o600 });
  try {
    await chmod(tempPath, 0o600);
  } catch (error) {
    warnPermissionHardeningFailure(tempPath, error);
  }

  try {
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

function warnPermissionHardeningFailure(path: string, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[aperture] Failed to harden runtime auth token permissions for ${path}: ${detail}`);
}
