import assert from "node:assert/strict";
import test from "node:test";

import { renderJudgmentBenchMarkdown, runJudgmentBench, type ReplayScenario } from "../src/index.js";

test("JudgmentBench markdown report includes score and doctrine health", async () => {
  const result = await runJudgmentBench();
  const markdown = renderJudgmentBenchMarkdown(result);

  assert.match(markdown, /# JudgmentBench Summary/);
  assert.match(markdown, /Benchmark score: \*\*/);
  assert.match(markdown, /## Doctrine Health/);
  assert.match(markdown, /## Semantic Health/);
  assert.match(markdown, /interruption_credibility/);
  assert.match(markdown, /episode_missed/);
  assert.match(markdown, /Semantic readings:/);
  assert.match(markdown, /Semantic families:/);
  assert.match(markdown, /Decision readings:/);
  assert.match(markdown, /Ambiguous decisions:/);
  assert.match(markdown, /Ambiguous next -> now:/);
  assert.match(markdown, /Ambiguity trace:/);
  assert.match(markdown, /Semantic \(/);
  assert.match(markdown, /Semantic ontology \(/);
  assert.match(markdown, /Decision \(/);
  assert.match(markdown, /Decision ambiguity \(/);
  assert.match(markdown, /Why headline:/);
  assert.match(markdown, /Why target:/);
});

test("JudgmentBench markdown report includes workflow footprint when scenarios carry workflow metadata", async () => {
  const scenarios: ReplayScenario[] = [
    {
      id: "bench:workflow",
      title: "Workflow metadata bench",
      steps: [
        {
          kind: "publish",
          event: {
            id: "evt:workflow:approval",
            taskId: "task:workflow:approval",
            timestamp: "2026-04-23T20:00:00.000Z",
            type: "human.input.requested",
            interactionId: "interaction:workflow:approval",
            title: "Approve maintenance",
            summary: "Scheduled maintenance needs approval.",
            consequence: "high",
            request: { kind: "approval" },
            metadata: {
              automation: {
                runMode: "scheduled",
              },
              execution: {
                surface: "terminal",
                runner: "claude-code",
                placement: "cloud",
              },
              governance: {
                approvalState: "pending",
              },
              usage: {
                model: "gpt-5.4",
                inputTokens: 800,
                outputTokens: 120,
                costUsd: 0.08,
              },
            },
          },
        },
      ],
    },
  ];

  const result = await runJudgmentBench(scenarios);
  const markdown = renderJudgmentBenchMarkdown(result);

  assert.match(markdown, /Workflow execution:/);
  assert.match(markdown, /automation=scheduled/);
  assert.match(markdown, /runners=claude-code/);
  assert.match(markdown, /models=gpt-5.4/);
  assert.match(markdown, /Workflow usage: input=800, output=120, cost=\$0.08/);
});
