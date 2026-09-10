import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { choiceAnswerInput, resolveChoice, resolveChoiceAnswer } from '../automation/kernels/choice.js';
import { openDecisionWindow } from '../automation/kernels/decision-window.js';
import { EMPTY_BINDER } from '../automation/primitives/reference.js';
import type { RuleChoice, RuleChoiceAnswer, RuleExecutionContext, RuleExecutionInput } from '../automation/primitives/types.js';
import { executeFlowResume } from '../automation/kernels/execute-flow.js';
import { registerDecisionContinuation } from '../automation/kernels/continuation-runtime.js';
import { capturedActor } from '../automation/primitives/reference.js';
import { startEncounterTo, validCharacter } from './fixtures.js';

function fixture() {
  let state = createEncounter('Recorded choice parity');
  const hero = actorFromCharacter(validCharacter('Chooser'), { x: 1, y: 1 });
  const foe = createFoe('Candidate', { x: 2, y: 1 });
  for (const actor of [hero, foe]) state = executeCommand(state, { type: 'ADD_ACTOR', actor }).state;
  state = startEncounterTo(state, hero.id);
  const context: RuleExecutionContext = {
    state: encounterRuleState(state), encounterState: state, actorId: hero.id,
    sourceId: 'test:opaque', actionId: 'decision', timing: 'interrupt', input: {},
    dice: { die: () => { throw new Error('unexpected RNG'); } },
  };
  return { state, hero, foe, context };
}
const row = (kind: RuleChoice['kind'], required = true): RuleChoice => ({ kind, key: 'answer', label: 'Recorded answer', required });

function resultCode(fn: () => unknown): unknown {
  try { fn(); return 'accepted'; } catch (error) {
    expect(error).toHaveProperty('code');
    return (error as { code: string }).code;
  }
}

describe('U4 ↔ U13 durable answer contract', () => {
  it('records every kind without truncation or coercion and replays exact JSON events', () => {
    const { state, hero, foe, context } = fixture();
    const answers: RuleChoiceAnswer[] = [
      { kind: 'actors', ids: [foe.id, hero.id] },
      { kind: 'positions', positions: [{ x: 2, y: 2 }, { x: 3, y: 3 }] },
      { kind: 'direction', direction: { x: -2, y: 1 } },
      { kind: 'option', value: '' }, { kind: 'number', value: 0 },
      { kind: 'boolean', value: false }, { kind: 'ordering', ids: ['b', 'a'] },
    ];
    for (const answer of answers) {
      const before = structuredClone(state);
      const choice = { ...row(answer.kind), ...(answer.kind === 'ordering' ? { candidateIds: ['a', 'b'] } : {}) };
      if (answer.kind === 'ordering') {
        for (const id of ['a', 'b']) openDecisionWindow(before, { id, kind: 'uses-ability', actorId: hero.id });
      }
      const window = openDecisionWindow(before, { id: 'test:answer', kind: 'choice', actorId: hero.id, choice,
        resume: { remaining: [], binder: EMPTY_BINDER, continuationPoint: 'test' } });
      const input = choiceAnswerInput(choice.key, answer);
      const commandAnswer = resolveChoice(choice, { ...context, input });
      expect(resolveChoiceAnswer(choice, answer, context)).toEqual(commandAnswer);
      const result = executeCommand(before, { type: 'ANSWER_DECISION_WINDOW', windowId: window.id, input }, context.dice);
      const event = result.events.find(event => event.type === 'DECISION_ANSWERED');
      expect(event).toMatchObject({ decision: { key: choice.key, value: answer } });
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
      expect(applyEvents(before, JSON.parse(JSON.stringify(result.events)))).toEqual(result.state);
      if (answer.kind === 'ordering') {
        const legacy = JSON.parse(JSON.stringify(result.events));
        legacy.find((event: { type: string }) => event.type === 'DECISION_ANSWERED').decision.value = answer.ids;
        expect(applyEvents(before, legacy)).toEqual({ ...result.state, eventLog: [...before.eventLog, ...legacy] });
      }
      expect(before.decisionWindows.some(w => w.id === window.id)).toBe(true);
      expect(() => executeCommand(result.state, { type: 'ANSWER_DECISION_WINDOW', windowId: window.id, input }, context.dice)).toThrow();
    }
  });

  it.each(['actors', 'positions', 'direction', 'option', 'number', 'boolean', 'ordering'] as const)('%s optional absence records decline; required absence rejects identically', kind => {
    const { state, hero, context } = fixture();
    for (const required of [false, true]) {
      const choice = row(kind, required);
      const before = structuredClone(state);
      const window = openDecisionWindow(before, { id: 'optional', kind: 'choice', actorId: hero.id, choice,
        resume: { remaining: [], binder: EMPTY_BINDER, continuationPoint: 'test' } });
      const run = () => executeCommand(before, { type: 'ANSWER_DECISION_WINDOW', windowId: window.id }, context.dice);
      if (required) {
        expect(resultCode(run)).toBe(resultCode(() => resolveChoice(choice, context)));
        expect(before.decisionWindows).toHaveLength(1);
      } else {
        const result = run();
        expect(result.events[0]).toMatchObject({ decision: { value: resolveChoice(choice, context) } });
        expect(applyEvents(before, JSON.parse(JSON.stringify(result.events)))).toEqual(result.state);
      }
    }
  });

  it('rejects adversarial command/window inputs with identical U4 errors and no state changes', () => {
    const { state, hero, foe, context } = fixture();
    const cases: [RuleChoice, Record<string, unknown>][] = [
      [row('actors'), { actorIds: { answer: ['missing'] } }],
      [{ ...row('actors'), relation: 'foe' }, { actorIds: { answer: [hero.id] } }],
      [row('actors'), { actorIds: { answer: [foe.id, foe.id] } }],
      [row('actors'), { actorIds: { answer: 'not-a-list' } }],
      [row('positions'), { positions: { answer: [{ x: -1, y: 2 }] } }],
      [{ ...row('positions'), range: { kind: 'constant', value: 1 } }, { positions: { answer: [{ x: 5, y: 5 }] } }],
      [row('positions'), { positions: { answer: [{ x: 1.5, y: 2 }] } }],
      [row('direction'), { directions: { answer: { x: 0, y: 0 } } }],
      [row('direction'), { directions: { answer: { x: Infinity, y: 0 } } }],
      [{ ...row('option'), options: ['allowed'] }, { options: { answer: 'foreign' } }],
      [row('option', false), { options: { answer: 0 } }],
      [{ ...row('number'), maximum: 2 }, { numbers: { answer: 3 } }],
      [row('number', false), { numbers: { answer: NaN } }],
      [row('boolean', false), { booleans: { answer: 'false' } }],
      [{ ...row('ordering'), candidateIds: ['a', 'b'] }, { actorIds: { answer: ['a', 'foreign'] } }],
    ];
    for (const [choice, raw] of cases) {
      const before = structuredClone(state);
      openDecisionWindow(before, { id: 'adversarial', kind: 'choice', actorId: hero.id, choice,
        resume: { remaining: [], binder: EMPTY_BINDER, continuationPoint: 'test' } });
      const snapshot = structuredClone(before);
      const input = raw as RuleExecutionInput;
      const commandCode = resultCode(() => resolveChoice(choice, { ...context, input }));
      expect(commandCode).not.toBe('accepted');
      expect(resultCode(() => executeCommand(before, { type: 'ANSWER_DECISION_WINDOW', windowId: 'adversarial', input }, context.dice))).toBe(commandCode);
      expect(before).toEqual(snapshot);
    }
  });
  it('held continuations receive complete typed lists and skip optional declines; replay never invokes the resolver', () => {
    const { state, hero, foe, context } = fixture();
    let calls = 0;
    let received: RuleChoiceAnswer | undefined;
    const choice = row('actors', false);
    registerDecisionContinuation({ programId: 'test:recorded-list', choice, consume: () => [],
      resolve: (_state, continuation) => {
        calls++;
        received = continuation.choiceAnswer;
        return [{ kind: 'state', sourceId: 'test:recorded-list', sourceActorId: hero.id, operation: 'set', actorId: hero.id, key: 'recorded-list', value: JSON.stringify(received) }];
      },
    });
    openDecisionWindow(state, { id: 'held', kind: 'choice', actorId: hero.id, choice,
      heldPayload: { id: 'held:payload', programId: 'test:recorded-list', ownerRef: capturedActor(hero.id), refs: [],
        trigger: { kind: 'window', windowId: 'held' }, payload: { kind: 'deferred-rule' } },
    });
    const snapshot = structuredClone(state);
    const declined = executeCommand(state, { type: 'ANSWER_DECISION_WINDOW', windowId: 'held' }, context.dice);
    expect(calls).toBe(0);
    expect(declined.events[0]).toMatchObject({ decision: { value: { kind: 'actors', ids: [] } }, mutations: [] });
    const accepted = executeCommand(state, { type: 'ANSWER_DECISION_WINDOW', windowId: 'held', input: { actorIds: { answer: [hero.id, foe.id] } } }, context.dice);
    expect(received).toEqual({ kind: 'actors', ids: [hero.id, foe.id] });
    expect(calls).toBe(1);
    expect(state).toEqual(snapshot);
    expect(applyEvents(state, JSON.parse(JSON.stringify(accepted.events)))).toEqual(accepted.state);
    expect(calls).toBe(1);
  });

  it('explicit boolean false reaches the held-continuation resolver; only optional absence skips it', () => {
    const { state, hero, context } = fixture();
    let calls = 0;
    const received: (RuleChoiceAnswer | undefined)[] = [];
    const choice = row('boolean', false);
    registerDecisionContinuation({ programId: 'test:recorded-boolean', choice, consume: () => [],
      resolve: (_state, continuation) => {
        calls++;
        received.push(continuation.choiceAnswer);
        return [{ kind: 'state', sourceId: 'test:recorded-boolean', sourceActorId: hero.id, operation: 'set', actorId: hero.id, key: 'recorded-boolean', value: JSON.stringify(continuation.choiceAnswer) }];
      },
    });
    openDecisionWindow(state, { id: 'held-boolean', kind: 'choice', actorId: hero.id, choice,
      heldPayload: { id: 'held:boolean-payload', programId: 'test:recorded-boolean', ownerRef: capturedActor(hero.id), refs: [],
        trigger: { kind: 'window', windowId: 'held-boolean' }, payload: { kind: 'deferred-rule' } },
    });
    // The explicit no answer is a supplied value: it reaches the resolver,
    // and the ROW owns the consequence (here: the recorded marker mutation).
    const explicitFalse = executeCommand(state, { type: 'ANSWER_DECISION_WINDOW', windowId: 'held-boolean', input: { booleans: { answer: false } } }, context.dice);
    expect(calls).toBe(1);
    expect(received[0]).toEqual({ kind: 'boolean', value: false });
    expect(explicitFalse.events[0]).toMatchObject({ decision: { value: { kind: 'boolean', value: false } } });
    expect(applyEvents(state, JSON.parse(JSON.stringify(explicitFalse.events)))).toEqual(explicitFalse.state);
    // Genuine optional absence stays dispatcher-owned: decline records, the
    // resolver never runs, and no consequence applies.
    openDecisionWindow(explicitFalse.state, { id: 'held-boolean-absent', kind: 'choice', actorId: hero.id, choice,
      heldPayload: { id: 'held:boolean-payload-absent', programId: 'test:recorded-boolean', ownerRef: capturedActor(hero.id), refs: [],
        trigger: { kind: 'window', windowId: 'held-boolean-absent' }, payload: { kind: 'deferred-rule' } },
    });
    const absent = executeCommand(explicitFalse.state, { type: 'ANSWER_DECISION_WINDOW', windowId: 'held-boolean-absent' }, context.dice);
    expect(calls).toBe(1);
    expect(absent.events[0]).toMatchObject({ decision: { value: { kind: 'boolean', value: null } }, mutations: [] });
    expect(applyEvents(explicitFalse.state, JSON.parse(JSON.stringify(absent.events)))).toEqual(absent.state);
  });

  it('flow resume uses the recorded actor list and clears ambient input on decline', () => {
    const { hero, foe, context } = fixture();
    const resume = { binder: EMPTY_BINDER, remaining: [{ kind: 'apply' as const, effect: {
      kind: 'damage' as const, target: { kind: 'input' as const, key: 'answer', relation: 'any' as const },
      amount: { kind: 'constant' as const, value: 2 }, damageType: 'normal' as const, delivery: 'effect' as const,
    } }] };
    const ambient = { ...context, input: { actorIds: { answer: [hero.id] }, options: { answer: 'stale' } } };
    const accepted = executeFlowResume(resume, ambient, { decision: { key: 'answer', value: { kind: 'actors', ids: [foe.id] } } });
    expect(accepted.mutations).toMatchObject([{ kind: 'damage', actorId: foe.id }]);
    const declined = executeFlowResume(resume, ambient, { decision: { key: 'answer', value: { kind: 'actors', ids: [] } } });
    expect(declined.mutations).toEqual([]);
    expect(ambient.input.actorIds.answer).toEqual([hero.id]);
  });

  it('tagged answers reject truncation, missing payloads, wrong kinds, and malformed values through U4', () => {
    const { context } = fixture();
    const truncated: [RuleChoice, RuleChoiceAnswer][] = [
      [row('number', false), { kind: 'number' } as RuleChoiceAnswer],
      [row('option', false), { kind: 'option' } as RuleChoiceAnswer],
      [row('boolean', false), { kind: 'boolean' } as RuleChoiceAnswer],
      [row('direction', false), { kind: 'direction' } as RuleChoiceAnswer],
      [row('actors', false), { kind: 'actors', ids: 'not-a-list' } as unknown as RuleChoiceAnswer],
      [row('positions', false), { kind: 'positions', positions: 'not-a-list' } as unknown as RuleChoiceAnswer],
    ];
    for (const [choice, answer] of truncated) {
      // The projection rejects a truncated answer before U4: a missing bucket
      // must never misread truncation as optional absence (decline).
      expect(resultCode(() => resolveChoiceAnswer(choice, answer, context))).toBe('choice.answer-invalid');
    }
    for (const answer of [{ kind: 'number' }, { kind: 'number', value: NaN }, { kind: 'number', value: '1' }, { kind: 'boolean', value: true }]) {
      expect(resultCode(() => resolveChoiceAnswer(row('number', false), answer as RuleChoiceAnswer, context))).not.toBe('accepted');
    }
  });

});
