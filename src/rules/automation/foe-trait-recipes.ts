import type { RuleSourceUnit } from '../source-units.js';
import type { RuleAction, RuleClauseCompilation, RuleEffect, RuleProgramCompilation, RuleSelector } from './types.js';

/**
 * The small, reviewed passive foe-trait slice.  This is deliberately a
 * source-ID manifest rather than a parser: a mention of "flying" or
 * "phasing" in any other trait never grants either condition.
 *
 * The source audit currently finds 19 `Flying`, 14 `Phasing`, and three
 * two-condition traits (including Smoke Demon's source-order
 * `Phasing, Flying`): 36 source units in total.
 */
export type FoeTraitMovementCondition = 'flying' | 'phasing';

export interface FoeTraitMovementRecipe {
  /** Exact extracted trait text reviewed with this source ID. */
  rulesText: 'Flying' | 'Phasing' | 'Flying, Phasing' | 'Phasing, Flying';
  /** Durable passive conditions projected while this source trait is owned. */
  conditions: readonly FoeTraitMovementCondition[];
}

/**
 * Explicitly reviewed ICON 1.5 foe-trait movement projections.  Do not turn
 * this into text matching: mixed, conditional, and otherwise unrelated traits
 * (including every Sturdy trait) remain source-visible but unprojected until
 * each receives its own reviewed recipe.
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

const noMovementConditions: readonly FoeTraitMovementCondition[] = [];
const self: RuleSelector = { kind: 'self' };

export function foeTraitMovementRecipe(sourceId: string): FoeTraitMovementRecipe | null {
  return Object.prototype.hasOwnProperty.call(FOE_TRAIT_MOVEMENT_RECIPES, sourceId)
    ? FOE_TRAIT_MOVEMENT_RECIPES[sourceId]!
    : null;
}

/** The encounter adapter uses this durable projection rather than executing a passive command. */
export function projectedFoeTraitMovementConditions(sourceId: string): readonly FoeTraitMovementCondition[] {
  return foeTraitMovementRecipe(sourceId)?.conditions ?? noMovementConditions;
}

function projectionEffects(recipe: FoeTraitMovementRecipe): RuleEffect[] {
  return recipe.conditions.map((conditionId) => ({
    kind: 'condition',
    target: self,
    conditionId,
    operation: 'apply',
    potency: 'normal',
  }));
}

/**
 * Compile an audited passive projection into the same typed vocabulary used by
 * active programs.  It intentionally is not added to EXECUTE_RULE authority:
 * the conditions are already present whenever the foe owns the source trait.
 */
export function compileFoeTraitMovementRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  const recipe = foeTraitMovementRecipe(unit.id);
  if (!recipe) return null;
  const exactSource = unit.rulesText === recipe.rulesText;
  const effects = projectionEffects(recipe);
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: 'passive',
    text: unit.rulesText,
    effects,
    complete: exactSource,
    unsupportedText: exactSource
      ? ''
      : `Audited foe-trait projection expects exact source text ${JSON.stringify(recipe.rulesText)}.`,
  };
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing: 'passive',
    costs: [],
    tags: [...recipe.conditions],
    range: null,
    area: null,
    choices: [],
    steps: [{ id: `${unit.id}:projection`, timing: 'passive', effects }],
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
    unsupportedClauses: exactSource ? [] : [clause],
  };
}
