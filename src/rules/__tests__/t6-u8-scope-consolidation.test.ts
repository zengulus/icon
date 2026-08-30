import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { applyEvents, createEncounter, createFoe, actorFromCharacter, executeCommand } from '../encounter.js';
import {
  consumeUseLedgerMutation,
  refreshUsageLedgerForBoundary,
  resetBoundaryFor,
  usageLedgerHoldsForBoundary,
  useLedgerAvailable,
  useLedgerKey,
} from '../automation/kernels/use-ledger.js';
import { usagePeriodForResetBoundary } from '../automation/primitives/usage.js';
import { clockForTiming } from '../automation/primitives/scope.js';
import type { BoundaryRef } from '../automation/primitives/scope.js';
import type { EncounterActor, EncounterEvent, EncounterState } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/** The durable rule-state value type (matches `EncounterActor.ruleState`). */
type RuleStateValue = string | number | boolean | null;

/**
 * T6.1 — U8 SCOPE/CLOCK consolidation consumer parity + replay tests.
 *
 * These tests prove the USE-LEDGER consumers actually route their temporal
 * interpretation through the shared U8 boundary authority
 * (`usagePeriodForResetBoundary` over a U8 `BoundaryRef`) instead of parsing
 * `ledger:<period>:` string prefixes independently in the content recipes.
 *
 * They complement `scope.test.ts` (which proves the U8 PRIMITIVE semantics).
 * The purpose here is the CONSUMER PARITY the gate requires: the lifecycle
 * reset recipes consult the SAME authority their applies gate and body use,
 * and replay reproduces the identical durable ledger state byte-for-byte.
 */

/** A two-actor encounter where the hero's own turn-start resets its turn
 * ledger and a full turn cycle back to the hero crosses the round boundary. */
const ledgerFixture = (): { state: EncounterState; heroId: string; foeId: string } => {
  let state = createEncounter('T6 U8 fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, heroId: hero.id, foeId: foe.id };
};

describe('U8 — usagePeriodForResetBoundary is the INVERSE of resetBoundaryFor', () => {
  it('turn-start maps to the turn period; round-start to round; combat-end never refreshes', () => {
    // span/edge is the authority — the actor subject never changes the PERIOD.
    expect(usagePeriodForResetBoundary(resetBoundaryFor('turn', 'hero'))).toBe('turn');
    expect(usagePeriodForResetBoundary(resetBoundaryFor('round', 'hero'))).toBe('round');
    expect(usagePeriodForResetBoundary(resetBoundaryFor('combat', 'hero'))).toBeNull();
  });

  it('edges stay distinct: only the START edge is a reset boundary for turn/round', () => {
    const turnStart = clockForTiming('turn-start')!;
    const turnEnd = clockForTiming('turn-end')!;
    const roundStart = clockForTiming('round-start')!;
    const roundEnd = clockForTiming('round-end')!;
    expect(usagePeriodForResetBoundary(turnStart)).toBe('turn');
    expect(usagePeriodForResetBoundary(roundStart)).toBe('round');
    // start ≠ end: a turn-end / round-end never refreshes a once-per-X gate.
    expect(usagePeriodForResetBoundary(turnEnd)).toBeNull();
    expect(usagePeriodForResetBoundary(roundEnd)).toBeNull();
  });

  it('non-boundary / event refs never refresh a period', () => {
    const event: BoundaryRef = { kind: 'event', event: 'some-lifecycle-event' };
    expect(usagePeriodForResetBoundary(event)).toBeNull();
  });
});

describe('U8 — refreshUsageLedgerForBoundary clears exactly the refreshed period', () => {
  it('the turn-start boundary clears only ledger:turn:* keys, never round/combat', () => {
    const actor = {
      id: 'a',
      ruleState: {
        'ledger:turn:g1': true,
        'ledger:round:g2': 3,
        'ledger:combat:g3': true,
        'unrelated': 1,
      } as Record<string, RuleStateValue>,
      ruleStateOwners: {} as Record<string, string | null>,
    } as unknown as EncounterActor;
    // The recorded turn-start boundary drives the decision.
    const boundary = clockForTiming('turn-start')!;
    expect(refreshUsageLedgerForBoundary(actor, boundary)).toBe(true);
    expect(actor.ruleState['ledger:turn:g1']).toBeUndefined();
    // Round/combat gates survive a turn boundary.
    expect(actor.ruleState['ledger:round:g2']).toBe(3);
    expect(actor.ruleState['ledger:combat:g3']).toBe(true);
    expect(actor.ruleState['unrelated']).toBe(1);
  });

  it('the round-start boundary clears only ledger:round:* keys', () => {
    const actor = {
      id: 'a',
      ruleState: {
        'ledger:round:g': true,
        'ledger:turn:g': 2,
      } as Record<string, RuleStateValue>,
      ruleStateOwners: {} as Record<string, string | null>,
    } as unknown as EncounterActor;
    expect(refreshUsageLedgerForBoundary(actor, clockForTiming('round-start')!)).toBe(true);
    expect(actor.ruleState['ledger:round:g']).toBeUndefined();
    expect(actor.ruleState['ledger:turn:g']).toBe(2);
  });

  it('a non-refresh boundary (turn-end, combat-end) clears nothing', () => {
    const actor = {
      id: 'a',
      ruleState: { 'ledger:turn:g': true } as Record<string, RuleStateValue>,
      ruleStateOwners: {} as Record<string, string | null>,
    } as unknown as EncounterActor;
    expect(refreshUsageLedgerForBoundary(actor, clockForTiming('turn-end')!)).toBe(false);
    expect(actor.ruleState['ledger:turn:g']).toBe(true);
    expect(refreshUsageLedgerForBoundary(actor, clockForTiming('combat-end')!)).toBe(false);
    expect(actor.ruleState['ledger:turn:g']).toBe(true);
  });
});

describe('U8 — the lifecycle recipes consume the SAME authority (applies gate == body)', () => {
  it('the turn-ledger reset recipe participates exactly when the turn-start boundary refreshes a held turn ledger', () => {
    const actor = {
      id: 'a',
      ruleState: { 'ledger:turn:gate': true } as Record<string, RuleStateValue>,
    };
    // The applies precondition goes through U8: a turn-start boundary names the
    // turn period, and this actor holds a turn ledger.
    expect(usageLedgerHoldsForBoundary(actor, clockForTiming('turn-start')!)).toBe(true);
    // The same actor holding ONLY a round ledger is NOT refreshed by turn-start.
    const roundOnly = { id: 'a', ruleState: { 'ledger:round:gate': true } as Record<string, RuleStateValue> };
    expect(usageLedgerHoldsForBoundary(roundOnly, clockForTiming('turn-start')!)).toBe(false);
    expect(usageLedgerHoldsForBoundary(roundOnly, clockForTiming('round-start')!)).toBe(true);
    // A combat-only actor's ledger is never held by any reset boundary.
    const combatOnly = { id: 'a', ruleState: { 'ledger:combat:gate': true } as Record<string, RuleStateValue> };
    expect(usageLedgerHoldsForBoundary(combatOnly, clockForTiming('combat-end')!)).toBe(false);
    expect(usageLedgerHoldsForBoundary(combatOnly, clockForTiming('round-start')!)).toBe(false);
  });
});

describe('U8 — once-per-turn refreshes at the OWNER turn-start, once-per-round at the round boundary (integration + replay)', () => {
  it('turn gates reset on the owner’s OWN next turn, round gates at the round, combat gates never — replay byte-identical', () => {
    const { state, heroId, foeId } = ledgerFixture();
    const tKey = useLedgerKey('turn', 'fixture:gate');
    const rKey = useLedgerKey('round', 'fixture:gate');
    const cKey = useLedgerKey('combat', 'fixture:gate');

    // Drive the real command boundary, accumulating the recorded stream so a
    // byte-exact replay can be proven from the ORIGINAL pre-state.
    let current = state;
    let stream: EncounterEvent[] = [];
    const step = (result: { state: EncounterState; events: EncounterEvent[] }): void => {
      stream = [...stream, ...result.events];
      current = result.state;
    };

    // Consume all three periods of the hero's gate family as a recorded
    // RULE_MUTATIONS_APPLIED event (the command boundary owns the consume
    // decision; the mark rides the event for replay).
    const consumeEvent: EncounterEvent = { type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'fixture:ability', actionId: 'use', timing: 'use', tags: [], mutations: [
      consumeUseLedgerMutation('fixture:ability', heroId, 'turn', 'fixture:gate'),
      consumeUseLedgerMutation('fixture:ability', heroId, 'round', 'fixture:gate'),
      consumeUseLedgerMutation('fixture:ability', heroId, 'combat', 'fixture:gate'),
    ] };
    stream = [...stream, consumeEvent];
    current = applyEvents(state, [consumeEvent]);
    expect(useLedgerAvailable(current.actors[heroId], tKey)).toBe(false);
    expect(useLedgerAvailable(current.actors[heroId], rKey)).toBe(false);
    expect(useLedgerAvailable(current.actors[heroId], cKey)).toBe(false);

    // Foe's turn is the same round: nothing refreshes for the hero yet.
    step(executeCommand(current, { type: 'END_TURN', actorId: current.activeActorId! }, scriptedDice()));
    step(executeCommand(current, { type: 'TAKE_TURN', actorId: foeId }, scriptedDice()));
    expect(current.activeActorId).toBe(foeId);
    expect(useLedgerAvailable(current.actors[heroId], tKey)).toBe(false);
    expect(useLedgerAvailable(current.actors[heroId], rKey)).toBe(false);
    expect(useLedgerAvailable(current.actors[heroId], cKey)).toBe(false);

    // Hero takes its next turn → crosses round-start. Both the turn gate (its
    // OWN turn-start) and the round gate (round-start) refresh; combat stays.
    step(executeCommand(current, { type: 'END_TURN', actorId: current.activeActorId! }, scriptedDice()));
    step(executeCommand(current, { type: 'TAKE_TURN', actorId: heroId }, scriptedDice()));
    expect(current.round).toBe(2);
    expect(current.activeActorId).toBe(heroId);
    expect(useLedgerAvailable(current.actors[heroId], tKey)).toBe(true);
    expect(useLedgerAvailable(current.actors[heroId], rKey)).toBe(true);
    expect(useLedgerAvailable(current.actors[heroId], cKey)).toBe(false);

    // Replay: rebuild from the ORIGINAL pre-state with the FULL recorded
    // stream. applyEvents consumes recorded events (no fresh dice/decisions),
    // and the final durable ledger state must be DEEP-identical — the
    // boundaries' refresh decisions are reconstructed from recorded Clock data,
    // never re-decided.
    const replay = applyEvents(state, stream);
    expect(replay.actors[heroId].ruleState).toEqual(current.actors[heroId].ruleState);
    expect(replay.round).toBe(2);
  });
});