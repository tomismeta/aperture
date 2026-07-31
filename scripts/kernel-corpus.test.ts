import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildKernelCorpusConformanceReport,
  buildKernelCorpusScorecard,
  loadGoldenScenarios,
  parseKernelCorpusScorecard,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/index.js";
import { runKernelCorpusCommand } from "./kernel-corpus.ts";

test("kernel corpus write compares scorecard baselines unless override is explicit", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-kernel-corpus-"));
  try {
    const reportPath = join(root, "kernel-corpus-v2.json");
    const scorecardPath = join(root, "kernel-corpus-scorecard-v2.json");
    const scenarios = await loadGoldenScenarios();
    const report = await buildKernelCorpusConformanceReport(scenarios);
    const scorecard = buildKernelCorpusScorecard(report, scenarios);
    const stricterBaseline = {
      ...scorecard,
      summary: {
        ...scorecard.summary,
        assertions: {
          ...scorecard.summary.assertions,
          total: scorecard.summary.assertions.total + 1,
        },
      },
    };

    await writeFile(scorecardPath, `${serializeKernelCanonicalJson(stricterBaseline)}\n`, "utf8");

    await assert.rejects(
      () => runKernelCorpusCommand({ args: ["--write"], reportPath, scorecardPath }),
      /scorecard comparison failed/,
    );

    await runKernelCorpusCommand({
      args: ["--write", "--allow-scorecard-regression"],
      reportPath,
      scorecardPath,
    });

    const writtenScorecard = parseKernelCorpusScorecard(await readFile(scorecardPath, "utf8"));
    assert.equal(writtenScorecard.summary.assertions.total, scorecard.summary.assertions.total);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("kernel corpus write requires an existing scorecard baseline by default", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-kernel-corpus-"));
  try {
    await assert.rejects(
      () =>
        runKernelCorpusCommand({
          args: ["--write"],
          reportPath: join(root, "kernel-corpus-v2.json"),
          scorecardPath: join(root, "missing-scorecard.json"),
        }),
      /scorecard baseline is missing/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
