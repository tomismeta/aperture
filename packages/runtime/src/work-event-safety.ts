const WORK_INPUT_CONTROL_CHAR_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/u;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function assertSafeUnknown(value: unknown, path: string): void {
  if (typeof value === "string") {
    assertSafeString(value, path);
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      assertSafeUnknown(entry, `${path}[${index}]`);
    }
    return;
  }

  if (!isPlainRecord(value)) {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new Error(`${path}.${key} is not allowed`);
    }
    assertSafeUnknown(entry, `${path}.${key}`);
  }
}

export function assertSafeString(value: string, path: string): void {
  if (WORK_INPUT_CONTROL_CHAR_PATTERN.test(value)) {
    throw new Error(`${path} contains unsupported control characters`);
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
