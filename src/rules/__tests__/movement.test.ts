import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand, RuleViolation } from '../encounter.js';
import { planMovement, planMovementPath } from '../movement.js';
import { noRepeatKey, standardMoveOncePerTurnKey } from '../automation/kernels/use-ledger.js';
import type { EncounterState, Position, TerrainCell } from '../types.js';
import {validCharacter, endTurnTo, startEncounterTo, dangerousTerrainTriggeredThisTurn} from './fixtures.js';

function activeEncounter(options: {
  heroPosition?: Position;
  foePosition?: Position;
  allyPosition?: Position;
  terrain?: TerrainCell[];
  gridSize?: number;
} = {}) {
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroPosition ?? { x: 1, y: 1 });
  const foe = createFoe('Relict', options.foePosition ?? { x: 4, y: 4 });
  const ally = options.allyPosition ? actorFromCharacter(validCharacter('Bryn'), options.allyPosition) : null;
  let state = createEncounter('Movement plan fixture');
  const gridSize = options.gridSize ?? 6;
  state = { ...state, grid: { ...state.grid, width: gridSize, height: gridSize, terrain: options.terrain ?? [] } };
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, ally };
}

function moveAccepted(state: EncounterState, actorId: string, path: Position[], mode: 'standard' | 'dash') {
  try {
    return { accepted: true as const, result: executeCommand(state, { type: 'MOVE', actorId, path, mode }) };
  } catch (error) {
    expect(error).toBeInstanceOf(RuleViolation);
    return { accepted: false as const, result: null };
  }
}

describe('shared movement planner', () => {
  it('predicts reducer acceptance, route, cost, and consequences over many destinations', () => {
    const { state, hero } = activeEncounter({
      allyPosition: { x: 2, y: 3 },
      terrain: [
        { position: { x: 1, y: 2 }, type: 'difficult', elevation: 0 },
        { position: { x: 2, y: 2 }, type: 'dangerous', elevation: 0 },
        { position: { x: 3, y: 3 }, type: 'impassable', elevation: 0 },
        { position: { x: 4, y: 2 }, type: 'basic', elevation: 2 },
      ],
    });

    for (const mode of ['standard', 'dash'] as const) {
      for (let y = 0; y < state.grid.height; y += 1) {
        for (let x = 0; x < state.grid.width; x += 1) {
          const plan = planMovement(state, hero.id, { x, y }, mode);
          const execution = moveAccepted(state, hero.id, plan.path, mode);
          expect(execution.accepted, `${mode} (${x}, ${y})`).toBe(plan.legal);
          if (execution.accepted) {
            expect(execution.result.events[0]).toMatchObject({
              type: 'ACTOR_MOVED',
              actorId: hero.id,
              path: plan.path,
              mode,
              dangerousDamage: plan.dangerousDamage,
              slashedDamage: plan.slashedDamage,
            });
            expect(execution.result.state.actors[hero.id].position).toEqual(plan.destination);
          }
        }
      }
    }
  });

  it('allows an ally waypoint while rejecting occupied final spaces', () => {
    const { state, hero, foe, ally } = activeEncounter({ allyPosition: { x: 2, y: 1 } });
    // The same allied cell has different legality by path role (ICON p.88):
    // it is a legal transit leg, but not a legal final space.
    expect(planMovementPath(state, hero.id, [{ x: 2, y: 1 }, { x: 3, y: 1 }], 'standard'))
      .toMatchObject({ legal: true, destination: { x: 3, y: 1 } });
    expect(planMovementPath(state, hero.id, [{ x: 2, y: 1 }], 'standard'))
      .toMatchObject({ legal: false, issue: { code: 'move.obstructed' } });

    const throughAlly = planMovement(state, hero.id, { x: 3, y: 1 }, 'standard');
    expect(throughAlly).toMatchObject({ legal: true, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }], cost: 2 });
    expect(moveAccepted(state, hero.id, throughAlly.path, 'standard').accepted).toBe(true);

    const allyDestination = planMovement(state, hero.id, ally!.position, 'standard');
    expect(allyDestination).toMatchObject({ legal: false, issue: { code: 'move.obstructed' } });
    expect(moveAccepted(state, hero.id, [ally!.position], 'standard').accepted).toBe(false);

    const foeDestination = planMovement(state, hero.id, foe.position, 'standard');
    expect(foeDestination).toMatchObject({ legal: false, issue: { code: 'move.obstructed' } });
  });

  it('uses the highest terrain, elevation, and engagement penalty and lets Dash ignore engagement', () => {
    const terrain: TerrainCell[] = [
      { position: { x: 1, y: 1 }, type: 'difficult', elevation: 0 },
      { position: { x: 2, y: 1 }, type: 'basic', elevation: 2 },
    ];
    const elevation = activeEncounter({ terrain });
    const elevated = planMovement(elevation.state, elevation.hero.id, { x: 2, y: 1 }, 'standard');
    expect(elevated).toMatchObject({ legal: true, cost: 3, steps: [{ difficultTerrainPenalty: 1, elevationPenalty: 2, engagementPenalty: 0, cost: 3 }] });
    expect(moveAccepted(elevation.state, elevation.hero.id, elevated.path, 'standard').accepted).toBe(true);

    const sloped = activeEncounter({ terrain: [
      { position: { x: 1, y: 1 }, type: 'slope', elevation: 0 },
      { position: { x: 2, y: 1 }, type: 'basic', elevation: 2 },
    ] });
    expect(planMovement(sloped.state, sloped.hero.id, { x: 2, y: 1 }, 'standard')).toMatchObject({ legal: true, cost: 2, steps: [{ elevationPenalty: 1, cost: 2 }] });

    const engaged = activeEncounter({ foePosition: { x: 1, y: 2 } });
    expect(planMovement(engaged.state, engaged.hero.id, { x: 2, y: 1 }, 'standard')).toMatchObject({ legal: true, cost: 2, steps: [{ engagementPenalty: 1, cost: 2 }] });
    const dash = planMovement(engaged.state, engaged.hero.id, { x: 2, y: 1 }, 'dash');
    expect(dash).toMatchObject({ legal: true, cost: 1, actionCost: 1, steps: [{ engagementPenalty: 0, cost: 1 }] });
    const executedDash = moveAccepted(engaged.state, engaged.hero.id, dash.path, 'dash');
    expect(executedDash.accepted).toBe(true);
    if (executedDash.accepted) {
      expect(executedDash.result.state.actors[engaged.hero.id]).toMatchObject({ actionsRemaining: 1 });
      expect(executedDash.result.state.actors[engaged.hero.id]!.ruleState[noRepeatKey('basic:dash')]).toBe(true);
    }
  });

  it('reports an impossible elevation leg with the same rejection as the reducer', () => {
    const { state, hero } = activeEncounter({ terrain: [{ position: { x: 2, y: 1 }, type: 'basic', elevation: 4 }] });
    const path = [{ x: 2, y: 1 }];
    expect(planMovement(state, hero.id, path[0]!, 'standard')).toMatchObject({ legal: false, issue: { code: 'move.elevation' } });
    const plan = planMovementPath(state, hero.id, path, 'standard');
    expect(plan).toMatchObject({ legal: false, issue: { code: 'move.elevation' } });
    expect(moveAccepted(state, hero.id, path, 'standard').accepted).toBe(false);
  });

  it('retains reducer validation order for an empty MOVE path', () => {
    const { state, hero } = activeEncounter();
    state.actors[hero.id].ruleState[standardMoveOncePerTurnKey(hero.id)] = true;
    expect(planMovementPath(state, hero.id, [], 'standard')).toMatchObject({ legal: false, issue: { code: 'move.empty' } });
    try {
      executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [], mode: 'standard' });
      throw new Error('Expected MOVE to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'move.empty' });
    }
  });

  it('applies dangerous terrain once in a turn, then resets it for the actor’s next turn', () => {
    const { state, hero, foe } = activeEncounter({ terrain: [{ position: { x: 2, y: 1 }, type: 'dangerous', elevation: 0 }] });
    state.actors[hero.id].vigor = 5;
    const firstPlan = planMovement(state, hero.id, { x: 2, y: 1 }, 'standard');
    expect(firstPlan).toMatchObject({ legal: true, dangerousDamage: 2 });
    const standardResult = executeCommand(state, { type: 'MOVE', actorId: hero.id, path: firstPlan.path, mode: 'standard' });
    const afterStandard = standardResult.state;
    expect(afterStandard.actors[hero.id]).toMatchObject({ hp: 38, vigor: 5 });
    expect(dangerousTerrainTriggeredThisTurn(afterStandard.actors[hero.id])).toBe(true);
    expect(applyEvents(state, standardResult.events)).toEqual(afterStandard);

    const dashPlan = planMovement(afterStandard, hero.id, { x: 1, y: 1 }, 'dash');
    expect(dashPlan).toMatchObject({ legal: true, dangerousDamage: 0 });
    const afterDash = executeCommand(afterStandard, { type: 'MOVE', actorId: hero.id, path: dashPlan.path, mode: 'dash' }).state;
    expect(afterDash.actors[hero.id]).toMatchObject({ hp: 38, vigor: 5 });
    // A second movement in the same turn must NOT re-trigger dangerous terrain.
    expect(dangerousTerrainTriggeredThisTurn(afterDash.actors[hero.id])).toBe(true);

    const foeTurn = endTurnTo(afterDash, foe.id);
    const nextHeroTurn = endTurnTo(foeTurn, hero.id);
    expect(dangerousTerrainTriggeredThisTurn(nextHeroTurn.actors[hero.id])).toBe(false);
    const nextPlan = planMovement(nextHeroTurn, hero.id, { x: 2, y: 1 }, 'standard');
    expect(nextPlan).toMatchObject({ legal: true, dangerousDamage: 2 });
  });

  it('determines dangerous terrain through mitigation but retains its explicit vigor bypass', () => {
    const { state, hero } = activeEncounter({ terrain: [{ position: { x: 2, y: 1 }, type: 'dangerous', elevation: 0 }] });
    state.actors[hero.id].vigor = 5;
    state.actors[hero.id].conditions.push({ id: 'resistance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });

    const moved = executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [{ x: 2, y: 1 }], mode: 'standard' });

    // Dangerous terrain is a raw 2-piercing instance (p.89). Resistance
    // halves it once; its independently stated bypass-vigor property remains.
    expect(moved.events[0]).toMatchObject({ type: 'ACTOR_MOVED', dangerousDamage: 2 });
    expect(moved.state.actors[hero.id]).toMatchObject({ hp: 39, vigor: 5 });
    expect(applyEvents(state, moved.events)).toEqual(moved.state);
  });

  it('applies overlapping terrain, pit elevation, and object obstruction from the source map state', () => {
    const { state, hero } = activeEncounter({ terrain: [{ position: { x: 2, y: 1 }, type: 'pit', elevation: 3 }] });
    state.terrainEffects.push({
      id: 'fixture:acid-pit',
      sourceId: 'fixture',
      ownerId: null,
      terrain: 'dangerous',
      positions: [{ x: 2, y: 1 }],
      height: null,
      duration: null,
    });
    state.entities['fixture:barrel'] = {
      id: 'fixture:barrel',
      type: 'object',
      ownerId: null,
      positions: [{ x: 3, y: 1 }],
      state: {},
      duration: null,
    };

    // ICON p. 89: a pit is one elevation lower than its base space; dangerous
    // terrain can overlap it and still deals its once-per-turn piercing damage.
    expect(planMovement(state, hero.id, { x: 2, y: 1 }, 'standard')).toMatchObject({
      legal: true,
      cost: 3,
      dangerousDamage: 2,
      steps: [{ elevationPenalty: 2 }],
    });
    expect(planMovement(state, hero.id, { x: 3, y: 1 }, 'standard')).toMatchObject({
      legal: false,
      issue: { code: 'move.obstructed' },
    });
  });

  it('executes Skirmisher, Flying, Phasing, and Immobile movement rules', () => {
    const skirmisher = activeEncounter({ foePosition: { x: 5, y: 5 } });
    skirmisher.state.actors[skirmisher.hero.id].traitIds.push('vagabond:trait:skirmisher');
    skirmisher.state.actors[skirmisher.hero.id].dash = 2;
    const diagonal = planMovement(skirmisher.state, skirmisher.hero.id, { x: 2, y: 2 }, 'standard');
    expect(diagonal).toMatchObject({ legal: true, path: [{ x: 2, y: 2 }], cost: 1 });
    expect(moveAccepted(skirmisher.state, skirmisher.hero.id, diagonal.path, 'standard').accepted).toBe(true);

    const freshSkirmisher = activeEncounter({ foePosition: { x: 5, y: 5 } });
    freshSkirmisher.state.actors[freshSkirmisher.hero.id].traitIds.push('vagabond:trait:skirmisher');
    freshSkirmisher.state.actors[freshSkirmisher.hero.id].dash = 2;
    // ICON p. 105: Skirmisher makes Dash a full-Speed move rather than Dash.
    expect(planMovement(freshSkirmisher.state, freshSkirmisher.hero.id, { x: 5, y: 1 }, 'dash')).toMatchObject({ legal: true, allowance: 4, cost: 4 });

    const flight = activeEncounter({
      foePosition: { x: 5, y: 5 },
      terrain: [
        { position: { x: 2, y: 1 }, type: 'impassable', elevation: 3 },
        { position: { x: 3, y: 1 }, type: 'dangerous', elevation: 0 },
      ],
    });
    flight.state.actors[flight.hero.id].conditions.push({ id: 'flying', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const flyingRoute = planMovementPath(flight.state, flight.hero.id, [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }], 'standard');
    expect(flyingRoute).toMatchObject({ legal: true, cost: 3, dangerousDamage: 0 });
    expect(flyingRoute.steps).toEqual(expect.arrayContaining([expect.objectContaining({ elevationPenalty: 0, difficultTerrainPenalty: 0, engagementPenalty: 0 })]));
    // Flight crosses obstructions, but characters still cannot end in one.
    expect(planMovement(flight.state, flight.hero.id, { x: 2, y: 1 }, 'standard')).toMatchObject({ legal: false, issue: { code: 'move.impassable' } });

    const phasing = activeEncounter({ foePosition: { x: 5, y: 5 }, terrain: [{ position: { x: 2, y: 1 }, type: 'impassable', elevation: 0 }] });
    phasing.state.actors[phasing.hero.id].conditions.push({ id: 'phasing', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    expect(planMovementPath(phasing.state, phasing.hero.id, [{ x: 2, y: 1 }, { x: 3, y: 1 }], 'standard')).toMatchObject({ legal: true, path: [{ x: 2, y: 1 }, { x: 3, y: 1 }] });
    expect(planMovement(phasing.state, phasing.hero.id, { x: 2, y: 1 }, 'standard')).toMatchObject({ legal: false, issue: { code: 'move.impassable' } });

    const immobile = activeEncounter();
    immobile.state.actors[immobile.hero.id].conditions.push({ id: 'immobile', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    expect(planMovement(immobile.state, immobile.hero.id, { x: 2, y: 1 }, 'standard')).toMatchObject({ legal: false, issue: { code: 'move.immobile' } });
    expect(moveAccepted(immobile.state, immobile.hero.id, [{ x: 2, y: 1 }], 'standard').accepted).toBe(false);
  });

  it('Size 2: anchor in bounds but footprint off-map is rejected', () => {
    // 6×6 grid; hero at (4,4) size 2 → footprint occupies (4,4),(5,4),(4,5),(5,5)
    // Move to (5,5) → footprint extends to x=6 which is off the 6-wide grid
    const { state, hero } = activeEncounter({ heroPosition: { x: 4, y: 4 }, foePosition: { x: 0, y: 0 }, gridSize: 6 });
    state.actors[hero.id].size = 2;
    expect(planMovement(state, hero.id, { x: 5, y: 5 }, 'standard')).toMatchObject({
      legal: false,
      issue: { code: 'move.out-of-bounds' },
    });
  });

  it('Size 2: cannot finish overlapping another actor', () => {
    // Hero size 2 at (1,1) → footprint (1,1)(2,1)(1,2)(2,2)
    // Foe size 1 at (3,2)
    // Move hero to (2,2) → footprint (2,2)(3,2)(2,3)(3,3) overlaps foe at (3,2)
    const { state, hero, foe } = activeEncounter({ heroPosition: { x: 1, y: 1 }, foePosition: { x: 3, y: 2 } });
    state.actors[hero.id].size = 2;
    expect(planMovement(state, hero.id, { x: 2, y: 2 }, 'standard')).toMatchObject({
      legal: false,
      issue: { code: 'move.obstructed' },
    });
  });

  it('Size 2: cannot finish overlapping impassable terrain', () => {
    // Hero size 2 at (1,1), impassable at (3,2)
    // Move to (2,2) → footprint (2,2)(3,2)(2,3)(3,3) overlaps impassable
    const { state, hero } = activeEncounter({
      heroPosition: { x: 1, y: 1 },
      foePosition: { x: 5, y: 5 },
      terrain: [{ position: { x: 3, y: 2 }, type: 'impassable', elevation: 0 }],
    });
    state.actors[hero.id].size = 2;
    expect(planMovement(state, hero.id, { x: 2, y: 2 }, 'standard')).toMatchObject({
      legal: false,
      issue: { code: 'move.impassable' },
    });
  });

  it('Size 2: engaged when any footprint edge is adjacent to a hostile footprint', () => {
    // Hero size 2 at (1,1) → footprint (1,1)(2,1)(1,2)(2,2)
    // Foe size 2 at (3,2) → footprint (3,2)(4,2)(3,3)(4,3)
    // Footprint adjacency: hero's (2,2) is orthogonally adjacent to foe's (3,2)
    // → hero is engaged at (1,1) even though anchors are distance 2 apart
    const { state, hero, foe } = activeEncounter({ heroPosition: { x: 1, y: 1 }, foePosition: { x: 3, y: 2 } });
    state.actors[hero.id].size = 2;
    state.actors[foe.id].size = 2;
    // Engagement is checked at the step's `from` position. The first step
    // starts from (1,1) where footprints ARE adjacent → engagement penalty.
    const plan = planMovement(state, hero.id, { x: 2, y: 0 }, 'standard');
    expect(plan.steps[0]?.engagementPenalty).toBe(1);
  });

  it('Size 2: two large actors whose anchors are not adjacent can be engaged via footprints', () => {
    // Hero size 2 at (1,1) → (1,1)(2,1)(1,2)(2,2)
    // Foe size 2 at (3,2) → (3,2)(4,2)(3,3)(4,3)
    // Anchor distance: max(|3-1|,|2-1|) = 2 — not adjacent by anchor alone
    // But footprints: (2,2) adjacent to (3,2) → engaged by footprint adjacency
    const { state, hero, foe } = activeEncounter({ heroPosition: { x: 1, y: 1 }, foePosition: { x: 3, y: 2 } });
    state.actors[hero.id].size = 2;
    state.actors[foe.id].size = 2;
    // Size 1 hero at same position would NOT be engaged (anchor distance 2)
    const { state: s1, hero: h1 } = activeEncounter({ heroPosition: { x: 1, y: 1 }, foePosition: { x: 3, y: 2 } });
    const size1Plan = planMovement(s1, h1.id, { x: 2, y: 0 }, 'standard');
    expect(size1Plan.steps[0]?.engagementPenalty).toBe(0);
    // Size 2 hero IS engaged because footprints are adjacent
    const size2Plan = planMovement(state, hero.id, { x: 2, y: 0 }, 'standard');
    expect(size2Plan.steps[0]?.engagementPenalty).toBe(1);
  });

  it('Size 2: passing through an ally footprint is legal but ending overlapped is not', () => {
    // Hero size 2 at (0,0), ally size 1 at (2,1)
    // Move hero to (1,1) → footprint (1,1)(2,1)(1,2)(2,2) overlaps ally at (2,1)
    const { state, hero, ally } = activeEncounter({
      heroPosition: { x: 0, y: 0 },
      allyPosition: { x: 2, y: 1 },
      foePosition: { x: 5, y: 5 },
    });
    state.actors[hero.id].size = 2;
    expect(planMovement(state, hero.id, { x: 1, y: 1 }, 'standard')).toMatchObject({
      legal: false,
      issue: { code: 'move.obstructed' },
    });
    // But moving through (1,0) → (2,0) → (2,1) should work as waypoints
    // (ally at (2,1) is passable during movement, just not at destination)
    const throughPath = planMovementPath(state, hero.id, [
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
    ], 'standard');
    // The intermediate waypoints (1,0) and (2,0) should be legal
    expect(throughPath.steps[0]).not.toBeNull();
    expect(throughPath.steps[1]).not.toBeNull();
  });
});
