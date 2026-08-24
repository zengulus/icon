import type { EncounterState } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';
import { collidingShoveTargets, reactiveSlayTargets } from './encounter-adapter.js';

/** Facts produced by the current ability resolution. */
export interface ResolutionTriggerFacts {
  triggers: Set<string>;
  attackTargets: string[];
  collidedActorIds: string[];
  slainActorIds: string[];
}

export function resolutionFactsFromRecorded(
  facts: { triggers: readonly string[]; attackTargets: readonly string[]; collidedActorIds: readonly string[]; slainActorIds: readonly string[] },
): ResolutionTriggerFacts {
  return {
    triggers: new Set(facts.triggers),
    attackTargets: [...facts.attackTargets],
    collidedActorIds: [...facts.collidedActorIds],
    slainActorIds: [...facts.slainActorIds],
  };
}

/**
 * Derive trigger facts from already-resolved mutations and attack records.
 * This fold never rolls, mutates, or interprets source ids. Collision and
 * defeat remain delegated to the encounter authorities, while attack-result
 * facts are read from the authoritative attack mutation.
 */
export function deriveResolutionTriggers(
  state: EncounterState,
  mutations: readonly RuleMutation[],
  initial: ReadonlySet<string> = new Set(),
): ResolutionTriggerFacts {
  const triggers = new Set(initial);
  const attackTargets: string[] = [];
  for (const mutation of mutations) {
    if (mutation.kind !== 'attack') continue;
    attackTargets.push(mutation.targetId);
    triggers.add(mutation.hit ? 'hit' : 'miss');
    if (mutation.critical) triggers.add('critical-hit');
    if (mutation.exceed === true) triggers.add('exceed');
  }
  const collidedActorIds = collidingShoveTargets(state, mutations);
  if (collidedActorIds.length > 0) triggers.add('collide');
  const slainActorIds = reactiveSlayTargets(state, [...mutations]);
  if (slainActorIds.length > 0) triggers.add('slay');
  return { triggers, attackTargets, collidedActorIds, slainActorIds };
}
