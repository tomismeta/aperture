import assert from "node:assert/strict";
import test from "node:test";

import { projectApertureKernelEvent, type ApertureKernelEvent } from "../src/kernel.js";

const timestamp = "2026-04-22T18:30:00.000Z";

test("kernel projection exposes event to observation to judgment contract", () => {
  const projection = projectApertureKernelEvent(
    failedTaskEvent(
      "kernel:command",
      "Your command ran successfully and did not produce any output.",
      {
        capabilityFamily: "exec_command",
      },
    ),
  );

  assert.equal(projection.evaluation.kind, "candidate");
  assert.equal(projection.event.semantic.capabilityFamily, "exec_command");
  assert.deepEqual(projection.observation, {
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
  assert.deepEqual(projection.judgment, {
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

test("kernel projection keeps generic host capability aliases equivalent to direct facts", () => {
  for (const caseSpec of KERNEL_PARITY_CASES) {
    const direct = projectApertureKernelEvent(
      failedTaskEvent(`direct:${caseSpec.id}`, caseSpec.summary, {
        capabilityFamily: caseSpec.capabilityFamily,
      }),
    );
    const context = projectApertureKernelEvent(
      failedTaskEvent(`context:${caseSpec.id}`, caseSpec.summary, {
        contextCapabilityFamily: caseSpec.capabilityFamily,
      }),
    );
    const generic = projectApertureKernelEvent(
      failedTaskEvent(`generic:${caseSpec.id}`, caseSpec.summary, {
        metadataCapabilityFamily: caseSpec.capabilityFamily,
      }),
    );

    assert.equal(generic.evaluation.kind, "candidate", caseSpec.id);
    assert.equal(generic.event.semantic.capabilityFamily, caseSpec.capabilityFamily, caseSpec.id);
    assert.equal(
      generic.observation?.ownership.capabilityFamily,
      caseSpec.capabilityFamily,
      caseSpec.id,
    );
    assert.equal(generic.judgment?.statusConflictKind, caseSpec.statusConflictKind, caseSpec.id);
    assert.deepEqual(context.observation, direct.observation, caseSpec.id);
    assert.deepEqual(context.judgment, direct.judgment, caseSpec.id);
    assert.deepEqual(generic.observation, direct.observation, caseSpec.id);
    assert.deepEqual(generic.judgment, direct.judgment, caseSpec.id);
  }
});

test("kernel projection keeps explicit capability facts authoritative over metadata aliases", () => {
  const projection = projectApertureKernelEvent(
    failedTaskEvent("precedence", "Your command ran successfully and did not produce any output.", {
      capabilityFamily: "exec_command",
      metadataCapabilityFamily: "read",
    }),
  );

  assert.equal(projection.event.capabilityFamily, "exec_command");
  assert.equal(projection.observation?.ownership.capabilityFamily, "exec_command");
  assert.equal(projection.judgment?.statusConflictKind, "command_success_observation");
});

test("kernel projection keeps capability facts authoritative over context and metadata aliases", () => {
  const projection = projectApertureKernelEvent(
    failedTaskEvent(
      "fact-context-precedence",
      "Your command ran successfully and did not produce any output.",
      {
        capabilityFamily: "exec_command",
        contextCapabilityFamily: "read",
        metadataCapabilityFamily: "search",
      },
    ),
  );

  assert.equal(projection.event.capabilityFamily, "exec_command");
  assert.equal(projection.observation?.ownership.capabilityFamily, "exec_command");
  assert.equal(projection.judgment?.statusConflictKind, "command_success_observation");
});

test("kernel projection keeps context capability aliases authoritative over metadata aliases", () => {
  const projection = projectApertureKernelEvent(
    failedTaskEvent(
      "context-precedence",
      "Your command ran successfully and did not produce any output.",
      {
        contextCapabilityFamily: "exec_command",
        metadataCapabilityFamily: "read",
      },
    ),
  );

  assert.equal(projection.event.capabilityFamily, "exec_command");
  assert.equal(projection.observation?.ownership.capabilityFamily, "exec_command");
  assert.equal(projection.judgment?.statusConflictKind, "command_success_observation");
});

test("kernel projection exposes candidates that do not yet have observation documents", () => {
  const projection = projectApertureKernelEvent({
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

  assert.equal(projection.evaluation.kind, "candidate");
  assert.equal(projection.event.kind, "input.requested");
  assert.equal(projection.observation, null);
  assert.equal(projection.judgment, null);
});

test("kernel projection leaves non-candidate events judgment-free", () => {
  const projection = projectApertureKernelEvent({
    id: "evt:kernel:completed",
    workId: "work:kernel:completed",
    occurredAt: timestamp,
    kind: "work.completed",
    summary: "Done.",
  });

  assert.deepEqual(projection.evaluation, {
    kind: "clear",
    workId: "work:kernel:completed",
  });
  assert.equal(projection.observation, null);
  assert.equal(projection.judgment, null);
});

const KERNEL_PARITY_CASES = [
  {
    id: "command",
    statusConflictKind: "command_success_observation",
    summary: "Your command ran successfully and did not produce any output.",
    capabilityFamily: "exec_command",
  },
  {
    id: "read",
    statusConflictKind: "payload_observation",
    summary:
      "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import annotations",
    capabilityFamily: "read",
  },
  {
    id: "search",
    statusConflictKind: "search_output_observation",
    summary: 'Web search results for "aperture": /repo/README.md: Aperture overview',
    capabilityFamily: "search",
  },
  {
    id: "structured",
    statusConflictKind: "execution_success_observation",
    summary:
      '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/pkg/lib.rs:10:fn main() {}"}',
    capabilityFamily: "custom_runner",
  },
] as const;

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
