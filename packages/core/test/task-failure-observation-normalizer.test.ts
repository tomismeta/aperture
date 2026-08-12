import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichTaskFailureObservation,
  normalizeTaskFailureObservation,
  projectTaskFailureObservationCore,
} from "../src/task-failure-observation-normalizer.js";
import type { NormalizedObservation } from "../src/normalized-observation.js";
import { resolveObservationStatusConflictKind } from "../src/judgment-observation-contract.js";
import type {
  SemanticTextEvidence,
  TaskFailureSemanticEvidence,
} from "../src/semantic-evidence.js";
import type { ObservationSemantics } from "../src/observation-semantics.js";
import type { AttentionOntologyDiagnostic } from "../src/semantic-ontology-types.js";
import type { TaskFailureObservationSyntax } from "../src/task-failure-observation-grammar.js";

const emptyText: SemanticTextEvidence = { shapes: [] };

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
    "consequenceBaseline" | "observationSyntax" | "readsAsObservation" | "text"
  > &
    Partial<
      Pick<
        TaskFailureSemanticEvidence,
        "consequenceBaseline" | "observationSyntax" | "readsAsObservation" | "text"
      >
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

function observationSyntax(
  input: Omit<TaskFailureObservationSyntax, "evidenceLoss">,
): TaskFailureObservationSyntax {
  return {
    ...input,
    evidenceLoss: "none",
  };
}

test("task-failure observation core preserves ontology-independent semantic facts", () => {
  const failureEvidence = evidence({
    kind: "terminal_failure",
    failureDetail: "diagnostic",
    toolFamily: "bash",
    consequenceBaseline: "high",
  });
  const core: ObservationSemantics = projectTaskFailureObservationCore(failureEvidence);

  assert.deepEqual(core, {
    kind: "diagnostic",
    polarity: "failure",
    ownership: { owner: "tool", toolFamily: "bash" },
    subject: "tool",
    evidenceLoss: "none",
    diagnosticClass: "runtime",
    recoveryHint: "inspect_diagnostic",
    provenance: { origin: "semantic_evidence" },
    consequenceBaseline: "high",
    evidenceCertainty: "determinate",
  });
  assert.equal("semanticAgreement" in core, false);
  assert.equal("evidenceStrength" in core, false);
  assert.equal("authority" in core.provenance, false);
  assert.deepEqual(
    enrichTaskFailureObservation({
      core,
      ontology: { ...ontology, consequence: "high" },
      abstained: false,
      semanticAgreement: "stable",
    }),
    compile(failureEvidence),
  );
});

test("task-failure observation enrichment owns evidence-certainty constraints", () => {
  const core = projectTaskFailureObservationCore(
    evidence({
      kind: "terminal_failure",
      failureDetail: "indeterminate",
      toolFamily: "bash",
      consequenceBaseline: "high",
    }),
  );

  assert.equal(core.evidenceCertainty, "indeterminate");
  assert.equal(
    enrichTaskFailureObservation({
      core,
      ontology: { ...ontology, consequence: "high" },
      abstained: false,
      semanticAgreement: "overridden",
    }).semanticAgreement,
    "uncertain",
  );

  const unclassified = projectTaskFailureObservationCore(
    evidence({
      kind: "unclassified_failure",
      failureDetail: "indeterminate",
      consequenceBaseline: "high",
    }),
  );

  assert.equal(unclassified.evidenceCertainty, "indeterminate");
  assert.equal(
    enrichTaskFailureObservation({
      core: unclassified,
      ontology: { ...ontology, consequence: "high" },
      abstained: false,
      semanticAgreement: "stable",
    }).semanticAgreement,
    "uncertain",
  );
});

test("task-failure observation enrichment derives strength from ontology and evidence quality", () => {
  const diagnosticCore = projectTaskFailureObservationCore(
    evidence({
      kind: "terminal_failure",
      failureDetail: "diagnostic",
      toolFamily: "bash",
      consequenceBaseline: "high",
    }),
  );
  const absentCore = projectTaskFailureObservationCore(
    evidence({
      kind: "empty_failure_payload",
      failureDetail: "absent_evidence",
      toolFamily: "edit",
    }),
  );
  const cases: Array<{
    name: string;
    core: typeof diagnosticCore;
    ontology: AttentionOntologyDiagnostic;
    abstained: boolean;
    semanticAgreement: Parameters<typeof enrichTaskFailureObservation>[0]["semanticAgreement"];
    expectedStrength: NormalizedObservation["evidenceStrength"];
    expectedAuthority: NormalizedObservation["provenance"]["authority"];
  }> = [
    {
      name: "high explicit stable",
      core: diagnosticCore,
      ontology: { ...ontology, consequence: "high", confidence: "high", source: "explicit" },
      abstained: false,
      semanticAgreement: "stable",
      expectedStrength: "strong",
      expectedAuthority: "explicit",
    },
    {
      name: "high inferred stable",
      core: diagnosticCore,
      ontology: { ...ontology, consequence: "high", confidence: "high", source: "inferred" },
      abstained: false,
      semanticAgreement: "stable",
      expectedStrength: "qualified",
      expectedAuthority: "inferred",
    },
    {
      name: "medium hinted stable",
      core: diagnosticCore,
      ontology: { ...ontology, consequence: "high", confidence: "medium", source: "hinted" },
      abstained: false,
      semanticAgreement: "stable",
      expectedStrength: "qualified",
      expectedAuthority: "hinted",
    },
    {
      name: "medium inferred stable",
      core: diagnosticCore,
      ontology: { ...ontology, consequence: "high", confidence: "medium", source: "inferred" },
      abstained: false,
      semanticAgreement: "stable",
      expectedStrength: "weak",
      expectedAuthority: "inferred",
    },
    {
      name: "low explicit stable",
      core: diagnosticCore,
      ontology: { ...ontology, consequence: "high", confidence: "low", source: "explicit" },
      abstained: false,
      semanticAgreement: "stable",
      expectedStrength: "weak",
      expectedAuthority: "explicit",
    },
    {
      name: "abstained",
      core: diagnosticCore,
      ontology: { ...ontology, consequence: "high", confidence: "high", source: "explicit" },
      abstained: true,
      semanticAgreement: "stable",
      expectedStrength: "weak",
      expectedAuthority: "explicit",
    },
    {
      name: "overridden",
      core: diagnosticCore,
      ontology: { ...ontology, consequence: "high", confidence: "high", source: "explicit" },
      abstained: false,
      semanticAgreement: "overridden",
      expectedStrength: "weak",
      expectedAuthority: "explicit",
    },
    {
      name: "absent evidence",
      core: absentCore,
      ontology,
      abstained: false,
      semanticAgreement: "stable",
      expectedStrength: "weak",
      expectedAuthority: "explicit",
    },
  ];

  for (const testCase of cases) {
    const observation = enrichTaskFailureObservation({
      core: testCase.core,
      ontology: testCase.ontology,
      abstained: testCase.abstained,
      semanticAgreement: testCase.semanticAgreement,
    });

    assert.equal(observation.evidenceStrength, testCase.expectedStrength, testCase.name);
    assert.equal(observation.provenance.authority, testCase.expectedAuthority, testCase.name);
  }
});

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
      expected: { kind: "outcome", polarity: "success", subject: "command" },
    },
    {
      name: "structured execution success",
      evidence: evidence({
        kind: "structured_execution_success_observation",
        toolFamily: "bash",
        observationSyntax: observationSyntax({
          kind: "outcome",
          polarity: "success",
          origin: "structured_output",
          subject: "tool",
          consequenceBaseline: "low",
          toolFamily: "bash",
        }),
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
        observationSyntax: observationSyntax({
          kind: "payload",
          polarity: "neutral",
          origin: "structured_output",
          subject: "source",
          consequenceBaseline: "high",
          toolFamily: "bash",
        }),
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
        observationSyntax: observationSyntax({
          kind: "payload",
          polarity: "neutral",
          origin: "transcript",
          subject: "source",
          consequenceBaseline: "high",
          toolFamily: "bash",
        }),
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
        observationSyntax: observationSyntax({
          kind: "control",
          polarity: "neutral",
          origin: "status_text",
          subject: "tool",
          consequenceBaseline: "low",
          toolFamily: "bash",
          recoveryHint: "await_authorization",
        }),
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
        semanticAgreement: "uncertain",
      },
    },
  ];

  for (const testCase of cases) {
    const observation = compile(testCase.evidence);
    const core = projectTaskFailureObservationCore(testCase.evidence);
    const enriched = enrichTaskFailureObservation({
      core,
      ontology: { ...ontology, consequence: testCase.evidence.consequenceBaseline },
      abstained: false,
      semanticAgreement: "stable",
    });

    assert.deepEqual(enriched, observation, testCase.name);
    assert.equal("semanticAgreement" in core, false, testCase.name);
    assert.equal("evidenceStrength" in core, false, testCase.name);
    assert.equal("authority" in core.provenance, false, testCase.name);

    for (const [key, value] of Object.entries(testCase.expected)) {
      if (key === "ownership" || key === "provenance") {
        continue;
      }
      assert.deepEqual(observation[key as keyof NormalizedObservation], value, testCase.name);
    }
    assert.equal(
      observation.semanticAgreement,
      testCase.expected.semanticAgreement ?? "stable",
      testCase.name,
    );
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

test("status-conflict kinds are derived from normalized observation fields", () => {
  const parityCases: Array<{
    name: string;
    failureEvidence: TaskFailureSemanticEvidence;
    expected: ReturnType<typeof resolveObservationStatusConflictKind>;
  }> = [
    {
      name: "command success observation",
      failureEvidence: evidence({
        kind: "routine_bash_success_observation",
        toolFamily: "bash",
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: "command_success_observation",
    },
    {
      name: "structured execution success observation",
      failureEvidence: evidence({
        kind: "structured_execution_success_observation",
        toolFamily: "bash",
        observationSyntax: observationSyntax({
          kind: "outcome",
          polarity: "success",
          origin: "structured_output",
          subject: "tool",
          consequenceBaseline: "low",
          toolFamily: "bash",
        }),
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: "execution_success_observation",
    },
    {
      name: "operation success observation",
      failureEvidence: evidence({
        kind: "operation_success_observation",
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: "payload_observation",
    },
    {
      name: "structured tool output observation",
      failureEvidence: evidence({
        kind: "structured_tool_output_observation",
        toolFamily: "bash",
        observationSyntax: observationSyntax({
          kind: "payload",
          polarity: "neutral",
          origin: "structured_output",
          subject: "source",
          consequenceBaseline: "high",
          toolFamily: "bash",
        }),
        readsAsObservation: true,
        consequenceBaseline: "high",
      }),
      expected: "structured_output_observation",
    },
    {
      name: "transcript payload observation",
      failureEvidence: evidence({
        kind: "observational_payload",
        toolFamily: "bash",
        observationSyntax: observationSyntax({
          kind: "payload",
          polarity: "neutral",
          origin: "transcript",
          subject: "source",
          consequenceBaseline: "high",
          toolFamily: "bash",
        }),
        readsAsObservation: true,
        consequenceBaseline: "high",
      }),
      expected: "payload_observation",
    },
    {
      name: "search output observation",
      failureEvidence: evidence({
        kind: "routine_search_output",
        toolFamily: "search",
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: "search_output_observation",
    },
    {
      name: "rejected tool-use observation",
      failureEvidence: evidence({
        kind: "rejected_tool_use_observation",
        toolFamily: "bash",
        observationSyntax: observationSyntax({
          kind: "control",
          polarity: "neutral",
          origin: "status_text",
          subject: "tool",
          consequenceBaseline: "low",
          toolFamily: "bash",
          recoveryHint: "await_authorization",
        }),
        readsAsObservation: true,
        consequenceBaseline: "low",
      }),
      expected: "rejected_tool_use_observation",
    },
    {
      name: "empty failed payload",
      failureEvidence: evidence({
        kind: "empty_failure_payload",
        failureDetail: "absent_evidence",
        toolFamily: "edit",
      }),
      expected: null,
    },
    {
      name: "expected diagnostic failure",
      failureEvidence: evidence({
        kind: "expected_diagnostic_failure",
        toolFamily: "bash",
      }),
      expected: null,
    },
    {
      name: "terminal diagnostic failure",
      failureEvidence: evidence({
        kind: "terminal_failure",
        failureDetail: "diagnostic",
        toolFamily: "bash",
      }),
      expected: null,
    },
    {
      name: "unclassified failure",
      failureEvidence: evidence({
        kind: "unclassified_failure",
        failureDetail: "indeterminate",
        consequenceBaseline: "high",
      }),
      expected: null,
    },
  ];

  for (const { name, failureEvidence, expected } of parityCases) {
    assert.equal(resolveObservationStatusConflictKind(compile(failureEvidence)), expected, name);
  }

  assert.equal(
    resolveObservationStatusConflictKind({
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
  assert.equal(compile(unclassified).semanticAgreement, "uncertain");
  assert.equal(compile(unclassified).evidenceStrength, "weak");
  assert.equal(
    compile(unclassified, { semanticAgreement: "overridden" }).semanticAgreement,
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
