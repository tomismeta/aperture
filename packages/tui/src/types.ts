import type {
  AttentionFrame as Frame,
  AttentionResponse as FrameResponse,
  AttentionView,
} from "@tomismeta/aperture-core";
import type {
  ApertureTrace,
  AttentionField as FrameField,
  AttentionResponseSpec as FrameResponseSpec,
  AttentionSignalSummary as SignalSummary,
  AttentionState,
} from "../../core/src/internal-contract.js";

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
  terminalTitle?: string;
  input?: InputLike;
  output?: OutputLike;
  reducedMotion?: boolean;
  ambientStaleMs?: number;
  getConnectionStatus?: () => AttentionConnectionSnapshot | null;
  subscribeConnectionStatus?: (listener: (status: AttentionConnectionSnapshot | null) => void) => () => void;
  runConnectionAction?: (actionId: string) => void | Promise<void>;
};

export type AttentionConnectionState = "ready" | "starting" | "action" | "error" | "disabled";

export type AttentionConnectionEntry = {
  id: string;
  label: string;
  state: AttentionConnectionState;
  detail: string;
  hint?: string;
  actions?: AttentionConnectionAction[];
};

export type AttentionConnectionSnapshot = {
  summary?: string;
  entries: AttentionConnectionEntry[];
  actions?: AttentionConnectionAction[];
};

export type AttentionConnectionAction = {
  id: string;
  key: string;
  label: string;
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
  queueMovement: Map<string, { direction: "up" | "down"; delta: number; ticksRemaining: number }>;
  /** Continuous tick counter for idle lens pulse */
  idleTick: number;
};

export type TuiState = {
  attentionView: AttentionView;
  statusLine: string;
  inputDraft: InputDraft | null;
  expanded: boolean;
  showSetup: boolean;
  whyMode: boolean;
  whyExpanded: boolean;
  traceCache: Map<string, ApertureTrace>;
  connectionStatus: AttentionConnectionSnapshot | null;
  posture: Posture;
  previousPosture: Posture;
  animation: AnimationState;
};

export type QueueGroup = {
  key: string;
  frame: Frame;
  count: number;
};

export type RenderOptions = {
  title?: string;
  statusLine?: string;
  inputDraft?: InputDraft | null;
  color?: boolean;
  height?: number;
  showSetup?: boolean;
  stats?: { summary: SignalSummary; state: AttentionState } | null;
  expanded?: boolean;
  whyMode?: boolean;
  whyExpanded?: boolean;
  trace?: ApertureTrace | null;
  posture?: Posture;
  animation?: AnimationState;
  connectionStatus?: AttentionConnectionSnapshot | null;
};
