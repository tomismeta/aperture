import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout, exit } from "node:process";

const HOOK_EVENT_NAMES = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "UserPromptSubmit",
  "Stop",
];

async function main() {
  const args = process.argv.slice(2);
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: pnpm claude:disconnect /path/to/project\n");
    stderr.write("   or: pnpm claude:disconnect --global\n");
    exit(1);
    return;
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const targetRoot = targetArg ? resolve(targetArg) : null;
  const settingsPath = global
    ? resolve(process.env.HOME ?? "~", ".claude", "settings.json")
    : resolve(targetRoot, ".claude", "settings.local.json");
  const forwarderPath = resolve(repoRoot, "scripts", "claude-forward.mjs");
  const command = `node ${forwarderPath}`;

  const settings = await readSettings(settingsPath);
  const updated = removeHooks(settings, command);

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  stdout.write(`Updated ${settingsPath}\n`);
  stdout.write("Removed Aperture Claude hook entries.\n");
  stdout.write(`Restart Claude Code${global ? "" : " in the target project"}.\n`);
}

async function readSettings(settingsPath) {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("settings must be a JSON object");
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${settingsPath}: ${message}`);
  }
}

function isMissingFile(error) {
  return Boolean(error) && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function removeHooks(settings, command) {
  const next = { ...settings };
  const hooks = normalizeHooks(next.hooks);

  for (const eventName of HOOK_EVENT_NAMES) {
    const existing = hooks[eventName];
    if (!Array.isArray(existing)) {
      continue;
    }

    const cleanedEntries = existing
      .map(cloneEntry)
      .map((entry) => ({
        ...entry,
        hooks: Array.isArray(entry.hooks)
          ? entry.hooks.filter((hook) => !isApertureHook(hook, command))
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

function normalizeHooks(value) {
  if (value === undefined) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("settings.hooks must be an object when present");
  }

  return { ...value };
}

function cloneEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("hook entries must be objects");
  }

  const hooks = Array.isArray(entry.hooks) ? entry.hooks.map(cloneHook) : [];
  return {
    ...entry,
    ...(typeof entry.matcher === "string" ? { matcher: entry.matcher } : {}),
    hooks,
  };
}

function cloneHook(hook) {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    throw new Error("hook definitions must be objects");
  }

  return { ...hook };
}

function isApertureHook(hook, command) {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
    return false;
  }

  if (hook.type !== "command" || typeof hook.command !== "string") {
    return false;
  }

  return hook.command === command
    || hook.command.includes("/scripts/claude-hook-forward.mjs")
    || hook.command.includes("/scripts/claude-forward.mjs")
    || hook.command.includes("http://127.0.0.1:4545/hook")
    || hook.command.includes("http://localhost:4545/hook");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  exit(1);
});
