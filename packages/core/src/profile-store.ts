import { join } from "node:path";

import { readFrontmatterFile, writeFrontmatterFile } from "./markdown-frontmatter.js";

export type UserProfile = {
  version: number;
  operatorId: string;
  updatedAt: string;
  preferences?: {
    quietHours?: string[];
    preferBatchingFor?: string[];
    alwaysExpandContextFor?: string[];
    neverAutoApprove?: string[];
  };
  overrides?: {
    tools?: Record<string, Record<string, string | boolean | number>>;
  };
};

export type MemoryProfile = {
  version: number;
  operatorId: string;
  updatedAt: string;
  sessionCount: number;
  toolFamilies?: Record<string, ToolFamilyMemory>;
  sourceTrust?: Record<string, Record<string, SourceTrustMemory>>;
  consequenceProfiles?: Record<string, ConsequenceMemory>;
  lessons?: string[];
};

export type ToolFamilyMemory = {
  presentations: number;
  responses: number;
  dismissals: number;
  avgResponseLatencyMs?: number;
  avgDismissalLatencyMs?: number;
  contextExpansionRate?: number;
  returnAfterDeferralRate?: number;
};

export type SourceTrustMemory = {
  confirmations: number;
  disagreements: number;
  trustAdjustment: number;
};

export type ConsequenceMemory = {
  rejectionRate: number;
};

export class ProfileStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  loadUserProfile(fallback: UserProfile): Promise<UserProfile> {
    return readFrontmatterFile(this.userPath(), fallback);
  }

  loadMemoryProfile(fallback: MemoryProfile): Promise<MemoryProfile> {
    return readFrontmatterFile(this.memoryPath(), fallback);
  }

  saveMemoryProfile(profile: MemoryProfile): Promise<void> {
    return writeFrontmatterFile(
      this.memoryPath(),
      profile,
      "Durable learned summaries and trust calibration.",
    );
  }

  private userPath(): string {
    return join(this.rootDir, "USER.md");
  }

  private memoryPath(): string {
    return join(this.rootDir, "MEMORY.md");
  }
}
