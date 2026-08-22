import { projectedFoeTraitMovementConditions } from './foe-trait-recipes.js';

/**
 * Closed, source-ID passive projection registry.
 *
 * A passive becomes an encounter condition only through an entry here or a
 * dedicated audited source-ID recipe.  This module deliberately never parses
 * trait/role prose: that would turn catalog text into unreviewed authority.
 */
const CHARACTER_TRAIT_CONDITION_RECIPES: Readonly<Record<string, readonly string[]>> = {
  'stalwart:trait:fortify': ['fortify'],
  'vagabond:trait:skirmisher': ['skirmisher'],
  'vagabond:trait:dodge': ['dodge'],
  'vagabond:trait:finesse': ['finesse'],
  'wright:trait:slip': ['slip'],
  'wright:trait:aetherwall': ['aetherwall'],
  'wright:trait:chain-reaction': ['chain-reaction'],
  'wright:trait:aether': ['aether-user'],
};

/**
 * Conditions supplied by exact owned source IDs.  The caller may safely add
 * these to an actor's ephemeral condition set; no result is persisted or
 * inferred from display text.
 *
 * TODO(ICON-rules, pp.104, 186, 298): add Defiance/Counter/Dodge/
 * Regeneration/Rot and foe-role baseline recipes only with the required
 * damage, trigger, restore, and lifecycle fixtures. In particular, role
 * labels must not be mapped here until their source mechanics are complete.
 */
export function projectedPassiveConditions(traitIds: readonly string[]): ReadonlySet<string> {
  const conditions = new Set<string>();
  for (const traitId of traitIds) {
    for (const condition of CHARACTER_TRAIT_CONDITION_RECIPES[traitId] ?? []) conditions.add(condition);
    for (const condition of projectedFoeTraitMovementConditions(traitId)) conditions.add(condition);
  }
  return conditions;
}

/** Exposed for closed-registry tests and source-audit tooling. */
export const PASSIVE_TRAIT_CONDITION_RECIPES = CHARACTER_TRAIT_CONDITION_RECIPES;
