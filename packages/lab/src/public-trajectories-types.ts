import path from "node:path";

import type { ReplaySessionBundle } from "./session-bundle.js";
import type { ImportedSession } from "./imported-session.js";
import { DEFAULT_LAB_RUNTIME_ROOT } from "./runtime-paths.js";

export const SWE_SMITH_DATASET = "SWE-bench/SWE-smith-trajectories" as const;
export const HUGGINGFACE_SWE_SMITH_DATASET = SWE_SMITH_DATASET;
export const DEFAULT_SWE_SMITH_SPLIT = "tool" as const;
export const DATACLAW_DATASET = "woctordho/dataclaw" as const;
export const HUGGINGFACE_DATACLAW_DATASET = DATACLAW_DATASET;
export const DEFAULT_DATACLAW_SPLIT = "train" as const;
export const OPEN_AGENT_SESSIONS_SITE_URL = "https://openagentsessions.org/" as const;
export const OPEN_AGENT_SESSIONS_URLS_URL = "https://openagentsessions.org/urls.txt" as const;
export const DEFAULT_OPEN_AGENT_SESSIONS_SPLIT = "approved" as const;
export const DEFAULT_PUBLIC_TRAJECTORY_BUNDLES_DIR = path.join(
  DEFAULT_LAB_RUNTIME_ROOT,
  "bundles",
  "public",
);
export const DEFAULT_OPEN_AGENT_SESSIONS_RAW_DIR = path.resolve(
  DEFAULT_LAB_RUNTIME_ROOT,
  "imported/open-agent-sessions/raw",
);

export type PublicTrajectoryDataset = "swe-smith" | "dataclaw" | "open-agent-sessions";
export type SweSmithTrajectorySplit = "tool" | "xml" | "ticks";
export type DataclawSplit = "train";
export type OpenAgentSessionsSplit = "approved";
export type PublicTrajectorySplit =
  | SweSmithTrajectorySplit
  | DataclawSplit
  | OpenAgentSessionsSplit;

export type SweSmithRow = {
  messages: string;
  instance_id: string;
  resolved: boolean;
  model: string;
  traj_id: string;
  patch: string;
};

export type SweSmithTrajectoryRow = SweSmithRow;

export type DataclawToolUse = {
  tool: string;
  input?: unknown;
  output?: unknown;
  status?: string;
};

export type DataclawMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  thinking?: string | null;
  timestamp?: string;
  tool_uses?: DataclawToolUse[];
};

export type DataclawStats = Partial<{
  user_messages: number;
  assistant_messages: number;
  tool_uses: number;
  input_tokens: number;
  output_tokens: number;
}>;

export type DataclawRow = {
  session_id: string;
  model: string;
  project: string;
  source: string;
  start_time: string;
  end_time?: string;
  git_branch?: string;
  stats?: DataclawStats;
  messages: DataclawMessage[];
};

export type DataclawTrajectoryRow = DataclawRow;

export type OpenAgentSessionsContentBlock = Partial<{
  type: string;
  text: string;
  thinking: string;
  thinkingSignature: string;
  textSignature: string;
  id: string;
  name: string;
  arguments: unknown;
  partialJson: string;
}>;

export type OpenAgentSessionsMessage = {
  role: "system" | "user" | "assistant" | "toolResult" | "bashExecution";
  content?: OpenAgentSessionsContentBlock[];
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  command?: string;
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
  truncated?: boolean;
  excludeFromContext?: boolean;
  provider?: string;
  model?: string;
  stopReason?: string;
  usage?: unknown;
};

export type OpenAgentSessionsEvent = Partial<{
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  version: number;
  cwd: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  message: OpenAgentSessionsMessage;
}>;

export type OpenAgentSessionsMetadata = Partial<{
  schema_version: string;
  license: string;
  consent_confirmed: boolean;
  redaction_done: boolean;
  created_at: string;
  session: Partial<{
    agent: string;
    model: string;
    language: string;
    topic: string;
  }>;
  tags: string[];
  redaction_stats: Record<string, unknown>;
}>;

export type OpenAgentSessionsRow = {
  gist_id: string;
  gist_url: string;
  jsonl_raw_url: string;
  jsonl_file_name: string;
  metadata_raw_url?: string;
  metadata_file_name?: string;
  contributor?: string;
  session_id: string;
  events: OpenAgentSessionsEvent[];
  metadata?: OpenAgentSessionsMetadata;
  raw_mirror_dir?: string;
};

export type PublicTrajectoryRow =
  | SweSmithTrajectoryRow
  | DataclawTrajectoryRow
  | OpenAgentSessionsRow;

export type ImportedTrajectoryBundle = {
  dataset: PublicTrajectoryDataset;
  split: PublicTrajectorySplit;
  row: PublicTrajectoryRow;
  recordId: string;
  session?: ImportedSession;
  sessionFilePath?: string;
  bundle: ReplaySessionBundle;
  filePath: string;
};

export type ImportPublicTrajectoryBundlesOptions = {
  dataset?: PublicTrajectoryDataset;
  split?: PublicTrajectorySplit;
  offset?: number;
  limit?: number;
  outputDirectory?: string;
  exportedAt?: string;
  dryRun?: boolean;
};
