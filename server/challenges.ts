/**
 * Short-lived, single-use challenge store for instance possession proofs.
 *
 * A challenge is created for ONE instanceId + public key and scoped to ONE
 * operation. `consume` is atomic in this process: a challenge can be consumed
 * exactly once, only before its expiry, and only for the operation it was
 * issued for. Replaying a consumed challenge, using an expired one, or using
 * a challenge for a different operation all fail closed.
 *
 * The Render service is intentionally a single instance (see README), so an
 * in-memory store is correct and bounded; a server restart simply invalidates
 * outstanding challenges, forcing a fresh request.
 */
import { randomChallengeBytes } from '../src/connect/crypto.js';

export interface StoredChallenge {
  id: string;
  instanceId: string;
  publicKey: JsonWebKey;
  operation: string;
  /** The exact canonical challenge string the client must sign. */
  challenge: string;
  expiresAt: number;
  usedAt: number | null;
}

export class ChallengeStore {
  private readonly challenges = new Map<string, StoredChallenge>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  create(input: {
    instanceId: string;
    publicKey: JsonWebKey;
    operation: string;
  }): StoredChallenge {
    const challenge: StoredChallenge = {
      id: crypto.randomUUID(),
      instanceId: input.instanceId,
      publicKey: input.publicKey,
      operation: input.operation,
      challenge: Buffer.from(randomChallengeBytes(32)).toString('base64url'),
      expiresAt: this.now() + this.ttlMs,
      usedAt: null,
    };
    this.challenges.set(challenge.id, challenge);
    return challenge;
  }

  /** Atomically consume a challenge for the given operation. Returns the
   * stored challenge only when it exists, is unused, unexpired, and matches
   * the operation; otherwise null. */
  consume(id: string, operation: string): StoredChallenge | null {
    const challenge = this.challenges.get(id);
    if (!challenge) return null;
    const now = this.now();
    if (challenge.usedAt !== null || challenge.expiresAt <= now || challenge.operation !== operation) {
      this.challenges.delete(id);
      return null;
    }
    challenge.usedAt = now;
    return challenge;
  }

  /** Drop expired/used entries (lazy cleanup; the map stays bounded by the
   * rate limiter in front of `create`). */
  sweep(): void {
    const now = this.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.usedAt !== null || challenge.expiresAt <= now) this.challenges.delete(id);
    }
  }

  size(): number {
    return this.challenges.size;
  }
}
