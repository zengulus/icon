import type { RuleSourceUnit } from '../../source-units.js';
import type { RuleAction, RuleClauseCompilation, RuleEffect, RuleProgramCompilation, RuleSelector } from '../primitives/types.js';

/**
 * Foe-trait movement projection kernel.
 *
 * The small, reviewed passive foe-trait slice is a source-ID manifest rather
 * than a parser: a mention of "flying" or "phasing" in any other trait never
 * grants either condition. The rows live in
 * `content/foes/trait-recipes.ts` and register through
 * `registerFoeTraitMovementRecipes`; this module contains the registry and
 * the compiler machinery, with no source IDs of its own.
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

const foeTraitMovementRecipes: Record<string, FoeTraitMovementRecipe> = {};

/** Register reviewed foe-trait movement rows (content/foes/trait-recipes.ts). */
export function registerFoeTraitMovementRecipes(rows: Readonly<Record<string, FoeTraitMovementRecipe>>): void {
  Object.assign(foeTraitMovementRecipes, rows);
}

export function foeTraitMovementRecipe(sourceId: string): FoeTraitMovementRecipe | null {
  return Object.prototype.hasOwnProperty.call(foeTraitMovementRecipes, sourceId)
    ? foeTraitMovementRecipes[sourceId]!
    : null;
}

/** The encounter adapter uses this durable projection rather than executing a passive command. */
export function projectedFoeTraitMovementConditions(sourceId: string): readonly FoeTraitMovementCondition[] {
  return foeTraitMovementRecipe(sourceId)?.conditions ?? noMovementConditions;
}

const noMovementConditions: readonly FoeTraitMovementCondition[] = [];
const self: RuleSelector = { kind: 'self' };

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
