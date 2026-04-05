import assert from "node:assert/strict";
import test from "node:test";

import {
  createOfflineReviewBatchReport,
  renderOfflineReviewBatchMarkdown,
  summarizeRecommendationItems,
  type OfflineReviewBatchEntry,
} from "../src/index.js";

test("offline review batch report aggregates counts across entries", () => {
  const entries: OfflineReviewBatchEntry[] = [
    {
      sessionId: "one",
      status: "disagreement",
      disagreementCount: 3,
      actionableCount: 2,
      reviewer: "openclaw",
      model: "gpt-5.4",
      requestPath: "/tmp/request-1.json",
      promptPath: "/tmp/prompt-1.md",
      rawResponsePath: "/tmp/raw-1.txt",
      responseArtifactPath: "/tmp/response-1.json",
      reportPath: "/tmp/report-1.json",
      recommendationPath: "/tmp/recommendation-1.json",
      runPath: "/tmp/run-1.json",
      focusAreaCounts: {
        title: 0,
        summary: 0,
        status: 0,
        ask: 0,
        intentFrame: 2,
        toolFamily: 0,
        consequence: 1,
        blocking: 0,
        episode: 0,
        confidence: 0,
        source: 0,
      },
      recommendationCounts: {
        promote: 2,
        inspect: 1,
        ignore: 0,
      },
      topRecommendations: [
        {
          focusArea: "intentFrame",
          disagreementCount: 2,
          recommendation: "promote",
          owner: "semantic",
          summary: "Tighten intent-frame reads.",
        },
      ],
    },
    {
      sessionId: "two",
      status: "clean",
      disagreementCount: 0,
      actionableCount: 0,
      reviewer: "openclaw",
      model: "gpt-5.4",
      requestPath: "/tmp/request-2.json",
      promptPath: "/tmp/prompt-2.md",
      rawResponsePath: "/tmp/raw-2.txt",
      responseArtifactPath: "/tmp/response-2.json",
      reportPath: "/tmp/report-2.json",
      recommendationPath: "/tmp/recommendation-2.json",
      runPath: "/tmp/run-2.json",
      focusAreaCounts: {
        title: 0,
        summary: 0,
        status: 0,
        ask: 0,
        intentFrame: 0,
        toolFamily: 0,
        consequence: 0,
        blocking: 0,
        episode: 0,
        confidence: 0,
        source: 0,
      },
      recommendationCounts: {
        promote: 0,
        inspect: 0,
        ignore: 0,
      },
      topRecommendations: [],
    },
    {
      sessionId: "three",
      status: "error",
      disagreementCount: 0,
      actionableCount: 0,
      error: "Reviewer returned malformed JSON.",
      focusAreaCounts: {
        title: 0,
        summary: 0,
        status: 0,
        ask: 0,
        intentFrame: 0,
        toolFamily: 0,
        consequence: 0,
        blocking: 0,
        episode: 0,
        confidence: 0,
        source: 0,
      },
      recommendationCounts: {
        promote: 0,
        inspect: 0,
        ignore: 0,
      },
      topRecommendations: [],
    },
  ];

  const report = createOfflineReviewBatchReport(entries, {
    reviewerCommand: "pnpm lab:fstop:reviewer --provider openclaw",
    reviewerProvider: "openclaw",
    dataset: "swe-smith",
    split: "tool",
    limit: 3,
    imported: true,
    bundles: ["/tmp/one.json", "/tmp/two.json", "/tmp/three.json"],
    generatedAt: "2026-03-28T00:00:00.000Z",
  });

  assert.equal(report.summary.bundleCount, 3);
  assert.equal(report.summary.statusCounts.disagreement, 1);
  assert.equal(report.summary.statusCounts.clean, 1);
  assert.equal(report.summary.statusCounts.error, 1);
  assert.equal(report.summary.disagreementCount, 3);
  assert.equal(report.summary.actionableCount, 2);
  assert.equal(report.summary.focusAreaCounts.intentFrame, 2);
  assert.equal(report.summary.focusAreaCounts.consequence, 1);
  assert.equal(report.summary.recommendationCounts.promote, 2);
});

test("offline review batch markdown renders a compact summary", () => {
  const markdown = renderOfflineReviewBatchMarkdown(createOfflineReviewBatchReport([], {
    reviewerCommand: "pnpm lab:fstop:reviewer --provider openclaw",
    reviewerProvider: "openclaw",
    imported: false,
    bundles: [],
    generatedAt: "2026-03-28T00:00:00.000Z",
  }));

  assert.match(markdown, /Offline Review Batch/);
  assert.match(markdown, /Reviewer: openclaw/);
  assert.match(markdown, /- error: 0/);
});

test("summarizeRecommendationItems sorts by disagreement count", () => {
  const items = summarizeRecommendationItems([
    {
      focusArea: "consequence",
      owner: "semantic",
      targets: [],
      recommendation: "inspect",
      disagreementCount: 1,
      confidenceCounts: { high: 0, medium: 1, low: 0 },
      summary: "one",
      examples: [],
    },
    {
      focusArea: "intentFrame",
      owner: "semantic",
      targets: [],
      recommendation: "promote",
      disagreementCount: 4,
      confidenceCounts: { high: 4, medium: 0, low: 0 },
      summary: "two",
      examples: [],
    },
  ]);

  assert.equal(items[0]?.focusArea, "intentFrame");
  assert.equal(items[1]?.focusArea, "consequence");
});
