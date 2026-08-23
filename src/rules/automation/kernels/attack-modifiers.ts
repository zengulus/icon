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

export interface TraitAttackModifier {
  boons: number;
  trueStrike: boolean;
  damageDieOverride: number | null;
  bonusDamageFlat: number;
  exceedThreshold: number | null;
}

/** The minimal read surface both the declarative actor view and the direct
 * EncounterActor satisfy (the view exposes `state` for ruleState). */
export interface TraitModifierOwner {
  traitIds: readonly string[];
  state: Record<string, unknown>;
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
}

const attackModifierRules: AttackModifierRule[] = [];

/** Register an attack-path trait rule (content/jobs/attack-modifier-recipes.ts). */
export function registerAttackModifierRule(rule: AttackModifierRule): void {
  attackModifierRules.push(rule);
}

/** The combined attack-path modifier for an attack at `elevationDiff`
 * (source elevation − target elevation). Pure reads: armed one-shot state
 * plus the permanent elevation mechanics. */
export function traitAttackModifier(owner: TraitModifierOwner, elevationDiff: number): TraitAttackModifier {
  const modifier: TraitAttackModifier = {
    boons: 0,
    trueStrike: false,
    damageDieOverride: null,
    bonusDamageFlat: 0,
    exceedThreshold: null,
  };
  for (const rule of attackModifierRules) {
    if (!owner.traitIds.includes(rule.traitId)) continue;
    if (rule.armedKey && owner.state[rule.armedKey] !== true) continue;
    if (rule.boons) modifier.boons += rule.boons;
    if (rule.trueStrike) modifier.trueStrike = true;
    if (rule.damageDieOverride) modifier.damageDieOverride = rule.damageDieOverride;
    if (rule.elevationBonusDamage && elevationDiff >= 1) modifier.bonusDamageFlat += rule.elevationBonusDamage;
    if (rule.elevationExceedThreshold && elevationDiff >= 2) modifier.exceedThreshold = rule.elevationExceedThreshold;
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

