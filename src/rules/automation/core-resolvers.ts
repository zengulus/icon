import { CORE_RULES } from '../core.js';
import { rollBoonOrCurse } from '../dice.js';
import type { RuleMutation, RuleResolver, RuleResolverRegistry } from './types.js';

const statusIds = new Set(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);

const actorInput = (context: Parameters<RuleResolver>[0], key: string) => {
  const id = context.input.actorIds?.[key]?.[0];
  return id ? context.state.actors[id] : undefined;
};

const movementResolver = (kind: 'rush' | 'shove', distance: (context: Parameters<RuleResolver>[0]) => number, positionInput: string): RuleResolver => (context) => [{
  kind: 'move',
  sourceId: context.sourceId,
  sourceActorId: context.actorId,
  actorId: context.actorId,
  movement: kind,
  distance: distance(context),
  positions: [...(context.input.positions?.[positionInput] ?? [])],
  direction: context.input.directions?.direction ?? null,
  phasing: false,
}];

const basicAttack = (weight: 'light' | 'heavy'): RuleResolver => (context) => {
  const source = context.state.actors[context.actorId];
  const target = actorInput(context, 'target') ?? (context.attackTargetId ? context.state.actors[context.attackTargetId] : undefined);
  if (!source || !target) return [];
  const d20 = context.dice.die(20);
  const boon = rollBoonOrCurse(Math.trunc(context.input.numbers?.boons ?? 0) - (source.conditions.has('dazed') ? 1 : 0), context.dice).modifier;
  const total = d20 + boon;
  const hit = total >= target.defense;
  const critical = hit && total >= 20;
  const diceCount = hit ? (weight === 'heavy' ? 2 : 1) + (critical ? 1 : 0) : 0;
  const damage = Array.from({ length: diceCount }, () => context.dice.die(source.damageDie)).reduce((sum, roll) => sum + roll, source.fray);
  return [{ kind: 'attack', sourceId: context.sourceId, actorId: source.id, targetId: target.id, d20, boon, total, hit, critical, evasionRoll: null, trueStrike: false, autoHit: false }, {
    kind: 'damage', sourceId: context.sourceId, sourceActorId: source.id, actorId: target.id, amount: damage, damageType: 'normal', instance: 1, delivery: hit ? 'hit' : 'miss', ignoreCover: false,
  }];
};

const coreResolvers: Record<string, RuleResolver> = {
  'core:standard-move': movementResolver('rush', (context) => context.state.actors[context.actorId]?.speed ?? 0, 'path'),
  'core:dash': movementResolver('rush', (context) => Math.ceil((context.state.actors[context.actorId]?.speed ?? 0) / 2), 'path'),
  'core:interact': (context) => [{ kind: 'state', sourceId: context.sourceId, actorId: context.actorId, key: 'last-interaction', operation: 'set', value: context.input.options?.description ?? 'Interact' }],
  'core:rescue': (context) => {
    const target = actorInput(context, 'target');
    if (!target) return [];
    return [{ kind: 'state', sourceId: context.sourceId, actorId: target.id, key: 'rescue-requested', operation: 'set', value: true }, { kind: 'heal', sourceId: context.sourceId, actorId: target.id, amount: target.maxHp, maximum: target.maxHp }];
  },
  'core:light-attack': basicAttack('light'),
  'core:heavy-attack': basicAttack('heavy'),
  'core:recover': (context) => {
    const source = context.state.actors[context.actorId];
    if (!source) return [];
    const mutations: RuleMutation[] = [{ kind: 'vigor', sourceId: context.sourceId, actorId: source.id, amount: source.hp <= source.maxHp / 2 ? source.vitality : 4, uncapped: false }];
    for (const conditionId of source.conditions) {
      if (!statusIds.has(conditionId)) continue;
      const roll = context.dice.die(20);
      const success = roll >= 10;
      mutations.push({ kind: 'save', sourceId: context.sourceId, actorId: source.id, roll, boon: 0, total: roll, success });
      if (success) mutations.push({ kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: source.id, conditionId, operation: 'remove', potency: 'normal' });
    }
    return mutations;
  },
};

const passiveResolver: RuleResolver = (context) => [{ kind: 'state', sourceId: context.sourceId, actorId: context.actorId, key: `core-rule:${context.sourceId}`, operation: 'set', value: true }];
for (const rule of CORE_RULES) coreResolvers[`core:${rule.id}`] ??= passiveResolver;

export const CORE_RULE_RESOLVERS: RuleResolverRegistry = coreResolvers;

export function hasCoreRuleResolver(id: string) {
  return Boolean(CORE_RULE_RESOLVERS[id]);
}
