type RuntimeRateLimitBucket = {
  startedAt: number;
  count: number;
};

type RuntimeRateLimiterOptions = {
  windowMs: number;
  limits: Record<string, number>;
};

export class RuntimeRateLimiter {
  private readonly windowMs: number;
  private readonly limits: Record<string, number>;
  private readonly buckets = new Map<string, RuntimeRateLimitBucket>();

  constructor(options: RuntimeRateLimiterOptions) {
    this.windowMs = options.windowMs;
    this.limits = options.limits;
  }

  check(key: string, limitKey: keyof RuntimeRateLimiterOptions["limits"] | string): boolean {
    const limit = this.limits[limitKey];
    if (limit === undefined) {
      return true;
    }

    const now = Date.now();
    const bucketKey = `${limitKey}:${key}`;
    const current = this.buckets.get(bucketKey);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(bucketKey, { startedAt: now, count: 1 });
      return true;
    }

    if (current.count >= limit) {
      return false;
    }

    current.count += 1;
    return true;
  }
}
