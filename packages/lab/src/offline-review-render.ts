import {
  DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_EXCERPT_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_STEPS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_SUMMARY_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_TITLE_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_WHY_NOW_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_EXCERPT_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_STEPS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_SUMMARY_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_TITLE_CHARS,
  DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_WHY_NOW_CHARS,
  type OfflineReviewArtifact,
  type OfflineReviewPreparedStep,
  type OfflineReviewPromptPacket,
  type OfflineReviewPromptStep,
  type OfflineReviewRecommendationReport,
  type OfflineReviewReport,
} from "./offline-review.js";
import { summarizeWorkflowTargetMetadata } from "./workflow-metadata.js";

export function renderOfflineReviewReportMarkdown(report: OfflineReviewReport): string {
  const lines = [
    "# Offline Review Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Bundle: ${report.bundle.sessionId}`,
    `Rubric: ${report.rubricVersion}`,
    "",
    "## Summary",
    "",
    `- Total findings: ${report.summary.totalFindings}`,
    `- Disagreements: ${report.summary.disagreementCount}`,
    `- Matched findings: ${report.summary.matchedFindings}`,
    "",
  ];

  appendTargetContextLines(lines, report.bundle.explanation);

  lines.push("## Focus Areas", "");

  for (const focusArea of DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS) {
    lines.push(`- ${focusArea}: ${report.summary.disagreementsByFocusArea[focusArea] ?? 0}`);
  }

  lines.push("", "## Disagreements", "");

  if (report.disagreements.length === 0) {
    lines.push("- none", "");
    return `${lines.join("\n")}\n`;
  }

  for (const disagreement of report.disagreements) {
    lines.push(
      `- step ${disagreement.stepIndex}${disagreement.stepLabel ? ` (${disagreement.stepLabel})` : ""}: ${disagreement.focusArea}`,
      `  - Aperture: ${renderValue(disagreement.apertureValue)}`,
      `  - Expected: ${renderValue(disagreement.expectedValue)}`,
      `  - Confidence: ${disagreement.confidence}`,
      `  - Recommendation: ${disagreement.recommendation}`,
    );
    if (disagreement.supportingText) {
      lines.push(`  - Evidence: ${disagreement.supportingText}`);
    }
    if (disagreement.rationale) {
      lines.push(`  - Rationale: ${disagreement.rationale}`);
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderOfflineReviewRecommendationMarkdown(
  report: OfflineReviewRecommendationReport,
): string {
  const lines = [
    "# Offline Review Recommendations",
    "",
    `Generated: ${report.generatedAt}`,
    `Bundle: ${report.bundle.sessionId}`,
    `Status: ${report.status}`,
    "",
    "## Summary",
    "",
    `- Disagreements: ${report.summary.disagreementCount}`,
    `- Actionable: ${report.summary.actionableCount}`,
    `- Promote: ${report.summary.recommendationCounts.promote}`,
    `- Inspect: ${report.summary.recommendationCounts.inspect}`,
    `- Ignore: ${report.summary.recommendationCounts.ignore}`,
    "",
  ];

  appendTargetContextLines(lines, report.bundle.explanation);

  lines.push("## Recommendations", "");

  if (report.items.length === 0) {
    lines.push("- none", "");
    return `${lines.join("\n")}\n`;
  }

  for (const item of report.items) {
    lines.push(
      `- ${item.focusArea}: ${item.summary}`,
      `  - Recommendation: ${item.recommendation}`,
      `  - Owner: ${item.owner}`,
      `  - Targets: ${item.targets.join(", ")}`,
      `  - Disagreements: ${item.disagreementCount}`,
      `  - Confidence: high=${item.confidenceCounts.high}, medium=${item.confidenceCounts.medium}, low=${item.confidenceCounts.low}`,
    );

    for (const example of item.examples) {
      lines.push(
        `  - Example step ${example.stepIndex}${example.stepLabel ? ` (${example.stepLabel})` : ""}: Aperture=${renderValue(example.apertureValue)} expected=${renderValue(example.expectedValue)} (${example.confidence}, ${example.recommendation})`,
      );
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function appendTargetContextLines(
  lines: string[],
  explanation: OfflineReviewReport["bundle"]["explanation"] | undefined,
): void {
  if (!explanation) {
    return;
  }

  const targetMetadataSummary = summarizeWorkflowTargetMetadata(explanation.targetMetadata);
  const contextLines = [
    formatContextLine("Interaction", explanation.targetInteractionId),
    formatContextLine("Lane", explanation.targetLane),
    formatContextLine(
      "Routing Authority",
      explanation.routingAuthority !== undefined
        ? (explanation.routingAuthority ?? "none")
        : undefined,
    ),
    formatContextLine("Headline", explanation.headline),
    formatContextLine("Why Now", explanation.whyNow),
    formatContextLine("Automation", targetMetadataSummary?.automation),
    formatContextLine("Execution", targetMetadataSummary?.execution),
    formatContextLine("Governance", targetMetadataSummary?.governance),
    formatContextLine("Usage", targetMetadataSummary?.usage),
  ].filter((line): line is string => line !== null);

  if (contextLines.length === 0) {
    return;
  }

  lines.push("## Target Context", "", ...contextLines, "");
}

export function buildOfflineReviewPromptPacket(
  artifact: OfflineReviewArtifact,
  options: {
    maxChars?: number;
    maxSteps?: number;
  } = {},
): OfflineReviewPromptPacket {
  const maxChars = options.maxChars ?? DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_CHARS;
  const targetMaxSteps = Math.min(
    options.maxSteps ?? DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_STEPS,
    artifact.steps.length,
  );
  const minSteps = Math.min(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_STEPS, artifact.steps.length);

  let maxSteps = Math.max(minSteps, targetMaxSteps);
  let excerptLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_EXCERPT_CHARS;
  let summaryLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_SUMMARY_CHARS;
  let titleLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_TITLE_CHARS;
  let whyNowLimit = DEFAULT_OFFLINE_REVIEW_PROMPT_MAX_WHY_NOW_CHARS;

  let packet = buildOfflineReviewPromptPacketWithBudget(artifact, {
    maxSteps,
    excerptLimit,
    summaryLimit,
    titleLimit,
    whyNowLimit,
  });

  for (let attempts = 0; attempts < 64; attempts += 1) {
    if (renderOfflineReviewPromptFromPacket(packet).length <= maxChars) {
      return packet;
    }

    if (maxSteps > minSteps) {
      maxSteps -= 1;
    } else if (excerptLimit > DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_EXCERPT_CHARS) {
      excerptLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_EXCERPT_CHARS, excerptLimit - 32);
      summaryLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_SUMMARY_CHARS, summaryLimit - 24);
      titleLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_TITLE_CHARS, titleLimit - 12);
      whyNowLimit = Math.max(DEFAULT_OFFLINE_REVIEW_PROMPT_MIN_WHY_NOW_CHARS, whyNowLimit - 16);
    } else {
      return packet;
    }

    packet = buildOfflineReviewPromptPacketWithBudget(artifact, {
      maxSteps,
      excerptLimit,
      summaryLimit,
      titleLimit,
      whyNowLimit,
    });
  }

  return packet;
}

export function renderOfflineReviewPrompt(artifact: OfflineReviewArtifact): string {
  return renderOfflineReviewPromptFromPacket(buildOfflineReviewPromptPacket(artifact));
}

function renderOfflineReviewPromptFromPacket(packet: OfflineReviewPromptPacket): string {
  const lines = [
    "# Aperture Offline Review Prompt",
    "",
    "Review Aperture's current read for this bundle.",
    "Return JSON only with exactly one top-level `review` object.",
    "Do not include markdown fences, prose preambles, shell commands, or any non-JSON text.",
    "Add findings only for material mistakes or important omissions.",
    "Each finding must include: `stepIndex`, `focusArea`, `expected`, `confidence`.",
    "Optional fields: `supportingText`, `rationale`, `recommendation`.",
    "Recommendations: `promote` for crisp misses, `inspect` for plausible misses, `ignore` for weak disagreements.",
    "If there are no material mistakes, return `{\"review\":{\"findings\":[]}}`.",
    "",
    `Focus areas: ${packet.focusAreas.join(", ")}`,
    `Packet stats: original=${packet.packet.originalStepCount}, included=${packet.packet.includedStepCount}, omitted=${packet.packet.omittedStepCount}`,
    "",
    "```json",
    JSON.stringify(packet),
    "```",
    "",
    "Response shape:",
    "",
    "```json",
    JSON.stringify(
      {
        review: {
          reviewer: "reviewer-name",
          model: "model-id",
          completedAt: "2026-03-27T00:00:00.000Z",
          notes: "optional short note",
          findings: [
            {
              stepIndex: 0,
              focusArea: "title",
              expected: "expected value",
              confidence: "high",
              supportingText: "source evidence",
              rationale: "brief explanation",
              recommendation: "promote",
            },
          ],
        },
      },
      null,
      2,
    ),
    "```",
    "",
  ];

  return `${lines.join("\n")}\n`;
}

function buildOfflineReviewPromptPacketWithBudget(
  artifact: OfflineReviewArtifact,
  limits: {
    maxSteps: number;
    excerptLimit: number;
    summaryLimit: number;
    titleLimit: number;
    whyNowLimit: number;
  },
): OfflineReviewPromptPacket {
  const selectedIndices = selectOfflineReviewPromptStepIndices(artifact.steps, limits.maxSteps);
  const steps = artifact.steps
    .filter((step) => selectedIndices.has(step.stepIndex))
    .map((step) => compactOfflineReviewPromptStep(step, limits));
  const description = artifact.bundle.description
    ? clipOfflineReviewPromptText(artifact.bundle.description, limits.summaryLimit)
    : null;
  const explanationHeadline = artifact.bundle.explanation?.headline
    ? clipOfflineReviewPromptText(artifact.bundle.explanation.headline, limits.whyNowLimit)
    : null;
  const explanationWhyNow = artifact.bundle.explanation?.whyNow
    ? clipOfflineReviewPromptText(artifact.bundle.explanation.whyNow, limits.whyNowLimit)
    : null;
  const targetMetadataSummary = summarizeWorkflowTargetMetadata(
    artifact.bundle.explanation?.targetMetadata,
  );

  return {
    bundle: {
      sessionId: artifact.bundle.sessionId,
      title: clipOfflineReviewPromptText(artifact.bundle.title, limits.titleLimit) ?? artifact.bundle.title,
      ...(description ? { description } : {}),
      ...(artifact.bundle.source?.id ? { sourceId: artifact.bundle.source.id } : {}),
      ...(artifact.bundle.source?.label ? { sourceLabel: artifact.bundle.source.label } : {}),
      ...(explanationHeadline ? { explanationHeadline } : {}),
      ...(explanationWhyNow ? { explanationWhyNow } : {}),
      ...(targetMetadataSummary ? { targetMetadataSummary } : {}),
      ...(artifact.bundle.explanation?.targetLane ? { targetLane: artifact.bundle.explanation.targetLane } : {}),
      ...(artifact.bundle.explanation?.routingAuthority !== undefined
        ? { routingAuthority: artifact.bundle.explanation.routingAuthority }
        : {}),
    },
    focusAreas: [...artifact.focusAreas],
    packet: {
      originalStepCount: artifact.steps.length,
      includedStepCount: steps.length,
      omittedStepCount: Math.max(artifact.steps.length - steps.length, 0),
      compaction: "deterministic",
    },
    steps,
  };
}

function compactOfflineReviewPromptStep(
  step: OfflineReviewPreparedStep,
  limits: {
    excerptLimit: number;
    summaryLimit: number;
    titleLimit: number;
    whyNowLimit: number;
  },
): OfflineReviewPromptStep {
  const stepLabel = step.stepLabel
    ? clipOfflineReviewPromptText(step.stepLabel, limits.titleLimit)
    : null;
  const sourceExcerpt = step.sourceExcerpt
    ? clipOfflineReviewPromptText(step.sourceExcerpt, limits.excerptLimit)
    : null;

  return {
    stepIndex: step.stepIndex,
    stepKind: step.stepKind,
    ...(stepLabel ? { stepLabel } : {}),
    ...(sourceExcerpt ? { sourceExcerpt } : {}),
    ...(step.sourceEvent ? { sourceEvent: compactOfflineReviewEventSummary(step.sourceEvent, limits) } : {}),
    ...(step.normalizedEvent ? { normalizedEvent: compactOfflineReviewEventSummary(step.normalizedEvent, limits) } : {}),
    ...(step.apertureRead ? { apertureRead: compactOfflineReviewRead(step.apertureRead, limits) } : {}),
    ...(step.apertureDecision ? { apertureDecision: compactOfflineReviewDecision(step.apertureDecision) } : {}),
  };
}

function compactOfflineReviewEventSummary(
  event: NonNullable<OfflineReviewPreparedStep["sourceEvent"]>,
  limits: {
    summaryLimit: number;
    titleLimit: number;
  },
): NonNullable<OfflineReviewPromptStep["sourceEvent"]> {
  return {
    type: event.type,
    title: clipOfflineReviewPromptText(event.title, limits.titleLimit),
    summary: clipOfflineReviewPromptText(event.summary, limits.summaryLimit),
    status: event.status,
    toolFamily: event.toolFamily,
  };
}

function compactOfflineReviewRead(
  read: NonNullable<OfflineReviewPreparedStep["apertureRead"]>,
  limits: {
    whyNowLimit: number;
  },
): NonNullable<OfflineReviewPromptStep["apertureRead"]> {
  return {
    ask: read.ask,
    intentFrame: read.intentFrame,
    toolFamily: read.toolFamily,
    consequence: read.consequence,
    blocking: read.blocking,
    episode: read.episode,
    confidence: read.confidence,
    source: read.source,
    abstained: read.abstained,
    whyNow: clipOfflineReviewPromptText(read.whyNow, limits.whyNowLimit),
    relationKinds: read.relationKinds.slice(0, 4),
  };
}

function compactOfflineReviewDecision(
  decision: NonNullable<OfflineReviewPreparedStep["apertureDecision"]>,
): NonNullable<OfflineReviewPromptStep["apertureDecision"]> {
  return {
    evaluationKind: decision.evaluationKind,
    decisionKind: decision.decisionKind,
    resultLane: decision.resultLane,
    semanticInfluence: decision.semanticInfluence.slice(0, 4),
  };
}

function selectOfflineReviewPromptStepIndices(
  steps: OfflineReviewPreparedStep[],
  maxSteps: number,
): Set<number> {
  if (steps.length <= maxSteps) {
    return new Set(steps.map((step) => step.stepIndex));
  }

  const firstStepIndex = steps[0]?.stepIndex ?? 0;
  const lastStepIndex = steps.at(-1)?.stepIndex ?? firstStepIndex;
  const selected = new Set<number>([firstStepIndex, lastStepIndex]);
  const ranked = steps
    .map((step) => ({
      stepIndex: step.stepIndex,
      priority: offlineReviewPromptStepPriority(step, lastStepIndex),
    }))
    .sort((left, right) => right.priority - left.priority || left.stepIndex - right.stepIndex);

  for (const entry of ranked) {
    if (selected.size >= maxSteps) {
      break;
    }
    selected.add(entry.stepIndex);
  }

  return new Set([...selected].sort((left, right) => left - right));
}

function offlineReviewPromptStepPriority(
  step: OfflineReviewPreparedStep,
  lastStepIndex: number,
): number {
  const sourceType = step.sourceEvent?.type;
  const statusPriority =
    step.sourceEvent?.status === "failed" || step.normalizedEvent?.status === "failed"
      ? 850
      : step.sourceEvent?.status === "waiting" || step.normalizedEvent?.status === "waiting"
        ? 700
        : 0;
  const lanePriority = step.apertureDecision?.resultLane === "now"
    ? 650
    : step.apertureDecision?.resultLane === "next"
      ? 600
      : 0;
  const confidencePriority = step.apertureRead?.abstained || step.apertureRead?.confidence === "low"
    ? 550
    : step.apertureRead?.confidence === "medium"
      ? 325
      : 0;
  const consequencePriority = step.apertureRead?.consequence === "high"
    ? 500
    : step.apertureRead?.consequence === "medium"
      ? 250
      : 0;

  return [
    step.stepIndex === 0 || step.stepIndex === lastStepIndex ? 1_000 : 0,
    sourceType === "task.started" || sourceType === "task.completed" || sourceType === "task.cancelled" ? 900 : 0,
    statusPriority,
    lanePriority,
    confidencePriority,
    consequencePriority,
    step.sourceEvent?.toolFamily || step.normalizedEvent?.toolFamily || step.apertureRead?.toolFamily ? 220 : 0,
    step.sourceEvent?.title === "user follow-up" || step.stepLabel?.includes("followup") || step.stepLabel?.includes("follow-up") ? 300 : 0,
    (step.apertureDecision?.semanticInfluence.length ?? 0) > 0 ? 120 : 0,
  ].reduce((total, value) => total + value, 0);
}

function renderValue(value: string | string[] | boolean | null): string {
  if (Array.isArray(value)) return value.length === 0 ? "[]" : value.join(", ");
  return value === null ? "null" : String(value);
}

function compactText(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function clipOfflineReviewPromptText(
  value: string | null | undefined,
  maxLength: number,
): string | null {
  const normalized = compactText(value ?? null);
  return !normalized || normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(maxLength - 3, 1))}...`;
}

function formatContextLine(label: string, value: string | null | undefined): string | null {
  return value ? `- ${label}: ${value}` : null;
}
