import type { EncounterState } from '../../types.js';
import type { Fact, RuleMutation } from '../primitives/types.js';
import { recordFacts, deriveResolutionFactProjection, factInstanceId } from '../primitives/facts.js';
import { collidingShoveTargets, reactiveSlayTargets } from './encounter-adapter.js';

/** Facts produced by the current ability resolution. The projection fields
 * remain byte-compatible with the long-standing surface encounter.ts
 * consumes; the `facts` list is the typed U10 history they [[recordFacts]]
 * is projected FROM. */
export interface ResolutionTriggerFacts {
  triggers: Set<string>;
  attackTargets: string[];
  collidedActorIds: string[];
  slainActorIds: string[];
  /** The typed U10 fact history this resolution produced (the newly-landed
   * authority). Encounter.ts need not read it to keep behavior; U16/U6 and
   * future U12/U13 consumers read facts through this list. */
  facts?: Fact[];
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

/** The resolution's causal context (source + initiating owner) derived from
 * the resolved mutation list — the owner is the mutation's own initiating
 * actor (U9), so reflected/secondary outcomes keep the originating identity. */
function resolveContextOf(
  mutations: readonly RuleMutation[],
): { sourceId: string; ownerId: string } {
  const first = mutations[0];
  if (!first) return { sourceId: '', ownerId: '' };
  let ownerId = '';
  if ('ownerId' in first && typeof first.ownerId === 'string' && first.ownerId) ownerId = first.ownerId;
  else if ('sourceActorId' in first && typeof first.sourceActorId === 'string' && first.sourceActorId) ownerId = first.sourceActorId;
  else if ('actorId' in first && typeof first.actorId === 'string' && first.actorId) ownerId = first.actorId;
  return { sourceId: first.sourceId, ownerId };
}

/** The collide facts (ICON p.102/103): a shove as part of THIS ability shoved
 * an actor into an obstruction. The domain spatial authority
 * (`collidingShoveTargets`) decides WHICH actors collided; this kernel only
 * turns that into typed facts with U9 provenance. */
function collideFacts(sourceId: string, ownerId: string, collidedActorIds: string[]): Fact[] {
  return collidedActorIds.map((shovedActorId, offset) => ({
    kind: 'collide',
    instanceId: factInstanceId(sourceId, 'collide', offset),
    sourceId,
    ownerId,
    shovedActorId,
    provenance: {
      sourceId,
      ...(ownerId !== '' ? { sourceActorId: ownerId } : {}),
      delivery: 'direct',
      movementMode: 'shove',
    },
  }));
}

/** The slay facts (ICON p.95 glossary): THIS ability reduced an actor to 0.
 * The defeat authority (`reactiveSlayTargets`) decides WHO was slain; this
 * kernel turns that into typed facts with U9 provenance. */
function slayFacts(sourceId: string, ownerId: string, slainActorIds: string[]): Fact[] {
  return slainActorIds.map((defeatedId, offset) => ({
    kind: 'actor-defeated',
    instanceId: factInstanceId(sourceId, 'actor-defeated', offset),
    sourceId,
    ownerId,
    defeatedId,
    // A SLAY (this ability's damage reduced the character to 0, p.95) — the
    // `slay` trigger projection resolves only on this flag, never on an
    // explicit instant-defeat mutation.
    viaSlay: true,
    provenance: {
      sourceId,
      ...(ownerId !== '' ? { sourceActorId: ownerId } : {}),
      delivery: 'effect',
    },
  }));
}

/**
 * Derive the fact history from already-resolved mutations and attack records,
 * then project the reactive trigger surface (U10 as the authority). This
 * fold never rolls, mutates, or interprets source ids: per-mutation facts
 * come from `recordFacts` (primitives/facts.ts), {collide, slay} facts come
 * from the encounter domain authorities (spatial + defeat), and the
 * `ResolutionTriggerFacts` projection is derived FROM the typed fact history
 * — so facts are the single authority, behavior-preserving for the surface
 * encounter.ts consumes.
 */
export function deriveResolutionTriggers(
  state: EncounterState,
  mutations: readonly RuleMutation[],
  initial: ReadonlySet<string> = new Set(),
): ResolutionTriggerFacts {
  const { sourceId, ownerId } = resolveContextOf(mutations);
  // Per-mutation facts (attack/damage/effect/movement/entity/terrain/save).
  const facts = recordFacts(mutations, { ownerId: ownerId === '' ? undefined : ownerId });
  // Domain collide/slay facts (spatial + defeat authority live in the kernel).
  const collidedActorIds = collidingShoveTargets(state, mutations);
  const slainActorIds = reactiveSlayTargets(state, [...mutations]);
  const allFacts = [
    ...facts,
    ...collideFacts(sourceId, ownerId, collidedActorIds),
    ...slayFacts(sourceId, ownerId, slainActorIds),
  ];
  // Project the byte-compatible reactive-trigger surface from the typed facts.
  // The caller's known-trigger set (from the continuation state) is layered in
  // exactly as before — it is the pre-existing durable trigger history.
  const projection = deriveResolutionFactProjection(allFacts);
  for (const trigger of initial) projection.triggers.add(trigger);
  return {
    triggers: projection.triggers,
    attackTargets: projection.attackTargets,
    collidedActorIds: projection.collidedActorIds,
    slainActorIds: projection.slainActorIds,
    facts: allFacts,
  };
}