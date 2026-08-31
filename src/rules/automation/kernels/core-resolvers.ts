import { CORE_RULES } from '../../core.js';
import { resolveOrdinaryAttackMutations } from './ordinary-attack.js';
import { resolveCureMutations } from '../primitives/status-saves.js';
import type { RuleResolver, RuleResolverRegistry } from '../primitives/types.js';
import { resolveActorSelectorReference } from '../primitives/reference.js';

const referencedActor = (
  context: Parameters<RuleResolver>[0],
  selector: { kind: 'self' } | { kind: 'attack-target' } | { kind: 'input'; key: string },
) => {
  const resolution = resolveActorSelectorReference(selector, context);
  if (!resolution.ok) return undefined;
  if (resolution.value.kind === 'actor') return resolution.value.actor;
  const first = resolution.value.kind === 'collection' ? resolution.value.items[0] : undefined;
  return first?.kind === 'actor' ? first.actor : undefined;
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
  const source = referencedActor(context, { kind: 'self' });
  const target = referencedActor(context, { kind: 'input', key: 'target' })
    ?? referencedActor(context, { kind: 'attack-target' });
  if (!source || !target) return [];
  return resolveOrdinaryAttackMutations(context, source, target, weight === 'heavy' ? 2 : 1, {
    boons: Math.trunc(context.input.numbers?.boons ?? 0),
  }, Math.max(0, source.resources['bonus-damage'] ?? 0)).mutations;
};

const coreResolvers: Record<string, RuleResolver> = {
  'core:standard-move': movementResolver('rush', (context) => referencedActor(context, { kind: 'self' })?.speed ?? 0, 'path'),
  'core:dash': movementResolver('rush', (context) => Math.ceil((referencedActor(context, { kind: 'self' })?.speed ?? 0) / 2), 'path'),
  'core:interact': (context) => [{ kind: 'state', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: context.actorId, key: 'last-interaction', operation: 'set', value: context.input.options?.description ?? 'Interact' }],
  'core:rescue': (context) => {
    const target = referencedActor(context, { kind: 'input', key: 'target' });
    if (!target) return [];
    return [{ kind: 'state', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id, key: 'rescue-requested', operation: 'set', value: true }, { kind: 'heal', sourceId: context.sourceId, actorId: target.id, amount: target.maxHp, maximum: target.maxHp }];
  },
  'core:light-attack': basicAttack('light'),
  'core:heavy-attack': basicAttack('heavy'),
  'core:recover': (context) => {
    const source = referencedActor(context, { kind: 'self' });
    if (!source) return [];
    return resolveCureMutations(context, source);
  },
};

const passiveResolver: RuleResolver = (context) => [{ kind: 'state', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: context.actorId, key: `core-rule:${context.sourceId}`, operation: 'set', value: true }];
for (const rule of CORE_RULES) coreResolvers[`core:${rule.id}`] ??= passiveResolver;

export const CORE_RULE_RESOLVERS: RuleResolverRegistry = coreResolvers;

export function hasCoreRuleResolver(id: string) {
  return Boolean(CORE_RULE_RESOLVERS[id]);
}
