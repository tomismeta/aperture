import {
  DEFAULT_AUTORESEARCH_GATE_TIMEOUT_SECONDS,
  DEFAULT_DATACLAW_SPLIT,
  DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS,
  DEFAULT_OPEN_AGENT_SESSIONS_SPLIT,
  DEFAULT_SWE_SMITH_SPLIT,
  DEFAULT_TRACE_COMMONS_SPLIT,
} from "./index.js";

export function printTopLevelUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm tsx scripts/fstop.ts <command> [options]",
      "",
      "Commands:",
      "  run               Run a single unattended F-Stop window",
      "  campaign          Run repeated unattended F-Stop windows",
      "  service           Supervise campaign windows with restart/stall handling",
      "  sweep             Run a repeatable multi-lane unattended sweep",
      "  ingest            Normalize a raw export or canonical session into replay bundles",
      "  workflow-summary  Summarize workflow, approvals, runners, and usage from session bundles",
      "  review-candidates Extract deterministic semantic review candidates from bundles",
      "  gc                Prune old runtime campaigns and artifacts",
      "  optimize          Run one bounded optimizer attempt against calibration cases",
      "  prepare           Prepare an offline-review artifact from a replay bundle",
      "  prompt            Render an offline-review prompt from an artifact",
      "  compare           Compare a completed offline-review artifact",
      "  review-run        Run a reviewer command against an offline-review artifact",
      "  promote           Promote an offline-review report into a calibration case",
      "  evaluate          Evaluate frozen calibration cases",
      "  cycle             Evaluate frozen calibration cases and emit an optimization brief",
      "  reviewer          Read a reviewer prompt on stdin and delegate to a configured provider",
      "  optimizer         Read an optimizer prompt on stdin and delegate to a configured provider",
      "  trajectory-import Import public trajectory bundles into the runtime bundle format",
      "  corpus-run        Run bounded public corpus import batches with manifests",
    ].join("\n") + "\n",
  );
}

export function printRunUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:run [options]",
      "",
      "Runs Aperture Lab F-Stop so a provider can manage repeated proposal attempts end to end.",
      "",
      "Options:",
      "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
      "  --file <path>                         Autodetect a session bundle JSON, offline-review batch report JSON, canonical F-Stop session JSON, or supported raw export file",
      "  --batch-report <path>                 Reuse a precomputed offline-review batch report JSON",
      "  --bundle <path>                       Run a single unattended proposal attempt against an explicit bundle (repeatable)",
      "  --dataset <swe-smith|dataclaw|pi|open-agent-sessions|trace-commons>       Public dataset for slice mode, or an optional raw-file hint",
      "  --split <tool|xml|ticks|train|approved>             Dataset split (default: dataset-specific)",
      "  --offset <number>                     Starting row offset (default: 0)",
      "  --limit <number>                      Rows per proposal slice (default: 12)",
      "  --max-slices <number>                 Maximum slices to attempt (default: 3)",
      "  --reviewer-provider <provider>        Reviewer provider used inside proposal attempts",
      "  --optimizer-provider <provider>       Optimizer provider used inside proposal attempts",
      "  --review-concurrency <number>         Parallel offline reviews per slice (default: 2)",
      "  --min-session-count <number>          Proposal promotion threshold (default: 2)",
      "  --max-reports <number>                Max promoted reports per attempt (default: 4)",
      "  --output <path>                       Run JSON output path",
      "  --status-output <path>                Live run status JSON output path",
      `  --gate-timeout-seconds <number>       Max seconds per post-patch gate command (default: ${DEFAULT_AUTORESEARCH_GATE_TIMEOUT_SECONDS})`,
      "  --skip-judgment-battle                Skip pnpm judgment:battle during optimization",
      "  --skip-release-check                  Skip pnpm release:check during optimization",
      "  --json                                Emit machine-readable JSON",
    ].join("\n") + "\n",
  );
}

export function printCampaignUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:campaign [options]",
      "",
      "Runs repeated F-Stop campaign windows from a clean source checkout.",
      "",
      "Options:",
      "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
      "  --dataset <swe-smith|dataclaw|open-agent-sessions|trace-commons>  Public dataset to import (default: swe-smith)",
      "  --split <tool|xml|ticks|train|approved>             Dataset split (default: dataset-specific)",
      "  --offset <number>                     Starting row offset (default: 0)",
      "  --limit <number>                      Rows per slice (default: 12)",
      "  --max-slices <number>                 Max slices per window (default: 10)",
      "  --windows <number>                    Number of repeated windows to attempt (default: 8)",
      "  --reviewer-provider <provider>        Reviewer provider used inside proposal attempts",
      "  --optimizer-provider <provider>       Optimizer provider used inside proposal attempts",
      "  --review-concurrency <number>         Parallel offline reviews per slice (default: 2)",
      "  --min-session-count <number>          Proposal promotion threshold (default: 2)",
      "  --max-reports <number>                Max promoted reports per attempt (default: 4)",
      "  --stall-threshold-seconds <number>    Mark a run stalled after this many seconds (default: 900)",
      "  --campaign-id <id>                    Explicit campaign id",
      "  --campaign-root <path>                Explicit campaign directory",
      "  --source-repo <path>                  Source repo to run from (default: cwd)",
      "  --json                                Emit machine-readable JSON",
    ].join("\n") + "\n",
  );
}

export function printServiceUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:service [options]",
      "",
      "Supervises F-Stop campaign windows with restart and stall handling.",
      "",
      "Options:",
      "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
      "  --dataset <swe-smith|dataclaw|open-agent-sessions|trace-commons>  Public dataset to review",
      "  --split <tool|xml|ticks|train|approved>             Dataset split (default: dataset-specific)",
      "  --offset <number>                      Starting row offset (default: 0)",
      "  --limit <number>                       Rows per slice (default: 12)",
      "  --max-slices <number>                  Maximum slices per campaign window (default: 10)",
      "  --window-count <number>                Maximum supervised campaign windows (default: 8)",
      "  --reviewer-provider <provider>         Reviewer provider used inside campaign windows",
      "  --optimizer-provider <provider>        Optimizer provider used inside campaign windows",
      "  --review-concurrency <number>          Parallel offline reviews per slice (default: 2)",
      "  --min-session-count <number>           Proposal promotion threshold (default: 2)",
      "  --max-reports <number>                 Max promoted reports per campaign window (default: 4)",
      "  --max-restarts <number>                Restart budget before failing (default: 3)",
      "  --restart-backoff-seconds <number>     Delay before restarting after failure (default: 15)",
      "  --campaign-stall-threshold-seconds <number>  Inner campaign stall threshold (default: 900)",
      "  --service-stall-threshold-seconds <number>   Supervisor stall threshold (default: 1200)",
      "  --service-id <id>                      Override the generated service id",
      "  --service-root <path>                  Service status/log root (default: .aperture/lab/service)",
      "  --source-repo <path>                   Clean repo to supervise (default: cwd)",
      "  --json                                 Emit machine-readable JSON",
    ].join("\n") + "\n",
  );
}

export function printSweepUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:sweep [options]",
      "",
      "Runs multiple F-Stop service lanes sequentially from one clean source checkout.",
      "",
      "Options:",
      "  --provider <hermes|openclaw|generic>   Default provider shortcut for reviewer and optimizer (default: generic)",
      "  --reviewer-provider <provider>         Reviewer provider used inside each lane",
      "  --optimizer-provider <provider>        Optimizer provider used inside each lane",
      "  --preset <pre-release>                 Built-in sweep lane preset",
      "  --lane <dataset>/<split>               Add one lane explicitly (repeatable)",
      "  --offset <number>                      Starting row offset for each lane (default: 0)",
      "  --limit <number>                       Rows per slice (default: 12)",
      "  --max-slices <number>                  Maximum slices per campaign window (default: 10)",
      "  --window-count <number>                Maximum supervised campaign windows per lane (default: 8)",
      "  --review-concurrency <number>          Parallel offline reviews per slice (default: 2)",
      "  --min-session-count <number>           Proposal promotion threshold (default: 2)",
      "  --max-reports <number>                 Max promoted reports per campaign window (default: 4)",
      "  --max-restarts <number>                Restart budget before failing a lane (default: 3)",
      "  --restart-backoff-seconds <number>     Delay before restarting after failure (default: 15)",
      "  --campaign-stall-threshold-seconds <number>  Inner campaign stall threshold (default: 900)",
      "  --service-stall-threshold-seconds <number>   Supervisor stall threshold (default: 1200)",
      "  --sweep-id <id>                        Override the generated sweep id",
      "  --sweep-root <path>                    Preserve sweep outputs here (default: .aperture/fstop-sweeps/<id>)",
      "  --source-repo <path>                   Clean repo to supervise (default: cwd)",
      "  --json                                 Emit machine-readable JSON",
    ].join("\n") + "\n",
  );
}

export function printIngestUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:ingest --file <path> [options]",
      "",
      "Normalizes a supported raw export or canonical F-Stop session file into replayable bundles.",
      "",
      "Options:",
      "  --file <path>                        Raw export file to ingest",
      "  --dataset <swe-smith|dataclaw|pi|open-agent-sessions|trace-commons>       Optional dataset hint",
      "  --split <tool|xml|ticks|train|approved>             Optional split hint",
      "  --output-dir <path>                 Bundle destination root (default: .aperture/lab/bundles/raw)",
      "  --dry-run                           Parse and prepare without writing bundle files",
      "  --json                              Emit machine-readable JSON",
      "  --help, -h                          Show this message",
    ].join("\n") + "\n",
  );
}

export function printGcUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:gc [options]",
      "",
      "Prunes old F-Stop campaign and artifact outputs from the runtime directory.",
      "",
      "Options:",
      "  --runtime-root <path>     Runtime root to prune (default: .aperture/lab)",
      "  --source-repo <path>      Source repo whose git worktree metadata should also be pruned (default: cwd)",
      "  --keep-campaigns <n>      Number of campaign directories to keep (default: 5)",
      "  --keep-artifacts <n>      Number of files or proposal/report dirs to keep per artifact bucket (default: 50)",
      "  --dry-run                 Show what would be pruned without deleting",
      "  --json                    Emit machine-readable JSON",
    ].join("\n") + "\n",
  );
}

export function printWorkflowSummaryUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm tsx scripts/fstop.ts workflow-summary (--bundle <path> | --bundle-dir <path>) [options]",
      "",
      "Builds a compact operator-facing summary from replay session bundles.",
      "",
      "Options:",
      "  --bundle <path>       Session bundle JSON file to summarize (repeatable)",
      "  --bundle-dir <path>   Directory of session bundles to summarize recursively (repeatable)",
      "  --output <path>       Write markdown summary to this path",
      "  --json                Emit the summary report as machine-readable JSON",
      "  --help, -h            Show this message",
    ].join("\n") + "\n",
  );
}

export function printReviewCandidateUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm tsx scripts/fstop.ts review-candidates (--manifest <path> | --bundle <path> | --bundle-dir <path>) [options]",
      "",
      "Extracts deterministic semantic and judgment review candidates from replay session bundles.",
      "",
      "Options:",
      "  --manifest <path>             Public corpus run manifest JSON to scan through its verified ledger (repeatable)",
      "  --bundle <path>               Session bundle JSON file to scan (repeatable)",
      "  --bundle-dir <path>           Directory of session bundles to scan recursively (repeatable)",
      "  --limit-per-kind <number>     Retained examples per candidate kind (default: 30)",
      "  --limit-per-session-kind <n>   Retained examples per session per kind (default: 3)",
      "  --output <path>               Write candidate report JSON to this path",
      "  --markdown-output <path>      Write markdown summary to this path",
      "  --json                        Emit the report paths and payload as machine-readable JSON",
      "  --help, -h                    Show this message",
    ].join("\n") + "\n",
  );
}

export function printOptimizeUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:optimize [options]",
      "",
      "Runs the Aperture Lab F-Stop frozen calibration loop, asks an optimizer provider to make bounded semantic-layer edits, then reruns the gates.",
      "",
      "Options:",
      "  --provider <hermes|openclaw|generic>  Optimizer provider shortcut (default: generic)",
      "  --optimizer-command <cmd>             Explicit optimizer command; overrides provider adapter",
      "  --extra-calibration-dir <path>        Include additional calibration cases from this directory",
      "  --output <path>                       Write optimizer run JSON to this path",
      "  --prompt-output <path>                Write optimizer prompt to this path",
      "  --raw-output <path>                   Write raw optimizer stdout/stderr summary to this path",
      "  --patch-output <path>                 Write the surviving git diff patch to this path",
      "  --before-output <path>                Write the pre-optimization evaluation report to this path",
      "  --after-output <path>                 Write the post-optimization evaluation report to this path",
      "  --brief-output <path>                 Write the optimization brief to this path",
      "  --skip-judgment-battle                Skip pnpm judgment:battle",
      "  --skip-release-check                  Skip pnpm release:check",
      "  --json                                Emit machine-readable JSON",
    ].join("\n") + "\n",
  );
}

export function printPrepareUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:prepare --bundle <path> [options]",
      "",
      "Options:",
      "  --bundle <path>          Session bundle JSON to prepare for offline review",
      "  --output <path>          Destination artifact JSON path",
      "  --rubric-version <id>    Rubric identifier to record in the artifact",
      `  --focus <csv>            Focus areas (default: ${DEFAULT_OFFLINE_REVIEW_FOCUS_AREAS.join(",")})`,
      "  --json                   Emit machine-readable JSON to stdout",
    ].join("\n") + "\n",
  );
}

export function printPromptUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:prompt --artifact <path> [options]",
      "",
      "Options:",
      "  --artifact <path>        Prepared offline review artifact JSON",
      "  --output <path>          Destination reviewer prompt markdown path",
      "  --json                   Emit machine-readable JSON to stdout",
    ].join("\n") + "\n",
  );
}

export function printCompareUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:compare --artifact <path> [options]",
      "",
      "Options:",
      "  --artifact <path>        Completed offline review artifact JSON",
      "  --output <path>          Destination disagreement report JSON path",
      "  --json                   Emit machine-readable JSON to stdout",
      "  --fail-on-disagreement   Exit non-zero when disagreements are found",
    ].join("\n") + "\n",
  );
}

export function printReviewRunUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:fstop:review:run --artifact <path> (--response <path> | --response-stdin | --reviewer-command <cmd>) [options]",
      "",
      "Options:",
      "  --artifact <path>             Prepared offline review artifact JSON",
      "  --response <path>             Reviewer-model response file (JSON or fenced JSON)",
      "  --response-stdin              Read reviewer-model response from stdin",
      "  --reviewer-command <cmd>      Shell command that reads the prompt on stdin and writes JSON to stdout",
      "  --prompt <path>               Destination reviewer prompt markdown path",
      "  --raw-response-output <path>  Destination raw reviewer stdout path",
      "  --response-artifact <path>    Destination completed artifact JSON path",
      "  --output <path>               Destination disagreement report JSON path",
      "  --recommendation-output <path> Destination recommendation JSON path",
      "  --run-output <path>           Destination run summary JSON path",
      "  --json                        Emit machine-readable JSON to stdout",
      "  --fail-on-disagreement        Exit non-zero when disagreements are found",
    ].join("\n") + "\n",
  );
}

export function printCalibrationUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  pnpm lab:fstop:promote --report <path> --split <train|validation|heldout> [options]",
      "  pnpm lab:fstop:evaluate [--split <split>] [--extra-calibration-dir <path>] [--json]",
      "  pnpm lab:fstop:cycle [--split <split>] [--extra-calibration-dir <path>] [--json]",
      "",
      "Promotion options:",
      "  --focus-area <title|summary|status|intentFrame|toolFamily|consequence>",
      "  --recommendation <promote|inspect|ignore>",
      "  --minimum-confidence <high|medium|low>",
      "  --no-step-invariants",
      "",
      "Evaluate / cycle options:",
      "  --extra-calibration-dir <path>        Include additional calibration cases from this directory",
    ].join("\n") + "\n",
  );
}

export function printRoleUsage(): void {
  process.stdout.write(
    [
      "Usage:",
      "  pnpm lab:fstop:reviewer [options]",
      "  pnpm lab:fstop:optimizer [options]",
      "",
      "Each command reads a prompt on stdin and delegates to a configured provider command.",
      "",
      "Options:",
      "  --provider <hermes|openclaw|generic>  Provider shortcut (default: generic)",
      "  --command <cmd>                       Explicit command; overrides env vars",
    ].join("\n") + "\n",
  );
}

export function printTrajectoryImportUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm trajectory:import [options]",
      "",
      "Imports public trajectories into local Aperture Lab session bundles.",
      "",
      "Options:",
      "  --dataset <swe-smith|dataclaw|open-agent-sessions|trace-commons>  Public dataset to import (default: swe-smith)",
      `  --split <tool|xml|ticks|${DEFAULT_DATACLAW_SPLIT}|${DEFAULT_OPEN_AGENT_SESSIONS_SPLIT}|${DEFAULT_TRACE_COMMONS_SPLIT}>  Dataset split to import (dataset-specific default: ${DEFAULT_SWE_SMITH_SPLIT}, ${DEFAULT_DATACLAW_SPLIT}, ${DEFAULT_OPEN_AGENT_SESSIONS_SPLIT}, or ${DEFAULT_TRACE_COMMONS_SPLIT})`,
      "  --offset <number>         Row offset in the dataset (default: 0)",
      "  --limit <number>          Number of rows to import (default: 5)",
      "  --output-dir <path>       Destination root for imported bundle JSON files",
      "  --dry-run                 Fetch and convert without writing files",
      "  --help, -h                Show this message",
    ].join("\n") + "\n",
  );
}

export function printCorpusRunUsage(): void {
  process.stdout.write(
    [
      "Usage: pnpm lab:corpus:run [options]",
      "",
      "Runs a bounded Trace Commons import and writes an auditable manifest/report.",
      "",
      "Options:",
      "  --dataset <trace-commons>        Public dataset to import (default: trace-commons)",
      `  --split <${DEFAULT_TRACE_COMMONS_SPLIT}>                  Dataset split to import (default: ${DEFAULT_TRACE_COMMONS_SPLIT})`,
      "  --offset <number>               Starting row offset (default: 0)",
      "  --max-rows <number>             Maximum rows to fetch/import (default: 100)",
      "  --page-size <number>            Rows per request, max 100 (default: 25)",
      "  --runtime-root <path>           Lab runtime root (default: .aperture/lab)",
      "  --output-root <path>            Corpus run manifest/report root (default: .aperture/lab/corpus-runs)",
      "  --bundle-root <path>            Bundle output root (default: .aperture/lab/bundles/public)",
      "  --run-id <id>                   Stable run id for repeatable VPS jobs",
      "  --resume <manifest-path>        Resume an incomplete run from its manifest",
      "  --request-timeout-seconds <n>   Fetch timeout per request (default: 30)",
      "  --max-response-bytes <number>   Decompressed response cap, max 134217728 (default: 67108864)",
      "  --max-retries <number>          Retry budget for retryable fetch failures (default: 2)",
      "  --existing <verify|error|skip>  Existing bundle policy (default: verify)",
      "  --plan                          Build the manifest plan without network or writes",
      "  --dry-run                       Fetch and convert without writing bundle or manifest files",
      "  --json                          Emit machine-readable JSON",
      "  --help, -h                      Show this message",
    ].join("\n") + "\n",
  );
}
