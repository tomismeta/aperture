import path from "node:path";

export function defaultLabRuntimeRoot(repoRoot: string = process.cwd()): string {
  const override = process.env.APERTURE_LAB_RUNTIME_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }

  return path.resolve(repoRoot, ".aperture", "lab");
}

export const DEFAULT_LAB_RUNTIME_ROOT = defaultLabRuntimeRoot();

export function defaultLabRuntimeSubdirectory(...segments: string[]): string {
  return path.join(DEFAULT_LAB_RUNTIME_ROOT, ...segments);
}
