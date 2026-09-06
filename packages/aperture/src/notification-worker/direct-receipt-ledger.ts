import type { OmpAttentionEvent } from "../omp-attention-event.js";
import {
  WORKER_DIRECT_PROTOCOL_VERSION,
  directMessageRequestId,
  type WorkerDirectAcknowledgement,
} from "../worker-direct-message.js";
import { DirectAttentionPrecommitError } from "./direct-message-execution.js";

type DirectReceipt = {
  fingerprint: string;
  settled: boolean;
  retryable: boolean;
  outcome: Promise<WorkerDirectAcknowledgement>;
};

export class DirectReceiptLedger {
  private readonly receipts = new Map<string, DirectReceipt>();

  constructor(private readonly maximumReceipts: number) {}

  execute(
    message: OmpAttentionEvent,
    operation: () => Promise<WorkerDirectAcknowledgement>,
  ): Promise<WorkerDirectAcknowledgement> {
    const requestId = directMessageRequestId(message);
    const fingerprint = attentionReceiptFingerprint(message);
    const existing = this.receipts.get(requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return Promise.resolve({
          schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
          status: "rejected",
          requestId,
          code: "request_identity_conflict",
        });
      }
      if (!existing.retryable) return existing.outcome;
    }
    if (!existing) {
      this.evictSettled();
      if (this.receipts.size >= this.maximumReceipts) {
        return Promise.resolve({
          schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
          status: "rejected",
          requestId,
          code: "capacity",
        });
      }
    }
    const receipt: DirectReceipt = {
      fingerprint,
      settled: false,
      retryable: false,
      outcome: Promise.resolve()
        .then(operation)
        .catch((error: unknown): WorkerDirectAcknowledgement => {
          if (!(error instanceof DirectAttentionPrecommitError)) throw error;
          receipt.retryable = true;
          return {
            schemaVersion: WORKER_DIRECT_PROTOCOL_VERSION,
            status: "rejected",
            requestId,
            code: error.code,
          };
        })
        .finally(() => {
          receipt.settled = true;
        }),
    };
    this.receipts.set(requestId, receipt);
    return receipt.outcome;
  }

  clear(): void {
    this.receipts.clear();
  }

  private evictSettled(): void {
    for (const [requestId, receipt] of this.receipts) {
      if (this.receipts.size < this.maximumReceipts) return;
      if (receipt.settled) this.receipts.delete(requestId);
    }
  }
}

function attentionReceiptFingerprint(message: OmpAttentionEvent): string {
  const { occurredAt: _occurredAt, session: _session, focus: _focus, ...causalPayload } = message;
  return JSON.stringify(causalPayload);
}
