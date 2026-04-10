import {
  baseAttentionSurfaceCapabilities,
  type AttentionSurfaceCapabilities,
} from "@tomismeta/aperture-core";

import type { ApertureRuntimeSnapshot } from "./runtime-contract.js";

export const DEFAULT_RUNTIME_POLL_INTERVAL_MS = 250;

export function createEmptyRuntimeSnapshot(): ApertureRuntimeSnapshot {
  return {
    version: 0,
    attentionView: { now: null, next: [], ambient: [] },
    signalSummary: {
      recentSignals: 0,
      lifetimeSignals: 0,
      counts: {
        presented: 0,
        viewed: 0,
        responded: 0,
        dismissed: 0,
        deferred: 0,
        contextExpanded: 0,
        contextSkipped: 0,
        timedOut: 0,
        returned: 0,
        attentionShifted: 0,
      },
      deferred: {
        next: 0,
        suppressed: 0,
        manual: 0,
      },
      responseRate: 0,
      dismissalRate: 0,
      averageResponseLatencyMs: null,
      averageDismissalLatencyMs: null,
      lastSignalAt: null,
    },
    attentionState: "monitoring",
    adapters: [],
    surfaceCount: 0,
    surfaceCapabilities: {
      topology: {
        supportsAmbient: baseAttentionSurfaceCapabilities.topology.supportsAmbient,
      },
      responses: {
        supportsSingleChoice: baseAttentionSurfaceCapabilities.responses.supportsSingleChoice,
        supportsMultipleChoice: baseAttentionSurfaceCapabilities.responses.supportsMultipleChoice,
        supportsForm: baseAttentionSurfaceCapabilities.responses.supportsForm,
        supportsTextResponse: baseAttentionSurfaceCapabilities.responses.supportsTextResponse,
      },
    } satisfies AttentionSurfaceCapabilities,
  };
}

export function normalizeRuntimeUrls(input: string): { baseUrl: string; controlUrl: string } {
  const normalized = input.replace(/\/+$/, "");
  if (normalized.endsWith("/runtime")) {
    return {
      baseUrl: normalized.slice(0, -"/runtime".length),
      controlUrl: normalized,
    };
  }
  return {
    baseUrl: normalized,
    controlUrl: `${normalized}/runtime`,
  };
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Aperture runtime request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

export async function postJson<T = Record<string, never>>(
  url: string,
  body: unknown,
  contentType = "application/json",
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Aperture runtime request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}
