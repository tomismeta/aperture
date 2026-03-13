import type { AttentionState } from "./attention-state.js";
import type { EpisodeSummary } from "./episode-store.js";
import type { ApertureEvent } from "./events.js";
import type { AttentionView, Frame, TaskView } from "./frame.js";
import type { InteractionCandidate, InteractionPriority } from "./interaction-candidate.js";
import type { PolicyVerdict } from "./policy-gates.js";
import type { SignalSummary } from "./signal-summary.js";
import type { UtilityBreakdown } from "./utility-score.js";

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
      episode: EpisodeSummary | null;
      policy: PolicyVerdict;
      utility: {
        candidate: UtilityBreakdown;
        currentScore: number | null;
        currentPriority: InteractionPriority | null;
      };
      planner: {
        kind: "activate" | "queue" | "ambient" | "keep" | "clear";
        reasons: string[];
      };
      coordination: {
        kind: "activate" | "queue" | "ambient" | "keep" | "clear";
        candidateScore: number;
        currentScore: number | null;
        currentPriority: InteractionPriority | null;
        reasons: string[];
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
