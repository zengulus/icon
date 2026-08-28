/**
 * Action-type/action-cost fold kernel (docs/rules-foundations.md §K-P7).
 *
 * ICON 1.5 source units with action-type-change semantics modify the effective
 * action cost of a parent ability (e.g. "At round 4 or later, Valiant becomes
 * a free action"). The fold is the single reusable authority that answers:
 *
 *   - what is the effective action cost for this ability on this actor right now?
 *   - should the action-cost gate pass despite the ability's nominal cost?
 *
 * Content registers reviewed `ActionTypeModifier` rows (content/jobs/
 * action-type-recipes.ts): each row declares the parent ability, a predicate
 * against current encounter state + actor, and the effective cost when the
 * predicate holds. This module contains no source IDs of its own; `sourceId`
 * is provenance and registry key only.
 *
 * A modifier fires ONLY when:
 *   - the actor has the parent ability equipped (in abilityIds),
 *   - the actor has mastered it (in masteredAbilityIds) for mastery rows,
 *     or has the talent equipped (in talents) for talent rows,
 *   - the registered predicate is satisfied.
 *
 * Multiple modifiers for the same ability compose: the first matching modifier
 * wins (deterministic registration order). If no modifier matches, the base
 * cost is returned unchanged.
 */

import type { EncounterActor, EncounterState } from '../../types.js';

// ---------------------------------------------------------------------------
// Modifier registry
// ---------------------------------------------------------------------------

export interface ActionTypeModifier {
  /** Exact source ID of the mastery/talent that declares the change. */
  sourceId: string;
  /** The parent ability whose effective action cost is modified. */
  abilityId: string;
  /**
   * Whether this modifier requires the parent ability to be mastered
   * (true for mastery rows) or merely have the talent equipped (false
   * for talent rows). The fold checks masteredAbilityIds/abilities accordingly.
   */
  requiresMastery: boolean;
  /**
   * For talent rows only: the talent source ID to check in actor.talents.
   * Ignored when requiresMastery is true.
   */
  talentSourceId?: string;
  /** A deterministic predicate against current encounter state + actor. */
  predicate: (state: EncounterState, actor: EncounterActor) => boolean;
  /** The effective action cost when the predicate holds. */
  effectiveCost: { kind: 'action' | 'free'; value: number };
}

const modifiers: ActionTypeModifier[] = [];

/** Register a reviewed action-type modifier (content/jobs/action-type-recipes.ts). */
export function registerActionTypeModifier(modifier: ActionTypeModifier): void {
  modifiers.push(modifier);
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Whether the actor meets the equipment gate for this modifier.
 * Mastery rows require masteredAbilityIds; talent rows require the talent
 * to be equipped (talents[abilityId] >= required rank).
 */
function meetsEquipmentGate(mod: ActionTypeModifier, actor: EncounterActor): boolean {
  if (!actor.abilityIds.includes(mod.abilityId)) return false;
  if (mod.requiresMastery) return actor.masteredAbilityIds.includes(mod.abilityId);
  // Talent rows: the talent source ID must be equipped (talents[sourceId] >= 1).
  if (mod.talentSourceId) return (actor.talents[mod.talentSourceId] ?? 0) >= 1;
  // Fallback: ability equipped is sufficient.
  return true;
}

/**
 * The effective action cost for `abilityId` on `actor` in `state`, after
 * applying every registered action-type modifier. If the actor lacks the
 * ability or no modifier matches, the base cost is returned unchanged.
 *
 * This is consulted by:
 * - the USE_ABILITY command gate (before target validation / RNG)
 * - the EXECUTE_RULE command gate (before program cost validation)
 *
 * Both surfaces must use the SAME validated result to guarantee replay
 * compatibility: the effective cost that the gate permits is the cost the
 * recorded event carries.
 */
export function effectiveAbilityActionCost(
  state: EncounterState,
  actor: EncounterActor,
  abilityId: string,
  baseCost: { kind: 'action' | 'free'; value: number },
): { kind: 'action' | 'free'; value: number } {
  if (baseCost.kind === 'free') return baseCost;
  for (const mod of modifiers) {
    if (mod.abilityId !== abilityId) continue;
    if (!meetsEquipmentGate(mod, actor)) continue;
    if (mod.predicate(state, actor)) return mod.effectiveCost;
  }
  return baseCost;
}
