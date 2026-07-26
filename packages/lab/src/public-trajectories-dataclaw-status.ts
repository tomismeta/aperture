import type { SourceEvent } from "@tomismeta/aperture-core";

import { inferObservationStatus, isRecord } from "./public-trajectories-shared.js";
import type { DataclawToolUse } from "./public-trajectories-types.js";

export function inferDataclawToolResultStatus(
  toolUse: DataclawToolUse,
  text: string | null,
  toolFamily?: string,
): Extract<SourceEvent, { type: "task.updated" }>["status"] {
  const normalizedStatus =
    typeof toolUse.status === "string" ? toolUse.status.trim().toLowerCase() : "";

  if (
    normalizedStatus.includes("cancel") ||
    normalizedStatus.includes("reject")
  ) {
    return "failed";
  }

  if (normalizedStatus.includes("fail") || normalizedStatus.includes("error")) {
    return isDataclawObservationalSuccessOutput(toolUse, text, toolFamily)
      ? "running"
      : "failed";
  }

  if (
    normalizedStatus.includes("wait") ||
    normalizedStatus.includes("pending") ||
    normalizedStatus.includes("running")
  ) {
    return "waiting";
  }

  if (isDataclawObservationalSuccessOutput(toolUse, text, toolFamily)) {
    return "running";
  }

  if (text) {
    return inferObservationStatus(text, toolFamily);
  }

  if (normalizedStatus.includes("success") || normalizedStatus.includes("complete")) {
    return "running";
  }

  return "running";
}

function isDataclawObservationalSuccessOutput(
  toolUse: DataclawToolUse,
  text: string | null,
  toolFamily?: string,
): boolean {
  if (
    !text ||
    toolUse.output === undefined ||
    toolUse.output === null ||
    hasDataclawStructuredError(toolUse.output)
  ) {
    return false;
  }

  if (toolFamily === "read") {
    return isDataclawReadbackSuccess(text);
  }

  if (toolFamily === "search") {
    return hasDataclawStructuredSearchResults(toolUse.output) || isDataclawSearchListing(text);
  }

  return false;
}

function isDataclawReadbackSuccess(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /(?:^|\n)\d+→/.test(text.trim()) ||
    normalized.includes("showing abbreviated version") ||
    normalized.includes("please use `str_replace_editor view`")
  );
}

function hasDataclawStructuredSearchResults(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (!isRecord(value)) {
    return false;
  }

  return ["matches", "files", "results", "paths"].some((key) =>
    hasDataclawSearchResultValue(value[key]),
  );
}

function hasDataclawSearchResultValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return isRecord(value) && Object.keys(value).length > 0;
}

function isDataclawSearchListing(text: string): boolean {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .some((line) => /^(?:\/|\.{1,2}\/|[A-Za-z0-9._-]+\/).+\.[A-Za-z0-9._-]+$/.test(line));
}

function hasDataclawStructuredError(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasDataclawStructuredError(entry));
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "error" ||
      normalizedKey === "errors" ||
      normalizedKey === "stderr" ||
      normalizedKey === "exception" ||
      normalizedKey === "traceback"
    ) {
      return hasSubstantiveDataclawErrorValue(entry);
    }

    return hasDataclawStructuredError(entry);
  });
}

function hasSubstantiveDataclawErrorValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasSubstantiveDataclawErrorValue(entry));
  }

  if (isRecord(value)) {
    return Object.values(value).some((entry) => hasSubstantiveDataclawErrorValue(entry));
  }

  return value === true || typeof value === "number";
}
