/**
 * F6 attack-path trait modifier kernel (docs/rules-foundations.md §7).
 *
 * The attack-family traits execute through a shared fold instead of being
 * hand-wired per site: each trait registers an `AttackModifierRule` (content/
 * jobs/attack-modifier-recipes.ts) describing its armed one-shot state and
 * permanent elevation mechanics, and the fold below reads the registered
 * rules at attack time. Armed one-shot state is consumed by the attack that
 * reads it: the direct path consumes at reducer time next to
 * `consumeMassiveOverhead`; the VM consumes mid-command by mutating its fresh
 * actor view, so a multi-target ability only applies the modifier to its
 * first attack roll while the reducer-time consume keeps the rebuilt state
 * faithful. This module deliberately contains no source IDs of its own.
 */

import type { RuleSourceUnit } from '../../source-units.js';
import type { RuleAction, RuleClauseCompilation, RuleProgramCompilation, RuleSelector } from '../primitives/types.js';

export interface TraitAttackModifier {
  boons: number;
  trueStrike: boolean;
  damageDieOverride: number | null;
  bonusDamageFlat: number;
  exceedThreshold: number | null;
  /** Unerring (p.105): the attack ignores cover and aetherwall. */
  unerring: boolean;
}

/** The minimal read surface both the declarative actor view and the direct
 * EncounterActor satisfy (the view exposes `state` for ruleState). */
export interface TraitModifierOwner {
  traitIds: readonly string[];
  state: Record<string, unknown>;
}

/** The minimal target read surface for target-threshold and distance-gated
 * modifiers: the target's HP vs its wounds-adjusted maximum, plus the
 * canonical source→target distance (computed by the caller through the
 * shared range kernel, so the fold and the targeting gates agree on the same
 * metric). */
export interface AttackModifierTarget {
  hp: number;
  maxHp: number;
  distance?: number;
}

/**
 * A registered attack-path trait rule:
 *
 * - Armed one-shot rules (Demon Edge's true strike, Hissatsu's boon/true
 *   strike/d10) only apply while the owner's `armedKey` rule-state is true;
 *   the key is consumed by the next attack.
 * - Elevation rules (Pulverize) are permanent reads: flat bonus damage at one
 *   or more elevations lower, and an exceed-threshold override at two or more.
 */
export interface AttackModifierRule {
  /** The exact source trait id that owns this rule. */
  traitId: string;
  /** One-shot armed rule-state key that must be true for the grant to apply. */
  armedKey?: string;
  boons?: number;
  trueStrike?: boolean;
  /** Damage die sides override (e.g. Hissatsu's d10). */
  damageDieOverride?: number;
  /** Flat bonus damage at elevation diff >= 1 (source − target). */
  elevationBonusDamage?: number;
  /** Exceed-threshold override at elevation diff >= 2. */
  elevationExceedThreshold?: number;
  /** Flat bonus damage on attacks against a bloodied target (Blood Hunger:
   * "+2 damage with all abilities against bloodied foes"). The gate is the
   * shared bloodied predicate (at or under 50% of the target's maximum). */
  targetBloodiedBonusDamage?: number;
  /** Exact-distance gate: the rule applies only when the target is at exactly
   * this range from the source (Trigrammaton: "against foes at exactly range
   * 3"). The distance is the shared p.92 footprint metric; the rule never
   * changes targeting legality. */
  exactRange?: number;
  /** Unerring grant (Trigrammaton: "gain +1 boon on attack rolls and
   * unerring"): the attack ignores cover and aetherwall (p.105). */
  unerring?: boolean;
}

const attackModifierRules: AttackModifierRule[] = [];

/** Register an attack-path trait rule (content/jobs/attack-modifier-recipes.ts). */
export function registerAttackModifierRule(rule: AttackModifierRule): void {
  attackModifierRules.push(rule);
}

/** The combined attack-path modifier for an attack at `elevationDiff`
 * (source elevation − target elevation) against `target` (for target-
 * threshold rules). Pure reads: armed one-shot state plus the permanent
 * elevation and target-threshold mechanics. */
export function traitAttackModifier(owner: TraitModifierOwner, elevationDiff: number, target?: AttackModifierTarget): TraitAttackModifier {
  const modifier: TraitAttackModifier = {
    boons: 0,
    trueStrike: false,
    damageDieOverride: null,
    bonusDamageFlat: 0,
    exceedThreshold: null,
    unerring: false,
  };
  for (const rule of attackModifierRules) {
    if (!owner.traitIds.includes(rule.traitId)) continue;
    if (rule.armedKey && owner.state[rule.armedKey] !== true) continue;
    if (rule.exactRange !== undefined && target?.distance !== rule.exactRange) continue;
    if (rule.boons) modifier.boons += rule.boons;
    if (rule.trueStrike) modifier.trueStrike = true;
    if (rule.damageDieOverride) modifier.damageDieOverride = rule.damageDieOverride;
    if (rule.elevationBonusDamage && elevationDiff >= 1) modifier.bonusDamageFlat += rule.elevationBonusDamage;
    if (rule.elevationExceedThreshold && elevationDiff >= 2) modifier.exceedThreshold = rule.elevationExceedThreshold;
    if (rule.targetBloodiedBonusDamage && target && target.hp <= target.maxHp / 2) modifier.bonusDamageFlat += rule.targetBloodiedBonusDamage;
    if (rule.unerring) modifier.unerring = true;
  }
  return modifier;
}

/** True when the attack consumed armed one-shot state (Hissatsu / Demon
 * Edge true strike), so callers know to clear the armed keys. */
export function consumedTraitModifier(modifier: TraitAttackModifier): boolean {
  return modifier.boons > 0 || modifier.trueStrike || modifier.damageDieOverride !== null;
}

/** Clear the one-shot armed keys (call after an attack consumed them). */
export function consumeTraitAttackModifiers(state: Record<string, unknown>): void {
  for (const rule of attackModifierRules) {
    if (rule.armedKey) delete state[rule.armedKey];
  }
}

/** The damage die sides for an attack, honoring armed d10 overrides. */
export function effectiveDamageDie(owner: TraitModifierOwner & { damageDie: number }): number {
  for (const rule of attackModifierRules) {
    if (rule.damageDieOverride && owner.traitIds.includes(rule.traitId) && rule.armedKey && owner.state[rule.armedKey] === true) return rule.damageDieOverride;
  }
  return owner.damageDie;
}

// ── Foe-trait audit compilation ──────────────────────────────────────────────

const self: RuleSelector = { kind: 'self' };

/** Compile a reviewed attack-modifier foe trait (Blood Hunger) into the same
 * typed passive vocabulary the other foe-trait manifests use. The modifier
 * is already folded at both attack sites whenever the foe owns the source
 * trait, so the program is audit-complete without adding EXECUTE_RULE
 * authority. */
export function compileAttackModifierFoeTraitRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  const rule = attackModifierRules.find((candidate) => candidate.traitId === unit.id);
  if (!rule) return null;
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: 'passive',
    text: unit.rulesText,
    effects: [],
    complete: true,
    unsupportedText: '',
  };
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing: 'passive',
    costs: [],
    tags: [],
    range: null,
    area: null,
    choices: [],
    steps: [{ id: `${unit.id}:projection`, timing: 'passive', effects: [] }],
  };
  return {
    program: {
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: `program:${unit.id}`,
      sourceId: unit.id,
      source: unit.source,
      name: unit.name,
      actions: [action],
      dependencies: unit.parentId ? [unit.parentId] : [],
      classification: 'encounter',
    },
    clauses: [clause],
    unsupportedClauses: [],
  };
}

