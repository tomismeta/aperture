import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const FRONTMATTER_DELIMITER = "---";

export async function readFrontmatterFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(path, "utf8");
    const parsed = parseFrontmatter<T>(content);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export async function writeFrontmatterFile<T extends object>(
  path: string,
  value: T,
  body: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const next = serializeFrontmatter(value, body);
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, next, "utf8");
  await rename(tempPath, path);
}

export function parseFrontmatter<T>(content: string): T | null {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    return null;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === FRONTMATTER_DELIMITER);
  if (closingIndex === -1) {
    return null;
  }

  const frontmatter = lines.slice(1, closingIndex).join("\n").trim();
  if (frontmatter.length === 0) {
    return null;
  }

  try {
    return JSON.parse(frontmatter) as T;
  } catch {
    return null;
  }
}

export function serializeFrontmatter<T extends object>(value: T, body: string): string {
  const frontmatter = JSON.stringify(value, null, 2);
  const trimmedBody = body.trim();
  return [
    FRONTMATTER_DELIMITER,
    frontmatter,
    FRONTMATTER_DELIMITER,
    "",
    trimmedBody,
    "",
  ].join("\n");
}
