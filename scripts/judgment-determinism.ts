import { runDeterminismAudit } from "@aperture/lab";

async function main(): Promise<void> {
  const audit = await runDeterminismAudit();

  process.stdout.write(
    [
      `Judgment determinism scenarios: ${audit.summary.totalScenarios}`,
      `stable: ${audit.summary.stableScenarios}`,
      `drifted: ${audit.summary.driftedScenarios}`,
      `determinism score: ${(audit.summary.determinismScore * 100).toFixed(1)}%`,
      ...audit.scenarios
        .filter((scenario) => !scenario.stable)
        .map((scenario) => `drift: ${scenario.scenario.id} -> ${scenario.driftAreas.join(", ")}`),
    ].join("\n") + "\n",
  );
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
