import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTaskFailureObservation } from "../src/task-failure-observation-normalizer.js";
import type { NormalizedObservation } from "../src/normalized-observation.js";
import {
  readObservationalStatusConflictKind,
  readObservationalStatusConflictKindFromObservation,
} from "../src/observational-status-conflict-kind.js";
import type {
  SemanticTextEvidence,
  TaskFailureSemanticEvidence,
} from "../src/semantic-evidence.js";
import type { AttentionOntologyDiagnostic } from "../src/semantic-ontology-types.js";

const emptyText: SemanticTextEvidence = {
  routineSuccessObservation: false,
  terminalFailureEvidence: false,
  expectedDiagnosticFailure: false,
  observationalReadback: false,
  taggedFileObservation: false,
  readObservationPayload: false,
  searchResultOutput: false,
  sourceCodeObservation: false,
  logObservation: false,
  buildMetadataObservation: false,
};

const ontology: AttentionOntologyDiagnostic = {
  ask: "status",
  activity: "failure",
  consequence: "medium",
  blocking: "non_blocking",
  episode: "unknown",
  confidence: "high",
  source: "explicit",
};

function evidence(
  overrides: Omit<
    TaskFailureSemanticEvidence,
    "consequenceBaseline" | "readsAsObservation" | "text"
  > &
    Partial<
      Pick<TaskFailureSemanticEvidence, "consequenceBaseline" | "readsAsObservation" | "text">
    >,
): TaskFailureSemanticEvidence {
  return {
    consequenceBaseline: "medium",
    readsAsObservation: false,
    text: emptyText,
    ...overrides,
  };
}

function compile(
  failureEvidence: TaskFailureSemanticEvidence,
  input: Partial<Parameters<typeof normalizeTaskFailureObservation>[0]> = {},
): NormalizedObservation {
  return normalizeTaskFailureObservation({
    failureEvidence,
    ontology: { ...ontology, consequence: failureEvidence.consequenceBaseline },
    abstained: false,
    semanticAgreement: "stable",
    ...input,
  });
}

test("task-failure observation normalizer maps every evidence kind into the normalized document", () => {
  const cases: Array<{
    name: string;
    evidence: TaskFailureSemanticEvidence;
    expected: Partial<NormalizedObservation> & {
      ownership?: Partial<NormalizedObservation["ownership"]>;
      provenance?: Partial<NormalizedObservation["provenance"]>;
    };
  }> = [
    {
      name: "routine command success",
      evidence: evidence({
        kind: "routine_bash_success_observation",
        toolFamily: "bash",
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: { kind: "outcome", polarity: "success", subject: "tool" },
    },
    {
      name: "structured execution success",
      evidence: evidence({
        kind: "structured_execution_success_observation",
        toolFamily: "bash",
        observation: {
          kind: "execution_success",
          origin: "structured_output",
          subject: "tool",
          consequenceBaseline: "low",
          toolFamily: "bash",
        },
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: {
        kind: "outcome",
        polarity: "success",
        subject: "tool",
        provenance: { origin: "structured_output" },
      },
    },
    {
      name: "operation success transcript",
      evidence: evidence({
        kind: "operation_success_observation",
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: { kind: "outcome", polarity: "success", subject: "unknown" },
    },
    {
      name: "structured source payload",
      evidence: evidence({
        kind: "structured_tool_output_observation",
        toolFamily: "bash",
        observation: {
          kind: "payload",
          origin: "structured_output",
          subject: "source",
          consequenceBaseline: "high",
          toolFamily: "bash",
        },
        readsAsObservation: true,
        consequenceBaseline: "high",
      }),
      expected: {
        kind: "payload",
        polarity: "neutral",
        subject: "source",
        provenance: { origin: "structured_output" },
      },
    },
    {
      name: "empty failure payload",
      evidence: evidence({
        kind: "empty_failure_payload",
        failureDetail: "absent_evidence",
        toolFamily: "edit",
      }),
      expected: {
        kind: "outcome",
        polarity: "failure",
        evidenceLoss: "absent",
        recoveryHint: "request_evidence",
        evidenceStrength: "weak",
      },
    },
    {
      name: "observational diff payload",
      evidence: evidence({
        kind: "observational_payload",
        toolFamily: "bash",
        observation: {
          kind: "payload",
          origin: "transcript",
          subject: "diff",
          consequenceBaseline: "high",
          toolFamily: "bash",
        },
        readsAsObservation: true,
        consequenceBaseline: "high",
      }),
      expected: {
        kind: "payload",
        polarity: "neutral",
        subject: "source",
        provenance: { origin: "transcript" },
      },
    },
    {
      name: "routine search output",
      evidence: evidence({
        kind: "routine_search_output",
        toolFamily: "search",
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: { kind: "payload", polarity: "neutral", subject: "search" },
    },
    {
      name: "expected diagnostic failure",
      evidence: evidence({
        kind: "expected_diagnostic_failure",
        toolFamily: "bash",
      }),
      expected: {
        kind: "diagnostic",
        polarity: "failure",
        diagnosticClass: "expected",
        recoveryHint: "inspect_diagnostic",
      },
    },
    {
      name: "terminal outcome-only failure",
      evidence: evidence({
        kind: "terminal_failure",
        failureDetail: "outcome_only",
        toolFamily: "bash",
      }),
      expected: { kind: "outcome", polarity: "failure", evidenceLoss: "none" },
    },
    {
      name: "terminal runtime diagnostic",
      evidence: evidence({
        kind: "terminal_failure",
        failureDetail: "diagnostic",
        toolFamily: "bash",
        consequenceBaseline: "high",
      }),
      expected: {
        kind: "diagnostic",
        polarity: "failure",
        diagnosticClass: "runtime",
        recoveryHint: "inspect_diagnostic",
      },
    },
    {
      name: "terminal source-window limit",
      evidence: evidence({
        kind: "terminal_failure",
        failureDetail: "source_window_limit",
        toolFamily: "read",
      }),
      expected: {
        kind: "diagnostic",
        polarity: "failure",
        subject: "source",
        evidenceLoss: "partial",
        diagnosticClass: "source_limit",
        recoveryHint: "narrow_evidence_scope",
      },
    },
    {
      name: "tool-use rejection",
      evidence: evidence({
        kind: "rejected_tool_use_observation",
        toolFamily: "bash",
        observation: {
          kind: "tool_rejection",
          origin: "status_text",
          subject: "tool",
          consequenceBaseline: "low",
          toolFamily: "bash",
        },
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: {
        kind: "control",
        polarity: "neutral",
        recoveryHint: "await_authorization",
        provenance: { origin: "status_text" },
      },
    },
    {
      name: "unclassified failure",
      evidence: evidence({
        kind: "unclassified_failure",
        failureDetail: "indeterminate",
        consequenceBaseline: "high",
      }),
      expected: {
        kind: "unknown",
        polarity: "failure",
        evidenceLoss: "unknown",
        recoveryHint: "inspect_original_evidence",
        evidenceStrength: "weak",
      },
    },
  ];

  for (const testCase of cases) {
    const observation = compile(testCase.evidence);

    for (const [key, value] of Object.entries(testCase.expected)) {
      if (key === "ownership" || key === "provenance") {
        continue;
      }
      assert.deepEqual(observation[key as keyof NormalizedObservation], value, testCase.name);
    }
    assert.equal(observation.semanticAgreement, "stable", testCase.name);
    assert.equal(
      observation.consequenceBaseline,
      testCase.evidence.consequenceBaseline,
      testCase.name,
    );
    assert.deepEqual(
      { ...observation.ownership, ...testCase.expected.ownership },
      observation.ownership,
      testCase.name,
    );
    assert.deepEqual(
      { ...observation.provenance, ...testCase.expected.provenance },
      observation.provenance,
      testCase.name,
    );
  }
});

test("normalized observations preserve status-conflict kind parity with legacy evidence kinds", () => {
  const parityCases = [
    evidence({
      kind: "routine_bash_success_observation",
      toolFamily: "bash",
      readsAsObservation: true,
      consequenceBaseline: "low",
    }),
    evidence({
      kind: "structured_execution_success_observation",
      toolFamily: "bash",
      observation: {
        kind: "execution_success",
        origin: "structured_output",
        subject: "tool",
        consequenceBaseline: "low",
        toolFamily: "bash",
      },
      readsAsObservation: true,
      consequenceBaseline: "low",
    }),
    evidence({
      kind: "operation_success_observation",
      readsAsObservation: true,
      consequenceBaseline: "low",
    }),
    evidence({
      kind: "structured_tool_output_observation",
      toolFamily: "bash",
      observation: {
        kind: "payload",
        origin: "structured_output",
        subject: "source",
        consequenceBaseline: "high",
        toolFamily: "bash",
      },
      readsAsObservation: true,
      consequenceBaseline: "high",
    }),
    evidence({
      kind: "observational_payload",
      toolFamily: "bash",
      observation: {
        kind: "payload",
        origin: "transcript",
        subject: "diff",
        consequenceBaseline: "high",
        toolFamily: "bash",
      },
      readsAsObservation: true,
      consequenceBaseline: "high",
    }),
    evidence({
      kind: "routine_search_output",
      toolFamily: "search",
      readsAsObservation: true,
      consequenceBaseline: "low",
    }),
    evidence({
      kind: "rejected_tool_use_observation",
      toolFamily: "bash",
      observation: {
        kind: "tool_rejection",
        origin: "status_text",
        subject: "tool",
        consequenceBaseline: "low",
        toolFamily: "bash",
      },
      readsAsObservation: true,
      consequenceBaseline: "low",
    }),
    evidence({
      kind: "empty_failure_payload",
      failureDetail: "absent_evidence",
      toolFamily: "edit",
    }),
    evidence({
      kind: "expected_diagnostic_failure",
      toolFamily: "bash",
    }),
    evidence({
      kind: "terminal_failure",
      failureDetail: "diagnostic",
      toolFamily: "bash",
    }),
    evidence({
      kind: "unclassified_failure",
      failureDetail: "indeterminate",
      consequenceBaseline: "high",
    }),
  ];

  for (const failureEvidence of parityCases) {
    assert.equal(
      readObservationalStatusConflictKindFromObservation(compile(failureEvidence)),
      readObservationalStatusConflictKind(failureEvidence.kind),
      failureEvidence.kind,
    );
  }

  assert.equal(
    readObservationalStatusConflictKindFromObservation({
      kind: "outcome",
      polarity: "success",
      semanticAgreement: "stable",
      ownership: { owner: "tool", toolFamily: "edit" },
      evidenceStrength: "qualified",
      subject: "tool",
      evidenceLoss: "none",
      provenance: { origin: "semantic_evidence", authority: "inferred" },
      consequenceBaseline: "high",
    }),
    "payload_observation",
  );
});

test("task-failure observation normalizer lowers certainty for uncertainty and evidence loss", () => {
  const absent = evidence({
    kind: "empty_failure_payload",
    failureDetail: "absent_evidence",
    toolFamily: "edit",
  });
  const unclassified = evidence({
    kind: "unclassified_failure",
    failureDetail: "indeterminate",
    consequenceBaseline: "high",
  });
  const terminalIndeterminate = evidence({
    kind: "terminal_failure",
    failureDetail: "indeterminate",
    toolFamily: "bash",
    consequenceBaseline: "high",
  });
  const runtimeDiagnostic = evidence({
    kind: "terminal_failure",
    failureDetail: "diagnostic",
    toolFamily: "bash",
    consequenceBaseline: "high",
  });

  assert.equal(compile(absent).evidenceStrength, "weak");
  assert.equal(compile(unclassified).semanticAgreement, "stable");
  assert.equal(compile(unclassified).evidenceStrength, "weak");
  assert.equal(
    compile(unclassified, { semanticAgreement: "uncertain" }).semanticAgreement,
    "uncertain",
  );
  assert.equal(compile(terminalIndeterminate).semanticAgreement, "uncertain");
  assert.equal(
    compile(terminalIndeterminate, { semanticAgreement: "overridden" }).semanticAgreement,
    "uncertain",
  );
  assert.equal(compile(terminalIndeterminate).evidenceStrength, "weak");
  assert.equal(compile(runtimeDiagnostic).evidenceStrength, "strong");
  assert.equal(
    compile(runtimeDiagnostic, { semanticAgreement: "overridden" }).semanticAgreement,
    "overridden",
  );
  assert.equal(
    compile(runtimeDiagnostic, { semanticAgreement: "overridden" }).evidenceStrength,
    "weak",
  );
  assert.equal(compile(runtimeDiagnostic, { abstained: true }).evidenceStrength, "weak");
  assert.equal(
    compile(runtimeDiagnostic, {
      ontology: { ...ontology, consequence: "high", confidence: "low" },
    }).evidenceStrength,
    "weak",
  );
});
