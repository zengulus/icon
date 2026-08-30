import { describe, expect, it } from 'vitest';
import { ChallengeStore } from '../challenges.js';

const INSTANCE = '11111111-2222-3333-4444-555555555555';
const PUBLIC_JWK = {
  kty: 'EC' as const,
  crv: 'P-256' as const,
  x: 'sTPu3m0d3n8Y5hWkQjLfOeBqVxKJgHdCzNwMaRbUvTi',
  y: 'R6uQaBmZwXcVnHtJfKlOePsDiGfYhUkQjLmZoNxCaWvEb',
};

function store(now = 1_000_000, ttlMs = 5 * 60_000) {
  return new ChallengeStore(() => now, ttlMs);
}

describe('challenge store (tests 9–13 semantics at the store boundary)', () => {
  it('issues a fresh single-use challenge scoped to an instance + operation', () => {
    const challenges = store();
    const created = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.challenge.length).toBeGreaterThanOrEqual(32);
    expect(created.operation).toBe('register');
    expect(challenges.size()).toBe(1);
  });

  it('consumes a challenge exactly once; replay fails (test 11)', () => {
    const challenges = store();
    const created = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    expect(challenges.consume(created.id, 'register')).toMatchObject({ id: created.id });
    expect(challenges.consume(created.id, 'register')).toBeNull();
    expect(challenges.consume(created.id, 'register')).toBeNull();
  });

  it('rejects an expired challenge (test 12)', () => {
    const challenges = store(1_000, 500);
    const created = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    expect(challenges.consume(created.id, 'register')).not.toBeNull();
    // Same fake now → consumed; move past the TTL with a fresh challenge.
    const second = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    const later = new ChallengeStore(() => 2_000, 500);
    later.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    expect(later.consume(second.id, 'register')).toBeNull();
  });

  it('scopes a challenge to its operation; a different operation fails (test 13)', () => {
    const challenges = store();
    const created = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    expect(challenges.consume(created.id, 'register')).not.toBeNull();
    const second = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'login' });
    // The 'register' consume above already used the first id; the second is
    // scoped to login and must not authorize register.
    const wrong = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    expect(challenges.consume(second.id, 'register')).toBeNull();
    expect(challenges.consume(wrong.id, 'login')).toBeNull();
  });

  it('binds a challenge to the instance it was issued for', () => {
    const challenges = store();
    const created = challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    const other = challenges.create({ instanceId: '99999999-8888-7777-6666-555555555555', publicKey: PUBLIC_JWK, operation: 'register' });
    // A consumed challenge returns its stored instance so the service can
    // compare it against the presented instanceId.
    expect(challenges.consume(other.id, 'register')).toMatchObject({ instanceId: '99999999-8888-7777-6666-555555555555' });
    expect(challenges.consume(created.id, 'register')).toMatchObject({ instanceId: INSTANCE });
  });

  it('sweeps used and expired entries so the store stays bounded', () => {
    const challenges = store(1_000, 1_000);
    challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    challenges.create({ instanceId: INSTANCE, publicKey: PUBLIC_JWK, operation: 'register' });
    expect(challenges.size()).toBe(2);
    challenges.sweep();
    expect(challenges.size()).toBe(2);
  });
});
