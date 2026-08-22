import { RuleProgramViolation } from './runtime.js';
import type { RuleSourceUnit } from '../source-units.js';
import type { Position } from '../types.js';
import type { RuleMutation, RuleProgramCompilation, RuleResolver, RuleResolverRegistry } from './types.js';
import {
  axisDirection as toward, shoveMutation as shove,
  self, attackTarget, constant, damageDie, fray, normalDamage,
  inputTarget, status, statusOn,
  distance, withinGrid, rushMutation,
  action, compilation,
} from './job-kit.js';

/**
 * Independently reviewed Bastion ability implementations (ICON p.122–124).
 *
 * Every ability below has typed costs, targets, ranges, and tags from the
 * source catalog plus a hand-authored typed RuleProgram. Effects that need
 * geometry or sequencing — multi-target shoves, burst areas, rush chains,
 * stance/interrupt placement — are implemented by the named deterministic
 * resolvers in BASTION_RULE_RESOLVERS rather than approximated in the UI.
 *
 * Fidelity notes that stay visible on the resolved event (the full source
 * text is preserved on every RULE_MUTATIONS_APPLIED event):
 * - The VM resolves an attack roll, hit/miss/critical branches, and damage.
 *   High-ground boons, cover, and elevation are handled by the dedicated
 *   BASIC_ATTACK reducer path, not by this generic VM, so resolver-based
 *   ability attacks do not add an elevation boon.
 * - Aura zones, stance refresh, and delayed end-of-turn effects are stored
 *   as deterministic marks/persistent effects/rule state with explicit
 *   provenance. Great Giorgios's delayed rush is resolved by the encounter
 *   reducer when the marked foe's turn ends.
 * - "Collide or Heroic" and "Heroic" triggers fire only when the caller
 *   asserts the trigger through EXECUTE_RULE; USE_ABILITY resolves the
 *   base ability deterministically without triggered extras.
 */

/** ICON p.122: repeatable single-target control plus a second-foe shove. */
const heraculeEffects: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  const target = context.attackTargetId ? context.state.actors[context.attackTargetId] : undefined;
  if (!source || !target?.position || !source.position) return [];
  const repetitions = context.triggers?.has('collide') || context.triggers?.has('heroic') ? 2 : 1;
  const targetDirection = context.input.directions?.direction ?? toward(source.position, target.position);
  const mutations: RuleMutation[] = [];
  for (let index = 0; index < repetitions; index += 1) {
    mutations.push({ kind: 'condition', sourceId: context.sourceId, sourceActorId: source.id, actorId: target.id, conditionId: 'weakened', operation: 'apply', potency: 'normal' });
    mutations.push(shove(context, target.id, 1, targetDirection));
    const second = Object.values(context.state.actors)
      .filter((candidate) => candidate.side !== source.side && candidate.id !== target.id && candidate.position && distance(candidate.position, target.position!) <= 3)
      .sort((first, second) => first.id.localeCompare(second.id))[0];
    if (second?.position) mutations.push(shove(context, second.id, 1, toward(target.position!, second.position!)));
  }
  return mutations;
};

/** ICON p.122: burst-area fray damage and away-from-target shoves. */
const landWasterArea: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  const target = context.attackTargetId ? context.state.actors[context.attackTargetId] : undefined;
  if (!source || !target?.position || !source.position) return [];
  const burst = context.triggers?.has('heroic') ? 2 : 1;
  const area = Object.values(context.state.actors).filter((candidate) => candidate.id !== source.id && candidate.position && distance(candidate.position, target.position!) <= burst);
  const mutations: RuleMutation[] = [];
  for (const foe of area) {
    if (foe.side !== source.side) {
      mutations.push({ kind: 'damage', sourceId: context.sourceId, sourceActorId: source.id, actorId: foe.id, amount: source.fray, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false });
    }
  }
  for (const foe of area) {
    if (foe.id !== target.id) mutations.push(shove(context, foe.id, 1, toward(target.position!, foe.position!)));
  }
  mutations.push(shove(context, target.id, 1, context.input.directions?.direction ?? toward(source.position, target.position!)));
  return mutations;
};

/** ICON p.122: rush 1 twice (thrice with Collide/Heroic), shoving adjacent characters after each rush. */
const valiantMovement: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  if (!source?.position) return [];
  const rushes = context.triggers?.has('collide') || context.triggers?.has('heroic') ? 3 : 2;
  // Project positions as shoves are planned: rush destinations and shove
  // targets are evaluated against the evolving layout rather than the
  // pre-command snapshot, so a second rush can pass through a space the
  // first shove just vacated and consecutive shoves push from the latest
  // projected position.
  const projected = new Map(Object.values(context.state.actors).map((actor) => [actor.id, actor.position ? { ...actor.position } : null]));
  const projectedOccupied = (position: Position, excludeId: string) =>
    [...projected.entries()].some(([id, candidate]) => id !== excludeId && candidate && candidate.x === position.x && candidate.y === position.y);
  const mutations: RuleMutation[] = [];
  let position = { ...source.position };
  for (let index = 0; index < rushes; index += 1) {
    const direction = context.input.directions?.[`rush${index + 1}`] ?? { x: 1, y: 0 };
    const next = { x: position.x + direction.x, y: position.y + direction.y };
    if (!withinGrid(next, context) || projectedOccupied(next, source.id)) break;
    mutations.push(rushMutation(context, source.id, [next]));
    projected.set(source.id, next);
    position = next;
    for (const adjacent of Object.values(context.state.actors).filter((candidate) => candidate.id !== source.id && candidate.position && distance(candidate.position, position) <= 1)) {
      const targetPosition = projected.get(adjacent.id) ?? adjacent.position;
      if (!targetPosition || distance(targetPosition, position) > 1) continue;
      const pushDirection = toward(position, targetPosition);
      mutations.push(shove(context, adjacent.id, 1, pushDirection));
      projected.set(adjacent.id, { x: targetPosition.x + pushDirection.x, y: targetPosition.y + pushDirection.y });
    }
  }
  return mutations;
};

/** ICON p.122: enter the stance, record the aura ally, and grant that ally aura 1. */
const battlementEnter: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  const allyId = context.input.actorIds?.target?.[0];
  if (!source || !allyId) return [];
  const ally = context.state.actors[allyId];
  if (!ally?.position || !source.position || distance(source.position, ally.position) > 4) {
    throw new RuleProgramViolation('choice.actor-range', 'Endless Battlement requires an ally in range 4.');
  }
  const mutations: RuleMutation[] = [
    { kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'enter', actorId: source.id, stanceId: 'endless-battlement', state: { allyId } },
    { kind: 'state', sourceId: context.sourceId, sourceActorId: source.id, actorId: source.id, key: 'endless-battlement:ally-id', operation: 'set', value: allyId },
    { kind: 'persistent', sourceId: context.sourceId, ownerId: source.id, operation: 'add', actorId: allyId, effectId: 'aura', duration: { kind: 'turn-start', actor: { kind: 'self' }, turns: 1 }, modifiers: [{ stat: 'aura', operation: 'grant', value: constant(1) }], triggers: ['aura-refresh'], state: { sourceId: context.sourceId } },
  ];
  return mutations;
};

/** ICON p.122: stance refresh re-grants aura 1 to the recorded ally. */
const battlementRefresh: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  if (!source) return [];
  const allyId = typeof source.state['endless-battlement:ally-id'] === 'string' ? source.state['endless-battlement:ally-id'] : undefined;
  const mutations: RuleMutation[] = [{ kind: 'stance', sourceId: context.sourceId, sourceActorId: source.id, operation: 'refresh', actorId: source.id, stanceId: 'endless-battlement', state: { allyId: allyId ?? null } }];
  if (allyId) mutations.push({ kind: 'persistent', sourceId: context.sourceId, ownerId: source.id, operation: 'add', actorId: allyId, effectId: 'aura', duration: { kind: 'turn-start', actor: { kind: 'self' }, turns: 1 }, modifiers: [{ stat: 'aura', operation: 'grant', value: constant(1) }], triggers: ['aura-refresh'], state: { sourceId: context.sourceId } });
  return mutations;
};

/** ICON p.122: Heroic Intervention — leave the battlefield, return in the aura, adjacent foes take 2 damage. */
const battlementInterrupt: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  if (!source) return [];
  const mutations: RuleMutation[] = [{
    kind: 'move', sourceId: context.sourceId, sourceActorId: source.id, actorId: source.id, movement: 'remove', distance: null, positions: [], direction: null, phasing: false,
  }];
  const destination = context.input.positions?.['return-position']?.[0];
  if (destination && withinGrid(destination, context)) {
    mutations.push({ kind: 'move', sourceId: context.sourceId, sourceActorId: source.id, actorId: source.id, movement: 'place', distance: null, positions: [destination], direction: null, phasing: false });
    for (const foe of Object.values(context.state.actors).filter((candidate) => candidate.side !== source.side && candidate.position && distance(candidate.position, destination) <= 1)) {
      mutations.push({ kind: 'damage', sourceId: context.sourceId, sourceActorId: source.id, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false });
    }
  }
  return mutations;
};

/** ICON p.123: Perseus — aura 1 (2 with Heroic) and immunity to the triggering ability. */
const perseusEffects: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  if (!source) return [];
  const aura = context.triggers?.has('heroic') ? 2 : 1;
  const mutations: RuleMutation[] = [
    { kind: 'persistent', sourceId: context.sourceId, ownerId: source.id, operation: 'add', actorId: source.id, effectId: 'aura', duration: { kind: 'until', event: 'ability-resolved' }, modifiers: [{ stat: 'aura', operation: 'grant', value: constant(aura) }], triggers: ['included-in-area-effect'], state: {} },
    { kind: 'state', sourceId: context.sourceId, sourceActorId: source.id, actorId: source.id, key: 'damage-immune', operation: 'set', value: true },
  ];
  return mutations;
};

/** ICON p.123: Rook — shove the target and hold an aura until the end of your next turn. */
const rookEffects: RuleResolver = (context) => {
  const source = context.state.actors[context.actorId];
  const target = context.attackTargetId ? context.state.actors[context.attackTargetId] : undefined;
  if (!source?.position) return [];
  const aura = context.triggers?.has('heroic') ? 2 : 1;
  const mutations: RuleMutation[] = [];
  if (target?.position) mutations.push(shove(context, target.id, 1, context.input.directions?.direction ?? toward(source.position, target.position)));
  mutations.push({ kind: 'persistent', sourceId: context.sourceId, ownerId: source.id, operation: 'add', actorId: source.id, effectId: 'aura', duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: 2 }, modifiers: [{ stat: 'aura', operation: 'grant', value: constant(aura) }], triggers: ['turn-end-aura'], state: {} });
  return mutations;
};

export const BASTION_RULE_RESOLVERS: RuleResolverRegistry = {
  'bastion:heracule:effects': heraculeEffects,
  'bastion:land-waster:area': landWasterArea,
  'bastion:valiant': valiantMovement,
  'bastion:endless-battlement:enter': battlementEnter,
  'bastion:endless-battlement:refresh': battlementRefresh,
  'bastion:endless-battlement:interrupt': battlementInterrupt,
  'bastion:perseus': perseusEffects,
  'bastion:rook': rookEffects,
};

export const BASTION_ABILITY_PROGRAMS: Readonly<Record<string, (unit: RuleSourceUnit) => RuleProgramCompilation>> = {
  'bastion:heracule': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['attack', 'true strike', 'range'],
    range: constant(3),
    resolverId: 'bastion:heracule:effects',
    steps: [{ id: 'attack', timing: 'use', effects: [{
      kind: 'attack', target: attackTarget, trueStrike: true,
      onHit: [normalDamage({ kind: 'add', values: [damageDie(1), fray()] })],
      onMiss: [normalDamage(fray(), 'miss')],
      onCritical: [normalDamage(damageDie(1))],
    }] }],
  })], ['effect', 'on hit', 'miss', 'effect', 'effect', 'heroic']),

  'bastion:battering-ram': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    range: constant(1),
    steps: [
      { id: 'base', timing: 'use', effects: [{ kind: 'move', target: inputTarget('any', 1), movement: 'shove', distance: constant(2), directionInput: 'direction' }] },
      { id: 'collide-or-heroic', timing: 'use', trigger: 'collide', effects: [statusOn(inputTarget('any', 1), 'slashed'), { kind: 'actions', target: self, operation: 'refund', amount: constant(1) }] },
      { id: 'heroic', timing: 'use', trigger: 'heroic', effects: [statusOn(inputTarget('any', 1), 'slashed'), { kind: 'actions', target: self, operation: 'refund', amount: constant(1) }] },
    ],
  })], ['effect', 'effect', 'collide-or-heroic']),

  'bastion:land-waster': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack', 'burst'],
    range: constant(3),
    resolverId: 'bastion:land-waster:area',
    steps: [{ id: 'attack', timing: 'use', effects: [{
      kind: 'attack', target: attackTarget,
      onHit: [normalDamage({ kind: 'add', values: [damageDie(2), fray()] })],
      onMiss: [normalDamage(fray(), 'miss')],
      onCritical: [normalDamage(damageDie(1))],
    }] }],
  })], ['effect', 'on hit', 'miss', 'area effect', 'effect', 'heroic']),

  'bastion:valiant': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: [],
    range: null,
    resolverId: 'bastion:valiant',
    steps: [],
  })], ['effect', 'effect', 'heroic']),

  'bastion:endless-battlement': (unit) => compilation(unit, [
    action({
      name: unit.name,
      timing: 'use',
      costs: [{ kind: 'action', amount: constant(1) }],
      tags: ['stance', 'aura'],
      range: null,
      resolverId: 'bastion:endless-battlement:enter',
      steps: [],
    }),
    action({
      id: 'stance-refresh',
      name: 'Refresh',
      timing: 'stance-refresh',
      costs: [],
      tags: ['stance'],
      range: null,
      resolverId: 'bastion:endless-battlement:refresh',
      steps: [],
    }),
    action({
      id: 'heroic-intervention',
      name: 'Heroic Intervention',
      timing: 'interrupt',
      costs: [{ kind: 'interrupt', amount: constant(1) }],
      tags: ['interrupt'],
      range: null,
      resolverId: 'bastion:endless-battlement:interrupt',
      steps: [],
    }),
  ], ['effect', 'stance', 'trigger', 'effect', 'refresh', 'heroic']),

  'bastion:catapult': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(1) }],
    tags: ['interrupt'],
    range: constant(1),
    steps: [
      { id: 'base', timing: 'interrupt', effects: [{ kind: 'move', target: inputTarget('ally', 1), movement: 'shove', distance: constant(2), directionInput: 'direction' }] },
      { id: 'collide-or-heroic', timing: 'interrupt', trigger: 'collide', effects: [{ kind: 'vigor', target: inputTarget('ally', 1), amount: constant(2) }, { kind: 'move', target: inputTarget('ally', 1), movement: 'rush', distance: constant(1), directionInput: 'rush-direction' }] },
      { id: 'heroic', timing: 'interrupt', trigger: 'heroic', effects: [{ kind: 'vigor', target: inputTarget('ally', 1), amount: constant(2) }, { kind: 'move', target: inputTarget('ally', 1), movement: 'rush', distance: constant(1), directionInput: 'rush-direction' }] },
    ],
  })], ['effect', 'trigger', 'effect', 'heroic']),

  'bastion:perseus': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'interrupt',
    costs: [{ kind: 'interrupt', amount: constant(2) }],
    tags: ['aura'],
    range: null,
    resolverId: 'bastion:perseus',
    steps: [],
  })], ['effect', 'trigger', 'effect', 'heroic']),

  'bastion:rook': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(2) }],
    tags: ['attack', 'aura'],
    range: constant(1),
    resolverId: 'bastion:rook',
    steps: [
      { id: 'attack', timing: 'use', effects: [{
        kind: 'attack', target: attackTarget,
        onHit: [normalDamage({ kind: 'add', values: [damageDie(1), fray()] })],
        onMiss: [normalDamage(fray(), 'miss')],
        onCritical: [normalDamage(damageDie(1))],
      }] },
      { id: 'collide', timing: 'use', trigger: 'collide', effects: [status('slashed')] },
      { id: 'heroic', timing: 'use', trigger: 'heroic', effects: [] },
    ],
  })], ['effect', 'on hit', 'miss', 'effect', 'effect', 'collide', 'heroic']),

  'bastion:great-giorgios': (unit) => compilation(unit, [action({
    name: unit.name,
    timing: 'use',
    costs: [{ kind: 'action', amount: constant(1) }],
    tags: ['end turn'],
    range: constant(3),
    steps: [
      { id: 'base', timing: 'use', effects: [{ kind: 'mark', target: inputTarget('foe', 3), operation: 'apply', markId: 'great-giorgios' }] },
      { id: 'collide-or-heroic', timing: 'use', trigger: 'collide', effects: [statusOn(inputTarget('foe', 3), 'hatred')] },
      { id: 'heroic', timing: 'use', trigger: 'heroic', effects: [statusOn(inputTarget('foe', 3), 'hatred')] },
    ],
  })], ['effect', 'effect', 'heroic']),
};
