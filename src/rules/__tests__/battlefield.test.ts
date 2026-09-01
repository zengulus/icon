import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { validatePositionLegality } from '../automation/kernels/evaluate-query.js';
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
