import type { SourceRef } from "./events.js";

export type FrameMode = "status" | "approval" | "choice" | "form";

export type FrameTone = "ambient" | "focused" | "critical";

export type ConsequenceLevel = "low" | "medium" | "high";

export type Frame = {
  id: string;
  taskId: string;
  interactionId: string;
  source?: SourceRef;
  version: number;
  mode: FrameMode;
  tone: FrameTone;
  consequence: ConsequenceLevel;
  title: string;
  summary?: string;
  context?: FrameContext;
  responseSpec?: FrameResponseSpec;
  provenance?: FrameProvenance;
  timing: FrameTiming;
  metadata?: Record<string, unknown>;
};

export type FrameContext = {
  stage?: string;
  progress?: number;
  items?: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
};

export type FrameResponseSpec =
  | ApprovalResponseSpec
  | ChoiceResponseSpec
  | FormResponseSpec
  | NoResponseSpec;

export type NoResponseSpec = {
  kind: "none";
};

export type ApprovalResponseSpec = {
  kind: "approval";
  actions: FrameAction[];
  requireReason?: boolean;
};

export type ChoiceResponseSpec = {
  kind: "choice";
  selectionMode: "single" | "multiple";
  options: FrameOption[];
  actions: FrameAction[];
};

export type FormResponseSpec = {
  kind: "form";
  fields: FrameField[];
  actions: FrameAction[];
};

export type FrameAction = {
  id: string;
  label: string;
  kind: "submit" | "approve" | "reject" | "cancel" | "dismiss";
  emphasis: "primary" | "secondary" | "danger";
};

export type FrameOption = {
  id: string;
  label: string;
  summary?: string;
};

export type FrameField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
};

export type FrameProvenance = {
  whyNow?: string;
  factors?: string[];
  sources?: Array<{
    label: string;
    ref?: string;
  }>;
};

export type FrameTiming = {
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

export type TaskView = {
  active: Frame | null;
  queued: Frame[];
  ambient: Frame[];
};

export type AttentionView = {
  active: Frame | null;
  queued: Frame[];
  ambient: Frame[];
};
