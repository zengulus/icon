import { registerFoeTraitMovementRecipes } from '../../kernels/foe-trait-recipes.js';
import type { FoeTraitMovementRecipe } from '../../kernels/foe-trait-recipes.js';

/**
 * Explicitly reviewed ICON 1.5 foe-trait movement projections.  Do not turn
 * this into text matching: mixed, conditional, and otherwise unrelated traits
 * (including every Sturdy trait) remain source-visible but unprojected until
 * each receives its own reviewed recipe. The rows register into the
 * `kernels/foe-trait-recipes.ts` projection registry on import.
 */
export const FOE_TRAIT_MOVEMENT_RECIPES: Readonly<Record<string, FoeTraitMovementRecipe>> = {
  'basic:hellion:302:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'basic:shadow:303:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'basic:storm-caller:306:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'basic:chaos-wright:306:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'basic:crucible:309:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'relict:ghul:327:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'relict:wraith:328:trait:special-traits': { rulesText: 'Flying, Phasing', conditions: ['flying', 'phasing'] },
  'relict:strigoi:330:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'relict:life-hunter:331:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'relict:izenghast:333:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'ruin-beast:aetherachnid:347:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'ruin-beast:dungeon-jelly:348:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'ruin-beast:ironfeather:350:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'ruin-beast:harpy:350:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'ruin-beast:barghest:351:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'ruin-beast:floatfish:353:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'ruin-beast:basilisk:355:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'scavenger:nightcloak:369:trait:traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'demon:smoke-demon:410:trait:traits': { rulesText: 'Phasing, Flying', conditions: ['phasing', 'flying'] },
  'demon:warping-demon:410:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'demon:chaos-demon:411:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'demon:feathered-demon:411:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'demon:gazer:413:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'demon:lesser-emissary:414:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'demon:greater-emissary:415:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'lowlander:swarm-wright:434:trait:traits': { rulesText: 'Flying, Phasing', conditions: ['flying', 'phasing'] },
  'jotunn:mistral:451:trait:traits': { rulesText: 'Flying', conditions: ['flying'] },
  'jotunn:quintessent:452:trait:traits': { rulesText: 'Flying', conditions: ['flying'] },
  'jotunn:starblood:454:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
  'jotunn:watcher:454:trait:traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'hob:spirit-hob:470:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'hob:eaves-hob:472:trait:traits': { rulesText: 'Flying', conditions: ['flying'] },
  'hob:pixie:473:trait:traits': { rulesText: 'Flying', conditions: ['flying'] },
  'hob:floating-petal-aesi:474:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'hob:wissan:479:trait:special-traits': { rulesText: 'Phasing', conditions: ['phasing'] },
  'hob:deep-snow-aesi:487:trait:special-traits': { rulesText: 'Flying', conditions: ['flying'] },
};

registerFoeTraitMovementRecipes(FOE_TRAIT_MOVEMENT_RECIPES);
