import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stdout } from "node:process";

import { isMissingFile } from "./shared.js";

export type ClaudeHookInstallResult = {
  changed: boolean;
  settingsPath: string;
  command: string;
};

type JsonObject = Record<string, unknown>;
type HookSpec = { eventName: string; matcher?: string };
type HookDefinition = { type: string; command?: string } & Record<string, unknown>;
type HookEntry = { matcher?: string; hooks: HookDefinition[] } & Record<string, unknown>;

const DEFAULT_HOOK_SPECS: HookSpec[] = [
  { eventName: "SessionStart" },
  { eventName: "InstructionsLoaded" },
  { eventName: "PreToolUse", matcher: "*" },
  { eventName: "PermissionRequest", matcher: "*" },
  { eventName: "PermissionDenied", matcher: "*" },
  { eventName: "PostToolUse", matcher: "*" },
  { eventName: "PostToolUseFailure", matcher: "*" },
  { eventName: "Elicitation" },
  { eventName: "ElicitationResult" },
  { eventName: "Notification" },
  { eventName: "SubagentStart" },
  { eventName: "SubagentStop" },
  { eventName: "TaskCreated" },
  { eventName: "TaskCompleted" },
  { eventName: "UserPromptSubmit" },
  { eventName: "StopFailure" },
  { eventName: "TeammateIdle" },
  { eventName: "ConfigChange" },
  { eventName: "CwdChanged" },
  { eventName: "PreCompact" },
  { eventName: "PostCompact" },
  { eventName: "SessionEnd" },
  { eventName: "Stop" },
];

export async function installClaudeHooks(options: {
  global: boolean;
  targetRoot?: string;
  quiet?: boolean;
  command: string;
}): Promise<ClaudeHookInstallResult> {
  const settingsPath = resolveClaudeSettingsPath(options.global, options.targetRoot);
  const settings = await readSettings(settingsPath);
  const updated = mergeHooks(settings, DEFAULT_HOOK_SPECS, options.command);
  const changed = JSON.stringify(settings) !== JSON.stringify(updated);

  if (!changed) {
    return {
      changed,
      settingsPath,
      command: options.command,
    };
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  if (options.quiet) {
    return {
      changed,
      settingsPath,
      command: options.command,
    };
  }

  stdout.write(`Updated ${settingsPath}\n`);
  stdout.write(`Hook command: ${options.command}\n`);
  stdout.write("\n");
  stdout.write("Next steps:\n");
  stdout.write("1. Start Aperture: aperture\n");
  stdout.write(`2. Restart Claude Code${options.global ? "" : " in the target project"}.\n`);
  stdout.write("3. Run /hooks in Claude Code to confirm the hooks loaded.\n");

  return {
    changed,
    settingsPath,
    command: options.command,
  };
}

export async function removeClaudeHooks(options: {
  global: boolean;
  targetRoot?: string;
  command: string;
}): Promise<ClaudeHookInstallResult> {
  const settingsPath = resolveClaudeSettingsPath(options.global, options.targetRoot);
  const settings = await readSettings(settingsPath);
  const updated = removeApertureHooks(settings);
  const changed = JSON.stringify(settings) !== JSON.stringify(updated);

  if (!changed) {
    return {
      changed,
      settingsPath,
      command: options.command,
    };
  }

  if (Object.keys(updated).length === 0) {
    await rm(settingsPath, { force: true });
    return {
      changed,
      settingsPath,
      command: options.command,
    };
  }

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  return {
    changed,
    settingsPath,
    command: options.command,
  };
}

export function buildClaudeHookCommand(cliEntryPath: string, cliRepoRoot: string): string {
  if (cliEntryPath.endsWith(".ts")) {
    return `pnpm --dir ${shellQuote(cliRepoRoot)} exec tsx ${shellQuote(cliEntryPath)} internal hook claude-forward`;
  }

  return `${shellQuote(process.execPath)} ${shellQuote(cliEntryPath)} internal hook claude-forward`;
}

export async function readSettings(settingsPath: string): Promise<JsonObject> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("settings must be a JSON object");
    }
    return parsed as JsonObject;
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${settingsPath}: ${message}`);
  }
}

export function resolveClaudeSettingsPath(global: boolean, targetRoot?: string): string {
  return global
    ? resolve(process.env.HOME ?? "~", ".claude", "settings.json")
    : resolve(targetRoot ?? ".", ".claude", "settings.local.json");
}

export function countApertureHookEntries(settings: JsonObject): number {
  const hooks = normalizeHooks(settings.hooks);
  let count = 0;

  for (const existing of Object.values(hooks)) {
    if (!Array.isArray(existing)) {
      continue;
    }

    for (const entry of existing) {
      const cloned = cloneEntry(entry);
      count += cloned.hooks.filter(isAnyApertureHook).length;
    }
  }

  return count;
}

function mergeHooks(settings: JsonObject, hookSpecs: HookSpec[], command: string): JsonObject {
  const next = { ...settings };
  const hooks = normalizeHooks(next.hooks);

  for (const hookSpec of hookSpecs) {
    hooks[hookSpec.eventName] = ensureCommandHook(hooks[hookSpec.eventName], command, hookSpec.matcher);
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
      .filter((entry) => Array.isArray(entry.hooks) && entry.hooks.length > 0);

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
    throw new Error("settings.hooks must be an object when present");
  }

  return { ...(value as Record<string, unknown>) };
}

function ensureCommandHook(existing: unknown, command: string, matcher?: string): HookEntry[] {
  const entries = Array.isArray(existing)
    ? existing.map(cloneEntry).filter((entry) => !isLegacyApertureHookEntry(entry, command))
    : [];
  const hook: HookDefinition = { type: "command", command };

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
  return Array.isArray(entry.hooks)
    && entry.hooks.some((hook) => hook.type === "command" && hook.command === command);
}

function sameMatcher(left: unknown, right: unknown): boolean {
  return (left ?? null) === (right ?? null);
}

function isLegacyApertureHookEntry(entry: HookEntry, command: string): boolean {
  if (!Array.isArray(entry.hooks)) {
    return false;
  }

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

  return hook.command.includes("hook claude-forward")
    || hook.command.includes("/scripts/claude-hook-forward.mjs")
    || hook.command.includes("/scripts/claude-forward.mjs")
    || hook.command.includes("/scripts/claude-forward.ts")
    || hook.command.includes("http://127.0.0.1:4545/hook")
    || hook.command.includes("http://localhost:4545/hook");
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}
