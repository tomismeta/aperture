import assert from "node:assert/strict";
import test from "node:test";

import { renderJudgmentBenchMarkdown, runJudgmentBench } from "../src/index.js";

test("JudgmentBench markdown report includes score and doctrine health", async () => {
  const result = await runJudgmentBench();
  const markdown = renderJudgmentBenchMarkdown(result);

  assert.match(markdown, /# JudgmentBench Summary/);
  assert.match(markdown, /Benchmark score: \*\*/);
  assert.match(markdown, /## Doctrine Health/);
  assert.match(markdown, /interruption_credibility/);
});
