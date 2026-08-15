import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function run(
  command: string,
  args: string[],
  cwd: string,
  extraEnv: Record<string, string> = {},
): void {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv, npm_config_ignore_scripts: "false" },
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
    const registryDir = join(tempRoot, "registry");
    const tokenPath = join(tempRoot, "token");
    await mkdir(registryDir, { recursive: true });
    await writeFile(tokenPath, "proof\n", { encoding: "utf8", mode: 0o600 });
    await chmod(tokenPath, 0o600);
    await writeFile(
      join(registryDir, "runtime-proof.json"),
      `${JSON.stringify({
        id: "runtime:proof",
        kind: "aperture",
        controlUrl: "http://127.0.0.1:4546/runtime",
        baseUrl: "http://127.0.0.1:4546",
        tokenPath,
        updatedAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
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
      `import type { WorkEvent, WorkResponse, WorkReceipt, WorkResponseAnswer } from "@tomismeta/aperture/work";\nconst valid: WorkEvent = { kind: "work.updated", work: { id: "task:proof", status: "running" }, trace: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" }, run: { sessionId: "session:proof", runId: "run:proof" } };\nconst receipt: WorkReceipt = { ok: true, apiVersion: "1.0", accepted: 1, receivedAs: "event", message: "accepted", published: [] };\nconst response: WorkResponse = { ok: true, apiVersion: "1.0", taskId: "task:proof", interactionId: "interaction:proof", state: "pending", message: "pending", expiresAt: "2026-08-13T00:01:00.000Z" };\nconst answered: WorkResponse = { ok: true, apiVersion: "1.0", taskId: "task:proof", interactionId: "interaction:proof", state: "answered", message: "answered", response: { kind: "approved" }, answeredAt: "2026-08-13T00:01:00.000Z", retentionExpiresAt: "2026-08-13T00:02:00.000Z" };\nconst answer: WorkResponseAnswer = answered.state === "answered" ? answered.response : { kind: "dismissed" };\nconst invalid: WorkEvent = {\n  // @ts-expect-error Work has one supported contract version.\n  specVersion: "1.1",\n  kind: "work.updated",\n  work: { id: "task:proof", status: "running" },\n};\nvoid valid; void receipt; void response; void answered; void answer; void invalid;\n`,
      "utf8",
    );
    await writeFile(
      join(consumerDir, "index.mjs"),
      `import assert from "node:assert/strict";\nimport { ApertureWorkClient, WORK_API_VERSION, WORK_SCHEMA_URL, workEventSchemaDocument } from "@tomismeta/aperture/work";\nassert.equal(WORK_API_VERSION, "1.0");\nassert.equal(WORK_SCHEMA_URL, "https://raw.githubusercontent.com/tomismeta/aperture/aperture-v0.5.0/schemas/work-event.schema.json");\nassert.equal(workEventSchemaDocument().$id, "urn:aperture:work-event:1.0");\nconst answeredInteractionId = "interaction:proof:answered";\nconst cancelledInteractionId = "interaction:proof:cancelled";\nconst reads = new Map();\nconst json = (value) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });\nconst endpoint = { apiVersion: "1.0", path: "/work", method: "POST", summary: "Work", auth: "Bearer", send: [{ receivedAs: "text", contentType: "text/plain", body: "string", bestFor: "simple work", example: "hello" }], response: { path: "/work/response/{interactionId}", deletePath: "/work/response/{interactionId}", bestFor: "poll", states: ["pending", "answered", "expired", "cancelled"] }, retention: { pendingTtlMs: 60000, terminalRetentionMs: 60000, capacity: 32 }, next: [] };\nconst fetchProof = async (input, init) => {\n  const request = new Request(input, init);\n  assert.equal(request.headers.get("authorization"), "Bearer proof");\n  const url = new URL(request.url);\n  if (request.method === "GET" && url.pathname === "/work") return json(endpoint);\n  if (request.method === "POST" && url.pathname === "/work") return json({ ok: true, apiVersion: "1.0", accepted: 1, receivedAs: "text", message: "accepted", published: [] });\n  const match = url.pathname.match(/\\/work\\/response\\/(.+)$/);\n  if (match) {\n    const interactionId = decodeURIComponent(match[1]);\n    const count = (reads.get(interactionId) ?? 0) + 1;\n    reads.set(interactionId, count);\n    if (request.method === "GET") {\n      if (interactionId === answeredInteractionId && count > 1) return json({ ok: true, apiVersion: "1.0", taskId: "task:proof:answered", interactionId, state: "answered", message: "answered", response: { kind: "approved" }, answeredAt: "2026-08-13T00:01:00.000Z", retentionExpiresAt: "2026-08-13T00:02:00.000Z" });\n      return json({ ok: true, apiVersion: "1.0", taskId: "task:proof:" + interactionId.split(":").at(-1), interactionId, state: "pending", message: "pending", expiresAt: "2026-08-13T00:01:00.000Z" });\n    }\n    if (request.method === "DELETE" && interactionId === cancelledInteractionId) return json({ ok: true, apiVersion: "1.0", taskId: "task:proof:cancelled", interactionId, state: "cancelled", message: "cancelled", cancelledAt: "2026-08-13T00:01:00.000Z", retentionExpiresAt: "2026-08-13T00:02:00.000Z" });\n  }\n  throw new Error("Unexpected Work proof request: " + request.method + " " + url.pathname);\n};\nconst client = await ApertureWorkClient.connect({ baseUrl: "http://127.0.0.1:4546", authToken: "proof", fetch: fetchProof });\nassert.equal((await client.describe()).apiVersion, "1.0");\nassert.equal((await client.publish("hello")).accepted, 1);\nassert.equal((await client.readResponse(answeredInteractionId)).state, "pending");\nassert.equal((await client.readResponse(answeredInteractionId)).state, "answered");\nassert.equal((await client.readResponse(cancelledInteractionId)).state, "pending");\nassert.equal((await client.cancelResponse(cancelledInteractionId)).state, "cancelled");\nassert.equal(client.url, "http://127.0.0.1:4546");\nconst discovered = await ApertureWorkClient.connect({ registryDir: process.env.APERTURE_PROOF_REGISTRY, fetch: fetchProof });\nassert.equal(discovered.url, client.url);\n`,
      "utf8",
    );
    run("pnpm", ["install", "--offline"], tempRoot);
    run("pnpm", ["exec", "tsc", "--noEmit"], consumerDir);
    run("node", ["index.mjs"], consumerDir, { APERTURE_PROOF_REGISTRY: registryDir });
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
