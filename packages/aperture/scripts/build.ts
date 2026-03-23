import { chmod, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(PACKAGE_ROOT, "dist");
const ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "cli.ts");
const OUTFILE = path.join(DIST_DIR, "cli.js");

await rm(DIST_DIR, { recursive: true, force: true });

await build({
  entryPoints: [ENTRY_POINT],
  outfile: OUTFILE,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
  packages: "bundle",
  legalComments: "none",
  banner: {
    js: "#!/usr/bin/env node",
  },
});

const built = await readFile(OUTFILE, "utf8");
const shebang = "#!/usr/bin/env node\n";
if (!built.startsWith(shebang)) {
  await writeFile(OUTFILE, `${shebang}${built}`, "utf8");
}
await chmod(OUTFILE, 0o755);
