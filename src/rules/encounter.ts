import { ENCOUNTER_SCHEMA_VERSION, RULES_VERSION, type CommandResult, type EncounterActiveEffect, type EncounterActor, type EncounterCommand, type EncounterCondition, type EncounterEvent, type EncounterMark, type EncounterPendingInterrupt, type EncounterState, type IconCharacter, type Position, type StatusId, type StatusSaveCommandInput, type TurnEndCause } from './types.js';
import { findAbility, findClass, findJob } from './catalog.js';
import { FOE_PROFILES, findFoeProfile, findFoeRole } from './foes.js';
import { characterStats } from './character.js';
import { randomDice, rollBoonOrCurse, rollDamage, type DiceSource } from './dice.js';
import { compileRuleSourceUnit } from './automation/content/glue/compiler.js';
import type { RuleExecutionContext, RuleExecutionResult, RuleMutation, RuleProgram, RuleResolverRegistry, RuleTiming } from './automation/primitives/types.js';
import { SAVE_REROLL_INTERRUPT_IDS, compileManualRuleProgram, isIndependentlyExecutableAbility, isIndependentlyExecutableManualProgram } from './automation/content/glue/manual-programs.js';
import { initialCharacterResources, perEncounterCharacterResourceIds } from './core.js';
import { applyDeterminedEncounterDamage, applyHeldDamage, applyRuleMutations, collidingShoveTargets, defeatActor, deferrableEffectWindow, defyDeathActive, determineAndApplyEncounterDamage, determineEncounterDamage, encounterConditionSet, encounterRuleState, gainVigor, isBloodied, reactiveRuleTriggers, reactiveSlayTargets, saveRerollWindow } from './automation/kernels/encounter-adapter.js';
import { applyDamageLedger } from './automation/kernels/damage-ledger.js';
import { decideDamageWindow } from './automation/kernels/trigger-window.js';
import { resolveSaveWindow } from './automation/primitives/save-window.js';
import { applyCombatStartTraitEffects, planTurnTransition, runLifecyclePhase, runLifecyclePhaseForAll, type TurnTransitionIntent } from './automation/kernels/lifecycle.js';
import { tickGallowsHumorDie } from './automation/content/jobs/lifecycle-recipes.js';
// Content registry: registers the lifecycle rows, passive projections, and
// content hooks every kernel fold below reads. Must load before any command.
import './automation/content/registry.js';
import { talentReactiveTrigger, talentTriggerMutations, type TalentReactiveTargets } from './automation/kernels/talent-recipes.js';
import { traitReactionMutations, traitReactionNeededTriggers } from './automation/kernels/trait-reactions.js';
import { applyDeterminedDamageToVitals } from './automation/primitives/damage-resolution.js';
import { projectedFoeTraitStats } from './automation/kernels/foe-trait-recipes.js';
import { resolveAttackRoll } from './automation/primitives/attack-resolution.js';
import { consumeTraitAttackModifiers, effectiveDamageDie, traitAttackModifier } from './automation/kernels/attack-modifiers.js';
import { areaStateView, rangeStateView } from './automation/kernels/encounter-adapter.js';
import { effectiveAbilityRange } from './automation/kernels/range.js';
import { effectiveAreaFor } from './automation/kernels/area.js';
import { footprintDistance } from './automation/primitives/spatial-intent.js';
import { auraStateView, projectedAuraAttackModifiers } from './automation/kernels/aura.js';
import { projectedHpThresholdActionBonus } from './automation/kernels/hp-threshold.js';
import { bullStrengthCollideMutations, DEMON_EDGE_TRAIT, demonEdgeSlowTurnMutations } from './automation/content/jobs/attack-modifier-recipes.js';
import { queryDirectTarget, type DirectTargetQuery } from './automation/primitives/targeting.js';
import { executeRuleProgram, orderedSelectedSteps, rerollSaveMutations } from './automation/kernels/runtime.js';
import { resolveCureMutations, resolveStatusSaveMutations, StatusSaveViolation } from './automation/primitives/status-saves.js';
import { hasLineOfSight as lineOfSightKernel } from './automation/primitives/line-of-sight.js';
import { movementEntryTriggerMutations } from './automation/kernels/movement-triggers.js';
import { RULE_RESOLVERS } from './automation/content/glue/resolvers.js';
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
    masteredAbilityIds: [...(actor.masteredAbilityIds ?? [])],
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
      masteredAbilityIds: [...(actor.masteredAbilityIds ?? [])],
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
    // F7: the equipped talent choice per ability (1 or 2), projected from the
    // character's loadout so the talent fold sees the same durable selection
    // on command and replay.
    talents: Object.fromEntries(
      character.abilities.filter(({ talent }) => talent !== null).map(({ abilityId, talent }) => [abilityId, talent as 1 | 2]),
    ),
    // Mastery ownership is projected from the character sheet the same way:
    // only abilities that are both equipped and legitimately mastered appear,
    // so a mastery gate never fires for an unmastered or unequipped parent.
    masteredAbilityIds: character.abilities
      .filter(({ abilityId, mastered }) => mastered && character.equippedAbilityIds.includes(abilityId))
      .map(({ abilityId }) => abilityId),
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
    talents: {},
    masteredAbilityIds: [],
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
  // F5: p.298 Size/Armor/Speed keywords on the profile's reviewed special-
  // traits rows override the role defaults (the generated catalog does not
  // carry them in stats). The durable actor fields are the record; the p.92
  // footprint half of Size stays pending until the footprint matrix lands.
  const traitStats = projectedFoeTraitStats(foeTraitIds(profile.id));
  return {
    id: `foe:${makeId()}`,
    name: profile.name,
    side: 'foes',
    controllerId: null,
    characterId: null,
    foeProfileId: profile.id,
    roleId: profile.roleId,
    actorKind: 'foe',
    size: traitStats.size ?? profile.stats.size ?? 1,
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
    armor: traitStats.armor ?? profile.stats.armor ?? (role.id === 'heavy' ? 2 : 0),
    speed: traitStats.speed ?? profile.stats.speed ?? role.speed,
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
    talents: {},
    masteredAbilityIds: [],
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

/** The per-cell union of base terrain and overlay effects, matching the
 * movement planner's view so every spatial kernel sees the same terrain. */
function terrainTypesAt(state: EncounterState, position: Position): ReadonlySet<string> {
  const types = new Set<string>();
  const base = terrainAt(state, position);
  if (base) types.add(base.type);
  for (const effect of state.terrainEffects) {
    if (effect.positions.some((candidate) => samePosition(candidate, position))) types.add(effect.terrain);
  }
  return types;
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

interface EncounterStatusSaveResolution {
  mutations: RuleMutation[];
  saves: Array<{ status: StatusId; roll: number; cleared: boolean }>;
}

function statusSaveResults(mutations: readonly RuleMutation[]): Array<{ status: StatusId; roll: number; cleared: boolean }> {
  return mutations.flatMap((mutation) => mutation.kind === 'save' && mutation.statusId
    ? [{ status: mutation.statusId as StatusId, roll: mutation.roll, cleared: mutation.success }]
    : []);
}

/**
 * Resolve a core command's ordinary status-save window through the same
 * projected policy as command-time Cure.  This is intentionally not a
 * generic replacement for program/movement saves: those have their own
 * source-specific contexts and remain separately audited.
 */
function resolveEncounterStatusSaves(
  state: EncounterState,
  actor: EncounterActor,
  dice: DiceSource,
  input: StatusSaveCommandInput | RuleExecutionContext['input'] = {},
  excluded: readonly StatusId[] = [],
  sourceId = 'core:status-save',
): EncounterStatusSaveResolution {
  const projected = encounterRuleState(state);
  const target = projected.actors[actor.id];
  if (!target) return { mutations: [], saves: [] };
  try {
    const mutations = resolveStatusSaveMutations({
      state: projected,
      actorId: actor.id,
      sourceId,
      actionId: 'status-save',
      timing: 'turn-end',
      input,
      dice,
    }, target, { excludedStatusIds: new Set(excluded) });
    return {
      mutations,
      saves: statusSaveResults(mutations),
    };
  } catch (error) {
    if (error instanceof StatusSaveViolation) throw new RuleViolation(error.code, error.message);
    throw error;
  }
}

/** Resolve the p.91 Recover/Diaga Cure sequence, including Cure's own denial. */
function resolveEncounterCure(
  state: EncounterState,
  actor: EncounterActor,
  dice: DiceSource,
  input: StatusSaveCommandInput | RuleExecutionContext['input'] = {},
  sourceId = 'core:recover',
): EncounterStatusSaveResolution {
  const projected = encounterRuleState(state);
  const target = projected.actors[actor.id];
  if (!target) return { mutations: [], saves: [] };
  try {
    const mutations = resolveCureMutations({
      state: projected,
      actorId: actor.id,
      sourceId,
      actionId: 'default',
      timing: 'use',
      input,
      dice,
    }, target);
    return { mutations, saves: statusSaveResults(mutations) };
  } catch (error) {
    if (error instanceof StatusSaveViolation) throw new RuleViolation(error.code, error.message);
    throw error;
  }
}

/**
 * One command can resolve a status save and then force its own turn to end.
 * A p.102 choice is for one save, not a reusable command-wide discount, so
 * status-tagged save mutations consume the matching declared choice before a
 * later forced end-turn window sees it.
 */
function remainingStatusSaveInput(input: RuleExecutionContext['input'], mutations: readonly RuleMutation[]): RuleExecutionContext['input'] {
  const choices = input.statusSaveChoices;
  if (!choices) return input;
  const consumed = new Map<string, Set<string>>();
  for (const mutation of mutations) {
    if (mutation.kind !== 'save' || !mutation.statusId) continue;
    const statuses = consumed.get(mutation.actorId) ?? new Set<string>();
    statuses.add(mutation.statusId);
    consumed.set(mutation.actorId, statuses);
  }
  if (consumed.size === 0) return input;
  const remaining: Record<string, Record<string, { spendBlessing?: boolean }>> = {};
  for (const [actorId, actorChoices] of Object.entries(choices)) {
    const used = consumed.get(actorId);
    const retained = Object.fromEntries(Object.entries(actorChoices).filter(([statusId]) => !used?.has(statusId)));
    if (Object.keys(retained).length > 0) remaining[actorId] = retained;
  }
  return { ...input, statusSaveChoices: remaining };
}

function statusSaveMutationsFromEvents(events: readonly EncounterEvent[]): RuleMutation[] {
  return events.flatMap((event) => {
    if (event.type === 'RULE_MUTATIONS_APPLIED') return event.mutations;
    if (event.type === 'ACTOR_RECOVERED' || event.type === 'TURN_ENDED') return event.statusSaveMutations ?? [];
    return [];
  });
}

/**
 * A client may only nominate a Blessing for a status save that this command
 * actually produced.  This rejects cross-target and no-longer-available
 * choices instead of silently accepting a misleading command payload.
 */
function assertStatusSaveChoicesConsumed(input: RuleExecutionContext['input'], mutations: readonly RuleMutation[]) {
  const choices = input.statusSaveChoices;
  if (!choices) return;
  const resolved = new Set(mutations.flatMap((mutation) => mutation.kind === 'save' && mutation.statusId
    ? [`${mutation.actorId}\u0000${mutation.statusId}`]
    : []));
  for (const [actorId, actorChoices] of Object.entries(choices)) {
    for (const statusId of Object.keys(actorChoices)) {
      if (!resolved.has(`${actorId}\u0000${statusId}`)) {
        throw new RuleViolation('status-save.unused-choice', `${statusId} is not being saved against by this command.`);
      }
    }
  }
}

function turnEndedEvent(
  state: EncounterState,
  actor: EncounterActor,
  dice: DiceSource,
  input: StatusSaveCommandInput | RuleExecutionContext['input'] = {},
  excluded: readonly StatusId[] = [],
  sourceId = 'core:end-turn',
  cause: TurnEndCause = 'voluntary',
): Extract<EncounterEvent, { type: 'TURN_ENDED' }> {
  const next = nextActor(state, actor);
  // F3: the command boundary plans the whole transition — rolls the dice
  // windows (Carnevale/Monogatari gambles) and precomputes the ordered
  // lifecycle participants — so the event carries a replayable intent.
  const { intent } = planTurnTransition(state, actor, dice, { cause, nextActorId: next.actor.id, nextRound: next.round, input: input as Record<string, unknown> | undefined });
  const statusSaves = resolveEncounterStatusSaves(state, actor, dice, input, excluded, sourceId);
  return {
    type: 'TURN_ENDED',
    actorId: actor.id,
    nextActorId: next.actor.id,
    round: next.round,
    saves: statusSaves.saves,
    statusSaveMutations: statusSaves.mutations,
    cause,
    intent,
    ...(intent.diceWindows.carnevaleGamble !== undefined ? { carnevaleGamble: intent.diceWindows.carnevaleGamble } : {}),
    ...(intent.diceWindows.monogatariGamble !== undefined ? { monogatariGamble: intent.diceWindows.monogatariGamble } : {}),
  };
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
  // valid to move to, so the exit move is rejected. The save is a recorded
  // F2 movement-kind SaveWindow — it honors the projected save policy (e.g.
  // Rot's curse) and the successful result rides the ACTOR_MOVED event so
  // replay reads the same record. The failed branch's "unable to exit until
  // the start of their next turn" continuation stays source-visible: it
  // needs the F3 turn-transition lifecycle to clear a persistent lockout.
  let exitSave: Extract<RuleMutation, { kind: 'save' }> | undefined;
  if (actor.side === 'foes') {
    const trigram = state.terrainEffects.find((effect) => effect.terrain === 'six-hells-trigram' && effect.ownerId && state.actors[effect.ownerId]?.ruleState['six-hells:stage'] === 'active');
    if (trigram) {
      const inside = (position: Position) => trigram.positions.some((cell) => samePosition(cell, position));
      if (inside(actor.position) && !inside(plan.destination)) {
        const projected = encounterRuleState(state);
        const view = projected.actors[actor.id];
        if (view) {
          const save = resolveSaveWindow(
            { state: projected, actorId: actor.id, sourceId: 'demon-slayer:six-hells-trigram', actionId: 'move', timing: 'use', input: {}, dice },
            view,
            { id: `demon-slayer:six-hells-trigram:exit:${actor.id}`, kind: 'movement', sourceId: 'demon-slayer:six-hells-trigram', actorId: actor.id },
          ).mutation;
          if (!save.success) {
            throw new RuleViolation('move.trigram-boundary', `${actor.name} is trapped: the save to leave the Six Hells Trigram failed.`);
          }
          exitSave = save;
        }
      }
    }
  }
  const defiance = encounterConditionSet(actor, state).has('defiance');
  // Movement records source damage, not a locally armor-reduced preview.
  // Derive the same p.93 amount used by replay here only to decide whether an
  // explicit legacy defeat event is needed after the move.
  const dangerousDetermination = determineEncounterDamage(state, {
    targetId: actor.id,
    sourceRuleId: 'core:dangerous-terrain',
    amount: plan.dangerousDamage,
    damageType: 'piercing',
    delivery: 'terrain',
    instance: 1,
    ignoreCover: true,
  });
  const dangerousUsesDefiance = defiance && dangerousDetermination.amount >= actor.hp;
  const dangerous = applyDeterminedDamageToVitals(actor, {
    amount: dangerousDetermination.amount,
    bypassVigor: true,
    minimumHp: defyDeathActive(actor) || dangerousUsesDefiance ? 1 : 0,
  });
  const flooredAt1 = dangerous.hp === 1 && dangerousDetermination.amount >= actor.hp
    ? (defyDeathActive(actor) ? 'defy-death' : 'defiance')
    : null;
  const defeated = dangerous.hp === 0 && !defyDeathActive(actor) && !dangerousUsesDefiance;
  const events: EncounterEvent[] = [{ type: 'ACTOR_MOVED', actorId: actor.id, path: plan.path, mode: plan.mode, dangerousDamage: plan.dangerousDamage, slashedDamage: plan.slashedDamage, ...(exitSave ? { exitSave } : {}), ...(plan.dangerousDamage > 0 ? {
    // F0 damage ledger (source handoff): the terrain amount replays through
    // determineAndApplyEncounterDamage so p.93 mitigation is re-derived.
    ledger: {
      handoff: 'source',
      targetId: actor.id,
      sourceActorId: null,
      sourceRuleId: 'core:dangerous-terrain',
      instance: 1,
      delivery: 'terrain',
      damageType: 'piercing',
      bypassVigor: true,
      ignoreCover: true,
      amount: plan.dangerousDamage,
      appliedAmount: dangerous.amountApplied,
      hpDamage: dangerous.hpDamage,
      vigorDamage: dangerous.vigorDamage,
      flooredAt1,
      defeated,
      woundGained: actor.side === 'heroes',
      window: null,
    },
  } : {}) }];
  if (defeated) events.push({ type: 'ACTOR_DEFEATED', actorId: actor.id, woundGained: actor.side === 'heroes' });
  // Movement-entry triggers (Party Favor mines, p.151; the same seam serves
  // bubbles, motes, and "when a character enters" terrain effects). The fold
  // runs at the command boundary against the recorded path, so the resulting
  // mutations ride RULE_MUTATIONS_APPLIED events and replay identically;
  // any roll (a detonation gamble) is rolled once with the caller's dice.
  for (const fold of movementEntryTriggerMutations(state, actor, plan.path, dice)) {
    events.push({
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: actor.id,
      sourceId: fold.sourceId,
      actionId: `${fold.sourceId}:movement-entry`,
      timing: 'movement-end',
      tags: [],
      mutations: fold.mutations,
    });
  }
  return events;
}

function attackEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'BASIC_ATTACK' }>, dice: DiceSource): EncounterEvent[] {
  const actor = assertActive(state, command.actorId);
  const target = state.actors[command.targetId];
  const cost = command.weight === 'heavy' ? 2 : 1;
  if (!target || target.defeated || target.side === actor.side) throw new RuleViolation('attack.invalid-target', 'Basic attacks require a living foe.');
  if (actor.attackedThisTurn) throw new RuleViolation('attack.limit', 'A character can only use one attack ability per turn.');
  if (actor.ruleState['weapon-deployed'] === true) throw new RuleViolation('attack.deployed', 'You cannot attack while your thrown weapon is deployed.');
  if (actor.actionsRemaining < cost) throw new RuleViolation('action.insufficient', `A ${command.weight} attack costs ${cost} action${cost === 1 ? '' : 's'}.`);
  const attackTargetQuery = {
    relation: 'foe' as const,
    maximumRange: actor.basicAttackRange,
    requireLineOfSight: true as const,
  };
  assertDirectTarget(state, actor, target, attackTargetQuery, 'attack');
  const actorElevation = elevationAt(state, actor.position);
  const targetElevation = elevationAt(state, target.position);
  // F6 attack-path trait fold: armed one-shot modifiers (Demon Edge true
  // strike, Hissatsu +1 boon / true strike / d10) and permanent elevation
  // mechanics (Pulverize flat damage; the exceed threshold only matters on
  // the VM path, where exceed effects fire), distance-gated rules
  // (Trigrammaton's exactly-range-3 boon/unerring) through the canonical
  // p.92 footprint distance, and unerring (ignores cover + aetherwall).
  const traitOwner = { traitIds: actor.traitIds, state: actor.ruleState };
  const traitModifier = traitAttackModifier(traitOwner, actorElevation - targetElevation, {
    hp: target.hp,
    maxHp: Math.max(1, target.baseMaxHp - target.wounds * target.vitality),
    distance: footprintDistance(
      { position: actor.position, size: actor.size },
      { position: target.position, size: target.size },
    ),
  });
  // Aura membership feeds the same attack-modifier authority as the trait
  // fold: the attacker's own aura boons/curses plus any defensive curse an
  // aura projects against the target (stacking through netBoon, p.92).
  const auraView = auraStateView(state);
  const auraAttack = projectedAuraAttackModifiers(auraView, actor.id);
  const targetAuraCurse = projectedAuraAttackModifiers(auraView, target.id).targetCurses ?? 0;
  const { d20, boon, total, hit, critical, evasionRoll } = resolveAttackRoll({
    defense: target.defense,
    sourceBoon: traitModifier.boons + (auraAttack.boons ?? 0) - (auraAttack.curses ?? 0) - targetAuraCurse,
    elevationModifier: actorElevation - targetElevation,
    sourceDazed: actor.statuses.includes('dazed'),
    targetEvasion: encounterConditionSet(target, state).has('evasion'),
    trueStrike: traitModifier.trueStrike,
    bonusDamageFlat: traitModifier.bonusDamageFlat,
    unerring: traitModifier.unerring,
  }, dice);
  if (massiveOverheadArmed(actor)) actor.resources['bonus-damage'] = (actor.resources['bonus-damage'] ?? 0) + 1;
  const bonusDice = (critical ? 1 : 0) + Math.max(0, actor.resources['bonus-damage'] ?? 0);
  const damageRoll = rollDamage(effectiveDamageDie({ ...traitOwner, damageDie: actor.damageDie }), hit ? (command.weight === 'heavy' ? 2 : 1) : 0, bonusDice, dice);
  // Pulverize's +2 applies to the attack's damage on a hit (p.142).
  const rawDamage = (hit ? damageRoll.total + traitModifier.bonusDamageFlat : 0) + actor.fray;
  const covered = hasCoverFrom(state, target, actor) && actorElevation <= targetElevation;
  const determination = determineEncounterDamage(state, {
    targetId: target.id,
    sourceActorId: actor.id,
    sourceRuleId: command.weight === 'heavy' ? 'core:heavy-attack' : 'core:light-attack',
    amount: rawDamage,
    damageType: 'normal',
    delivery: hit ? 'hit' : 'miss',
    instance: 1,
    ignoreCover: traitModifier.unerring,
    ignoreAetherwall: traitModifier.unerring,
    covered,
  });
  const defiance = encounterConditionSet(target, state).has('defiance');
  const wouldDefeat = determination.amount >= target.vigor + target.hp;
  // Defiance's application-time HP floor is a durable result, not something
  // replay can re-infer: the recorded applied amount is already reduced to the
  // floor, so a later replay from that number would miss the lethal blow and
  // leave the condition unconsumed without its temporary immunity (p.104).
  const defianceTriggered = defiance && wouldDefeat;
  const preview = applyDeterminedDamageToVitals(target, {
    amount: determination.amount,
    bypassVigor: false,
    minimumHp: defyDeathActive(target) || defianceTriggered ? 1 : 0,
  });
  const appliedDamage = preview.amountApplied;
  const willDefeat = !defyDeathActive(target) && !defianceTriggered && preview.hp === 0;
  const flooredAt1 = preview.hp === 1 && wouldDefeat ? (defyDeathActive(target) ? 'defy-death' : 'defiance') : null;
  // F4: the attack's interrupt-window decision is recorded at construction
  // time — when the target has an armed when-damaged/defeated interrupt, the
  // blow is held on the replay side (openDamageWindowFromLedger) exactly as
  // the single-pass VM path would hold it. The record and the replay decision
  // are the same TriggerWindow registry row.
  const attackWindow = decideDamageWindow(state, target, {
    targetId: target.id,
    sourceActorId: actor.id,
    determinedAmount: determination.amount,
    bypassVigor: false,
    damageType: 'normal',
  });
  const events: EncounterEvent[] = [{ type: 'ATTACK_RESOLVED', actorId: actor.id, targetId: target.id, weight: command.weight, d20, boonDie: boon, total, evasionRoll, hit, critical, rawDamage, appliedDamage, ...(defianceTriggered ? { defianceTriggered: true } : {}),
    // F0 ledger — the AttackResolution (roll/authority provenance) with the
    // downstream damage ledger (determined handoff) nested inside: the full
    // post-mitigation amount plus the application result, so replay does not
    // re-infer the floor from the reduced recorded amount. The attack-window
    // record (F4) rides both levels.
    attackResolution: {
      target: {
        relation: attackTargetQuery.relation,
        maximumRange: attackTargetQuery.maximumRange,
        lineOfSight: attackTargetQuery.requireLineOfSight,
      },
      covered,
      window: attackWindow,
      damage: {
        handoff: 'determined',
        targetId: target.id,
        sourceActorId: actor.id,
        sourceRuleId: command.weight === 'heavy' ? 'core:heavy-attack' : 'core:light-attack',
        instance: 1,
        delivery: hit ? 'hit' : 'miss',
        damageType: 'normal',
        ignoreCover: false,
        covered,
        amount: determination.amount,
        appliedAmount: preview.amountApplied,
        hpDamage: preview.hpDamage,
        vigorDamage: preview.vigorDamage,
        flooredAt1,
        defeated: willDefeat,
        woundGained: target.side === 'heroes',
        window: attackWindow,
      },
    },
  }];
  // A held blow is not applied at replay (the window holds it), so the defeat
  // event must not be emitted — ACTOR_DEFEATED defeats mechanically, and the
  // interrupt (when-damaged or defeated) decides whether the target falls.
  if (willDefeat && !attackWindow?.held) {
    events.push({ type: 'ACTOR_DEFEATED', actorId: target.id, woundGained: target.side === 'heroes' });
  }
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
  // Guard receives a *previously determined* incoming damage amount; applying
  // armor/halving again here would double-mitigate it. Punish is kept on this
  // historical event shape until Vigilance is moved into DamageWindow/
  // TriggerWindow authority (ICON p.105).
  // TODO(ICON-rules): bind both uses to a real trigger record, enforce range
  // 2/adjacency, and give Punish a full DamageIntent before promoting it.
  const appliedDamage = command.use === 'guard' ? Math.max(0, (command.damage ?? 0) - roll) : roll;
  const defiance = encounterConditionSet(target, state).has('defiance');
  const wouldDefeat = appliedDamage >= target.vigor + target.hp;
  // Like ATTACK_RESOLVED, the recorded amount is already floored at 1 HP by
  // Defiance, so replay needs the durable trigger result to re-consume the
  // condition and grant the temporary immunity (p.104).
  const defianceTriggered = defiance && wouldDefeat;
  const preview = applyDeterminedDamageToVitals(target, {
    amount: appliedDamage,
    bypassVigor: false,
    minimumHp: defyDeathActive(target) || defianceTriggered ? 1 : 0,
  });
  const appliedDamageAfterDefiance = preview.amountApplied;
  const flooredAt1 = preview.hp === 1 && wouldDefeat ? (defyDeathActive(target) ? 'defy-death' : 'defiance') : null;
  const defeated = !defyDeathActive(target) && !defianceTriggered && preview.hp === 0;
  const events: EncounterEvent[] = [{ type: 'VIGILANCE_SPENT', actorId: actor.id, targetId: target.id, use: command.use, roll, appliedDamage: appliedDamageAfterDefiance, ...(defianceTriggered ? { defianceTriggered: true } : {}),
    // F0 damage ledger (determined handoff) — same rationale as ATTACK_RESOLVED.
    ledger: {
      handoff: 'determined',
      targetId: target.id,
      sourceActorId: actor.id,
      sourceRuleId: 'core:vigilance',
      instance: 1,
      delivery: 'effect',
      damageType: 'normal',
      ignoreCover: true,
      amount: appliedDamage,
      appliedAmount: preview.amountApplied,
      hpDamage: preview.hpDamage,
      vigorDamage: preview.vigorDamage,
      flooredAt1,
      defeated,
      woundGained: target.side === 'heroes',
      window: null,
    },
  }];
  if (defeated) events.push({ type: 'ACTOR_DEFEATED', actorId: target.id, woundGained: target.side === 'heroes' });
  return events;
}

function abilityRange(header: string, listedRange: number | null) {
  if (listedRange !== null) return listedRange;
  const area = header.match(/\b(?:line|arc)\s+(\d+)/i);
  return area ? Number(area[1]) : 1;
}

/** ICON p.97: for a Line X ability, the attack space is any character in the
 * area, and the line extends `length` from the user — so the target's legal
 * range IS the effective line length (a Line 6 talent extends target
 * legality with the pattern). Arc abilities keep the range rules (where the
 * pattern starts) as their range authority. */
function isLineShaped(header: string): boolean {
  return /\bline\s+\d+/i.test(header);
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
  let mutations = first.mutations;
  let selectedSteps = first.selectedSteps;
  if (missing.length > 0) {
    const additional = executeRuleProgram(program, {
      ...context,
      triggers: new Set([...(context.triggers ?? []), ...missing]),
    }, resolvers, { onlyTriggers: new Set(missing) });
    mutations = [...first.mutations, ...additional.mutations];
    selectedSteps = orderedSelectedSteps(first.selectedAction, [...first.selectedSteps, ...additional.selectedSteps]);
  }
  // F6 Bull's Strength (p.149): abilities gain "collide: deal 2 damage" —
  // when one of the ability's shoves collided, the trait fold appends the
  // 2-damage mutation against the shoved character and sets the once-per-
  // turn guard (a plan-time decision recorded through the event's
  // mutations; the guard clears at turn end via the lifecycle recipe).
  const bullStrengthDamage = bullStrengthCollideMutations(state, mutations);
  if (bullStrengthDamage.length > 0) mutations = [...mutations, ...bullStrengthDamage];
  return { ...first, mutations, selectedSteps };
}

/** F1: the reducer's line of sight is the shared kernel (primitives/
 * line-of-sight.ts, ICON p.92) — grid impassable terrain blocks, and overlay
 * effects block only when an explicit LoS-blocking type is registered
 * (none exist in the current catalog, so reducer behavior is unchanged). */
export function hasLineOfSight(state: EncounterState, from: Position, to: Position) {
  return lineOfSightKernel({
    grid: state.grid,
    terrainAt: (position) => terrainTypesAt(state, position),
  }, from, to);
}

/**
 * Current one-target command gate shared by basic attacks, reviewed ability
 * commands, and reviewed raw rule commands. It intentionally uses the
 * point-cell range metric that the existing reducer used; p.92 footprint and
 * p.107 line-of-effect belong to the next TargetQuery tranche.
 */
function assertDirectTarget(
  state: EncounterState,
  source: EncounterActor,
  target: EncounterActor,
  query: Omit<DirectTargetQuery, 'sourceBlind' | 'hasLineOfSight'>,
  family: 'attack' | 'ability',
) {
  const result = queryDirectTarget(source, target, {
    ...query,
    sourceBlind: encounterConditionSet(source, state).has('blind'),
    targetStealth: query.targetStealth ?? encounterConditionSet(target, state).has('stealth'),
    hasLineOfSight: query.requireLineOfSight ? hasLineOfSight(state, source.position, target.position) : true,
  });
  if (result.legal) return;
  switch (result.problem) {
    case 'unavailable':
      throw new RuleViolation(family === 'attack' ? 'attack.invalid-target' : 'ability.invalid-target', family === 'attack' ? 'Basic attacks require a living foe.' : 'That ability target is unavailable.');
    case 'relation':
      throw new RuleViolation('attack.invalid-target', 'Attacks can only target foes.');
    case 'stealth':
      throw new RuleViolation(family === 'attack' ? 'attack.stealth' : 'ability.stealth', 'A stealthy character can only be directly targeted from adjacency.');
    case 'range':
      throw new RuleViolation(family === 'attack' ? 'attack.range' : 'ability.range', family === 'attack' ? 'The target is outside basic attack range.' : `${target.name} is outside this ability’s range.`);
    case 'line-of-sight':
      throw new RuleViolation(family === 'attack' ? 'attack.line-of-sight' : 'ability.line-of-sight', `${target.name} is outside line of sight.`);
    default:
      throw new RuleViolation('ability.invalid-target', 'That ability target is unavailable.');
  }
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

/** F7/F9 reactive fold input: when the actor's equipped talent for this
 * ability is a wired slay/collide row, or any equipped job trait registers a
 * collide/slay reaction, compute the post-application trigger targets (the
 * collided actors / the defeated actors) from the ability's recorded
 * mutations — the same dry run that derives the ability's own reactive
 * clauses. The dry run clones the encounter state, so it is skipped when no
 * reactive consumer is equipped. */
function talentReactiveTargets(state: EncounterState, actor: EncounterActor, abilityId: string, mutations: RuleMutation[]): TalentReactiveTargets {
  const talentTrigger = talentReactiveTrigger(actor, abilityId);
  const traitNeeds = traitReactionNeededTriggers(actor);
  const out: TalentReactiveTargets = {};
  if (talentTrigger === 'collide' || traitNeeds.has('collide')) out.collidedActorIds = collidingShoveTargets(state, mutations);
  if (talentTrigger === 'slay' || traitNeeds.has('slay')) out.slainActorIds = reactiveSlayTargets(state, mutations);
  return out;
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

  // Independently executable abilities resolve through their hand-authored
  // typed RuleProgram and named deterministic resolvers; the generic
  // cost/attack approximation is never used. The typed program's selectors
  // enforce their own target ranges, so the reducer only keeps the generic
  // attack-range and line-of-sight gate for the single attack target.
  if (attackAbility && !noAttackSpace) {
    const attackTargetActor = targets[0]!;
    // The effective listed range folds every registered range-modifier rule
    // (listed/conditional/dynamic) for this ability against the current
    // encounter state, so a talent like "Valkyrie gains range 4" genuinely
    // widens target legality — it is never UI-only. A Line X ability's
    // target legality is its effective line length (p.97: the attack space
    // is any character in the area), so the area kernel's shape/size
    // overrides feed the same gate.
    const baseRange = abilityRange(ability.header, ability.range);
    const maximumRange = isLineShaped(ability.header)
      ? effectiveAreaFor(areaStateView(state, actor.id), actor.id, ability.id, 'line', baseRange).length
      : effectiveAbilityRange(rangeStateView(state), actor.id, ability.id, baseRange);
    assertDirectTarget(state, actor, attackTargetActor, {
      relation: 'foe',
      maximumRange,
      trueStrike: ability.tags.includes('true strike'),
      requireLineOfSight: true,
    }, 'ability');
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
    input: { ...(command.input ?? {}), actorIds: { target: targetIds } },
    dice,
    ...(attackAbility && !noAttackSpace && targets[0] ? { attackTargetId: targets[0].id } : {}),
    triggers: abilityTriggers,
  };
  const result = executeRuleProgramWithReactiveTriggers(compilation.program, ruleContext, RULE_RESOLVERS, state);
  // F7 talent fold: the equipped wired talent's trigger-effect mutations ride
  // the same event, so replay applies exactly what the command decided. The
  // slay/collide triggers receive the post-application reactive targets
  // computed from the recorded mutations.
  const reactive = talentReactiveTargets(state, actor, ability.id, result.mutations);
  const talentMutations = talentTriggerMutations(state, actor, ability.id, result.mutations, targetIds, reactive);
  // F9 reactive job-trait fold: equipped wired job-trait reactions (e.g. a
  // once-per-round collide reaction) ride the same event, so replay applies
  // exactly what the command decided.
  const traitReactionMutations_ = traitReactionMutations(state, actor, result.mutations, reactive);
  // F6 Demon Edge: triggering a slow-turn or delay arms the trait's window
  // (vigilance +1, bonus damage until the end of your next turn, and a
  // one-shot true strike) as recorded mutations on the same event.
  const demonEdgeMutations = actor.traitIds.includes(DEMON_EDGE_TRAIT)
    ? demonEdgeSlowTurnMutations(ability.id, actor.id, actor.id, programAction, result.mutations, state.round)
    : [];
  let events: EncounterEvent[] = [attachSaveReroll(state, actor.id, ability.id, ruleContext, dice, {
    type: 'RULE_MUTATIONS_APPLIED',
    actorId: actor.id,
    sourceId: ability.id,
    actionId: programAction.id,
    timing,
    tags: [...programAction.tags],
    mutations: [...result.mutations, ...talentMutations, ...traitReactionMutations_, ...demonEdgeMutations],
  })];
  if (endsTurn && !interrupt) {
    const intermediate = applyEvents(state, events);
    const acting = intermediate.actors[actor.id];
    if (!acting.defeated) {
      events.push(turnEndedEvent(
        intermediate,
        acting,
        dice,
        remainingStatusSaveInput(command.input ?? {}, result.mutations),
        ['stunned'],
        'core:forced-end-turn',
        actor.statuses.includes('stunned') ? 'forced-status' : 'ability-tag',
      ));
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
        assertDirectTarget(state, actor, target, {
          relation: action.tags.includes('attack') ? 'foe' : 'any',
          maximumRange: effectiveAbilityRange(
            rangeStateView(state),
            actor.id,
            unit.id,
            action.range?.kind === 'constant' ? action.range.value : 1,
            action.id,
          ),
          trueStrike: action.tags.includes('true strike'),
          // Preserve the current explicitly reviewed Stealth gate for attacks;
          // non-attack direct-target semantics move with TargetQuery's broader
          // source contract instead of being guessed here.
          targetStealth: action.tags.includes('attack') ? undefined : false,
          requireLineOfSight: true,
        }, 'ability');
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
      let result: RuleExecutionResult;
      try {
        result = executeRuleProgramWithReactiveTriggers(compilation.program, ruleContext, RULE_RESOLVERS, state);
      } catch (error) {
        if (error instanceof StatusSaveViolation) throw new RuleViolation(error.code, error.message);
        throw error;
      }
      // F6 Demon Edge: the generic rule path arms the trait window the same
      // way USE_ABILITY does (slow-turn/delay abilities execute here too).
      const demonEdgeMutations = actor.traitIds.includes(DEMON_EDGE_TRAIT)
        ? demonEdgeSlowTurnMutations(unit.id, actor.id, actor.id, action, result.mutations, state.round)
        : [];
      // F7 talent fold + F9 reactive job-trait fold: symmetric with
      // USE_ABILITY (a no-op for non-ability sources, whose ids never appear
      // in the actor's talent map).
      const reactive = talentReactiveTargets(state, actor, unit.id, result.mutations);
      const spentResources = new Map<string, number>();
      for (const mutation of result.mutations) {
        if (mutation.kind === 'actions' && mutation.operation === 'spend' && mutation.amount > actor.actionsRemaining) throw new RuleViolation('action.insufficient', `${unit.name} costs more actions than are available.`);
        if (mutation.kind === 'resource' && mutation.operation === 'spend') {
          const resourceActor = state.actors[mutation.actorId];
          if (!resourceActor) throw new RuleViolation('resource.actor-missing', `${unit.name} attempted to spend a resource from an unavailable character.`);
          const key = `${resourceActor.id}:${mutation.resourceId}`;
          const spent = (spentResources.get(key) ?? 0) + mutation.amount;
          spentResources.set(key, spent);
          const available = mutation.resourceId === 'resolve' ? state.partyResolve + (resourceActor.resources['personal-resolve'] ?? 0) : resourceActor.resources[mutation.resourceId] ?? 0;
          if (spent > available) throw new RuleViolation('resource.insufficient', `${unit.name} requires ${spent} ${mutation.resourceId}.`);
        }
      }
      events = [attachSaveReroll(state, actor.id, unit.id, ruleContext, dice, {
        type: 'RULE_MUTATIONS_APPLIED',
        actorId: actor.id,
        sourceId: unit.id,
        actionId: command.actionId,
        timing: command.timing,
        tags: [...action.tags],
        // F7 talent fold + F9 reactive job-trait fold: symmetric with USE_ABILITY.
        mutations: [...result.mutations, ...talentTriggerMutations(state, actor, unit.id, result.mutations, command.attackTargetId ? [command.attackTargetId] : [], reactive), ...traitReactionMutations(state, actor, result.mutations, reactive), ...demonEdgeMutations],
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
      // ICON p.172 Succor changes only Rescue's target distance. Keep this a
      // closed source-ID check: a trait name or arbitrary condition cannot
      // accidentally widen the core Rescue action.
      const rescueRange = actor.traitIds.includes('mendicant:trait:succor') ? 4 : 1;
      if (distance(actor.position, target.position) > rescueRange) {
        throw new RuleViolation('rescue.range', rescueRange === 4
          ? 'Succor can only rescue a defeated ally in range 4.'
          : 'The defeated ally must be adjacent.');
      }
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
      // ICON p.91 Recover is Cure self, then save against every saveable
      // status.  Match Diaga's Cure sequence exactly: a cure denial blocks
      // that immediate sequence, while Rot's curse still applies to separate
      // ordinary save windows such as an end turn (pp.144, 186).
      const recovery = resolveEncounterCure(state, actor, dice, command.input ?? {}, 'core:recover');
      const statusSaveMutations = recovery.mutations;
      const preview = clone(state);
      applyRuleMutations(preview, statusSaveMutations);
      const vigorGained = Math.max(0, preview.actors[actor.id]!.vigor - actor.vigor);
      events = [{ type: 'ACTOR_RECOVERED', actorId: actor.id, vigorGained, saves: recovery.saves, statusSaveMutations }];
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
      if (encounterConditionSet(target, state).has('unstoppable')) throw new RuleViolation('status.immune', `${target.name} is immune to statuses while Unstoppable.`);
      events = [{ type: 'STATUS_APPLIED', actorId: command.actorId, targetId: target.id, status: command.status }];
      break;
    }
    case 'END_TURN': {
      const actor = assertActive(state, command.actorId);
      events = [turnEndedEvent(state, actor, dice, command.input ?? {})];
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
      const input = 'input' in command ? command.input ?? {} : {};
      events.push({ type: 'STATUS_REMOVED', actorId: actor.id, status: 'stunned' });
      events.push(turnEndedEvent(
        intermediate,
        actor,
        dice,
        remainingStatusSaveInput(input, statusSaveMutationsFromEvents(events)),
        ['stunned'],
        'core:forced-end-turn',
        'forced-status',
      ));
    }
  }
  if (command.type === 'EXECUTE_RULE' && command.timing === 'use') {
    const intermediate = applyEvents(state, events);
    const actor = intermediate.actors[command.actorId];
    if (actor && !actor.defeated && (state.actors[command.actorId]?.statuses.includes('stunned') || actor.ruleState['end-turn-requested'] === true)) {
      if (actor.statuses.includes('stunned')) events.push({ type: 'STATUS_REMOVED', actorId: actor.id, status: 'stunned' });
      events.push(turnEndedEvent(
        intermediate,
        actor,
        dice,
        remainingStatusSaveInput(command.input, statusSaveMutationsFromEvents(events)),
        ['stunned'],
        'core:forced-end-turn',
        state.actors[command.actorId]?.statuses.includes('stunned') ? 'forced-status' : 'rule-requested',
      ));
    }
  }
  const statusSaveInput = 'input' in command ? command.input ?? {} : {};
  assertStatusSaveChoicesConsumed(statusSaveInput, statusSaveMutationsFromEvents(events));
  return { state: applyEvents(state, events), events };
}

/**
 * Apply a deterministic, lifecycle-owned ability move through the same
 * mutation boundary as a command-time ability. This is what lets p.104
 * Slashed observe delayed self/ally ability movement without reviving the
 * incorrect standard-Move trigger.
 *
 * TODO(ICON-rules, pp.87–94, 104, 107): replace the precomputed destination
 * with a durable SpatialIntent/MoveIntent that records legality, movement
 * path, and trigger windows. Until then, every lifecycle ability that moves a
 * source/self or an ally must call this helper rather than assign `.position`
 * directly, and must provide an exact source ID plus a source/replay fixture.
 */
function applyLifecycleAbilityMove(
  state: EncounterState,
  actor: EncounterActor,
  sourceId: string,
  movement: Extract<RuleMutation, { kind: 'move' }>['movement'],
  destination: Position,
) {
  applyRuleMutations(state, [{
    kind: 'move',
    sourceId,
    sourceActorId: actor.id,
    actorId: actor.id,
    movement,
    distance: null,
    positions: [{ ...destination }],
    direction: null,
    phasing: false,
  }]);
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
    const startPosition = { ...owner.position };
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
    applyLifecycleAbilityMove(state, owner, 'stalwart:great-giorgios', 'rush', position);
    const rushed = distance(startPosition, owner.position);
    if (owner.defeated || distanceTo(owner.position) > 1 || actor.defeated) continue;
    const dx = actor.position.x - owner.position.x;
    const dy = actor.position.y - owner.position.y;
    const direction = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 0, y: 0 } : { x: 0, y: Math.sign(dy) || 0 };
    let shoved = 0;
    while (shoved < rushed) {
      const next = { x: actor.position.x + direction.x, y: actor.position.y + direction.y };
      if (blockedCell(next, actor.id)) break;
      actor.position = next;
      shoved += 1;
    }
    const damage = rushed + 2;
    determineAndApplyEncounterDamage(state, {
      targetId: actor.id,
      sourceActorId: owner.id,
      sourceRuleId: 'stalwart:great-giorgios',
      amount: damage,
      damageType: 'normal',
      instance: 1,
      delivery: 'effect',
      ignoreCover: true,
    });
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
  // applies it here so the regenerated branch is replay-exact. The durable
  // modifiers breakdown (F2) reproduces the exact evaluated modifier; legacy
  // held saves without it fall back to the recorded boon.
  const cursed = event.mutations.some((mutation) => mutation.kind === 'state' && mutation.actorId === heldSave.targetId && mutation.key === 'sucker-punch:curse' && mutation.value === true);
  const modifier = heldSave.modifiers
    ? heldSave.modifiers.sourceModifier + heldSave.modifiers.saveBoon - heldSave.modifiers.saveCurse + (heldSave.modifiers.blessing ? 1 : 0) - (cursed ? 1 : 0)
    : heldSave.boon - (cursed ? 1 : 0);
  // Re-rolling a save means a new d20 and a new boon/curse roll from the same
  // modifier (p.143), not reusing the previous rolled boon value.
  const boon = rollBoonOrCurse(modifier, dice).modifier;
  const total = roll + boon;
  return {
    ...event,
    reroll: {
      roll,
      boon,
      total,
      success: total >= (heldSave.threshold ?? 10),
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

/** Gallows Humor (p.151): whenever you or an ally misses or is missed by an
 * attack anywhere, the stance's d6 power die ticks up by 1 (capped at 6). */
function tickGallowsHumorOnMiss(state: EncounterState) {
  for (const actor of Object.values(state.actors)) tickGallowsHumorDie(actor);
}

function resolveTurnStart(state: EncounterState, next: EncounterActor, intent: TurnTransitionIntent) {
  expireBoundaryEffects(state, next.id, 'turn-start');
  // F3: the registered turn-start participants run in their recorded order.
  runLifecyclePhase(state, next, 'turn-start', intent);
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
 * clear the slow-turn flag, and run the registered turn-end participants
 * (stances, marks, terrain effects, and the Carnevale/Monogatari dice
 * windows) in their recorded order.
 */
function resolveTurnEnd(state: EncounterState, actor: EncounterActor, intent: TurnTransitionIntent) {
  expireBoundaryEffects(state, actor.id, 'turn-end');
  actor.ruleState['slow-turn'] = false;
  actor.ruleStateOwners['slow-turn'] ??= null;
  runLifecyclePhase(state, actor, 'turn-end', intent);
}

/** Roll the Carnevale detonation gamble when the actor armed it, did not
 * attack this turn, and still owns bombs. Rolled here (not in the reducer) so
 * the TURN_ENDED event carries a deterministic value for replay. */
function carnevaleGambleForTurnEnd(state: EncounterState, actor: EncounterActor, dice: DiceSource): number | undefined {
  if (actor.ruleState['carnevale:armed'] !== true || actor.attackedThisTurn) return undefined;
  return Object.values(state.entities).some((entity) => entity.type === 'bomb' && entity.ownerId === actor.id) ? dice.die(6) : undefined;
}

/** The action pool an actor starts a turn with: 2 base actions plus any
 * HP-threshold passive bonus (Enrage: "+1 action while bloodied"), derived
 * from current authoritative HP — never a persisted boolean. */
function derivedTurnStartActions(actor: EncounterActor): number {
  return 2 + projectedHpThresholdActionBonus(actor);
}

/**
 * Apply one already-planned turn boundary.  Command paths may differ in why
 * they end a turn, but every replayed boundary consumes the same ordered
 * `TurnTransitionIntent`: the recorded cause, dice windows, and lifecycle
 * participants (F3).  Legacy events without an intent fall back to the
 * applies gates and the event's top-level dice fields.
 */
function applyTurnTransition(
  state: EncounterState,
  event: Extract<EncounterEvent, { type: 'TURN_ENDED' }>,
) {
  const actor = state.actors[event.actorId];
  const intent: TurnTransitionIntent = event.intent ?? {
    cause: event.cause ?? 'voluntary',
    participants: [],
    diceWindows: {
      ...(event.carnevaleGamble !== undefined ? { carnevaleGamble: event.carnevaleGamble } : {}),
      ...(event.monogatariGamble !== undefined ? { monogatariGamble: event.monogatariGamble } : {}),
    },
    roundAdvance: event.round > state.round,
  };
  if (event.statusSaveMutations) {
    // New events retain every result as mutations so replay does not need
    // fresh dice or re-evaluate temporary status-save policy.
    applyRuleMutations(state, event.statusSaveMutations);
  } else {
    // Historical event logs did not include the mutation ledger.
    actor.statuses = actor.statuses.filter((status) => !event.saves.some((save) => save.status === status && save.cleared));
    actor.conditions = actor.conditions.filter((condition) => !event.saves.some((save) => save.status === condition.id && save.cleared && condition.potency !== 'plus'));
  }
  actor.statuses = actor.statuses.filter((status) => status !== 'hatred');
  actor.conditions = actor.conditions.filter(({ id }) => id !== 'hatred');
  actor.ruleState['end-turn-requested'] = false;
  actor.ruleStateOwners['end-turn-requested'] ??= null;
  if (actor.traitIds.includes('stalwart:trait:fortify')) actor.resources.vigilance = (actor.resources.vigilance ?? 0) + 1;
  // p.104 regeneration (4 vigor at turn end while bloodied) reads the
  // projected condition set, so a durable regeneration condition and a
  // reviewed source-ID mark projection (Rot REGENERATE, p.186) both count.
  if (encounterConditionSet(actor, state).has('regeneration') && isBloodied(actor)) gainVigor(state, actor, 4);
  actor.turnTaken = true;
  resolveTurnEnd(state, actor, intent);
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
    // ICON p.298 Legend role baseline: Juggernaut clears a status or mark at
    // the start of a round. Deterministic — every status, status-condition,
    // and mark on each living legend is cleared before the new round begins.
    for (const candidate of Object.values(state.actors)) {
      if (candidate.roleId !== 'legend' || candidate.defeated) continue;
      candidate.statuses = [];
      candidate.conditions = [];
      candidate.marks = [];
    }
  }
  const next = state.actors[event.nextActorId];
  next.actionsRemaining = derivedTurnStartActions(next);
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
  // The delayed phase (historical resolveDelayedMarkEffects position): runs
  // after the per-actor flag reset so its fresh ability-moves (Great Giorgios
  // rush) are on the next turn's clock and their triggers survive the boundary.
  runLifecyclePhase(state, actor, 'delayed', intent);
  state.round = event.round;
  // F6 round-start phase: every living actor's round-start recipes run (True
  // Horn sturdy, round-5 rages, mantra die tick) with the new round number
  // visible, executing exactly the recorded participants.
  runLifecyclePhaseForAll(state, 'round-start', intent);
  state.activeActorId = event.nextActorId;
  state.lastSide = actor.side;
  // ICON p.107: interrupt windows close at the end of the turn; held damage
  // and held ability effects resolve now (the window was the opportunity).
  resolveHeldInterruptWindows(state);
  expireBoundaryEffects(state, next.id, 'round-start');
  resolveTurnStart(state, next, intent);
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
        // The first actor's turn starts here too: HP-threshold passives
        // (Enrage +1 action while bloodied) derive the action pool from
        // current HP exactly like every later turn boundary.
        state.actors[event.firstActorId].actionsRemaining = derivedTurnStartActions(state.actors[event.firstActorId]);
        for (const actor of Object.values(state.actors)) {
          // Shared per-encounter resources reset to zero when combat begins
          // (aether, combo, blessing, vigilance; personal resolve survives).
          for (const resourceId of perEncounterCharacterResourceIds()) actor.resources[resourceId] = 0;
          actor.ruleState['damage-immune'] = false;
          actor.ruleStateOwners['damage-immune'] ??= null;
          if (actor.traitIds.includes('stalwart:trait:armor-2')) actor.armor = Math.max(2, actor.armor);
        }
        // F6: round 1 is the combat start — durable consumable grants
        // (Defiance), companion summons, and the round-start lifecycle phase
        // (True Horn sturdy, mantra die seed) all apply here, idempotently,
        // so the replayed ENCOUNTER_STARTED event is deterministic.
        applyCombatStartTraitEffects(state);
        runLifecyclePhaseForAll(state, 'round-start', { cause: 'voluntary', participants: [], diceWindows: {}, roundAdvance: true });
        break;
      case 'ACTOR_MOVED': {
        const actor = state.actors[event.actorId];
        const from = { ...actor.position };
        actor.position = event.path.at(-1)!;
        actor.standardMoveUsed ||= event.mode === 'standard';
        pickupThrownWeapon(state, actor, [from, actor.position, ...event.path]);
        if (event.mode === 'dash') {
          // ICON p.168 Path of the Aesi: while the owner has Stealth the Dash
          // action is free. Closed source-ID check — a trait name or a bare
          // condition could never accidentally waive the core Dash cost.
          const freeDash = actor.traitIds.includes('warden:trait:path-of-the-aesi') && encounterConditionSet(actor, state).has('stealth');
          if (!freeDash) actor.actionsRemaining -= 1;
          actor.usedAbilityIds.push('basic:dash');
        }
        // Movement events intentionally retain source amounts.  Do not route
        // them through applyDeterminedEncounterDamage: that API is only for
        // a persisted post-mitigation amount and would bypass p.93 here.
        // New events carry the F0 damage ledger (source handoff); historical
        // events replay the loose numeric field the same way.
        if (event.ledger) {
          if (event.ledger.amount > 0) {
            applyDamageLedger(state, event.ledger);
            actor.dangerousTerrainTriggeredThisTurn = true;
          }
        } else if (event.dangerousDamage) {
          determineAndApplyEncounterDamage(state, {
            targetId: actor.id,
            sourceRuleId: 'core:dangerous-terrain',
            amount: event.dangerousDamage,
            damageType: 'piercing',
            bypassVigor: true,
            instance: 1,
            delivery: 'terrain',
            ignoreCover: true,
          });
          actor.dangerousTerrainTriggeredThisTurn = true;
        }
        // `slashedDamage` is a retired compatibility field. p.104 Slashed
        // belongs to the self/ally ability-mutation trigger in the encounter
        // adapter, not to a standard MOVE/DASH event. Leave old snapshots
        // readable without perpetuating their incorrect core-movement damage.
        // Symphony mote movement-entry detonation is now handled by the
        // movement-entry trigger fold (kernels/movement-triggers.ts), not here.
        break;
      }
      case 'ATTACK_RESOLVED': {
        const actor = state.actors[event.actorId];
        const target = state.actors[event.targetId];
        actor.actionsRemaining -= event.weight === 'heavy' ? 2 : 1;
        actor.attackedThisTurn = true;
        if (event.hit) discardWickedSheathDie(actor);
        breakStealth(actor);
        // New events replay the durable AttackResolution ledger (the full
        // determined amount nested in its downstream damage record, plus the
        // recorded floor/defeat result). Historical events without the ledger
        // replay the reduced applied amount plus the durable defiance flag.
        if (event.attackResolution) applyDamageLedger(state, event.attackResolution.damage);
        else {
          applyDeterminedEncounterDamage(state, target, actor, {
            amount: event.appliedDamage,
            damageType: 'normal',
            sourceActorId: actor.id,
            sourceId: event.weight === 'heavy' ? 'core:heavy-attack' : 'core:light-attack',
            instance: 1,
            delivery: event.hit ? 'hit' : 'miss',
            ignoreCover: false,
            ...(event.defianceTriggered === true ? { defianceTriggered: true } : {}),
          });
        }
        consumeMassiveOverhead(state, actor, target);
        // F6: armed one-shot trait modifiers (Demon Edge true strike,
        // Hissatsu) are consumed by the attack that read them, exactly like
        // Massive Overhead's arm — a reducer-time decision on the rebuilt
        // state, so replay consumes identically.
        consumeTraitAttackModifiers(actor.ruleState);
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
          // New events carry the durable ledger; historical ABILITY_RESOLVED
          // events keep the documented lossy bypassVigor → divine mapping.
          if (event.attack.ledger) applyDamageLedger(state, event.attack.ledger);
          else {
            applyDeterminedEncounterDamage(state, target, actor, {
              amount: event.attack.appliedDamage,
              damageType: event.attack.bypassVigor ? 'divine' : 'normal',
              sourceActorId: actor.id,
              sourceId: event.abilityId,
              instance: 1,
              delivery: event.attack.hit ? 'hit' : 'miss',
              ignoreCover: false,
            });
          }
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
        // F6: the VM's attack roll consumed armed one-shot trait modifiers at
        // plan time; clear them on the rebuilt state so replay sees the same
        // post-attack ruleState (the roll itself is already recorded).
        if (event.mutations.some((mutation) => mutation.kind === 'attack')) consumeTraitAttackModifiers(actor.ruleState);
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
        if (encounterConditionSet(actor, state).has('chain-reaction') && actor.ruleState['chain-reaction-used'] !== true) {
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
        defeatActor(state, actor, { woundGained: event.woundGained });
        break;
      }
      case 'VIGILANCE_SPENT': {
        const actor = state.actors[event.actorId];
        const target = state.actors[event.targetId];
        actor.resources.vigilance = Math.max(0, (actor.resources.vigilance ?? 0) - 1);
        // New events replay the durable ledger; historical events replay the
        // reduced applied amount plus the durable defiance flag.
        if (event.ledger) applyDamageLedger(state, event.ledger);
        else {
          applyDeterminedEncounterDamage(state, target, actor, {
            amount: event.appliedDamage,
            damageType: 'normal',
            sourceActorId: actor.id,
            sourceId: 'core:vigilance',
            instance: 1,
            delivery: 'effect',
            ignoreCover: true,
            ...(event.defianceTriggered === true ? { defianceTriggered: true } : {}),
          });
        }
        break;
      }
      case 'ACTOR_RECOVERED': {
        const actor = state.actors[event.actorId];
        actor.actionsRemaining -= 2;
        actor.usedAbilityIds.push('basic:recover');
        if (event.statusSaveMutations) {
          // New events replay the full cure/save ledger, including policy
          // denial, Rot's curse, and any explicit Blessing spend.
          applyRuleMutations(state, event.statusSaveMutations);
        } else {
          // Historical event logs only recorded outcome booleans.
          gainVigor(state, actor, event.vigorGained);
          actor.statuses = actor.statuses.filter((status) => !event.saves.some((save) => save.status === status && save.cleared));
        }
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
        applyTurnTransition(state, event);
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
