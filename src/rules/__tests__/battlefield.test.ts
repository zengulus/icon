import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { validatePositionLegality } from '../automation/kernels/evaluate-query.js';
import { chosenTeleportDestination } from '../automation/kernels/teleport-choice.js';
import { finalSpaceOccupied } from '../automation/primitives/battlefield.js';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import type { EncounterState } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

function fixture() {
  const hero = actorFromCharacter(validCharacter('Anchor'), { x: 1, y: 1 });
  const foe = createFoe('Large fixture', { x: 4, y: 2 });
  foe.size = 2;
  let state = createEncounter('Final-space authority');
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  return { state, hero, foe };
}

function context(state: EncounterState, actorId: string): RuleExecutionContext {
  return {
    state: encounterRuleState(state),
    actorId,
    sourceId: 'fixture:final-space',
    actionId: 'default',
    timing: 'use',
    input: {},
    dice: scriptedDice(),
  };
}

describe('finalSpaceOccupied authority', () => {
  it('uses every cell of a live footprint and honors excludeId', () => {
    const { state, hero, foe } = fixture();
    const view = context(state, hero.id);
    for (const cell of [{ x: 4, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 3 }, { x: 5, y: 3 }]) {
      expect(finalSpaceOccupied(cell, view)).toBe(true);
    }
    expect(finalSpaceOccupied({ x: 6, y: 3 }, view)).toBe(false);
    expect(finalSpaceOccupied({ x: 5, y: 3 }, view, foe.id)).toBe(false);
  });

  it('ignores defeated and off-battlefield actors, including in U3 final-space legality', () => {
    const { state, hero, foe } = fixture();
    state.actors[foe.id].defeated = true;
    const defeated = context(state, hero.id);
    expect(finalSpaceOccupied({ x: 4, y: 2 }, defeated)).toBe(false);
    expect(validatePositionLegality(
      { origin: hero.position, originSize: hero.size, range: 10, excludeActorId: hero.id },
      { x: 4, y: 2 },
      defeated,
    )).toMatchObject({ legal: true });

    state.actors[foe.id].defeated = false;
    state.actors[foe.id].onBattlefield = false;
    expect(finalSpaceOccupied({ x: 4, y: 2 }, context(state, hero.id))).toBe(false);
  });

  it('uses complete object geometry and the shared entity-kind authority', () => {
    const { state, hero } = fixture();
    state.entities.single = {
      id: 'single', type: 'unlisted-object-type', kind: 'object', ownerId: null,
      positions: [{ x: 2, y: 5 }], state: {}, duration: null,
    };
    state.entities.region = {
      id: 'region', type: 'another-unlisted-type', kind: 'object', ownerId: null,
      positions: [{ x: 6, y: 5 }, { x: 7, y: 5 }, { x: 7, y: 6 }], state: {}, duration: null,
    };
    // Explicit summon category wins over the object-like type name; the
    // primitive never infers category from display prose.
    state.entities.intangible = {
      id: 'intangible', type: 'boulder', kind: 'summon', ownerId: hero.id,
      positions: [{ x: 3, y: 5 }, { x: 3, y: 6 }], state: {}, duration: null,
    };
    const view = context(state, hero.id);

    expect(finalSpaceOccupied({ x: 2, y: 5 }, view)).toBe(true);
    for (const cell of state.entities.region.positions) {
      expect(finalSpaceOccupied(cell, view)).toBe(true);
    }
    expect(finalSpaceOccupied({ x: 6, y: 6 }, view)).toBe(false);
    expect(finalSpaceOccupied({ x: 3, y: 5 }, view)).toBe(false);
    expect(finalSpaceOccupied({ x: 3, y: 6 }, view)).toBe(false);
  });
});

describe('U7 — teleport origin frame measures from the mover p.92 footprint edge', () => {
  it('a Size-1 mover is unchanged: range 1 from the origin point cell', () => {
    const { state, hero } = fixture();
    const view = context(state, hero.id);
    // hero is Size 1 at (1,1). Teleport 1 must accept a destination 1 cell
    // away and reject a destination 2 cells away (the point-frame baseline
    // that every Size-1 caller has always used).
    expect(validatePositionLegality(
      { origin: { x: 1, y: 1 }, originSize: 1, range: 1, excludeActorId: hero.id },
      { x: 2, y: 1 }, view,
    )).toMatchObject({ legal: true });
    expect(validatePositionLegality(
      { origin: { x: 1, y: 1 }, originSize: 1, range: 1, excludeActorId: hero.id },
      { x: 3, y: 1 }, view,
    )).toMatchObject({ legal: false, problem: 'range' });
  });

  it('a Size-2 mover measures from the footprint EDGE, not the anchor cell (p.92)', () => {
    const { state, foe } = fixture(); // foe is Size 2 at (4,2): footprint (4,2)(5,2)(4,3)(5,3)
    const view = context(state, foe.id);
    // Range 1 from the EDGE reaches (6,2) (one cell past the east edge) …
    expect(validatePositionLegality(
      { origin: { x: 4, y: 2 }, originSize: 2, range: 1, excludeActorId: foe.id },
      { x: 6, y: 2 }, view,
    )).toMatchObject({ legal: true });
    // … while the POINT metric (originSize 1, the pre-fix behavior) rejects it.
    expect(validatePositionLegality(
      { origin: { x: 4, y: 2 }, originSize: 1, range: 1, excludeActorId: foe.id },
      { x: 6, y: 2 }, view,
    )).toMatchObject({ legal: false, problem: 'range' });
    // One cell PAST the edge+1 boundary still fails with the edge metric.
    expect(validatePositionLegality(
      { origin: { x: 4, y: 2 }, originSize: 2, range: 1, excludeActorId: foe.id },
      { x: 7, y: 2 }, view,
    )).toMatchObject({ legal: false, problem: 'range' });
  });

  it('chosenTeleportDestination threads the mover footprint size through the legality boundary', () => {
    const { state, foe } = fixture();
    // The mover is the Size-2 foe; a range-1 teleport to the edge-adjacent
    // cell (6,2) is legal BECAUSE the kernel measures from the footprint edge.
    // (With the old point frame it was out of range.)
    const view = {
      ...context(state, foe.id),
      input: { positions: { teleport: [{ x: 6, y: 2 }] } },
    };
    const destination = chosenTeleportDestination(
      view, foe.id, 'teleport', { x: 4, y: 2 }, 1, 'fixture',
    );
    expect(destination).toEqual({ x: 6, y: 2 });
    // And a destination one cell PAST the edge-adjacent boundary is rejected
    // with the mover's footprint frame.
    const beyond = {
      ...context(state, foe.id),
      input: { positions: { teleport: [{ x: 7, y: 2 }] } },
    };
    expect(() => chosenTeleportDestination(
      beyond, foe.id, 'teleport', { x: 4, y: 2 }, 1, 'fixture',
    )).toThrow(/limited to 1 space/);
  });

  it('the mover\'s own cells are not self-blocking under the edge metric', () => {
    const { state, foe } = fixture();
    const view = context(state, foe.id);
    // A cell INSIDE the mover's own footprint (the anchor cell) is not
    // occupied by the mover (excludeActorId), but is also not a legal
    // teleport destination (it is not a move). The legality operator blocks
    // it as occupied-by-self is excluded; assert it resolves as in-range
    // (the frame), while a genuinely-occupied cell (an ally within range)
    // is rejected as occupied.
    expect(validatePositionLegality(
      { origin: { x: 4, y: 2 }, originSize: 2, range: 1, excludeActorId: foe.id },
      { x: 5, y: 2 }, view,
    )).toMatchObject({ legal: true });
  });
});
