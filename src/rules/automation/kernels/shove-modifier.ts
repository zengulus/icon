/**
 * Shove-modifier fold kernel (docs/rules-foundations.md §K-P7).
 *
 * ICON 1.5 source units with shove-modifier semantics modify the effective
 * properties of a shove (distance, direction) or add shove effects triggered
 * by ability resolution. The fold is the single reusable authority that
 * answers:
 *
 *   - what is the effective shove distance for this mutation?
 *   - what is the effective shove direction?
 *
 * Content registers reviewed `ShoveModifierRule` rows; the kernel folds
 * them in registration order at the shove-resolution pipeline boundary.
 * This module contains no source IDs of its own; `sourceId` is provenance
 * and registry key only.
 *
 * A modifier fires ONLY when:
 *   - the actor has the ability equipped,
 *   - the actor has the talent equipped (for talent rows),
 *     or has mastered the ability (for mastery rows),
 *   - the registered predicate is satisfied.
 *
 * Multiple modifiers for the same ability compose: the first matching
 * modifier wins (deterministic registration order). If no modifier matches,
 * the base shove is returned unchanged.
 */
import type { EncounterActor, EncounterState, Position } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';

// ---------------------------------------------------------------------------
// Modifier registry
// ---------------------------------------------------------------------------

export interface ShoveModifierRule {
  /** Exact source ID of the talent/mastery that declares the change. */
  sourceId: string;
  /** The parent ability whose shoves are modified. */
  abilityId: string;
  /** Whether this modifier requires mastery (true) or talent (false). */
  requiresMastery: boolean;
  /** For talent rows: the talent source ID to check in actor.talents. */
  talentSourceId?: string;
  /** A deterministic predicate against current encounter state + actor. */
  predicate: (state: EncounterState, actor: EncounterActor) => boolean;
  /** Modify the shove mutation. Return a new mutation; never mutate the input. */
  modify(mutation: RuleMutation, state: EncounterState, actor: EncounterActor): RuleMutation;
}

const modifiers: ShoveModifierRule[] = [];

/** Register a reviewed shove modifier rule (content/jobs/shove-modifier-recipes.ts). */
export function registerShoveModifierRule(rule: ShoveModifierRule): void {
  modifiers.push(rule);
}

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

/**
 * Whether the actor meets the equipment gate for this modifier.
 */
function meetsEquipmentGate(mod: ShoveModifierRule, actor: EncounterActor): boolean {
  if (!actor.abilityIds.includes(mod.abilityId)) return false;
  if (mod.requiresMastery) return actor.masteredAbilityIds.includes(mod.abilityId);
  if (mod.talentSourceId) return (actor.talents[mod.talentSourceId] ?? 0) >= 1;
  return true;
}

/**
 * Apply every registered shove modifier that applies, in registration order.
 * Returns the effective shove mutation. If no modifier matches, the input
 * is returned unchanged.
 *
 * Called from the encounter-adapter's shove-resolution pipeline, before
 * `shoveResolution` processes the mutation.
 */
export function effectiveShoveMutation(
  mutation: RuleMutation,
  state: EncounterState,
): RuleMutation {
  if (mutation.kind !== 'move' || mutation.movement !== 'shove') return mutation;
  // The modifier's talent/mastery is on the SOURCE actor (the one shoving),
  // not the target actor being shoved.
  const sourceActor = mutation.sourceActorId ? state.actors[mutation.sourceActorId] : undefined;
  if (!sourceActor) return mutation;
  let current: RuleMutation = mutation;
  for (const mod of modifiers) {
    if (mod.abilityId !== mutation.sourceId) continue;
    if (!meetsEquipmentGate(mod, sourceActor)) continue;
    if (!mod.predicate(state, sourceActor)) continue;
    current = mod.modify(current, state, sourceActor);
  }
  return current;
}
