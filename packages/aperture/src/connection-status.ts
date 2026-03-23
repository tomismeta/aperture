import type {
  AttentionConnectionAction,
  AttentionConnectionEntry,
  AttentionConnectionSnapshot,
  AttentionConnectionState,
} from "@aperture/tui";

type ConnectionListener = (snapshot: AttentionConnectionSnapshot) => void;

export class LauncherConnectionStore {
  private readonly order: string[];
  private readonly entries = new Map<string, AttentionConnectionEntry>();
  private readonly suppressed = new Set<string>();
  private readonly listeners = new Set<ConnectionListener>();

  constructor(entries: AttentionConnectionEntry[]) {
    this.order = entries.map((entry) => entry.id);
    for (const entry of entries) {
      this.entries.set(entry.id, { ...entry });
    }
  }

  getSnapshot(): AttentionConnectionSnapshot {
    const baseEntries = this.order
      .map((id) => this.entries.get(id))
      .filter((entry): entry is AttentionConnectionEntry => entry !== undefined)
      .filter((entry) => !this.suppressed.has(entry.id));
    const entries = baseEntries.map((entry) => {
      const actions = buildEntryActions(entry);
      return actions.length > 0 ? { ...entry, actions } : entry;
    });
    const summary = summarize(entries);
    const actions = buildGlobalActions(entries, this.suppressed.size > 0 && !hasPending(entries));
    for (const entry of entries) {
      if (entry.actions) {
        actions.push(...entry.actions);
      }
    }

    return summary
      ? (actions.length > 0 ? { summary, entries, actions } : { summary, entries })
      : (actions.length > 0 ? { entries, actions } : { entries });
  }

  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(id: string, patch: Partial<Omit<AttentionConnectionEntry, "id">>): void {
    const current = this.entries.get(id);
    if (!current) {
      return;
    }
    const next = {
      ...current,
      ...patch,
    };
    if (sameConnectionEntry(current, next)) {
      return;
    }
    this.entries.set(id, next);
    this.emit();
  }

  suppressPending(): void {
    for (const id of this.order) {
      const entry = this.entries.get(id);
      if (!entry) {
        continue;
      }
      if (entry.state !== "ready" && entry.state !== "disabled") {
        this.suppressed.add(id);
      }
    }
    this.emit();
  }

  restoreSuppressed(): void {
    if (this.suppressed.size === 0) {
      return;
    }
    this.suppressed.clear();
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

function summarize(entries: AttentionConnectionEntry[]): string | undefined {
  if (entries.length === 0) {
    return undefined;
  }

  if (entries.some((entry) => entry.state === "error" || entry.state === "action")) {
    return "Finish setup to bring your agent surfaces online.";
  }

  if (entries.some((entry) => entry.state === "starting")) {
    return "Bringing your agent surfaces online.";
  }

  if (entries.some((entry) => entry.state === "ready")) {
    return "Your agent surfaces are ready.";
  }

  if (entries.every((entry) => entry.state === "disabled")) {
    return "All integrations are disabled for this Aperture session.";
  }

  return undefined;
}

function buildGlobalActions(
  entries: AttentionConnectionEntry[],
  showSetupAction: boolean,
): AttentionConnectionAction[] {
  const actions: AttentionConnectionAction[] = [];

  if (entries.some((entry) => entry.state === "starting" || entry.state === "action" || entry.state === "error")) {
    actions.push({ id: "skip-setup", key: "s", label: "skip for now" });
  }

  if (showSetupAction) {
    actions.push({ id: "show-setup", key: "s", label: "show setup" });
  }

  return actions;
}

function hasPending(entries: AttentionConnectionEntry[]): boolean {
  return entries.some((entry) => entry.state !== "ready" && entry.state !== "disabled");
}

function buildEntryActions(entry: AttentionConnectionEntry): AttentionConnectionAction[] {
  if (entry.state === "ready" || entry.state === "disabled") {
    return [];
  }

  switch (entry.id) {
    case "claude":
      return [{ id: "refresh-claude", key: "c", label: "finish Claude setup" }];
    case "opencode":
      return [{ id: "retry-opencode", key: "r", label: "retry OpenCode" }];
    default:
      return [];
  }
}

export function makeConnectionEntry(
  id: string,
  label: string,
  state: AttentionConnectionState,
  detail: string,
  hint?: string,
): AttentionConnectionEntry {
  return hint
    ? { id, label, state, detail, hint }
    : { id, label, state, detail };
}

function sameConnectionEntry(
  a: AttentionConnectionEntry,
  b: AttentionConnectionEntry,
): boolean {
  return a.id === b.id
    && a.label === b.label
    && a.state === b.state
    && a.detail === b.detail
    && a.hint === b.hint;
}
