import type { AttentionFrame, AttentionView } from "@tomismeta/aperture-core";
import type { ApertureTrace } from "@tomismeta/aperture-core/internal";

import type {
  ApertureRuntimeAttentionViewSnapshot,
  ApertureRuntimeExplanationSnapshot,
  ApertureRuntimeTargetMetadata,
} from "./runtime-contract.js";

type CandidateRuntimeTrace = Extract<ApertureTrace, { result: AttentionFrame | null }>;

export function buildRuntimeExplanationSnapshot(
  attentionView: AttentionView,
  traces: ApertureTrace[],
): ApertureRuntimeExplanationSnapshot {
  const target = findPrimaryAttentionFrame(attentionView);

  if (!target) {
    return {
      targetInteractionId: null,
      targetLane: "none",
      headline: null,
      targetMetadata: null,
      whyNow: null,
      routingAuthority: null,
      semanticImpact: null,
      semanticInfluence: [],
      coordinationReasons: [],
      plannerReasons: [],
      policyRationale: [],
      criterionRationale: [],
      continuityRationale: [],
      attentionRationale: [],
    };
  }

  const targetLane =
    attentionView.now?.interactionId === target.interactionId
      ? "now"
      : attentionView.next.some((frame) => frame.interactionId === target.interactionId)
        ? "next"
        : "ambient";

  const candidateTrace =
    [...traces].reverse().find((trace): trace is CandidateRuntimeTrace => {
      if (!isCandidateRuntimeTrace(trace)) {
        return false;
      }

      return (
        trace.result?.interactionId === target.interactionId ||
        trace.current?.interactionId === target.interactionId ||
        trace.evaluation.adjusted.interactionId === target.interactionId ||
        trace.evaluation.original.interactionId === target.interactionId
      );
    }) ?? null;
  const continuityRationale = candidateTrace
    ? candidateTrace.coordination.continuityEvaluations
        .filter((evaluation) => evaluation.kind === "override")
        .flatMap((evaluation) => evaluation.rationale)
    : [];
  const attentionRationale = readAttentionRationale(target);
  const semanticImpact = candidateTrace?.semantic?.impact
    ? {
        canonical: [...candidateTrace.semantic.impact.canonical],
        routing: [...candidateTrace.semantic.impact.routing],
        continuity: [...candidateTrace.semantic.impact.continuity],
        ambiguity: [...candidateTrace.semantic.impact.ambiguity],
        contextOnly: [...candidateTrace.semantic.impact.contextOnly],
      }
    : null;
  const headline =
    target.provenance?.whyNow ??
    continuityRationale[0] ??
    candidateTrace?.coordination.reasons[0] ??
    attentionRationale[0] ??
    synthesizeExplanationHeadline(target);

  return {
    targetInteractionId: target.interactionId,
    targetLane,
    headline,
    targetMetadata: readTargetMetadata(target),
    whyNow: target.provenance?.whyNow ?? candidateTrace?.semantic?.whyNow ?? null,
    routingAuthority:
      candidateTrace?.semantic?.impact.routingAuthority ?? inferRoutingAuthority(target),
    semanticImpact,
    semanticInfluence: candidateTrace?.semantic?.influence
      ? [...candidateTrace.semantic.influence]
      : [],
    coordinationReasons: candidateTrace ? [...candidateTrace.coordination.reasons] : [],
    plannerReasons: candidateTrace ? [...candidateTrace.planner.reasons] : [],
    policyRationale: candidateTrace ? [...candidateTrace.policy.rationale] : [],
    criterionRationale: candidateTrace?.policyRules.criterion
      ? [...candidateTrace.policyRules.criterion.rationale]
      : [],
    continuityRationale,
    attentionRationale,
  };
}

export function selectExplanationAttentionView(
  currentAttentionView: AttentionView,
  attentionViewSnapshots: ApertureRuntimeAttentionViewSnapshot[],
): AttentionView {
  if (findPrimaryAttentionFrame(currentAttentionView)) {
    return currentAttentionView;
  }

  for (let index = attentionViewSnapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = attentionViewSnapshots[index]?.attentionView;
    if (snapshot && findPrimaryAttentionFrame(snapshot)) {
      return snapshot;
    }
  }

  return currentAttentionView;
}

function isCandidateRuntimeTrace(trace: ApertureTrace): trace is CandidateRuntimeTrace {
  return trace.evaluation.kind === "candidate" && "result" in trace;
}

function findPrimaryAttentionFrame(attentionView: AttentionView): AttentionFrame | null {
  return attentionView.now ?? attentionView.next[0] ?? attentionView.ambient[0] ?? null;
}

function readTargetMetadata(frame: AttentionFrame): ApertureRuntimeTargetMetadata | null {
  const metadata = frame.metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const targetMetadata: ApertureRuntimeTargetMetadata = {};
  const automation = readMetadataObject(metadata, "automation");
  const execution = readMetadataObject(metadata, "execution");
  const governance = readMetadataObject(metadata, "governance");
  const usage = readMetadataObject(metadata, "usage");

  if (automation) {
    targetMetadata.automation = automation;
  }
  if (execution) {
    targetMetadata.execution = execution;
  }
  if (governance) {
    targetMetadata.governance = governance;
  }
  if (usage) {
    targetMetadata.usage = usage;
  }

  return Object.keys(targetMetadata).length > 0 ? targetMetadata : null;
}

function readMetadataObject(
  metadata: NonNullable<AttentionFrame["metadata"]>,
  key: keyof ApertureRuntimeTargetMetadata,
): Record<string, unknown> | null {
  const value = metadata[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readAttentionRationale(frame: AttentionFrame): string[] {
  const attention = frame.metadata?.attention;
  if (!attention || typeof attention !== "object" || !("rationale" in attention)) {
    return [];
  }

  const { rationale } = attention;
  if (!Array.isArray(rationale)) {
    return [];
  }

  return rationale.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
}

function synthesizeExplanationHeadline(frame: AttentionFrame): string | null {
  switch (frame.mode) {
    case "approval":
      return frame.consequence === "high"
        ? "High-risk action requires operator approval"
        : "Approval blocking agent progress";
    case "choice":
      return "Waiting for operator decision";
    case "form":
      return "Input needed to continue";
    case "status":
      return null;
  }
}

function inferRoutingAuthority(frame: AttentionFrame): "status" | "request" | "event" | null {
  switch (frame.mode) {
    case "approval":
    case "choice":
    case "form":
      return "request";
    case "status":
      return "status";
  }
}
