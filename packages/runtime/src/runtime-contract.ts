import type {
  ApertureCore,
  AttentionResponse,
  AttentionSignal,
  AttentionSurfaceCapabilities,
  AttentionView,
  SourceEvent,
} from "@tomismeta/aperture-core";
import type {
  ApertureCoreHealthSnapshot,
  ApertureTrace,
  AttentionSignalSummary,
  AttentionState,
} from "@tomismeta/aperture-core/internal";

import type { LearningPersistenceState } from "./learning-persistence.js";

export type ApertureRuntimeOptions = {
  kind?: string;
  controlHost?: string;
  controlPathPrefix?: string;
  controlPort?: number;
  eventLogLimit?: number;
  captureLogLimit?: number;
  adapterTtlMs?: number;
  surfaceTtlMs?: number;
  workResponseMaxEntries?: number;
  workResponsePendingTtlMs?: number;
  workResponseRetentionMs?: number;
  metadata?: Record<string, string>;
  core?: ApertureCore;
  learningPersistence?: LearningPersistenceState;
};

export type ApertureRuntimeEvent =
  | {
      sequence: number;
      type: "response";
      response: AttentionResponse;
    }
  | {
      sequence: number;
      type: "trace";
      trace: ApertureTrace;
    };

export type ApertureRuntimeSnapshot = {
  version: number;
  attentionView: AttentionView;
  signalSummary: AttentionSignalSummary;
  attentionState: AttentionState;
  adapters: ApertureRuntimeAdapter[];
  surfaceCount: number;
  surfaceCapabilities: AttentionSurfaceCapabilities;
  health: ApertureRuntimeHealthSnapshot;
  learningPersistence?: LearningPersistenceState;
};

export type ApertureRuntimeCaptureHealthSnapshot = {
  currentSequence: number;
  currentCaptureSequence: number;
  eventFeedCount: number;
  captureSteps: number;
  publishedSourceEvents: number;
  submittedResponses: number;
  signals: number;
  traces: number;
  attentionViewSnapshots: number;
  eventFeedLimit: number;
  captureLogLimit: number;
};

export type ApertureRuntimeWorkResponseHealthSnapshot = {
  total: number;
  counts: Record<WorkResponseState, number>;
  capacity: number;
  pendingTtlMs: number;
  retentionMs: number;
  persistenceOk: boolean;
  lastPersistedAt: string | null;
  lastPersistenceError: string | null;
  lastPersistenceErrorAt: string | null;
};

export type ApertureRuntimeTelemetryRouteHealthSnapshot = {
  name: string;
  method: "GET" | "POST" | "DELETE" | "UNKNOWN";
  requests: number;
  successfulResponses: number;
  failedResponses: number;
  unauthorizedResponses: number;
  rateLimitedResponses: number;
  rejectedOriginResponses: number;
  averageDurationMs: number | null;
  maxDurationMs: number | null;
  lastStatusCode: number | null;
  lastRequestAt: string | null;
  lastCompletedAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
};

export type ApertureRuntimeTelemetryErrorHealthSnapshot = {
  at: string;
  route: string;
  method: "GET" | "POST" | "DELETE" | "UNKNOWN";
  statusCode: number;
  code: string;
  message: string;
};

export type ApertureRuntimeTelemetryHealthSnapshot = {
  totalRequests: number;
  activeRequests: number;
  completedRequests: number;
  failedRequests: number;
  unauthorizedRequests: number;
  rateLimitedRequests: number;
  rejectedOriginRequests: number;
  lastRequestAt: string | null;
  lastCompletedAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  routes: ApertureRuntimeTelemetryRouteHealthSnapshot[];
  recentErrors: ApertureRuntimeTelemetryErrorHealthSnapshot[];
};

export type ApertureRuntimeHealthSnapshot = {
  startedAt: string;
  adapters: {
    count: number;
    ttlMs: number;
  };
  surfaces: {
    count: number;
    ttlMs: number;
  };
  capture: ApertureRuntimeCaptureHealthSnapshot;
  workResponses: ApertureRuntimeWorkResponseHealthSnapshot;
  telemetry: ApertureRuntimeTelemetryHealthSnapshot;
  core: ApertureCoreHealthSnapshot;
};

export type ApertureRuntimeCaptureStep =
  | {
      sequence: number;
      recordedAt: string;
      kind: "publishSource";
      event: SourceEvent;
    }
  | {
      sequence: number;
      recordedAt: string;
      kind: "submit";
      response: AttentionResponse;
    };

export type ApertureRuntimeAttentionViewSnapshot = {
  sequence: number;
  recordedAt: string;
  attentionView: AttentionView;
};

export type ApertureRuntimeTargetMetadata = {
  automation?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  governance?: Record<string, unknown>;
  usage?: Record<string, unknown>;
};

export type ApertureRuntimeExplanationSnapshot = {
  targetInteractionId: string | null;
  targetLane: "now" | "next" | "ambient" | "none";
  headline: string | null;
  targetMetadata: ApertureRuntimeTargetMetadata | null;
  whyNow: string | null;
  routingAuthority: "status" | "request" | "event" | null;
  semanticImpact: {
    canonical: string[];
    routing: string[];
    continuity: string[];
    ambiguity: string[];
    contextOnly: string[];
  } | null;
  semanticInfluence: string[];
  coordinationReasons: string[];
  plannerReasons: string[];
  policyRationale: string[];
  criterionRationale: string[];
  continuityRationale: string[];
  attentionRationale: string[];
};

export type ApertureRuntimeSessionCapture = {
  runtimeId: string;
  kind: string;
  startedAt: string;
  exportedAt: string;
  captureSteps: ApertureRuntimeCaptureStep[];
  publishedSourceEvents: SourceEvent[];
  submittedResponses: AttentionResponse[];
  signals: AttentionSignal[];
  traces: ApertureTrace[];
  attentionViewSnapshots: ApertureRuntimeAttentionViewSnapshot[];
  currentAttentionView: AttentionView;
  currentExplanation: ApertureRuntimeExplanationSnapshot;
  adapters: ApertureRuntimeAdapter[];
  metadata?: Record<string, string>;
  learningPersistence?: LearningPersistenceState;
};

export type ApertureRuntimeAdapter = {
  id: string;
  kind: string;
  label?: string;
  metadata?: Record<string, string>;
  lastSeenAt: string;
  connectedAt: string;
};

export type ApertureRuntime = {
  listen(): Promise<{
    baseUrl: string;
    controlUrl: string;
    runtimeId: string;
    kind: string;
    surfaceTtlMs: number;
    authToken: string;
    tokenPath: string;
  }>;
  close(): Promise<void>;
  getCore(): ApertureCore;
  hasAttachedSurface(): boolean;
  exportSessionCapture(): ApertureRuntimeSessionCapture;
  publishSourceEvent(event: SourceEvent): void;
  publishSourceEventBatch(events: SourceEvent[]): void;
};

export type WorkReceiptMode = "text" | "event" | "batch";

export type WorkReceiptItem = {
  taskId: string;
  type: SourceEvent["type"];
  title?: string;
  summary?: string;
  status?: string;
  interactionId?: string;
  responsePath?: string;
  responseUrl?: string;
};

export type WorkReceiptNextStep = {
  when: string;
  send: "text" | "WorkEvent" | "WorkEvent[]";
  why: string;
};

export type WorkReceipt = {
  ok: true;
  apiVersion: string;
  accepted: number;
  receivedAs: WorkReceiptMode;
  message: string;
  published: WorkReceiptItem[];
  retention?: {
    pendingTtlMs: number;
    terminalRetentionMs: number;
    capacity: number;
  };
  next?: WorkReceiptNextStep[];
};

export type WorkResponseState = "pending" | "answered" | "expired" | "cancelled";

export type WorkResponse = {
  ok: true;
  apiVersion: string;
  taskId: string;
  interactionId: string;
  state: WorkResponseState;
  message: string;
  response?: AttentionResponse["response"];
  answeredAt?: string;
  expiresAt?: string;
  cancelledAt?: string;
  retentionExpiresAt?: string;
};

export type RuntimeWorkResponseRecord = {
  taskId: string;
  interactionId: string;
  state: WorkResponseState;
  createdAt: string;
  updatedAt: string;
  response?: AttentionResponse["response"];
  answeredAt?: string;
  expiresAt?: string;
  cancelledAt?: string;
  retentionExpiresAt?: string;
};
