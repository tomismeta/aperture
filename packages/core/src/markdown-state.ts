import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readMarkdownFile<T>(
  path: string,
  fallback: T,
  parse: (content: string) => T | null,
): Promise<T> {
  try {
    const content = await readFile(path, "utf8");
    return parse(content) ?? fallback;
  } catch {
    return fallback;
  }
}

export async function writeMarkdownFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
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

export function parseBullet(line: string): { key: string; value: string } | { text: string } | null {
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
