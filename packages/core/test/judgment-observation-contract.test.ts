import assert from "node:assert/strict";
import test from "node:test";

import {
  projectObservationJudgmentContract,
  resolveObservationStatusConflictKind,
  type ObservationJudgmentDocument,
} from "../src/judgment-observation-contract.js";

function observation(
  overrides: Partial<Omit<ObservationJudgmentDocument, "ownership" | "provenance">> & {
    ownership?: Partial<ObservationJudgmentDocument["ownership"]>;
    provenance?: Partial<ObservationJudgmentDocument["provenance"]>;
  } = {},
): ObservationJudgmentDocument {
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

test("observation judgment projection classifies status conflicts structurally", () => {
  const cases: Array<[string, ObservationJudgmentDocument, string | null]> = [
    [
      "rejected control",
      observation({ kind: "control", recoveryHint: "await_authorization" }),
      "rejected_tool_use_observation",
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
