import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const packageDir = join(repoRoot, "packages", "aperture");
  const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const tempRoot = await mkdtemp(join(tmpdir(), "aperture-omp-contract-consumer-"));
  const packDir = join(tempRoot, "pack");
  const consumerDir = join(tempRoot, "consumer");
  const tarballName = `${packageJson.name.replace(/^@/, "").replaceAll("/", "-")}-${packageJson.version}.tgz`;
  const tarballPath = join(packDir, tarballName);

  try {
    run("pnpm", ["--dir", packageDir, "pack", "--pack-destination", packDir], repoRoot);
    const entries = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
    assert.match(entries, /package\/dist\/omp-attention-event\.js/);
    assert.match(entries, /package\/dist\/omp-attention-event\.d\.ts/);
    assert.match(entries, /package\/dist\/omp-attention-event\.schema\.json/);
    assert.doesNotMatch(entries, /package\/src\//);

    await mkdir(consumerDir, { recursive: true });
    await writeFile(
      join(consumerDir, "package.json"),
      `${JSON.stringify({
        name: "omp-attention-contract-consumer",
        private: true,
        type: "module",
        dependencies: { "@tomismeta/aperture": `file:${tarballPath}` },
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(consumerDir, "tsconfig.json"),
      `${JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2022",
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["contract.ts"],
      })}\n`,
      "utf8",
    );
    await writeFile(
      join(consumerDir, "contract.ts"),
      `import { assertOmpAttentionEvent, type OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";\nconst input: OmpAttentionEvent = { schemaVersion: 1, type: "omp.attention-event", eventId: "event-1", occurredAt: "2026-09-01T16:00:00.000Z", sessionId: "session;opaque", interactionId: "tool-1", classification: "approval_requested", title: "OMP needs approval", summary: "OMP is waiting for an operator decision.", transition: "requested" };\nassertOmpAttentionEvent(input);\n`,
      "utf8",
    );
    await writeFile(
      join(consumerDir, "index.mjs"),
      `import assert from "node:assert/strict";\nimport { assertOmpAttentionEvent, resolveOmpAttentionSocketPath } from "@tomismeta/aperture/omp-attention-event";\nimport schema from "@tomismeta/aperture/omp-attention-event.schema.json" with { type: "json" };\nconst event = assertOmpAttentionEvent({ schemaVersion: 1, type: "omp.attention-event", eventId: "event-1", occurredAt: "2026-09-01T16:00:00.000Z", sessionId: "session;$(opaque)", interactionId: "tool-1", classification: "approval_requested", title: "OMP needs approval", summary: "OMP is waiting for an operator decision.", transition: "requested" });\nassert.equal(event.sessionId, "session;$(opaque)");\nassert.equal(schema.$id, "urn:tomismeta:aperture:omp-attention-event:v1");\nassert.equal(resolveOmpAttentionSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }), "/run/user/1000/omarchy/aperture/attention.sock");\n`,
      "utf8",
    );
    run("pnpm", ["install", "--offline"], consumerDir);
    run(join(repoRoot, "node_modules", ".bin", "tsc"), ["--noEmit"], consumerDir);
    run("node", ["index.mjs"], consumerDir);
    process.stdout.write("OMP attention contract consumer proof passed\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, npm_config_ignore_scripts: "false" },
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
