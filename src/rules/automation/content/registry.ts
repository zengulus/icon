/**
 * Content registry root.
 *
 * Every content module is imported here for its registration side effects:
 * each module calls the kernel registration APIs (e.g.
 * `registerLifecycleRecipe`, `registerCharacterTraitConditionRecipes`) at
 * module scope, so importing this module populates every kernel registry
 * before any command runs. Production entry points (encounter.ts,
 * movement.ts, catalog.ts, foes.ts) and the automation barrel import this
 * module; tests that exercise registered content import it too.
 *
 * Dependency rule: content → kernels → primitives, one direction. Nothing
 * under `content/` may be imported by `kernels/` or `primitives/`.
 */

import './classes/trait-condition-recipes.js';
import './jobs/trait-condition-recipes.js';
import './jobs/lifecycle-recipes.js';
import './jobs/attack-modifier-recipes.js';
import './jobs/talent-recipes.js';
import './jobs/trait-reactions.js';
import './jobs/summon-recipes.js';
import './jobs/encounter-hooks.js';
import './jobs/aura-recipes.js';
import './jobs/mastery-recipes.js';
import './jobs/hp-threshold-recipes.js';
import './jobs/range-recipes.js';
import './jobs/area-recipes.js';
import './foes/role-baseline-recipes.js';
import './foes/mark-recipes.js';
import './foes/ability-recipes.js';
import './foes/trait-recipes.js';
import './foes/aura-recipes.js';
import './foes/hp-threshold-recipes.js';

// F6 combat-start rows: registered here (not inside job-trait-recipes.ts, so
// the lifecycle kernel never participates in the encounter-adapter/manual-
// programs/job-trait-recipes cycle).
import { COMBAT_START_TRAIT_RECIPES } from './jobs/job-trait-recipes.js';
import { registerCombatStartTraitRecipe } from '../kernels/lifecycle.js';
for (const [traitId, recipe] of Object.entries(COMBAT_START_TRAIT_RECIPES)) {
  registerCombatStartTraitRecipe(traitId, recipe);
}

// Interrupt allowlists (reviewed interrupt sources by trigger): the adapter
// kernel consumes these but must not import content, so they register here
// through the kernel's registry API (dependency rule: content → kernels).
import {
  AREA_INCLUSION_INTERRUPT_IDS,
  DEFEATED_INTERRUPT_IDS,
  SAVE_REROLL_INTERRUPT_IDS,
  TARGETED_BY_ABILITY_INTERRUPT_IDS,
  USES_ABILITY_INTERRUPT_IDS,
  WHEN_DAMAGED_INTERRUPT_IDS,
} from './glue/manual-programs.js';
import { registerInterruptAllowlist } from '../kernels/encounter-adapter.js';
registerInterruptAllowlist('when-damaged', WHEN_DAMAGED_INTERRUPT_IDS);
registerInterruptAllowlist('defeated', DEFEATED_INTERRUPT_IDS);
registerInterruptAllowlist('uses-ability', USES_ABILITY_INTERRUPT_IDS);
registerInterruptAllowlist('area-inclusion', AREA_INCLUSION_INTERRUPT_IDS);
registerInterruptAllowlist('targeted-by-ability', TARGETED_BY_ABILITY_INTERRUPT_IDS);
registerInterruptAllowlist('save-reroll', SAVE_REROLL_INTERRUPT_IDS);
