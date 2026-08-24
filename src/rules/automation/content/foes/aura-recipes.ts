import { registerAuraDefinition } from '../../kernels/aura.js';

/**
 * Reviewed foe aura traits (content/foes).
 *
 * Each row registers one source aura into the generic Aura kernel: how the
 * aura's origin is found in current state, its radius, which relations count
 * as members, and the ephemeral conditions/modifiers membership projects.
 * The kernel derives membership continuously from positions — nothing here
 * grants a durable condition, so leaving the aura removes the projection
 * immediately. The row doubles as the trait's audit compilation
 * (`compileAuraFoeTraitRecipe`, kernels/aura.ts), so the exact source unit
 * becomes executable through the generic engine.
 */

// ICON p.304 Commander: "Commander's Aura: Aura 2. Allies in the aura have
// +1 boon on attacks." The Commander is never its own ally, so the origin is
// excluded by construction (includesOrigin: false).
registerAuraDefinition({
  sourceId: 'basic:commander:304:trait:commander-s-aura',
  origin: { kind: 'actor-trait', traitId: 'basic:commander:304:trait:commander-s-aura' },
  radius: 2,
  relations: ['allies'],
  includesOrigin: false,
  attackModifiers: { boons: 1 },
});

// ICON p.304 Abjurer: "Aura of Shielding: Aura 1. The abjurer and allies in
// the area have dodge." The origin itself is included, so the Abjurer gains
// Dodge from its own aura.
registerAuraDefinition({
  sourceId: 'basic:abjurer:304:trait:aura-of-shielding',
  origin: { kind: 'actor-trait', traitId: 'basic:abjurer:304:trait:aura-of-shielding' },
  radius: 1,
  relations: ['allies'],
  includesOrigin: true,
  conditions: ['dodge'],
});
