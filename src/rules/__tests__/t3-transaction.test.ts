/**
 * t3-transaction.test.ts — Phase T3 U15 TRANSACTION / ATOMIC COMMIT tests
 * (corrected contract).
 *
 * The generic authority (`primitives/transaction.ts`) is ATOMIC GROUPING +
 * COMMIT: propose intents → validate every leg → if all legal, emit; else
 * reject — never half-applied state. The per-domain legality stays in the
 * domain authorities (spatial stays spatial, payment stays economy); this
 * underlay owns the verdict, the all-or-nothing guarantee, and the
 * COLLECTIVE-DEPENDENCE mode:
 *
 *   - `simultaneous` — every leg validates against the ORIGINAL common
 *     pre-state (source-defined swaps: each leg judged pre-swap, never
 *     against the other legs' projected effects).
 *   - `sequential` — leg i validates against the state projected by the
 *     EARLIER proposed legs (`project(snapshot, applied)`): multiple spends
 *     against one pool, split pools, creation conflicts, sacrifice + payoff.
 *     The projection is the CALLER's domain projection (payment stays
 *     economy) — the generic authority never guesses how an intent changes
 *     state, and a sequential transaction WITHOUT a projection fails
 *     (never a silent fallback to simultaneous semantics).
 *
 * Covered here: the corrected wallet test (3 + 4 against a 5 wallet rejects
 * WITHOUT the second validator manually subtracting the first spend),
 * mutually incompatible legs, simultaneous swap semantics against the common
 * pre-state, no-intents-on-failure, the sequential-without-projection
 * programming-error fail, deterministic replay, and the Masquerade
 * spatial-batch gate composition through the seam.
 */
import { describe, expect, it } from 'vitest';
import {
  legWithCheck,
  proposeAtomicGroup,
  validateTransaction,
  type TransactionLeg,
  type TransactionSpec,
} from '../automation/primitives/transaction.js';

interface Wallet {
  aether: number;
}

interface Spend {
  resourceId: string;
  amount: number;
}

const spendLeg = (amount: number): TransactionLeg<Spend, Wallet> => ({
  intent: { resourceId: 'aether', amount },
  validate: (snap) => (snap.aether >= amount ? null : 'insufficient aether'),
});

describe('U15 — all-or-nothing commit', () => {
  it('every leg legal → the intents are returned for commit', () => {
    const spec: TransactionSpec<Spend | { label: string }, Wallet> = {
      legs: [
        { intent: { resourceId: 'aether', amount: 2 }, validate: (snap) => (snap.aether >= 2 ? null : 'insufficient aether') },
        { intent: { label: 'effect' }, validate: () => null },
      ],
    };
    const result = proposeAtomicGroup(spec, { aether: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.intents).toHaveLength(2);
    }
  });

  it('second-leg failure rejects the whole group — nothing commits', () => {
    const spec: TransactionSpec<Spend | { label: string }, Wallet> = {
      legs: [
        { intent: { resourceId: 'aether', amount: 2 }, validate: () => null },
        { intent: { label: 'effect' }, validate: () => 'effect not legal now' },
      ],
    };
    const result = proposeAtomicGroup(spec, { aether: 5 });
    expect(result).toEqual({ ok: false, reason: 'effect not legal now', failedIndex: 1 });
  });

  it('failure emits no intents: proposeAtomicGroup never returns partial intents', () => {
    const spec: TransactionSpec<Spend, Wallet> = {
      mode: 'sequential',
      project: (snap, applied) => ({ aether: snap.aether - applied.reduce((total, spend) => total + spend.amount, 0) }),
      legs: [spendLeg(3), spendLeg(4)],
    };
    const result = proposeAtomicGroup(spec, { aether: 5 });
    expect(result).toEqual({ ok: false, reason: 'insufficient aether', failedIndex: 1 });
  });

  it('deterministic replay: the same snapshot + legs produce the same verdict every time', () => {
    const spec: TransactionSpec<Spend, Wallet> = { legs: [spendLeg(2)] };
    expect(validateTransaction(spec, { aether: 1 })).toEqual({ ok: false, reason: 'insufficient aether', failedIndex: 0 });
    expect(validateTransaction(spec, { aether: 1 })).toEqual({ ok: false, reason: 'insufficient aether', failedIndex: 0 });
    expect(validateTransaction(spec, { aether: 2 })).toEqual({ ok: true });
  });
});

describe('U15 — collective dependence: cumulative spends (the corrected wallet contract)', () => {
  // The wallet contract: wallet 5, spends 3 + 4. Each leg is INDIVIDUALLY
  // legal against the original state (5 >= 3, 5 >= 4) — the transaction must
  // still reject because the aggregate is illegal. The validators never
  // manually subtract an earlier spend: the declared `project` derives the
  // cumulative validation snapshot deterministically.
  const cumulative: TransactionSpec<Spend, Wallet> = {
    mode: 'sequential',
    project: (snap, applied) => ({ aether: snap.aether - applied.reduce((total, spend) => total + spend.amount, 0) }),
    legs: [spendLeg(3), spendLeg(4)],
  };

  it('against the ORIGINAL state both legs are individually legal (simultaneous mode)', () => {
    // The same legs in simultaneous mode validate against the unchanged
    // pre-state — proof the rejection below is the aggregate, not an
    // individually illegal leg.
    expect(validateTransaction({ ...cumulative, mode: 'simultaneous' }, { aether: 5 })).toEqual({ ok: true });
  });

  it('the cumulative transaction rejects the aggregate without manual subtraction', () => {
    expect(validateTransaction(cumulative, { aether: 5 })).toEqual({ ok: false, reason: 'insufficient aether', failedIndex: 1 });
  });

  it('a cumulative spend within the wallet commits (3 + 2 against 5)', () => {
    const spec: TransactionSpec<Spend, Wallet> = {
      mode: 'sequential',
      project: (snap, applied) => ({ aether: snap.aether - applied.reduce((total, spend) => total + spend.amount, 0) }),
      legs: [spendLeg(3), spendLeg(2)],
    };
    expect(validateTransaction(spec, { aether: 5 })).toEqual({ ok: true });
  });

  it('a sequential transaction without a projection fails closed (never silently simultaneous)', () => {
    const spec: TransactionSpec<Spend, Wallet> = { mode: 'sequential', legs: [spendLeg(1)] };
    expect(() => validateTransaction(spec, { aether: 5 })).toThrow(/projection/);
  });
});

describe('U15 — mutually incompatible legs (creation conflicts)', () => {
  interface Placement {
    cell: string;
  }
  interface Grid {
    occupied: Set<string>;
  }

  const placement = (cell: string): TransactionLeg<Placement, Grid> => ({
    intent: { cell },
    validate: (snap) => (snap.occupied.has(cell) ? 'cell occupied' : null),
  });

  it('two placements of the same cell: individually legal, mutually incompatible', () => {
    // Both legs are legal against the EMPTY original grid (simultaneous
    // mode) — the conflict only exists between the proposed legs.
    const conflicting: TransactionSpec<Placement, Grid> = {
      mode: 'sequential',
      project: (snap, applied) => ({ occupied: new Set([...snap.occupied, ...applied.map((p) => p.cell)]) }),
      legs: [placement('5,5'), placement('5,5')],
    };
    expect(validateTransaction({ ...conflicting, mode: 'simultaneous' }, { occupied: new Set() })).toEqual({ ok: true });
    // Sequentially, the first placement projects onto the validation
    // snapshot and the second conflicts — the whole transaction rejects.
    expect(validateTransaction(conflicting, { occupied: new Set() })).toEqual({ ok: false, reason: 'cell occupied', failedIndex: 1 });
  });

  it('distinct cells commit (the same projection, no conflict)', () => {
    const spec: TransactionSpec<Placement, Grid> = {
      mode: 'sequential',
      project: (snap, applied) => ({ occupied: new Set([...snap.occupied, ...applied.map((p) => p.cell)]) }),
      legs: [placement('5,5'), placement('6,6')],
    };
    expect(validateTransaction(spec, { occupied: new Set() })).toEqual({ ok: true });
  });
});

describe('U15 — simultaneous swap semantics against the common pre-state', () => {
  interface Move {
    actor: string;
    to: number;
  }
  interface Board {
    cellOf: Record<string, number>;
  }

  const noOverlap = (snap: Board): string | null => (snap.cellOf.a === snap.cellOf.b ? 'overlap' : null);

  it('a Masquerade-style swap validates every leg against the pre-swap state', () => {
    // A and B exchange cells. Simultaneous mode judges each leg against the
    // ORIGINAL board (a at 1, b at 2 — no overlap): the swap is legal even
    // though each leg's own projection would create an overlap.
    const spec: TransactionSpec<Move, Board> = {
      mode: 'simultaneous',
      legs: [
        { intent: { actor: 'a', to: 2 }, validate: noOverlap },
        { intent: { actor: 'b', to: 1 }, validate: noOverlap },
      ],
    };
    expect(validateTransaction(spec, { cellOf: { a: 1, b: 2 } })).toEqual({ ok: true });
  });

  it('a sequential projection would wrongly reject the same swap (why simultaneous is required)', () => {
    // Applying leg A's move first projects both actors into cell 2; leg B is
    // then judged against the projected overlap and rejected. This is
    // precisely why source-defined swaps need the simultaneous pre-state.
    const spec: TransactionSpec<Move, Board> = {
      mode: 'sequential',
      project: (snap, applied) => {
        const cellOf = { ...snap.cellOf };
        for (const move of applied) cellOf[move.actor] = move.to;
        return { cellOf };
      },
      legs: [
        { intent: { actor: 'a', to: 2 }, validate: noOverlap },
        { intent: { actor: 'b', to: 1 }, validate: noOverlap },
      ],
    };
    expect(validateTransaction(spec, { cellOf: { a: 1, b: 2 } }).ok).toBe(false);
  });
});

describe('U15 — the spatial-batch gate composes through the seam', () => {
  it('a denied atomic spatial leg rejects the whole batch (the Masquerade contract)', () => {
    // Replicates the command-boundary composition in encounter.ts
    // assertLegalSpatialBatch: every move leg of the source-declared atomic
    // group is validated against the SAME pre-swap snapshot (simultaneous
    // mode); one denied leg rejects the whole action before any event is
    // emitted.
    const deniedIndices = new Set([1]);
    const legs = [
      { intent: { id: 'swap-a' }, validate: () => (deniedIndices.has(0) ? 'denied' : null) },
      { intent: { id: 'swap-b' }, validate: () => (deniedIndices.has(1) ? 'denied' : null) },
    ];
    const verdict = validateTransaction({ mode: 'simultaneous', legs }, {});
    expect(verdict).toEqual({ ok: false, reason: 'denied', failedIndex: 1 });
    // With no denied leg the whole group commits.
    expect(validateTransaction({
      mode: 'simultaneous',
      legs: [
        { intent: { id: 'swap-a' }, validate: () => null },
        { intent: { id: 'swap-b' }, validate: () => null },
      ],
    }, {})).toEqual({ ok: true });
  });

  it('legWithCheck converts a boolean legality check into a reason-or-null validate', () => {
    const verdict = validateTransaction<Spend, Wallet>({
      legs: [
        legWithCheck({ resourceId: 'aether', amount: 2 }, (snap) => snap.aether >= 2, 'insufficient aether'),
        legWithCheck({ resourceId: 'aether', amount: 4 }, (snap) => snap.aether >= 4, 'insufficient aether'),
      ],
    }, { aether: 5 });
    expect(verdict).toEqual({ ok: true });
  });
});
