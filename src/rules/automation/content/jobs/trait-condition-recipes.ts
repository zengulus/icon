import { registerJobTraitConditionRecipes } from '../../kernels/passive-projection.js';

/**
 * Job-trait condition projections (F6, docs/rules-foundations.md §7).
 *
 * A whole-combat, non-consumable condition grant from a Job trait becomes an
 * encounter condition only through a reviewed row here — never by parsing
 * `rulesText` prose. The rows are deliberately limited to *static* grants:
 * consumable conditions (Defiance, which is removed when it triggers) and
 * gated conditions (Sturdy-while-bloodied, round-5 rages, distance-gated
 * Evasion) use the durable round-start grants and lifecycle recipes in
 * `content/jobs/lifecycle-recipes.ts` instead, so a projection can never
 * resurrect a consumed condition or apply a condition its source gates.
 */
export const JOB_TRAIT_CONDITION_RECIPES: Readonly<Record<string, readonly string[]>> = {
  // ICON p.196 Sealer martial arts: "You have dodge".
  'sealer:trait:martial-arts': ['dodge'],
  // ICON p.162 Shade shadow arts: "You have phasing" (the blinded-immunity
  // half is a per-status immunity mechanic, not a condition).
  'shade:trait:shadow-arts': ['phasing'],
  // ICON p.192 Colossus furious berserk: "You have regeneration" (Defiance is
  // granted durably at combat start — it is consumable, so it must never be
  // re-projected here; the bloodied Sturdy half is a lifecycle-gated row).
  'colossus:trait:furious-berserk': ['regeneration'],
  // ICON p.208 Enochian embersoul: "Start combat with regeneration" (Defiance
  // is granted durably at combat start for the same consumable reason).
  'enochian:trait:embersoul': ['regeneration'],
};

registerJobTraitConditionRecipes(JOB_TRAIT_CONDITION_RECIPES);

/** Exposed for the closed-registry fixtures (F6): the whole-combat Job-trait
 * condition rows. A trait outside this table projects nothing, and a trait
 * with a consumable/gated mechanic is never listed here. */
export const JOB_TRAIT_CONDITION_RECIPES_VIEW: Readonly<Record<string, readonly string[]>> = JOB_TRAIT_CONDITION_RECIPES;
