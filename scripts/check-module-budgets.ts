import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const SEMANTIC_MODULE_COUNT_BUDGET = 100;
const SEMANTIC_LINE_COUNT_BUDGET = 8695;
const SEMANTIC_MATCHER_SITE_BUDGET = 600;
const SEMANTIC_PHRASE_LITERAL_BUDGET = 175;
const OBSERVATION_PRIMITIVE_LINE_COUNT_BUDGET = 650;
const TASK_FAILURE_PARSING_LINE_COUNT_BUDGET = 1225;

const OBSERVATION_SEMANTICS_FILE = "packages/core/src/observation-semantics.ts";
const NORMALIZED_OBSERVATION_FILE = "packages/core/src/normalized-observation.ts";
const TASK_FAILURE_OBSERVATION_GRAMMAR_FILE =
  "packages/core/src/task-failure-observation-grammar.ts";
const TASK_FAILURE_PAYLOAD_OBSERVATION_GRAMMAR_FILE =
  "packages/core/src/task-failure-payload-observation-grammar.ts";
const TASK_FAILURE_EVIDENCE_OBSERVATION_GRAMMAR_FILE =
  "packages/core/src/task-failure-evidence-observation-grammar.ts";
const TASK_FAILURE_OBSERVATION_CORE_FILE = "packages/core/src/task-failure-observation-core.ts";
const TASK_FAILURE_OBSERVATION_NORMALIZER_FILE =
  "packages/core/src/task-failure-observation-normalizer.ts";
const observationPrimitiveBudgetFiles = [
  OBSERVATION_SEMANTICS_FILE,
  NORMALIZED_OBSERVATION_FILE,
  TASK_FAILURE_OBSERVATION_GRAMMAR_FILE,
  TASK_FAILURE_PAYLOAD_OBSERVATION_GRAMMAR_FILE,
  TASK_FAILURE_EVIDENCE_OBSERVATION_GRAMMAR_FILE,
  TASK_FAILURE_OBSERVATION_CORE_FILE,
  TASK_FAILURE_OBSERVATION_NORMALIZER_FILE,
] as const;
const taskFailureParsingBudgetFiles = [
  TASK_FAILURE_OBSERVATION_GRAMMAR_FILE,
  TASK_FAILURE_PAYLOAD_OBSERVATION_GRAMMAR_FILE,
  // The evidence observation grammar has no lexical parsing; it is governed
  // by the observation primitive aggregate and its explicit file budget.
  "packages/core/src/semantic-task-failure-signals.ts",
  "packages/core/src/semantic-evidence.ts",
  "packages/core/src/semantic-failure-detail.ts",
  "packages/core/src/semantic-edit-output-shapes.ts",
  "packages/core/src/semantic-tool-use-rejection-shapes.ts",
  "packages/core/src/semantic-task-failure-structured-output.ts",
] as const;
const semanticMatcherGovernanceFiles = [
  TASK_FAILURE_OBSERVATION_GRAMMAR_FILE,
  TASK_FAILURE_PAYLOAD_OBSERVATION_GRAMMAR_FILE,
] as const;

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
  { file: "packages/core/src/aperture-core-relation-lifecycle.ts", maxLines: 250 },
  { file: "packages/core/src/episode-tracker.ts", maxLines: 700 },
  { file: "packages/core/src/attention-claim.ts", maxLines: 275 },
  { file: "packages/core/src/attention-decision-record.ts", maxLines: 175 },
  { file: "packages/core/src/attention-decision-record-builder.ts", maxLines: 125 },
  { file: "packages/core/src/attention-decision-record-projection.ts", maxLines: 175 },
  { file: "packages/core/src/attention-decision-record-schema.ts", maxLines: 10 },
  { file: "packages/core/src/observational-status-conflict.ts", maxLines: 25 },
  { file: OBSERVATION_SEMANTICS_FILE, maxLines: 50 },
  { file: NORMALIZED_OBSERVATION_FILE, maxLines: 75 },
  { file: TASK_FAILURE_OBSERVATION_GRAMMAR_FILE, maxLines: 250 },
  { file: TASK_FAILURE_PAYLOAD_OBSERVATION_GRAMMAR_FILE, maxLines: 225 },
  { file: TASK_FAILURE_EVIDENCE_OBSERVATION_GRAMMAR_FILE, maxLines: 205 },
  { file: TASK_FAILURE_OBSERVATION_CORE_FILE, maxLines: 205 },
  { file: TASK_FAILURE_OBSERVATION_NORMALIZER_FILE, maxLines: 150 },
  { file: "packages/core/src/attention-evaluator.ts", maxLines: 350 },
  { file: "packages/core/src/attention-evaluator-config.ts", maxLines: 125 },
  { file: "packages/core/src/attention-evaluator-input.ts", maxLines: 325 },
  { file: "packages/core/src/attention-evaluator-profile-config.ts", maxLines: 175 },
  { file: "packages/core/src/attention-evaluator-runtime-config.ts", maxLines: 125 },
  { file: "packages/core/src/attention-record-json.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-bare-nonzero-terminal-exit.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-detection.ts", maxLines: 375 },
  { file: "packages/core/src/semantic-relation-detection.ts", maxLines: 350 },
  { file: "packages/core/src/semantic-evidence.ts", maxLines: 475 },
  { file: "packages/core/src/semantic-failure-detail.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-imperative-supersession-relation.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-interpreter.ts", maxLines: 700 },
  { file: "packages/core/src/semantic-language.ts", maxLines: 150 },
  { file: "packages/core/src/semantic-abbreviated-file-view-observation-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-diagnostic-shapes.ts", maxLines: 100 },
  { file: "packages/core/src/semantic-runtime-error-diagnostic-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-diagnostic-reference-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-document-observation-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-edit-output-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-command-text-observation-boundaries.ts", maxLines: 35 },
  { file: "packages/core/src/semantic-command-warning-observation-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-linter-output-observation-shapes.ts", maxLines: 60 },
  { file: "packages/core/src/semantic-bare-diagnostic-observation-shapes.ts", maxLines: 10 },
  { file: "packages/core/src/semantic-observation-reference-wrapper-shapes.ts", maxLines: 20 },
  { file: "packages/core/src/semantic-observation-text.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-location-diagnostic-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-observation-transcript-actual-section.ts", maxLines: 40 },
  { file: "packages/core/src/semantic-observation-transcript-body.ts", maxLines: 15 },
  {
    file: "packages/core/src/semantic-observation-transcript-diagnostic-boundaries.ts",
    maxLines: 100,
  },
  {
    file: "packages/core/src/semantic-observation-transcript-diagnostic-candidate.ts",
    maxLines: 125,
  },
  { file: "packages/core/src/semantic-observation-transcript-diagnostic-shapes.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-observation-transcript-reference-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-observation-transcript-shapes.ts", maxLines: 100 },
  { file: "packages/core/src/semantic-observation-transcript-types.ts", maxLines: 25 },
  {
    file: "packages/core/src/semantic-nondiagnostic-observation-transcript-shapes.ts",
    maxLines: 35,
  },
  { file: "packages/core/src/semantic-normalizer.ts", maxLines: 325 },
  { file: "packages/core/src/semantic-ontology-types.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-ontology.ts", maxLines: 375 },
  { file: "packages/core/src/semantic-operation-success-observation-shapes.ts", maxLines: 100 },
  { file: "packages/core/src/semantic-path-qualified-failure-diagnostic-shapes.ts", maxLines: 20 },
  { file: "packages/core/src/semantic-patterns.ts", maxLines: 300 },
  { file: "packages/core/src/semantic-provenance.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-quoted-span.ts", maxLines: 100 },
  { file: "packages/core/src/semantic-read-failure-diagnostic-shapes.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-relation-hint-dedupe.ts", maxLines: 30 },
  { file: "packages/core/src/semantic-relation-judgment.ts", maxLines: 30 },
  { file: "packages/core/src/semantic-relations.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-source-fixture-observation-shapes.ts", maxLines: 15 },
  { file: "packages/core/src/semantic-tagged-file-observation-transcript-shapes.ts", maxLines: 15 },
  { file: "packages/core/src/semantic-task-failure-structured-output.ts", maxLines: 40 },
  { file: "packages/core/src/semantic-arrow-numbered-document-span-parser.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-arrow-numbered-source-span-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-assembly-source-observation-shapes.ts", maxLines: 175 },
  { file: "packages/core/src/semantic-c-like-source-line-shapes.ts", maxLines: 150 },
  { file: "packages/core/src/semantic-c-like-source-observation-shapes.ts", maxLines: 175 },
  { file: "packages/core/src/semantic-clipped-read-window-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-kernel-log-shapes.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-panic-diagnostic-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-procedural-observation-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-python-diagnostic-shapes.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-line-numbered-document-observation-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-line-numbered-document-span-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-listing-body-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-listing-entry-shapes.ts", maxLines: 100 },
  { file: "packages/core/src/semantic-listing-observation-shapes.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-numbered-source-observation-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-numbered-source-span-shapes.ts", maxLines: 175 },
  { file: "packages/core/src/semantic-observation-shapes.ts", maxLines: 150 },
  { file: "packages/core/src/semantic-payload-observation-shapes.ts", maxLines: 285 },
  { file: "packages/core/src/semantic-owned-observation-payload-shapes.ts", maxLines: 400 },
  { file: "packages/core/src/semantic-owned-read-observation-shapes.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-owned-read-transport-numbering.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-read-observation-shapes.ts", maxLines: 50 },
  {
    file: "packages/core/src/semantic-recovered-command-output-observation-shapes.ts",
    maxLines: 75,
  },
  {
    file: "packages/core/src/semantic-recovered-command-source-observation-shapes.ts",
    maxLines: 75,
  },
  { file: "packages/core/src/semantic-resolution-polarity.ts", maxLines: 225 },
  { file: "packages/core/src/semantic-single-listing-observation-shapes.ts", maxLines: 100 },
  { file: "packages/core/src/semantic-source-header-observation-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-source-literal-wrapper-shapes.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-source-observation-shapes.ts", maxLines: 175 },
  { file: "packages/core/src/semantic-source-quality.ts", maxLines: 60 },
  { file: "packages/core/src/semantic-source-statement-shapes.ts", maxLines: 225 },
  { file: "packages/core/src/semantic-source-window-limit-shapes.ts", maxLines: 60 },
  { file: "packages/core/src/semantic-sectioned-source-observation-shapes.ts", maxLines: 25 },
  { file: "packages/core/src/semantic-structured-output-ownership.ts", maxLines: 35 },
  { file: "packages/core/src/semantic-structured-output.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-test-output-observation-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-test-runner-output-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-test-result-section-shapes.ts", maxLines: 100 },
  { file: "packages/core/src/semantic-test-section-parser.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-terminal-evidence.ts", maxLines: 175 },
  { file: "packages/core/src/semantic-tool-output-diagnostic-shapes.ts", maxLines: 50 },
  { file: "packages/core/src/semantic-tool-use-rejection-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-truncated-structured-output-recovery.ts", maxLines: 175 },
  { file: "packages/core/src/semantic-truncated-structured-output.ts", maxLines: 175 },
  { file: "packages/core/src/semantic-search-observation-shapes.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-task-failure-signals.ts", maxLines: 200 },
  { file: "packages/core/src/semantic-text.ts", maxLines: 75 },
  { file: "packages/core/src/semantic-tool-family.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-types.ts", maxLines: 125 },
  { file: "packages/core/src/semantic-unified-diff-observation-shapes.ts", maxLines: 35 },
  { file: "packages/core/src/semantic.ts", maxLines: 60 },
  { file: "packages/core/src/policy/semantic-uncertainty-criterion-rule.ts", maxLines: 175 },
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
  { file: "packages/lab/src/fstop-cli-corpus.ts", maxLines: 100 },
  { file: "packages/lab/src/fstop-cli-review.ts", maxLines: 325 },
  { file: "packages/lab/src/fstop-cli-review-candidates.ts", maxLines: 75 },
  { file: "packages/lab/src/fstop-cli-ingest.ts", maxLines: 175 },
  { file: "packages/lab/src/fstop-cli-gc.ts", maxLines: 175 },
  { file: "packages/lab/src/fstop-cli-shared.ts", maxLines: 100 },
  { file: "packages/lab/src/fstop-cli-args.ts", maxLines: 125 },
  { file: "packages/lab/src/fstop-cli-args-autoresearch.ts", maxLines: 500 },
  { file: "packages/lab/src/fstop-cli-args-corpus.ts", maxLines: 150 },
  { file: "packages/lab/src/fstop-cli-args-support.ts", maxLines: 250 },
  { file: "packages/lab/src/fstop-cli-args-review.ts", maxLines: 325 },
  { file: "packages/lab/src/fstop-cli-args-review-candidates.ts", maxLines: 125 },
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
  { file: "packages/lab/src/semantic-review-candidates.ts", maxLines: 325 },
  { file: "packages/lab/src/semantic-review-candidate-accumulator.ts", maxLines: 100 },
  { file: "packages/lab/src/semantic-review-candidate-input.ts", maxLines: 275 },
  { file: "packages/lab/src/semantic-review-candidate-policy.ts", maxLines: 400 },
  { file: "packages/lab/src/semantic-review-candidate-render.ts", maxLines: 150 },
  { file: "packages/lab/src/semantic-review-candidate-types.ts", maxLines: 150 },
  { file: "packages/lab/src/semantic-review-coverage-baseline.ts", maxLines: 125 },
  { file: "packages/lab/src/semantic-review-coverage-ledger.ts", maxLines: 275 },
  { file: "packages/lab/src/semantic-review-coverage-ledger-render.ts", maxLines: 120 },
  { file: "packages/lab/src/semantic-review-coverage-signatures.ts", maxLines: 225 },
  { file: "packages/lab/src/semantic-review-coverage-ledger-types.ts", maxLines: 125 },
  { file: "packages/lab/src/semantic-review-event-shape-support.ts", maxLines: 75 },
  { file: "packages/lab/src/semantic-review-failure-event-shapes.ts", maxLines: 200 },
  { file: "packages/lab/src/semantic-review-failure-evidence.ts", maxLines: 225 },
  { file: "packages/lab/src/semantic-review-failure-evidence-retention.ts", maxLines: 125 },
  { file: "packages/lab/src/semantic-review-failure-evidence-render.ts", maxLines: 125 },
  { file: "packages/lab/src/semantic-review-failure-evidence-types.ts", maxLines: 100 },
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
  { file: "packages/lab/src/public-trajectories-trace-commons.ts", maxLines: 75 },
  { file: "packages/lab/src/public-trajectories-trace-commons-fetch.ts", maxLines: 175 },
  { file: "packages/lab/src/public-trajectories-trace-commons-parse.ts", maxLines: 375 },
  { file: "packages/lab/src/public-trajectories-trace-commons-import.ts", maxLines: 525 },
  { file: "packages/lab/src/public-trajectories-trace-commons-support.ts", maxLines: 275 },
  { file: "packages/lab/src/public-trajectories-swe-smith.ts", maxLines: 75 },
  { file: "packages/lab/src/public-trajectories-swe-smith-fetch.ts", maxLines: 200 },
  { file: "packages/lab/src/public-trajectories-swe-smith-import.ts", maxLines: 400 },
  { file: "packages/lab/src/public-corpus-fetch-body.ts", maxLines: 100 },
  { file: "packages/lab/src/public-corpus-fetch-policy.ts", maxLines: 125 },
  { file: "packages/lab/src/public-corpus-ledger-format.ts", maxLines: 75 },
  { file: "packages/lab/src/public-corpus-ledger-integrity.ts", maxLines: 125 },
  { file: "packages/lab/src/public-corpus-ledger.ts", maxLines: 300 },
  { file: "packages/lab/src/public-corpus-manifest-validation.ts", maxLines: 175 },
  { file: "packages/lab/src/public-corpus-manifest.ts", maxLines: 375 },
  { file: "packages/lab/src/public-corpus-runner-records.ts", maxLines: 175 },
  { file: "packages/lab/src/public-corpus-runner-plan.ts", maxLines: 125 },
  { file: "packages/lab/src/public-corpus-runner-support.ts", maxLines: 275 },
  { file: "packages/lab/src/public-corpus-runner.ts", maxLines: 175 },
  { file: "packages/lab/src/public-corpus-trace-commons-source.ts", maxLines: 100 },
  { file: "packages/lab/src/session-bundle.ts", maxLines: 100 },
  { file: "packages/lab/src/session-bundle-model.ts", maxLines: 325 },
  { file: "packages/lab/src/session-bundle-scenarios.ts", maxLines: 150 },
  { file: "packages/lab/src/session-bundle-files.ts", maxLines: 125 },
  { file: "packages/lab/src/session-bundle-capture.ts", maxLines: 350 },
  { file: "packages/lab/src/scenario.ts", maxLines: 300 },
  { file: "packages/lab/src/runner.ts", maxLines: 300 },
  { file: "packages/lab/src/replay-decision-snapshot.ts", maxLines: 175 },
  { file: "packages/lab/src/judgment-bench.ts", maxLines: 875 },
  { file: "packages/lab/src/judgment-bench-decision.ts", maxLines: 275 },
  { file: "packages/lab/src/determinism.ts", maxLines: 350 },
  { file: "packages/lab/src/determinism-decision.ts", maxLines: 125 },
  { file: "packages/lab/src/kernel-canonical-json.ts", maxLines: 100 },
  { file: "packages/lab/src/kernel-conformance.ts", maxLines: 250 },
  { file: "packages/lab/src/kernel-conformance-decision-output.ts", maxLines: 75 },
  { file: "packages/lab/src/kernel-conformance-support.ts", maxLines: 275 },
  { file: "packages/lab/src/kernel-corpus-conformance.ts", maxLines: 150 },
  { file: "packages/lab/src/kernel-corpus-profile.ts", maxLines: 100 },
  { file: "packages/lab/src/kernel-corpus-profile-data.ts", maxLines: 100 },
  { file: "packages/lab/src/kernel-corpus-quality.ts", maxLines: 175 },
  { file: "packages/lab/src/kernel-decision-contract.ts", maxLines: 175 },
  { file: "packages/lab/src/kernel-decision-contract-support.ts", maxLines: 250 },
  { file: "packages/lab/src/kernel-decision-value.ts", maxLines: 75 },
  { file: "packages/lab/src/kernel-decision-projection.ts", maxLines: 225 },
  { file: "packages/lab/src/kernel-profile.ts", maxLines: 75 },
  { file: "packages/lab/src/replay-trace.ts", maxLines: 75 },
  { file: "packages/lab/src/validation.ts", maxLines: 75 },
  { file: "packages/lab/src/validation-events.ts", maxLines: 350 },
  { file: "packages/lab/src/validation-replay.ts", maxLines: 450 },
  { file: "packages/lab/src/validation-replay-decision.ts", maxLines: 175 },
  { file: "packages/lab/src/validation-replay-decision-support.ts", maxLines: 150 },
  { file: "packages/lab/src/validation-trace.ts", maxLines: 100 },
  { file: "packages/lab/src/validation-support.ts", maxLines: 350 },
] as const;

async function main(): Promise<void> {
  const violations: Array<{ file: string; lineCount: number; maxLines: number }> = [];
  const missingBudgetFiles: string[] = [];
  const aggregateViolations: Array<{ label: string; value: number; max: number }> = [];
  const budgetedFiles = new Set(budgets.map((budget) => budget.file));

  for (const budget of budgets) {
    const absolutePath = resolve(repoRoot, budget.file);
    const lineCount = await readLineCount(absolutePath);
    if (lineCount > budget.maxLines) {
      violations.push({
        file: budget.file,
        lineCount,
        maxLines: budget.maxLines,
      });
    }
  }

  const semanticFiles = await collectCoreSemanticFiles();
  let semanticLineCount = 0;
  let semanticMatcherSiteCount = 0;
  let semanticPhraseLiteralCount = 0;
  for (const file of semanticFiles) {
    const relativeFile = relative(repoRoot, file);
    const text = await readFile(file, "utf8");
    if (!budgetedFiles.has(relativeFile)) {
      missingBudgetFiles.push(relativeFile);
    }
    semanticLineCount += text.split("\n").length;
  }
  const semanticMatcherFiles = await collectSemanticMatcherGovernedFiles();
  for (const file of semanticMatcherFiles) {
    const text = await readFile(file, "utf8");
    semanticMatcherSiteCount += countSemanticMatcherSites(text);
    semanticPhraseLiteralCount += countSemanticPhraseLiterals(text);
  }
  const observationPrimitiveLineCount = await countObservationPrimitiveLines();
  const taskFailureParsingLineCount = await countTaskFailureParsingLines();
  if (semanticFiles.length > SEMANTIC_MODULE_COUNT_BUDGET) {
    aggregateViolations.push({
      label: "packages/core/src/semantic*.ts module count",
      value: semanticFiles.length,
      max: SEMANTIC_MODULE_COUNT_BUDGET,
    });
  }
  if (semanticLineCount > SEMANTIC_LINE_COUNT_BUDGET) {
    aggregateViolations.push({
      label: "packages/core/src/semantic*.ts total lines",
      value: semanticLineCount,
      max: SEMANTIC_LINE_COUNT_BUDGET,
    });
  }
  if (semanticMatcherSiteCount > SEMANTIC_MATCHER_SITE_BUDGET) {
    aggregateViolations.push({
      label: "packages/core/src semantic parser matcher sites",
      value: semanticMatcherSiteCount,
      max: SEMANTIC_MATCHER_SITE_BUDGET,
    });
  }
  if (semanticPhraseLiteralCount > SEMANTIC_PHRASE_LITERAL_BUDGET) {
    aggregateViolations.push({
      label: "packages/core/src semantic parser phrase literals",
      value: semanticPhraseLiteralCount,
      max: SEMANTIC_PHRASE_LITERAL_BUDGET,
    });
  }
  if (observationPrimitiveLineCount > OBSERVATION_PRIMITIVE_LINE_COUNT_BUDGET) {
    aggregateViolations.push({
      label: "packages/core/src observation primitive total lines",
      value: observationPrimitiveLineCount,
      max: OBSERVATION_PRIMITIVE_LINE_COUNT_BUDGET,
    });
  }
  if (taskFailureParsingLineCount > TASK_FAILURE_PARSING_LINE_COUNT_BUDGET) {
    aggregateViolations.push({
      label: "packages/core/src task-failure parsing total lines",
      value: taskFailureParsingLineCount,
      max: TASK_FAILURE_PARSING_LINE_COUNT_BUDGET,
    });
  }

  if (
    violations.length === 0 &&
    missingBudgetFiles.length === 0 &&
    aggregateViolations.length === 0
  ) {
    return;
  }

  const lines = ["Module budget check failed.", ""];

  if (violations.length > 0) {
    lines.push("These files exceeded their line-count budgets:", "");
    for (const violation of violations) {
      lines.push(
        `- ${relative(repoRoot, resolve(repoRoot, violation.file))}: ${violation.lineCount} lines (budget ${violation.maxLines})`,
      );
    }
    lines.push("");
  }

  if (missingBudgetFiles.length > 0) {
    lines.push("These semantic core modules are missing explicit budgets:", "");
    for (const file of missingBudgetFiles) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (aggregateViolations.length > 0) {
    lines.push("These aggregate budgets were exceeded:", "");
    for (const violation of aggregateViolations) {
      lines.push(`- ${violation.label}: ${violation.value} (budget ${violation.max})`);
    }
    lines.push("");
  }

  lines.push(
    "Split command shells, parser/usage surfaces, or mapper families before adding more logic to these files.",
  );
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = 1;
}

export async function collectCoreSemanticFiles(root = repoRoot): Promise<string[]> {
  const directory = resolve(root, "packages/core/src");
  const files = await collectTypeScriptFiles(directory);
  return files.filter((file) => isCoreSemanticModule(root, file)).sort();
}

export async function collectSemanticMatcherGovernedFiles(root = repoRoot): Promise<string[]> {
  const files = new Set(await collectCoreSemanticFiles(root));
  for (const file of semanticMatcherGovernanceFiles) {
    files.add(resolve(root, file));
  }
  return [...files].sort();
}

export async function countObservationPrimitiveLines(root = repoRoot): Promise<number> {
  let lineCount = 0;
  for (const file of observationPrimitiveBudgetFiles) {
    lineCount += await readLineCount(resolve(root, file));
  }
  return lineCount;
}

export async function countTaskFailureParsingLines(root = repoRoot): Promise<number> {
  let lineCount = 0;
  for (const file of taskFailureParsingBudgetFiles) {
    lineCount += await readLineCount(resolve(root, file));
  }
  return lineCount;
}

export function countSemanticMatcherSites(text: string): number {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .reduce((count, line) => count + countLineSemanticMatcherSites(line), 0);
}

export function countSemanticPhraseLiterals(text: string): number {
  const phraseArrayPattern =
    /\b(?:export\s+)?const\s+[A-Z0-9_]*(?:PHRASES|NEGATIONS)\s*=\s*\[([\s\S]*?)\]\s*as const/g;
  return [...text.matchAll(phraseArrayPattern)].reduce(
    (count, match) => count + countStringLiterals(stripCommentLines(match[1] ?? "")),
    0,
  );
}

function countLineSemanticMatcherSites(line: string): number {
  const regexLiteralSites = line.match(/\/(?![/*])(?:\\.|[^/\\\r\n])+\/[dgimsuvy]*/g)?.length ?? 0;
  const dynamicRegexSites = line.match(/\bnew RegExp\s*\(/g)?.length ?? 0;
  const phraseMatcherSites = line.match(/\bcontainsAnySemanticPhrase\s*\(/g)?.length ?? 0;
  return regexLiteralSites + dynamicRegexSites + phraseMatcherSites;
}

function stripCommentLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function countStringLiterals(text: string): number {
  return text.match(/(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/g)?.length ?? 0;
}

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTypeScriptFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readLineCount(file: string): Promise<number> {
  const text = await readFile(file, "utf8");
  return text.split("\n").length;
}

function isCoreSemanticModule(root: string, file: string): boolean {
  const relativeFile = relative(root, file).replace(/\\/g, "/");
  const basename = relativeFile.split("/").at(-1) ?? "";
  return /^packages\/core\/src\/semantic\//.test(relativeFile) || /^semantic.*\.ts$/.test(basename);
}

if (process.argv[1] === scriptPath) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
