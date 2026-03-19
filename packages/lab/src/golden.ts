import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ReplayScenario } from "./scenario.js";

export const DEFAULT_GOLDEN_SCENARIOS_DIR = path.resolve(
  process.cwd(),
  "packages/lab/golden",
);

export async function loadGoldenScenarios(
  directory: string = DEFAULT_GOLDEN_SCENARIOS_DIR,
): Promise<ReplayScenario[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const scenarios: ReplayScenario[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const raw = await readFile(absolutePath, "utf8");
    scenarios.push(JSON.parse(raw) as ReplayScenario);
  }

  return scenarios.sort((left, right) => left.id.localeCompare(right.id));
}
