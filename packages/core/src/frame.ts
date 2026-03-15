import type { SourceRef } from "./events.js";

export type AttentionFrameMode = "status" | "approval" | "choice" | "form";

export type AttentionTone = "ambient" | "focused" | "critical";

export type AttentionConsequenceLevel = "low" | "medium" | "high";

export type AttentionFrame = {
  id: string;
  taskId: string;
  interactionId: string;
  source?: SourceRef;
  version: number;
  mode: AttentionFrameMode;
  tone: AttentionTone;
  consequence: AttentionConsequenceLevel;
  title: string;
  summary?: string;
  context?: AttentionContext;
  responseSpec?: AttentionResponseSpec;
  provenance?: AttentionProvenance;
  timing: AttentionTiming;
  metadata?: Record<string, unknown>;
};

export type AttentionContext = {
  stage?: string;
  progress?: number;
  items?: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
};

export type AttentionResponseSpec =
  | AttentionApprovalResponseSpec
  | AttentionAcknowledgeResponseSpec
  | AttentionChoiceResponseSpec
  | AttentionFormResponseSpec
  | AttentionNoResponseSpec;

export type AttentionNoResponseSpec = {
  kind: "none";
};

export type AttentionApprovalResponseSpec = {
  kind: "approval";
  actions: AttentionAction[];
  requireReason?: boolean;
};

export type AttentionAcknowledgeResponseSpec = {
  kind: "acknowledge";
  actions: AttentionAction[];
};

export type AttentionChoiceResponseSpec = {
  kind: "choice";
  selectionMode: "single" | "multiple";
  allowTextResponse?: boolean;
  options: AttentionOption[];
  actions: AttentionAction[];
};

export type AttentionFormResponseSpec = {
  kind: "form";
  fields: AttentionField[];
  actions: AttentionAction[];
};

export type AttentionAction = {
  id: string;
  label: string;
  kind: "submit" | "approve" | "reject" | "cancel" | "dismiss" | "acknowledge";
  emphasis: "primary" | "secondary" | "danger";
};

export type AttentionOption = {
  id: string;
  label: string;
  summary?: string;
};

export type AttentionField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
};

export type AttentionProvenance = {
  whyNow?: string;
  factors?: string[];
  sources?: Array<{
    label: string;
    ref?: string;
  }>;
};

export type AttentionTiming = {
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};

export type AttentionTaskView = {
  active: AttentionFrame | null;
  queued: AttentionFrame[];
  ambient: AttentionFrame[];
};

export type AttentionView = {
  active: AttentionFrame | null;
  queued: AttentionFrame[];
  ambient: AttentionFrame[];
};
