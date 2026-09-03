import type { OmpAttentionEvent } from "../omp-attention-event.js";
import {
  directMessageRequestId,
  type WorkerDirectAcknowledgement,
} from "../worker-direct-message.js";

type DirectReceipt = {
  fingerprint: string;
  settled: boolean;
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
    const fingerprint = JSON.stringify(message);
    const existing = this.receipts.get(requestId);
    if (existing) {
      if (existing.fingerprint === fingerprint) return existing.outcome;
      return Promise.resolve({
        schemaVersion: 4,
        status: "rejected",
        requestId,
        code: "request_identity_conflict",
      });
    }
    this.evictSettled();
    if (this.receipts.size >= this.maximumReceipts) {
      return Promise.resolve({
        schemaVersion: 4,
        status: "rejected",
        requestId,
        code: "capacity",
      });
    }
    const receipt: DirectReceipt = {
      fingerprint,
      settled: false,
      outcome: Promise.resolve().then(operation),
    };
    this.receipts.set(requestId, receipt);
    void receipt.outcome.finally(() => {
      receipt.settled = true;
    });
    return receipt.outcome;
  }

  clear(): void {
    this.receipts.clear();
  }

  private evictSettled(): void {
    while (this.receipts.size >= this.maximumReceipts) {
      const settled = [...this.receipts].find(([, receipt]) => receipt.settled);
      if (!settled) return;
      this.receipts.delete(settled[0]);
    }
  }
}
