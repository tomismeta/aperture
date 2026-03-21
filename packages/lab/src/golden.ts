import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ReplayScenario } from "./scenario.js";

export const DEFAULT_GOLDEN_SCENARIOS_DIR = path.resolve(
  process.cwd(),
  "packages/lab/golden",
);

export const DEFAULT_HARVESTED_SCENARIOS_DIR = path.resolve(
  process.cwd(),
  "packages/lab/harvested",
);

export async function loadGoldenScenarios(
  directory: string = DEFAULT_GOLDEN_SCENARIOS_DIR,
): Promise<ReplayScenario[]> {
  const scenarios = await loadReplayScenarios(directory);
  return scenarios.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadHarvestedScenarios(
  directory: string = DEFAULT_HARVESTED_SCENARIOS_DIR,
): Promise<ReplayScenario[]> {
  const scenarios = await loadReplayScenarios(directory);
  return scenarios.sort((left, right) => left.id.localeCompare(right.id));
}

export async function loadReplayScenarios(directory: string): Promise<ReplayScenario[]> {
  return readScenarioDirectory(directory);
}

export async function writeReplayScenario(
  filePath: string,
  scenario: ReplayScenario,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
}

export function defaultHarvestedScenarioPath(
  scenario: ReplayScenario,
  directory: string = DEFAULT_HARVESTED_SCENARIOS_DIR,
): string {
  return path.join(directory, `${safeScenarioFilename(scenario.id)}.json`);
}

async function readScenarioDirectory(directory: string): Promise<ReplayScenario[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const scenarios: ReplayScenario[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      scenarios.push(...await readScenarioDirectory(absolutePath));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const raw = await readFile(absolutePath, "utf8");
    scenarios.push(JSON.parse(raw) as ReplayScenario);
  }

  return scenarios;
}

function safeScenarioFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
