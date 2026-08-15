import type {
  ApertureCoreOptions,
  ApertureEvent,
  AttentionFrame,
  AttentionFrameListener,
  AttentionResponse,
  AttentionResponseListener,
  AttentionSignal,
  AttentionSignalListener,
  AttentionTaskView,
  AttentionTaskViewListener,
  AttentionTraceListener,
  AttentionView,
  AttentionViewListener,
  SourceEvent,
} from "../src/index.js";
import type {
  ApertureTrace,
  CandidateApertureTrace,
  TraceAttentionPriority,
  TraceCandidateTransition,
  TraceContinuityEvaluation,
  TraceCriterionEvaluation,
  TraceDecisionAmbiguity,
  TraceDecisionKind,
  TraceFieldDiff,
  TraceGateEvaluation,
  TraceInterruptCriterion,
  TraceInterruptCriterionVerdict,
  TraceFrameTransition,
  TraceObservationSummary,
  TraceResultLane,
  TraceSemanticSummary,
  ObservationalStatusConflictEvidence as TraceObservationalStatusConflictEvidence,
  ObservationalStatusConflictKind as TraceObservationalStatusConflictKind,
} from "../src/trace.js";
import type {
  AttentionOntologyDiagnostic,
  SemanticConfidence,
  SemanticInterpretation,
  SemanticInterpretationHints,
  SemanticRelationHint,
  TruncatedSourceEvidenceHintOptions,
} from "../src/semantic.js";
import type {
  AttentionClaimAction,
  AttentionClaim,
  AttentionClaimContext,
  AttentionClaimEpisode,
  AttentionClaimResponseSpec,
  AttentionClaimJudgment,
  AttentionClaimMode,
  AttentionClaimPriority,
  AttentionDecisionRecordContinuityEvaluation,
  AttentionDecisionRecord,
  AttentionDecisionRoute,
  AttentionEvaluationContext,
  AttentionEvaluationConfig,
  AttentionEvaluationFrame,
  AttentionEvaluationInput,
  AttentionOperatorPresence,
} from "../src/evaluator.js";
import type {
  ApertureKernelEvent,
  ApertureKernelEvaluation,
  ApertureKernelConformanceCase,
  ApertureKernelConformanceCaseResult,
  ApertureKernelConformanceReport,
  ApertureKernelExplanation,
  ApertureKernelFinalEvent,
  ApertureKernelHostAdapter,
  Observation,
  ObservationJudgment,
  ApertureKernelResult,
} from "../src/kernel.js";

void (0 as unknown as ApertureCoreOptions);
void (0 as unknown as AttentionFrameListener);
void (0 as unknown as AttentionTaskViewListener);
void (0 as unknown as AttentionViewListener);
void (0 as unknown as AttentionResponseListener);
void (0 as unknown as AttentionSignalListener);
void (0 as unknown as AttentionTraceListener);
void (0 as unknown as ApertureEvent);
void (0 as unknown as SourceEvent);
void (0 as unknown as AttentionFrame);
void (0 as unknown as AttentionResponse);
void (0 as unknown as AttentionSignal);
void (0 as unknown as AttentionTaskView);
void (0 as unknown as AttentionView);
void (0 as unknown as ApertureTrace);
void (0 as unknown as CandidateApertureTrace);
void (0 as unknown as TraceAttentionPriority);
void (0 as unknown as TraceCandidateTransition);
void (0 as unknown as TraceContinuityEvaluation);
void (0 as unknown as TraceCriterionEvaluation);
void (0 as unknown as TraceDecisionAmbiguity);
void (0 as unknown as TraceDecisionKind);
void (0 as unknown as TraceFieldDiff);
void (0 as unknown as TraceGateEvaluation);
void (0 as unknown as TraceInterruptCriterion);
void (0 as unknown as TraceInterruptCriterionVerdict);
void (0 as unknown as TraceFrameTransition);
void (0 as unknown as TraceObservationSummary);
void (0 as unknown as TraceResultLane);
void (0 as unknown as TraceSemanticSummary);
void (0 as unknown as TraceObservationalStatusConflictEvidence);
void (0 as unknown as TraceObservationalStatusConflictKind);
void (0 as unknown as SemanticInterpretation);
void (0 as unknown as SemanticInterpretationHints);
void (0 as unknown as AttentionOntologyDiagnostic);
void (0 as unknown as SemanticRelationHint);
void (0 as unknown as SemanticConfidence);
void (0 as unknown as TruncatedSourceEvidenceHintOptions);
void (0 as unknown as AttentionClaim);
void (0 as unknown as AttentionClaimAction);
void (0 as unknown as AttentionClaimContext);
void (0 as unknown as AttentionClaimEpisode);
void (0 as unknown as AttentionClaimResponseSpec);
void (0 as unknown as AttentionClaimJudgment);
void (0 as unknown as AttentionClaimMode);
void (0 as unknown as AttentionClaimPriority);
void (0 as unknown as AttentionDecisionRecordContinuityEvaluation);
void (0 as unknown as AttentionDecisionRecord);
void (0 as unknown as AttentionDecisionRoute);
void (0 as unknown as AttentionEvaluationContext);
void (0 as unknown as AttentionEvaluationConfig);
void (0 as unknown as AttentionEvaluationFrame);
void (0 as unknown as AttentionEvaluationInput);
void (0 as unknown as AttentionOperatorPresence);
void (0 as unknown as ApertureKernelEvent);
void (0 as unknown as ApertureKernelEvaluation);
void (0 as unknown as ApertureKernelConformanceCase<unknown>);
void (0 as unknown as ApertureKernelConformanceCaseResult);
void (0 as unknown as ApertureKernelConformanceReport);
void (0 as unknown as ApertureKernelExplanation);
void (0 as unknown as ApertureKernelFinalEvent);
void (0 as unknown as ApertureKernelHostAdapter<unknown>);
void (0 as unknown as Observation);
void (0 as unknown as ObservationJudgment);
void (0 as unknown as ApertureKernelResult);

const truncatedSourceOptions: TruncatedSourceEvidenceHintOptions = {
  status: "failed",
  consequence: "high",
};
const evaluatorJudgment: AttentionClaimJudgment = {
  semanticEvidence: {
    confidence: "high",
    source: "explicit",
    strength: "strong",
  },
};

void truncatedSourceOptions;
void evaluatorJudgment;
