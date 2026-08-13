import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import workEventBatchSchema from "./work-event-batch.schema.json" with { type: "json" };
import workEventSchema from "./work-event.schema.json" with { type: "json" };
import { WORK_API_VERSION } from "./work-contract.generated.js";
export {
  WORK_API_VERSION,
  WORK_BATCH_SCHEMA_ID,
  WORK_SCHEMA_ID,
  WORK_SCHEMA_URL,
} from "./work-contract.generated.js";
export type {
  WorkEndpointDescription,
  WorkEvent,
  WorkEventBatch,
  WorkEventContextItem,
  WorkEventKind,
  WorkEventRequest,
  WorkReceipt,
  WorkReceiptItem,
  WorkReceiptMode,
  WorkReceiptNextStep,
  WorkRequestKind,
  WorkResponse,
  WorkResponseState,
  WorkStatus,
} from "./work-contract.generated.js";
import type {
  WorkEndpointDescription,
  WorkEvent,
  WorkEventBatch,
  WorkReceipt,
  WorkResponse,
} from "./work-contract.generated.js";

type SchemaDocument = Record<string, unknown> & { $id?: string };
const WORK_EVENT_SCHEMA = workEventSchema as SchemaDocument;
const WORK_EVENT_BATCH_SCHEMA = workEventBatchSchema as SchemaDocument;
export type WorkInput = string | WorkEvent | WorkEventBatch;

export type WorkClientOptions = {
  baseUrl?: string;
  authToken?: string;
  runtimeKind?: string;
  registryDir?: string;
  fetch?: typeof globalThis.fetch;
};

type RuntimeRegistration = {
  id: string;
  kind: string;
  controlUrl: string;
  baseUrl?: string;
  tokenPath: string;
  updatedAt: string;
};

export class ApertureWorkClientError extends Error {
  readonly code: string;
  readonly status: number | null;
  readonly hint: string | undefined;
  readonly receivedVersion: unknown;
  readonly supportedVersion: string | undefined;
  readonly batchIndex: number | undefined;
  readonly body: unknown;

  constructor(options: {
    code: string;
    message: string;
    status?: number | null;
    hint?: string;
    receivedVersion?: unknown;
    supportedVersion?: string;
    batchIndex?: number;
    body?: unknown;
  }) {
    super(options.message);
    this.name = "ApertureWorkClientError";
    this.code = options.code;
    this.status = options.status ?? null;
    this.hint = options.hint;
    this.receivedVersion = options.receivedVersion;
    this.supportedVersion = options.supportedVersion;
    this.batchIndex = options.batchIndex;
    this.body = options.body;
  }
}

export function isSupportedWorkSpecVersion(value: string): boolean {
  return value === WORK_API_VERSION;
}

export function workEventSchemaDocument(): Record<string, unknown> {
  return structuredClone(WORK_EVENT_SCHEMA);
}

export function workEventBatchSchemaDocument(): Record<string, unknown> {
  return structuredClone(WORK_EVENT_BATCH_SCHEMA);
}

export class ApertureWorkClient {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly request: typeof globalThis.fetch;

  private constructor(options: {
    baseUrl: string;
    authToken: string;
    request: typeof globalThis.fetch;
  }) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.authToken = options.authToken;
    this.request = options.request;
  }

  static async connect(options: WorkClientOptions = {}): Promise<ApertureWorkClient> {
    const request = options.fetch ?? globalThis.fetch;
    if (!request) {
      throw new ApertureWorkClientError({
        code: "fetch_unavailable",
        message: "Aperture Work client requires a fetch implementation.",
        hint: "Use Node 18+ or pass fetch in WorkClientOptions.",
      });
    }
    const runtime = await resolveRuntime(options);
    const client = new ApertureWorkClient({ ...runtime, request });
    const description = await client.describe();
    if (description.apiVersion !== WORK_API_VERSION) {
      throw new ApertureWorkClientError({
        code: "work_version_mismatch",
        message: `Aperture Work server reported ${description.apiVersion}; this client supports ${WORK_API_VERSION}.`,
        hint: "Upgrade the client or connect it to a runtime with the same Work contract version.",
        receivedVersion: description.apiVersion,
        supportedVersion: WORK_API_VERSION,
      });
    }
    return client;
  }

  get url(): string {
    return this.baseUrl;
  }

  async describe(): Promise<WorkEndpointDescription> {
    return this.requestJson<WorkEndpointDescription>("/work", { method: "GET" });
  }

  async publish(input: WorkInput): Promise<WorkReceipt> {
    const text = typeof input === "string";
    return this.requestJson<WorkReceipt>("/work", {
      method: "POST",
      headers: { "Content-Type": text ? "text/plain" : "application/json" },
      body: text ? input : JSON.stringify(input),
    });
  }

  async readResponse(interactionId: string): Promise<WorkResponse> {
    return this.requestJson(workResponsePath(interactionId), { method: "GET" });
  }

  async cancelResponse(interactionId: string): Promise<WorkResponse> {
    return this.requestJson(workResponsePath(interactionId), { method: "DELETE" });
  }

  private async requestJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.request(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.authToken}`, ...(init.headers ?? {}) },
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      const error = readErrorEnvelope(body);
      throw new ApertureWorkClientError({
        code: error?.code ?? "work_request_failed",
        message: error?.message ?? `Aperture Work request failed with HTTP ${response.status}.`,
        status: response.status,
        ...(error?.hint !== undefined ? { hint: error.hint } : {}),
        ...(error?.receivedVersion !== undefined ? { receivedVersion: error.receivedVersion } : {}),
        ...(error?.supportedVersion !== undefined
          ? { supportedVersion: error.supportedVersion }
          : {}),
        ...(error?.batchIndex !== undefined ? { batchIndex: error.batchIndex } : {}),
        body,
      });
    }
    return body as T;
  }
}

export async function connectWork(options: WorkClientOptions = {}): Promise<ApertureWorkClient> {
  return ApertureWorkClient.connect(options);
}

async function resolveRuntime(
  options: WorkClientOptions,
): Promise<{ baseUrl: string; authToken: string }> {
  if (options.baseUrl && options.authToken) {
    return { baseUrl: normalizeBaseUrl(options.baseUrl), authToken: options.authToken };
  }

  const registrations = await discoverRuntimeRegistrations(
    options.registryDir ?? resolve(homedir(), ".aperture", "runtimes"),
    options.runtimeKind ?? "aperture",
  );

  if (options.baseUrl) {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const registration = registrations.find((candidate) => matchesBaseUrl(candidate, baseUrl));
    const authToken = options.authToken ?? (registration ? await readToken(registration) : null);
    if (!authToken) {
      throw new ApertureWorkClientError({
        code: "runtime_auth_unavailable",
        message: `No local auth token was found for ${baseUrl}.`,
        hint: "Pass authToken explicitly or connect to a locally registered Aperture runtime.",
      });
    }
    return { baseUrl, authToken };
  }
  if (registrations.length === 0) {
    throw new ApertureWorkClientError({
      code: "runtime_not_found",
      message: "No local Aperture runtime was found.",
      hint: "Start Aperture or pass baseUrl and authToken explicitly.",
    });
  }
  if (registrations.length > 1) {
    throw new ApertureWorkClientError({
      code: "multiple_runtimes_found",
      message: `Found ${registrations.length} local Aperture runtimes; refusing to choose implicitly.`,
      hint: "Pass baseUrl to select a runtime explicitly.",
    });
  }
  const registration = registrations[0] as RuntimeRegistration;
  return {
    baseUrl: normalizeBaseUrl(registration.baseUrl ?? registration.controlUrl),
    authToken: options.authToken ?? (await readToken(registration)),
  };
}

async function discoverRuntimeRegistrations(
  registryDir: string,
  kind: string,
): Promise<RuntimeRegistration[]> {
  let entries: string[];
  try {
    entries = await readdir(registryDir);
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const cutoff = Date.now() - 15_000;
  const registrations = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map(async (entry): Promise<RuntimeRegistration | null> => {
        try {
          const value = JSON.parse(await readFile(resolve(registryDir, entry), "utf8")) as unknown;
          if (!isRuntimeRegistration(value) || value.kind !== kind) return null;
          const updatedAt = Date.parse(value.updatedAt);
          return Number.isNaN(updatedAt) || updatedAt < cutoff ? null : value;
        } catch {
          return null;
        }
      }),
  );
  return registrations
    .filter((registration): registration is RuntimeRegistration => registration !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isRuntimeRegistration(value: unknown): value is RuntimeRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.kind === "string" &&
    typeof candidate.controlUrl === "string" &&
    typeof candidate.tokenPath === "string" &&
    typeof candidate.updatedAt === "string"
  );
}

function isMissingFile(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function readToken(registration: RuntimeRegistration): Promise<string> {
  try {
    if (process.platform !== "win32") {
      const mode = (await stat(registration.tokenPath)).mode;
      if ((mode & 0o077) !== 0) {
        throw new Error("token file permissions are too broad; expected owner-only access");
      }
    }
    const token = (await readFile(registration.tokenPath, "utf8")).trim();
    if (!token) throw new Error("token file is empty");
    return token;
  } catch (error) {
    throw new ApertureWorkClientError({
      code: "runtime_auth_unavailable",
      message: `Unable to read the local auth token for runtime ${registration.id}.`,
      hint: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeBaseUrl(input: string): string {
  const normalized = input.replace(/\/+$/, "");
  return normalized.endsWith("/runtime") ? normalized.slice(0, -"/runtime".length) : normalized;
}

function matchesBaseUrl(registration: RuntimeRegistration, baseUrl: string): boolean {
  return [registration.baseUrl, registration.controlUrl].some(
    (value) => value !== undefined && normalizeBaseUrl(value) === baseUrl,
  );
}

function workResponsePath(interactionId: string): string {
  return `/work/response/${encodeURIComponent(interactionId)}`;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return undefined;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("json") || text.trim().startsWith("{") || text.trim().startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function readErrorEnvelope(body: unknown): {
  code?: string;
  message?: string;
  hint?: string;
  receivedVersion?: unknown;
  supportedVersion?: string;
  batchIndex?: number;
} | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const error = "error" in body ? body.error : body;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  return error as {
    code?: string;
    message?: string;
    hint?: string;
    receivedVersion?: unknown;
    supportedVersion?: string;
    batchIndex?: number;
  };
}
