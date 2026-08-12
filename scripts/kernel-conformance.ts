import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertKernelConformanceReportPassed,
  buildKernelConformanceReport,
  serializeKernelCanonicalJson,
} from "../packages/lab/src/index.js";

const DEFAULT_REPORT_PATH = "packages/lab/conformance/kernel-v3.json";

async function main(): Promise<void> {
  const reportPath = path.resolve(DEFAULT_REPORT_PATH);
  const report = await buildKernelConformanceReport();
  assertKernelConformanceReportPassed(report);
  const expected = `${serializeKernelCanonicalJson(report)}\n`;

  if (process.argv.includes("--write")) {
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, expected, "utf8");
    return;
  }

  const actual = await readFile(reportPath, "utf8");
  if (actual !== expected) {
    process.stderr.write(
      `Kernel conformance report is stale. Run: pnpm kernel:conformance:write\n`,
    );
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
