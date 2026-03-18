import type { Frame } from "./types.js";

export function displaySourceLabel(source: Frame["source"] | null | undefined): string {
  const rawSource = source?.label ?? source?.id ?? "unknown";
  return rawSource.replace(/ (aperture|session)?\s*#[a-f0-9]+$/i, "").trim();
}
