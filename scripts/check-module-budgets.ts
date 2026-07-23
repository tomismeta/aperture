import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const budgets = [
  { file: "packages/runtime/src/runtime.ts", maxLines: 800 },
  { file: "packages/runtime/src/runtime-routes.ts", maxLines: 75 },
  { file: "packages/runtime/src/runtime-control-routes.ts", maxLines: 225 },
  { file: "packages/runtime/src/runtime-work-routes.ts", maxLines: 140 },
  { file: "packages/runtime/src/runtime-registry-routes.ts", maxLines: 180 },
  { file: "packages/runtime/src/runtime-route-utils.ts", maxLines: 50 },
  { file: "packages/runtime/src/runtime-client-session.ts", maxLines: 175 },
  { file: "packages/runtime/src/runtime-client.ts", maxLines: 275 },
  { file: "packages/runtime/src/adapter-client.ts", maxLines: 275 },
  { file: "packages/runtime/src/held-request-coordinator.ts", maxLines: 175 },
  { file: "packages/runtime/src/work-event-ingest.ts", maxLines: 550 },
  { file: "packages/runtime/src/work-contract.ts", maxLines: 425 },
  { file: "packages/core/src/aperture-core.ts", maxLines: 1000 },
  { file: "packages/core/src/aperture-core-attention-evidence.ts", maxLines: 175 },
  { file: "packages/core/src/aperture-core-frame-lifecycle.ts", maxLines: 375 },
  { file: "packages/core/src/attention-claim.ts", maxLines: 275 },
  { file: "packages/core/src/attention-decision-record.ts", maxLines: 375 },
  { file: "packages/core/src/attention-evaluator.ts", maxLines: 350 },
  { file: "packages/core/src/attention-evaluator-config.ts", maxLines: 125 },
  { file: "packages/core/src/attention-evaluator-input.ts", maxLines: 325 },
  { file: "packages/core/src/attention-evaluator-profile-config.ts", maxLines: 175 },
  { file: "packages/core/src/attention-evaluator-runtime-config.ts", maxLines: 125 },
  { file: "packages/core/src/attention-record-json.ts", maxLines: 125 },
  { file: "packages/core/src/evaluator.ts", maxLines: 75 },
  { file: "packages/core/src/attention-planner.ts", maxLines: 700 },
  { file: "packages/core/src/attention-planner-routing.ts", maxLines: 500 },
  { file: "packages/claude-code/src/server.ts", maxLines: 975 },
  { file: "packages/claude-code/src/server-support.ts", maxLines: 150 },
  { file: "packages/claude-code/src/server-hook-event.ts", maxLines: 625 },
  { file: "packages/claude-code/src/server-hook-event-latest.ts", maxLines: 175 },
  { file: "packages/codex/src/hook-server.ts", maxLines: 350 },
  { file: "packages/claude-code/src/mapping.ts", maxLines: 600 },
  { file: "packages/claude-code/src/mapping-requests.ts", maxLines: 425 },
  { file: "packages/claude-code/src/mapping-lifecycle.ts", maxLines: 700 },
  { file: "packages/claude-code/src/mapping-latest-hooks.ts", maxLines: 225 },
  { file: "packages/claude-code/src/mapping-shared.ts", maxLines: 700 },
  { file: "packages/codex/src/mapping.ts", maxLines: 250 },
  { file: "packages/codex/src/mapping-requests.ts", maxLines: 550 },
  { file: "packages/codex/src/mapping-notifications.ts", maxLines: 400 },
  { file: "packages/codex/src/mapping-notifications-ops.ts", maxLines: 325 },
  { file: "packages/codex/src/mapping-notifications-thread.ts", maxLines: 325 },
  { file: "packages/codex/src/mapping-response.ts", maxLines: 350 },
  { file: "packages/codex/src/mapping-shared.ts", maxLines: 300 },
  { file: "packages/opencode/src/mapping.ts", maxLines: 200 },
  { file: "packages/opencode/src/mapping-requests.ts", maxLines: 450 },
  { file: "packages/opencode/src/mapping-lifecycle.ts", maxLines: 300 },
  { file: "packages/opencode/src/mapping-platform.ts", maxLines: 250 },
  { file: "packages/opencode/src/mapping-session-events.ts", maxLines: 250 },
  { file: "packages/opencode/src/mapping-response.ts", maxLines: 300 },
  { file: "packages/opencode/src/mapping-shared.ts", maxLines: 175 },
  { file: "packages/pi/src/extension.ts", maxLines: 275 },
  { file: "packages/pi/src/mapping.ts", maxLines: 125 },
  { file: "packages/pi/src/mapping-lifecycle.ts", maxLines: 275 },
  { file: "packages/pi/src/mapping-tools.ts", maxLines: 275 },
  { file: "packages/pi/src/mapping-shared.ts", maxLines: 250 },
  { file: "packages/aperture/src/cli.ts", maxLines: 275 },
  { file: "packages/aperture/src/cli/config.ts", maxLines: 550 },
  { file: "packages/aperture/src/cli/launcher.ts", maxLines: 700 },
  { file: "packages/tui/src/render.ts", maxLines: 800 },
  { file: "packages/tui/src/render-why.ts", maxLines: 500 },
  { file: "packages/tui/src/render-preflight.ts", maxLines: 225 },
  { file: "packages/lab/src/fstop-cli.ts", maxLines: 200 },
  { file: "packages/lab/src/fstop-cli-autoresearch.ts", maxLines: 175 },
  { file: "packages/lab/src/fstop-cli-review.ts", maxLines: 325 },
  { file: "packages/lab/src/fstop-cli-ingest.ts", maxLines: 175 },
  { file: "packages/lab/src/fstop-cli-gc.ts", maxLines: 175 },
  { file: "packages/lab/src/fstop-cli-shared.ts", maxLines: 100 },
  { file: "packages/lab/src/fstop-cli-args.ts", maxLines: 125 },
  { file: "packages/lab/src/fstop-cli-args-autoresearch.ts", maxLines: 500 },
  { file: "packages/lab/src/fstop-cli-args-support.ts", maxLines: 250 },
  { file: "packages/lab/src/fstop-cli-args-review.ts", maxLines: 325 },
  { file: "packages/lab/src/fstop-cli-args-calibration.ts", maxLines: 250 },
  { file: "packages/lab/src/fstop-cli-args-ingest.ts", maxLines: 150 },
  { file: "packages/lab/src/fstop-cli-args-ops.ts", maxLines: 250 },
  { file: "packages/lab/src/fstop-ingest.ts", maxLines: 225 },
  { file: "packages/lab/src/fstop-ingest-raw.ts", maxLines: 650 },
  { file: "packages/lab/src/autoresearch-report.ts", maxLines: 600 },
  { file: "packages/lab/src/autoresearch-report-files.ts", maxLines: 100 },
  { file: "packages/lab/src/autoresearch-report-render.ts", maxLines: 225 },
  { file: "packages/lab/src/artifact-versions.ts", maxLines: 75 },
  { file: "packages/lab/src/autoresearch-campaign-command.ts", maxLines: 575 },
  { file: "packages/lab/src/autoresearch-campaign-support.ts", maxLines: 325 },
  { file: "packages/lab/src/autoresearch-run-command.ts", maxLines: 425 },
  { file: "packages/lab/src/autoresearch-run-command-support.ts", maxLines: 450 },
  { file: "packages/lab/src/offline-review.ts", maxLines: 725 },
  { file: "packages/lab/src/offline-review-support.ts", maxLines: 350 },
  { file: "packages/lab/src/offline-review-validation.ts", maxLines: 350 },
  { file: "packages/lab/src/offline-review-render.ts", maxLines: 500 },
  { file: "packages/lab/src/offline-review-files.ts", maxLines: 150 },
  { file: "packages/lab/src/autoresearch-calibration.ts", maxLines: 700 },
  { file: "packages/lab/src/autoresearch-calibration-support.ts", maxLines: 350 },
  { file: "packages/lab/src/autoresearch-calibration-validation.ts", maxLines: 275 },
  { file: "packages/lab/src/autoresearch-calibration-render.ts", maxLines: 175 },
  { file: "packages/lab/src/autoresearch-calibration-files.ts", maxLines: 100 },
  { file: "packages/lab/src/public-trajectories-dataclaw.ts", maxLines: 75 },
  { file: "packages/lab/src/public-trajectories-dataclaw-fetch.ts", maxLines: 175 },
  { file: "packages/lab/src/public-trajectories-dataclaw-import.ts", maxLines: 475 },
  { file: "packages/lab/src/public-trajectories-open-agent-sessions.ts", maxLines: 75 },
  { file: "packages/lab/src/public-trajectories-open-agent-sessions-fetch.ts", maxLines: 350 },
  { file: "packages/lab/src/public-trajectories-open-agent-sessions-import.ts", maxLines: 525 },
  { file: "packages/lab/src/public-trajectories-pi.ts", maxLines: 75 },
  { file: "packages/lab/src/public-trajectories-pi-parse.ts", maxLines: 150 },
  { file: "packages/lab/src/public-trajectories-pi-import.ts", maxLines: 475 },
  { file: "packages/lab/src/public-trajectories-pi-support.ts", maxLines: 400 },
  { file: "packages/lab/src/public-trajectories-swe-smith.ts", maxLines: 75 },
  { file: "packages/lab/src/public-trajectories-swe-smith-fetch.ts", maxLines: 200 },
  { file: "packages/lab/src/public-trajectories-swe-smith-import.ts", maxLines: 400 },
  { file: "packages/lab/src/session-bundle.ts", maxLines: 100 },
  { file: "packages/lab/src/session-bundle-model.ts", maxLines: 325 },
  { file: "packages/lab/src/session-bundle-scenarios.ts", maxLines: 150 },
  { file: "packages/lab/src/session-bundle-files.ts", maxLines: 125 },
  { file: "packages/lab/src/session-bundle-capture.ts", maxLines: 350 },
  { file: "packages/lab/src/scenario.ts", maxLines: 300 },
  { file: "packages/lab/src/runner.ts", maxLines: 300 },
  { file: "packages/lab/src/judgment-bench.ts", maxLines: 875 },
  { file: "packages/lab/src/determinism.ts", maxLines: 350 },
  { file: "packages/lab/src/kernel-canonical-json.ts", maxLines: 100 },
  { file: "packages/lab/src/kernel-conformance.ts", maxLines: 250 },
  { file: "packages/lab/src/kernel-conformance-support.ts", maxLines: 275 },
  { file: "packages/lab/src/kernel-corpus-conformance.ts", maxLines: 150 },
  { file: "packages/lab/src/kernel-corpus-profile.ts", maxLines: 100 },
  { file: "packages/lab/src/kernel-corpus-quality.ts", maxLines: 175 },
  { file: "packages/lab/src/kernel-decision-contract.ts", maxLines: 175 },
  { file: "packages/lab/src/kernel-decision-contract-support.ts", maxLines: 250 },
  { file: "packages/lab/src/kernel-decision-projection.ts", maxLines: 225 },
  { file: "packages/lab/src/kernel-profile.ts", maxLines: 75 },
  { file: "packages/lab/src/replay-trace.ts", maxLines: 75 },
  { file: "packages/lab/src/validation.ts", maxLines: 75 },
  { file: "packages/lab/src/validation-events.ts", maxLines: 350 },
  { file: "packages/lab/src/validation-replay.ts", maxLines: 450 },
  { file: "packages/lab/src/validation-replay-decision.ts", maxLines: 175 },
  { file: "packages/lab/src/validation-trace.ts", maxLines: 100 },
  { file: "packages/lab/src/validation-support.ts", maxLines: 350 },
] as const;

async function main(): Promise<void> {
  const violations: Array<{ file: string; lineCount: number; maxLines: number }> = [];

  for (const budget of budgets) {
    const absolutePath = resolve(repoRoot, budget.file);
    const text = await readFile(absolutePath, "utf8");
    const lineCount = text.split("\n").length;
    if (lineCount > budget.maxLines) {
      violations.push({
        file: budget.file,
        lineCount,
        maxLines: budget.maxLines,
      });
    }
  }

  if (violations.length === 0) {
    return;
  }

  const lines = [
    "Module budget check failed.",
    "These files exceeded their line-count budgets:",
    "",
  ];

  for (const violation of violations) {
    lines.push(
      `- ${relative(repoRoot, resolve(repoRoot, violation.file))}: ${violation.lineCount} lines (budget ${violation.maxLines})`,
    );
  }

  lines.push("");
  lines.push(
    "Split command shells, parser/usage surfaces, or mapper families before adding more logic to these files.",
  );
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = 1;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
