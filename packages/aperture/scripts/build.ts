import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const DIST_DIR = path.join(PACKAGE_ROOT, "dist");
const ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "cli.ts");
const OUTFILE = path.join(DIST_DIR, "cli.js");
const SHEBANG = "#!/usr/bin/env -S node --title=aperture";

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
    js: SHEBANG,
  },
});

const built = await readFile(OUTFILE, "utf8");
const normalized = built.replace(/^#!.*$/m, SHEBANG);
if (normalized !== built) {
  await writeFile(OUTFILE, normalized, "utf8");
}
