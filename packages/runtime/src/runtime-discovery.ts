import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type ApertureLocalRuntimeRegistration = {
  id: string;
  kind: string;
  controlUrl: string;
  baseUrl?: string;
  tokenPath: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  metadata?: Record<string, string>;
};

type DiscoveryOptions = {
  kind?: string;
  maxStalenessMs?: number;
  registryDir?: string;
};

const DEFAULT_REGISTRY_DIR = resolve(homedir(), ".aperture", "runtimes");
const DEFAULT_MAX_STALENESS_MS = 15_000;

export async function writeLocalRuntimeRegistration(
  registration: ApertureLocalRuntimeRegistration,
  options: { registryDir?: string } = {},
): Promise<void> {
  const registryDir = options.registryDir ?? DEFAULT_REGISTRY_DIR;
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    registrationPath(registration.id, registryDir),
    `${JSON.stringify(registration, null, 2)}\n`,
    "utf8",
  );
}

export async function removeLocalRuntimeRegistration(
  id: string,
  options: { registryDir?: string } = {},
): Promise<void> {
  const registryDir = options.registryDir ?? DEFAULT_REGISTRY_DIR;
  await rm(registrationPath(id, registryDir), { force: true });
}

export async function discoverLocalRuntimes(
  options: DiscoveryOptions = {},
): Promise<ApertureLocalRuntimeRegistration[]> {
  const registryDir = options.registryDir ?? DEFAULT_REGISTRY_DIR;
  const maxStalenessMs = options.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS;
  let entries: string[];

  try {
    entries = await readdir(registryDir);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const registrations = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry) => {
        try {
          const parsed: unknown = JSON.parse(await readFile(resolve(registryDir, entry), "utf8"));
          return isRuntimeRegistration(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }),
  );

  const cutoff = Date.now() - maxStalenessMs;
  return registrations
    .filter(
      (registration): registration is ApertureLocalRuntimeRegistration => registration !== null,
    )
    .filter((registration) => (options.kind ? registration.kind === options.kind : true))
    .filter((registration) => {
      const updatedAt = Date.parse(registration.updatedAt);
      return !Number.isNaN(updatedAt) && updatedAt >= cutoff;
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function registrationPath(id: string, registryDir: string): string {
  return resolve(registryDir, `${encodeURIComponent(id)}.json`);
}

function isRuntimeRegistration(value: unknown): value is ApertureLocalRuntimeRegistration {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const metadata = candidate.metadata;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.kind === "string" &&
    candidate.kind.length > 0 &&
    typeof candidate.controlUrl === "string" &&
    candidate.controlUrl.length > 0 &&
    (candidate.baseUrl === undefined || typeof candidate.baseUrl === "string") &&
    typeof candidate.tokenPath === "string" &&
    candidate.tokenPath.length > 0 &&
    typeof candidate.pid === "number" &&
    Number.isSafeInteger(candidate.pid) &&
    candidate.pid > 0 &&
    typeof candidate.startedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.startedAt)) &&
    typeof candidate.updatedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.updatedAt)) &&
    (metadata === undefined ||
      (metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        Object.values(metadata).every((entry) => typeof entry === "string")))
  );
}

function isMissingFile(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return false;
  }

  return error.code === "ENOENT";
}
