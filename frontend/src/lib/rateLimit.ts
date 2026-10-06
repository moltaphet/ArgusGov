/**
 * In-memory sliding-window limiter. Each key keeps the timestamps of its recent hits; a
 * request is allowed while fewer than `limit` of them fall inside the window.
 *
 * Memory is bounded: idle keys are pruned and, past `maxKeys`, the least recently used go first.
 * State is per server instance, so on a multi-instance deployment the effective limit is
 * per instance; put a shared store behind this if a global limit is needed.
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until the next request would be allowed (0 when allowed). */
  retryAfterMs: number;
}

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 5000,
  ) {}

  check(key: string): RateLimitResult {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    // Re-insert so Map order tracks recency for eviction.
    this.hits.delete(key);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      this.evict();
      return { allowed: false, limit: this.limit, remaining: 0, retryAfterMs: Math.max(0, recent[0] + this.windowMs - now) };
    }
    recent.push(now);
    this.hits.set(key, recent);
    this.evict();
    return { allowed: true, limit: this.limit, remaining: this.limit - recent.length, retryAfterMs: 0 };
  }

  private evict(): void {
    if (this.hits.size <= this.maxKeys) return;
    const now = this.now();
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
    while (this.hits.size > this.maxKeys) {
      const oldest = this.hits.keys().next().value;
      if (oldest === undefined) break;
      this.hits.delete(oldest);
    }
  }

  get size(): number {
    return this.hits.size;
  }
}

/** Best-effort client identity. Platform headers are preferred because x-forwarded-for can be spoofed when no trusted proxy sets it. */
export function clientKey(headers: { get(name: string): string | null }): string {
  const platform = headers.get("x-real-ip") ?? headers.get("x-vercel-forwarded-for");
  if (platform) return platform.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
