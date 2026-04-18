import type { Frame } from "./types.js";

export function displaySourceLabel(source: Frame["source"] | null | undefined): string {
  const rawSource = normalizedSourceLabel(source);
  return rawSource.replace(/ (aperture|session)?\s*#[a-f0-9]+$/i, "").trim();
}

function normalizedSourceLabel(source: Frame["source"] | null | undefined): string {
  const explicit = source?.label?.trim();
  if (explicit) {
    return explicit;
  }

  const kindLabel = sourceKindLabel(source?.kind);
  if (kindLabel) {
    return kindLabel;
  }

  const id = source?.id?.trim();
  return id && id.length > 0 ? id : "unknown";
}

function sourceKindLabel(kind: string | undefined): string | null {
  switch (kind) {
    case "claude-code":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "Codex";
    default:
      return null;
  }
}
