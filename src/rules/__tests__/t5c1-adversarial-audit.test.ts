import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand, migrateEncounter } from '../encounter.js';
import type { CommandResult, DecisionWindowRecord, EncounterActor, EncounterEvent, EncounterState, Position } from '../types.js';
import { ENCOUNTER_SCHEMA_VERSION } from '../types.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { armContinuation, clockObservationForBoundary, continuationDue, heldDamageContinuation, resumeContinuation, type ArmedContinuation } from '../automation/primitives/continuation.js';
import { EMPTY_BINDER, capturedActor, capturedPosition, liveRef, resolveReference } from '../automation/primitives/reference.js';
import { nextWindowId, openDecisionWindow, orderDecisionWindows, popDecisionWindowStack, windowHeldDamage } from '../automation/kernels/decision-window.js';
import { registerContinuationResolver, resumeDueContinuations } from '../automation/kernels/continuation-runtime.js';
import { executeFlow, executeFlowResume } from '../automation/kernels/execute-flow.js';
import type { FlowNode } from '../automation/kernels/execute-flow.js';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import { endTurnOnly, endTurnTo, scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * T5c.1 — adversarial audit of T5a–T5c as ONE composed system. Every case
 * below encodes a demanded regression from the T5c.1 task list; where the
 * composed-system invariant spans layers the case exercises the real command
 * / reducer / window path, not a helper in isolation.
 */

interface T5Fixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally: EncounterActor | null;
}

function t5Encounter(options: { foe?: Position; ally?: Position | null } = {}): T5Fixture {
  let state = createEncounter('T5c.1 fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, ally };
}

const damageEvent = (sourceActorId: string, actorId: string, amount: number): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:foe-attack',
  actionId: 'default',
  timing: 'use',
  tags: ['attack'],
  mutations: [{ kind: 'damage', sourceId: 'fixture:foe-attack', sourceActorId, actorId, amount, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
});

const answerWindow = (state: EncounterState, windowId: string, input: Record<string, unknown>): CommandResult =>
  executeCommand(state, { type: 'ANSWER_DECISION_WINDOW', windowId, input }, scriptedDice());

/** The canonical turn-end boundary ref (turn span, end edge). */
const turnEnd = () => clockObservationForBoundary({ kind: 'boundary', boundary: 'turn', edge: 'end' });

/** A choice window on a pure `suspend` gate (no held payload/resolver), so a
 * synthetic choice can be validated through the real ANSWER_DECISION_WINDOW
 * boundary without content rows. */
function openChoiceWindow(state: EncounterState, actorId: string, choice: { key: string; label: string; kind: 'boolean' | 'number' | 'option' | 'actors' | 'positions' | 'direction'; required: boolean; options?: string[]; minimum?: number; maximum?: number }): DecisionWindowRecord {
  return openDecisionWindow(state, {
    id: `test:choice:${choice.key}`,
    kind: 'choice',
    actorId,
    choice,
    resume: { remaining: [], binder: EMPTY_BINDER, continuationPoint: 'test' },
  });
}

/** A dice source that THROWS if any RNG is consumed — replay must never
 * roll. */
const throwingDice = () => {
  throw new Error('replay consumed RNG');
};

describe('T5c.1 H3 — the window-answer boundary validates; omission is never a silent default', () => {
  it('an omitted REQUIRED boolean answer rejects; an explicit false records a legal decline', () => {
    const { state, hero, foe } = t5Encounter({ foe: { x: 4, y: 1 } });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const window = ended.decisionWindows.find((candidate) => candidate.kind === 'choice');
    expect(window).toBeDefined();
    // Omission is NOT a decision: the required boolean must be answered.
    expect(() => answerWindow(ended, window!.id, {})).toThrow(/requires a yes\/no answer/);
    // Malformed input is not interpreted as a decline either.
    expect(() => answerWindow(ended, window!.id, { booleans: { rush: 'maybe' } })).toThrow();
    // An explicit false is a valid recorded decline.
    const declined = answerWindow(ended, window!.id, { booleans: { rush: false } });
    expect(declined.state.decisionWindows).toHaveLength(0);
    expect(declined.state.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    // The recorded decision carries the EXPLICIT value; replay consumes it.
    const answeredEvent = declined.events.find((event) => event.type === 'DECISION_ANSWERED');
    expect(answeredEvent).toMatchObject({ decision: { key: 'rush', value: false } });
    expect(applyEvents(ended, declined.events)).toEqual(declined.state);
  });

  it('invalid option / number / actor / position / direction answers reject rather than becoming empty sentinels', () => {
    let state = createEncounter('Choice validation');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);

    // option: membership is enforced.
    const optionWindow = openChoiceWindow(state, hero.id, { key: 'mode', label: 'Mode', kind: 'option', required: true, options: ['a', 'b'] });
    expect(() => answerWindow(state, optionWindow.id, { options: { mode: 'c' } })).toThrow(/not one of/);
    expect(() => answerWindow(state, optionWindow.id, {})).toThrow(/requires a chosen option/);

    // number: bounds are enforced; omission rejects.
    const numberWindow = openChoiceWindow(state, hero.id, { key: 'n', label: 'N', kind: 'number', required: true, minimum: 1, maximum: 3 });
    expect(() => answerWindow(state, numberWindow.id, { numbers: { n: 0 } })).toThrow(/at least 1/);
    expect(() => answerWindow(state, numberWindow.id, { numbers: { n: 4 } })).toThrow(/at most 3/);
    expect(() => answerWindow(state, numberWindow.id, {})).toThrow(/requires a numeric value/);
    expect(() => answerWindow(state, numberWindow.id, { numbers: { n: 2 } })).not.toThrow();

    // actors: candidate legality routes through the shared U3 authority —
    // an unknown/defeated actor is rejected, never recorded as ''.
    const actorWindow = openChoiceWindow(state, hero.id, { key: 'target', label: 'Target', kind: 'actors', required: true });
    expect(() => answerWindow(state, actorWindow.id, { actorIds: { target: ['no-such-actor'] } })).toThrow();
    expect(() => answerWindow(state, actorWindow.id, {})).toThrow(/requires a chosen target/);

    // positions: out-of-grid rejects; omission rejects.
    const positionWindow = openChoiceWindow(state, hero.id, { key: 'spot', label: 'Spot', kind: 'positions', required: true });
    expect(() => answerWindow(state, positionWindow.id, { positions: { spot: [{ x: -1, y: 0 }] } })).toThrow(/outside the battlefield/);
    expect(() => answerWindow(state, positionWindow.id, {})).toThrow(/requires a chosen position/);

    // direction: (0,0) is not a direction.
    const directionWindow = openChoiceWindow(state, hero.id, { key: 'dir', label: 'Dir', kind: 'direction', required: true });
    expect(() => answerWindow(state, directionWindow.id, { directions: { dir: { x: 0, y: 0 } } })).toThrow(/cannot be \(0,0\)/);
    expect(() => answerWindow(state, directionWindow.id, { directions: { dir: { x: 1, y: 0 } } })).not.toThrow();
  });
});

describe('T5c.1 H1 — trigger identity is the exact causal instance', () => {
  it('two same-kind facts with different instanceIds cannot wake each other\'s continuations', () => {
    const state = createEncounter('fact identity');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const continuation = armContinuation({
      id: 'fact:test:a',
      programId: 'fixture:fact-rule',
      ownerRef: capturedActor(hero.id),
      trigger: { kind: 'fact', factKind: 'damage-applied', instanceId: 'inst-a' },
      payload: { kind: 'deferred-rule', resumeId: 'fixture:fact-rule' },
    });
    const now = turnEnd();
    const fact = (instanceId: string) => ({ kind: 'damage-applied' as const, instanceId, sourceId: 'fixture:fact-rule', ownerId: 'actor:1', recipientId: 'actor:1', amount: 1, delivery: 'hit' as const });
    // A same-kind fact with a DIFFERENT instance id is not the trigger.
    expect(continuationDue(continuation, now, [fact('inst-b')])).toBe(false);
    // The exact causal instance satisfies it.
    expect(continuationDue(continuation, now, [fact('inst-a')])).toBe(true);
    // resumeContinuation agrees (the pure decision, no execution).
    expect(resumeContinuation(continuation, now, [fact('inst-b')])).toMatchObject({ ok: false });
    expect(resumeContinuation(continuation, now, [fact('inst-a')])).toMatchObject({ ok: true });
  });

  it('a window-gated held result can never auto-fire from a coarse same-kind fact', () => {
    const state = createEncounter('window gate');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const held = heldDamageContinuation({
      id: 'held:test:1',
      programId: 'fixture:held-damage',
      ownerActorId: hero.id,
      targetId: hero.id,
      amount: 4,
      damageType: 'normal',
      sourceActorId: 'foe:1',
      sourceId: 'fixture:foe-attack',
      instance: 1,
      delivery: 'hit',
      ignoreCover: false,
      windowId: 'when-damaged:actor:1:0',
    });
    const now = turnEnd();
    // Even a same-kind fact (the old fake seam) can never satisfy a window
    // trigger — the boundary gate is structurally closed.
    const coarseFact = { kind: 'damage-applied' as const, instanceId: 'x', sourceId: 'fixture:foe-attack', ownerId: 'actor:1', recipientId: 'actor:1', amount: 4, delivery: 'hit' as const };
    expect(continuationDue(held, now, [coarseFact])).toBe(false);
    expect(continuationDue(held, now, [])).toBe(false);
    expect(held.trigger).toEqual({ kind: 'window', windowId: 'when-damaged:actor:1:0' });
  });
});

describe('T5c.1 H4 — ordering: one authority, no invented tie-breaks', () => {
  it('same-owner simultaneous windows are a RECORDED ordering decision, never a lexicographic kind order (T6.2)', () => {
    const { state, hero } = t5Encounter({});
    // Both owned by the SAME character (the hero): with different trigger
    // kinds at the same instant there is no source-defined total order, and
    // p.107 grants the OWNER the ordering choice — a recorded decision, never
    // a kind-name sort. Without a recorded order the projection rejects with
    // the decision-required error (the seam is `openOrderingDecisionWindow`).
    const heroWindow = { id: 'h', kind: 'when-damaged' as const, actorId: hero.id, triggeredAt: 7, order: 0 } as DecisionWindowRecord;
    const saveWindow = { id: 's', kind: 'save-rolled' as const, actorId: hero.id, triggeredAt: 7, order: 1 } as DecisionWindowRecord;
    expect(() => orderDecisionWindows(state, hero.id, [saveWindow, heroWindow])).toThrow(/decision-required/);
    // With a RECORDED order the projection consumes exactly it.
    const orderedWindows = orderDecisionWindows(state, hero.id, [
      { ...saveWindow, resolvedOrder: 0 },
      { ...heroWindow, resolvedOrder: 1 },
    ]);
    expect(orderedWindows.map((window) => window.id)).toEqual(['s', 'h']);
    const reversed = orderDecisionWindows(state, hero.id, [
      { ...saveWindow, resolvedOrder: 1 },
      { ...heroWindow, resolvedOrder: 0 },
    ]);
    expect(reversed.map((window) => window.id)).toEqual(['h', 's']);
  });

  it('same-instant same-side windows with DIFFERENT owners have no single chooser and stay unrepresentable', () => {
    const { state, hero, ally } = t5Encounter({ ally: { x: 3, y: 1 } });
    // Same side, same instant, DIFFERENT owners (the hero and an ally): no
    // single character owns both effects, so p.107 grants nobody the choice;
    // the projection must reject — never a kind-name sort, never a same-owner
    // decision.
    const heroWindow = { id: 'h', kind: 'when-damaged' as const, actorId: hero.id, triggeredAt: 7, order: 0 } as DecisionWindowRecord;
    const allyWindow = { id: 'a', kind: 'save-rolled' as const, actorId: ally!.id, triggeredAt: 7, order: 1 } as DecisionWindowRecord;
    expect(() => orderDecisionWindows(state, hero.id, [allyWindow, heroWindow])).toThrow(/ordering-unrepresentable/);
  });

  it('same-instant same-owner ambiguity fails closed instead of using registration order', () => {
    const { state, hero } = t5Encounter({});
    const first = { id: 'a', kind: 'when-damaged' as const, actorId: hero.id, triggeredAt: 7, order: 0, heldPayload: { id: 'p-a' } } as unknown as DecisionWindowRecord;
    const second = { id: 'b', kind: 'when-damaged' as const, actorId: hero.id, triggeredAt: 7, order: 1, heldPayload: { id: 'p-b' } } as unknown as DecisionWindowRecord;
    state.decisionWindows.push(first, second);
    // p.107 grants the OWNER the ordering right — a recorded decision, never
    // the registration `order`. The engine rejects instead of substituting.
    expect(() => popDecisionWindowStack(state, hero.id, true)).toThrow(/ambiguous-order/);
  });

  it('permuting state.continuations cannot alter the U17-observable resume order', () => {
    // Register a fixture resolver whose emitted mutations are observable.
    const marks: string[] = [];
    registerContinuationResolver({
      programId: 'fixture:order-rule',
      resolve: (_state, continuation) => {
        marks.push(continuation.id);
        return [];
      },
    });
    const arm = (id: string): ArmedContinuation => armContinuation({
      id,
      programId: 'fixture:order-rule',
      ownerRef: capturedActor('actor:1'),
      trigger: { kind: 'clock', clock: { kind: 'boundary', boundary: 'turn', edge: 'end' } },
      payload: { kind: 'deferred-rule', resumeId: 'fixture:order-rule' },
    });
    const run = (order: ArmedContinuation[]) => {
      const state = createEncounter('resume order');
      state.continuations = [...order];
      marks.length = 0;
      resumeDueContinuations(state, turnEnd(), []);
      return [...marks];
    };
    const first = arm('order:first');
    const second = arm('order:second');
    // Permuting the durable collection cannot change the recorded
    // ordering-identity resume sequence.
    expect(run([first, second])).toEqual(run([second, first]));
  });
});

describe('T5c.1 H6 — window identity is durable and never reused', () => {
  it('closing a window cannot let a later window reuse its durable id in the same revision', () => {
    const { state, hero } = t5Encounter({});
    const firstId = nextWindowId(state, 'when-damaged', hero.id);
    openDecisionWindow(state, { id: firstId, kind: 'when-damaged', actorId: hero.id });
    // Close it (collection length drops, but the serial never rewinds).
    state.decisionWindows = state.decisionWindows.filter((window) => window.id !== firstId);
    const secondId = nextWindowId(state, 'when-damaged', hero.id);
    expect(secondId).not.toBe(firstId);
    // Both ids exist in the encounter's id space without collision.
    openDecisionWindow(state, { id: secondId, kind: 'when-damaged', actorId: hero.id });
    expect(state.decisionWindows.map((window) => window.id)).toEqual([secondId]);
  });

  it('two open windows never share an id; the serial is monotonic per revision', () => {
    const { state, hero } = t5Encounter({});
    const ids = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      const id = nextWindowId(state, 'when-damaged', hero.id);
      ids.add(id);
      openDecisionWindow(state, { id, kind: 'when-damaged', actorId: hero.id });
    }
    expect(ids.size).toBe(5);
    expect(state.windowSerial).toBe(5);
  });
});

describe('T5c.1 H2 — the held-result boundary: exact determination, never recomputation', () => {
  it('Righteous Disdain holds damage determined against the ALLY\'s mitigation — the owner\'s defenses are irrelevant', () => {
    const { state, hero, foe, ally } = t5Encounter({ foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 } });
    // Divergent defenses: the ALLY has armor 1 (determined 19), the OWNER
    // has armor 5 and 3 vigor — neither may re-mitigate the held blow.
    state.actors[ally!.id].armor = 1;
    state.actors[hero.id].armor = 5;
    state.actors[hero.id].vigor = 3;
    const damaged = applyEvents(state, [damageEvent(foe.id, ally!.id, 20)]);
    const window = damaged.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'when-damaged');
    expect(window).toBeDefined();
    // The held amount is the ALLY-determined 19 (20 - ally armor 1), frozen.
    expect(windowHeldDamage(window!)).toMatchObject({ amount: 19, targetId: ally!.id });
    // The drain applies exactly 19 to the ALLY; the owner's armor 5 / vigor 3
    // never touched the blow.
    const ended = endTurnTo(damaged, foe.id, scriptedDice());
    expect(ended.actors[ally!.id].hp).toBe(21); // 40 - 19
    expect(ended.actors[hero.id].hp).toBe(40);
    expect(ended.actors[hero.id].vigor).toBe(3);
  });

  it('the owner is DISTINCT from the damaged character: direct damage to the owner opens no RD window', () => {
    const { state, hero, foe } = t5Encounter({ foe: { x: 4, y: 1 } });
    // The hero is the only character with Righteous Disdain. Per p.128 the
    // trigger is damage to an ALLY of the owner — the owner answering for
    // their own blow is not the trigger. The blow applies directly.
    const damaged = applyEvents(state, [damageEvent(foe.id, hero.id, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.kind === 'when-damaged' && candidate.actorId === hero.id && candidate.heldPayload !== undefined)).toBe(false);
    expect(damaged.actors[hero.id].hp).toBe(38); // 40 - (4 - armor 2) = 38
  });

  it('an ally beyond the interrupt\'s declared Range 2 does not open the owner\'s window', () => {
    const { state, hero, foe, ally } = t5Encounter({ foe: { x: 4, y: 1 }, ally: { x: 4, y: 2 } });
    // Distance hero(1,1) → ally(4,2) is 3 — outside p.128 Range 2. The
    // trigger's range relationship is unsatisfied: no held window, the blow
    // applies directly to the ally.
    const damaged = applyEvents(state, [damageEvent(foe.id, ally!.id, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.kind === 'when-damaged' && candidate.actorId === hero.id)).toBe(false);
    expect(damaged.actors[ally!.id].hp).toBe(38); // applied directly
  });

  it('Sucker Punch: the original visible save stays immutable; the reroll is a separately recorded result', () => {
    const { state, hero, foe } = t5Encounter({ foe: { x: 2, y: 1 } });
    const deferred = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: hero.id,
      sourceId: 'fixture:save-ability',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [
        { kind: 'actions', sourceId: 'fixture:save-ability', actorId: hero.id, operation: 'spend', amount: 1 },
        {
          kind: 'save', sourceId: 'fixture:save-ability', actorId: foe.id, windowKind: 'effect', windowId: 'fixture:save-ability:default:effect-save:1:foe',
          roll: 12, boon: 0, total: 12, success: true, threshold: 10,
          modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
          branch: {
            boon: 0, threshold: 10,
            onSuccess: [{ kind: 'damage', target: { kind: 'trigger-targets' }, amount: { kind: 'constant', value: 2 }, damageType: 'normal', delivery: 'save-success' }],
            onFailure: [{ kind: 'damage', target: { kind: 'trigger-targets' }, amount: { kind: 'constant', value: 8 }, damageType: 'normal', delivery: 'effect' }],
          },
        },
        { kind: 'damage', sourceId: 'fixture:save-ability', sourceActorId: hero.id, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'save-success', ignoreCover: false },
      ],
    }]);
    const window = deferred.decisionWindows.find((candidate) => candidate.kind === 'save-rolled');
    expect(window).toBeDefined();
    // The ORIGINAL result is visible and immutable in the held payload.
    const original = window!.heldPayload!;
    expect(original.payload).toMatchObject({ kind: 'held-result' });
    // The reroll command creates a NEW recorded result; the original record
    // is never mutated (it is the payload the interrupt replaces).
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice(3));
    const rerollEvent = interrupt.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED' && 'reroll' in event);
    expect(rerollEvent).toBeDefined();
    expect((rerollEvent as { reroll: { roll: number } }).reroll).toMatchObject({ roll: 3 });
    expect(interrupt.state.actors[foe.id].hp).toBe(24); // 32 - 8; the held 2 never applied
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('a held result never auto-fires at a boundary merely because a coarse fact exists', () => {
    const { state, hero, foe, ally } = t5Encounter({ foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 } });
    // The ally's blow is held in the owner's window; the continuation is
    // armed with a window trigger.
    const damaged = applyEvents(state, [damageEvent(foe.id, ally!.id, 20)]);
    const window = damaged.decisionWindows.find((candidate) => candidate.actorId === hero.id);
    expect(window).toBeDefined();
    const held = window!.heldPayload!;
    expect(held.trigger.kind).toBe('window');
    // A boundary resume with a coarse same-kind fact in the history cannot
    // fire it: the continuation stays armed and the ally stays unharmed.
    const observed = turnEnd();
    const coarseFact = { kind: 'damage-applied' as const, instanceId: 'anything', sourceId: 'fixture:foe-attack', ownerId: foe.id, recipientId: ally!.id, amount: 20, delivery: 'hit' as const };
    expect(continuationDue(held, observed, [coarseFact])).toBe(false);
    resumeDueContinuations(damaged, observed, [coarseFact]);
    expect(damaged.actors[ally!.id].hp).toBe(40);
    // The held continuation lives on its OWNING window (never duplicated into
    // the armed collection); the window is untouched and still holds the blow.
    expect(damaged.decisionWindows.some((candidate) => candidate.heldPayload?.id === held.id)).toBe(true);
  });
});

describe('T5c.1 H8 — suspension inside loops resumes the EXACT unexecuted computation', () => {
  const suspendNode = (key: string): FlowNode => ({ kind: 'open-window', choice: { key, label: 'Continue?', kind: 'boolean', required: true } });
  const damageBound = (name: string): FlowNode => ({
    kind: 'apply',
    effect: { kind: 'damage', target: { kind: 'bound', name }, amount: { kind: 'constant', value: 2 }, damageType: 'normal', delivery: 'effect' },
  });
  const contextFor = (state: EncounterState, actorId: string): RuleExecutionContext => ({
    state: { ...state } as never,
    encounterState: state,
    actorId,
    sourceId: 'fixture:flow',
    actionId: 'default',
    timing: 'use',
    input: {},
    dice: scriptedDice(),
  });

  it('suspension inside repeat resumes every unexecuted iteration exactly once', () => {
    const state = createEncounter('repeat suspension');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    state.actors[hero.id] = hero as never;
    // repeat 3 of [damage, suspend, damage]: suspending inside iteration 2
    // must resume the rest of iteration 2 AND the whole of iteration 3 —
    // never just the innermost list tail.
    const nodes: FlowNode[] = [
      { kind: 'bind', name: 'target', reference: capturedActor(hero.id) },
      { kind: 'repeat', times: { kind: 'constant', value: 3 }, nodes: [damageBound('target'), suspendNode('go'), damageBound('target')] },
    ];
    const planned = executeFlow(nodes, contextFor(state, hero.id));
    expect(planned.window).toBeDefined();
    const remaining = planned.window!.remaining;
    // Iteration 1 ran damage(2) + suspended. Iterations 1-2 of damage already
    // planned: mutations = 1 damage (the first damage of iteration 1).
    expect(planned.mutations.filter((mutation) => mutation.kind === 'damage')).toHaveLength(1);
    // The remaining nodes must contain: [damage, suspend, damage] (rest of
    // iteration 1) + [damage, suspend, damage] (iteration 2) + [damage,
    // suspend, damage] (iteration 3) — 9 nodes: the tail of the current
    // iteration plus the two full unexecuted iterations.
    const resumed = executeFlowResume({ remaining, binder: planned.window!.binder }, contextFor(state, hero.id), { decision: { key: 'go', value: true } });
    // The resumed flow re-enters the loop bodies; the SECOND suspend (in the
    // resumed iteration-1 tail) suspends again — the nested-window seam.
    expect(resumed.window).toBeDefined();
    // Total damage mutations across the full execution: 3 iterations × 2
    // damage nodes = 6. After the first suspension 1 already planned; the
    // remaining must reach 6 when fully walked.
    const resumed2 = executeFlowResume({ remaining: resumed.window!.remaining, binder: resumed.window!.binder }, contextFor(state, hero.id), { decision: { key: 'go', value: true } });
    const resumed3 = resumed2.window
      ? executeFlowResume({ remaining: resumed2.window.remaining, binder: resumed2.window.binder }, contextFor(state, hero.id), { decision: { key: 'go', value: true } })
      : resumed2;
    const allDamage = [...planned.mutations, ...resumed.mutations, ...resumed2.mutations, ...(resumed3 === resumed2 ? [] : resumed3.mutations)].filter((mutation) => mutation.kind === 'damage');
    expect(allDamage).toHaveLength(6);
  });

  it('suspension inside for-each resumes every remaining item exactly once, re-bound', () => {
    const state = createEncounter('for-each suspension');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const second = actorFromCharacter(validCharacter('Mira'), { x: 2, y: 1 });
    const third = actorFromCharacter(validCharacter('Olin'), { x: 3, y: 1 });
    for (const actor of [hero, second, third]) state.actors[actor.id] = actor as never;
    const nodes: FlowNode[] = [
      {
        kind: 'for-each',
        items: [capturedActor(hero.id), capturedActor(second.id), capturedActor(third.id)],
        bindName: 'item',
        nodes: [damageBound('item'), suspendNode('go')],
      },
    ];
    const planned = executeFlow(nodes, contextFor(state, hero.id));
    expect(planned.window).toBeDefined();
    expect(planned.mutations.filter((mutation) => mutation.kind === 'damage')).toHaveLength(1);
    // Resuming must walk the current item's tail and then BOTH remaining
    // items (each re-bound) — the second suspend proves the loop re-entry.
    const resumed = executeFlowResume({ remaining: planned.window!.remaining, binder: planned.window!.binder }, contextFor(state, hero.id), { decision: { key: 'go', value: true } });
    expect(resumed.window).toBeDefined();
    const resumed2 = executeFlowResume({ remaining: resumed.window!.remaining, binder: resumed.window!.binder }, contextFor(state, hero.id), { decision: { key: 'go', value: true } });
    const resumed3 = resumed2.window
      ? executeFlowResume({ remaining: resumed2.window.remaining, binder: resumed2.window.binder }, contextFor(state, hero.id), { decision: { key: 'go', value: true } })
      : resumed2;
    const allDamage = [...planned.mutations, ...resumed.mutations, ...resumed2.mutations, ...(resumed3 === resumed2 ? [] : resumed3.mutations)].filter((mutation) => mutation.kind === 'damage');
    // 3 items × 1 damage node = 3 damage mutations total.
    expect(allDamage).toHaveLength(3);
  });
});

describe('T5c.1 H5 — LIVE reads diverge from CAPTURED values', () => {
  it('a captured actor identity reads THEN-CURRENT state while a captured position/value stays the literal', () => {
    const state = createEncounter('live vs captured');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.position = { x: 2, y: 2 };
    const heroView = hero as never;
    const context: RuleExecutionContext = {
      state: { ...state, actors: { [hero.id]: heroView } } as never,
      encounterState: state,
      actorId: hero.id,
      sourceId: 'fixture:ref',
      actionId: 'default',
      timing: 'use',
      input: {},
      dice: scriptedDice(),
    };
    // The actor is at (2,2). A CAPTURED position stays the literal (arm-time
    // value), a LIVE position reads the actor's then-current position, and a
    // CAPTURED-actor identity still resolves the actor whose state is read
    // then-current.
    const captured = capturedPosition({ x: 1, y: 1 });
    expect(resolveReference(captured, context)).toEqual({ ok: true, value: { kind: 'position', position: { x: 1, y: 1 } } });
    const live = liveRef('position', { kind: 'id', id: hero.id });
    expect(resolveReference(live, context)).toEqual({ ok: true, value: { kind: 'position', position: { x: 2, y: 2 } } });
    // Now the actor moves: the captured literal does not move; the live
    // position does.
    (context.state as { actors: Record<string, { position: Position }> }).actors[hero.id]!.position = { x: 9, y: 9 };
    expect(resolveReference(captured, context)).toEqual({ ok: true, value: { kind: 'position', position: { x: 1, y: 1 } } });
    expect(resolveReference(live, context)).toEqual({ ok: true, value: { kind: 'position', position: { x: 9, y: 9 } } });
    // A captured-actor identity resolves the actor whose state is THEN-CURRENT.
    const capturedActorRef = capturedActor(hero.id);
    const actorResolution = resolveReference(capturedActorRef, context);
    expect(actorResolution.ok).toBe(true);
    if (actorResolution.ok) {
      expect(actorResolution.value).toEqual({ kind: 'actor', actor: (context.state as never as { actors: Record<string, { position: Position }> }).actors[hero.id] });
    }
  });
});

describe('T5c.1 H9 — replay proofs: byte-identical final state with zero fresh RNG/choice', () => {
  it('full end-to-end replay through boundary drain and decision answer reaches the identical state with zero fresh RNG/choice', () => {
    const { state, hero, foe, ally } = t5Encounter({ foe: { x: 2, y: 1 }, ally: { x: 2, y: 0 } });
    // Build the command path, collecting EVERY recorded event in order.
    const stream: EncounterEvent[] = [damageEvent(foe.id, ally!.id, 20)];
    let built = applyEvents(state, stream);
    const saveEvent: EncounterEvent = {
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: hero.id,
      sourceId: 'fixture:save-ability',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [
        { kind: 'actions', sourceId: 'fixture:save-ability', actorId: hero.id, operation: 'spend', amount: 1 },
        {
          kind: 'save', sourceId: 'fixture:save-ability', actorId: foe.id, windowKind: 'effect', windowId: 'fixture:save-ability:default:effect-save:1:foe',
          roll: 12, boon: 0, total: 12, success: true, threshold: 10,
          modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
          branch: {
            boon: 0, threshold: 10,
            onSuccess: [{ kind: 'damage', target: { kind: 'trigger-targets' }, amount: { kind: 'constant', value: 2 }, damageType: 'normal', delivery: 'save-success' }],
            onFailure: [{ kind: 'damage', target: { kind: 'trigger-targets' }, amount: { kind: 'constant', value: 8 }, damageType: 'normal', delivery: 'effect' }],
          },
        },
        { kind: 'damage', sourceId: 'fixture:save-ability', sourceActorId: hero.id, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'save-success', ignoreCover: false },
      ],
    };
    built = applyEvents(built, [saveEvent]);
    stream.push(saveEvent);
    // Sucker Punch reroll (fresh RNG exactly once at the command boundary).
    const rerolled = executeCommand(built, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice(3));
    stream.push(...rerolled.events);
    // Great Giorgios USE_ABILITY (ends the hero's turn) + foe TAKE_TURN +
    // foe END_TURN (opens the decision window, drains held damage).
    const ggUsed = executeCommand(rerolled.state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    stream.push(...ggUsed.events);
    const ggFoeTurn = executeCommand(ggUsed.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice());
    stream.push(...ggFoeTurn.events);
    const ggEnded = executeCommand(ggFoeTurn.state, { type: 'END_TURN', actorId: foe.id }, scriptedDice());
    stream.push(...ggEnded.events);
    // Answer the decision (fresh decision exactly once).
    const ggWindow = ggEnded.state.decisionWindows.find((candidate) => candidate.kind === 'choice');
    expect(ggWindow).toBeDefined();
    const accepted = executeCommand(ggEnded.state, { type: 'ANSWER_DECISION_WINDOW', windowId: ggWindow!.id, input: { booleans: { rush: true } } }, scriptedDice());
    stream.push(...accepted.events);

    // Replay the ENTIRE recorded stream from the SAME pre-state in one
    // application. applyEvents accepts no dice — replay consumes zero fresh
    // RNG/choice by construction (every roll and decision was recorded on the
    // events).
    const replay = applyEvents(state, stream);
    // The final durable state is DEEP-identical to the command-built path.
    expect(replay).toEqual(accepted.state);
    expect(replay.windowSerial).toBe(accepted.state.windowSerial);
  });

  it('a recorded accept/decline event replays to the identical state with zero re-planning', () => {
    const { state, hero, foe } = t5Encounter({ foe: { x: 4, y: 1 } });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const declined = answerWindow(ended, ended.decisionWindows.find((candidate) => candidate.kind === 'choice')!.id, { booleans: { rush: false } });
    // The replayed DECISION_ANSWERED event carries the recorded decision and
    // mutations; replay never re-validates or re-plans.
    expect(applyEvents(ended, declined.events)).toEqual(declined.state);
  });
});

describe('T5c.1 H6 — schema migration cannot resurrect a second window authority or collide ids', () => {
  it('a schema-9 checkpoint with legacy windows migrates held payloads onto window identity without collision', () => {
    const { state, hero } = t5Encounter({});
    // Build a schema-9 checkpoint: legacy decisionWindows with per-window
    // heldDamage records and a NON-migrated windowSerial absent.
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    legacy.schemaVersion = 9;
    (legacy as { decisionWindows: Array<Record<string, unknown>> }).decisionWindows = [
      {
        id: 'when-damaged:actor:1:0', trigger: 'when-damaged', actorId: hero.id, triggeredAt: 1, order: 0,
        heldDamage: { amount: 8, damageType: 'normal', sourceActorId: 'foe:1', sourceId: 'fixture:foe-attack', instance: 1, delivery: 'hit', ignoreCover: false },
      },
      {
        id: 'when-damaged:actor:1:1', trigger: 'when-damaged', actorId: hero.id, triggeredAt: 2, order: 1,
        heldDamage: { amount: 4, damageType: 'normal', sourceActorId: 'foe:1', sourceId: 'fixture:foe-attack', instance: 1, delivery: 'hit', ignoreCover: false },
      },
    ];
    delete (legacy as { windowSerial?: unknown }).windowSerial;
    const migrated = migrateEncounter(legacy);
    expect(migrated.schemaVersion).toBe(ENCOUNTER_SCHEMA_VERSION);
    // The serial initializes (0) and the legacy ids are preserved — no
    // collision, no second authority.
    expect(migrated.windowSerial).toBe(0);
    expect(migrated.decisionWindows.map((window) => window.id)).toEqual(['when-damaged:actor:1:0', 'when-damaged:actor:1:1']);
    // Each migrated held payload is gated by ITS OWNING window's exact id.
    const [first, second] = migrated.decisionWindows;
    expect(first!.heldPayload!.trigger).toMatchObject({ kind: 'window', windowId: 'when-damaged:actor:1:0' });
    expect(second!.heldPayload!.trigger).toMatchObject({ kind: 'window', windowId: 'when-damaged:actor:1:1' });
    expect(first!.heldPayload!.id).not.toBe(second!.heldPayload!.id);
    // The migrated windows are the SAME authority the live reducer uses:
    // draining applies the held blow exactly.
    const withActor = migrated;
    const drained = endTurnOnly(withActor, scriptedDice());
    expect(drained.decisionWindows).toHaveLength(0);
  });
});

describe('T5c.1 H9 — boundary drain and window answer interact through exact identity', () => {
  it('two same-kind windows cannot answer or drain each other\'s held result', () => {
    const { state, hero, foe, ally } = t5Encounter({ foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 } });
    // Two blows against the ALLY, two held windows on the SAME owner.
    const first = applyEvents(state, [damageEvent(foe.id, ally!.id, 4)]);
    const second = applyEvents(first, [damageEvent(foe.id, ally!.id, 4)]);
    const windows = second.decisionWindows.filter((candidate) => candidate.actorId === hero.id && candidate.kind === 'when-damaged');
    expect(windows).toHaveLength(2);
    expect(windows[0]!.id).not.toBe(windows[1]!.id);
    // Answering the newest window (interrupt) pops ONLY it; the older held
    // blow remains intact under its own id and applies at the drain.
    const interrupt = executeCommand(second, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally!.id] }, scriptedDice());
    const remaining = interrupt.state.decisionWindows.filter((candidate) => candidate.actorId === hero.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(windows[0]!.id);
    expect(windowHeldDamage(remaining[0]!)).toMatchObject({ amount: 2 });
    // The drain applies the OLDER blow's exact amount to the ally.
    const ended = endTurnTo(interrupt.state, foe.id, scriptedDice());
    expect(ended.decisionWindows).toHaveLength(0);
    expect(ended.actors[ally!.id].hp).toBe(38); // 40 - held 2 (older blow)
  });
});
