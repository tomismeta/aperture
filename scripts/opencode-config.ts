import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { stderr, stdin } from "node:process";

export type OpencodeConnectionProfile = {
  id: string;
  label?: string;
  baseUrl: string;
  enabled: boolean;
  updatedAt: string;
  createdAt: string;
  auth?: {
    username: string;
    password?: string;
    passwordEnv?: string;
  };
  scope?: {
    directory: string;
    mode?: "header" | "query";
  };
};

type OpencodeConnectionConfig = {
  version: 1;
  updatedAt: string;
  profiles: OpencodeConnectionProfile[];
};

const GLOBAL_CONFIG_PATH = resolve(homedir(), ".aperture", "opencode.json");

export async function listGlobalOpencodeProfiles(): Promise<OpencodeConnectionProfile[]> {
  const config = await readGlobalOpencodeConfig();
  return [...config.profiles];
}

export async function listEnabledGlobalOpencodeProfiles(): Promise<OpencodeConnectionProfile[]> {
  const profiles = await listGlobalOpencodeProfiles();
  return profiles.filter((profile) => profile.enabled);
}

export async function saveGlobalOpencodeProfile(
  profile: Omit<OpencodeConnectionProfile, "createdAt" | "updatedAt">,
): Promise<OpencodeConnectionProfile> {
  const config = await readGlobalOpencodeConfig();
  const now = new Date().toISOString();
  const existing = config.profiles.find((candidate) => candidate.id === profile.id);
  const nextProfile: OpencodeConnectionProfile = {
    ...profile,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const nextProfiles = config.profiles.filter((candidate) => candidate.id !== profile.id);
  nextProfiles.push(nextProfile);
  nextProfiles.sort((left, right) => left.id.localeCompare(right.id));

  await writeGlobalOpencodeConfig({
    version: 1,
    updatedAt: now,
    profiles: nextProfiles,
  });

  return nextProfile;
}

export async function removeGlobalOpencodeProfile(profileId: string): Promise<boolean> {
  const config = await readGlobalOpencodeConfig();
  const nextProfiles = config.profiles.filter((profile) => profile.id !== profileId);
  if (nextProfiles.length === config.profiles.length) {
    return false;
  }

  if (nextProfiles.length === 0) {
    await rm(GLOBAL_CONFIG_PATH, { force: true });
    return true;
  }

  await writeGlobalOpencodeConfig({
    version: 1,
    updatedAt: new Date().toISOString(),
    profiles: nextProfiles,
  });
  return true;
}

export function normalizeBaseUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`Invalid OpenCode URL: ${raw}`);
  }
}

export function globalOpencodeConfigPath(): string {
  return GLOBAL_CONFIG_PATH;
}

export async function promptHiddenPassword(prompt: string): Promise<string> {
  if (!stdin.isTTY) {
    throw new Error("Password prompt requires a TTY");
  }

  stderr.write(prompt);
  stdin.resume();
  stdin.setEncoding("utf8");
  stdin.setRawMode?.(true);

  return new Promise<string>((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode?.(false);
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          stderr.write("\n");
          reject(new Error("Password prompt cancelled"));
          return;
        }

        if (char === "\r" || char === "\n") {
          cleanup();
          stderr.write("\n");
          resolve(value);
          return;
        }

        if (char === "\u007f") {
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
          continue;
        }

        value += char;
      }
    };

    stdin.on("data", onData);
  });
}

export function resolveProfilePassword(profile: OpencodeConnectionProfile): string | undefined {
  if (profile.auth?.passwordEnv) {
    return process.env[profile.auth.passwordEnv];
  }
  return profile.auth?.password;
}

async function readGlobalOpencodeConfig(): Promise<OpencodeConnectionConfig> {
  try {
    const raw = await readFile(GLOBAL_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<OpencodeConnectionConfig>;
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles.filter(isProfile) : [],
    };
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        version: 1,
        updatedAt: new Date(0).toISOString(),
        profiles: [],
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${GLOBAL_CONFIG_PATH}: ${message}`);
  }
}

async function writeGlobalOpencodeConfig(config: OpencodeConnectionConfig): Promise<void> {
  await mkdir(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  await writeFile(GLOBAL_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(GLOBAL_CONFIG_PATH, 0o600).catch(() => {});
}

function isProfile(value: unknown): value is OpencodeConnectionProfile {
  return Boolean(value) && typeof value === "object" && "id" in value && typeof value.id === "string";
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
