import { writeFile } from "node:fs/promises";
import path from "node:path";

import { assertWorkerDirectMessage, type FocusRegistration } from "../src/worker-direct-message.js";
import { FocusCoordinator } from "../src/notification-worker/focus/focus-coordinator.js";

const reportPath = optionValue(process.argv.slice(2), "--report");
const clients = [
  { address: "0x101", class: "foot", title: "herdr-original" },
  { address: "0x202", class: "foot", title: `Aperture Focus ${"D".repeat(32)}` },
  { address: "0x303", class: "footclient", title: "tmux-original" },
];
let activeAddress = "0x101";
let herdrPane = "w1:p1";
let tmuxPane = "%0";
let tmuxSetTitles = "off";
let tmuxTitle = "tmux-original";
let tokenSerial = 0;
const confirmations = { herdr: 0, tmux: 0 };
let herdrClearCalls = 0;

const coordinator = new FocusCoordinator({
  randomToken: () => `smoke-${tokenSerial++}`.padEnd(32, "X").slice(0, 32),
  socketValidator: async () => undefined,
  sleep: async () => undefined,
  monotonicNow: (() => {
    let now = 0;
    return () => (now += 25);
  })(),
  herdrRequest: async (_socketPath, method, params) => {
    if (method === "pane.current") {
      return { type: "pane_current", pane: { pane_id: String(params.caller_pane_id) } };
    }
    if (method === "client.window_title.set") {
      const title = String(params.title);
      const changed = clients[0]!.title !== title;
      clients[0]!.title = title;
      return { type: "client_window_title", changed, reason: "set" };
    }
    if (method === "client.window_title.clear") {
      herdrClearCalls += 1;
      clients[0]!.title = "herdr-original";
      return { type: "client_window_title", changed: true, reason: "clear" };
    }
    if (method === "pane.focus") {
      herdrPane = String(params.pane_id);
      return { type: "pane_focused" };
    }
    if (method === "session.snapshot") {
      confirmations.herdr += 1;
      return { type: "session_snapshot", snapshot: { focused_pane_id: herdrPane } };
    }
    throw new Error("unexpected Herdr smoke operation");
  },
  hyprctlRequest: async (_instance, args) => {
    if (args[0] === "-j" && args[1] === "clients") return clients.map((client) => ({ ...client }));
    if (args[0] === "dispatch") {
      const address = String(args[1]).match(/address:(0x[0-9a-f]+)/i)?.[1];
      if (!address) throw new Error("missing smoke surface address");
      activeAddress = address;
      return null;
    }
    if (args[0] === "-j" && args[1] === "activewindow") {
      const client = clients.find((candidate) => candidate.address === activeAddress);
      if (!client) throw new Error("missing smoke active surface");
      return { ...client };
    }
    throw new Error("unexpected Hyprland smoke operation");
  },
  tmuxRequest: async (_socketPath, args) => {
    if (args[0] === "display-message" && args.includes("#{session_id}")) return "$0\n";
    if (args[0] === "list-clients") return "/dev/pts/7\n";
    if (args[0] === "show-options") {
      const option = args.at(-1);
      if (args.includes("-q") && !args.includes("-qv")) return `${String(option)}\n`;
      if (option === "set-titles") return `${tmuxSetTitles}\n`;
      if (option === "set-titles-string") return `${tmuxTitle}\n`;
    }
    if (args[0] === "set-option") {
      const unset = args.includes("-u");
      const option = args[args.indexOf("-t") + 2];
      const value = args[args.indexOf("-t") + 3];
      if (option === "set-titles") tmuxSetTitles = unset ? "on" : String(value);
      else if (option === "set-titles-string") {
        tmuxTitle = unset ? "#{host}:#{window_index}" : String(value);
        clients[2]!.title = unset ? "tmux-inherited" : tmuxTitle;
      } else throw new Error("unexpected tmux smoke option");
      return "";
    }
    if (args[0] === "switch-client") {
      tmuxPane = String(args.at(-1));
      return "";
    }
    if (args[0] === "display-message" && args.includes("#{pane_id}")) {
      confirmations.tmux += 1;
      return `${tmuxPane}\n`;
    }
    throw new Error("unexpected tmux smoke operation");
  },
});

const registrations = [
  registration("direct-terminal", "D".repeat(32)),
  registration("herdr", "H".repeat(32)),
  registration("tmux", "T".repeat(32)),
];
const results: Array<{ backend: string; result: string }> = [];
for (const item of registrations) await coordinator.register(item);
for (const item of registrations) {
  results.push({
    backend: item.target.kind,
    result: await coordinator.activate(item.publicHandle),
  });
}
if (results.some((entry) => entry.result !== "focused")) {
  throw new Error("positive focus backend smoke failed");
}
if (confirmations.herdr < 2 || confirmations.tmux < 2) {
  throw new Error("inner focus was not confirmed before and after outer focus");
}
await coordinator.close();
if (herdrClearCalls !== 0 || !clients[0]!.title.startsWith("Aperture Focus ")) {
  throw new Error("Herdr cleanup did not retain its exact marker");
}
if (tmuxSetTitles !== "off" || tmuxTitle !== "tmux-original") {
  throw new Error("tmux cleanup did not restore its owned options");
}

const report = {
  schemaVersion: 1,
  proofId: "aperture-opaque-focus-navigation-v4",
  status: "passed",
  backends: results,
  checks: [
    "three-backend-coexistence",
    "positive-inner-focus",
    "positive-outer-focus",
    "post-outer-inner-reconfirmation",
    "herdr-marker-retained-no-conditional-clear",
    "tmux-compare-and-restore-close",
  ],
};
if (reportPath) {
  await writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
} else {
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function registration(
  kind: "herdr" | "direct-terminal" | "tmux",
  handle: string,
): FocusRegistration {
  const target =
    kind === "herdr"
      ? {
          kind,
          socketPath: "/run/user/1000/herdr.sock",
          paneId: "w1:p1",
          hyprlandInstance: "instance_1",
        }
      : kind === "direct-terminal"
        ? { kind, marker: "D".repeat(32), hyprlandInstance: "instance_1" }
        : {
            kind,
            socketPath: "/run/user/1000/tmux.sock",
            paneId: "%0",
            hyprlandInstance: "instance_1",
          };
  return assertWorkerDirectMessage({
    schemaVersion: 4,
    type: "focus.register",
    requestId: `smoke-${kind}`,
    publicHandle: handle,
    hostGeneration: `${kind}-generation`.padEnd(32, "X").slice(0, 32),
    target,
  }) as FocusRegistration;
}

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value`);
  return value;
}
