/**
 * Shove-modifier content rows (F8b, docs/rules-foundations.md §K-P7).
 *
 * ICON 1.5 source units with shove-modifier semantics modify shove
 * properties (distance, direction) or add shove effects. This file registers
 * reviewed `ShoveModifierRule` rows into the kernel (kernels/shove-modifier.ts).
 *
 * Decomposition of the 10 pure shove-modifier singletons:
 *
 * **Distance modifiers (fold-applicable):**
 * - demon-slayer:demon-claw:talent:2 — shove distance 1→2 after second rush
 *
 * **Direction modifiers (resolver-level, NOT fold-applicable):**
 * The player's direction choice is command-time input, not encounter state.
 * Folds must be deterministic from state alone; direction selection belongs
 * in the resolver where context.input is available. These 5 units need
 * resolver wiring, not a fold:
 * - bastion:heracule:talent:1 — shoves in any direction
 * - bastion:great-giorgios:talent:2 — allies shoved in any direction
 * - demon-slayer:righteous-disdain:talent:2 — shove in any direction
 * - warden:circle-the-oak:mastery — enemies shoved 1
 * - enochian:soul-burn:talent:2 — foes shoved 1
 *
 * **New shove effects (resolver-level):**
 * These add shove as a new effect, not modify an existing shove:
 * - bastion:limit-break — shoves all characters
 * - bastion:land-waster:talent:1 — conditional +1 shove + stun
 * - bastion:catapult:talent:2 — foe trigger becomes shove 1
 * - bastion:great-giorgios:talent:1 — foes shoved after rush
 */
import { registerShoveModifierRule } from '../../kernels/shove-modifier.js';

// ── Distance modifiers ────────────────────────────────────────────────────

// ICON p.107 Demon Claw talent 2: "After the second rush, you can shove an
// adjacent character 2 spaces." The base shove is distance 1; the talent
// increases it to 2.
registerShoveModifierRule({
  sourceId: 'demon-slayer:demon-claw:talent:2',
  abilityId: 'demon-slayer:demon-claw',
  requiresMastery: false,
  talentSourceId: 'demon-slayer:demon-claw:talent:2',
  predicate: () => true,
  modify(mutation) {
    return { ...mutation, distance: 2 };
  },
});
