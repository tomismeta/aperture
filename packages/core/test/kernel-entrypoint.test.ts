import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION,
  evaluateApertureKernelEvent,
  type ApertureKernelEvent,
  type ApertureKernelObservation,
  type ApertureKernelObservationJudgment,
  type SourceEvidence,
} from "../src/kernel.js";
import type { ApertureEvent } from "../src/events.js";
import type { SourceEvent } from "../src/source-event.js";
import { EventEvaluator } from "../src/event-evaluator.js";
import { enrichApertureEvent, normalizeSourceEvent } from "../src/semantic-normalizer.js";

const timestamp = "2026-04-22T18:30:00.000Z";

test("kernel evaluation exposes event to observation to observation-judgment contract", () => {
  const result = evaluateApertureKernelEvent(
    failedTaskEvent(
      "kernel:command",
      "Your command ran successfully and did not produce any output.",
      {
        capabilityFamily: "exec_command",
      },
    ),
  );

  assert.equal(result.evaluation.kind, "candidate");
  assert.equal(result.event.semantic.capabilityFamily, "exec_command");
  assert.deepEqual(result.observation, {
    kind: "outcome",
    polarity: "success",
    ownership: {
      owner: "tool",
      capabilityFamily: "exec_command",
    },
    subject: "command",
    evidenceLoss: "none",
    semanticAgreement: "stable",
    evidenceStrength: "qualified",
    provenance: {
      origin: "semantic_evidence",
      authority: "inferred",
    },
    consequenceBaseline: "low",
  });
  assert.deepEqual(result.observationJudgment, {
    statusEvidence: "stable_observation",
    statusConflictKind: "command_success_observation",
    recoveryPosture: "none",
    baselineConsequence: "low",
    outcomeOnlyFailureStatus: false,
    limitedFailureStatus: false,
    stableStatusEvidence: true,
    visibleDiagnosticFailure: false,
  });
});

test("kernel preserves document-scoped adversative runtime diagnostics", () => {
  for (const conjunction of ["but", "however", "yet"] as const) {
    for (const separator of [", ", " "] as const) {
      const summary = `A complete document read describes how execution could fail${separator}${conjunction} execution later crashed and a complete runtime diagnostic was returned.`;
      const result = evaluateApertureKernelEvent(
        failedTaskEvent(`document-adversative:${conjunction}:${separator.length}`, summary, {
          capabilityFamily: "exec_command",
        }),
      );

      assert.equal(result.evaluation.kind, "candidate", summary);
      assert.equal(result.observation?.diagnosticClass, "runtime", summary);
      assert.equal(
        result.observationJudgment?.statusEvidence,
        "visible_diagnostic_failure",
        summary,
      );
    }
  }
});

test("kernel command observations do not depend on host title vocabulary", () => {
  const event = failedTaskEvent(
    "kernel:host-title",
    "Your command ran successfully and did not produce any output.",
    { capabilityFamily: "exec_command" },
  );
  const baseline = evaluateApertureKernelEvent(event);
  const hostTitled = evaluateApertureKernelEvent({ ...event, title: "Command status" });

  assert.deepEqual(hostTitled.observation, baseline.observation);
  assert.deepEqual(hostTitled.observationJudgment, baseline.observationJudgment);
  assert.equal(hostTitled.observation?.kind, "outcome");
  assert.equal(hostTitled.observation?.polarity, "success");
});

test("kernel raw command observations do not depend on capability identity", () => {
  const summary = "Your command ran successfully and did not produce any output.";
  const results = [undefined, "exec_command", "catalog", "read"].map((capabilityFamily, index) =>
    evaluateApertureKernelEvent(
      failedTaskEvent(`kernel:capability-opacity:${index}`, summary, {
        ...(capabilityFamily === undefined ? {} : { capabilityFamily }),
      }),
    ),
  );
  const baseline = results[0];
  assert.ok(baseline.observation);
  for (const result of results) {
    assert.deepEqual(result.observationJudgment, baseline.observationJudgment);
    assert.deepEqual(
      result.observation === null ? null : { ...result.observation, ownership: undefined },
      baseline.observation === null ? null : { ...baseline.observation, ownership: undefined },
    );
    assert.equal(result.observation?.kind, "outcome");
    assert.equal(result.observation?.polarity, "success");
  }
});

test("kernel raw success prose without command vocabulary stays capability-opaque", () => {
  for (const summary of ["Ran successfully and did not produce any output.", "Exit code: 0."]) {
    const results = [undefined, "exec_command", "catalog", "read"].map((capabilityFamily, index) =>
      evaluateApertureKernelEvent(
        failedTaskEvent(`kernel:capability-opacity:plain:${index}`, summary, {
          ...(capabilityFamily === undefined ? {} : { capabilityFamily }),
        }),
      ),
    );
    const baseline = results[0];
    assert.ok(baseline.observation);
    for (const result of results) {
      assert.deepEqual(result.observationJudgment, baseline.observationJudgment, summary);
      assert.deepEqual(
        result.observation === null ? null : { ...result.observation, ownership: undefined },
        baseline.observation === null ? null : { ...baseline.observation, ownership: undefined },
        summary,
      );
      assert.equal(result.observation?.kind, "outcome", summary);
      assert.equal(result.observation?.polarity, "success", summary);
    }
  }
});

test("kernel command titles cannot fabricate or override summary evidence", () => {
  const event = failedTaskEvent("kernel:title-authority", "Result unavailable.", {
    capabilityFamily: "exec_command",
  });
  const titleOnlySuccess = evaluateApertureKernelEvent({
    ...event,
    title: "Your command ran successfully and did not produce any output.",
  });
  const terminalTitle = evaluateApertureKernelEvent({
    ...event,
    title: "Permission denied",
    summary: "Your command ran successfully and did not produce any output.",
  });

  assert.notEqual(titleOnlySuccess.observation?.polarity, "success");
  assert.equal(titleOnlySuccess.observationJudgment?.statusConflictKind, null);
  assert.notEqual(terminalTitle.observation?.polarity, "success");
  assert.equal(terminalTitle.observationJudgment?.statusConflictKind, null);
});

test("kernel evaluation exposes the stable normalize to observe to judge explanation", () => {
  const result = evaluateApertureKernelEvent(
    failedTaskEvent(
      "kernel:explain",
      "Your command ran successfully and did not produce any output.",
      {
        capabilityFamily: "exec_command",
      },
    ),
  );

  assert.equal(result.explanation.schemaVersion, APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION);
  assert.deepEqual(result.explanation.flow, ["normalize", "observe", "judge"]);
  assert.deepEqual(result.explanation.reasonCodes, [
    "kernel:normalize:event",
    "kernel:evaluate:candidate",
    "kernel:observe:present",
    "kernel:observe:kind:outcome",
    "kernel:observe:polarity:success",
    "kernel:observe:owner:tool",
    "kernel:observe:subject:command",
    "kernel:observe:evidence_loss:none",
    "kernel:observe:evidence_strength:qualified",
    "kernel:observe:agreement:stable",
    "kernel:observe:provenance:semantic_evidence:inferred",
    "kernel:judge:status_evidence:stable_observation",
    "kernel:judge:status_conflict:command_success_observation",
    "kernel:judge:recovery:none",
    "kernel:judge:baseline:low",
  ]);
});

test("host-owned adapters can feed unrelated event shapes through the kernel event contract", () => {
  const fixture = readKernelPortabilityFixture();

  for (const caseSpec of fixture.cases) {
    const kernelEvent = adaptHostEvent(caseSpec.host, caseSpec.event);

    assert.ok(kernelEvent, caseSpec.id);
    const result = evaluateApertureKernelEvent(kernelEvent);

    assert.equal(result.evaluation.kind, "candidate", caseSpec.id);
    assert.deepEqual(result.observation, caseSpec.expected.observation, caseSpec.id);
    assert.deepEqual(
      result.observationJudgment,
      caseSpec.expected.observationJudgment,
      caseSpec.id,
    );
    assert.equal(
      result.explanation.schemaVersion,
      APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION,
      caseSpec.id,
    );
    assert.deepEqual(result.explanation.flow, ["normalize", "observe", "judge"], caseSpec.id);
    assert.deepEqual(
      result.explanation.reasonCodes,
      caseSpec.expected.explanationReasonCodes,
      caseSpec.id,
    );
  }
});

test("host-owned adapters can decline events before kernel invocation", () => {
  const kernelEvent = adaptRecordLogEvent({ kind: "host.event.ignored" });

  assert.equal(kernelEvent, null);
});

test("kernel only treats facts capability family as capability authority", () => {
  const direct = evaluateApertureKernelEvent(
    runningTaskEvent("direct-authority", {
      capabilityFamily: "exec_command",
      contextCapabilityFamily: "read",
      metadataCapabilityFamily: "search",
    }),
  );
  const contextual = evaluateApertureKernelEvent(
    runningTaskEvent("contextual-alias", {
      contextCapabilityFamily: "read",
      metadataCapabilityFamily: "search",
    }),
  );

  assert.equal(direct.event.capabilityFamily, "exec_command");
  assert.equal(contextual.event.capabilityFamily, undefined);
});

test("kernel canonicalizes capability family case before semantic matching", () => {
  const lowercase = evaluateApertureKernelEvent(
    failedTaskEvent(
      "capability-lowercase",
      "Your command ran successfully and did not produce any output.",
      {
        capabilityFamily: "bash",
      },
    ),
  );
  const mixedCase = evaluateApertureKernelEvent(
    failedTaskEvent(
      "capability-mixed-case",
      "Your command ran successfully and did not produce any output.",
      {
        capabilityFamily: " Bash ",
      },
    ),
  );

  assert.equal(mixedCase.event.semantic.capabilityFamily, "bash");
  assert.deepEqual(mixedCase.observation, lowercase.observation);
  assert.deepEqual(mixedCase.observationJudgment, lowercase.observationJudgment);
});

test("kernel evaluation exposes candidates that do not yet have observation documents", () => {
  const result = evaluateApertureKernelEvent({
    id: "evt:kernel:approval",
    workId: "work:kernel:approval",
    occurredAt: timestamp,
    kind: "input.requested",
    interactionId: "interaction:kernel:approval",
    title: "Approve deploy",
    summary: "Review the deployment before continuing.",
    request: { kind: "approval" },
    facts: { capabilityFamily: "deploy" },
    hints: { consequence: "high" },
  });

  assert.equal(result.evaluation.kind, "candidate");
  assert.equal(result.event.kind, "input.requested");
  assert.equal(result.observation, null);
  assert.equal(result.observationJudgment, null);
});

test("kernel evaluation leaves non-candidate events observation-judgment-free", () => {
  const result = evaluateApertureKernelEvent({
    id: "evt:kernel:completed",
    workId: "work:kernel:completed",
    occurredAt: timestamp,
    kind: "work.completed",
    summary: "Done.",
  });

  assert.deepEqual(result.evaluation, {
    kind: "clear",
    workId: "work:kernel:completed",
  });
  assert.equal(result.observation, null);
  assert.equal(result.observationJudgment, null);
});

test("typed source evidence deterministically covers every observation family", () => {
  const cases: Array<{
    id: string;
    evidence: SourceEvidence;
    expected: {
      kind: ApertureKernelObservation["kind"];
      polarity: ApertureKernelObservation["polarity"];
      subject: ApertureKernelObservation["subject"];
      evidenceLoss: ApertureKernelObservation["evidenceLoss"];
      diagnosticClass: ApertureKernelObservation["diagnosticClass"] | null;
      recoveryHint: ApertureKernelObservation["recoveryHint"] | null;
      origin: ApertureKernelObservation["provenance"]["origin"];
      baseline: ApertureKernelObservation["consequenceBaseline"];
      statusEvidence: ApertureKernelObservationJudgment["statusEvidence"];
      conflict: ApertureKernelObservationJudgment["statusConflictKind"];
      recovery: ApertureKernelObservationJudgment["recoveryPosture"];
    };
  }> = [
    {
      id: "failure-outcome",
      evidence: {
        kind: "outcome",
        outcome: "failure",
        subject: "command",
        channel: "command",
        complete: true,
      },
      expected: expectedEvidence(
        "outcome",
        "failure",
        "command",
        "none",
        null,
        null,
        "command_output",
        "medium",
        "limited_failure",
        null,
        "none",
      ),
    },
    {
      id: "success-outcome",
      evidence: {
        kind: "outcome",
        outcome: "success",
        subject: "command",
        channel: "structured",
        complete: true,
      },
      expected: expectedEvidence(
        "outcome",
        "success",
        "command",
        "none",
        null,
        null,
        "structured_output",
        "low",
        "stable_observation",
        "execution_success_observation",
        "none",
      ),
    },
    {
      id: "runtime-diagnostic",
      evidence: {
        kind: "diagnostic",
        diagnostic: "runtime",
        subject: "tool",
        channel: "transcript",
        complete: true,
      },
      expected: expectedEvidence(
        "diagnostic",
        "failure",
        "tool",
        "none",
        "runtime",
        "inspect_diagnostic",
        "transcript",
        "high",
        "visible_diagnostic_failure",
        null,
        "diagnostic_inspection",
      ),
    },
    {
      id: "expected-diagnostic",
      evidence: {
        kind: "diagnostic",
        diagnostic: "expected",
        subject: "document",
        channel: "structured",
        complete: true,
      },
      expected: expectedEvidence(
        "diagnostic",
        "failure",
        "document",
        "none",
        "expected",
        "inspect_diagnostic",
        "structured_output",
        "medium",
        "stable_observation",
        null,
        "diagnostic_inspection",
      ),
    },
    {
      id: "source-limit",
      evidence: {
        kind: "diagnostic",
        diagnostic: "source_limit",
        channel: "read",
        window: { unit: "bytes", offset: 0, length: 2048, total: 10_000 },
      },
      expected: expectedEvidence(
        "diagnostic",
        "failure",
        "source",
        "partial",
        "source_limit",
        "narrow_evidence_scope",
        "read_output",
        "medium",
        "limited_failure",
        null,
        "evidence_scope_required",
      ),
    },
    {
      id: "search-payload",
      evidence: { kind: "payload", subject: "search", channel: "search", complete: true },
      expected: expectedEvidence(
        "payload",
        "neutral",
        "search",
        "none",
        null,
        null,
        "transcript",
        "low",
        "stable_observation",
        "search_output_observation",
        "none",
      ),
    },
    {
      id: "authorization",
      evidence: {
        kind: "authorization",
        state: "required",
        execution: "not_started",
        result: "absent",
      },
      expected: expectedEvidence(
        "control",
        "neutral",
        "tool",
        "none",
        null,
        "await_authorization",
        "status_text",
        "low",
        "stable_observation",
        "rejected_tool_use_observation",
        "authorization_required",
      ),
    },
  ];

  for (const testCase of cases) {
    const result = evaluateApertureKernelEvent(
      failedTaskEvent(testCase.id, "Contradictory prose says this was an unrelated success.", {
        capabilityFamily: "Opaque-Capability/17",
        evidence: testCase.evidence,
      }),
    );
    const observation = result.observation;
    const judgment = result.observationJudgment;
    assert.ok(observation, testCase.id);
    assert.ok(judgment, testCase.id);
    assert.equal(observation.ownership.owner, "tool", testCase.id);
    assert.equal(observation.ownership.capabilityFamily, "opaque-capability/17", testCase.id);
    assert.equal(observation.semanticAgreement, "stable", testCase.id);
    assert.equal(observation.evidenceStrength, "strong", testCase.id);
    assert.equal(observation.provenance.authority, "explicit", testCase.id);
    assert.deepEqual(
      {
        kind: observation.kind,
        polarity: observation.polarity,
        subject: observation.subject,
        evidenceLoss: observation.evidenceLoss,
        diagnosticClass: observation.diagnosticClass ?? null,
        recoveryHint: observation.recoveryHint ?? null,
        origin: observation.provenance.origin,
        baseline: observation.consequenceBaseline,
        statusEvidence: judgment.statusEvidence,
        conflict: judgment.statusConflictKind,
        recovery: judgment.recoveryPosture,
      },
      testCase.expected,
      testCase.id,
    );
  }
});

test("typed evidence semantics never depend on opaque capability identity or prose", () => {
  const evidence: SourceEvidence = {
    kind: "payload",
    subject: "search",
    channel: "search",
    complete: true,
  };
  const first = evaluateApertureKernelEvent(
    failedTaskEvent("typed-invariance-a", "Permission denied and execution failed.", {
      capabilityFamily: "alpha_native_operation",
      evidence,
    }),
  );
  const second = evaluateApertureKernelEvent(
    failedTaskEvent("typed-invariance-b", "All work completed successfully.", {
      capabilityFamily: "beta_external_action",
      evidence,
    }),
  );

  assert.deepEqual(withoutCapabilityIdentity(first), withoutCapabilityIdentity(second));
});

test("typed evidence outranks recognized capability families, risk prose, and semantic hints", () => {
  const evidence: SourceEvidence = {
    kind: "outcome",
    outcome: "failure",
    subject: "command",
    channel: "command",
    complete: true,
  };
  const variants = [
    ["read", "Critical destructive write breached production."],
    ["search", "Everything completed successfully."],
    ["edit", "Permission denied before execution."],
    ["exec_command", "A harmless read returned one document."],
  ] as const;
  const results = variants.map(([capabilityFamily, summary], index) =>
    evaluateApertureKernelEvent(
      failedTaskEvent(`typed-authority-${index}`, summary, { capabilityFamily, evidence }),
    ),
  );
  const baseline = results[0];
  assert.ok(baseline);
  for (const result of results) {
    assert.deepEqual(withoutCapabilityIdentity(result), withoutCapabilityIdentity(baseline));
    assert.equal(result.observation?.semanticAgreement, "stable");
    assert.equal(result.observation?.evidenceStrength, "strong");
    assert.equal(result.observation?.provenance.authority, "explicit");
    assert.equal(result.observation?.consequenceBaseline, "medium");
  }

  const source: SourceEvent = {
    id: "evt:typed-hint-authority",
    taskId: "task:typed-hint-authority",
    timestamp,
    type: "task.updated",
    title: "Host failure",
    summary: "Critical destructive write breached production.",
    status: "failed",
    toolFamily: "exec_command",
    evidence,
  };
  const hinted: SourceEvent = {
    ...source,
    semanticHints: {
      intentFrame: "blocked_work",
      activityClass: "tool_failure",
      consequence: "high",
      confidence: "low",
      abstained: true,
    },
  };
  const plainResult = new EventEvaluator().evaluate(normalizeSourceEvent(source));
  const hintedResult = new EventEvaluator().evaluate(normalizeSourceEvent(hinted));
  assert.equal(plainResult.kind, "candidate");
  assert.equal(hintedResult.kind, "candidate");
  if (plainResult.kind !== "candidate" || hintedResult.kind !== "candidate") return;
  assert.deepEqual(
    hintedResult.candidate.judgmentInput.observation,
    plainResult.candidate.judgmentInput.observation,
  );
});

test("source, direct, and kernel events share one typed-evidence observation path", () => {
  const evidence: SourceEvidence = {
    kind: "diagnostic",
    diagnostic: "source_limit",
    channel: "read",
    window: { unit: "lines", offset: 20, length: 40, total: 900 },
  };
  const event = {
    id: "evt:shared-evidence",
    taskId: "work:shared-evidence",
    timestamp,
    type: "task.updated" as const,
    title: "Opaque host update",
    summary: "The prose says there was no truncation.",
    status: "failed" as const,
    toolFamily: "native-reader-42",
    evidence,
  };
  const sourceResult = new EventEvaluator().evaluate(
    normalizeSourceEvent(event satisfies SourceEvent),
  );
  const directResult = new EventEvaluator().evaluate(
    enrichApertureEvent(event satisfies ApertureEvent),
  );
  const optedOutDirectResult = new EventEvaluator().evaluate(
    enrichApertureEvent(event satisfies ApertureEvent, { skipSemanticDefaults: true }),
  );
  const kernelResult = evaluateApertureKernelEvent({
    id: event.id,
    workId: event.taskId,
    occurredAt: event.timestamp,
    kind: "work.updated",
    title: event.title,
    summary: event.summary,
    status: event.status,
    evidence,
    facts: { capabilityFamily: event.toolFamily },
  });

  assert.equal(sourceResult.kind, "candidate");
  assert.equal(directResult.kind, "candidate");
  assert.equal(optedOutDirectResult.kind, "candidate");
  if (
    sourceResult.kind !== "candidate" ||
    directResult.kind !== "candidate" ||
    optedOutDirectResult.kind !== "candidate"
  )
    return;
  assert.deepEqual(
    sourceResult.candidate.judgmentInput.observation,
    directResult.candidate.judgmentInput.observation,
  );
  assert.deepEqual(
    optedOutDirectResult.candidate.judgmentInput.observation,
    directResult.candidate.judgmentInput.observation,
  );
  assert.deepEqual(
    projectInternalObservation(sourceResult.candidate.judgmentInput.observation),
    kernelResult.observation,
  );
});

test("kernel rejects malformed typed evidence at runtime", () => {
  assert.throws(
    () =>
      evaluateApertureKernelEvent({
        id: "evt:kernel:nonfailed-evidence",
        workId: "work:kernel:nonfailed-evidence",
        occurredAt: timestamp,
        kind: "work.updated",
        title: "Invalid running evidence",
        status: "running",
        evidence: {
          kind: "outcome",
          outcome: "success",
          subject: "command",
          channel: "command",
          complete: true,
        } as never,
      }),
    /event\.evidence/,
  );

  assert.throws(
    () =>
      evaluateApertureKernelEvent({
        id: "evt:kernel:invalid-evidence",
        workId: "work:kernel:invalid-evidence",
        occurredAt: timestamp,
        kind: "work.updated",
        title: "Invalid source window",
        status: "failed",
        evidence: {
          kind: "diagnostic",
          diagnostic: "source_limit",
          channel: "read",
          window: { unit: "bytes", offset: 0, length: 100, total: 100 },
        } as never,
      }),
    /event\.evidence\.window must be valid bounded source evidence/,
  );
});

function runningTaskEvent(
  id: string,
  options: {
    capabilityFamily?: string;
    contextCapabilityFamily?: string;
    metadataCapabilityFamily?: string;
  },
): ApertureKernelEvent {
  return {
    id: `evt:kernel:${id}`,
    workId: `work:kernel:${id}`,
    occurredAt: timestamp,
    kind: "work.updated",
    title: "Host status",
    summary: "Routine status update.",
    status: "running",
    ...(options.capabilityFamily === undefined
      ? {}
      : { facts: { capabilityFamily: options.capabilityFamily } }),
    ...contextAndMetadataOptions(options),
  };
}

function failedTaskEvent(
  id: string,
  summary: string,
  options: {
    capabilityFamily?: string;
    contextCapabilityFamily?: string;
    evidence?: SourceEvidence;
    metadataCapabilityFamily?: string;
  },
): ApertureKernelEvent {
  return {
    id: `evt:kernel:${id}`,
    workId: `work:kernel:${id}`,
    occurredAt: timestamp,
    kind: "work.updated",
    title: "Host observation",
    summary,
    status: "failed",
    ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    ...(options.capabilityFamily === undefined
      ? {}
      : { facts: { capabilityFamily: options.capabilityFamily } }),
    ...contextAndMetadataOptions(options),
  };
}

function expectedEvidence(
  kind: ApertureKernelObservation["kind"],
  polarity: ApertureKernelObservation["polarity"],
  subject: ApertureKernelObservation["subject"],
  evidenceLoss: ApertureKernelObservation["evidenceLoss"],
  diagnosticClass: ApertureKernelObservation["diagnosticClass"] | null,
  recoveryHint: ApertureKernelObservation["recoveryHint"] | null,
  origin: ApertureKernelObservation["provenance"]["origin"],
  baseline: ApertureKernelObservation["consequenceBaseline"],
  statusEvidence: ApertureKernelObservationJudgment["statusEvidence"],
  conflict: ApertureKernelObservationJudgment["statusConflictKind"],
  recovery: ApertureKernelObservationJudgment["recoveryPosture"],
) {
  return {
    kind,
    polarity,
    subject,
    evidenceLoss,
    diagnosticClass,
    recoveryHint,
    origin,
    baseline,
    statusEvidence,
    conflict,
    recovery,
  };
}

function withoutCapabilityIdentity(result: ReturnType<typeof evaluateApertureKernelEvent>) {
  return {
    observation:
      result.observation === null
        ? null
        : { ...result.observation, ownership: { owner: result.observation.ownership.owner } },
    judgment: result.observationJudgment,
    reasonCodes: result.explanation.reasonCodes,
  };
}

function projectInternalObservation(
  observation: Extract<
    ReturnType<EventEvaluator["evaluate"]>,
    { kind: "candidate" }
  >["candidate"]["judgmentInput"]["observation"],
): ApertureKernelObservation | null {
  if (observation === undefined) return null;
  return {
    kind: observation.kind,
    polarity: observation.polarity,
    ownership: {
      owner: observation.ownership.owner,
      ...(observation.ownership.toolFamily === undefined
        ? {}
        : { capabilityFamily: observation.ownership.toolFamily }),
    },
    subject: observation.subject,
    evidenceLoss: observation.evidenceLoss,
    semanticAgreement: observation.semanticAgreement,
    evidenceStrength: observation.evidenceStrength,
    ...(observation.diagnosticClass === undefined
      ? {}
      : { diagnosticClass: observation.diagnosticClass }),
    ...(observation.recoveryHint === undefined ? {} : { recoveryHint: observation.recoveryHint }),
    provenance: observation.provenance,
    consequenceBaseline: observation.consequenceBaseline,
  };
}

function contextAndMetadataOptions(options: {
  contextCapabilityFamily?: string;
  metadataCapabilityFamily?: string;
}): Pick<ApertureKernelEvent, "context" | "metadata"> {
  return {
    ...(options.contextCapabilityFamily === undefined
      ? {}
      : {
          context: {
            items: [
              {
                id: "capability_family",
                label: "Capability family",
                value: options.contextCapabilityFamily,
              },
            ],
          },
        }),
    ...(options.metadataCapabilityFamily === undefined
      ? {}
      : { metadata: { capabilityFamily: options.metadataCapabilityFamily } }),
  };
}

type KernelPortabilityFixture = {
  id: "aperture.kernel.portability.v1";
  cases: KernelPortabilityFixtureCase[];
};

type KernelPortabilityFixtureCase = {
  id: string;
  host: "record-log" | "snapshot-state";
  event: Record<string, unknown>;
  expected: {
    observation: ApertureKernelObservation;
    observationJudgment: ApertureKernelObservationJudgment;
    explanationReasonCodes: string[];
  };
};

function readKernelPortabilityFixture(): KernelPortabilityFixture {
  return JSON.parse(
    readFileSync(new URL("./fixtures/kernel-portability-v1.json", import.meta.url), "utf8"),
  ) as KernelPortabilityFixture;
}

function adaptHostEvent(
  host: KernelPortabilityFixtureCase["host"],
  event: Record<string, unknown>,
): ApertureKernelEvent | null {
  switch (host) {
    case "record-log":
      return adaptRecordLogEvent(event);
    case "snapshot-state":
      return adaptSnapshotStateEvent(event);
  }
}

function adaptRecordLogEvent(event: Record<string, unknown>): ApertureKernelEvent | null {
  if (
    typeof event.recordId !== "string" ||
    typeof event.workKey !== "string" ||
    typeof event.recordedAt !== "string" ||
    typeof event.title !== "string" ||
    typeof event.text !== "string" ||
    typeof event.status !== "string"
  ) {
    return null;
  }

  return {
    id: event.recordId,
    workId: event.workKey,
    occurredAt: event.recordedAt,
    kind: "work.updated",
    title: event.title,
    summary: event.text,
    status: event.status === "failed" ? "failed" : "running",
    ...(typeof event.capability === "string"
      ? { facts: { capabilityFamily: event.capability } }
      : {}),
  };
}

function adaptSnapshotStateEvent(event: Record<string, unknown>): ApertureKernelEvent | null {
  const job = event.job;
  const output = event.output;
  if (
    typeof event.messageId !== "string" ||
    typeof event.observedAt !== "string" ||
    typeof event.state !== "string" ||
    !isRecord(job) ||
    !isRecord(output) ||
    typeof job.id !== "string" ||
    typeof job.name !== "string" ||
    typeof output.summary !== "string"
  ) {
    return null;
  }

  return {
    id: event.messageId,
    workId: job.id,
    occurredAt: event.observedAt,
    kind: "work.updated",
    title: job.name,
    summary: output.summary,
    status: event.state === "error" ? "failed" : "running",
    ...(typeof output.capabilityFamily === "string"
      ? { facts: { capabilityFamily: output.capabilityFamily } }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
