import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTENTION_DECISION_RECORD_SCHEMA_VERSION,
  evaluateAttention,
  type AttentionClaim,
  type AttentionEvaluationContext,
  type AttentionEvaluationFrame,
} from "../src/evaluator.js";
import { JudgmentCoordinator } from "../src/judgment-coordinator.js";
import type { AttentionFrame } from "../src/frame.js";
import type { AttentionCandidate } from "../src/interaction-candidate.js";

function createClaim(overrides: Partial<AttentionClaim> = {}): AttentionClaim {
  return {
    taskId: "task:evaluator",
    interactionId: "interaction:evaluator",
    source: { id: "codex", kind: "codex" },
    toolFamily: "read",
    activityClass: "permission_request",
    mode: "approval",
    tone: "focused",
    consequence: "low",
    title: "Read package.json",
    summary: "The agent wants to inspect package.json before editing.",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    priority: "normal",
    blocking: true,
    timestamp: "2026-03-13T18:00:00.000Z",
    judgment: {
      blockedLikeStatus: false,
    },
    ...overrides,
  };
}

function createCurrentFrame(
  overrides: Partial<AttentionEvaluationFrame> = {},
): AttentionEvaluationFrame {
  return {
    id: "frame:current",
    taskId: "task:evaluator",
    interactionId: "interaction:current",
    source: { id: "codex", kind: "codex" },
    mode: "approval",
    tone: "critical",
    consequence: "high",
    title: "Current deploy approval",
    responseSpec: {
      kind: "approval",
      actions: [
        { id: "approve", label: "Approve", kind: "approve", emphasis: "primary" },
        { id: "reject", label: "Reject", kind: "reject", emphasis: "danger" },
      ],
    },
    timestamp: "2026-03-13T17:59:00.000Z",
    updatedAt: "2026-03-13T17:59:00.000Z",
    ...overrides,
  };
}

function createInternalCandidate(claim: AttentionClaim): AttentionCandidate {
  return {
    taskId: claim.taskId,
    interactionId: claim.interactionId,
    ...(claim.source !== undefined ? { source: claim.source } : {}),
    ...(claim.toolFamily !== undefined ? { toolFamily: claim.toolFamily } : {}),
    ...(claim.activityClass !== undefined ? { activityClass: claim.activityClass } : {}),
    mode: claim.mode,
    tone: claim.tone,
    consequence: claim.consequence,
    title: claim.title,
    ...(claim.summary !== undefined ? { summary: claim.summary } : {}),
    ...(claim.context !== undefined ? { context: claim.context } : {}),
    ...(claim.provenance !== undefined ? { provenance: claim.provenance } : {}),
    judgmentInput: {
      ...(claim.judgment?.ontology !== undefined ? { ontology: claim.judgment.ontology } : {}),
      ...(claim.judgment?.semanticEvidence !== undefined
        ? {
            semanticEvidence: {
              confidence: claim.judgment.semanticEvidence.confidence,
              source: claim.judgment.semanticEvidence.source,
              strength: claim.judgment.semanticEvidence.strength,
              abstained: claim.judgment.semanticEvidence.abstained ?? false,
            },
          }
        : {}),
      ...(claim.judgment?.relationEvidence !== undefined
        ? { relationEvidence: claim.judgment.relationEvidence }
        : {}),
      blockedLikeStatus: claim.judgment?.blockedLikeStatus ?? false,
      ...(claim.judgment?.routineObservationalStatusConflict === true ||
      claim.judgment?.observationalStatusConflict !== undefined
        ? { routineObservationalStatusConflict: true }
        : {}),
      ...(claim.judgment?.observationalStatusConflict !== undefined
        ? { observationalStatusConflict: claim.judgment.observationalStatusConflict }
        : {}),
    },
    ...(claim.relationHints !== undefined ? { relationHints: claim.relationHints } : {}),
    responseSpec: claim.responseSpec,
    priority: claim.priority,
    blocking: claim.blocking,
    timestamp: claim.timestamp,
    ...(claim.scoreAdjustment !== undefined ? { attentionScoreOffset: claim.scoreAdjustment } : {}),
    ...(claim.scoreRationale !== undefined ? { attentionRationale: claim.scoreRationale } : {}),
  };
}

function createInternalFrame(frame: AttentionEvaluationFrame): AttentionFrame {
  return {
    id: frame.id,
    taskId: frame.taskId,
    interactionId: frame.interactionId,
    ...(frame.source !== undefined ? { source: frame.source } : {}),
    version: 1,
    mode: frame.mode,
    tone: frame.tone,
    consequence: frame.consequence,
    title: frame.title,
    ...(frame.summary !== undefined ? { summary: frame.summary } : {}),
    ...(frame.context !== undefined ? { context: frame.context } : {}),
    ...(frame.responseSpec !== undefined ? { responseSpec: frame.responseSpec } : {}),
    ...(frame.provenance !== undefined ? { provenance: frame.provenance } : {}),
    timing: {
      createdAt: frame.timestamp,
      updatedAt: frame.updatedAt ?? frame.timestamp,
      ...(frame.expiresAt !== undefined ? { expiresAt: frame.expiresAt } : {}),
    },
  };
}

test("public attention evaluator matches the coordinator decision record", () => {
  const claim = createClaim();
  const current = createCurrentFrame();
  const context: AttentionEvaluationContext = {
    current,
    currentEpisode: {
      id: "episode:evaluator",
      key: "episode:evaluator",
      state: "waiting",
      size: 1,
      evidenceScore: 2,
      evidenceReasons: ["same task is already active"],
      lastInteractionId: current.interactionId,
      updatedAt: current.updatedAt ?? current.timestamp,
    },
    operatorPresence: "present" as const,
  };

  const record = evaluateAttention({ claim, context });
  const explanation = new JudgmentCoordinator().explain(
    createInternalFrame(current),
    createInternalCandidate(claim),
    {
      currentEpisode: context.currentEpisode,
      operatorPresence: "present",
    },
  );

  assert.deepEqual(record, explanation.record);
  assert.equal(record.schemaVersion, ATTENTION_DECISION_RECORD_SCHEMA_VERSION);
  assert.equal(record.evaluatedAt, claim.timestamp);
  assert.equal(record.planning.route, explanation.decision.kind);
  assert.equal("realizedLane" in record, false);
  assert.equal("realizedLane" in record.planning, false);
});

test("public attention evaluator returns owned JSON-safe record values", () => {
  const claim = createClaim({
    context: {
      stage: "review",
      progress: 0.5,
      items: [{ id: "file", label: "File", value: "package.json" }],
    },
  });
  const before = JSON.stringify(claim);
  const record = evaluateAttention({ claim });

  assert.equal(JSON.stringify(claim), before);
  assert.notEqual(record.claim, claim);
  assert.deepEqual(record.claim, claim);

  claim.context!.items![0]!.value = "mutated.ts";
  assert.equal(record.claim.context?.items?.[0]?.value, "package.json");
});

test("public attention evaluator preserves observational status-conflict evidence", () => {
  const observationalStatusConflict = {
    kind: "command_success_observation" as const,
    toolFamily: "bash",
    baselineConsequence: "low" as const,
  };
  const claim = createClaim({
    mode: "status",
    toolFamily: "bash",
    activityClass: "status_update",
    tone: "ambient",
    consequence: "low",
    responseSpec: { kind: "none" },
    priority: "background",
    blocking: false,
    judgment: {
      blockedLikeStatus: false,
      routineObservationalStatusConflict: true,
      observationalStatusConflict,
    },
  });

  const record = evaluateAttention({ claim });
  const candidate = createInternalCandidate(claim);

  assert.deepEqual(record.claim.judgment?.observationalStatusConflict, observationalStatusConflict);
  assert.equal(record.claim.judgment?.routineObservationalStatusConflict, true);
  assert.deepEqual(
    candidate.judgmentInput.observationalStatusConflict,
    observationalStatusConflict,
  );
  assert.equal(candidate.judgmentInput.routineObservationalStatusConflict, true);
});

test("decorative metadata does not enter the evaluator record", () => {
  const claim = createClaim();
  const decorated = {
    ...claim,
    metadata: {
      urgency: "EMERGENCY",
      decorativeScore: 9_999,
      nested: { banner: "please interrupt now" },
    },
  } satisfies AttentionClaim & { metadata: Record<string, unknown> };

  assert.deepEqual(evaluateAttention({ claim: decorated }), evaluateAttention({ claim }));
  assert.equal("metadata" in evaluateAttention({ claim: decorated }).claim, false);
});

test("public attention evaluator preserves claim timestamp and records explicit clock", () => {
  const claim = createClaim({
    timestamp: "2026-03-13T18:00:00.000Z",
  });
  const record = evaluateAttention({
    claim,
    now: Date.parse("2026-03-13T18:01:00.000Z"),
  });

  assert.equal(claim.timestamp, "2026-03-13T18:00:00.000Z");
  assert.equal(record.claim.timestamp, "2026-03-13T18:00:00.000Z");
  assert.equal(record.evaluatedAt, "2026-03-13T18:01:00.000Z");
});

test("public attention evaluator uses evaluation clock for elapsed-time planning", () => {
  const claim = createClaim({
    taskId: "task:dwell",
    interactionId: "interaction:dwell:incoming",
    consequence: "medium",
    priority: "high",
    blocking: false,
    timestamp: "2026-03-08T12:01:00.000Z",
  });
  const context: AttentionEvaluationContext = {
    current: createCurrentFrame({
      id: "frame:dwell-current",
      taskId: "task:dwell",
      interactionId: "interaction:dwell-current",
      mode: "status",
      tone: "focused",
      consequence: "medium",
      responseSpec: { kind: "none" },
      timestamp: "2026-03-08T12:00:55.000Z",
      updatedAt: "2026-03-08T12:00:55.000Z",
    }),
  };
  const config = {
    plannerDefaults: {
      minimumDwellMs: 30_000,
    },
  };

  const immediateRecord = evaluateAttention({
    claim,
    context,
    config,
    now: "2026-03-08T12:01:00.000Z",
  });
  const delayedRecord = evaluateAttention({
    claim,
    context,
    config,
    now: "2026-03-08T12:02:00.000Z",
  });

  assert.equal(claim.timestamp, "2026-03-08T12:01:00.000Z");
  assert.equal(immediateRecord.claim.timestamp, claim.timestamp);
  assert.equal(delayedRecord.claim.timestamp, claim.timestamp);
  assert.equal(immediateRecord.evaluatedAt, "2026-03-08T12:01:00.000Z");
  assert.equal(delayedRecord.evaluatedAt, "2026-03-08T12:02:00.000Z");
  assert.equal(
    immediateRecord.planning.continuityEvaluations.find(
      (evaluation) => evaluation.rule === "minimum_dwell",
    )?.kind,
    "override",
  );
  assert.equal(
    delayedRecord.planning.continuityEvaluations.find(
      (evaluation) => evaluation.rule === "minimum_dwell",
    )?.kind,
    "noop",
  );
  assert.equal(delayedRecord.planning.route, "activate");
});

test("public attention evaluator is byte-stable for repeated JSON evaluation", () => {
  const input = deepFreeze({
    claim: createClaim({
      judgment: {
        ontology: {
          ask: "approval",
          activity: "decision_request",
          consequence: "low",
          blocking: "blocking",
          episode: "new",
          confidence: "high",
          source: "explicit",
        },
        semanticEvidence: {
          confidence: "high",
          source: "explicit",
          strength: "strong",
        },
        blockedLikeStatus: false,
      },
    }),
    context: {
      current: createCurrentFrame({
        id: "frame:stable",
        updatedAt: "2026-03-13T17:58:00.000Z",
      }),
      operatorPresence: "present" as const,
    },
    config: {
      plannerDefaults: {
        minimumDwellMs: 30_000,
      },
    },
    now: "2026-03-13T18:01:00.000Z",
  });

  const first = JSON.stringify(evaluateAttention(input));
  const second = JSON.stringify(evaluateAttention(input));

  assert.equal(first, second);
});

test("public attention evaluator does not mutate context or config and owns context output", () => {
  const context: AttentionEvaluationContext = {
    pressure: {
      level: "elevated",
      overloadRisk: "rising",
      score: 2,
      metrics: {
        recentDemand: 3,
        interruptiveVisible: 0,
        averageResponseLatencyMs: null,
        deferredCount: 1,
        suppressedCount: 0,
      },
      reasons: ["incoming demand is climbing"],
    },
    burden: {
      level: "elevated",
      thresholdOffset: 1,
      metrics: {
        recentDecisions: 4,
        deferredCount: 1,
        averageResponseLatencyMs: null,
        interruptiveVisible: 0,
        pressureLevel: "elevated",
        attentionState: "monitoring",
      },
      reasons: ["recent decision volume is climbing"],
    },
  };
  const config = {
    plannerDefaults: {
      deferLowValueDuringPressure: true,
    },
  };
  const beforeContext = JSON.stringify(context);
  const beforeConfig = JSON.stringify(config);
  const record = evaluateAttention({ claim: createClaim(), context, config });

  assert.equal(JSON.stringify(context), beforeContext);
  assert.equal(JSON.stringify(config), beforeConfig);

  context.pressure!.reasons[0] = "mutated pressure";
  context.burden!.reasons[0] = "mutated burden";

  assert.equal(record.evidenceSnapshot.pressureForecast.reasons[0], "incoming demand is climbing");
  assert.equal(
    record.evidenceSnapshot.attentionBurden.reasons[0],
    "recent decision volume is climbing",
  );
});

test("public attention evaluator rejects malformed claim and clock timestamps", () => {
  assert.throws(
    () => evaluateAttention({ claim: createClaim({ timestamp: "not-a-date" }) }),
    /claim timestamp/,
  );
  assert.throws(
    () => evaluateAttention({ claim: createClaim(), now: "not-a-date" }),
    /evaluation clock/,
  );
  assert.throws(
    () => evaluateAttention({ claim: createClaim(), now: Number.NaN }),
    /evaluation clock must be finite/,
  );
});

test("public attention evaluator rejects internal current-frame aliases", () => {
  assert.throws(
    () =>
      evaluateAttention({
        claim: createClaim(),
        current: createInternalFrame(createCurrentFrame()),
      } as never),
    /context\.current/,
  );
  assert.throws(
    () =>
      evaluateAttention({
        claim: createClaim(),
        context: {
          current: createCurrentFrame(),
          currentFrame: createInternalFrame(createCurrentFrame()),
        },
      } as never),
    /context\.current/,
  );
});

test("public attention evaluator sorts and deduplicates reason codes", () => {
  const record = evaluateAttention({ claim: createClaim() });

  assert.deepEqual(record.planning.reasonCodes, [...record.planning.reasonCodes].sort());
  assert.equal(new Set(record.planning.reasonCodes).size, record.planning.reasonCodes.length);
  assert.ok(record.planning.reasonCodes.includes(`route:${record.planning.route}`));
  assert.ok(record.planning.reasonCodes.includes(`lane:${record.planning.plannedLane}`));
});

test("public attention evaluator projects continuity overrides without nested candidates", () => {
  const record = evaluateAttention({
    context: {
      current: createCurrentFrame({
        id: "frame:current-status",
        taskId: "task:current",
        interactionId: "interaction:current",
        mode: "status",
        tone: "focused",
        consequence: "medium",
        responseSpec: { kind: "none" },
        timestamp: "2026-03-08T12:00:55.000Z",
        updatedAt: "2026-03-08T12:00:55.000Z",
      }),
    },
    claim: createClaim({
      taskId: "task:current",
      interactionId: "interaction:incoming",
      consequence: "medium",
      priority: "high",
      blocking: false,
      timestamp: "2026-03-08T12:01:00.000Z",
    }),
  });
  const minimumDwell = record.planning.continuityEvaluations.find(
    (evaluation) => evaluation.rule === "minimum_dwell",
  );

  assert.equal(minimumDwell?.kind, "override");
  if (minimumDwell?.kind !== "override") {
    return;
  }

  assert.deepEqual(minimumDwell.decision, { kind: "queue" });
  assert.equal("candidate" in minimumDwell.decision, false);
});

test("public attention evaluator rejects non-finite decision-bearing values", () => {
  assert.throws(
    () =>
      evaluateAttention({
        claim: createClaim({
          scoreAdjustment: Number.POSITIVE_INFINITY,
        }),
      }),
    /non-finite number/,
  );
});

test("public attention evaluator accepts data-only policy configuration", () => {
  const record = evaluateAttention({
    claim: createClaim(),
    config: {
      policyConfig: {
        policy: {
          lowRiskRead: {
            autoApprove: true,
          },
        },
      },
    },
  });

  assert.deepEqual(record.decision, {
    kind: "auto_approve",
    response: {
      taskId: "task:evaluator",
      interactionId: "interaction:evaluator",
      response: { kind: "approved" },
    },
  });
  assert.equal(record.planning.plannedLane, "none");
  assert.ok(record.planning.reasonCodes.includes("policy:auto_approve"));
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }

  return value;
}
