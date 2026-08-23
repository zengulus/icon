import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position, StatusSaveCommandInput } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Movement-entry trigger fixtures (the F1/F3 seam, ICON p.151 Party Favor:
 * "When any character enters the space, the mine explodes"). The exemplar
 * consumer is registered by content (fool-programs.ts) and folded over a
 * standard MOVE command's recorded path, so the gamble is pre-rolled at the
 * command boundary and the mutation sequence replays identically.
 */

/** The USE_ABILITY command surface exposes only Blessing choices on its
 * `input`; the fixtures cast the Party Favor resolver's explicit mine
 * placement through, exactly as the runtime VM reads it. */
const minePlacement = (position: Position): StatusSaveCommandInput =>
  ({ positions: { 'mine-position': [position] } }) as unknown as StatusSaveCommandInput;

interface MovementFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function movementFixture(options: { foe?: Position; hero?: Position } = {}): MovementFixture {
  let state = createEncounter('Movement trigger fixture');
  const hero = actorFromCharacter(validCharacter('Harlequin'), options.hero ?? { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe };
}

/** Place a Party Favor mine, then hand the turn to the foe so it can move. */
function mineAndFoeTurn(state: EncounterState, heroId: string, mineAt: Position) {
  const placed = executeCommand(state, {
    type: 'USE_ABILITY', actorId: heroId, abilityId: 'fool:party-favor', targetIds: [], input: minePlacement(mineAt),
  }, scriptedDice()).state;
  expect(placed.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(true);
  return executeCommand(placed, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
}

const partyFavorEvents = (events: ReturnType<typeof executeCommand>['events']) =>
  events.filter((event) => event.type === 'RULE_MUTATIONS_APPLIED' && event.sourceId === 'fool:party-favor');

describe('movement-entry triggers (ICON p.151 Party Favor exemplar)', () => {
  it('a foe moving into the mine cell detonates it automatically and removes it', () => {
    const { state, hero, foe } = movementFixture();
    const foeTurn = mineAndFoeTurn(state, hero.id, { x: 3, y: 1 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 3, y: 1 }], mode: 'standard' }, scriptedDice(3));

    // The mine detonated on entry: the foe takes 2 area damage and the
    // gamble of 3 neither blinds nor grants stealth.
    expect(moved.state.actors[foe.id].hp).toBe(30);
    expect(moved.state.actors[foe.id].statuses).not.toContain('blind');
    expect(moved.state.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(false);
    // The owner is in the medium blast: \"Yourself and allies in the area fly
    // 1\" — one step away from the mine center.
    expect(moved.state.actors[hero.id].position).toEqual({ x: 0, y: 1 });

    const detonation = partyFavorEvents(moved.events);
    expect(detonation).toHaveLength(1);
    expect(detonation[0]).toMatchObject({ actionId: 'fool:party-favor:movement-entry', timing: 'movement-end' });
    // Replay produces the identical state.
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('does not detonate when the mover never enters the mine space (closed negative)', () => {
    const { state, hero, foe } = movementFixture();
    const foeTurn = mineAndFoeTurn(state, hero.id, { x: 3, y: 1 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 2, y: 0 }], mode: 'standard' }, scriptedDice(3));
    expect(partyFavorEvents(moved.events)).toHaveLength(0);
    expect(moved.state.actors[foe.id].hp).toBe(32);
    expect(moved.state.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(true);
  });

  it('a bloodied foe entering the mine activates the ability\u2019s Finishing Blow clause (2 damage twice)', () => {
    const { state, hero, foe } = movementFixture();
    state.actors[foe.id].hp = 16; // bloodied (baseMaxHp 32)
    const foeTurn = mineAndFoeTurn(state, hero.id, { x: 3, y: 1 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 3, y: 1 }], mode: 'standard' }, scriptedDice(3));
    // Base 2 + the clause's 2 twice = 6 total.
    expect(moved.state.actors[foe.id].hp).toBe(10);
    const damage = partyFavorEvents(moved.events).flatMap((event) => 'mutations' in event ? event.mutations : []).filter((mutation) => mutation.kind === 'damage');
    expect(damage).toHaveLength(3);
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('talent 2 extends the Finishing Blow clause to a dazed foe entering the mine', () => {
    const { state, hero, foe } = movementFixture();
    state.actors[hero.id].talents['fool:party-favor'] = 2;
    state.actors[foe.id].conditions = [{ id: 'dazed', sourceId: 'fixture:daze', ownerId: null, potency: 'normal', duration: null }];
    const foeTurn = mineAndFoeTurn(state, hero.id, { x: 3, y: 1 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 3, y: 1 }], mode: 'standard' }, scriptedDice(3));
    expect(moved.state.actors[foe.id].hp).toBe(26); // 32 - 2 - 2 - 2
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('a multi-space path detonates the mine exactly once, on entry', () => {
    const { state, hero, foe } = movementFixture({ foe: { x: 1, y: 2 } });
    const foeTurn = mineAndFoeTurn(state, hero.id, { x: 3, y: 2 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 2, y: 2 }, { x: 3, y: 2 }], mode: 'standard' }, scriptedDice(4));
    expect(moved.state.actors[foe.id].hp).toBe(30);
    expect(partyFavorEvents(moved.events)).toHaveLength(1);
    // The 4+ gamble blinds the entering foe.
    expect(moved.state.actors[foe.id].statuses).toContain('blind');
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });
});
