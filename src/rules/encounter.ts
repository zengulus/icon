import { ENCOUNTER_SCHEMA_VERSION, RULES_VERSION, type CommandResult, type EncounterActiveEffect, type EncounterActor, type EncounterCommand, type EncounterCondition, type EncounterEvent, type EncounterMark, type EncounterPendingInterrupt, type EncounterState, type IconCharacter, type Position, type StatusId } from './types.js';
import { findAbility, findClass, findJob } from './catalog.js';
import { FOE_PROFILES, findFoeProfile, findFoeRole } from './foes.js';
import { characterStats } from './character.js';
import { randomDice, rollBoonOrCurse, rollDamage, type DiceSource } from './dice.js';
import { compileRuleSourceUnit } from './automation/compiler.js';
import type { RuleExecutionContext, RuleExecutionResult, RuleMutation, RuleProgram, RuleResolverRegistry, RuleTiming } from './automation/types.js';
import { SAVE_REROLL_INTERRUPT_IDS, compileManualRuleProgram, isIndependentlyExecutableAbility, isIndependentlyExecutableManualProgram } from './automation/manual-programs.js';
import { initialCharacterResources, perEncounterCharacterResourceIds } from './core.js';
import { applyHeldDamage, applyRuleMutations, deferrableEffectWindow, defyDeathActive, encounterConditionSet, encounterRuleState, gentlenessReflection, hatredDivertsDamage, isBloodied, reactiveRuleTriggers, retaliate, saveRerollWindow } from './automation/encounter-adapter.js';
import { executeRuleProgram, orderedSelectedSteps, rerollSaveMutations } from './automation/runtime.js';
import { RULE_RESOLVERS } from './automation/resolvers.js';
import { findRuleSourceUnit } from './source-units.js';
import { planMovementPath } from './movement.js';
import { durableAssetUrlProblem } from './durable-assets.js';
import { axisDirection, orthogonalNeighbors, squareArea } from './area-geometry.js';

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
    pendingInterrupts: [],
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
    pendingInterrupts: clone(candidate.pendingInterrupts ?? []),
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
    resources: initialCharacterResources(character.personalResolve),
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

/** ICON p.103 Combo: true when the ability's independently reviewed program
 * ships a combo version, so using its base version grants a combo token. */
function hasComboVersion(sourceId: string): boolean {
  const unit = findRuleSourceUnit(sourceId);
  if (!unit) return false;
  const compilation = compileManualRuleProgram(unit);
  return compilation?.program.actions.some((action) => action.id === 'combo') ?? false;
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

function movementEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'MOVE' }>, dice: DiceSource): EncounterEvent[] {
  const plan = planMovementPath(state, command.actorId, command.path, command.mode);
  if (!plan.legal) {
    const failure = plan.issue ?? { code: 'move.invalid', message: 'That movement cannot be taken.' };
    throw new RuleViolation(failure.code, failure.message);
  }
  const actor = state.actors[command.actorId]!;
  // Six Hells Trigram (p.129): while active, a foe inside that attempts to
  // exit must first pass a save. On a failed save the space outside is not
  // valid to move to, so the exit move is rejected.
  if (actor.side === 'foes') {
    const trigram = state.terrainEffects.find((effect) => effect.terrain === 'six-hells-trigram' && effect.ownerId && state.actors[effect.ownerId]?.ruleState['six-hells:stage'] === 'active');
    if (trigram) {
      const inside = (position: Position) => trigram.positions.some((cell) => samePosition(cell, position));
      if (inside(actor.position) && !inside(plan.destination) && dice.die(20) < 10) {
        throw new RuleViolation('move.trigram-boundary', `${actor.name} is trapped: the save to leave the Six Hells Trigram failed.`);
      }
    }
  }
  const hpAfterDanger = Math.max(0, actor.hp - plan.dangerousDamage);
  const hpAfterSlashed = Math.max(0, hpAfterDanger - Math.max(0, plan.slashedDamage - actor.vigor));
  const events: EncounterEvent[] = [{ type: 'ACTOR_MOVED', actorId: actor.id, path: plan.path, mode: plan.mode, dangerousDamage: plan.dangerousDamage, slashedDamage: plan.slashedDamage }];
  if (hpAfterSlashed === 0 && !defyDeathActive(actor)) events.push({ type: 'ACTOR_DEFEATED', actorId: actor.id, woundGained: actor.side === 'heroes' });
  return events;
}

function attackEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'BASIC_ATTACK' }>, dice: DiceSource): EncounterEvent[] {
  const actor = assertActive(state, command.actorId);
  const target = state.actors[command.targetId];
  const cost = command.weight === 'heavy' ? 2 : 1;
  if (!target || target.defeated || target.side === actor.side) throw new RuleViolation('attack.invalid-target', 'Basic attacks require a living foe.');
  if (encounterConditionSet(target).has('stealth') && distance(actor.position, target.position) > 1) throw new RuleViolation('attack.stealth', 'A stealthy character can only be directly targeted from adjacency.');
  if (actor.attackedThisTurn) throw new RuleViolation('attack.limit', 'A character can only use one attack ability per turn.');
  if (actor.ruleState['weapon-deployed'] === true) throw new RuleViolation('attack.deployed', 'You cannot attack while your thrown weapon is deployed.');
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
  if (massiveOverheadArmed(actor)) actor.resources['bonus-damage'] = (actor.resources['bonus-damage'] ?? 0) + 1;
  const bonusDice = (critical ? 1 : 0) + Math.max(0, actor.resources['bonus-damage'] ?? 0);
  const damageRoll = rollDamage(actor.damageDie, hit ? (command.weight === 'heavy' ? 2 : 1) : 0, bonusDice, dice);
  let rawDamage = (hit ? damageRoll.total : 0) + actor.fray;
  if (actor.statuses.includes('weakened')) rawDamage = Math.max(0, rawDamage - 2);
  if (actor.statuses.includes('pacified')) rawDamage = Math.ceil(rawDamage / 2);
  if (hatredDivertsDamage(state, actor, target)) rawDamage = Math.ceil(rawDamage / 2);
  const vulnerableDamage = rawDamage > 0 && target.statuses.includes('vulnerable') ? rawDamage + 1 : rawDamage;
  let reduced = Math.max(0, vulnerableDamage - target.armor);
  if (hasCoverFrom(state, target, actor) && actorElevation <= targetElevation) reduced = Math.ceil(reduced / 2);
  const defeatCeiling = defyDeathActive(target) ? target.vigor + target.hp - 1 : target.vigor + target.hp;
  const appliedDamage = Math.min(reduced, defeatCeiling);
  const willDefeat = !defyDeathActive(target) && appliedDamage >= target.vigor + target.hp;
  const events: EncounterEvent[] = [{ type: 'ATTACK_RESOLVED', actorId: actor.id, targetId: target.id, weight: command.weight, d20, boonDie: boon.modifier, total, hit, critical, rawDamage, appliedDamage }];
  if (willDefeat) events.push({ type: 'ACTOR_DEFEATED', actorId: target.id, woundGained: target.side === 'heroes' });
  return events;
}

/**
 * ICON p.105 Vigilance: spend a charge to roll d6 and either reduce damage
 * to a nearby ally (`guard`) or damage a foe breaking adjacency (`punish`).
 * The incoming damage for `guard` is the already-determined, not-yet-applied
 * amount (the same window Righteous Disdain uses), so the reducer does not
 * re-apply armor or cover.
 */
function vigilanceEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'SPEND_VIGILANCE' }>, dice: DiceSource): EncounterEvent[] {
  if (state.phase !== 'active') throw new RuleViolation('encounter.not-active', 'The encounter is not active.');
  const actor = state.actors[command.actorId];
  if (!actor || actor.defeated || !actor.onBattlefield) throw new RuleViolation('vigilance.unavailable', 'That actor cannot spend vigilance.');
  if ((actor.resources.vigilance ?? 0) < 1) throw new RuleViolation('vigilance.charges', 'No vigilance charges remain.');
  const target = state.actors[command.targetId];
  if (!target || target.defeated || !target.onBattlefield) throw new RuleViolation('vigilance.target', 'That vigilance target is unavailable.');
  if (command.use === 'guard' && target.side !== actor.side) throw new RuleViolation('vigilance.ally', 'Guard can only protect an ally.');
  if (command.use === 'punish' && target.side === actor.side) throw new RuleViolation('vigilance.foe', 'Punish can only damage a foe.');
  const roll = dice.die(6);
  const appliedDamage = command.use === 'guard' ? Math.max(0, (command.damage ?? 0) - roll) : roll;
  const events: EncounterEvent[] = [{ type: 'VIGILANCE_SPENT', actorId: actor.id, targetId: target.id, use: command.use, roll, appliedDamage }];
  if (!defyDeathActive(target) && appliedDamage >= target.vigor + target.hp) events.push({ type: 'ACTOR_DEFEATED', actorId: target.id, woundGained: target.side === 'heroes' });
  return events;
}

function abilityRange(header: string, listedRange: number | null) {
  if (listedRange !== null) return listedRange;
  const area = header.match(/\b(?:line|arc)\s+(\d+)/i);
  return area ? Number(area[1]) : 1;
}

/**
 * State-derived triggers (ICON p.95) are inferred from the current encounter
 * before a resolver runs, instead of relying on the caller to assert them:
 * Charge fires on a slow turn, Comeback while the user is bloodied, and
 * Finishing Blow when targeting a bloodied foe. Exceed is added by the VM's
 * attack effect at a total of 15+; Heroic and Infuse remain caller choices
 * because they gate a resource spend or a Stalwart gambit decision.
 */
function deriveTriggers(state: EncounterState, actor: EncounterActor, attackTargetId?: string): Set<string> {
  const triggers = new Set<string>();
  if (actor.ruleState['slow-turn'] === true) triggers.add('charge');
  if (isBloodied(actor)) triggers.add('comeback');
  const target = attackTargetId ? state.actors[attackTargetId] : undefined;
  if (target && target.side !== actor.side && isBloodied(target)) triggers.add('finishing-blow');
  return triggers;
}

/**
 * Run a program twice when a reactive trigger (Collide or Slay) is only
 * knowable after its mutations resolve: the first pass produces the base
 * mutations, a dry run of those mutations predicts the reactive triggers, and
 * a second append-only pass resolves the newly-qualifying trigger steps. The
 * append pass pays no costs and re-runs no resolver, so its extra dice rolls
 * are the next values from the same source rather than re-rolls of the base.
 *
 * Trigger-ordering contract (ICON p.85, p.107 §4): an ability's effects
 * resolve in source-listing order. Static triggers (charge, comeback,
 * finishing blow, exceed, and asserted heroic/infuse) fire at their listed
 * positions in the first pass. Reactive triggers (collide, slay) depend on
 * the base effect's resolution, so they activate immediately after the base
 * pass — which is their listed position, because a collide/slay clause always
 * follows the effect that reveals it. Mutations therefore apply base-first
 * and then the reactive steps in source-listing order, deterministically.
 */
export function executeRuleProgramWithReactiveTriggers(
  program: RuleProgram,
  context: RuleExecutionContext,
  resolvers: RuleResolverRegistry,
  state: EncounterState,
): RuleExecutionResult {
  const first = executeRuleProgram(program, context, resolvers);
  const missing = [...reactiveRuleTriggers(state, first.mutations)].filter((trigger) => !context.triggers?.has(trigger));
  if (missing.length === 0) return first;
  const additional = executeRuleProgram(program, {
    ...context,
    triggers: new Set([...(context.triggers ?? []), ...missing]),
  }, resolvers, { onlyTriggers: new Set(missing) });
  return {
    ...first,
    mutations: [...first.mutations, ...additional.mutations],
    selectedSteps: orderedSelectedSteps(first.selectedAction, [...first.selectedSteps, ...additional.selectedSteps]),
  };
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
  if (attackAbility && actor.ruleState['weapon-deployed'] === true) throw new RuleViolation('attack.deployed', 'You cannot attack while your thrown weapon is deployed.');
  const noAttackSpace = /\bno attack space\b/i.test(ability.rulesText);
  const targetIds = command.targetIds.length === 0 && ability.tags.includes('self') ? [actor.id] : [...command.targetIds];
  if (attackAbility && !noAttackSpace && targetIds.length !== 1) throw new RuleViolation('attack.target-count', 'Choose exactly one attack target.');
  const targets = targetIds.map((targetId) => state.actors[targetId]);
  if (targets.some((target) => !target || target.defeated)) throw new RuleViolation('ability.invalid-target', 'One or more ability targets are unavailable.');
  if (attackAbility && !noAttackSpace && targets[0].side === actor.side) throw new RuleViolation('attack.invalid-target', 'Attacks can only target foes.');
  if (attackAbility && !noAttackSpace && !ability.tags.includes('true strike') && encounterConditionSet(targets[0]).has('stealth') && distance(actor.position, targets[0].position) > 1) {
    throw new RuleViolation('ability.stealth', 'A stealthy character can only be directly targeted from adjacency.');
  }

  // Independently executable abilities resolve through their hand-authored
  // typed RuleProgram and named deterministic resolvers; the generic
  // cost/attack approximation is never used. The typed program's selectors
  // enforce their own target ranges, so the reducer only keeps the generic
  // attack-range and line-of-sight gate for the single attack target.
  if (attackAbility && !noAttackSpace) {
    const attackTargetActor = targets[0];
    const maximumRange = actor.statuses.includes('blind') && !ability.tags.includes('true strike') ? Math.min(2, abilityRange(ability.header, ability.range)) : abilityRange(ability.header, ability.range);
    if (distance(actor.position, attackTargetActor.position) > maximumRange) throw new RuleViolation('ability.range', `${attackTargetActor.name} is outside this ability’s range.`);
    if (!hasLineOfSight(state, actor.position, attackTargetActor.position)) throw new RuleViolation('ability.line-of-sight', `${attackTargetActor.name} is outside line of sight.`);
  }
  for (const target of targets) {
    if (target.id === actor.id && !ability.tags.includes('self')) throw new RuleViolation('ability.self-target', 'Abilities cannot target their user unless they specify Self.');
  }

  const timing: RuleTiming = interrupt ? 'interrupt' : 'use';
  const unit = findRuleSourceUnit(ability.id);
  if (!unit) throw new RuleViolation('ability.unresolved', `${ability.name} has no indexed source rule.`);
  const compilation = compileRuleSourceUnit(unit);
  if (compilation.unsupportedClauses.length > 0) throw new RuleViolation('ability.unresolved', `${ability.name} still has ${compilation.unsupportedClauses.length} unsupported source clause${compilation.unsupportedClauses.length === 1 ? '' : 's'}.`);
  const programAction = compilation.program.actions.find(({ timing: actionTiming }) => actionTiming === timing);
  if (!programAction) throw new RuleViolation('ability.unresolved', `${ability.name} has no executable ${timing} action.`);
  // An ability ends the turn when the source header says so or when its
  // hand-authored program declares it (e.g. Six Hells Trigram's "End your
  // turn" even though the extraction tags it as a delay/terrain effect).
  const endsTurn = ability.tags.includes('end turn') || programAction.tags.includes('end turn') || actor.statuses.includes('stunned');
  const abilityTriggers = deriveTriggers(state, actor, targets[0]?.id);
  // ICON p.134 Massive Overhead: the next attack gains a bonus damage die;
  // if its target is already in a pit, every exceed effect also activates.
  if (attackAbility && !noAttackSpace && targets[0] && massiveOverheadArmed(actor)) {
    actor.resources['bonus-damage'] = (actor.resources['bonus-damage'] ?? 0) + 1;
    if (targetInPit(state, targets[0])) abilityTriggers.add('exceed');
  }
  // ICON p.157 Ace: the next attack triggers every exceed effect (the daze and
  // unerring half resolve when the attack lands in the reducer).
  if (attackAbility && !noAttackSpace && targets[0] && actor.ruleState['ace:armed'] === true) {
    abilityTriggers.add('exceed');
  }
  const ruleContext: RuleExecutionContext = {
    state: encounterRuleState(state),
    actorId: actor.id,
    sourceId: ability.id,
    actionId: programAction.id,
    timing,
    input: { actorIds: { target: targetIds } },
    dice,
    ...(attackAbility && !noAttackSpace && targets[0] ? { attackTargetId: targets[0].id } : {}),
    triggers: abilityTriggers,
  };
  const result = executeRuleProgramWithReactiveTriggers(compilation.program, ruleContext, RULE_RESOLVERS, state);
  let events: EncounterEvent[] = [attachSaveReroll(state, actor.id, ability.id, ruleContext, dice, {
    type: 'RULE_MUTATIONS_APPLIED',
    actorId: actor.id,
    sourceId: ability.id,
    actionId: programAction.id,
    timing,
    tags: [...programAction.tags],
    mutations: result.mutations,
  })];
  if (endsTurn && !interrupt) {
    const intermediate = applyEvents(state, events);
    const acting = intermediate.actors[actor.id];
    if (!acting.defeated) {
      const next = nextActor(intermediate, acting);
      const carnevaleGamble = carnevaleGambleForTurnEnd(intermediate, acting, dice);
      const monogatariGamble = monogatariGambleForTurnEnd(intermediate, acting, dice);
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(acting, dice, ['stunned']), ...(carnevaleGamble !== undefined ? { carnevaleGamble } : {}), ...(monogatariGamble !== undefined ? { monogatariGamble } : {}) });
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
      events = movementEvents(state, command, dice);
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
      // ICON p.152 Chronotemper: "While marked, that character can use the
      // following interrupt: Cheat Time" — the mark grants ownership, so the
      // interrupt only executes for a character holding a `cheat-time` mark,
      // and the generic ability-ownership gate is skipped for it.
      const cheatTimeMarked = unit.id === 'fool:chronotemper' && command.actionId === 'cheat-time'
        && actor.marks.some(({ markId }) => markId === 'cheat-time');
      if (unit.id === 'fool:chronotemper' && command.actionId === 'cheat-time' && !cheatTimeMarked) {
        throw new RuleViolation('rule.not-owned', 'Cheat Time can only be used by the character marked by Chronotemper.');
      }
      if ((unit.kind === 'job-ability' || unit.kind === 'foe-ability') && !cheatTimeMarked && !actor.abilityIds.includes(unit.id)) throw new RuleViolation('rule.not-owned', `${unit.name} is not available to this actor.`);
      if ((unit.kind === 'class-trait' || unit.kind === 'job-trait' || unit.kind === 'foe-trait') && !actor.traitIds.includes(unit.id)) throw new RuleViolation('rule.not-owned', `${unit.name} is not active on this actor.`);
      const compilation = compileRuleSourceUnit(unit);
      if (compilation.unsupportedClauses.length > 0) throw new RuleViolation('rule.not-executable', `${unit.name} still has ${compilation.unsupportedClauses.length} unsupported source clause${compilation.unsupportedClauses.length === 1 ? '' : 's'}.`);
      const action = compilation.program.actions.find(({ id, timing }) => id === command.actionId && timing === command.timing);
      if (!action) throw new RuleViolation('rule.action-unknown', 'That rule action is not available at this timing.');
      if (action.tags.includes('attack') && actor.attackedThisTurn) throw new RuleViolation('attack.limit', 'A character can only use one attack ability per turn.');
      if (action.tags.includes('attack') && actor.ruleState['weapon-deployed'] === true) throw new RuleViolation('attack.deployed', 'You cannot attack while your thrown weapon is deployed.');
      if (command.attackTargetId) {
        const target = state.actors[command.attackTargetId];
        if (!target || target.defeated || !target.onBattlefield) throw new RuleViolation('attack.invalid-target', 'That rule target is unavailable.');
        if (action.tags.includes('attack') && target.side === actor.side) throw new RuleViolation('attack.invalid-target', 'Attacks can only target foes.');
        if (action.tags.includes('attack') && !action.tags.includes('true strike') && encounterConditionSet(target).has('stealth') && distance(actor.position, target.position) > 1) throw new RuleViolation('ability.stealth', 'A stealthy character can only be directly targeted from adjacency.');
        const maximumRange = action.range?.kind === 'constant' ? action.range.value : 1;
        if (distance(actor.position, target.position) > maximumRange) throw new RuleViolation('ability.range', `${target.name} is outside this rule action’s range.`);
        if (!hasLineOfSight(state, actor.position, target.position)) throw new RuleViolation('ability.line-of-sight', `${target.name} is outside line of sight.`);
      }
      const triggers = deriveTriggers(state, actor, command.attackTargetId);
      for (const trigger of command.triggers ?? []) triggers.add(trigger);
      // ICON p.134 Massive Overhead arms the next attack resolved through the
      // generic VM as well as through USE_ABILITY.
      if (command.attackTargetId && action.tags.includes('attack') && massiveOverheadArmed(actor)) {
        actor.resources['bonus-damage'] = (actor.resources['bonus-damage'] ?? 0) + 1;
        const overheadTarget = state.actors[command.attackTargetId];
        if (overheadTarget && targetInPit(state, overheadTarget)) triggers.add('exceed');
      }
      // ICON p.157 Ace: the next attack triggers every exceed effect.
      if (command.attackTargetId && action.tags.includes('attack') && actor.ruleState['ace:armed'] === true) {
        triggers.add('exceed');
      }
      const ruleContext: RuleExecutionContext = {
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
        triggers,
      };
      const result = executeRuleProgramWithReactiveTriggers(compilation.program, ruleContext, RULE_RESOLVERS, state);
      for (const mutation of result.mutations) {
        if (mutation.kind === 'actions' && mutation.operation === 'spend' && mutation.amount > actor.actionsRemaining) throw new RuleViolation('action.insufficient', `${unit.name} costs more actions than are available.`);
        if (mutation.kind === 'resource' && mutation.operation === 'spend') {
          const available = mutation.resourceId === 'resolve' ? state.partyResolve + (actor.resources['personal-resolve'] ?? 0) : actor.resources[mutation.resourceId] ?? 0;
          if (mutation.amount > available) throw new RuleViolation('resource.insufficient', `${unit.name} requires ${mutation.amount} ${mutation.resourceId}.`);
        }
      }
      events = [attachSaveReroll(state, actor.id, unit.id, ruleContext, dice, {
        type: 'RULE_MUTATIONS_APPLIED',
        actorId: actor.id,
        sourceId: unit.id,
        actionId: command.actionId,
        timing: command.timing,
        tags: [...action.tags],
        mutations: result.mutations,
      })];
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
    case 'SPEND_VIGILANCE':
      events = vigilanceEvents(state, command, dice);
      break;
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
      const carnevaleGamble = carnevaleGambleForTurnEnd(state, actor, dice);
      const monogatariGamble = monogatariGambleForTurnEnd(state, actor, dice);
      events = [{ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor, dice), ...(carnevaleGamble !== undefined ? { carnevaleGamble } : {}), ...(monogatariGamble !== undefined ? { monogatariGamble } : {}) }];
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
      const carnevaleGamble = carnevaleGambleForTurnEnd(intermediate, actor, dice);
      const monogatariGamble = monogatariGambleForTurnEnd(intermediate, actor, dice);
      events.push({ type: 'STATUS_REMOVED', actorId: actor.id, status: 'stunned' });
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor, dice, ['stunned']), ...(carnevaleGamble !== undefined ? { carnevaleGamble } : {}), ...(monogatariGamble !== undefined ? { monogatariGamble } : {}) });
    }
  }
  if (command.type === 'EXECUTE_RULE' && command.timing === 'use') {
    const intermediate = applyEvents(state, events);
    const actor = intermediate.actors[command.actorId];
    if (actor && !actor.defeated && (state.actors[command.actorId]?.statuses.includes('stunned') || actor.ruleState['end-turn-requested'] === true)) {
      const next = nextActor(intermediate, actor);
      const carnevaleGamble = carnevaleGambleForTurnEnd(intermediate, actor, dice);
      const monogatariGamble = monogatariGambleForTurnEnd(intermediate, actor, dice);
      if (actor.statuses.includes('stunned')) events.push({ type: 'STATUS_REMOVED', actorId: actor.id, status: 'stunned' });
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor, dice, ['stunned']), ...(carnevaleGamble !== undefined ? { carnevaleGamble } : {}), ...(monogatariGamble !== undefined ? { monogatariGamble } : {}) });
    }
  }
  return { state: applyEvents(state, events), events };
}

/**
 * ICON p.124 Great Giorgios: when the marked foe's turn ends, its user may
 * rush up to 4 spaces (each space strictly closer to the foe), then the foe
 * is shoved that many spaces and takes that many + 2 damage. Deterministic:
 * the rush follows the dominant axis and stops at occupancy, the grid edge,
 * or when the next space would not be closer. The mark is consumed either
 * way, so a defeated or absent owner cannot leave stale marks behind.
 */
function resolveDelayedMarkEffects(state: EncounterState, actor: EncounterActor) {
  const pending = actor.marks.filter((mark) => mark.markId === 'great-giorgios');
  if (pending.length === 0) return;
  actor.marks = actor.marks.filter((mark) => mark.markId !== 'great-giorgios');
  const distanceTo = (position: Position) => Math.max(Math.abs(position.x - actor.position.x), Math.abs(position.y - actor.position.y));
  const blockedCell = (position: Position, moverId: string) => position.x < 0 || position.y < 0
    || position.x >= state.grid.width || position.y >= state.grid.height
    || Object.values(state.actors).some((candidate) => candidate.id !== moverId && candidate.onBattlefield && !candidate.defeated && samePosition(candidate.position, position))
    || state.grid.terrain.some((cell) => samePosition(cell.position, position) && cell.type === 'impassable');
  for (const mark of pending) {
    const owner = mark.ownerId ? state.actors[mark.ownerId] : undefined;
    if (!owner || owner.defeated || !owner.onBattlefield) continue;
    let position = { ...owner.position };
    let steps = 0;
    while (steps < 4) {
      const dx = actor.position.x - position.x;
      const dy = actor.position.y - position.y;
      const next = Math.abs(dx) >= Math.abs(dy)
        ? { x: position.x + Math.sign(dx), y: position.y }
        : { x: position.x, y: position.y + Math.sign(dy) };
      if (distanceTo(next) >= distanceTo(position)) break;
      if (blockedCell(next, owner.id)) break;
      position = next;
      steps += 1;
    }
    owner.position = position;
    if (distanceTo(position) > 1 || actor.defeated) continue;
    const dx = actor.position.x - position.x;
    const dy = actor.position.y - position.y;
    const direction = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 0, y: 0 } : { x: 0, y: Math.sign(dy) || 0 };
    let shoved = 0;
    while (shoved < steps) {
      const next = { x: actor.position.x + direction.x, y: actor.position.y + direction.y };
      if (blockedCell(next, actor.id)) break;
      actor.position = next;
      shoved += 1;
    }
    const damage = steps + 2;
    actor.hp = Math.max(defyDeathActive(actor) ? 1 : 0, actor.hp - damage);
    if (actor.hp <= 0 && !defyDeathActive(actor)) {
      actor.defeated = true;
      actor.vigor = 0;
      actor.statuses = [];
      if (actor.side === 'heroes') actor.wounds = Math.min(4, actor.wounds + 1);
    }
  }
}

type DurationBoundary = 'turn-start' | 'turn-end' | 'round-start' | 'round-end';

interface BoundaryEffect {
  actorId: string;
  ownerId: string | null;
  kind: 'condition' | 'effect';
  record: EncounterCondition | EncounterActiveEffect;
  order: number;
}

/**
 * ICON p.107 — when effects resolve at the same time: effects that do not
 * belong to the turn character resolve first, then the turn character's; and
 * hostile effects (owned by the turn character's foes) resolve before
 * beneficial effects (owned by allies or the turn character). Same-owner
 * effects keep their listed order, the deterministic stand-in for the owning
 * player's choice. The result is a stable total order keyed on
 * (turn-character?, hostile?) with listing order as the final tiebreak.
 */
export function orderCrossCharacterEffects(state: EncounterState, turnActorId: string, pending: BoundaryEffect[]): BoundaryEffect[] {
  const turnSide = state.actors[turnActorId]?.side;
  const rank = (entry: BoundaryEffect): [number, number] => {
    const turn = entry.ownerId === turnActorId ? 1 : 0;
    const owner = entry.ownerId ? state.actors[entry.ownerId] : undefined;
    const hostile = owner && owner.side !== turnSide ? 0 : 1;
    return [turn, hostile];
  };
  return [...pending].sort((first, second) => {
    const [firstTurn, firstHostile] = rank(first);
    const [secondTurn, secondHostile] = rank(second);
    if (firstTurn !== secondTurn) return firstTurn - secondTurn;
    if (firstHostile !== secondHostile) return firstHostile - secondHostile;
    return first.order - second.order;
  });
}

/**
 * ICON p.107 — Interrupt Order. Interrupts resolve with the most recently
 * triggered interrupt first: nested interrupts (windows opened later, e.g. by
 * another interrupt's effect) have a higher `triggeredAt` and resolve before
 * the window that opened them. Interrupts that share a trigger and trigger at
 * the same time resolve in the same order as turns — the turn character's
 * side first, then alternating sides, with same-side entries keeping their
 * registration order as the deterministic stand-in for the players' choice.
 * The result is a stable total order keyed on (triggeredAt desc, side,
 * registration order).
 */
export function orderInterrupts(state: EncounterState, turnActorId: string, pending: EncounterPendingInterrupt[]): EncounterPendingInterrupt[] {
  const turnSide = state.actors[turnActorId]?.side;
  const sideRank = (actorId: string): number => (state.actors[actorId]?.side === turnSide ? 0 : 1);
  return [...pending].sort((first, second) => {
    if (first.triggeredAt !== second.triggeredAt) return second.triggeredAt - first.triggeredAt;
    if (first.trigger !== second.trigger) return first.trigger.localeCompare(second.trigger);
    const bySide = sideRank(first.actorId) - sideRank(second.actorId);
    if (bySide !== 0) return bySide;
    return first.order - second.order;
  });
}

/** Pop (LIFO) the most recently triggered interrupt window for `actorId` and
 * return it. An interrupt answers the most recently triggered window that is
 * still holding damage — windows opened by the interrupt's own later damage
 * are newer triggers, not the window being answered. Falls back to the most
 * recently triggered plain window (no held damage) for interrupts that answer
 * a trigger with no deferral. */
function popInterruptWindow(state: EncounterState, actorId: string): EncounterPendingInterrupt | undefined {
  for (let index = state.pendingInterrupts.length - 1; index >= 0; index -= 1) {
    if (state.pendingInterrupts[index].actorId === actorId && state.pendingInterrupts[index].heldDamage) {
      return state.pendingInterrupts.splice(index, 1)[0];
    }
  }
  for (let index = state.pendingInterrupts.length - 1; index >= 0; index -= 1) {
    if (state.pendingInterrupts[index].actorId === actorId) {
      return state.pendingInterrupts.splice(index, 1)[0];
    }
  }
  return undefined;
}

/** ICON p.151 Masquerade: the interrupt swaps places with a willing ally and
 * the held ability targets the ally instead — every effect aimed at
 * `fromActorId` (and any attack whose target was them) is retargeted. */
function retargetEffects(mutations: RuleMutation[], from: string, to: string): RuleMutation[] {
  return mutations.map((mutation) => {
    if ('actorId' in mutation && mutation.actorId === from) return { ...mutation, actorId: to };
    if (mutation.kind === 'attack' && mutation.targetId === from) return { ...mutation, targetId: to };
    return mutation;
  });
}

/** The held effects of a window, retargeted when the interrupt redirects the
 * ability (Masquerade). */
function resolveHeldEffects(state: EncounterState, window: EncounterPendingInterrupt) {
  if (!window.heldEffects || window.heldEffects.length === 0) return;
  const effects = window.retarget ? retargetEffects(window.heldEffects, window.retarget.fromActorId, window.retarget.toActorId) : window.heldEffects;
  applyRuleMutations(state, effects);
}

/** ICON p.143 Sucker Punch: when the interrupt executes and a `save-rolled`
 * window is open for the user, the command layer (which owns the dice) rolls
 * the re-roll and regenerates the save's branch, carrying both on the event
 * so the reducer can apply them replay-exactly after the window pops. */
function attachSaveReroll(
  state: EncounterState,
  actorId: string,
  interruptSourceId: string,
  context: RuleExecutionContext,
  dice: DiceSource,
  event: Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }>,
): Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }> {
  if (!SAVE_REROLL_INTERRUPT_IDS[interruptSourceId]) return event;
  const saveWindow = state.pendingInterrupts.find((window) => window.actorId === actorId && window.trigger === 'save-rolled');
  const heldSave = saveWindow?.heldSave;
  if (!heldSave) return event;
  const roll = dice.die(20);
  // ICON p.144 Heroic: "The character rolls the new save with +1 curse." The
  // resolver records the curse as a mutation in this same event; the re-roll
  // applies it here so the regenerated branch is replay-exact.
  const cursed = event.mutations.some((mutation) => mutation.kind === 'state' && mutation.actorId === heldSave.targetId && mutation.key === 'sucker-punch:curse' && mutation.value === true);
  const boon = heldSave.boon - (cursed ? 1 : 0);
  const total = roll + boon;
  return {
    ...event,
    reroll: {
      roll,
      boon,
      total,
      success: total >= 10,
      mutations: rerollSaveMutations(heldSave, context, roll, boon),
    },
  };
}

/** ICON p.107: at a boundary (turn end, encounter end) every open interrupt
 * window closes. Damage that was held unapplied is determined damage — the
 * window was the interrupt opportunity, not a damage cancellation — so it
 * resolves now; actors that became immune or were defeated while the window
 * was open are skipped by `applyHeldDamage`. Held ability effects (Heroic
 * Intervention, Perseus, Masquerade) and held save branches (Sucker Punch)
 * also resolve now when no interrupt answers them. Resolving effects can open
 * new windows, so the queue drains until empty. */
function resolveHeldInterruptWindows(state: EncounterState) {
  while (state.pendingInterrupts.length > 0) {
    const window = state.pendingInterrupts.shift()!;
    if (window.heldDamage) applyHeldDamage(state, window.actorId, window.heldDamage);
    resolveHeldEffects(state, window);
  }
}

/**
 * Expire conditions and persistent effects whose duration names this boundary.
 * Turn boundaries are owner-scoped ("until the start/end of your next turn"),
 * while round boundaries apply to every actor; either way the expirations
 * resolve in the canonical p.107 cross-character order.
 */
function expireBoundaryEffects(state: EncounterState, turnActorId: string, boundary: DurationBoundary) {
  const turnScoped = boundary === 'turn-start' || boundary === 'turn-end';
  const pending: BoundaryEffect[] = [];
  let order = 0;
  for (const candidate of Object.values(state.actors)) {
    for (const condition of candidate.conditions) {
      if (condition.duration?.kind !== boundary || (turnScoped && condition.ownerId !== turnActorId)) continue;
      pending.push({ actorId: candidate.id, ownerId: condition.ownerId, kind: 'condition', record: condition, order: order++ });
    }
    for (const effect of candidate.activeEffects) {
      if (effect.duration.kind !== boundary || (turnScoped && effect.ownerId !== turnActorId)) continue;
      pending.push({ actorId: candidate.id, ownerId: effect.ownerId, kind: 'effect', record: effect, order: order++ });
    }
  }
  for (const entry of orderCrossCharacterEffects(state, turnActorId, pending)) {
    const actor = state.actors[entry.actorId];
    const duration = entry.record.duration;
    if (!duration || duration.kind !== boundary) continue;
    if (duration.kind === 'turn-start' || duration.kind === 'turn-end') {
      const turns = duration.turns ?? 1;
      if (turns > 1) {
        entry.record.duration = { ...duration, turns: turns - 1 };
        continue;
      }
    } else {
      const rounds = duration.rounds ?? 1;
      if (rounds > 1) {
        entry.record.duration = { ...duration, rounds: rounds - 1 };
        continue;
      }
    }
    if (entry.kind === 'condition') actor.conditions = actor.conditions.filter((candidate) => candidate !== entry.record);
    else {
      actor.activeEffects = actor.activeEffects.filter((candidate) => candidate !== entry.record);
      if ('effectId' in entry.record && entry.record.effectId === 'defy-death') actor.resources['bonus-damage'] = 0;
    }
  }
}

/**
 * ICON p.129 Six Hells Trigram: at the start of the user's next turn the
 * pending burst-2 area activates — foes inside are weakened, and with Heroic
 * the area gains rampart and foes inside take the user's fray damage. The
 * terrain effect itself is created by the ability; the stage lives on the
 * owner's rule state so no schema change is needed.
 */
function resolvePendingTrigram(state: EncounterState, owner: EncounterActor) {
  if (owner.ruleState['six-hells:stage'] !== 'pending') return;
  const effect = state.terrainEffects.find((candidate) => candidate.terrain === 'six-hells-trigram' && candidate.ownerId === owner.id);
  if (!effect) return;
  owner.ruleState['six-hells:stage'] = 'active';
  owner.ruleStateOwners['six-hells:stage'] = owner.id;
  const inside = (position: Position) => effect.positions.some((cell) => samePosition(cell, position));
  for (const foe of Object.values(state.actors)) {
    if (foe.side === 'heroes' || !foe.position || !inside(foe.position)) continue;
    applyRuleMutations(state, [
      { kind: 'condition', sourceId: 'demon-slayer:six-hells-trigram', sourceActorId: owner.id, actorId: foe.id, conditionId: 'weakened', operation: 'apply', potency: 'normal' },
      ...(owner.ruleState['six-hells:heroic'] === true ? [{ kind: 'damage', sourceId: 'demon-slayer:six-hells-trigram', sourceActorId: owner.id, actorId: foe.id, amount: owner.fray, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false } as const] : []),
    ]);
  }
  if (owner.ruleState['six-hells:heroic'] === true) {
    state.terrainEffects.push({ id: `six-hells-rampart:${owner.id}:${state.revision}`, sourceId: 'demon-slayer:six-hells-trigram', ownerId: owner.id, terrain: 'rampart', positions: [...effect.positions], height: null, duration: null });
  }
}

/**
 * ICON p.128 Comet: the thrown weapon is picked up when its owner enters,
 * exits, or starts a turn adjacent to it, ending the effect and removing the
 * object. "Cannot attack while deployed" is enforced at the attack boundary.
 */
function pickupThrownWeapon(state: EncounterState, actor: EncounterActor, adjacentCells: readonly Position[]) {
  const weapon = Object.values(state.entities).find((entity) => entity.type === 'object' && entity.ownerId === actor.id && entity.state['thrownWeapon'] === true);
  if (!weapon) return;
  const adjacentToWeapon = (cell: Position) => weapon.positions.some((position) => orthogonalNeighbors(cell).some((neighbor) => samePosition(neighbor, position)));
  if (!adjacentCells.some(adjacentToWeapon)) return;
  delete state.entities[weapon.id];
  actor.ruleState['weapon-deployed'] = false;
  actor.ruleStateOwners['weapon-deployed'] = null;
}

/**
 * ICON p.130 Wicked Sheath: the d4 power die charges at the start of each
 * round (gain at 1, or tick up by 1) and is discarded after the user hits
 * with any attack. The die value is consumed by the Wicked Sheath resolver.
 */
function chargeWickedSheathDie(state: EncounterState) {
  for (const actor of Object.values(state.actors)) {
    if (actor.ruleState['wicked-sheath:charged'] !== true) continue;
    actor.resources['wicked-sheath-die'] = Math.max(1, (actor.resources['wicked-sheath-die'] ?? 0) + 1);
  }
}

function discardWickedSheathDie(actor: EncounterActor) {
  if (actor.ruleState['wicked-sheath:charged'] !== true) return;
  actor.ruleState['wicked-sheath:charged'] = false;
  actor.ruleStateOwners['wicked-sheath:charged'] = null;
  actor.resources['wicked-sheath-die'] = 0;
}

/** ICON p.104 Stealth: most abilities break the user's stealth when used. */
function breakStealth(actor: EncounterActor) {
  actor.conditions = actor.conditions.filter(({ id }) => id !== 'stealth');
}

/** ICON p.134 Massive Overhead: the resolver arms the next attack, which deals
 * bonus damage, creates a pit under its target, and (Comeback/Heroic) adds a
 * small blast of 2 damage. This helper reports the armed state. */
function massiveOverheadArmed(actor: EncounterActor): boolean {
  return actor.ruleState['massive-overhead'] === true;
}

function targetInPit(state: EncounterState, target: EncounterActor): boolean {
  return state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions.some((cell) => samePosition(cell, target.position)));
}

/** Consume Massive Overhead's armed state after the next attack resolves: drop
 * a pit under the target and, on the heroic arm, a small blast (blast 1) that
 * deals 2 damage to every character inside. The bonus damage itself is added
 * at the attack site as an extra keep-highest die, so nothing is spent here. */
function consumeMassiveOverhead(state: EncounterState, actor: EncounterActor, target: EncounterActor) {
  if (!massiveOverheadArmed(actor)) return;
  const heroic = actor.ruleState['massive-overhead:heroic'] === true;
  delete actor.ruleState['massive-overhead'];
  delete actor.ruleStateOwners['massive-overhead'];
  delete actor.ruleState['massive-overhead:heroic'];
  delete actor.ruleStateOwners['massive-overhead:heroic'];
  actor.resources['bonus-damage'] = Math.max(0, (actor.resources['bonus-damage'] ?? 0) - 1);
  state.terrainEffects.push({
    id: `massive-overhead-pit:${actor.id}:${state.revision}`,
    sourceId: 'colossus:massive-overhead',
    ownerId: actor.id,
    terrain: 'pit',
    positions: [{ ...target.position }],
    height: null,
    duration: null,
  });
  if (heroic) {
    const blast = squareArea(target.position, 1);
    const victims = Object.values(state.actors).filter((character) => character.position && blast.some((cell) => samePosition(cell, character.position)));
    applyRuleMutations(state, victims.map((character) => ({
      kind: 'damage' as const, sourceId: 'colossus:massive-overhead', sourceActorId: actor.id, actorId: character.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false,
    })));
  }
}

/**
 * Deterministic turn-boundary lifecycle: duration expiry, Six Hells Trigram
 * activation, the slow-turn flag, and Comet pickup when a turn starts on an
 * adjacent space.
 */
/** ICON p.141 Dark Knight: at the start of the user's turn the hatred+ target
 * refreshes to the currently closest foe; at the end of the turn the stance
 * grants vigilance +1. */
function resolveDarkKnightTurnStart(state: EncounterState, actor: EncounterActor) {
  if (actor.stance?.stanceId !== 'dark-knight' || !actor.position) return;
  const closest = Object.values(state.actors)
    .filter((foe) => foe.side !== actor.side && !foe.defeated && foe.onBattlefield && foe.position)
    .sort((a, b) => distance(a.position, actor.position) - distance(b.position, actor.position) || a.id.localeCompare(b.id))[0];
  if (closest) {
    actor.ruleState['hatred-of'] = closest.id;
    actor.ruleStateOwners['hatred-of'] = actor.id;
  }
}

/** ICON p.142 Intimidate: starting your turn adjacent to the marked foe deals
 * fray damage, stuns them, and ends the mark. */
function resolveIntimidateTurnStart(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  for (const foe of Object.values(state.actors)) {
    const mark = foe.marks.find((candidate) => candidate.markId === 'intimidate' && candidate.ownerId === actor.id);
    if (!mark) continue;
    if (foe.defeated || !foe.onBattlefield || !foe.position || distance(actor.position, foe.position) > 1) continue;
    applyRuleMutations(state, [
      { kind: 'damage', sourceId: 'knave:intimidate', sourceActorId: actor.id, actorId: foe.id, amount: actor.fray, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false },
      { kind: 'condition', sourceId: 'knave:intimidate', sourceActorId: actor.id, actorId: foe.id, conditionId: 'stunned', operation: 'apply', potency: 'normal' },
    ]);
    foe.marks = foe.marks.filter((candidate) => candidate !== mark);
  }
}

/** ICON p.151 Gallows Humor: the stance's d6 power die ticks up by 1 (to a
 * maximum of 6) when the stance refreshes at the start of the user's turn, or
 * whenever you or an ally misses or is missed by an attack anywhere. */
function tickGallowsHumorDie(actor: EncounterActor) {
  if (actor.stance?.stanceId !== 'gallows-humor') return;
  actor.ruleState['gallows-humor:die'] = Math.min(6, Number(actor.ruleState['gallows-humor:die'] ?? 1) + 1);
  actor.ruleStateOwners['gallows-humor:die'] = actor.id;
}

function tickGallowsHumorOnMiss(state: EncounterState) {
  for (const actor of Object.values(state.actors)) tickGallowsHumorDie(actor);
}

function resolveGallowsHumorTurnStart(state: EncounterState, actor: EncounterActor) {
  tickGallowsHumorDie(actor);
}

/** ICON p.156 Exorcism: at the end of any turn where the owner ends in range 3
 * of the marked foe, or that foe ends in range 3 of the owner, set out the d4
 * power die at 1 (or tick it up) and shoot a projectile for 2 unerring damage.
 * When the die reaches its maximum of 4, every projectile flies for 2 damage
 * per charge and the mark ends. */
function resolveExorcismTurnEnd(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  const tick = (mark: EncounterMark, foe: EncounterActor, owner: EncounterActor) => {
    const die = Math.min(4, Number(mark.state.die ?? 0) + 1);
    const charges = Number(mark.state.charges ?? 0) + 1;
    mark.state.die = die;
    mark.state.charges = charges;
    applyRuleMutations(state, [{
      kind: 'damage', sourceId: 'freelancer:exorcism', sourceActorId: owner.id, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
    }]);
    if (die >= 4) {
      applyRuleMutations(state, [{
        kind: 'damage', sourceId: 'freelancer:exorcism', sourceActorId: owner.id, actorId: foe.id, amount: 2 * charges, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
      }]);
      foe.marks = foe.marks.filter((candidate) => candidate !== mark);
    }
  };
  // The owner ended their turn: tick the marks they own whose foe is in range.
  for (const foe of Object.values(state.actors)) {
    const mark = foe.marks.find((candidate) => candidate.markId === 'exorcism' && candidate.ownerId === actor.id);
    if (!mark || foe.defeated || !foe.onBattlefield || !foe.position || distance(actor.position, foe.position) > 3) continue;
    tick(mark, foe, actor);
  }
  // The marked foe ended their turn: tick the marks on this actor whose owner is in range.
  for (const mark of [...actor.marks]) {
    if (mark.markId !== 'exorcism') continue;
    const owner = state.actors[mark.ownerId];
    if (!owner || owner.defeated || !owner.onBattlefield || !owner.position || distance(owner.position, actor.position) > 3) continue;
    tick(mark, actor, owner);
  }
}

/** ICON p.156 Astral Chain: at the start of the user's turn a marked foe in
 * range 3 takes 2 unerring damage (twice, for 4, if at exactly range 3). */
function resolveAstralChainTurnStart(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  for (const foe of Object.values(state.actors)) {
    const mark = foe.marks.find((candidate) => candidate.markId === 'astral-chain' && candidate.ownerId === actor.id);
    if (!mark || foe.defeated || !foe.onBattlefield || !foe.position) continue;
    const d = distance(actor.position, foe.position);
    if (d > 3) continue;
    applyRuleMutations(state, [{
      kind: 'damage', sourceId: 'freelancer:astral-chain', sourceActorId: actor.id, actorId: foe.id, amount: d === 3 ? 4 : 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
    }]);
  }
}

/** ICON p.157 Showdown: at the end of the marked foe's next turn the user may
 * dash 2 (if the foe is within range 3) or the foe takes 2 unerring damage
 * twice (four times on a Finishing Blow) when at range 4 or higher; the mark
 * ends either way. */
function resolveShowdownTurnEnd(state: EncounterState, actor: EncounterActor) {
  const marks = actor.marks.filter((mark) => mark.markId === 'showdown');
  if (marks.length === 0) return;
  actor.marks = actor.marks.filter((mark) => mark.markId !== 'showdown');
  const blocked = (position: Position, moverId: string) => position.x < 0 || position.y < 0
    || position.x >= state.grid.width || position.y >= state.grid.height
    || Object.values(state.actors).some((candidate) => candidate.id !== moverId && candidate.onBattlefield && !candidate.defeated && samePosition(candidate.position, position))
    || state.grid.terrain.some((cell) => samePosition(cell.position, position) && cell.type === 'impassable');
  for (const mark of marks) {
    const owner = state.actors[mark.ownerId];
    if (!owner || owner.defeated || !owner.onBattlefield || !owner.position || !actor.position) continue;
    const d = distance(owner.position, actor.position);
    if (d <= 3) {
      let position = { ...owner.position };
      for (let steps = 0; steps < 2; steps += 1) {
        const dx = actor.position.x - position.x;
        const dy = actor.position.y - position.y;
        const next = Math.abs(dx) >= Math.abs(dy)
          ? { x: position.x + Math.sign(dx), y: position.y }
          : { x: position.x, y: position.y + Math.sign(dy) };
        if (samePosition(next, position) || blocked(next, owner.id)) break;
        position = next;
      }
      owner.position = position;
    } else {
      applyRuleMutations(state, [{
        kind: 'damage', sourceId: 'freelancer:showdown', sourceActorId: owner.id, actorId: actor.id, amount: mark.state.finishing === true ? 8 : 4, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
      }]);
    }
  }
}

/** ICON p.158 Warding Bolts: a foe that starts its turn inside the hover zone
 * and ends it outside is struck for 2 unerring damage and dazed. */
function resolveWardingBoltsTurnStart(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  const effect = state.terrainEffects.find((candidate) =>
    candidate.terrain === 'warding-bolts'
    && candidate.ownerId
    && state.actors[candidate.ownerId]?.side !== actor.side
    && candidate.positions.some((cell) => samePosition(cell, actor.position)));
  if (effect) {
    actor.ruleState['warding-bolts:owner'] = effect.ownerId;
    actor.ruleStateOwners['warding-bolts:owner'] = actor.id;
  }
}

/** ICON p.163 Assassinate: at the end of the marked foe's turn, if still in
 * range 3, the user teleports adjacent, deals 2 damage three times (or just 2
 * if the foe has an adjacent ally), blinds the foe, then flies 2 away. */
function resolveAssassinateTurnEnd(state: EncounterState, actor: EncounterActor) {
  const marks = actor.marks.filter((mark) => mark.markId === 'assassinate');
  if (marks.length === 0) return;
  actor.marks = actor.marks.filter((mark) => mark.markId !== 'assassinate');
  const blocked = (position: Position, moverId: string) => position.x < 0 || position.y < 0
    || position.x >= state.grid.width || position.y >= state.grid.height
    || Object.values(state.actors).some((candidate) => candidate.id !== moverId && candidate.onBattlefield && !candidate.defeated && samePosition(candidate.position, position))
    || state.grid.terrain.some((cell) => samePosition(cell.position, position) && cell.type === 'impassable');
  for (const mark of marks) {
    const owner = state.actors[mark.ownerId];
    if (!owner || owner.defeated || !owner.onBattlefield || !owner.position || !actor.position) continue;
    if (distance(owner.position, actor.position) > 3) continue;
    const adjacent = orthogonalNeighbors(actor.position).find((cell) => !blocked(cell, owner.id));
    if (adjacent) owner.position = { ...adjacent };
    const hasAdjacentAlly = Object.values(state.actors).some((candidate) => candidate.side === actor.side && candidate.id !== actor.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, actor.position) <= 1);
    applyRuleMutations(state, [
      { kind: 'damage', sourceId: 'shade:assassinate', sourceActorId: owner.id, actorId: actor.id, amount: hasAdjacentAlly ? 2 : 6, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true },
      { kind: 'condition', sourceId: 'shade:assassinate', sourceActorId: owner.id, actorId: actor.id, conditionId: 'blind', operation: 'apply', potency: 'normal' },
    ]);
    const away = axisDirection(actor.position, owner.position);
    let position = { ...owner.position };
    for (let step = 0; step < 2; step += 1) {
      const next = { x: position.x + away.x, y: position.y + away.y };
      if (blocked(next, owner.id)) break;
      position = next;
    }
    owner.position = position;
  }
}

/** ICON p.164 Incubus: when a foe ends its turn adjacent to the marked foe (or
 * the marked foe ends its turn adjacent to another foe), the marked foe and
 * every adjacent foe take 2 damage and are dazed, once per round. */
function resolveIncubusTurnEnd(state: EncounterState, actor: EncounterActor) {
  if (actor.side !== 'foes' || !actor.position) return;
  for (const marked of Object.values(state.actors)) {
    const mark = marked.marks.find((candidate) => candidate.markId === 'incubus');
    if (!mark || marked.defeated || !marked.onBattlefield || !marked.position) continue;
    const owner = state.actors[mark.ownerId];
    if (!owner || owner.defeated || owner.ruleState['incubus:triggered'] === true) continue;
    const adjacent = actor.id === marked.id
      ? Object.values(state.actors).some((candidate) => candidate.side === 'foes' && candidate.id !== marked.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, marked.position) <= 1)
      : distance(actor.position, marked.position) <= 1;
    if (!adjacent) continue;
    const targets = [marked, ...Object.values(state.actors).filter((candidate) => candidate.side === 'foes' && candidate.id !== marked.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, marked.position) <= 1)];
    for (const target of targets) {
      applyRuleMutations(state, [
        { kind: 'damage', sourceId: 'shade:incubus', sourceActorId: owner.id, actorId: target.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false },
        { kind: 'condition', sourceId: 'shade:incubus', sourceActorId: owner.id, actorId: target.id, conditionId: 'dazed', operation: 'apply', potency: 'normal' },
      ]);
    }
    owner.ruleState['incubus:triggered'] = true;
    owner.ruleStateOwners['incubus:triggered'] = owner.id;
  }
}

/** ICON p.163 Umbral Echo: at the end of the user's turn, if no foe is adjacent,
 * the stance refreshes and its power die ticks up by 1 (to a maximum of 4). */
function resolveUmbralEchoTurnEnd(state: EncounterState, actor: EncounterActor) {
  if (actor.stance?.stanceId !== 'umbral-echo' || !actor.position) return;
  const adjacentFoe = Object.values(state.actors).some((candidate) => candidate.side !== actor.side && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, actor.position) <= 1);
  if (adjacentFoe) return;
  actor.ruleState['umbral-echo:die'] = Math.min(4, Number(actor.ruleState['umbral-echo:die'] ?? 2) + 1);
  actor.ruleStateOwners['umbral-echo:die'] = actor.id;
}

function resolveWardingBoltsTurnEnd(state: EncounterState, actor: EncounterActor) {
  const ownerId = actor.ruleState['warding-bolts:owner'];
  if (typeof ownerId !== 'string' || !ownerId) return;
  delete actor.ruleState['warding-bolts:owner'];
  delete actor.ruleStateOwners['warding-bolts:owner'];
  const effect = state.terrainEffects.find((candidate) => candidate.terrain === 'warding-bolts' && candidate.ownerId === ownerId);
  if (!effect || !actor.position) return;
  if (effect.positions.some((cell) => samePosition(cell, actor.position))) return;
  applyRuleMutations(state, [
    { kind: 'damage', sourceId: 'freelancer:warding-bolts', sourceActorId: ownerId, actorId: actor.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true },
    { kind: 'condition', sourceId: 'freelancer:warding-bolts', sourceActorId: ownerId, actorId: actor.id, conditionId: 'dazed', operation: 'apply', potency: 'normal' },
  ]);
}

/** ICON p.150 Bomb summon effect: when all bombs are detonated, each explodes
 * in a small blast dealing the (pre-rolled) gamble result; characters caught
 * in overlapping blasts are affected only once. The gamble is rolled at the
 * command boundary so replay stays deterministic. */
function detonateBombs(state: EncounterState, owner: EncounterActor, gamble: number) {
  const bombs = Object.values(state.entities).filter((entity) => entity.type === 'bomb' && entity.ownerId === owner.id);
  if (bombs.length === 0) return;
  const affected = new Set<string>();
  for (const bomb of bombs) {
    if (!bomb.positions[0]) continue;
    for (const cell of squareArea(bomb.positions[0], 1)) {
      for (const character of Object.values(state.actors)) {
        if (!character.defeated && character.onBattlefield && character.position && samePosition(character.position, cell)) affected.add(character.id);
      }
    }
  }
  applyRuleMutations(state, [...affected].map((actorId) => ({
    kind: 'damage' as const, sourceId: 'fool:carnevale', sourceActorId: owner.id, actorId, amount: gamble, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false,
  })));
  for (const bomb of bombs) delete state.entities[bomb.id];
}

/** First in-grid, unoccupied, non-impassable cell within Chebyshev `radius` of
 * `center` (orthogonal neighbors when `orthogonalOnly`), sorted by distance
 * then coordinates so default placement is deterministic (mirrors job-kit's
 * freeCellsInRange ordering). */
function freeCellNear(state: EncounterState, center: Position, radius: number, orthogonalOnly = false): Position | null {
  const occupiedCell = (cell: Position) => Object.values(state.actors).some((candidate) => candidate.onBattlefield && !candidate.defeated && candidate.position && samePosition(candidate.position, cell))
    || Object.values(state.entities).some((entity) => entity.positions[0] && samePosition(entity.positions[0], cell));
  const cells = orthogonalOnly ? orthogonalNeighbors(center) : squareArea(center, radius);
  const candidates: Position[] = [];
  for (const cell of cells) {
    if (samePosition(cell, center) || !positionWithinGrid(cell, state)) continue;
    if (state.grid.terrain.some((t) => samePosition(t.position, cell) && t.type === 'impassable')) continue;
    if (occupiedCell(cell)) continue;
    candidates.push(cell);
  }
  return candidates.sort((a, b) => distance(center, a) - distance(center, b) || a.x - b.x || a.y - b.y)[0] ?? null;
}

/** ICON p.171 Sidhe: at the end of the marked foe's next turn the toxin
 * detonates for 6 damage (reduced to 3 if the foe ends adjacent to an ally),
 * then the mark ends. */
function resolveSidheTurnEnd(state: EncounterState, actor: EncounterActor) {
  const marks = actor.marks.filter((mark) => mark.markId === 'sidhe-toxin');
  if (marks.length === 0) return;
  actor.marks = actor.marks.filter((mark) => mark.markId !== 'sidhe-toxin');
  for (const mark of marks) {
    const owner = state.actors[mark.ownerId];
    if (!owner || owner.defeated || !owner.onBattlefield || !actor.position) continue;
    const adjacentAlly = Object.values(state.actors).some((candidate) =>
      candidate.side === actor.side && candidate.id !== actor.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, actor.position) <= 1);
    applyRuleMutations(state, [{
      kind: 'damage', sourceId: 'warden:sidhe', sourceActorId: owner.id, actorId: actor.id, amount: adjacentAlly ? 3 : 6, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
    }]);
  }
}

/** ICON p.170 Stampede: once per round, at the end of the marked foe's turn,
 * the spirit beast charges in — 2 damage, shove 1 away from the user, then it
 * coalesces into a beast summon adjacent to the foe. The line-from-the-edge
 * geometry and side shoves are table-facing (documented in warden-programs.ts). */
function resolveStampedeTurnEnd(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  for (const mark of [...actor.marks]) {
    if (mark.markId !== 'stampede') continue;
    const owner = state.actors[mark.ownerId];
    if (!owner || owner.defeated || !owner.onBattlefield || owner.ruleState['stampede:triggered'] === true) continue;
    owner.ruleState['stampede:triggered'] = true;
    owner.ruleStateOwners['stampede:triggered'] = owner.id;
    applyRuleMutations(state, [{
      kind: 'damage', sourceId: 'warden:stampede', sourceActorId: owner.id, actorId: actor.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
    }]);
    if (owner.position) {
      const direction = axisDirection(owner.position, actor.position);
      applyRuleMutations(state, [{
        kind: 'move', sourceId: 'warden:stampede', sourceActorId: owner.id, actorId: actor.id, movement: 'shove', distance: 1, positions: [], direction, phasing: false,
      }]);
    }
    const beastCell = freeCellNear(state, actor.position, 1, true);
    if (beastCell) {
      applyRuleMutations(state, [{
        kind: 'entity', sourceId: 'warden:stampede', operation: 'create', entityType: 'beast', ownerId: owner.id, positions: [beastCell], count: 1, state: {},
      }]);
    }
  }
}

/** ICON p.171 Morrigan: at the start of the user's (slow) next turn the flock
 * lashes out — allies in range 2 gain stealth (the optional dash 2 is
 * table-facing), foes in range 2 are shoved 2 away and blinded. */
function resolveMorriganTurnStart(state: EncounterState, actor: EncounterActor) {
  if (actor.ruleState['morrigan:pending'] !== true || !actor.position) return;
  delete actor.ruleState['morrigan:pending'];
  delete actor.ruleStateOwners['morrigan:pending'];
  actor.ruleState['slow-turn'] = true;
  actor.ruleStateOwners['slow-turn'] = actor.id;
  for (const character of Object.values(state.actors)) {
    if (character.defeated || !character.onBattlefield || !character.position) continue;
    if (distance(character.position, actor.position) > 2) continue;
    if (character.side === actor.side) {
      applyRuleMutations(state, [{
        kind: 'condition', sourceId: 'warden:morrigan', sourceActorId: actor.id, actorId: character.id, conditionId: 'stealth', operation: 'apply', potency: 'normal',
      }]);
    } else {
      const direction = axisDirection(actor.position, character.position);
      applyRuleMutations(state, [
        { kind: 'move', sourceId: 'warden:morrigan', sourceActorId: actor.id, actorId: character.id, movement: 'shove', distance: 2, positions: [], direction, phasing: false },
        { kind: 'condition', sourceId: 'warden:morrigan', sourceActorId: actor.id, actorId: character.id, conditionId: 'blind', operation: 'apply', potency: 'normal' },
      ]);
    }
  }
}

/** ICON p.170 Strength of the Pack: when the stance refreshes at the start of
 * the user's turn, summon a beast in a free space in the aura. The optional
 * ally dash 1 is a player choice and is documented as table-facing. */
function resolveStrengthOfThePackTurnStart(state: EncounterState, actor: EncounterActor) {
  if (actor.stance?.stanceId !== 'strength-of-the-pack' || !actor.position) return;
  const beastCell = freeCellNear(state, actor.position, 2);
  if (beastCell) {
    applyRuleMutations(state, [{
      kind: 'entity', sourceId: 'warden:strength-of-the-pack', operation: 'create', entityType: 'beast', ownerId: actor.id, positions: [beastCell], count: 1, state: {},
    }]);
  }
}

/** ICON p.170 Underway: at the end of the user's turn, a second leafy portal
 * grows in a free adjacent space. */
function resolveUnderwayTurnEnd(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  const ownsPortal = Object.values(state.entities).some((entity) => entity.type === 'underway' && entity.ownerId === actor.id);
  if (!ownsPortal) return;
  const portalCell = freeCellNear(state, actor.position, 1, true);
  if (portalCell) {
    applyRuleMutations(state, [{
      kind: 'entity', sourceId: 'warden:underway', operation: 'create', entityType: 'underway', ownerId: actor.id, positions: [portalCell], count: 1, state: {},
    }]);
  }
}

/** ICON p.178 Aria: at the start of the user's (slow) next turn the stunning
 * performance resolves — a blast (small, or medium/large per foe-ability
 * damage taken while pending) centered on the user: foes take fray twice and
 * are sealed, sealed or pacified foes are shoved 1 away, allies are cured. */
function resolveAriaTurnStart(state: EncounterState, actor: EncounterActor) {
  if (actor.ruleState['aria:pending'] !== true || !actor.position) return;
  delete actor.ruleState['aria:pending'];
  delete actor.ruleStateOwners['aria:pending'];
  const damaged = Number(actor.ruleState['aria:damaged'] ?? 0);
  delete actor.ruleState['aria:damaged'];
  delete actor.ruleStateOwners['aria:damaged'];
  actor.ruleState['slow-turn'] = true;
  actor.ruleStateOwners['slow-turn'] = actor.id;
  const radius = damaged >= 2 ? 3 : damaged >= 1 ? 2 : 1;
  const area = squareArea(actor.position, radius);
  for (const character of Object.values(state.actors)) {
    if (character.defeated || !character.onBattlefield || !character.position) continue;
    if (!area.some((cell) => samePosition(cell, character.position))) continue;
    if (character.side === actor.side) {
      applyRuleMutations(state, [{ kind: 'cure', sourceId: 'chanter:aria', actorId: character.id, all: false }]);
    } else {
      applyRuleMutations(state, [
        { kind: 'damage', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, amount: actor.fray, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
        { kind: 'damage', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, amount: actor.fray, damageType: 'normal', instance: 2, delivery: 'area', ignoreCover: false },
        { kind: 'condition', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, conditionId: 'sealed', operation: 'apply', potency: 'normal' },
      ]);
    }
  }
  for (const character of Object.values(state.actors)) {
    if (character.side === actor.side || character.defeated || !character.onBattlefield || !character.position) continue;
    if (!area.some((cell) => samePosition(cell, character.position))) continue;
    if (!character.statuses.includes('sealed') && !character.statuses.includes('pacified')) continue;
    const direction = axisDirection(actor.position, character.position);
    applyRuleMutations(state, [{
      kind: 'move', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, movement: 'shove', distance: 1, positions: [], direction, phasing: false,
    }]);
  }
}

/** ICON p.178 Symphony: a character that enters or starts a turn on a mote
 * detonates it — a small blast centered on them (foes take fray, allies gain
 * 2 vigor); a triggering hero is blessed and flies 1, a triggering foe gets a
 * pit under them. */
function detonateSymphonyMote(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  const mote = state.terrainEffects.find((effect) => effect.terrain === 'symphony-mote' && effect.positions.some((cell) => samePosition(cell, actor.position)));
  if (!mote) return;
  state.terrainEffects = state.terrainEffects.filter((effect) => effect !== mote);
  const owner = mote.ownerId ? state.actors[mote.ownerId] : undefined;
  const ownerSide = owner?.side ?? actor.side;
  const center = { ...actor.position };
  const blast = squareArea(center, 1);
  for (const character of Object.values(state.actors)) {
    if (character.defeated || !character.onBattlefield || !character.position) continue;
    if (!blast.some((cell) => samePosition(cell, character.position))) continue;
    if (character.side === ownerSide) {
      applyRuleMutations(state, [{ kind: 'vigor', sourceId: 'chanter:symphony', actorId: character.id, amount: 2, uncapped: false }]);
    } else {
      applyRuleMutations(state, [{ kind: 'damage', sourceId: 'chanter:symphony', sourceActorId: actor.id, actorId: character.id, amount: owner?.fray ?? actor.fray, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false }]);
    }
  }
  if (actor.side === ownerSide) {
    applyRuleMutations(state, [{ kind: 'resource', sourceId: 'chanter:symphony', actorId: actor.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }]);
    // May fly 1: deterministic — one step toward the nearest foe (or +x).
    const foes = Object.values(state.actors).filter((candidate) => candidate.side !== actor.side && candidate.onBattlefield && !candidate.defeated && candidate.position);
    const direction = foes.length > 0
      ? axisDirection(actor.position, foes.sort((a, b) => distance(a.position!, actor.position!) - distance(b.position!, actor.position!) || a.id.localeCompare(b.id))[0].position!)
      : { x: 1, y: 0 };
    const next = { x: center.x + Math.sign(direction.x), y: center.y + Math.sign(direction.y) };
    const free = next.x >= 0 && next.y >= 0 && next.x < state.grid.width && next.y < state.grid.height
      && !Object.values(state.actors).some((candidate) => candidate.onBattlefield && !candidate.defeated && candidate.position && samePosition(candidate.position, next))
      && !state.grid.terrain.some((cell) => samePosition(cell.position, next) && cell.type === 'impassable');
    if (free) actor.position = next;
  } else {
    state.terrainEffects.push({ id: `symphony-pit:${actor.id}:${state.revision}`, sourceId: 'chanter:symphony', ownerId: actor.id, terrain: 'pit', positions: [center], height: null, duration: null });
  }
}

function resolveSymphonyMoteTurnStart(state: EncounterState, actor: EncounterActor) {
  detonateSymphonyMote(state, actor);
}

/** ICON p.179 Monogatari: while a tale is active, each hero character's
 * starting position is recorded so the Tale of Travels (move 4+ from start)
 * can be checked at their turn end. */
function resolveMonogatariTurnStart(state: EncounterState, actor: EncounterActor) {
  if (actor.side !== 'heroes' || !actor.position) return;
  const taleActive = Object.values(state.actors).some((candidate) => candidate.ruleState['monogatari:tale'] !== null && candidate.ruleState['monogatari:tale'] !== undefined);
  if (!taleActive) return;
  actor.ruleState['monogatari:turn-start-pos'] = `${actor.position.x},${actor.position.y}`;
  actor.ruleStateOwners['monogatari:turn-start-pos'] = actor.id;
}

/** The deterministic tale conditions the single-pass VM can evaluate: Travels
 * (moved 4+ from start), Green (did not attack), Cunning (used an interrupt),
 * and Boon Companions (ended adjacent to an ally). Fury and Triumph are
 * documented table-facing windows. */
function monogatariTaleMet(state: EncounterState, actor: EncounterActor, tale: number): boolean {
  switch (tale) {
    case 2: {
      const start = actor.ruleState['monogatari:turn-start-pos'];
      if (typeof start !== 'string' || !actor.position) return false;
      const [sx, sy] = start.split(',').map(Number);
      return Math.max(Math.abs(actor.position.x - sx), Math.abs(actor.position.y - sy)) > 4;
    }
    case 3: return !actor.attackedThisTurn;
    case 4: return actor.interruptUsedThisTurn;
    case 5: return actor.position !== null && Object.values(state.actors).some((candidate) =>
      candidate.side === actor.side && candidate.id !== actor.id && !candidate.defeated && candidate.onBattlefield && candidate.position && distance(candidate.position, actor.position) <= 1);
    default: return false;
  }
}

/** ICON p.179 Monogatari: at the end of a hero character's turn, if the active
 * tale's course of action was completed and it has not already been granted
 * this song, they are blessed (the optional fly 2 is a free-action choice). */
function resolveMonogatariTurnEnd(state: EncounterState, actor: EncounterActor) {
  if (actor.side !== 'heroes' || !actor.position || actor.defeated || actor.ruleState['monogatari:granted'] === true) return;
  const owner = Object.values(state.actors).find((candidate) => candidate.ruleState['monogatari:tale'] !== null && candidate.ruleState['monogatari:tale'] !== undefined);
  if (!owner) return;
  if (!monogatariTaleMet(state, actor, Number(owner.ruleState['monogatari:tale']))) return;
  actor.ruleState['monogatari:granted'] = true;
  actor.ruleStateOwners['monogatari:granted'] = actor.id;
  applyRuleMutations(state, [{ kind: 'resource', sourceId: 'chanter:monogatari', actorId: actor.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }]);
}

/** ICON p.179 Chastise: at the end of the marked foe's next turn, the
 * retribution lands (1 divine three times) if it damaged a chosen character
 * with an ability, and the Charism combo cures or blesses allies in a small
 * blast centered on the foe (opening a pit under it with 2+ allies). */
function resolveChastiseTurnEnd(state: EncounterState, actor: EncounterActor) {
  if (actor.side !== 'foes' || !actor.position) return;
  const marks = actor.marks.filter((mark) => mark.markId === 'chastise-retribution' || mark.markId === 'chastise-charism');
  if (marks.length === 0) return;
  actor.marks = actor.marks.filter((mark) => mark.markId !== 'chastise-retribution' && mark.markId !== 'chastise-charism');
  for (const mark of marks) {
    const owner = state.actors[mark.ownerId];
    if (!owner || owner.defeated || !owner.onBattlefield) continue;
    if (mark.markId === 'chastise-retribution') {
      if (mark.state.triggered === true) {
        for (let i = 0; i < 3; i += 1) {
          applyRuleMutations(state, [{ kind: 'damage', sourceId: 'chanter:chastise', sourceActorId: owner.id, actorId: actor.id, amount: 1, damageType: 'divine', instance: i + 1, delivery: 'effect', ignoreCover: false }]);
        }
      }
    } else {
      const allies = Object.values(state.actors).filter((candidate) =>
        candidate.side === owner.side && !candidate.defeated && candidate.onBattlefield && candidate.position && distance(candidate.position, actor.position) <= 1);
      if (mark.state.choice === 'bless') {
        for (const ally of allies) {
          applyRuleMutations(state, [{ kind: 'resource', sourceId: 'chanter:chastise', actorId: ally.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }]);
        }
      } else {
        for (const ally of allies) {
          applyRuleMutations(state, [{ kind: 'cure', sourceId: 'chanter:chastise', actorId: ally.id, all: false }]);
        }
      }
      if (allies.length >= 2) {
        state.terrainEffects.push({ id: `charism-pit:${actor.id}:${state.revision}`, sourceId: 'chanter:chastise', ownerId: owner.id, terrain: 'pit', positions: [{ ...actor.position }], height: null, duration: null });
      }
    }
  }
}

function resolveTurnStart(state: EncounterState, next: EncounterActor) {
  expireBoundaryEffects(state, next.id, 'turn-start');
  resolvePendingTrigram(state, next);
  resolveDarkKnightTurnStart(state, next);
  resolveIntimidateTurnStart(state, next);
  resolveGallowsHumorTurnStart(state, next);
  resolveAstralChainTurnStart(state, next);
  resolveWardingBoltsTurnStart(state, next);
  resolveMorriganTurnStart(state, next);
  resolveStrengthOfThePackTurnStart(state, next);
  resolveAriaTurnStart(state, next);
  resolveSymphonyMoteTurnStart(state, next);
  resolveMonogatariTurnStart(state, next);
  // A Delay ability (Six Hells Trigram, p.129) makes the user's next turn
  // slow; the slow-turn flag is what the Charge trigger reads during it.
  if (next.ruleState['six-hells:slow-turn'] === true) {
    next.ruleState['slow-turn'] = true;
    next.ruleStateOwners['slow-turn'] = next.id;
    delete next.ruleState['six-hells:slow-turn'];
    delete next.ruleStateOwners['six-hells:slow-turn'];
  }
  if (next.position) pickupThrownWeapon(state, next, [next.position]);
}

/**
 * Turn-end lifecycle: expire turn-end durations owned by the ending actor,
 * clear the slow-turn flag, refresh Soul Blade when the user ended the turn
 * without attacking (p.129), and grant Dark Knight's vigilance (p.141).
 */
function resolveTurnEnd(state: EncounterState, actor: EncounterActor, carnevaleGamble?: number, monogatariGamble?: number) {
  expireBoundaryEffects(state, actor.id, 'turn-end');
  actor.ruleState['slow-turn'] = false;
  actor.ruleStateOwners['slow-turn'] ??= null;
  if (actor.stance?.stanceId === 'soul-blade' && !actor.attackedThisTurn) {
    const die = Number(actor.ruleState['soul-blade:die'] ?? 0);
    actor.ruleState['soul-blade:die'] = Math.min(6, die + 1);
    actor.ruleStateOwners['soul-blade:die'] = actor.id;
  }
  if (actor.stance?.stanceId === 'dark-knight') {
    actor.resources.vigilance = (actor.resources.vigilance ?? 0) + 1;
  }
  resolveExorcismTurnEnd(state, actor);
  resolveShowdownTurnEnd(state, actor);
  resolveWardingBoltsTurnEnd(state, actor);
  resolveAssassinateTurnEnd(state, actor);
  resolveIncubusTurnEnd(state, actor);
  resolveUmbralEchoTurnEnd(state, actor);
  resolveSidheTurnEnd(state, actor);
  resolveStampedeTurnEnd(state, actor);
  resolveUnderwayTurnEnd(state, actor);
  resolveMonogatariTurnEnd(state, actor);
  resolveChastiseTurnEnd(state, actor);
  // ICON p.150 Carnevale: ending the turn without attacking detonates all of
  // the user's bombs with the gamble rolled at the command boundary.
  if (carnevaleGamble !== undefined) {
    detonateBombs(state, actor, carnevaleGamble);
    actor.ruleState['carnevale:armed'] = false;
    actor.ruleStateOwners['carnevale:armed'] ??= null;
  }
  // ICON p.179 Monogatari: the song's tale is gambled at the end of the turn
  // the ability was used (pre-rolled at the command boundary). A fresh tale
  // resets the once-per-song grants for every hero character.
  if (monogatariGamble !== undefined) {
    actor.ruleState['monogatari:tale'] = monogatariGamble;
    actor.ruleStateOwners['monogatari:tale'] = actor.id;
    for (const candidate of Object.values(state.actors)) {
      if (candidate.side !== 'heroes') continue;
      delete candidate.ruleState['monogatari:granted'];
      delete candidate.ruleStateOwners['monogatari:granted'];
    }
  }
}

/** Roll the Carnevale detonation gamble when the actor armed it, did not
 * attack this turn, and still owns bombs. Rolled here (not in the reducer) so
 * the TURN_ENDED event carries a deterministic value for replay. */
function carnevaleGambleForTurnEnd(state: EncounterState, actor: EncounterActor, dice: DiceSource): number | undefined {
  if (actor.ruleState['carnevale:armed'] !== true || actor.attackedThisTurn) return undefined;
  return Object.values(state.entities).some((entity) => entity.type === 'bomb' && entity.ownerId === actor.id) ? dice.die(6) : undefined;
}

/** Roll the Monogatari song gamble when the user has an active song with no
 * tale yet. Charge rolls an extra d6 and takes the higher result. Rolled here
 * (not in the reducer) so the TURN_ENDED event carries a deterministic value. */
function monogatariGambleForTurnEnd(state: EncounterState, actor: EncounterActor, dice: DiceSource): number | undefined {
  const tale = actor.ruleState['monogatari:tale'];
  if (actor.ruleState['monogatari:active'] !== true || tale !== null && tale !== undefined) return undefined;
  if (actor.ruleState['monogatari:charge'] === true) return Math.max(dice.die(6), dice.die(6));
  return dice.die(6);
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
          // Shared per-encounter resources reset to zero when combat begins
          // (aether, combo, blessing, vigilance; personal resolve survives).
          for (const resourceId of perEncounterCharacterResourceIds()) actor.resources[resourceId] = 0;
          actor.ruleState['damage-immune'] = false;
          actor.ruleStateOwners['damage-immune'] ??= null;
          if (actor.traitIds.includes('stalwart:trait:armor-2')) actor.armor = Math.max(2, actor.armor);
        }
        break;
      case 'ACTOR_MOVED': {
        const actor = state.actors[event.actorId];
        const from = { ...actor.position };
        actor.position = event.path.at(-1)!;
        actor.standardMoveUsed ||= event.mode === 'standard';
        pickupThrownWeapon(state, actor, [from, actor.position, ...event.path]);
        if (event.mode === 'dash') {
          actor.actionsRemaining -= 1;
          actor.usedAbilityIds.push('basic:dash');
        }
        if (event.dangerousDamage) {
          actor.hp = Math.max(defyDeathActive(actor) ? 1 : 0, actor.hp - event.dangerousDamage);
          actor.dangerousTerrainTriggeredThisTurn = true;
        }
        if (actor.statuses.includes('slashed') && !actor.slashedTriggeredThisTurn) {
          const slashedDamage = event.slashedDamage ?? 0;
          const vigorDamage = Math.min(actor.vigor, slashedDamage);
          actor.vigor -= vigorDamage;
          actor.hp = Math.max(defyDeathActive(actor) ? 1 : 0, actor.hp - (slashedDamage - vigorDamage));
          actor.slashedTriggeredThisTurn = true;
        }
        // ICON p.178 Symphony: entering a mote space detonates it.
        detonateSymphonyMote(state, actor);
        break;
      }
      case 'ATTACK_RESOLVED': {
        const actor = state.actors[event.actorId];
        const target = state.actors[event.targetId];
        actor.actionsRemaining -= event.weight === 'heavy' ? 2 : 1;
        actor.attackedThisTurn = true;
        if (event.hit) discardWickedSheathDie(actor);
        breakStealth(actor);
        const vigorDamage = Math.min(target.vigor, event.appliedDamage);
        target.vigor -= vigorDamage;
        target.hp = Math.max(0, target.hp - (event.appliedDamage - vigorDamage));
        if (event.appliedDamage > 0 && actor.side !== target.side) target.statuses = target.statuses.filter((status) => status !== 'pacified');
        if (event.appliedDamage > 0 && actor.side !== target.side && encounterConditionSet(target).has('counter')) retaliate(state, actor);
        if (event.appliedDamage > 0) gentlenessReflection(state, actor);
        consumeMassiveOverhead(state, actor, target);
        if (!event.hit) tickGallowsHumorOnMiss(state);
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
          // ICON p.107: an interrupt answers the most recently triggered window
          // open for its user (LIFO); windows close at the end of the turn.
          popInterruptWindow(state, actor.id);
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
        const actor = state.actors[event.actorId];
        // ICON p.107 deferred-trigger windows: while an armed interrupt is
        // available, an ability that has not resolved yet is held — Heroic
        // Intervention (p.122, a foe targets the armored ally), Perseus (p.123,
        // an allied area effect includes the user), Masquerade (p.151, an
        // ability targets the user). The ability's costs pay immediately; its
        // effects resolve after the interrupt (or at the turn boundary if no
        // interrupt answers the window), retargeted when the interrupt
        // redirects them. A rolled save held for a save-reroll interrupt
        // (Sucker Punch, p.143) is its own window carrying the save's branch.
        const deferredWindow = deferrableEffectWindow(state, event.actorId, event.mutations);
        const saveWindow = saveRerollWindow(state, event.actorId, event.mutations);
        const held = new Set<RuleMutation>();
        for (const window of [deferredWindow, saveWindow]) {
          if (!window) continue;
          state.pendingInterrupts.push(window);
          for (const mutation of window.heldEffects ?? []) held.add(mutation);
        }
        const appliedMutations = held.size > 0 ? event.mutations.filter((mutation) => !held.has(mutation)) : event.mutations;
        // ICON p.157 Ace / p.156 Trick Shot: the armed next attack consumes the
        // flag and applies the deterministic parts — Ace dazes the foe (its
        // exceed effects already fired upstream) and both make the attack's
        // damage unerring (ignore cover). The +1 boon and rebound bounce stay
        // table-facing, documented in freelancer-programs.ts.
        if (event.tags.includes('attack')) {
          if (actor.ruleState['ace:armed'] === true) {
            const attackMutation = event.mutations.find((mutation) => mutation.kind === 'attack');
            const aceTarget = attackMutation ? state.actors[attackMutation.targetId] : undefined;
            for (const mutation of event.mutations) if (mutation.kind === 'damage') mutation.ignoreCover = true;
            if (aceTarget && !aceTarget.defeated) {
              applyRuleMutations(state, [{ kind: 'condition', sourceId: 'freelancer:ace', sourceActorId: actor.id, actorId: aceTarget.id, conditionId: 'dazed', operation: 'apply', potency: 'normal' }]);
            }
            delete actor.ruleState['ace:armed'];
            delete actor.ruleStateOwners['ace:armed'];
          }
          if (actor.ruleState['trick-shot:armed'] === true) {
            for (const mutation of event.mutations) if (mutation.kind === 'damage') mutation.ignoreCover = true;
            delete actor.ruleState['trick-shot:armed'];
            delete actor.ruleStateOwners['trick-shot:armed'];
          }
        }
        // ICON p.104 Stealth: using an attack ability breaks the user's stealth
        // before its effects resolve, so an ability that re-grants stealth as
        // part of its own effect (e.g. Warden's Apex on a Finishing Blow) keeps
        // the newly granted stealth.
        if (event.tags.includes('attack')) breakStealth(actor);
        applyRuleMutations(state, appliedMutations);
        if (event.timing === 'use' || event.timing === 'interrupt') actor.usedAbilityIds.push(event.sourceId);
        actor.attackedThisTurn ||= event.tags.includes('attack');
        if (event.mutations.some((mutation) => mutation.kind === 'attack' && mutation.hit)) discardWickedSheathDie(actor);
        if (event.tags.includes('attack') && massiveOverheadArmed(actor)) {
          const attackMutation = event.mutations.find((mutation) => mutation.kind === 'attack');
          const overheadTarget = attackMutation ? state.actors[attackMutation.targetId] : undefined;
          if (overheadTarget && !overheadTarget.defeated) consumeMassiveOverhead(state, actor, overheadTarget);
        }
        if (event.timing === 'interrupt') {
          // Track per-ability interrupt uses the same way ABILITY_RESOLVED
          // does, so resolver-based interrupts obey the source usage limit.
          actor.interruptUses[event.sourceId] = (actor.interruptUses[event.sourceId] ?? 0) + 1;
          actor.interruptUsedThisTurn = true;
          // ICON p.107: an interrupt answers the most recently triggered window
          // open for its user (LIFO); windows close at the end of the turn.
          const window = popInterruptWindow(state, actor.id);
          // ICON p.107 held-damage protocol: a when-damaged interrupt resolves
          // before the damage that opened its window applies. The held damage
          // applies after the interrupt's own mutations — unless the interrupt
          // re-dealt damage to the held target (e.g. Righteous Disdain splits
          // the held blow between two characters, consuming it).
          if (window?.heldDamage && !event.mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === window.actorId)) {
            applyHeldDamage(state, window.actorId, window.heldDamage);
          }
          // ICON p.107 deferred-effect windows: the ability resolves after the
          // interrupt (Heroic Intervention repositions the stance user before
          // the effects land; Perseus's immunity applies first; Masquerade
          // swaps and redirects the effects to the ally). The interrupts do
          // not cancel the ability, so its held effects now apply.
          if (window) {
            if (window.heldSave) {
              // ICON p.143 Sucker Punch: re-roll the save, keeping the second
              // result — the command layer's regenerated branch replaces the
              // held one; any other interrupt (or the turn boundary) lets the
              // original roll stand.
              if (event.reroll?.mutations) applyRuleMutations(state, event.reroll.mutations);
              else resolveHeldEffects(state, window);
            } else {
              resolveHeldEffects(state, window);
            }
          }
        }
        // ICON p.95 Chain Reaction (Wright): once per round, damaging at least
        // two foes with one ability grants 1 Aether.
        if (encounterConditionSet(actor).has('chain-reaction') && actor.ruleState['chain-reaction-used'] !== true) {
          const damagedFoeIds = new Set<string>();
          for (const mutation of event.mutations) {
            if (mutation.kind !== 'damage' || mutation.amount <= 0) continue;
            if (state.actors[mutation.actorId]?.side !== actor.side) damagedFoeIds.add(mutation.actorId);
          }
          if (damagedFoeIds.size >= 2) {
            actor.resources.aether = (actor.resources.aether ?? 0) + 1;
            actor.ruleState['chain-reaction-used'] = true;
            actor.ruleStateOwners['chain-reaction-used'] = actor.id;
          }
        }
        if (event.mutations.some((mutation) => mutation.kind === 'attack' && !mutation.hit)) tickGallowsHumorOnMiss(state);
        // ICON p.103 Combo: using the base version of a combo ability grants one
        // combo token. Only one token may be held at once; the combo version
        // itself discards the token, so it never re-grants.
        if (event.actionId !== 'combo' && hasComboVersion(event.sourceId)) {
          actor.resources.combo = Math.min(1, (actor.resources.combo ?? 0) + 1);
        }
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
        if (defyDeathActive(actor)) {
          actor.hp = Math.max(1, actor.hp);
          break;
        }
        actor.defeated = true;
        actor.hp = 0;
        actor.vigor = 0;
        actor.statuses = [];
        if (event.woundGained) actor.wounds = Math.min(4, actor.wounds + 1);
        break;
      }
      case 'VIGILANCE_SPENT': {
        const actor = state.actors[event.actorId];
        const target = state.actors[event.targetId];
        actor.resources.vigilance = Math.max(0, (actor.resources.vigilance ?? 0) - 1);
        const vigorDamage = Math.min(target.vigor, event.appliedDamage);
        target.vigor -= vigorDamage;
        target.hp = Math.max(defyDeathActive(target) ? 1 : 0, target.hp - (event.appliedDamage - vigorDamage));
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
        resolveTurnEnd(state, actor, event.carnevaleGamble, event.monogatariGamble);
        if (event.round > state.round) {
          expireBoundaryEffects(state, actor.id, 'round-end');
          for (const candidate of Object.values(state.actors)) {
            candidate.turnTaken = false;
            candidate.ruleState['chain-reaction-used'] = false;
            candidate.ruleStateOwners['chain-reaction-used'] ??= null;
            candidate.ruleState['incubus:triggered'] = false;
            candidate.ruleStateOwners['incubus:triggered'] ??= null;
            candidate.ruleState['stampede:triggered'] = false;
            candidate.ruleStateOwners['stampede:triggered'] ??= null;
          }
          state.partyResolve += 1;
          chargeWickedSheathDie(state);
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
          candidate.ruleState['gates-of-hell:vigilance-rushed'] = false;
          candidate.ruleStateOwners['gates-of-hell:vigilance-rushed'] ??= null;
        }
        state.round = event.round;
        state.activeActorId = event.nextActorId;
        state.lastSide = actor.side;
        resolveDelayedMarkEffects(state, actor);
        // ICON p.107: interrupt windows close at the end of the turn; held
        // damage and held ability effects resolve now (the window was the
        // interrupt opportunity).
        resolveHeldInterruptWindows(state);
        expireBoundaryEffects(state, next.id, 'round-start');
        resolveTurnStart(state, next);
        break;
      }
      case 'ENCOUNTER_ENDED':
        state.phase = 'complete';
        state.activeActorId = null;
        state.partyResolve = 0;
        // ICON p.107: open windows close at the encounter boundary; held damage
        // and held ability effects resolve (see `resolveHeldInterruptWindows`).
        resolveHeldInterruptWindows(state);
        for (const actor of Object.values(state.actors)) {
          actor.vigor = 0;
          actor.statuses = [];
          actor.conditions = actor.conditions.filter(({ duration }) => duration?.kind === 'expedition');
          actor.activeEffects = actor.activeEffects.filter(({ duration }) => duration.kind === 'expedition');
          actor.marks = [];
          actor.stance = null;
          // Shared per-encounter resources are discarded at the end of combat;
          // personal resolve is earned across fights and survives.
          for (const resourceId of perEncounterCharacterResourceIds()) actor.resources[resourceId] = 0;
          actor.resources['bonus-damage'] = 0;
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
