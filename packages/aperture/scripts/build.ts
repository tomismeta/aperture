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
const SCHEMA_FILES = ["work-event.schema.json", "work-event-batch.schema.json"] as const;

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

const built = await readFile(OUTFILE, "utf8");
const shebang = "#!/usr/bin/env node\n";
if (!built.startsWith(shebang)) {
  await writeFile(OUTFILE, `${shebang}${built}`, "utf8");
}
await chmod(OUTFILE, 0o755);

for (const schemaFile of SCHEMA_FILES) {
  await copyFile(path.join(PACKAGE_ROOT, "src", schemaFile), path.join(DIST_DIR, schemaFile));
}
