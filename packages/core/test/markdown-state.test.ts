import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApertureCore } from "../src/aperture-core.js";
import { loadJudgmentConfig, serializeJudgmentConfig } from "../src/judgment-config.js";
import { parseBullet, parseHeading } from "../src/markdown-state.js";
import { ProfileStore } from "../src/profile-store.js";

test("markdown helpers parse headings and key-value bullets", () => {
  assert.deepEqual(parseHeading("## Preferences"), { level: 2, text: "Preferences" });
  assert.deepEqual(parseBullet("- session count: 3"), { key: "session count", value: "3" });
  assert.deepEqual(parseBullet("- durable lesson"), { text: "durable lesson" });
});

test("profile store saves and loads memory without extra dependencies", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-profile-store-"));
  const store = new ProfileStore(root);

  await store.saveMemoryProfile({
    version: 1,
    operatorId: "default",
    updatedAt: "2026-03-12T10:15:00.000Z",
    sessionCount: 3,
    toolFamilies: {
      read: {
        presentations: 4,
        responses: 4,
        dismissals: 0,
        avgResponseLatencyMs: 1800,
      },
    },
    lessons: ["Read approvals resolve quickly."],
    consequenceProfiles: {
      low: {
        rejectionRate: 0.25,
        reviewedCount: 4,
      },
    },
  });

  const loaded = await store.loadMemoryProfile({
    version: 1,
    operatorId: "fallback",
    updatedAt: "1970-01-01T00:00:00.000Z",
    sessionCount: 0,
  });

  assert.equal(loaded.operatorId, "default");
  assert.equal(loaded.toolFamilies?.read?.avgResponseLatencyMs, 1800);
  assert.deepEqual(loaded.lessons, ["Read approvals resolve quickly."]);
  assert.equal(loaded.consequenceProfiles?.low?.reviewedCount, 4);

  const raw = await readFile(join(root, "MEMORY.md"), "utf8");
  assert.match(raw, /^# Memory/m);
  assert.match(raw, /^## Tool Families/m);
});

test("profile store falls back when memory markdown uses an unsupported version", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-memory-version-"));
  await writeFile(
    join(root, "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Meta",
      "- version: 2",
      "- operator id: migrated",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "- session count: 5",
      "",
    ].join("\n"),
    "utf8",
  );

  const loaded = await new ProfileStore(root).loadMemoryProfile({
    version: 1,
    operatorId: "fallback",
    updatedAt: "1970-01-01T00:00:00.000Z",
    sessionCount: 0,
  });

  assert.equal(loaded.operatorId, "fallback");
  assert.equal(loaded.sessionCount, 0);
});

test("profile store loads user preferences and tool overrides from markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-user-profile-"));
  await writeFile(
    join(root, "USER.md"),
    [
      "# User",
      "",
      "## Meta",
      "- version: 1",
      "- operator id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "",
      "## Preferences",
      "- quiet hours: 22:00-06:00",
      "- quiet hours: weekend",
      "- prefer batching for: status",
      "- prefer batching for: background",
      "- always expand context for: destructive_bash",
      "- never auto approve: production_deploy",
      "",
      "## Tool Overrides",
      "",
      "### bash",
      "- may interrupt: true",
      "- minimum presentation: active",
      "- require context expansion: true",
      "- score boost: 12",
      "",
    ].join("\n"),
    "utf8",
  );

  const loaded = await new ProfileStore(root).loadUserProfile({
    version: 1,
    operatorId: "fallback",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.operatorId, "default");
  assert.deepEqual(loaded.preferences?.quietHours, ["22:00-06:00", "weekend"]);
  assert.deepEqual(loaded.preferences?.preferBatchingFor, ["status", "background"]);
  assert.deepEqual(loaded.preferences?.alwaysExpandContextFor, ["destructive_bash"]);
  assert.deepEqual(loaded.preferences?.neverAutoApprove, ["production_deploy"]);
  assert.deepEqual(loaded.overrides?.tools?.bash, {
    mayInterrupt: true,
    minimumPresentation: "active",
    requireContextExpansion: true,
    scoreBoost: 12,
  });
});

test("judgment config loader reads pure markdown judgment files", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-judgment-config-"));
  const path = join(root, "JUDGMENT.md");
  const content = serializeJudgmentConfig({
    version: 1,
    updatedAt: "2026-03-12T10:15:00.000Z",
    ambiguityDefaults: {
      nonBlockingActivationThreshold: 190,
      promotionMargin: 24,
    },
    plannerDefaults: {
      batchStatusBursts: false,
      deferLowValueDuringPressure: false,
      minimumDwellMs: 25_000,
      streamContinuityMargin: 18,
      conflictingInterruptMargin: 14,
      disabledContinuityRules: ["minimum_dwell", "decision_stream_continuity"],
    },
    policy: {
      lowRiskRead: {
        autoApprove: true,
      },
    },
  });

  await writeFile(path, content, "utf8");

  const loaded = await loadJudgmentConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.policy?.lowRiskRead?.autoApprove, true);
  assert.equal(loaded.ambiguityDefaults?.nonBlockingActivationThreshold, 190);
  assert.equal(loaded.ambiguityDefaults?.promotionMargin, 24);
  assert.equal(loaded.plannerDefaults?.batchStatusBursts, false);
  assert.equal(loaded.plannerDefaults?.deferLowValueDuringPressure, false);
  assert.equal(loaded.plannerDefaults?.minimumDwellMs, 25_000);
  assert.equal(loaded.plannerDefaults?.streamContinuityMargin, 18);
  assert.equal(loaded.plannerDefaults?.conflictingInterruptMargin, 14);
  assert.deepEqual(loaded.plannerDefaults?.disabledContinuityRules, [
    "minimum_dwell",
    "decision_stream_continuity",
  ]);
});

test("judgment config loader parses all judgment rule fields from markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-judgment-policy-fields-"));
  await writeFile(
    join(root, "JUDGMENT.md"),
    [
      "# Judgment",
      "",
      "## Meta",
      "- version: 1",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "",
      "## Policy",
      "",
      "### destructiveBash",
      "- auto approve: false",
      "- may interrupt: true",
      "- minimum presentation: active",
      "- require context expansion: true",
      "",
    ].join("\n"),
    "utf8",
  );

  const loaded = await loadJudgmentConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.deepEqual(loaded.policy?.destructiveBash, {
    autoApprove: false,
    mayInterrupt: true,
    minimumPresentation: "active",
    requireContextExpansion: true,
  });
});

test("judgment config loader deduplicates recognized disabled continuity rules and drops unknown names", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-judgment-disabled-rules-"));
  await writeFile(
    join(root, "JUDGMENT.md"),
    [
      "# Judgment",
      "",
      "## Meta",
      "- version: 1",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "",
      "## Planner Defaults",
      "- disabled continuity rules: minimum_dwell, typo_rule, minimum_dwell, decision_stream_continuity",
      "",
    ].join("\n"),
    "utf8",
  );

  const loaded = await loadJudgmentConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.deepEqual(loaded.plannerDefaults?.disabledContinuityRules, [
    "minimum_dwell",
    "decision_stream_continuity",
  ]);
});

test("judgment config loader falls back when markdown uses an unsupported version", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-judgment-version-"));
  await writeFile(
    join(root, "JUDGMENT.md"),
    [
      "# Judgment",
      "",
      "## Meta",
      "- version: 2",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "",
      "## Policy",
      "",
      "### lowRiskRead",
      "- auto approve: true",
      "",
    ].join("\n"),
    "utf8",
  );

  const loaded = await loadJudgmentConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.version, 1);
  assert.equal(loaded.updatedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(loaded.policy, undefined);
});

test("markdown-backed core checkpoints distilled memory back to MEMORY.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-checkpoint-memory-"));
  await writeFile(
    join(root, "USER.md"),
    [
      "# User",
      "",
      "## Meta",
      "- version: 1",
      "- operator id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Meta",
      "- version: 1",
      "- operator id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "- session count: 1",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "JUDGMENT.md"),
    serializeJudgmentConfig({
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
    }),
    "utf8",
  );

  const core = await ApertureCore.fromMarkdown(root);
  core.publish({
    id: "event:1",
    type: "human.input.requested",
    taskId: "task:read",
    interactionId: "interaction:read",
    timestamp: "2026-03-12T10:15:00.000Z",
    source: { id: "session:1", kind: "claude-code" },
    title: "Claude Code wants to read config.ts",
    summary: "config.ts",
    consequence: "low",
    request: { kind: "approval" },
  });
  core.submit({
    taskId: "task:read",
    interactionId: "interaction:read",
    response: { kind: "approved" },
  });

  const snapshot = await core.checkpointMemory("2026-03-12T10:16:00.000Z");
  assert.equal(snapshot?.sessionCount, 2);
  assert.equal(snapshot?.toolFamilies?.read?.presentations, 1);
  assert.equal(snapshot?.toolFamilies?.read?.responses, 1);

  const persisted = await new ProfileStore(root).loadMemoryProfile({
    version: 1,
    operatorId: "missing",
    updatedAt: "1970-01-01T00:00:00.000Z",
    sessionCount: 0,
  });
  assert.equal(persisted.sessionCount, 2);
  assert.equal(persisted.toolFamilies?.read?.responses, 1);
});

test("markdown-backed core can reload judgment rules without restarting", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-reload-markdown-"));
  await writeFile(
    join(root, "USER.md"),
    [
      "# User",
      "",
      "## Meta",
      "- version: 1",
      "- operator id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    join(root, "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Meta",
      "- version: 1",
      "- operator id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "- session count: 0",
      "",
    ].join("\n"),
    "utf8",
  );
  const judgmentPath = join(root, "JUDGMENT.md");
  await writeFile(
    judgmentPath,
    serializeJudgmentConfig({
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        lowRiskRead: {
          autoApprove: true,
        },
      },
    }),
    "utf8",
  );

  const core = await ApertureCore.fromMarkdown(root);
  core.publish({
    id: "event:ambient",
    type: "human.input.requested",
    taskId: "task:ambient",
    interactionId: "interaction:ambient",
    timestamp: "2026-03-12T10:15:00.000Z",
    source: { id: "session:1", kind: "claude-code" },
    title: "Claude Code wants to read config.ts",
    summary: "config.ts",
    consequence: "low",
    request: { kind: "approval" },
  });
  assert.equal(core.getTaskView("task:ambient").active, null);
  assert.equal(core.getSignals("task:ambient")[0]?.kind, "responded");

  await writeFile(
    judgmentPath,
    serializeJudgmentConfig({
      version: 1,
      updatedAt: "2026-03-12T10:20:00.000Z",
    }),
    "utf8",
  );
  assert.equal(await core.reloadMarkdown(), true);

  core.publish({
    id: "event:active",
    type: "human.input.requested",
    taskId: "task:active",
    interactionId: "interaction:active",
    timestamp: "2026-03-12T10:21:00.000Z",
    source: { id: "session:1", kind: "claude-code" },
    title: "Claude Code wants to read settings.ts",
    summary: "settings.ts",
    consequence: "low",
    request: { kind: "approval" },
  });
  assert.equal(core.getTaskView("task:active").active?.interactionId, "interaction:active");
});

test("memory snapshots deduplicate repeated terminal signals for one interaction", () => {
  const core = new ApertureCore();

  core.recordSignal({
    kind: "presented",
    taskId: "task:read",
    interactionId: "interaction:read",
    timestamp: "2026-03-12T10:15:00.000Z",
    metadata: {
      toolFamily: "read",
      consequence: "low",
      sourceKey: "claude-code",
    },
  });
  core.recordSignal({
    kind: "responded",
    taskId: "task:read",
    interactionId: "interaction:read",
    responseKind: "approved",
    latencyMs: 1200,
    timestamp: "2026-03-12T10:15:01.000Z",
    metadata: {
      toolFamily: "read",
      consequence: "low",
      sourceKey: "claude-code",
    },
  });
  core.recordSignal({
    kind: "responded",
    taskId: "task:read",
    interactionId: "interaction:read",
    responseKind: "approved",
    latencyMs: 900,
    timestamp: "2026-03-12T10:15:02.000Z",
    metadata: {
      toolFamily: "read",
      consequence: "low",
      sourceKey: "claude-code",
    },
  });

  const snapshot = core.snapshotMemoryProfile("2026-03-12T10:16:00.000Z");

  assert.equal(snapshot.toolFamilies?.read?.presentations, 1);
  assert.equal(snapshot.toolFamilies?.read?.responses, 1);
  assert.equal(snapshot.toolFamilies?.read?.avgResponseLatencyMs, 900);
  assert.equal(snapshot.sourceTrust?.["claude-code"]?.low?.confirmations, 1);
  assert.equal(snapshot.consequenceProfiles?.low?.reviewedCount, 1);
});

test("memory snapshots default to the core timeSource when no timestamp is supplied", () => {
  const fixedTimestamp = "2026-03-12T10:16:00.000Z";
  const core = new ApertureCore({
    timeSource: () => Date.parse(fixedTimestamp),
  });

  core.recordSignal({
    kind: "presented",
    taskId: "task:read",
    interactionId: "interaction:read",
    timestamp: "2026-03-12T10:15:00.000Z",
    metadata: {
      toolFamily: "read",
      consequence: "low",
      sourceKey: "claude-code",
    },
  });

  const snapshot = core.snapshotMemoryProfile();

  assert.equal(snapshot.updatedAt, fixedTimestamp);
  assert.equal(snapshot.sessionCount, 1);
});
