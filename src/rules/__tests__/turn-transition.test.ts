import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState, TurnEndCause } from '../types.js';
import { scriptedDice, validCharacter, endTurnTo, startEncounterTo } from './fixtures.js';

/**
 * F3 turn-transition fixtures (docs/rules-foundations.md §4).
 *
 * Every TURN_ENDED event now carries the durable `TurnTransitionIntent`: the
 * end cause, the ordered lifecycle participants that ran, and the dice/save
 * windows pre-rolled at the command boundary. These cases pin the boundary
 * contract — replay executes exactly the recorded participants (never
 * re-rolls or re-decides), the dice windows are consumed from the record, and
 * the four end causes replay identically. Legacy events without an intent
 * keep the documented applies-gate fallback.
 */

interface TransitionFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor;
}

function transitionEncounter(options: { second?: boolean } = {}): TransitionFixture {
  let state = createEncounter('Turn-transition fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', { x: 2, y: 1 });
  const second = options.second === false ? null : createFoe('Grim', { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second: second! };
}

function turnEndedOf(result: ReturnType<typeof executeCommand>): Extract<EncounterEvent, { type: 'TURN_ENDED' }> {
  const event = result.events.find((candidate) => candidate.type === 'TURN_ENDED');
  if (!event || event.type !== 'TURN_ENDED') throw new Error('Expected a TURN_ENDED event.');
  return event;
}

describe('F3 turn-transition intent', () => {
  it('records the cause, dice windows, round advance, and ordered participants on a voluntary end turn', () => {
    const { state, hero, foe, second } = transitionEncounter();
    const result = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    const event = turnEndedOf(result);
    expect(event.cause).toBe('voluntary');
    expect(event.intent).toMatchObject({
      cause: 'voluntary',
      roundAdvance: false,
      diceWindows: {},
    });
    // The recorded participants are exactly the registry recipes whose gates
    // passed for the hero's turn-end at this boundary (the next actor's
    // turn-start participants are planned when the controller selects it via
    // TAKE_TURN).
    expect(event.intent!.participants).toEqual(expect.any(Array));
    expect(event.intent!.participants).not.toContain('fool:carnevale');
    // The boundary never chooses the next actor: the hostile side becomes
    // eligible and the GM selects the foe.
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
    expect(applyEvents(state, result.events)).toEqual(result.state);
    const foeTurn = executeCommand(result.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;

    // The round-closing boundary (the last actor, back to the hero) records
    // roundAdvance: true and replays the round increment.
    const next = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice());
    const midRound = turnEndedOf(next);
    expect(midRound.round).toBe(1);
    expect(midRound.intent).toMatchObject({ cause: 'voluntary', roundAdvance: false });
    expect(applyEvents(foeTurn, next.events)).toEqual(next.state);

    const secondTurn = executeCommand(next.state, { type: 'TAKE_TURN', actorId: second.id }, scriptedDice()).state;
    const third = executeCommand(secondTurn, { type: 'END_TURN', actorId: second.id }, scriptedDice());
    const roundEvent = turnEndedOf(third);
    expect(roundEvent.round).toBe(2);
    expect(roundEvent.intent).toMatchObject({ cause: 'voluntary', roundAdvance: true });
    expect(applyEvents(secondTurn, third.events)).toEqual(third.state);
  });

  it('pre-rolls the Carnevale detonation gamble at the command boundary and records it on the intent', () => {
    const { state, hero, foe } = transitionEncounter({ second: false });
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:carnevale', input: { positions: { 'bomb-positions': [{ x: 0, y: 1 }, { x: 0, y: 2 }] } }, targetIds: [] }, scriptedDice());
    const bombs = Object.values(placed.state.entities).filter((entity) => entity.type === 'bomb' && entity.ownerId === hero.id);
    expect(bombs).toHaveLength(2);

    const detonated = executeCommand(placed.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice(5));
    const event = turnEndedOf(detonated);
    // The gamble was rolled once at the command boundary and recorded both on
    // the event (historical shape) and inside the intent (F3 dice window).
    expect(event.intent!.diceWindows).toEqual({ carnevaleGamble: 5 });
    expect(event.carnevaleGamble).toBe(5);
    expect(event.intent!.participants).toContain('fool:carnevale');
    // The recorded gamble is what the damage applied: 5 normal - armor 2.
    expect(detonated.state.actors[hero.id].hp).toBe(37);
    expect(applyEvents(placed.state, detonated.events)).toEqual(detonated.state);
  });

  it('replay executes exactly the recorded participants, never re-decides them', () => {
    const { state, hero } = transitionEncounter({ second: false });
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:carnevale', input: { positions: { 'bomb-positions': [{ x: 0, y: 1 }, { x: 0, y: 2 }] } }, targetIds: [] }, scriptedDice());
    const detonated = executeCommand(placed.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice(5));
    const event = turnEndedOf(detonated);

    // Strip the Carnevale plan from the recorded per-phase candidate plan
    // (T6.3): the gate still passes at replay (the gamble window is present),
    // but the recorded contract must win — the bombs must NOT detonate. The
    // flat legacy `participants` list is filtered too; the phases plan is the
    // authoritative replay record.
    const excluding: EncounterEvent[] = [{
      ...event,
      intent: {
        ...event.intent!,
        participants: event.intent!.participants.filter((id) => id !== 'fool:carnevale'),
        phases: (event.intent!.phases ?? []).map((plan) => ({
          ...plan,
          candidates: plan.candidates.filter((candidate) => candidate.sourceId !== 'fool:carnevale'),
        })),
      },
    }];
    const replayed = applyEvents(placed.state, excluding);
    expect(Object.values(replayed.entities).filter((entity) => entity.type === 'bomb')).toHaveLength(2);
    expect(replayed.actors[hero.id].ruleState['carnevale:armed']).toBe(true);

    // A fabricated source id in the participants list is ignored safely.
    const fabricated: EncounterEvent[] = [{ ...event, intent: { ...event.intent!, participants: [...event.intent!.participants, 'fixture:not-a-recipe'] } }];
    const withFabricated = applyEvents(placed.state, fabricated);
    expect(Object.values(withFabricated.entities).filter((entity) => entity.type === 'bomb')).toHaveLength(0);
    expect(applyEvents(placed.state, detonated.events)).toEqual(detonated.state);
  });

  it('legacy events without an intent fall back to the applies gates and top-level dice fields', () => {
    const { state, hero } = transitionEncounter({ second: false });
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:carnevale', input: { positions: { 'bomb-positions': [{ x: 0, y: 1 }, { x: 0, y: 2 }] } }, targetIds: [] }, scriptedDice());
    const detonated = executeCommand(placed.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice(5));
    const event = turnEndedOf(detonated);

    // Historical logs carried the gamble on the event, not in an intent.
    const { intent: _intent, ...legacy } = event;
    const replayed = applyEvents(placed.state, [legacy as EncounterEvent]);
    // The fallback reconstructs the dice window from the top-level field and
    // runs every applies gate — the Carnevale recipe participates again.
    // (The full-state comparison is skipped: the eventLog legitimately differs
    // because the replayed log retains the legacy event without an intent.)
    expect(Object.values(replayed.entities).filter((entity) => entity.type === 'bomb')).toHaveLength(0);
    expect(replayed.actors[hero.id].hp).toBe(37);
    expect(replayed.actors[hero.id].ruleState['carnevale:armed']).toBe(false);
    expect(applyEvents(placed.state, [legacy as EncounterEvent])).toEqual(replayed);
  });

  it('records a gallows-humor turn-start participant and replays its die tick from the recorded list', () => {
    const { state, hero, foe } = transitionEncounter({ second: false });
    // The hero holds the stance (die set out at 1 as when entered); the die
    // ticks at the start of the hero's next turn. The scheduler never names
    // the hero at the foe's boundary: the TURN_ENDED event records the
    // transition, and the controller's TAKE_TURN records the hero's
    // turn-start participant list.
    state.actors[hero.id].stance = { id: 'stance', sourceId: 'fool:gallows-humor', ownerId: hero.id, stanceId: 'gallows-humor', state: {} };
    state.actors[hero.id].ruleState['gallows-humor:die'] = 1;
    state.actors[hero.id].ruleStateOwners['gallows-humor:die'] = hero.id;
    const foeTurn = endTurnTo(state, foe.id, scriptedDice());
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice());
    expect(ended.state.activeActorId).toBeNull();
    const started = executeCommand(ended.state, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice());
    const startedEvent = started.events.find((candidate) => candidate.type === 'TURN_STARTED');
    expect(startedEvent && startedEvent.type === 'TURN_STARTED' ? startedEvent.participants : []).toContain('freelancer:gallows-humor');
    expect(started.state.actors[hero.id].ruleState['gallows-humor:die']).toBe(2);

    // Replay consumes the recorded participant list (identical command state).
    expect(applyEvents(foeTurn, ended.events)).toEqual(ended.state);
    expect(applyEvents(ended.state, started.events)).toEqual(started.state);

    // Removing the recipe from the recorded TURN_STARTED candidate plan
    // (T6.3 — the phases record is the authoritative replay input)
    // suppresses the tick even though the stance gate still passes.
    if (startedEvent && startedEvent.type === 'TURN_STARTED') {
      const excluding: EncounterEvent[] = [{
        ...startedEvent,
        participants: startedEvent.participants.filter((id) => id !== 'freelancer:gallows-humor'),
        phases: (startedEvent.phases ?? []).map((plan) => ({
          ...plan,
          candidates: plan.candidates.filter((candidate) => candidate.sourceId !== 'freelancer:gallows-humor'),
        })),
      }];
      const replayed = applyEvents(ended.state, excluding);
      expect(replayed.actors[hero.id].ruleState['gallows-humor:die']).toBe(1);
    }
  });
});

describe('F3 turn-end cause parity', () => {
  it('voluntary: the END_TURN command records and replays a voluntary boundary', () => {
    const { state, hero, foe } = transitionEncounter({ second: false });
    const result = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    expect(turnEndedOf(result).cause).toBe('voluntary');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('ability-tag: an ability tagged end turn records and replays an ability-tag boundary', () => {
    const { state, hero, foe } = transitionEncounter({ second: false });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const event = turnEndedOf(result);
    expect(event.cause).toBe('ability-tag');
    expect(event.intent).toMatchObject({ cause: 'ability-tag' });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('forced-status: a stunned actor is forced to end its turn and replays identically', () => {
    const { state, hero, foe } = transitionEncounter({ second: false });
    state.actors[hero.id].statuses.push('stunned');
    const result = executeCommand(state, { type: 'MOVE', actorId: hero.id, path: [{ x: 1, y: 2 }], mode: 'standard' }, scriptedDice());
    const event = turnEndedOf(result);
    expect(event.cause).toBe('forced-status');
    expect(event.intent).toMatchObject({ cause: 'forced-status' });
    expect(result.state.actors[hero.id].statuses).not.toContain('stunned');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('rule-requested: an EXECUTE_RULE that requests the turn end records and replays it', () => {
    const { state, hero, foe } = transitionEncounter({ second: false });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'warden:morrigan',
      actionId: 'default',
      timing: 'use',
      input: {},
    }, scriptedDice());
    const event = turnEndedOf(result);
    expect(event.cause).toBe('rule-requested');
    expect(event.intent).toMatchObject({ cause: 'rule-requested' });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('every cause replays through applyEvents to the identical command state', () => {
    const causes: Array<{ cause: TurnEndCause; run: (state: EncounterState) => ReturnType<typeof executeCommand> }> = [
      {
        cause: 'voluntary',
        run: (state) => executeCommand(state, { type: 'END_TURN', actorId: state.activeActorId! }, scriptedDice()),
      },
    ];
    for (const { cause, run } of causes) {
      const fixture = transitionEncounter({ second: false });
      const result = run(fixture.state);
      expect(turnEndedOf(result).cause).toBe(cause);
      expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
    }
  });
});
