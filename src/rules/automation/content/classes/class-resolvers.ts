import { RuleProgramViolation } from '../../kernels/runtime.js';
import { resolveAttackTarget, resolveSourceActor } from '../glue/reference-authoring.js';
import { resolveCureMutations } from '../../primitives/status-saves.js';
import type { RuleMutation, RuleResolver, RuleResolverRegistry } from '../../primitives/types.js';

const applyCondition = (conditionId: string): RuleResolver => (context) => [{
  kind: 'condition',
  sourceId: context.sourceId,
  sourceActorId: context.actorId,
  actorId: context.actorId,
  conditionId,
  operation: 'apply',
  potency: 'plus',
  duration: { kind: 'combat' },
}];

const passiveState: RuleResolver = (context) => [{ kind: 'state', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: context.actorId, key: `trait:${context.sourceId}`, operation: 'set', value: true }];

export const CLASS_RULE_RESOLVERS: RuleResolverRegistry = {
  'stalwart:trait:armor-2': passiveState,
  'stalwart:trait:fortify': passiveState,
  'vagabond:trait:skirmisher': applyCondition('skirmisher'),
  'vagabond:trait:dodge': applyCondition('dodge'),
  'vagabond:trait:prowl': (context) => {
    // The source-actor reference resolves through the U1 content-authoring
    // adapter (the legacy `if (!source) return []` guard was the off-actor
    // hole that simply skipped Stealth; fail-closed resolution is strictly
    // stricter — a nameless source is malformed command input).
    const source = resolveSourceActor(context);
    // ICON p.116: Prowl costs one action unless no *living* foe is within
    // range 2. Defeated and off-board actors cannot make the activation cost.
    const foesInRange = Object.values(context.state.actors).some((target) => !target.defeated
      && target.side !== source.side
      && target.position
      && source.position
      && Math.max(Math.abs(target.position.x - source.position.x), Math.abs(target.position.y - source.position.y)) <= 2);
    const mutations: RuleMutation[] = [{ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: source.id, conditionId: 'stealth', operation: 'apply', potency: 'normal' }];
    // This must be a conditional spend, not a spend followed by a refund:
    // the free-action branch remains legal when the actor has no actions left.
    if (foesInRange) mutations.unshift({ kind: 'actions', sourceId: context.sourceId, actorId: source.id, operation: 'spend', amount: 1 });
    return mutations;
  },
  // Finesse has no resolver: it is a recipient-scoped bonus-damage rule
  // (content/jobs/bonus-damage-recipes.ts) read at the damage-roll query
  // point against the actual damage recipient.
  'mendicant:trait:diaga': (context) => {
    // Diaga targets a character in range 4.  Requiring attackTargetId routes
    // that non-attack target through the generic range/line-of-sight gate
    // (caller-owned validation); the target reference itself resolves through
    // the U1 content-authoring adapter (fail closed on a missing actor).
    if (!context.attackTargetId) throw new RuleProgramViolation('choice.actor-count', 'Diaga requires one character in range 4.');
    // The caller-owned gate above guarantees the slot; the adapter still
    // fail-closes (reference.missing-actor) if a nameless actor vanished.
    const target = resolveAttackTarget(context)!;
    return resolveCureMutations(context, target);
  },
  'mendicant:trait:bless': (context) => {
    // ICON p.172 says "a character in range 4."  The direct rule target is
    // therefore required; do not let an unrelated input selector retarget the
    // Blessing after the command layer has range-checked attackTargetId.
    if (!context.attackTargetId) throw new RuleProgramViolation('choice.actor-count', 'Bless requires one character in range 4.');
    // U4 choice-identity validation (ID compare, never dereferenced here).
    const inputTargets = context.input.actorIds?.target;
    if (inputTargets && (inputTargets.length !== 1 || inputTargets[0] !== context.attackTargetId)) {
      throw new RuleProgramViolation('choice.actor-mismatch', 'Bless input target must match its range-checked rule target.');
    }
    // The caller-owned gate above guarantees the slot; the adapter still
    // fail-closes (reference.missing-actor) if a nameless actor vanished.
    const target = resolveAttackTarget(context)!;
    return [{ kind: 'resource', sourceId: context.sourceId, actorId: target.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }];
  },
  'mendicant:trait:succor': passiveState,
  'wright:trait:slip': applyCondition('slip'),
  'wright:trait:aetherwall': applyCondition('aetherwall'),
  'wright:trait:chain-reaction': passiveState,
  'wright:trait:aether': passiveState,
};
