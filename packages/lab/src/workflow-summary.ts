import type {
  ApertureEvent,
  TaskStatus,
} from "@tomismeta/aperture-core";

import type { ReplaySessionBundle } from "./session-bundle.js";
import {
  formatWorkflowTargetMetadataRollupSummary,
  formatWorkflowTargetMetadataRollupUsage,
  hasWorkflowTargetMetadataRollup,
  mergeWorkflowTargetMetadataRollups,
  rollupWorkflowTargetMetadata,
  type WorkflowTargetMetadata,
  type WorkflowTargetMetadataRollup,
  validateWorkflowTargetMetadata,
} from "./workflow-metadata.js";

export type WorkflowSummaryRequestCounts = Record<"approval" | "choice" | "form", number>;
export type WorkflowSummaryStatusCounts = Record<TaskStatus, number>;

export type WorkflowSummarySession = {
  sessionId: string;
  title: string;
  exportedAt: string;
  source?: ReplaySessionBundle["source"];
  window: {
    startedAt: string | null;
    endedAt: string | null;
  };
  counts: {
    events: number;
    tasks: number;
    requests: number;
    requestKinds: WorkflowSummaryRequestCounts;
    statuses: WorkflowSummaryStatusCounts;
  };
  workflow?: WorkflowTargetMetadataRollup;
};

export type WorkflowSummaryReport = {
  generatedAt: string;
  input: {
    bundleCount: number;
  };
  summary: {
    sessionCount: number;
    eventCount: number;
    taskCount: number;
    requestCount: number;
    requestKinds: WorkflowSummaryRequestCounts;
    statuses: WorkflowSummaryStatusCounts;
    workflow?: WorkflowTargetMetadataRollup;
  };
  sessions: WorkflowSummarySession[];
};

export function createWorkflowSummaryReport(
  bundles: ReplaySessionBundle[],
  options: {
    generatedAt?: string;
  } = {},
): WorkflowSummaryReport {
  const sessions = bundles
    .map((bundle) => summarizeWorkflowSession(bundle))
    .sort(
      (left, right) =>
        left.sessionId.localeCompare(right.sessionId) || left.exportedAt.localeCompare(right.exportedAt),
    );
  const requestKinds = createRequestCounts();
  const statuses = createStatusCounts();
  const workflow = mergeWorkflowTargetMetadataRollups(sessions.map((session) => session.workflow));

  let eventCount = 0;
  let taskCount = 0;
  let requestCount = 0;

  for (const session of sessions) {
    eventCount += session.counts.events;
    taskCount += session.counts.tasks;
    requestCount += session.counts.requests;
    requestKinds.approval += session.counts.requestKinds.approval;
    requestKinds.choice += session.counts.requestKinds.choice;
    requestKinds.form += session.counts.requestKinds.form;
    statuses.running += session.counts.statuses.running;
    statuses.waiting += session.counts.statuses.waiting;
    statuses.blocked += session.counts.statuses.blocked;
    statuses.failed += session.counts.statuses.failed;
    statuses.completed += session.counts.statuses.completed;
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    input: {
      bundleCount: bundles.length,
    },
    summary: {
      sessionCount: sessions.length,
      eventCount,
      taskCount,
      requestCount,
      requestKinds,
      statuses,
      ...(hasWorkflowTargetMetadataRollup(workflow) ? { workflow } : {}),
    },
    sessions,
  };
}

export function renderWorkflowSummaryMarkdown(
  report: WorkflowSummaryReport,
): string {
  const lines: string[] = [
    "# Workflow Summary",
    "",
    `Generated: ${report.generatedAt}`,
    `Bundles: ${report.input.bundleCount}`,
    `Sessions: ${report.summary.sessionCount}`,
    "",
    "## Overview",
    "",
    `- events: ${formatCount(report.summary.eventCount)}`,
    `- tasks: ${formatCount(report.summary.taskCount)}`,
    `- human requests: ${formatCount(report.summary.requestCount)}`,
    `- approvals: ${formatCount(report.summary.requestKinds.approval)}`,
    `- choices: ${formatCount(report.summary.requestKinds.choice)}`,
    `- forms: ${formatCount(report.summary.requestKinds.form)}`,
  ];

  const statusSummary = formatStatusCounts(report.summary.statuses);
  if (statusSummary) {
    lines.push(`- statuses: ${statusSummary}`);
  }

  const workflowSummary = formatWorkflowTargetMetadataRollupSummary(report.summary.workflow);
  if (workflowSummary) {
    lines.push(`- workflow: ${workflowSummary}`);
  }

  const workflowUsage = formatWorkflowTargetMetadataRollupUsage(report.summary.workflow);
  if (workflowUsage) {
    lines.push(`- workflow usage: ${workflowUsage}`);
  }

  lines.push("", "## Sessions", "");

  if (report.sessions.length === 0) {
    lines.push("- (none)");
    return lines.join("\n");
  }

  for (const session of report.sessions) {
    lines.push(`### ${session.sessionId}`);
    lines.push("");
    lines.push(`- title: ${session.title}`);
    if (session.source?.label || session.source?.id) {
      lines.push(`- source: ${session.source.label ?? session.source.id}`);
    }
    if (session.window.startedAt || session.window.endedAt) {
      lines.push(
        `- window: ${session.window.startedAt ?? "unknown"} -> ${session.window.endedAt ?? "unknown"}`,
      );
    }
    lines.push(`- events: ${formatCount(session.counts.events)}`);
    lines.push(`- tasks: ${formatCount(session.counts.tasks)}`);
    lines.push(`- human requests: ${formatCount(session.counts.requests)}`);

    const requestKinds = [
      session.counts.requestKinds.approval > 0
        ? `approval=${formatCount(session.counts.requestKinds.approval)}`
        : null,
      session.counts.requestKinds.choice > 0
        ? `choice=${formatCount(session.counts.requestKinds.choice)}`
        : null,
      session.counts.requestKinds.form > 0
        ? `form=${formatCount(session.counts.requestKinds.form)}`
        : null,
    ].filter((value): value is string => value !== null);
    if (requestKinds.length > 0) {
      lines.push(`- request kinds: ${requestKinds.join(", ")}`);
    }

    const sessionStatusSummary = formatStatusCounts(session.counts.statuses);
    if (sessionStatusSummary) {
      lines.push(`- statuses: ${sessionStatusSummary}`);
    }

    const sessionWorkflowSummary = formatWorkflowTargetMetadataRollupSummary(session.workflow);
    if (sessionWorkflowSummary) {
      lines.push(`- workflow: ${sessionWorkflowSummary}`);
    }

    const sessionWorkflowUsage = formatWorkflowTargetMetadataRollupUsage(session.workflow);
    if (sessionWorkflowUsage) {
      lines.push(`- workflow usage: ${sessionWorkflowUsage}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}

function summarizeWorkflowSession(bundle: ReplaySessionBundle): WorkflowSummarySession {
  const events = bundle.normalizedEvents.map((snapshot) => snapshot.event);
  const taskIds = new Set<string>();
  const timestamps: string[] = [];
  const requestKinds = createRequestCounts();
  const statuses = createStatusCounts();
  const eventMetadata = readEventWorkflowMetadata(events);
  const fallbackMetadata = validateWorkflowTargetMetadata(bundle.explanation?.targetMetadata);
  const workflow = rollupWorkflowTargetMetadata(
    eventMetadata.length > 0 ? eventMetadata : [fallbackMetadata],
  );

  let requestCount = 0;

  for (const event of events) {
    taskIds.add(event.taskId);
    timestamps.push(event.timestamp);

    if (event.type === "human.input.requested") {
      requestCount += 1;
      requestKinds[event.request.kind] += 1;
      continue;
    }

    if (event.type === "task.updated") {
      statuses[event.status] += 1;
    }
  }

  return {
    sessionId: bundle.sessionId,
    title: bundle.title,
    exportedAt: bundle.exportedAt,
    ...(bundle.source ? { source: bundle.source } : {}),
    window: {
      startedAt: timestamps[0] ?? null,
      endedAt: timestamps[timestamps.length - 1] ?? null,
    },
    counts: {
      events: events.length,
      tasks: taskIds.size,
      requests: requestCount,
      requestKinds,
      statuses,
    },
    ...(hasWorkflowTargetMetadataRollup(workflow) ? { workflow } : {}),
  };
}

function readEventWorkflowMetadata(
  events: ApertureEvent[],
): WorkflowTargetMetadata[] {
  return events.flatMap((event) => {
    const metadata = validateWorkflowTargetMetadata(event.metadata);
    return metadata ? [metadata] : [];
  });
}

function createRequestCounts(): WorkflowSummaryRequestCounts {
  return {
    approval: 0,
    choice: 0,
    form: 0,
  };
}

function createStatusCounts(): WorkflowSummaryStatusCounts {
  return {
    running: 0,
    waiting: 0,
    blocked: 0,
    failed: 0,
    completed: 0,
  };
}

function formatStatusCounts(value: WorkflowSummaryStatusCounts): string | undefined {
  const parts = [
    value.running > 0 ? `running=${formatCount(value.running)}` : null,
    value.waiting > 0 ? `waiting=${formatCount(value.waiting)}` : null,
    value.blocked > 0 ? `blocked=${formatCount(value.blocked)}` : null,
    value.failed > 0 ? `failed=${formatCount(value.failed)}` : null,
    value.completed > 0 ? `completed=${formatCount(value.completed)}` : null,
  ].filter((part): part is string => part !== null);

  return parts.length > 0 ? parts.join(", ") : undefined;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
