import { join } from "node:path";

import {
  formatBullet,
  formatTextBullet,
  parseBullet,
  parseHeading,
  parseScalar,
  readMarkdownFile,
  writeMarkdownFile,
} from "./markdown-state.js";
import { MARKDOWN_SCHEMA_VERSION } from "./judgment-defaults.js";

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
    return readMarkdownFile(this.userPath(), fallback, parseUserProfile);
  }

  loadMemoryProfile(fallback: MemoryProfile): Promise<MemoryProfile> {
    return readMarkdownFile(this.memoryPath(), fallback, parseMemoryProfile);
  }

  saveMemoryProfile(profile: MemoryProfile): Promise<void> {
    return writeMarkdownFile(this.memoryPath(), serializeMemoryProfile(profile));
  }

  private userPath(): string {
    return join(this.rootDir, "USER.md");
  }

  private memoryPath(): string {
    return join(this.rootDir, "MEMORY.md");
  }
}

function parseUserProfile(content: string): UserProfile | null {
  // TODO: Add explicit migrations if the markdown schema needs a breaking
  // change. For now we keep the format additive and fall back to defaults when
  // required metadata is missing.
  const meta = new Map<string, string[]>();
  const preferences = new Map<string, string[]>();
  const toolOverrides = new Map<string, Record<string, string | boolean | number>>();
  let section: string | null = null;
  let tool: string | null = null;

  for (const line of content.split("\n")) {
    const heading = parseHeading(line);
    if (heading) {
      if (heading.level === 2) {
        section = heading.text;
        tool = null;
      } else if (heading.level === 3 && section === "Tool Overrides") {
        tool = heading.text;
        if (!toolOverrides.has(tool)) {
          toolOverrides.set(tool, {});
        }
      }
      continue;
    }

    const bullet = parseBullet(line);
    if (!bullet || !("key" in bullet)) {
      continue;
    }

    if (section === "Meta") {
      pushValue(meta, bullet.key, bullet.value);
      continue;
    }

    if (section === "Preferences") {
      pushValue(preferences, bullet.key, bullet.value);
      continue;
    }

    if (section === "Tool Overrides" && tool) {
      toolOverrides.set(tool, {
        ...(toolOverrides.get(tool) ?? {}),
        [camelKey(bullet.key)]: parseScalar(bullet.value),
      });
    }
  }

  const operatorId = first(meta, "operator id");
  const updatedAt = first(meta, "updated at");
  const version = numberValue(first(meta, "version"));

  if (!operatorId || !updatedAt || version === null || version !== MARKDOWN_SCHEMA_VERSION) {
    return null;
  }

  return {
    version,
    operatorId,
    updatedAt,
    ...(preferences.size > 0
      ? {
          preferences: {
            ...(readList(preferences, "quiet hours").length > 0 ? { quietHours: readList(preferences, "quiet hours") } : {}),
            ...(readList(preferences, "prefer batching for").length > 0
              ? { preferBatchingFor: readList(preferences, "prefer batching for") }
              : {}),
            ...(readList(preferences, "always expand context for").length > 0
              ? { alwaysExpandContextFor: readList(preferences, "always expand context for") }
              : {}),
            ...(readList(preferences, "never auto approve").length > 0
              ? { neverAutoApprove: readList(preferences, "never auto approve") }
              : {}),
          },
        }
      : {}),
    ...(toolOverrides.size > 0
      ? {
          overrides: {
            tools: Object.fromEntries(toolOverrides.entries()),
          },
        }
      : {}),
  };
}

function parseMemoryProfile(content: string): MemoryProfile | null {
  // TODO: Add explicit migrations if the markdown schema needs a breaking
  // change. For now we keep the format additive and fall back to defaults when
  // required metadata is missing.
  const meta = new Map<string, string[]>();
  const toolFamilies = new Map<string, ToolFamilyMemory>();
  const sourceTrust = new Map<string, Record<string, SourceTrustMemory>>();
  const consequenceProfiles = new Map<string, ConsequenceMemory>();
  const lessons: string[] = [];
  let section: string | null = null;
  let entry: string | null = null;

  for (const line of content.split("\n")) {
    const heading = parseHeading(line);
    if (heading) {
      if (heading.level === 2) {
        section = heading.text;
        entry = null;
      } else if (heading.level === 3) {
        entry = heading.text;
      }
      continue;
    }

    const bullet = parseBullet(line);
    if (!bullet) {
      continue;
    }

    if (section === "Meta" && "key" in bullet) {
      pushValue(meta, bullet.key, bullet.value);
      continue;
    }

    if (section === "Tool Families" && entry && "key" in bullet) {
      toolFamilies.set(entry, {
        ...(toolFamilies.get(entry) ?? emptyToolFamilyMemory()),
        [camelKey(bullet.key)]: parseScalar(bullet.value) as never,
      });
      continue;
    }

    if (section === "Source Trust" && entry && "key" in bullet) {
      const [source, consequence] = entry.split("/").map((value) => value.trim());
      if (!source || !consequence) {
        continue;
      }

      const current = sourceTrust.get(source) ?? {};
      current[consequence] = {
        ...(current[consequence] ?? { confirmations: 0, disagreements: 0, trustAdjustment: 0 }),
        [camelKey(bullet.key)]: parseScalar(bullet.value) as never,
      };
      sourceTrust.set(source, current);
      continue;
    }

    if (section === "Consequence Profiles" && entry && "key" in bullet) {
      consequenceProfiles.set(entry, {
        ...(consequenceProfiles.get(entry) ?? { rejectionRate: 0 }),
        [camelKey(bullet.key)]: parseScalar(bullet.value) as never,
      });
      continue;
    }

    if (section === "Lessons" && "text" in bullet) {
      lessons.push(bullet.text);
    }
  }

  const operatorId = first(meta, "operator id");
  const updatedAt = first(meta, "updated at");
  const version = numberValue(first(meta, "version"));
  const sessionCount = numberValue(first(meta, "session count"));
  if (
    !operatorId
    || !updatedAt
    || version === null
    || version !== MARKDOWN_SCHEMA_VERSION
    || sessionCount === null
  ) {
    return null;
  }

  return {
    version,
    operatorId,
    updatedAt,
    sessionCount,
    ...(toolFamilies.size > 0 ? { toolFamilies: Object.fromEntries(toolFamilies.entries()) } : {}),
    ...(sourceTrust.size > 0 ? { sourceTrust: Object.fromEntries(sourceTrust.entries()) } : {}),
    ...(consequenceProfiles.size > 0
      ? { consequenceProfiles: Object.fromEntries(consequenceProfiles.entries()) }
      : {}),
    ...(lessons.length > 0 ? { lessons } : {}),
  };
}

function serializeMemoryProfile(profile: MemoryProfile): string {
  const lines: string[] = [
    "# Memory",
    "",
    "## Meta",
    formatBullet("version", profile.version),
    formatBullet("operator id", profile.operatorId),
    formatBullet("updated at", profile.updatedAt),
    formatBullet("session count", profile.sessionCount),
  ];

  if (profile.toolFamilies && Object.keys(profile.toolFamilies).length > 0) {
    lines.push("", "## Tool Families");
    for (const [toolFamily, values] of Object.entries(profile.toolFamilies)) {
      lines.push("", `### ${toolFamily}`);
      lines.push(formatBullet("presentations", values.presentations));
      lines.push(formatBullet("responses", values.responses));
      lines.push(formatBullet("dismissals", values.dismissals));
      if (values.avgResponseLatencyMs !== undefined) {
        lines.push(formatBullet("avg response latency ms", values.avgResponseLatencyMs));
      }
      if (values.avgDismissalLatencyMs !== undefined) {
        lines.push(formatBullet("avg dismissal latency ms", values.avgDismissalLatencyMs));
      }
      if (values.contextExpansionRate !== undefined) {
        lines.push(formatBullet("context expansion rate", values.contextExpansionRate));
      }
      if (values.returnAfterDeferralRate !== undefined) {
        lines.push(formatBullet("return after deferral rate", values.returnAfterDeferralRate));
      }
    }
  }

  if (profile.sourceTrust && Object.keys(profile.sourceTrust).length > 0) {
    lines.push("", "## Source Trust");
    for (const [source, levels] of Object.entries(profile.sourceTrust)) {
      for (const [consequence, values] of Object.entries(levels)) {
        lines.push("", `### ${source} / ${consequence}`);
        lines.push(formatBullet("confirmations", values.confirmations));
        lines.push(formatBullet("disagreements", values.disagreements));
        lines.push(formatBullet("trust adjustment", values.trustAdjustment));
      }
    }
  }

  if (profile.consequenceProfiles && Object.keys(profile.consequenceProfiles).length > 0) {
    lines.push("", "## Consequence Profiles");
    for (const [consequence, values] of Object.entries(profile.consequenceProfiles)) {
      lines.push("", `### ${consequence}`);
      lines.push(formatBullet("rejection rate", values.rejectionRate));
    }
  }

  if (profile.lessons && profile.lessons.length > 0) {
    lines.push("", "## Lessons");
    for (const lesson of profile.lessons) {
      lines.push(formatTextBullet(lesson));
    }
  }

  lines.push("");
  return lines.join("\n");
}

function emptyToolFamilyMemory(): ToolFamilyMemory {
  return {
    presentations: 0,
    responses: 0,
    dismissals: 0,
  };
}

function pushValue(target: Map<string, string[]>, key: string, value: string): void {
  const current = target.get(key) ?? [];
  current.push(value);
  target.set(key, current);
}

function first(target: Map<string, string[]>, key: string): string | null {
  return target.get(key)?.[0] ?? null;
}

function readList(target: Map<string, string[]>, key: string): string[] {
  return target.get(key) ?? [];
}

function numberValue(value: string | null): number | null {
  return value !== null && /^-?\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}

function camelKey(value: string): string {
  return value.replace(/\s+([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}
