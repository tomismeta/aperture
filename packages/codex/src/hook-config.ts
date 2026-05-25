import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type CodexHookInstallResult = {
  changed: boolean;
  hooksPath: string;
  configPath: string;
  command: string;
  featureChanged: boolean;
};

type JsonObject = Record<string, unknown>;
type HookSpec = { eventName: string; matcher?: string; statusMessage?: string };
type HookDefinition = { type: string; command?: string } & Record<string, unknown>;
type HookEntry = { matcher?: string; hooks: HookDefinition[] } & Record<string, unknown>;

const DEFAULT_HOOK_SPECS: HookSpec[] = [
  { eventName: "SessionStart", matcher: "startup|resume", statusMessage: "Connecting Aperture" },
  { eventName: "PreToolUse", matcher: "*", statusMessage: "Waiting for Aperture approval" },
  { eventName: "PermissionRequest", matcher: "*", statusMessage: "Waiting for Aperture approval" },
  { eventName: "PostToolUse", matcher: "*" },
  { eventName: "UserPromptSubmit" },
  { eventName: "PreCompact" },
  { eventName: "PostCompact" },
  { eventName: "SubagentStart" },
  { eventName: "SubagentStop" },
  { eventName: "Stop" },
];

export async function installCodexHooks(options: {
  global: boolean;
  targetRoot?: string;
  quiet?: boolean;
  command: string;
}): Promise<CodexHookInstallResult> {
  const hooksPath = resolveCodexHooksPath(options.global, options.targetRoot);
  const configPath = resolveCodexConfigPath(options.global, options.targetRoot);
  const existing = await readHookConfig(hooksPath);
  const updated = mergeHooks(existing, DEFAULT_HOOK_SPECS, options.command);
  const changed = JSON.stringify(existing) !== JSON.stringify(updated);

  if (changed) {
    await mkdir(dirname(hooksPath), { recursive: true });
    await writeFile(hooksPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  }

  const featureChanged = await ensureCodexHooksFeatureEnabled(configPath);

  return {
    changed,
    hooksPath,
    configPath,
    command: options.command,
    featureChanged,
  };
}

export async function removeCodexHooks(options: {
  global: boolean;
  targetRoot?: string;
  command: string;
}): Promise<CodexHookInstallResult> {
  const hooksPath = resolveCodexHooksPath(options.global, options.targetRoot);
  const configPath = resolveCodexConfigPath(options.global, options.targetRoot);
  const existing = await readHookConfig(hooksPath);
  const updated = removeApertureHooks(existing);
  const changed = JSON.stringify(existing) !== JSON.stringify(updated);

  if (changed) {
    if (Object.keys(updated).length === 0) {
      await rm(hooksPath, { force: true });
    } else {
      await mkdir(dirname(hooksPath), { recursive: true });
      await writeFile(hooksPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    }
  }

  return {
    changed,
    hooksPath,
    configPath,
    command: options.command,
    featureChanged: false,
  };
}

export async function readHookConfig(hooksPath: string): Promise<JsonObject> {
  try {
    const raw = await readFile(hooksPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("hooks.json must be a JSON object");
    }
    return parsed as JsonObject;
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${hooksPath}: ${message}`);
  }
}

export function resolveCodexHooksPath(global: boolean, targetRoot?: string): string {
  return global
    ? resolve(process.env.HOME ?? "~", ".codex", "hooks.json")
    : resolve(targetRoot ?? ".", ".codex", "hooks.json");
}

export function resolveCodexConfigPath(global: boolean, targetRoot?: string): string {
  return global
    ? resolve(process.env.HOME ?? "~", ".codex", "config.toml")
    : resolve(targetRoot ?? ".", ".codex", "config.toml");
}

export function buildCodexHookCommand(cliEntryPath: string, cliRepoRoot: string): string {
  if (cliEntryPath.endsWith(".ts")) {
    return `pnpm --dir ${shellQuote(cliRepoRoot)} exec tsx ${shellQuote(cliEntryPath)}`;
  }

  return `${shellQuote(process.execPath)} ${shellQuote(cliEntryPath)}`;
}

export function withCodexHooksFeatureEnabled(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  if (normalized.length === 0) {
    return "[features]\nhooks = true\n";
  }
  const lines = normalized.split("\n");
  const output: string[] = [];
  let inFeatures = false;
  let sawFeatures = false;
  let wroteFlag = false;

  const flushMissingFlag = () => {
    if (inFeatures && !wroteFlag) {
      if (output.length > 0 && output[output.length - 1] === "") {
        output.splice(output.length - 1, 0, "hooks = true");
      } else {
        output.push("hooks = true");
      }
      wroteFlag = true;
    }
  };

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      flushMissingFlag();
      inFeatures = sectionMatch[1]?.trim() === "features";
      sawFeatures ||= inFeatures;
      output.push(line);
      continue;
    }

    if (inFeatures && /^\s*hooks\s*=/.test(line)) {
      output.push("hooks = true");
      wroteFlag = true;
      continue;
    }

    output.push(line);
  }

  flushMissingFlag();

  if (!sawFeatures) {
    if (output.length > 0 && output[output.length - 1] !== "") {
      output.push("");
    }
    output.push("[features]");
    output.push("hooks = true");
    wroteFlag = true;
  }

  const rendered = output.join("\n").replace(/\n+$/, "");
  return `${rendered}\n`;
}

function mergeHooks(settings: JsonObject, hookSpecs: HookSpec[], command: string): JsonObject {
  const next = { ...settings };
  const hooks = normalizeHooks(next.hooks);

  for (const hookSpec of hookSpecs) {
    hooks[hookSpec.eventName] = ensureCommandHook(
      hooks[hookSpec.eventName],
      command,
      hookSpec.matcher,
      hookSpec.statusMessage,
    );
  }

  next.hooks = hooks;
  return next;
}

function removeApertureHooks(settings: JsonObject): JsonObject {
  const next = { ...settings };
  const hooks = normalizeHooks(next.hooks);

  for (const [eventName, existing] of Object.entries(hooks)) {
    if (!Array.isArray(existing)) {
      continue;
    }

    const cleanedEntries = existing
      .map(cloneEntry)
      .map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry.hooks)
          ? entry.hooks.filter((hook) => !isAnyApertureHook(hook))
          : [],
      }))
      .filter((entry) => entry.hooks.length > 0);

    if (cleanedEntries.length === 0) {
      delete hooks[eventName];
      continue;
    }

    hooks[eventName] = cleanedEntries;
  }

  if (Object.keys(hooks).length === 0) {
    delete next.hooks;
    return next;
  }

  next.hooks = hooks;
  return next;
}

function normalizeHooks(value: unknown): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("hooks must be an object when present");
  }

  return { ...(value as Record<string, unknown>) };
}

function ensureCommandHook(
  existing: unknown,
  command: string,
  matcher?: string,
  statusMessage?: string,
): HookEntry[] {
  const entries = Array.isArray(existing)
    ? existing.map(cloneEntry).filter((entry) => !isLegacyApertureHookEntry(entry, command))
    : [];
  const hook: HookDefinition = {
    type: "command",
    command,
    ...(statusMessage ? { statusMessage } : {}),
  };

  for (const entry of entries) {
    if (hasCommand(entry, command) && sameMatcher(entry.matcher, matcher)) {
      return entries;
    }
  }

  const matchedEntry = entries.find((entry) => sameMatcher(entry.matcher, matcher) && Array.isArray(entry.hooks));
  if (matchedEntry) {
    matchedEntry.hooks.push(hook);
    return entries;
  }

  const nextEntry: HookEntry = matcher !== undefined
    ? { matcher, hooks: [hook] }
    : { hooks: [hook] };
  entries.push(nextEntry);
  return entries;
}

async function ensureCodexHooksFeatureEnabled(configPath: string): Promise<boolean> {
  let raw = "";
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Unable to read ${configPath}: ${message}`);
    }
  }

  const updated = withCodexHooksFeatureEnabled(raw);
  if (updated === raw) {
    return false;
  }

  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, updated, "utf8");
  return true;
}

function cloneEntry(entry: unknown): HookEntry {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("hook entries must be objects");
  }

  const typedEntry = entry as Record<string, unknown>;
  const hooks = Array.isArray(typedEntry.hooks) ? typedEntry.hooks.map(cloneHook) : [];
  return {
    ...typedEntry,
    ...(typeof typedEntry.matcher === "string" ? { matcher: typedEntry.matcher } : {}),
    hooks,
  };
}

function cloneHook(hook: unknown): HookDefinition {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    throw new Error("hook definitions must be objects");
  }
  return { ...(hook as HookDefinition) };
}

function hasCommand(entry: HookEntry, command: string): boolean {
  return entry.hooks.some((hook) => hook.type === "command" && hook.command === command);
}

function sameMatcher(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

function isLegacyApertureHookEntry(entry: HookEntry, command: string): boolean {
  return entry.hooks.some((hook) => {
    if (hook.type !== "command" || typeof hook.command !== "string") {
      return false;
    }

    if (hook.command === command) {
      return false;
    }

    return isAnyApertureHook(hook);
  });
}

function isAnyApertureHook(hook: HookDefinition): boolean {
  if (hook.type !== "command" || typeof hook.command !== "string") {
    return false;
  }

  return hook.command.includes("/scripts/codex-forward.ts")
    || hook.command.includes("/scripts/codex-forward.mjs")
    || hook.command.includes("internal hook codex-forward")
    || hook.command.includes("APERTURE_CODEX_HOOK_URL");
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error)
    && typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}

function shellQuote(value: string): string {
  return `"${value.replace(/([\"\\\\$`])/g, "\\$1")}"`;
}
