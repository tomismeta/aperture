import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stdout } from "node:process";

import {
  loadPolicyConfig,
  ProfileStore,
  type ApertureProfile,
  type MemoryProfile,
  type PolicyConfig,
} from "@tomismeta/aperture-core/internal";

import { apertureLearningWorkspaceRoot } from "../opencode-config.js";
import { printConfigHelp } from "./help.js";
import { isMissingFile, pathExists, readRequiredValue } from "./shared.js";

type ConfigDiagnostic = {
  line?: number;
  severity: "warning" | "error";
  message: string;
};

type ConfigSuggestion = {
  title: string;
  reason: string;
  snippet: string[];
};

export type ApertureConfigReport = {
  rootDir: string;
  aperturePath: string;
  memoryPath: string;
  apertureExists: boolean;
  memoryExists: boolean;
  profile: ApertureProfile;
  policyConfig: PolicyConfig;
  memoryProfile: MemoryProfile;
  diagnostics: ConfigDiagnostic[];
  suggestions: ConfigSuggestion[];
};

const PROFILE_FALLBACK_UPDATED_AT = "1970-01-01T00:00:00.000Z";

export async function runConfigCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printConfigHelp();
    return;
  }

  const report = await inspectApertureConfig(readConfigRootArg(args));
  stdout.write(`${formatConfigReport(report)}\n`);
}

export async function inspectApertureConfig(
  rootDir = defaultConfigRoot(),
): Promise<ApertureConfigReport> {
  const resolvedRoot = resolve(rootDir);
  const aperturePath = join(resolvedRoot, "APERTURE.md");
  const memoryPath = join(resolvedRoot, "MEMORY.md");
  const profileStore = new ProfileStore(resolvedRoot);
  const apertureExists = await pathExists(aperturePath);
  const memoryExists = await pathExists(memoryPath);
  const fallbackProfile = defaultApertureProfile();
  const fallbackPolicy = defaultPolicyConfig();
  const fallbackMemory = defaultMemoryProfile();
  const [profile, policyConfig, memoryProfile] = await Promise.all([
    profileStore.loadApertureProfile(fallbackProfile),
    loadPolicyConfig(resolvedRoot, fallbackPolicy),
    profileStore.loadMemoryProfile(fallbackMemory),
  ]);
  const diagnostics = await inspectConfigFile(aperturePath, apertureExists, profile, policyConfig);

  return {
    rootDir: resolvedRoot,
    aperturePath,
    memoryPath,
    apertureExists,
    memoryExists,
    profile,
    policyConfig,
    memoryProfile,
    diagnostics,
    suggestions: suggestPolicySnippets(profile, policyConfig, memoryProfile),
  };
}

export function formatConfigReport(report: ApertureConfigReport): string {
  const lines = [
    "Aperture Config",
    "Human-owned preferences and policy. Aperture never rewrites this file.",
    "",
    "Files",
    `  state dir: ${report.rootDir}`,
    `  APERTURE.md: ${report.apertureExists ? report.aperturePath : "missing"}`,
    `  MEMORY.md: ${report.memoryExists ? report.memoryPath : "missing"}`,
    "",
    "Preferences",
    `  control mode: ${report.profile.preferences?.controlMode ?? "standard"}`,
    "",
    "Policy",
    ...formatPolicyRules(report.policyConfig),
    "",
    "Planner",
    ...formatPlannerDefaults(report.policyConfig),
    "",
    "Suggestions",
    ...formatSuggestions(report.suggestions),
    "",
    "Diagnostics",
    ...formatDiagnostics(report.diagnostics),
  ];

  return lines.join("\n");
}

function readConfigRootArg(args: string[]): string {
  const rootIndex = args.findIndex((arg) => arg === "--root");
  if (rootIndex === -1) {
    return defaultConfigRoot();
  }
  return readRequiredValue("--root", args[rootIndex + 1]);
}

function defaultConfigRoot(): string {
  return resolve(apertureLearningWorkspaceRoot(), ".aperture");
}

async function inspectConfigFile(
  aperturePath: string,
  exists: boolean,
  profile: ApertureProfile,
  policyConfig: PolicyConfig,
): Promise<ConfigDiagnostic[]> {
  if (!exists) {
    return [
      {
        severity: "warning",
        message:
          "APERTURE.md does not exist yet. Run `aperture` with learning enabled to create it.",
      },
    ];
  }

  let content: string;
  try {
    content = await readFile(aperturePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return [
        {
          severity: "warning",
          message: "APERTURE.md disappeared while reading it.",
        },
      ];
    }
    throw error;
  }

  const diagnostics = inspectApertureMarkdown(content);
  if (profile.updatedAt === PROFILE_FALLBACK_UPDATED_AT) {
    diagnostics.push({
      severity: "error",
      message: "Aperture preferences could not be parsed, so defaults are active.",
    });
  }
  if (policyConfig.updatedAt === PROFILE_FALLBACK_UPDATED_AT) {
    diagnostics.push({
      severity: "error",
      message: "Policy rules could not be parsed, so defaults are active.",
    });
  }
  return diagnostics;
}

function inspectApertureMarkdown(content: string): ConfigDiagnostic[] {
  const diagnostics: ConfigDiagnostic[] = [];
  let section: string | null = null;
  let policyRule: string | null = null;
  let toolOverride: string | null = null;

  for (const [index, line] of content.split("\n").entries()) {
    const lineNumber = index + 1;
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line.trim());
    if (heading) {
      const level = heading[1]!.length;
      const text = heading[2]!;
      if (level === 2) {
        section = text;
        policyRule = null;
        toolOverride = null;
        if (!KNOWN_SECTIONS.has(text)) {
          diagnostics.push(warn(lineNumber, `Unknown section "${text}" will be ignored.`));
        }
      } else if (level === 3 && section === "Policy") {
        policyRule = text;
        if (!KNOWN_POLICY_RULES.has(text)) {
          diagnostics.push(
            warn(lineNumber, `Unknown policy rule "${text}" will not affect routing.`),
          );
        }
      } else if (level === 3 && section === "Tool Overrides") {
        toolOverride = text;
      }
      continue;
    }

    const bullet = /^-\s+([^:]+):\s*(.*?)\s*$/.exec(line.trim());
    if (!bullet) {
      continue;
    }

    const key = bullet[1]!;
    const value = bullet[2]!;
    diagnostics.push(...inspectBullet(lineNumber, section, policyRule, toolOverride, key, value));
  }

  return diagnostics;
}

function inspectBullet(
  line: number,
  section: string | null,
  policyRule: string | null,
  toolOverride: string | null,
  key: string,
  value: string,
): ConfigDiagnostic[] {
  switch (section) {
    case "Meta":
      return KNOWN_META_KEYS.has(key)
        ? []
        : [warn(line, `Unknown meta key "${key}" will be ignored.`)];
    case "Preferences":
      return inspectPreference(line, key, value);
    case "Policy":
      return inspectPolicy(line, policyRule, key, value);
    case "Planner Defaults":
      return inspectPlannerDefault(line, key, value);
    case "Ambiguity Defaults":
      return inspectAmbiguityDefault(line, key, value);
    case "Tool Overrides":
      return toolOverride
        ? inspectToolOverride(line, key, value)
        : [warn(line, "Tool override fields need a tool heading.")];
    default:
      return [warn(line, `Field "${key}" is outside a recognized section and will be ignored.`)];
  }
}

function inspectPreference(line: number, key: string, value: string): ConfigDiagnostic[] {
  if (!KNOWN_PREFERENCE_KEYS.has(key)) {
    return [warn(line, `Unknown preference "${key}" will be ignored.`)];
  }
  if (key === "control mode" && !["hands-on", "standard", "focus"].includes(value)) {
    return [warn(line, `Control mode "${value}" is invalid. Use hands-on, standard, or focus.`)];
  }
  return [];
}

function inspectPolicy(
  line: number,
  policyRule: string | null,
  key: string,
  value: string,
): ConfigDiagnostic[] {
  if (!policyRule) {
    return [warn(line, "Policy fields need a rule heading like ### lowRiskRead.")];
  }
  if (!KNOWN_POLICY_FIELDS.has(key)) {
    return [warn(line, `Unknown policy field "${key}" will be ignored.`)];
  }
  return validatePolicyValue(line, key, value);
}

function inspectPlannerDefault(line: number, key: string, value: string): ConfigDiagnostic[] {
  if (!KNOWN_PLANNER_FIELDS.has(key)) {
    return [warn(line, `Unknown planner default "${key}" will be ignored.`)];
  }
  if (key === "batch status bursts" || key === "defer low value during pressure") {
    return validateBoolean(line, key, value);
  }
  if (key === "disabled continuity rules") {
    return [];
  }
  return validateNumber(line, key, value);
}

function inspectAmbiguityDefault(line: number, key: string, value: string): ConfigDiagnostic[] {
  if (!KNOWN_AMBIGUITY_FIELDS.has(key)) {
    return [warn(line, `Unknown ambiguity default "${key}" will be ignored.`)];
  }
  return validateNumber(line, key, value);
}

function inspectToolOverride(line: number, key: string, value: string): ConfigDiagnostic[] {
  if (!KNOWN_TOOL_OVERRIDE_FIELDS.has(key)) {
    return [warn(line, `Unknown tool override field "${key}" will be ignored.`)];
  }
  return validatePolicyValue(line, key, value);
}

function validatePolicyValue(line: number, key: string, value: string): ConfigDiagnostic[] {
  if (key === "minimum lane" || key === "default presentation" || key === "minimum presentation") {
    return ["ambient", "next", "now"].includes(value)
      ? []
      : [warn(line, `${key} must be ambient, next, or now.`)];
  }
  if (key === "score boost") {
    return validateNumber(line, key, value);
  }
  return validateBoolean(line, key, value);
}

function validateBoolean(line: number, key: string, value: string): ConfigDiagnostic[] {
  return value === "true" || value === "false" ? [] : [warn(line, `${key} must be true or false.`)];
}

function validateNumber(line: number, key: string, value: string): ConfigDiagnostic[] {
  return /^-?\d+(?:\.\d+)?$/.test(value) ? [] : [warn(line, `${key} must be a number.`)];
}

function suggestPolicySnippets(
  profile: ApertureProfile,
  policyConfig: PolicyConfig,
  memoryProfile: MemoryProfile,
): ConfigSuggestion[] {
  const suggestions: ConfigSuggestion[] = [];
  maybeSuggestAutoApprove(suggestions, "read", "lowRiskRead", policyConfig, memoryProfile);
  maybeSuggestAutoApprove(suggestions, "web", "lowRiskWeb", policyConfig, memoryProfile);

  const bashMemory = memoryProfile.toolFamilies?.bash;
  if (
    bashMemory &&
    bashMemory.presentations >= 5 &&
    (bashMemory.contextExpansionRate ?? 0) >= 0.6 &&
    policyConfig.policy?.destructiveBash?.requireContextExpansion !== true
  ) {
    suggestions.push({
      title: "Require context before destructive shell work",
      reason: `Bash interactions needed extra context ${Math.round((bashMemory.contextExpansionRate ?? 0) * 100)}% of the time.`,
      snippet: ["### destructiveBash", "- require context expansion: true"],
    });
  }

  if (profile.preferences?.controlMode === "hands-on") {
    return suggestions.filter((suggestion) => !suggestion.title.includes("auto-approve"));
  }
  return suggestions;
}

function maybeSuggestAutoApprove(
  suggestions: ConfigSuggestion[],
  toolFamily: string,
  policyRule: "lowRiskRead" | "lowRiskWeb",
  policyConfig: PolicyConfig,
  memoryProfile: MemoryProfile,
): void {
  const memory = memoryProfile.toolFamilies?.[toolFamily];
  const lowRiskRejectionRate = memoryProfile.consequenceProfiles?.low?.rejectionRate ?? 1;
  if (
    memory &&
    memory.presentations >= 5 &&
    memory.responses >= 5 &&
    memory.dismissals === 0 &&
    lowRiskRejectionRate <= 0.1 &&
    policyConfig.policy?.[policyRule]?.autoApprove !== true
  ) {
    suggestions.push({
      title: `Consider auto-approving ${policyRule}`,
      reason: `${toolFamily} work has ${memory.responses}/${memory.presentations} responses, no dismissals, and low-risk rejection is ${Math.round(lowRiskRejectionRate * 100)}%.`,
      snippet: [`### ${policyRule}`, "- auto approve: true"],
    });
  }
}

function formatPolicyRules(policyConfig: PolicyConfig): string[] {
  const policy = policyConfig.policy ?? {};
  const names = Object.keys(policy);
  if (names.length === 0) {
    return ["  none configured"];
  }
  return names.sort().map((name) => `  ${name}: ${formatPolicyRule(policy[name] ?? {})}`);
}

function formatPolicyRule(rule: NonNullable<PolicyConfig["policy"]>[string]): string {
  const parts = [
    rule.autoApprove !== undefined ? `auto approve ${rule.autoApprove}` : null,
    rule.mayInterrupt !== undefined ? `may interrupt ${rule.mayInterrupt}` : null,
    rule.minimumLane !== undefined ? `minimum lane ${rule.minimumLane}` : null,
    rule.requireContextExpansion !== undefined
      ? `require context expansion ${rule.requireContextExpansion}`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : "declared with no fields";
}

function formatPlannerDefaults(policyConfig: PolicyConfig): string[] {
  const defaults = policyConfig.plannerDefaults ?? {};
  const ambiguity = policyConfig.ambiguityDefaults ?? {};
  const lines = [
    ...Object.entries(defaults).map(([key, value]) => `  ${humanCamelKey(key)}: ${String(value)}`),
    ...Object.entries(ambiguity).map(([key, value]) => `  ${humanCamelKey(key)}: ${String(value)}`),
  ];
  return lines.length > 0 ? lines : ["  defaults active"];
}

function formatSuggestions(suggestions: ConfigSuggestion[]): string[] {
  if (suggestions.length === 0) {
    return ["  none yet"];
  }
  return suggestions.flatMap((suggestion) => [
    `  - ${suggestion.title}`,
    `    reason: ${suggestion.reason}`,
    "    snippet:",
    ...suggestion.snippet.map((line) => `      ${line}`),
  ]);
}

function formatDiagnostics(diagnostics: ConfigDiagnostic[]): string[] {
  if (diagnostics.length === 0) {
    return ["  none"];
  }
  return diagnostics.map((diagnostic) => {
    const location = diagnostic.line !== undefined ? `line ${diagnostic.line}: ` : "";
    return `  - ${diagnostic.severity}: ${location}${diagnostic.message}`;
  });
}

function defaultApertureProfile(): ApertureProfile {
  return {
    version: 1,
    operatorId: "default",
    updatedAt: PROFILE_FALLBACK_UPDATED_AT,
  };
}

function defaultPolicyConfig(): PolicyConfig {
  return {
    version: 1,
    updatedAt: PROFILE_FALLBACK_UPDATED_AT,
  };
}

function defaultMemoryProfile(): MemoryProfile {
  return {
    version: 1,
    operatorId: "default",
    updatedAt: PROFILE_FALLBACK_UPDATED_AT,
    sessionCount: 0,
  };
}

function humanCamelKey(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
}

function warn(line: number, message: string): ConfigDiagnostic {
  return { line, severity: "warning", message };
}

const KNOWN_SECTIONS = new Set([
  "Meta",
  "Preferences",
  "Policy",
  "Tool Overrides",
  "Planner Defaults",
  "Ambiguity Defaults",
]);
const KNOWN_META_KEYS = new Set(["version", "profile id", "updated at"]);
const KNOWN_PREFERENCE_KEYS = new Set([
  "control mode",
  "quiet hours",
  "prefer batching for",
  "always expand context for",
  "never auto approve",
]);
const KNOWN_POLICY_RULES = new Set([
  "lowRiskRead",
  "lowRiskWeb",
  "fileWrite",
  "envWrite",
  "destructiveBash",
]);
const KNOWN_POLICY_FIELDS = new Set([
  "auto approve",
  "may interrupt",
  "minimum lane",
  "require context expansion",
]);
const KNOWN_TOOL_OVERRIDE_FIELDS = new Set([
  ...KNOWN_POLICY_FIELDS,
  "default presentation",
  "minimum presentation",
  "score boost",
]);
const KNOWN_PLANNER_FIELDS = new Set([
  "batch status bursts",
  "defer low value during pressure",
  "minimum dwell ms",
  "stream continuity margin",
  "conflicting interrupt margin",
  "disabled continuity rules",
]);
const KNOWN_AMBIGUITY_FIELDS = new Set(["non blocking activation threshold", "promotion margin"]);
