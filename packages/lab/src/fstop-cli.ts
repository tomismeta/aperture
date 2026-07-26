import {
  runCampaignCli,
  runOptimizeCli,
  runRoleCli,
  runRunCli,
  runServiceCli,
  runSweepCli,
} from "./fstop-cli-autoresearch.js";
import { runGcCli } from "./fstop-cli-gc.js";
import { runIngestCli, runTrajectoryImportCli } from "./fstop-cli-ingest.js";
import { runCorpusPruneCli, runCorpusRunCli } from "./fstop-cli-corpus.js";
import { runCalibrationCli, runReviewCli } from "./fstop-cli-review.js";
import { runReviewCandidatesCli } from "./fstop-cli-review-candidates.js";
import { runWorkflowSummaryCli } from "./fstop-cli-summary.js";
import { printTopLevelUsage } from "./fstop-cli-usage.js";

export async function runFStopCli(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case "run":
      await runRunCli(rest);
      return;
    case "campaign":
      await runCampaignCli(rest);
      return;
    case "service":
      await runServiceCli(rest);
      return;
    case "sweep":
      await runSweepCli(rest);
      return;
    case "ingest":
      await runIngestCli(rest);
      return;
    case "workflow-summary":
      await runWorkflowSummaryCli(rest);
      return;
    case "review-candidates":
      await runReviewCandidatesCli(rest);
      return;
    case "optimize":
      await runOptimizeCli(rest);
      return;
    case "gc":
      await runGcCli(rest);
      return;
    case "prepare":
    case "prompt":
    case "compare":
    case "review-run":
      await runReviewCli(command, rest);
      return;
    case "promote":
    case "evaluate":
    case "cycle":
      await runCalibrationCli(command, rest);
      return;
    case "reviewer":
    case "optimizer":
      await runRoleCli(command, rest);
      return;
    case "trajectory-import":
      await runTrajectoryImportCli(rest);
      return;
    case "corpus-run":
    case "corpus":
      await runCorpusRunCli(rest);
      return;
    case "corpus-prune":
      await runCorpusPruneCli(rest);
      return;
    case "--help":
    case "-h":
    case undefined:
      printTopLevelUsage();
      return;
    default:
      throw new Error(`Unknown F-Stop command: ${command}`);
  }
}
