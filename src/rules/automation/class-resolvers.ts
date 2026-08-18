import type { RuleMutation, RuleResolver, RuleResolverRegistry } from './types.js';

const targetActor = (context: Parameters<RuleResolver>[0]) => {
  const id = context.input.actorIds?.target?.[0] ?? context.attackTargetId;
  return id ? context.state.actors[id] : undefined;
};

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

const passiveState: RuleResolver = (context) => [{ kind: 'state', sourceId: context.sourceId, actorId: context.actorId, key: `trait:${context.sourceId}`, operation: 'set', value: true }];

export const CLASS_RULE_RESOLVERS: RuleResolverRegistry = {
  'stalwart:trait:armor-2': passiveState,
  'stalwart:trait:fortify': passiveState,
  'vagabond:trait:skirmisher': applyCondition('skirmisher'),
  'vagabond:trait:dodge': applyCondition('dodge'),
  'vagabond:trait:prowl': (context) => {
    const source = context.state.actors[context.actorId];
    if (!source) return [];
    const foesInRange = Object.values(context.state.actors).some((target) => target.side !== source.side && target.position && source.position && Math.max(Math.abs(target.position.x - source.position.x), Math.abs(target.position.y - source.position.y)) <= 2);
    const mutations: RuleMutation[] = [{ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: source.id, conditionId: 'stealth', operation: 'apply', potency: 'normal' }];
    if (!foesInRange) mutations.unshift({ kind: 'actions', sourceId: context.sourceId, actorId: source.id, operation: 'refund', amount: 1 });
    return mutations;
  },
  'vagabond:trait:finesse': applyCondition('finesse'),
  'mendicant:trait:diaga': (context) => {
    const target = targetActor(context);
    if (!target) return [];
    const mutations: RuleMutation[] = [{ kind: 'vigor', sourceId: context.sourceId, actorId: target.id, amount: target.hp <= target.maxHp / 2 ? target.vitality : 4, uncapped: false }];
    for (const conditionId of target.conditions) {
      if (!['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable'].includes(conditionId)) continue;
      const roll = context.dice.die(20);
      const success = roll >= 10;
      mutations.push({ kind: 'save', sourceId: context.sourceId, actorId: target.id, roll, boon: 0, total: roll, success });
      if (success) mutations.push({ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, conditionId, operation: 'remove', potency: 'normal' });
    }
    return mutations;
  },
  'mendicant:trait:bless': (context) => {
    const target = targetActor(context);
    return target ? [{ kind: 'resource', sourceId: context.sourceId, actorId: target.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }] : [];
  },
  'mendicant:trait:succor': passiveState,
  'wright:trait:slip': applyCondition('slip'),
  'wright:trait:aetherwall': applyCondition('aetherwall'),
  'wright:trait:chain-reaction': passiveState,
  'wright:trait:aether': passiveState,
};
