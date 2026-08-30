/**
 * t6-2-u17-recorded-ordering.test.ts — T6.2 RECORDED SAME-OWNER ORDERING
 * (U17 + U4 + U13).
 *
 * ICON p.107: "If a character owns multiple effects, and there's ambiguity
 * in the order in which they trigger, they can determine the order." The
 * engine must never invent a lexical/registration/actor-id/source-id/
 * array-order tie-break where the source grants the owner the choice — the
 * ordering decision is a RECORDED U4 choice through the U13 decision window:
 *
 *   1. U17 `sameOwnerOrderingDecision` classifies the tie (determined /
 *      unresolved / yields a chooser decision) and builds the typed U4
 *      ORDERING choice over the EXACT candidate set;
 *   2. U2 derives the entitled chooser from the choice's `chooser: owner`
 *      role against the durable role frame (never an ad-hoc actor-id
 *      assumption — an underivable chooser fails closed);
 *   3. U13 opens the ONE choice window; the answer validates through
 *      `resolveChoice` (a full permutation of the exact pending set);
 *   4. the recorded order is stamped as durable `resolvedOrder` ranks and
 *      the U17 LIFO pop / boundary projection consume exactly that order on
 *      replay — zero fresh choice, zero inferred tie-break, zero dependence
 *      on current array/registration order.
 *
 * Covered: positive (1–5), choice validation (6–11), boundaries (12–15),
 * suspension/state (16–18), stack-policy respect (19), replay (20–22).
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { DecisionWindowRecord, EncounterActor, EncounterEvent, EncounterState } from '../types.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { sameOwnerOrderingDecision, type OrderingCandidate } from '../automation/primitives/ordering.js';
import { deriveRoles, resolveRoleSelector, type RoleFrame } from '../automation/primitives/roles.js';
import { resolveChoice } from '../automation/kernels/choice.js';
import {
  nextWindowId,
  openDecisionWindow,
  openOrderingDecisionForSameOwnerTies,
  openOrderingDecisionWindow,
  orderDecisionWindows,
  peekDecisionWindowStack,
  popDecisionWindowStack,
  recordOrderingDecision,
} from '../automation/kernels/decision-window.js';
import { heldDamageContinuation } from '../automation/primitives/continuation.js';
import type { RuleChoice, RuleExecutionContext } from '../automation/primitives/types.js';
import { endTurnOnly, scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

/** Capture the `.code` of a thrown violation (repo convention — the message
 * never carries the code). */
function expectViolationCode(fn: () => unknown, code: string) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect((caught as { code?: string } | undefined)?.code).toBe(code);
}

/** The canonical T6.2 fixture: a hero with every executable ability (the
 * when-damaged interrupt owner), a foe, and two allies both within the
 * owner's p.128 Range 2. */
function t62Encounter(options: { ally1?: { x: number; y: number }; ally2?: { x: number; y: number } } = {}): {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally1: EncounterActor;
  ally2: EncounterActor;
} {
  let state = createEncounter('T6.2 fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', { x: 4, y: 1 });
  const ally1 = actorFromCharacter(validCharacter('Mira'), options.ally1 ?? { x: 2, y: 1 });
  const ally2 = actorFromCharacter(validCharacter('Nova'), options.ally2 ?? { x: 2, y: 2 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally1 }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally2 }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, ally1, ally2 };
}

/** ONE event carrying TWO damage mutations to two allies — the reducer opens
 * two when-damaged windows for the same owner at the SAME revision, which is
 * the p.107 same-instant same-owner ambiguity. */
function doubleDamageEvent(foe: EncounterActor, ally1: EncounterActor, ally2: EncounterActor, amount: number): EncounterEvent {
  return {
    type: 'RULE_MUTATIONS_APPLIED',
    actorId: foe.id,
    sourceId: 'fixture:foe-blast',
    actionId: 'default',
    timing: 'use',
    tags: [],
    mutations: [
      { kind: 'damage', sourceId: 'fixture:foe-blast', sourceActorId: foe.id, actorId: ally1.id, amount, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
      { kind: 'damage', sourceId: 'fixture:foe-blast', sourceActorId: foe.id, actorId: ally2.id, amount, damageType: 'normal', instance: 2, delivery: 'area', ignoreCover: false },
    ],
  };
}

const answerOrdering = (state: EncounterState, windowId: string, order: string[]) =>
  executeCommand(state, { type: 'ANSWER_DECISION_WINDOW', windowId, input: { actorIds: { ordering: order } } }, scriptedDice());

/** The ordering windows opened on a fixture with two same-instant windows. */
function tieWindows(state: EncounterState, heroId: string) {
  const windows = state.decisionWindows.filter((window) => window.actorId === heroId && isInterruptLike(window.kind));
  return windows;
}

function isInterruptLike(kind: DecisionWindowRecord['kind']): boolean {
  return kind !== 'choice';
}

function contextFor(choice: RuleChoice, actorIds: string[]): RuleExecutionContext {
  return {
    state: {} as RuleExecutionContext['state'],
    actorId: 'hero',
    sourceId: 'fixture:ordering',
    actionId: 'decision',
    timing: 'interrupt',
    input: { actorIds: { [choice.key]: actorIds } },
    dice: scriptedDice(),
  } as RuleExecutionContext;
}

describe('U17 — sameOwnerOrderingDecision (the source yields a chooser decision only for a single owner)', () => {
  it('positive: two same-owner candidates yield the typed U4 ordering choice over the EXACT set', () => {
    const candidates: OrderingCandidate[] = [
      { id: 'window-a', ownerId: 'hero' },
      { id: 'window-b', ownerId: 'hero' },
    ];
    const decision = sameOwnerOrderingDecision(candidates, { key: 'ordering', label: 'Order your simultaneous effects' });
    expect(decision.kind).toBe('choice');
    if (decision.kind !== 'choice') return;
    expect(decision.ownerId).toBe('hero');
    expect(decision.choice).toMatchObject({
      key: 'ordering',
      kind: 'ordering',
      required: true,
      candidateIds: ['window-a', 'window-b'],
      chooser: { kind: 'role', role: 'owner' },
    });
  });

  it('a 3+ candidate set produces a FULL-permutation choice, not a binary option', () => {
    const decision = sameOwnerOrderingDecision(
      [{ id: 'a', ownerId: 'hero' }, { id: 'b', ownerId: 'hero' }, { id: 'c', ownerId: 'hero' }],
      { key: 'ordering', label: 'Order' },
    );
    expect(decision.kind).toBe('choice');
    if (decision.kind !== 'choice') return;
    expect(decision.choice.candidateIds).toEqual(['a', 'b', 'c']);
    // The answer must be a full permutation — the U4 validator below rejects
    // anything shorter (tested in the U4 suite).
    expect(resolveChoice(decision.choice, contextFor(decision.choice, ['c', 'a', 'b']))).toEqual({ kind: 'ordering', ids: ['c', 'a', 'b'] });
  });

  it('negative: a candidate without a derivable owner is UNRESOLVED (unknown never means same-owner)', () => {
    expect(sameOwnerOrderingDecision([{ id: 'a', ownerId: 'hero' }, { id: 'b' }], { key: 'ordering', label: 'Order' }))
      .toEqual({ kind: 'unresolved', problem: 'missing-candidate-owner' });
    expect(sameOwnerOrderingDecision([{ id: 'a' }, { id: 'b' }], { key: 'ordering', label: 'Order' }))
      .toEqual({ kind: 'unresolved', problem: 'missing-candidate-owner' });
  });

  it('negative: DIFFERENT owners have no single chooser — cross-owner stays unresolved, never a same-owner choice', () => {
    expect(sameOwnerOrderingDecision([{ id: 'a', ownerId: 'hero' }, { id: 'b', ownerId: 'ally' }], { key: 'ordering', label: 'Order' }))
      .toEqual({ kind: 'unresolved', problem: 'cross-owner' });
  });

  it('boundary: a single candidate is not a tie', () => {
    expect(sameOwnerOrderingDecision([{ id: 'a', ownerId: 'hero' }], { key: 'ordering', label: 'Order' }))
      .toEqual({ kind: 'unresolved', problem: 'not-a-tie' });
  });
});

describe('U4 — the ordering choice validates a FULL PERMUTATION of the exact pending set', () => {
  const orderingChoice: RuleChoice = {
    key: 'ordering',
    label: 'Order your simultaneous effects',
    kind: 'ordering',
    required: true,
    candidateIds: ['window-a', 'window-b', 'window-c'],
    chooser: { kind: 'role', role: 'owner' },
  };

  it('positive: an exact permutation (any order) is accepted and RECORDED as given', () => {
    expect(resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-c', 'window-a', 'window-b']))).toEqual({
      kind: 'ordering',
      ids: ['window-c', 'window-a', 'window-b'],
    });
    expect(resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-a', 'window-b', 'window-c']))).toEqual({
      kind: 'ordering',
      ids: ['window-a', 'window-b', 'window-c'],
    });
  });

  it('negative: an omitted required ordering rejects (no silent default)', () => {
    expectViolationCode(() => resolveChoice(orderingChoice, contextFor(orderingChoice, [])), 'choice.ordering-required');
  });

  it('negative: a duplicate candidate rejects', () => {
    expectViolationCode(() => resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-a', 'window-a', 'window-b'])), 'choice.ordering-distinct');
  });

  it('negative: an unknown candidate rejects (never a plausible-looking subset acceptance)', () => {
    expectViolationCode(() => resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-a', 'window-b', 'foreign'])), 'choice.ordering-unknown');
    // Same length, but the set is wrong — the ids must be the EXACT pending set.
    expectViolationCode(() => resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-a', 'window-b', 'x'])), 'choice.ordering-unknown');
  });

  it('negative: a PARTIAL permutation rejects (missing candidates)', () => {
    expectViolationCode(() => resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-a', 'window-b'])), 'choice.ordering-set');
    expectViolationCode(() => resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-a'])), 'choice.ordering-set');
  });

  it('negative: an EXTRA candidate rejects', () => {
    expectViolationCode(() => resolveChoice(orderingChoice, contextFor(orderingChoice, ['window-a', 'window-b', 'window-c', 'window-d'])), 'choice.ordering-set');
  });

  it('boundary: a two-candidate tie validates the binary pair and nothing else', () => {
    const pair: RuleChoice = { ...orderingChoice, candidateIds: ['p', 'q'] };
    expect(resolveChoice(pair, contextFor(pair, ['q', 'p']))).toEqual({ kind: 'ordering', ids: ['q', 'p'] });
    expectViolationCode(() => resolveChoice(pair, contextFor(pair, ['p', 'p'])), 'choice.ordering-distinct');
    expectViolationCode(() => resolveChoice(pair, contextFor(pair, ['p'])), 'choice.ordering-set');
  });
});

describe('U13 — the recorded ordering decision seam (openOrderingDecisionWindow)', () => {
  function openedFixture(): { state: EncounterState; hero: EncounterActor } {
    const fixture = t62Encounter();
    const { state, hero } = fixture;
    // Two same-instant windows for the hero, as if one event opened them.
    const first = nextWindowId(state, 'when-damaged', hero.id);
    const second = nextWindowId(state, 'when-damaged', hero.id);
    openDecisionWindow(state, { id: first, kind: 'when-damaged', actorId: hero.id });
    openDecisionWindow(state, { id: second, kind: 'when-damaged', actorId: hero.id });
    return { state, hero };
  }

  it('opens the ONE U13 choice window with the derived owner chooser and the exact candidate set', () => {
    const { state, hero } = openedFixture();
    const window = openOrderingDecisionWindow(state, {
      id: 'ordering:test:1',
      candidates: state.decisionWindows.map((candidate) => ({ id: candidate.id, ownerId: candidate.actorId })),
    });
    expect(window.kind).toBe('choice');
    expect(window.actorId).toBe(hero.id); // the OWNER decides — never the active actor or a source fallback
    expect(window.choice).toMatchObject({ kind: 'ordering', required: true });
    expect(window.choice!.candidateIds).toEqual([...state.decisionWindows.filter((c) => c.kind !== 'choice').map((c) => c.id)]);
  });

  it('derives the entitled chooser through U2 — the owner role on the durable frame, controller-of(owner) at the boundary', () => {
    const { state, hero } = openedFixture();
    const frame: RoleFrame = {
      sourceId: hero.id,
      ownerId: hero.id,
      // A multiplayer/session authority records the owner's controller; the
      // room boundary authorizes the answer by that controller (the same
      // composition server/rooms.ts applies via actors[window.actorId].controllerId).
      controllers: { owner: 'player-1' },
    };
    const window = openOrderingDecisionWindow(state, {
      id: 'ordering:test:2',
      candidates: state.decisionWindows.map((candidate) => ({ id: candidate.id, ownerId: candidate.actorId })),
      frame,
    });
    const map = deriveRoles(frame);
    // The owner ROLE resolves to the owner actor — the durable window
    // responder (never the source, never the active actor).
    expect(resolveRoleSelector({ kind: 'role', role: 'owner' }, map)).toBe(hero.id);
    expect(window.actorId).toBe(hero.id);
    // The network boundary then authorizes the answer by the owner's
    // RECORDED controller: controller-of(owner) → the player who may answer.
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'owner' }, map)).toBe('player-1');
  });

  it('an UNDERIVABLE chooser fails closed rather than guessing (no active-actor fallback)', () => {
    const { state } = openedFixture();
    expect(() => openOrderingDecisionWindow(state, {
      id: 'ordering:test:3',
      candidates: state.decisionWindows.map((candidate) => ({ id: candidate.id, ownerId: candidate.actorId })),
      // The durable frame does NOT carry the owner role — the declared
      // chooser cannot be derived; the engine must not substitute the source
      // or the active actor.
      frame: { sourceId: 'hero' },
    })).toThrow(/cannot be derived/);
  });

  it('cross-owner candidates never open a same-owner ordering window', () => {
    const { state, hero } = openedFixture();
    expect(() => openOrderingDecisionWindow(state, {
      id: 'ordering:test:4',
      candidates: [
        { id: 'a', ownerId: hero.id },
        { id: 'b', ownerId: 'ally-other' },
      ],
    })).toThrow(/cross-owner/);
  });

  it('recordOrderingDecision stamps the EXACT recorded permutation as durable ranks', () => {
    const { state, hero } = openedFixture();
    const windows = state.decisionWindows;
    const [a, b] = windows;
    const ordering = openOrderingDecisionWindow(state, {
      id: 'ordering:test:5',
      candidates: windows.map((candidate) => ({ id: candidate.id, ownerId: candidate.actorId })),
    });
    recordOrderingDecision(state, ordering, [b!.id, a!.id]);
    expect(state.decisionWindows.find((candidate) => candidate.id === a!.id)!.resolvedOrder).toBe(1);
    expect(state.decisionWindows.find((candidate) => candidate.id === b!.id)!.resolvedOrder).toBe(0);
    // A corrupt recorded value fails closed — never a partial or invented order.
    expect(() => recordOrderingDecision(state, ordering, [a!.id])).toThrow(/permutation/);
    expect(() => recordOrderingDecision(state, ordering, ['foreign', a!.id])).toThrow(/not in the pending set/);
    expect(() => recordOrderingDecision(state, ordering, [a!.id, a!.id])).toThrow(/repeats a candidate/);
    expect(() => recordOrderingDecision(state, ordering, [a!.id, b!.id, 'extra'])).toThrow(/permutation/);
    expect(() => recordOrderingDecision(state, ordering, true)).toThrow(/ordered candidate ids/);
    // The hero is the entitled chooser; the answerer authorization lives at
    // the network boundary (the window's actorId's controllerId).
    void hero;
  });
});

describe('End-to-end: the same-owner tie opens the ordering window and the answer resolves it (tests 1–5, 16–18)', () => {
  it('two simultaneous effects owned by one chooser reach a recorded decision — never an invented order', () => {
    const { state, hero, foe, ally1, ally2 } = t62Encounter();
    const damaged = applyEvents(state, [doubleDamageEvent(foe, ally1, ally2, 4)]);
    const tied = tieWindows(damaged, hero.id);
    expect(tied).toHaveLength(2);
    expect(tied[0]!.triggeredAt).toBe(tied[1]!.triggeredAt); // the same instant
    // The reducer opened the U13 ordering decision window automatically.
    const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering');
    expect(ordering).toBeDefined();
    expect(ordering!.actorId).toBe(hero.id); // the OWNER decides
    expect(ordering!.choice!.candidateIds).toEqual(expect.arrayContaining(tied.map((window) => window.id)));
    // While the decision is pending, the dependent resolution (an interrupt
    // pop) FAILS CLOSED — nothing partially executes past the decision point.
    expect(() => popDecisionWindowStack(damaged, hero.id, true)).toThrow(/ambiguous-order/);
    expect(() => peekDecisionWindowStack(damaged, hero.id, true)).toThrow(/ambiguous-order/);
    expect(damaged.decisionWindows.map((window) => window.id)).toEqual([
      ...tied.map((window) => window.id),
      ordering!.id,
    ]);
  });

  it('the entitled chooser can record A→B and B→A, producing observably different pop order', () => {
    const build = () => {
      const fixture = t62Encounter();
      const damaged = applyEvents(fixture.state, [doubleDamageEvent(fixture.foe, fixture.ally1, fixture.ally2, 4)]);
      const tied = tieWindows(damaged, fixture.hero.id);
      const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
      return { damaged, tied, ordering, hero: fixture.hero };
    };

    // A→B: the A window resolves first.
    const ab = build();
    const answeredAB = answerOrdering(ab.damaged, ab.ordering.id, [ab.tied[0]!.id, ab.tied[1]!.id]);
    // The ordering decision window closed; the two tied when-damaged windows
    // remain held, ranked by the recorded order.
    expect(answeredAB.state.decisionWindows).toHaveLength(2);
    expect(answeredAB.state.decisionWindows.some((window) => window.kind === 'choice')).toBe(false);
    expect(answeredAB.events.find((event) => event.type === 'DECISION_ANSWERED')).toMatchObject({
      decision: { key: 'ordering', value: [ab.tied[0]!.id, ab.tied[1]!.id] },
    });
    // The recorded ranks stamp the exact order; the pop consumes it.
    expect(popDecisionWindowStack(answeredAB.state, ab.hero.id, true)!.id).toBe(ab.tied[0]!.id);

    // B→A: the B window resolves first.
    const ba = build();
    const answeredBA = answerOrdering(ba.damaged, ba.ordering.id, [ba.tied[1]!.id, ba.tied[0]!.id]);
    expect(popDecisionWindowStack(answeredBA.state, ba.hero.id, true)!.id).toBe(ba.tied[1]!.id);
    // The two recorded choices are BOTH source-legal (p.107 grants the owner
    // the full choice) and yield DIFFERENT resolution order.
    expect(answeredAB.state).not.toEqual(answeredBA.state);
  });

  it('while the ordering window is pending, an interrupt use does not partially execute (16)', () => {
    const { state, hero, foe, ally1, ally2 } = t62Encounter();
    const damaged = applyEvents(state, [doubleDamageEvent(foe, ally1, ally2, 4)]);
    const before = structuredClone(damaged);
    // The hero attempts a when-damaged interrupt — the LIFO pop would be
    // ambiguous, so the command fails closed and NOTHING is consumed.
    expect(() => executeCommand(damaged, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally1.id] }, scriptedDice()))
      .toThrow(/ambiguous-order/);
    expect(damaged).toEqual(before);
    // The ordering decision window is still open for the player to answer.
    expect(damaged.decisionWindows.some((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')).toBe(true);
  });

  it('after answering, each pending effect resolves exactly once; closing cannot duplicate or drop (17–18)', () => {
    const { state, hero, foe, ally1, ally2 } = t62Encounter();
    const damaged = applyEvents(state, [doubleDamageEvent(foe, ally1, ally2, 4)]);
    const tied = tieWindows(damaged, hero.id);
    const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
    const answered = answerOrdering(damaged, ordering.id, [tied[0]!.id, tied[1]!.id]).state;
    // Exactly the first-resolved window pops; the other stays held.
    const popped = popDecisionWindowStack(answered, hero.id, true)!;
    expect(popped.id).toBe(tied[0]!.id);
    const remaining = answered.decisionWindows.filter((window) => window.actorId === hero.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(tied[1]!.id);
    expect(remaining[0]!.resolvedOrder).toBe(1); // the recorded rank survives
    // The boundary drain resolves the remaining held effect exactly once.
    const ended = endTurnOnly(answered, scriptedDice());
    expect(ended.decisionWindows.filter((window) => window.actorId === hero.id)).toHaveLength(0);
    // Re-answering is impossible — the ordering window is gone (no duplicate).
    expectViolationCode(() => { answerOrdering(answered, ordering.id, [tied[0]!.id, tied[1]!.id]); }, 'window.unknown');
  });

  it('a recorded order is consumed without duplicating or dropping windows across many pops (18)', () => {
    const { state, hero, foe, ally1, ally2 } = t62Encounter();
    const damaged = applyEvents(state, [doubleDamageEvent(foe, ally1, ally2, 4)]);
    const tied = tieWindows(damaged, hero.id);
    const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
    const answered = answerOrdering(damaged, ordering.id, [tied[0]!.id, tied[1]!.id]).state;
    // Two consecutive pops consume the two tied windows in the recorded order
    // exactly once each — no drop, no duplicate.
    const firstPop = popDecisionWindowStack(answered, hero.id, true)!;
    const secondPop = popDecisionWindowStack(answered, hero.id, true)!;
    expect([firstPop.id, secondPop.id]).toEqual([tied[0]!.id, tied[1]!.id]);
    expect(popDecisionWindowStack(answered, hero.id, true)).toBeUndefined();
  });

  it('nested/stacked windows keep the U17 LIFO policy across instants; the ordering decision only ranks the SAME instant (19)', () => {
    const { state, hero, foe, ally1, ally2 } = t62Encounter();
    // One ally is damaged first (older instant), then BOTH allies in one
    // event (newer instant) — the ordering decision governs only the newer
    // tie; the stack still pops the NEWER instant first.
    const older = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-attack',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:foe-attack', sourceActorId: foe.id, actorId: ally1.id, amount: 4, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
    }]);
    const damaged = applyEvents(older, [doubleDamageEvent(foe, ally1, ally2, 4)]);
    const heroWindows = tieWindows(damaged, hero.id);
    expect(heroWindows).toHaveLength(3);
    // The ordering window names exactly the NEWER pair (the same-instant
    // set), never the older window.
    const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
    expect(ordering.choice!.candidateIds).toHaveLength(2);
    const olderId = heroWindows.find((window) => window.triggeredAt < heroWindows[1]!.triggeredAt)!.id;
    expect(ordering.choice!.candidateIds).not.toContain(olderId);
    // Answer the decision; the stack still pops the newer instant first, in
    // the recorded order within it.
    const answered = answerOrdering(damaged, ordering.id, [...ordering.choice!.candidateIds!]).state;
    const popped = popDecisionWindowStack(answered, hero.id, true)!;
    expect(popped.id).toBe(ordering.choice!.candidateIds![0]);
    expect(popped.triggeredAt).toBeGreaterThan(heroWindows.find((window) => window.id === olderId)!.triggeredAt);
    // The older window remains held (LIFO across instants untouched).
    expect(answered.decisionWindows.some((window) => window.id === olderId)).toBe(true);
  });
});

describe('Boundaries (12–15)', () => {
  it('a source-defined total order resolves automatically without opening a choice window (12)', () => {
    const { state, hero } = t62Encounter();
    // Two windows at DIFFERENT instants: the stack rule (p.107 most-recent
    // first) fully determines the order — no ordering window opens, no choice.
    // (`openDecisionWindow` derives triggeredAt from the current revision, so
    // distinct instants are pushed directly as durable records, the same way
    // historical windows from different events exist at different revisions.)
    const first = nextWindowId(state, 'when-damaged', hero.id);
    const second = nextWindowId(state, 'when-damaged', hero.id);
    const held = (id: string, instance: number) => heldDamageContinuation({
      id: `held:${id}`,
      programId: 'fixture',
      ownerActorId: hero.id,
      targetId: hero.id,
      amount: 4,
      damageType: 'normal',
      sourceActorId: 'foe',
      sourceId: 'fixture',
      instance,
      delivery: 'hit',
      ignoreCover: false,
      windowId: id,
    });
    state.decisionWindows.push(
      { id: first, kind: 'when-damaged', actorId: hero.id, triggeredAt: 5, order: 0, heldPayload: held(first, 1) } as DecisionWindowRecord,
      { id: second, kind: 'when-damaged', actorId: hero.id, triggeredAt: 7, order: 1, heldPayload: held(second, 2) } as DecisionWindowRecord,
    );
    // The U17 source authority (stack) answers; nothing yields a chooser.
    expect(sameOwnerOrderingDecision(
      [{ id: first, ownerId: hero.id }],
      { key: 'ordering', label: 'Order' },
    )).toEqual({ kind: 'unresolved', problem: 'not-a-tie' });
    expect(popDecisionWindowStack(state, hero.id, true)!.id).toBe(second);
    expect(state.decisionWindows.some((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')).toBe(false);
  });

  it('different-owner simultaneous effects never spuriously become same-owner choices (13)', () => {
    const { state, hero, ally1 } = t62Encounter();
    // A same-instant tie between TWO DIFFERENT owners (the hero and the ally).
    const heroWindow = { id: 'h', kind: 'when-damaged' as const, actorId: hero.id, triggeredAt: 7, order: 0 } as DecisionWindowRecord;
    const allyWindow = { id: 'a', kind: 'when-damaged' as const, actorId: ally1.id, triggeredAt: 7, order: 1 } as DecisionWindowRecord;
    state.decisionWindows.push(heroWindow, allyWindow);
    // No single owner: the tie is NOT a same-owner choice.
    expect(sameOwnerOrderingDecision(
      [{ id: 'h', ownerId: hero.id }, { id: 'a', ownerId: ally1.id }],
      { key: 'ordering', label: 'Order' },
    )).toEqual({ kind: 'unresolved', problem: 'cross-owner' });
    // The reducer-side tie detection opens nothing for cross-owner groups.
    const before = state.decisionWindows.length;
    openOrderingDecisionForSameOwnerTies(state);
    expect(state.decisionWindows).toHaveLength(before);
    // The projection applies the source-defined U17 policy and rejects the
    // unrepresentable cross-owner tie rather than inventing an order.
    expect(() => orderDecisionWindows(state, hero.id, [allyWindow, heroWindow])).toThrow(/ordering-unrepresentable/);
  });

  it('a genuinely underivable chooser still fails closed (14)', () => {
    const { state, hero } = t62Encounter();
    const first = nextWindowId(state, 'when-damaged', hero.id);
    const second = nextWindowId(state, 'when-damaged', hero.id);
    openDecisionWindow(state, { id: first, kind: 'when-damaged', actorId: hero.id });
    openDecisionWindow(state, { id: second, kind: 'when-damaged', actorId: hero.id });
    // The owner role is underivable from the durable frame — the seam rejects
    // instead of guessing the active actor / source.
    expect(() => openOrderingDecisionWindow(state, {
      id: 'ordering:underivable',
      candidates: state.decisionWindows.map((candidate) => ({ id: candidate.id, ownerId: candidate.actorId })),
      frame: { sourceId: 'not-the-owner' },
    })).toThrow(/cannot be derived/);
    // And without a recorded order the pop still fails closed.
    expect(() => popDecisionWindowStack(state, hero.id, false)).toThrow(/ambiguous-order/);
  });

  it('a same-owner set of 3+ candidates produces and validates a full permutation (15)', () => {
    const { state, hero } = t62Encounter();
    const windows = [0, 1, 2].map(() => {
      const id = nextWindowId(state, 'when-damaged', hero.id);
      openDecisionWindow(state, { id, kind: 'when-damaged', actorId: hero.id });
      return id;
    });
    const decision = sameOwnerOrderingDecision(
      windows.map((id) => ({ id, ownerId: hero.id })),
      { key: 'ordering', label: 'Order' },
    );
    expect(decision.kind).toBe('choice');
    if (decision.kind !== 'choice') return;
    expect(decision.choice.candidateIds).toEqual(windows);
    // A full 3-candidate permutation is valid…
    expect(resolveChoice(decision.choice, contextFor(decision.choice, [windows[2]!, windows[0]!, windows[1]!]))).toEqual({
      kind: 'ordering',
      ids: [windows[2]!, windows[0]!, windows[1]!],
    });
    // …while any 2-of-3 subset is NOT.
    expectViolationCode(() => resolveChoice(decision.choice, contextFor(decision.choice, [windows[0]!, windows[1]!])), 'choice.ordering-set');
  });
});

describe('Replay (20–22): the recorded order rides the durable events; replay consumes it with zero fresh choice', () => {
  it('serialize/replay a recorded same-owner ordering and consume the SAME order with no fresh decision (20–21)', () => {
    const { state, hero, foe, ally1, ally2 } = t62Encounter();
    const damageEvents = [doubleDamageEvent(foe, ally1, ally2, 4)];
    const damaged = applyEvents(state, damageEvents);
    const tied = tieWindows(damaged, hero.id);
    const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
    const chosen = [tied[1]!.id, tied[0]!.id];
    const answered = answerOrdering(damaged, ordering.id, chosen);
    // The decision rode the recorded event.
    const decisionEvent = answered.events.find((event) => event.type === 'DECISION_ANSWERED');
    expect(decisionEvent).toMatchObject({ windowId: ordering.id, decision: { key: 'ordering', value: chosen } });
    // Replay the full recorded history: byte-identical state, and the pop
    // consumes the SAME recorded order.
    const replayed = applyEvents(state, [...damageEvents, ...answered.events]);
    expect(replayed).toEqual(answered.state);
    const replayedTied = tieWindows(replayed, hero.id);
    expect(replayedTied.map((window) => window.resolvedOrder)).toEqual(tied.map((window) => (window.id === chosen[0] ? 0 : 1)));
    // The replayed pop consumes the recorded order — no fresh choice, no
    // re-sort of the candidate array.
    expect(popDecisionWindowStack(replayed, hero.id, true)!.id).toBe(chosen[0]);
    expect(popDecisionWindowStack(replayed, hero.id, true)!.id).toBe(chosen[1]);
  });

  it('the replay is identical even if the candidate registration/input array order differs (22)', () => {
    const build = (reversedInput: boolean) => {
      const fixture = t62Encounter();
      const damageEvents = [doubleDamageEvent(fixture.foe, fixture.ally1, fixture.ally2, 4)];
      const damaged = applyEvents(fixture.state, damageEvents);
      const tied = tieWindows(damaged, fixture.hero.id);
      const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
      // The recorded ANSWER is decided once; the incidental array order of
      // the pending windows is never part of the decision.
      const chosen = reversedInput ? [tied[1]!.id, tied[0]!.id] : [tied[0]!.id, tied[1]!.id];
      const answered = answerOrdering(damaged, ordering.id, chosen);
      return applyEvents(fixture.state, [...damageEvents, ...answered.events]);
    };
    // Two otherwise-identical playthroughs differing ONLY in incidental input
    // order produce identical durable state (the recorded order wins).
    const ab = build(false);
    const ba = build(true);
    expect(ab).not.toEqual(ba); // the recorded orders differ — as decided
    // Replay with the SAME recorded events is byte-identical regardless of
    // the pre-replay windows array permutation: permute the incidental
    // decisionWindows array between the damage event and the recorded
    // DECISION_ANSWERED, and the recorded order (looked up by durable id)
    // still reproduces the identical state and pop order.
    const fixtureA = t62Encounter();
    const damageEventsA = [doubleDamageEvent(fixtureA.foe, fixtureA.ally1, fixtureA.ally2, 4)];
    const damagedA = applyEvents(fixtureA.state, damageEventsA);
    const tiedA = tieWindows(damagedA, fixtureA.hero.id);
    const orderingA = damagedA.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
    const answeredA = answerOrdering(damagedA, orderingA.id, [tiedA[0]!.id, tiedA[1]!.id]);
    const permuted = structuredClone(damagedA);
    permuted.decisionWindows = [...permuted.decisionWindows].reverse();
    const replayedPermuted = applyEvents(permuted, answeredA.events);
    // The array ORDER of the durable windows is documented as incidental
    // (never a game rule): the invariants are the per-id ranks and the pop
    // order. Compare state modulo that incidental array ordering.
    const normalize = (candidate: EncounterState) => ({
      ...candidate,
      decisionWindows: [...candidate.decisionWindows].sort((first, second) => (first.id < second.id ? -1 : 1)),
    });
    expect(normalize(replayedPermuted)).toEqual(normalize(answeredA.state));
    expect(popDecisionWindowStack(replayedPermuted, fixtureA.hero.id, true)!.id).toBe(tiedA[0]!.id);
  });

  it('replay never re-opens a fresh decision for a recorded ordering (20)', () => {
    const { state, hero, foe, ally1, ally2 } = t62Encounter();
    const damageEvents = [doubleDamageEvent(foe, ally1, ally2, 4)];
    const damaged = applyEvents(state, damageEvents);
    const tied = tieWindows(damaged, hero.id);
    const ordering = damaged.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')!;
    const answered = answerOrdering(damaged, ordering.id, [tied[0]!.id, tied[1]!.id]);
    const replayed = applyEvents(state, [...damageEvents, ...answered.events]);
    // The recorded DECISION_ANSWERED is consumed — no NEW ordering window and
    // no fresh choice are created on replay.
    expect(replayed.decisionWindows.filter((window) => window.kind === 'choice' && window.choice?.kind === 'ordering')).toHaveLength(0);
    expect(replayed.decisionWindows.map((window) => window.resolvedOrder).sort()).toEqual([0, 1]);
  });
});
