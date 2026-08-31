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
 *   (the F9 reactive fold's `applyOncePerRoundUsage` writes the identical key
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
  ledgerAvailable,
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

/** The authoritative result of a once-per-round usage COMMIT (U16). A
 * discriminated union: either the entitlement is unavailable (emit nothing),
 * or U16 returns the COMPLETE commit bundle — the caller's proposed effect
 * mutations PLUS the U16 consume mark, grouped in one array. The caller commits
 * `mutations` verbatim and through it alone: it cannot separately decide
 * availability, cannot hand-build the consume mark, and never names the ledger
 * key (none of the three are exposed by the operation — they are decided inside
 * U16). */
export type OncePerRoundTransaction =
  | { available: false }
  | { available: true; mutations: readonly RuleMutation[] };

/** U16 COMMIT operation for one once-per-round usage. The caller PROPOSES its
 * effect mutations; U16 owns the entire entitlement transaction in ONE
 * operation: the typed owner identity (the `actor` argument's id), the one-shot
 * round usage scope, the physical key derivation (`usageKey` round period), the
 * availability check (`ledgerAvailable`), the consume mark
 * (`consumeUsageMutation`), and the grouping of that consume with the allowed
 * effects into the returned bundle. The caller cannot separate the availability
 * decision from the returned transaction and cannot independently construct the
 * usage-consume mutation — it commits the returned `mutations` bundle and only
 * that.
 *
 * A round-start lifecycle recipe clears the round ledger, so the entitlement
 * reopens at the next round boundary. The decision is made ONCE at the command
 * boundary; replay applies the recorded bundle and never rechecks entitlement.
 * Generic and source-ID-free: `sourceId` is a content-owned provenance key, and
 * the proposed `mutations` are opaque to this kernel. Deterministic — a pure
 * function of the actor's recorded ruleState and the proposed mutations. */
export function applyOncePerRoundUsage(options: {
  actor: Pick<EncounterActor, 'id' | 'ruleState'>;
  sourceId: string;
  mutations: readonly RuleMutation[];
}): OncePerRoundTransaction {
  const key = usageKey({ sourceId: options.sourceId, ownerId: options.actor.id, scope: 'round' });
  if (!ledgerAvailable(options.actor, key)) return { available: false };
  const consume = consumeUsageMutation(options.sourceId, options.actor.id, key) as Extract<RuleMutation, { kind: 'state' }>;
  return { available: true, mutations: [...options.mutations, consume] };
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
export function noRepeatKey(sourceId: string, actionId?: string): string {
  // No Repeats is an ACTION-level restriction (p.91 "you can't repeat it"): a
  // source unit may expose several actions under ONE sourceId (a stance whose
  // interrupt, an ability + its collide/combo action). Using the main action
  // and then the stance's DISTINCT interrupt must not be treated as repeating
  // the same ability, so a NON-primary action gets its own identity
  // `sourceId#actionId` while the primary action (actionId undefined / 'default'
  // / 'use' / a combo dispatch that shares the base) stays on the bare
  // `sourceId` key. Command/reducer gates record the bare (primary) key; window
  // discovery passes a stance-interrupt's action id so a used stance never
  // falsely blocks its distinct sub-interrupt. Opaque to content ids. */
  const primary = actionId === undefined || actionId === 'default' || actionId === 'use' || actionId === 'combo';
  return usageKey({ sourceId: primary ? sourceId : `${sourceId}#${actionId}`, ownerId: '', scope: 'any-turn' });
}

/** ICON p.290 Repeatable (foe Unique Rule): "Repeatable X: This action is
 * repeatable any number of times in a turn, ignoring the no repeats rule."
 * The keyword is a TYPED, source-derived tag recorded on the compiled action
 * and on the recorded event (via the source catalog `tags`), never inferred
 * from ability name or prose. Job abilities never carry it — No Repeats
 * (p.91) applies to every job/basic ability and every interrupt. */
export const REPEATABLE_TAG = 'repeatable';

/** Whether the p.91 No Repeats rule applies to an action: true UNLESS the
 * action's source-derived tags declare it explicitly Repeatable (p.290). This
 * is the ONE typed semantic deciding No-Repeats applicability, shared by the
 * command-side authorization and the reducer-side recording so they can never
 * disagree (task: command and reducer must use the same rule). */
export function noRepeatsApplies(tags: readonly string[]): boolean {
  return !tags.includes(REPEATABLE_TAG);
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

// ---------------------------------------------------------------------------
// Residual once-per-scope marks (U16 residual-usage-state census, 2026-08-31)
// ---------------------------------------------------------------------------
// The following are the last actor-local usage/entitlement gates the engine
// owned as raw booleans/counters. Each is now a typed U16 `ledger:*` key so the
// authority derives identity + scope + availability + consume + reset in one
// place; the migrated consumers read `usageCount`/`ledgerAvailable` and persist
// via `consumeUsageMutation`/`recordUsageKey`, and the lifecycle resets below
// reuse the shared boundary sweeps (`refreshAnyTurnLedgersForAll` for any-turn,
// the round-start `core:round-ledger-reset` recipe for round, and the combat
// period which never refreshes). Source ids are opaque content-owned provenance,
// never branched on.

/** Chain Reaction (Wright p.95, encounter condition): once per round, damaging
 * at least two foes with one ability grants 1 Aether. Opaque gate key. */
const CHAIN_REACTION_ONCE_PER_ROUND = 'core:chain-reaction';

/** The typed KEY for the once-per-round Chain Reaction proc. Round scope,
 * actor-local — the acting actor's own round ledger, reset by the U16
 * round-start reset. */
export function chainReactionOncePerRoundKey(): string {
  return usageKey({ sourceId: CHAIN_REACTION_ONCE_PER_ROUND, ownerId: '', scope: 'round' });
}

/** Incubus (Shade p.164): the marked foe and adjacent foes take 2 damage and
 * are dazed when adjacency triggers, once per round. Opaque gate key (the
 * entitlement lives on the MARK OWNER). */
const INCUBUS_ONCE_PER_ROUND = 'shade:incubus';

/** The typed KEY for Incubus's once-per-round detonation. Round scope,
 * actor-local on the mark owner, reset by the U16 round-start reset. */
export function incubusOncePerRoundKey(): string {
  return usageKey({ sourceId: INCUBUS_ONCE_PER_ROUND, ownerId: '', scope: 'round' });
}

/** Stampede (Warden p.170): once per round, at the end of the marked foe's
 * turn, the spirit beast charges in. Opaque gate key (the entitlement lives on
 * the MARK OWNER). */
const STAMPEDE_ONCE_PER_ROUND = 'warden:stampede';

/** The typed KEY for Stampede's once-per-round charge. Round scope, actor-local
 * on the mark owner, reset by the U16 round-start reset. */
export function stampedeOncePerRoundKey(): string {
  return usageKey({ sourceId: STAMPEDE_ONCE_PER_ROUND, ownerId: '', scope: 'round' });
}

/** Vigilance Rush (Demon Slayer p.129): may rush 2 after activating vigilance,
 * once per turn. Opaque gate key. Reopens at EVERY turn start for every actor
 * (the battlefield `any-turn` window), exactly like No Repeats — the ability is
 * only usable on the user's own turn, and the observed reset is any-turn.
 * Cleared by `refreshAnyTurnLedgersForAll`. */
const VIGILANCE_RUSH_ONCE_PER_TURN = 'gates-of-hell:vigilance-rushed';

/** The typed KEY for the once-per-turn vigilance rush. `any-turn` scope (reopened
 * by every turn start), actor-local. */
export function vigilanceRushOncePerTurnKey(): string {
  return usageKey({ sourceId: VIGILANCE_RUSH_ONCE_PER_TURN, ownerId: '', scope: 'any-turn' });
}

/** Midas (Geomancer p.220 interrupt): twice per combat. The count is the U16
 * N-per-combat entitlement (combat scope — never refreshes mid-encounter).
 * Opaque gate key. */
const MIDAS_ONCE_PER_COMBAT = 'geomancer:midas';

/** The typed KEY for Midas's twice-per-combat permanence. Combat scope,
 * actor-local, cap 2. */
export function midasOncePerCombatKey(): string {
  return usageKey({ sourceId: MIDAS_ONCE_PER_COMBAT, ownerId: '', scope: 'combat' });
}

/** Bull's Strength (Bastion p.149): abilities gain "collide: deal 2 damage"
 * and "Characters can't take this damage more than once a turn." The
 * restriction belongs to the character RECEIVING the Bull's Strength damage
 * — a PER-TARGET, battlefield `any-turn` entitlement (reopens at EVERY actor's
 * turn start), NOT an owner-relative once-per-own-turn gate. Opaque gate key. */
const BULL_STRENGTH_COLLIDE = 'core:bull-s-strength';

/** The typed KEY for the per-target once-per-turn Bull's Strength collide
 * damage. Lives on the TRAIT OWNER's ruleState with a U16 `:target:<id>`
 * suffix (owner identity = the storage actor, target identity = the key
 * suffix), so two different Bastions never alias and two different targets
 * never share a gate. `any-turn` scope: the battlefield window reopens for
 * every actor at every turn start via `refreshAnyTurnLedgersForAll`, so the
 * next actor's turn-start is sufficient — there is no dependency on the
 * Bastion's own next turn. */
export function bullStrengthCollideKey(targetId: string): string {
  return usageKey({ sourceId: BULL_STRENGTH_COLLIDE, ownerId: '', scope: 'any-turn', targetId });
}

/** U16 COMMIT operation for ONE per-target Bull's Strength collide damage
 * (p.149 "Characters can't take this damage more than once a turn"). The
 * caller PROPOSES the effect mutations (the 2 damage against the shoved
 * character); U16 owns the entire entitlement transaction in ONE operation:
 * the per-target `any-turn` identity (`bullStrengthCollideKey` — owner via
 * the storage actor, target via the key suffix), the availability check
 * (`ledgerAvailable`), the consume mark (`consumeUsageMutation`), and the
 * grouping of that consume with the allowed effects into the returned bundle.
 * The caller cannot separately decide availability or hand-build the consume
 * mark. A turn boundary reopens the window, so the next battlefield turn may
 * deal the damage again. Generic and source-ID-free: `sourceId` is the
 * content-owned provenance recorded on the consume, and the proposed
 * `mutations` are opaque to this kernel. Deterministic — a pure function of
 * the owner's recorded ruleState and the proposed mutations. */
export function applyBullStrengthCollide(options: {
  actor: Pick<EncounterActor, 'id' | 'ruleState'>;
  targetId: string;
  sourceId: string;
  mutations: readonly RuleMutation[];
}): readonly RuleMutation[] {
  const key = bullStrengthCollideKey(options.targetId);
  if (!ledgerAvailable(options.actor, key)) return [];
  const consume = consumeUsageMutation(options.sourceId, options.actor.id, key) as Extract<RuleMutation, { kind: 'state' }>;
  return [...options.mutations, consume];
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
 * once per turn, and the per-target Bull's Strength collide gates) at a
 * turn-START boundary. This is the DISTINCT reset for the "during any turn"
 * restriction: unlike the owner-relative `ledger:turn:*` pools (which refresh
 * only at the OWNER's turn), the `any-turn` window is re-opened for ALL actors
 * at EVERY turn start. Pure over the durable state; deterministic and
 * replay-stable (replay re-applies the same deletes). */
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

/** Whether the actor can use an interrupt at all (reactive WINDOW DISCOVERY
 * projection): the actor owns it, their actor-local one-per-turn window is
 * open, the named source's owner-relative between-turn pool has remaining
 * uses, AND No Repeats does not forbid that specific interrupt in the current
 * turn. Cap = the per-interrupt rank. `noRepeatActionId` keys the No Repeats
 * check for a stance-GRANTED interrupt (a distinct sub-action of a shared
 * source) so a used stance never falsely blocks its interrupt; standalone
 * interrupts leave it unset (bare source key). Black Rock Vanguard raises only
 * the per-turn cap (`interruptsPerTurnCap`), never the pool or No Repeats, so
 * a second interrupt window can open under BRV only when that specific
 * interrupt is not No-Repeats-exhausted. */
export interface InterruptLegalityResult {
  ok: boolean;
  code: string;
  detail: string;
}

/** THE shared U16 interrupt-authorization predicate (p.91), used by the
 * USE_ABILITY command, the generic EXECUTE_RULE command, and reactive window
 * discovery so every surface decides from exactly the same authority and can
 * never disagree:
 *
 * 1. the actor is not Stunned;
 * 2. the actor's OWN one-interrupt-during-any-turn window is open;
 * 3. the named interrupt's owner-relative between-own-turn pool (cap = rank)
 *    still has uses;
 * 4. p.91 No Repeats does not forbid that specific interrupt in the current
 *    turn (unless an explicit source rule — Black Rock Vanguard — raises the
 *    actor's per-turn cap, which it does WITHOUT touching the pool or No
 *    Repeats).
 *
 * `noRepeatActionId` keys the No Repeats check for a stance-granted interrupt
 * (a distinct sub-action of a shared source) so a used stance never falsely
 * blocks its interrupt; standalone interrupts leave it unset (bare source
 * key). Ownership is checked by the command layer (which knows the unit's
 * kind/cheat-time marking); window discovery checks it separately via
 * `interruptAvailable`. Returns a typed result so the caller throws with the
 * exact U16 code/detail. PURE — no mutation, no RNG. */
export function interruptLegality(
  actor: Pick<EncounterActor, 'id' | 'ruleState' | 'statuses' | 'abilityIds' | 'traitIds'>,
  interruptSourceId: string,
  cap: number,
  noRepeatActionId?: string,
  options: { repeatable?: boolean } = {},
): InterruptLegalityResult {
  if (actor.statuses.includes('stunned')) return { ok: false, code: 'interrupt.stunned', detail: 'Stunned characters cannot use interrupts.' };
  // A source-granted Repeatable interrupt (p.290) may be used again in the
  // current turn by the entitled actor: it bypasses No Repeats, the actor-
  // local one-per-turn window, and the between-turn pool (they would each
  // otherwise throttle a second same-turn use). OTHER gates — ownership,
  // stunned — still apply. The reducer must skip recording usage marks for
  // the same action (commanded via `repeatable`, persisted from the same
  // determination), so authorization and persistence agree.
  if (options.repeatable) return { ok: true, code: 'ok', detail: '' };
  if (!interruptWindowAvailableFor(actor)) return { ok: false, code: 'interrupt.turn-limit', detail: 'This character can only use one interrupt during any turn.' };
  if (usageCount(actor, interruptUseKey(actor.id, interruptSourceId)) >= cap) {
    return { ok: false, code: 'interrupt.uses', detail: 'This interrupt has no uses remaining before the actor’s next turn.' };
  }
  if (usageCount(actor, noRepeatKey(interruptSourceId, noRepeatActionId)) >= 1) {
    return { ok: false, code: 'ability.repeat', detail: 'An ability with a cost cannot be repeated during the same turn.' };
  }
  return { ok: true, code: 'ok', detail: '' };
}

/** Whether the actor can use an interrupt at all (reactive WINDOW DISCOVERY
 * projection): the actor owns it, their actor-local one-per-turn window is
 * open, the named source's owner-relative between-turn pool has remaining
 * uses, AND No Repeats does not forbid that specific interrupt in the current
 * turn. Cap = the per-interrupt rank. `noRepeatActionId` keys the No Repeats
 * check for a stance-GRANTED interrupt (a distinct sub-action of a shared
 * source) so a used stance never falsely blocks its interrupt; standalone
 * interrupts leave it unset (bare source key). Black Rock Vanguard raises only
 * the per-turn cap (`interruptsPerTurnCap`), never the pool or No Repeats, so
 * a second interrupt window can open under BRV only when that specific
 * interrupt is not No-Repeats-exhausted. */
export function interruptAvailable(
  state: EncounterState,
  actor: Pick<EncounterActor, 'id' | 'ruleState' | 'abilityIds' | 'traitIds'>,
  interruptSourceId: string,
  cap: number,
  noRepeatActionId?: string,
): boolean {
  if (!actor.abilityIds.includes(interruptSourceId)) return false;
  if (!interruptWindowAvailableFor(actor)) return false;
  if (usageCount(actor, interruptUseKey(actor.id, interruptSourceId)) >= cap) return false;
  if (usageCount(actor, noRepeatKey(interruptSourceId, noRepeatActionId)) >= 1) return false;
  return true;
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
