import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApertureCore } from "../src/aperture-core.js";
import { loadPolicyConfig } from "../src/policy-config.js";
import { parseBullet, parseHeading } from "../src/markdown-state.js";
import { ProfileStore, type MemoryProfile } from "../src/profile-store.js";
import type { AttentionSignal } from "../src/interaction-signal.js";

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

test("checkpoints account one session and one interaction across split feedback, reload and retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-checkpoint-deltas-"));
  const core = await ApertureCore.fromMarkdown(root);
  const now = "2026-03-12T10:16:00.000Z";
  const signal: AttentionSignal = {
    kind: "presented",
    taskId: "task:read",
    interactionId: "interaction:read",
    timestamp: "2026-03-12T10:15:00.000Z",
    metadata: { toolFamily: "read", consequence: "low", sourceKey: "test-source" },
  };
  core.recordSignal(signal);
  const first = await core.checkpointMemory(now);
  assert.equal(first?.sessionCount, 1);
  assert.equal(first?.toolFamilies?.read?.presentations, 1);
  assert.deepEqual(await core.checkpointMemory(now), first);
  assert.deepEqual(core.snapshotMemoryProfile(now), first);
  assert.equal(core.getSignals().length, 1);
  await core.reloadMarkdown();
  assert.deepEqual(core.snapshotMemoryProfile(now), first);

  // Feedback retention must not erase the presentation already accounted for.
  for (let index = 0; index < 260; index += 1) {
    core.recordSignal({
      kind: "viewed",
      taskId: signal.taskId,
      interactionId: `noise:${index}`,
      timestamp: signal.timestamp,
    });
  }
  assert.equal(
    core.getSignals().some((item) => item.kind === "presented"),
    false,
  );
  core.recordSignal({ ...signal, kind: "responded", responseKind: "approved", latencyMs: 1200 });
  const second = await core.checkpointMemory(now);
  assert.equal(second?.sessionCount, 1);
  assert.equal(second?.toolFamilies?.read?.presentations, 1);
  assert.equal(second?.toolFamilies?.read?.responses, 1);
  assert.equal(second?.toolFamilies?.read?.avgResponseLatencyMs, 1200);
  assert.equal(second?.sourceTrust?.["test-source"]?.low?.confirmations, 1);
  assert.equal(second?.consequenceProfiles?.low?.reviewedCount, 1);
  assert.deepEqual(await core.checkpointMemory(now), second);
  await core.reloadMarkdown();
  assert.deepEqual(core.snapshotMemoryProfile(now), second);

  // Updating the same terminal contribution adjusts it rather than adding it again.
  core.recordSignal({ ...signal, kind: "responded", responseKind: "rejected", latencyMs: 900 });
  const corrected = await core.checkpointMemory(now);
  assert.equal(corrected?.toolFamilies?.read?.presentations, 1);
  assert.equal(corrected?.toolFamilies?.read?.responses, 1);
  assert.equal(corrected?.toolFamilies?.read?.avgResponseLatencyMs, 900);
  assert.equal(corrected?.sourceTrust?.["test-source"]?.low?.confirmations, 0);
  assert.equal(corrected?.sourceTrust?.["test-source"]?.low?.disagreements, 1);
  assert.equal(corrected?.consequenceProfiles?.low?.rejectionRate, 1);
  const restarted = await ApertureCore.fromMarkdown(root);
  assert.equal(restarted.snapshotMemoryProfile(now).toolFamilies?.read?.responses, 1);
  assert.equal(restarted.snapshotMemoryProfile(now).sessionCount, 2);
});

test("memory accounting preserves uncheckpointed interactions beyond task and signal history retention", () => {
  const core = new ApertureCore();
  for (let index = 0; index < 300; index += 1) {
    core.recordSignal({
      kind: "responded",
      responseKind: "approved",
      taskId: "task:old",
      interactionId: `interaction:${index}`,
      timestamp: "2026-03-12T10:15:00.000Z",
      metadata: { toolFamily: "read", consequence: "low", sourceKey: "test-source" },
    });
  }
  core.recordSignal({
    kind: "responded",
    responseKind: "approved",
    taskId: "task:new",
    interactionId: "interaction:0",
    timestamp: "2026-03-15T10:15:00.000Z",
    metadata: { toolFamily: "read", consequence: "low", sourceKey: "test-source" },
  });
  assert.equal(core.getSignals("task:old").length, 0);
  const snapshot = core.snapshotMemoryProfile();
  assert.equal(snapshot.toolFamilies?.read?.responses, 301);
  assert.equal(snapshot.toolFamilies?.read?.presentations, 301);
  assert.equal(snapshot.sourceTrust?.["test-source"]?.low?.confirmations, 301);
  assert.equal(snapshot.consequenceProfiles?.low?.reviewedCount, 301);
});

test("concurrent checkpoints and reload serialize; failed persistence never consumes contributions", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-checkpoint-order-"));
  const writes: MemoryProfile[] = [];
  const operations: string[] = [];
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  const profileStore = {
    async saveMemoryProfile(profile: MemoryProfile) {
      operations.push("save");
      writes.push(structuredClone(profile));
      if (writes.length === 1) {
        await gate;
        throw new Error("persistence unavailable");
      }
    },
    async loadApertureProfile(fallback: Parameters<ProfileStore["loadApertureProfile"]>[0]) {
      return fallback;
    },
    async loadMemoryProfile(fallback: MemoryProfile) {
      operations.push("load");
      return structuredClone(writes.at(-1) ?? fallback);
    },
  } as unknown as ProfileStore;
  const core = new ApertureCore({ profileStore, markdownRootDir: root });
  const signal = {
    taskId: "task:concurrent",
    interactionId: "interaction:concurrent",
    timestamp: "2026-03-12T10:15:00.000Z",
    metadata: { toolFamily: "read", consequence: "low", sourceKey: "test-source" },
  };
  core.recordSignal({ ...signal, kind: "presented" });
  const failed = assert.rejects(core.checkpointMemory(), /persistence unavailable/);
  core.recordSignal({ ...signal, kind: "responded", responseKind: "approved", latencyMs: 1200 });
  const second = core.checkpointMemory();
  const reload = core.reloadMarkdown();
  const third = core.checkpointMemory();
  assert.deepEqual(operations, ["save"]);
  release();
  await failed;
  const saved = await second;
  assert.equal(await reload, true);
  const repeated = await third;
  assert.deepEqual(operations, ["save", "save", "load", "save"]);
  assert.equal(writes[0]?.toolFamilies?.read?.responses, 0);
  for (const profile of [saved, repeated, core.snapshotMemoryProfile()]) {
    assert.equal(profile?.sessionCount, 1);
    assert.equal(profile?.toolFamilies?.read?.presentations, 1);
    assert.equal(profile?.toolFamilies?.read?.responses, 1);
  }
  assert.equal(core.getSignals().length, 2);
  saved!.toolFamilies!.read!.responses = 999;
  assert.equal(core.snapshotMemoryProfile().toolFamilies?.read?.responses, 1);
});

test("successful concurrent saves include feedback arriving while the first save is pending", async () => {
  const { promise: gate, resolve: release } = Promise.withResolvers<void>();
  let saves = 0;
  const profileStore = {
    async saveMemoryProfile() {
      saves += 1;
      if (saves === 1) await gate;
    },
  } as unknown as ProfileStore;
  const core = new ApertureCore({ profileStore });
  const signal = {
    taskId: "task:partial",
    interactionId: "interaction:partial",
    timestamp: "2026-03-12T10:15:00.000Z",
    metadata: { toolFamily: "read", consequence: "low", sourceKey: "test-source" },
  };
  core.recordSignal({ ...signal, kind: "presented" });
  const first = core.checkpointMemory();
  core.recordSignal({ ...signal, kind: "dismissed", latencyMs: 100 });
  const second = core.checkpointMemory();
  assert.equal(saves, 1);
  release();
  assert.equal((await first)?.toolFamilies?.read?.dismissals, 0);
  const dismissed = await second;
  assert.equal(dismissed?.sessionCount, 1);
  assert.equal(dismissed?.toolFamilies?.read?.presentations, 1);
  assert.equal(dismissed?.toolFamilies?.read?.dismissals, 1);
  core.recordSignal({ ...signal, kind: "responded", responseKind: "approved", latencyMs: 200 });
  const answered = await core.checkpointMemory();
  assert.equal(answered?.toolFamilies?.read?.presentations, 1);
  assert.equal(answered?.toolFamilies?.read?.responses, 1);
  assert.equal(answered?.toolFamilies?.read?.dismissals, 0);
  assert.equal(answered?.toolFamilies?.read?.avgDismissalLatencyMs, undefined);
  assert.equal(answered?.sourceTrust?.["test-source"]?.low?.confirmations, 1);
  assert.equal(answered?.sourceTrust?.["test-source"]?.low?.disagreements, 0);
  assert.equal(core.getSignals().length, 3);
});

test("latency samples arriving after a checkpoint update their interaction without dilution", async () => {
  const profileStore = { async saveMemoryProfile() {} } as unknown as ProfileStore;
  const core = new ApertureCore({ profileStore });
  const signal = {
    kind: "responded" as const,
    responseKind: "approved" as const,
    taskId: "task:latency",
    timestamp: "2026-03-12T10:15:00.000Z",
    metadata: { toolFamily: "read" },
  };
  core.recordSignal({ ...signal, interactionId: "first" });
  core.recordSignal({ ...signal, interactionId: "second", latencyMs: 100 });
  const first = await core.checkpointMemory();
  assert.equal(first?.toolFamilies?.read?.responses, 2);
  assert.equal(first?.toolFamilies?.read?.avgResponseLatencyMs, 100);
  core.recordSignal({ ...signal, interactionId: "first", latencyMs: 200 });
  const second = await core.checkpointMemory();
  assert.equal(second?.toolFamilies?.read?.responses, 2);
  assert.equal(second?.toolFamilies?.read?.avgResponseLatencyMs, 150);
});

test("metadata corrections move one interaction before or after its first checkpoint", async (t) => {
  for (const checkpointBeforeCorrection of [false, true]) {
    await t.test(`checkpoint before correction: ${checkpointBeforeCorrection}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "aperture-memory-reclassification-"));
      const core = await ApertureCore.fromMarkdown(root);
      const now = "2026-03-12T10:16:00.000Z";
      const signal: AttentionSignal = {
        kind: "responded",
        responseKind: "approved",
        taskId: "task:corrected",
        interactionId: "interaction:corrected",
        timestamp: "2026-03-12T10:15:00.000Z",
        latencyMs: 1200,
        metadata: { toolFamily: "read", sourceKey: "original", consequence: "low" },
      };
      core.recordSignal({ ...signal, kind: "presented" });
      core.recordSignal({ ...signal, kind: "context_expanded" });
      core.recordSignal({ ...signal, kind: "deferred" });
      core.recordSignal({ ...signal, kind: "returned" });
      core.recordSignal(signal);
      if (checkpointBeforeCorrection) await core.checkpointMemory(now);

      const corrected: AttentionSignal = {
        ...signal,
        responseKind: "rejected",
        latencyMs: 900,
        metadata: { toolFamily: "command", sourceKey: "corrected", consequence: "high" },
      };
      core.recordSignal(corrected);
      core.recordSignal({ ...corrected, latencyMs: 600 });
      core.recordSignal({ ...corrected, kind: "dismissed", latencyMs: 50 });
      const saved = await core.checkpointMemory(now);
      assert.equal(saved?.sessionCount, 1);
      assert.equal(saved?.toolFamilies?.read?.presentations ?? 0, 0);
      assert.equal(saved?.toolFamilies?.read?.responses ?? 0, 0);
      assert.equal(saved?.toolFamilies?.read?.avgResponseLatencyMs, undefined);
      assert.equal(saved?.toolFamilies?.read?.returnAfterDeferralRate, undefined);
      assert.equal(saved?.sourceTrust?.original?.low?.confirmations ?? 0, 0);
      assert.equal(saved?.sourceTrust?.original?.low?.disagreements ?? 0, 0);
      assert.equal(saved?.consequenceProfiles?.low?.reviewedCount ?? 0, 0);
      assert.deepEqual(saved?.toolFamilies?.command, {
        presentations: 1,
        responses: 1,
        dismissals: 0,
        avgResponseLatencyMs: 600,
        contextExpansionRate: 1,
        returnAfterDeferralRate: 1,
      });
      assert.deepEqual(saved?.sourceTrust?.corrected?.high, {
        confirmations: 0,
        disagreements: 1,
        trustAdjustment: -2,
      });
      assert.deepEqual(saved?.consequenceProfiles?.high, { reviewedCount: 1, rejectionRate: 1 });
      assert.deepEqual(await core.checkpointMemory(now), saved);
      await core.reloadMarkdown();
      assert.deepEqual(core.snapshotMemoryProfile(now), saved);
      assert.deepEqual(await core.checkpointMemory(now), saved);
    });
  }
});

test("moving a session's last bucket contribution restores historical counts, latency and deferrals", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-memory-reclassification-last-"));
  const now = "2026-03-12T10:16:00.000Z";
  const signal: AttentionSignal = {
    kind: "responded",
    responseKind: "approved",
    taskId: "task:reused",
    interactionId: "interaction:reused",
    timestamp: now,
    latencyMs: 100,
    metadata: { toolFamily: "read", sourceKey: "original", consequence: "low" },
  };
  const historical = await ApertureCore.fromMarkdown(root);
  historical.recordSignal(signal);
  historical.recordSignal({ ...signal, kind: "deferred" });
  historical.recordSignal({ ...signal, kind: "returned" });
  const prior = await historical.checkpointMemory(now);

  const core = await ApertureCore.fromMarkdown(root);
  core.recordSignal({ ...signal, latencyMs: 300 });
  core.recordSignal({ ...signal, kind: "deferred" });
  const before = await core.checkpointMemory(now);
  assert.equal(before?.toolFamilies?.read?.responses, 2);
  assert.equal(before?.toolFamilies?.read?.avgResponseLatencyMs, 200);
  assert.equal(before?.toolFamilies?.read?.returnAfterDeferralRate, 0);
  core.recordSignal({
    ...signal,
    latencyMs: 500,
    responseKind: "rejected",
    metadata: { toolFamily: "command", sourceKey: "corrected", consequence: "high" },
  });
  const saved = await core.checkpointMemory(now);
  assert.equal(saved?.sessionCount, 2);
  assert.deepEqual(saved?.toolFamilies?.read, prior?.toolFamilies?.read);
  assert.deepEqual(saved?.sourceTrust?.original?.low, prior?.sourceTrust?.original?.low);
  assert.deepEqual(saved?.consequenceProfiles?.low, prior?.consequenceProfiles?.low);
  assert.equal(saved?.toolFamilies?.command?.responses, 1);
  assert.equal(saved?.toolFamilies?.command?.avgResponseLatencyMs, 500);
  assert.equal(saved?.toolFamilies?.command?.returnAfterDeferralRate, 0);
  assert.equal(saved?.sourceTrust?.corrected?.high?.disagreements, 1);
  assert.equal(saved?.consequenceProfiles?.high?.reviewedCount, 1);
  assert.deepEqual(await core.checkpointMemory(now), saved);
  await core.reloadMarkdown();
  assert.deepEqual(core.snapshotMemoryProfile(now), saved);
});

test("reclassification preserves historical buckets and both parts of interaction identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-memory-reclassification-history-"));
  const now = "2026-03-12T10:16:00.000Z";
  await new ProfileStore(root).saveMemoryProfile({
    version: 1,
    operatorId: "default",
    updatedAt: now,
    sessionCount: 2,
    toolFamilies: {
      read: {
        presentations: 4,
        responses: 3,
        dismissals: 1,
        avgResponseLatencyMs: 100,
        avgDismissalLatencyMs: 50,
        contextExpansionRate: 0.25,
      },
      command: { presentations: 2, responses: 2, dismissals: 0, avgResponseLatencyMs: 500 },
    },
    sourceTrust: {
      original: { low: { confirmations: 2, disagreements: 2, trustAdjustment: 0 } },
      corrected: { high: { confirmations: 2, disagreements: 0, trustAdjustment: 4 } },
    },
    consequenceProfiles: {
      low: { reviewedCount: 5, rejectionRate: 0.4 },
      high: { reviewedCount: 2, rejectionRate: 0 },
    },
  });
  const core = await ApertureCore.fromMarkdown(root);
  const signal: AttentionSignal = {
    kind: "responded",
    responseKind: "approved",
    taskId: "task:original",
    interactionId: "interaction:original",
    timestamp: now,
    latencyMs: 300,
    metadata: { toolFamily: "read", sourceKey: "original", consequence: "low" },
  };
  core.recordSignal(signal);
  core.recordSignal({ ...signal, interactionId: "interaction:unrelated", latencyMs: 500 });
  core.recordSignal({
    ...signal,
    taskId: "task:unrelated",
    responseKind: "rejected",
    latencyMs: 700,
  });
  await core.checkpointMemory(now);
  core.recordSignal({
    ...signal,
    responseKind: "rejected",
    latencyMs: 900,
    metadata: { toolFamily: "command", sourceKey: "corrected", consequence: "high" },
  });
  const saved = await core.checkpointMemory(now);
  assert.equal(saved?.sessionCount, 3);
  assert.equal(saved?.toolFamilies?.read?.presentations, 6);
  assert.equal(saved?.toolFamilies?.read?.responses, 5);
  assert.equal(saved?.toolFamilies?.read?.dismissals, 1);
  assert.equal(saved?.toolFamilies?.read?.avgResponseLatencyMs, 300);
  assert.equal(saved?.toolFamilies?.read?.avgDismissalLatencyMs, 50);
  assert.equal(saved?.toolFamilies?.command?.presentations, 3);
  assert.equal(saved?.toolFamilies?.command?.responses, 3);
  assert.equal(saved?.toolFamilies?.command?.avgResponseLatencyMs, 633);
  assert.deepEqual(saved?.sourceTrust?.original?.low, {
    confirmations: 3,
    disagreements: 3,
    trustAdjustment: 0,
  });
  assert.deepEqual(saved?.sourceTrust?.corrected?.high, {
    confirmations: 2,
    disagreements: 1,
    trustAdjustment: 2,
  });
  assert.deepEqual(saved?.consequenceProfiles?.low, { reviewedCount: 7, rejectionRate: 0.429 });
  assert.deepEqual(saved?.consequenceProfiles?.high, { reviewedCount: 3, rejectionRate: 0.333 });
  assert.deepEqual(await core.checkpointMemory(now), saved);
  await core.reloadMarkdown();
  assert.deepEqual(core.snapshotMemoryProfile(now), saved);
});

test("pending successful or failed saves account only their captured classifications", async (t) => {
  for (const failPendingSave of [false, true]) {
    await t.test(`pending save fails: ${failPendingSave}`, async () => {
      const root = await mkdtemp(join(tmpdir(), "aperture-memory-reclassification-save-"));
      const now = "2026-03-12T10:16:00.000Z";
      const { promise: gate, resolve: release } = Promise.withResolvers<void>();
      const { promise: saving, resolve: started } = Promise.withResolvers<void>();
      let saves = 0;
      class GatedProfileStore extends ProfileStore {
        override async saveMemoryProfile(profile: MemoryProfile): Promise<void> {
          saves += 1;
          if (saves === 2) {
            started();
            await gate;
            if (failPendingSave) throw new Error("persistence unavailable");
          }
          await super.saveMemoryProfile(profile);
        }
      }
      const store = new GatedProfileStore(root);
      const core = new ApertureCore({ profileStore: store });
      const signal: AttentionSignal = {
        kind: "dismissed",
        taskId: "task:pending",
        interactionId: "interaction:pending",
        timestamp: now,
        latencyMs: 100,
        metadata: { toolFamily: "read", sourceKey: "original", consequence: "low" },
      };
      core.recordSignal(signal);
      await core.checkpointMemory(now);
      core.recordSignal({
        ...signal,
        kind: "responded",
        responseKind: "approved",
        latencyMs: 300,
        metadata: { toolFamily: "command", sourceKey: "corrected", consequence: "high" },
      });
      const pending = core.checkpointMemory(now);
      const settled = failPendingSave
        ? assert.rejects(pending, /persistence unavailable/)
        : pending;
      await saving;
      core.recordSignal({
        ...signal,
        kind: "responded",
        responseKind: "rejected",
        latencyMs: 500,
        metadata: { toolFamily: "edit", sourceKey: "latest", consequence: "medium" },
      });
      const next = core.checkpointMemory(now);
      release();
      await settled;
      const saved = await next;
      assert.equal(saved?.sessionCount, 1);
      for (const family of ["read", "command"]) {
        assert.equal(saved?.toolFamilies?.[family]?.presentations ?? 0, 0);
        assert.equal(saved?.toolFamilies?.[family]?.responses ?? 0, 0);
        assert.equal(saved?.toolFamilies?.[family]?.dismissals ?? 0, 0);
        assert.equal(saved?.toolFamilies?.[family]?.avgResponseLatencyMs, undefined);
        assert.equal(saved?.toolFamilies?.[family]?.avgDismissalLatencyMs, undefined);
      }
      assert.equal(saved?.sourceTrust?.original?.low?.disagreements ?? 0, 0);
      assert.equal(saved?.sourceTrust?.corrected?.high?.confirmations ?? 0, 0);
      assert.equal(saved?.consequenceProfiles?.high?.reviewedCount ?? 0, 0);
      assert.deepEqual(saved?.toolFamilies?.edit, {
        presentations: 1,
        responses: 1,
        dismissals: 0,
        avgResponseLatencyMs: 500,
        contextExpansionRate: 0,
      });
      assert.deepEqual(saved?.sourceTrust?.latest?.medium, {
        confirmations: 0,
        disagreements: 1,
        trustAdjustment: -2,
      });
      assert.deepEqual(saved?.consequenceProfiles?.medium, { reviewedCount: 1, rejectionRate: 1 });
      assert.deepEqual(await core.checkpointMemory(now), saved);
      assert.deepEqual(await store.loadMemoryProfile(saved!), saved);
    });
  }
});

test("prototype-named memory identities remain own persisted entries without global mutation", async (t) => {
  const targets = [Object.prototype, Object, Object.prototype.toString];
  const descriptors = targets.map((target) => Object.getOwnPropertyDescriptor(target, "low"));
  t.after(() => {
    for (const [index, target] of targets.entries()) {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(target, "low", descriptor);
      else Reflect.deleteProperty(target, "low");
    }
  });
  const root = await mkdtemp(join(tmpdir(), "aperture-memory-prototype-"));
  const now = "2026-03-12T10:16:00.000Z";
  const identities = ["__proto__", "constructor", "toString"];
  for (const session of [1, 2]) {
    const core = await ApertureCore.fromMarkdown(root);
    for (const identity of identities) {
      core.recordSignal({
        kind: "responded",
        responseKind: "approved",
        taskId: `task:${session}`,
        interactionId: identity,
        timestamp: now,
        latencyMs: session * 100,
        metadata: { toolFamily: identity, sourceKey: identity, consequence: "low" },
      });
    }
    const saved = await core.checkpointMemory(now);
    assert.equal(saved?.sessionCount, session);
    for (const identity of identities) {
      assert.equal(Object.hasOwn(saved!.toolFamilies!, identity), true);
      assert.equal(Object.hasOwn(saved!.sourceTrust!, identity), true);
      assert.equal(Object.hasOwn(saved!.sourceTrust![identity]!, "low"), true);
      assert.equal(saved?.toolFamilies?.[identity]?.presentations, session);
      assert.equal(saved?.toolFamilies?.[identity]?.responses, session);
      assert.equal(
        saved?.toolFamilies?.[identity]?.avgResponseLatencyMs,
        session === 1 ? 100 : 150,
      );
      assert.equal(saved?.sourceTrust?.[identity]?.low?.confirmations, session);
    }
    assert.deepEqual(await core.checkpointMemory(now), saved);
    await core.reloadMarkdown();
    assert.deepEqual(core.snapshotMemoryProfile(now), saved);
    assert.deepEqual(
      targets.map((target) => Object.getOwnPropertyDescriptor(target, "low")),
      descriptors,
    );
  }
});
