import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function readMarkdownFile<T>(
  path: string,
  fallback: T,
  parse: (content: string) => T | null,
): Promise<T> {
  try {
    const content = await readFile(path, "utf8");
    const parsed = parse(content);
    if (parsed === null) {
      warnMarkdownPersistenceIssue(
        path,
        "Failed to parse markdown state. Falling back to the in-memory default.",
      );
      return fallback;
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) {
      return fallback;
    }
    warnMarkdownPersistenceIssue(
      path,
      "Failed to read markdown state. Falling back to the in-memory default.",
      error,
    );
    return fallback;
  }
}

export async function writeMarkdownFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(tempPath, "w", 0o600);
  let closed = false;
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(tempPath, path);
  } catch (error) {
    if (!closed) {
      await handle.close().catch(() => {});
    }
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export function parseHeading(line: string): { level: 1 | 2 | 3; text: string } | null {
  const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line.trim());
  if (!match) {
    return null;
  }

  const marker = match[1];
  if (marker === undefined) {
    return null;
  }

  const level = marker.length;
  if (level < 1 || level > 3) {
    return null;
  }

  const text = match[2]?.trim();
  if (!text) {
    return null;
  }

  return { level: level as 1 | 2 | 3, text };
}

export function parseBullet(
  line: string,
): { key: string; value: string } | { text: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) {
    return null;
  }

  const body = trimmed.slice(2).trim();
  const separator = body.indexOf(":");
  if (separator === -1) {
    return body.length > 0 ? { text: body } : null;
  }

  const key = body.slice(0, separator).trim();
  const value = body.slice(separator + 1).trim();
  if (key.length === 0) {
    return null;
  }

  return { key, value };
}

export function parseScalar(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}

export function formatBullet(key: string, value: string | number | boolean): string {
  return `- ${key}: ${String(value)}`;
}

export function formatTextBullet(value: string): string {
  return `- ${value}`;
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function warnMarkdownPersistenceIssue(path: string, message: string, error?: unknown): void {
  const detail =
    error === undefined ? "" : ` ${error instanceof Error ? error.message : String(error)}`;
  console.warn(`[aperture] ${message} (${path})${detail}`);
}
