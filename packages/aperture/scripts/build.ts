import { chmod, copyFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import { minify } from "terser";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");
const WORKSPACE_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
const DIST_DIR = path.join(PACKAGE_ROOT, "dist");
const ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "cli.ts");
const WORK_ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "work.ts");
const OUTFILE = path.join(DIST_DIR, "cli.js");
const WORK_OUTFILE = path.join(DIST_DIR, "work.js");
const OMP_ATTENTION_EVENT_ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "omp-attention-event.ts");
const OMP_ATTENTION_EVENT_OUTFILE = path.join(DIST_DIR, "omp-attention-event.js");
const FOCUS_HOST_ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "focus-host.ts");
const FOCUS_HOST_OUTFILE = path.join(DIST_DIR, "focus-host.js");
const WORKER_DIRECT_MESSAGE_ENTRY_POINT = path.join(
  PACKAGE_ROOT,
  "src",
  "worker-direct-message.ts",
);
const WORKER_DIRECT_MESSAGE_OUTFILE = path.join(DIST_DIR, "worker-direct-message.js");
const ATTENTION_WORKER_ENTRY_POINT = path.join(PACKAGE_ROOT, "src", "omp-attention-worker.ts");
const ATTENTION_WORKER_OUTFILE = path.join(DIST_DIR, "aperture-attention-engine.cjs");
const ATTENTION_WORKER_IMPORT_REPORT = path.join(
  DIST_DIR,
  "aperture-attention-engine.runtime-imports.json",
);
const OMP_EXTENSION_ENTRY_POINT = path.join(
  WORKSPACE_ROOT,
  "packages",
  "omp",
  "src",
  "omarchy-extension.ts",
);
const OMP_EXTENSION_OUTFILE = path.join(DIST_DIR, "aperture-omp-extension.mjs");
const OMP_EXTENSION_IMPORT_REPORT = path.join(
  DIST_DIR,
  "aperture-omp-extension.runtime-imports.json",
);
const SCHEMA_FILES = [
  "work-event.schema.json",
  "work-event-batch.schema.json",
  "surface-protocol.schema.json",
  "notification-worker-input.schema.json",
  "notification-worker-output.schema.json",
  "omp-worker-output.schema.json",
  "omp-attention-event.schema.json",
  "worker-direct-message.schema.json",
] as const;

await rm(DIST_DIR, { recursive: true, force: true });
const packageMetadata = JSON.parse(
  await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
) as { version?: unknown };
if (typeof packageMetadata.version !== "string" || !packageMetadata.version) {
  throw new Error("Aperture package version is invalid");
}

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

await build({
  ...sharedBuildOptions,
  entryPoints: [OMP_ATTENTION_EVENT_ENTRY_POINT],
  outfile: OMP_ATTENTION_EVENT_OUTFILE,
});
await build({
  ...sharedBuildOptions,
  entryPoints: [WORKER_DIRECT_MESSAGE_ENTRY_POINT],
  outfile: WORKER_DIRECT_MESSAGE_OUTFILE,
});
await build({
  ...sharedBuildOptions,
  entryPoints: [FOCUS_HOST_ENTRY_POINT],
  outfile: FOCUS_HOST_OUTFILE,
});

const attentionWorkerBuild = await build({
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node22",
  packages: "bundle",
  legalComments: "none",
  minify: true,
  define: {
    APERTURE_PACKAGE_VERSION: JSON.stringify(packageMetadata.version),
  },
  metafile: true,
  entryPoints: [ATTENTION_WORKER_ENTRY_POINT],
  outfile: ATTENTION_WORKER_OUTFILE,
});
const forbiddenOmpWorkerInputs = [
  "src/attention-worker.ts",
  "notification-worker/adapter.ts",
  "notification-worker/config.ts",
  "notification-worker/engine.ts",
  "notification-worker/notification-lifecycle.ts",
  "notification-worker/state-store.ts",
  "notification-worker/stdio.ts",
] as const;
const attentionWorkerSourceFiles = Object.keys(attentionWorkerBuild.metafile.inputs).map((input) =>
  input.replaceAll("\\", "/"),
);
for (const forbidden of forbiddenOmpWorkerInputs) {
  if (attentionWorkerSourceFiles.some((input) => input.endsWith(forbidden))) {
    throw new Error(`OMP-only worker retained generic notification module: ${forbidden}`);
  }
}
for (const required of ["src/omp-attention-worker.ts", "notification-worker/omp-stdio.ts"]) {
  if (!attentionWorkerSourceFiles.some((input) => input.endsWith(required))) {
    throw new Error(`OMP-only worker omitted dedicated startup module: ${required}`);
  }
}
const compressedWorker = await minify(await readFile(ATTENTION_WORKER_OUTFILE, "utf8"), {
  compress: { passes: 2 },
  ecma: 2022,
  format: { comments: false },
  mangle: true,
});
if (!compressedWorker.code) {
  throw new Error("attention worker compression produced no output");
}
const dependencyRoots = new Set<string>();
for (const input of attentionWorkerSourceFiles) {
  const dependency = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
  if (dependency) dependencyRoots.add(dependency[1]!);
}
const bundledNotices = await Promise.all(
  [...dependencyRoots].sort().map(async (relativeRoot) => {
    const root = path.resolve(PACKAGE_ROOT, relativeRoot);
    const metadata = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as {
      name: string;
      version: string;
      license: string;
    };
    const license = (await readFile(path.join(root, "LICENSE"), "utf8")).trim();
    return `Package: ${metadata.name}@${metadata.version}\nLicense: ${metadata.license}\n\n${license}\n`;
  }),
);
const thirdPartyNotices =
  "Third-party software bundled in Aperture's attention worker.\n\n" + bundledNotices.join("\n");
if (thirdPartyNotices.includes("*/")) {
  throw new Error("bundled license text cannot be safely embedded in the worker");
}
await writeFile(
  ATTENTION_WORKER_OUTFILE,
  `/*!\n${thirdPartyNotices}*/\n${compressedWorker.code}\n`,
  "utf8",
);
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
      sourceFiles: attentionWorkerSourceFiles.sort(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
const ompExtensionBuild = await build({
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  packages: "bundle",
  legalComments: "none",
  minify: true,
  metafile: true,
  entryPoints: [OMP_EXTENSION_ENTRY_POINT],
  outfile: OMP_EXTENSION_OUTFILE,
});
const ompRuntimeImports = new Set<string>();
for (const output of Object.values(ompExtensionBuild.metafile.outputs)) {
  for (const imported of output.imports) {
    if (!imported.external) continue;
    if (!imported.path.startsWith("node:")) {
      throw new Error(`OMP extension retained a non-builtin runtime import: ${imported.path}`);
    }
    ompRuntimeImports.add(imported.path);
  }
}
await writeFile(
  OMP_EXTENSION_IMPORT_REPORT,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      status: "passed",
      policy: "node-builtins-only",
      imports: [...ompRuntimeImports].sort(),
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
