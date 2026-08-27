/**
 * Bonus-damage grant kernel (F6a, docs/rules-foundations.md §8).
 *
 * ICON p.102: "Bonus damage means roll one more die than normal, then pick
 * the highest." The engine's bonus-dice ROLL authority is the shared
 * `damage-roll` evaluation (the declarative VM) and `rollDamageDice` (named
 * resolvers). This module is the single reusable, source-ID-free seam that
 * decides HOW MANY bonus dice a single ability use carries, from
 * source-declared gates — it never rolls anything itself.
 *
 * A content module registers one `BonusDamageRule` per source clause
 * (content/jobs/bonus-damage-recipes.ts). The fold is evaluated at the
 * USE_ABILITY command boundary and its dice ride `abilityUseModifiers`, so
 * the ability's recorded damage mutations carry exactly what the command
 * decided (F0 durable record): replay applies the recorded roll and never
 * re-decides a gate.
 *
 * Rules key on the parent ability id and (for talent rows) the equipped
 * talent choice, and evaluate their gate against current encounter state at
 * use time — self bloodied (comeback), the attack target's bloodied/status
 * state, or a deterministic function of the fold view for scaled rows (e.g.
 * "one bonus die for every ally of your target adjacent to your target").
 * This module contains no source IDs: `sourceId` is provenance only.
 */
import type { EncounterActor, EncounterState } from '../../types.js';
import type { DiceSource } from '../../dice.js';
import { rollDamageDice } from '../primitives/job-kit.js';
import { isBloodied } from './hp-threshold.js';

export { isBloodied };

/** The source-defined conditions under which a bonus-damage rule applies. */
export type BonusDamageGate =
  /** Unconditional (the row's own scaled dice decide the magnitude). */
  | { kind: 'always' }
  /** The acting character is bloodied ("Comeback", ICON p.102). */
  | { kind: 'self-bloodied' }
  /** The ability's attack target is a bloodied foe (ICON p.102). */
  | { kind: 'target-bloodied' }
  /** The ability's attack target is suffering from a status ("if your foe is
   * suffering from a status"). Without `conditionId`, ANY status qualifies;
   * with one, only that exact condition. */
  | { kind: 'target-has-condition'; conditionId?: string };

/** The deterministic fold view handed to scaled `dice` rows. */
export interface BonusDamageFoldView {
  state: EncounterState;
  actorId: string;
  abilityId: string;
  targetIds: readonly string[];
}

export interface BonusDamageRule {
  /** Exact source id of the granting unit (talent / trait / mastery). */
  sourceId: string;
  /** The parent ability whose damage roll carries the bonus dice. */
  abilityId: string;
  /** For talent rows, the equipped talent choice (1 or 2) that arms the
   * bonus; the fold only fires when the actor chose this talent. */
  talent?: 1 | 2;
  /** Source conditions (default: unconditional). */
  gate?: BonusDamageGate;
  /** Bonus dice for the use. A number, or a deterministic function of the
   * fold view for scaled rows (an ally/foe count read from current state). */
  dice: number | ((view: BonusDamageFoldView) => number);
}

const bonusDamageRules: BonusDamageRule[] = [];

/** Register a bonus-damage grant rule (content/jobs/bonus-damage-recipes.ts). */
export function registerBonusDamageRule(rule: BonusDamageRule): void {
  bonusDamageRules.push(rule);
}

function targetActor(state: EncounterState, targetIds: readonly string[]): EncounterActor | undefined {
  const targetId = targetIds[0];
  return targetId ? state.actors[targetId] : undefined;
}

function gateHolds(gate: BonusDamageGate | undefined, state: EncounterState, actorId: string, targetIds: readonly string[]): boolean {
  if (!gate || gate.kind === 'always') return true;
  const actor = state.actors[actorId];
  if (!actor) return false;
  switch (gate.kind) {
    case 'self-bloodied': return isBloodied(actor);
    case 'target-bloodied': {
      const target = targetActor(state, targetIds);
      return Boolean(target && target.side !== actor.side && isBloodied(target));
    }
    case 'target-has-condition': {
      const target = targetActor(state, targetIds);
      if (!target || target.side === actor.side) return false;
      return gate.conditionId === undefined
        ? target.conditions.length > 0
        : target.conditions.some((condition) => condition.id === gate.conditionId);
    }
  }
}

/**
 * The total bonus dice a single use of `abilityId` carries for `actor`, per
 * every registered rule whose parent, talent choice, and gate hold. Evaluated
 * once at the USE_ABILITY command boundary; the result rides
 * `abilityUseModifiers` so the rolled damage mutations record it durably.
 */
export function bonusDamageDiceForUse(
  state: EncounterState,
  actor: EncounterActor,
  abilityId: string,
  targetIds: readonly string[],
): number {
  let total = 0;
  for (const rule of bonusDamageRules) {
    if (rule.abilityId !== abilityId) continue;
    if (rule.talent !== undefined && actor.talents?.[abilityId] !== rule.talent) continue;
    if (!gateHolds(rule.gate, state, actor.id, targetIds)) continue;
    const dice = typeof rule.dice === 'function' ? rule.dice({ state, actorId: actor.id, abilityId, targetIds }) : rule.dice;
    total += Math.max(0, Math.floor(dice));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Recipient-scoped bonus damage (Finesse / Vagabond Gambit)
// ---------------------------------------------------------------------------

/** The deterministic fold view handed to a recipient-scoped rule. */
export interface RecipientBonusDamageView {
  state: EncounterState;
  /** The damage source (attacker). */
  source: EncounterActor;
  /** The ability whose damage roll is being evaluated. */
  abilityId: string;
  /** The damage recipient. */
  recipient: EncounterActor;
}

/**
 * A recipient-scoped bonus-damage rule. Unlike the use-level fold above, this
 * family is evaluated PER DAMAGE RECIPIENT at the actual damage-roll query
 * point: a clause like ICON p.116 Finesse ("You deal bonus damage to bloodied
 * foes") keys off the recipient's live state, so an ability that damages a
 * bloodied and a healthy foe must award the die to exactly the bloodied one
 * — never to every recipient because the primary attack target happens to be
 * bloodied. `gate` is a deterministic function of the fold view (the same
 * pure state-read pattern as `registerMarkConditionProjection.matches` and
 * lifecycle `applies`), and the fold itself never rolls anything: it returns
 * how many extra dice the roll carries. This module contains no source IDs:
 * `sourceId` is provenance only.
 */
export interface RecipientBonusDamageRule {
  /** Exact source id of the granting unit (trait / talent / mastery). */
  sourceId: string;
  /** Deterministic source+recipient gate (pure reads of the fold view). */
  gate(view: RecipientBonusDamageView): boolean;
  /** Bonus dice for this recipient (default 1). */
  dice?: number | ((view: RecipientBonusDamageView) => number);
}

const recipientBonusDamageRules: RecipientBonusDamageRule[] = [];

/** Register a recipient-scoped bonus-damage rule (content/jobs). */
export function registerRecipientBonusDamageRule(rule: RecipientBonusDamageRule): void {
  recipientBonusDamageRules.push(rule);
}

/** True when any bonus-damage rule (use-gated or recipient-scoped) is
 * registered for `sourceId`. The compound-talent completeness manifest uses
 * this to require a compound talent's bonus-damage component to be genuinely
 * wired — a manifest entry never audits complete on a bare allowlist. */
export function hasBonusDamageRule(sourceId: string): boolean {
  return bonusDamageRules.some((rule) => rule.sourceId === sourceId)
    || recipientBonusDamageRules.some((rule) => rule.sourceId === sourceId);
}

/**
 * The total bonus dice a damage roll against `recipientId` carries, per every
 * registered recipient-scoped rule whose source+recipient gate holds. Read at
 * the roll query point (the declarative VM's `damage-roll` and the named
 * resolvers' `rollDamageDice` calls), so the roll records exactly the dice
 * the source rules award for THIS recipient and replay applies them.
 */
export function recipientBonusDamageDice(
  state: EncounterState,
  sourceId: string,
  abilityId: string,
  recipientId: string,
): number {
  const source = state.actors[sourceId];
  const recipient = state.actors[recipientId];
  if (!source || !recipient) return 0;
  let total = 0;
  for (const rule of recipientBonusDamageRules) {
    if (!rule.gate({ state, source, abilityId, recipient })) continue;
    const dice = typeof rule.dice === 'function' ? rule.dice({ state, source, abilityId, recipient }) : (rule.dice ?? 1);
    total += Math.max(0, Math.floor(dice));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Named-resolver damage-roll authority
// ---------------------------------------------------------------------------

/**
 * The single generic named-resolver damage-roll authority. Every named
 * resolver that rolls source [D] damage must route through this helper so
 * that both the use-level bonus-damage dice (Blessing of War, F6a talent
 * grants) and the recipient-scoped bonus-damage dice (Vagabond Finesse /
 * Gambit) fold into the roll automatically.
 *
 * ICON p.102: "Bonus damage means roll one more die than normal, then pick
 * the highest." The helper computes the total bonus dice from both sources
 * and delegates to the shared `rollDamageDice` keep-highest evaluation.
 *
 * Callers add `fray` or other flat bonuses AFTER this call.
 */
export function rollAbilityDamage(
  dice: DiceSource,
  damageDie: number,
  baseDice: number,
  recipientId: string,
  context: {
    abilityUseModifiers?: { bonusDamageDice?: number } | undefined;
    encounterState?: EncounterState | undefined;
    actorId: string;
    sourceId: string;
  },
): number {
  const useLevelBonus = context.abilityUseModifiers?.bonusDamageDice ?? 0;
  const recipientBonus = context.encounterState
    ? recipientBonusDamageDice(context.encounterState, context.actorId, context.sourceId, recipientId)
    : 0;
  return rollDamageDice(dice, damageDie, baseDice, useLevelBonus + recipientBonus);
}
