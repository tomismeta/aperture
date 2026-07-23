import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ReplayScenario } from "./scenario.js";
import { compareKernelCanonicalKey } from "./kernel-canonical-json.js";
import { validateReplayScenario } from "./validation.js";

export const DEFAULT_GOLDEN_SCENARIOS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../golden",
);

export const DEFAULT_HARVESTED_SCENARIOS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../harvested",
);

export async function loadGoldenScenarios(
  directory: string = DEFAULT_GOLDEN_SCENARIOS_DIR,
): Promise<ReplayScenario[]> {
  const scenarios = await loadReplayScenarios(directory);
  return scenarios.sort((left, right) => compareKernelCanonicalKey(left.id, right.id));
}

export async function loadHarvestedScenarios(
  directory: string = DEFAULT_HARVESTED_SCENARIOS_DIR,
): Promise<ReplayScenario[]> {
  const scenarios = await loadReplayScenarios(directory);
  return scenarios.sort((left, right) => compareKernelCanonicalKey(left.id, right.id));
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
      scenarios.push(...(await readScenarioDirectory(absolutePath)));
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const raw = await readFile(absolutePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(
        `Failed to parse replay scenario at ${absolutePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const scenario = validateReplayScenario(parsed);
    if (!scenario) {
      throw new Error(`Invalid replay scenario at ${absolutePath}`);
    }

    scenarios.push(scenario);
  }

  return scenarios;
}

function safeScenarioFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}
