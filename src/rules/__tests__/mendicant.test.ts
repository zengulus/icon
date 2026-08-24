import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/** Source-derived Mendicant class-trait fixtures (ICON p.172). */
function mendicantEncounter(
  traits: readonly string[],
  allyPosition: Position = { x: 5, y: 1 },
  foePosition: Position = { x: 8, y: 8 },
  defeatedAlly = false,
) {
  let state = createEncounter('Mendicant trait fixture');
  const mendicant = actorFromCharacter(validCharacter('Mender'), { x: 1, y: 1 });
  mendicant.traitIds.push(...traits);
  const ally = actorFromCharacter(validCharacter('Patient'), allyPosition);
  const foe = createFoe('Witness', foePosition);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: mendicant }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (defeatedAlly) state = applyEvents(state, [{ type: 'ACTOR_DEFEATED', actorId: ally.id, woundGained: true }]);
  state = startEncounterTo(state, mendicant.id);
  return { state, mendicant, ally, foe };
}

function ruleMutations(events: ReturnType<typeof executeCommand>['events']) {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED');
  if (!event || event.type !== 'RULE_MUTATIONS_APPLIED') throw new Error('Expected a rule-mutation event.');
  return event.mutations;
}

function expectRuleCode(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected ${code}.`);
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('Mendicant class traits (ICON p.172)', () => {
  it('Bless costs one action, grants one Blessing to the selected in-range character, and replays exactly', () => {
    const source = findRuleSourceUnit('mendicant:trait:bless');
    expect(source).toMatchObject({
      source: { page: 172, sectionId: 'mendicant' },
      rulesText: '1 action: Grant a Blessing token to a character in range 4.',
    });
    expect(compileRuleSourceUnit(source!).unsupportedClauses).toEqual([]);

    const { state, mendicant, foe } = mendicantEncounter(['mendicant:trait:bless'], { x: 8, y: 8 }, { x: 5, y: 1 });
    // p.172 deliberately says "character", not ally: Bless does not impose
    // an unlicensed side restriction on the chosen, range-checked target.
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: mendicant.id,
      sourceId: 'mendicant:trait:bless',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice());

    expect(result.state.actors[mendicant.id].actionsRemaining).toBe(1);
    expect(result.state.actors[foe.id].resources.blessing).toBe(1);
    expect(ruleMutations(result.events)).toEqual([
      { kind: 'actions', sourceId: 'mendicant:trait:bless', actorId: mendicant.id, operation: 'spend', amount: 1 },
      { kind: 'resource', sourceId: 'mendicant:trait:bless', actorId: foe.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null },
    ]);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Bless requires an owned character target in range 4 before it spends its action', () => {
    const missingTarget = mendicantEncounter(['mendicant:trait:bless']);
    expectRuleCode(() => executeCommand(missingTarget.state, {
      type: 'EXECUTE_RULE', actorId: missingTarget.mendicant.id, sourceId: 'mendicant:trait:bless', actionId: 'default', timing: 'use', input: {},
    }, scriptedDice()), 'choice.actor-count');
    expect(missingTarget.state.actors[missingTarget.mendicant.id].actionsRemaining).toBe(2);

    const outOfRange = mendicantEncounter(['mendicant:trait:bless'], { x: 8, y: 8 }, { x: 6, y: 1 });
    expectRuleCode(() => executeCommand(outOfRange.state, {
      type: 'EXECUTE_RULE', actorId: outOfRange.mendicant.id, sourceId: 'mendicant:trait:bless', actionId: 'default', timing: 'use', input: {}, attackTargetId: outOfRange.foe.id,
    }, scriptedDice()), 'ability.range');
    expect(outOfRange.state.actors[outOfRange.mendicant.id].actionsRemaining).toBe(2);

    // A raw command cannot validate an in-range target and then smuggle a
    // different, out-of-range recipient through the generic input selector.
    const mismatchedTarget = mendicantEncounter(['mendicant:trait:bless'], { x: 6, y: 1 }, { x: 5, y: 1 });
    expectRuleCode(() => executeCommand(mismatchedTarget.state, {
      type: 'EXECUTE_RULE',
      actorId: mismatchedTarget.mendicant.id,
      sourceId: 'mendicant:trait:bless',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [mismatchedTarget.ally.id] } },
      attackTargetId: mismatchedTarget.foe.id,
    }, scriptedDice()), 'choice.actor-mismatch');
    expect(mismatchedTarget.state.actors[mismatchedTarget.mendicant.id].actionsRemaining).toBe(2);
    expect(mismatchedTarget.state.actors[mismatchedTarget.ally.id].resources.blessing ?? 0).toBe(0);
    expect(mismatchedTarget.state.actors[mismatchedTarget.foe.id].resources.blessing ?? 0).toBe(0);
  });

  it('Succor replaces only Rescue adjacency with source range 4 and replays exactly', () => {
    const source = findRuleSourceUnit('mendicant:trait:succor');
    expect(source).toMatchObject({
      source: { page: 172, sectionId: 'mendicant' },
      rulesText: 'Rescue may target a defeated ally in range 4 instead of only an adjacent ally.',
    });
    expect(compileRuleSourceUnit(source!).unsupportedClauses).toEqual([]);

    const withoutSuccor = mendicantEncounter([], { x: 5, y: 1 }, { x: 8, y: 8 }, true);
    expectRuleCode(() => executeCommand(withoutSuccor.state, {
      type: 'RESCUE', actorId: withoutSuccor.mendicant.id, targetId: withoutSuccor.ally.id,
    }, scriptedDice()), 'rescue.range');

    const withSuccor = mendicantEncounter(['mendicant:trait:succor'], { x: 5, y: 1 }, { x: 8, y: 8 }, true);
    const result = executeCommand(withSuccor.state, {
      type: 'RESCUE', actorId: withSuccor.mendicant.id, targetId: withSuccor.ally.id,
    }, scriptedDice());
    expect(result.events).toEqual([expect.objectContaining({
      type: 'ACTOR_RESCUED', actorId: withSuccor.mendicant.id, targetId: withSuccor.ally.id, restoredHp: 30,
    })]);
    expect(result.state.actors[withSuccor.mendicant.id].actionsRemaining).toBe(1);
    expect(result.state.actors[withSuccor.ally.id]).toMatchObject({ defeated: false, hp: 30, vigor: 0, statuses: [] });
    expect(applyEvents(withSuccor.state, result.events)).toEqual(result.state);

    const tooFar = mendicantEncounter(['mendicant:trait:succor'], { x: 6, y: 1 }, { x: 8, y: 8 }, true);
    expectRuleCode(() => executeCommand(tooFar.state, {
      type: 'RESCUE', actorId: tooFar.mendicant.id, targetId: tooFar.ally.id,
    }, scriptedDice()), 'rescue.range');
  });
});
