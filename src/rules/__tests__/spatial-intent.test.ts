import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { computeSpatialArea } from '../automation/primitives/spatial-intent.js';
import { lineCells, squareArea } from '../area-geometry.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position, TerrainCell } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * F1 spatial-gateway matrix (ICON pp.87–92, 94, 107).
 *
 * Every explicit-destination VM path (place, teleport, explicit rush/fly
 * positions) routes through automation/spatial-intent.ts, so bounds,
 * occupancy, impassable terrain, and Rampart are decided once. These
 * fixtures pin the authority: legal moves apply, illegal destinations are
 * denied with a stable problem, co-moved actors (paired swaps) validate
 * atomically, and every applied event replays to the identical state.
 */

interface SpatialFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function spatialEncounter(options: { terrain?: TerrainCell[] } = {}): SpatialFixture {
  let state = createEncounter('Spatial fixture');
  if (options.terrain) state.grid = { ...state.grid, terrain: options.terrain };
  const hero = actorFromCharacter(validCharacter('Green Witch'), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe };
}

/** A VM move mutation of the given movement kind to an explicit destination. */
const moveEvent = (sourceActorId: string, actorId: string, movement: 'place' | 'teleport' | 'rush', to: Position): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:spatial',
  actionId: 'default',
  timing: 'use',
  tags: [],
  mutations: [{ kind: 'move', sourceId: 'fixture:spatial', sourceActorId, actorId, movement, distance: null, positions: [to], direction: null, phasing: false }],
});

describe('F1 spatial gateway (pp.87–92, 94, 107)', () => {
  it('place validates bounds, occupancy, and impassable terrain', () => {
    const { state, hero, foe } = spatialEncounter({
      terrain: [{ position: { x: 5, y: 1 }, type: 'impassable', elevation: 0 }],
    });
    // Legal: a free cell inside the grid.
    const legal = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 3, y: 1 })]);
    expect(legal.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    // Occupied: the hero sits on (1,1).
    const occupied = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 1, y: 1 })]);
    expect(occupied.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(occupied.pendingInterrupts).toHaveLength(0); // no window from a denied move
    // Out of bounds.
    const bounds = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 99, y: 1 })]);
    expect(bounds.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    // Impassable terrain.
    const impassable = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 5, y: 1 })]);
    expect(impassable.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    // Replay pairs: the legal move replays to the identical state.
    expect(applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 3, y: 1 })])).toEqual(legal);
  });

  it('paired place mutations swap atomically (co-moved actors are not obstructions)', () => {
    const { state, hero, foe } = spatialEncounter();
    const swap: EncounterEvent = {
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: hero.id,
      sourceId: 'fixture:swap',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [
        { kind: 'move', sourceId: 'fixture:swap', sourceActorId: hero.id, actorId: foe.id, movement: 'place', distance: null, positions: [{ x: 1, y: 1 }], direction: null, phasing: false },
        { kind: 'move', sourceId: 'fixture:swap', sourceActorId: hero.id, actorId: hero.id, movement: 'place', distance: null, positions: [{ x: 4, y: 1 }], direction: null, phasing: false },
      ],
    };
    const result = applyEvents(state, [swap]);
    // The foe was co-moved, so the first place onto the hero's cell is legal;
    // the hero then takes the foe's old cell — a full swap.
    expect(result.actors[foe.id].position).toEqual({ x: 1, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(applyEvents(state, [swap])).toEqual(result);
  });

  it('teleport is denied when entering or leaving rampart differs (p.104)', () => {
    const { state, hero, foe } = spatialEncounter();
    // The fortify hero projects rampart over its adjacent cells (p.116).
    // Teleporting adjacent to it enters rampart → denied.
    const denied = applyEvents(state, [moveEvent(hero.id, foe.id, 'teleport', { x: 2, y: 1 })]);
    expect(denied.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    // Teleporting to a free non-rampart cell is legal.
    const legal = applyEvents(state, [moveEvent(hero.id, foe.id, 'teleport', { x: 3, y: 1 })]);
    expect(legal.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    expect(applyEvents(state, [moveEvent(hero.id, foe.id, 'teleport', { x: 3, y: 1 })])).toEqual(legal);
    // Slip ignores rampart (p.105): the same denied destination now applies.
    state.actors[foe.id].conditions.push({ id: 'slip', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const slipped = applyEvents(state, [moveEvent(hero.id, foe.id, 'teleport', { x: 2, y: 1 })]);
    expect(slipped.actors[foe.id].position).toEqual({ x: 2, y: 1 });
  });

  it('a rush into a fortify-rampart cell is denied; a free landing applies', () => {
    const { state, hero, foe } = spatialEncounter();
    // Adjacent to the fortify hero → rampart → the dash is denied (p.104).
    const denied = applyEvents(state, [moveEvent(hero.id, foe.id, 'rush', { x: 2, y: 1 })]);
    expect(denied.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    // A landing outside the rampart applies.
    const legal = applyEvents(state, [moveEvent(hero.id, foe.id, 'rush', { x: 3, y: 1 })]);
    expect(legal.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    expect(applyEvents(state, [moveEvent(hero.id, foe.id, 'rush', { x: 3, y: 1 })])).toEqual(legal);
  });

  it('immobile actors deny all movement before the gateway', () => {
    const { state, hero, foe } = spatialEncounter();
    state.actors[foe.id].conditions.push({ id: 'immobile', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const result = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 3, y: 1 })]);
    expect(result.actors[foe.id].position).toEqual({ x: 4, y: 1 });
  });
});

describe('F1 area gateway (p.95 AoE patterns)', () => {
  it('rejects a burst center out of bounds or beyond the source’s reach', () => {
    const { state, hero } = spatialEncounter();
    const base = { kind: 'area' as const, sourceActorId: hero.id, sourceRuleId: 'fixture:area', shape: 'burst' as const, radius: 1 };
    expect(computeSpatialArea(state, { ...base, center: { x: 99, y: 1 }, maximumRangeFromSource: 4, requireCenterInBounds: true })).toMatchObject({ legal: false, problem: 'out-of-bounds' });
    expect(computeSpatialArea(state, { ...base, center: { x: 8, y: 1 }, maximumRangeFromSource: 4, requireCenterInBounds: true })).toMatchObject({ legal: false, problem: 'range' });
  });

  it('a free-space center must be unoccupied and passable', () => {
    const { state, hero, foe } = spatialEncounter({
      terrain: [{ position: { x: 5, y: 1 }, type: 'impassable', elevation: 0 }],
    });
    const base = { kind: 'area' as const, sourceActorId: hero.id, sourceRuleId: 'fixture:area', shape: 'burst' as const, radius: 1, maximumRangeFromSource: 4, requireCenterInBounds: true, requireFreeCenter: true };
    expect(computeSpatialArea(state, { ...base, center: { x: 1, y: 1 } })).toMatchObject({ legal: false, problem: 'occupied' }); // the hero's own cell
    expect(computeSpatialArea(state, { ...base, center: { x: 5, y: 1 } })).toMatchObject({ legal: false, problem: 'impassable-terrain' });
    expect(computeSpatialArea(state, { ...base, center: { x: 3, y: 1 } })).toMatchObject({ legal: true, problem: null }); // free and in reach
  });

  it('derives the same cells as the shared geometry and resolves inclusion', () => {
    const { state, hero, foe } = spatialEncounter();
    // Hero at (1,1), foe at (4,1): a burst 1 centered at (2,1) includes the
    // hero (adjacent) but not the foe (distance 2), exactly like squareArea.
    const burst = computeSpatialArea(state, { kind: 'area', sourceActorId: hero.id, sourceRuleId: 'fixture:area', shape: 'burst', center: { x: 2, y: 1 }, radius: 1, maximumRangeFromSource: 4, requireCenterInBounds: true });
    expect(burst.cells).toEqual(squareArea({ x: 2, y: 1 }, 1));
    expect(burst.includedActorIds).toEqual([hero.id]);
    // A line 3 east from (1,1) reaches the foe at (4,1) and matches lineCells.
    const line = computeSpatialArea(state, { kind: 'area', sourceActorId: hero.id, sourceRuleId: 'fixture:area', shape: 'line', center: { x: 1, y: 1 }, radius: 3, direction: { x: 1, y: 0 }, maximumRangeFromSource: 3, requireCenterInBounds: true });
    expect(line.cells).toEqual(lineCells({ x: 1, y: 1 }, { x: 1, y: 0 }, 3));
    expect(line.includedActorIds).toEqual([foe.id]);
  });
});
