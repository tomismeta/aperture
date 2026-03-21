export { loadGoldenScenarios, DEFAULT_GOLDEN_SCENARIOS_DIR } from "./golden.js";
export { compareScenarioDeterminism, normalizeReplayRun, runDeterminismAudit } from "./determinism.js";
export { runJudgmentBench } from "./judgment-bench.js";
export {
  DEFAULT_PERTURBATION_PROFILES,
  generatePerturbedSemanticScenarios,
  loadPerturbedSemanticScenarios,
  runPerturbedJudgmentBench,
} from "./perturbation.js";
export { renderJudgmentBenchMarkdown } from "./report.js";
export { runReplayScenario } from "./runner.js";
export { scoreReplayRun } from "./scorecard.js";

export type {
  DeterminismAuditRun,
  DeterminismScenarioResult,
  NormalizedReplayRun,
} from "./determinism.js";
export type {
  ReplayDecisionExpectation,
  ReplayDecisionSnapshot,
  ReplayScenario,
  ReplayObservationStep,
  ReplaySemanticExpectation,
  ReplaySemanticSnapshot,
  ReplayScenarioExpectations,
  ReplayViewSnapshot,
} from "./scenario.js";
export type {
  ReplayRunResult,
  ReplayStepResult,
} from "./runner.js";
export type { ReplayExplanationSnapshot, ReplayScorecard } from "./scorecard.js";
export type {
  JudgmentBenchAssertionResult,
  JudgmentBenchDoctrineHealth,
  JudgmentBenchRun,
  JudgmentBenchScenarioResult,
} from "./judgment-bench.js";
export type { ScenarioPerturbationProfile } from "./perturbation.js";
