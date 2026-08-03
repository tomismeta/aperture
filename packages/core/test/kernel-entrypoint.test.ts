import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APERTURE_KERNEL_EXPLANATION_SCHEMA_VERSION,
  evaluateApertureKernelEvent,
  type ApertureKernelEvent,
  type ApertureKernelObservation,
  type ApertureKernelObservationJudgment,
} from "../src/kernel.js";

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
    ...(options.capabilityFamily === undefined
      ? {}
      : { facts: { capabilityFamily: options.capabilityFamily } }),
    ...contextAndMetadataOptions(options),
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
