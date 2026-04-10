import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const budgets = [
  { file: "packages/runtime/src/runtime.ts", maxLines: 900 },
  { file: "packages/core/src/aperture-core.ts", maxLines: 1050 },
  { file: "packages/claude-code/src/mapping.ts", maxLines: 2300 },
  { file: "packages/codex/src/mapping.ts", maxLines: 1300 },
  { file: "packages/lab/src/fstop-cli.ts", maxLines: 900 },
  { file: "packages/lab/src/fstop-cli-args.ts", maxLines: 1500 },
  { file: "packages/lab/src/offline-review.ts", maxLines: 1800 },
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
  lines.push("Split command shells, parser/usage surfaces, or mapper families before adding more logic to these files.");
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exitCode = 1;
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
