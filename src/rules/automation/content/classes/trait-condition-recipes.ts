import { registerCharacterTraitConditionRecipes } from '../../kernels/passive-projection.js';

/**
 * Closed, source-ID class-trait condition projections (ICON pp.116–117).
 *
 * A class passive becomes an encounter condition only through a reviewed
 * row here — never by parsing `rulesText` prose.
 */
export const CHARACTER_TRAIT_CONDITION_RECIPES: Readonly<Record<string, readonly string[]>> = {
  'stalwart:trait:fortify': ['fortify'],
  'vagabond:trait:skirmisher': ['skirmisher'],
  'vagabond:trait:dodge': ['dodge'],
  // Finesse (p.116 "You deal bonus damage to bloodied foes") is NOT a
  // condition projection: it is a recipient-scoped bonus-damage rule
  // (content/jobs/bonus-damage-recipes.ts) evaluated at the damage-roll
  // query point, so the die keys off the actual damage recipient's bloodied
  // state (plus the Vagabond Gambit ownership gate) rather than an actor-
  // wide condition.
  'wright:trait:slip': ['slip'],
  'wright:trait:aetherwall': ['aetherwall'],
  'wright:trait:chain-reaction': ['chain-reaction'],
  'wright:trait:aether': ['aether-user'],
};

registerCharacterTraitConditionRecipes(CHARACTER_TRAIT_CONDITION_RECIPES);

/** Exposed for closed-registry tests and source-audit tooling. */
export const PASSIVE_TRAIT_CONDITION_RECIPES = CHARACTER_TRAIT_CONDITION_RECIPES;
