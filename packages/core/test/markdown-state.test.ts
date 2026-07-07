import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApertureCore } from "../src/aperture-core.js";
import { loadPolicyConfig } from "../src/policy-config.js";
import { parseBullet, parseHeading } from "../src/markdown-state.js";
import { ProfileStore } from "../src/profile-store.js";

test("markdown helpers parse headings and key-value bullets", () => {
  assert.deepEqual(parseHeading("## Preferences"), { level: 2, text: "Preferences" });
  assert.deepEqual(parseBullet("- session count: 3"), { key: "session count", value: "3" });
  assert.deepEqual(parseBullet("- durable lesson"), { text: "durable lesson" });
});

function apertureMarkdown(
  sections: readonly string[],
  options: { version?: number; operatorId?: string; updatedAt?: string } = {},
): string {
  return [
    "# Aperture",
    "",
    "## Meta",
    `- version: ${options.version ?? 1}`,
    `- profile id: ${options.operatorId ?? "default"}`,
    `- updated at: ${options.updatedAt ?? "2026-03-12T10:15:00.000Z"}`,
    "",
    ...sections,
    "",
  ].join("\n");
}

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
      "- profile id: migrated",
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

test("profile store falls back when Aperture markdown uses an unsupported version", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-profile-version-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown(["## Preferences", "- control mode: focus"], { version: 2 }),
    "utf8",
  );

  const loaded = await new ProfileStore(root).loadApertureProfile({
    version: 1,
    operatorId: "fallback",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.operatorId, "fallback");
  assert.equal(loaded.preferences, undefined);
});

test("profile store loads Aperture preferences and tool overrides from markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-user-profile-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown([
      "## Preferences",
      "- control mode: focus",
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
      "- minimum lane: now",
      "- require context expansion: true",
      "- score boost: 12",
    ]),
    "utf8",
  );

  const loaded = await new ProfileStore(root).loadApertureProfile({
    version: 1,
    operatorId: "fallback",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.operatorId, "default");
  assert.equal(loaded.preferences?.controlMode, "focus");
  assert.deepEqual(loaded.preferences?.quietHours, ["22:00-06:00", "weekend"]);
  assert.deepEqual(loaded.preferences?.preferBatchingFor, ["status", "background"]);
  assert.deepEqual(loaded.preferences?.alwaysExpandContextFor, ["destructive_bash"]);
  assert.deepEqual(loaded.preferences?.neverAutoApprove, ["production_deploy"]);
  assert.deepEqual(loaded.overrides?.tools?.bash, {
    mayInterrupt: true,
    minimumLane: "now",
    requireContextExpansion: true,
    scoreBoost: 12,
  });
});

test("policy config loader reads policy sections from APERTURE.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-policy-config-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown([
      "## Policy",
      "",
      "### lowRiskRead",
      "- auto approve: true",
      "",
      "## Planner Defaults",
      "- batch status bursts: false",
      "- defer low value during pressure: false",
      "- minimum dwell ms: 25000",
      "- stream continuity margin: 18",
      "- conflicting interrupt margin: 14",
      "- disabled continuity rules: minimum_dwell, decision_stream_continuity",
      "",
      "## Ambiguity Defaults",
      "- non blocking activation threshold: 190",
      "- promotion margin: 24",
    ]),
    "utf8",
  );

  const loaded = await loadPolicyConfig(root, {
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

test("policy config loader parses all policy rule fields from markdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-policy-policy-fields-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown([
      "## Policy",
      "",
      "### destructiveBash",
      "- auto approve: false",
      "- may interrupt: true",
      "- minimum lane: now",
      "- require context expansion: true",
    ]),
    "utf8",
  );

  const loaded = await loadPolicyConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.deepEqual(loaded.policy?.destructiveBash, {
    autoApprove: false,
    mayInterrupt: true,
    minimumLane: "now",
    requireContextExpansion: true,
  });
});

test("policy config loader normalizes legacy minimum presentation values", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-policy-legacy-lane-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown(["## Policy", "", "### lowRiskRead", "- minimum presentation: queue"]),
    "utf8",
  );

  const loaded = await loadPolicyConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.policy?.lowRiskRead?.minimumLane, "next");
});

test("profile store normalizes legacy minimum presentation values into minimumLane", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-user-profile-legacy-lane-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown(["## Tool Overrides", "", "### bash", "- minimum presentation: active"]),
    "utf8",
  );

  const loaded = await new ProfileStore(root).loadApertureProfile({
    version: 1,
    operatorId: "fallback",
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.deepEqual(loaded.overrides?.tools?.bash, {
    minimumLane: "now",
  });
});

test("policy config loader deduplicates recognized disabled continuity rules and drops unknown names", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-policy-disabled-rules-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown([
      "## Planner Defaults",
      "- disabled continuity rules: minimum_dwell, typo_rule, minimum_dwell, decision_stream_continuity",
    ]),
    "utf8",
  );

  const loaded = await loadPolicyConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.deepEqual(loaded.plannerDefaults?.disabledContinuityRules, [
    "minimum_dwell",
    "decision_stream_continuity",
  ]);
});

test("policy config loader falls back when markdown uses an unsupported version", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-policy-version-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown(["## Policy", "", "### lowRiskRead", "- auto approve: true"], { version: 2 }),
    "utf8",
  );

  const loaded = await loadPolicyConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.version, 1);
  assert.equal(loaded.updatedAt, "1970-01-01T00:00:00.000Z");
  assert.equal(loaded.policy, undefined);
});

test("markdown-backed core checkpoints distilled memory back to MEMORY.md", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-checkpoint-memory-"));
  await writeFile(join(root, "APERTURE.md"), apertureMarkdown([]), "utf8");
  await writeFile(
    join(root, "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Meta",
      "- version: 1",
      "- profile id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "- session count: 1",
      "",
    ].join("\n"),
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

test("markdown-backed core can reload policy rules without restarting", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-reload-markdown-"));
  await writeFile(
    join(root, "APERTURE.md"),
    apertureMarkdown(["## Policy", "", "### lowRiskRead", "- auto approve: true"]),
    "utf8",
  );
  await writeFile(
    join(root, "MEMORY.md"),
    [
      "# Memory",
      "",
      "## Meta",
      "- version: 1",
      "- profile id: default",
      "- updated at: 2026-03-12T10:15:00.000Z",
      "- session count: 0",
      "",
    ].join("\n"),
    "utf8",
  );
  const aperturePath = join(root, "APERTURE.md");

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
  assert.equal(core.getTaskView("task:ambient").now, null);
  assert.equal(core.getSignals("task:ambient")[0]?.kind, "responded");

  await writeFile(
    aperturePath,
    apertureMarkdown([], { updatedAt: "2026-03-12T10:20:00.000Z" }),
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
  assert.equal(core.getTaskView("task:active").now?.interactionId, "interaction:active");
});

test("markdown-backed core coalesces concurrent reloads into one in-flight refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-reload-coalesce-"));
  await writeFile(join(root, "APERTURE.md"), apertureMarkdown([]), "utf8");

  let userLoads = 0;
  let memoryLoads = 0;
  let releaseGate: (() => void) | null = null;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const profileStore = {
    async loadApertureProfile(fallback: Parameters<ProfileStore["loadApertureProfile"]>[0]) {
      userLoads += 1;
      await gate;
      return fallback;
    },
    async loadMemoryProfile(fallback: Parameters<ProfileStore["loadMemoryProfile"]>[0]) {
      memoryLoads += 1;
      await gate;
      return fallback;
    },
    async saveMemoryProfile() {},
  } as unknown as ProfileStore;

  const core = new ApertureCore({
    profileStore,
    markdownRootDir: root,
    apertureProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
    },
    memoryProfile: {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
      sessionCount: 0,
    },
    policyConfig: {
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
    },
  });

  const firstReload = core.reloadMarkdown();
  const secondReload = core.reloadMarkdown();
  await Promise.resolve();

  assert.equal(userLoads, 1);
  assert.equal(memoryLoads, 1);
  releaseGate?.();

  assert.equal(await firstReload, true);
  assert.equal(await secondReload, true);
  assert.equal(userLoads, 1);
  assert.equal(memoryLoads, 1);
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
