import { registerForcedCombatTrigger } from '../../kernels/forced-triggers.js';

/**
 * Source-forced once-per-combat trigger rows (trigger provenance, ICON p.95):
 * source clauses that force a trigger effect WITHOUT its ordinary natural
 * condition, once per combat. The kernel (kernels/forced-triggers.ts) owns
 * the availability/consume; this table names the source units.
 */

// ICON p.194 Sealer Open The Gates: "This attack gains +1 boon, cannot miss
// (turn any miss into a hit) and triggers any exceed effects the first time
// it is used in combat." — the first use in combat forces the ability's
// exceed effect (the shove/teleport hops) regardless of the roll. This is
// NOT a threshold read: later uses keep the ordinary natural 15+ exceed.
registerForcedCombatTrigger({ sourceId: 'sealer:open-the-gates', trigger: 'exceed' });