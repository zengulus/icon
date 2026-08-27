/**
 * Mark-modifier rows (F5, docs/rules-foundations.md §9).
 *
 * A mark modifier is a reviewed row that changes what an existing mark DOES
 * at one of the engine's mark query points — the projected condition set
 * (carrier-aware, with potency), the status-save policy, or a turn-boundary
 * lifecycle trigger — never a parallel mark subsystem. The rows below are
 * registered for audit in content/jobs/talent-recipes.ts
 * (registerMarkModifierTalent); the source fixtures and replay tests live in
 * the per-job test files. This module contains only the mark-query rows
 * whose home is not a dedicated kernel file (the rot talent-2 trigger row
 * lives in lifecycle-recipes.ts with the other lifecycle recipes).
 */
import { registerMarkConditionProjection } from '../../kernels/passive-projection.js';
import { registerStatusSavePolicySource } from '../../kernels/encounter-adapter.js';
import { isBloodied } from '../../kernels/hp-threshold.js';

// ICON p.192 Sealer Grand Seal talent 1: "Bloodied foes gain +1 curse on
// saves while marked." A mark-keyed status-save policy row: a foe carrying a
// Grand Seal mark from a sealer who chose talent 1 saves with +1 curse while
// bloodied. The bloodied read is live (a foe that becomes bloodied later
// gains the curse), and the owner's talent is read from the durable actor
// record, never snapshotted onto the mark.
registerStatusSavePolicySource({
  sourceId: 'sealer:grand-seal:talent:1',
  modify: (state, actor, policy) => {
    if (actor.defeated || !actor.onBattlefield || !isBloodied(actor)) return;
    const markedByTalentOne = actor.marks.some((mark) =>
      mark.markId === 'grand-seal'
      && mark.sourceId === 'sealer:grand-seal'
      && state.actors[mark.ownerId]?.talents?.['sealer:grand-seal'] === 1);
    if (!markedByTalentOne) return;
    policy.saveCurse += 1;
  },
});

// ICON p.192 Sealer Grand Seal talent 2: "Bloodied foes are also pacified+
// while marked." A carrier-aware mark-condition projection: the marked foe
// gains pacified (potency plus — the "+" ongoing potency the source names)
// while it is bloodied and the sealer chose talent 2. The projection is
// ephemeral: the durable marks array stays the record, so healing the foe
// above bloodied immediately drops the pacified grant.
registerMarkConditionProjection({
  sourceId: 'sealer:grand-seal',
  markId: 'grand-seal',
  matches: (mark, carrier, state) => {
    if (!carrier || !state || carrier.defeated || !carrier.onBattlefield) return false;
    if (!isBloodied(carrier)) return false;
    return state.actors[mark.ownerId]?.talents?.['sealer:grand-seal'] === 2;
  },
  grants: ['pacified'],
  grantPotencies: { pacified: 'plus' },
});
