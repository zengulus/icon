/**
 * transaction.ts — U15 TRANSACTION / ATOMIC COMMIT: ONE generic authority
 * for "which proposed state changes must validate together before any
 * commit".
 *
 * ICON has several multi-leg operations the source makes all-or-nothing:
 * costs/spends validated before any effect or RNG (p.99, p.102/103 —
 * `assertRuleCostsPayable` prior art), swap groups every-leg-or-none
 * (p.151, p.163, p.300 — `spatialBatchId` prior art), exact-count entity
 * creation (p.95/p.107/p.108 — `countMode: 'exact'`), resolve split across
 * party + personal pools (p.99), and multi-actor relocation. Each domain
 * keeps its OWN legality (spatial stays spatial, payment stays economy,
 * creation stays creation) — this underlay is the GROUPING + COMMIT
 * contract, never one merged validation algorithm:
 *
 *   1. propose intents (the legs);
 *   2. validate every required leg against ONE authoritative/intermediate
 *      snapshot;
 *   3. if every leg is legal, emit the mutations;
 *   4. otherwise reject (or take an explicitly source-defined fallback) —
 *      never leave half-applied state.
 *
 * Command/event purity: the verdict is resolved BEFORE any event is
 * emitted. Replay applies the already-decided result and does not
 * revalidate/re-decide from future state — the reducer never re-runs
 * `validateTransaction` on a recorded event.
 *
 * Foundation: no source IDs, no kernel imports. The domain legality lives
 * in the domain authorities; this module owns only the grouping and the
 * all-or-nothing verdict.
 */

/** One leg of a transaction: the intent (a proposed mutation or sub-
 * operation) plus its legality check against the shared snapshot. The
 * validate function is a pure read of the snapshot — it never mutates, so
 * the same snapshot validates every leg consistently (the ONE
 * authoritative/intermediate state). */
export interface TransactionLeg<Intent, Snapshot> {
  intent: Intent;
  /** Returns a rejection reason, or null when the leg is legal. */
  validate(snapshot: Snapshot): string | null;
}

/** The all-or-nothing verdict over a transaction's legs. `ok: true` means
 * EVERY leg validated against the same snapshot — the caller may emit the
 * intents' mutations. `ok: false` names the first failing leg and its
 * reason; nothing was committed and no partial state exists. */
export type TransactionVerdict =
  | { ok: true }
  | { ok: false; reason: string; failedIndex: number };

/** Validate every leg of a transaction against ONE snapshot. Pure — a
 * deterministic function of the legs and the snapshot; the caller commits
 * (or rejects) based on the verdict, never half-applying. */
export function validateTransaction<Intent, Snapshot>(
  legs: readonly TransactionLeg<Intent, Snapshot>[],
  snapshot: Snapshot,
): TransactionVerdict {
  for (let index = 0; index < legs.length; index += 1) {
    const reason = legs[index].validate(snapshot);
    if (reason !== null) {
      return { ok: false, reason, failedIndex: index };
    }
  }
  return { ok: true };
}

/** The propose→validate→commit convenience: returns the intents ready for
 * commit, or the rejection verdict. The caller emits the returned intents'
 * mutations ONLY on `ok: true`. */
export function proposeAtomicGroup<Intent, Snapshot>(
  legs: readonly TransactionLeg<Intent, Snapshot>[],
  snapshot: Snapshot,
): { ok: true; intents: Intent[] } | { ok: false; reason: string; failedIndex: number } {
  const verdict = validateTransaction(legs, snapshot);
  if (!verdict.ok) return verdict;
  return { ok: true, intents: legs.map((leg) => leg.intent) };
}

/** Convenience for a leg whose validate is a predicate: convert a boolean
 * legality check into a reason-or-null validate. */
export function legWithCheck<Intent, Snapshot>(
  intent: Intent,
  check: (snapshot: Snapshot) => boolean,
  reason: string,
): TransactionLeg<Intent, Snapshot> {
  return {
    intent,
    validate: (snapshot) => (check(snapshot) ? null : reason),
  };
}
