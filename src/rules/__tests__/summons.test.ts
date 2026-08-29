import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { defeatActor, encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { validateEntityCreation } from '../automation/kernels/entity-creation.js';
import { executeRuleProgram, RuleProgramViolation } from '../automation/kernels/runtime.js';
import type { RuleEffect, RuleExecutionContext, RuleMutation, RuleProgram, RuleSelector } from '../automation/primitives/types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand, migrateEncounter } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position, TerrainCell } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

interface SummonFixture { state: EncounterState; hero: EncounterActor; foe: EncounterActor; }

function summonEncounter(traits: string[]): SummonFixture {
  let state = createEncounter('Summon fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
  hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
  for (const traitId of traits) hero.traitIds.push(traitId);
  const foe = createFoeFromProfile('basic:knuckle:301', { x: 5, y: 1 }, 4);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

const entitiesOf = (state: EncounterState, type: string, ownerId: string) =>
  Object.values(state.entities).filter((entity) => entity.type === type && entity.ownerId === ownerId);

const entityCreate = (ownerId: string, entityType: string, companion = false, index = 0): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED', actorId: ownerId, sourceId: 'fixture:summon', actionId: 'default', timing: 'use', tags: [],
  mutations: [{ kind: 'entity', sourceId: 'fixture:summon', ownerId, entityType, operation: 'create', positions: [{ x: 2 + (index % 6), y: 2 + Math.floor(index / 6) }], count: 1, state: companion ? { companion: true } : {} }],
});

describe('F6 persistent companions (combat-start summons)', () => {
  it('Beast Master places a great-beast companion in range 2 at combat start', () => {
    const { state, hero } = summonEncounter(['warden:trait:beast-master']);
    const beasts = entitiesOf(state, 'beast', hero.id);
    expect(beasts).toHaveLength(1);
    expect(beasts[0].state.companion).toBe(true);
    expect(Math.max(Math.abs(beasts[0].positions[0].x - hero.position.x), Math.abs(beasts[0].positions[0].y - hero.position.y))).toBeLessThanOrEqual(2);
  });
  it('Bound Spirit places a seraph companion in range 2 at combat start', () => {
    const { state, hero } = summonEncounter(['freelancer:trait:bound-spirit']);
    const seraphs = entitiesOf(state, 'seraph', hero.id);
    expect(seraphs).toHaveLength(1);
    expect(seraphs[0].state.companion).toBe(true);
    expect(Math.max(Math.abs(seraphs[0].positions[0].x - hero.position.x), Math.abs(seraphs[0].positions[0].y - hero.position.y))).toBeLessThanOrEqual(2);
  });
  it('Selkie places an elemental companion in range 3 at combat start', () => {
    const { state, hero } = summonEncounter(['stormbender:trait:selkie']);
    const elementals = entitiesOf(state, 'selkie', hero.id);
    expect(elementals).toHaveLength(1);
    expect(elementals[0].state.companion).toBe(true);
    expect(Math.max(Math.abs(elementals[0].positions[0].x - hero.position.x), Math.abs(elementals[0].positions[0].y - hero.position.y))).toBeLessThanOrEqual(3);
  });
  it('a combat-start companion survives the owner’s defeat', () => {
    const { state, hero } = summonEncounter(['warden:trait:beast-master']);
    const companionId = entitiesOf(state, 'beast', hero.id)[0].id;
    defeatActor(state, state.actors[hero.id]);
    expect(state.actors[hero.id].defeated).toBe(true);
    expect(state.entities[companionId]).toBeDefined();
    expect(state.entities[companionId].state.companion).toBe(true);
  });
});

describe('F6 generic entity creation authority', () => {
  it('rejects occupied/out-of-bounds positions and deterministically selects valid positions', () => {
    const { state, hero } = summonEncounter([]);
    // Hero at (1,1): that cell is occupied by the summoner and rejected.
    // ICON general rule: the summoner occupies space like any other character.
    const result = validateEntityCreation(state, { ownerId: hero.id, entityType: 'bomb', count: 3, positions: [{ x: -1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }], state: {}, duration: null });
    expect(result).toEqual({ positions: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }], count: 3 });
  });
  it('applies the registered per-owner cap to multi-create requests', () => {
    const { state, hero } = summonEncounter([]);
    const first = validateEntityCreation(state, { ownerId: hero.id, entityType: 'bomb', count: 8, positions: Array.from({ length: 8 }, (_, index) => ({ x: index, y: 2 })), state: {}, duration: null });
    expect(first?.count).toBe(6);
  });
});

describe('F6 entity creation LoS and range enforcement', () => {
  it('rejects a destination behind impassable terrain when LoS is required', () => {
    const { state, hero } = summonEncounter([]);
    // Place an impassable wall between the hero at (1,1) and position (3,1).
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 });
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 3, y: 1 }],
      state: {}, duration: null,
      spatial: { origin: { x: 1, y: 1 } },
    });
    // The impassable terrain at (2,1) blocks LoS from (1,1) to (3,1).
    expect(result).toBeNull();
  });
  it('accepts a destination within range and line of sight', () => {
    const { state, hero } = summonEncounter([]);
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 3, y: 1 }],
      state: {}, duration: null,
      spatial: { origin: { x: 1, y: 1 }, maxRange: 5 },
    });
    expect(result).toEqual({ positions: [{ x: 3, y: 1 }], count: 1 });
  });
  it('rejects a destination beyond maximum range', () => {
    const { state, hero } = summonEncounter([]);
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 8, y: 1 }],
      state: {}, duration: null,
      spatial: { origin: { x: 1, y: 1 }, maxRange: 3 },
    });
    expect(result).toBeNull();
  });
  it('accepts the exact maximum range boundary', () => {
    const { state, hero } = summonEncounter([]);
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 4, y: 1 }],
      state: {}, duration: null,
      spatial: { origin: { x: 1, y: 1 }, maxRange: 3 },
    });
    expect(result).toEqual({ positions: [{ x: 4, y: 1 }], count: 1 });
  });
  it('uses Chebyshev (diagonal) distance for range validation', () => {
    const { state, hero } = summonEncounter([]);
    // Diagonal distance from (1,1) to (3,3) = max(|3-1|,|3-1|) = 2
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 3, y: 3 }],
      state: {}, duration: null,
      spatial: { origin: { x: 1, y: 1 }, maxRange: 2 },
    });
    expect(result).toEqual({ positions: [{ x: 3, y: 3 }], count: 1 });
  });
  it('accepts creation when no origin or maxRange are provided (backward-compatible path)', () => {
    // Without origin/maxRange the kernel skips LoS/range checks — this is the
    // backward-compatible path for existing mutations without source-declared
    // origin metadata.
    const { state, hero } = summonEncounter([]);
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 3, y: 1 }],
      state: {}, duration: null,
    });
    expect(result).toEqual({ positions: [{ x: 3, y: 1 }], count: 1 });
  });
  it('uses p.92 footprint distance for Size > 1 origins', () => {
    const { state, hero } = summonEncounter([]);
    // Hero at (1,1) with size 2 occupies cells (1,1), (1,2), (2,1), (2,2).
    // The footprint distance from origin footprint to (4,1) = max(0, 4-(1+2-1)) = max(0, 2) = 2.
    hero.size = 2;
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 4, y: 1 }],
      state: {}, duration: null,
      spatial: { origin: hero.position, originSize: 2, maxRange: 2 },
    });
    expect(result).toEqual({ positions: [{ x: 4, y: 1 }], count: 1 });
  });
  it('rejects one space beyond the Size-2 origin footprint range', () => {
    const { state, hero } = summonEncounter([]);
    hero.size = 2;
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 5, y: 1 }],
      state: {}, duration: null,
      spatial: { origin: hero.position, originSize: 2, maxRange: 2 },
    });
    expect(result).toBeNull();
  });
});

describe('F6 entity creation origin fail-closed (production path: RuleEffect → runtime → mutation → reducer)', () => {
  // The origin/range of entity creation is a source-declared PAIRED spatial
  // contract. These tests exercise the real production chain: a VM RuleEffect
  // carrying the contract resolves through the runtime's effectsToMutations
  // (origin selector validated fail-closed), the emitted RuleMutation rides a
  // RULE_MUTATIONS_APPLIED event, and the reducer's validateEntityCreation
  // enforces LoS/range/occupancy on replay — never a hand-authored final
  // mutation masquerading as VM coverage.
  const createProgram = (spatial: { origin: RuleSelector; maxRange?: number }): RuleProgram => ({
    schemaVersion: 1,
    rulesVersion: '1.5',
    id: 'program:fixture-create',
    sourceId: 'fixture:create',
    source: { page: 1, sectionId: 'test' },
    name: 'Fixture Create',
    classification: 'encounter',
    dependencies: [],
    actions: [{
      id: 'use', name: 'Fixture Create', timing: 'use', costs: [], tags: [], range: null, area: null, choices: [],
      steps: [{ id: 'create', timing: 'use', effects: [{
        kind: 'entity', operation: 'create', entityType: 'bomb', owner: { kind: 'self' },
        positionInput: 'cell', count: { kind: 'constant', value: 1 }, spatial,
      }] }],
    }],
  });
  const runtimeContext = (state: EncounterState, heroId: string, cell: Position, overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext => ({
    state: encounterRuleState(state),
    actorId: heroId,
    sourceId: 'fixture:create',
    actionId: 'use',
    timing: 'use',
    input: { positions: { cell: [cell] } },
    dice: scriptedDice(5),
    triggers: new Set(),
    ...overrides,
  });
  const eventFrom = (heroId: string, mutations: RuleMutation[]): EncounterEvent => ({
    type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'fixture:create',
    actionId: 'use', timing: 'use', tags: [], mutations,
  });
  const entityMutationOf = (result: ReturnType<typeof executeRuleProgram>): Extract<RuleMutation, { kind: 'entity' }> => {
    const mutation = result.mutations.find((candidate): candidate is Extract<RuleMutation, { kind: 'entity' }> => candidate.kind === 'entity');
    expect(mutation).toBeDefined();
    return mutation!;
  };

  it('valid source-declared origin+range: runtime emits the paired contract and the reducer creates the entity', () => {
    const { state, hero } = summonEncounter([]);
    const result = executeRuleProgram(createProgram({ origin: { kind: 'self' }, maxRange: 5 }), runtimeContext(state, hero.id, { x: 3, y: 1 }));
    const mutation = entityMutationOf(result);
    // The runtime resolved the self-origin (hero at (1,1), size 1) into the
    // replay-safe paired contract.
    expect(mutation.creationSpatial).toEqual({ origin: { x: 1, y: 1 }, originSize: 1, maxRange: 5 });
    const applied = applyEvents(state, [eventFrom(hero.id, [mutation])]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(1);
    expect(entitiesOf(applied, 'bomb', hero.id)[0].positions).toEqual([{ x: 3, y: 1 }]);
  });
  it('zero-match origin selector is rejected before any mutation is emitted', () => {
    const { state, hero } = summonEncounter([]);
    expect(() => executeRuleProgram(
      createProgram({ origin: { kind: 'input', key: 'origin', relation: 'any' }, maxRange: 5 }),
      runtimeContext(state, hero.id, { x: 3, y: 1 }, { input: { positions: { cell: [{ x: 3, y: 1 }] }, actorIds: { origin: [] } } }),
    )).toThrow(RuleProgramViolation);
  });
  it('multi-match origin selector is rejected when exactly one origin is required', () => {
    const { state, hero } = summonEncounter([]);
    expect(() => executeRuleProgram(
      createProgram({ origin: { kind: 'all', relation: 'any' }, maxRange: 5 }),
      runtimeContext(state, hero.id, { x: 3, y: 1 }),
    )).toThrow(RuleProgramViolation);
  });
  it('off-board origin actor (no valid position) is rejected', () => {
    const { state, hero } = summonEncounter([]);
    state.actors[hero.id].onBattlefield = false;
    expect(() => executeRuleProgram(
      createProgram({ origin: { kind: 'self' }, maxRange: 5 }),
      runtimeContext(state, hero.id, { x: 3, y: 1 }),
    )).toThrow(RuleProgramViolation);
  });
  it('a declared maxRange without an origin is rejected by the runtime (unrepresentable pairing, defended anyway)', () => {
    const { state, hero } = summonEncounter([]);
    const malformed = createProgram({ origin: { kind: 'self' } });
    malformed.actions[0].steps = [{
      id: 'create', timing: 'use', effects: [{
        kind: 'entity', operation: 'create', entityType: 'bomb', owner: { kind: 'self' },
        positionInput: 'cell', count: { kind: 'constant', value: 1 },
        spatial: { maxRange: 5 },
      } as unknown as RuleEffect],
    }];
    expect(() => executeRuleProgram(malformed, runtimeContext(state, hero.id, { x: 3, y: 1 }))).toThrow('Entity creation declares a maximum range but no origin');
  });
  it('reducer rejects a malformed maxRange-only creationSpatial (no silent unlimited creation)', () => {
    const { state, hero } = summonEncounter([]);
    const event: EncounterEvent = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'fixture:summon',
      actionId: 'default', timing: 'use', tags: [],
      mutations: [{
        kind: 'entity', sourceId: 'fixture:summon', ownerId: hero.id,
        entityType: 'bomb', operation: 'create',
        positions: [{ x: 3, y: 1 }], count: 1, state: {},
        creationSpatial: { origin: undefined as unknown as Position, originSize: 1, maxRange: 5 },
      }],
    };
    const applied = applyEvents(state, [event]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(0);
  });
  it('reducer rejects an off-board carried origin (out of the battlefield grid)', () => {
    const { state, hero } = summonEncounter([]);
    const event: EncounterEvent = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'fixture:summon',
      actionId: 'default', timing: 'use', tags: [],
      mutations: [{
        kind: 'entity', sourceId: 'fixture:summon', ownerId: hero.id,
        entityType: 'bomb', operation: 'create',
        positions: [{ x: 3, y: 1 }], count: 1, state: {},
        creationSpatial: { origin: { x: 50, y: 50 }, originSize: 1, maxRange: 5 },
      }],
    };
    const applied = applyEvents(state, [event]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(0);
  });
  it('reducer rejects entity creation when the creation origin is present but unreachable (behind wall)', () => {
    const { state, hero } = summonEncounter([]);
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 });
    const event: EncounterEvent = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'fixture:summon',
      actionId: 'default', timing: 'use', tags: [],
      mutations: [{
        kind: 'entity', sourceId: 'fixture:summon', ownerId: hero.id,
        entityType: 'bomb', operation: 'create',
        positions: [{ x: 3, y: 1 }], count: 1, state: {},
        creationSpatial: { origin: { x: 1, y: 1 }, originSize: 1, maxRange: 5 },
      }],
    };
    const applied = applyEvents(state, [event]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(0);
  });
  it('Size-2 origin: the exact footprint-distance boundary is legal through the production path', () => {
    const { state, hero } = summonEncounter([]);
    // Size the ACTOR ON THE STATE (the runtime view projects from it); the
    // local fixture handle is a pre-ADD_ACTOR copy.
    state.actors[hero.id].size = 2; // occupies (1,1),(1,2),(2,1),(2,2)
    const result = executeRuleProgram(createProgram({ origin: { kind: 'self' }, maxRange: 2 }), runtimeContext(state, hero.id, { x: 4, y: 1 }));
    const mutation = entityMutationOf(result);
    expect(mutation.creationSpatial).toEqual({ origin: { x: 1, y: 1 }, originSize: 2, maxRange: 2 });
    const applied = applyEvents(state, [eventFrom(hero.id, [mutation])]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(1);
  });
  it('Size-2 origin: one space beyond the footprint boundary is rejected through the production path', () => {
    const { state, hero } = summonEncounter([]);
    state.actors[hero.id].size = 2;
    const result = executeRuleProgram(createProgram({ origin: { kind: 'self' }, maxRange: 2 }), runtimeContext(state, hero.id, { x: 5, y: 1 }));
    const mutation = entityMutationOf(result);
    const applied = applyEvents(state, [eventFrom(hero.id, [mutation])]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(0);
  });
  it('replay reproduces entity creation with the spatial contract exactly', () => {
    const { state, hero } = summonEncounter([]);
    const result = executeRuleProgram(createProgram({ origin: { kind: 'self' }, maxRange: 5 }), runtimeContext(state, hero.id, { x: 3, y: 1 }));
    const event = eventFrom(hero.id, result.mutations);
    const first = applyEvents(state, [event]);
    const replay = applyEvents(state, [event]);
    const firstEntity = entitiesOf(first, 'bomb', hero.id)[0];
    const replayEntity = entitiesOf(replay, 'bomb', hero.id)[0];
    expect(firstEntity).toBeDefined();
    expect(replayEntity).toBeDefined();
    expect(firstEntity.positions).toEqual(replayEntity.positions);
    expect(firstEntity.id).toEqual(replayEntity.id);
  });
});

describe('F6 entity lifecycle', () => {
  it('a non-companion entity is removed when its owner falls', () => {
    const { state, hero } = summonEncounter([]);
    const withBomb = applyEvents(state, [entityCreate(hero.id, 'bomb')]);
    expect(entitiesOf(withBomb, 'bomb', hero.id)).toHaveLength(1);
    defeatActor(withBomb, withBomb.actors[hero.id]);
    expect(entitiesOf(withBomb, 'bomb', hero.id)).toHaveLength(0);
  });
  it('each entity type caps at six per owner; the seventh create is declined', () => {
    const { state, hero } = summonEncounter([]);
    let current = state;
    for (let i = 0; i < 8; i += 1) current = applyEvents(current, [entityCreate(hero.id, 'beast', false, i)]);
    expect(entitiesOf(current, 'beast', hero.id)).toHaveLength(6);
    current = applyEvents(current, [entityCreate(hero.id, 'bomb', false, 5)]);
    expect(entitiesOf(current, 'bomb', hero.id)).toHaveLength(0);
  });
  it('the cap does not count companions against the same-type ephemeral cap', () => {
    const { state, hero } = summonEncounter(['warden:trait:beast-master']);
    const beastCount = entitiesOf(state, 'beast', hero.id).length;
    let current = state;
    for (let i = 0; i < 7; i += 1) current = applyEvents(current, [entityCreate(hero.id, 'beast', false, i)]);
    expect(entitiesOf(current, 'beast', hero.id).length).toBe(beastCount + 6);
  });
});

describe('legacy entity-event spatial migration (schema-7 compatibility)', () => {
  /** A RULE_MUTATIONS_APPLIED event carrying an entity mutation in the
   * PRE-creationSpatial durable shape (aa736a6's `creationOrigin` /
   * `creationOriginSize` / `creationMaxRange` fields). */
  const legacyEvent = (heroId: string, positions: Position[], options: { maxRange?: number } = {}): EncounterEvent => {
    const mutation: Record<string, unknown> = {
      kind: 'entity', sourceId: 'fixture:legacy', operation: 'create', entityType: 'bomb',
      ownerId: heroId, positions, count: 1, state: {},
      creationOrigin: { x: 1, y: 1 }, creationOriginSize: 1,
    };
    if (options.maxRange !== undefined) mutation.creationMaxRange = options.maxRange;
    return {
      type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'fixture:legacy', actionId: 'default', timing: 'use', tags: [],
      mutations: [mutation as unknown as RuleMutation],
    };
  };

  it('a valid legacy constrained creation is rewritten to creationSpatial at the migration boundary and replays correctly', () => {
    const { state, hero } = summonEncounter([]);
    // (3,1) is distance 2 from the origin (1,1) with max range 5 and clear LoS.
    const migrated = migrateEncounter({ ...state, eventLog: [legacyEvent(hero.id, [{ x: 3, y: 1 }], { maxRange: 5 })] });
    const normalized = migrated.eventLog.find((event) => event.type === 'RULE_MUTATIONS_APPLIED')!;
    expect(normalized.type).toBe('RULE_MUTATIONS_APPLIED');
    const mutation = normalized.mutations[0] as unknown as {
      creationSpatial?: { origin: Position; originSize: number; maxRange?: number };
      creationOrigin?: unknown; creationOriginSize?: unknown; creationMaxRange?: unknown;
    };
    expect(mutation.creationSpatial).toEqual({ origin: { x: 1, y: 1 }, originSize: 1, maxRange: 5 });
    expect(mutation.creationOrigin).toBeUndefined();
    expect(mutation.creationOriginSize).toBeUndefined();
    expect(mutation.creationMaxRange).toBeUndefined();
    const applied = applyEvents(migrated, [normalized]);
    const bomb = entitiesOf(applied, 'bomb', hero.id)[0];
    expect(bomb).toBeDefined();
    expect(bomb.positions).toEqual([{ x: 3, y: 1 }]);
  });

  it('an old event whose target is outside the declared range does not suddenly create an entity', () => {
    const { state, hero } = summonEncounter([]);
    // (7,1) is distance 6 from the origin (1,1) — beyond max range 5.
    const migrated = migrateEncounter({ ...state, eventLog: [legacyEvent(hero.id, [{ x: 7, y: 1 }], { maxRange: 5 })] });
    const normalized = migrated.eventLog.find((event) => event.type === 'RULE_MUTATIONS_APPLIED')!;
    const applied = applyEvents(migrated, [normalized]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(0);
  });

  it('an old event whose LoS is blocked does not become unrestricted', () => {
    const { state, hero } = summonEncounter([]);
    // Impassable terrain at (2,1) blocks the straight line from the origin
    // (1,1) to the target (3,1) — the migrated contract must keep enforcing it.
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 });
    const migrated = migrateEncounter({ ...state, eventLog: [legacyEvent(hero.id, [{ x: 3, y: 1 }], { maxRange: 5 })] });
    const normalized = migrated.eventLog.find((event) => event.type === 'RULE_MUTATIONS_APPLIED')!;
    const applied = applyEvents(migrated, [normalized]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(0);
  });

  it('a current-format event replays identically without migration', () => {
    const { state, hero } = summonEncounter([]);
    const current: EncounterEvent = {
      type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'fixture:current', actionId: 'default', timing: 'use', tags: [],
      mutations: [{
        kind: 'entity', sourceId: 'fixture:current', operation: 'create', entityType: 'bomb',
        ownerId: hero.id, positions: [{ x: 3, y: 1 }], count: 1, state: {},
        creationSpatial: { origin: { x: 1, y: 1 }, originSize: 1, maxRange: 5 },
      }],
    };
    const applied = applyEvents(state, [current]);
    const bomb = entitiesOf(applied, 'bomb', hero.id)[0];
    expect(bomb).toBeDefined();
    expect(bomb.positions).toEqual([{ x: 3, y: 1 }]);
    // Replay of the same current-format event is identical.
    const replay = applyEvents(state, [current]);
    expect(replay.entities[bomb.id]).toBeDefined();
    expect(replay.entities[bomb.id].positions).toEqual(bomb.positions);
  });

  it('the reducer declines an UN-migrated legacy mutation instead of silently treating it as unrestricted', () => {
    // A legacy-shaped mutation that bypasses the migration boundary must
    // never replay as unrestricted creation — the reducer's fail-closed
    // guard declines the whole creation even though the placement is
    // in-range under the old fields.
    const { state, hero } = summonEncounter([]);
    const applied = applyEvents(state, [legacyEvent(hero.id, [{ x: 3, y: 1 }], { maxRange: 5 })]);
    expect(entitiesOf(applied, 'bomb', hero.id)).toHaveLength(0);
  });
});

describe('F6 companion placement uses one legality authority', () => {
  /** Build a combat-start companion fixture with a configurable hero
   * position, extra Size-N actors, blocker entities, and terrain. */
  function companionEncounter(options: {
    trait: string; heroAt: Position; big?: { position: Position; size: number };
    blockers?: Position[];    terrain?: Omit<TerrainCell, 'elevation'>[];
  }): { state: EncounterState; hero: EncounterActor } {
    let state = createEncounter('Companion fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt);
    hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
    hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
    hero.traitIds.push(options.trait);
    const foe = createFoeFromProfile('basic:knuckle:301', { x: 5, y: 1 }, 4);
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    if (options.big) {
      const big = createFoeFromProfile('basic:knuckle:301', options.big.position, 4);
      big.size = options.big.size;
      big.id = 'foe:big';
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: big }).state;
    }
    for (const cell of options.terrain ?? []) state.grid.terrain.push({ ...cell, elevation: 0 });
    if (options.blockers && options.blockers.length > 0) {
      const mutations = options.blockers.map((position) => ({
        kind: 'entity' as const, sourceId: 'fixture:blocker', operation: 'create' as const, entityType: 'blocker',
        ownerId: hero.id, positions: [position], count: 1, state: {},
      }));
      state = applyEvents(state, [{
        type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'fixture:blocker', actionId: 'default', timing: 'use', tags: [],
        mutations,
      }]);
    }
    // The companion summon fires at ENCOUNTER_STARTED (applyCombatStart-
    // TraitEffects), exactly like the production combat-start boundary.
    state = startEncounterTo(state, hero.id);
    return { state, hero };
  }

  it('a Size-2 actor occupying a candidate through a non-anchor footprint cell is skipped; the next legal cell is used', () => {
    // Hero at (2,2); the first candidates (1,1) and (1,2) lie inside a Size-2
    // actor's footprint anchored at (0,1) — neither is its anchor cell. The
    // old freeCellNear (anchor-cell occupancy only) would have picked (1,1);
    // the shared validateEntityCreation authority uses full footprints and
    // falls through to the next legal candidate (1,3).
    const { state, hero } = companionEncounter({
      trait: 'warden:trait:beast-master', heroAt: { x: 2, y: 2 },
      big: { position: { x: 0, y: 1 }, size: 2 },
    });
    const beasts = entitiesOf(state, 'beast', hero.id);
    expect(beasts).toHaveLength(1);
    expect(beasts[0].positions[0]).toEqual({ x: 1, y: 3 });
    expect(beasts[0].state.companion).toBe(true);
  });

  it('a LoS-blocked first candidate falls through to a later legal cell', () => {
    // Hero at (0,0) with the Selkie's range-3 companion. Every candidate is
    // occupied except (2,1) and (3,0); the FIRST free candidate (2,1) has its
    // LoS blocked by impassable terrain at (1,1), so the companion is
    // created at the LATER free candidate (3,0), which has clear LoS — the
    // old freeCellNear (no LoS) would have picked (2,1) and the reducer
    // would have declined the whole summon.
    const { state, hero } = companionEncounter({
      trait: 'stormbender:trait:selkie', heroAt: { x: 0, y: 0 },
      blockers: [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 2 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 0, y: 3 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }],
      terrain: [{ position: { x: 1, y: 1 }, type: 'impassable' }],
    });
    const elementals = entitiesOf(state, 'selkie', hero.id);
    expect(elementals).toHaveLength(1);
    expect(elementals[0].positions[0]).toEqual({ x: 3, y: 0 });
  });

  it('candidate ordering is deterministic and replay is stable', () => {
    // The same layout produced twice yields the identical companion cell,
    // and the recorded ENCOUNTER_STARTED event replays to the same state.
    const first = companionEncounter({
      trait: 'warden:trait:beast-master', heroAt: { x: 2, y: 2 },
      big: { position: { x: 0, y: 1 }, size: 2 },
    });
    const second = companionEncounter({
      trait: 'warden:trait:beast-master', heroAt: { x: 2, y: 2 },
      big: { position: { x: 0, y: 1 }, size: 2 },
    });
    expect(entitiesOf(first.state, 'beast', first.hero.id)[0].positions).toEqual(
      entitiesOf(second.state, 'beast', second.hero.id)[0].positions,
    );
    const preStart = createEncounter('Companion fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 2, y: 2 });
    hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
    hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
    hero.traitIds.push('warden:trait:beast-master');
    const foe = createFoeFromProfile('basic:knuckle:301', { x: 5, y: 1 }, 4);
    const big = createFoeFromProfile('basic:knuckle:301', { x: 0, y: 1 }, 4);
    big.size = 2;
    big.id = 'foe:big';
    let built = executeCommand(preStart, { type: 'ADD_ACTOR', actor: hero }).state;
    built = executeCommand(built, { type: 'ADD_ACTOR', actor: foe }).state;
    built = executeCommand(built, { type: 'ADD_ACTOR', actor: big }).state;
    const started = executeCommand(built, { type: 'START_ENCOUNTER' }, scriptedDice());
    expect(applyEvents(built, started.events)).toEqual(started.state);
    expect(entitiesOf(started.state, 'beast', hero.id)[0].positions[0]).toEqual({ x: 1, y: 3 });
  });
});

describe('F6 reducer-path candidate fall-through (a single intent mutation with an ordered candidate list + creationSpatial)', () => {
  type EntityIntent = Extract<RuleMutation, { kind: 'entity' }>;
  const intent = (ownerId: string, over: Partial<EntityIntent> = {}): EntityIntent => ({
    kind: 'entity', sourceId: 'fixture:summon', operation: 'create', entityType: 'bomb', ownerId,
    positions: [], count: 1, state: {},
    creationSpatial: { origin: { x: 1, y: 1 }, originSize: 1, maxRange: 5 },
    ...over,
  });
  const eventFrom = (actorId: string, mutations: RuleMutation[]): EncounterEvent => ({
    type: 'RULE_MUTATIONS_APPLIED', actorId, sourceId: 'fixture:summon', actionId: 'default', timing: 'use', tags: [], mutations,
  });

  it('skips an LoS-blocked earliest candidate and falls through to a later legal one', () => {
    const { state, hero } = summonEncounter([]);
    // Impassable at (2,1) blocks line of sight from origin (1,1) to (3,1).
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 });
    const applied = applyEvents(state, [eventFrom(hero.id, [intent(hero.id, { positions: [{ x: 3, y: 1 }, { x: 3, y: 3 }] })])]);
    const bombs = Object.values(applied.entities).filter((entity) => entity.type === 'bomb');
    expect(bombs).toHaveLength(1);
    expect(bombs[0].positions[0]).toEqual({ x: 3, y: 3 });
  });

  it('skips an impassable candidate and falls through to a later free cell', () => {
    const { state, hero } = summonEncounter([]);
    state.grid.terrain.push({ position: { x: 3, y: 1 }, type: 'impassable', elevation: 0 });
    const applied = applyEvents(state, [eventFrom(hero.id, [intent(hero.id, { positions: [{ x: 3, y: 1 }, { x: 3, y: 2 }] })])]);
    const bombs = Object.values(applied.entities).filter((entity) => entity.type === 'bomb');
    expect(bombs).toHaveLength(1);
    expect(bombs[0].positions[0]).toEqual({ x: 3, y: 2 });
  });

  it('skips an occupied candidate and falls through to a later free cell', () => {
    const { state, hero } = summonEncounter([]);
    state.entities.blocker = { id: 'blocker', type: 'boulder', ownerId: null, positions: [{ x: 3, y: 1 }], state: {}, duration: null };
    const applied = applyEvents(state, [eventFrom(hero.id, [intent(hero.id, { positions: [{ x: 3, y: 1 }, { x: 3, y: 2 }] })])]);
    const bombs = Object.values(applied.entities).filter((entity) => entity.type === 'bomb');
    expect(bombs).toHaveLength(1);
    expect(bombs[0].positions[0]).toEqual({ x: 3, y: 2 });
    // The blocker boulder survives untouched.
    expect(applied.entities.blocker).toBeDefined();
  });

  it('a Size>1 origin measures range from the footprint edge, so an anchor-close-but-footprint-far candidate is skipped and an edge-close one wins', () => {
    const { state, hero } = summonEncounter([]);
    // Origin footprint covers x 3-4, y 3-4, size 2, maxRange 2. Anchor-to-(7,3)
    // is 4 but footprint-edge-to-(7,3) is 3 — still beyond. (6,3) is edge-dist
    // 2, legal. The ordered list makes the reducer land on (6,3).
    const applied = applyEvents(state, [eventFrom(hero.id, [intent(hero.id, {
      creationSpatial: { origin: { x: 3, y: 3 }, originSize: 2, maxRange: 2 },
      positions: [{ x: 7, y: 3 }, { x: 6, y: 3 }],
    })])]);
    const bombs = Object.values(applied.entities).filter((entity) => entity.type === 'bomb');
    expect(bombs).toHaveLength(1);
    expect(bombs[0].positions[0]).toEqual({ x: 6, y: 3 });
  });

  it('honors the registered per-owner summon cap on a multi-create request', () => {
    const { state, hero } = summonEncounter([]);
    // Five existing non-companion bombs leave exactly one slot under the cap (6).
    for (let i = 0; i < 5; i += 1) {
      state.entities[`b${i}`] = { id: `b${i}`, type: 'bomb', ownerId: hero.id, positions: [{ x: i, y: 7 }], state: {}, duration: null };
    }
    const applied = applyEvents(state, [eventFrom(hero.id, [intent(hero.id, { positions: [{ x: 3, y: 2 }, { x: 4, y: 2 }], count: 2 })])]);
    const bombs = Object.values(applied.entities).filter((entity) => entity.type === 'bomb' && entity.ownerId === hero.id);
    expect(bombs).toHaveLength(6); // only one extra, capped at six
  });

  it('an over-subscribed request yields only the legally permitted count', () => {
    const { state, hero } = summonEncounter([]);
    // One occupied candidate plus two free ones for a requested count of 3.
    state.entities.blocker = { id: 'blocker', type: 'boulder', ownerId: null, positions: [{ x: 3, y: 1 }], state: {}, duration: null };
    const applied = applyEvents(state, [eventFrom(hero.id, [intent(hero.id, { positions: [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }], count: 3 })])]);
    const bombs = Object.values(applied.entities).filter((entity) => entity.type === 'bomb');
    expect(bombs).toHaveLength(2);
  });

  it('replays the candidate fall-through decision deterministically to the identical state', () => {
    const base = summonEncounter([]);
    base.state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 });
    const events = [eventFrom(base.hero.id, [intent(base.hero.id, { positions: [{ x: 3, y: 1 }, { x: 3, y: 3 }] })])];
    const first = applyEvents(structuredClone(base.state), events);
    const second = applyEvents(structuredClone(base.state), events);
    expect(second).toEqual(first);
    expect(Object.values(first.entities).filter((entity) => entity.type === 'bomb')[0].positions[0]).toEqual({ x: 3, y: 3 });
  });
});

describe('F3 entity kind: summons vs objects (ICON p.95 lifecycle/staking)', () => {
  it('an ordinary summon is removed when its controller is defeated; an object survives', () => {
    const { state, hero } = summonEncounter([]);
    state.entities.summon = { id: 'summon', type: 'beast', ownerId: hero.id, positions: [{ x: 3, y: 2 }], state: {}, duration: null, kind: 'summon' };
    state.entities.object = { id: 'object', type: 'boulder', ownerId: hero.id, positions: [{ x: 4, y: 2 }], state: { height: 1 }, duration: null, kind: 'object' };
    defeatActor(state, state.actors[hero.id]);
    expect(state.entities.summon).toBeUndefined();
    expect(state.entities.object).toBeDefined();
  });

  it('a persistent companion survives its owner defeat', () => {
    const { state, hero } = summonEncounter([]);
    state.entities.companion = { id: 'c', type: 'beast', ownerId: hero.id, positions: [{ x: 3, y: 2 }], state: { companion: true }, duration: null, kind: 'summon' };
    defeatActor(state, state.actors[hero.id]);
    expect(state.entities.companion).toBeDefined();
  });

  it('objects may be created on other objects as long as total height <= 3', () => {
    const state = createEncounter('stack');
    state.entities.b0 = { id: 'b0', type: 'boulder', ownerId: 'o', positions: [{ x: 4, y: 1 }], state: { height: 2 }, duration: null, kind: 'object' };
    const ok = validateEntityCreation(state, { ownerId: 'o', entityType: 'boulder', kind: 'object', positions: [{ x: 4, y: 1 }], count: 1, state: { height: 1 }, duration: null });
    expect(ok).not.toBeNull();
  });

  it('stacking above total object height 3 is rejected', () => {
    const state = createEncounter('stack');
    state.entities.b0 = { id: 'b0', type: 'boulder', ownerId: 'o', positions: [{ x: 4, y: 1 }], state: { height: 3 }, duration: null, kind: 'object' };
    const over = validateEntityCreation(state, { ownerId: 'o', entityType: 'boulder', kind: 'object', positions: [{ x: 4, y: 1 }], count: 1, state: { height: 1 }, duration: null });
    expect(over).toBeNull();
  });

  it('a stack at exactly total height 3 (2+1) accepts a height-1 object but a height-2 object is rejected', () => {
    const state = createEncounter('stack');
    state.entities.b0 = { id: 'b0', type: 'boulder', ownerId: 'o', positions: [{ x: 4, y: 1 }], state: { height: 2 }, duration: null, kind: 'object' };
    expect(validateEntityCreation(state, { ownerId: 'o', entityType: 'boulder', kind: 'object', positions: [{ x: 4, y: 1 }], count: 1, state: { height: 1 }, duration: null })).not.toBeNull();
    expect(validateEntityCreation(state, { ownerId: 'o', entityType: 'boulder', kind: 'object', positions: [{ x: 4, y: 1 }], count: 1, state: { height: 2 }, duration: null })).toBeNull();
  });

  it('a summon cannot occupy an existing object\u2019s space', () => {
    const state = createEncounter('occ');
    state.entities.b0 = { id: 'b0', type: 'boulder', ownerId: 'o', positions: [{ x: 4, y: 1 }], state: { height: 1 }, duration: null, kind: 'object' };
    expect(validateEntityCreation(state, { ownerId: 'o', entityType: 'beast', kind: 'summon', positions: [{ x: 4, y: 1 }], count: 1, state: {}, duration: null })).toBeNull();
  });

  it('replay is deterministic for lifecycle and stacking decisions', () => {
    const base = summonEncounter([]);
    base.state.entities.b0 = { id: 'b0', type: 'boulder', ownerId: base.hero.id, positions: [{ x: 4, y: 1 }], state: { height: 2 }, duration: null, kind: 'object' };
    const mut: Extract<RuleMutation, { kind: 'entity' }> = {
      kind: 'entity', sourceId: 'fixture:summon', operation: 'create', entityType: 'boulder', ownerId: base.hero.id, category: 'object',
      positions: [{ x: 4, y: 1 }], count: 1, state: { height: 1 },
    };
    const events: EncounterEvent[] = [{ type: 'RULE_MUTATIONS_APPLIED', actorId: base.hero.id, sourceId: 'fixture:summon', actionId: 'default', timing: 'use', tags: [], mutations: [mut] }];
    const first = applyEvents(structuredClone(base.state), events);
    const second = applyEvents(structuredClone(base.state), events);
    expect(second).toEqual(first);
    // The stack now totals 3 (two objects shared the cell).
    expect(Object.values(first.entities).filter((e) => e.type === 'boulder')).toHaveLength(2);
  });
});

describe('F3 count/range semantics (exact vs up-to; creator footprint range)', () => {
  it('a Size-2 creator may place at a cell outside anchor-radius but inside footprint range', () => {
    // Origin (3,3) size 2 (footprint x3-4, y3-4); footprint-distance to (6,3) is 2
    // and legal, while the anchor Chebyshev distance would be 3.
    const state = createEncounter('range');
    const r = validateEntityCreation(state, { ownerId: 'o', entityType: 'beast', kind: 'summon', positions: [{ x: 6, y: 3 }], count: 1, state: {}, duration: null, spatial: { origin: { x: 3, y: 3 }, originSize: 2, maxRange: 2 } });
    expect(r).not.toBeNull();
  });

  it('exact-N fails (nothing created) when fewer legal cells than N', () => {
    const state = createEncounter('exact');
    state.entities.occ = { id: 'occ', type: 'boulder', ownerId: 'o', positions: [{ x: 3, y: 1 }], state: { height: 1 }, duration: null, kind: 'object' };
    const r = validateEntityCreation(state, { ownerId: 'o', entityType: 'beast', kind: 'summon', positions: [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }], count: 3, countMode: 'exact', state: {}, duration: null });
    expect(r).toBeNull();
  });

  it('up-to creates the legal subset above an occupied candidate', () => {
    const state = createEncounter('up-to');
    state.entities.occ = { id: 'occ', type: 'boulder', ownerId: 'o', positions: [{ x: 3, y: 1 }], state: { height: 1 }, duration: null, kind: 'object' };
    const r = validateEntityCreation(state, { ownerId: 'o', entityType: 'beast', kind: 'summon', positions: [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }], count: 3, state: {}, duration: null });
    expect(r).toEqual({ positions: [{ x: 3, y: 2 }, { x: 4, y: 2 }], count: 2 });
  });

  it('the summon cap yields partial success even under an exact request', () => {
    const state = createEncounter('cap');
    for (let i = 0; i < 5; i += 1) state.entities[`b${i}`] = { id: `b${i}`, type: 'bomb', ownerId: 'o', positions: [{ x: i, y: 7 }], state: {}, duration: null, kind: 'summon' };
    // Five existing bombs leave one slot under the cap (6): exact count 2 → one.
    const r = validateEntityCreation(state, { ownerId: 'o', entityType: 'bomb', kind: 'summon', positions: [{ x: 3, y: 2 }, { x: 4, y: 2 }], count: 2, countMode: 'exact', state: {}, duration: null });
    expect(r).toEqual({ positions: [{ x: 3, y: 2 }], count: 1 });
  });

  it('deterministic ordering and replay for count-limited partial creation', () => {
    const base = createEncounter('order');
    base.entities.occ = { id: 'occ', type: 'boulder', ownerId: 'o', positions: [{ x: 3, y: 1 }], state: { height: 1 }, duration: null, kind: 'object' };
    base.entities.occ2 = { id: 'occ2', type: 'boulder', ownerId: 'o', positions: [{ x: 4, y: 2 }], state: { height: 1 }, duration: null, kind: 'object' };
    const candidates = [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }];
    const req = { ownerId: 'o' as const, entityType: 'beast' as const, kind: 'summon' as const, positions: candidates, count: 3, state: {} as Record<string, string | number | boolean | null>, duration: null as null, spatial: { origin: { x: 1, y: 1 } as Position, originSize: 1 as number } };
    const first = validateEntityCreation(structuredClone(base), req);
    const second = validateEntityCreation(structuredClone(base), req);
    expect(second).toEqual(first);
    expect(first).toEqual({ positions: [{ x: 3, y: 2 }, { x: 5, y: 2 }], count: 2 });
  });
});

describe('F3 creation-intent split: placement region vs creator LoS origin', () => {
  it('LoS is measured from the CREATOR origin (a wall between the creator and a candidate skips it for a visible one), even when candidates are centered on a target region', () => {
    const state = createEncounter('los');
    state.grid.terrain.push({ position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 });
    // Region is target-centered (candidates near (3,1)); LoS origin is the
    // CREATOR (1,1). (3,1) sits behind the wall at (2,1); (3,2) is also
    // behind it, but (3,3) is visible from the creator — so the creation
    // falls through to the visible cell.
    const r = validateEntityCreation(state, { ownerId: 'o', entityType: 'beast', kind: 'summon', positions: [{ x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }], count: 1, state: {}, duration: null, spatial: { origin: { x: 1, y: 1 } } });
    expect(r).toEqual({ positions: [{ x: 3, y: 3 }], count: 1 });
  });

  it('with a clear creator path the target-centered placement succeeds', () => {
    const state = createEncounter('los');
    const r = validateEntityCreation(state, { ownerId: 'o', entityType: 'beast', kind: 'summon', positions: [{ x: 3, y: 1 }], count: 1, state: {}, duration: null, spatial: { origin: { x: 1, y: 1 } } });
    expect(r).toEqual({ positions: [{ x: 3, y: 1 }], count: 1 });
  });

  it('a source-centered summon still behaves normally', () => {
    const state = createEncounter('los');
    // Region and LoS origin both at the source (1,1).
    const r = validateEntityCreation(state, { ownerId: 'o', entityType: 'beast', kind: 'summon', positions: [{ x: 1, y: 2 }], count: 1, state: {}, duration: null, spatial: { origin: { x: 1, y: 1 } } });
    expect(r).toEqual({ positions: [{ x: 1, y: 2 }], count: 1 });
  });
});

describe('F6 creation obstruction uses the dynamic terrain view', () => {
  it('a dynamic impassable TERRAIN EFFECT blocks a creation cell and skips it', () => {
    const { state, hero } = summonEncounter([]);
    // An impassable overlay created during play occupies (2,1) and (3,1), so
    // the ordinary `state.grid.terrain` view (empty) must NOT be trusted: the
    // canonical combined terrain union decides obstruction. The first candidate
    // (2,1) is obstructed; (4,1) is legal and selected.
    state.terrainEffects.push({ id: 'wallfx', sourceId: 'fixture', ownerId: 'o', terrain: 'impassable', positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }], height: null, duration: null });
    const result = validateEntityCreation(state, {
      ownerId: hero.id, entityType: 'bomb', count: 1,
      positions: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
      state: {}, duration: null,
      spatial: { origin: { x: 1, y: 1 }, maxRange: 6 },
    });
    expect(result).toEqual({ positions: [{ x: 4, y: 1 }], count: 1 });
    // Note (source fidelity): LoS itself blocks only on grid impassable terrain
    // or an explicitly registered LoS-blocking effect — a dynamic impassable
    // overlay OBSTRUCTS creation cells but does NOT by itself block the
    // creator's line of sight (line-of-sight.ts). That closed separation is
    // preserved rather than conflated here.
  });
});
