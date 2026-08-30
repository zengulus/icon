/**
 * Minimal fixed-window in-memory rate limiter for the account endpoints.
 *
 * The Render service is a single instance, so in-memory state is correct and
 * does not need a shared store. Buckets are keyed by the caller (IP at the
 * HTTP layer; an injected key in tests). Entries expire lazily so the map
 * cannot grow without bound.
 */

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Rate limit must be a positive integer.');
    if (!Number.isInteger(windowMs) || windowMs < 1_000) throw new Error('Rate limit window must be at least one second.');
  }

  /** True when the caller may proceed; false when the window is exhausted. */
  allow(key: string): boolean {
    const timestamp = this.now();
    const current = this.buckets.get(key);
    if (!current || timestamp - current.windowStart >= this.windowMs) {
      this.buckets.set(key, { windowStart: timestamp, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }
}
