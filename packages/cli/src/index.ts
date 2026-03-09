import type { ApertureTrace, AttentionView, Frame, TaskView } from "@aperture/core";

export function renderFrame(frame: Frame | null): string {
  if (!frame) {
    return "No active Aperture frame.";
  }

  const lines = [frame.title];

  if (frame.summary) {
    lines.push("", frame.summary);
  }

  if (frame.context?.items && frame.context.items.length > 0) {
    lines.push("", "Context");
    for (const fact of frame.context.items) {
      lines.push(`- ${fact.label}: ${fact.value ?? "n/a"}`);
    }
  }

  const provenance = [
    ...(frame.provenance?.whyNow ? [frame.provenance.whyNow] : []),
    ...(frame.provenance?.factors ?? []),
  ];

  if (provenance.length > 0) {
    lines.push("", "Why now");
    for (const item of provenance) {
      lines.push(`- ${item}`);
    }
  }

  const attention = readAttention(frame);
  if (attention) {
    lines.push("", "Attention");
    lines.push(`- score offset: ${attention.scoreOffset}`);
    for (const item of attention.rationale) {
      lines.push(`- ${item}`);
    }
  }

  const actions = frame.responseSpec && frame.responseSpec.kind !== "none" ? frame.responseSpec.actions : [];

  if (actions.length > 0) {
    lines.push("", "Actions");
    for (const action of actions) {
      lines.push(`- ${action.label} [${action.id}]`);
    }
  }

  return lines.join("\n");
}

export function renderTaskView(taskView: TaskView): string {
  const lines = ["Task View"];

  lines.push("", "Active");
  lines.push(taskView.active ? renderFrameSummary(taskView.active) : "- none");

  lines.push("", "Queued");
  if (taskView.queued.length === 0) {
    lines.push("- none");
  } else {
    for (const frame of taskView.queued) {
      lines.push(renderFrameSummary(frame));
    }
  }

  lines.push("", "Ambient");
  if (taskView.ambient.length === 0) {
    lines.push("- none");
  } else {
    for (const frame of taskView.ambient) {
      lines.push(renderFrameSummary(frame));
    }
  }

  return lines.join("\n");
}

export function renderAttentionView(attentionView: AttentionView): string {
  const lines = ["Attention View"];

  lines.push("", "Active");
  lines.push(attentionView.active ? renderFrameSummary(attentionView.active) : "- none");

  lines.push("", "Queued");
  if (attentionView.queued.length === 0) {
    lines.push("- none");
  } else {
    for (const frame of attentionView.queued) {
      lines.push(renderFrameSummary(frame));
    }
  }

  lines.push("", "Ambient");
  if (attentionView.ambient.length === 0) {
    lines.push("- none");
  } else {
    for (const frame of attentionView.ambient) {
      lines.push(renderFrameSummary(frame));
    }
  }

  return lines.join("\n");
}

export function renderTrace(trace: ApertureTrace): string {
  const lines = ["Aperture Trace"];

  lines.push("", `Event: ${trace.event.type}`);
  lines.push(`Task: ${trace.event.taskId}`);

  switch (trace.evaluation.kind) {
    case "noop":
      lines.push("Evaluation: noop");
      break;
    case "clear":
      lines.push(`Evaluation: clear (${trace.evaluation.taskId})`);
      break;
    case "candidate": {
      if (!isCandidateTrace(trace)) {
        break;
      }
      const candidateTrace = trace;
      lines.push(
        `Evaluation: ${candidateTrace.evaluation.original.mode} -> ${candidateTrace.evaluation.adjusted.mode}`,
      );
      lines.push(`Decision: ${candidateTrace.coordination.kind}`);
      lines.push(`Candidate score: ${candidateTrace.coordination.candidateScore}`);
      lines.push(
        `Current score: ${candidateTrace.coordination.currentScore ?? "n/a"}`,
      );
      lines.push(`Task attention state: ${candidateTrace.taskAttentionState}`);
      lines.push(`Global attention state: ${candidateTrace.globalAttentionState}`);
      lines.push(`Heuristic offset: ${candidateTrace.heuristics.scoreOffset}`);
      if (candidateTrace.heuristics.rationale.length > 0) {
        lines.push("", "Heuristics");
        for (const item of candidateTrace.heuristics.rationale) {
          lines.push(`- ${item}`);
        }
      }
      break;
    }
  }

  return lines.join("\n");
}

function isCandidateTrace(
  trace: ApertureTrace,
): trace is Extract<ApertureTrace, { coordination: unknown; heuristics: unknown }> {
  return "coordination" in trace && "heuristics" in trace;
}

function renderFrameSummary(frame: Frame): string {
  const source = frame.source?.label ?? frame.source?.id;
  return source ? `- ${frame.title} (${source})` : `- ${frame.title}`;
}

function readAttention(
  frame: Frame,
): { scoreOffset: number; rationale: string[] } | null {
  const attention = frame.metadata?.attention;
  if (!attention || typeof attention !== "object") {
    return null;
  }

  const scoreOffset =
    "scoreOffset" in attention && typeof attention.scoreOffset === "number"
      ? attention.scoreOffset
      : null;
  const rationale =
    "rationale" in attention && Array.isArray(attention.rationale)
      ? attention.rationale.filter((item): item is string => typeof item === "string")
      : [];

  if (scoreOffset === null && rationale.length === 0) {
    return null;
  }

  return {
    scoreOffset: scoreOffset ?? 0,
    rationale,
  };
}
