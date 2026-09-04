import type { OmpAttentionEvent } from "@tomismeta/aperture/omp-attention-event";
import type { OmpEventSink } from "./bind.js";
import {
  OmarchyAttentionCoordinator,
  type OmarchyAttentionCoordinatorOptions,
} from "./omarchy-attention-coordinator.js";
import type { OmpEvent, OmpMappingContext } from "./types.js";

export type OmarchyAttentionTransportOptions = OmarchyAttentionCoordinatorOptions;

export class OmarchyAttentionTransport implements OmpEventSink {
  private readonly coordinator: OmarchyAttentionCoordinator;

  constructor(options: OmarchyAttentionTransportOptions) {
    this.coordinator = new OmarchyAttentionCoordinator(options);
  }

  async isAvailable(): Promise<boolean> {
    return this.coordinator.isAvailable();
  }

  async handle(event: OmpEvent, context: OmpMappingContext): Promise<void> {
    this.coordinator.handle(event, context);
  }

  async handleMapped(
    event: OmpEvent,
    context: OmpMappingContext,
    directEvents: OmpAttentionEvent[],
  ): Promise<void> {
    this.coordinator.handleMapped(event, context, directEvents);
  }

  replayFocus(workerGeneration: string, publicHandle: string): void {
    this.coordinator.replayFocus(workerGeneration, publicHandle);
  }

  async close(): Promise<void> {
    await this.coordinator.close();
  }

  disable(): void {
    this.coordinator.disable();
  }
}
