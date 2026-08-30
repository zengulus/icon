/**
 * t3-ordering.test.ts — Phase T3 U17 ORDERING / ARBITRATION tests
 * (corrected contract).
 *
 * Typed ordering policies (`primitives/ordering.ts`) — NOT one numeric
 * priority: source-order (p.85, p.107 §4), stack/LIFO (interrupt nesting,
 * p.107), turn-order, hostile-before-beneficial (p.107 turn-boundary
 * ordering), non-active-owner-first (p.107), controller-choice (a policy
 * that YIELDS A CHOICE via U4 — the engine never invents an order), and
 * explicit-list.
 *
 * FAIL CLOSED (corrected contract): a policy whose required context is
 * absent — or whose candidates are not fully covered by its declared
 * ordering authority — returns `ok: false` with a typed problem. It NEVER
 * silently retains the incoming array order (arbitrary caller array
 * construction must never become game semantics), and `controller-choice`
 * is never resolved by `applyOrdering` — it yields the typed U4 choice and
 * the caller routes it through the choice authority.
 *
 * Covered here: every policy's ordering, the negative missing-context and
 * unknown-candidate cases for each context-requiring policy, the
 * policy→choice seam (yields-choice never resolves), the deterministic
 * policy key, and the wired `orderedSelectedSteps` adapter (the engine's
 * ability-step order reads through the shared source-order policy).
 */
import { describe, expect, it } from 'vitest';
import {
  applyOrdering,
  orderingKey,
  policyYieldsChoice,
  type OrderingCandidate,
} from '../automation/primitives/ordering.js';
import { orderedSelectedSteps } from '../automation/kernels/runtime.js';
import type { RuleAction } from '../automation/primitives/types.js';

const candidates: OrderingCandidate[] = [
  { id: 'a', side: 'heroes' },
  { id: 'b', side: 'foes' },
  { id: 'c', side: 'heroes' },
  { id: 'd', side: 'foes' },
];

describe('U17 — ordering policies', () => {
  it('source-order reorders a subset by the source listing (p.85/p.107 §4)', () => {
    const result = applyOrdering(
      { kind: 'source-order' },
      [{ id: 'c' }, { id: 'a' }, { id: 'd' }],
      { sourceOrder: ['a', 'b', 'c', 'd'] },
    );
    expect(result).toEqual({ ok: true, ordered: [{ id: 'a' }, { id: 'c' }, { id: 'd' }] });
  });

  it('source-order FAILS CLOSED without the source listing (never incoming order)', () => {
    expect(applyOrdering({ kind: 'source-order' }, candidates)).toEqual({ ok: false, problem: 'missing-source-order' });
  });

  it('source-order FAILS CLOSED on a candidate absent from the listing (never an array-order tie-break)', () => {
    const result = applyOrdering(
      { kind: 'source-order' },
      [{ id: 'a' }, { id: 'zzz' }],
      { sourceOrder: ['a', 'b'] },
    );
    expect(result).toEqual({ ok: false, problem: 'unknown-candidate' });
  });

  it('stack is LIFO (most-recent trigger first, p.107)', () => {
    const result = applyOrdering({ kind: 'stack' }, candidates);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.ordered.map((candidate) => candidate.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('turn-order follows the recorded scheduler sequence', () => {
    const result = applyOrdering(
      { kind: 'turn-order' },
      [{ id: 'hero' }, { id: 'foe' }, { id: 'ally' }],
      { turnOrder: ['ally', 'hero', 'foe'] },
    );
    expect(result).toEqual({ ok: true, ordered: [{ id: 'ally' }, { id: 'hero' }, { id: 'foe' }] });
  });

  it('turn-order FAILS CLOSED without the recorded sequence and on unknown candidates', () => {
    expect(applyOrdering({ kind: 'turn-order' }, [{ id: 'hero' }])).toEqual({ ok: false, problem: 'missing-turn-order' });
    const result = applyOrdering(
      { kind: 'turn-order' },
      [{ id: 'hero' }, { id: 'zzz' }],
      { turnOrder: ['hero'] },
    );
    // The unknown candidate is not in the declared authority — the incoming
    // array order is never used as an accidental tie-break.
    expect(result).toEqual({ ok: false, problem: 'unknown-candidate' });
  });

  it('hostile-before-beneficial puts the other side first (p.107 turn-boundary ordering)', () => {
    const result = applyOrdering(
      { kind: 'hostile-before-beneficial' },
      candidates,
      { perspectiveActorId: 'hero', perspectiveSide: 'heroes' },
    );
    // Foes (b, d) resolve before the hero's own side (a, c), preserving
    // source order within each group.
    expect(result).toEqual({ ok: true, ordered: [{ id: 'b', side: 'foes' }, { id: 'd', side: 'foes' }, { id: 'a', side: 'heroes' }, { id: 'c', side: 'heroes' }] });
  });

  it('hostile-before-beneficial derives the perspective side from the candidate list when only the actor is given', () => {
    const result = applyOrdering(
      { kind: 'hostile-before-beneficial' },
      [{ id: 'hero', side: 'heroes' }, { id: 'foe', side: 'foes' }],
      { perspectiveActorId: 'hero' },
    );
    expect(result).toEqual({ ok: true, ordered: [{ id: 'foe', side: 'foes' }, { id: 'hero', side: 'heroes' }] });
  });

  it('hostile-before-beneficial FAILS CLOSED without a perspective actor/side (never an invented classification)', () => {
    expect(applyOrdering({ kind: 'hostile-before-beneficial' }, candidates)).toEqual({ ok: false, problem: 'missing-perspective' });
  });

  it('hostile-before-beneficial fails closed on a candidate with no derivable side (unknown ≠ beneficial)', () => {
    // Every candidate in the list must be classifiable; an unsided candidate
    // is UNRESOLVED, never silently treated as beneficial.
    const result = applyOrdering(
      { kind: 'hostile-before-beneficial' },
      [{ id: 'hero', side: 'heroes' }, { id: 'unknown-actor' }],
      { perspectiveActorId: 'hero' },
    );
    expect(result).toEqual({ ok: false, problem: 'missing-candidate-side' });
  });

  it('non-active-owner-first puts the active owner last (p.107), ownership affirmed', () => {
    const result = applyOrdering(
      { kind: 'non-active-owner-first' },
      [
        { id: 'hero', isActiveOwner: true },
        { id: 'foe', isActiveOwner: false },
        { id: 'ally', isActiveOwner: false },
      ],
      { activeActorId: 'hero' },
    );
    expect(result).toEqual({ ok: true, ordered: [{ id: 'foe', isActiveOwner: false }, { id: 'ally', isActiveOwner: false }, { id: 'hero', isActiveOwner: true }] });
  });

  it('non-active-owner-first FAILS CLOSED without the active owner', () => {
    expect(applyOrdering({ kind: 'non-active-owner-first' }, candidates)).toEqual({ ok: false, problem: 'missing-active-owner' });
  });

  it('non-active-owner-first fails closed on a candidate with underivable ownership (unknown ≠ not-active)', () => {
    // `foe` is neither the active id nor carries an isActiveOwner flag — its
    // ownership relative to the active actor cannot be derived, so the
    // policy rejects rather than assuming it is not-the-owner.
    const result = applyOrdering(
      { kind: 'non-active-owner-first' },
      [
        { id: 'hero', isActiveOwner: true },
        { id: 'foe' },
      ],
      { activeActorId: 'hero' },
    );
    expect(result).toEqual({ ok: false, problem: 'missing-candidate-ownership' });
  });

  it('explicit-list orders by the id list', () => {
    const result = applyOrdering(
      { kind: 'explicit-list', order: ['d', 'a', 'b', 'c'] },
      candidates,
    );
    expect(result).toEqual({ ok: true, ordered: [{ id: 'd', side: 'foes' }, { id: 'a', side: 'heroes' }, { id: 'b', side: 'foes' }, { id: 'c', side: 'heroes' }] });
  });

  it('explicit-list FAILS CLOSED on a candidate absent from the list (never source-order fallback)', () => {
    const result = applyOrdering(
      { kind: 'explicit-list', order: ['d', 'a'] },
      candidates,
    );
    expect(result).toEqual({ ok: false, problem: 'unknown-candidate' });
  });
});

describe('U17 — policy → choice seam and durable identity', () => {
  it('controller-choice yields a typed U4 choice and is never resolved by applyOrdering', () => {
    const choice = { key: 'order-effects', label: 'Order the effects', kind: 'option' as const, required: true, options: ['a-first', 'b-first'] };
    const policy = { kind: 'controller-choice' as const, choice };
    const spec = policyYieldsChoice(policy);
    expect(spec).toBe(choice);
    // applyOrdering returns the unresolved yields-choice result carrying the
    // choice — the engine never picks an order; the caller routes the
    // recorded player decision through U4.
    expect(applyOrdering(policy, candidates)).toEqual({ ok: false, problem: 'yields-choice', choice });
    // Other policies never yield a choice.
    expect(policyYieldsChoice({ kind: 'source-order' })).toBeNull();
    expect(policyYieldsChoice({ kind: 'stack' })).toBeNull();
  });

  it('orderingKey is a deterministic durable identity per policy', () => {
    expect(orderingKey({ kind: 'source-order' })).toBe('source-order');
    expect(orderingKey({ kind: 'stack' })).toBe('stack');
    expect(orderingKey({ kind: 'hostile-before-beneficial' })).toBe('hostile-before-beneficial');
    expect(orderingKey({ kind: 'explicit-list', order: ['a', 'b'] })).toBe('explicit-list:a,b');
    expect(orderingKey({ kind: 'explicit-list', order: ['a', 'b'] })).toBe(orderingKey({ kind: 'explicit-list', order: ['a', 'b'] }));
  });

  it('orderedSelectedSteps (the engine step order) reads through the shared source-order policy', () => {
    const action: RuleAction = {
      id: 'use',
      name: 'Fixture',
      timing: 'use',
      costs: [],
      tags: [],
      range: null,
      area: null,
      choices: [],
      steps: [
        { id: 'base', timing: 'use', effects: [] },
        { id: 'collide', timing: 'use', trigger: 'collide', effects: [] },
        { id: 'slay', timing: 'use', trigger: 'slay', effects: [] },
      ],
    };
    const selected = [
      action.steps[2],
      action.steps[0],
      action.steps[1],
    ];
    expect(orderedSelectedSteps(action, selected).map((step) => step.id)).toEqual(['base', 'collide', 'slay']);
  });

  it('orderedSelectedSteps FAILS CLOSED on a step the action listing does not name', () => {
    const action: RuleAction = {
      id: 'use',
      name: 'Fixture',
      timing: 'use',
      costs: [],
      tags: [],
      range: null,
      area: null,
      choices: [],
      steps: [{ id: 'base', timing: 'use', effects: [] }],
    };
    const foreign = { id: 'not-in-listing', timing: 'use' as const, effects: [] };
    expect(() => orderedSelectedSteps(action, [foreign, action.steps[0]])).toThrow(/Cannot order steps/);
  });
});
