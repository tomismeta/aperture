import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultAutoresearchRetainedBacklogMarkdownPath,
  loadAutoresearchRetainedBacklog,
  updateAutoresearchRetainedBacklog,
  type AutoresearchRunnerRun,
} from "../src/index.js";

function createRun(options: {
  generatedAt: string;
  provider: "openclaw" | "hermes";
  retainedOutcome: "no_change_patch_attempted" | "signal_only";
  optimizerStatus?: "no_change";
  patchPath?: string;
}): AutoresearchRunnerRun {
  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    provider: options.provider,
    runnerCommand: "deterministic sequential slice loop",
    status: "no_proposal",
    artifacts: {},
    selectedProposal: {
      status: "no_change",
      summary: {
        actionableCount: 11,
        selectedSignalCount: 1,
        promotedCaseCount: 2,
      },
      signals: [
        {
          signature: "consequence|semantic|low|medium|semantic-interpreter",
          focusArea: "consequence",
          owner: "semantic",
          apertureValue: "low",
          expectedValue: "medium",
          sessionCount: 2,
          disagreementCount: 3,
          targets: ["packages/core/src/semantic-interpreter.ts"],
          examples: [
            {
              sessionId: "session-a",
              stepIndex: 19,
              stepLabel: "trajectory submitted",
              confidence: "high",
              rationale: "Unresolved completion should not stay low consequence.",
            },
          ],
        },
      ],
      intentStatements: [
        {
          focusArea: "consequence",
          owner: "semantic",
          statement: "Raise unresolved completion consequence from low to medium.",
          apertureValue: "low",
          expectedValue: "medium",
          sessionCount: 2,
          disagreementCount: 3,
          targets: ["packages/core/src/semantic-interpreter.ts"],
        },
      ],
      codeRecommendations: [
        {
          kind: "patch",
          summary: "Narrow completion consequence inference for unresolved endings.",
          recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
          reasons: ["Repeated high-confidence disagreement."],
          targets: ["packages/core/src/semantic-interpreter.ts"],
          ...(options.patchPath ? { patchPath: options.patchPath } : {}),
          ...(options.optimizerStatus ? { optimizerStatus: options.optimizerStatus } : {}),
          beforeMismatchCount: 3,
          afterMismatchCount: 3,
        },
      ],
      ...(options.optimizerStatus
        ? {
            optimizer: {
              status: options.optimizerStatus,
              beforeMismatchCount: 3,
              afterMismatchCount: 3,
              beforeInvariantMismatchCount: 0,
              afterInvariantMismatchCount: 0,
              changedFiles: ["packages/core/src/semantic-interpreter.ts"],
              disallowedFiles: [],
              ...(options.patchPath ? { patchPath: options.patchPath } : {}),
            },
          }
        : {}),
    },
    retainedAttempts: [
      {
        offset: 6,
        limit: 6,
        status: "no_change",
        actionableCount: 11,
        selectedSignalCount: 1,
        promotedCaseCount: 2,
        ...(options.optimizerStatus ? { optimizerStatus: options.optimizerStatus } : {}),
        retainedOutcome: options.retainedOutcome,
        ...(options.patchPath ? { patch: options.patchPath } : {}),
        snapshot: {
          status: "no_change",
          summary: {
            actionableCount: 11,
            selectedSignalCount: 1,
            promotedCaseCount: 2,
          },
          signals: [
            {
              signature: "consequence|semantic|low|medium|semantic-interpreter",
              focusArea: "consequence",
              owner: "semantic",
              apertureValue: "low",
              expectedValue: "medium",
              sessionCount: 2,
              disagreementCount: 3,
              targets: ["packages/core/src/semantic-interpreter.ts"],
              examples: [
                {
                  sessionId: "session-a",
                  stepIndex: 19,
                  stepLabel: "trajectory submitted",
                  confidence: "high",
                  rationale: "Unresolved completion should not stay low consequence.",
                },
              ],
            },
          ],
          intentStatements: [
            {
              focusArea: "consequence",
              owner: "semantic",
              statement: "Raise unresolved completion consequence from low to medium.",
              apertureValue: "low",
              expectedValue: "medium",
              sessionCount: 2,
              disagreementCount: 3,
              targets: ["packages/core/src/semantic-interpreter.ts"],
            },
          ],
          codeRecommendations: [
            {
              kind: "patch",
              summary: "Narrow completion consequence inference for unresolved endings.",
              recommendedFiles: ["packages/core/src/semantic-interpreter.ts"],
              reasons: ["Repeated high-confidence disagreement."],
              targets: ["packages/core/src/semantic-interpreter.ts"],
              ...(options.patchPath ? { patchPath: options.patchPath } : {}),
              ...(options.optimizerStatus ? { optimizerStatus: options.optimizerStatus } : {}),
              beforeMismatchCount: 3,
              afterMismatchCount: 3,
            },
          ],
          ...(options.optimizerStatus
            ? {
                optimizer: {
                  status: options.optimizerStatus,
                  beforeMismatchCount: 3,
                  afterMismatchCount: 3,
                  beforeInvariantMismatchCount: 0,
                  afterInvariantMismatchCount: 0,
                  changedFiles: ["packages/core/src/semantic-interpreter.ts"],
                  disallowedFiles: [],
                  ...(options.patchPath ? { patchPath: options.patchPath } : {}),
                },
              }
            : {}),
        },
      },
    ],
    feedback: {
      action: "no_proposal",
      summary: "Exhausted without a durable patch.",
      reasons: [],
      commandsRun: [],
      attempts: [],
    },
    notes: [],
  };
}

test("updateAutoresearchRetainedBacklog compounds repeated retained signals across runs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "aperture-retained-backlog-"));
  const backlogPath = path.join(root, "autoresearch-retained-backlog.json");
  const patchPath = ".aperture/lab/results/autoresearch/optimizer/patches/example.diff";

  const first = await updateAutoresearchRetainedBacklog({
    run: createRun({
      generatedAt: "2026-03-31T19:42:25.327Z",
      provider: "openclaw",
      retainedOutcome: "no_change_patch_attempted",
      optimizerStatus: "no_change",
      patchPath,
    }),
    runPath: ".aperture/lab/results/autoresearch/runner/runs/run-1.json",
    runMarkdownPath: ".aperture/lab/results/autoresearch/runner/runs/run-1.md",
    outputPath: backlogPath,
  });

  const second = await updateAutoresearchRetainedBacklog({
    run: createRun({
      generatedAt: "2026-03-31T20:42:25.327Z",
      provider: "hermes",
      retainedOutcome: "signal_only",
    }),
    runPath: ".aperture/lab/results/autoresearch/runner/runs/run-2.json",
    runMarkdownPath: ".aperture/lab/results/autoresearch/runner/runs/run-2.md",
    outputPath: backlogPath,
  });

  assert.equal(first.backlog.entryCount, 1);
  assert.equal(second.backlog.entryCount, 1);

  const backlog = await loadAutoresearchRetainedBacklog(backlogPath);
  assert.ok(backlog);
  assert.equal(backlog.entries.length, 1);

  const entry = backlog.entries[0]!;
  assert.equal(entry.key, "consequence|semantic|low|medium|semantic-interpreter");
  assert.equal(entry.occurrenceCount, 2);
  assert.equal(entry.runCount, 2);
  assert.equal(entry.patchAttemptCount, 1);
  assert.equal(entry.latestProvider, "hermes");
  assert.equal(entry.latestRetainedOutcome, "signal_only");
  assert.equal(entry.latestIntentStatements[0]?.statement, "Raise unresolved completion consequence from low to medium.");
  assert.equal(entry.examples[0]?.sessionId, "session-a");
  assert.equal(entry.recentOccurrences.length, 2);

  const markdown = await readFile(defaultAutoresearchRetainedBacklogMarkdownPath(backlogPath), "utf8");
  assert.match(markdown, /Aperture Lab Proposal Brief/);
  assert.match(markdown, /What The Change Would Do/);
  assert.match(markdown, /Latest Optimizer Result/);
  assert.match(markdown, /occurrences: 2 across 2 run\(s\)/);
  assert.match(markdown, /Raise unresolved completion consequence from low to medium/);
});
