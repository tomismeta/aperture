import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

type JsonObject = Record<string, unknown>;
type HookSpec = { eventName: string; matcher?: string };
type HookDefinition = { type: string; command?: string } & Record<string, unknown>;
type HookEntry = { matcher?: string; hooks: HookDefinition[] } & Record<string, unknown>;

const DEFAULT_HOOK_SPECS: HookSpec[] = [
  { eventName: "PreToolUse", matcher: "*" },
  { eventName: "PostToolUse", matcher: "*" },
  { eventName: "PostToolUseFailure", matcher: "*" },
  { eventName: "Notification" },
  { eventName: "UserPromptSubmit" },
  { eventName: "Stop" },
];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: pnpm claude:connect /path/to/project\n");
    stderr.write("   or: pnpm claude:connect --global\n");
    process.exit(1);
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const targetRoot = targetArg ? resolve(targetArg) : null;
  const settingsPath = global
    ? resolve(process.env.HOME ?? "~", ".claude", "settings.json")
    : resolve(targetRoot ?? ".", ".claude", "settings.local.json");
  const forwarderPath = resolve(repoRoot, "scripts", "claude-forward.ts");
  const tsxPath = resolve(repoRoot, "node_modules", ".bin", "tsx");
  const command = `${shellQuote(tsxPath)} ${shellQuote(forwarderPath)}`;

  const settings = await readSettings(settingsPath);
  const updated = mergeHooks(settings, DEFAULT_HOOK_SPECS, command);

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  stdout.write(`Updated ${settingsPath}\n`);
  stdout.write(`Hook command: ${command}\n`);
  stdout.write("\n");
  stdout.write("Next steps:\n");
  stdout.write("1. In this repo, start Aperture: pnpm aperture\n");
  stdout.write(`2. Restart Claude Code${global ? "" : " in the target project"}.\n`);
  stdout.write("3. Run /hooks in Claude Code to confirm the hooks loaded.\n");
}

async function readSettings(settingsPath: string): Promise<JsonObject> {
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

function isMissingFile(error: unknown): boolean {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
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

    if (hook.command.includes("/scripts/claude-hook-forward.mjs")) {
      return true;
    }

    if (hook.command.includes("/scripts/claude-forward.mjs")) {
      return true;
    }

    if (hook.command.includes("/scripts/claude-forward.ts")) {
      return true;
    }

    return hook.command.includes("http://127.0.0.1:4545/hook")
      || hook.command.includes("http://localhost:4545/hook");
  });
}

function shellQuote(value: string): string {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  process.exit(1);
});
