import type { ReplayScenario } from "./scenario.js";
import { runReplayScenario, type ReplayRunResult } from "./runner.js";
import { scoreReplayRun, type ReplayScorecard } from "./scorecard.js";
import { loadGoldenScenarios } from "./golden.js";

export type JudgmentBenchScenarioResult = {
  scenario: ReplayScenario;
  run: ReplayRunResult;
  scorecard: ReplayScorecard;
};

export type JudgmentBenchRun = {
  benchmark: "JudgmentBench";
  generatedAt: string;
  scenarios: JudgmentBenchScenarioResult[];
  summary: {
    totalScenarios: number;
    totalCandidates: number;
    totalActivated: number;
    totalQueued: number;
    totalAmbient: number;
    totalResponses: number;
    totalPresentedSignals: number;
  };
};

export async function runJudgmentBench(
  scenarios?: ReplayScenario[],
): Promise<JudgmentBenchRun> {
  const loadedScenarios = scenarios ?? await loadGoldenScenarios();
  const results = loadedScenarios.map((scenario) => {
    const run = runReplayScenario(scenario);
    const scorecard = scoreReplayRun(run);

    return {
      scenario,
      run,
      scorecard,
    };
  });

  return {
    benchmark: "JudgmentBench",
    generatedAt: new Date().toISOString(),
    scenarios: results,
    summary: {
      totalScenarios: results.length,
      totalCandidates: sum(results.map((result) => result.scorecard.trace.totalCandidates)),
      totalActivated: sum(results.map((result) => result.scorecard.trace.activated)),
      totalQueued: sum(results.map((result) => result.scorecard.trace.queued)),
      totalAmbient: sum(results.map((result) => result.scorecard.trace.ambient)),
      totalResponses: sum(results.map((result) => result.run.responses.length)),
      totalPresentedSignals: sum(results.map((result) => result.scorecard.signals.presented)),
    },
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
