import type { AttentionState } from "./attention-state.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionView, Frame, TaskView } from "./frame.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";
import type { SignalSummary } from "./signal-summary.js";

export type ApertureTrace =
  | {
      timestamp: string;
      event: ApertureEvent;
      evaluation: {
        kind: "noop";
      };
      taskSummary: SignalSummary;
      globalSummary: SignalSummary;
      taskAttentionState: AttentionState;
      globalAttentionState: AttentionState;
      current: Frame | null;
      taskView: TaskView;
      attentionView: AttentionView;
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      evaluation: {
        kind: "clear";
        taskId: string;
      };
      taskSummary: SignalSummary;
      globalSummary: SignalSummary;
      taskAttentionState: AttentionState;
      globalAttentionState: AttentionState;
      current: Frame | null;
      taskView: TaskView;
      attentionView: AttentionView;
    }
  | {
      timestamp: string;
      event: ApertureEvent;
      evaluation: {
        kind: "candidate";
        original: InteractionCandidate;
        adjusted: InteractionCandidate;
      };
      heuristics: {
        scoreOffset: number;
        rationale: string[];
      };
      coordination: {
        kind: "activate" | "queue" | "ambient" | "keep" | "clear";
        candidateScore: number;
        currentScore: number | null;
        currentPriority: InteractionPriority | null;
      };
      taskSummary: SignalSummary;
      globalSummary: SignalSummary;
      taskAttentionState: AttentionState;
      globalAttentionState: AttentionState;
      current: Frame | null;
      taskView: TaskView;
      attentionView: AttentionView;
      result: Frame | null;
    };
