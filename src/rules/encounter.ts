import { ENCOUNTER_SCHEMA_VERSION, RULES_VERSION, type CommandResult, type EncounterActor, type EncounterCommand, type EncounterEvent, type EncounterState, type IconCharacter, type Position, type StatusId } from './types.js';
import { findAbility, findClass, findJob } from './catalog.js';
import { FOE_PROFILES, findFoeProfile, findFoeRole } from './foes.js';
import { characterStats } from './character.js';
import { randomDice, rollBoonOrCurse, rollDamage, type DiceSource } from './dice.js';
import { compileRuleSourceUnit } from './automation/compiler.js';
import { isIndependentlyExecutableAbility, isIndependentlyExecutableManualProgram } from './automation/manual-programs.js';
import { applyRuleMutations, encounterConditionSet, encounterRuleState } from './automation/encounter-adapter.js';
import { executeRuleProgram } from './automation/runtime.js';
import { RULE_RESOLVERS } from './automation/resolvers.js';
import { findRuleSourceUnit } from './source-units.js';
import { planMovementPath } from './movement.js';
import { durableAssetUrlProblem } from './durable-assets.js';

export class RuleViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

/**
 * Durable room snapshots carry a recent combat history for the VTT event
 * panel. It is not the source of truth for mechanical state, so keeping it
 * bounded prevents every later checkpoint and player projection from growing
 * forever during a long-running encounter.
 */
export const MAX_ENCOUNTER_EVENT_LOG = 500;

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `encounter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = <T>(value: T): T => structuredClone(value);
const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const distance = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const positionWithinGrid = (position: Position, state: Pick<EncounterState, 'grid'>) =>
  position.x >= 0 && position.y >= 0 && position.x < state.grid.width && position.y < state.grid.height;

/**
 * The websocket schema already requires these fields, but local/imported
 * callers can invoke the reducer directly. Canonicalize optional historical
 * provenance at the reducer boundary so an accepted ADD_ACTOR event can
 * never create a checkpoint that the strict room validator rejects later.
 */
function canonicalActorForAdd(actor: EncounterActor): EncounterActor {
  const ruleState = { ...(actor.ruleState ?? {}) };
  const ruleStateOwners = { ...(actor.ruleStateOwners ?? {}) };
  for (const key of Object.keys(ruleState)) ruleStateOwners[key] ??= null;
  for (const key of Object.keys(ruleStateOwners)) if (!(key in ruleState)) delete ruleStateOwners[key];
  return {
    ...actor,
    foeProfileId: actor.foeProfileId ?? null,
    conditions: (actor.conditions ?? []).map((condition) => ({ ...condition, ownerId: condition.ownerId ?? null })),
    ruleState,
    ruleStateOwners,
    stance: actor.stance ? { ...actor.stance, ownerId: actor.stance.ownerId ?? null } : null,
  };
}

export function createEncounter(name = 'Untitled encounter'): EncounterState {
  return {
    schemaVersion: ENCOUNTER_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    id: makeId(),
    name,
    phase: 'setup',
    grid: { width: 10, height: 10, backgroundUrl: '', terrain: [] },
    actors: {},
    round: 0,
    activeActorId: null,
    lastSide: null,
    partyResolve: 0,
    entities: {},
    terrainEffects: [],
    revision: 0,
    eventLog: [],
  };
}

export function migrateEncounter(input: unknown): EncounterState {
  if (!input || typeof input !== 'object') throw new RuleViolation('encounter.invalid', 'Encounter data must be an object.');
  const candidate = input as Omit<Partial<EncounterState>, 'schemaVersion'> & { schemaVersion?: number };
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3 && candidate.schemaVersion !== 4 && candidate.schemaVersion !== 5 && candidate.schemaVersion !== ENCOUNTER_SCHEMA_VERSION) {
    throw new RuleViolation('encounter.schema', `Unsupported encounter schema version: ${String(candidate.schemaVersion)}`);
  }
  // There is no cross-rules-version converter in this release. Treat a
  // declared non-1.5 ruleset as an incompatible import instead of silently
  // relabelling its mechanics as ICON 1.5 during schema migration.
  if (candidate.rulesVersion !== undefined && candidate.rulesVersion !== RULES_VERSION) {
    throw new RuleViolation('encounter.rules-version', `Unsupported ICON rules version: ${String(candidate.rulesVersion)}`);
  }
  const base = createEncounter(typeof candidate.name === 'string' ? candidate.name : 'Migrated encounter');
  const actors = Object.fromEntries(Object.entries(candidate.actors ?? {}).map(([id, value]) => {
    const actor = value as Partial<EncounterActor>;
    return [id, {
      ...actor,
      id,
      foeProfileId: actor.foeProfileId ?? null,
      roleId: actor.roleId ?? (actor.foeProfileId ? findFoeProfile(actor.foeProfileId)?.roleId ?? null : null),
      actorKind: actor.actorKind ?? (actor.side === 'heroes' ? 'hero' : 'foe'),
      size: actor.size ?? 1,
      chapter: actor.chapter ?? 1,
      abilityIds: [...(actor.abilityIds ?? [])],
      conditions: (actor.conditions ?? []).map((condition) => ({ ...condition, ownerId: condition.ownerId ?? null })),
      resources: { ...(actor.resources ?? {}) },
      ruleState: { ...(actor.ruleState ?? {}) },
      ruleStateOwners: { ...(actor.ruleStateOwners ?? {}) },
      activeEffects: [...(actor.activeEffects ?? [])],
      marks: [...(actor.marks ?? [])],
      stance: actor.stance ? { ...actor.stance, ownerId: actor.stance.ownerId ?? null } : null,
      traitIds: [...(actor.traitIds ?? [])],
      onBattlefield: actor.onBattlefield ?? true,
      usedAbilityIds: [...(actor.usedAbilityIds ?? [])],
      interruptUses: { ...(actor.interruptUses ?? {}) },
      interruptUsedThisTurn: actor.interruptUsedThisTurn ?? false,
      slashedTriggeredThisTurn: actor.slashedTriggeredThisTurn ?? false,
      dangerousTerrainTriggeredThisTurn: actor.dangerousTerrainTriggeredThisTurn ?? false,
    } as EncounterActor];
  }));
  // Pre-provenance checkpoint schemas did not record which actor created a
  // condition. Recover the unambiguous common case from the source unit held
  // by an actor, while leaving genuinely unknown legacy ownership as null.
  // New resolver mutations always write ownerId explicitly.
  const inferOwnerId = (sourceId: string): string | null => {
    const owners = Object.values(actors).filter((candidate) => candidate.abilityIds.includes(sourceId)
      || candidate.traitIds.includes(sourceId));
    return owners.length === 1 ? owners[0]!.id : null;
  };
  for (const target of Object.values(actors)) {
    for (const condition of target.conditions) {
      if (condition.ownerId !== null) continue;
      condition.ownerId = inferOwnerId(condition.sourceId);
    }
    if (target.stance?.ownerId === null) target.stance.ownerId = inferOwnerId(target.stance.sourceId);
    for (const key of Object.keys(target.ruleState)) {
      if (key in target.ruleStateOwners) continue;
      const sourceId = key.startsWith('trait:')
        ? key.slice('trait:'.length)
        : key.startsWith('core-rule:')
          ? key.slice('core-rule:'.length)
          : null;
      target.ruleStateOwners[key] = sourceId ? inferOwnerId(sourceId) : null;
    }
    for (const key of Object.keys(target.ruleStateOwners)) {
      if (!(key in target.ruleState)) delete target.ruleStateOwners[key];
    }
  }
  if (candidate.eventLog !== undefined && !Array.isArray(candidate.eventLog)) {
    throw new RuleViolation('encounter.event-log', 'Encounter event history must be an array when present.');
  }
  if (candidate.eventLog && candidate.eventLog.length > MAX_ENCOUNTER_EVENT_LOG) {
    throw new RuleViolation('encounter.event-log', `Encounter event history exceeds the ${MAX_ENCOUNTER_EVENT_LOG}-event durable limit.`);
  }
  return {
    ...base,
    ...candidate,
    schemaVersion: ENCOUNTER_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    grid: { ...base.grid, ...(candidate.grid ?? {}), terrain: [...(candidate.grid?.terrain ?? [])] },
    actors,
    entities: clone(candidate.entities ?? {}),
    terrainEffects: clone(candidate.terrainEffects ?? []),
    // A migration may add canonical fields, but it must never erase an older
    // event simply to fit the current bounded-history policy. Reject and ask
    // for an explicit archive/compaction decision instead.
    eventLog: candidate.eventLog ? clone(candidate.eventLog) : [],
  };
}

export function actorFromCharacter(character: IconCharacter, position: Position, controllerId: string | null = null): EncounterActor {
  const stats = characterStats(character);
  const job = character.primaryJobId ? findJob(character.primaryJobId) : undefined;
  const jobClass = job ? findClass(job.classId) : undefined;
  if (!stats || !job) throw new RuleViolation('character.job-required', 'A valid primary Job is required before entering combat.');
  return {
    id: `actor:${character.id}`,
    name: character.name || 'Unnamed Icon',
    side: 'heroes',
    controllerId,
    characterId: character.id,
    foeProfileId: null,
    roleId: null,
    actorKind: 'hero',
    size: 1,
    tokenUrl: character.portraitUrl,
    classId: job.classId,
    chapter: stats.chapter as 1 | 2 | 3,
    abilityIds: [...character.equippedAbilityIds],
    position,
    vitality: stats.vitality,
    baseMaxHp: stats.hp,
    hp: stats.maxHp,
    vigor: 0,
    wounds: character.wounds,
    defense: stats.defense,
    armor: stats.armor,
    speed: stats.speed,
    dash: stats.dash,
    fray: stats.fray,
    damageDie: stats.damageDie,
    basicAttackRange: stats.basicAttackRange,
    statuses: [],
    conditions: [],
    resources: { aether: 0, vigilance: 0, blessing: 0, combo: 0, 'personal-resolve': character.personalResolve },
    ruleState: {},
    ruleStateOwners: {},
    activeEffects: [],
    marks: [],
    stance: null,
    traitIds: [...(jobClass?.traits.map(({ id }) => id) ?? []), ...job.traits.map(({ id }) => id)],
    onBattlefield: true,
    defeated: false,
    actionsRemaining: 2,
    standardMoveUsed: false,
    attackedThisTurn: false,
    usedAbilityIds: [],
    interruptUses: {},
    interruptUsedThisTurn: false,
    slashedTriggeredThisTurn: false,
    dangerousTerrainTriggeredThisTurn: false,
    turnTaken: false,
  };
}

export function createFoe(name: string, position: Position): EncounterActor {
  return {
    id: `foe:${makeId()}`,
    name,
    side: 'foes',
    controllerId: null,
    characterId: null,
    foeProfileId: null,
    roleId: null,
    actorKind: 'foe',
    size: 1,
    tokenUrl: '',
    classId: 'foe',
    chapter: 1,
    abilityIds: [],
    position,
    vitality: 8,
    baseMaxHp: 32,
    hp: 32,
    vigor: 0,
    wounds: 0,
    defense: 8,
    armor: 0,
    speed: 4,
    dash: 2,
    fray: 3,
    damageDie: 8,
    basicAttackRange: 4,
    statuses: [],
    conditions: [],
    resources: {},
    ruleState: {},
    ruleStateOwners: {},
    activeEffects: [],
    marks: [],
    stance: null,
    traitIds: [],
    onBattlefield: true,
    defeated: false,
    actionsRemaining: 2,
    standardMoveUsed: false,
    attackedThisTurn: false,
    usedAbilityIds: [],
    interruptUses: {},
    interruptUsedThisTurn: false,
    slashedTriggeredThisTurn: false,
    dangerousTerrainTriggeredThisTurn: false,
    turnTaken: false,
  };
}

export function foeAbilityIds(profileId: string): string[] {
  const profile = findFoeProfile(profileId);
  if (!profile) throw new RuleViolation('foe.profile-unknown', 'That foe profile does not exist in ICON 1.5.');
  const inherited = profile.kind === 'variant' && profile.parentId ? foeAbilityIds(profile.parentId) : [];
  const components = profile.kind === 'legend'
    ? FOE_PROFILES.filter(({ parentId }) => parentId === profile.id).flatMap(({ id }) => foeAbilityIds(id))
    : [];
  return [...new Set([...inherited, ...profile.abilities.map(({ id }) => id), ...components])];
}

export function foeTraitIds(profileId: string): string[] {
  const profile = findFoeProfile(profileId);
  if (!profile) throw new RuleViolation('foe.profile-unknown', 'That foe profile does not exist in ICON 1.5.');
  const inherited = profile.kind === 'variant' && profile.parentId ? foeTraitIds(profile.parentId) : [];
  const components = profile.kind === 'legend'
    ? FOE_PROFILES.filter(({ parentId }) => parentId === profile.id).flatMap(({ id }) => foeTraitIds(id))
    : [];
  return [...new Set([...inherited, ...profile.traits.map(({ id }) => id), ...components])];
}

export function createFoeFromProfile(profileId: string, position: Position, playerCount = 4, chapter: 1 | 2 | 3 = 1): EncounterActor {
  const profile = findFoeProfile(profileId);
  if (!profile) throw new RuleViolation('foe.profile-unknown', 'That foe profile does not exist in ICON 1.5.');
  if (chapter < profile.minimumChapter) throw new RuleViolation('foe.chapter', `${profile.name} requires Chapter ${profile.minimumChapter}.`);
  const role = findFoeRole(profile.roleId);
  if (!role || profile.roleId === 'special') throw new RuleViolation('foe.role-special', 'Special foe components require a parent profile.');
  if (role.id === 'mob') throw new RuleViolation('foe.mob-unsupported', 'Mob profiles require member-level state that is not executable yet.');

  const listedHp = Number(profile.traitsText.match(/\bHP\s*:\s*(\d+)/i)?.[1] ?? 0);
  const roleHp = role.id === 'legend' ? Math.max(role.minimumHp ?? 0, (role.hpPerPlayer ?? 0) * Math.max(1, playerCount)) : role.hp ?? 1;
  const maxHp = profile.stats.hp ?? (listedHp || (profile.kind === 'elite' ? roleHp * 2 : roleHp));
  return {
    id: `foe:${makeId()}`,
    name: profile.name,
    side: 'foes',
    controllerId: null,
    characterId: null,
    foeProfileId: profile.id,
    roleId: profile.roleId,
    actorKind: 'foe',
    size: profile.stats.size ?? 1,
    tokenUrl: '',
    classId: 'foe',
    chapter,
    abilityIds: foeAbilityIds(profile.id),
    position,
    vitality: profile.stats.vitality ?? role.vitality ?? Math.max(1, Math.ceil(maxHp / 4)),
    baseMaxHp: maxHp,
    hp: maxHp,
    vigor: 0,
    wounds: 0,
    defense: profile.stats.defense ?? role.defense,
    armor: profile.stats.armor ?? (role.id === 'heavy' ? 2 : 0),
    speed: profile.stats.speed ?? role.speed,
    dash: profile.stats.dash ?? role.dash,
    fray: profile.stats.fray ?? role.fray,
    damageDie: profile.stats.damageDie ?? role.damageDie,
    basicAttackRange: 1,
    statuses: [],
    conditions: [],
    resources: {},
    ruleState: { phaseId: profile.phases[0]?.id ?? null },
    ruleStateOwners: { phaseId: null },
    activeEffects: [],
    marks: [],
    stance: null,
    traitIds: foeTraitIds(profile.id),
    onBattlefield: true,
    defeated: false,
    actionsRemaining: 2,
    standardMoveUsed: false,
    attackedThisTurn: false,
    usedAbilityIds: [],
    interruptUses: {},
    interruptUsedThisTurn: false,
    slashedTriggeredThisTurn: false,
    dangerousTerrainTriggeredThisTurn: false,
    turnTaken: false,
  };
}

function terrainAt(state: EncounterState, position: Position) {
  return state.grid.terrain.find((cell) => samePosition(cell.position, position));
}

/** ICON p.89: a pit counts as one elevation lower than its base space. */
function elevationAt(state: EncounterState, position: Position) {
  const terrain = terrainAt(state, position);
  return (terrain?.elevation ?? 0) - (terrain?.type === 'pit' ? 1 : 0);
}

function assertActive(state: EncounterState, actorId: string) {
  if (state.phase !== 'active') throw new RuleViolation('encounter.not-active', 'The encounter is not active.');
  if (state.activeActorId !== actorId) throw new RuleViolation('turn.not-active-actor', 'Only the active actor can take that action.');
  const actor = state.actors[actorId];
  if (!actor || actor.defeated || !actor.onBattlefield) throw new RuleViolation('actor.unavailable', 'That actor cannot act.');
  return actor;
}

function nextActor(state: EncounterState, current: EncounterActor) {
  const living = Object.values(state.actors).filter((actor) => !actor.defeated && actor.onBattlefield && !actor.turnTaken && actor.id !== current.id);
  const alternate = living.find((actor) => actor.side !== current.side);
  const same = living.find((actor) => actor.side === current.side);
  if (alternate || same) return { actor: alternate ?? same!, round: state.round };
  const nextRoundActors = Object.values(state.actors).filter((actor) => !actor.defeated && actor.onBattlefield && actor.id !== current.id);
  const preferred = nextRoundActors.find((actor) => actor.side !== current.side) ?? nextRoundActors[0] ?? current;
  return { actor: preferred, round: state.round + 1 };
}

function saveStatuses(actor: EncounterActor, dice: DiceSource, excluded: StatusId[] = []) {
  const ongoing = new Set(actor.conditions.filter(({ potency }) => potency === 'plus').map(({ id }) => id));
  return actor.statuses.filter((status) => !excluded.includes(status) && !ongoing.has(status)).map((status) => {
    const roll = dice.die(20);
    return { status, roll, cleared: roll >= 10 };
  });
}

function movementEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'MOVE' }>): EncounterEvent[] {
  const plan = planMovementPath(state, command.actorId, command.path, command.mode);
  if (!plan.legal) {
    const failure = plan.issue ?? { code: 'move.invalid', message: 'That movement cannot be taken.' };
    throw new RuleViolation(failure.code, failure.message);
  }
  const actor = state.actors[command.actorId]!;
  const hpAfterDanger = Math.max(0, actor.hp - plan.dangerousDamage);
  const hpAfterSlashed = Math.max(0, hpAfterDanger - Math.max(0, plan.slashedDamage - actor.vigor));
  const events: EncounterEvent[] = [{ type: 'ACTOR_MOVED', actorId: actor.id, path: plan.path, mode: plan.mode, dangerousDamage: plan.dangerousDamage, slashedDamage: plan.slashedDamage }];
  if (hpAfterSlashed === 0) events.push({ type: 'ACTOR_DEFEATED', actorId: actor.id, woundGained: actor.side === 'heroes' });
  return events;
}

function attackEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'BASIC_ATTACK' }>, dice: DiceSource): EncounterEvent[] {
  const actor = assertActive(state, command.actorId);
  const target = state.actors[command.targetId];
  const cost = command.weight === 'heavy' ? 2 : 1;
  if (!target || target.defeated || target.side === actor.side) throw new RuleViolation('attack.invalid-target', 'Basic attacks require a living foe.');
  if (actor.attackedThisTurn) throw new RuleViolation('attack.limit', 'A character can only use one attack ability per turn.');
  if (actor.actionsRemaining < cost) throw new RuleViolation('action.insufficient', `A ${command.weight} attack costs ${cost} action${cost === 1 ? '' : 's'}.`);
  const attackRange = actor.statuses.includes('blind') ? Math.min(2, actor.basicAttackRange) : actor.basicAttackRange;
  if (distance(actor.position, target.position) > attackRange) throw new RuleViolation('attack.range', 'The target is outside basic attack range.');
  if (!hasLineOfSight(state, actor.position, target.position)) throw new RuleViolation('attack.line-of-sight', `${target.name} is outside line of sight.`);
  let netBoon = 0;
  const actorElevation = elevationAt(state, actor.position);
  const targetElevation = elevationAt(state, target.position);
  netBoon += actorElevation - targetElevation;
  if (actor.statuses.includes('dazed')) netBoon -= 1;
  const d20 = dice.die(20);
  const boon = rollBoonOrCurse(netBoon, dice);
  const total = d20 + boon.modifier;
  const hit = total >= target.defense;
  const critical = hit && total >= 20;
  const damageRoll = rollDamage(actor.damageDie, hit ? (command.weight === 'heavy' ? 2 : 1) : 0, critical ? 1 : 0, dice);
  let rawDamage = (hit ? damageRoll.total : 0) + actor.fray;
  if (actor.statuses.includes('weakened')) rawDamage = Math.max(0, rawDamage - 2);
  if (actor.statuses.includes('pacified')) rawDamage = Math.ceil(rawDamage / 2);
  const vulnerableDamage = rawDamage > 0 && target.statuses.includes('vulnerable') ? rawDamage + 1 : rawDamage;
  let reduced = Math.max(0, vulnerableDamage - target.armor);
  if (hasCoverFrom(state, target, actor) && actorElevation <= targetElevation) reduced = Math.ceil(reduced / 2);
  const appliedDamage = Math.min(reduced, target.vigor + target.hp);
  const willDefeat = appliedDamage >= target.vigor + target.hp;
  const events: EncounterEvent[] = [{ type: 'ATTACK_RESOLVED', actorId: actor.id, targetId: target.id, weight: command.weight, d20, boonDie: boon.modifier, total, hit, critical, rawDamage, appliedDamage }];
  if (willDefeat) events.push({ type: 'ACTOR_DEFEATED', actorId: target.id, woundGained: target.side === 'heroes' });
  return events;
}

interface DamageFormula {
  dice: number;
  flat: number;
  fray: boolean;
  times: number;
}

function labeledRuleText(rulesText: string, label: 'on hit' | 'miss' | 'auto hit') {
  const expression = new RegExp(`\\b${label}:\\s*([\\s\\S]*?)(?=\\s+(?:On hit|Miss|Effect|Area effect|Attack|Critical Hit|Heroic|Charge|Collide|Exceed|Comeback|Finishing Blow|Slay|Infuse|Gamble):|$)`, 'i');
  return rulesText.match(expression)?.[1]?.split('.')[0]?.trim() ?? '';
}

function parseDamageFormula(text: string): DamageFormula | null {
  const die = text.match(/(?:(\d+)\s*)?\[D\]/i);
  const fixed = text.match(/(?:^|\s)(\d+)\s+(?:(?:piercing|divine)\s+)?damage\b/i);
  const fray = /\bfray(?:\s+damage)?\b/i.test(text);
  if (!die && !fixed && !fray) return null;
  const timesText = text.match(/(?:,|\s)(?:(\d+)\s+times|twice|thrice)\b/i);
  const times = /\bthrice\b/i.test(timesText?.[0] ?? '') ? 3 : /\btwice\b/i.test(timesText?.[0] ?? '') ? 2 : Number(timesText?.[1] ?? 1);
  return {
    dice: die ? Number(die[1] || 1) : 0,
    flat: fixed ? Number(fixed[1]) : 0,
    fray,
    times,
  };
}

function abilityRange(header: string, listedRange: number | null) {
  if (listedRange !== null) return listedRange;
  const area = header.match(/\b(?:line|arc)\s+(\d+)/i);
  return area ? Number(area[1]) : 1;
}

export function hasLineOfSight(state: EncounterState, from: Position, to: Position) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) * 4;
  if (steps <= 1) return true;
  for (let step = 1; step < steps; step += 1) {
    const ratio = step / steps;
    const position = {
      x: Math.floor(from.x + 0.5 + (to.x - from.x) * ratio),
      y: Math.floor(from.y + 0.5 + (to.y - from.y) * ratio),
    };
    if (!samePosition(position, from) && !samePosition(position, to) && terrainAt(state, position)?.type === 'impassable') return false;
  }
  return true;
}

function lineIntersectsCellInterior(from: Position, to: Position, cell: Position) {
  const epsilon = 1e-9;
  const startX = from.x + 0.5;
  const startY = from.y + 0.5;
  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const intervalForAxis = (start: number, delta: number, lower: number, upper: number): [number, number] | null => {
    if (Math.abs(delta) <= epsilon) return start > lower && start < upper ? [-Infinity, Infinity] : null;
    const first = (lower - start) / delta;
    const second = (upper - start) / delta;
    return [Math.min(first, second), Math.max(first, second)];
  };
  const x = intervalForAxis(startX, deltaX, cell.x + epsilon, cell.x + 1 - epsilon);
  const y = intervalForAxis(startY, deltaY, cell.y + epsilon, cell.y + 1 - epsilon);
  if (!x || !y) return false;
  return Math.max(0, x[0], y[0]) < Math.min(1, x[1], y[1]) - epsilon;
}

/**
 * Source p.92: cover is a target-side state determined from adjacent higher
 * terrain between the two characters. It is never accepted as a client attack
 * flag. Exact edge-touch ambiguity remains a GM ruling, so this only grants
 * cover for an unambiguous line through the terrain cell.
 */
export function hasCoverFrom(state: EncounterState, target: EncounterActor, attacker: EncounterActor) {
  if (distance(attacker.position, target.position) <= 1) return false;
  const targetElevation = elevationAt(state, target.position);
  return state.grid.terrain.some((terrain) => {
    if (distance(terrain.position, target.position) !== 1) return false;
    const terrainElevation = terrain.elevation - (terrain.type === 'pit' ? 1 : 0);
    if (terrain.type !== 'impassable' && terrainElevation < targetElevation + 1) return false;
    return lineIntersectsCellInterior(attacker.position, target.position, terrain.position);
  });
}

function abilityAttack(
  state: EncounterState,
  actor: EncounterActor,
  target: EncounterActor,
  ability: NonNullable<ReturnType<typeof findAbility>>,
  command: Extract<EncounterCommand, { type: 'USE_ABILITY' }>,
  dice: DiceSource,
): NonNullable<Extract<EncounterEvent, { type: 'ABILITY_RESOLVED' }>['attack']> {
  const automatic = /\bAttack:\s*Auto hit:/i.test(ability.rulesText);
  let netBoon = 0;
  netBoon += Number(ability.header.match(/\+(\d+)\s+boon/i)?.[1] ?? 0);
  const actorElevation = elevationAt(state, actor.position);
  const targetElevation = elevationAt(state, target.position);
  netBoon += actorElevation - targetElevation;
  if (actor.statuses.includes('dazed') && !ability.tags.includes('true strike')) netBoon -= 1;
  const d20 = automatic ? null : dice.die(20);
  const boon = automatic ? { modifier: 0 } : rollBoonOrCurse(netBoon, dice);
  const total = d20 === null ? null : d20 + boon.modifier;
  const hit = automatic || (total ?? 0) >= target.defense;
  const critical = !automatic && hit && (total ?? 0) >= 20;
  const damageText = automatic
    ? labeledRuleText(ability.rulesText, 'auto hit')
    : labeledRuleText(ability.rulesText, hit ? 'on hit' : 'miss');
  const formula = parseDamageFormula(damageText);
  const divine = ability.tags.includes('divine') || /\bdivine\b/i.test(ability.header);
  const pierce = ability.tags.includes('pierce');
  let rawDamage = 0;
  let reduced = 0;
  if (formula) {
    const damageRoll = rollDamage(actor.damageDie, formula.dice, critical ? 1 : 0, dice);
    const baseInstance = damageRoll.total + formula.flat + (formula.fray ? actor.fray : 0);
    for (let instance = 0; instance < formula.times; instance += 1) {
      let outgoing = baseInstance;
      if (!divine && !pierce && actor.statuses.includes('weakened')) outgoing = Math.max(0, outgoing - 2);
      if (!divine && actor.statuses.includes('pacified')) outgoing = Math.ceil(outgoing / 2);
      rawDamage += outgoing;
      if (outgoing > 0 && target.statuses.includes('vulnerable')) outgoing += 1;
      if (!divine && !pierce) outgoing = Math.max(0, outgoing - target.armor);
      const coverApplies = hasCoverFrom(state, target, actor) && actorElevation <= targetElevation && !ability.tags.includes('unerring') && !divine;
      if (coverApplies) outgoing = Math.ceil(outgoing / 2);
      reduced += outgoing;
    }
  }
  const bypassVigor = divine;
  const availableHealth = bypassVigor ? target.hp : target.vigor + target.hp;
  return {
    targetId: target.id,
    d20,
    boonDie: boon.modifier,
    total,
    hit,
    critical,
    rawDamage,
    appliedDamage: Math.min(reduced, availableHealth),
    bypassVigor,
  };
}

function abilityEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'USE_ABILITY' }>, dice: DiceSource): EncounterEvent[] {
  if (state.phase !== 'active') throw new RuleViolation('encounter.not-active', 'The encounter is not active.');
  const actor = state.actors[command.actorId];
  if (!actor || actor.defeated || !actor.onBattlefield) throw new RuleViolation('actor.unavailable', 'That actor cannot use an ability.');
  const ability = findAbility(command.abilityId);
  if (!ability) throw new RuleViolation('ability.unknown', 'That ability does not exist in ICON 1.5.');
  if (!actor.abilityIds.includes(ability.id)) throw new RuleViolation('ability.not-equipped', 'That ability is not in this actor’s expedition loadout.');
  if (ability.chapter > actor.chapter) throw new RuleViolation('ability.chapter', `Chapter ${ability.chapter} abilities are not available to this actor.`);
  // Indexing a job ability gives the UI useful source text, not permission to
  // apply a guessed generic attack/cost routine. An ability needs an explicit
  // independently reviewed resolver entry and source-derived replay fixtures
  // before it can alter encounter state.
  if (ability.automation !== 'executable' || !isIndependentlyExecutableAbility(ability.id)) {
    throw new RuleViolation(
      'ability.unresolved',
      `${ability.name} is not an independently executable ICON rule yet. Review p.${ability.source.page}: ${ability.rulesText}`,
    );
  }
  if (actor.usedAbilityIds.includes(ability.id)) throw new RuleViolation('ability.repeat', 'An ability with a cost cannot be repeated during the same turn.');
  if (ability.cost.kind === 'passive') throw new RuleViolation('ability.passive', 'Passive abilities are always active and cannot be used as commands.');

  const interrupt = ability.cost.kind === 'interrupt';
  if (interrupt) {
    if (actor.statuses.includes('stunned')) throw new RuleViolation('interrupt.stunned', 'Stunned characters cannot use interrupts.');
    if (actor.interruptUsedThisTurn) throw new RuleViolation('interrupt.turn-limit', 'A character can only use one interrupt during any turn.');
    if ((actor.interruptUses[ability.id] ?? 0) >= ability.cost.value) throw new RuleViolation('interrupt.uses', 'This interrupt has no uses remaining before the actor’s next turn.');
  } else {
    assertActive(state, actor.id);
    if (ability.cost.kind === 'action' && actor.actionsRemaining < ability.cost.value) throw new RuleViolation('action.insufficient', `This ability costs ${ability.cost.value} action${ability.cost.value === 1 ? '' : 's'}.`);
  }

  const attackAbility = ability.tags.includes('attack');
  if (attackAbility && actor.attackedThisTurn) throw new RuleViolation('attack.limit', 'A character can only use one attack ability per turn.');
  const noAttackSpace = /\bno attack space\b/i.test(ability.rulesText);
  const targetIds = command.targetIds.length === 0 && ability.tags.includes('self') ? [actor.id] : [...command.targetIds];
  if (attackAbility && !noAttackSpace && targetIds.length !== 1) throw new RuleViolation('attack.target-count', 'Choose exactly one attack target.');
  const targets = targetIds.map((targetId) => state.actors[targetId]);
  if (targets.some((target) => !target || target.defeated)) throw new RuleViolation('ability.invalid-target', 'One or more ability targets are unavailable.');
  if (attackAbility && !noAttackSpace && targets[0].side === actor.side) throw new RuleViolation('attack.invalid-target', 'Attacks can only target foes.');

  const maximumRange = actor.statuses.includes('blind') && !ability.tags.includes('true strike') ? Math.min(2, abilityRange(ability.header, ability.range)) : abilityRange(ability.header, ability.range);
  for (const target of targets) {
    if (target.id === actor.id && !ability.tags.includes('self')) throw new RuleViolation('ability.self-target', 'Abilities cannot target their user unless they specify Self.');
    if (distance(actor.position, target.position) > maximumRange) throw new RuleViolation('ability.range', `${target.name} is outside this ability’s range.`);
    if (/\bline\s+\d+/i.test(ability.header) && ability.range === null && actor.position.x !== target.position.x && actor.position.y !== target.position.y) {
      throw new RuleViolation('ability.line', 'A line without a listed range must be drawn orthogonally from its user.');
    }
    if (!hasLineOfSight(state, actor.position, target.position)) throw new RuleViolation('ability.line-of-sight', `${target.name} is outside line of sight.`);
  }

  const attack = attackAbility && !noAttackSpace ? abilityAttack(state, actor, targets[0], ability, command, dice) : null;
  const actionCost = ability.cost.kind === 'action' ? ability.cost.value : 0;
  const endsTurn = ability.tags.includes('end turn') || actor.statuses.includes('stunned');
  const event: Extract<EncounterEvent, { type: 'ABILITY_RESOLVED' }> = {
    type: 'ABILITY_RESOLVED',
    actorId: actor.id,
    abilityId: ability.id,
    targetIds,
    actionCost,
    interrupt,
    attackAbility,
    endsTurn,
    attack,
    resolvedEffects: attack ? ['Attack roll and listed hit/miss damage'] : ['Ability cost and legal targeting'],
    pendingRulesText: ability.rulesText,
  };
  const events: EncounterEvent[] = [event];
  if (attack && attack.appliedDamage >= (attack.bypassVigor ? targets[0].hp : targets[0].vigor + targets[0].hp)) {
    events.push({ type: 'ACTOR_DEFEATED', actorId: targets[0].id, woundGained: targets[0].side === 'heroes' });
  }
  if (endsTurn && !interrupt) {
    const intermediate = applyEvents(state, events);
    const acting = intermediate.actors[actor.id];
    if (!acting.defeated) {
      const next = nextActor(intermediate, acting);
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(acting, dice, ['stunned']) });
    }
  }
  return events;
}

export function executeCommand(state: EncounterState, command: EncounterCommand, dice: DiceSource = randomDice): CommandResult {
  let events: EncounterEvent[] = [];
  switch (command.type) {
    case 'ADD_ACTOR':
      if (state.phase !== 'setup') throw new RuleViolation('setup.closed', 'Actors can only be added during setup.');
      {
        const actor = canonicalActorForAdd(command.actor);
        const tokenUrlProblem = durableAssetUrlProblem(actor.tokenUrl);
        if (tokenUrlProblem) throw new RuleViolation('actor.token-url', `Actor token URL ${tokenUrlProblem}`);
        if (!positionWithinGrid(actor.position, state)) throw new RuleViolation('actor.position', 'Actor position must be inside the battlefield grid.');
        if (state.actors[actor.id]) throw new RuleViolation('actor.duplicate', 'That actor is already on the battlefield.');
        if (Object.values(state.actors).some((existing) => samePosition(existing.position, actor.position))) throw new RuleViolation('actor.position', 'That space is occupied.');
        events = [{ type: 'ACTOR_ADDED', actor }];
      }
      break;
    case 'REMOVE_ACTOR':
      if (state.phase !== 'setup') throw new RuleViolation('setup.closed', 'Actors can only be removed during setup.');
      events = [{ type: 'ACTOR_REMOVED', actorId: command.actorId }];
      break;
    case 'SET_TERRAIN':
      if (state.phase !== 'setup') throw new RuleViolation('setup.closed', 'Terrain can only be changed during setup.');
      if (!positionWithinGrid(command.cell.position, state)) throw new RuleViolation('terrain.position', 'Terrain position must be inside the battlefield grid.');
      events = [{ type: 'TERRAIN_SET', cell: command.cell }];
      break;
    case 'START_ENCOUNTER': {
      if (state.phase !== 'setup') throw new RuleViolation('encounter.started', 'The encounter has already started.');
      const first = Object.values(state.actors).find((actor) => actor.side === 'heroes');
      if (!first || !Object.values(state.actors).some((actor) => actor.side === 'foes')) throw new RuleViolation('encounter.sides', 'Setup needs at least one hero and one foe.');
      events = [{ type: 'ENCOUNTER_STARTED', firstActorId: first.id }];
      break;
    }
    case 'MOVE':
      events = movementEvents(state, command);
      break;
    case 'BASIC_ATTACK':
      events = attackEvents(state, command, dice);
      break;
    case 'USE_ABILITY':
      events = abilityEvents(state, command, dice);
      break;
    case 'EXECUTE_RULE': {
      if (state.phase !== 'active') throw new RuleViolation('encounter.not-active', 'The encounter is not active.');
      const actor = state.actors[command.actorId];
      if (!actor || actor.defeated || !actor.onBattlefield) throw new RuleViolation('actor.unavailable', 'That actor cannot execute a rule program.');
      if (command.timing === 'use' && state.activeActorId !== actor.id) throw new RuleViolation('turn.not-active-actor', 'Only the active actor can use this rule action.');
      if (actor.usedAbilityIds.includes(command.sourceId) && command.timing === 'use') throw new RuleViolation('ability.repeat', 'An ability with a cost cannot be repeated during the same turn.');
      const unit = findRuleSourceUnit(command.sourceId);
      if (!unit) throw new RuleViolation('rule.source-unknown', 'That ICON source rule does not exist.');
      // Compilation coverage is an audit signal, not permission to execute a
      // heuristic parse against live authority. Only explicitly reviewed
      // manual VM programs may take this generic path; all other mechanics
      // stay on their dedicated reducer command or table-facing rules path.
      if (!isIndependentlyExecutableManualProgram(unit.id)) {
        throw new RuleViolation('rule.not-executable', `${unit.name} does not have an independently verified RuleProgram implementation.`);
      }
      if ((unit.kind === 'job-ability' || unit.kind === 'foe-ability') && !actor.abilityIds.includes(unit.id)) throw new RuleViolation('rule.not-owned', `${unit.name} is not available to this actor.`);
      if ((unit.kind === 'class-trait' || unit.kind === 'job-trait' || unit.kind === 'foe-trait') && !actor.traitIds.includes(unit.id)) throw new RuleViolation('rule.not-owned', `${unit.name} is not active on this actor.`);
      const compilation = compileRuleSourceUnit(unit);
      if (compilation.unsupportedClauses.length > 0) throw new RuleViolation('rule.not-executable', `${unit.name} still has ${compilation.unsupportedClauses.length} unsupported source clause${compilation.unsupportedClauses.length === 1 ? '' : 's'}.`);
      const action = compilation.program.actions.find(({ id, timing }) => id === command.actionId && timing === command.timing);
      if (!action) throw new RuleViolation('rule.action-unknown', 'That rule action is not available at this timing.');
      if (action.tags.includes('attack') && actor.attackedThisTurn) throw new RuleViolation('attack.limit', 'A character can only use one attack ability per turn.');
      if (command.attackTargetId) {
        const target = state.actors[command.attackTargetId];
        if (!target || target.defeated || !target.onBattlefield) throw new RuleViolation('attack.invalid-target', 'That rule target is unavailable.');
        if (action.tags.includes('attack') && target.side === actor.side) throw new RuleViolation('attack.invalid-target', 'Attacks can only target foes.');
        const maximumRange = action.range?.kind === 'constant' ? action.range.value : 1;
        if (distance(actor.position, target.position) > maximumRange) throw new RuleViolation('ability.range', `${target.name} is outside this rule action’s range.`);
        if (!hasLineOfSight(state, actor.position, target.position)) throw new RuleViolation('ability.line-of-sight', `${target.name} is outside line of sight.`);
      }
      const result = executeRuleProgram(compilation.program, {
        state: encounterRuleState(state),
        actorId: actor.id,
        sourceId: unit.id,
        actionId: command.actionId,
        timing: command.timing,
        input: command.input,
        dice,
        ...(command.attackTargetId ? { attackTargetId: command.attackTargetId } : {}),
        ...(command.triggerSourceId ? { triggerSourceId: command.triggerSourceId } : {}),
        ...(command.triggerTargetIds ? { triggerTargetIds: command.triggerTargetIds } : {}),
        triggers: new Set(command.triggers ?? []),
      }, RULE_RESOLVERS);
      for (const mutation of result.mutations) {
        if (mutation.kind === 'actions' && mutation.operation === 'spend' && mutation.amount > actor.actionsRemaining) throw new RuleViolation('action.insufficient', `${unit.name} costs more actions than are available.`);
        if (mutation.kind === 'resource' && mutation.operation === 'spend') {
          const available = mutation.resourceId === 'resolve' ? state.partyResolve + (actor.resources['personal-resolve'] ?? 0) : actor.resources[mutation.resourceId] ?? 0;
          if (mutation.amount > available) throw new RuleViolation('resource.insufficient', `${unit.name} requires ${mutation.amount} ${mutation.resourceId}.`);
        }
      }
      events = [{ type: 'RULE_MUTATIONS_APPLIED', actorId: actor.id, sourceId: unit.id, actionId: command.actionId, timing: command.timing, tags: [...action.tags], mutations: result.mutations }];
      break;
    }
    case 'INTERACT': {
      const actor = assertActive(state, command.actorId);
      if (actor.actionsRemaining < 1) throw new RuleViolation('action.insufficient', 'Interact costs one action.');
      if (actor.usedAbilityIds.includes('basic:interact')) throw new RuleViolation('ability.repeat', 'Interact cannot be repeated during the same turn.');
      if (command.position.x < 0 || command.position.y < 0 || command.position.x >= state.grid.width || command.position.y >= state.grid.height) throw new RuleViolation('interact.out-of-bounds', 'That interaction is outside the battlefield.');
      if (distance(actor.position, command.position) > 1) throw new RuleViolation('interact.range', 'Interact can only affect the user’s space or an adjacent space.');
      events = [{ type: 'ACTOR_INTERACTED', actorId: actor.id, position: command.position, description: command.description.trim() || 'Interact' }];
      break;
    }
    case 'RESCUE': {
      const actor = assertActive(state, command.actorId);
      const target = state.actors[command.targetId];
      if (actor.actionsRemaining < 1) throw new RuleViolation('action.insufficient', 'Rescue costs one action.');
      if (actor.usedAbilityIds.includes('basic:rescue')) throw new RuleViolation('ability.repeat', 'Rescue cannot be repeated during the same turn.');
      if (!target || !target.defeated || target.side !== actor.side || target.id === actor.id) throw new RuleViolation('rescue.target', 'Rescue requires an adjacent defeated ally.');
      if (distance(actor.position, target.position) > 1) throw new RuleViolation('rescue.range', 'The defeated ally must be adjacent.');
      events = [{ type: 'ACTOR_RESCUED', actorId: actor.id, targetId: target.id, restoredHp: Math.max(1, target.baseMaxHp - target.wounds * target.vitality) }];
      break;
    }
    case 'RECOVER': {
      const actor = assertActive(state, command.actorId);
      if (actor.actionsRemaining < 2) throw new RuleViolation('action.insufficient', 'Recover costs two actions.');
      if (actor.usedAbilityIds.includes('basic:recover')) throw new RuleViolation('ability.repeat', 'Recover cannot be repeated during the same turn.');
      const saves = saveStatuses(actor, dice);
      const cap = actor.vitality;
      const vigorGained = actor.statuses.includes('shattered') ? 0 : Math.max(0, Math.min(cap, actor.vigor + (actor.hp <= actor.baseMaxHp / 2 ? cap : 4)) - actor.vigor);
      events = [{ type: 'ACTOR_RECOVERED', actorId: actor.id, vigorGained, saves }];
      break;
    }
    // Status application in production comes from a resolved source program.
    // This narrow command remains available to deterministic fixtures and GM
    // migration tools, but is deliberately excluded from the websocket schema.
    case 'APPLY_STATUS': {
      const actor = assertActive(state, command.actorId);
      if (actor.statuses.includes('sealed')) throw new RuleViolation('status.sealed', 'Sealed characters cannot inflict statuses.');
      const target = state.actors[command.targetId];
      if (!target || target.defeated) throw new RuleViolation('status.target', 'That status target is unavailable.');
      if (encounterConditionSet(target).has('unstoppable')) throw new RuleViolation('status.immune', `${target.name} is immune to statuses while Unstoppable.`);
      events = [{ type: 'STATUS_APPLIED', actorId: command.actorId, targetId: target.id, status: command.status }];
      break;
    }
    case 'END_TURN': {
      const actor = assertActive(state, command.actorId);
      const next = nextActor(state, actor);
      events = [{ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor, dice) }];
      break;
    }
    case 'END_ENCOUNTER':
      if (state.phase !== 'active') throw new RuleViolation('encounter.not-active', 'Only an active encounter can end.');
      events = [{ type: 'ENCOUNTER_ENDED' }];
      break;
  }
  if (command.type !== 'USE_ABILITY' && ['MOVE', 'BASIC_ATTACK', 'RECOVER', 'INTERACT', 'RESCUE'].includes(command.type) && 'actorId' in command && state.actors[command.actorId]?.statuses.includes('stunned')) {
    const intermediate = applyEvents(state, events);
    const actor = intermediate.actors[command.actorId];
    if (!actor.defeated) {
      const next = nextActor(intermediate, actor);
      events.push({ type: 'STATUS_REMOVED', actorId: actor.id, status: 'stunned' });
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor, dice, ['stunned']) });
    }
  }
  if (command.type === 'EXECUTE_RULE' && command.timing === 'use') {
    const intermediate = applyEvents(state, events);
    const actor = intermediate.actors[command.actorId];
    if (actor && !actor.defeated && (state.actors[command.actorId]?.statuses.includes('stunned') || actor.ruleState['end-turn-requested'] === true)) {
      const next = nextActor(intermediate, actor);
      if (actor.statuses.includes('stunned')) events.push({ type: 'STATUS_REMOVED', actorId: actor.id, status: 'stunned' });
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor, dice, ['stunned']) });
    }
  }
  return { state: applyEvents(state, events), events };
}

export function applyEvents(input: EncounterState, events: EncounterEvent[]): EncounterState {
  const state = clone(input);
  for (const event of events) {
    switch (event.type) {
      case 'ACTOR_ADDED':
        state.actors[event.actor.id] = canonicalActorForAdd(clone(event.actor));
        break;
      case 'ACTOR_REMOVED':
        delete state.actors[event.actorId];
        break;
      case 'TERRAIN_SET':
        state.grid.terrain = state.grid.terrain.filter((cell) => !samePosition(cell.position, event.cell.position));
        if (event.cell.type !== 'basic' || event.cell.elevation !== 0) state.grid.terrain.push(event.cell);
        break;
      case 'ENCOUNTER_STARTED':
        state.phase = 'active';
        state.round = 1;
        state.partyResolve = 1;
        state.activeActorId = event.firstActorId;
        for (const actor of Object.values(state.actors)) {
          actor.resources.aether = 0;
          actor.resources.combo = 0;
          actor.resources.blessing = 0;
          actor.ruleState['damage-immune'] = false;
          actor.ruleStateOwners['damage-immune'] ??= null;
          if (actor.traitIds.includes('stalwart:trait:armor-2')) actor.armor = Math.max(2, actor.armor);
        }
        break;
      case 'ACTOR_MOVED': {
        const actor = state.actors[event.actorId];
        actor.position = event.path.at(-1)!;
        actor.standardMoveUsed ||= event.mode === 'standard';
        if (event.mode === 'dash') {
          actor.actionsRemaining -= 1;
          actor.usedAbilityIds.push('basic:dash');
        }
        if (event.dangerousDamage) {
          actor.hp = Math.max(0, actor.hp - event.dangerousDamage);
          actor.dangerousTerrainTriggeredThisTurn = true;
        }
        if (actor.statuses.includes('slashed') && !actor.slashedTriggeredThisTurn) {
          const slashedDamage = event.slashedDamage ?? 0;
          const vigorDamage = Math.min(actor.vigor, slashedDamage);
          actor.vigor -= vigorDamage;
          actor.hp = Math.max(0, actor.hp - (slashedDamage - vigorDamage));
          actor.slashedTriggeredThisTurn = true;
        }
        break;
      }
      case 'ATTACK_RESOLVED': {
        const actor = state.actors[event.actorId];
        const target = state.actors[event.targetId];
        actor.actionsRemaining -= event.weight === 'heavy' ? 2 : 1;
        actor.attackedThisTurn = true;
        const vigorDamage = Math.min(target.vigor, event.appliedDamage);
        target.vigor -= vigorDamage;
        target.hp = Math.max(0, target.hp - (event.appliedDamage - vigorDamage));
        if (event.appliedDamage > 0 && actor.side !== target.side) target.statuses = target.statuses.filter((status) => status !== 'pacified');
        break;
      }
      case 'ABILITY_RESOLVED': {
        const actor = state.actors[event.actorId];
        actor.actionsRemaining -= event.actionCost;
        actor.usedAbilityIds.push(event.abilityId);
        actor.attackedThisTurn ||= event.attackAbility;
        if (event.interrupt) {
          actor.interruptUses[event.abilityId] = (actor.interruptUses[event.abilityId] ?? 0) + 1;
          actor.interruptUsedThisTurn = true;
        }
        if (event.endsTurn) actor.statuses = actor.statuses.filter((status) => status !== 'stunned');
        if (event.attack) {
          const target = state.actors[event.attack.targetId];
          if (event.attack.bypassVigor) target.hp = Math.max(0, target.hp - event.attack.appliedDamage);
          else {
            const vigorDamage = Math.min(target.vigor, event.attack.appliedDamage);
            target.vigor -= vigorDamage;
            target.hp = Math.max(0, target.hp - (event.attack.appliedDamage - vigorDamage));
          }
          if (event.attack.appliedDamage > 0 && actor.side !== target.side) target.statuses = target.statuses.filter((status) => status !== 'pacified');
        }
        break;
      }
      case 'RULE_MUTATIONS_APPLIED': {
        applyRuleMutations(state, event.mutations);
        const actor = state.actors[event.actorId];
        if (event.timing === 'use' || event.timing === 'interrupt') actor.usedAbilityIds.push(event.sourceId);
        actor.attackedThisTurn ||= event.tags.includes('attack');
        if (event.timing === 'interrupt') actor.interruptUsedThisTurn = true;
        break;
      }
      case 'ACTOR_INTERACTED': {
        const actor = state.actors[event.actorId];
        actor.actionsRemaining -= 1;
        actor.usedAbilityIds.push('basic:interact');
        break;
      }
      case 'ACTOR_RESCUED': {
        const actor = state.actors[event.actorId];
        const target = state.actors[event.targetId];
        actor.actionsRemaining -= 1;
        actor.usedAbilityIds.push('basic:rescue');
        target.defeated = false;
        target.hp = event.restoredHp;
        target.vigor = 0;
        target.statuses = [];
        target.turnTaken = true;
        break;
      }
      case 'ACTOR_DEFEATED': {
        const actor = state.actors[event.actorId];
        actor.defeated = true;
        actor.hp = 0;
        actor.vigor = 0;
        actor.statuses = [];
        if (event.woundGained) actor.wounds = Math.min(4, actor.wounds + 1);
        break;
      }
      case 'ACTOR_RECOVERED': {
        const actor = state.actors[event.actorId];
        actor.actionsRemaining -= 2;
        actor.usedAbilityIds.push('basic:recover');
        actor.vigor = Math.min(actor.vitality, actor.vigor + event.vigorGained);
        actor.statuses = actor.statuses.filter((status) => !event.saves.some((save) => save.status === status && save.cleared));
        break;
      }
      case 'STATUS_APPLIED': {
        const target = state.actors[event.targetId];
        if (!target.statuses.includes(event.status)) target.statuses.push(event.status);
        break;
      }
      case 'STATUS_REMOVED': {
        const actor = state.actors[event.actorId];
        actor.statuses = actor.statuses.filter((status) => status !== event.status);
        break;
      }
      case 'TURN_ENDED': {
        const actor = state.actors[event.actorId];
        actor.statuses = actor.statuses.filter((status) => !event.saves.some((save) => save.status === status && save.cleared));
        actor.conditions = actor.conditions.filter((condition) => !event.saves.some((save) => save.status === condition.id && save.cleared && condition.potency !== 'plus'));
        actor.statuses = actor.statuses.filter((status) => status !== 'hatred');
        actor.conditions = actor.conditions.filter(({ id }) => id !== 'hatred');
        actor.ruleState['end-turn-requested'] = false;
        actor.ruleStateOwners['end-turn-requested'] ??= null;
        if (actor.traitIds.includes('stalwart:trait:fortify')) actor.resources.vigilance = (actor.resources.vigilance ?? 0) + 1;
        if (actor.conditions.some(({ id }) => id === 'regeneration') && actor.hp <= actor.baseMaxHp / 2 && !actor.statuses.includes('shattered')) actor.vigor = Math.min(actor.vitality, actor.vigor + 4);
        actor.turnTaken = true;
        if (event.round > state.round) {
          for (const candidate of Object.values(state.actors)) candidate.turnTaken = false;
          state.partyResolve += 1;
        }
        const next = state.actors[event.nextActorId];
        next.actionsRemaining = 2;
        next.standardMoveUsed = false;
        next.attackedThisTurn = false;
        next.interruptUses = {};
        if (next.traitIds.includes('wright:trait:aether')) next.resources.aether = (next.resources.aether ?? 0) + 1;
        for (const candidate of Object.values(state.actors)) {
          candidate.usedAbilityIds = [];
          candidate.interruptUsedThisTurn = false;
          candidate.slashedTriggeredThisTurn = false;
          candidate.dangerousTerrainTriggeredThisTurn = false;
          candidate.ruleState['damage-immune'] = false;
          candidate.ruleStateOwners['damage-immune'] ??= null;
        }
        state.round = event.round;
        state.activeActorId = event.nextActorId;
        state.lastSide = actor.side;
        break;
      }
      case 'ENCOUNTER_ENDED':
        state.phase = 'complete';
        state.activeActorId = null;
        state.partyResolve = 0;
        for (const actor of Object.values(state.actors)) {
          actor.vigor = 0;
          actor.statuses = [];
          actor.conditions = actor.conditions.filter(({ duration }) => duration?.kind === 'expedition');
          actor.activeEffects = actor.activeEffects.filter(({ duration }) => duration.kind === 'expedition');
          actor.marks = [];
          actor.stance = null;
          actor.resources.aether = 0;
          actor.resources.combo = 0;
          actor.resources.blessing = 0;
        }
        state.entities = Object.fromEntries(Object.entries(state.entities).filter(([, entity]) => entity.type === 'object'));
        break;
    }
    state.revision += 1;
    state.eventLog.push(clone(event));
  }
  if (state.eventLog.length > MAX_ENCOUNTER_EVENT_LOG) {
    state.eventLog = state.eventLog.slice(-MAX_ENCOUNTER_EVENT_LOG);
  }
  return state;
}

export function replayEncounter(initial: EncounterState, events: EncounterEvent[]) {
  return applyEvents({ ...clone(initial), eventLog: [], revision: 0 }, events);
}
