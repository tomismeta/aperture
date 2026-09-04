import {
  OMP_SESSION_HEARTBEAT_INTERVAL_MS,
  WORKER_DIRECT_LIMITS,
} from "../worker-direct-message.js";

export const OMP_SESSION_LIVENESS = {
  heartbeatIntervalMilliseconds: OMP_SESSION_HEARTBEAT_INTERVAL_MS,
  leaseMilliseconds: 20_000,
  reconnectGraceMilliseconds: 10_000,
  sweepMilliseconds: 1_000,
  maximumSessions: WORKER_DIRECT_LIMITS.sessionLeaseRecords,
} as const;

type SessionLease = {
  generation: number;
  deadline: number;
};

export type OmpSessionLeaseExpiry = {
  sessionId: string;
  generation: number;
  deadline: number;
};

export type OmpSessionLivenessOptions = {
  monotonicNow?: () => number;
  leaseMilliseconds?: number;
  reconnectGraceMilliseconds?: number;
  maximumSessions?: number;
};

export class OmpSessionCapacityError extends Error {
  constructor() {
    super("Aperture OMP session lease capacity was exhausted");
    this.name = "OmpSessionCapacityError";
  }
}

export class OmpSessionLiveness {
  private readonly monotonicNow: () => number;
  private readonly leaseMilliseconds: number;
  private readonly reconnectGraceMilliseconds: number;
  private readonly maximumSessions: number;
  private readonly leases = new Map<string, SessionLease>();
  private nextGeneration = 0;

  constructor(options: OmpSessionLivenessOptions = {}) {
    this.monotonicNow = options.monotonicNow ?? performance.now.bind(performance);
    this.leaseMilliseconds = options.leaseMilliseconds ?? OMP_SESSION_LIVENESS.leaseMilliseconds;
    this.reconnectGraceMilliseconds =
      options.reconnectGraceMilliseconds ?? OMP_SESSION_LIVENESS.reconnectGraceMilliseconds;
    this.maximumSessions = options.maximumSessions ?? OMP_SESSION_LIVENESS.maximumSessions;
    for (const [label, value] of [
      ["lease", this.leaseMilliseconds],
      ["reconnect grace", this.reconnectGraceMilliseconds],
      ["capacity", this.maximumSessions],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error(`Aperture OMP session ${label} was invalid`);
      }
    }
  }

  seed(sessionIds: readonly string[]): string[] {
    const overflow: string[] = [];
    const deadline = this.monotonicNow() + this.reconnectGraceMilliseconds;
    for (const sessionId of sessionIds) {
      if (this.leases.has(sessionId)) continue;
      if (this.leases.size >= this.maximumSessions) {
        overflow.push(sessionId);
        continue;
      }
      this.leases.set(sessionId, {
        generation: this.newGeneration(),
        deadline,
      });
    }
    return overflow;
  }

  observe(sessionId: string): void {
    const current = this.leases.get(sessionId);
    if (!current && this.leases.size >= this.maximumSessions) {
      throw new OmpSessionCapacityError();
    }
    this.leases.set(sessionId, {
      generation: this.newGeneration(),
      deadline: this.monotonicNow() + this.leaseMilliseconds,
    });
  }

  forget(sessionId: string): void {
    this.leases.delete(sessionId);
  }

  expired(): OmpSessionLeaseExpiry[] {
    const now = this.monotonicNow();
    const expired: OmpSessionLeaseExpiry[] = [];
    for (const [sessionId, lease] of this.leases) {
      if (lease.deadline <= now) expired.push({ sessionId, ...lease });
    }
    return expired;
  }

  stillExpired(expiry: OmpSessionLeaseExpiry): boolean {
    const current = this.leases.get(expiry.sessionId);
    return (
      current?.generation === expiry.generation &&
      current.deadline === expiry.deadline &&
      current.deadline <= this.monotonicNow()
    );
  }

  commitExpired(expiries: readonly OmpSessionLeaseExpiry[]): void {
    for (const expiry of expiries) {
      if (this.stillExpired(expiry)) this.leases.delete(expiry.sessionId);
    }
  }

  get size(): number {
    return this.leases.size;
  }

  private newGeneration(): number {
    this.nextGeneration =
      this.nextGeneration >= Number.MAX_SAFE_INTEGER ? 1 : this.nextGeneration + 1;
    return this.nextGeneration;
  }
}
