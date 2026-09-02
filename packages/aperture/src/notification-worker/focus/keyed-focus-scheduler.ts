import { FocusRegistrationError, throwIfAborted } from "./types.js";

export class KeyedFocusScheduler {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly controllers = new Set<AbortController>();
  private queued = 0;
  private closed = false;

  constructor(private readonly maximumQueued: number) {}

  run<T>(
    key: string,
    externalSignal: AbortSignal,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.closed || this.queued >= this.maximumQueued) {
      throw new FocusRegistrationError("capacity");
    }
    this.queued += 1;
    const controller = new AbortController();
    const onAbort = (): void => controller.abort();
    externalSignal.addEventListener("abort", onAbort, { once: true });
    if (externalSignal.aborted) controller.abort();
    this.controllers.add(controller);

    const prior = this.tails.get(key) ?? Promise.resolve();
    const result = prior
      .catch(() => undefined)
      .then(async () => {
        throwIfAborted(controller.signal);
        return operation(controller.signal);
      });
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    return result.finally(() => {
      this.queued -= 1;
      this.controllers.delete(controller);
      externalSignal.removeEventListener("abort", onAbort);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
  }

  abortAll(): void {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.tails.values()]);
  }
}
