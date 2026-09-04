import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import { isDirectExecution } from "./direct-execution.js";

const executeFile = promisify(execFileCallback);
const OSV_BATCH_ENDPOINT = "https://api.osv.dev/v1/querybatch";
const OSV_BATCH_LIMIT = 1_000;
const AUDIT_TIMEOUT_MILLISECONDS = 30_000;
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const LOCAL_VERSION_PREFIXES = ["link:", "workspace:", "file:"] as const;

type JsonRecord = Record<string, unknown>;
type FetchImplementation = typeof fetch;

export type ProductionPackage = {
  name: string;
  version: string;
};

export type OsvFinding = ProductionPackage & {
  id: string;
  summary?: string;
};

export function collectProductionPackages(value: unknown): ProductionPackage[] {
  if (!Array.isArray(value)) throw new Error("pnpm list did not return a project array");

  const pending: Array<{ declaredName: string; value: unknown }> = [];
  for (const [index, projectValue] of value.entries()) {
    const project = requireRecord(projectValue, `pnpm project ${index}`);
    appendDependencies(pending, project.dependencies, `pnpm project ${index} dependencies`);
    appendDependencies(
      pending,
      project.optionalDependencies,
      `pnpm project ${index} optionalDependencies`,
    );
  }

  const packages = new Map<string, ProductionPackage>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const dependency = requireRecord(current.value, `dependency ${current.declaredName}`);
    appendDependencies(pending, dependency.dependencies, `${current.declaredName} dependencies`);
    appendDependencies(
      pending,
      dependency.optionalDependencies,
      `${current.declaredName} optionalDependencies`,
    );

    const version = dependency.version;
    if (typeof version !== "string" || version.length === 0) {
      throw new Error(`dependency ${current.declaredName} has no version`);
    }
    if (LOCAL_VERSION_PREFIXES.some((prefix) => version.startsWith(prefix))) continue;
    if (!EXACT_VERSION_PATTERN.test(version)) {
      throw new Error(`dependency ${current.declaredName} is not pinned to an exact npm version`);
    }

    const from = dependency.from;
    const name = typeof from === "string" && from.length > 0 ? from : current.declaredName;
    if (!isNpmPackageName(name))
      throw new Error(`dependency ${current.declaredName} has an invalid name`);
    packages.set(`${name}\u0000${version}`, { name, version });
  }

  return [...packages.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

export function parseOsvBatchResponse(
  value: unknown,
  packages: readonly ProductionPackage[],
): OsvFinding[] {
  const response = requireRecord(value, "OSV response");
  if (!Array.isArray(response.results) || response.results.length !== packages.length) {
    throw new Error("OSV response did not match the submitted dependency batch");
  }

  const findings: OsvFinding[] = [];
  for (const [index, resultValue] of response.results.entries()) {
    const result = requireRecord(resultValue, `OSV result ${index}`);
    if (result.next_page_token !== undefined) {
      throw new Error(`OSV result ${index} was paginated; the audit cannot be complete`);
    }
    if (result.vulns === undefined) continue;
    if (!Array.isArray(result.vulns))
      throw new Error(`OSV result ${index} has invalid vulnerabilities`);
    for (const [vulnerabilityIndex, vulnerabilityValue] of result.vulns.entries()) {
      const vulnerability = requireRecord(
        vulnerabilityValue,
        `OSV result ${index} vulnerability ${vulnerabilityIndex}`,
      );
      if (typeof vulnerability.id !== "string" || vulnerability.id.length === 0) {
        throw new Error(`OSV result ${index} has a vulnerability without an id`);
      }
      const summary =
        typeof vulnerability.summary === "string" && vulnerability.summary.length > 0
          ? vulnerability.summary
          : undefined;
      findings.push({ ...packages[index], id: vulnerability.id, ...(summary ? { summary } : {}) });
    }
  }
  return findings;
}

export async function auditProductionPackages(
  packages: readonly ProductionPackage[],
  fetchImplementation: FetchImplementation = fetch,
): Promise<OsvFinding[]> {
  const findings: OsvFinding[] = [];
  for (let offset = 0; offset < packages.length; offset += OSV_BATCH_LIMIT) {
    const batch = packages.slice(offset, offset + OSV_BATCH_LIMIT);
    const response = await fetchImplementation(OSV_BATCH_ENDPOINT, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        queries: batch.map(({ name, version }) => ({
          package: { ecosystem: "npm", name },
          version,
        })),
      }),
      signal: AbortSignal.timeout(AUDIT_TIMEOUT_MILLISECONDS),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OSV audit request failed with HTTP ${response.status}: ${detail}`);
    }
    findings.push(...parseOsvBatchResponse(await response.json(), batch));
  }
  return findings;
}

export async function runProductionDependencyAudit(): Promise<void> {
  const { stdout } = await executeFile(
    "pnpm",
    ["list", "--recursive", "--prod", "--json", "--depth", "Infinity", "--lockfile-only"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  const graph: unknown = JSON.parse(stdout);
  const packages = collectProductionPackages(graph);
  if (packages.length === 0) {
    throw new Error("Production dependency graph contained no auditable npm packages");
  }
  const findings = await auditProductionPackages(packages);
  if (findings.length > 0) {
    const details = findings
      .map(({ name, version, id, summary }) =>
        [`${name}@${version}`, id, summary].filter((part) => part !== undefined).join(" — "),
      )
      .join("\n");
    throw new Error(`Production dependency vulnerabilities found:\n${details}`);
  }
  console.log(
    `Production dependency audit passed: ${packages.length} exact package version${packages.length === 1 ? "" : "s"} checked via OSV`,
  );
}

function appendDependencies(
  pending: Array<{ declaredName: string; value: unknown }>,
  value: unknown,
  context: string,
): void {
  if (value === undefined) return;
  const dependencies = requireRecord(value, context);
  for (const [declaredName, dependency] of Object.entries(dependencies)) {
    pending.push({ declaredName, value: dependency });
  }
}

function requireRecord(value: unknown, context: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} was not an object`);
  }
  return value as JsonRecord;
}

function isNpmPackageName(value: string): boolean {
  return value.length <= 214 && !/[\s\\]/u.test(value) && !value.startsWith(".");
}

if (isDirectExecution(import.meta.url)) {
  runProductionDependencyAudit().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
