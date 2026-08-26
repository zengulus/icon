import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { computeSpatialArea } from '../automation/primitives/spatial-intent.js';
import { lineCells, squareArea } from '../area-geometry.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position, TerrainCell } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

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

function spatialEncounter(options: { terrain?: TerrainCell[]; extra?: EncounterActor[]; foePosition?: Position } = {}): SpatialFixture {
  let state = createEncounter('Spatial fixture');
  if (options.terrain) state.grid = { ...state.grid, terrain: options.terrain };
  const hero = actorFromCharacter(validCharacter('Green Witch'), { x: 1, y: 1 });
  const foe = createFoe('Relict', options.foePosition ?? { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  for (const actor of options.extra ?? []) state = executeCommand(state, { type: 'ADD_ACTOR', actor }).state;
  state = startEncounterTo(state, hero.id);
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

  it('Size-2 destinations validate the whole footprint, not just the anchor (p.92)', () => {
    const { state, hero, foe } = spatialEncounter({
      terrain: [{ position: { x: 5, y: 1 }, type: 'impassable', elevation: 0 }],
    });
    // The foe becomes a Size-2 actor occupying an N×N footprint.
    state.actors[foe.id].size = 2;
    // Legal: the whole 2×2 footprint at (3,1) — (3,1),(4,1),(3,2),(4,2) — is
    // in bounds, unoccupied, and clear of the impassable cell at (5,1).
    const legal = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 3, y: 1 })]);
    expect(legal.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    expect(applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 3, y: 1 })])).toEqual(legal);
    // Anchor in bounds but the footprint spills out of the grid: the anchor
    // cell (8,1) is inside a 10-wide grid, but a Size-2 anchor at x=8 would
    // occupy x∈[8,9] which is still in bounds; use x=9 → x∈[9,10] exceeds.
    const bounds = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 9, y: 0 })]);
    expect(bounds.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    // Anchor clear but a footprint cell on impassable terrain: (4,1) is free
    // and passable, but the Size-2 footprint at (4,1) covers (5,1) — impassable.
    const impassable = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 4, y: 1 })]);
    expect(impassable.actors[foe.id].position).toEqual({ x: 4, y: 1 });
  });

  it('Size-2 destinations cannot overlap another actor\'s footprint (anchor free)', () => {
    const { state, hero, foe } = spatialEncounter();
    state.actors[foe.id].size = 2;
    // The Size-2 footprint anchored at (0,1) covers (0,1),(1,1),(0,2),(1,2) —
    // overlapping the hero at (1,1) even though the anchor cell is free.
    const overlapping = applyEvents(state, [moveEvent(hero.id, foe.id, 'place', { x: 0, y: 1 })]);
    expect(overlapping.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    // The same anchor is legal once the hero leaves (1,1): the footprint is
    // then entirely free and in bounds.
    const heroMoved = applyEvents(state, [{ ...moveEvent(hero.id, hero.id, 'place', { x: 7, y: 1 }) }]);
    const nowFree = applyEvents(heroMoved, [moveEvent(heroMoved.actors[hero.id].id, foe.id, 'place', { x: 0, y: 1 })]);
    expect(nowFree.actors[foe.id].position).toEqual({ x: 0, y: 1 });
  });
});

describe('F1 atomic spatial groups (source-declared, every leg or none)', () => {
  /** An explicitly grouped swap-style batch (the shape `swapMutations` emits). */
  const swapEvent = (legs: Array<{ actorId: string; to: Position; movement?: 'place' | 'teleport' }>): EncounterEvent => ({
    type: 'RULE_MUTATIONS_APPLIED',
    actorId: legs[0].actorId,
    sourceId: 'fixture:swap',
    actionId: 'default',
    timing: 'use',
    tags: [],
    mutations: legs.map(({ actorId, to, movement = 'place' }) => ({
      kind: 'move', sourceId: 'fixture:swap', sourceActorId: actorId, actorId, movement, distance: null, positions: [to], direction: null, phasing: false, spatialBatchId: 'fixture:swap',
    })),
  });
  /** The same legs WITHOUT the declared group: independent multi-target movement. */
  const ungroupedEvent = (legs: Array<{ actorId: string; to: Position; movement?: 'place' | 'teleport' }>): EncounterEvent => ({
    type: 'RULE_MUTATIONS_APPLIED',
    actorId: legs[0].actorId,
    sourceId: 'fixture:move',
    actionId: 'default',
    timing: 'use',
    tags: [],
    mutations: legs.map(({ actorId, to, movement = 'place' }) => ({
      kind: 'move', sourceId: 'fixture:move', sourceActorId: actorId, actorId, movement, distance: null, positions: [to], direction: null, phasing: false,
    })),
  });

  it('a legal two-way teleporting swap applies every leg', () => {
    const ally = actorFromCharacter(validCharacter('Second'), { x: 4, y: 1 });
    const { state, hero } = spatialEncounter({ extra: [ally], foePosition: { x: 7, y: 1 } });
    // Both legs are real teleports; both destinations are the other
    // participant's cell. The hero's own Fortify does not block same-side
    // movers, so the declared permutation is legal and both legs apply.
    const swap = swapEvent([
      { actorId: hero.id, to: { x: 4, y: 1 }, movement: 'teleport' },
      { actorId: ally.id, to: { x: 1, y: 1 }, movement: 'teleport' },
    ]);
    const result = applyEvents(state, [swap]);
    expect(result.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(result.actors[ally.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, [swap])).toEqual(result);
  });

  it('a legal remove/place swap applies every leg', () => {
    const { state, hero, foe } = spatialEncounter();
    const swap = swapEvent([{ actorId: foe.id, to: { x: 1, y: 1 } }, { actorId: hero.id, to: { x: 4, y: 1 } }]);
    const result = applyEvents(state, [swap]);
    expect(result.actors[foe.id].position).toEqual({ x: 1, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(applyEvents(state, [swap])).toEqual(result);
  });

  it('an asymmetric invalid teleport leg denies the whole declared swap — the legal leg is not applied either (out of bounds)', () => {
    const { state, hero, foe } = spatialEncounter();
    // The first teleport onto the hero's cell is legal; the second leg's
    // destination is off the grid. The declared permutation is prevalidated
    // against the same pre-swap state, so the swap is denied as a whole.
    const swap = swapEvent([
      { actorId: foe.id, to: { x: 1, y: 1 }, movement: 'teleport' },
      { actorId: hero.id, to: { x: 99, y: 1 }, movement: 'teleport' },
    ]);
    const result = applyEvents(state, [swap]);
    expect(result.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(result.pendingInterrupts).toHaveLength(0); // no window from a denied swap
    expect(applyEvents(state, [swap])).toEqual(result);
  });

  it('a swap leg targeting a cell occupied by a non-co-moved actor denies the whole swap', () => {
    const third = createFoe('Relict', { x: 3, y: 1 });
    const { state, hero, foe } = spatialEncounter({ extra: [third] });
    // The second leg targets (3,1), occupied by the third actor, which is not
    // part of the batch: the permutation is illegal against the pre-swap
    // state, so neither the legal first leg nor the second leg applies.
    const swap = swapEvent([{ actorId: foe.id, to: { x: 1, y: 1 } }, { actorId: hero.id, to: { x: 3, y: 1 } }]);
    const result = applyEvents(state, [swap]);
    expect(result.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, [swap])).toEqual(result);
  });

  it('two grouped legs may not land on the same destination — the duplicate permutation is denied entirely', () => {
    const { state, hero, foe } = spatialEncounter();
    // Both legs target the free cell (5,1). A co-moved actor is never an
    // obstruction to another leg, so per-leg validation alone would stack
    // both actors on one cell; the permutation check rejects the duplicate
    // destination and applies neither leg.
    const swap = swapEvent([{ actorId: foe.id, to: { x: 5, y: 1 } }, { actorId: hero.id, to: { x: 5, y: 1 } }]);
    const result = applyEvents(state, [swap]);
    expect(result.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, [swap])).toEqual(result);
  });

  it('overlapping destination footprints (size 2) are denied even with distinct anchors', () => {
    const { state, hero, foe } = spatialEncounter();
    // Both actors are Size 2: a footprint anchored at (3,1) covers
    // (3,1),(4,1),(3,2),(4,2) and one at (4,1) covers (4,1),(5,1),(4,2),(5,2)
    // — the anchors differ but the footprints overlap, so the declared
    // permutation is not injective and the whole swap is denied.
    state.actors[hero.id].size = 2;
    state.actors[foe.id].size = 2;
    const swap = swapEvent([{ actorId: foe.id, to: { x: 3, y: 1 } }, { actorId: hero.id, to: { x: 4, y: 1 } }]);
    const result = applyEvents(state, [swap]);
    expect(result.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, [swap])).toEqual(result);
  });

  it('a full three-party rotation applies every leg of the permutation', () => {
    const third = createFoe('Relict', { x: 7, y: 1 });
    const { state, hero, foe } = spatialEncounter({ extra: [third] });
    // A→B, B→C, C→A: every destination is the pre-swap cell of a co-moved
    // participant, so the declared permutation is legal and all three legs
    // apply.
    const rotation = swapEvent([
      { actorId: foe.id, to: { x: 1, y: 1 } },
      { actorId: third.id, to: { x: 4, y: 1 } },
      { actorId: hero.id, to: { x: 7, y: 1 } },
    ]);
    const result = applyEvents(state, [rotation]);
    expect(result.actors[foe.id].position).toEqual({ x: 1, y: 1 });
    expect(result.actors[third.id].position).toEqual({ x: 4, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 7, y: 1 });
    expect(applyEvents(state, [rotation])).toEqual(result);
  });

  it('a teleporting swap with one rampart-denied leg applies no leg (p.104)', () => {
    const ally = actorFromCharacter(validCharacter('Second'), { x: 4, y: 1 });
    const allyTwo = actorFromCharacter(validCharacter('Third'), { x: 7, y: 1 });
    const { state, hero, foe } = spatialEncounter({ extra: [ally, allyTwo], foePosition: { x: 5, y: 1 } });
    // A hostile rampart source adjacent to (4,1) makes that one cell
    // rampart-affected for hero-side movers. In the rotation A→B, B→C, C→A
    // the legs entering or leaving the affected cell are denied, so the
    // whole teleporting swap is denied — the one legal leg (C→A) does not
    // apply on its own.
    state.actors[foe.id].conditions.push({ id: 'rampart', sourceId: 'fixture:rampart', ownerId: foe.id, potency: 'normal', duration: null });
    const rotation = swapEvent([
      { actorId: hero.id, to: { x: 4, y: 1 }, movement: 'teleport' },
      { actorId: ally.id, to: { x: 7, y: 1 }, movement: 'teleport' },
      { actorId: allyTwo.id, to: { x: 1, y: 1 }, movement: 'teleport' },
    ]);
    const result = applyEvents(state, [rotation]);
    expect(result.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(result.actors[ally.id].position).toEqual({ x: 4, y: 1 });
    expect(result.actors[allyTwo.id].position).toEqual({ x: 7, y: 1 });
    expect(applyEvents(state, [rotation])).toEqual(result);
  });

  it('ungrouped multi-target explicit movement stays non-atomic: the legal leg applies on its own', () => {
    const { state, hero, foe } = spatialEncounter();
    // Two explicit-destination place legs with NO spatialBatchId: atomicity
    // is source-declared, never inferred from the mutation shape, so each
    // leg resolves independently — the legal leg applies and the out-of-
    // bounds leg is denied on its own.
    const moves = ungroupedEvent([{ actorId: foe.id, to: { x: 3, y: 1 } }, { actorId: hero.id, to: { x: 99, y: 1 } }]);
    const result = applyEvents(state, [moves]);
    expect(result.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    expect(result.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, [moves])).toEqual(result);
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
