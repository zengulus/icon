import { ENCOUNTER_SCHEMA_VERSION, RULES_VERSION, type CommandResult, type EncounterActor, type EncounterCommand, type EncounterEvent, type EncounterState, type IconCharacter, type Position, type StatusId } from './types.js';
import { findAbility, findJob } from './catalog.js';
import { FOE_PROFILES, findFoeProfile, findFoeRole } from './foes.js';
import { characterStats } from './character.js';
import { randomDice, rollBoonOrCurse, rollDamage, type DiceSource } from './dice.js';

export class RuleViolation extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

const makeId = () => globalThis.crypto?.randomUUID?.() ?? `encounter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = <T>(value: T): T => structuredClone(value);
const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const distance = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

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
    revision: 0,
    eventLog: [],
  };
}

export function migrateEncounter(input: unknown): EncounterState {
  if (!input || typeof input !== 'object') throw new RuleViolation('encounter.invalid', 'Encounter data must be an object.');
  const candidate = input as Omit<Partial<EncounterState>, 'schemaVersion'> & { schemaVersion?: number };
  if (candidate.schemaVersion !== 1 && candidate.schemaVersion !== ENCOUNTER_SCHEMA_VERSION) {
    throw new RuleViolation('encounter.schema', `Unsupported encounter schema version: ${String(candidate.schemaVersion)}`);
  }
  const base = createEncounter(typeof candidate.name === 'string' ? candidate.name : 'Migrated encounter');
  const actors = Object.fromEntries(Object.entries(candidate.actors ?? {}).map(([id, value]) => {
    const actor = value as Partial<EncounterActor>;
    return [id, {
      ...actor,
      id,
      foeProfileId: actor.foeProfileId ?? null,
      chapter: actor.chapter ?? 1,
      abilityIds: [...(actor.abilityIds ?? [])],
      usedAbilityIds: [...(actor.usedAbilityIds ?? [])],
      interruptUses: { ...(actor.interruptUses ?? {}) },
      interruptUsedThisTurn: actor.interruptUsedThisTurn ?? false,
      slashedTriggeredThisTurn: actor.slashedTriggeredThisTurn ?? false,
    } as EncounterActor];
  }));
  return {
    ...base,
    ...candidate,
    schemaVersion: ENCOUNTER_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    grid: { ...base.grid, ...(candidate.grid ?? {}), terrain: [...(candidate.grid?.terrain ?? [])] },
    actors,
    eventLog: [...(candidate.eventLog ?? [])],
  };
}

export function actorFromCharacter(character: IconCharacter, position: Position, controllerId: string | null = null): EncounterActor {
  const stats = characterStats(character);
  const job = character.primaryJobId ? findJob(character.primaryJobId) : undefined;
  if (!stats || !job) throw new RuleViolation('character.job-required', 'A valid primary Job is required before entering combat.');
  return {
    id: `actor:${character.id}`,
    name: character.name || 'Unnamed Icon',
    side: 'heroes',
    controllerId,
    characterId: character.id,
    foeProfileId: null,
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
    defeated: false,
    actionsRemaining: 2,
    standardMoveUsed: false,
    attackedThisTurn: false,
    usedAbilityIds: [],
    interruptUses: {},
    interruptUsedThisTurn: false,
    slashedTriggeredThisTurn: false,
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
    defeated: false,
    actionsRemaining: 2,
    standardMoveUsed: false,
    attackedThisTurn: false,
    usedAbilityIds: [],
    interruptUses: {},
    interruptUsedThisTurn: false,
    slashedTriggeredThisTurn: false,
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

export function createFoeFromProfile(profileId: string, position: Position, playerCount = 4, chapter: 1 | 2 | 3 = 1): EncounterActor {
  const profile = findFoeProfile(profileId);
  if (!profile) throw new RuleViolation('foe.profile-unknown', 'That foe profile does not exist in ICON 1.5.');
  const role = findFoeRole(profile.roleId);
  if (!role || profile.roleId === 'special') throw new RuleViolation('foe.role-special', 'Special foe components require a parent profile.');
  if (role.id === 'mob') throw new RuleViolation('foe.mob-unsupported', 'Mob profiles require member-level state that is not executable yet.');

  const listedHp = Number(profile.traitsText.match(/\bHP\s*:\s*(\d+)/i)?.[1] ?? 0);
  const roleHp = role.id === 'legend' ? Math.max(role.minimumHp ?? 0, (role.hpPerPlayer ?? 0) * Math.max(1, playerCount)) : role.hp ?? 1;
  const maxHp = listedHp || (profile.kind === 'elite' ? roleHp * 2 : roleHp);
  return {
    id: `foe:${makeId()}`,
    name: profile.name,
    side: 'foes',
    controllerId: null,
    characterId: null,
    foeProfileId: profile.id,
    tokenUrl: '',
    classId: 'foe',
    chapter,
    abilityIds: foeAbilityIds(profile.id),
    position,
    vitality: role.vitality ?? Math.max(1, Math.ceil(maxHp / 4)),
    baseMaxHp: maxHp,
    hp: maxHp,
    vigor: 0,
    wounds: 0,
    defense: role.defense,
    armor: role.id === 'heavy' ? 2 : 0,
    speed: role.speed,
    dash: role.dash,
    fray: role.fray,
    damageDie: role.damageDie,
    basicAttackRange: 1,
    statuses: [],
    defeated: false,
    actionsRemaining: 2,
    standardMoveUsed: false,
    attackedThisTurn: false,
    usedAbilityIds: [],
    interruptUses: {},
    interruptUsedThisTurn: false,
    slashedTriggeredThisTurn: false,
    turnTaken: false,
  };
}

function terrainAt(state: EncounterState, position: Position) {
  return state.grid.terrain.find((cell) => samePosition(cell.position, position));
}

function assertActive(state: EncounterState, actorId: string) {
  if (state.phase !== 'active') throw new RuleViolation('encounter.not-active', 'The encounter is not active.');
  if (state.activeActorId !== actorId) throw new RuleViolation('turn.not-active-actor', 'Only the active actor can take that action.');
  const actor = state.actors[actorId];
  if (!actor || actor.defeated) throw new RuleViolation('actor.unavailable', 'That actor cannot act.');
  return actor;
}

function nextActor(state: EncounterState, current: EncounterActor) {
  const living = Object.values(state.actors).filter((actor) => !actor.defeated && !actor.turnTaken && actor.id !== current.id);
  const alternate = living.find((actor) => actor.side !== current.side);
  const same = living.find((actor) => actor.side === current.side);
  if (alternate || same) return { actor: alternate ?? same!, round: state.round };
  const nextRoundActors = Object.values(state.actors).filter((actor) => !actor.defeated && actor.id !== current.id);
  const preferred = nextRoundActors.find((actor) => actor.side !== current.side) ?? nextRoundActors[0] ?? current;
  return { actor: preferred, round: state.round + 1 };
}

function saveStatuses(statuses: StatusId[], dice: DiceSource) {
  return statuses.map((status) => {
    const roll = dice.die(20);
    return { status, roll, cleared: roll >= 10 };
  });
}

function movementEvents(state: EncounterState, command: Extract<EncounterCommand, { type: 'MOVE' }>): EncounterEvent[] {
  const actor = assertActive(state, command.actorId);
  if (command.path.length === 0) throw new RuleViolation('move.empty', 'Choose at least one destination space.');
  if (command.mode === 'standard' && actor.standardMoveUsed) throw new RuleViolation('move.standard-used', 'The standard move has already been used this turn.');
  if (command.mode === 'dash' && actor.actionsRemaining < 1) throw new RuleViolation('action.insufficient', 'Dashing costs one action.');
  if (command.mode === 'dash' && actor.usedAbilityIds.includes('basic:dash')) throw new RuleViolation('ability.repeat', 'Dash cannot be repeated during the same turn.');
  const allowance = command.mode === 'standard' ? actor.speed : actor.dash;
  let previous = actor.position;
  let cost = 0;
  let dangerousDamage = 0;
  for (const point of command.path) {
    if (point.x < 0 || point.y < 0 || point.x >= state.grid.width || point.y >= state.grid.height) throw new RuleViolation('move.out-of-bounds', 'Movement cannot leave the battlefield.');
    if (Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) !== 1) throw new RuleViolation('move.orthogonal', 'Movement must follow an orthogonal, contiguous path.');
    const occupant = Object.values(state.actors).find((other) => !other.defeated && other.id !== actor.id && samePosition(other.position, point));
    if (occupant && (occupant.side !== actor.side || samePosition(point, command.path.at(-1)!))) {
      throw new RuleViolation('move.obstructed', occupant.side === actor.side ? 'Movement can pass through an ally but cannot end in their space.' : 'A foe obstructs that space.');
    }
    const terrain = terrainAt(state, point);
    if (terrain?.type === 'impassable') throw new RuleViolation('move.impassable', 'Impassable terrain obstructs movement.');
    const previousTerrain = terrainAt(state, previous);
    const terrainPenalty = previousTerrain?.type === 'difficult' ? 1 : 0;
    const rawElevationPenalty = Math.max(0, (terrain?.elevation ?? 0) - (previousTerrain?.elevation ?? 0));
    const elevationPenalty = Math.max(0, rawElevationPenalty - (previousTerrain?.type === 'slope' ? 1 : 0));
    if (elevationPenalty >= 4) throw new RuleViolation('move.elevation', 'Normal movement cannot climb four or more elevation levels at once.');
    const engagementPenalty = command.mode === 'dash' ? 0 : Object.values(state.actors).some((other) => other.side !== actor.side && !other.defeated && distance(other.position, previous) <= 1) ? 1 : 0;
    cost += 1 + Math.max(terrainPenalty, elevationPenalty, engagementPenalty);
    if ((terrain?.type === 'dangerous' || previousTerrain?.type === 'dangerous') && dangerousDamage === 0) dangerousDamage = 2;
    previous = point;
  }
  if (cost > allowance) throw new RuleViolation('move.too-far', `That path costs ${cost} movement; only ${allowance} is available.`);
  const slashedDamage = actor.statuses.includes('slashed') && !actor.slashedTriggeredThisTurn ? Math.max(0, 4 - actor.armor) : 0;
  const hpAfterDanger = Math.max(0, actor.hp - dangerousDamage);
  const hpAfterSlashed = Math.max(0, hpAfterDanger - Math.max(0, slashedDamage - actor.vigor));
  const events: EncounterEvent[] = [{ type: 'ACTOR_MOVED', actorId: actor.id, path: command.path, mode: command.mode, dangerousDamage, slashedDamage }];
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
  let netBoon = command.boons ?? 0;
  const actorElevation = terrainAt(state, actor.position)?.elevation ?? 0;
  const targetElevation = terrainAt(state, target.position)?.elevation ?? 0;
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
  if (command.cover && distance(actor.position, target.position) > 1) reduced = Math.ceil(reduced / 2);
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

function hasLineOfSight(state: EncounterState, from: Position, to: Position) {
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

function abilityAttack(
  state: EncounterState,
  actor: EncounterActor,
  target: EncounterActor,
  ability: NonNullable<ReturnType<typeof findAbility>>,
  command: Extract<EncounterCommand, { type: 'USE_ABILITY' }>,
  dice: DiceSource,
): NonNullable<Extract<EncounterEvent, { type: 'ABILITY_RESOLVED' }>['attack']> {
  const automatic = /\bAttack:\s*Auto hit:/i.test(ability.rulesText);
  let netBoon = command.boons ?? 0;
  netBoon += Number(ability.header.match(/\+(\d+)\s+boon/i)?.[1] ?? 0);
  const actorElevation = terrainAt(state, actor.position)?.elevation ?? 0;
  const targetElevation = terrainAt(state, target.position)?.elevation ?? 0;
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
      const coverApplies = command.cover && distance(actor.position, target.position) > 1 && actorElevation <= targetElevation && !ability.tags.includes('unerring') && !divine;
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
  if (!actor || actor.defeated) throw new RuleViolation('actor.unavailable', 'That actor cannot use an ability.');
  const ability = findAbility(command.abilityId);
  if (!ability) throw new RuleViolation('ability.unknown', 'That ability does not exist in ICON 1.5.');
  if (!actor.abilityIds.includes(ability.id)) throw new RuleViolation('ability.not-equipped', 'That ability is not in this actor’s expedition loadout.');
  if (ability.chapter > actor.chapter) throw new RuleViolation('ability.chapter', `Chapter ${ability.chapter} abilities are not available to this actor.`);
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
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(acting.statuses.filter((status) => status !== 'stunned'), dice) });
    }
  }
  return events;
}

export function executeCommand(state: EncounterState, command: EncounterCommand, dice: DiceSource = randomDice): CommandResult {
  let events: EncounterEvent[] = [];
  switch (command.type) {
    case 'ADD_ACTOR':
      if (state.phase !== 'setup') throw new RuleViolation('setup.closed', 'Actors can only be added during setup.');
      if (state.actors[command.actor.id]) throw new RuleViolation('actor.duplicate', 'That actor is already on the battlefield.');
      if (Object.values(state.actors).some((actor) => samePosition(actor.position, command.actor.position))) throw new RuleViolation('actor.position', 'That space is occupied.');
      events = [{ type: 'ACTOR_ADDED', actor: command.actor }];
      break;
    case 'REMOVE_ACTOR':
      if (state.phase !== 'setup') throw new RuleViolation('setup.closed', 'Actors can only be removed during setup.');
      events = [{ type: 'ACTOR_REMOVED', actorId: command.actorId }];
      break;
    case 'SET_TERRAIN':
      if (state.phase !== 'setup') throw new RuleViolation('setup.closed', 'Terrain can only be changed during setup.');
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
      const saves = saveStatuses(actor.statuses, dice);
      const cap = actor.vitality;
      const vigorGained = actor.statuses.includes('shattered') ? 0 : Math.max(0, Math.min(cap, actor.vigor + (actor.hp <= actor.baseMaxHp / 2 ? cap : 4)) - actor.vigor);
      events = [{ type: 'ACTOR_RECOVERED', actorId: actor.id, vigorGained, saves }];
      break;
    }
    case 'APPLY_STATUS': {
      const actor = assertActive(state, command.actorId);
      if (actor.statuses.includes('sealed')) throw new RuleViolation('status.sealed', 'Sealed characters cannot inflict statuses.');
      const target = state.actors[command.targetId];
      if (!target || target.defeated) throw new RuleViolation('status.target', 'That status target is unavailable.');
      events = [{ type: 'STATUS_APPLIED', actorId: command.actorId, targetId: target.id, status: command.status }];
      break;
    }
    case 'END_TURN': {
      const actor = assertActive(state, command.actorId);
      const next = nextActor(state, actor);
      events = [{ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor.statuses, dice) }];
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
      events.push({ type: 'TURN_ENDED', actorId: actor.id, nextActorId: next.actor.id, round: next.round, saves: saveStatuses(actor.statuses.filter((status) => status !== 'stunned'), dice) });
    }
  }
  return { state: applyEvents(state, events), events };
}

export function applyEvents(input: EncounterState, events: EncounterEvent[]): EncounterState {
  const state = clone(input);
  for (const event of events) {
    switch (event.type) {
      case 'ACTOR_ADDED':
        state.actors[event.actor.id] = clone(event.actor);
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
        break;
      case 'ACTOR_MOVED': {
        const actor = state.actors[event.actorId];
        actor.position = event.path.at(-1)!;
        actor.standardMoveUsed ||= event.mode === 'standard';
        if (event.mode === 'dash') {
          actor.actionsRemaining -= 1;
          actor.usedAbilityIds.push('basic:dash');
        }
        if (event.dangerousDamage) actor.hp = Math.max(0, actor.hp - event.dangerousDamage);
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
        for (const candidate of Object.values(state.actors)) {
          candidate.usedAbilityIds = [];
          candidate.interruptUsedThisTurn = false;
          candidate.slashedTriggeredThisTurn = false;
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
        }
        break;
    }
    state.revision += 1;
    state.eventLog.push(clone(event));
  }
  return state;
}

export function replayEncounter(initial: EncounterState, events: EncounterEvent[]) {
  return applyEvents({ ...clone(initial), eventLog: [], revision: 0 }, events);
}
