export const IMPLIED_OPERATOR_ASKS = [
  "need your input",
  "need your approval",
  "need your review",
  "need your sign off",
  "need your sign-off",
  "should i continue",
  "can you approve",
  "can you review",
  "what should i do",
] as const;

export const IMPLIED_OPERATOR_NEGATIONS = [
  "no action needed",
  "no approval needed",
  "approval is not needed",
  "approval not needed",
  "sign off not needed",
  "sign-off not needed",
  "no input needed",
  "for awareness only",
  "for your awareness",
  "continuing automatically",
] as const;

export const EXPLICIT_BLOCKING_PHRASES = [
  "cannot continue",
  "can't continue",
  "cannot proceed",
  "can't proceed",
  "unable to continue",
  "unable to proceed",
  "blocked on",
  "blocked until",
  "stuck on",
  "requires operator input before continuing",
  "needs operator input before continuing",
  "must be provided before continuing",
] as const;

export const EXPLICIT_WAITING_PHRASES = [
  "waiting for approval",
  "approval required",
  "awaiting approval",
  "waiting on approval",
  "pending approval",
  "waiting for input",
  "awaiting input",
  "waiting on input",
  "awaiting review",
  "waiting for review",
] as const;

export const HIGH_RISK_PHRASES = [
  "production",
  "prod",
  "force push",
  "git push --force",
  "rm -rf",
  "drop table",
  "delete database",
  "delete prod",
  "sudo",
  "chmod 777",
  "kill process",
  "migrate",
] as const;

export const OBSERVATIONAL_READBACK_PHRASES = [
  "result of running cat -n",
  "result of running sed -n",
  "result of running grep",
  "result of running ls",
  "result of running find",
  "here s the result of running cat -n",
  "here s the result of running sed -n",
] as const;

export const OBSERVATIONAL_PAYLOAD_PHRASES = [
  "observation",
  "contents of",
  "showing first",
  "showing top",
  "found",
] as const;

export const TAGGED_FILE_OBSERVATION_PHRASES = [
  "path",
  "type file",
  "content",
] as const;

export const ROUTINE_SUCCESS_PHRASES = [
  "ran successfully and did not produce any output",
  "command ran successfully and did not produce any output",
  "completed successfully and did not produce any output",
] as const;

export const LOG_LIKE_OBSERVATION_PHRASES = [
  "tool-output",
  "dmesg",
] as const;

export const BUILD_METADATA_PHRASES = [
  "makefile",
  "spdx-license-identifier",
  "patchlevel",
  "sublevel",
  "extraversion",
] as const;

export const PATH_LIKE_TOKEN_PATTERN = /(?:^|\s)\/[a-z0-9._-]+(?:\/[a-z0-9._-]+)+(?:\s|$)/;
export const SEARCH_RESULT_OUTPUT_PATTERN = /\bfound\s+\d+\s+match(?:es)?\b|\bshowing\s+(?:first|top)\s+\d+\b|\bmatch(?:es)?\s+in\s+\d+\s+files?\b/;
export const CODE_CONTENT_PATTERN = /\b(import|from|export|class|def|function|const|let|var|return)\b/;
export const LINE_NUMBERED_CODE_PATTERN = /\b\d+\s+(?:import|from|export|class|def|function|const|let|var|return)\b/;
export const SOURCE_CODE_PATH_PATTERN = /\/[a-z0-9._/-]+\.(?:c|cc|cpp|cxx|h|hpp|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift)(?:\b|\/)/;
export const SOURCE_CODE_FILENAME_PATTERN = /\b[a-z0-9.-]+\.(?:c|cc|cpp|cxx|h|hpp|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift)\b/;
export const SOURCE_CODE_CONTENT_PATTERN = /\b(static|struct|enum|typedef|void|int|char|bool|return)\b/;
export const LINE_NUMBERED_SOURCE_CODE_PATTERN = /\b\d+\s+(?:static|struct|enum|typedef|void|int|char|bool|return)\b/;
export const LOG_OUTPUT_PATTERN = /\b\d+\s+\[\s*\d+\.\d+\]\s+[a-z0-9_.:-]+/;
export const BUILD_METADATA_PATTERN = /\b(?:version|patchlevel|sublevel|extraversion)\b/;

export const EXPECTED_DIAGNOSTIC_FAILURE_PHRASES = [
  "form is valid false",
  "form without instance is valid false",
  "form errors",
  "errorlist",
  "decompress result",
] as const;

export const TERMINAL_FAILURE_PHRASES = [
  "traceback",
  "exception",
  "permission denied",
  "command not found",
  "segmentation fault",
] as const;

export const REPEAT_PHRASES = [
  "still",
  "again",
  "back again",
  "came back",
  "continues",
  "continuing",
  "returned",
  "returning",
  "remains",
  "persisting",
  "retrying",
  "recurred",
] as const;

export const NEGATED_REPEAT_PHRASES = [
  "did not repeat",
  "didn t repeat",
  "did not return",
  "didn t return",
  "did not recur",
  "didn t recur",
  "not repeated",
  "not returning",
  "not recurring",
  "no repeat",
] as const;

export const DIRECT_RESOLVE_PHRASES = [
  "resolved",
  "fixed",
  "unblocked",
  "no longer blocked",
] as const;

export const NEGATED_RESOLVE_PHRASES = [
  "not resolved",
  "did not resolve",
  "didn t resolve",
  "not fixed",
  "did not fix",
  "didn t fix",
  "not recovered",
  "did not recover",
  "didn t recover",
] as const;

export const CONTEXTUAL_RESOLVE_PHRASES = [
  "recovered",
  "completed successfully",
  "succeeded after",
] as const;

export const SUPERSEDE_PHRASES = [
  "instead",
  "supersedes",
  "superseded",
  "replaced by",
  "use this plan instead",
  "follow this plan instead",
] as const;

export const ESCALATE_PHRASES = [
  "worse",
  "worsened",
  "escalating",
  // Intentional overlap: a regression is both a continuing issue signal and an
  // escalation signal, so it appears in both families.
  "regression",
  "regressed",
  "spread",
  "broader impact",
  "degraded further",
  "critical now",
  "now failing",
] as const;

export const NEGATED_ESCALATE_PHRASES = [
  "did not regress",
  "didn t regress",
  "no regression",
  "not worsening",
  "did not worsen",
  "didn t worsen",
  "not escalating",
  "did not escalate",
  "didn t escalate",
] as const;

export const ISSUE_SIGNAL_PHRASES = [
  "fail",
  "failed",
  "failing",
  "failure",
  "error",
  "broken",
  "blocked",
  "stalled",
  "stall",
  "incident",
  "issue",
  "outage",
  "degraded",
  "regression",
  "retry",
  "rollback",
] as const;
