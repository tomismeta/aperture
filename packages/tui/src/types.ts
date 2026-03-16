import type {
  AttentionField as FrameField,
  AttentionFrame as Frame,
  AttentionResponse as FrameResponse,
  AttentionResponseSpec as FrameResponseSpec,
  AttentionSignalSummary as SignalSummary,
  AttentionState,
  AttentionView,
  ApertureTrace,
} from "@tomismeta/aperture-core";

export type {
  FrameField,
  Frame,
  FrameResponse,
  FrameResponseSpec,
  SignalSummary,
  AttentionState,
  AttentionView,
  ApertureTrace,
};

export type InputLike = NodeJS.ReadStream & {
  setRawMode?: (mode: boolean) => void;
  isTTY?: boolean;
};

export type OutputLike = NodeJS.WriteStream;

export type AttentionSurface = {
  getAttentionView(): AttentionView;
  getSignalSummary(): SignalSummary;
  getAttentionState(): AttentionState;
  subscribeAttentionView(listener: (attentionView: AttentionView) => void): () => void;
  onResponse(listener: (response: FrameResponse) => void): () => void;
  submit(response: FrameResponse): void;
  onTrace?(listener: (trace: ApertureTrace) => void): () => void;
};

export type AttentionTuiOptions = {
  title?: string;
  input?: InputLike;
  output?: OutputLike;
};

export type FormDraft = {
  kind: "form";
  interactionId: string;
  fieldIndex: number;
  values: Record<string, unknown>;
  buffer: string;
};

export type TextDraft = {
  kind: "text";
  interactionId: string;
  buffer: string;
};

export type InputDraft = FormDraft | TextDraft;

export type Posture = "calm" | "elevated" | "busy";

export type AnimationState = {
  postureFlash: { previous: Posture; ticksRemaining: number } | null;
  frameEntrance: { interactionId: string; ticksRemaining: number } | null;
};

export type TuiState = {
  attentionView: AttentionView;
  statusLine: string;
  inputDraft: InputDraft | null;
  expanded: boolean;
  whyMode: boolean;
  whyExpanded: boolean;
  traceCache: Map<string, ApertureTrace>;
  posture: Posture;
  previousPosture: Posture;
  animation: AnimationState;
};

export type QueueGroup = {
  frame: Frame;
  count: number;
};

export type RenderOptions = {
  title?: string;
  statusLine?: string;
  inputDraft?: InputDraft | null;
  color?: boolean;
  height?: number;
  stats?: { summary: SignalSummary; state: AttentionState } | null;
  expanded?: boolean;
  whyMode?: boolean;
  whyExpanded?: boolean;
  trace?: ApertureTrace | null;
  posture?: Posture;
  animation?: AnimationState;
};
