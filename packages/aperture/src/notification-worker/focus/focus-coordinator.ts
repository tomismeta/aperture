import { randomBytes } from "node:crypto";

import type {
  FocusRecovery,
  FocusRegistration,
  FocusRevocation,
  FocusTarget,
} from "../../worker-direct-message.js";
import { ClosedFocusBackendRegistry } from "./backend-registry.js";
import {
  HyprlandFootSurfaceController,
  type HyprlandFootSurfaceControllerOptions,
} from "./hyprland-foot-surface-controller.js";
import { KeyedFocusScheduler } from "./keyed-focus-scheduler.js";
import type { HerdrRequest, SocketValidator, TmuxRequest } from "./native.js";
import {
  FOCUS_LIMITS,
  FOCUS_TIMING,
  FocusRegistrationError,
  abortError,
  admissionKey,
  targetKey,
  throwIfAborted,
  type FocusActivationResult,
  type FocusDiagnosticStage,
  type FocusLease,
  type FocusRegistrationRecord,
  type KnownFocusSurface,
  type PreparedFocusTarget,
} from "./types.js";
import type { ApertureSurfaceNavigation } from "../../surface/protocol.js";

const MAXIMUM_CANCELLATION_FENCES = FOCUS_LIMITS.activeRegistrations * 2;
const NEVER_ABORTED = new AbortController().signal;

type CoordinatorLimits = {
  queuedOperations: number;
  activeRegistrations: number;
  leaseMembers: number;
  shutdownMilliseconds: number;
};

export type FocusCoordinatorOptions = HyprlandFootSurfaceControllerOptions & {
  now?: () => number;
  ttlMs?: number;
  randomToken?: () => string;
  herdrRequest?: HerdrRequest;
  tmuxRequest?: TmuxRequest;
  socketValidator?: SocketValidator;
  onInvalidated?: (publicHandle: string) => void;
  onDiagnostic?: (stage: FocusDiagnosticStage) => void;
  limits?: Partial<CoordinatorLimits>;
};

type PendingRegistration = {
  hostGeneration: string;
  target: FocusTarget;
  admissionKey: string;
};

export class FocusCoordinator {
  private readonly registrations = new Map<string, FocusRegistrationRecord>();
  private readonly leases = new Map<string, FocusLease>();
  private readonly pendingRegistrations = new Map<string, PendingRegistration>();
  private readonly pendingAdmission = new Map<string, number>();
  private readonly cancellationFences = new Map<string, true>();
  private readonly surfaceController: HyprlandFootSurfaceController;
  private readonly backends: ClosedFocusBackendRegistry;
  private readonly scheduler: KeyedFocusScheduler;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly randomToken: () => string;
  private readonly onInvalidated: (publicHandle: string) => void;
  private readonly onDiagnostic: (stage: FocusDiagnosticStage) => void;
  private readonly limits: CoordinatorLimits;
  private expiryTimer: NodeJS.Timeout | undefined;
  private closing = false;

  constructor(options: FocusCoordinatorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? FOCUS_TIMING.registrationTtlMilliseconds;
    this.randomToken = options.randomToken ?? (() => randomBytes(24).toString("base64url"));
    this.onInvalidated = options.onInvalidated ?? (() => undefined);
    this.onDiagnostic = options.onDiagnostic ?? (() => undefined);
    this.limits = {
      queuedOperations: options.limits?.queuedOperations ?? FOCUS_LIMITS.queuedOperations,
      activeRegistrations: options.limits?.activeRegistrations ?? FOCUS_LIMITS.activeRegistrations,
      leaseMembers: options.limits?.leaseMembers ?? FOCUS_LIMITS.leaseMembers,
      shutdownMilliseconds:
        options.limits?.shutdownMilliseconds ?? FOCUS_LIMITS.shutdownMilliseconds,
    };
    validateLimits(this.limits);
    this.scheduler = new KeyedFocusScheduler(this.limits.queuedOperations);
    this.surfaceController = new HyprlandFootSurfaceController(options);
    this.backends = new ClosedFocusBackendRegistry({
      surfaceController: this.surfaceController,
      ...(options.herdrRequest ? { herdrRequest: options.herdrRequest } : {}),
      ...(options.tmuxRequest ? { tmuxRequest: options.tmuxRequest } : {}),
      ...(options.socketValidator ? { socketValidator: options.socketValidator } : {}),
    });
  }

  async register(
    registration: FocusRegistration,
    signal: AbortSignal = NEVER_ABORTED,
  ): Promise<FocusRecovery | undefined> {
    if (this.closing) throw new FocusRegistrationError("capacity");
    throwIfAborted(signal);
    const existing = this.registrations.get(registration.publicHandle);
    const registrationAdmissionKey = admissionKey(registration.target);
    if (
      !existing &&
      this.registrations.size + this.pendingRegistrations.size >= this.limits.activeRegistrations
    ) {
      this.onDiagnostic("capacity");
      throw new FocusRegistrationError("capacity");
    }
    if (this.pendingRegistrations.has(registration.publicHandle)) {
      this.onDiagnostic("capacity");
      throw new FocusRegistrationError("capacity");
    }
    if (
      !existing &&
      this.countAdmission(registrationAdmissionKey) +
        (this.pendingAdmission.get(registrationAdmissionKey) ?? 0) >=
        this.limits.leaseMembers
    ) {
      this.onDiagnostic("capacity");
      throw new FocusRegistrationError("capacity");
    }

    this.pendingRegistrations.set(registration.publicHandle, {
      hostGeneration: registration.hostGeneration,
      target: registration.target,
      admissionKey: registrationAdmissionKey,
    });
    this.pendingAdmission.set(
      registrationAdmissionKey,
      (this.pendingAdmission.get(registrationAdmissionKey) ?? 0) + 1,
    );
    try {
      return await this.scheduler.run(
        compositorQueueKey(registration.target.hyprlandInstance),
        signal,
        async (operationSignal) => this.registerScheduled(registration, operationSignal),
      );
    } finally {
      if (
        this.pendingRegistrations.get(registration.publicHandle)?.hostGeneration ===
        registration.hostGeneration
      ) {
        this.pendingRegistrations.delete(registration.publicHandle);
      }
      const pending = (this.pendingAdmission.get(registrationAdmissionKey) ?? 1) - 1;
      if (pending > 0) this.pendingAdmission.set(registrationAdmissionKey, pending);
      else this.pendingAdmission.delete(registrationAdmissionKey);
    }
  }

  async revoke(revocation: FocusRevocation, signal: AbortSignal = NEVER_ABORTED): Promise<void> {
    const existing = this.registrations.get(revocation.publicHandle);
    const pending = this.pendingRegistrations.get(revocation.publicHandle);
    const generation = existing?.hostGeneration ?? pending?.hostGeneration;
    if (generation !== revocation.hostGeneration) return;
    this.rememberCancellation(revocation.publicHandle, revocation.hostGeneration);
    const hyprlandInstance =
      existing?.lease.surface.hyprlandInstance ?? pending?.target.hyprlandInstance;
    if (!hyprlandInstance) return;
    await this.scheduler.run(
      compositorQueueKey(hyprlandInstance),
      signal,
      async (operationSignal) => {
        const current = this.registrations.get(revocation.publicHandle);
        if (!current || current.hostGeneration !== revocation.hostGeneration) return;
        await this.invalidate(current, operationSignal);
      },
    );
  }

  navigationFor(publicHandle: string | undefined): ApertureSurfaceNavigation | undefined {
    if (!publicHandle) return undefined;
    const record = this.registrations.get(publicHandle);
    if (!record || this.isCancelled(record)) return undefined;
    if (record.expiresAt <= this.now()) {
      this.rememberCancellation(record.publicHandle, record.hostGeneration);
      this.scheduleExpiry(0);
      return undefined;
    }
    return { kind: "opaque-focus", handle: publicHandle };
  }

  async activate(
    publicHandle: string,
    signal: AbortSignal = NEVER_ABORTED,
  ): Promise<FocusActivationResult> {
    const initial = this.registrations.get(publicHandle);
    if (!initial || this.isCancelled(initial)) return "missing";
    try {
      return await this.scheduler.run(
        compositorQueueKey(initial.lease.surface.hyprlandInstance),
        signal,
        async (operationSignal) => this.activateScheduled(publicHandle, operationSignal),
      );
    } catch (error) {
      if (error instanceof FocusRegistrationError && error.code === "capacity") {
        this.onDiagnostic("capacity");
        return "missing";
      }
      if (isAbort(error)) return "missing";
      return "stale";
    }
  }

  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    for (const record of this.registrations.values()) {
      this.rememberCancellation(record.publicHandle, record.hostGeneration);
    }
    const deadline = Date.now() + this.limits.shutdownMilliseconds;
    this.scheduler.abortAll();
    await boundedWait(this.scheduler.drain(), Math.max(0, deadline - Date.now()));

    const controller = new AbortController();
    const release = Promise.allSettled(
      [...this.leases.values()].map((lease) => this.releaseLease(lease, controller.signal)),
    );
    const remaining = Math.max(0, deadline - Date.now());
    const completed = await boundedWait(release, remaining);
    if (!completed) controller.abort();

    for (const record of this.registrations.values()) this.onInvalidated(record.publicHandle);
    this.registrations.clear();
    this.leases.clear();
    this.pendingRegistrations.clear();
    this.pendingAdmission.clear();
    this.cancellationFences.clear();
  }

  private async registerScheduled(
    registration: FocusRegistration,
    signal: AbortSignal,
  ): Promise<FocusRecovery | undefined> {
    throwIfAborted(signal);
    if (
      this.closing ||
      this.hasCancellation(registration.publicHandle, registration.hostGeneration)
    ) {
      throw abortError();
    }
    const expectedTargetKey = targetKey(registration.target);
    const current = this.registrations.get(registration.publicHandle);
    if (
      current &&
      (current.hostGeneration !== registration.hostGeneration ||
        current.targetKey !== expectedTargetKey)
    ) {
      throw new Error("Aperture rejected a stale focus registration");
    }
    if (!current && this.registrations.size >= this.limits.activeRegistrations) {
      this.onDiagnostic("capacity");
      throw new FocusRegistrationError("capacity");
    }
    if (
      !current &&
      this.countAdmission(admissionKey(registration.target)) >= this.limits.leaseMembers
    ) {
      this.onDiagnostic("capacity");
      throw new FocusRegistrationError("capacity");
    }

    let prepared: PreparedFocusTarget;
    try {
      prepared = await this.backends.prepare(registration, signal);
    } catch (error) {
      if (current && !signal.aborted && !isAbort(error)) {
        await this.invalidateLease(current.lease, signal);
      }
      throw error;
    }
    throwIfAborted(signal);
    if (this.hasCancellation(registration.publicHandle, registration.hostGeneration))
      throw abortError();

    if (current) {
      if (current.lease.key !== prepared.leaseKey || current.lease.kind !== prepared.kind) {
        throw new Error("Aperture rejected a changed focus lease");
      }
      try {
        await this.backends.refresh(current.lease, prepared, signal);
      } catch (error) {
        if (!signal.aborted && !isAbort(error)) {
          await this.invalidateLease(current.lease, signal);
        }
        throw error;
      }
      throwIfAborted(signal);
      if (!this.isCurrent(current)) throw abortError();
      current.lease.members.set(current.publicHandle, this.backends.member(prepared));
      current.expiresAt = this.now() + this.ttlMs;
      this.scheduleExpiry();
      return this.backends.recovery(current.lease);
    }

    let lease = this.leases.get(prepared.leaseKey);
    if (lease) {
      if (lease.kind !== prepared.kind) throw new Error("Aperture focus lease kind changed");
      if (lease.members.size >= this.limits.leaseMembers) {
        this.onDiagnostic("capacity");
        throw new FocusRegistrationError("capacity");
      }
      try {
        await this.backends.refresh(lease, prepared, signal);
      } catch (error) {
        if (!signal.aborted && !isAbort(error)) {
          await this.invalidateLease(lease, signal);
        }
        throw error;
      }
    } else {
      lease = await this.backends.acquire(
        prepared,
        this.knownFocusSurfaces(),
        this.randomToken,
        signal,
      );
      try {
        throwIfAborted(signal);
        if (this.hasCancellation(registration.publicHandle, registration.hostGeneration)) {
          throw abortError();
        }
        const collision = [...this.leases.values()].find(
          (candidate) =>
            candidate.surface.hyprlandInstance === lease!.surface.hyprlandInstance &&
            candidate.surface.address === lease!.surface.address,
        );
        if (collision) throw new Error("Aperture focus surface already has an owner");
        this.leases.set(lease.key, lease);
      } catch (error) {
        await this.releaseLeaseBestEffort(lease);
        throw error;
      }
    }

    const record: FocusRegistrationRecord = {
      publicHandle: registration.publicHandle,
      hostGeneration: registration.hostGeneration,
      targetKey: expectedTargetKey,
      admissionKey: admissionKey(registration.target),
      lease,
      expiresAt: this.now() + this.ttlMs,
    };
    lease.members.set(record.publicHandle, this.backends.member(prepared));
    this.registrations.set(record.publicHandle, record);
    this.cancellationFences.delete(cancellationKey(record.publicHandle, record.hostGeneration));
    this.scheduleExpiry();
    return this.backends.recovery(lease);
  }

  private async activateScheduled(
    publicHandle: string,
    signal: AbortSignal,
  ): Promise<FocusActivationResult> {
    const record = this.registrations.get(publicHandle);
    if (!record || !this.isCurrent(record)) return "missing";
    if (record.expiresAt <= this.now() + FOCUS_TIMING.activationExpiryFenceMilliseconds) {
      await this.invalidate(record, signal);
      return "missing";
    }
    const lease = record.lease;
    const member = lease.members.get(publicHandle);
    if (!member) return "missing";
    const epoch = lease.epoch;
    const isCurrent = (): boolean => this.isCurrent(record, epoch);
    try {
      this.onDiagnostic("lease-before-focus");
      await this.backends.validate(lease, signal);
      if (!isCurrent()) return "missing";

      this.onDiagnostic("pane-focus");
      await this.backends.focusInner(lease, member, signal);
      if (!isCurrent()) return "missing";

      this.onDiagnostic("pane-snapshot");
      if (!(await this.backends.confirmInner(lease, member, signal))) {
        await this.invalidateLease(lease, signal);
        return "stale";
      }
      if (!isCurrent()) return "missing";

      this.onDiagnostic("dispatch");
      const outer = await this.surfaceController.focusAndConfirm(lease.surface, isCurrent, signal);
      if (outer !== "focused") {
        if (outer === "stale") {
          this.onDiagnostic("active-confirm-timeout");
          await this.invalidateLease(lease, signal);
        }
        return outer;
      }

      this.onDiagnostic("inner-reconfirm");
      if (!(await this.backends.confirmInner(lease, member, signal))) {
        await this.invalidateLease(lease, signal);
        return "stale";
      }
      return isCurrent() ? "focused" : "missing";
    } catch (error) {
      if (signal.aborted || isAbort(error) || !isCurrent()) return "missing";
      this.onDiagnostic("exception");
      await this.invalidateLease(lease, signal);
      return "stale";
    }
  }

  private async invalidate(record: FocusRegistrationRecord, signal: AbortSignal): Promise<void> {
    if (this.registrations.get(record.publicHandle) !== record) return;
    this.registrations.delete(record.publicHandle);
    record.lease.members.delete(record.publicHandle);
    this.onInvalidated(record.publicHandle);
    if (record.lease.members.size > 0) {
      this.scheduleExpiry();
      return;
    }
    this.leases.delete(record.lease.key);
    await this.releaseLease(record.lease, signal);
    this.scheduleExpiry();
  }

  private async invalidateLease(lease: FocusLease, signal: AbortSignal): Promise<void> {
    if (this.leases.get(lease.key) !== lease) return;
    this.leases.delete(lease.key);
    for (const handle of [...lease.members.keys()]) {
      const record = this.registrations.get(handle);
      if (!record || record.lease !== lease) continue;
      this.registrations.delete(handle);
      lease.members.delete(handle);
      this.rememberCancellation(record.publicHandle, record.hostGeneration);
      this.onInvalidated(handle);
    }
    await this.releaseLease(lease, signal);
    this.scheduleExpiry();
  }

  private isCurrent(record: FocusRegistrationRecord, epoch = record.lease.epoch): boolean {
    return (
      !this.closing &&
      !this.isCancelled(record) &&
      this.registrations.get(record.publicHandle) === record &&
      this.leases.get(record.lease.key) === record.lease &&
      record.lease.epoch === epoch &&
      record.lease.members.has(record.publicHandle)
    );
  }

  private isCancelled(record: FocusRegistrationRecord): boolean {
    return this.hasCancellation(record.publicHandle, record.hostGeneration);
  }

  private hasCancellation(publicHandle: string, hostGeneration: string): boolean {
    return this.cancellationFences.has(cancellationKey(publicHandle, hostGeneration));
  }

  private rememberCancellation(publicHandle: string, hostGeneration: string): void {
    const key = cancellationKey(publicHandle, hostGeneration);
    this.cancellationFences.delete(key);
    this.cancellationFences.set(key, true);
    while (this.cancellationFences.size > MAXIMUM_CANCELLATION_FENCES) {
      const oldest = this.cancellationFences.keys().next().value;
      if (typeof oldest !== "string") break;
      this.cancellationFences.delete(oldest);
    }
  }

  private countAdmission(key: string): number {
    let count = 0;
    for (const record of this.registrations.values()) {
      if (record.admissionKey === key) count += 1;
    }
    return count;
  }

  private knownFocusSurfaces(): readonly KnownFocusSurface[] {
    return [...this.leases.values()].map((lease) => ({
      backend: lease.kind,
      leaseKey: lease.key,
      epoch: lease.epoch,
      surface: lease.surface,
    }));
  }

  private scheduleExpiry(delay?: number): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    if (this.closing || this.registrations.size === 0) return;
    const nextExpiry = Math.min(
      ...[...this.registrations.values()].map((record) => record.expiresAt),
    );
    const wait = delay ?? Math.max(0, nextExpiry - this.now());
    this.expiryTimer = setTimeout(() => void this.expireDue(), wait);
    this.expiryTimer.unref?.();
  }

  private async expireDue(): Promise<void> {
    this.expiryTimer = undefined;
    const now = this.now();
    const expired = [...this.registrations.values()].filter((record) => record.expiresAt <= now);
    await Promise.allSettled(
      expired.map(async (record) => {
        this.rememberCancellation(record.publicHandle, record.hostGeneration);
        try {
          await this.scheduler.run(
            compositorQueueKey(record.lease.surface.hyprlandInstance),
            NEVER_ABORTED,
            async (signal) => {
              const current = this.registrations.get(record.publicHandle);
              if (current === record && current.expiresAt <= this.now()) {
                await this.invalidate(current, signal);
              }
            },
          );
        } catch {
          // Capacity is retried by the single expiry scheduler.
        }
      }),
    );
    this.scheduleExpiry(expired.length > 0 ? 10 : undefined);
  }

  private async releaseLease(lease: FocusLease, signal: AbortSignal): Promise<void> {
    try {
      await this.backends.release(lease, signal);
    } catch {
      // Backends use compare-and-restore; unknown ownership remains untouched.
    }
  }

  private async releaseLeaseBestEffort(lease: FocusLease): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 750);
    try {
      await this.releaseLease(lease, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }
}

function cancellationKey(publicHandle: string, hostGeneration: string): string {
  return `${publicHandle}\u0000${hostGeneration}`;
}

function compositorQueueKey(hyprlandInstance: string): string {
  return `hyprland\u0000${hyprlandInstance}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function validateLimits(limits: CoordinatorLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("focus limits were invalid");
  }
}

async function boundedWait(operation: Promise<unknown>, milliseconds: number): Promise<boolean> {
  if (milliseconds <= 0) return false;
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
