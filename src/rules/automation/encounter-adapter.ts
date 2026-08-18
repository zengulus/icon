import type { EncounterActor, EncounterEntity, EncounterState, EncounterTerrainEffect, Position, StatusId } from '../types.js';
import type { RuleActorView, RuleMutation, RuleRuntimeState } from './types.js';

const statusIds = new Set<StatusId>(['slashed', 'blind', 'dazed', 'hatred', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable']);
const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const clone = <T>(value: T): T => structuredClone(value);

const traitConditions: Readonly<Record<string, string>> = {
  'stalwart:trait:fortify': 'fortify',
  'vagabond:trait:skirmisher': 'skirmisher',
  'vagabond:trait:dodge': 'dodge',
  'vagabond:trait:finesse': 'finesse',
  'wright:trait:slip': 'slip',
  'wright:trait:aetherwall': 'aetherwall',
  'wright:trait:chain-reaction': 'chain-reaction',
  'wright:trait:aether': 'aether-user',
};

export function encounterConditionSet(actor: EncounterActor) {
  const conditions = new Set<string>(actor.statuses);
  for (const condition of actor.conditions) conditions.add(condition.id);
  for (const effect of actor.activeEffects) {
    for (const modifier of effect.modifiers) if (modifier.operation === 'grant' && typeof modifier.value === 'string') conditions.add(modifier.value);
  }
  for (const traitId of actor.traitIds) if (traitConditions[traitId]) conditions.add(traitConditions[traitId]);
  return conditions;
}

export function encounterRuleState(state: EncounterState): RuleRuntimeState {
  return {
    round: state.round,
    actors: Object.fromEntries(Object.values(state.actors).map((actor): [string, RuleActorView] => [actor.id, {
      id: actor.id,
      side: actor.side,
      position: actor.onBattlefield ? { ...actor.position } : null,
      hp: actor.hp,
      maxHp: Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality),
      vitality: actor.vitality,
      vigor: actor.vigor,
      defense: actor.defense,
      armor: actor.armor,
      speed: actor.speed,
      dash: actor.dash,
      fray: actor.fray,
      damageDie: actor.damageDie,
      actions: actor.actionsRemaining,
      size: actor.size,
      defeated: actor.defeated,
      conditions: encounterConditionSet(actor),
      resources: { ...actor.resources, resolve: state.partyResolve + (actor.resources['personal-resolve'] ?? 0) },
      state: { ...actor.ruleState, phaseId: actor.ruleState.phaseId ?? null },
    }])),
    entities: Object.fromEntries(Object.values(state.entities).map((entity) => [entity.id, {
      id: entity.id,
      type: entity.type,
      ownerId: entity.ownerId,
      position: entity.positions[0] ?? null,
      state: entity.state,
    }])),
    terrainAt(position) {
      const values = new Set<string>();
      for (const cell of state.grid.terrain) if (samePosition(cell.position, position)) values.add(cell.type);
      for (const effect of state.terrainEffects) if (effect.positions.some((candidate) => samePosition(candidate, position))) values.add(effect.terrain);
      return values;
    },
  };
}

function generatedId(state: EncounterState, sourceId: string, mutationIndex: number, suffix: string) {
  return `${sourceId}:${state.revision}:${mutationIndex}:${suffix}`;
}

function removeOwnedEphemera(state: EncounterState, ownerId: string) {
  for (const [id, entity] of Object.entries(state.entities)) if (entity.ownerId === ownerId && entity.type !== 'object') delete state.entities[id];
  for (const actor of Object.values(state.actors)) {
    actor.marks = actor.marks.filter((mark) => mark.ownerId !== ownerId);
    actor.activeEffects = actor.activeEffects.filter((effect) => effect.ownerId !== ownerId);
  }
}

function defeatActor(state: EncounterState, actor: EncounterActor) {
  if (actor.defeated) return;
  actor.defeated = true;
  actor.hp = 0;
  actor.vigor = 0;
  actor.statuses = [];
  actor.conditions = [];
  actor.activeEffects = [];
  actor.marks = [];
  actor.stance = null;
  if (actor.side === 'heroes') actor.wounds = Math.min(4, actor.wounds + 1);
  removeOwnedEphemera(state, actor.id);
}

function applyDamage(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'damage' }>) {
  const target = state.actors[mutation.actorId];
  const source = state.actors[mutation.sourceActorId];
  if (!target || target.defeated || target.ruleState['damage-immune'] === true) return;
  if (mutation.damageType === 'sacrifice') {
    target.hp = Math.max(1, target.hp - mutation.amount);
    return;
  }
  let amount = mutation.amount;
  const sourceConditions = source ? encounterConditionSet(source) : new Set<string>();
  const targetConditions = encounterConditionSet(target);
  if (targetConditions.has('intangible') && source && source.side !== target.side) return;
  if (targetConditions.has('dodge') && (mutation.delivery === 'miss' || mutation.delivery === 'area' || mutation.delivery === 'save-success')) return;
  if (mutation.damageType !== 'divine' && mutation.damageType !== 'piercing' && sourceConditions.has('weakened')) amount = Math.max(0, amount - 2);
  if (mutation.damageType !== 'divine' && sourceConditions.has('pacified')) amount = Math.ceil(amount / 2);
  if (amount > 0 && targetConditions.has('vulnerable')) amount += 1;
  if (mutation.damageType === 'normal') amount = Math.max(0, amount - target.armor);
  const sourceDistance = source && source.onBattlefield && target.onBattlefield ? Math.max(Math.abs(source.position.x - target.position.x), Math.abs(source.position.y - target.position.y)) : 0;
  const aetherwall = targetConditions.has('aetherwall') && sourceDistance > 2;
  if (mutation.damageType !== 'divine' && (targetConditions.has('resistance') || aetherwall || (!mutation.ignoreCover && target.ruleState.cover === true))) amount = Math.ceil(amount / 2);
  if (mutation.damageType === 'divine') target.hp = Math.max(0, target.hp - amount);
  else {
    const vigorDamage = Math.min(target.vigor, amount);
    target.vigor -= vigorDamage;
    target.hp = Math.max(0, target.hp - (amount - vigorDamage));
  }
  if (amount > 0 && source && source.side !== target.side) target.statuses = target.statuses.filter((status) => status !== 'pacified');
  if (target.hp <= 0 && targetConditions.has('defiance') && mutation.damageType !== 'divine') {
    target.hp = 1;
    target.conditions = target.conditions.filter(({ id }) => id !== 'defiance');
    target.ruleState['damage-immune'] = true;
  } else if (target.hp <= 0) defeatActor(state, target);
}

function applyMovement(state: EncounterState, mutation: Extract<RuleMutation, { kind: 'move' }>) {
  const actor = state.actors[mutation.actorId];
  if (!actor || actor.defeated || encounterConditionSet(actor).has('immobile')) return;
  if (mutation.movement === 'remove') {
    actor.onBattlefield = false;
    return;
  }
  if (mutation.movement === 'place' || mutation.movement === 'teleport') {
    const destination = mutation.positions.at(-1);
    if (destination) {
      actor.position = { ...destination };
      actor.onBattlefield = true;
    }
    return;
  }
  if (mutation.positions.length > 0) {
    actor.position = { ...mutation.positions.at(-1)! };
    actor.onBattlefield = true;
    return;
  }
  if (!mutation.direction || !mutation.distance) return;
  const maximum = encounterConditionSet(actor).has('sturdy') && state.actors[mutation.sourceActorId]?.side !== actor.side ? Math.min(1, mutation.distance) : mutation.distance;
  let position = { ...actor.position };
  for (let step = 0; step < maximum; step += 1) {
    const next = { x: position.x + Math.sign(mutation.direction.x), y: position.y + Math.sign(mutation.direction.y) };
    const obstructed = next.x < 0 || next.y < 0 || next.x >= state.grid.width || next.y >= state.grid.height
      || Object.values(state.actors).some((candidate) => candidate.id !== actor.id && candidate.onBattlefield && !candidate.defeated && samePosition(candidate.position, next))
      || state.grid.terrain.some((cell) => samePosition(cell.position, next) && cell.type === 'impassable');
    if (obstructed) break;
    position = next;
  }
  actor.position = position;
}

export function applyRuleMutation(state: EncounterState, mutation: RuleMutation, mutationIndex: number) {
  switch (mutation.kind) {
    case 'attack': break;
    case 'damage': applyDamage(state, mutation); break;
    case 'heal': {
      const actor = state.actors[mutation.actorId];
      if (actor && !actor.defeated) actor.hp = Math.min(mutation.maximum ?? Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality), actor.hp + mutation.amount);
      break;
    }
    case 'vigor': {
      const actor = state.actors[mutation.actorId];
      if (actor && !actor.defeated && !encounterConditionSet(actor).has('shattered')) actor.vigor = Math.min(mutation.uncapped ? Number.MAX_SAFE_INTEGER : actor.vitality, actor.vigor + mutation.amount);
      break;
    }
    case 'condition': {
      const actor = state.actors[mutation.actorId];
      if (!actor || actor.defeated) break;
      const source = state.actors[mutation.sourceActorId];
      if (mutation.operation === 'apply' && source && encounterConditionSet(source).has('sealed') && statusIds.has(mutation.conditionId as StatusId)) break;
      if (mutation.operation === 'apply' && source && source.side !== actor.side && encounterConditionSet(actor).has('unstoppable') && statusIds.has(mutation.conditionId as StatusId)) break;
      if (mutation.operation === 'remove') {
        actor.statuses = actor.statuses.filter((status) => status !== mutation.conditionId);
        actor.conditions = actor.conditions.filter(({ id }) => id !== mutation.conditionId);
      } else if (statusIds.has(mutation.conditionId as StatusId)) {
        if (!actor.statuses.includes(mutation.conditionId as StatusId)) actor.statuses.push(mutation.conditionId as StatusId);
        if (mutation.potency === 'plus') actor.conditions.push({ id: mutation.conditionId, sourceId: mutation.sourceId, potency: 'plus', duration: mutation.duration ?? null });
      } else if (!actor.conditions.some(({ id, sourceId }) => id === mutation.conditionId && sourceId === mutation.sourceId)) {
        actor.conditions.push({ id: mutation.conditionId, sourceId: mutation.sourceId, potency: mutation.potency, duration: mutation.duration ?? null });
      }
      break;
    }
    case 'cure': {
      const actor = state.actors[mutation.actorId];
      if (actor && !actor.defeated) actor.vigor = Math.min(actor.vitality, actor.vigor + (actor.hp <= actor.baseMaxHp / 2 ? actor.vitality : 4));
      break;
    }
    case 'move': applyMovement(state, mutation); break;
    case 'resource': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      const current = actor.resources[mutation.resourceId] ?? 0;
      const raw = mutation.operation === 'set' ? mutation.amount : mutation.operation === 'spend' || mutation.operation === 'tick-down' ? current - mutation.amount : current + mutation.amount;
      actor.resources[mutation.resourceId] = Math.max(mutation.minimum ?? 0, Math.min(mutation.maximum ?? Number.MAX_SAFE_INTEGER, raw));
      break;
    }
    case 'actions': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      actor.actionsRemaining = mutation.operation === 'set' ? mutation.amount : mutation.operation === 'spend' ? Math.max(0, actor.actionsRemaining - mutation.amount) : actor.actionsRemaining + mutation.amount;
      break;
    }
    case 'terrain': {
      if (mutation.operation === 'remove') state.terrainEffects = state.terrainEffects.filter((effect) => effect.terrain !== mutation.terrain || !effect.positions.some((position) => mutation.positions.some((candidate) => samePosition(position, candidate))));
      else {
        const effect: EncounterTerrainEffect = { id: generatedId(state, mutation.sourceId, mutationIndex, 'terrain'), sourceId: mutation.sourceId, ownerId: null, terrain: mutation.terrain, positions: clone(mutation.positions), height: mutation.height, duration: mutation.duration ?? null };
        state.terrainEffects.push(effect);
      }
      break;
    }
    case 'entity': {
      if (mutation.operation === 'remove') {
        for (const [id, entity] of Object.entries(state.entities)) if (entity.type === mutation.entityType && entity.ownerId === mutation.ownerId) delete state.entities[id];
      } else {
        const entity: EncounterEntity = { id: generatedId(state, mutation.sourceId, mutationIndex, 'entity'), type: mutation.entityType, ownerId: mutation.ownerId, positions: clone(mutation.positions), state: { ...mutation.state }, duration: mutation.duration ?? null };
        state.entities[entity.id] = entity;
      }
      break;
    }
    case 'mark': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'remove') actor.marks = actor.marks.filter(({ markId }) => markId !== mutation.markId);
      else {
        actor.marks = actor.marks.filter(({ ownerId }) => ownerId !== mutation.ownerId);
        actor.marks.push({ id: generatedId(state, mutation.sourceId, mutationIndex, 'mark'), sourceId: mutation.sourceId, ownerId: mutation.ownerId, markId: mutation.markId, duration: mutation.duration ?? null, state: { ...mutation.state } });
      }
      break;
    }
    case 'stance': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'exit') actor.stance = null;
      else actor.stance = { id: generatedId(state, mutation.sourceId, mutationIndex, 'stance'), sourceId: mutation.sourceId, stanceId: mutation.stanceId, state: { ...mutation.state } };
      break;
    }
    case 'persistent': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'remove') actor.activeEffects = actor.activeEffects.filter(({ effectId }) => effectId !== mutation.effectId);
      else actor.activeEffects.push({ id: generatedId(state, mutation.sourceId, mutationIndex, 'effect'), sourceId: mutation.sourceId, effectId: mutation.effectId, ownerId: mutation.ownerId, duration: mutation.duration, modifiers: clone(mutation.modifiers), triggers: [...mutation.triggers], state: { ...mutation.state } });
      break;
    }
    case 'modifier': {
      const actor = state.actors[mutation.actorId];
      if (actor) actor.activeEffects.push({ id: generatedId(state, mutation.sourceId, mutationIndex, 'modifier'), sourceId: mutation.sourceId, effectId: `modifier:${mutation.modifier.stat}`, ownerId: mutation.ownerId, duration: mutation.duration, modifiers: [clone(mutation.modifier)], triggers: [], state: {} });
      break;
    }
    case 'save': break;
    case 'defeat': {
      const actor = state.actors[mutation.actorId];
      if (actor) defeatActor(state, actor);
      break;
    }
    case 'phase': {
      const actor = state.actors[mutation.actorId];
      if (actor) actor.ruleState.phaseId = mutation.phaseId;
      break;
    }
    case 'end-turn': {
      const actor = state.actors[mutation.actorId];
      if (actor) actor.ruleState['end-turn-requested'] = true;
      break;
    }
    case 'state': {
      const actor = state.actors[mutation.actorId];
      if (!actor) break;
      if (mutation.operation === 'clear') delete actor.ruleState[mutation.key];
      else if (mutation.operation === 'increment') actor.ruleState[mutation.key] = Number(actor.ruleState[mutation.key] ?? 0) + Number(mutation.value ?? 1);
      else actor.ruleState[mutation.key] = mutation.value ?? null;
      break;
    }
  }
}

export function applyRuleMutations(state: EncounterState, mutations: RuleMutation[]) {
  mutations.forEach((mutation, index) => applyRuleMutation(state, mutation, index));
}
