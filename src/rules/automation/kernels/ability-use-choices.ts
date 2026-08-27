/**
 * F10 ability-use choice fold (docs/rules-foundations.md §8).
 *  * The Blessing-of-War / Blessing-of-Rebirth family (ICON p.191 / p.184) lets a
 * character spend a resource *before an ability resolves* to modify that one
 * ability. This seam is the textual inverse of the core save window: the
 * player names a narrow source-backed choice (`traitId` + `spend`), and the
 * registered ICON source rule derives every consequence. The client must not
 * be able to request effects directly (e.g. "+1 boon"), only "use this trait's
 * option, spend N".
 *
 * This module contains no source IDs of its own. Content (content/jobs/
 * ability-use-choice-recipes.ts) registers the closed table: each trait's
 * resource, the allowed spends, and — per spend — the ordinary engine
 * modifiers (attack boons, bonus damage, pierce, forced trigger names) that
 * the fold feeds back into the resolution. Structure mirrors
 * `attack-modifier-recipes.ts` → `kernels/attack-modifiers.ts`, except this
 * fold also emits the recorded resource-spend mutations.
 */

import { AbilityUseChoiceViolation } from '../primitives/ability-use-choices.js';
import type { RuleMutation } from '../primitives/types.js';
import type { AbilityUseChoiceSource } from '../primitives/ability-use-choices.js';

/** Registered per-trait ability-use choice recipe (content-owned). */
export interface AbilityUseChoiceRecipe {
  traitId: string;
  name: string;
  /** The resource the user spends (e.g. `blessing`). */
  resourceId: string;
  /** Allowed spends and the modifiers each confers. */
  options: ReadonlyArray<{
    spend: number;
    boons?: number;
    bonusDamage?: number;
    pierce?: boolean;
    /** Forced trigger names added before trigger effects resolve. */
    triggers?: readonly string[];
  }>;
  /** Which actors owning the trait may grant the option (self / allies). */
  grant: 'self' | 'allies' | 'self-and-allies';
}

const recipes = new Map<string, AbilityUseChoiceRecipe>();

/** Register an ability-use choice recipe (content/jobs/ability-use-choice-recipes.ts). */
export function registerAbilityUseChoiceRecipe(recipe: AbilityUseChoiceRecipe): void {
  recipes.set(recipe.traitId, recipe);
}

export interface ResolvedAbilityUseChoices {
  /** The evaluated optional costs to aggregate at the command boundary. */
  costs: RuleMutation[];
  /** Ordinary engine modifiers to feed into this one resolution. */
  boons: number;
  bonusDamage: number;
  pierce: boolean;
  /** Forced trigger names (e.g. `exceed`, `slay`) added before triggers resolve. */
  triggers: Set<string>;
}

/**
 * Resolve a set of pre-resolution ability-use choices for a resolving actor.
 *
 * Permission is source-backed: the fold only honors a choice when a living,
 * allied (or self) owner of the granted trait is present. Enemy traits never
 * grant the option, and a client-supplied trait id is never trusted on its
 * own. The actor *using* the ability pays the resource, not the trait owner.
 *
 * The `source` projection provides the durable side/trait/resource reads the
 * fold needs; keep it slim and source-ID-free.
 */
export function resolveAbilityUseChoices(
  source: AbilityUseChoiceSource,
  choices: ReadonlyArray<{ traitId: string; spend: number }> | undefined,
): ResolvedAbilityUseChoices {
  const costs: RuleMutation[] = [];
  let boons = 0;
  let bonusDamage = 0;
  let pierce = false;
  const triggers = new Set<string>();

  for (const choice of choices ?? []) {
    const recipe = recipes.get(choice.traitId);
    if (!recipe) throw new AbilityUseChoiceViolation('unknown', `${choice.traitId} has no registered ability-use choice.`);
    // Find an eligible owner of the trait (self or an allied, living,
    // on-battlefield actor). Enemy owners never grant.
    let eligibleOwner = false;
    if (source.self.traitIds.includes(recipe.traitId)) {
      eligibleOwner = recipe.grant === 'self' || recipe.grant === 'self-and-allies';
    } else {
      for (const owner of source.allies) {
        if (owner.side === source.self.side && !owner.defeated && owner.onBattlefield && owner.traitIds.includes(recipe.traitId)) {
          eligibleOwner = recipe.grant === 'allies' || recipe.grant === 'self-and-allies';
          if (eligibleOwner) break;
        }
      }
    }
    if (!eligibleOwner) throw new AbilityUseChoiceViolation('no-owner', `no eligible allied owner of ${choice.traitId}.`);

    const option = recipe.options.find(({ spend }) => spend === choice.spend);
    if (!option) throw new AbilityUseChoiceViolation('invalid-spend', `${recipe.traitId} does not allow spending ${choice.spend}.`);

    // Affordability is validated only by the command-level aggregate cost
    // transaction. This fold is deliberately limited to ownership, option
    // shape, and modifier derivation; it cannot become a second payment
    // authority for direct callers.
    costs.push({ kind: 'resource', sourceId: recipe.traitId, actorId: source.self.id, resourceId: recipe.resourceId, operation: 'spend', amount: choice.spend, minimum: 0, maximum: null });

    boons += option.boons ?? 0;
    bonusDamage += option.bonusDamage ?? 0;
    pierce = pierce || Boolean(option.pierce);
    for (const trigger of option.triggers ?? []) triggers.add(trigger);
  }

  return { costs, boons, bonusDamage, pierce, triggers };
}
