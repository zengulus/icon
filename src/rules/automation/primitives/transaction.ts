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
 * party + personal pools (p.99), sacrifice + payoff, and multi-actor
 * relocation. Each domain keeps its OWN legality (spatial stays spatial,
 * payment stays economy, creation stays creation) — this underlay is the
 * GROUPING + COMMIT contract, never one merged validation algorithm:
 *
 *   1. propose intents (the legs);
 *   2. validate every required leg against the authoritative snapshot;
 *   3. if every leg is legal, emit the mutations;
 *   4. otherwise reject (or take an explicitly source-defined fallback) —
 *      never leave half-applied state.
 *
 * COLLECTIVE DEPENDENCE: a transaction is not only a bag of independent
 * validators over one snapshot. Two families exist and are BOTH
 * representable here, via the declared `mode`:
 *
 *   - `simultaneous` (default) — every leg validates against the ORIGINAL
 *     common pre-state. This is the source-defined swap family: each swap
 *     leg's legality is judged against the pre-swap state (Masquerade-style
 *     groups), never against the other legs' projected effects.
 *   - `sequential` — leg i validates against the state projected by the
 *     EARLIER proposed legs (the deterministic provisional-state
 *     projection, `project(snapshot, applied)`). This is the cumulative
 *     family: multiple spends against one pool, split pools, creation
 *     conflicts, sacrifice + payoff. The projection is the CALLER's domain
 *     projection (payment stays economy) — the generic authority never
 *     guesses how an intent changes state; a sequential transaction
 *     WITHOUT a projection fails (a programming error, never a silent
 *     fallback to simultaneous semantics).
 *
 * Command/event purity: the verdict is resolved BEFORE any event is
 * emitted. Replay applies the already-decided result and does not
 * revalidate/re-decide from future state — the reducer never re-runs
 * `validateTransaction` on a recorded event.
 *
 * Foundation: no source IDs, no kernel imports. The domain legality lives
 * in the domain authorities; this module owns only the grouping, the
 * validation mode, and the all-or-nothing verdict.
 */

/** One leg of a transaction: the intent (a proposed mutation or sub-
 * operation) plus its legality check against the CURRENT validation
 * snapshot (the original snapshot in `simultaneous` mode, the projected
 * state in `sequential` mode). The validate function is a pure read of the
 * snapshot — it never mutates, so every leg validates against the snapshot
 * the mode/projection determined. */
export interface TransactionLeg<Intent, Snapshot> {
  intent: Intent;
  /** Returns a rejection reason, or null when the leg is legal. */
  validate(snapshot: Snapshot): string | null;
}

/** How a transaction's legs relate to the snapshot:
 *
 * - `simultaneous` — every leg validates against the ORIGINAL common
 *   pre-state (source-defined swaps: each leg judged pre-swap, never
 *   against the other legs' projected effects).
 * - `sequential` — leg i validates against the state projected by the
 *   earlier proposed legs (`project(snapshot, applied)`): multiple spends
 *   against one pool, split pools, creation conflicts, sacrifice + payoff.
 *   REQUIRES a `project` (a sequential transaction without a projection
 *   cannot honestly express cumulative legality — fail, never silently
 *   fall back to simultaneous semantics). */
export type TransactionMode = 'simultaneous' | 'sequential';

/** The full transaction spec: the legs plus their declared validation mode
 * and (for sequential mode) the deterministic provisional-state
 * projection. */
export interface TransactionSpec<Intent, Snapshot> {
  legs: readonly TransactionLeg<Intent, Snapshot>[];
  /** 'simultaneous' (default): every leg validates against the original
   * snapshot. 'sequential': each leg validates against the state projected
   * by the earlier legs. */
  mode?: TransactionMode;
  /** Deterministic provisional-state projection for 'sequential' mode: the
   * validation snapshot for leg i is `project(snapshot, intents[0..i-1])`.
   * A PURE function of the snapshot + the applied intents — replay derives
   * the same projected state. Required for sequential mode. */
  project?(snapshot: Snapshot, applied: readonly Intent[]): Snapshot;
}

/** The all-or-nothing verdict over a transaction's legs. `ok: true` means
 * EVERY leg validated (against the snapshot the mode/projection determined);
 * the caller may emit the intents' mutations. `ok: false` names the first
 * failing leg and its reason; nothing was committed and no partial state
 * exists. */
export type TransactionVerdict =
  | { ok: true }
  | { ok: false; reason: string; failedIndex: number };

/** Validate every leg of a transaction. Pure — a deterministic function of
 * the legs, the mode, the projection, and the snapshot; the caller commits
 * (or rejects) based on the verdict, never half-applying. A `sequential`
 * transaction without a `project` is a programming error and fails closed
 * (throws) rather than silently degrading to simultaneous semantics. */
export function validateTransaction<Intent, Snapshot>(
  spec: TransactionSpec<Intent, Snapshot>,
  snapshot: Snapshot,
): TransactionVerdict {
  const mode = spec.mode ?? 'simultaneous';
  if (mode === 'sequential' && spec.project === undefined) {
    throw new Error('A sequential transaction requires a deterministic provisional-state projection (project).');
  }
  const applied: Intent[] = [];
  for (let index = 0; index < spec.legs.length; index += 1) {
    // sequential mode: the validation snapshot is the state projected by the
    // EARLIER proposed legs (never by the current leg or later ones).
    const validationSnapshot = mode === 'sequential'
      ? spec.project!(snapshot, applied)
      : snapshot;
    const reason = spec.legs[index].validate(validationSnapshot);
    if (reason !== null) {
      return { ok: false, reason, failedIndex: index };
    }
    applied.push(spec.legs[index].intent);
  }
  return { ok: true };
}

/** The propose→validate→commit convenience: returns the intents ready for
 * commit, or the rejection verdict. The caller emits the returned intents'
 * mutations ONLY on `ok: true`. */
export function proposeAtomicGroup<Intent, Snapshot>(
  spec: TransactionSpec<Intent, Snapshot>,
  snapshot: Snapshot,
): { ok: true; intents: Intent[] } | { ok: false; reason: string; failedIndex: number } {
  const verdict = validateTransaction(spec, snapshot);
  if (!verdict.ok) return verdict;
  return { ok: true, intents: spec.legs.map((leg) => leg.intent) };
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
