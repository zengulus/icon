import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { defeatActor, encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { validateEntityCreation } from '../automation/kernels/entity-creation.js';
import { executeRuleProgram, RuleProgramViolation } from '../automation/kernels/runtime.js';
import type { RuleEffect, RuleExecutionContext, RuleMutation, RuleProgram, RuleSelector } from '../automation/primitives/types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position } from '../types.js';
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
