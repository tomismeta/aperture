import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { EventEvaluator } from "../src/event-evaluator.js";
import { normalizeSourceEvent } from "../src/semantic-normalizer.js";
import { readBoundedToolFamily } from "../src/interaction-taxonomy.js";

const evaluation = new EventEvaluator();
const timestamp = "2026-03-27T17:00:00.000Z";

test("task-failure judgment agreement stays behind the normalized observation boundary", () => {
  const source = readFileSync(new URL("../src/judgment-input.ts", import.meta.url), "utf8");

  assert.match(source, /readObservationExpectedSemanticRead/);
  assert.equal(source.includes("type TaskFailureSemanticEvidence"), false);
  assert.equal(source.includes("readTaskFailureSemanticAgreement"), false);
  assert.equal(source.includes("failureEvidenceAgreesWithSemanticRead"), false);
  assert.equal(source.includes("normalizeTaskFailureObservation"), false);
  assert.equal(source.includes("draftObservation"), false);
  assert.equal(source.includes("type TaskFailureObservationCore"), false);
  assert.match(source, /readTaskFailureObservationCore/);
  assert.match(source, /ObservationSemantics/);
  assert.match(source, /enrichTaskFailureObservation/);
  assert.match(source, /function readObservationSemanticAgreement/);
  assert.match(source, /function observationAgreesWithSemanticRead/);

  for (const rawEvidenceBranch of [
    "failureEvidence.kind",
    "failureEvidence.failureDetail",
    "failureEvidence.readsAsObservation",
    "failureEvidence.consequenceBaseline",
  ]) {
    assert.equal(source.includes(rawEvidenceBranch), false, rawEvidenceBranch);
  }
});

test("task-failure semantic interpreter stays behind the observation-core boundary", () => {
  const source = readFileSync(new URL("../src/semantic-interpreter.ts", import.meta.url), "utf8");

  assert.match(source, /readTaskFailureObservationCore/);
  assert.match(source, /observationReadsAsStatusUpdate/);
  assert.match(source, /observation-semantic-read/);
  assert.equal(source.includes("type TaskFailureObservationCore"), false);

  for (const rawEvidenceBranch of [
    "failureEvidence.kind",
    "failureEvidence.failureDetail",
    "failureEvidence.readsAsObservation",
    "failureEvidence.consequenceBaseline",
    "failureEvidence?.kind",
    "failureEvidence?.failureDetail",
    "failureEvidence?.readsAsObservation",
    "failureEvidence?.consequenceBaseline",
  ]) {
    assert.equal(source.includes(rawEvidenceBranch), false, rawEvidenceBranch);
  }
});

test("observation semantics stays source-internal and out of package entrypoints", () => {
  for (const entrypoint of [
    "../src/index.ts",
    "../src/semantic.ts",
    "../src/internal-contract.ts",
  ]) {
    const source = readFileSync(new URL(entrypoint, import.meta.url), "utf8");
    assert.equal(source.includes("ObservationSemantics"), false, entrypoint);
    assert.equal(source.includes("observation-semantics"), false, entrypoint);
    assert.equal(source.includes("observation-semantic-read"), false, entrypoint);
    assert.equal(source.includes("task-failure-observation-grammar"), false, entrypoint);
    assert.equal(source.includes("task-failure-payload-observation-grammar"), false, entrypoint);
    assert.equal(source.includes("task-failure-evidence-observation-grammar"), false, entrypoint);
    assert.equal(source.includes("TaskFailureObservationGrammarInput"), false, entrypoint);
    assert.equal(source.includes("TaskFailurePayloadObservationGrammarInput"), false, entrypoint);
  }
});

test("observation semantics owns vocabulary upstream of normalized observations", () => {
  const semantics = readFileSync(
    new URL("../src/observation-semantics.ts", import.meta.url),
    "utf8",
  );
  const normalized = readFileSync(
    new URL("../src/normalized-observation.ts", import.meta.url),
    "utf8",
  );

  assert.equal(semantics.includes("normalized-observation"), false);
  assert.match(normalized, /from "\.\/observation-semantics\.js"/);
});

test("observation semantic read owns consumer-facing status/failure mapping", () => {
  const semanticRead = readFileSync(
    new URL("../src/observation-semantic-read.ts", import.meta.url),
    "utf8",
  );
  const semanticEvidence = readFileSync(
    new URL("../src/semantic-evidence.ts", import.meta.url),
    "utf8",
  );
  const interpreter = readFileSync(
    new URL("../src/semantic-interpreter.ts", import.meta.url),
    "utf8",
  );
  const judgmentInput = readFileSync(new URL("../src/judgment-input.ts", import.meta.url), "utf8");

  assert.match(semanticRead, /readObservationExpectedSemanticRead/);
  assert.match(semanticRead, /observationReadsAsStatusUpdate/);
  assert.equal(semanticRead.includes("export type ObservationExpectedSemanticRead"), false);
  assert.match(semanticEvidence, /readObservationExpectedSemanticRead/);
  assert.match(interpreter, /observationReadsAsStatusUpdate/);
  assert.match(judgmentInput, /readObservationExpectedSemanticRead/);
  assert.equal(semanticEvidence.includes("failureEvidence.readsAsObservation"), false);
  assert.equal(judgmentInput.includes("const readsAsObservation ="), false);
  assert.equal(interpreter.includes("function observationReadsAsStatusUpdate"), false);
});

test("task-failure observation grammar stays document-first and source-internal", () => {
  const grammar = readFileSync(
    new URL("../src/task-failure-observation-grammar.ts", import.meta.url),
    "utf8",
  );
  const payloadGrammar = readFileSync(
    new URL("../src/task-failure-payload-observation-grammar.ts", import.meta.url),
    "utf8",
  );
  const evidenceGrammar = readFileSync(
    new URL("../src/task-failure-evidence-observation-grammar.ts", import.meta.url),
    "utf8",
  );
  const core = readFileSync(
    new URL("../src/task-failure-observation-core.ts", import.meta.url),
    "utf8",
  );
  const signals = readFileSync(
    new URL("../src/semantic-task-failure-signals.ts", import.meta.url),
    "utf8",
  );
  const evidence = readFileSync(new URL("../src/semantic-evidence.ts", import.meta.url), "utf8");
  const payloadShapes = readFileSync(
    new URL("../src/semantic-payload-observation-shapes.ts", import.meta.url),
    "utf8",
  );

  assert.match(grammar, /readTaskFailureObservationSemantics/);
  assert.match(grammar, /readTaskFailurePayloadObservationSemantics/);
  assert.match(grammar, /ObservationSemantics/);
  assert.match(payloadGrammar, /readTaskFailurePayloadObservationSemantics/);
  assert.match(payloadGrammar, /ObservationSemantics/);
  assert.match(evidenceGrammar, /readTaskFailureEvidenceObservationSemantics/);
  assert.match(evidenceGrammar, /ObservationSemantics/);
  assert.match(evidenceGrammar, /import type \{ TaskFailureSemanticEvidence \}/);
  assert.match(core, /readTaskFailureEvidenceObservationSemantics/);
  for (const rawEvidenceBranch of [
    "evidence.kind",
    "evidence.failureDetail",
    "evidence.readsAsObservation",
    "evidence.consequenceBaseline",
  ]) {
    assert.equal(core.includes(rawEvidenceBranch), false, rawEvidenceBranch);
  }
  assert.equal(grammar.includes("export type TaskFailureObservation ="), false);
  assert.equal(grammar.includes("export type TaskFailureObservationGrammarInput"), false);
  assert.equal(
    payloadGrammar.includes("export type TaskFailurePayloadObservationGrammarInput"),
    false,
  );
  assert.equal(evidenceGrammar.includes("export type TaskFailureEvidenceObservationInput"), false);
  assert.equal(/export\s+type\s+\w*(?:Match|Signals)\b/.test(grammar), false);
  assert.equal(/export\s+type\s+\w*(?:Match|Signals)\b/.test(payloadGrammar), false);
  assert.equal(/export\s+type\s+\w*(?:Match|Signals)\b/.test(evidenceGrammar), false);
  assert.equal(payloadShapes.includes("TaskFailureStructuredOutputEnvelope"), false);
  assert.equal(payloadShapes.includes("semantic-tool-family"), false);
  assert.equal(payloadShapes.includes("ObservationSemantics"), false);
  assert.equal(grammar.includes("TaskFailureObservationEvidenceKind"), false);
  assert.equal(grammar.includes("structured_tool_output_observation"), false);
  assert.equal(grammar.includes("semantic-failure-detail"), false);
  assert.match(signals, /readTaskFailureObservationSemantics/);
  assert.equal(signals.includes("TaskFailureObservationMatch"), false);

  for (const forbidden of [
    "normalized-observation",
    "task-failure-observation-normalizer",
    "semantic-ontology",
    "semantic-interpreter",
    "judgment-input",
    "./semantic.js",
    "./index.js",
  ]) {
    assert.equal(grammar.includes(forbidden), false, forbidden);
    assert.equal(payloadGrammar.includes(forbidden), false, forbidden);
    assert.equal(evidenceGrammar.includes(forbidden), false, forbidden);
  }

  for (const removedPayloadField of [
    "rawReadSourceObservation",
    "rawReadListingObservation",
    "rawReadObservationBaseline",
    "rawReadStructuredObservation",
    "structuredOutputSingleListingObservation",
    "structuredOutputSourceObservation",
    "structuredOutputObservation",
  ]) {
    assert.equal(signals.includes(removedPayloadField), false, removedPayloadField);
    assert.equal(evidence.includes(removedPayloadField), false, removedPayloadField);
  }

  for (const leafModule of [
    "../src/semantic-command-text-observation-boundaries.ts",
    "../src/semantic-listing-observation-shapes.ts",
    "../src/semantic-owned-observation-payload-shapes.ts",
    "../src/semantic-owned-read-observation-shapes.ts",
    "../src/semantic-payload-observation-shapes.ts",
    "../src/semantic-read-observation-shapes.ts",
    "../src/semantic-source-observation-shapes.ts",
  ]) {
    const source = readFileSync(new URL(leafModule, import.meta.url), "utf8");
    assert.equal(source.includes("task-failure-observation-grammar"), false, leafModule);
    assert.equal(source.includes("task-failure-payload-observation-grammar"), false, leafModule);
    assert.equal(source.includes("ObservationSemantics"), false, leafModule);
  }
});

function candidateShape(candidate: {
  mode: string;
  priority: string;
  tone: string;
  consequence: string;
  blocking: boolean;
  responseSpec: { kind: string };
}) {
  return {
    mode: candidate.mode,
    priority: candidate.priority,
    tone: candidate.tone,
    consequence: candidate.consequence,
    blocking: candidate.blocking,
    responseSpec: candidate.responseSpec.kind,
  };
}

test("task.updated keeps status routing authoritative even when semantic fields are richer", () => {
  const result = evaluation.evaluate({
    id: "evt:status-contract",
    taskId: "task:status-contract",
    timestamp: "2026-03-27T17:00:00.000Z",
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
    semantic: {
      intentFrame: "approval_request",
      activityClass: "question_request",
      consequence: "high",
      whyNow: "Semantic layer thinks this resembles an approval checkpoint.",
      factors: ["task.updated", "waiting", "semantic approval checkpoint"],
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      confidence: "low",
      reasons: ["diagnostic semantic read"],
    },
  });

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.mode, "status");
  assert.equal(result.candidate.priority, "background");
  assert.equal(result.candidate.tone, "ambient");
  assert.equal(result.candidate.consequence, "low");
  assert.equal(result.candidate.responseSpec.kind, "none");
  assert.deepEqual(
    result.candidate.relationHints?.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
  assert.equal(
    result.candidate.provenance?.whyNow,
    "Semantic layer thinks this resembles an approval checkpoint.",
  );
});

test("task.updated allows named observational status-conflict routing exceptions", () => {
  const result = evaluation.evaluate(
    normalizeSourceEvent({
      id: "evt:status-contract:routine-observation-conflict",
      taskId: "task:status-contract:routine-observation-conflict",
      timestamp,
      type: "task.updated",
      title: "bash failure",
      summary: "Your command ran successfully and did not produce any output.",
      status: "failed",
      toolFamily: "bash",
    }),
  );

  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.deepEqual(candidateShape(result.candidate), {
    mode: "status",
    priority: "background",
    tone: "ambient",
    consequence: "low",
    blocking: false,
    responseSpec: "none",
  });
  assert.equal(result.candidate.judgmentInput.routineObservationalStatusConflict, true);
});

test("explanation-only semantic fields do not change task.updated routing", () => {
  const baseline = evaluation.evaluate({
    id: "evt:status-explanation:baseline",
    taskId: "task:status-explanation",
    timestamp,
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
  });

  const variants = [
    {
      name: "intentFrame",
      semantic: {
        intentFrame: "approval_request" as const,
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic read"],
      },
    },
    {
      name: "whyNow",
      semantic: {
        whyNow: "Semantic layer thinks this resembles an approval checkpoint.",
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic read"],
      },
    },
    {
      name: "factors",
      semantic: {
        factors: ["task.updated", "waiting", "diagnostic factor"],
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic read"],
      },
    },
    {
      name: "reasons",
      semantic: {
        relationHints: [],
        confidence: "high" as const,
        reasons: ["diagnostic semantic reason"],
      },
    },
  ];

  assert.equal(baseline.kind, "candidate");
  if (baseline.kind !== "candidate") {
    return;
  }

  for (const variant of variants) {
    const result = evaluation.evaluate({
      id: `evt:status-explanation:${variant.name}`,
      taskId: "task:status-explanation",
      timestamp,
      type: "task.updated",
      title: "Waiting for approval",
      summary: "Approval required before deploy can continue.",
      status: "waiting",
      semantic: variant.semantic,
    });

    assert.equal(result.kind, "candidate");
    if (result.kind !== "candidate") {
      continue;
    }

    assert.deepEqual(candidateShape(result.candidate), candidateShape(baseline.candidate));
  }
});

test("relation hints stay continuity-bearing without changing status routing shape", () => {
  const baseline = evaluation.evaluate({
    id: "evt:status-relation:baseline",
    taskId: "task:status-relation",
    timestamp,
    type: "task.updated",
    title: "Waiting for approval",
    summary: "Approval required before deploy can continue.",
    status: "waiting",
  });

  const related = evaluation.evaluate({
    id: "evt:status-relation:related",
    taskId: "task:status-relation",
    timestamp,
    type: "task.updated",
    title: "Waiting for approval again",
    summary: "Approval required again before deploy can continue.",
    status: "waiting",
    semantic: {
      relationHints: [{ kind: "same_issue" }, { kind: "repeats" }],
      confidence: "high",
      reasons: ["diagnostic continuity read"],
    },
  });

  assert.equal(baseline.kind, "candidate");
  assert.equal(related.kind, "candidate");
  if (baseline.kind !== "candidate" || related.kind !== "candidate") {
    return;
  }

  assert.deepEqual(candidateShape(related.candidate), candidateShape(baseline.candidate));
  assert.deepEqual(
    related.candidate.relationHints?.map((hint) => hint.kind),
    ["same_issue", "repeats"],
  );
});

test("semantic abstention stays ambiguity-bearing without changing task.updated routing shape", () => {
  const baseline = evaluation.evaluate({
    id: "evt:status-abstention:baseline",
    taskId: "task:status-abstention",
    timestamp,
    type: "task.updated",
    title: "Still waiting",
    summary: "Work is still waiting on a dependency.",
    status: "waiting",
  });

  const abstained = evaluation.evaluate({
    id: "evt:status-abstention:abstained",
    taskId: "task:status-abstention",
    timestamp,
    type: "task.updated",
    title: "Still waiting",
    summary: "Work is still waiting on a dependency.",
    status: "waiting",
    semantic: {
      relationHints: [],
      confidence: "high",
      abstained: true,
      reasons: ["semantic layer is intentionally abstaining until stronger evidence arrives"],
      factors: ["task.updated", "waiting", "semantic abstention"],
    },
  });

  assert.equal(baseline.kind, "candidate");
  assert.equal(abstained.kind, "candidate");
  if (baseline.kind !== "candidate" || abstained.kind !== "candidate") {
    return;
  }

  assert.deepEqual(candidateShape(abstained.candidate), candidateShape(baseline.candidate));
  assert.equal(abstained.candidate.judgmentInput.semanticEvidence?.confidence, "high");
  assert.equal(abstained.candidate.judgmentInput.semanticEvidence?.abstained, true);
});

test("bounded tool-family use stays available for approval requests", () => {
  assert.equal(
    readBoundedToolFamily({
      mode: "approval",
      title: "Approve read",
      summary: "Read src/index.ts",
    }),
    "read",
  );
});

test("tool family remains decision-bearing on approvals but explanatory on choice requests", () => {
  const approvalBaseline = normalizeSourceEvent({
    id: "evt:approval-no-tool-family",
    type: "human.input.requested",
    taskId: "task:approval-tool-family",
    interactionId: "interaction:approval-no-tool-family",
    timestamp,
    title: "Approve proposed step",
    summary: "Continue with the proposed action.",
    request: { kind: "approval" },
  });
  const approvalRead = normalizeSourceEvent({
    id: "evt:approval-read-tool-family",
    type: "human.input.requested",
    taskId: "task:approval-tool-family",
    interactionId: "interaction:approval-read-tool-family",
    timestamp,
    title: "Approve proposed step",
    summary: "Continue with the proposed action.",
    toolFamily: "read",
    request: { kind: "approval" },
  });

  assert.equal(approvalBaseline.type, "human.input.requested");
  assert.equal(approvalRead.type, "human.input.requested");
  if (
    approvalBaseline.type !== "human.input.requested" ||
    approvalRead.type !== "human.input.requested"
  ) {
    return;
  }

  assert.equal(approvalBaseline.consequence, "medium");
  assert.equal(approvalRead.consequence, "low");

  const choiceBaseline = normalizeSourceEvent({
    id: "evt:choice-no-tool-family",
    type: "human.input.requested",
    taskId: "task:choice-tool-family",
    interactionId: "interaction:choice-no-tool-family",
    timestamp,
    title: "Should we inspect the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });
  const choiceRead = normalizeSourceEvent({
    id: "evt:choice-read-tool-family",
    type: "human.input.requested",
    taskId: "task:choice-tool-family",
    interactionId: "interaction:choice-read-tool-family",
    timestamp,
    title: "Should we inspect the config first?",
    summary: "Choose the next step.",
    toolFamily: "read",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  assert.equal(choiceBaseline.type, "human.input.requested");
  assert.equal(choiceRead.type, "human.input.requested");
  if (
    choiceBaseline.type !== "human.input.requested" ||
    choiceRead.type !== "human.input.requested"
  ) {
    return;
  }

  assert.equal(choiceRead.toolFamily, undefined);
  assert.equal(choiceRead.semantic?.toolFamily, "read");

  const evaluatedBaseline = evaluation.evaluate(choiceBaseline);
  const evaluatedRead = evaluation.evaluate(choiceRead);
  assert.equal(evaluatedBaseline.kind, "candidate");
  assert.equal(evaluatedRead.kind, "candidate");
  if (evaluatedBaseline.kind !== "candidate" || evaluatedRead.kind !== "candidate") {
    return;
  }

  assert.deepEqual(
    candidateShape(evaluatedRead.candidate),
    candidateShape(evaluatedBaseline.candidate),
  );
  assert.equal(evaluatedRead.candidate.toolFamily, undefined);
});

test("activity class is projected into canonical human input and candidate metadata", () => {
  const normalized = normalizeSourceEvent({
    id: "evt:choice-activity-class",
    type: "human.input.requested",
    taskId: "task:choice-activity-class",
    interactionId: "interaction:choice-activity-class",
    timestamp,
    title: "Should we inspect the config first?",
    summary: "Choose the next step.",
    request: {
      kind: "choice",
      selectionMode: "single",
      options: [{ id: "yes", label: "Yes" }],
    },
  });

  assert.equal(normalized.type, "human.input.requested");
  if (normalized.type !== "human.input.requested") {
    return;
  }

  assert.equal(normalized.activityClass, "question_request");
  assert.equal(normalized.semantic?.activityClass, "question_request");
  assert.equal(normalized.semantic?.provenance?.activityClass, "inferred");

  const result = evaluation.evaluate(normalized);
  assert.equal(result.kind, "candidate");
  if (result.kind !== "candidate") {
    return;
  }

  assert.equal(result.candidate.activityClass, "question_request");
  assert.equal(result.candidate.mode, "choice");
  assert.equal(result.candidate.responseSpec.kind, "choice");
});

test("bounded tool-family use does not apply to explicit question requests", () => {
  assert.equal(
    readBoundedToolFamily({
      mode: "choice",
      activityClass: "question_request",
      toolFamily: "read",
      title: "Should we read the config first?",
      summary: "Choose the next step.",
    }),
    null,
  );
});

test("bounded tool-family use still preserves explicit status metadata", () => {
  assert.equal(
    readBoundedToolFamily({
      mode: "status",
      activityClass: "tool_completion",
      toolFamily: "read",
      title: "Read completed",
      summary: "Read completed successfully.",
    }),
    "read",
  );
});
