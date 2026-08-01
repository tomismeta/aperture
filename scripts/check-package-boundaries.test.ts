import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { checkPackageBoundaries, renderBoundaryCheckReport } from "./check-package-boundaries.ts";

test("boundary checker rejects corpus labels in production core", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/semantic-dataclaw.ts",
      'export const dataset = "dataclaw";\n',
    );

    const result = await checkPackageBoundaries(root);

    assert.equal(result.importViolations.length, 0);
    assert.equal(result.corpusLabelViolations.length, 1);
    assert.match(
      result.corpusLabelViolations[0]?.file ?? "",
      /packages\/core\/src\/semantic-dataclaw\.ts$/,
    );
    assert.deepEqual(result.corpusLabelViolations[0]?.labels, ["DataClaw"]);

    const report = renderBoundaryCheckReport(root, result);
    assert.match(report, /Production core contains corpus-specific labels/);
    assert.match(report, /generalized event-shape predicates/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary checker allows corpus labels in Lab and tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/lab/src/public-trajectories-dataclaw.ts",
      'export const dataset = "dataclaw";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/test/semantic-normalization.test.ts",
      'const source = "swe-smith";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-general-shape.ts",
      'export const shape = "source evidence truncated";\n',
    );

    const result = await checkPackageBoundaries(root);

    assert.deepEqual(result.importViolations, []);
    assert.deepEqual(result.corpusLabelViolations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary checker rejects sibling package implementation imports from core", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/semantic-cross-package.ts",
      'import { mapCodexServerRequest } from "../../codex/src/index.js";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic/nested-cross-package.ts",
      'import { mapOpencodeEvent } from "../../../opencode/src/index.js";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic/deep/normalized-cross-package.ts",
      'import { mapClaudeCodeHookEvent } from "../../../../claude-code/./src/index.js";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-package-import.ts",
      'import { createCodexBridge } from "@aperture/codex";\n',
    );

    const result = await checkPackageBoundaries(root);

    assert.equal(result.importViolations.length, 4);
    assert.deepEqual(
      result.importViolations.map((violation) => violation.label).sort(),
      [
        "sibling package implementation from production core",
        "sibling package implementation from production core",
        "sibling package implementation from production core",
        "sibling workspace package from production core",
      ].sort(),
    );
    assert.match(renderBoundaryCheckReport(root, result), /Keep production core independent/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary checker rejects adapter implementation imports from core tests", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/test/semantic-normalization.test.ts",
      'import { mapOpencodeEvent } from "../../opencode/src/index.js";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/test/nested/semantic-normalization.test.ts",
      'import { mapClaudeCodeHookEvent } from "../../../claude-code/./src/index.js";\n',
    );
    await writeRepoFile(
      root,
      "packages/core/test/semantic-parity.test.ts",
      'import { mapCodexServerRequest } from "@aperture/codex";\n',
    );

    const result = await checkPackageBoundaries(root);

    assert.equal(result.importViolations.length, 3);
    assert.deepEqual(
      result.importViolations.map((violation) => violation.label).sort(),
      [
        "adapter implementation from core tests",
        "adapter implementation from core tests",
        "adapter workspace package from core tests",
      ].sort(),
    );
    assert.match(renderBoundaryCheckReport(root, result), /Adapter parity belongs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary checker rejects raw judgment failure evidence outside the normalization seam", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/policy/semantic-raw-policy.ts",
      "export function reads(candidate: { judgmentInput: { failureEvidence?: unknown } }) { return candidate.judgmentInput.failureEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/judgment-input.ts",
      "export function compat(judgmentInput: { failureEvidence?: unknown }) { return judgmentInput.failureEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-policy.ts",
      "export function bracket(judgmentInput: Record<string, unknown>) { return judgmentInput['failureEvidence']; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-planner.ts",
      "export function destructure(candidate: { judgmentInput: { failureEvidence?: unknown } }) { const { failureEvidence } = candidate.judgmentInput; return failureEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-value.ts",
      "export function nested(candidate: { judgmentInput: { failureEvidence?: unknown } }) { const { judgmentInput: { failureEvidence } } = candidate; return failureEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-optional.ts",
      "export function optional(candidate: { judgmentInput?: { failureEvidence?: unknown } }) { return candidate.judgmentInput?.failureEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-alias.ts",
      "export function alias(candidate: { judgmentInput: { failureEvidence?: unknown } }) { const input = candidate.judgmentInput; return input.failureEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-param.ts",
      "export function param({ judgmentInput: { failureEvidence } }: { judgmentInput: { failureEvidence?: unknown } }) { return failureEvidence; }\n",
    );

    const result = await checkPackageBoundaries(root);

    assert.deepEqual(result.importViolations, []);
    assert.deepEqual(result.corpusLabelViolations, []);
    assert.equal(result.judgmentInputViolations.length, 8);
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/policy\/semantic-raw-policy\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/judgment-input\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/attention-policy\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/attention-planner\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/attention-value\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/attention-optional\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/attention-alias\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        /packages\/core\/src\/attention-param\.ts$/.test(violation.file),
      ),
      true,
    );
    assert.match(renderBoundaryCheckReport(root, result), /observation/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary checker returns no raw judgment failure evidence violations for clean core", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/policy/semantic-ir-policy.ts",
      "export function reads(candidate: { judgmentInput: { observation?: unknown } }) { return candidate.judgmentInput.observation; }\n",
    );

    const result = await checkPackageBoundaries(root);

    assert.deepEqual(result.importViolations, []);
    assert.deepEqual(result.corpusLabelViolations, []);
    assert.deepEqual(result.judgmentInputViolations, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("boundary checker rejects raw task-failure evidence member reads outside the observation seam", async () => {
  const root = await mkdtemp(join(tmpdir(), "aperture-boundaries-"));
  try {
    await writeRepoFile(
      root,
      "packages/core/src/semantic-interpreter.ts",
      "import { readTaskFailureSemanticEvidence } from './semantic-evidence.js';\nexport function reads(event: unknown) { const raw = readTaskFailureSemanticEvidence(event as never); const alias = raw; return alias?.kind; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-bracket.ts",
      "import { readTaskFailureSemanticEvidence } from './semantic-evidence.js';\nexport function reads(event: unknown) { const raw = readTaskFailureSemanticEvidence(event as never); return raw?.['terminalShape']; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-destructure.ts",
      "import { readTaskFailureSemanticEvidence } from './semantic-evidence.js';\nexport function reads(event: unknown) { const raw = readTaskFailureSemanticEvidence(event as never); const { consequenceBaseline } = raw as never; return consequenceBaseline; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-typed-param.ts",
      "import type { TaskFailureSemanticEvidence } from './semantic-evidence.js';\nexport function reads(raw: TaskFailureSemanticEvidence) { return raw.text; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/semantic-evidence.ts",
      "export type TaskFailureSemanticEvidence = { readsAsObservation: boolean };\nexport function read(failureEvidence: TaskFailureSemanticEvidence) { return failureEvidence.readsAsObservation; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-observation-core.ts",
      "import type { TaskFailureSemanticEvidence } from './semantic-evidence.js';\nexport function normalize(evidence: TaskFailureSemanticEvidence & { kind: string }) { return evidence.kind; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/task-failure-evidence-observation-grammar.ts",
      "import type { TaskFailureSemanticEvidence } from './semantic-evidence.js';\nexport function normalize(evidence: TaskFailureSemanticEvidence & { kind: string }) { return evidence.kind; }\n",
    );

    const result = await checkPackageBoundaries(root);

    assert.deepEqual(result.importViolations, []);
    assert.deepEqual(result.corpusLabelViolations, []);
    assert.equal(result.judgmentInputViolations.length, 4);
    assert.equal(
      result.judgmentInputViolations.some((violation) => violation.matches.includes("alias?.kind")),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("raw?.['terminalShape']"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("consequenceBaseline"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) => violation.matches.includes("raw.text")),
      true,
    );
    assert.match(renderBoundaryCheckReport(root, result), /observation document/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRepoFile(root: string, relativePath: string, content: string): Promise<void> {
  const file = resolve(root, relativePath);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}
