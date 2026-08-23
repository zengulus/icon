import { registerFoeRoleBaselineRecipes } from '../../kernels/passive-projection.js';
import { registerArmorBonusSource } from '../../kernels/encounter-adapter.js';
import type { FoeRoleId, EncounterActor, EncounterState } from '../../../types.js';

/**
 * Foe role baselines (ICON p.298, foe glossary).  A role becomes an encounter
 * condition only through a reviewed row here — never by parsing `traitsText`
 * prose. The rows project only the *condition* half of each baseline; the
 * non-condition halves stay with their dedicated mechanics:
 *
 * - Skirmisher: "Moves diagonally, dashes at full speed, and has Dodge" — the
 *   diagonal movement and full-speed dash are movement-planning recipes in
 *   `movement.ts`; the durable `dodge` condition (p.104: missed attacks and
 *   area effects deal no damage) is projected here.
 * - Heavy: "Guard grants Rampart and reduces damage to self and orthogonally
 *   adjacent allies by 2 as armor" — the `rampart` condition half is
 *   projected here (consumed by `rampartSourcesAt`), and the armor-2
 *   reduction registers here as an armor-bonus source into the damage
 *   kernel (`guardArmorBonus` fold in the adapter).
 * - Artillery: "Slip ignores Rampart, interrupts, and Vigilance. Aetherwall
 *   resists abilities from outside range 2" — both the `slip` and
 *   `aetherwall` conditions are projected here.
 * - Leader: Diaga is an active ability, not a passive condition.
 * - Legend: Juggernaut clears a status or mark at the start of a round — a
 *   lifecycle behavior handled at the round boundary, not a condition.
 * - Mob: member-count bookkeeping, not a condition.
 */
export const FOE_ROLE_BASELINE_RECIPES: Readonly<Record<FoeRoleId, readonly string[]>> = {
  mob: [],
  heavy: ['rampart'],
  skirmisher: ['dodge'],
  leader: [],
  artillery: ['slip', 'aetherwall'],
  legend: [],
  special: [],
};

registerFoeRoleBaselineRecipes(FOE_ROLE_BASELINE_RECIPES);

/** ICON p.298 Heavy Guard: reduces damage to self and orthogonally adjacent
 * allies by 2 as armor. The heavy's own role is the source; the bonus applies
 * to the heavy and to any living ally sharing an edge with it (Manhattan
 * distance 1). Projected through the damage kernel so command-time previews
 * and replay derive the same reduced amount. */
registerArmorBonusSource({
  sourceId: 'role:heavy',
  bonus: (state: EncounterState, target: EncounterActor): number => {
    if (target.defeated || !target.onBattlefield || !target.position) return 0;
    const guarded = (candidate: EncounterActor) => candidate.roleId === 'heavy' && !candidate.defeated && candidate.onBattlefield && candidate.position
      && (candidate.id === target.id || (candidate.side === target.side
        && Math.abs(candidate.position.x - target.position.x) + Math.abs(candidate.position.y - target.position.y) === 1));
    return Object.values(state.actors).some(guarded) ? 2 : 0;
  },
});
