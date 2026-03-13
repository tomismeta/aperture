import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadJudgmentConfig } from "../src/judgment-config.js";
import { parseFrontmatter, serializeFrontmatter } from "../src/markdown-frontmatter.js";
import { ProfileStore } from "../src/profile-store.js";

test("frontmatter codec round-trips JSON frontmatter inside markdown", () => {
  const content = serializeFrontmatter(
    {
      version: 1,
      operatorId: "default",
      updatedAt: "2026-03-12T10:15:00.000Z",
    },
    "Human-readable notes.",
  );

  const parsed = parseFrontmatter<{
    version: number;
    operatorId: string;
    updatedAt: string;
  }>(content);

  assert.deepEqual(parsed, {
    version: 1,
    operatorId: "default",
    updatedAt: "2026-03-12T10:15:00.000Z",
  });
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
  });

  const loaded = await store.loadMemoryProfile({
    version: 1,
    operatorId: "fallback",
    updatedAt: "1970-01-01T00:00:00.000Z",
    sessionCount: 0,
  });

  assert.equal(loaded.operatorId, "default");
  assert.equal(loaded.toolFamilies?.read?.avgResponseLatencyMs, 1800);

  const raw = await readFile(join(root, "MEMORY.md"), "utf8");
  assert.match(raw, /^---\n\{/);
});

test("judgment config loader reads JUDGMENT markdown frontmatter", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-judgment-config-"));
  const path = join(root, "JUDGMENT.md");
  const content = serializeFrontmatter(
    {
      version: 1,
      updatedAt: "2026-03-12T10:15:00.000Z",
      policy: {
        lowRiskRead: {
          mayInterrupt: false,
          minimumPresentation: "ambient",
        },
      },
    },
    "Explicit attention policy and guardrails.",
  );

  await writeFile(path, content, "utf8");

  const loaded = await loadJudgmentConfig(root, {
    version: 1,
    updatedAt: "1970-01-01T00:00:00.000Z",
  });

  assert.equal(loaded.policy?.lowRiskRead?.minimumPresentation, "ambient");
});
