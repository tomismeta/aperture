import type { AttentionFrame } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AttentionSignal } from "./interaction-signal.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";
import { readBoundedToolFamily, sourceKey } from "./interaction-taxonomy.js";
import type { MemoryProfile } from "./profile-store.js";

export function distillMemoryProfile(
  baseMemoryProfile: MemoryProfile,
  signals: AttentionSignal[],
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

export function signalMetadataForFrame(frame: AttentionFrame): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    consequence: frame.consequence,
  };

  const toolFamily = signalToolFamily(frame);
  if (toolFamily) {
    metadata.toolFamily = toolFamily;
  }

  const key = sourceKey(frame.source);
  if (key) {
    metadata.sourceKey = key;
  }

  return metadata;
}

export function signalMetadataForCandidate(candidate: AttentionCandidate): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    consequence: candidate.consequence,
  };

  const toolFamily = signalToolFamily(candidate);
  if (toolFamily) {
    metadata.toolFamily = toolFamily;
  }

  const key = sourceKey(candidate.source);
  if (key) {
    metadata.sourceKey = key;
  }

  return metadata;
}

function signalToolFamily(input: AttentionFrame | AttentionCandidate): string | null {
  return readBoundedToolFamily(input);
}

function toolFamilyMemory(
  baseMemoryProfile: MemoryProfile,
  signals: AttentionSignal[],
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
  const interactions = new Map<string, {
    toolFamily: string;
    presented: boolean;
    responded: boolean;
    dismissed: boolean;
    responseLatencyMs?: number;
    dismissalLatencyMs?: number;
    contextExpanded: boolean;
    deferred: boolean;
    returned: boolean;
  }>();

  for (const signal of signals) {
    const toolFamily = readSignalString(signal.metadata, "toolFamily");
    if (!toolFamily) {
      continue;
    }

    const interactionKey = `${toolFamily}::${signal.interactionId}`;
    const current = interactions.get(interactionKey) ?? {
      toolFamily,
      presented: false,
      responded: false,
      dismissed: false,
      contextExpanded: false,
      deferred: false,
      returned: false,
    };
    switch (signal.kind) {
      case "presented":
        current.presented = true;
        break;
      case "responded":
        current.responded = true;
        current.dismissed = false;
        if (signal.latencyMs !== undefined) {
          current.responseLatencyMs = signal.latencyMs;
        }
        break;
      case "dismissed":
        if (!current.responded) {
          current.dismissed = true;
          if (signal.latencyMs !== undefined) {
            current.dismissalLatencyMs = signal.latencyMs;
          }
        }
        break;
      case "context_expanded":
        current.contextExpanded = true;
        break;
      case "deferred":
        current.deferred = true;
        break;
      case "returned":
        current.returned = true;
        break;
    }

    interactions.set(interactionKey, current);
  }

  for (const interaction of interactions.values()) {
    const current = session.get(interaction.toolFamily) ?? {
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

    if (interaction.presented || interaction.responded || interaction.dismissed) {
      current.presentations += 1;
    }
    if (interaction.responded) {
      current.responses += 1;
      if (interaction.responseLatencyMs !== undefined) {
        current.responseLatencyTotal += interaction.responseLatencyMs;
        current.responseLatencyCount += 1;
      }
    } else if (interaction.dismissed) {
      current.dismissals += 1;
      if (interaction.dismissalLatencyMs !== undefined) {
        current.dismissalLatencyTotal += interaction.dismissalLatencyMs;
        current.dismissalLatencyCount += 1;
      }
    }
    if (interaction.contextExpanded) {
      current.contextExpanded += 1;
    }
    if (interaction.deferred) {
      current.deferrals += 1;
      if (interaction.returned) {
        current.returns += 1;
      }
    }

    session.set(interaction.toolFamily, current);
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
    const currentResponseAverage = current.responseLatencyCount > 0
      ? current.responseLatencyTotal / current.responseLatencyCount
      : undefined;
    const currentDismissalAverage = current.dismissalLatencyCount > 0
      ? current.dismissalLatencyTotal / current.dismissalLatencyCount
      : undefined;
    const previousContextExpanded = previous.contextExpansionRate !== undefined
      ? previous.contextExpansionRate * previous.presentations
      : 0;
    const currentContextExpanded = current.contextExpanded;
    next[toolFamily] = {
      presentations,
      responses,
      dismissals,
      ...(currentResponseAverage !== undefined
        ? {
            avgResponseLatencyMs: weightedAverage(
              previous.avgResponseLatencyMs,
              previous.responses,
              currentResponseAverage,
              current.responseLatencyCount,
            ),
          }
        : previous.avgResponseLatencyMs !== undefined
          ? { avgResponseLatencyMs: previous.avgResponseLatencyMs }
          : {}),
      ...(currentDismissalAverage !== undefined
        ? {
            avgDismissalLatencyMs: weightedAverage(
              previous.avgDismissalLatencyMs,
              previous.dismissals,
              currentDismissalAverage,
              current.dismissalLatencyCount,
            ),
          }
        : previous.avgDismissalLatencyMs !== undefined
          ? { avgDismissalLatencyMs: previous.avgDismissalLatencyMs }
          : {}),
      ...(presentations > 0
        ? {
            contextExpansionRate: roundRate((previousContextExpanded + currentContextExpanded) / presentations),
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
  signals: AttentionSignal[],
): NonNullable<MemoryProfile["sourceTrust"]> {
  const next = structuredClone(baseMemoryProfile.sourceTrust ?? {});
  const interactions = new Map<string, {
    source: string;
    consequence: "low" | "medium" | "high";
    responded: boolean;
    rejected: boolean;
    dismissed: boolean;
  }>();

  for (const signal of signals) {
    const source = readSignalString(signal.metadata, "sourceKey");
    const consequence = readSignalString(signal.metadata, "consequence");
    if (!source || (consequence !== "low" && consequence !== "medium" && consequence !== "high")) {
      continue;
    }
    const interactionKey = `${source}::${consequence}::${signal.interactionId}`;
    const current = interactions.get(interactionKey) ?? {
      source,
      consequence,
      responded: false,
      rejected: false,
      dismissed: false,
    };
    if (signal.kind === "responded") {
      current.responded = true;
      current.dismissed = false;
      current.rejected = signal.responseKind === "rejected";
    } else if (signal.kind === "dismissed") {
      if (!current.responded) {
        current.dismissed = true;
      }
    }

    interactions.set(interactionKey, current);
  }

  for (const interaction of interactions.values()) {
    const current = next[interaction.source]?.[interaction.consequence] ?? {
      confirmations: 0,
      disagreements: 0,
      trustAdjustment: 0,
    };

    if (interaction.responded) {
      if (interaction.rejected) {
        current.disagreements += 1;
      } else {
        current.confirmations += 1;
      }
    } else if (interaction.dismissed) {
      current.disagreements += 1;
    }

    const total = current.confirmations + current.disagreements;
    current.trustAdjustment = total > 0
      ? Math.round((((current.confirmations - current.disagreements) / total) * 10) * Math.min(total / 5, 1))
      : 0;

    next[interaction.source] = {
      ...(next[interaction.source] ?? {}),
      [interaction.consequence]: current,
    };
  }

  return next;
}

function consequenceMemory(
  baseMemoryProfile: MemoryProfile,
  signals: AttentionSignal[],
): NonNullable<MemoryProfile["consequenceProfiles"]> {
  const next = { ...(baseMemoryProfile.consequenceProfiles ?? {}) };
  const interactions = new Map<string, { consequence: "low" | "medium" | "high"; rejected: boolean }>();

  for (const signal of signals) {
    const consequence = readSignalString(signal.metadata, "consequence");
    if (consequence !== "low" && consequence !== "medium" && consequence !== "high") {
      continue;
    }

    if (signal.kind !== "responded") {
      continue;
    }

    interactions.set(`${consequence}::${signal.interactionId}`, {
      consequence,
      rejected: signal.responseKind === "rejected",
    });
  }

  const totals = new Map<string, { reviewed: number; rejected: number }>();
  for (const interaction of interactions.values()) {
    const current = totals.get(interaction.consequence) ?? { reviewed: 0, rejected: 0 };
    current.reviewed += 1;
    if (interaction.rejected) {
      current.rejected += 1;
    }
    totals.set(interaction.consequence, current);
  }

  for (const [consequence, current] of totals.entries()) {
    const previous = next[consequence] ?? { rejectionRate: 0, reviewedCount: 0 };
    const reviewedCount = (previous.reviewedCount ?? 0) + current.reviewed;
    next[consequence] = {
      rejectionRate: reviewedCount > 0
        ? roundRate((((previous.reviewedCount ?? 0) * previous.rejectionRate) + current.rejected) / reviewedCount)
        : 0,
      reviewedCount,
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

function weightedAverage(
  previousAverage: number | undefined,
  previousCount: number,
  currentAverage: number,
  currentCount: number,
): number {
  const totalCount = previousCount + currentCount;
  if (totalCount <= 0) {
    return Math.round(currentAverage);
  }

  const previousTotal = (previousAverage ?? 0) * previousCount;
  const currentTotal = currentAverage * currentCount;
  return Math.round((previousTotal + currentTotal) / totalCount);
}
