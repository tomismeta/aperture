import { execFile } from "node:child_process";
import path from "node:path";
import {
  assertOmpAttentionDisplayText,
  assertOmpAttentionSession,
  OMP_ATTENTION_LIMITS,
} from "@tomismeta/aperture/omp-attention-event";

import type {
  OmpEvent,
  OmpExtensionContext,
  OmpMappingContext,
  OmpSessionPresentation,
  OmpSessionPresentationFacet,
} from "./types.js";

type Checkout = { repo?: string; branch?: string; worktree?: string };
const METADATA_IDS: Readonly<Record<string, true | undefined>> = {
  model: true,
  repo: true,
  branch: true,
  worktree: true,
};

/** One checkout snapshot per binding; tool callbacks reuse it without running Git. */
export class OmpSessionMetadata {
  private cwd: string | undefined;
  private session: string | undefined;
  private checkout: Promise<Checkout> | undefined;
  private lookup: AbortController | undefined;

  capture(
    event: OmpEvent,
    extensionContext: OmpExtensionContext,
    context: OmpMappingContext,
  ): Promise<OmpSessionPresentation | undefined> {
    // OMP exposes ctx.model through a live getter. Copy presentation facts before
    // any subprocess await, including response metadata and caller-owned facets.
    const model =
      event.type === "session_stop" ? completedModel(event) : selectedModel(extensionContext.model);
    const base = context.session;
    const label = displayValue(
      base?.label,
      OMP_ATTENTION_LIMITS.sessionLabelCodePoints,
      context.focusHandle,
    );
    const supplied = base?.facets?.map((facet) => ({ ...facet })) ?? [];
    const cwd = context.cwd;
    const session =
      event.type === "session_stop" ? event.session_id : (context.sessionId ?? context.sessionFile);
    const refresh =
      !this.checkout ||
      cwd !== this.cwd ||
      session !== this.session ||
      event.type === "session_start" ||
      event.type === "agent_start" ||
      event.type === "session_stop";
    if (refresh) {
      this.lookup?.abort();
      this.lookup = new AbortController();
      this.cwd = cwd;
      this.session = session;
      this.checkout = discoverCheckout(cwd, this.lookup.signal);
    }
    const checkout = this.checkout!;
    if (event.type === "session_shutdown") {
      this.lookup?.abort();
      this.checkout = undefined;
      this.cwd = undefined;
      this.session = undefined;
    }
    return checkout.then((values) => {
      const facets: OmpSessionPresentationFacet[] = [];
      // Explicit caller facets keep their order and slots, except the four
      // adapter-owned IDs: those must never override actual response/checkout facts.
      for (const facet of supplied) {
        if (
          Object.hasOwn(METADATA_IDS, facet.id.trim()) ||
          facets.some((item) => item.id === facet.id.trim())
        )
          continue;
        const safe = safeFacet(facet.id.trim(), facet.label, facet.value, context.focusHandle);
        if (safe && facets.length < OMP_ATTENTION_LIMITS.sessionFacets) facets.push(safe);
      }
      for (const [id, title, value] of [
        ["model", "Model", model],
        ["repo", "Repository", values.repo],
        ["branch", "Branch", values.branch],
        ["worktree", "Worktree", values.worktree],
      ] as const) {
        const facet = safeFacet(id, title, value, context.focusHandle);
        if (facet && facets.length < OMP_ATTENTION_LIMITS.sessionFacets) facets.push(facet);
      }
      return label || facets.length
        ? {
            ...(label ? { label } : {}),
            ...(facets.length ? { facets } : {}),
          }
        : undefined;
    });
  }
}

function selectedModel(value: OmpExtensionContext["model"]): string | undefined {
  if (!value || typeof value.id !== "string") return undefined;
  const id = displayValue(value.id, value.id.length);
  if (!id) return undefined;
  if (typeof value.provider !== "string" || !value.provider.trim()) return id;
  const provider = displayValue(value.provider, value.provider.length);
  return provider ? `${provider}/${id}` : undefined;
}

function completedModel(event: Extract<OmpEvent, { type: "session_stop" }>): string | undefined {
  // last_assistant_message is structured in OMP 18.0.11; tolerate hosts sending
  // text, but never parse it or fall back to a newly selected completion model.
  const last = event.last_assistant_message;
  if (last && typeof last === "object" && "role" in last && last.role === "assistant") {
    return assistantModel(last);
  }
  if (!Array.isArray(event.messages)) return undefined;
  for (let index = event.messages.length - 1; index >= 0; index -= 1) {
    const message: unknown = event.messages[index];
    if (
      message &&
      typeof message === "object" &&
      "role" in message &&
      message.role === "assistant"
    ) {
      return assistantModel(message);
    }
  }
  return undefined;
}

function assistantModel(value: unknown): string | undefined {
  if (
    !value ||
    typeof value !== "object" ||
    !("role" in value) ||
    value.role !== "assistant" ||
    !("model" in value) ||
    typeof value.model !== "string"
  )
    return undefined;
  return selectedModel({
    id: value.model,
    ...("provider" in value && typeof value.provider === "string"
      ? { provider: value.provider }
      : {}),
  });
}

function displayValue(value: unknown, maximum: number, focusHandle?: string): string | undefined {
  if (
    typeof value !== "string" ||
    (focusHandle && value.includes(focusHandle)) ||
    /[\u0080-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/u.test(value)
  )
    return undefined;
  const trimmed = value.trim();
  try {
    // Validate before truncating, so truncation cannot conceal private material.
    assertOmpAttentionDisplayText(trimmed, trimmed.length, "session metadata");
    if (trimmed.length <= maximum) return trimmed;
    const points = Array.from(trimmed);
    return points.length > maximum ? `${points.slice(0, maximum - 1).join("")}…` : trimmed;
  } catch {
    return undefined;
  }
}

function safeFacet(
  id: string,
  label: unknown,
  value: unknown,
  focusHandle?: string,
): OmpSessionPresentationFacet | undefined {
  const safeLabel = displayValue(
    label,
    OMP_ATTENTION_LIMITS.sessionFacetLabelCodePoints,
    focusHandle,
  );
  const safeValue = displayValue(
    value,
    OMP_ATTENTION_LIMITS.sessionFacetValueCodePoints,
    focusHandle,
  );
  if (!safeLabel || !safeValue || (focusHandle && id.includes(focusHandle))) return undefined;
  try {
    return assertOmpAttentionSession({ facets: [{ id, label: safeLabel, value: safeValue }] })
      .facets?.[0];
  } catch {
    return undefined;
  }
}

async function discoverCheckout(cwd: string | undefined, signal: AbortSignal): Promise<Checkout> {
  if (!cwd || !path.isAbsolute(cwd) || cwd.includes("\0")) return {};
  const fallback: Checkout = { worktree: path.basename(cwd) };
  // Ignore inherited Git repository/config overrides: discovery describes cwd,
  // not an unrelated repository selected by the parent's Git environment.
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith("GIT_")) env[key] = value;
  }
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  const git = (args: string[]) => gitValue(cwd, args, env, signal);
  const [root, common, symbolic] = await Promise.all([
    git(["rev-parse", "--show-toplevel"]),
    git(["rev-parse", "--git-common-dir"]),
    git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
  ]);
  if (!root.value || signal.aborted) return fallback;
  const worktree = path.basename(root.value);
  const commonPath = common.value ? path.resolve(cwd, common.value) : undefined;
  const repo = commonPath
    ? path.basename(path.basename(commonPath) === ".git" ? path.dirname(commonPath) : commonPath)
    : undefined;
  let branch = symbolic.value;
  if (!branch && symbolic.code === 1) {
    const commit = await git(["rev-parse", "--verify", "--short=12", "HEAD"]);
    if (commit.value && /^[a-f0-9]{7,64}$/i.test(commit.value)) branch = `detached ${commit.value}`;
  }
  if (signal.aborted) return fallback;
  return { worktree, ...(repo ? { repo } : {}), ...(branch ? { branch } : {}) };
}

function gitValue(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<{ value?: string; code?: number }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        env,
        signal,
        encoding: "utf8",
        timeout: 500,
        killSignal: "SIGKILL",
        maxBuffer: 16 * 1024,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) resolve({ ...(typeof error.code === "number" ? { code: error.code } : {}) });
        else resolve({ value: stdout.replace(/\r?\n$/, "") });
      },
    );
  });
}
