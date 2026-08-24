import { expect } from 'vitest';
import { BONDS, JOBS } from '../catalog.js';
import { createCharacter } from '../character.js';
import { applyEvents, executeCommand } from '../encounter.js';
import type { DiceSource } from '../dice.js';
import type { EncounterCommand, EncounterState, IconCharacter } from '../types.js';

export function validCharacter(name = 'Aster'): IconCharacter {
  const character = createCharacter('2026-08-19T00:00:00.000Z');
  const bond = BONDS[0];
  const job = JOBS[0];
  return {
    ...character,
    name,
    kin: 'Thrynn',
    culture: 'Yeokin',
    bondId: bond.id,
    bondAction: 'traverse',
    bondPowers: [bond.powers[0]],
    actions: { ...character.actions, traverse: 3, sense: 1, study: 1, charm: 1 },
    jobs: [job.id],
    primaryJobId: job.id,
    abilities: job.abilities.slice(0, 2).map(({ id }) => ({ abilityId: id, talent: null, mastered: false })),
    equippedAbilityIds: job.abilities.slice(0, 2).map(({ id }) => id),
  };
}

export function scriptedDice(...rolls: number[]): DiceSource {
  let index = 0;
  return {
    die(sides) {
      const value = rolls[index++] ?? 1;
      if (value < 1 || value > sides) throw new Error(`Scripted roll ${value} is invalid for d${sides}.`);
      return value;
    },
  };
}

/**
 * Command-purity contract (AGENTS.md §1 and the encounter reducer):
 *
 *    immutable input state + command + dice
 *        -> planned durable events
 *        -> applyEvents(input, events)
 *        -> new state
 *
 * `executeCommand(state, ...)` must NEVER mutate the `state` it is given —
 * for accepted commands AND rejected commands. And for accepted commands,
 * `applyEvents(originalState, result.events)` must deeply equal
 * `result.state` (replay starts from the PRE-COMMAND snapshot).
 *
 * These helpers let any rules test assert both halves of the contract cheaply;
 * prefer them over hand-rolling the clone/expect pair.
 */

/** Assert that an accepted command leaves its input deeply unchanged and that
 * replay from the pre-command snapshot reproduces the returned state exactly.
 * Returns the command result for further assertions. */
export function expectCommandPurity(
  state: EncounterState,
  command: EncounterCommand,
  dice: DiceSource = scriptedDice(),
): ReturnType<typeof executeCommand> {
  const before = structuredClone(state);
  const result = executeCommand(state, command, dice);
  expect(state, `executeCommand must not mutate its input (${command.type})`).toEqual(before);
  expect(
    applyEvents(before, result.events),
    `replay from the pre-command snapshot must reproduce result.state (${command.type})`,
  ).toEqual(result.state);
  return result;
}

/** Assert that a rejected command leaves its input deeply unchanged. */
export function expectRejectedCommandPurity(
  state: EncounterState,
  command: EncounterCommand,
  dice: DiceSource = scriptedDice(),
): void {
  const before = structuredClone(state);
  expect(() => executeCommand(state, command, dice)).toThrow();
  expect(state, `a rejected executeCommand must not mutate its input (${command.type})`).toEqual(before);
}

/**
 * ICON p.87 scheduler fixture helpers. The engine never chooses the actor:
 * after START_ENCOUNTER (player side eligible) and after every END_TURN the
 * room awaits the controller's TAKE_TURN / GO_SLOW decision. These helpers
 * make that decision explicitly so rules tests keep their readable
 * hero-then-foe cadence while asserting the new scheduler contract
 * (awaiting-selection state after every boundary).
 */

/** START_ENCOUNTER, then have the player side select `firstActorId` via
 * TAKE_TURN. The combat-start first turn replays the historical cadence: no
 * turn-start lifecycle fires, but the selected actor is active with a fresh
 * turn clock. */
export function startEncounterTo(state: EncounterState, firstActorId: string, dice: DiceSource = scriptedDice()): EncounterState {
  const started = executeCommand(state, { type: 'START_ENCOUNTER' }, dice).state;
  expect(started.activeActorId).toBeNull();
  expect(started.eligibleSide).toBe('heroes');
  expect(started.turnPhase).toBe('normal');
  return executeCommand(started, { type: 'TAKE_TURN', actorId: firstActorId }, dice).state;
}

/** End the currently active actor's turn and select `nextActorId` via
 * TAKE_TURN. Asserts that END_TURN left the encounter awaiting a selection
 * (the old automatic nextActor behavior is gone). */
export function endTurnTo(state: EncounterState, nextActorId: string, dice: DiceSource = scriptedDice()): EncounterState {
  const activeActorId = state.activeActorId;
  if (!activeActorId) throw new Error('endTurnTo requires an active actor (the scheduler never auto-selects).');
  const ended = executeCommand(state, { type: 'END_TURN', actorId: activeActorId }, dice).state;
  expect(ended.activeActorId).toBeNull();
  return executeCommand(ended, { type: 'TAKE_TURN', actorId: nextActorId }, dice).state;
}

/** End the currently active actor's turn and leave the encounter awaiting the
 * next TAKE_TURN / GO_SLOW decision (for tests that only need the boundary to
 * resolve, not a specific next actor). */
export function endTurnOnly(state: EncounterState, dice: DiceSource = scriptedDice()): EncounterState {
  const activeActorId = state.activeActorId;
  if (!activeActorId) throw new Error('endTurnOnly requires an active actor (the scheduler never auto-selects).');
  const ended = executeCommand(state, { type: 'END_TURN', actorId: activeActorId }, dice).state;
  expect(ended.activeActorId).toBeNull();
  return ended;
}
