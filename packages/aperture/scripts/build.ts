import { chmod, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(PACKAGE_ROOT, "dist");
const ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "cli.ts");
const WORK_ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "work.ts");
const OUTFILE = path.join(DIST_DIR, "cli.js");
const WORK_OUTFILE = path.join(DIST_DIR, "work.js");
const ATTENTION_WORKER_ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "attention-worker.ts");
const ATTENTION_WORKER_OUTFILE = path.join(DIST_DIR, "aperture-attention-engine.cjs");
const ATTENTION_WORKER_IMPORT_REPORT = path.join(
  DIST_DIR,
  "aperture-attention-engine.runtime-imports.json",
);
const SCHEMA_FILES = [
  "work-event.schema.json",
  "work-event-batch.schema.json",
  "surface-protocol.schema.json",
  "notification-worker-input.schema.json",
  "notification-worker-output.schema.json",
] as const;

await rm(DIST_DIR, { recursive: true, force: true });

const sharedBuildOptions = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  packages: "bundle",
  legalComments: "none",
} as const;

await build({
  ...sharedBuildOptions,
  entryPoints: [ENTRY_POINT],
  outfile: OUTFILE,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

await build({
  ...sharedBuildOptions,
  entryPoints: [WORK_ENTRY_POINT],
  outfile: WORK_OUTFILE,
});

const attentionWorkerBuild = await build({
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  packages: "bundle",
  legalComments: "none",
  metafile: true,
  entryPoints: [ATTENTION_WORKER_ENTRY_POINT],
  outfile: ATTENTION_WORKER_OUTFILE,
});
const runtimeImports = new Set<string>();
for (const output of Object.values(attentionWorkerBuild.metafile.outputs)) {
  for (const imported of output.imports) {
    if (!imported.external) continue;
    if (!imported.path.startsWith("node:")) {
      throw new Error(`attention worker retained a non-builtin runtime import: ${imported.path}`);
    }
    runtimeImports.add(imported.path);
  }
}
await writeFile(
  ATTENTION_WORKER_IMPORT_REPORT,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      status: "passed",
      policy: "node-builtins-only",
      imports: [...runtimeImports].sort(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
const built = await readFile(OUTFILE, "utf8");
const shebang = "#!/usr/bin/env node\n";
if (!built.startsWith(shebang)) {
  await writeFile(OUTFILE, `${shebang}${built}`, "utf8");
}
await chmod(OUTFILE, 0o755);

for (const schemaFile of SCHEMA_FILES) {
  await copyFile(path.join(PACKAGE_ROOT, "src", schemaFile), path.join(DIST_DIR, schemaFile));
}
