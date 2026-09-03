import { serializeAsciiJsonLine } from "../ascii-jsonl.js";

export const APERTURE_SURFACE_PROTOCOL_VERSION = 4;
export const APERTURE_SURFACE_LIMITS = {
  sources: 32,
  nextFrames: 32,
  ambientFrames: 64,
  contextItems: 8,
  id: 160,
  kind: 80,
  label: 120,
  title: 200,
  summary: 600,
  contextValue: 240,
  whyNow: 400,
  errorMessage: 400,
  jsonLineBytes: 256 * 1024,
} as const;

export type ApertureSurfaceSource = {
  kind: string;
  label: string;
};

export type ApertureSurfaceFrameSource = {
  kind: string;
  label: string;
};

export type ApertureSurfaceContextItem = {
  id: string;
  label: string;
  value?: string;
};

export type ApertureSurfaceFrame = {
  id: string;
  taskId: string;
  interactionId: string;
  version: number;
  mode: "status" | "approval" | "choice" | "form";
  tone: "ambient" | "focused" | "critical";
  consequence: "low" | "medium" | "high";
  title: string;
  summary?: string;
  source?: ApertureSurfaceFrameSource;
  context?: {
    stage?: string;
    progress?: number;
    items?: ApertureSurfaceContextItem[];
  };
  provenance?: {
    whyNow: string;
  };
  timing: {
    createdAt: string;
    updatedAt: string;
    expiresAt?: string;
  };
};

export type ApertureSurfaceView = {
  now: ApertureSurfaceFrame | null;
  next: ApertureSurfaceFrame[];
  ambient: ApertureSurfaceFrame[];
};

export type ApertureSurfaceTotals = {
  now: 0 | 1;
  next: number;
  ambient: number;
  sources: number;
};

export type ApertureSurfaceCapabilities = {
  snapshots: boolean;
  responses: boolean;
  engagement: boolean;
};
export const APERTURE_STDIO_CAPABILITIES: Readonly<ApertureSurfaceCapabilities> = Object.freeze({
  snapshots: true,
  responses: false,
  engagement: false,
});

export type ApertureSurfaceHelloMessage = {
  type: "hello";
  protocolVersion: 4;
  packageVersion: string;
  surface: "aperture-stdio";
  capabilities: ApertureSurfaceCapabilities;
};

export type ApertureSurfaceConnectionMessage =
  | {
      type: "connection";
      state: "connecting";
    }
  | {
      type: "connection";
      state: "connected";
      runtimeId: string;
      runtimeKind: string;
    }
  | {
      type: "connection";
      state: "disconnected";
      reason: "runtime_unavailable" | "authentication_failed" | "connection_failed";
    };

export type ApertureSurfaceSnapshotMessage = {
  type: "snapshot";
  sequence: number;
  sources: ApertureSurfaceSource[];
  totals: ApertureSurfaceTotals;
  view: ApertureSurfaceView;
};

export type ApertureSurfaceErrorMessage = {
  type: "error";
  code: string;
  message: string;
  recoverable: boolean;
};

export type ApertureSurfaceMessage =
  | ApertureSurfaceHelloMessage
  | ApertureSurfaceConnectionMessage
  | ApertureSurfaceSnapshotMessage
  | ApertureSurfaceErrorMessage;

export function apertureSurfaceHello(
  packageVersion: string,
  capabilities: Readonly<ApertureSurfaceCapabilities> = APERTURE_STDIO_CAPABILITIES,
): ApertureSurfaceHelloMessage {
  const normalizedVersion = packageVersion.trim();
  if (
    !normalizedVersion ||
    Array.from(normalizedVersion).length > APERTURE_SURFACE_LIMITS.kind ||
    /[\u0000-\u001f\u007f]/.test(normalizedVersion)
  ) {
    throw new Error("Aperture package version must contain 1 to 80 visible characters.");
  }
  return {
    protocolVersion: APERTURE_SURFACE_PROTOCOL_VERSION,
    type: "hello",
    packageVersion: normalizedVersion,
    surface: "aperture-stdio",
    capabilities: { ...capabilities },
  };
}

export function serializeApertureSurfaceMessage(message: ApertureSurfaceMessage): string {
  const line = serializeAsciiJsonLine(message);
  if (line.length > APERTURE_SURFACE_LIMITS.jsonLineBytes) {
    throw new Error("Aperture surface protocol line exceeded the configured byte limit.");
  }
  return line;
}
