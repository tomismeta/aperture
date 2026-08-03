import assert from "node:assert/strict";
import test from "node:test";

import {
  projectObservationJudgmentContract,
  resolveObservationStatusConflictKind,
} from "../src/judgment-observation-contract.js";
import type { NormalizedObservation } from "../src/normalized-observation.js";

function observation(
  overrides: Partial<Omit<NormalizedObservation, "ownership" | "provenance">> & {
    ownership?: Partial<NormalizedObservation["ownership"]>;
    provenance?: Partial<NormalizedObservation["provenance"]>;
  } = {},
): NormalizedObservation {
  const { ownership, provenance, ...flat } = overrides;
  return {
    kind: "payload",
    polarity: "neutral",
    semanticAgreement: "stable",
    ownership: { owner: "tool", toolFamily: "fixture", ...ownership },
    evidenceStrength: "strong",
    subject: "tool",
    evidenceLoss: "none",
    provenance: { origin: "semantic_evidence", authority: "explicit", ...provenance },
    consequenceBaseline: "medium",
    ...flat,
  };
}

test("observation judgment projection covers the status-evidence truth table", () => {
  assert.equal(
    projectObservationJudgmentContract(
      observation({ kind: "outcome", polarity: "failure", consequenceBaseline: "medium" }),
    ).statusEvidence,
    "limited_failure",
  );
  assert.equal(
    projectObservationJudgmentContract(
      observation({
        kind: "diagnostic",
        polarity: "failure",
        diagnosticClass: "runtime",
        consequenceBaseline: "high",
      }),
    ).statusEvidence,
    "visible_diagnostic_failure",
  );
  assert.equal(
    projectObservationJudgmentContract(observation()).statusEvidence,
    "stable_observation",
  );
  assert.equal(
    projectObservationJudgmentContract(
      observation({ semanticAgreement: "uncertain", evidenceStrength: "weak" }),
    ).statusEvidence,
    "weak_or_uncertain",
  );
});

test("observation judgment projection classifies recovery posture", () => {
  const cases: Array<[string, Partial<NormalizedObservation>, string]> = [
    ["no recovery", {}, "none"],
    [
      "authorization",
      { kind: "control", recoveryHint: "await_authorization" },
      "authorization_required",
    ],
    [
      "diagnostic",
      {
        kind: "diagnostic",
        polarity: "failure",
        diagnosticClass: "runtime",
        recoveryHint: "inspect_diagnostic",
      },
      "diagnostic_inspection",
    ],
    [
      "original evidence",
      {
        kind: "unknown",
        polarity: "failure",
        evidenceLoss: "unknown",
        recoveryHint: "inspect_original_evidence",
      },
      "original_evidence_required",
    ],
    [
      "scope",
      {
        kind: "diagnostic",
        polarity: "failure",
        diagnosticClass: "source_limit",
        evidenceLoss: "partial",
        recoveryHint: "narrow_evidence_scope",
      },
      "evidence_scope_required",
    ],
    [
      "evidence",
      {
        kind: "outcome",
        polarity: "failure",
        evidenceLoss: "absent",
        recoveryHint: "request_evidence",
      },
      "evidence_required",
    ],
    [
      "contradictory evidence request",
      {
        kind: "outcome",
        polarity: "failure",
        evidenceLoss: "none",
        recoveryHint: "request_evidence",
      },
      "none",
    ],
    [
      "scope without source limit",
      {
        kind: "diagnostic",
        polarity: "failure",
        diagnosticClass: "runtime",
        evidenceLoss: "partial",
        recoveryHint: "narrow_evidence_scope",
      },
      "none",
    ],
  ];

  for (const [name, input, expected] of cases) {
    assert.equal(
      projectObservationJudgmentContract(observation(input)).recoveryPosture,
      expected,
      name,
    );
  }
});

test("observation judgment projection classifies status conflicts structurally", () => {
  const cases: Array<[string, NormalizedObservation, string | null]> = [
    [
      "rejected control",
      observation({ kind: "control", recoveryHint: "await_authorization" }),
      "rejected_tool_use_observation",
    ],
    [
      "malformed rejected control",
      observation({
        kind: "control",
        polarity: "failure",
        recoveryHint: "await_authorization",
      }),
      null,
    ],
    [
      "source-owned tool control",
      observation({
        kind: "control",
        ownership: { owner: "source" },
        subject: "tool",
        recoveryHint: "await_authorization",
      }),
      null,
    ],
    [
      "tool-owned document control",
      observation({
        kind: "control",
        subject: "document",
        recoveryHint: "await_authorization",
      }),
      null,
    ],
    [
      "structured success",
      observation({
        kind: "outcome",
        polarity: "success",
        subject: "command",
        provenance: { origin: "structured_output" },
      }),
      "execution_success_observation",
    ],
    [
      "command success",
      observation({ kind: "outcome", polarity: "success", subject: "command" }),
      "command_success_observation",
    ],
    [
      "unknown tool success",
      observation({
        kind: "outcome",
        polarity: "success",
        subject: "tool",
        ownership: { toolFamily: "custom_runner" },
      }),
      "payload_observation",
    ],
    [
      "structured payload",
      observation({ kind: "payload", provenance: { origin: "structured_output" } }),
      "structured_output_observation",
    ],
    [
      "search payload",
      observation({ kind: "payload", subject: "search" }),
      "search_output_observation",
    ],
    [
      "generic payload",
      observation({ kind: "payload", subject: "document" }),
      "payload_observation",
    ],
  ];

  for (const [name, input, expected] of cases) {
    assert.equal(resolveObservationStatusConflictKind(input), expected, name);
    assert.equal(projectObservationJudgmentContract(input).statusConflictKind, expected, name);
  }
});
