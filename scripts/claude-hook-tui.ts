import { stderr } from "node:process";

import { ApertureCore } from "../packages/core/src/index.ts";
import { createClaudeCodeHookServer } from "../packages/claude-code/src/server.ts";
import { runAttentionTui } from "../packages/tui/src/index.ts";

async function main(): Promise<void> {
  const core = new ApertureCore();
  const host = process.env.APERTURE_CLAUDE_HOST ?? "127.0.0.1";
  const port = readNumber(process.env.APERTURE_CLAUDE_PORT) ?? 4545;
  const path = process.env.APERTURE_CLAUDE_PATH ?? "/hook";
  const includePostToolUse = process.env.APERTURE_INCLUDE_POST_TOOL_USE === "1";
  const hookServer = createClaudeCodeHookServer(core, {
    host,
    port,
    path,
    includePostToolUse,
    tools: undefined, // accept all tools
  });

  const binding = await hookServer.listen();
  stderr.write(`Aperture Claude hook server listening at ${binding.url}\n`);
  stderr.write("Configure Claude Code hooks to POST PreToolUse and PostToolUseFailure events here.\n");

  try {
    await runAttentionTui(core, { title: "Aperture · Claude Code" });
  } finally {
    await hookServer.close();
  }
}

function readNumber(raw: string | undefined): number | null {
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

void main();
