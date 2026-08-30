import type { EncounterState } from '../../types.js';
import type { Fact, RuleMutation } from '../primitives/types.js';
import { recordFacts, deriveResolutionFactProjection, factInstanceId } from '../primitives/facts.js';
import { collidingShoveTargets, reactiveSlayTargets, resolveMutationOutcomes } from './encounter-adapter.js';

/** Facts produced by the current ability resolution. The projection fields
 * remain byte-compatible with the long-standing surface encounter.ts
 * consumes; the `facts` list is the typed U10 history they [[recordFacts]]
 * is projected FROM and the event carries for durable replay. */
export interface ResolutionTriggerFacts {
  triggers: Set<string>;
  attackTargets: string[];
  collidedActorIds: string[];
  slainActorIds: string[];
  /** The typed U10 fact history this resolution produced (the durable fact
   * authority). The `RULE_MUTATIONS_APPLIED` event carries this list so
   * replay consumes the recorded outcome identity — never re-derives it. */
  facts: Fact[];
  /** The durable, replay-stable resolution identity this fact history was
   * recorded under (owned by the command/event boundary). */
  resolutionId: string;
}

export function resolutionFactsFromRecorded(
  facts: { triggers: readonly string[]; attackTargets: readonly string[]; collidedActorIds: readonly string[]; slainActorIds: readonly string[] },
): ResolutionTriggerFacts {
  return {
    triggers: new Set(facts.triggers),
    attackTargets: [...facts.attackTargets],
    collidedActorIds: [...facts.collidedActorIds],
    slainActorIds: [...facts.slainActorIds],
    facts: [],
    resolutionId: '',
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
 * turns that into typed facts with U9 provenance, ID-scoped by resolution. */
function collideFacts(resolutionId: string, sourceId: string, ownerId: string, collidedActorIds: string[]): Fact[] {
  return collidedActorIds.map((shovedActorId, offset) => ({
    kind: 'collide',
    instanceId: factInstanceId(resolutionId, 'collide', offset),
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
function slayFacts(resolutionId: string, sourceId: string, ownerId: string, slainActorIds: string[]): Fact[] {
  return slainActorIds.map((defeatedId, offset) => ({
    kind: 'actor-defeated',
    instanceId: factInstanceId(resolutionId, 'actor-defeated', offset),
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
 * then project the reactive trigger surface (U10 as the authority). `facts`
 * are ID-scoped by the durable `resolutionId` (owned by the command/event
 * boundary) so two separate uses of the same ability never collide, and a
 * replayed event reproduces the identical fact history. Damage facts record
 * the DETERMINED (post-mitigation) amount from the damage authority, never a
 * raw proposal. Effect facts carry the canonical LIVE instance id the reducer
 * will create/remove (`effectInstanceId` — the mutation's command-boundary
 * stamp). This fold never rolls or interprets source ids; it records the
 * single boundary decisions ({@link resolveMutationOutcomes} stamps the
 * determined damage outcome and the effect instance identity onto the
 * mutations, and the reducer consumes exactly those records); {collide, slay}
 * facts come from the encounter domain authorities (spatial + defeat) and are
 * merged before projecting the byte-compatible surface.
 */
export function deriveResolutionTriggers(
  state: EncounterState,
  mutations: readonly RuleMutation[],
  initial: ReadonlySet<string> = new Set(),
  resolutionId = '',
  actionId = '',
): ResolutionTriggerFacts {
  const { sourceId, ownerId } = resolveContextOf(mutations);
  // The command/window boundary's single determination pass: damages are
  // determined ONCE against the sequentially-simulated pre-event state (the
  // reducer applies the recorded outcome, never a second determination), and
  // effect operations get their canonical LIVE instance id stamped (so a
  // recorded fact and the reducer's instance are the SAME id). Damage facts
  // record the DETERMINED (post-mitigation) amount; fully-prevented and
  // no-op (target already defeated/immunized by an earlier mutation) damage
  // emits no `damage-applied` fact.
  const resolvedDamage = resolveMutationOutcomes(state, mutations);
  const facts = recordFacts(mutations, {
    ownerId: ownerId === '' ? undefined : ownerId,
    actionId: actionId === '' ? undefined : actionId,
    resolutionId,
    resolvedDamage,
  });
  // `ability-used`: the resolution's initiating ability/action use, recorded
  // at the ability/action resolution boundary only when the mutation audit
  // authorities confirm an action genuinely resolved here (mutations present
  // for an ability source). Emitted under the resolution identity so two uses
  // of the same ability never collide. No/unknown action records none (no
  // false use), keeping the member honest.
  if (sourceId !== '' && mutations.length > 0 && ownerId !== '' && actionId !== '') {
    facts.unshift({
      kind: 'ability-used',
      instanceId: factInstanceId(resolutionId, 'ability-used', 0),
      sourceId,
      ownerId,
      actionId,
    });
  }
  // Domain collide/slay facts (spatial + defeat authority live in the kernel).
  const collidedActorIds = collidingShoveTargets(state, mutations);
  const slainActorIds = reactiveSlayTargets(state, [...mutations]);
  const allFacts = [
    ...facts,
    ...collideFacts(resolutionId, sourceId, ownerId, collidedActorIds),
    ...slayFacts(resolutionId, sourceId, ownerId, slainActorIds),
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
    resolutionId,
  };
}