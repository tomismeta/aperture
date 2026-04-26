import type { ApertureRuntimeExplanationSnapshot } from "@aperture/runtime/internal";

import {
  type Guard,
  hasShape,
  isNumber,
  isRecord,
  isString,
} from "./shape.js";

export type WorkflowTargetMetadata = NonNullable<ApertureRuntimeExplanationSnapshot["targetMetadata"]>;

export type WorkflowTargetMetadataSummary = {
  automation?: string;
  execution?: string;
  governance?: string;
  usage?: string;
};

export type WorkflowTargetMetadataRollup = {
  automationModes: string[];
  surfaces: string[];
  runners: string[];
  placements: string[];
  environments: string[];
  approvalStates: string[];
  models: string[];
  usageTotals: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
};

export function validateWorkflowTargetMetadata(value: unknown): WorkflowTargetMetadata | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    !hasShape(
      value,
      {},
      {
        automation: validateWithShape({
          runMode: isString,
          trigger: isString,
          recurrence: isString,
          scheduleId: isString,
        }),
        execution: validateWithShape({
          surface: isString,
          placement: isString,
          runner: isString,
          environment: isString,
        }),
        governance: validateWithShape({
          policyId: isString,
          approvalState: isString,
          approvalId: isString,
          decisionId: isString,
        }),
        usage: validateWithShape({
          model: isString,
          modelRouting: isString,
          inputTokens: isNumber,
          cachedInputTokens: isNumber,
          outputTokens: isNumber,
          costUsd: isNumber,
        }),
      },
    )
  ) {
    return null;
  }

  return hasWorkflowTargetMetadata(value) ? value as WorkflowTargetMetadata : null;
}

export function summarizeWorkflowTargetMetadata(
  value: WorkflowTargetMetadata | null | undefined,
): WorkflowTargetMetadataSummary | undefined {
  if (!value) {
    return undefined;
  }

  const automation = summarizeAutomation(value.automation);
  const execution = summarizeExecution(value.execution);
  const governance = summarizeGovernance(value.governance);
  const usage = summarizeUsage(value.usage);

  if (!automation && !execution && !governance && !usage) {
    return undefined;
  }

  return {
    ...(automation ? { automation } : {}),
    ...(execution ? { execution } : {}),
    ...(governance ? { governance } : {}),
    ...(usage ? { usage } : {}),
  };
}

export function rollupWorkflowTargetMetadata(
  values: Iterable<WorkflowTargetMetadata | null | undefined>,
): WorkflowTargetMetadataRollup {
  return mergeWorkflowTargetMetadataRollups(
    [...values]
      .filter((value): value is WorkflowTargetMetadata => value !== null && value !== undefined)
      .map((value) => ({
        automationModes: collectStringValues(value.automation, "runMode"),
        surfaces: collectStringValues(value.execution, "surface"),
        runners: collectStringValues(value.execution, "runner"),
        placements: collectStringValues(value.execution, "placement"),
        environments: collectStringValues(value.execution, "environment"),
        approvalStates: collectStringValues(value.governance, "approvalState"),
        models: collectStringValues(value.usage, "model"),
        usageTotals: {
          inputTokens: readNumber(value.usage ?? {}, "inputTokens") ?? 0,
          cachedInputTokens: readNumber(value.usage ?? {}, "cachedInputTokens") ?? 0,
          outputTokens: readNumber(value.usage ?? {}, "outputTokens") ?? 0,
          costUsd: readNumber(value.usage ?? {}, "costUsd") ?? 0,
        },
      })),
  );
}

export function mergeWorkflowTargetMetadataRollups(
  values: Iterable<WorkflowTargetMetadataRollup | null | undefined>,
): WorkflowTargetMetadataRollup {
  const automationModes = new Set<string>();
  const surfaces = new Set<string>();
  const runners = new Set<string>();
  const placements = new Set<string>();
  const environments = new Set<string>();
  const approvalStates = new Set<string>();
  const models = new Set<string>();
  const usageTotals = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
  };

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const entry of value.automationModes) {
      automationModes.add(entry);
    }
    for (const entry of value.surfaces) {
      surfaces.add(entry);
    }
    for (const entry of value.runners) {
      runners.add(entry);
    }
    for (const entry of value.placements) {
      placements.add(entry);
    }
    for (const entry of value.environments) {
      environments.add(entry);
    }
    for (const entry of value.approvalStates) {
      approvalStates.add(entry);
    }
    for (const entry of value.models) {
      models.add(entry);
    }
    usageTotals.inputTokens += value.usageTotals.inputTokens;
    usageTotals.cachedInputTokens += value.usageTotals.cachedInputTokens;
    usageTotals.outputTokens += value.usageTotals.outputTokens;
    usageTotals.costUsd += value.usageTotals.costUsd;
  }

  return {
    automationModes: [...automationModes].sort(),
    surfaces: [...surfaces].sort(),
    runners: [...runners].sort(),
    placements: [...placements].sort(),
    environments: [...environments].sort(),
    approvalStates: [...approvalStates].sort(),
    models: [...models].sort(),
    usageTotals,
  };
}

export function formatWorkflowTargetMetadataRollupSummary(
  value: WorkflowTargetMetadataRollup | null | undefined,
): string | undefined {
  if (!value || !hasWorkflowTargetMetadataRollup(value)) {
    return undefined;
  }

  const parts = [
    formatWorkflowField("automation", value.automationModes),
    formatWorkflowField("surfaces", value.surfaces),
    formatWorkflowField("runners", value.runners),
    formatWorkflowField("placements", value.placements),
    formatWorkflowField("environments", value.environments),
    formatWorkflowField("approval states", value.approvalStates),
    formatWorkflowField("models", value.models),
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join("; ") : undefined;
}

export function formatWorkflowTargetMetadataRollupUsage(
  value: WorkflowTargetMetadataRollup | null | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const parts = [
    value.usageTotals.inputTokens > 0 ? `input=${formatCount(value.usageTotals.inputTokens)}` : null,
    value.usageTotals.cachedInputTokens > 0
      ? `cache=${formatCount(value.usageTotals.cachedInputTokens)}`
      : null,
    value.usageTotals.outputTokens > 0 ? `output=${formatCount(value.usageTotals.outputTokens)}` : null,
    value.usageTotals.costUsd > 0 ? `cost=${formatUsd(value.usageTotals.costUsd)}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(", ") : undefined;
}

export function hasWorkflowTargetMetadataRollup(
  value: WorkflowTargetMetadataRollup,
): boolean {
  return (
    value.automationModes.length > 0
    || value.surfaces.length > 0
    || value.runners.length > 0
    || value.placements.length > 0
    || value.environments.length > 0
    || value.approvalStates.length > 0
    || value.models.length > 0
    || value.usageTotals.inputTokens > 0
    || value.usageTotals.cachedInputTokens > 0
    || value.usageTotals.outputTokens > 0
    || value.usageTotals.costUsd > 0
  );
}

function validateWithShape(
  optional: Record<string, Guard>,
): Guard<Record<string, unknown>> {
  return (value: unknown): value is Record<string, unknown> => (
    isRecord(value) && hasShape(value, {}, optional)
  );
}

function hasWorkflowTargetMetadata(value: Record<string, unknown>): boolean {
  return [
    value.automation,
    value.execution,
    value.governance,
    value.usage,
  ].some((entry) => isRecord(entry) && Object.keys(entry).length > 0);
}

function collectStringValues(
  value: unknown,
  key: string,
): string[] {
  if (!isRecord(value)) {
    return [];
  }
  const entry = readString(value, key);
  return entry ? [entry] : [];
}

function summarizeAutomation(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return joinSummaryParts([
    readString(value, "runMode"),
    readString(value, "trigger"),
    readString(value, "recurrence"),
    prefixedValue("schedule", readString(value, "scheduleId")),
  ]);
}

function summarizeExecution(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return joinSummaryParts([
    readString(value, "surface"),
    readString(value, "placement"),
    readString(value, "runner"),
    readString(value, "environment"),
  ]);
}

function summarizeGovernance(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return joinSummaryParts([
    readString(value, "approvalState"),
    prefixedValue("policy", readString(value, "policyId")),
    prefixedValue("approval", readString(value, "approvalId")),
    prefixedValue("decision", readString(value, "decisionId")),
  ]);
}

function summarizeUsage(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return joinSummaryParts([
    readString(value, "model"),
    readString(value, "modelRouting"),
    formatTokenCount(readNumber(value, "inputTokens"), "in"),
    formatTokenCount(readNumber(value, "cachedInputTokens"), "cache"),
    formatTokenCount(readNumber(value, "outputTokens"), "out"),
    formatUsd(readNumber(value, "costUsd")),
  ]);
}

function joinSummaryParts(parts: Array<string | undefined>): string | undefined {
  const filtered = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  return filtered.length > 0 ? filtered.join(" · ") : undefined;
}

function formatWorkflowField(label: string, values: string[]): string | null {
  return values.length > 0 ? `${label}=${values.join(", ")}` : null;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function pushString(target: Set<string>, value: unknown): void {
  if (typeof value === "string" && value.length > 0) {
    target.add(value);
  }
}

function prefixedValue(prefix: string, value: string | undefined): string | undefined {
  return value ? `${prefix} ${value}` : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] as string : undefined;
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" ? value[key] as number : undefined;
}

function formatTokenCount(value: number | undefined, suffix: string): string | undefined {
  return value !== undefined ? `${value.toLocaleString("en-US")} ${suffix}` : undefined;
}

function formatUsd(value: number | undefined): string | undefined {
  return value !== undefined ? `$${value.toFixed(2)}` : undefined;
}
