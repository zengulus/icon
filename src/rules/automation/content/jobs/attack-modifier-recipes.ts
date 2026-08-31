import { registerAttackModifierRule } from '../../kernels/attack-modifiers.js';
import { collidingShoveTargets } from '../../kernels/encounter-adapter.js';
import { bullStrengthOncePerTurnKey, useLedgerAvailable } from '../../kernels/use-ledger.js';
import { consumeUsageMutation } from '../../primitives/usage.js';
import type { EncounterState } from '../../../types.js';
import type { RuleMutation } from '../../primitives/types.js';

/**
 * Attack-path trait content (F6, docs/rules-foundations.md §7).
 *
 * The four attack-family traits register their attack-modifier rules into the
 * `kernels/attack-modifiers.ts` fold, and the two that arm/trigger on events
 * provide their content folds here:
 *
 * - **Demon Edge** (demon-slayer, p.140) — triggering a slow-turn or delay
 *   arms the demon-edge window: vigilance +1, +1 bonus damage (the shared
 *   `bonus-damage` resource, read as a bonus damage die at both attack
 *   sites) until the end of the owner's next turn, and a one-shot true
 *   strike. The arming rides the ability's event as recorded mutations
 *   (`demonEdgeSlowTurnMutations`); the window expires via the turn-end
 *   lifecycle recipe; the true strike is consumed by the next attack.
 * - **Hissatsu** (demon-slayer, p.141) — taking a turn without attacking
 *   arms the next attack with +1 boon, true strike, and a d10 damage die
 *   (`hissatsu:armed`), set by the turn-end lifecycle recipe and consumed
 *   by the next attack roll.
 * - **Pulverize** (colossus, p.142) — a pure elevation read, no armed
 *   state: attacking a lower target deals +2 flat damage on the attack's
 *   direct damage; at two or more elevations lower the attack exceeds on a
 *   13+ instead of 15+.
 * - **Bull's Strength** (bastion, p.149) — abilities gain "collide: deal 2
 *   damage": when an ability's shove collides, the shoved character takes 2
 *   damage, once per turn per character (a U16 owner-relative once-per-turn
 *   ledger gate `bullStrengthOncePerTurnKey`, refreshed at the owner's next
 *   turn-start by the shared core:turn-ledger-reset lifecycle recipe).
 */

export const DEMON_EDGE_TRAIT = 'demon-slayer:trait:demon-edge';
export const HISSATSU_TRAIT = 'demon-slayer:trait:hissatsu';
export const PULVERIZE_TRAIT = 'colossus:trait:pulverize';
export const BULL_STRENGTH_TRAIT = 'bastion:trait:bull-s-strength';

/** The one-shot armed keys consumed by the next attack. */
export const DEMON_EDGE_TRUESTRIKE_KEY = 'demon-edge:true-strike';
export const HISSATSU_ARMED_KEY = 'hissatsu:armed';

registerAttackModifierRule({ traitId: DEMON_EDGE_TRAIT, armedKey: DEMON_EDGE_TRUESTRIKE_KEY, trueStrike: true });
registerAttackModifierRule({ traitId: HISSATSU_TRAIT, armedKey: HISSATSU_ARMED_KEY, boons: 1, trueStrike: true, damageDieOverride: 10 });
registerAttackModifierRule({ traitId: PULVERIZE_TRAIT, elevationBonusDamage: 2, elevationExceedThreshold: 13 });
// ICON p.155 Freelancer Trigrammaton: "Your abilities used against foes at
// exactly range 3 gain +1 boon on attack rolls and unerring." An exact-
// distance attack modifier — it inspects the canonical p.92 distance and
// never widens targeting range. Unerring (p.105) ignores cover + aetherwall.
registerAttackModifierRule({ traitId: 'freelancer:trait:trigrammaton', exactRange: 3, boons: 1, unerring: true });
// ICON p.330 Strigoi Blood Hunger: "Deals +2 damage with all abilities
// against bloodied foes." Attack-path flat damage against a bloodied target
// (the same home as Pulverize), folded at both attack sites through the
// shared bloodied predicate.
registerAttackModifierRule({ traitId: 'relict:strigoi:330:trait:blood-hunger', targetBloodiedBonusDamage: 2 });

/**
 * Demon Edge arming fold (p.140): when the ability the actor just used
 * triggered a slow-turn or delay, the trait grants vigilance +1, +1 bonus
 * damage (until the end of the owner's next turn — the turn-end recipe
 * clears the window), and a one-shot true strike. Returns the recorded
 * mutations that ride the ability's RULE_MUTATIONS_APPLIED event, so replay
 * applies exactly what the command decided. Callers gate on the trait.
 */
export function demonEdgeSlowTurnMutations(
  sourceId: string,
  sourceActorId: string,
  actorId: string,
  programAction: { tags: readonly string[] },
  mutations: readonly RuleMutation[],
  round: number,
): RuleMutation[] {
  const triggeredSlowTurnOrDelay = programAction.tags.includes('delay')
    || mutations.some((mutation) => mutation.kind === 'state' && mutation.key === 'six-hells:slow-turn');
  if (!triggeredSlowTurnOrDelay) return [];
  return [
    { kind: 'resource', sourceId, actorId, resourceId: 'vigilance', operation: 'gain', amount: 1, minimum: 0, maximum: null },
    { kind: 'resource', sourceId, actorId, resourceId: 'bonus-damage', operation: 'gain', amount: 1, minimum: 0, maximum: null },
    // The window lasts until the end of the owner's NEXT turn, so the armed
    // round is recorded and the turn-end recipe only clears once a round
    // boundary has passed (the same command's end-turn must not clear it).
    { kind: 'state', sourceId, sourceActorId, actorId, key: 'demon-edge:window', operation: 'set', value: true },
    { kind: 'state', sourceId, sourceActorId, actorId, key: 'demon-edge:window-round', operation: 'set', value: round },
    { kind: 'state', sourceId, sourceActorId, actorId, key: DEMON_EDGE_TRUESTRIKE_KEY, operation: 'set', value: true },
  ];
}

/**
 * Bull's Strength collide fold (p.149): abilities gain "collide: deal 2
 * damage". When one of the ability's shoves collides with an obstruction and
 * the shoving character still has the trait's once-per-turn guard clear,
 * append a 2-damage mutation against the shoved character and set the guard
 * (a plan-time decision recorded through the event's mutations; the guard is
 * cleared by the turn-end lifecycle recipe).
 */
export function bullStrengthCollideMutations(state: EncounterState, mutations: readonly RuleMutation[]): RuleMutation[] {
  const appended: RuleMutation[] = [];
  const collidedTargets = new Set(collidingShoveTargets(state, mutations));
  // The once-per-turn guard holds both across commands (the reducer-applied
  // ruleState) and within a single ability use (a local set — a multi-shove
  // ability only awards the collide damage once).
  const guardSeen = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind !== 'move' || mutation.movement !== 'shove' || !collidedTargets.has(mutation.actorId)) continue;
    const source = state.actors[mutation.sourceActorId];
    if (!source || !source.traitIds.includes(BULL_STRENGTH_TRAIT)) continue;
    if (!useLedgerAvailable(source, bullStrengthOncePerTurnKey()) || guardSeen.has(source.id)) continue;
    const shoved = state.actors[mutation.actorId];
    if (!shoved || shoved.defeated || !shoved.onBattlefield) continue;
    guardSeen.add(source.id);
    // The once-per-turn gate is a *recorded* consume mutation (not a live-state
    // write), so re-running the identical program on the same state is
    // deterministic — the reducer applies the ledger consume with the damage,
    // and the next command's plan reads the applied gate. The shared
    // core:turn-ledger-reset recipe refreshes it at the owner's next turn-start.
    appended.push({
      kind: 'damage',
      sourceId: BULL_STRENGTH_TRAIT,
      sourceActorId: source.id,
      actorId: shoved.id,
      amount: 2,
      damageType: 'normal',
      instance: 1,
      delivery: 'effect',
      ignoreCover: false,
    }, consumeUsageMutation(BULL_STRENGTH_TRAIT, source.id, bullStrengthOncePerTurnKey()));
  }
  return appended;
}
