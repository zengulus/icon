import type { RuleSourceUnit } from '../../source-units.js';
import type { FoeRoleId } from '../../types.js';
import type { RuleAction, RuleClauseCompilation, RuleEffect, RuleProgramCompilation, RuleSelector } from '../primitives/types.js';

/**
 * Foe-trait keyword projection kernel.
 *
 * Foe profiles carry a `special-traits`/`traits` row whose text is a
 * comma-separated list of ICON p.298 glossary trait names (Sturdy, Defiance,
 * Flying, Size 2, Armor 10, …). Each row of the manifest in
 * `content/foes/trait-recipes.ts` is reviewed against its exact source ID and
 * declares the exact source keyword list plus the durable effect of each
 * keyword. Nothing is inferred from prose at runtime: a row only projects
 * when its source text parses to exactly the declared keywords, and a keyword
 * the engine cannot execute yet is registered as `pending` (the row then
 * audits as incomplete with the precise reason).
 *
 * The `automation: 'executable'` marker on a trait is derived from the same
 * closed manifest: a row is fully executable when every keyword maps to a
 * wired mechanic (a consumed condition, a consumed stat, or a role baseline).
 */
export type FoeTraitKeywordEffect =
  /** A durable positive condition consumed by the engine (p.104/p.298).
   * Non-consumable gates (Sturdy, Dodge, Rampart, …) are projected; a
   * consumable condition (Defiance, p.104: removed on trigger) must be
   * granted durably at combat start so the damage kernel's consumption is
   * not resurrected by the next projection fold (the F6 pattern). */
  | { kind: 'condition'; keyword: string; condition: string }
  | { kind: 'durable'; keyword: string; condition: string }
  /** A structured stat applied at profile construction. `pending` marks a
   * stat whose consuming mechanic is not wired yet (p.92 footprint). */
  | { kind: 'stat'; keyword: string; stat: 'size' | 'armor' | 'speed'; value: number; pending?: string }
  /** A p.298 role-glossary trait already covered by the profile's roleId
   * baseline (Guard → heavy). */
  | { kind: 'role'; keyword: string; roleId: FoeRoleId }
  /** A recognized keyword whose mechanic has no wired engine path yet. */
  | { kind: 'pending'; keyword: string; note: string };

export interface FoeTraitKeywordRecipe {
  sourceId: string;
  /** The exact source keyword list, one effect per comma-separated part. */
  effects: readonly FoeTraitKeywordEffect[];
}

const foeTraitKeywordRecipes: Record<string, FoeTraitKeywordRecipe> = {};

/** Register reviewed foe-trait keyword rows (content/foes/trait-recipes.ts). */
export function registerFoeTraitKeywordRecipes(rows: Readonly<Record<string, FoeTraitKeywordRecipe>>): void {
  Object.assign(foeTraitKeywordRecipes, rows);
}

export function foeTraitKeywordRecipe(sourceId: string): FoeTraitKeywordRecipe | null {
  return Object.prototype.hasOwnProperty.call(foeTraitKeywordRecipes, sourceId)
    ? foeTraitKeywordRecipes[sourceId]!
    : null;
}

/** True when every keyword of the reviewed row maps to a wired mechanic
 * (no `pending` effect and no `pending` stat). Drives the trait's
 * `automation: 'executable'` marker and the audit completeness of the row. */
export function isFullyExecutableFoeTraitRecipe(sourceId: string): boolean {
  const recipe = foeTraitKeywordRecipe(sourceId);
  if (!recipe) return false;
  return recipe.effects.every((effect) => effect.kind !== 'pending'
    && (effect.kind !== 'stat' || effect.pending === undefined));
}

/** Consumable positive conditions the reviewed row grants durably (currently
 * Defiance only). The content module registers these into the combat-start
 * recipe registry so the grant is applied once per combat, idempotently. */
export function durableFoeTraitGrantConditions(sourceId: string): readonly string[] {
  const recipe = foeTraitKeywordRecipe(sourceId);
  if (!recipe) return noConditions;
  return recipe.effects.filter((effect) => effect.kind === 'durable').map((effect) => effect.condition);
}

/** The durable passive conditions a reviewed source trait projects while it
 * is owned. The encounter adapter folds this into `encounterConditionSet`
 * (via `projectedPassiveConditions`), so every consumer sees the same set.
 * Consumable durable grants (Defiance) are deliberately not projected: they
 * are granted at combat start so the damage kernel can consume them. */
export function projectedFoeTraitConditions(sourceId: string): readonly string[] {
  const recipe = foeTraitKeywordRecipe(sourceId);
  if (!recipe) return noConditions;
  return recipe.effects.filter((effect) => effect.kind === 'condition').map((effect) => effect.condition);
}

/** The structured stat overrides a set of owned source traits projects
 * (Size/Armor/Speed keywords, p.298). Applied once at profile construction;
 * the durable actor fields are the record. Later rows win on a conflict
 * (deterministic by traitId order, matching the condition fold). */
export function projectedFoeTraitStats(traitIds: readonly string[]): { size?: number; armor?: number; speed?: number } {
  const stats: { size?: number; armor?: number; speed?: number } = {};
  for (const traitId of traitIds) {
    const recipe = foeTraitKeywordRecipe(traitId);
    if (!recipe) continue;
    for (const effect of recipe.effects) {
      if (effect.kind !== 'stat') continue;
      stats[effect.stat] = effect.value;
    }
  }
  return stats;
}

const noConditions: readonly string[] = [];
const self: RuleSelector = { kind: 'self' };

/** Split the source text into its comma-separated keyword parts, trimmed.
 * The split is exact: no period or case normalization, so a reviewed row can
 * only match the source text it was reviewed against (including source
 * artifacts such as `S ize 3` or a trailing period). */
export function parseFoeTraitKeywordList(text: string): string[] {
  return text.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

function projectionEffects(recipe: FoeTraitKeywordRecipe): RuleEffect[] {
  return recipe.effects
    .filter((effect) => effect.kind === 'condition')
    .map((effect) => ({
      kind: 'condition',
      target: self,
      conditionId: effect.condition,
      operation: 'apply',
      potency: 'normal',
    } as const));
}

/**
 * Compile an audited passive projection into the same typed vocabulary used
 * by active programs. It intentionally is not added to EXECUTE_RULE
 * authority: the conditions are already present whenever the foe owns the
 * source trait, and the durable stats are applied at profile construction.
 */
export function compileFoeTraitKeywordRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  const recipe = foeTraitKeywordRecipe(unit.id);
  if (!recipe) return null;
  const parts = parseFoeTraitKeywordList(unit.rulesText);
  const expected = recipe.effects.map((effect) => effect.keyword);
  const textMatches = parts.length === expected.length && parts.every((part, index) => part === expected[index]);
  const pendingNotes = recipe.effects.flatMap((effect): string[] => {
    if (effect.kind === 'pending') return [effect.note];
    if (effect.kind === 'stat' && effect.pending !== undefined) return [effect.pending];
    return [];
  });
  const complete = textMatches && pendingNotes.length === 0;
  const unsupportedText = complete
    ? ''
    : textMatches
      ? `Recognized foe-trait keyword(s) with no wired mechanic yet: ${pendingNotes.join('; ')}`
      : `Audited foe-trait keyword recipe expects the exact source keyword list ${JSON.stringify(expected)}.`;
  const effects = projectionEffects(recipe);
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: 'passive',
    text: unit.rulesText,
    effects,
    complete,
    unsupportedText,
  };
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing: 'passive',
    costs: [],
    tags: recipe.effects
      .filter((effect) => effect.kind === 'condition')
      .map((effect) => effect.condition),
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
    unsupportedClauses: complete ? [] : [clause],
  };
}

/** Backwards-compatible projection alias for the movement-only manifest
 * (renamed `projectedFoeTraitConditions`). */
export function projectedFoeTraitMovementConditions(sourceId: string): readonly string[] {
  return projectedFoeTraitConditions(sourceId);
}
