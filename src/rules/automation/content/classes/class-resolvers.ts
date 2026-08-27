import { RuleProgramViolation } from '../../kernels/runtime.js';
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
    const source = context.state.actors[context.actorId];
    if (!source) return [];
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
    // that non-attack target through the generic range/line-of-sight gate.
    if (!context.attackTargetId) throw new RuleProgramViolation('choice.actor-count', 'Diaga requires one character in range 4.');
    const target = context.state.actors[context.attackTargetId];
    if (!target) throw new RuleProgramViolation('selector.actor-missing', 'Diaga target does not exist.');
    return resolveCureMutations(context, target);
  },
  'mendicant:trait:bless': (context) => {
    // ICON p.172 says "a character in range 4."  The direct rule target is
    // therefore required; do not let an unrelated input selector retarget the
    // Blessing after the command layer has range-checked attackTargetId.
    if (!context.attackTargetId) throw new RuleProgramViolation('choice.actor-count', 'Bless requires one character in range 4.');
    const inputTargets = context.input.actorIds?.target;
    if (inputTargets && (inputTargets.length !== 1 || inputTargets[0] !== context.attackTargetId)) {
      throw new RuleProgramViolation('choice.actor-mismatch', 'Bless input target must match its range-checked rule target.');
    }
    const target = context.state.actors[context.attackTargetId];
    if (!target) throw new RuleProgramViolation('selector.actor-missing', 'Bless target does not exist.');
    return [{ kind: 'resource', sourceId: context.sourceId, actorId: target.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }];
  },
  'mendicant:trait:succor': passiveState,
  'wright:trait:slip': applyCondition('slip'),
  'wright:trait:aetherwall': applyCondition('aetherwall'),
  'wright:trait:chain-reaction': passiveState,
  'wright:trait:aether': passiveState,
};
