/**
 * Use-ledger kernel — the source-ID-free usage gate family, now an adapter
 * over the U16 USAGE LEDGER CORE (`primitives/usage.ts`).
 *
 * One durable gate represents "once per turn", "once per round", and "once
 * per combat" with automatic reset at the authoritative lifecycle boundary:
 *
 * - `once-per-round` — a durable `ledger:round:<sourceId>` flag written when
 *   the use fires; a round-start lifecycle recipe clears every actor's round
 *   ledger. This is the F9 reactive job-trait fold's existing gate
 *   (`kernels/trait-reactions.ts` `roundLedgerKey` writes the identical key
 *   format), so the shared gate and F9 can never drift.
 * - `once-per-turn` — a durable `ledger:turn:<sourceId>` flag; a turn-start
 *   lifecycle recipe clears the flag on the actor whose turn begins.
 * - `once-per-combat` — a durable `ledger:combat:<sourceId>` flag that
 *   remains spent for the rest of the encounter (the encounter state ends
 *   with combat, so no reset boundary is needed).
 *
 * The keys, counts, consume/refresh mutations, and the per-period holds
 * read are the U16 core (`usageKey`/`usageCount`/`consumeUsageMutation`);
 * this module keeps the period-restricted compatibility surface
 * (`UseLedgerPeriod`, `useLedgerKey`, `useLedgerAvailable`,
 * `consumeUseLedgerMutation`, `holdsUseLedgerKey`) so existing consumers
 * and the F9 fold stay unchanged.
 *
 * The decision is made once at the command boundary and the mark rides the
 * ability's recorded event as a `state` mutation, so replay applies exactly
 * what the command decided and never re-decides whether the gate was open.
 *
 * This module contains no source IDs; `sourceId`/`gateSourceId` are
 * content-owned provenance strings recorded verbatim.
 */
import type { EncounterActor } from '../../types.js';
import type { BoundaryRef } from '../primitives/scope.js';
import {
  consumeUsageMutation,
  holdsUsageKey,
  usageCount,
  usageKey,
  usagePeriodForResetBoundary,
  type UsagePeriod,
} from '../primitives/usage.js';
import type { RuleMutation } from '../primitives/types.js';

export type UseLedgerPeriod = UsagePeriod;

/** The durable ruleState key for a usage gate. The round format matches the
 * F9 reactive fold's `ledger:round:<sourceId>` keys exactly (U16 core). */
export function useLedgerKey(period: UseLedgerPeriod, sourceId: string): string {
  return usageKey({ sourceId, ownerId: '', scope: period });
}

/** Whether the actor's ledger still allows the gated use to fire (U16 core:
 * the recorded count is below the one-shot cap). */
export function useLedgerAvailable(actor: Pick<EncounterActor, 'ruleState'>, key: string): boolean {
  return usageCount(actor, key) < 1;
}

/** The durable mark mutation: setting the gate's key records the use so a
 * second attempt is rejected until the boundary resets it (U16 core one-shot
 * consume — byte-identical to the long-standing mark). */
export function consumeUseLedgerMutation(
  sourceId: string,
  actorId: string,
  period: UseLedgerPeriod,
  gateSourceId: string,
): RuleMutation {
  return consumeUsageMutation(sourceId, actorId, useLedgerKey(period, gateSourceId));
}

/** True when the actor holds any ledger key of the given period (the
 * lifecycle reset recipes' cheap precondition — U16 core). */
export function holdsUseLedgerKey(actor: Pick<EncounterActor, 'ruleState'>, period: UseLedgerPeriod): boolean {
  return holdsUsageKey(actor, period);
}

/**
 * The U8-backed reset boundary for a period, re-exposed so a consumer can
 * derive the typed BoundaryRef a period refreshes at without knowing the
 * boundary vocabulary directly (U16 owns usage; U8 owns the temporal
 * boundaries). Delegates to the U16 core's `resetBoundaryFor`.
 */
export { resetBoundaryFor } from '../primitives/usage.js';

/**
 * U8-backed refresh of a usage period triggered by a recorded boundary:
 * clear every durable `ledger:<period>:*` key on the actor for the single
 * period the boundary refreshes.
 *
 * This is the shared reset seam for the once-per-turn / once-per-round
 * lifecycle gates. The caller supplies the CURRENT recorded boundary (a U8
 * `BoundaryRef`); U8 owns the decision of which period that boundary
 * refreshes (`usagePeriodForResetBoundary`), never a hard-coded prefix parse
 * in the content recipe. A boundary that refreshes nothing (turn-end,
 * combat-end, …) clears nothing and returns false. Pure over the durable
 * actor state; deterministic and replay-stable.
 */
export function refreshUsageLedgerForBoundary(
  actor: EncounterActor,
  boundary: BoundaryRef,
): boolean {
  const period = usagePeriodForResetBoundary(boundary);
  if (period === null) return false;
  const prefix = `ledger:${period}:`;
  let cleared = false;
  for (const key of Object.keys(actor.ruleState)) {
    if (!key.startsWith(prefix)) continue;
    delete actor.ruleState[key];
    delete actor.ruleStateOwners[key];
    cleared = true;
  }
  return cleared;
}

/**
 * U8-backed PRECONDITION for the reset recipes: "does the current boundary
 * refresh a period this actor actually holds?"
 *
 * Pure (`applies` gate), so the participant planner may record the recipe
 * without mutating state. Mirrors the reset body's period decision through
 * the SAME U8 authority — the `applies` gate and the `resolve` body can never
 * disagree on which boundary refreshes which period.
 */
export function usageLedgerHoldsForBoundary(
  actor: Pick<EncounterActor, 'ruleState'>,
  boundary: BoundaryRef,
): boolean {
  const period = usagePeriodForResetBoundary(boundary);
  if (period === null) return false;
  return holdsUsageKey(actor, period);
}
