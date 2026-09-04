import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position, StatusSaveCommandInput } from '../types.js';
import { scriptedDice, validCharacter, endTurnTo, startEncounterTo } from './fixtures.js';

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
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

/** Place a Party Favor mine, then hand the turn to the foe so it can move.
 * The scheduler never auto-selects (ICON p.87): the GM chooses the foe via
 * TAKE_TURN after the hero's END_TURN. */
function mineAndFoeTurn(state: EncounterState, heroId: string, foeId: string, mineAt: Position) {
  const placed = executeCommand(state, {
    type: 'USE_ABILITY', actorId: heroId, abilityId: 'fool:party-favor', targetIds: [], input: minePlacement(mineAt),
  }, scriptedDice()).state;
  expect(placed.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(true);
  return endTurnTo(placed, foeId, scriptedDice());
}

const partyFavorEvents = (events: ReturnType<typeof executeCommand>['events']) =>
  events.filter((event) => event.type === 'RULE_MUTATIONS_APPLIED' && event.sourceId === 'fool:party-favor');

const partyFavorMutations = (events: ReturnType<typeof executeCommand>['events']) =>
  events.flatMap((event) => event.type === 'RULE_MUTATIONS_APPLIED' && event.sourceId === 'fool:party-favor' ? event.mutations : []);

describe('movement-entry triggers (ICON p.151 Party Favor exemplar)', () => {
  it('a foe moving into the mine cell detonates it automatically and removes it', () => {
    const { state, hero, foe } = movementFixture();
    const foeTurn = mineAndFoeTurn(state, hero.id, foe.id, { x: 3, y: 1 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 3, y: 1 }], mode: 'standard' }, scriptedDice(3));

    // The mine detonated on entry: the foe takes 2 area damage and the
    // gamble of 3 neither blinds nor grants stealth.
    expect(moved.state.actors[foe.id].hp).toBe(30);
    expect(moved.state.actors[foe.id].statuses).not.toContain('blind');
    expect(moved.state.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(false);
    // UNRESOLVED: source says "fly 1" but does not specify direction;
    // ally position is not asserted because the engine omits the fly mutation.

    const detonation = partyFavorEvents(moved.events);
    expect(detonation).toHaveLength(1);
    expect(detonation[0]).toMatchObject({ actionId: 'fool:party-favor:movement-entry', timing: 'movement-end' });
    // Replay produces the identical state.
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('does not detonate when the mover never enters the mine space (closed negative)', () => {
    const { state, hero, foe } = movementFixture();
    const foeTurn = mineAndFoeTurn(state, hero.id, foe.id, { x: 3, y: 1 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 2, y: 0 }], mode: 'standard' }, scriptedDice(3));
    expect(partyFavorEvents(moved.events)).toHaveLength(0);
    expect(moved.state.actors[foe.id].hp).toBe(32);
    expect(moved.state.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(true);
  });

  it('a bloodied foe entering the mine activates the ability\u2019s Finishing Blow clause (2 damage twice)', () => {
    const { state, hero, foe } = movementFixture();
    state.actors[foe.id].hp = 16; // bloodied (baseMaxHp 32)
    const foeTurn = mineAndFoeTurn(state, hero.id, foe.id, { x: 3, y: 1 });
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
    const foeTurn = mineAndFoeTurn(state, hero.id, foe.id, { x: 3, y: 1 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 3, y: 1 }], mode: 'standard' }, scriptedDice(3));
    expect(moved.state.actors[foe.id].hp).toBe(26); // 32 - 2 - 2 - 2
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('a multi-space path detonates the mine exactly once, on entry', () => {
    const { state, hero, foe } = movementFixture({ foe: { x: 1, y: 2 } });
    const foeTurn = mineAndFoeTurn(state, hero.id, foe.id, { x: 3, y: 2 });
    const moved = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 2, y: 2 }, { x: 3, y: 2 }], mode: 'standard' }, scriptedDice(4));
    expect(moved.state.actors[foe.id].hp).toBe(30);
    expect(partyFavorEvents(moved.events)).toHaveLength(1);
    // The 4+ gamble blinds the entering foe.
    expect(moved.state.actors[foe.id].statuses).toContain('blind');
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('enter \u2192 leave \u2192 re-enter the same mine detonates only once (re-entry dedup)', () => {
    // Regression: the fold evaluates cells against the original state, so a
    // path that revisits the mine cell must not fire the trigger twice.
    const { state, hero, foe } = movementFixture({ foe: { x: 1, y: 3 } });
    const foeTurn = mineAndFoeTurn(state, hero.id, foe.id, { x: 3, y: 3 });
    // Step-by-step path: (1,3)→(2,3)→(3,3) [mine] → (2,3) [leave] → (3,3) [re-enter]
    const moved = executeCommand(foeTurn, {
      type: 'MOVE', actorId: foe.id,
      path: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
      mode: 'standard',
    }, scriptedDice(3));
    // The fold produces one event per trigger source, not per cell.
    const detonation = partyFavorEvents(moved.events);
    expect(detonation).toHaveLength(1);
    // The event carries terrain removal for the mine (once) and one set of
    // detonation mutations — not two.
    const terrainRemovals = partyFavorMutations(moved.events).filter(
      (m) => m.kind === 'terrain' && m.operation === 'remove' && m.terrain === 'party-favor',
    );
    expect(terrainRemovals).toHaveLength(1);
    // Foe took 2 area damage (single detonation), not 4.
    expect(moved.state.actors[foe.id].hp).toBe(30);
    expect(moved.state.terrainEffects.some((e) => e.terrain === 'party-favor')).toBe(false);
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('two distinct mines at different positions both detonate in one movement', () => {
    // Regression: distinct trigger sources at different cells must fire
    // independently in the same fold.
    const { state, hero, foe } = movementFixture({ foe: { x: 1, y: 3 } });
    let placed = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:party-favor', targetIds: [],
      input: minePlacement({ x: 3, y: 3 }),
    }, scriptedDice()).state;
    // Place a second mine manually (the ability is once-per-turn).
    placed.terrainEffects.push({
      id: 'second-mine:fixture', sourceId: 'fool:party-favor', ownerId: hero.id,
      terrain: 'party-favor', positions: [{ x: 4, y: 3 }], height: null, duration: null,
    });
    const foeTurn = endTurnTo(placed, foe.id, scriptedDice());
    // Path crosses both mines step-by-step: (1,3)→(2,3)→(3,3)→(4,3)
    const moved = executeCommand(foeTurn, {
      type: 'MOVE', actorId: foe.id,
      path: [{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }],
      mode: 'standard',
    }, scriptedDice(3));
    const detonation = partyFavorEvents(moved.events);
    expect(detonation).toHaveLength(1);
    // The single event carries two terrain removals and two detonation batches.
    const terrainRemovals = partyFavorMutations(moved.events).filter(
      (m) => m.kind === 'terrain' && m.operation === 'remove' && m.terrain === 'party-favor',
    );
    expect(terrainRemovals).toHaveLength(2);
    // Both mines removed.
    expect(moved.state.terrainEffects.some((e) => e.terrain === 'party-favor')).toBe(false);
    // Foe took 2 area damage twice = 4 total.
    expect(moved.state.actors[foe.id].hp).toBe(28);
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });

  it('a DASH into the mine detonates it', () => {
    // Place the foe far from the hero to avoid engagement complications.
    const { state, hero, foe } = movementFixture({ foe: { x: 1, y: 5 }, hero: { x: 1, y: 1 } });
    // Mine must be within range 3 of the hero at (1,1).
    const foeTurn = mineAndFoeTurn(state, hero.id, foe.id, { x: 1, y: 4 });
    // DASH from (1,5) into (1,4) [mine].
    const moved = executeCommand(foeTurn, {
      type: 'MOVE', actorId: foe.id,
      path: [{ x: 1, y: 4 }],
      mode: 'dash',
    }, scriptedDice(3));
    expect(partyFavorEvents(moved.events)).toHaveLength(1);
    expect(moved.state.actors[foe.id].hp).toBe(30);
    expect(moved.state.terrainEffects.some((e) => e.terrain === 'party-favor')).toBe(false);
    expect(applyEvents(foeTurn, moved.events)).toEqual(moved.state);
  });
});
