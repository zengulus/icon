import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import {
  registerSlowTurnEligibilitySource,
  registerTurnEntitlementSource,
  turnEligibleActorIds,
  slowElectableActorIds,
} from '../turn-scheduler.js';
import type { EncounterActor, EncounterState } from '../types.js';
import { endTurnOnly, endTurnTo, scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

/**
 * ICON 1.5 turn-order scheduler matrix (p.87 — "Turn order", "Slow turns").
 *
 * The scheduler decides ONLY which SIDE/PHASE may act next; the controlling
 * player(s)/GM choose the actor through the explicit TAKE_TURN / GO_SLOW
 * commands. Every flow below asserts the awaiting-selection boundary after
 * each END_TURN and replays from the pre-command snapshot.
 */

interface SchedulerFixture {
  state: EncounterState;
  heroes: EncounterActor[];
  foes: EncounterActor[];
  allies: EncounterActor[];
}

function schedulerFixture(options: { heroes?: number; foes?: number; allies?: number; heroAt?: Array<[number, number]>; foeAt?: Array<[number, number]> } = {}): SchedulerFixture {
  let state = createEncounter('Scheduler fixture');
  const heroes = Array.from({ length: options.heroes ?? 1 }, (_, index) => {
    const actor = actorFromCharacter(validCharacter(`Hero ${index + 1}`), {
      x: options.heroAt?.[index]?.[0] ?? 1,
      y: options.heroAt?.[index]?.[1] ?? index + 1,
    });
    return actor;
  });
  const allies = Array.from({ length: options.allies ?? 0 }, (_, index) => {
    const actor = actorFromCharacter(validCharacter(`Ally ${index + 1}`), {
      x: options.heroAt?.[heroes.length + index]?.[0] ?? 1,
      y: options.heroAt?.[heroes.length + index]?.[1] ?? heroes.length + index + 1,
    });
    return actor;
  });
  const foes = Array.from({ length: options.foes ?? 1 }, (_, index) => {
    const actor = createFoe(`Foe ${index + 1}`, {
      x: options.foeAt?.[index]?.[0] ?? 6,
      y: options.foeAt?.[index]?.[1] ?? index + 1,
    });
    return actor;
  });
  for (const actor of [...heroes, ...allies, ...foes]) {
    state = executeCommand(state, { type: 'ADD_ACTOR', actor }).state;
  }
  return { state, heroes, foes, allies };
}

/** Start combat, then drive both sides through one full round in the given
 * order, asserting each boundary awaited a controller choice. */
function runRound(
  state: EncounterState,
  order: Array<{ actorId: string; slow?: boolean }>,
): EncounterState {
  let current = state;
  for (const step of order) {
    if (step.slow) {
      current = executeCommand(current, { type: 'GO_SLOW', actorId: step.actorId }, scriptedDice()).state;
      expect(current.activeActorId).toBeNull();
    } else {
      current = executeCommand(current, { type: 'TAKE_TURN', actorId: step.actorId }, scriptedDice()).state;
      expect(current.activeActorId).toBe(step.actorId);
      current = endTurnOnly(current, scriptedDice());
      expect(current.activeActorId).toBeNull();
    }
  }
  return current;
}

describe('ICON 1.5 turn order — combat start', () => {
  it('combat starts on round 1 with the player side eligible and NO actor auto-chosen', () => {
    const { state } = schedulerFixture({ heroes: 2, foes: 2 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    expect(started.phase).toBe('active');
    expect(started.round).toBe(1);
    expect(started.activeActorId).toBeNull();
    expect(started.eligibleSide).toBe('heroes');
    expect(started.turnPhase).toBe('normal');
    expect(turnEligibleActorIds(started)).toHaveLength(2);
  });

  it('either legal PC can be selected for the first turn (no insertion-order bias)', () => {
    const { state, heroes } = schedulerFixture({ heroes: 2, foes: 2 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    const first = executeCommand(started, { type: 'TAKE_TURN', actorId: heroes[1]!.id }, scriptedDice()).state;
    expect(first.activeActorId).toBe(heroes[1]!.id);
    expect(first.round).toBe(1);

    // And the first hero in insertion order is equally selectable.
    const started2 = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    const first2 = executeCommand(started2, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    expect(first2.activeActorId).toBe(heroes[0]!.id);
  });

  it('a hostile actor cannot be selected for the first turn of combat', () => {
    const { state, foes } = schedulerFixture({ heroes: 1, foes: 2 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    expect(() => executeCommand(started, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'turn.select' }));
  });

  it('a PC may elect Slow at the combat-start slot (the player side already holds it); with another PC the slot is retained', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 2, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    expect(slowElectableActorIds(started)).toContain(heroes[0]!.id);
    const afterSlow = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    // CASE A: another allied normal actor (H2) retains the opening slot.
    expect(afterSlow.eligibleSide).toBe('heroes');
    expect(afterSlow.turnPhase).toBe('normal');
    const h2Turn = executeCommand(afterSlow, { type: 'TAKE_TURN', actorId: heroes[1]!.id }, scriptedDice()).state;
    expect(h2Turn.activeActorId).toBe(heroes[1]!.id);
  });
});

describe('ICON 1.5 turn order — normal alternation', () => {
  it('2 heroes vs 2 foes: any legal choice per side, alternating sides, no insertion-order dependence', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 2, foes: 2 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;

    // Choose H2 first (reverse insertion order deliberately).
    let current = executeCommand(started, { type: 'TAKE_TURN', actorId: heroes[1]!.id }, scriptedDice()).state;
    expect(turnEligibleActorIds(current)).toHaveLength(0); // a turn is in progress
    current = endTurnOnly(current, scriptedDice());
    // The GM may choose either eligible foe.
    expect(current.eligibleSide).toBe('foes');
    expect(turnEligibleActorIds(current).sort()).toEqual([foes[0]!.id, foes[1]!.id].sort());

    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.eligibleSide).toBe('heroes');
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.eligibleSide).toBe('foes');
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[1]!.id }, scriptedDice()).state;
    const ended = endTurnOnly(current, scriptedDice());
    expect(ended.round).toBe(2); // the final foe's turn ended round 1
    expect(ended.eligibleSide).toBe('heroes'); // opposite of the final turn-taker
  });

  it('a side with no eligible actor yields consecutive turns to the other side (3 heroes vs 1 foe)', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 3, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    let current = executeCommand(started, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.eligibleSide).toBe('foes');
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    // No foes remain: the remaining heroes take consecutive turns in any
    // player-chosen order.
    expect(current.eligibleSide).toBe('heroes');
    const order = [heroes[1]!.id, heroes[2]!.id];
    for (const heroId of order) {
      current = executeCommand(current, { type: 'TAKE_TURN', actorId: heroId }, scriptedDice()).state;
      current = endTurnOnly(current, scriptedDice());
    }
    // The last hero ended round 1 → round 2 opens with the foes (the side
    // opposite the final actual turn-taker).
    expect(current.round).toBe(2);
    expect(current.eligibleSide).toBe('foes');
  });

  it('1 hero vs 3 foes: the remaining foes finish consecutively, and round 2 opens allied (a foe ended round 1)', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 3 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    let current = executeCommand(started, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    for (const foe of foes) {
      expect(current.eligibleSide).toBe('foes');
      current = executeCommand(current, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
      current = endTurnOnly(current, scriptedDice());
    }
    // A foe ended round 1 → the heroes side opens round 2.
    expect(current.round).toBe(2);
    expect(current.eligibleSide).toBe('heroes');
  });

  it('round-side inversion: allied final turn → hostile opens; hostile final turn → allied opens', () => {
    // Round 1 ends with a FOE (F2) → the heroes side opens round 2.
    const a = schedulerFixture({ heroes: 1, foes: 2 });
    const startedA = executeCommand(a.state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    const endedA = runRound(startedA, [
      { actorId: a.heroes[0]!.id },
      { actorId: a.foes[0]!.id },
      { actorId: a.foes[1]!.id },
    ]);
    expect(endedA.round).toBe(2);
    expect(endedA.eligibleSide).toBe('heroes');

    // Round 1 ends with a HERO (H2) → the foes side opens round 2.
    const b = schedulerFixture({ heroes: 2, foes: 1 });
    const startedB = executeCommand(b.state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    const endedB = runRound(startedB, [
      { actorId: b.heroes[0]!.id },
      { actorId: b.foes[0]!.id },
      { actorId: b.heroes[1]!.id },
    ]);
    expect(endedB.round).toBe(2);
    expect(endedB.eligibleSide).toBe('foes');
  });
});

describe('ICON 1.5 turn order — Slow turns', () => {
  it('a PC may elect Slow while another allied PC remains: the slot is retained and the other PC takes it', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 2, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    // H1 elects Slow at the allied slot (CASE A: H2 remains).
    expect(slowElectableActorIds(started)).toContain(heroes[0]!.id);
    const afterSlow = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    expect(afterSlow.actors[heroes[0]!.id].slow).toBe(true);
    expect(afterSlow.activeActorId).toBeNull();
    expect(afterSlow.eligibleSide).toBe('heroes');
    expect(afterSlow.turnPhase).toBe('normal');
    // H2 takes the retained allied slot (a normal turn, no slow lifecycle).
    const h2Turn = executeCommand(afterSlow, { type: 'TAKE_TURN', actorId: heroes[1]!.id }, scriptedDice()).state;
    expect(h2Turn.activeActorId).toBe(heroes[1]!.id);
    expect(h2Turn.actors[heroes[1]!.id].slow).toBe(false);
  });

  it('electing Slow fires no turn lifecycle for the deferring PC, and passing a slot does not advance the round', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 2, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    const heroBefore = structuredClone(started.actors[heroes[0]!.id]);
    const result = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice());
    expect(result.events.some((event) => event.type === 'TURN_STARTED' || event.type === 'TURN_ENDED')).toBe(false);
    expect(result.state.round).toBe(1);
    // No start/end-turn flags were touched on the deferring PC.
    expect(result.state.actors[heroes[0]!.id].turnTaken).toBe(heroBefore.turnTaken);
    expect(result.state.actors[heroes[0]!.id].actionsRemaining).toBe(heroBefore.actionsRemaining);
    // Replay from the pre-command snapshot reproduces the decision exactly.
    expect(applyEvents(started, result.events)).toEqual(result.state);
  });

  it('a PC elects Slow with no allied normal actor left: the allied slot passes and hostile turns continue', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 2 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    const afterSlow = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    // No other allied normal actor: the allied normal slot is passed to the
    // foes, with no phantom allied turn.
    expect(afterSlow.eligibleSide).toBe('foes');
    expect(afterSlow.turnPhase).toBe('normal');
    const f1 = executeCommand(afterSlow, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    expect(f1.activeActorId).toBe(foes[0]!.id);
    const f1Ended = endTurnOnly(f1, scriptedDice());
    const f2 = executeCommand(f1Ended, { type: 'TAKE_TURN', actorId: foes[1]!.id }, scriptedDice()).state;
    const f2Ended = endTurnOnly(f2, scriptedDice());
    // Normal phase exhausted → the Slow mini-round opens with the only slow actor.
    expect(f2Ended.turnPhase).toBe('slow');
    expect(f2Ended.eligibleSide).toBe('heroes');
  });

  it('multiple PCs elect Slow: all normal actors finish first, then the slow actors act in player-chosen order', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 2, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    let current = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = executeCommand(current, { type: 'GO_SLOW', actorId: heroes[1]!.id }, scriptedDice()).state;
    expect(current.eligibleSide).toBe('foes');
    // The single foe takes its normal turn.
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    // Normal phase is exhausted; the Slow mini-round runs the two slow heroes.
    expect(current.turnPhase).toBe('slow');
    expect(turnEligibleActorIds(current).sort()).toEqual([heroes[0]!.id, heroes[1]!.id].sort());
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[1]!.id }, scriptedDice()).state;
    expect(current.activeActorId).toBe(heroes[1]!.id);
    current = endTurnOnly(current, scriptedDice());
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    const ended = endTurnOnly(current, scriptedDice());
    // The slow hero ended the round → round 2 opens with the foes.
    expect(ended.round).toBe(2);
    expect(ended.eligibleSide).toBe('foes');
  });

  it('slow turns on both sides alternate (a source-granted slow foe), controllers still choose the actor', () => {
    // Register a source-backed slow-eligibility row for the fixture foe
    // (most enemies cannot take a slow turn, p.87; content grants it here).
    registerSlowTurnEligibilitySource({
      sourceId: 'fixture:slow-foe',
      eligible: (_state, actor) => actor.id.startsWith('foe:'),
    });
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 2 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    // Both sides elect Slow: the hero at the allied slot, the granted foe at
    // the hostile slot.
    let current = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.eligibleSide).toBe('foes');
    current = executeCommand(current, { type: 'GO_SLOW', actorId: foes[1]!.id }, scriptedDice()).state;
    // Both normal slots passed: the Slow mini-round alternates sides.
    expect(current.turnPhase).toBe('slow');
    expect(current.eligibleSide).toBe('heroes');
    const heroSlow = executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    expect(heroSlow.activeActorId).toBe(heroes[0]!.id);
    const heroEnded = endTurnOnly(heroSlow, scriptedDice());
    expect(heroEnded.eligibleSide).toBe('foes');
    const foeSlow = executeCommand(heroEnded, { type: 'TAKE_TURN', actorId: foes[1]!.id }, scriptedDice()).state;
    expect(foeSlow.activeActorId).toBe(foes[1]!.id);
  });

  it('a Slow turn has ordinary turn action economy (2 actions, standard move)', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    let current = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.turnPhase).toBe('slow');
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    expect(current.actors[heroes[0]!.id].actionsRemaining).toBe(2);
    expect(current.actors[heroes[0]!.id].standardMoveUsed).toBe(false);
  });

  it('illegal slow/turn decisions are rejected: acting again, going slow twice, normal turn from the slow pool, slow turn before the normal phase is exhausted', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    // GO_SLOW twice.
    let current = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    expect(() => executeCommand(current, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'slow.not-eligible' }));
    // A slow-pool actor cannot take a normal turn.
    expect(() => executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'turn.select' }));
    // A slow turn cannot be taken before the normal phase is exhausted (the
    // foe still owes its normal turn; the slow mini-round has not begun).
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    expect(() => executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'turn.select' }));
    // After acting normally, a character cannot elect Slow.
    current = endTurnOnly(current, scriptedDice());
    const next = executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    expect(() => executeCommand(next, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'slow.not-eligible' }));
  });

  it('an actor that completed its turn cannot be selected again that round', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    let current = executeCommand(started, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.eligibleSide).toBe('foes');
    expect(() => executeCommand(current, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'turn.select' }));
  });
});

describe('ICON 1.5 turn order — lifecycle, replay, and multi-turn foes', () => {
  it('the Slow-phase transition does not fire new-round effects, and the round only advances after the final actual turn', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    let current = executeCommand(started, { type: 'GO_SLOW', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    const transition = executeCommand(current, { type: 'END_TURN', actorId: foes[0]!.id }, scriptedDice());
    expect(transition.state.round).toBe(1); // the round does not advance here
    expect(transition.state.turnPhase).toBe('slow');
    // The slow hero's actual turn ends round 1; round 2 opens with the foes.
    current = executeCommand(transition.state, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    const ended = executeCommand(current, { type: 'END_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    expect(ended.round).toBe(2);
    expect(ended.eligibleSide).toBe('foes');
    // Party Resolve ticks once at the round boundary.
    expect(ended.partyResolve).toBe(2);
  });

  it('explicit actor-selection and Slow decisions replay to exactly the same authoritative state', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 2, foes: 1 });
    const commands: Array<{ command: Parameters<typeof executeCommand>[1]; dice?: ReturnType<typeof scriptedDice> }> = [
      { command: { type: 'START_ENCOUNTER' } },
      { command: { type: 'GO_SLOW', actorId: heroes[0]!.id } },
      { command: { type: 'TAKE_TURN', actorId: heroes[1]!.id } },
      { command: { type: 'END_TURN', actorId: heroes[1]!.id } },
      { command: { type: 'TAKE_TURN', actorId: foes[0]!.id } },
      { command: { type: 'END_TURN', actorId: foes[0]!.id } },
      { command: { type: 'TAKE_TURN', actorId: heroes[0]!.id } },
      { command: { type: 'END_TURN', actorId: heroes[0]!.id } },
    ];
    let live = state;
    const events: Array<ReturnType<typeof executeCommand>['events']> = [];
    for (const { command, dice } of commands) {
      const result = executeCommand(live, command, dice ?? scriptedDice());
      live = result.state;
      events.push(result.events);
    }
    const replayed = applyEvents(state, events.flat());
    expect(replayed).toEqual(live);
  });

  it('a multi-turn foe (source-granted extra entitlement) can take each eligible hostile turn, GM-chosen', () => {
    registerTurnEntitlementSource({
      sourceId: 'fixture:double-turn',
      extraTurns: (_state, actor) => (actor.name === 'Foe 1' ? 1 : 0),
    });
    const { state, heroes, foes } = schedulerFixture({ heroes: 1, foes: 1 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    expect(started.actors[foes[0]!.id].turnsRemaining).toBe(2);
    let current = executeCommand(started, { type: 'TAKE_TURN', actorId: heroes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    // The elite foe is eligible twice in the round.
    expect(current.eligibleSide).toBe('foes');
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.eligibleSide).toBe('foes'); // still owed its second turn
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foes[0]!.id }, scriptedDice()).state;
    current = endTurnOnly(current, scriptedDice());
    expect(current.eligibleSide).toBe('heroes');
    expect(current.round).toBe(2);
  });

  it('property: at most one actor is actively taking a turn, and the scheduler never picks an actor itself', () => {
    const { state, heroes, foes } = schedulerFixture({ heroes: 2, foes: 2 });
    const started = executeCommand(state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    let current = started;
    for (let index = 0; index < 10; index += 1) {
      const active = Object.values(current.actors).filter((actor) => actor.id === current.activeActorId);
      expect(active.length).toBeLessThanOrEqual(1);
      const eligible = turnEligibleActorIds(current);
      if (eligible.length === 0) {
        // A turn is in progress or the phase is transitioning: never an
        // auto-chosen actor, and END_TURN always lands back on awaiting.
        expect(current.activeActorId).toBeNull();
        break;
      }
      const chosen = current.eligibleSide === 'heroes'
        ? eligible.find((id) => id.startsWith('actor:')) ?? eligible[0]!
        : eligible[0]!;
      current = executeCommand(current, { type: 'TAKE_TURN', actorId: chosen }, scriptedDice()).state;
      current = endTurnOnly(current, scriptedDice());
    }
  });
});
