import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { formatConfigReport, inspectApertureConfig } from "../src/cli/config.js";

test("config report shows parsed preferences, diagnostics, and learned suggestions", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-config-report-"));
  await writeFile(
    join(root, "APERTURE.md"),
    [
      "# Aperture",
      "",
      "## Meta",
      "- version: 1",
      "- profile id: default",
      "- updated at: 2026-05-08T12:00:00.000Z",
      "",
      "## Preferences",
      "- control mode: standard",
      "- mystery toggle: yes",
      "",
      "## Policy",
      "",
      "### lowRiskRead",
      "- may interrupt: true",
      "- minimum lane: now",
      "",
      "### typoRule",
      "- auto approve: true",
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
      "- profile id: default",
      "- updated at: 2026-05-08T12:00:00.000Z",
      "- session count: 4",
      "",
      "## Tool Families",
      "",
      "### read",
      "- presentations: 6",
      "- responses: 6",
      "- dismissals: 0",
      "",
      "## Consequence Profiles",
      "",
      "### low",
      "- rejection rate: 0",
      "- reviewed count: 6",
      "",
    ].join("\n"),
    "utf8",
  );

  const report = await inspectApertureConfig(root);
  const output = formatConfigReport(report);

  assert.equal(report.profile.preferences?.controlMode, "standard");
  assert.match(output, /control mode: standard/);
  assert.match(output, /lowRiskRead: may interrupt true · minimum lane now/);
  assert.match(output, /Consider auto-approving lowRiskRead/);
  assert.match(output, /### lowRiskRead[\s\S]*- auto approve: true/);
  assert.match(output, /Unknown preference "mystery toggle"/);
  assert.match(output, /Unknown policy rule "typoRule"/);
});
