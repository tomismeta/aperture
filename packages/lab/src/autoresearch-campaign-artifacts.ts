import { access, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  renderAutoresearchFinalReportMarkdown,
  type AutoresearchFinalReport,
  writeAutoresearchFinalReport,
} from "./autoresearch-report.js";
import { removeWorktreeWorkspace } from "./autoresearch-workspace.js";

export type CampaignRunArtifactPayload = {
  runPath?: string;
  runMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedPatchPath?: string;
};

export type CampaignRunPreservedArtifacts = {
  reportPath?: string;
  reportMarkdownPath?: string;
  runPath?: string;
  runMarkdownPath?: string;
  selectedProposalPath?: string;
  selectedProposalMarkdownPath?: string;
  selectedPatchPath?: string;
};

export async function finalizeCampaignRunArtifacts(options: {
  sourceRepo: string;
  runRoot: string;
  repoDir: string;
  outputPath: string;
  runStatusPath: string;
  payload?: CampaignRunArtifactPayload;
  report?: AutoresearchFinalReport;
  reportPath?: string;
  reportMarkdownPath?: string;
  cleanupWorkspace?: () => Promise<void>;
}): Promise<CampaignRunPreservedArtifacts> {
  const cleanupWorkspace = options.cleanupWorkspace
    ?? (() => removeWorktreeWorkspace(options.sourceRepo, options.repoDir));
  const preserved: CampaignRunPreservedArtifacts = {};

  await mkdir(options.runRoot, { recursive: true });

  const runnerRunPath = await copyOptionalArtifact(
    options.repoDir,
    options.payload?.runPath,
    path.join(options.runRoot, "runner-run.json"),
  );
  if (runnerRunPath) {
    preserved.runPath = runnerRunPath;
  }

  const runnerRunMarkdownPath = await copyOptionalArtifact(
    options.repoDir,
    options.payload?.runMarkdownPath,
    path.join(options.runRoot, "runner-run.md"),
  );
  if (runnerRunMarkdownPath) {
    preserved.runMarkdownPath = runnerRunMarkdownPath;
  }

  const selectedProposalPath = await copyOptionalArtifact(
    options.repoDir,
    options.payload?.selectedProposalPath,
    path.join(options.runRoot, "proposal.json"),
  );
  if (selectedProposalPath) {
    preserved.selectedProposalPath = selectedProposalPath;
  }

  const selectedProposalMarkdownPath = selectedProposalPath && options.payload?.selectedProposalPath
    ? await copyAdjacentMarkdownFile(
        resolveRepoArtifactPath(options.repoDir, options.payload.selectedProposalPath),
        path.join(options.runRoot, "proposal.md"),
      )
    : undefined;
  if (selectedProposalMarkdownPath) {
    preserved.selectedProposalMarkdownPath = selectedProposalMarkdownPath;
  }

  const selectedPatchPath = await copyOptionalArtifact(
    options.repoDir,
    options.payload?.selectedPatchPath,
    path.join(options.runRoot, "patch.diff"),
  );
  if (selectedPatchPath) {
    preserved.selectedPatchPath = selectedPatchPath;
  }

  if (options.report && options.reportPath && options.reportMarkdownPath) {
    const report = rewriteFinalReportArtifactPaths(options.report, preserved);
    preserved.reportPath = options.reportPath;
    preserved.reportMarkdownPath = options.reportMarkdownPath;
    await writeAutoresearchFinalReport(options.reportPath, report);
    await writeFile(options.reportMarkdownPath, renderAutoresearchFinalReportMarkdown(report), "utf8");
  }

  await Promise.all([
    safeRemove(options.outputPath),
    safeRemove(options.runStatusPath),
  ]);
  await cleanupWorkspace();

  return preserved;
}

function rewriteFinalReportArtifactPaths(
  report: AutoresearchFinalReport,
  preserved: CampaignRunPreservedArtifacts,
): AutoresearchFinalReport {
  const note = "Transient worktree artifacts were deleted after report synthesis.";
  return {
    ...report,
    source: {
      ...(preserved.runPath ? { runnerRunPath: preserved.runPath } : {}),
      ...(preserved.selectedProposalPath ? { proposalPath: preserved.selectedProposalPath } : {}),
      ...(preserved.selectedPatchPath ? { patchPath: preserved.selectedPatchPath } : {}),
    },
    codeRecommendations: report.codeRecommendations.map((recommendation) => ({
      ...recommendation,
      ...(recommendation.patchPath && preserved.selectedPatchPath
        ? { patchPath: preserved.selectedPatchPath }
        : {}),
    })),
    notes: report.notes.includes(note) ? report.notes : [...report.notes, note],
  };
}

async function copyOptionalArtifact(
  repoDir: string,
  sourcePath: string | undefined,
  destinationPath: string,
): Promise<string | undefined> {
  if (!sourcePath) {
    return undefined;
  }

  const resolvedSourcePath = resolveRepoArtifactPath(repoDir, sourcePath);
  if (!(await pathExists(resolvedSourcePath))) {
    return undefined;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(resolvedSourcePath, destinationPath);
  return destinationPath;
}

async function copyAdjacentMarkdownFile(
  sourceJsonPath: string,
  destinationPath: string,
): Promise<string | undefined> {
  if (!sourceJsonPath || !sourceJsonPath.endsWith(".json")) {
    return undefined;
  }

  const sourceMarkdownPath = sourceJsonPath.replace(/\.json$/i, ".md");
  if (!(await pathExists(sourceMarkdownPath))) {
    return undefined;
  }

  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourceMarkdownPath, destinationPath);
  return destinationPath;
}

function resolveRepoArtifactPath(repoDir: string, artifactPath: string): string {
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(repoDir, artifactPath);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function safeRemove(filePath: string): Promise<void> {
  await rm(filePath, { recursive: true, force: true });
}
