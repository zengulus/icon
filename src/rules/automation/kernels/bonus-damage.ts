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
import { encounterRuleState } from './encounter-adapter.js';
import { rollDamageDice } from '../primitives/damage-roll.js';
import {
  constantModifierValue,
  foldNumberModifiers,
  modifierRulesForSource,
  modifierGateHolds,
  registerModifierRule,
  type ModifierFoldView,
} from '../primitives/modifiers.js';
import { resolveModifierNumber } from './evaluate-modifiers.js';
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
  | { kind: 'target-has-condition'; conditionId?: string }
  /** The acting character starts the ability on higher elevation than its
   * attack target by at least `minimumLevels` (Pulverize p.135: "When you
   * start an attack ability on higher elevation than your target, it deals
   * bonus damage"). The elevation difference is the canonical p.89 metric
   * (a pit counts one lower); evaluated once at the ability-use boundary
   * against the recorded attack target's position. */
  | { kind: 'elevation-above-target'; minimumLevels: number };

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
  /** Bonus dice for the use. A NUMBER registers a shared U14
   * `bonus-damage-dice` ModifierRule row (folded through the one registry);
   * a FUNCTION is the retained scaled-row specialist (a deterministic count
   * read from current state, e.g. Incubus' "one die per ally adjacent to
   * your target") — its per-source read cannot be a plain value fold, and
   * it stays in this kernel's local fold. */
  dice: number | ((view: BonusDamageFoldView) => number);
}

const scaledBonusDamageRules: BonusDamageRule[] = [];

/** Whether a bonus-damage gate can ride the shared U14 modifier registry
 * (the shared `ModifierGate` evaluator covers every gate except the
 * elevation metric, whose canonical p.89 evaluation needs the raw
 * encounter state's `elevationAt` — the local fold owns it). */
function isSharedGate(gate: BonusDamageGate): gate is Extract<BonusDamageGate, import('../primitives/modifiers.js').ModifierGate> {
  return gate.kind !== 'elevation-above-target';
}

/**
 * A TRAIT-gated ability-use bonus-damage rule. Unlike the ability-keyed rows
 * above, the rule fires for EVERY ability the trait owner uses while the
 * gate holds — it never needs the parent ability id. This is the home for
 * trait-wide "your abilities gain bonus damage under condition X" clauses
 * (Pulverize p.135: any attack ability started on higher elevation than its
 * target deals bonus damage — the bonus rides the ability's damage rolls,
 * never an attack-space-only provenance field). The dice are folded into
 * the SAME ability-use authority (`abilityUseModifiers.bonusDamageDice`) the
 * ability-keyed rows use, so every damage roll of the use carries them
 * through the shared keep-highest evaluation.
 */
export interface TraitBonusDamageRule {
  /** Exact source id of the granting unit (trait). */
  sourceId: string;
  /** The trait id whose ownership arms the rule. */
  traitId: string;
  /** Source conditions (default: unconditional). */
  gate?: BonusDamageGate;
  /** Bonus dice for the use. */
  dice: number;
}

const traitBonusDamageRules: TraitBonusDamageRule[] = [];

/** Register a bonus-damage grant rule (content/jobs/bonus-damage-recipes.ts).
 * Numeric rows convert to the shared U14 `bonus-damage-dice` query point;
 * function rows (scaled counts) stay in the local specialist fold. */
export function registerBonusDamageRule(rule: BonusDamageRule): void {
  if (typeof rule.dice === 'number' && (rule.gate === undefined || isSharedGate(rule.gate))) {
    registerModifierRule({
      sourceId: rule.sourceId,
      ownerId: rule.abilityId,
      queryPoint: 'bonus-damage-dice',
      scope: 'default',
      operation: 'add',
      value: constantModifierValue(rule.dice),
      ...(rule.gate ? { gates: [rule.gate] } : {}),
      ...(rule.talent !== undefined ? { talent: rule.talent } : {}),
    });
  } else {
    scaledBonusDamageRules.push(rule);
  }
}

/** Register a trait-gated bonus-damage rule (content/jobs/bonus-damage-
 * recipes.ts). Fired for every ability the trait owner uses while the gate
 * holds. */
export function registerTraitBonusDamageRule(rule: TraitBonusDamageRule): void {
  traitBonusDamageRules.push(rule);
}

function targetActor(state: EncounterState, targetIds: readonly string[]): EncounterActor | undefined {
  const targetId = targetIds[0];
  return targetId ? state.actors[targetId] : undefined;
}

/** Project the encounter state + actor + attack target onto the shared U14
 * fold view (the bonus-damage gates read the actor and target state). */
function bonusDamageFoldView(state: EncounterState, actor: EncounterActor, targetIds: readonly string[]): ModifierFoldView {
  const target = targetActor(state, targetIds);
  return {
    round: state.round,
    actor: {
      id: actor.id,
      hp: actor.hp,
      // The BASE maximum — the same bar isBloodied measures against (the
      // self-bloodied gate compares hp <= baseMaxHp/2; p.81 adjudication
      // icon-1.5:combat:bloodied-base-max).
      maximumHp: actor.baseMaxHp,
      side: actor.side,
      abilityIds: actor.abilityIds,
      masteredAbilityIds: actor.masteredAbilityIds,
      talents: actor.talents,
      conditions: new Set(actor.conditions.map((condition) => condition.id)),
    },
    conditionsFor: () => new Set(actor.conditions.map((condition) => condition.id)),
    ...(target ? {
      target: {
        id: target.id,
        side: target.side,
        hp: target.hp,
        // The BASE maximum — the same bar isBloodied measures against (the
        // shared target-bloodied gate compares hp <= baseMaxHp/2; p.81).
        maxHp: target.baseMaxHp,
        conditions: target.conditions,
      },
    } : {}),
  };
}

/**
 * The total bonus dice a single use of `abilityId` carries for `actor`, per
 * every registered rule whose parent, talent choice, and gate hold. Evaluated
 * once at the USE_ABILITY command boundary; the result rides
 * `abilityUseModifiers` so the rolled damage mutations record it durably.
 * Numeric rows fold through the shared U14 `bonus-damage-dice` registry;
 * scaled function rows fold through the local specialist (identical
 * registration-order semantics).
 */
export function bonusDamageDiceForUse(
  state: EncounterState,
  actor: EncounterActor,
  abilityId: string,
  targetIds: readonly string[],
): number {
  const foldView = bonusDamageFoldView(state, actor, targetIds);
  const shared = foldNumberModifiers('bonus-damage-dice', 'default', 0, abilityId, foldView, {}, resolveModifierNumber);
  let scaled = 0;
  for (const rule of scaledBonusDamageRules) {
    if (rule.abilityId !== abilityId) continue;
    if (rule.talent !== undefined && actor.talents?.[abilityId] !== rule.talent) continue;
    const gate = rule.gate;
    if (gate && !bonusDamageFoldGateHolds(gate, foldView, state, actor, targetIds)) continue;
    // Numeric rows land here when their gate is not expressible on the shared
    // U14 registry (the elevation metric); function rows are the scaled
    // specialist. Both fold identically against the same gate authority.
    const dice = typeof rule.dice === 'function'
      ? rule.dice({ state, actorId: actor.id, abilityId, targetIds })
      : rule.dice;
    scaled += Math.max(0, Math.floor(dice));
  }
  // Trait-gated rows: fired for every ability the trait owner uses while the
  // gate holds (Pulverize p.135 elevation bonus — the ability deals bonus
  // damage, so the die rides the ability-use fold, never an attack-space-
  // only provenance field).
  for (const rule of traitBonusDamageRules) {
    if (!actor.traitIds.includes(rule.traitId)) continue;
    const gate = rule.gate;
    if (gate && !bonusDamageFoldGateHolds(gate, foldView, state, actor, targetIds)) continue;
    scaled += Math.max(0, Math.floor(rule.dice));
  }
  return shared + scaled;
}

/** Numeric, scaled, and trait rows share U14 applicability. Elevation remains
 * a specialist until the shared fold view can express its spatial metric. */
function bonusDamageFoldGateHolds(
  gate: BonusDamageGate,
  foldView: ModifierFoldView,
  state: EncounterState,
  actor: EncounterActor,
  targetIds: readonly string[],
): boolean {
  if (isSharedGate(gate)) return modifierGateHolds(gate, foldView);
  const target = targetActor(state, targetIds);
  if (!target || !actor.position || !target.position) return false;
  // The canonical p.89 elevation metric (a pit counts one lower) — the
  // same authority the attack kernel uses for the elevation modifier.
  const view = encounterRuleState(state);
  return view.elevationAt(actor.position) - view.elevationAt(target.position) >= gate.minimumLevels;
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
  return modifierRulesForSource(sourceId, 'bonus-damage-dice').length > 0
    || scaledBonusDamageRules.some((rule) => rule.sourceId === sourceId)
    || recipientBonusDamageRules.some((rule) => rule.sourceId === sourceId)
    || traitBonusDamageRules.some((rule) => rule.sourceId === sourceId);
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
