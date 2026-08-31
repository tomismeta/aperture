import { ApertureRuntimeAdapterClient, discoverLocalRuntimes } from "@aperture/runtime";

import type { OmpEventSink } from "./bind.js";
import { createOmpInstanceKey, mapOmpEvent } from "./mapping.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

export type OmpRuntimeClient = Pick<
  ApertureRuntimeAdapterClient,
  "publishSourceEventBatch" | "close"
>;

export type OmpRuntimeTransportOptions = {
  runtimeBaseUrl?: string;
  runtimeLabel?: string;
  runtimeMetadata?: Record<string, string>;
  clientFactory?: (context: OmpMappingContext) => Promise<OmpRuntimeClient>;
};

export class OmpRuntimeTransport implements OmpEventSink {
  private readonly options: OmpRuntimeTransportOptions;
  private clientPromise: Promise<OmpRuntimeClient> | null = null;
  private client: OmpRuntimeClient | null = null;

  constructor(options: OmpRuntimeTransportOptions = {}) {
    this.options = options;
  }

  async handle(event: OmpEvent, context: OmpMappingContext): Promise<void> {
    const mapped = mapOmpEvent(event, context);
    if (mapped.length === 0) return;
    const client = await this.ensureClient(context);
    await client.publishSourceEventBatch(mapped);
  }

  async close(): Promise<void> {
    if (!this.client) return;
    const client = this.client;
    this.client = null;
    this.clientPromise = null;
    await client.close();
  }

  private async ensureClient(context: OmpMappingContext): Promise<OmpRuntimeClient> {
    if (this.client) return this.client;
    this.clientPromise ??= this.connect(context).catch((error: unknown) => {
      this.clientPromise = null;
      throw error;
    });
    this.client = await this.clientPromise;
    return this.client;
  }

  private async connect(context: OmpMappingContext): Promise<OmpRuntimeClient> {
    if (this.options.clientFactory) return this.options.clientFactory(context);
    const baseUrl = await resolveRuntimeUrl(this.options.runtimeBaseUrl);
    const instanceKey = createOmpInstanceKey(context);
    return ApertureRuntimeAdapterClient.connect({
      baseUrl,
      kind: "omp",
      id: `omp-${instanceKey}`,
      label: this.options.runtimeLabel ?? "OMP adapter",
      metadata: {
        transport: "omp-extension",
        ...(context.cwd ? { cwd: context.cwd } : {}),
        ...(context.sessionFile ? { sessionFile: context.sessionFile } : {}),
        ...(this.options.runtimeMetadata ?? {}),
      },
    });
  }
}

async function resolveRuntimeUrl(explicit: string | undefined): Promise<string> {
  const requested =
    explicit ?? process.env.APERTURE_OMP_RUNTIME_URL ?? process.env.APERTURE_RUNTIME_URL;
  if (requested) return requested.replace(/\/+$/, "");
  const runtimes = await discoverLocalRuntimes({ kind: "aperture" });
  const runtime = runtimes[0];
  if (!runtime) throw new Error("No live Aperture runtime found for the OMP adapter");
  return runtime.controlUrl;
}
