import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { defeatActor } from '../automation/kernels/encounter-adapter.js';
import { validateEntityCreation } from '../automation/kernels/entity-creation.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState } from '../types.js';
import { validCharacter, startEncounterTo } from './fixtures.js';

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
    const result = validateEntityCreation(state, { ownerId: hero.id, entityType: 'bomb', count: 3, positions: [{ x: -1, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }], state: {}, duration: null });
    expect(result).toEqual({ positions: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }], count: 3 });
  });
  it('applies the registered per-owner cap to multi-create requests', () => {
    const { state, hero } = summonEncounter([]);
    const first = validateEntityCreation(state, { ownerId: hero.id, entityType: 'bomb', count: 8, positions: Array.from({ length: 8 }, (_, index) => ({ x: index, y: 2 })), state: {}, duration: null });
    expect(first?.count).toBe(6);
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
