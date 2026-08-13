import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, npm_config_ignore_scripts: "false" },
  });
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const packageDir = join(repoRoot, "packages", "aperture");
  const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const tempRoot = await mkdtemp(join(tmpdir(), "aperture-work-consumer-"));
  const packDir = join(tempRoot, "pack");
  const consumerDir = join(tempRoot, "consumer");
  const tarballName = `${packageJson.name.replace(/^@/, "").replace(/\//g, "-")}-${packageJson.version}.tgz`;
  const tarballPath = join(packDir, tarballName);

  try {
    run("pnpm", ["--dir", packageDir, "pack", "--pack-destination", packDir], repoRoot);
    const entries = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8" });
    assert.match(entries, /package\/dist\/work\.js/);
    assert.match(entries, /package\/dist\/work\.d\.ts/);
    assert.match(entries, /package\/dist\/work-event\.schema\.json/);
    assert.match(entries, /package\/dist\/work-event-batch\.schema\.json/);
    assert.doesNotMatch(entries, /package\/src\//);
    const workJavaScript = execFileSync("tar", ["-xOzf", tarballPath, "package/dist/work.js"], {
      encoding: "utf8",
    });
    assert.doesNotMatch(workJavaScript, /^#!\/usr\/bin\/env node/);
    const declaration = execFileSync("tar", ["-xOzf", tarballPath, "package/dist/work.d.ts"], {
      encoding: "utf8",
    });
    assert.doesNotMatch(declaration, /@aperture\/runtime|workspace:/);

    await writeFile(
      join(tempRoot, "package.json"),
      `${JSON.stringify({ name: "aperture-work-consumer-proof", private: true })}\n`,
      "utf8",
    );
    await writeFile(
      join(tempRoot, "pnpm-workspace.yaml"),
      "packages:\n  - consumer\nautoInstallPeers: false\n",
      "utf8",
    );
    await mkdir(consumerDir, { recursive: true });
    await writeFile(
      join(consumerDir, "package.json"),
      `${JSON.stringify({ name: "consumer", private: true, type: "module", dependencies: { "@tomismeta/aperture": `file:${tarballPath}` }, devDependencies: { typescript: "5.9.3" } })}\n`,
      "utf8",
    );
    await writeFile(
      join(consumerDir, "tsconfig.json"),
      `${JSON.stringify({ compilerOptions: { strict: true, module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022", skipLibCheck: true, noEmit: true }, include: ["index.ts", "types.ts"] })}\n`,
      "utf8",
    );
    await writeFile(
      join(consumerDir, "types.ts"),
      `import type { WorkEvent, WorkResponse, WorkReceipt } from "@tomismeta/aperture/work";\nconst valid: WorkEvent = { kind: "work.updated", work: { id: "task:proof", status: "running" }, trace: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" }, run: { sessionId: "session:proof", runId: "run:proof" } };\nconst receipt: WorkReceipt = { ok: true, apiVersion: "1.0", accepted: 1, receivedAs: "event", message: "accepted", published: [] };\nconst response: WorkResponse = { ok: true, apiVersion: "1.0", taskId: "task:proof", interactionId: "interaction:proof", state: "pending", message: "pending" };\nconst invalid: WorkEvent = {\n  // @ts-expect-error Work has one supported contract version.\n  specVersion: "1.1",\n  kind: "work.updated",\n  work: { id: "task:proof", status: "running" },\n};\nvoid valid; void receipt; void response; void invalid;\n`,
      "utf8",
    );
    await writeFile(
      join(consumerDir, "index.mjs"),
      `import assert from "node:assert/strict";\nimport { ApertureWorkClient, WORK_API_VERSION, workEventSchemaDocument } from "@tomismeta/aperture/work";\nassert.equal(WORK_API_VERSION, "1.0");\nassert.equal(workEventSchemaDocument().$id, "urn:aperture:work-event:1.0");\nconst client = await ApertureWorkClient.connect({ baseUrl: "http://127.0.0.1:4546", authToken: "proof", fetch: async (input, init) => { const request = new Request(input, init); return new Response(request.method === "GET" ? JSON.stringify({ apiVersion: "1.0" }) : JSON.stringify({ ok: true, accepted: 1 }), { status: 200, headers: { "content-type": "application/json" } }); } });\nassert.equal((await client.publish("hello")).accepted, 1);\nassert.equal(client.url, "http://127.0.0.1:4546");\n`,
      "utf8",
    );
    run("pnpm", ["install", "--offline"], tempRoot);
    run("pnpm", ["exec", "tsc", "--noEmit"], consumerDir);
    run("node", ["index.mjs"], consumerDir);
    process.stdout.write("aperture work consumer proof passed\n");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
