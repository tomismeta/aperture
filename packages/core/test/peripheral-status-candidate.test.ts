import assert from "node:assert/strict";
import test from "node:test";

import type { AttentionCandidate } from "../src/interaction-candidate.js";
import type { NormalizedObservation } from "../src/normalized-observation.js";
import type { CandidateSemanticEvidence } from "../src/judgment-input-types.js";
import { isEstablishedPolicyPeripheralStatus } from "../src/policy/peripheral-status-candidate.js";

const stableSemanticEvidence: CandidateSemanticEvidence = {
  confidence: "high",
  source: "explicit",
  strength: "strong",
  abstained: false,
};

function observation(
  overrides: Partial<Omit<NormalizedObservation, "ownership" | "provenance">> & {
    ownership?: Partial<NormalizedObservation["ownership"]>;
    provenance?: Partial<NormalizedObservation["provenance"]>;
  } = {},
): NormalizedObservation {
  const { ownership, provenance, ...flatOverrides } = overrides;
  return {
    kind: "outcome",
    polarity: "failure",
    semanticAgreement: "stable",
    ownership: {
      owner: "tool",
      toolFamily: "bash",
      ...ownership,
    },
    evidenceStrength: "strong",
    subject: "tool",
    evidenceLoss: "none",
    provenance: {
      origin: "semantic_evidence",
      authority: "explicit",
      ...provenance,
    },
    consequenceBaseline: "high",
    ...flatOverrides,
  };
}

function candidate(input: {
  observation?: NormalizedObservation;
  semanticEvidence?: CandidateSemanticEvidence;
  routineObservationalStatusConflict?: boolean;
}): AttentionCandidate {
  return {
    taskId: "task:status",
    interactionId: "interaction:status",
    timestamp: "2026-03-27T20:00:00.000Z",
    mode: "status",
    priority: "background",
    tone: "ambient",
    consequence: "low",
    title: "Status update",
    responseSpec: { kind: "none" },
    blocking: false,
    judgmentInput: {
      blockedLikeStatus: false,
      ...(input.observation !== undefined ? { observation: input.observation } : {}),
      ...(input.semanticEvidence !== undefined ? { semanticEvidence: input.semanticEvidence } : {}),
      ...(input.routineObservationalStatusConflict === true
        ? { routineObservationalStatusConflict: true }
        : {}),
    },
  };
}

function ambientPeripheral(statusCandidate: AttentionCandidate): boolean {
  return isEstablishedPolicyPeripheralStatus(statusCandidate, {
    mayInterrupt: false,
    minimumLane: "ambient",
  });
}

test("peripheral status policy treats stable non-weak observations as authoritative", () => {
  assert.equal(
    ambientPeripheral(
      candidate({
        observation: observation({ evidenceStrength: "strong" }),
        semanticEvidence: stableSemanticEvidence,
      }),
    ),
    true,
  );

  assert.equal(
    ambientPeripheral(
      candidate({
        observation: observation({ evidenceStrength: "qualified" }),
        semanticEvidence: stableSemanticEvidence,
      }),
    ),
    true,
  );
});

test("peripheral status policy does not let legacy evidence rescue weak observations", () => {
  for (const observed of [
    observation({ evidenceStrength: "weak" }),
    observation({ semanticAgreement: "uncertain" }),
    observation({ semanticAgreement: "overridden" }),
  ]) {
    assert.equal(
      ambientPeripheral(
        candidate({
          observation: observed,
          semanticEvidence: stableSemanticEvidence,
        }),
      ),
      false,
      `${observed.semanticAgreement}/${observed.evidenceStrength}`,
    );
  }
});

test("peripheral status policy keeps legacy fallback and routine-conflict compatibility", () => {
  assert.equal(ambientPeripheral(candidate({ semanticEvidence: stableSemanticEvidence })), true);

  assert.equal(
    ambientPeripheral(
      candidate({
        observation: observation({
          evidenceStrength: "weak",
          semanticAgreement: "uncertain",
        }),
        semanticEvidence: stableSemanticEvidence,
        routineObservationalStatusConflict: true,
      }),
    ),
    true,
  );
});
