/**
 * t3-transaction.test.ts — Phase T3 U15 TRANSACTION / ATOMIC COMMIT tests.
 *
 * The generic authority (`primitives/transaction.ts`) is ATOMIC GROUPING +
 * COMMIT: propose intents → validate every leg against ONE snapshot → if all
 * legal, emit; else reject — never half-applied state. The per-domain
 * legality stays in the domain authorities (spatial stays spatial, payment
 * stays economy); this underlay owns the verdict and the all-or-nothing
 * guarantee.
 *
 * Covered here: second-leg failure rejects the whole group, a partial
 * resource spend never happens, the caller emits nothing on rejection
 * (no-event guarantee), the verdict is deterministic (replay property), and
 * the Masquerade spatial-batch gate composes through the seam exactly as the
 * command boundary does (denied leg → reject before any event).
 */
import { describe, expect, it } from 'vitest';
import {
  legWithCheck,
  proposeAtomicGroup,
  validateTransaction,
  type TransactionLeg,
} from '../automation/primitives/transaction.js';

interface ResourceSpendLeg {
  resourceId: string;
  amount: number;
}
interface EffectLeg {
  label: string;
}

interface Wallet {
  aether: number;
}

describe('U15 — all-or-nothing commit', () => {
  it('every leg legal → the intents are returned for commit', () => {
    const legs: TransactionLeg<ResourceSpendLeg | EffectLeg, Wallet>[] = [
      { intent: { resourceId: 'aether', amount: 2 }, validate: (snap) => (snap.aether >= 2 ? null : 'insufficient aether') },
      { intent: { label: 'effect' }, validate: () => null },
    ];
    const result = proposeAtomicGroup(legs, { aether: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intents).toHaveLength(2);
    }
  });

  it('second-leg failure rejects the whole group — nothing commits', () => {
    const legs: TransactionLeg<ResourceSpendLeg | EffectLeg, Wallet>[] = [
      { intent: { resourceId: 'aether', amount: 2 }, validate: () => null },
      { intent: { label: 'effect' }, validate: () => 'effect not legal now' },
    ];
    const result = proposeAtomicGroup(legs, { aether: 5 });
    expect(result).toEqual({ ok: false, reason: 'effect not legal now', failedIndex: 1 });
  });

  it('a partial resource spend never happens: the first leg fails → no mutation is emitted', () => {
    const result = proposeAtomicGroup<ResourceSpendLeg, Wallet>([
      { intent: { resourceId: 'aether', amount: 3 }, validate: (snap) => (snap.aether >= 3 ? null : 'insufficient aether') },
      { intent: { resourceId: 'aether', amount: 4 }, validate: (snap) => (snap.aether - 3 >= 4 ? null : 'insufficient aether after first leg') },
    ], { aether: 5 });
    // Both legs validated against the SAME snapshot: leg 2 fails, so leg 1's
    // spend is never emitted either. No half-applied state exists.
    expect(result).toEqual({ ok: false, reason: 'insufficient aether after first leg', failedIndex: 1 });
  });

  it('no-event guarantee: a rejected transaction produces no intents to emit', () => {
    const verdict = validateTransaction<ResourceSpendLeg | EffectLeg, Wallet>([
      legWithCheck({ resourceId: 'aether', amount: 2 }, (snap) => snap.aether >= 2, 'insufficient aether'),
      legWithCheck({ label: 'effect' }, () => false, 'effect not legal now'),
    ], { aether: 5 });
    expect(verdict.ok).toBe(false);
  });

  it('deterministic replay: the same snapshot + legs produce the same verdict every time', () => {
    const legs = [
      { intent: { resourceId: 'aether', amount: 2 }, validate: (snap: Wallet) => (snap.aether >= 2 ? null : 'insufficient aether') },
    ];
    expect(validateTransaction(legs, { aether: 1 })).toEqual({ ok: false, reason: 'insufficient aether', failedIndex: 0 });
    expect(validateTransaction(legs, { aether: 1 })).toEqual({ ok: false, reason: 'insufficient aether', failedIndex: 0 });
    expect(validateTransaction(legs, { aether: 2 })).toEqual({ ok: true });
  });
});

describe('U15 — the spatial-batch gate composes through the seam', () => {
  it('a denied atomic spatial leg rejects the whole batch (the Masquerade contract)', () => {
    // Replicates the command-boundary composition in encounter.ts
    // assertLegalSpatialBatch: every move leg of the source-declared atomic
    // group is validated against the SAME pre-swap snapshot; one denied leg
    // rejects the whole action before any event is emitted.
    const deniedIndices = new Set([1]);
    const legs = [
      { intent: { id: 'swap-a' }, validate: () => (deniedIndices.has(0) ? 'denied' : null) },
      { intent: { id: 'swap-b' }, validate: () => (deniedIndices.has(1) ? 'denied' : null) },
    ];
    const verdict = validateTransaction(legs, {});
    expect(verdict).toEqual({ ok: false, reason: 'denied', failedIndex: 1 });
    // With no denied leg the whole group commits.
    expect(validateTransaction([
      { intent: { id: 'swap-a' }, validate: () => null },
      { intent: { id: 'swap-b' }, validate: () => null },
    ], {})).toEqual({ ok: true });
  });
});
