/**
 * Mastery attachment kernel (docs/rules-foundations.md §Mastery).
 *
 * ICON 1.5: a mastery is not an independently activated ability — it modifies
 * or extends the ability that owns it. This module is the single reusable,
 * source-ID-free mechanism that answers the two generic questions:
 *
 *   - does this actor have the parent ability mastered (and equipped)?
 *   - what attachment kind does a registered mastery declare?
 *
 * A content module registers a reviewed `MasteryRecipe` per source mastery
 * (`content/jobs/mastery-recipes.ts`): the recipe declares its attachment
 * kind — how the mastery participates in the parent ability's existing
 * resolver, lifecycle, or passive authority — plus what the engine resolves
 * and (for documented rows) the remaining kernel need. The kernel never
 * branches on a source ID: `sourceId` is provenance and registry key only.
 *
 * The gate (`hasMastery`) requires the parent ability to be BOTH equipped
 * (the actor's `abilityIds`) AND mastered (`masteredAbilityIds`). A mastery
 * must never fire merely because a source ID exists in a registry, and it
 * must never fire for an unequipped parent. Both lists are durable encounter
 * authority — never queried from the character sheet during combat, so
 * command and replay read the same gate.
 */

import type { EncounterState } from '../../types.js';

/**
 * How a mastery attaches to its parent ability — the four families already
 * present in the engine:
 *
 * - `fold` — post-use mutation/fold augmentations (the F7 talent fold shape:
 *   the mastery appends deterministic mutations after the ability resolves).
 * - `program-level` — the mastery participates *inside* the parent ability's
 *   typed resolver (it changes the ability's own emitted mutations: a
 *   different area, a different aura record, a re-trigger effect).
 * - `continuous` — a continuous/passive projection derived from current state
 *   (an aura member projection, a condition projection), never a durable
 *   snapshot that can go stale.
 * - `lifecycle` — lifecycle/trigger augmentations (a turn-start/turn-end
 *   recipe, a save-or-suffer boundary) gated on the mastered parent.
 */
export type MasteryAttachmentKind = 'fold' | 'program-level' | 'continuous' | 'lifecycle';

export type MasteryStatus = 'implemented' | 'documented';

export interface MasteryRecipe {
  /** Exact source ID of the mastery source unit (e.g. `bastion:rook:mastery`). */
  sourceId: string;
  /** The parent ability the mastery modifies (its `parentId` in the source
   * unit graph). The gate keys on this id. */
  abilityId: string;
  name: string;
  status: MasteryStatus;
  attachment: MasteryAttachmentKind;
  /** What the engine resolves deterministically (implemented rows). */
  mechanic: string;
  /** Documented rows: the ruling / remaining kernel need. Implemented rows
   * leave this empty. */
  detail: string;
}

const masteryRecipes: Record<string, MasteryRecipe> = {};

/** Register a reviewed mastery recipe (content/jobs/mastery-recipes.ts). */
export function registerMasteryRecipe(recipe: MasteryRecipe): void {
  masteryRecipes[recipe.sourceId] = recipe;
}

/** The registered recipe for a mastery source unit, or null. */
export function masteryRecipeFor(sourceId: string): MasteryRecipe | null {
  return masteryRecipes[sourceId] ?? null;
}

/** The executable mastery ids — the allowlist that makes each mastery's
 * compilation complete (audit authority: allowlist + source fixture + replay
 * test). Only `implemented` rows are executable; documented rows stay
 * source-visible with their remaining kernel need. */
export function getExecutableMasteryIds(): ReadonlySet<string> {
  return new Set(Object.values(masteryRecipes)
    .filter((recipe) => recipe.status === 'implemented')
    .map((recipe) => recipe.sourceId));
}

/** True when the mastery source unit is registered as implemented. */
export const isExecutableMastery = (sourceId: string): boolean =>
  masteryRecipes[sourceId]?.status === 'implemented';

/** The documented-row detail text for an unimplemented mastery, or '' when
 * the row is implemented or unknown. */
export function documentedMasteryDetail(sourceId: string): string {
  const recipe = masteryRecipes[sourceId];
  if (!recipe || recipe.status === 'implemented') return '';
  return recipe.detail;
}

/** The minimal ownership surface the gate reads. Both the encounter actor and
 * the rule runtime view satisfy it. */
export interface MasteryOwnerView {
  abilityIds?: readonly string[];
  masteredAbilityIds?: readonly string[];
}

/**
 * The shared mastery gate: the parent ability must be equipped AND mastered.
 * Durable, deterministic, and source-ID-free — the caller supplies the
 * ability id it is gating (never a hardcoded source string inside a kernel).
 */
export function hasMastery(owner: MasteryOwnerView, abilityId: string): boolean {
  return Boolean(owner.abilityIds?.includes(abilityId) && owner.masteredAbilityIds?.includes(abilityId));
}

/** The same gate against the authoritative encounter state. */
export function isMastered(state: EncounterState, actorId: string, abilityId: string): boolean {
  const actor = state.actors[actorId];
  return Boolean(actor && hasMastery(actor, abilityId));
}
