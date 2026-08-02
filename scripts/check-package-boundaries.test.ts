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
      "packages/core/src/attention-raw-reader-alias.ts",
      "import { readTaskFailureSemanticEvidence as readRawFailure } from './semantic-evidence.js';\nexport function reads(event: unknown) { return readRawFailure(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return semanticEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-bracket.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return semanticEvidence['readTaskFailureSemanticEvidence'](event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-alias.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { const localSemanticEvidence = semanticEvidence; return localSemanticEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-alias-order.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return localSemanticEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\nconst localSemanticEvidence = semanticEvidence;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-function-alias-order.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return rawReader(event as never) !== null; }\nconst rawReader = semanticEvidence.readTaskFailureSemanticEvidence;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-assignment-order.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return assignedSemanticEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\nlet assignedSemanticEvidence: typeof semanticEvidence;\nassignedSemanticEvidence = semanticEvidence;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-function-assignment-order.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return assignedRawReader(event as never) !== null; }\nlet assignedRawReader: typeof semanticEvidence.readTaskFailureSemanticEvidence;\nassignedRawReader = semanticEvidence.readTaskFailureSemanticEvidence;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-function-object-assignment.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return assignedRawReader(event as never) !== null; }\nlet assignedRawReader: typeof semanticEvidence.readTaskFailureSemanticEvidence;\n({ readTaskFailureSemanticEvidence: assignedRawReader } = semanticEvidence);\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-member-assignment.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nconst holder: { rawReader?: typeof semanticEvidence.readTaskFailureSemanticEvidence } = {};\nholder.rawReader = semanticEvidence.readTaskFailureSemanticEvidence;\nexport function reads(event: unknown) { return holder.rawReader?.(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-member-bracket-assignment.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nconst holder: { rawReader?: typeof semanticEvidence.readTaskFailureSemanticEvidence } = {};\nholder['rawReader'] = semanticEvidence.readTaskFailureSemanticEvidence;\nexport function reads(event: unknown) { return holder['rawReader']?.(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-member-assignment.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nconst holder: { rawEvidence?: typeof semanticEvidence } = {};\nholder.rawEvidence = semanticEvidence;\nexport function reads(event: unknown) { return holder.rawEvidence?.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-value-context.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\ndeclare function accept(value: unknown): unknown;\nconst embedded = { reader: semanticEvidence.readTaskFailureSemanticEvidence, namespace: semanticEvidence };\nconst tuple = [semanticEvidence.readTaskFailureSemanticEvidence, semanticEvidence];\nexport function reads() { return accept(semanticEvidence.readTaskFailureSemanticEvidence) ?? accept(embedded) ?? tuple; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-arrow-return.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nconst provide = () => semanticEvidence.readTaskFailureSemanticEvidence;\nexport function reads(event: unknown) { return provide()(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-logical-assignment.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nlet reader: typeof semanticEvidence.readTaskFailureSemanticEvidence | undefined;\nreader ||= semanticEvidence.readTaskFailureSemanticEvidence;\nreader ??= semanticEvidence.readTaskFailureSemanticEvidence;\nreader &&= semanticEvidence.readTaskFailureSemanticEvidence;\nexport function reads(event: unknown) { return reader?.(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-parameter-default.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown, reader = semanticEvidence.readTaskFailureSemanticEvidence) { return reader(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-class-field.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport class Holder { reader = semanticEvidence.readTaskFailureSemanticEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-wrapped-value.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\ndeclare const fallback: unknown;\nconst provided = semanticEvidence.readTaskFailureSemanticEvidence || fallback;\nexport function reads() { return provided; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-tagged-template.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport const tagged = semanticEvidence.readTaskFailureSemanticEvidence`raw`;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-comma-call.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return (0, semanticEvidence.readTaskFailureSemanticEvidence)(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-method-call.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { return semanticEvidence.readTaskFailureSemanticEvidence.call(undefined, event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-new-call.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport const instance = new semanticEvidence.readTaskFailureSemanticEvidence(undefined as never);\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-yield.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function* reads() { yield semanticEvidence.readTaskFailureSemanticEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-throw.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads() { throw semanticEvidence; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-dynamic-import.ts",
      "export async function reads(event: unknown) { const { readTaskFailureSemanticEvidence } = await import('./semantic-evidence.js'); return readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-inline-dynamic-import.ts",
      "export async function reads(event: unknown) { return (await import('./semantic-evidence.js')).readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-class-heritage.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nclass ReaderInvoker extends semanticEvidence.readTaskFailureSemanticEvidence {}\nexport const instance = new ReaderInvoker(undefined as never);\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-destructure.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { const { readTaskFailureSemanticEvidence: rawReader } = semanticEvidence; return rawReader(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-computed-destructure.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nexport function reads(event: unknown) { const { ['readTaskFailureSemanticEvidence']: rawReader } = semanticEvidence; return rawReader(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-barrel.ts",
      "export { readTaskFailureSemanticEvidence as readRawTaskFailure } from './semantic-evidence.js';\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-barrel.ts",
      "import { readRawTaskFailure } from './raw-evidence-barrel.js';\nexport function reads(event: unknown) { return readRawTaskFailure(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-barrel-namespace.ts",
      "import * as rawEvidence from './raw-evidence-barrel.js';\nexport function reads(event: unknown) { return rawEvidence.readRawTaskFailure(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-default-barrel.ts",
      "export { readTaskFailureSemanticEvidence as default } from './semantic-evidence.js';\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-default-barrel.ts",
      "import readDefaultRawTaskFailure from './raw-evidence-default-barrel.js';\nexport function reads(event: unknown) { return readDefaultRawTaskFailure(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-local-barrel.ts",
      "import { readTaskFailureSemanticEvidence as localRawTaskFailureReader } from './semantic-evidence.js';\nexport { localRawTaskFailureReader };\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-local-barrel.ts",
      "import { localRawTaskFailureReader } from './raw-evidence-local-barrel.js';\nexport function reads(event: unknown) { return localRawTaskFailureReader(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-local-default-barrel.ts",
      "import { readTaskFailureSemanticEvidence as localRawTaskFailureReader } from './semantic-evidence.js';\nexport default localRawTaskFailureReader;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-local-default-barrel.ts",
      "import localRawTaskFailureReader from './raw-evidence-local-default-barrel.js';\nexport function reads(event: unknown) { return localRawTaskFailureReader(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-local-alias-default-barrel.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nconst localRawTaskFailureReader = semanticEvidence.readTaskFailureSemanticEvidence;\nexport default localRawTaskFailureReader;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-local-alias-default-barrel.ts",
      "import localRawTaskFailureReader from './raw-evidence-local-alias-default-barrel.js';\nexport function reads(event: unknown) { return localRawTaskFailureReader(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-namespace-local-barrel.ts",
      "import * as localRawEvidence from './semantic-evidence.js';\nexport { localRawEvidence };\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-local-barrel.ts",
      "import { localRawEvidence } from './raw-evidence-namespace-local-barrel.js';\nexport function reads(event: unknown) { return localRawEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-nested-namespace-local-barrel.ts",
      "import * as rawEvidenceNamespace from './raw-evidence-namespace-local-barrel.js';\nexport function reads(event: unknown) { return rawEvidenceNamespace.localRawEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-nested-namespace-local-barrel-bracket.ts",
      "import * as rawEvidenceNamespace from './raw-evidence-namespace-local-barrel.js';\nexport function reads(event: unknown) { return rawEvidenceNamespace['localRawEvidence']['readTaskFailureSemanticEvidence'](event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-nested-namespace-local-barrel-destructure.ts",
      "import * as rawEvidenceNamespace from './raw-evidence-namespace-local-barrel.js';\nexport function reads(event: unknown) { const { localRawEvidence: { readTaskFailureSemanticEvidence: rawReader } } = rawEvidenceNamespace; return rawReader(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-namespace-local-default-barrel.ts",
      "import * as localRawEvidence from './semantic-evidence.js';\nexport default localRawEvidence;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-local-default-barrel.ts",
      "import localRawEvidence from './raw-evidence-namespace-local-default-barrel.js';\nexport function reads(event: unknown) { return localRawEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-namespace-alias-default-barrel.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nconst localRawEvidence = semanticEvidence;\nexport default localRawEvidence;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-alias-default-barrel.ts",
      "import localRawEvidence from './raw-evidence-namespace-alias-default-barrel.js';\nexport function reads(event: unknown) { return localRawEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-namespace-assignment-default-barrel.ts",
      "import * as semanticEvidence from './semantic-evidence.js';\nlet localRawEvidence: typeof semanticEvidence;\nlocalRawEvidence = semanticEvidence;\nexport default localRawEvidence;\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-namespace-assignment-default-barrel.ts",
      "import localRawEvidence from './raw-evidence-namespace-assignment-default-barrel.js';\nexport function reads(event: unknown) { return localRawEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/raw-evidence-star-namespace-barrel.ts",
      "export * as sourceRawEvidence from './semantic-evidence.js';\n",
    );
    await writeRepoFile(
      root,
      "packages/core/src/attention-raw-reader-star-namespace-barrel.ts",
      "import { sourceRawEvidence } from './raw-evidence-star-namespace-barrel.js';\nexport function reads(event: unknown) { return sourceRawEvidence.readTaskFailureSemanticEvidence(event as never) !== null; }\n",
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
      "packages/core/src/task-failure-observation-reader.ts",
      "import { readTaskFailureSemanticEvidence } from './semantic-evidence.js';\nexport function read(event: unknown) { const raw = readTaskFailureSemanticEvidence(event as never); return raw?.kind; }\n",
    );

    const result = await checkPackageBoundaries(root);

    assert.deepEqual(result.importViolations, []);
    assert.deepEqual(result.corpusLabelViolations, []);
    assert.equal(result.judgmentInputViolations.length, 52);
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("readTaskFailureSemanticEvidence(event as never)"),
      ),
      true,
    );
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
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("readRawFailure(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "semanticEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "semanticEvidence['readTaskFailureSemanticEvidence'](event as never)",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "localSemanticEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.filter((violation) =>
        violation.matches.includes(
          "localSemanticEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ).length >= 2,
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "assignedSemanticEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("assignedRawReader(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "holder.rawReader = semanticEvidence.readTaskFailureSemanticEvidence",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "holder['rawReader'] = semanticEvidence.readTaskFailureSemanticEvidence",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("holder.rawEvidence = semanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-value-context\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-arrow-return\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-logical-assignment\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-parameter-default\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-class-field\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-wrapped-value\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-tagged-template\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-comma-call\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-method-call\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-new-call\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-yield\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-throw\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-dynamic-import\.ts$/.test(violation.file) &&
          violation.matches.includes("readTaskFailureSemanticEvidence(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-inline-dynamic-import\.ts$/.test(violation.file) &&
          violation.matches.some(
            (match) =>
              match.includes("semantic-evidence.js") &&
              match.includes("readTaskFailureSemanticEvidence"),
          ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some(
        (violation) =>
          /attention-raw-reader-class-heritage\.ts$/.test(violation.file) &&
          violation.matches.includes("semanticEvidence.readTaskFailureSemanticEvidence"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("rawReader(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("['readTaskFailureSemanticEvidence']: rawReader"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("readDefaultRawTaskFailure(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("localRawTaskFailureReader(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.filter((violation) =>
        violation.matches.includes("localRawTaskFailureReader(event as never)"),
      ).length >= 3,
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("rawEvidence.readRawTaskFailure(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes("readRawTaskFailure(event as never)"),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "localRawEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.filter((violation) =>
        violation.matches.includes(
          "localRawEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ).length >= 3,
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "rawEvidenceNamespace.localRawEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "rawEvidenceNamespace['localRawEvidence']['readTaskFailureSemanticEvidence'](event as never)",
        ),
      ),
      true,
    );
    assert.equal(
      result.judgmentInputViolations.filter((violation) =>
        violation.matches.includes("rawReader(event as never)"),
      ).length >= 2,
      true,
    );
    assert.equal(
      result.judgmentInputViolations.some((violation) =>
        violation.matches.includes(
          "sourceRawEvidence.readTaskFailureSemanticEvidence(event as never)",
        ),
      ),
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
