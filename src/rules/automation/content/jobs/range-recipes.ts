import { registerRangeModifierRule } from '../../kernels/range.js';
import { registerRangeModifierTalent, registerSacrificeCostTalent } from '../../kernels/talent-recipes.js';

/**
 * Range-modifier content rows (docs/rules-foundations.md §Range).
 *
 * Every row here is an audited LISTED-RANGE change on its parent ability: the
 * rule feeds the shared `kernels/range.ts` effective-range authority, which
 * both command gates (USE_ABILITY and EXECUTE_RULE) read before accepting a
 * target — so the change is authoritative target validation, never UI-only.
 * Distance-predicate effects (exact-range boons, outside-range resistance)
 * are NOT range-modifier rows; they live in the attack-modifier and damage
 * projections. The kernel never branches on a source ID: `sourceId` is
 * provenance, `abilityId` selects the parent.
 */

// ICON p.136 Colossus Valkyrie talent 1: "Valkyrie gains range 4." Valkyrie is
// a melee attack (no listed range) — the override widens the attack's target
// legality to range 4.
registerRangeModifierRule({
  sourceId: 'colossus:valkyrie:talent:1',
  abilityId: 'colossus:valkyrie',
  mode: 'override',
  value: 4,
  talent: 1,
});
registerRangeModifierTalent(
  'colossus:valkyrie:talent:1',
  'Valkyrie\'s listed range becomes 4 through the shared effective-range authority, so its attack target may be chosen at range 4.',
);

// ICON p.164 Shade Incubus talent 1: "Incubus gains range 3. If you make it
// from stealth, gains range 5." The stealth gate reads the user's current
// stealth condition at command time — losing stealth shrinks the range back.
registerRangeModifierRule({
  sourceId: 'shade:incubus:talent:1',
  abilityId: 'shade:incubus',
  mode: 'override',
  value: 3,
  talent: 1,
});
registerRangeModifierRule({
  sourceId: 'shade:incubus:talent:1',
  abilityId: 'shade:incubus',
  mode: 'override',
  value: 5,
  talent: 1,
  gate: { kind: 'stealth' },
});
registerRangeModifierTalent(
  'shade:incubus:talent:1',
  'Incubus\'s listed range becomes 3 (5 from stealth) through the shared effective-range authority, evaluated against the user\'s current stealth condition.',
);

// ICON p.185 Harvester Harvest talent 2: "Gains Range 2. Comeback: Range 5."
// Harvest is an Arc 6 area attack; the range is where the arc begins (p.97).
// Under Comeback (user bloodied) the arc begins at range 5 instead.
registerRangeModifierRule({
  sourceId: 'harvester:harvest:talent:2',
  abilityId: 'harvester:harvest',
  mode: 'override',
  value: 2,
  talent: 2,
});
registerRangeModifierRule({
  sourceId: 'harvester:harvest:talent:2',
  abilityId: 'harvester:harvest',
  mode: 'override',
  value: 5,
  talent: 2,
  gate: { kind: 'comeback' },
});
registerRangeModifierTalent(
  'harvester:harvest:talent:2',
  'Harvest\'s listed range becomes 2 (5 while the user is bloodied) through the shared effective-range authority, evaluated from current HP.',
);

// ICON p.194 Sealer Open the Gates talent 2: "Both versions of this ability
// gains a range equal to the round number." A dynamic range: the effective
// range re-reads the current round at every command, so round 3 allows range 3
// and round 5 allows range 5 with no stored state.
registerRangeModifierRule({
  sourceId: 'sealer:open-the-gates:talent:2',
  abilityId: 'sealer:open-the-gates',
  mode: 'override',
  value: 'round',
  talent: 2,
});
registerRangeModifierTalent(
  'sealer:open-the-gates:talent:2',
  'Open the Gates\'s listed range equals the round number through the shared effective-range authority (both the base and CENTER THE TEMPLE versions).',
);

// ICON p.162 Shade Umbra mastery: "Increase Umbra and Penumbra's range to 6
// and it gains unerring." The range half is wired here (both actions); the
// mastery stays unresolved in the census for its unerring half, which needs a
// per-ability attack-provenance seam — the mastery recipe is NOT registered,
// so the unit never audits complete with only half its semantics.
registerRangeModifierRule({
  sourceId: 'shade:umbra:mastery',
  abilityId: 'shade:umbra',
  mode: 'override',
  value: 6,
  gate: { kind: 'mastery', abilityId: 'shade:umbra' },
});

// ICON p.143 Knave Strongarm talent 1: "Comeback: this ability gains range 2."
// A melee hold with no listed range (base 1 = adjacency); under Comeback
// (user bloodied) the hold's target may be chosen at range 2. The rest of the
// talent — "Remove your target and place them into adjacency before
// activating this effect" — is a program-level remove/place reposition in the
// Strongarm program (program-level talent row), so this rule is the range
// authority only and the talent is NOT allowlisted as a range-modifier row.
registerRangeModifierRule({
  sourceId: 'knave:strongarm:talent:1',
  abilityId: 'knave:strongarm',
  mode: 'override',
  value: 2,
  talent: 1,
  gate: { kind: 'comeback' },
});

// ICON p.185 Harvester Dark Sliver talent 1: "Comeback: Deal bonus damage,
// and increase all ranges by +1." Dark Sliver lists Range 2; under Comeback
// (user bloodied) the attack target may be chosen at range 3. The bonus-
// damage half of the talent is the bonus-damage rule in
// bonus-damage-recipes.ts, so this rule is the range authority only and the
// talent is NOT allowlisted as a range-modifier row (program-level bonus-
// damage row instead).
registerRangeModifierRule({
  sourceId: 'harvester:dark-sliver:talent:1',
  abilityId: 'harvester:dark-sliver',
  mode: 'override',
  value: 3,
  talent: 1,
  gate: { kind: 'comeback' },
});

// ICON p.187 Harvester Dark Sliver talent 2: "Sacrifice 2: Ability gains
// range 6." A sacrifice-gated range override: the player declares the
// talent choice at command time (talentChoices input), and the range kernel
// evaluates the choice gate against the selected source ID. The sacrifice
// cost itself is a resource-management concern outside the range kernel.
registerRangeModifierRule({
  sourceId: 'harvester:dark-sliver:talent:2',
  abilityId: 'harvester:dark-sliver',
  mode: 'override',
  value: 6,
  talent: 2,
  gate: { kind: 'choice', sourceId: 'harvester:dark-sliver:talent:2' },
});
registerRangeModifierTalent(
  'harvester:dark-sliver:talent:2',
  'Dark Sliver\'s listed range becomes 6 through the shared effective-range authority when the player declares the sacrifice talent choice at command time.',
);
// ICON p.187 Sacrifice rule (p.190): "The HP cost is paid at the start of
// the ability." When the player declares the sacrifice talent choice, the
// sacrifice-2 HP cost is validated and paid through the cost-payment
// authority BEFORE the ability resolves, alongside the ability's own costs.
registerSacrificeCostTalent(
  'harvester:dark-sliver:talent:2', 2,
  'Sacrifice 2 HP: Dark Sliver gains range 6. The sacrifice is paid at the start of the ability through the cost-payment authority.',
);
