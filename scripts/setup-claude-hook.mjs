import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stderr, stdout, exit } from "node:process";

const DEFAULT_HOOK_SPECS = [
  { eventName: "PreToolUse", matcher: "*" },
  { eventName: "PostToolUseFailure", matcher: "*" },
  { eventName: "Notification" },
  { eventName: "UserPromptSubmit" },
];

async function main() {
  const args = process.argv.slice(2);
  const includePostToolUse = args.includes("--include-post-tool-use");
  const global = args.includes("--global") || args.includes("-g");
  const targetArg = args.find((arg) => !arg.startsWith("--"));

  if (!global && !targetArg) {
    stderr.write("Usage: pnpm setup:claude-hook /path/to/project [--include-post-tool-use]\n");
    stderr.write("   or: pnpm setup:claude-hook --global [--include-post-tool-use]\n");
    exit(1);
    return;
  }

  const hookSpecs = includePostToolUse
    ? [...DEFAULT_HOOK_SPECS, { eventName: "PostToolUse", matcher: "*" }]
    : DEFAULT_HOOK_SPECS;

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const targetRoot = targetArg ? resolve(targetArg) : null;
  const settingsPath = global
    ? resolve(process.env.HOME ?? "~", ".claude", "settings.json")
    : resolve(targetRoot, ".claude", "settings.local.json");
  const forwarderPath = resolve(repoRoot, "scripts", "claude-hook-forward.mjs");
  const command = `node ${forwarderPath}`;

  const settings = await readSettings(settingsPath);
  const updated = mergeHooks(settings, hookSpecs, command);

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");

  stdout.write(`Updated ${settingsPath}\n`);
  stdout.write(`Hook command: ${command}\n`);
  stdout.write("\n");
  stdout.write("Next steps:\n");
  stdout.write(
    `1. In this repo, run: ${includePostToolUse ? "APERTURE_INCLUDE_POST_TOOL_USE=1 " : ""}pnpm demo:claude-hook\n`,
  );
  stdout.write(`2. Restart Claude Code${global ? "" : " in the target project"}.\n`);
  stdout.write("3. Run /hooks in Claude Code to confirm the hooks loaded.\n");
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

function mergeHooks(settings, hookSpecs, command) {
  const next = { ...settings };
  const hooks = normalizeHooks(next.hooks);

  for (const hookSpec of hookSpecs) {
    hooks[hookSpec.eventName] = ensureCommandHook(hooks[hookSpec.eventName], command, hookSpec.matcher);
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

function ensureCommandHook(existing, command, matcher) {
  const entries = Array.isArray(existing) ? existing.map(cloneEntry) : [];
  const hook = { type: "command", command };

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

  const nextEntry = matcher !== undefined
    ? { matcher, hooks: [hook] }
    : { hooks: [hook] };
  entries.push(nextEntry);

  return entries;
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

function hasCommand(entry, command) {
  return Array.isArray(entry.hooks)
    && entry.hooks.some(
      (hook) =>
        hook
        && typeof hook === "object"
        && !Array.isArray(hook)
        && hook.type === "command"
        && hook.command === command,
    );
}

function sameMatcher(left, right) {
  return (left ?? null) === (right ?? null);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  stderr.write(`${message}\n`);
  exit(1);
});
