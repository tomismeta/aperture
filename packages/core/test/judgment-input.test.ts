import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAttentionJudgmentInput,
  hasActionableBlockedLikeStatusSemantics,
  hasBlockedLikeStatusSemantics,
  hasRoutineObservationalStatusConflictSemantics,
  readSemanticRelationEvidenceStrength,
  readSemanticEvidenceStrength,
  resolvePeripheralResolutionFloor,
} from "../src/judgment-input.js";

const timestamp = "2026-04-05T18:30:00.000Z";
const rejectedToolUseMessage =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
const successfulTestObservationTranscript =
  "OBSERVATION: === Testing quote formatting === All quote formatting tests passed!";
const abbreviatedFileViewObservationTranscript =
  "OBSERVATION: <NOTE>This file is too large to display entirely. Showing abbreviated version. Please use `str_replace_editor view` with the `view_range` parameter to show selected lines next.</NOTE> 1 # fmt: off 2 from __future__ import an...";

test("judgment input compiles blocked-like waiting statuses into one internal seam", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:blocked-like",
    taskId: "task:judgment-input:blocked-like",
    timestamp,
    type: "task.updated",
    title: "Cannot continue until credentials are provided",
    summary: "Work is waiting but cannot proceed until the operator provides credentials.",
    status: "waiting",
    semantic: {
      intentFrame: "blocked_work",
      activityClass: "status_update",
      consequence: "low",
      whyNow: "Work is blocked and may require operator attention.",
      factors: ["task.updated", "waiting", "semantic blocking signal"],
      relationHints: [],
      confidence: "medium",
      reasons: ["status wording indicates work cannot continue yet"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
      },
    },
  });

  assert.equal(input.blockedLikeStatus, true);
  assert.equal(input.ontology?.blocking, "blocking");
  assert.equal(input.semanticEvidence?.strength, "weak");
});

test("judgment input gives explicit human-input semantics a strong evidence read", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:approval",
    taskId: "task:judgment-input:approval",
    interactionId: "interaction:judgment-input:approval",
    timestamp,
    type: "human.input.requested",
    title: "Approve production deploy",
    summary: "Deploy the prepared release to production.",
    request: { kind: "approval" },
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      consequence: "high",
      whyNow: "High-consequence deploy needs explicit approval.",
      factors: ["human.input.requested", "approval"],
      relationHints: [],
      confidence: "high",
      reasons: ["request kind establishes an explicit operator decision point"],
      provenance: {
        intentFrame: "source",
        activityClass: "source",
        consequence: "source",
        whyNow: "source",
        confidence: "source",
      },
    },
  });

  assert.equal(input.blockedLikeStatus, false);
  assert.equal(input.semanticEvidence?.source, "explicit");
  assert.equal(input.semanticEvidence?.strength, "strong");
  assert.equal(input.relationEvidence, undefined);
});

test("judgment input marks routine observational failed-status conflicts", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:routine-observation-conflict",
    taskId: "task:judgment-input:routine-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed",
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });
  const candidate = {
    taskId: "task:judgment-input:routine-observation-conflict",
    interactionId: "interaction:judgment-input:routine-observation-conflict",
    mode: "status" as const,
    tone: "ambient" as const,
    consequence: "low" as const,
    title: "bash failure",
    responseSpec: { kind: "none" as const },
    priority: "background" as const,
    blocking: false,
    timestamp,
    judgmentInput: input,
  };

  assert.equal(input.routineObservationalStatusConflict, true);
  assert.equal(input.semanticEvidence?.strength, "qualified");
  assert.equal(hasRoutineObservationalStatusConflictSemantics(candidate), true);
});

test("judgment input derives routine status conflicts from raw evidence, not factors", () => {
  const base = {
    id: "evt:judgment-input:factor-independent-observation-conflict",
    taskId: "task:judgment-input:factor-independent-observation-conflict",
    timestamp,
    type: "task.updated" as const,
    title: "bash failure",
    summary: "Your command ran successfully and did not produce any output.",
    status: "failed" as const,
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update" as const,
      activityClass: "status_update" as const,
      toolFamily: "bash",
      consequence: "low" as const,
      factors: ["task.updated", "failed", "renamed_observation_factor"],
      relationHints: [],
      confidence: "high" as const,
      reasons: ["task status indicates failure but the update reads like observational output"],
    },
  };

  assert.equal(buildAttentionJudgmentInput(base).routineObservationalStatusConflict, true);
  assert.equal(
    buildAttentionJudgmentInput({
      ...base,
      summary: "Error: deployment failed with exit code 1.",
      semantic: {
        ...base.semantic,
        factors: ["task.updated", "failed", "observational_failure"],
      },
    }).routineObservationalStatusConflict,
    undefined,
  );
});

test("judgment input marks engine-owned non-bash observations as status conflicts", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:read-observation-conflict",
    taskId: "task:judgment-input:read-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "read failure",
    summary: "Observation path /var/log/system.log showing first 20 lines",
    status: "failed",
    toolFamily: "read",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "read",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        confidence: "inferred",
        toolFamily: "source",
      },
    },
  });

  assert.equal(input.routineObservationalStatusConflict, true);
  assert.equal(input.semanticEvidence?.strength, "qualified");
});

test("judgment input marks absent-family observation transcripts as status conflicts", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:missing-tool-observation-conflict",
    taskId: "task:judgment-input:missing-tool-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary:
      "OBSERVATION: Here's the result of running `cat -n` on /testbed/yamllint/cli.py: 1 #!/usr/bin/env python3 2 import sys",
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      consequence: "high",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        confidence: "inferred",
      },
    },
  });

  assert.equal(input.routineObservationalStatusConflict, true);
  assert.equal(input.ontology?.source, "inferred");
  assert.equal(input.ontology?.activity, "task_progress");
  assert.equal(input.ontology?.consequence, "high");
  assert.equal(input.ontology && "toolFamily" in input.ontology, false);
  assert.equal(input.semanticEvidence?.strength, "qualified");
});

test("judgment input marks low missing-tool transcript subclasses only on raw agreement", () => {
  for (const [id, summary] of [
    ["successful-test", successfulTestObservationTranscript],
    ["abbreviated-file-view", abbreviatedFileViewObservationTranscript],
  ] as const) {
    const input = buildAttentionJudgmentInput({
      id: `evt:judgment-input:${id}-observation-conflict`,
      taskId: `task:judgment-input:${id}-observation-conflict`,
      timestamp,
      type: "task.updated",
      title: "tool failure",
      summary,
      status: "failed",
      semantic: {
        intentFrame: "status_update",
        activityClass: "status_update",
        consequence: "low",
        factors: ["task.updated", "failed", "observational_failure"],
        relationHints: [],
        confidence: "high",
        reasons: ["task status indicates failure but the update reads like observational output"],
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          confidence: "inferred",
        },
      },
    });

    assert.equal(input.routineObservationalStatusConflict, true);
    assert.equal(input.ontology?.source, "inferred");
    assert.equal(input.ontology?.activity, "task_progress");
    assert.equal(input.ontology?.consequence, "low");
    assert.equal(input.ontology && "toolFamily" in input.ontology, false);
    assert.equal(input.semanticEvidence?.strength, "qualified");
  }

  const mismatchedFamilyInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:hinted-successful-test-observation-conflict",
    taskId: "task:judgment-input:hinted-successful-test-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: successfulTestObservationTranscript,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic hint claimed bash ownership"],
    },
  });
  const liftedConsequenceInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:lifted-successful-test-observation-conflict",
    taskId: "task:judgment-input:lifted-successful-test-observation-conflict",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: successfulTestObservationTranscript,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      consequence: "high",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic consequence was lifted"],
    },
  });

  assert.equal(mismatchedFamilyInput.routineObservationalStatusConflict, undefined);
  assert.equal(liftedConsequenceInput.routineObservationalStatusConflict, undefined);
});

test("judgment input marks tool-use rejection outcomes as status conflicts only on raw agreement", () => {
  const bashInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:bash-tool-use-rejection",
    taskId: "task:judgment-input:bash-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
    },
  });
  const absentInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:absent-tool-use-rejection",
    taskId: "task:judgment-input:absent-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["task status indicates failure but the update reads like observational output"],
    },
  });
  const mismatchedInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:mismatched-tool-use-rejection",
    taskId: "task:judgment-input:mismatched-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "tool failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "edit",
      consequence: "low",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic hint claimed edit ownership"],
    },
  });
  const liftedConsequenceInput = buildAttentionJudgmentInput({
    id: "evt:judgment-input:lifted-tool-use-rejection",
    taskId: "task:judgment-input:lifted-tool-use-rejection",
    timestamp,
    type: "task.updated",
    title: "bash failure",
    summary: rejectedToolUseMessage,
    status: "failed",
    toolFamily: "bash",
    semantic: {
      intentFrame: "status_update",
      activityClass: "status_update",
      toolFamily: "bash",
      consequence: "medium",
      factors: ["task.updated", "failed", "observational_failure"],
      relationHints: [],
      confidence: "high",
      reasons: ["semantic consequence was lifted"],
    },
  });

  assert.equal(bashInput.routineObservationalStatusConflict, true);
  assert.equal(absentInput.routineObservationalStatusConflict, true);
  assert.equal(mismatchedInput.routineObservationalStatusConflict, undefined);
  assert.equal(liftedConsequenceInput.routineObservationalStatusConflict, undefined);
});

test("judgment input gives hinted relation semantics their own continuity strength", () => {
  const input = buildAttentionJudgmentInput({
    id: "evt:judgment-input:relation-hint",
    taskId: "task:judgment-input:relation-hint",
    interactionId: "interaction:judgment-input:relation-hint",
    timestamp,
    type: "human.input.requested",
    title: "Approve rollback instead",
    summary: "Use the rollback plan instead for the same deploy.",
    request: { kind: "approval" },
    semantic: {
      intentFrame: "approval_request",
      activityClass: "permission_request",
      consequence: "high",
      whyNow: "A high-risk action needs explicit operator approval.",
      factors: ["human.input.requested", "approval"],
      relationHints: [
        { kind: "same_issue", target: "issue:deploy:prod" },
        { kind: "supersedes", target: "issue:deploy:prod" },
      ],
      confidence: "low",
      reasons: ["request kind establishes an explicit operator decision point"],
      provenance: {
        intentFrame: "inferred",
        activityClass: "inferred",
        consequence: "inferred",
        whyNow: "inferred",
        confidence: "inferred",
        relationHints: "hint",
      },
    },
  });

  const candidate = {
    taskId: "task:judgment-input:relation-hint",
    interactionId: "interaction:judgment-input:relation-hint",
    mode: "approval" as const,
    tone: "critical" as const,
    consequence: "high" as const,
    title: "Approve rollback instead",
    responseSpec: { kind: "approval" as const, actions: [] },
    priority: "high" as const,
    blocking: true,
    timestamp,
    judgmentInput: input,
  };

  assert.equal(input.semanticEvidence?.strength, "weak");
  assert.equal(input.relationEvidence?.source, "hinted");
  assert.equal(input.relationEvidence?.strength, "qualified");
  assert.equal(readSemanticRelationEvidenceStrength(candidate), "qualified");
});

test("judgment-input helpers preserve the blocked-like status peripheral floor", () => {
  const candidate = {
    taskId: "task:blocked-like",
    interactionId: "interaction:blocked-like",
    mode: "status" as const,
    tone: "ambient" as const,
    consequence: "low" as const,
    title: "Cannot continue until credentials are provided",
    responseSpec: { kind: "none" as const },
    priority: "background" as const,
    blocking: false,
    timestamp,
    judgmentInput: buildAttentionJudgmentInput({
      id: "evt:judgment-input:blocked-like-floor",
      taskId: "task:blocked-like",
      timestamp,
      type: "task.updated",
      title: "Cannot continue until credentials are provided",
      summary: "Work is waiting but cannot proceed until the operator provides credentials.",
      status: "waiting",
      semantic: {
        intentFrame: "blocked_work",
        activityClass: "status_update",
        consequence: "low",
        whyNow: "Work is blocked and may require operator attention.",
        factors: ["task.updated", "waiting", "semantic blocking signal"],
        relationHints: [],
        confidence: "medium",
        reasons: ["status wording indicates work cannot continue yet"],
        provenance: {
          intentFrame: "inferred",
          activityClass: "inferred",
          consequence: "inferred",
          whyNow: "inferred",
          confidence: "inferred",
        },
      },
    }),
  };

  assert.equal(hasBlockedLikeStatusSemantics(candidate), true);
  assert.equal(hasActionableBlockedLikeStatusSemantics(candidate), true);
  assert.equal(readSemanticEvidenceStrength(candidate), "weak");
  assert.equal(resolvePeripheralResolutionFloor(candidate, "ambient"), "queue");
});

test("judgment-input does not treat low-confidence blocked-like status as actionable", () => {
  const candidate = {
    taskId: "task:blocked-like-low",
    interactionId: "interaction:blocked-like-low",
    mode: "status" as const,
    tone: "ambient" as const,
    consequence: "low" as const,
    title: "Might be waiting",
    responseSpec: { kind: "none" as const },
    priority: "background" as const,
    blocking: false,
    timestamp,
    judgmentInput: {
      blockedLikeStatus: true,
      semanticEvidence: {
        confidence: "low" as const,
        source: "inferred" as const,
        strength: "weak" as const,
        abstained: false,
      },
    },
  };

  assert.equal(hasBlockedLikeStatusSemantics(candidate), true);
  assert.equal(hasActionableBlockedLikeStatusSemantics(candidate), false);
});
