import { registerAttackModifierRule } from '../../kernels/attack-modifiers.js';
import { collidingShoveTargets } from '../../kernels/encounter-adapter.js';
import { applyBullStrengthCollide, bullStrengthCollideKey } from '../../kernels/use-ledger.js';
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
 * - **Pulverize** (colossus, p.134) — a pure elevation read, no armed
 *   state: attacking a lower target deals GENUINE bonus damage (ICON p.102:
 *   one extra damage die, keep the normal number of highest dice) on the
 *   attack's direct damage; two or more elevations lower SOURCE-FORCES the
 *   exceed fact ("…it also triggers all exceed effects" — the exceed
 *   condition fires regardless of the roll, never approximated as a
 *   threshold cut).
 * - **Bull's Strength** (bastion, p.149) — abilities gain "collide: deal 2
 *   damage": when an ability's shove collides, the shoved character takes 2
 *   damage, and "Characters can't take this damage more than once a turn."
 *   The restriction belongs to the character RECEIVING the damage: a U16
 *   per-target `any-turn` gate (`bullStrengthCollideKey(targetId)`) that
 *   reopens at every actor's turn start, so each character may take the
 *   bonus once per battlefield turn and two different Bastions never alias.
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
// ICON p.135 Pulverize: "When you start an attack ability on higher elevation
// than your target, it deals bonus damage." "It" is the attack ABILITY — the
// bonus damage is ability-wide: every damage roll the ability makes carries
// the extra die through the shared ability-use bonus-damage fold
// (kernels/bonus-damage.ts `registerTraitBonusDamageRule`, the same authority
// Blessing of War / F6a talent grants use), never an attack-space-only
// provenance field. The bonus-damage half therefore lives in
// bonus-damage-recipes.ts; this row keeps ONLY the SOURCE-FORCED exceed half
// (two or more elevations higher forces every exceed effect regardless of
// the roll — never approximated as a threshold cut).
registerAttackModifierRule({ traitId: PULVERIZE_TRAIT, elevationForceExceed: true });
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
 * damage", and "Characters can't take this damage more than once a turn."
 * The restriction is PER-TARGET: each character that is shoved into an
 * obstruction may take the 2 damage at most once during the current
 * battlefield turn, and the window reopens at the next actor's turn start
 * (no dependency on the Bastion's own turn). For every collided shove, the
 * fold proposes the 2-damage mutation against the shoved character through
 * the U16 per-target `any-turn` transaction (`applyBullStrengthCollide`),
 * which authorizes and records the consume; the same-command planning set is
 * keyed on the exact U16 entitlement identity (owner storage + source +
 * target + window), so an ability that shoves the same character twice
 * awards the damage once while two DIFFERENT targets each stay entitled.
 */
export function bullStrengthCollideMutations(state: EncounterState, mutations: readonly RuleMutation[]): RuleMutation[] {
  const appended: RuleMutation[] = [];
  const collidedTargets = new Set(collidingShoveTargets(state, mutations));
  // Same-command planning set keyed on the FULL U16 ledger key — owner
  // (the storage actor) + source + target + the current any-turn window.
  // It dedupes only WITHIN this command (recorded consumes are not applied
  // until the event); it never substitutes for the ledger availability gate.
  const planned = new Set<string>();
  for (const mutation of mutations) {
    if (mutation.kind !== 'move' || mutation.movement !== 'shove' || !collidedTargets.has(mutation.actorId)) continue;
    const source = state.actors[mutation.sourceActorId];
    if (!source || !source.traitIds.includes(BULL_STRENGTH_TRAIT)) continue;
    const shoved = state.actors[mutation.actorId];
    if (!shoved || shoved.defeated || !shoved.onBattlefield) continue;
    const key = bullStrengthCollideKey(shoved.id);
    if (planned.has(key)) continue;
    planned.add(key);
    // The once-per-turn gate is a *recorded* consume mutation (not a live-state
    // write), so re-running the identical program on the same state is
    // deterministic — the reducer applies the ledger consume with the damage,
    // and the next command's plan reads the applied gate. The shared
    // any-turn sweep refreshes the window at the next turn boundary.
    appended.push(...applyBullStrengthCollide({
      actor: source,
      targetId: shoved.id,
      sourceId: BULL_STRENGTH_TRAIT,
      mutations: [{
        kind: 'damage',
        sourceId: BULL_STRENGTH_TRAIT,
        sourceActorId: source.id,
        actorId: shoved.id,
        amount: 2,
        damageType: 'normal',
        instance: 1,
        delivery: 'effect',
        ignoreCover: false,
      }],
    }));
  }
  return appended;
}
