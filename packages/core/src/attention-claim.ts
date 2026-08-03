import type { AttentionActivityClass, SourceRef } from "./events.js";
import type { AttentionCandidate } from "./interaction-candidate.js";
import type {
  AttentionOntologyAuthority,
  AttentionOntologyDiagnostic,
} from "./semantic-ontology-types.js";
import type { SemanticConfidence, SemanticRelationHint } from "./semantic-types.js";
import type { SemanticEvidenceStrength } from "./judgment-input-types.js";

export type AttentionClaimMode = "status" | "approval" | "choice" | "form";

export type AttentionClaimTone = "ambient" | "focused" | "critical";

export type AttentionClaimConsequence = "low" | "medium" | "high";

export type AttentionClaimPriority = "background" | "normal" | "high";

export type AttentionClaimContextItem = {
  id: string;
  label: string;
  value?: string;
};

export type AttentionClaimContext = {
  stage?: string;
  progress?: number;
  items?: AttentionClaimContextItem[];
};

export type AttentionClaimProvenance = {
  whyNow?: string;
  factors?: string[];
  sources?: Array<{
    label: string;
    ref?: string;
  }>;
};

export type AttentionClaimResponseSpec =
  | AttentionClaimApprovalResponseSpec
  | AttentionClaimAcknowledgeResponseSpec
  | AttentionClaimChoiceResponseSpec
  | AttentionClaimFormResponseSpec
  | AttentionClaimNoResponseSpec;

export type AttentionClaimNoResponseSpec = {
  kind: "none";
};

export type AttentionClaimApprovalResponseSpec = {
  kind: "approval";
  actions: AttentionClaimAction[];
  requireReason?: boolean;
};

export type AttentionClaimAcknowledgeResponseSpec = {
  kind: "acknowledge";
  actions: AttentionClaimAction[];
};

export type AttentionClaimChoiceResponseSpec = {
  kind: "choice";
  selectionMode: "single" | "multiple";
  allowTextResponse?: boolean;
  options: AttentionClaimOption[];
  actions: AttentionClaimAction[];
};

export type AttentionClaimFormResponseSpec = {
  kind: "form";
  fields: AttentionClaimField[];
  actions: AttentionClaimAction[];
};

export type AttentionClaimAction = {
  id: string;
  label: string;
  kind: "submit" | "approve" | "reject" | "cancel" | "dismiss" | "acknowledge";
  emphasis: "primary" | "secondary" | "danger";
};

export type AttentionClaimOption = {
  id: string;
  label: string;
  summary?: string;
};

export type AttentionClaimField = {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  helpText?: string;
};

export type AttentionClaim = {
  taskId: string;
  interactionId: string;
  source?: SourceRef;
  toolFamily?: string;
  activityClass?: AttentionActivityClass;
  mode: AttentionClaimMode;
  tone: AttentionClaimTone;
  consequence: AttentionClaimConsequence;
  title: string;
  summary?: string;
  context?: AttentionClaimContext;
  provenance?: AttentionClaimProvenance;
  judgment?: AttentionClaimJudgment;
  relationHints?: SemanticRelationHint[];
  responseSpec: AttentionClaimResponseSpec;
  priority: AttentionClaimPriority;
  blocking: boolean;
  timestamp: string;
  scoreAdjustment?: number;
  scoreRationale?: string[];
  episode?: AttentionClaimEpisode;
};

export type AttentionClaimJudgment = {
  ontology?: AttentionOntologyDiagnostic;
  semanticEvidence?: {
    confidence: SemanticConfidence;
    source: AttentionOntologyAuthority;
    strength: SemanticEvidenceStrength;
    abstained?: boolean;
  };
  relationEvidence?: {
    source: AttentionOntologyAuthority;
    strength: SemanticEvidenceStrength;
  };
};

export type AttentionClaimEpisode = {
  id: string;
  key: string;
  state: "emerging" | "actionable" | "batched" | "waiting" | "stale" | "resolved";
  size: number;
  evidenceScore: number;
  evidenceReasons: string[];
  lastInteractionId: string;
  updatedAt: string;
};

export function buildAttentionClaim(candidate: AttentionCandidate): AttentionClaim {
  const judgment = buildAttentionClaimJudgment(candidate);
  const episode = buildAttentionClaimEpisode(candidate);

  return {
    taskId: candidate.taskId,
    interactionId: candidate.interactionId,
    ...(candidate.source !== undefined ? { source: candidate.source } : {}),
    ...(candidate.toolFamily !== undefined ? { toolFamily: candidate.toolFamily } : {}),
    ...(candidate.activityClass !== undefined ? { activityClass: candidate.activityClass } : {}),
    mode: candidate.mode,
    tone: candidate.tone,
    consequence: candidate.consequence,
    title: candidate.title,
    ...(candidate.summary !== undefined ? { summary: candidate.summary } : {}),
    ...(candidate.context !== undefined ? { context: candidate.context } : {}),
    ...(candidate.provenance !== undefined ? { provenance: candidate.provenance } : {}),
    ...(judgment !== undefined ? { judgment } : {}),
    ...(candidate.relationHints !== undefined ? { relationHints: candidate.relationHints } : {}),
    responseSpec: candidate.responseSpec,
    priority: candidate.priority,
    blocking: candidate.blocking,
    timestamp: candidate.timestamp,
    ...(candidate.attentionScoreOffset !== undefined
      ? { scoreAdjustment: candidate.attentionScoreOffset }
      : {}),
    ...(candidate.attentionRationale !== undefined
      ? { scoreRationale: candidate.attentionRationale }
      : {}),
    ...(episode !== undefined ? { episode } : {}),
  };
}

function buildAttentionClaimJudgment(
  candidate: AttentionCandidate,
): AttentionClaimJudgment | undefined {
  const judgment = candidate.judgmentInput;
  const claimJudgment: AttentionClaimJudgment = {
    ...(judgment.ontology !== undefined ? { ontology: judgment.ontology } : {}),
    ...(judgment.semanticEvidence !== undefined
      ? {
          semanticEvidence: {
            confidence: judgment.semanticEvidence.confidence,
            source: judgment.semanticEvidence.source,
            strength: judgment.semanticEvidence.strength,
            ...(judgment.semanticEvidence.abstained
              ? { abstained: judgment.semanticEvidence.abstained }
              : {}),
          },
        }
      : {}),
    ...(judgment.relationEvidence !== undefined
      ? { relationEvidence: judgment.relationEvidence }
      : {}),
  };

  return Object.keys(claimJudgment).length > 0 ? claimJudgment : undefined;
}

function buildAttentionClaimEpisode(
  candidate: AttentionCandidate,
): AttentionClaimEpisode | undefined {
  if (
    candidate.episodeId === undefined ||
    candidate.episodeKey === undefined ||
    candidate.episodeState === undefined ||
    candidate.episodeSize === undefined ||
    candidate.episodeEvidenceScore === undefined ||
    candidate.episodeEvidenceReasons === undefined
  ) {
    return undefined;
  }

  return {
    id: candidate.episodeId,
    key: candidate.episodeKey,
    state: candidate.episodeState,
    size: candidate.episodeSize,
    evidenceScore: candidate.episodeEvidenceScore,
    evidenceReasons: candidate.episodeEvidenceReasons,
    lastInteractionId: candidate.interactionId,
    updatedAt: candidate.timestamp,
  };
}
