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
import type { EncounterActor, EncounterState } from '../../types.js';
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

/** Re-export the U16 durable count/availability read so content, the reducer,
 * and kernels route every usage read through this kernel's vocabulary. */
export { usageCount } from '../primitives/usage.js';

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

/** Reserved provenance for the actor-local ONE-INTERRUPT-during-any-turn
 * restriction (p.91 "only one interrupt during any turn, (yours or another
 * character's)"). The grammatical subject of the passage is the CHARACter:
 * each character may normally use at most one interrupt during a particular
 * turn (yours or anyone else's). It is NOT battlefield-global. The mark
 * therefore lives on the ACTING actor's own `any-turn` window and is read
 * actor-locally (never a battlefield scan). Opaque content-owned gate key,
 * never parsed. */
const ONE_INTERRUPT_PER_TURN = 'core:one-interrupt-per-turn';

/** The typed KEY for an interrupt's per-interrupt use bucket. The per-source
 * count lives on the OWNER in the owner-relative `turn` period (refreshes at
 * the owner's own turn-start — p.91 "get them all back at the start of any of
 * your turns"), cap = the interrupt's rank. DISTINCT from the actor-local
 * one-interrupt-during-any-turn mark: a per-interrupt cap and a per-turn
 * restriction must never share a counter. */
export function interruptUseKey(ownerId: string, interruptSourceId: string): string {
  return usageKey({ sourceId: interruptSourceId, ownerId, scope: 'turn' });
}

/** The typed KEY for the actor-local one-interrupt-during-any-turn mark. It
 * is scoped to the `any-turn` period (refreshes at EVERY turn start for ALL
 * actors via `refreshAnyTurnLedgersForAll`), but it is read and written
 * ACTOR-LOCALLY: the key lives on the acting actor's own ruleState, and
 * `interruptAvailable` checks only that actor's own mark. So Alice's use of
 * one interrupt during Bob's turn never closes Carol's independent window, and
 * a new turn reopens every actor's mark. DISTINCT from the per-interrupt cap
 * (`interruptUseKey`). */
export function oneInterruptPerTurnWindowKey(): string {
  return usageKey({ sourceId: ONE_INTERRUPT_PER_TURN, ownerId: '', scope: 'any-turn' });
}

/** Reserved provenance for ICON's No Repeats rule (p.91 "When you use any
 * ability with a cost, you can't repeat it in the same turn. This includes
 * free actions or abilities you can use off your turn, such as interrupts").
 * The no-repeat restriction is itself U16-shaped: "has/may THIS ability be
 * used again within the current turn?" — actor-local, per-source, refreshed
 * at every turn start. The per-ability mark is keyed by the ability's own
 * source id (never a shared `core:` namespace) so it cannot alias two
 * different abilities or two different actors (storage is actor-local). */
export function noRepeatKey(sourceId: string): string {
  return usageKey({ sourceId, ownerId: '', scope: 'any-turn' });
}

/** Reserved provenance for the standard move (p.91 "The most basic Free
 * Action is a standard move"). The single standard move per own turn is an
 * OWNER-RELATIVE once-per-turn entitlement (`turn` period — refreshed only at
 * the OWNER's own turn-start via the lifecycle turn-ledger-reset recipe),
 * distinct from Dash (a costed basic ability subject to No Repeats). Opaque
 * content-owned gate key, never parsed. */
const STANDARD_MOVE_ONCE_PER_TURN = 'core:standard-move';

/** The typed KEY for the owner-relative once-per-own-turn standard move gate.
 * `turn` period (resets at the owner's own turn-start), NOT `any-turn` — a
 * standard move can only ever be taken on the owner's own turn, so another
 * actor's turn-start must never reset it. DISTINCT from the no-repeat Dash
 * key (`noRepeatKey('basic:dash')`). */
export function standardMoveOncePerTurnKey(ownerId: string): string {
  return usageKey({ sourceId: STANDARD_MOVE_ONCE_PER_TURN, ownerId, scope: 'turn' });
}

/** Reserved provenance for the once-per-turn attack-tag entitlement (p.129
 * Special, p.91 "only one attack can be made per turn"). Opaque
 * content-owned gate key, never parsed. */
const ATTACK_ONCE_PER_TURN = 'core:attack-this-turn';

/** The typed KEY for the once-per-turn attack-tag gate. Lives on the OWNER in
 * the owner-relative `turn` period (refreshes at the owner's own turn-start).
 * This is the U16 ENTITLEMENT gate; it is NOT a historical "attack happened"
 * fact (that stays a U10 outcome at resolution — acceptance #6: a first
 * attempt that fails before resolution must not fabricate a fact). */
export function attackOncePerTurnKey(ownerId: string): string {
  return usageKey({ sourceId: ATTACK_ONCE_PER_TURN, ownerId, scope: 'turn' });
}

/** Reserved provenance for Slashed's once-per-turn damage de-dup (p.104 "no
 * more than once a turn"). Opaque content-owned gate key, never parsed. */
const SLASHED_ONCE_PER_TURN = 'core:slashed-this-turn';

/** The typed KEY for Slashed's once-per-turn damage de-dup. Scoped to the
 * `any-turn` period: a character can be Slashed at most once during any turn
 * and the window resets at each turn start. DISTINCT from the once-per-ability
 * U10 trigger de-dup (a single ability can be triggered across turns; the
 * once-per-turn scope only bounds the 4 damage). */
export function slashedOncePerTurnKey(): string {
  return usageKey({ sourceId: SLASHED_ONCE_PER_TURN, ownerId: '', scope: 'any-turn' });
}

/** Reserved provenance for dangerous terrain's once-per-turn damage (p.89
 * "enter or exit dangerous terrain … can only take this damage once a turn").
 * Opaque content-owned gate key, never parsed. */
const DANGEROUS_ONCE_PER_TURN = 'core:dangerous-terrain-this-turn';

/** The typed KEY for dangerous terrain's once-per-turn damage de-dup. Scoped
 * to the `any-turn` period: a character cannot take dangerous-terrain damage
 * repeatedly through multiple movement segments within one turn; the window
 * resets at each turn start. */
export function dangerousOncePerTurnKey(): string {
  return usageKey({ sourceId: DANGEROUS_ONCE_PER_TURN, ownerId: '', scope: 'any-turn' });
}

/** The durable PREFIX of every `any-turn` battlefield window key (the U16 key
 * vocabulary owns the format, never a caller rewriting `ledger:any-turn:*`).
 * The reducer's turn-start sweep clears exactly these keys on every actor. */
export const ANY_TURN_LEDGER_PREFIX = usageKey({ sourceId: '', ownerId: '', scope: 'any-turn' });

/** True when ANY actor holds an `any-turn` battlefield window key (the
 * reducer's cheap precondition for the turn-start sweep). */
export function anyActorHoldsAnyTurnLedger(state: EncounterState): boolean {
  return Object.values(state.actors).some((actor) => holdsUsageKey(actor, 'any-turn'));
}

/** U16/U8 ANY-TURN SWEEP: refresh every actor's battlefield `any-turn` window
 * (one-interrupt-during-any-turn, slashed once per turn, dangerous terrain
 * once per turn) at a turn-START boundary. This is the DISTINCT reset for the
 * "during any turn" restriction: unlike the owner-relative `ledger:turn:*`
 * pools (which refresh only at the OWNER's turn), the `any-turn` window is
 * re-opened for ALL actors at EVERY turn start. Pure over the durable state;
 * deterministic and replay-stable (replay re-applies the same deletes). */
export function refreshAnyTurnLedgersForAll(state: EncounterState): void {
  for (const candidate of Object.values(state.actors)) {
    let touched = false;
    for (const key of Object.keys(candidate.ruleState)) {
      if (!key.startsWith(ANY_TURN_LEDGER_PREFIX)) continue;
      delete candidate.ruleState[key];
      delete candidate.ruleStateOwners[key];
      touched = true;
    }
    void touched;
  }
}

/** Reducer-side durable mark for a usage ledger key: set the key's count to
 * `current + amount` on the actor (a one-shot cap records `true` for count 1,
 * byte-compatible with `consumeUsageMutation`), and record the owning actor in
 * `ruleStateOwners`. Deterministic — replay applies the identical durable mark
 * because the mark is a pure function of the recorded event fields. Used by
 * the reducer (applyEvents) for the battlefield/entitlement marks that the
 * command boundary already validated, so the decision was made once at the
 * boundary and this only persists it. */
export function recordUsageKey(
  actor: Pick<EncounterActor, 'ruleState' | 'ruleStateOwners' | 'id'>,
  key: string,
  amount: number = 1,
): void {
  const next = usageCount(actor, key) + amount;
  actor.ruleState[key] = next === 1 ? true : next;
  if ('id' in actor && actor.id) actor.ruleStateOwners[key] = actor.id;
  else actor.ruleStateOwners[key] = null;
}

/** A content source that raises (or lowers) how many interrupts an actor may
 * take per turn, KEYED ON THE ACTOR ITSELF (never a battlefield claim).
 * Black Rock Vanguard (p.124) returns `Infinity` for its own Bastion;
 * the normal restriction is 1 (p.91 "only one interrupt during any turn").
 * Returning undefined means "no override — keep the default". */
export type InterruptsPerTurnCapSource = (actor: Pick<EncounterActor, 'traitIds' | 'id'>) => number | undefined;
const interruptsPerTurnCapSources: InterruptsPerTurnCapSource[] = [];

/** Register a content source that overrides an actor's per-turn interrupt
 * allowance (content/jobs registers Black Rock Vanguard). The kernel answers
 * the cap; it never branches on a source id. */
export function registerInterruptsPerTurnCapSource(source: InterruptsPerTurnCapSource): void {
  interruptsPerTurnCapSources.push(source);
}

/** The actor's per-turn interrupt allowance: the p.91 default of 1, raised
 * only by an actor-specific registered override (Black Rock Vanguard). PURE
 * over the actor — no battlefield scan, so one actor's allowance can never
 * couple to another actor's. */
export function interruptsPerTurnCap(actor: Pick<EncounterActor, 'traitIds' | 'id'>): number {
  let cap = 1;
  for (const source of interruptsPerTurnCapSources) {
    const override = source(actor);
    if (override !== undefined) cap = Math.max(cap, override);
  }
  return cap;
}

/** Whether the ACTING actor's OWN one-interrupt-per-turn window still has
 * allowance this turn (p.91). Actor-local by design: reads only this actor's
 * own mark, so Carol's independent window is never consumed by Alice's use. */
export function interruptWindowAvailableFor(actor: Pick<EncounterActor, 'ruleState' | 'traitIds' | 'id'>): boolean {
  return usageCount(actor, oneInterruptPerTurnWindowKey()) < interruptsPerTurnCap(actor);
}

/** Whether the actor can use an interrupt at all: the actor's OWN
 * one-per-turn window is open, AND the named source's owner-relative
 * between-turn pool has remaining uses. Cap = the per-interrupt rank.
 * Distinct identities: the actor-local per-turn window and the per-source
 * between-turn pool are different U16 entries. No battlefield coupling. */
export function interruptAvailable(
  state: EncounterState,
  actor: Pick<EncounterActor, 'id' | 'ruleState' | 'abilityIds' | 'traitIds'>,
  interruptSourceId: string,
  cap: number,
): boolean {
  if (!actor.abilityIds.includes(interruptSourceId)) return false;
  if (!interruptWindowAvailableFor(actor)) return false;
  return usageCount(actor, interruptUseKey(actor.id, interruptSourceId)) < cap;
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
