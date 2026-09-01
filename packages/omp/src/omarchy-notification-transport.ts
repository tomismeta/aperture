import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { OmpEventSink } from "./bind.js";
import {
  mapOmpNotificationTransitions,
  type OmpNotificationClass,
  type OmpNotificationTransition,
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
  availabilityCheck?: () => Promise<boolean>;
};

type ActiveNotification = {
  id: string;
  notificationClass: OmpNotificationClass;
  expiresAt: number | null;
};

export class OmarchyNotificationTransport implements OmpEventSink {
  private readonly commandRunner: OmpCommandRunner;
  private readonly senderCommand: string;
  private readonly appName: string;
  private readonly availabilityCheck: () => Promise<boolean>;
  private readonly active = new Map<string, ActiveNotification>();

  constructor(options: OmarchyNotificationTransportOptions = {}) {
    this.commandRunner = options.commandRunner ?? runCommand;
    this.senderCommand = options.senderCommand ?? "omarchy-notification-send";
    this.appName = options.appName ?? "aperture-omp";
    this.availabilityCheck =
      options.availabilityCheck ?? (() => commandIsExecutable(this.senderCommand));
  }

  isAvailable(): Promise<boolean> {
    return this.availabilityCheck();
  }

  async handle(event: OmpEvent, context: OmpMappingContext): Promise<void> {
    await this.deliverTransitions(mapOmpNotificationTransitions(event, context), true);
  }

  async handleClosures(event: OmpEvent, context: OmpMappingContext): Promise<void> {
    await this.deliverTransitions(mapOmpNotificationTransitions(event, context), false);
  }

  private async deliverTransitions(
    transitions: OmpNotificationTransition[],
    allowUpserts: boolean,
  ): Promise<void> {
    this.pruneExpired();
    for (const transition of transitions) {
      switch (transition.kind) {
        case "upsert": {
          if (!allowUpserts) break;
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
            expiresAt: transition.expireTimeMs > 0 ? Date.now() + transition.expireTimeMs : null,
          });
          if (this.active.size > 128) {
            const oldestKey = this.active.keys().next().value;
            if (typeof oldestKey === "string") await this.closeKey(oldestKey);
          }
          break;
        }
        case "close":
          await this.closeKey(transition.key);
          break;
        case "close-class":
          await this.closeClass(transition.notificationClass);
          break;
      }
    }
  }

  async close(): Promise<void> {
    await this.closeClass("approval");
    await this.closeClass("input");
    this.active.clear();
  }

  private async closeClass(notificationClass: OmpNotificationClass): Promise<void> {
    for (const [key, notification] of [...this.active.entries()]) {
      if (notification.notificationClass === notificationClass) await this.closeKey(key);
    }
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, notification] of this.active) {
      if (notification.expiresAt !== null && notification.expiresAt <= now) {
        this.active.delete(key);
      }
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

async function commandIsExecutable(command: string): Promise<boolean> {
  const candidates =
    path.isAbsolute(command) || command.includes(path.sep)
      ? [path.resolve(command)]
      : (process.env.PATH ?? "")
          .split(path.delimiter)
          .filter(Boolean)
          .map((directory) => path.join(directory, command));
  for (const candidate of candidates) {
    try {
      const metadata = await stat(candidate);
      if (!metadata.isFile()) continue;
      await access(candidate, constants.X_OK);
      return true;
    } catch {
      // Keep searching PATH; an unavailable optional transport is not an OMP failure.
    }
  }
  return false;
}
