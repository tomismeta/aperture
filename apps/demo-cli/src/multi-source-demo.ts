import { ApertureCore } from "@aperture/core";
import type { ApertureEvent } from "@aperture/core";

import { attachAttentionLogging, driveInteractiveAttentionResponses } from "./lib.js";

const core = new ApertureCore();
const now = Date.now();

const stream: ApertureEvent[] = [
  {
    id: "evt:alpha:start",
    taskId: "thread:alpha:deploy",
    timestamp: new Date(now).toISOString(),
    source: {
      id: "openclaw-alpha",
      kind: "paperclip",
      label: "Paperclip Alpha",
    },
    type: "task.started",
    title: "Alpha deploy supervisor preparing release",
    summary: "Collecting deployment context from release subagents.",
  },
  {
    id: "evt:alpha:approval",
    taskId: "thread:alpha:deploy",
    timestamp: new Date(now + 100).toISOString(),
    source: {
      id: "openclaw-alpha",
      kind: "paperclip",
      label: "Paperclip Alpha",
    },
    type: "human.input.requested",
    interactionId: "interrupt:alpha:approval",
    title: "Approve alpha production deploy",
    summary: "Alpha needs explicit human approval before production release.",
    tone: "critical",
    consequence: "high",
    request: {
      kind: "approval",
    },
    context: {
      items: [
        { id: "source", label: "Source", value: "OpenClaw Alpha" },
        { id: "scope", label: "Scope", value: "Payments release" },
      ],
    },
    provenance: {
      whyNow: "A high-impact production release is waiting on approval.",
      factors: ["multiple subagents", "production workflow"],
    },
  },
  {
    id: "evt:beta:start",
    taskId: "thread:beta:refunds",
    timestamp: new Date(now + 150).toISOString(),
    source: {
      id: "openclaw-beta",
      kind: "paperclip",
      label: "Paperclip Beta",
    },
    type: "task.started",
    title: "Beta refunds agent triaging queue",
    summary: "Gathering context for pending refund actions.",
  },
  {
    id: "evt:beta:choice",
    taskId: "thread:beta:refunds",
    timestamp: new Date(now + 200).toISOString(),
    source: {
      id: "openclaw-beta",
      kind: "paperclip",
      label: "Paperclip Beta",
    },
    type: "human.input.requested",
    interactionId: "interrupt:beta:choice",
    title: "Select refund resolution path",
    summary: "Beta needs a fallback policy before continuing.",
    tone: "focused",
    consequence: "medium",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [
        { id: "manual-review", label: "Manual review" },
        { id: "partial-credit", label: "Partial credit" },
      ],
    },
    provenance: {
      whyNow: "A downstream branch depends on this choice.",
    },
  },
  {
    id: "evt:gamma:status",
    taskId: "thread:gamma:observability",
    timestamp: new Date(now + 250).toISOString(),
    source: {
      id: "openclaw-gamma",
      kind: "paperclip",
      label: "Paperclip Gamma",
    },
    type: "task.updated",
    title: "Gamma diagnostics available",
    summary: "A non-blocking diagnostics package is available.",
    status: "waiting",
    progress: 60,
  },
];

attachAttentionLogging(core, "Aperture Multi-Source Attention View");

for (const event of stream) {
  core.publish(event);
}

await driveInteractiveAttentionResponses(core);
