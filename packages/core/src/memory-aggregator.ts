import type { AttentionFrame } from "./frame.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type { AttentionSignal } from "./interaction-signal.js";
import { APERTURE_STATE_SCHEMA_VERSION } from "./judgment-defaults.js";
import { readBoundedToolFamily, sourceKey } from "./interaction-taxonomy.js";
import type { MemoryProfile, SourceTrustMemory } from "./profile-store.js";

type ToolInteraction = {
  family: string;
  presented: boolean;
  responded: boolean;
  dismissed: boolean;
  responseLatency?: number;
  dismissalLatency?: number;
  expanded: boolean;
  deferred: boolean;
  returned: boolean;
};
type SourceInteraction = {
  source: string;
  consequence: string;
  responded: boolean;
  rejected: boolean;
  dismissed: boolean;
};
type ToolTotals = {
  presentations: number;
  responses: number;
  dismissals: number;
  responseLatency: number;
  responseSamples: number;
  dismissalLatency: number;
  dismissalSamples: number;
  expanded: number;
  deferrals: number;
  returns: number;
  baselineReturnAfterDeferralRate?: number | undefined;
};
type MemoryContributions = {
  tools: Map<string, ToolTotals>;
  sources: Map<
    string,
    { source: string; consequence: string; confirmations: number; disagreements: number }
  >;
  consequences: Map<string, { reviewed: number; rejected: number }>;
};

const TOOL_MEMORY_SIGNAL_KINDS: Partial<Record<AttentionSignal["kind"], true>> = {
  presented: true,
  responded: true,
  dismissed: true,
  context_expanded: true,
  deferred: true,
  returned: true,
};

/** Session accounting is independent of the bounded, public feedback history. */
export class MemoryAccumulator {
  private readonly tools = new Map<string, ToolInteraction>();
  private readonly sources = new Map<string, SourceInteraction>();
  private readonly consequences = new Map<string, { consequence: string; rejected: boolean }>();
  private accounted: MemoryContributions | null = null;

  record(signal: AttentionSignal): void {
    const key = JSON.stringify([signal.taskId, signal.interactionId]);
    const family = readSignalString(signal.metadata, "toolFamily");
    const source = readSignalString(signal.metadata, "sourceKey");
    const consequence = readSignalString(signal.metadata, "consequence");
    const validConsequence =
      consequence === "low" || consequence === "medium" || consequence === "high";
    if (family && TOOL_MEMORY_SIGNAL_KINDS[signal.kind]) {
      const current = this.tools.get(key) ?? {
        family,
        presented: false,
        responded: false,
        dismissed: false,
        expanded: false,
        deferred: false,
        returned: false,
      };
      current.family = family;
      switch (signal.kind) {
        case "presented":
          current.presented = true;
          break;
        case "responded":
          current.responded = true;
          current.dismissed = false;
          if (signal.latencyMs !== undefined) current.responseLatency = signal.latencyMs;
          break;
        case "dismissed":
          if (!current.responded) {
            current.dismissed = true;
            if (signal.latencyMs !== undefined) current.dismissalLatency = signal.latencyMs;
          }
          break;
        case "context_expanded":
          current.expanded = true;
          break;
        case "deferred":
          current.deferred = true;
          break;
        case "returned":
          current.returned = true;
          break;
      }
      this.tools.set(key, current);
    }
    if (
      source &&
      validConsequence &&
      (signal.kind === "responded" || signal.kind === "dismissed")
    ) {
      const current = this.sources.get(key) ?? {
        source,
        consequence,
        responded: false,
        rejected: false,
        dismissed: false,
      };
      current.source = source;
      current.consequence = consequence;
      if (signal.kind === "responded") {
        current.responded = true;
        current.dismissed = false;
        current.rejected = signal.responseKind === "rejected";
      } else if (!current.responded) {
        current.dismissed = true;
      }
      this.sources.set(key, current);
    }
    if (validConsequence && signal.kind === "responded") {
      this.consequences.set(key, {
        consequence,
        rejected: signal.responseKind === "rejected",
      });
    }
  }

  snapshot(
    base: MemoryProfile,
    now: string,
  ): { profile: MemoryProfile; accounting: MemoryContributions } {
    const accounting = this.contributions();
    const profile = structuredClone(base);
    profile.version = APERTURE_STATE_SCHEMA_VERSION;
    profile.updatedAt = now;
    profile.sessionCount += this.accounted === null ? 1 : 0;
    for (const family of new Set([
      ...accounting.tools.keys(),
      ...(this.accounted?.tools.keys() ?? []),
    ])) {
      const current = accounting.tools.get(family) ?? emptyToolTotals();
      const prior = this.accounted?.tools.get(family) ?? emptyToolTotals();
      const previous = ownValue(profile.toolFamilies, family) ?? {
        presentations: 0,
        responses: 0,
        dismissals: 0,
      };
      // Session deferrals override this rate; a reclassification must restore the prior-session value.
      current.baselineReturnAfterDeferralRate =
        prior.deferrals > 0
          ? prior.baselineReturnAfterDeferralRate
          : previous.returnAfterDeferralRate;
      const presentations = previous.presentations + current.presentations - prior.presentations;
      const responses = previous.responses + current.responses - prior.responses;
      const dismissals = previous.dismissals + current.dismissals - prior.dismissals;
      const avgResponseLatencyMs = deltaAverage(
        previous.avgResponseLatencyMs,
        previous.responses - prior.responses + prior.responseSamples,
        current.responseLatency - prior.responseLatency,
        current.responseSamples - prior.responseSamples,
      );
      const avgDismissalLatencyMs = deltaAverage(
        previous.avgDismissalLatencyMs,
        previous.dismissals - prior.dismissals + prior.dismissalSamples,
        current.dismissalLatency - prior.dismissalLatency,
        current.dismissalSamples - prior.dismissalSamples,
      );
      profile.toolFamilies ??= {};
      setOwnValue(profile.toolFamilies, family, {
        presentations,
        responses,
        dismissals,
        ...(avgResponseLatencyMs === undefined ? {} : { avgResponseLatencyMs }),
        ...(avgDismissalLatencyMs === undefined ? {} : { avgDismissalLatencyMs }),
        ...(presentations > 0
          ? {
              contextExpansionRate: roundRate(
                ((previous.contextExpansionRate ?? 0) * previous.presentations +
                  current.expanded -
                  prior.expanded) /
                  presentations,
              ),
            }
          : {}),
        ...(current.deferrals > 0
          ? { returnAfterDeferralRate: roundRate(current.returns / current.deferrals) }
          : current.baselineReturnAfterDeferralRate === undefined
            ? {}
            : { returnAfterDeferralRate: current.baselineReturnAfterDeferralRate }),
      });
    }
    for (const [key, { source, consequence }] of new Map([
      ...(this.accounted?.sources ?? []),
      ...accounting.sources,
    ])) {
      const current = accounting.sources.get(key);
      const prior = this.accounted?.sources.get(key);
      const sourceTrust: Record<string, SourceTrustMemory> =
        ownValue(profile.sourceTrust, source) ?? {};
      const previous = ownValue(sourceTrust, consequence);
      const confirmations =
        (previous?.confirmations ?? 0) +
        (current?.confirmations ?? 0) -
        (prior?.confirmations ?? 0);
      const disagreements =
        (previous?.disagreements ?? 0) +
        (current?.disagreements ?? 0) -
        (prior?.disagreements ?? 0);
      const total = confirmations + disagreements;
      profile.sourceTrust ??= {};
      setOwnValue(profile.sourceTrust, source, sourceTrust);
      setOwnValue(sourceTrust, consequence, {
        confirmations,
        disagreements,
        trustAdjustment:
          total > 0
            ? Math.round(((confirmations - disagreements) / total) * 10 * Math.min(total / 5, 1))
            : 0,
      });
    }
    for (const consequence of new Set([
      ...accounting.consequences.keys(),
      ...(this.accounted?.consequences.keys() ?? []),
    ])) {
      const current = accounting.consequences.get(consequence);
      const prior = this.accounted?.consequences.get(consequence);
      const previous = ownValue(profile.consequenceProfiles, consequence);
      const previousCount = previous?.reviewedCount ?? 0;
      const reviewedCount = previousCount + (current?.reviewed ?? 0) - (prior?.reviewed ?? 0);
      profile.consequenceProfiles ??= {};
      setOwnValue(profile.consequenceProfiles, consequence, {
        reviewedCount,
        rejectionRate:
          reviewedCount > 0
            ? roundRate(
                (previousCount * (previous?.rejectionRate ?? 0) +
                  (current?.rejected ?? 0) -
                  (prior?.rejected ?? 0)) /
                  reviewedCount,
              )
            : 0,
      });
    }
    return { profile, accounting };
  }

  commit(accounting: MemoryContributions): void {
    this.accounted = accounting;
  }

  private contributions(): MemoryContributions {
    const result: MemoryContributions = {
      tools: new Map(),
      sources: new Map(),
      consequences: new Map(),
    };
    for (const interaction of this.tools.values()) {
      const totals = result.tools.get(interaction.family) ?? emptyToolTotals();
      if (interaction.presented || interaction.responded || interaction.dismissed)
        totals.presentations += 1;
      if (interaction.responded) {
        totals.responses += 1;
        if (interaction.responseLatency !== undefined) {
          totals.responseLatency += interaction.responseLatency;
          totals.responseSamples += 1;
        }
      } else if (interaction.dismissed) {
        totals.dismissals += 1;
        if (interaction.dismissalLatency !== undefined) {
          totals.dismissalLatency += interaction.dismissalLatency;
          totals.dismissalSamples += 1;
        }
      }
      if (interaction.expanded) totals.expanded += 1;
      if (interaction.deferred) {
        totals.deferrals += 1;
        if (interaction.returned) totals.returns += 1;
      }
      result.tools.set(interaction.family, totals);
    }
    for (const interaction of this.sources.values()) {
      const key = JSON.stringify([interaction.source, interaction.consequence]);
      const totals = result.sources.get(key) ?? {
        source: interaction.source,
        consequence: interaction.consequence,
        confirmations: 0,
        disagreements: 0,
      };
      if (interaction.responded) {
        if (interaction.rejected) totals.disagreements += 1;
        else totals.confirmations += 1;
      } else if (interaction.dismissed) totals.disagreements += 1;
      result.sources.set(key, totals);
    }
    for (const interaction of this.consequences.values()) {
      const totals = result.consequences.get(interaction.consequence) ?? {
        reviewed: 0,
        rejected: 0,
      };
      totals.reviewed += 1;
      if (interaction.rejected) totals.rejected += 1;
      result.consequences.set(interaction.consequence, totals);
    }
    return result;
  }
}

export function signalMetadataForFrame(frame: AttentionFrame): Record<string, unknown> {
  const metadata = signalMetadataForCandidate(frame);
  const episode = frame.metadata?.episode;
  if (episode && typeof episode === "object" && !Array.isArray(episode)) metadata.episode = episode;
  return metadata;
}

export function signalMetadataForCandidate(
  candidate: AttentionCandidate | AttentionFrame,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { consequence: candidate.consequence };
  const toolFamily = readBoundedToolFamily(candidate);
  if (toolFamily) metadata.toolFamily = toolFamily;
  const key = sourceKey(candidate.source);
  if (key) metadata.sourceKey = key;
  return metadata;
}

function emptyToolTotals(): ToolTotals {
  return {
    presentations: 0,
    responses: 0,
    dismissals: 0,
    responseLatency: 0,
    responseSamples: 0,
    dismissalLatency: 0,
    dismissalSamples: 0,
    expanded: 0,
    deferrals: 0,
    returns: 0,
  };
}

function deltaAverage(
  previous: number | undefined,
  previousCount: number,
  totalDelta: number,
  countDelta: number,
): number | undefined {
  if (totalDelta === 0 && countDelta === 0) return previous;
  const count = (previous === undefined ? 0 : previousCount) + countDelta;
  return count > 0 ? Math.round(((previous ?? 0) * previousCount + totalDelta) / count) : undefined;
}

function ownValue<T>(values: Record<string, T> | undefined, key: string): T | undefined {
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}

function setOwnValue<T>(values: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(values, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function readSignalString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}
