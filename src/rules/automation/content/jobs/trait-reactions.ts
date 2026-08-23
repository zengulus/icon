/**
 * Wired job-trait reaction rows (the once-per-round reactive seam).
 *
 * A job trait whose reaction folds into an ability's post-application
 * mutation stream registers here through the shared
 * `kernels/trait-reactions.ts` fold. Rows declare the trigger (`collide` /
 * `shove` / `slay`), an optional once-per-round gate, and a deterministic
 * `build` that emits typed mutations for the firing actor. The source is
 * exact; mechanics must never leak source IDs into the kernel.
 */
import { computeSpatialArea } from '../../primitives/spatial-intent.js';
import { registerTraitReaction, type TraitReactionMutation } from '../../kernels/trait-reactions.js';

// stormbender/dash-on-the-rocks — p.230
registerTraitReaction('stormbender:trait:dash-on-the-rocks', {
  mechanic:
    '1/round when you cause a character to collide, gain 1 aether and deal 1 piercing damage as a burst-1 area effect centered on that collided character (the burst never affects the ability user, ICON p.97). The once-per-round gate is a durable round ledger cleared at the round-start boundary; the burst is computed through the shared computeSpatialArea authority.',
  reaction: {
    trigger: 'collide',
    gate: 'once-per-round',
    build(actorId, triggerTargetIds, context): TraitReactionMutation[] {
      const { state } = context;
      const out: TraitReactionMutation[] = [];
      out.push({ kind: 'resource', actorId, resourceId: 'aether', operation: 'gain', amount: 1, minimum: 0, maximum: null });
      for (const collidedId of triggerTargetIds) {
        const collided = state.actors[collidedId];
        if (!collided || !collided.onBattlefield || collided.defeated || !collided.position) continue;
        const area = computeSpatialArea(state, {
          kind: 'area',
          sourceActorId: actorId,
          sourceRuleId: 'stormbender:trait:dash-on-the-rocks',
          shape: 'burst',
          center: collided.position,
          radius: 1,
          requireCenterInBounds: true,
        });
        if (!area.legal) continue;
        for (const targetId of area.includedActorIds) {
          // ICON p.97 Burst does not affect the ability user unless specified.
          if (targetId === actorId) continue;
          out.push({ kind: 'damage', sourceActorId: actorId, actorId: targetId, amount: 1, damageType: 'piercing', instance: 1, delivery: 'area', ignoreCover: false });
        }
      }
      return out;
    },
  },
});
