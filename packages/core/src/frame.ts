import type { SourceRef } from "./events.js";

export type AttentionFrameMode = "status" | "approval" | "choice" | "form";
export type FrameMode = AttentionFrameMode;

export type AttentionTone = "ambient" | "focused" | "critical";
export type FrameTone = AttentionTone;

export type AttentionConsequenceLevel = "low" | "medium" | "high";
export type ConsequenceLevel = AttentionConsequenceLevel;

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
export type Frame = AttentionFrame;

export type AttentionContext = {
  stage?: string;
  progress?: number;
  items?: Array<{
    id: string;
    label: string;
    value?: string;
  }>;
};
export type FrameContext = AttentionContext;

export type AttentionResponseSpec =
  | AttentionApprovalResponseSpec
  | AttentionAcknowledgeResponseSpec
  | AttentionChoiceResponseSpec
  | AttentionFormResponseSpec
  | AttentionNoResponseSpec;
export type FrameResponseSpec = AttentionResponseSpec;

export type AttentionNoResponseSpec = {
  kind: "none";
};
export type NoResponseSpec = AttentionNoResponseSpec;

export type AttentionApprovalResponseSpec = {
  kind: "approval";
  actions: AttentionAction[];
  requireReason?: boolean;
};
export type ApprovalResponseSpec = AttentionApprovalResponseSpec;

export type AttentionAcknowledgeResponseSpec = {
  kind: "acknowledge";
  actions: AttentionAction[];
};
export type AcknowledgeResponseSpec = AttentionAcknowledgeResponseSpec;

export type AttentionChoiceResponseSpec = {
  kind: "choice";
  selectionMode: "single" | "multiple";
  options: AttentionOption[];
  actions: AttentionAction[];
};
export type ChoiceResponseSpec = AttentionChoiceResponseSpec;

export type AttentionFormResponseSpec = {
  kind: "form";
  fields: AttentionField[];
  actions: AttentionAction[];
};
export type FormResponseSpec = AttentionFormResponseSpec;

export type AttentionAction = {
  id: string;
  label: string;
  kind: "submit" | "approve" | "reject" | "cancel" | "dismiss" | "acknowledge";
  emphasis: "primary" | "secondary" | "danger";
};
export type FrameAction = AttentionAction;

export type AttentionOption = {
  id: string;
  label: string;
  summary?: string;
};
export type FrameOption = AttentionOption;

export type AttentionField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
};
export type FrameField = AttentionField;

export type AttentionProvenance = {
  whyNow?: string;
  factors?: string[];
  sources?: Array<{
    label: string;
    ref?: string;
  }>;
};
export type FrameProvenance = AttentionProvenance;

export type AttentionTiming = {
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
};
export type FrameTiming = AttentionTiming;

export type AttentionTaskView = {
  active: AttentionFrame | null;
  queued: AttentionFrame[];
  ambient: AttentionFrame[];
};
export type TaskView = AttentionTaskView;

export type AttentionView = {
  active: AttentionFrame | null;
  queued: AttentionFrame[];
  ambient: AttentionFrame[];
};
