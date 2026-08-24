import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { applyEvents, createEncounter, createFoe, actorFromCharacter, executeCommand } from '../encounter.js';
import {
  consumeUseLedgerMutation,
  holdsUseLedgerKey,
  useLedgerAvailable,
  useLedgerKey,
  type UseLedgerPeriod,
} from '../automation/kernels/use-ledger.js';
import { roundLedgerKey } from '../automation/kernels/trait-reactions.js';
import type { EncounterState } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Use-ledger kernel tests (docs/rules-foundations.md non-glossary foundation
 * #8) — the source-ID-free usage-gate family:
 *
 * - once-per-turn holds a durable `ledger:turn:<sourceId>` flag that the
 *   actor's own turn-start boundary resets;
 * - once-per-round holds the identical durable key F9's reactive fold writes
 *   (`ledger:round:<sourceId>`), reset at the round boundary — the shared
 *   gate and F9 can never drift;
 * - once-per-combat stays spent until the encounter ends (no reset boundary).
 *
 * The decision is made once at the command boundary and the mark rides the
 * ability's recorded event as a `state` mutation, so replay applies exactly
 * what the command decided and never re-decides whether the gate was open.
 */

const ledgerFixture = (): { state: EncounterState; heroId: string; foeId: string } => {
  let state = createEncounter('Use-ledger fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  const foe = createFoe('Relict', { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, heroId: hero.id, foeId: foe.id };
};

describe('use-ledger: key contract', () => {
  it('builds the durable per-period keys with the period scoping the source', () => {
    expect(useLedgerKey('turn', 'fixture:gate')).toBe('ledger:turn:fixture:gate');
    expect(useLedgerKey('round', 'fixture:gate')).toBe('ledger:round:fixture:gate');
    expect(useLedgerKey('combat', 'fixture:gate')).toBe('ledger:combat:fixture:gate');
  });

  it('the round key is byte-identical to the F9 reactive fold key', () => {
    expect(useLedgerKey('round', 'fixture:reaction')).toBe(roundLedgerKey('fixture:reaction'));
  });

  it('the consume mutation sets the durable key on the actor', () => {
    const mutation = consumeUseLedgerMutation('fixture:ability', 'actor:hero', 'turn', 'fixture:gate');
    expect(mutation).toEqual({
      kind: 'state',
      sourceId: 'fixture:ability',
      sourceActorId: 'actor:hero',
      actorId: 'actor:hero',
      key: 'ledger:turn:fixture:gate',
      operation: 'set',
      value: true,
    });
  });

  it('availability and holds reflect the flag state', () => {
    const actor = { ruleState: {} as Record<string, boolean> };
    expect(useLedgerAvailable(actor, 'ledger:round:fixture:gate')).toBe(true);
    expect(holdsUseLedgerKey(actor, 'round')).toBe(false);
    actor.ruleState['ledger:round:fixture:gate'] = true;
    expect(useLedgerAvailable(actor, 'ledger:round:fixture:gate')).toBe(false);
    expect(holdsUseLedgerKey(actor, 'round')).toBe(true);
    // Different period prefix never leaks.
    expect(holdsUseLedgerKey(actor, 'turn')).toBe(false);
  });
});

describe('use-ledger: once-per-turn resets at the turn boundary', () => {
  it('a consumed turn gate rejects a second use while active, then resets on the actor\\u2019s next turn', () => {
    const { state, heroId, foeId } = ledgerFixture();
    // Simulate the command boundary consuming the gate: the mark rides the
    // recorded event as a durable state mutation.
    const consumed = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'fixture:ability', actionId: 'use', timing: 'use', tags: [], mutations: [consumeUseLedgerMutation('fixture:ability', heroId, 'turn', 'fixture:once-per-turn')] }]);
    expect(useLedgerAvailable(consumed.actors[heroId], 'ledger:turn:fixture:once-per-turn')).toBe(false);
    expect(holdsUseLedgerKey(consumed.actors[heroId], 'turn')).toBe(true);

    // Second use on the same turn is rejected by the same durable flag the
    // gate would read (the gate is a read of this exact key).
    const gateCheck = useLedgerAvailable(consumed.actors[heroId], 'ledger:turn:fixture:once-per-turn');
    expect(gateCheck).toBe(false);

    // End the hero's turn; the foe acts; when the turn comes back around to
    // the hero, the turn-start lifecycle recipe clears the flag.
    const foeTurn = executeCommand(consumed, { type: 'END_TURN', actorId: heroId }, scriptedDice());
    expect(foeTurn.state.activeActorId).toBe(foeId);
    expect(holdsUseLedgerKey(foeTurn.state.actors[heroId], 'turn')).toBe(true); // untouched mid-round
    const heroTurn = executeCommand(foeTurn.state, { type: 'END_TURN', actorId: foeId }, scriptedDice());
    expect(heroTurn.state.activeActorId).toBe(heroId);
    expect(holdsUseLedgerKey(heroTurn.state.actors[heroId], 'turn')).toBe(false); // reset at own turn start
    expect(useLedgerAvailable(heroTurn.state.actors[heroId], 'ledger:turn:fixture:once-per-turn')).toBe(true);
  });
});

describe('use-ledger: once-per-round preserves the F9 round boundary', () => {
  it('a consumed round gate stays spent through the turn boundary and resets at the round boundary', () => {
    const { state, heroId, foeId } = ledgerFixture();
    const consumed = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'fixture:ability', actionId: 'use', timing: 'use', tags: [], mutations: [consumeUseLedgerMutation('fixture:ability', heroId, 'round', 'fixture:once-per-round')] }]);
    expect(useLedgerAvailable(consumed.actors[heroId], 'ledger:round:fixture:once-per-round')).toBe(false);

    // The hero's own next turn is still the same round: the gate stays spent.
    const heroTurnAgain = executeCommand(consumed, { type: 'END_TURN', actorId: heroId }, scriptedDice());
    expect(heroTurnAgain.state.activeActorId).toBe(foeId);
    const roundTwo = executeCommand(heroTurnAgain.state, { type: 'END_TURN', actorId: foeId }, scriptedDice());
    expect(roundTwo.state.round).toBe(2);
    // The round-start lifecycle recipe reset every actor's round ledger.
    expect(useLedgerAvailable(roundTwo.state.actors[heroId], 'ledger:round:fixture:once-per-round')).toBe(true);
    expect(holdsUseLedgerKey(roundTwo.state.actors[heroId], 'round')).toBe(false);
  });
});

describe('use-ledger: once-per-combat stays spent', () => {
  it('a consumed combat gate survives both turn and round boundaries until the encounter ends', () => {
    const { state, heroId, foeId } = ledgerFixture();
    const consumed = applyEvents(state, [{ type: 'RULE_MUTATIONS_APPLIED', actorId: heroId, sourceId: 'fixture:ability', actionId: 'use', timing: 'use', tags: [], mutations: [consumeUseLedgerMutation('fixture:ability', heroId, 'combat', 'fixture:once-per-combat')] }]);
    expect(useLedgerAvailable(consumed.actors[heroId], 'ledger:combat:fixture:once-per-combat')).toBe(false);

    // Two full turn cycles (through the round boundary) leave the combat gate spent.
    let current = consumed;
    for (const ending of [heroId, foeId, heroId, foeId]) {
      current = executeCommand(current, { type: 'END_TURN', actorId: ending }, scriptedDice()).state;
    }
    expect(current.round).toBe(3);
    expect(useLedgerAvailable(current.actors[heroId], 'ledger:combat:fixture:once-per-combat')).toBe(false);
    expect(holdsUseLedgerKey(current.actors[heroId], 'combat')).toBe(true);
    // No lifecycle phase clears it (only the turn/round recipes exist).
    expect(holdsUseLedgerKey(current.actors[heroId], 'turn')).toBe(false);
    expect(holdsUseLedgerKey(current.actors[heroId], 'round')).toBe(false);
  });

  it('the per-period keys never collide: distinct gates of every period stay independently available, and replay reproduces the exact state', () => {
    const periods: UseLedgerPeriod[] = ['turn', 'round', 'combat'];
    const { state, heroId } = ledgerFixture();
    const events = periods.map((period) => ({ type: 'RULE_MUTATIONS_APPLIED' as const, actorId: heroId, sourceId: 'fixture:ability', actionId: 'use', timing: 'use' as const, tags: [] as string[], mutations: [consumeUseLedgerMutation('fixture:ability', heroId, period, `fixture:gate-${period}`)] }));
    const current = applyEvents(state, events);
    expect(useLedgerAvailable(current.actors[heroId], 'ledger:turn:fixture:gate-turn')).toBe(false);
    expect(useLedgerAvailable(current.actors[heroId], 'ledger:round:fixture:gate-round')).toBe(false);
    expect(useLedgerAvailable(current.actors[heroId], 'ledger:combat:fixture:gate-combat')).toBe(false);
    // Replay: applying the same recorded events to the original state reproduces the exact state.
    expect(applyEvents(state, events)).toEqual(current);
  });
});
