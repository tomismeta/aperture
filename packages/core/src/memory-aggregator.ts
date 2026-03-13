import type { Frame } from "./frame.js";
import type { InteractionSignal } from "./interaction-signal.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import { inferToolFamily, sourceKey } from "./interaction-taxonomy.js";
import type { MemoryProfile } from "./profile-store.js";

export function buildMemoryProfile(
  baseMemoryProfile: MemoryProfile,
  signals: InteractionSignal[],
  now: string,
): MemoryProfile {
  const toolFamilies = toolFamilyMemory(baseMemoryProfile, signals);
  const sourceTrust = sourceTrustMemory(baseMemoryProfile, signals);
  const consequenceProfiles = consequenceMemory(baseMemoryProfile, signals);

  return {
    ...baseMemoryProfile,
    version: MARKDOWN_SCHEMA_VERSION,
    updatedAt: now,
    sessionCount: baseMemoryProfile.sessionCount + 1,
    ...(Object.keys(toolFamilies).length > 0 ? { toolFamilies } : {}),
    ...(Object.keys(sourceTrust).length > 0 ? { sourceTrust } : {}),
    ...(Object.keys(consequenceProfiles).length > 0 ? { consequenceProfiles } : {}),
  };
}

export function signalMetadataForFrame(frame: Frame): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    consequence: frame.consequence,
  };

  const toolFamily = inferToolFamily(frame);
  if (toolFamily) {
    metadata.toolFamily = toolFamily;
  }

  const key = sourceKey(frame.source);
  if (key) {
    metadata.sourceKey = key;
  }

  return metadata;
}

function toolFamilyMemory(
  baseMemoryProfile: MemoryProfile,
  signals: InteractionSignal[],
): NonNullable<MemoryProfile["toolFamilies"]> {
  const next = { ...(baseMemoryProfile.toolFamilies ?? {}) };
  const session = new Map<string, {
    presentations: number;
    responses: number;
    dismissals: number;
    responseLatencyTotal: number;
    responseLatencyCount: number;
    dismissalLatencyTotal: number;
    dismissalLatencyCount: number;
    contextExpanded: number;
    deferrals: number;
    returns: number;
  }>();

  for (const signal of signals) {
    const toolFamily = readSignalString(signal.metadata, "toolFamily");
    if (!toolFamily) {
      continue;
    }

    const current = session.get(toolFamily) ?? {
      presentations: 0,
      responses: 0,
      dismissals: 0,
      responseLatencyTotal: 0,
      responseLatencyCount: 0,
      dismissalLatencyTotal: 0,
      dismissalLatencyCount: 0,
      contextExpanded: 0,
      deferrals: 0,
      returns: 0,
    };

    switch (signal.kind) {
      case "presented":
        current.presentations += 1;
        break;
      case "responded":
        current.responses += 1;
        if (signal.latencyMs !== undefined) {
          current.responseLatencyTotal += signal.latencyMs;
          current.responseLatencyCount += 1;
        }
        break;
      case "dismissed":
        current.dismissals += 1;
        if (signal.latencyMs !== undefined) {
          current.dismissalLatencyTotal += signal.latencyMs;
          current.dismissalLatencyCount += 1;
        }
        break;
      case "context_expanded":
        current.contextExpanded += 1;
        break;
      case "deferred":
        current.deferrals += 1;
        break;
      case "returned":
        current.returns += 1;
        break;
    }

    session.set(toolFamily, current);
  }

  for (const [toolFamily, current] of session.entries()) {
    const previous = next[toolFamily] ?? {
      presentations: 0,
      responses: 0,
      dismissals: 0,
    };
    const presentations = previous.presentations + current.presentations;
    const responses = previous.responses + current.responses;
    const dismissals = previous.dismissals + current.dismissals;
    next[toolFamily] = {
      presentations,
      responses,
      dismissals,
      ...(current.responseLatencyCount > 0
        ? {
            avgResponseLatencyMs: Math.round(current.responseLatencyTotal / current.responseLatencyCount),
          }
        : previous.avgResponseLatencyMs !== undefined
          ? { avgResponseLatencyMs: previous.avgResponseLatencyMs }
          : {}),
      ...(current.dismissalLatencyCount > 0
        ? {
            avgDismissalLatencyMs: Math.round(current.dismissalLatencyTotal / current.dismissalLatencyCount),
          }
        : previous.avgDismissalLatencyMs !== undefined
          ? { avgDismissalLatencyMs: previous.avgDismissalLatencyMs }
          : {}),
      ...(presentations > 0
        ? {
            contextExpansionRate: roundRate(current.contextExpanded / presentations),
          }
        : previous.contextExpansionRate !== undefined
          ? { contextExpansionRate: previous.contextExpansionRate }
          : {}),
      ...(current.deferrals > 0
        ? {
            returnAfterDeferralRate: roundRate(current.returns / current.deferrals),
          }
        : previous.returnAfterDeferralRate !== undefined
          ? { returnAfterDeferralRate: previous.returnAfterDeferralRate }
          : {}),
    };
  }

  return next;
}

function sourceTrustMemory(
  baseMemoryProfile: MemoryProfile,
  signals: InteractionSignal[],
): NonNullable<MemoryProfile["sourceTrust"]> {
  const next = structuredClone(baseMemoryProfile.sourceTrust ?? {});

  for (const signal of signals) {
    const source = readSignalString(signal.metadata, "sourceKey");
    const consequence = readSignalString(signal.metadata, "consequence");
    if (!source || (consequence !== "low" && consequence !== "medium" && consequence !== "high")) {
      continue;
    }

    const current = next[source]?.[consequence] ?? {
      confirmations: 0,
      disagreements: 0,
      trustAdjustment: 0,
    };

    if (signal.kind === "responded") {
      if (signal.responseKind === "rejected") {
        current.disagreements += 1;
      } else {
        current.confirmations += 1;
      }
    } else if (signal.kind === "dismissed") {
      current.disagreements += 1;
    }

    const total = current.confirmations + current.disagreements;
    current.trustAdjustment = total > 0
      ? Math.round(((current.confirmations - current.disagreements) / total) * 10)
      : 0;

    next[source] = {
      ...(next[source] ?? {}),
      [consequence]: current,
    };
  }

  return next;
}

function consequenceMemory(
  baseMemoryProfile: MemoryProfile,
  signals: InteractionSignal[],
): NonNullable<MemoryProfile["consequenceProfiles"]> {
  const next = { ...(baseMemoryProfile.consequenceProfiles ?? {}) };
  const totals = new Map<string, { reviewed: number; rejected: number }>();

  for (const signal of signals) {
    const consequence = readSignalString(signal.metadata, "consequence");
    if (consequence !== "low" && consequence !== "medium" && consequence !== "high") {
      continue;
    }

    if (signal.kind !== "responded") {
      continue;
    }

    const current = totals.get(consequence) ?? { reviewed: 0, rejected: 0 };
    current.reviewed += 1;
    if (signal.responseKind === "rejected") {
      current.rejected += 1;
    }
    totals.set(consequence, current);
  }

  for (const [consequence, current] of totals.entries()) {
    next[consequence] = {
      rejectionRate: current.reviewed > 0 ? roundRate(current.rejected / current.reviewed) : 0,
    };
  }

  return next;
}

function readSignalString(metadata: Record<string, unknown> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}
