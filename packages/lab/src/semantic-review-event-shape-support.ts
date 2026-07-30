const KNOWN_TOOL_FAMILY_SHAPES = new Set([
  "bash",
  "edit",
  "read",
  "search",
  "task",
  "web",
  "write",
]);

export function toolFamilyShape(value: string | undefined | null): string {
  const normalized = shapeToken(value ?? "none");
  if (normalized === "none") {
    return "none";
  }

  return KNOWN_TOOL_FAMILY_SHAPES.has(normalized) ? normalized : "other";
}

export function textLengthBucket(text: string): string {
  if (text.length < 160) {
    return "short";
  }
  if (text.length < 1_024) {
    return "medium";
  }
  return "long";
}

export function lengthBucket(length: number): string {
  if (length === 0) {
    return "empty";
  }
  if (length < 5) {
    return "small";
  }
  if (length < 25) {
    return "medium";
  }
  return "large";
}

export function jsonPrimitiveType(value: unknown): string {
  return value === null ? "null" : jsonValueType(value);
}

export function jsonValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shapeToken(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "none"
  );
}
