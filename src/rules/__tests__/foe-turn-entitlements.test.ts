import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { ELITE_TURN_ENTITLEMENT_SOURCE_ID, LEGEND_TURN_ENTITLEMENT_SOURCE_ID } from '../automation/index.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import { isActorSlowCommitted, mustNextTurnBeSlow, turnEligibleActorIds } from '../turn-scheduler.js';
import type { EncounterActor, EncounterCommand, EncounterEvent, EncounterState } from '../types.js';
import { endTurnOnly, expectCommandPurity, scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

/**
 * Foe role turn entitlements (ICON pp.298–299; TODO B1 / roadmap P2).
 *
 *   p.298 Legend:  "Takes 1 turn for each player character"
 *                  (HP: 50 per player character, minimum 100 — construction).
 *   p.299 Elite:   "This foe takes 2 turns. Double HP for the Foe."
 *                  (the HP half is applied once at construction.)
 *
 * The entitlements are PRODUCTION content rows
 * (`automation/content/foes/turn-entitlement-recipes.ts`) registered into the
 * existing scheduler registry. Every test here drives the authoritative
 * encounter path (createFoeFromProfile → ADD_ACTOR → START_ENCOUNTER →
 * TAKE_TURN / END_TURN) with NO test-only entitlement registration.
 */

const ELITE_PROFILE = 'basic:archon:308'; // p.308 Archon — heavy-role Elite template, HP 80
const LEGEND_PROFILE = 'jotunn:i-rider-of-the-primal-storm:459'; // p.459 I-Rider of the Primal Storm
const REGULAR_PROFILE = 'basic:knuckle:301'; // plain job-kind foe

function heroAt(name: string, x: number): EncounterActor {
  return actorFromCharacter(validCharacter(name), { x, y: 1 });
}

/** Build a setup-state encounter: `pcCount` player characters vs one foe
 * constructed through the production path. */
function fixture(profileId: string, pcCount: number): { state: EncounterState; heroes: EncounterActor[]; foeId: string } {
  let state = createEncounter('Foe role entitlement fixture');
  const heroes: EncounterActor[] = [];
  for (let index = 0; index < pcCount; index += 1) {
    const hero = heroAt(`PC ${index + 1}`, index);
    heroes.push(hero);
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }, scriptedDice()).state;
  }
  const foe = createFoeFromProfile(profileId, { x: pcCount + 2, y: 5 }, pcCount);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }, scriptedDice()).state;
  return { state, heroes, foeId: foe.id };
}

/** Fixture opened into round 1 with the opening PC's turn already selected
 * (the engine never chooses the actor itself, p.87). */
function startedFixture(profileId: string, pcCount: number): { state: EncounterState; heroes: EncounterActor[]; foeId: string } {
  const base = fixture(profileId, pcCount);
  return {
    state: startEncounterTo(base.state, base.heroes[0]!.id, scriptedDice()),
    heroes: base.heroes,
    foeId: base.foeId,
  };
}

/** The controller's explicit actor selection (the scheduler awaits it). */
function take(state: EncounterState, actorId: string): EncounterState {
  return executeCommand(state, { type: 'TAKE_TURN', actorId }, scriptedDice()).state;
}

/** Drive actual turns until the round first shows `targetRound`, always
 * taking the first scheduler-offered actor (`foeId` preferred on the hostile
 * side). Counts how many times `foeId` was SELECTED along the way. */
function driveToRound(start: EncounterState, targetRound: number, foeId?: string): { state: EncounterState; foeTurnsSelected: number } {
  let current = start;
  let foeTurnsSelected = 0;
  for (let guard = 0; guard < 80; guard += 1) {
    if (current.round === targetRound) return { state: current, foeTurnsSelected };
    if (current.activeActorId !== null) {
      current = endTurnOnly(current, scriptedDice());
      continue;
    }
    const eligible = turnEligibleActorIds(current);
    expect(eligible.length, 'scheduler stalled with no eligible actors').toBeGreaterThan(0);
    const chosen = current.eligibleSide === 'foes' && foeId && eligible.includes(foeId) ? foeId : eligible[0]!;
    if (chosen === foeId) foeTurnsSelected += 1;
    current = take(current, chosen);
  }
  throw new Error(`round ${targetRound} never arrived`);
}

describe('foe role turn entitlements — production rows through the authoritative scheduler (pp.298–299)', () => {
  it('1. a regular foe gets exactly one turn per round, refreshed every round', () => {
    const { state, heroes, foeId } = startedFixture(REGULAR_PROFILE, 1);
    expect(state.actors[foeId].roleId).toBe('heavy');
    expect(state.actors[foeId].turnsRemaining).toBe(1);

    // Round 1: the PC finishes, the knuckle takes its single hostile slot.
    let current = endTurnOnly(state, scriptedDice());
    expect(current.eligibleSide).toBe('foes');
    current = endTurnOnly(take(current, foeId), scriptedDice());
    expect(current.round).toBe(2);
    // Round 2 refreshes the SAME single entitlement — no phantom extra slot.
    expect(current.actors[foeId].turnsRemaining).toBe(1);
    expect(turnEligibleActorIds(current)).toEqual([heroes[0]!.id]);
  });

  it('2. an Elite gets exactly two turns per round with NO test-only registration', () => {
    const { state, foeId } = startedFixture(ELITE_PROFILE, 1);
    // Source-exact construction sanity (p.299/p.308): the listed HP 80 already
    // stands in for the template's doubled HP; this suite owns only the TURN
    // half.
    expect(state.actors[foeId].baseMaxHp).toBe(80);
    expect(state.actors[foeId].turnsRemaining).toBe(2);

    // Round 1: hero acts, then the GM is offered the SAME elite twice.
    let current = endTurnOnly(state, scriptedDice());
    expect(current.eligibleSide).toBe('foes');
    current = endTurnOnly(take(current, foeId), scriptedDice()); // elite turn 1
    expect(current.round).toBe(1);
    expect(current.eligibleSide).toBe('foes'); // still owed its second turn
    current = endTurnOnly(take(current, foeId), scriptedDice()); // elite turn 2
    // Both entitlements spent: the round ends and reopens with the heroes.
    expect(current.round).toBe(2);
    expect(current.eligibleSide).toBe('heroes');
  });

  it('3. a Legend facing four player characters gets exactly four turns per round', () => {
    const { state, foeId } = startedFixture(LEGEND_PROFILE, 4);
    expect(state.actors[foeId].roleId).toBe('legend');
    expect(state.actors[foeId].turnsRemaining).toBe(4);

    const { state: second, foeTurnsSelected } = driveToRound(state, 2, foeId);
    expect(foeTurnsSelected).toBe(4); // four actual legend turns in round 1
    expect(second.eligibleSide).toBe('heroes'); // round 2 opens opposite the legend's final turn
    expect(second.actors[foeId].turnsRemaining).toBe(4); // refreshed for round 2
  });

  it('4. entitlements refresh at the next round boundary (an Elite keeps two every round)', () => {
    const { state, heroes, foeId } = startedFixture(ELITE_PROFILE, 1);
    // Round 1: hero, elite ×2 → round 2.
    let current = endTurnOnly(state, scriptedDice());
    current = endTurnOnly(take(current, foeId), scriptedDice());
    current = endTurnOnly(take(current, foeId), scriptedDice());
    expect(current.round).toBe(2);
    expect(current.actors[foeId].turnsRemaining).toBe(2); // refreshed, not consumed forever
    expect(current.actors[heroes[0]!.id].turnsRemaining).toBe(1);

    // Round 2 repeats the exact same cadence.
    current = endTurnOnly(take(current, heroes[0]!.id), scriptedDice());
    current = endTurnOnly(take(current, foeId), scriptedDice());
    expect(current.round).toBe(2);
    expect(current.eligibleSide).toBe('foes'); // second round-2 slot
    current = endTurnOnly(take(current, foeId), scriptedDice());
    expect(current.round).toBe(3);
    expect(current.actors[foeId].turnsRemaining).toBe(2);
  });

  it('5. defeated player characters still count toward the Legend turns (pinned reading of source silence)', () => {
    const { state, foeId } = startedFixture(LEGEND_PROFILE, 4);
    const pcIds = Object.values(state.actors).filter((actor) => actor.actorKind === 'hero').map(({ id }) => id);
    // A NON-opening PC falls mid-fight (direct durable defeat, as in the
    // settlement suite); the opening PC's turn is in progress.
    state.actors[pcIds[3]!].defeated = true;
    // The NEXT round still derives FOUR legend turns: "each player character"
    // names no living-only exception, matching the fixed party-size basis of
    // the legend's HP scaling. Deliberately pinned — see
    // automation/content/foes/turn-entitlement-recipes.ts.
    const { state: second } = driveToRound(state, 2, foeId);
    expect(second.actors[foeId].turnsRemaining).toBe(4);
  });

  it('6. a Delayed multi-turn Elite serves its extra entitlement out of the Slow mini-round with normal action economy', () => {
    const { state, foeId } = startedFixture(ELITE_PROFILE, 1);
    // Round 1: the hero finishes, then the elite's FIRST normal turn begins…
    let current = endTurnOnly(state, scriptedDice());
    current = take(current, foeId);
    // …and a Delay effect lands during it ("your next turn must be a slow
    // turn", p.95) — the same durable pending state the Six Hells Trigram
    // program writes.
    current.actors[foeId].ruleState['six-hells:slow-turn'] = true;
    current.actors[foeId].ruleStateOwners['six-hells:slow-turn'] = foeId;
    // Completing this turn, the elite is slow-committed: its SECOND slot can
    // only be a Slow turn, so the normal phase passes into the Slow mini-round.
    expect(isActorSlowCommitted(current.actors[foeId])).toBe(true);
    current = endTurnOnly(current, scriptedDice());
    expect(current.turnPhase).toBe('slow');
    expect(turnEligibleActorIds(current)).toEqual([foeId]);
    const forced = take(current, foeId);
    expect(forced.actors[foeId].actionsRemaining).toBe(2); // Slow turns have normal action economy
    expect(forced.actors[foeId].ruleState['six-hells:slow-turn']).toBeUndefined(); // consumed by THIS turn
    const ended = executeCommand(forced, { type: 'END_TURN', actorId: foeId }, scriptedDice()).state;
    expect(ended.round).toBe(2);
    expect(ended.turnPhase).toBe('normal');
  });

  it('7. a Delay pending across the round boundary forces one slow turn, then restores the ordinary multi-turn cadence', () => {
    const { state, heroes, foeId } = startedFixture(ELITE_PROFILE, 1);
    // Round 1: hero, then the elite's first turn…
    let current = endTurnOnly(state, scriptedDice());
    current = endTurnOnly(take(current, foeId), scriptedDice());
    // …and the Delay lands during the elite's SECOND round-1 turn. Its
    // completion therefore plans ROUND 2 across the boundary with the pending
    // flag intact (unlike a voluntary GO_SLOW election, which dies with its
    // round).
    current = take(current, foeId);
    current.actors[foeId].ruleState['six-hells:slow-turn'] = true;
    current.actors[foeId].ruleStateOwners['six-hells:slow-turn'] = foeId;
    current = endTurnOnly(current, scriptedDice());
    expect(current.round).toBe(2);
    expect(mustNextTurnBeSlow(current.actors[foeId])).toBe(true); // survived the reset
    // Round 2: the hero's ordinary turn runs first; the pass rule then hands
    // the slot to the Slow mini-round (the delayed elite is out of the normal
    // pool).
    current = endTurnOnly(take(current, heroes[0]!.id), scriptedDice());
    expect(current.turnPhase).toBe('slow');
    expect(turnEligibleActorIds(current)).toEqual([foeId]);
    // The forced Slow turn consumes the pending delay at its start.
    const forced = take(current, foeId);
    expect(forced.actors[foeId].ruleState['slow-turn']).toBe(true);
    expect(forced.actors[foeId].actionsRemaining).toBe(2);
    expect(mustNextTurnBeSlow(forced.actors[foeId])).toBe(false);
    const afterForced = executeCommand(forced, { type: 'END_TURN', actorId: foeId }, scriptedDice()).state;
    // That forced slow turn was ONE of the elite's TWO round-2 turns: the
    // multi-turn cadence resumes with a normal-phase hostile slot afterwards.
    expect(afterForced.round).toBe(2);
    expect(afterForced.eligibleSide).toBe('foes');
    expect(afterForced.turnPhase).toBe('normal');
    expect(isActorSlowCommitted(afterForced.actors[foeId])).toBe(false);
  });

  it('8. replaying an Elite encounter reproduces identical scheduler state and events', () => {
    const base = fixture(ELITE_PROFILE, 1);
    const heroId = base.heroes[0]!.id;
    const commands: EncounterCommand[] = [
      { type: 'START_ENCOUNTER' },
      { type: 'TAKE_TURN', actorId: heroId },
      { type: 'END_TURN', actorId: heroId },
      { type: 'TAKE_TURN', actorId: base.foeId },
      { type: 'END_TURN', actorId: base.foeId },
      { type: 'TAKE_TURN', actorId: base.foeId },
      { type: 'END_TURN', actorId: base.foeId },
      { type: 'TAKE_TURN', actorId: heroId },
      { type: 'END_TURN', actorId: heroId },
      { type: 'TAKE_TURN', actorId: base.foeId },
      { type: 'END_TURN', actorId: base.foeId },
    ];
    let live = base.state;
    const events: EncounterEvent[][] = [];
    for (const command of commands) {
      const result = expectCommandPurity(live, command, scriptedDice());
      live = result.state;
      events.push(result.events);
    }
    expect(live.round).toBeGreaterThanOrEqual(2);
    const replayed = applyEvents(base.state, events.flat());
    expect(replayed).toEqual(live);
  });

  it('9. replaying a Legend encounter reproduces identical scheduler state and events', () => {
    const base = fixture(LEGEND_PROFILE, 2);
    const [heroA, heroB] = base.heroes;
    const commands: EncounterCommand[] = [
      { type: 'START_ENCOUNTER' },
      { type: 'TAKE_TURN', actorId: heroA!.id },
      { type: 'END_TURN', actorId: heroA!.id },
      { type: 'TAKE_TURN', actorId: base.foeId },
      { type: 'END_TURN', actorId: base.foeId },
      { type: 'TAKE_TURN', actorId: heroB!.id },
      { type: 'END_TURN', actorId: heroB!.id },
      { type: 'TAKE_TURN', actorId: base.foeId },
      { type: 'END_TURN', actorId: base.foeId },
      { type: 'TAKE_TURN', actorId: heroA!.id },
      { type: 'END_TURN', actorId: heroA!.id },
      { type: 'TAKE_TURN', actorId: base.foeId },
      { type: 'END_TURN', actorId: base.foeId },
    ];
    let live = base.state;
    const events: EncounterEvent[][] = [];
    for (const command of commands) {
      const result = expectCommandPurity(live, command, scriptedDice());
      live = result.state;
      events.push(result.events);
    }
    expect(live.round).toBeGreaterThanOrEqual(2);
    const replayed = applyEvents(base.state, events.flat());
    expect(replayed).toEqual(live);
  });

  it('10. the production rows alone are the authority: stable source ids keyed on template/role identity, not display names', () => {
    expect(ELITE_TURN_ENTITLEMENT_SOURCE_ID).toBe('role:elite-template');
    expect(LEGEND_TURN_ENTITLEMENT_SOURCE_ID).toBe('role:legend-turns');
    // In ONE started encounter: a regular foe stays at 1 while the elite
    // template grants 2 — the rows discriminate on durable identity alone.
    const base = fixture(ELITE_PROFILE, 1);
    const regular = createFoeFromProfile(REGULAR_PROFILE, { x: 8, y: 8 }, 1);
    const withRegular = executeCommand(base.state, { type: 'ADD_ACTOR', actor: regular }, scriptedDice()).state;
    const started = executeCommand(withRegular, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    expect(started.actors[regular.id].turnsRemaining).toBe(1);
    expect(started.actors[base.foeId].turnsRemaining).toBe(2);
    // And the Legend row reads party size from authoritative state:
    const legendBase = fixture(LEGEND_PROFILE, 4);
    const legendStarted = executeCommand(legendBase.state, { type: 'START_ENCOUNTER' }, scriptedDice()).state;
    expect(legendStarted.actors[legendBase.foeId].turnsRemaining).toBe(4);
  });
});
