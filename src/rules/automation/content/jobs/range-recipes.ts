import { registerRangeModifierRule } from '../../kernels/range.js';
import { registerCompoundTalentCompleteness, registerPreUseTalentAugmentation, registerRangeModifierTalent } from '../../kernels/talent-recipes.js';

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

// ICON p.128 Demon Slayer Draken Cross talent 2: "Charge: Increase range to
// 5, and all areas may be increased to medium blasts instead." The range half
// is a charge-gated override: the attack target may legally be chosen at
// range 5 ONLY on a slow turn (the ICON Charge triggered effect — Charge and
// Heroic are distinct, and the Talent clause says "Charge:"), so a Heroic
// without Charge keeps the base range 3. The shared `charge` gate reads the
// durable slow-turn flag projected by the range kernel, so this is
// authoritative target legality at both command gates, never UI-only. The
// medium-blast half is the program-level talent variant in the Draken Cross
// program (both areas become the exact MEDIUM template — center + 8
// surrounding squares — on the same charge-gated read).
registerRangeModifierRule({
  sourceId: 'demon-slayer:draken-cross:talent:2',
  abilityId: 'demon-slayer:draken-cross',
  mode: 'override',
  value: 5,
  talent: 2,
  gate: { kind: 'charge' },
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
// and increase all ranges by +1." "All ranges" is a scoped range rule: the
// attack Range 2 becomes 3, AND the source-declared internal ranges — the
// terrain-effect soul-space selector and the Slay plant placement, both
// "range 3 of your foe" — become 4. The resolver queries the SAME authority
// by scope key (harvester-programs.ts), so the Comeback gate lives here
// once. The bonus-damage half is the bonus-damage rule in
// bonus-damage-recipes.ts; the compound completeness manifest below requires
// BOTH the full scope set and the bonus-damage rule before the talent audits
// complete.
registerRangeModifierRule({
  sourceId: 'harvester:dark-sliver:talent:1',
  abilityId: 'harvester:dark-sliver',
  mode: 'add',
  value: 1,
  talent: 1,
  gate: { kind: 'comeback' },
  scopes: ['attack', 'terrain-placement', 'slay-placement'],
});

// ICON p.187 Harvester Dark Sliver talent 2: "Sacrifice 2: Ability gains
// range 6." The range half is a sacrifice-gated override folded at both
// command gates by the shared range kernel (the `choice` gate reads the
// VALIDATED augmentation set, never raw input); the sacrifice half is the
// pre-use augmentation below, which binds the whole talent: parent ability,
// required equipped rank, the declared-choice opt-in, and the pre-resolution
// Sacrifice-2 cost paid through the cost-payment authority before any effect
// or RNG.
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
// ICON p.187 + Combat Glossary Sacrifice (p.103): "Sacrifice costs are paid
// at the start of an ability, cannot be reduced, ignored, transferred, or
// resisted, cannot bring your hp below 1, and you can pay them even if you
// don\'t have enough hp left." The augmentation row is the COMPLETE-semantics
// authority: both command surfaces resolve the declared choice through
// `resolvePreUseTalentAugmentations` (equipped rank 2 on
// `harvester:dark-sliver` required) and feed the SAME validated set into the
// range kernel's choice gate, so Range 6 and Sacrifice 2 always travel
// together — a declared choice for another ability, or without the talent
// equipped, is ignored entirely.
registerPreUseTalentAugmentation({
  sourceId: 'harvester:dark-sliver:talent:2',
  abilityId: 'harvester:dark-sliver',
  talent: 2,
  requiresChoice: true,
  costs: [{ kind: 'sacrifice', amount: 2 }],
  mechanic: 'Sacrifice 2 HP: Dark Sliver gains range 6. The sacrifice is paid at the start of the ability through the cost-payment authority; the range override is gated on the same validated choice.',
});

// ── Compound talent completeness manifests ──────────────────────────────────
// A range recipe may mark a source unit complete by itself only when the
// reviewed unit's COMPLETE semantics are exclusively that range change.
// Compound talents register an explicit composite manifest (kernels/
// talent-recipes.ts) naming EVERY required semantic component; the compiler
// audits the unit complete only when each component is genuinely wired, and
// the audit fails if any one is removed.
//
// ICON p.185 Dark Sliver talent 1: "Comeback: Deal bonus damage, and increase
// all ranges by +1." Complete semantics = the comeback-gated range rule
// covering ALL THREE scopes (attack + the two internal placement ranges) AND
// the comeback bonus-damage rule.
registerCompoundTalentCompleteness('harvester:dark-sliver:talent:1', [
  { kind: 'range-modifier', scopes: ['attack', 'terrain-placement', 'slay-placement'] },
  { kind: 'bonus-damage' },
]);

// ICON p.187 Dark Sliver talent 2: "Sacrifice 2: Ability gains range 6."
// Complete semantics = BOTH the validated Range-6 modifier (choice-gated
// through the range kernel) AND the pre-use Sacrifice-2 augmentation.
registerCompoundTalentCompleteness('harvester:dark-sliver:talent:2', [
  { kind: 'range-modifier' },
  { kind: 'pre-use-augmentation' },
]);
