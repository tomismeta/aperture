import { ApertureCore } from "@tomismeta/aperture-core";
import { runAttentionTui } from "@aperture/tui";
import { LauncherConnectionStore, makeConnectionEntry } from "../packages/aperture/src/connection-status.ts";

type DemoOptions = {
  recording: boolean;
};

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const core = new ApertureCore();
  const connections = new LauncherConnectionStore([
    makeConnectionEntry(
      "claude",
      "Claude Code",
      "ready",
      "Using an existing Claude bridge at http://127.0.0.1:4545/hook.",
    ),
    makeConnectionEntry(
      "opencode",
      "OpenCode",
      "starting",
      "Checking OpenCode at http://127.0.0.1:4096.",
    ),
  ]);
  const opencodeReadyTimer = setTimeout(() => {
    connections.update("opencode", {
      state: "action",
      detail: "Waiting for OpenCode at http://127.0.0.1:4096.",
      hint: "Run: opencode serve --port 4096, then opencode attach http://127.0.0.1:4096.",
    });
  }, options.recording ? 1_200 : 0);

  try {
    await runAttentionTui(core, {
      title: "Aperture Setup Demo",
      terminalTitle: "Aperture",
      reducedMotion: options.recording,
      getConnectionStatus: () => connections.getSnapshot(),
      subscribeConnectionStatus: (listener) => connections.subscribe(listener),
      runConnectionAction: async (actionId) => {
        switch (actionId) {
          case "skip-setup":
            connections.suppressPending();
            return;
          case "show-setup":
            connections.restoreSuppressed();
            return;
          case "retry-opencode":
          case "refresh-claude":
            return;
          default:
            return;
        }
      },
    });
  } finally {
    clearTimeout(opencodeReadyTimer);
  }
}

function readOptions(args: string[]): DemoOptions {
  return {
    recording: args.includes("--recording") || process.env.APERTURE_DEMO_RECORDING === "1",
  };
}

void main();
