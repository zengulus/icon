import { registerAbilityUseChoiceRecipe } from '../../kernels/ability-use-choices.js';

/**
 * F10 ability-use choice content (docs/rules-foundations.md §8).
 *
 * The Blessing-of-War / Blessing-of-Rebirth traits register their closed
 * ability-use choice tables here. The kernels (`kernels/ability-use-choices.ts`)
 * stay source-ID-free; they only see `traitId` as an opaque key into this
 * table. Every consequence (resource spend, boon, bonus damage, pierce,
 * forced trigger) is derived from the source rule, never from the client.
 */

// ICON p.183 Harvester Blessing of Rebirth: "Yourself and allies can spend 1
// blessing when using any ability to grant it pierce and bonus damage. They
// may spend 3 blessings instead to additionally trigger any slay effects."
registerAbilityUseChoiceRecipe({
  traitId: 'harvester:trait:blessing-of-rebirth',
  name: 'Blessing of Rebirth',
  resourceId: 'blessing',
  grant: 'self-and-allies',
  options: [
    { spend: 1, pierce: true, bonusDamage: 1 },
    { spend: 3, pierce: true, bonusDamage: 1, triggers: ['slay'] },
  ],
});

// ICON p.191 Sealer Blessing of War: "Yourself or allies can spend a blessing
// when they use an ability to gain +1 boon on attacks and bonus damage with
// that ability. If they consume 3 blessings, it additionally triggers all
// exceed effects."
registerAbilityUseChoiceRecipe({
  traitId: 'sealer:trait:blessing-of-war',
  name: 'Blessing of War',
  resourceId: 'blessing',
  grant: 'self-and-allies',
  options: [
    { spend: 1, boons: 1, bonusDamage: 1 },
    { spend: 3, boons: 1, bonusDamage: 1, triggers: ['exceed'] },
  ],
});
