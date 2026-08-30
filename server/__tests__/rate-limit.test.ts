import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter } from '../rate-limit.js';

describe('in-memory rate limiter (test 20)', () => {
  it('allows requests within the window up to the limit, then blocks (test 20)', () => {
    const limiter = new InMemoryRateLimiter(5, 60_000, () => 1_000);
    for (let index = 0; index < 5; index += 1) {
      expect(limiter.allow('caller-a')).toBe(true);
    }
    expect(limiter.allow('caller-a')).toBe(false);
    // A different caller has its own budget.
    expect(limiter.allow('caller-b')).toBe(true);
  });

  it('resets the window after it elapses', () => {
    let now = 1_000;
    const limiter = new InMemoryRateLimiter(2, 60_000, () => now);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
    now = 61_001;
    expect(limiter.allow('k')).toBe(true);
  });

  it('supports explicit reset (test 20)', () => {
    const limiter = new InMemoryRateLimiter(1, 60_000, () => 1_000);
    expect(limiter.allow('k')).toBe(true);
    expect(limiter.allow('k')).toBe(false);
    limiter.reset('k');
    expect(limiter.allow('k')).toBe(true);
  });

  it('rejects invalid configuration', () => {
    expect(() => new InMemoryRateLimiter(0, 60_000)).toThrow(/positive integer/i);
    expect(() => new InMemoryRateLimiter(5, 500)).toThrow(/at least one second/i);
  });
});
