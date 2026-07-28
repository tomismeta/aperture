import type { TaskFailureSemanticEvidence } from "@tomismeta/aperture-core/internal";

import {
  escapeRegExp,
  jsonPrimitiveType,
  jsonValueType,
  lengthBucket,
  textLengthBucket,
  toolFamilyShape,
} from "./semantic-review-event-shape-support.js";

const KNOWN_JSON_KEYS = [
  "command",
  "error",
  "exit_code",
  "file_path",
  "message",
  "output",
  "path",
  "status",
  "stderr",
  "stdout",
  "truncated",
  "wall_time",
] as const;

export function readFailureEvidenceEventShape(input: {
  evidence: TaskFailureSemanticEvidence;
  event: {
    summary: string | null;
    toolFamily: string | null;
  };
}): string {
  const toolFamily = toolFamilyShape(input.evidence.toolFamily ?? input.event.toolFamily);
  return `tool:${toolFamily}|summary:${readSummaryShape(input.event.summary)}`;
}

function readSummaryShape(summary: string | null): string {
  if (summary === null) {
    return "missing";
  }

  const text = summary.trim();
  if (text.length === 0) {
    return "blank";
  }

  const parsed = parseJsonValue(text);
  if (parsed.ok && Array.isArray(parsed.value)) {
    return `json_array:${lengthBucket(parsed.value.length)}`;
  }
  if (parsed.ok && isRecord(parsed.value)) {
    return readJsonObjectShape(parsed.value);
  }
  if (parsed.ok) {
    return `json_${jsonPrimitiveType(parsed.value)}`;
  }

  if (/^\s*\{/.test(text)) {
    return `malformed_json_object:${keyHintShape(text)}`;
  }
  if (/^\s*\[/.test(text)) {
    return "malformed_json_array";
  }

  return readTextShape(text);
}

function readJsonObjectShape(value: Record<string, unknown>): string {
  const keyShape = objectKeyShape(value);
  const details: string[] = [`keys=${keyShape}`];

  if (Object.hasOwn(value, "exit_code")) {
    details.push(`exit_code=${jsonValueType(value.exit_code)}`);
  }
  if (Object.hasOwn(value, "output")) {
    details.push(`output=${readPayloadValueShape(value.output)}`);
  }
  if (Object.hasOwn(value, "truncated")) {
    details.push(`truncated=${jsonValueType(value.truncated)}`);
  }
  if (Object.hasOwn(value, "wall_time")) {
    details.push(`wall_time=${jsonValueType(value.wall_time)}`);
  }

  return `json_object:${details.join(";")}`;
}

function objectKeyShape(value: Record<string, unknown>): string {
  const present = KNOWN_JSON_KEYS.filter((key) => Object.hasOwn(value, key));
  const otherCount = Object.keys(value).filter(
    (key) => !(KNOWN_JSON_KEYS as readonly string[]).includes(key),
  ).length;

  return [...present, ...(otherCount > 0 ? [`other:${otherCount}`] : [])].join(",") || "none";
}

function keyHintShape(text: string): string {
  const present = KNOWN_JSON_KEYS.filter((key) =>
    new RegExp(`"${escapeRegExp(key)}"\\s*:`).test(text),
  );
  return `keys=${present.join(",") || "unknown"}`;
}

function readPayloadValueShape(value: unknown): string {
  if (typeof value === "string") {
    return readTextShape(value);
  }
  if (Array.isArray(value)) {
    return `json_array:${lengthBucket(value.length)}`;
  }
  if (isRecord(value)) {
    return `json_object:keys=${objectKeyShape(value)}`;
  }
  return jsonValueType(value);
}

function readTextShape(text: string): string {
  const normalized = text.trim();
  if (/^\s*\{/.test(normalized)) {
    return "text:json_object_like";
  }
  if (/^\s*\[/.test(normalized)) {
    return "text:json_array_like";
  }
  if (looksLikeRepeatedLineNumberContext(normalized)) {
    return "text:line_numbered_context";
  }
  if (looksLikeSourceText(normalized)) {
    return "text:source_like";
  }
  if (looksPathHeavy(normalized)) {
    return `text:path_heavy:${textLengthBucket(normalized)}`;
  }
  return `text:plain:${textLengthBucket(normalized)}`;
}

function looksLikeRepeatedLineNumberContext(text: string): boolean {
  return [...text.matchAll(/(?:^|\s)\d+[-:|]\s*\S/g)].length >= 2;
}

function looksLikeSourceText(text: string): boolean {
  return (
    /(?:^|\s)(?:import|export|class|function|def|interface|type|struct|enum|const|let|var)\s+/.test(
      text,
    ) ||
    /(?:^|\s)#!\/usr\/bin\/env\s+\S/.test(text) ||
    /(?:^|\s)diff --git\s+/.test(text)
  );
}

function looksPathHeavy(text: string): boolean {
  return [...text.matchAll(/(?:^|\s)(?:\.{0,2}\/|[a-zA-Z]:\\|~\/)[^\s:]+/g)].length >= 2;
}

type JsonParseResult = { ok: true; value: unknown } | { ok: false };

function parseJsonValue(value: string): JsonParseResult {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
