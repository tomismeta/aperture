import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import {
  evaluateApertureKernelEvent,
  type ApertureKernelEvent,
  type ApertureKernelResult,
} from "../packages/core/src/kernel.js";
import { serializeKernelCanonicalJson } from "../packages/lab/src/kernel-canonical-json.js";
import { isDirectExecution } from "./direct-execution.js";

export const KERNEL_SCALE_BENCHMARK_SCHEMA_VERSION = 1 as const;
export const KERNEL_SCALE_BENCHMARK_THRESHOLDS = {
  minimumRounds: 3,
  minimumEvaluations: 30_000,
  minimumRoundThroughputPerSecond: 700,
} as const;

export type KernelScaleBenchmarkRound = {
  round: number;
  evaluations: number;
  durationMs: number;
  throughputPerSecond: number;
  meanLatencyMicroseconds: number;
  resultDigest: string;
};

export type KernelScaleBenchmarkReport = {
  schemaVersion: typeof KERNEL_SCALE_BENCHMARK_SCHEMA_VERSION;
  profile: "aperture-kernel-mixed-events";
  thresholds: typeof KERNEL_SCALE_BENCHMARK_THRESHOLDS;
  passed: boolean;
  failures: string[];
  workload: {
    families: number;
    warmupEvaluations: number;
    rounds: number;
    evaluationsPerRound: number;
    totalEvaluations: number;
  };
  determinism: {
    stable: boolean;
    resultDigest: string;
  };
  performance: {
    minimumThroughputPerSecond: number;
    medianThroughputPerSecond: number;
    medianRoundMeanLatencyMicroseconds: number;
    p95RoundMeanLatencyMicroseconds: number;
  };
  memory: {
    heapUsedBeforeBytes: number;
    heapUsedAfterBytes: number;
    heapUsedDeltaBytes: number;
  };
  rounds: KernelScaleBenchmarkRound[];
};

export type KernelScaleBenchmarkOptions = {
  evaluationsPerRound?: number;
  rounds?: number;
  warmupEvaluations?: number;
};

const WORKLOAD_FAMILIES = 8;

export function runKernelScaleBenchmark(
  options: KernelScaleBenchmarkOptions = {},
): KernelScaleBenchmarkReport {
  const evaluationsPerRound = normalizePositiveInteger(options.evaluationsPerRound, 10_000);
  const rounds = normalizePositiveInteger(options.rounds, 3);
  const warmupEvaluations = normalizePositiveInteger(options.warmupEvaluations, 1_000);

  for (let index = 0; index < warmupEvaluations; index += 1) {
    evaluateApertureKernelEvent(kernelScaleEvent(index));
  }

  const heapUsedBeforeBytes = process.memoryUsage().heapUsed;
  const roundReports: KernelScaleBenchmarkRound[] = [];
  for (let round = 0; round < rounds; round += 1) {
    roundReports.push(runRound(round, evaluationsPerRound));
  }
  const heapUsedAfterBytes = process.memoryUsage().heapUsed;
  const digests = new Set(roundReports.map((round) => round.resultDigest));
  const stable = digests.size === 1;
  const throughputs = roundReports.map((round) => round.throughputPerSecond);
  const latencies = roundReports.map((round) => round.meanLatencyMicroseconds);
  const totalEvaluations = evaluationsPerRound * rounds;
  const failures = collectFailures({ roundReports, rounds, stable, totalEvaluations });

  return {
    schemaVersion: KERNEL_SCALE_BENCHMARK_SCHEMA_VERSION,
    profile: "aperture-kernel-mixed-events",
    thresholds: KERNEL_SCALE_BENCHMARK_THRESHOLDS,
    passed: failures.length === 0,
    failures,
    workload: {
      families: WORKLOAD_FAMILIES,
      warmupEvaluations,
      rounds,
      evaluationsPerRound,
      totalEvaluations,
    },
    determinism: {
      stable,
      resultDigest: roundReports[0]?.resultDigest ?? "",
    },
    performance: {
      minimumThroughputPerSecond: Math.min(...throughputs),
      medianThroughputPerSecond: percentile(throughputs, 0.5),
      medianRoundMeanLatencyMicroseconds: percentile(latencies, 0.5),
      p95RoundMeanLatencyMicroseconds: percentile(latencies, 0.95),
    },
    memory: {
      heapUsedBeforeBytes,
      heapUsedAfterBytes,
      heapUsedDeltaBytes: heapUsedAfterBytes - heapUsedBeforeBytes,
    },
    rounds: roundReports,
  };
}

export function assertKernelScaleBenchmarkPassed(report: KernelScaleBenchmarkReport): void {
  if (!report.passed) {
    throw new Error(`Kernel scale benchmark failed: ${report.failures.join(", ")}`);
  }
}

function runRound(round: number, evaluations: number): KernelScaleBenchmarkRound {
  const digest = createHash("sha256");
  const startedAt = performance.now();
  for (let index = 0; index < evaluations; index += 1) {
    updateResultDigest(digest, evaluateApertureKernelEvent(kernelScaleEvent(index)));
  }
  const durationMs = performance.now() - startedAt;
  return {
    round,
    evaluations,
    durationMs,
    throughputPerSecond: (evaluations * 1_000) / durationMs,
    meanLatencyMicroseconds: (durationMs * 1_000) / evaluations,
    resultDigest: `sha256:${digest.digest("hex")}`,
  };
}

function updateResultDigest(
  digest: ReturnType<typeof createHash>,
  result: ApertureKernelResult,
): void {
  digest.update(serializeKernelCanonicalJson(result));
  digest.update("\n");
}

function kernelScaleEvent(index: number): ApertureKernelEvent {
  const id = `scale:${index}`;
  const base = { id: `event:${id}`, workId: `work:${id}`, occurredAt: "2026-08-12T18:30:00.000Z" };
  switch (index % WORKLOAD_FAMILIES) {
    case 0:
      return workUpdate(
        base,
        "Command status",
        "Your command ran successfully and did not produce any output.",
        "failed",
        "exec_command",
      );
    case 1:
      return workUpdate(
        base,
        "Command result",
        "(no output) Command exited with code 1",
        "failed",
        "bash",
      );
    case 2:
      return workUpdate(
        base,
        "Source read",
        "File content (410KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file.",
        "failed",
        "read",
      );
    case 3:
      return workUpdate(
        base,
        "Runtime result",
        "Traceback (most recent call last): RuntimeError: scale fixture failed",
        "failed",
        "bash",
      );
    case 4:
      return workUpdate(
        base,
        "Search result",
        'Web search results for "kernel": /repo/README.md: Kernel overview',
        "failed",
        "search",
      );
    case 5:
      return workUpdate(
        base,
        "Structured result",
        '{"exit_code":0,"wall_time":"0.125 seconds","output":"/repo/src/app.ts:1:export const value = 1;"}',
        "failed",
        "bash",
      );
    case 6:
      return {
        ...base,
        kind: "input.requested",
        interactionId: `interaction:${id}`,
        title: "Approve change",
        summary: "Apply the prepared change?",
        request: { kind: "approval" },
      };
    default:
      return { ...base, kind: "work.completed", summary: "Work completed." };
  }
}

function workUpdate(
  base: { id: string; workId: string; occurredAt: string },
  title: string,
  summary: string,
  status: "failed",
  capabilityFamily: string,
): ApertureKernelEvent {
  return {
    ...base,
    kind: "work.updated",
    title,
    summary,
    status,
    facts: { capabilityFamily },
  };
}

function collectFailures(input: {
  roundReports: readonly KernelScaleBenchmarkRound[];
  rounds: number;
  stable: boolean;
  totalEvaluations: number;
}): string[] {
  const failures: string[] = [];
  if (input.rounds < KERNEL_SCALE_BENCHMARK_THRESHOLDS.minimumRounds)
    failures.push("kernel_scale:insufficient_rounds");
  if (input.totalEvaluations < KERNEL_SCALE_BENCHMARK_THRESHOLDS.minimumEvaluations)
    failures.push("kernel_scale:insufficient_evaluations");
  if (!input.stable) failures.push("kernel_scale:non_deterministic_results");
  if (
    input.roundReports.some(
      (round) =>
        round.throughputPerSecond <
        KERNEL_SCALE_BENCHMARK_THRESHOLDS.minimumRoundThroughputPerSecond,
    )
  ) {
    failures.push("kernel_scale:throughput_below_floor");
  }
  return failures;
}

function percentile(values: readonly number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value <= 0 ? fallback : value;
}

function renderKernelScaleBenchmark(report: KernelScaleBenchmarkReport): string {
  return [
    `kernel scale: ${report.passed ? "passed" : "failed"}`,
    `evaluations: ${report.workload.totalEvaluations.toLocaleString()} across ${report.workload.rounds} rounds`,
    `deterministic: ${report.determinism.stable ? "yes" : "no"} (${report.determinism.resultDigest})`,
    `throughput: median ${Math.round(report.performance.medianThroughputPerSecond).toLocaleString()}/s, minimum ${Math.round(report.performance.minimumThroughputPerSecond).toLocaleString()}/s`,
    `round mean latency: median ${report.performance.medianRoundMeanLatencyMicroseconds.toFixed(1)}us, p95 ${report.performance.p95RoundMeanLatencyMicroseconds.toFixed(1)}us`,
    `heap delta: ${report.memory.heapUsedDeltaBytes.toLocaleString()} bytes`,
    ...(report.failures.length === 0 ? [] : [`failures: ${report.failures.join(", ")}`]),
  ].join("\n");
}

if (isDirectExecution(import.meta.url)) {
  const report = runKernelScaleBenchmark();
  process.stdout.write(
    process.argv.includes("--json")
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderKernelScaleBenchmark(report)}\n`,
  );
  assertKernelScaleBenchmarkPassed(report);
}
