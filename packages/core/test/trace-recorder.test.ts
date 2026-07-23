import assert from "node:assert/strict";
import test from "node:test";

import type { ApertureTrace } from "../src/index.js";

import { ApertureCore } from "../src/aperture-core.js";
import {
  subscribeInternalTrace,
  type ApertureTrace as InternalApertureTrace,
} from "../src/internal-contract.js";

function latestCandidateTrace(traces: ApertureTrace[]) {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index];
    if (trace?.evaluation.kind === "candidate") {
      return trace;
    }
  }

  return null;
}

function latestInternalCandidateTrace(traces: InternalApertureTrace[]) {
  for (let index = traces.length - 1; index >= 0; index -= 1) {
    const trace = traces[index];
    if (trace?.evaluation.kind === "candidate") {
      return trace;
    }
  }

  return null;
}

test("trace recorder captures explanatory-only tool family on question paths", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:question:tool-family",
    type: "human.input.requested",
    taskId: "task:question:tool-family",
    interactionId: "interaction:question:tool-family",
    timestamp: "2026-03-27T20:00:00.000Z",
    source: { id: "custom-agent" },
    title: "Should we read the config first?",
    summary: "Choose the next step.",
    context: {
      items: [{ id: "toolFamily", label: "Tool Family", value: "read" }],
    },
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.eventTransition.kind, "source_normalized");
  assert.equal(
    trace.eventTransition.changedFields.some(
      (field) => field.path === "semantic.toolFamily" && field.after === "read",
    ),
    true,
  );
  assert.equal(
    trace.candidateTransition.changedFields.some(
      (field) => field.path === "episodeState" && field.after === "actionable",
    ),
    true,
  );
  assert.equal(
    trace.frameTransition.changedFields.some(
      (field) => field.path === "responseSpec.kind" && field.after === "choice",
    ),
    true,
  );
  assert.equal(trace.semantic?.toolFamily, "read");
  assert.equal(trace.semantic?.confidence, "low");
  assert.deepEqual(trace.semantic?.ontology, {
    ask: "choice",
    activity: "question",
    consequence: "medium",
    blocking: "blocking",
    episode: "new",
    confidence: "low",
    source: "explicit",
  });
  assert.ok(
    trace.semantic?.influence.includes("tool family stayed context-only on the question/form path"),
  );
  assert.equal(trace.semantic?.provenance?.toolFamily, "source");
  assert.deepEqual(trace.semantic?.impact, {
    routingAuthority: "request",
    decisionBearing: ["activity (canonical)", "consequence (canonical)"],
    explanatory: ["intent", "tool", "why now", "confidence"],
    canonical: ["activity (canonical)", "consequence (canonical)"],
    routing: [],
    continuity: [],
    ambiguity: [],
    contextOnly: ["intent", "tool", "why now", "confidence"],
  });
});

test("trace recorder captures explanatory-only tool family on form paths", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:form:tool-family",
    type: "human.input.requested",
    taskId: "task:form:tool-family",
    interactionId: "interaction:form:tool-family",
    timestamp: "2026-03-27T20:00:30.000Z",
    source: { id: "custom-agent" },
    title: "Fill out the release form",
    summary: "Provide the required deployment fields.",
    context: {
      items: [{ id: "toolFamily", label: "Tool Family", value: "read" }],
    },
    request: {
      kind: "form",
      fields: [{ id: "reason", label: "Reason", input: { kind: "text" } }],
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.toolFamily, "read");
  assert.equal(trace.semantic?.confidence, "low");
  assert.deepEqual(trace.semantic?.ontology, {
    ask: "form",
    activity: "question",
    consequence: "medium",
    blocking: "blocking",
    episode: "new",
    confidence: "low",
    source: "explicit",
  });
  assert.ok(
    trace.semantic?.influence.includes("tool family stayed context-only on the question/form path"),
  );
  assert.equal(trace.semantic?.provenance?.toolFamily, "source");
  assert.deepEqual(trace.semantic?.impact, {
    routingAuthority: "request",
    decisionBearing: ["activity (canonical)", "consequence (canonical)"],
    explanatory: ["intent", "tool", "why now", "confidence"],
    canonical: ["activity (canonical)", "consequence (canonical)"],
    routing: [],
    continuity: [],
    ambiguity: [],
    contextOnly: ["intent", "tool", "why now", "confidence"],
  });
});

test("trace recorder explains that status remains authoritative on task updates", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:status:semantic",
    type: "task.updated",
    taskId: "task:status:semantic",
    timestamp: "2026-03-27T20:01:00.000Z",
    source: { id: "custom-agent" },
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.ok(
    trace.semantic?.influence.includes(
      "task status stayed authoritative for candidate routing; semantic details still affected context, continuity, ambiguity handling, and ontology diagnostics",
    ),
  );
  assert.equal(trace.semantic?.intentFrame, "status_update");
  assert.deepEqual(trace.semantic?.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "low",
    blocking: "waiting",
    episode: "unknown",
    confidence: "high",
    source: "explicit",
  });
  assert.equal(trace.semantic?.provenance?.intentFrame, "inferred");
  assert.deepEqual(trace.semantic?.impact, {
    routingAuthority: "status",
    decisionBearing: ["activity (canonical)"],
    explanatory: ["intent", "consequence", "confidence"],
    canonical: ["activity (canonical)"],
    routing: [],
    continuity: [],
    ambiguity: [],
    contextOnly: ["intent", "consequence", "confidence"],
  });
});

test("trace recorder marks operator-directed status asks as inferred semantic evidence", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:status:direct-ask",
    type: "task.updated",
    taskId: "task:status:direct-ask",
    timestamp: "2026-03-27T20:01:15.000Z",
    source: { id: "custom-agent" },
    title: "Need your approval before continuing",
    summary: "Can you approve the deploy so work can continue?",
    status: "waiting",
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.deepEqual(trace.semantic?.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "low",
    blocking: "waiting",
    episode: "unknown",
    confidence: "low",
    source: "inferred",
  });
  assert.deepEqual(trace.semantic?.impact, {
    routingAuthority: "status",
    decisionBearing: ["activity (canonical)", "confidence (ambiguity)"],
    explanatory: ["intent", "consequence", "why now"],
    canonical: ["activity (canonical)"],
    routing: [],
    continuity: [],
    ambiguity: ["confidence (ambiguity)"],
    contextOnly: ["intent", "consequence", "why now"],
  });
});

test("trace recorder promotes abstention to ambiguity-bearing impact on non-blocking status work", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:status:abstained",
    type: "task.updated",
    taskId: "task:status:abstained",
    timestamp: "2026-03-27T20:01:30.000Z",
    source: { id: "custom-agent" },
    title: "Still waiting on dependency fetch",
    summary: "Work is still waiting while the semantic layer abstains for now.",
    status: "waiting",
    semanticHints: {
      abstained: true,
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.abstained, true);
  assert.deepEqual(trace.semantic?.ontology, {
    ask: "status",
    activity: "task_progress",
    consequence: "low",
    blocking: "waiting",
    episode: "unknown",
    confidence: "high",
    source: "hinted",
  });
  assert.ok(
    trace.semantic?.influence.includes(
      "semantic abstention can keep non-blocking status work peripheral until clearer evidence arrives",
    ),
  );
  assert.deepEqual(trace.semantic?.impact, {
    routingAuthority: "status",
    decisionBearing: ["activity (canonical)", "abstention (ambiguity)"],
    explanatory: ["intent", "consequence", "confidence"],
    canonical: ["activity (canonical)"],
    routing: [],
    continuity: [],
    ambiguity: ["abstention (ambiguity)"],
    contextOnly: ["intent", "consequence", "confidence"],
  });
});

test("trace recorder exposes blocked-like waiting status queue decisions without changing status mode", () => {
  const core = new ApertureCore();
  const traces: InternalApertureTrace[] = [];

  subscribeInternalTrace(core, (trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:status:blocking-read",
    type: "task.updated",
    taskId: "task:status:blocking-read",
    timestamp: "2026-03-27T20:01:45.000Z",
    source: { id: "custom-agent" },
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
  });

  const trace = latestInternalCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.intentFrame, "blocked_work");
  assert.equal(trace.semantic?.ontology.blocking, "blocking");
  assert.equal(trace.coordination.kind, "queue");
  assert.equal(trace.coordination.resultLane, "now");
  assert.equal(trace.decisionRecord.planning.route, "queue");
  assert.equal(trace.decisionRecord.planning.plannedLane, "next");
  assert.deepEqual(trace.decisionRecord.planning.reasonCodes, trace.coordination.reasonCodes);
  assert.ok(trace.decisionRecord.planning.reasonCodes.includes("route:queue"));
  assert.ok(trace.decisionRecord.planning.reasonCodes.includes("lane:next"));
  assert.ok(trace.decisionRecord.planning.reasonCodes.includes("evidence:current_frame:absent"));
  assert.equal(trace.decisionRecord.value.claimScore, trace.coordination.candidateScore);
  assert.equal(trace.decisionRecord.value.currentScore, trace.coordination.currentScore);
  assert.equal(trace.decisionRecord.policy.criterion, trace.coordination.criterion);
  assert.equal(trace.decisionRecord.evidenceSnapshot.currentFrameId, null);
  assert.ok(
    trace.semantic?.influence.includes(
      "semantic blocking marked the waiting status as blocked-like for peripheral routing while status handling stayed non-blocking",
    ),
  );
  assert.equal(trace.semantic?.impact.routingAuthority, "status");
  assert.deepEqual(trace.semantic?.impact.routing, ["blocking (peripheral routing)"]);
  assert.ok(trace.semantic?.impact.decisionBearing.includes("blocking (peripheral routing)"));
});

test("trace recorder preserves hint-driven semantic provenance", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:hinted:approval",
    type: "human.input.requested",
    taskId: "task:hinted:approval",
    interactionId: "interaction:hinted:approval",
    timestamp: "2026-03-27T20:02:00.000Z",
    source: { id: "custom-agent" },
    title: "Approve read",
    summary: "Read a file in the repo.",
    request: { kind: "approval" },
    semanticHints: {
      consequence: "high",
      whyNow: "A policy escalation requires senior review.",
      reasons: ["adapter provided a trusted escalation hint"],
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.consequence, "high");
  assert.deepEqual(trace.semantic?.ontology, {
    ask: "approval",
    activity: "decision_request",
    consequence: "high",
    blocking: "blocking",
    episode: "new",
    confidence: "medium",
    source: "hinted",
  });
  assert.equal(trace.semantic?.whyNow, "A policy escalation requires senior review.");
  assert.equal(trace.semantic?.provenance?.consequence, "hint");
  assert.equal(trace.semantic?.provenance?.whyNow, "hint");
  assert.deepEqual(trace.semantic?.impact, {
    routingAuthority: "request",
    decisionBearing: ["activity (canonical)", "consequence (canonical)", "tool (approval path)"],
    explanatory: ["intent", "why now", "confidence"],
    canonical: ["activity (canonical)", "consequence (canonical)", "tool (approval path)"],
    routing: [],
    continuity: [],
    ambiguity: [],
    contextOnly: ["intent", "why now", "confidence"],
  });
});

test("trace recorder classifies canonical activity and continuity hints on human input", () => {
  const core = new ApertureCore();
  const traces: ApertureTrace[] = [];

  core.onTrace((trace) => {
    traces.push(trace);
  });

  core.publishSourceEvent({
    id: "src:choice:activity-and-relations",
    type: "human.input.requested",
    taskId: "task:choice:activity-and-relations",
    interactionId: "interaction:choice:activity-and-relations",
    timestamp: "2026-03-27T20:02:30.000Z",
    source: { id: "custom-agent" },
    title: "Should we inspect the config first?",
    summary: "Choose the next step again.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
    semanticHints: {
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      reasons: ["adapter linked this request to the previous interaction"],
    },
  });

  const trace = latestCandidateTrace(traces);
  assert.ok(trace);
  assert.equal(trace?.evaluation.kind, "candidate");
  if (!trace || trace.evaluation.kind !== "candidate") {
    return;
  }

  assert.equal(trace.semantic?.activityClass, "question_request");
  assert.deepEqual(
    trace.semantic?.relationHints.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
  assert.ok(
    trace.semantic?.influence.includes("activity class was projected into the canonical request"),
  );
  assert.ok(trace.semantic?.influence.includes("relation hints informed continuity handling"));
  assert.deepEqual(trace.semantic?.impact, {
    routingAuthority: "request",
    decisionBearing: ["activity (canonical)", "consequence (canonical)", "relations (continuity)"],
    explanatory: ["intent", "why now", "confidence"],
    canonical: ["activity (canonical)", "consequence (canonical)"],
    routing: [],
    continuity: ["relations (continuity)"],
    ambiguity: [],
    contextOnly: ["intent", "why now", "confidence"],
  });
});
