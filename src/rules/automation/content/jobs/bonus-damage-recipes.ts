/**
 * Bonus-damage grant rows (F6a, docs/rules-foundations.md §8).
 *
 * ICON p.102: "Bonus damage means roll one more die than normal, then pick
 * the highest." Each row below declares, for one exact source unit, that the
 * parent ability's damage roll carries bonus dice under the source's gate.
 * The fold (kernels/bonus-damage.ts) evaluates the rows at the USE_ABILITY
 * boundary and the dice ride the ability's recorded damage roll — the same
 * keep-highest semantics as the shared `damage-roll` authority, so no row
 * re-implements a roll.
 *
 * The rows are registered for audit in content/jobs/talent-recipes.ts
 * (registerBonusDamageTalent), which is what makes each unit's compilation
 * complete; the source fixtures and replay tests live in the per-job test
 * files.
 */
import { registerBonusDamageRule } from '../../kernels/bonus-damage.js';

// ICON p.139 Knave Low Blow talent 1: "Deals bonus damage if your foe is
// suffering from a status." Any status on the attack target qualifies.
registerBonusDamageRule({
  sourceId: 'knave:low-blow:talent:1',
  abilityId: 'knave:low-blow',
  talent: 1,
  gate: { kind: 'target-has-condition' },
  dice: 1,
});

// ICON p.225 Spellblade Nothung talent 1: "When used against a bloodied foe,
// Nothung deals bonus damage, and deals 1 piercing damage again to its target
// on hit." The bonus die is this row; the extra 1-piercing instance is a
// separate on-hit effect the Nothung resolver emits under the same source
// condition (a distinct damage instance, not a die).
registerBonusDamageRule({
  sourceId: 'spellblade:nothung:talent:1',
  abilityId: 'spellblade:nothung',
  talent: 1,
  gate: { kind: 'target-bloodied' },
  dice: 1,
});

// ICON p.164 Shade Incubus talent 2: "Incubus deals bonus damage for every
// ally of your target adjacent to your target." Scaled: one bonus die per
// living character allied with the target (the target's own side) adjacent to
// it — the clustering condition the mark's area damage also keys on.
registerBonusDamageRule({
  sourceId: 'shade:incubus:talent:2',
  abilityId: 'shade:incubus',
  talent: 2,
  gate: { kind: 'always' },
  dice: ({ state, targetIds }) => {
    const target = state.actors[targetIds[0]];
    if (!target?.position) return 0;
    return Object.values(state.actors).filter((candidate) =>
      candidate.id !== target.id
      && !candidate.defeated
      && candidate.position
      && candidate.side === target.side
      && Math.max(Math.abs(candidate.position.x - target.position!.x), Math.abs(candidate.position.y - target.position!.y)) <= 1,
    ).length;
  },
});

// ICON p.185 Harvester Dark Sliver talent 1: "Comeback: Deal bonus damage,
// and increase all ranges by +1." The range half is the comeback-gated range
// rule in range-recipes.ts (range 2 → 3); the bonus die is the same Comeback
// (user bloodied) gate folded here.
registerBonusDamageRule({
  sourceId: 'harvester:dark-sliver:talent:1',
  abilityId: 'harvester:dark-sliver',
  talent: 1,
  gate: { kind: 'self-bloodied' },
  dice: 1,
});
