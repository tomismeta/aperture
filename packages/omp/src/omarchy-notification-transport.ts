import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { OmpEventSink } from "./bind.js";
import {
  mapOmpNotificationTransitions,
  type OmpNotificationClass,
} from "./notification-mapping.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

const execFileAsync = promisify(execFile);

export type OmpCommandResult = { stdout: string; stderr: string };
export type OmpCommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number; maximumOutputBytes: number },
) => Promise<OmpCommandResult>;

export type OmarchyNotificationTransportOptions = {
  commandRunner?: OmpCommandRunner;
  senderCommand?: string;
  appName?: string;
};

type ActiveNotification = {
  id: string;
  notificationClass: OmpNotificationClass;
};

export class OmarchyNotificationTransport implements OmpEventSink {
  private readonly commandRunner: OmpCommandRunner;
  private readonly senderCommand: string;
  private readonly appName: string;
  private readonly active = new Map<string, ActiveNotification>();

  constructor(options: OmarchyNotificationTransportOptions = {}) {
    this.commandRunner = options.commandRunner ?? runCommand;
    this.senderCommand = options.senderCommand ?? "omarchy-notification-send";
    this.appName = options.appName ?? "aperture-omp";
  }

  async handle(event: OmpEvent, context: OmpMappingContext): Promise<void> {
    const transitions = mapOmpNotificationTransitions(event, context);
    for (const transition of transitions) {
      switch (transition.kind) {
        case "upsert": {
          const existing = this.active.get(transition.key);
          const args = [
            "--app-name",
            this.appName,
            "--urgency",
            transition.urgency,
            "--expire-time",
            String(transition.expireTimeMs),
            "--print-id",
            ...(existing ? ["--replace-id", existing.id] : []),
            transition.summary,
            transition.body,
          ];
          const result = await this.commandRunner(this.senderCommand, args, {
            timeoutMs: 3_000,
            maximumOutputBytes: 4_096,
          });
          const id = result.stdout.trim();
          if (!/^\d+$/.test(id)) {
            throw new Error("Omarchy notification sender returned an invalid notification id");
          }
          this.active.set(transition.key, {
            id,
            notificationClass: transition.notificationClass,
          });
          break;
        }
        case "close":
          await this.closeKey(transition.key);
          break;
        case "close-class":
          await this.closeClass(transition.notificationClass);
          break;
        case "close-all":
          await this.close();
          break;
      }
    }
  }

  async close(): Promise<void> {
    for (const key of [...this.active.keys()]) await this.closeKey(key);
  }

  private async closeClass(notificationClass: OmpNotificationClass): Promise<void> {
    for (const [key, notification] of [...this.active.entries()]) {
      if (notification.notificationClass === notificationClass) await this.closeKey(key);
    }
  }

  private async closeKey(key: string): Promise<void> {
    const notification = this.active.get(key);
    if (!notification) return;
    await this.commandRunner(
      "busctl",
      [
        "--user",
        "call",
        "org.freedesktop.Notifications",
        "/org/freedesktop/Notifications",
        "org.freedesktop.Notifications",
        "CloseNotification",
        "u",
        notification.id,
      ],
      { timeoutMs: 3_000, maximumOutputBytes: 4_096 },
    );
    this.active.delete(key);
  }
}

async function runCommand(
  command: string,
  args: string[],
  options: { timeoutMs: number; maximumOutputBytes: number },
): Promise<OmpCommandResult> {
  const result = await execFileAsync(command, args, {
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: options.maximumOutputBytes,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}
