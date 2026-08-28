/**
 * Action-cost override content rows (F8a, docs/rules-foundations.md §K-P7).
 *
 * ICON 1.5 mastery source units whose ONLY semantic component is "at round 4+,
 * ability X becomes a free action." Each row registers a CostModifierRule into
 * the cost-payment kernel (kernels/cost-payment.ts), which is the single
 * reusable authority consulted by both USE_ABILITY and EXECUTE_RULE before any
 * target validation or RNG.
 *
 * These 3 units are the pure action-cost-override subset of the original
 * 10-unit "action-type-change" census family. The remaining 7 units have
 * compound semantics (end-turn suppression, vigor grant, aura override, power
 * die, first-use gate, auto-refresh, dash increase, or granted free actions)
 * and are reclassified with their actual multi-component blocker sets.
 */
import { registerCostModifierRule } from '../../kernels/cost-payment.js';
import type { CostPaymentContext } from '../../kernels/cost-payment.js';
import type { RuleCost } from '../../primitives/types.js';

// ── Mastery rows: "At round 4+, ability X becomes a free action" ──────────

/** The 3 pure action-cost-override ability IDs. */
const ACTION_COST_OVERRIDE_ABILITIES: ReadonlySet<string> = new Set([
  'bastion:valiant',
  'shade:shadow-play',
  'seer:polaris',
]);

/**
 * Mastery ability IDs for each ability. The actor must have the ability
 * equipped AND mastered for the override to apply.
 */
const MASTERY_OWNERS: Readonly<Record<string, string>> = {
  'bastion:valiant': 'bastion:valiant:mastery',
  'shade:shadow-play': 'shade:shadow-play:mastery',
  'seer:polaris': 'seer:polaris:mastery',
};

// ICON p.122 Bastion Valiant mastery: "At round 4 or higher in combat, valiant
// becomes a free action."
// ICON p.163 Shade Shadow Play mastery: "At round 4 or later in combat,
// Shadow Play becomes a free action."
// ICON p.202 Seer Polaris mastery: "At round 4+, Polaris becomes a free action."
registerCostModifierRule({
  sourceId: 'action-cost-override:mastery:round-4',
  applies(context: CostPaymentContext): boolean {
    const abilityId = context.sourceId;
    if (!ACTION_COST_OVERRIDE_ABILITIES.has(abilityId)) return false;
    if (context.round < 4) return false;
    // Actor must have the ability equipped and mastered.
    if (!context.actor.abilityIds.includes(abilityId)) return false;
    const masteryId = MASTERY_OWNERS[abilityId];
    if (!masteryId) return false;
    return context.actor.masteredAbilityIds.includes(abilityId);
  },
  modify(costs: readonly RuleCost[], _context: CostPaymentContext): RuleCost[] {
    // Replace every action cost with free. There should be exactly one.
    return costs.map((cost) =>
      cost.kind === 'action' ? { ...cost, kind: 'free' as const } : cost,
    );
  },
});
