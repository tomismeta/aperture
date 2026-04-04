import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packagesRoot = path.join(repoRoot, "packages");
const preservedArtifactNames = new Set([".gitignore", ".gitkeep"]);

type CleanupSummary = {
  buildArtifactCount: number;
  workspaceArtifactCount: number;
  removedRuntimeRoots: string[];
  clearedDirectories: string[];
};

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const cleanBuild = args.size === 0 || args.has("--build");
  const cleanWorkspace = args.has("--workspace");

  const summary: CleanupSummary = {
    buildArtifactCount: 0,
    workspaceArtifactCount: 0,
    removedRuntimeRoots: [],
    clearedDirectories: [],
  };

  if (cleanBuild) {
    await cleanBuildArtifacts(summary);
  }

  if (cleanWorkspace) {
    await cleanWorkspaceArtifacts(summary);
  }

  const lines = [
    cleanBuild ? "Build artifacts cleaned." : "Build artifacts skipped.",
    cleanWorkspace ? "Workspace artifacts cleaned." : "Workspace artifacts skipped.",
  ];

  if (summary.buildArtifactCount > 0) {
    lines.push(`Build directories removed: ${summary.buildArtifactCount}`);
  }

  if (summary.workspaceArtifactCount > 0) {
    lines.push(`Workspace artifact paths removed: ${summary.workspaceArtifactCount}`);
  }

  if (summary.removedRuntimeRoots.length > 0) {
    lines.push("", "Removed runtime roots:");
    for (const runtimeRoot of summary.removedRuntimeRoots) {
      lines.push(`- ${path.relative(repoRoot, runtimeRoot) || "."}`);
    }
  }

  if (summary.clearedDirectories.length > 0) {
    lines.push("", "Cleared tracked artifact directories:");
    for (const directory of summary.clearedDirectories) {
      lines.push(`- ${path.relative(repoRoot, directory) || "."}`);
    }
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}

async function cleanBuildArtifacts(summary: CleanupSummary): Promise<void> {
  await removePath(path.join(repoRoot, "tsconfig.tsbuildinfo"), summary, "build");

  const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
  for (const entry of packageEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageRoot = path.join(packagesRoot, entry.name);

    for (const artifactDirectoryName of ["dist", "public-dist"]) {
      const artifactPath = path.join(packageRoot, artifactDirectoryName);
      await removePath(artifactPath, summary, "build");
    }

    await removePath(path.join(packageRoot, "tsconfig.tsbuildinfo"), summary, "build");

    const packageFiles = await readdir(packageRoot, { withFileTypes: true });
    for (const packageFile of packageFiles) {
      if (!packageFile.isFile() || !packageFile.name.endsWith(".tgz")) {
        continue;
      }

      await removePath(path.join(packageRoot, packageFile.name), summary, "build");
    }
  }
}

async function cleanWorkspaceArtifacts(summary: CleanupSummary): Promise<void> {
  await removePath(path.join(repoRoot, ".aperture", "lab"), summary, "workspace-root");

  await clearTrackedArtifactDirectory(path.join(repoRoot, "packages", "lab", "results"), summary);
  await clearTrackedArtifactDirectory(path.join(repoRoot, "packages", "lab", "bundles"), summary);
}

async function clearTrackedArtifactDirectory(directoryPath: string, summary: CleanupSummary): Promise<void> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  let removedAnyEntry = false;

  for (const entry of entries) {
    if (preservedArtifactNames.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const childRemoved = await clearTrackedArtifactDirectory(entryPath, summary);
      if (childRemoved) {
        removedAnyEntry = true;
      }
      continue;
    }

    await removePath(entryPath, summary, "workspace");
    removedAnyEntry = true;
  }

  const remainingEntries = await readdir(directoryPath, { withFileTypes: true });
  if (remainingEntries.length === 0) {
    await removePath(directoryPath, summary, "workspace");
    return true;
  }

  if (removedAnyEntry) {
    summary.clearedDirectories.push(directoryPath);
  }

  return removedAnyEntry;
}

async function removePath(
  targetPath: string,
  summary: CleanupSummary,
  category: "build" | "workspace" | "workspace-root",
): Promise<void> {
  const existedBefore = await pathExists(targetPath);
  if (!existedBefore) {
    return;
  }

  await rm(targetPath, { recursive: true, force: true });
  if (category === "build") {
    summary.buildArtifactCount += 1;
    return;
  }

  summary.workspaceArtifactCount += 1;
  if (category === "workspace-root") {
    summary.removedRuntimeRoots.push(targetPath);
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
