import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { NotificationWorkerIdentity } from "./adapter.js";

export type NotificationWorkerConfig = {
  schemaVersion: 1;
  identities: NotificationWorkerIdentity[];
};

export type NotificationWorkerPaths = {
  configPath: string;
  stateDir: string;
};

export function notificationWorkerPaths(
  environment: NodeJS.ProcessEnv = process.env,
): NotificationWorkerPaths {
  const home = environment.HOME || os.homedir();
  const configHome = environment.XDG_CONFIG_HOME || path.join(home, ".config");
  const stateHome = environment.XDG_STATE_HOME || path.join(home, ".local", "state");
  return {
    configPath: path.join(configHome, "omarchy", "aperture", "config.json"),
    stateDir: path.join(stateHome, "omarchy", "aperture"),
  };
}

export async function loadNotificationWorkerConfig(
  configPath: string,
): Promise<NotificationWorkerConfig> {
  let raw: string;
  try {
    if ((await stat(configPath)).size > 256 * 1024) {
      throw new Error("notification worker config exceeded the byte limit");
    }
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return { schemaVersion: 1, identities: [] };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("notification worker config is not valid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("notification worker config must be an object");
  }
  const record = value as Record<string, unknown>;
  const rootKeys = Object.keys(record).sort();
  if (
    rootKeys.length !== 2 ||
    rootKeys[0] !== "identities" ||
    rootKeys[1] !== "schemaVersion" ||
    record.schemaVersion !== 1 ||
    !Array.isArray(record.identities) ||
    record.identities.length > 64
  ) {
    throw new Error("notification worker config schema is unsupported");
  }
  const identities = record.identities.map((identity, index) =>
    assertNotificationWorkerIdentity(identity, index),
  );
  const seenIds: Record<string, true> = {};
  const seenAliases: Record<string, string> = {};
  for (const identity of identities) {
    if (seenIds[identity.id]) throw new Error(`duplicate notification identity id: ${identity.id}`);
    seenIds[identity.id] = true;
    for (const [namespace, aliases] of [
      ["application", identity.applicationNames ?? []],
      ["desktop-entry", identity.desktopEntries ?? []],
    ] as const) {
      for (const alias of aliases) {
        const key = `${namespace}:${alias}`;
        const owner = seenAliases[key];
        if (owner) {
          throw new Error(
            `notification identity alias ${alias} is shared by ${owner} and ${identity.id}`,
          );
        }
        seenAliases[key] = identity.id;
      }
    }
  }
  return { schemaVersion: 1, identities };
}

function assertNotificationWorkerIdentity(
  value: unknown,
  index: number,
): NotificationWorkerIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`notification identity ${index} must be an object`);
  }
  const record = value as Record<string, unknown>;
  const allowed: Record<string, true> = {
    id: true,
    kind: true,
    label: true,
    applicationNames: true,
    desktopEntries: true,
  };
  for (const key of Object.keys(record)) {
    if (!allowed[key])
      throw new Error(`notification identity ${index} contains unknown field: ${key}`);
  }
  const id = boundedIdentityToken(record.id, `notification identity ${index} id`);
  const kind = boundedIdentityToken(record.kind, `notification identity ${index} kind`);
  const label = boundedIdentityText(record.label, 120, `notification identity ${index} label`);
  const applicationNames = optionalStringArray(
    record.applicationNames,
    `notification identity ${index} applicationNames`,
  );
  const desktopEntries = optionalStringArray(
    record.desktopEntries,
    `notification identity ${index} desktopEntries`,
  );
  if (applicationNames.length === 0 && desktopEntries.length === 0) {
    throw new Error(`notification identity ${index} must declare at least one exact alias`);
  }
  return {
    id,
    kind,
    label,
    ...(applicationNames.length > 0 ? { applicationNames } : {}),
    ...(desktopEntries.length > 0 ? { desktopEntries } : {}),
  };
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) {
    throw new Error(`${label} must be an array with at most 32 entries`);
  }
  return value.map((entry, index) => boundedIdentityText(entry, 120, `${label}[${index}]`));
}

function boundedIdentityToken(value: unknown, label: string): string {
  const token = boundedIdentityText(value, 80, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token)) {
    throw new Error(`${label} must be a stable token`);
  }
  return token;
}

function boundedIdentityText(value: unknown, maximum: number, label: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} must contain visible text`);
  }
  if (Array.from(value).length > maximum) throw new Error(`${label} exceeded the limit`);
  return value;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}
