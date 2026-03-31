import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultAutoresearchRunnerRunPath,
  renderAutoresearchRunnerRunMarkdown,
  type AutoresearchRunnerRun,
} from "../src/index.js";

test("renderAutoresearchRunnerRunMarkdown summarizes the sequential run clearly", () => {
  const run: AutoresearchRunnerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    provider: "openclaw",
    runnerCommand: "deterministic sequential slice loop",
    status: "proposal_ready",
    artifacts: {
      selectedProposalPath: ".aperture/lab/results/autoresearch/proposals/example.json",
      selectedBatchReportPath: ".aperture/lab/results/offline-review/batches/example.json",
      selectedOptimizerRunPath: ".aperture/lab/results/autoresearch/optimizer/runs/example.json",
      selectedPatchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
    },
    feedback: {
      action: "proposal_ready",
      summary: "Found a proposal on the first patch-producing slice.",
      reasons: ["Offset 24 produced a durable patch artifact."],
      commandsRun: [
        "pnpm lab:fstop:propose --dataset swe-smith --split tool --offset 24 --limit 12 --json",
      ],
      attempts: [
        {
          offset: 24,
          limit: 12,
          status: "proposed",
          proposalPath: ".aperture/lab/results/autoresearch/proposals/example.json",
          optimizerPatchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
        },
      ],
      selectedProposalPath: ".aperture/lab/results/autoresearch/proposals/example.json",
      selectedPatchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
    },
    notes: ["Sequential slice loop stopped after the first successful patch."],
  };

  const markdown = renderAutoresearchRunnerRunMarkdown(run);

  assert.match(markdown, /Aperture Lab F-Stop Run/);
  assert.match(markdown, /Execution: deterministic sequential slice loop/);
  assert.match(markdown, /Status: proposal_ready/);
  assert.match(markdown, /selected proposal/);
  assert.match(markdown, /Commands/);
  assert.match(markdown, /example\.diff/);
  assert.match(markdown, /Sequential slice loop stopped after the first successful patch/);
});

test("renderAutoresearchRunnerRunMarkdown retains intent for no-proposal runs", () => {
  const run: AutoresearchRunnerRun = {
    schemaVersion: 1,
    generatedAt: "2026-03-28T00:00:00.000Z",
    provider: "hermes",
    runnerCommand: "deterministic sequential slice loop",
    status: "no_proposal",
    artifacts: {},
    selectedProposal: {
      status: "no_change",
      summary: {
        actionableCount: 14,
        selectedSignalCount: 2,
        promotedCaseCount: 3,
      },
      signals: [
        {
          signature: "consequence|semantic|high|low|semantic-interpreter",
          focusArea: "consequence",
          owner: "semantic",
          apertureValue: "high",
          expectedValue: "low",
          sessionCount: 3,
          disagreementCount: 4,
          targets: ["packages/core/src/semantic-interpreter.ts"],
          examples: [
            {
              sessionId: "session-a",
              stepIndex: 12,
              confidence: "high",
            },
          ],
        },
      ],
      intentStatements: [
        {
          focusArea: "consequence",
          owner: "semantic",
          statement: "Lower consequence when observational tool failures still preserve strong evidence.",
          apertureValue: "high",
          expectedValue: "low",
          sessionCount: 3,
          disagreementCount: 4,
          targets: ["packages/core/src/semantic-interpreter.ts"],
        },
      ],
      codeRecommendations: [
        {
          kind: "intent_only",
          summary: "Narrow observational failure semantics before planner scoring runs.",
          recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
          reasons: ["Repeated promote signal across held-out sessions."],
          targets: ["packages/core/src/semantic-interpreter.ts"],
        },
      ],
      optimizer: {
        status: "no_change",
        beforeMismatchCount: 4,
        afterMismatchCount: 4,
        beforeInvariantMismatchCount: 0,
        afterInvariantMismatchCount: 0,
        changedFiles: ["packages/core/src/semantic-interpreter.ts"],
        disallowedFiles: [],
        patchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
      },
    },
    retainedAttempts: [
      {
        offset: 126,
        limit: 6,
        status: "no_change",
        actionableCount: 14,
        selectedSignalCount: 2,
        promotedCaseCount: 3,
        optimizerStatus: "no_change",
        retainedOutcome: "no_change_patch_attempted",
        patch: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
        snapshot: {
          status: "no_change",
          summary: {
            actionableCount: 14,
            selectedSignalCount: 2,
            promotedCaseCount: 3,
          },
          signals: [
            {
              signature: "consequence|semantic|high|low|semantic-interpreter",
              focusArea: "consequence",
              owner: "semantic",
              apertureValue: "high",
              expectedValue: "low",
              sessionCount: 3,
              disagreementCount: 4,
              targets: ["packages/core/src/semantic-interpreter.ts"],
              examples: [
                {
                  sessionId: "session-a",
                  stepIndex: 12,
                  confidence: "high",
                },
              ],
            },
          ],
          intentStatements: [
            {
              focusArea: "consequence",
              owner: "semantic",
              statement: "Lower consequence when observational tool failures still preserve strong evidence.",
              apertureValue: "high",
              expectedValue: "low",
              sessionCount: 3,
              disagreementCount: 4,
              targets: ["packages/core/src/semantic-interpreter.ts"],
            },
          ],
          codeRecommendations: [
            {
              kind: "intent_only",
              summary: "Narrow observational failure semantics before planner scoring runs.",
              recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
              reasons: ["Repeated promote signal across held-out sessions."],
              targets: ["packages/core/src/semantic-interpreter.ts"],
            },
          ],
          optimizer: {
            status: "no_change",
            beforeMismatchCount: 4,
            afterMismatchCount: 4,
            beforeInvariantMismatchCount: 0,
            afterInvariantMismatchCount: 0,
            changedFiles: ["packages/core/src/semantic-interpreter.ts"],
            disallowedFiles: [],
            patchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
          },
        },
      },
    ],
    feedback: {
      action: "no_proposal",
      summary: "Exhausted the slice budget without finding a proposal patch artifact.",
      reasons: ["Highest-signal retained slice offset 126 ended status=no_change with 2 signal(s) and 3 promoted case(s)."],
      commandsRun: [],
      attempts: [
        {
          offset: 126,
          limit: 6,
          status: "no_change",
          actionableCount: 14,
          selectedSignalCount: 2,
          promotedCaseCount: 3,
          optimizerStatus: "no_change",
          proposal: {
            status: "no_change",
            summary: {
              actionableCount: 14,
              selectedSignalCount: 2,
              promotedCaseCount: 3,
            },
            signals: [
              {
                signature: "consequence|semantic|high|low|semantic-interpreter",
                focusArea: "consequence",
                owner: "semantic",
                apertureValue: "high",
                expectedValue: "low",
                sessionCount: 3,
                disagreementCount: 4,
                targets: ["packages/core/src/semantic-interpreter.ts"],
                examples: [
                  {
                    sessionId: "session-a",
                    stepIndex: 12,
                    confidence: "high",
                  },
                ],
              },
            ],
            intentStatements: [
              {
                focusArea: "consequence",
                owner: "semantic",
                statement: "Lower consequence when observational tool failures still preserve strong evidence.",
                apertureValue: "high",
                expectedValue: "low",
                sessionCount: 3,
                disagreementCount: 4,
                targets: ["packages/core/src/semantic-interpreter.ts"],
              },
            ],
            codeRecommendations: [
              {
                kind: "intent_only",
                summary: "Narrow observational failure semantics before planner scoring runs.",
                recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
                reasons: ["Repeated promote signal across held-out sessions."],
                targets: ["packages/core/src/semantic-interpreter.ts"],
              },
            ],
            optimizer: {
              status: "no_change",
              beforeMismatchCount: 4,
              afterMismatchCount: 4,
              beforeInvariantMismatchCount: 0,
              afterInvariantMismatchCount: 0,
              changedFiles: ["packages/core/src/semantic-interpreter.ts"],
              disallowedFiles: [],
              patchPath: ".aperture/lab/results/autoresearch/optimizer/patches/example.diff",
            },
          },
        },
      ],
      recommendedNextStep: "Inspect the highest-signal no_change slices before expanding the slice budget.",
    },
    notes: ["Retained the highest-signal non-winning slice intent for later review."],
  };

  const markdown = renderAutoresearchRunnerRunMarkdown(run);

  assert.match(markdown, /Status: no_proposal/);
  assert.match(markdown, /Retained Intent/);
  assert.match(markdown, /Retained Attempts/);
  assert.match(markdown, /Lower consequence when observational tool failures still preserve strong evidence/);
  assert.match(markdown, /Narrow observational failure semantics before planner scoring runs/);
  assert.match(markdown, /no_change_patch_attempted/);
});

test("defaultAutoresearchRunnerRunPath writes run artifacts under the runner runs dir", () => {
  const filePath = defaultAutoresearchRunnerRunPath("2026-03-28T00:00:00.000Z");
  assert.match(filePath, /\.aperture\/lab\/results\/autoresearch\/runner\/runs\/autoresearch-runner-run-2026-03-28T00-00-00-000Z\.json$/);
});
