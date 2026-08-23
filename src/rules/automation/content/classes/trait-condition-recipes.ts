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
  'vagabond:trait:finesse': ['finesse'],
  'wright:trait:slip': ['slip'],
  'wright:trait:aetherwall': ['aetherwall'],
  'wright:trait:chain-reaction': ['chain-reaction'],
  'wright:trait:aether': ['aether-user'],
};

registerCharacterTraitConditionRecipes(CHARACTER_TRAIT_CONDITION_RECIPES);

/** Exposed for closed-registry tests and source-audit tooling. */
export const PASSIVE_TRAIT_CONDITION_RECIPES = CHARACTER_TRAIT_CONDITION_RECIPES;
