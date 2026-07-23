import { createHash } from "node:crypto";

export type KernelCanonicalJsonDigest = `sha256:${string}`;

export function serializeKernelCanonicalJson(value: unknown): string {
  return serializeValue(value);
}

export function digestKernelCanonicalJson(value: unknown): KernelCanonicalJsonDigest {
  const bytes = Buffer.from(serializeKernelCanonicalJson(value), "utf8");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function compareKernelCanonicalKey(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function serializeValue(value: unknown): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) {
        throw new TypeError("Kernel canonical JSON only accepts finite numbers.");
      }
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      return Array.isArray(value) ? serializeArray(value) : serializeObject(value);
    default:
      throw new TypeError(`Kernel canonical JSON cannot serialize ${typeof value}.`);
  }
}

function serializeArray(value: unknown[]): string {
  const entries: string[] = [];

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError("Kernel canonical JSON cannot serialize sparse arrays.");
    }
    entries.push(serializeValue(value[index]));
  }

  return `[${entries.join(",")}]`;
}

function serializeObject(value: object): string {
  const entries = Object.keys(value)
    .sort(compareKernelCanonicalKey)
    .map((key) => {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) {
        throw new TypeError("Kernel canonical JSON cannot serialize undefined object values.");
      }
      return `${JSON.stringify(key)}:${serializeValue(entry)}`;
    });

  return `{${entries.join(",")}}`;
}
