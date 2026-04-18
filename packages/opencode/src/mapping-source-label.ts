import { basename } from "node:path";

import type { OpencodeMappingContext } from "./mapping-shared.js";

export function opencodeSourceLabel(
  context: Pick<OpencodeMappingContext, "scope" | "sourceLabel">,
): string {
  const explicit = context.sourceLabel?.trim();
  if (explicit) {
    return explicit;
  }

  const scope = scopeLabel(context.scope?.directory);
  return scope ? `OpenCode ${scope}` : "OpenCode";
}

function scopeLabel(directory: string | undefined): string | null {
  if (!directory) {
    return null;
  }

  const normalized = directory.replace(/[\\/]+$/, "").trim();
  if (normalized.length === 0) {
    return null;
  }

  const label = basename(normalized);
  return label.length > 0 ? label : normalized;
}
