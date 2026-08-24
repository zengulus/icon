import { projectedFoeTraitConditions } from './foe-trait-recipes.js';
import type { EncounterMark, FoeRoleId } from '../../types.js';

/**
 * Passive projection kernel (docs/rules-foundations.md §7).
 *
 * A passive becomes an encounter condition only through a reviewed source-ID
 * recipe registered here by a content module — never by parsing trait/role
 * prose or mark state, which would turn catalog text into unreviewed
 * authority. The content rows live in `content/classes/`, `content/jobs/`,
 * and `content/foes/` and register through the APIs below; this module
 * deliberately contains no source IDs of its own.
 */

const characterTraitConditionRecipes: Record<string, readonly string[]> = {};

/** Register whole-combat class-trait condition rows (content/classes). */
export function registerCharacterTraitConditionRecipes(rows: Readonly<Record<string, readonly string[]>>): void {
  Object.assign(characterTraitConditionRecipes, rows);
}

const jobTraitConditionRecipes: Record<string, readonly string[]> = {};

/** Register whole-combat Job-trait condition rows (content/jobs). */
export function registerJobTraitConditionRecipes(rows: Readonly<Record<string, readonly string[]>>): void {
  Object.assign(jobTraitConditionRecipes, rows);
}

const foeRoleBaselineRecipes: Record<string, readonly string[]> = {};

/** Register foe role baseline condition rows (content/foes). */
export function registerFoeRoleBaselineRecipes(rows: Readonly<Record<FoeRoleId, readonly string[]>>): void {
  Object.assign(foeRoleBaselineRecipes, rows);
}

/** A reviewed mark-condition projection (ICON p.186). A mark becomes
 * mechanically active only through a registered entry keyed on the exact
 * mark `sourceId` and `markId` plus the specific state the source names. */
export interface MarkConditionProjection {
  sourceId: string;
  markId: string;
  /** The specific mark state the source names (e.g. the ally/foe branch). */
  matches(mark: EncounterMark): boolean;
  /** Conditions this mark grants on its carrier while active. */
  grants?: readonly string[];
  /** Conditions this mark suppresses on its carrier while active. */
  suppresses?: readonly string[];
}

const markConditionProjections: MarkConditionProjection[] = [];

/** Register a reviewed mark-condition projection (content/foes). */
export function registerMarkConditionProjection(projection: MarkConditionProjection): void {
  markConditionProjections.push(projection);
}

/** Conditions a foe role baseline supplies, or none for roles without one. */
export function projectedRoleConditions(roleId: FoeRoleId | null): ReadonlySet<string> {
  return new Set(roleId ? foeRoleBaselineRecipes[roleId] ?? [] : []);
}

/**
 * Conditions a reviewed mark grants on its carrier. The projection is
 * ephemeral: the durable `marks` array is the record, and nothing here is
 * written back into it.
 */
export function projectedMarkConditionGrants(marks: readonly EncounterMark[]): ReadonlySet<string> {
  const granted = new Set<string>();
  for (const mark of marks) {
    for (const projection of markConditionProjections) {
      if (projection.markId !== mark.markId || projection.sourceId !== mark.sourceId) continue;
      if (!projection.matches(mark)) continue;
      for (const condition of projection.grants ?? []) granted.add(condition);
    }
  }
  return granted;
}

/** Conditions a reviewed mark suppresses on its carrier — the source says the
 * carrier "loses" them while the mark is active. */
export function projectedMarkConditionSuppressions(marks: readonly EncounterMark[]): ReadonlySet<string> {
  const suppressed = new Set<string>();
  for (const mark of marks) {
    for (const projection of markConditionProjections) {
      if (projection.markId !== mark.markId || projection.sourceId !== mark.sourceId) continue;
      if (!projection.matches(mark)) continue;
      for (const condition of projection.suppresses ?? []) suppressed.add(condition);
    }
  }
  return suppressed;
}

/**
 * Conditions supplied by exact owned source IDs.  The caller may safely add
 * these to an actor's ephemeral condition set; no result is persisted or
 * inferred from display text.
 *
 * TODO(ICON-rules, pp.104, 186, 298): add Defiance/Counter/Dodge/
 * Regeneration/Rot and foe-role baseline recipes only with the required
 * damage, trigger, restore, and lifecycle fixtures. In particular, role
 * labels must not be mapped here until their source mechanics are complete.
 * The Rot mark projection (noDefiance suppression, REGENERATE ally
 * regeneration) is the reviewed first mark slice.
 */
export function projectedPassiveConditions(traitIds: readonly string[]): ReadonlySet<string> {
  const conditions = new Set<string>();
  for (const traitId of traitIds) {
    for (const condition of characterTraitConditionRecipes[traitId] ?? []) conditions.add(condition);
    for (const condition of jobTraitConditionRecipes[traitId] ?? []) conditions.add(condition);
    for (const condition of projectedFoeTraitConditions(traitId)) conditions.add(condition);
  }
  return conditions;
}

/**
 * Aura-conditional self-grant (docs/rules-foundations.md §6, ICON Aura X). A
 * bearer projects a condition onto itself while it carries an active aura
 * effect whose `sourceId` matches a registered row AND whose owning talent
 * the bearer still ranks in (e.g. Rook — "you also have counter while Rook's
 * aura is active", p.122: only while the Rook talent is taken). The
 * projection is ephemeral and derives from the durable `activeEffects` and
 * `traitIds`/`abilityIds` records (never written back), so it is
 * replay-safe. Content registers rows keyed on the exact aura `sourceId`.
 */
export interface AuraSelfGrantRecipe {
  /** The aura effect's source ID whose activation grants the condition. */
  auraSourceId: string;
  /** The base ability id whose talent grant the source names (e.g. Rook
   * talent 1 grants counter while Rook's aura is active). */
  requiredAbilityId: string;
  /** Conditions granted to the bearer while the aura is active. */
  conditions: readonly string[];
}

const auraSelfGrantRecipes: AuraSelfGrantRecipe[] = [];

/** Register aura-conditional self-grant rows (content/jobs/talent-recipes). */
export function registerAuraSelfGrantRecipes(rows: Readonly<Record<string, AuraSelfGrantRecipe[]>>): void {
  for (const recipeList of Object.values(rows)) auraSelfGrantRecipes.push(...recipeList);
}

/** True when the bearer still ranks in the granting ability. A row like
 * "a talent 1 grants X" is scoped to the ability's talent tier. */
function hasTalentFor(abilityId: string, talents: Readonly<Record<string, 1 | 2>>, abilityIds: readonly string[]): boolean {
  return (talents[abilityId] ?? 0) >= 1 && abilityIds.includes(abilityId);
}

/** Conditions a bearer projects onto itself while it has an active aura effect
 * from a registered source and still owns the granting ability/talent. The
 * blanket bearer is always a member of its own aura, so "while the aura is
 * active" reduces to "has an active aura effect from that source". */
export function projectedAuraSelfGrants(
  activeAuraSourceIds: readonly string[],
  abilityIds: readonly string[],
  talents: Readonly<Record<string, 1 | 2>>,
): Set<string> {
  const granted = new Set<string>();
  for (const recipe of auraSelfGrantRecipes) {
    if (!activeAuraSourceIds.includes(recipe.auraSourceId)) continue;
    if (!hasTalentFor(recipe.requiredAbilityId, talents, abilityIds)) continue;
    for (const condition of recipe.conditions) granted.add(condition);
  }
  return granted;
}
