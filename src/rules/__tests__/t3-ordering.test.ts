/**
 * t3-ordering.test.ts — Phase T3 U17 ORDERING / ARBITRATION tests.
 *
 * Typed ordering policies (`primitives/ordering.ts`) — NOT one numeric
 * priority: source-order (p.85, p.107 §4), stack/LIFO (interrupt nesting,
 * p.107), turn-order, hostile-before-beneficial (p.107 turn-boundary
 * ordering), non-active-owner-first (p.107), controller-choice (a policy
 * that YIELDS A CHOICE via U4 — the engine never invents an order), and
 * explicit-list. Ordering is a pure function of the policy + durable
 * context, so replay derives the same order; array construction order never
 * becomes the game rule.
 *
 * Covered here: every policy's ordering, the policy→choice seam, the
 * deterministic policy key, fail-closed reads (a policy that cannot
 * classify hostile vs beneficial without a perspective actor keeps source
 * order), and the wired `orderedSelectedSteps` adapter (the engine's
 * ability-step order now reads through the shared source-order policy).
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
    const ordered = applyOrdering(
      { kind: 'source-order' },
      [{ id: 'c' }, { id: 'a' }, { id: 'd' }],
      { sourceOrder: ['a', 'b', 'c', 'd'] },
    );
    expect(ordered.map((candidate) => candidate.id)).toEqual(['a', 'c', 'd']);
  });

  it('stack is LIFO (most-recent trigger first, p.107)', () => {
    expect(applyOrdering({ kind: 'stack' }, candidates).map((candidate) => candidate.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('turn-order follows the recorded scheduler sequence', () => {
    const ordered = applyOrdering(
      { kind: 'turn-order' },
      [{ id: 'hero' }, { id: 'foe' }, { id: 'ally' }],
      { turnOrder: ['ally', 'hero', 'foe'] },
    );
    expect(ordered.map((candidate) => candidate.id)).toEqual(['ally', 'hero', 'foe']);
    // Unknown ids sort last, stably.
    const withUnknown = applyOrdering(
      { kind: 'turn-order' },
      [{ id: 'hero' }, { id: 'zzz' }],
      { turnOrder: ['hero'] },
    );
    expect(withUnknown.map((candidate) => candidate.id)).toEqual(['hero', 'zzz']);
  });

  it('hostile-before-beneficial puts the other side first (p.107 turn-boundary ordering)', () => {
    const ordered = applyOrdering(
      { kind: 'hostile-before-beneficial' },
      candidates,
      { perspectiveActorId: 'hero', perspectiveSide: 'heroes' },
    );
    // Foes (b, d) resolve before the hero's own side (a, c), preserving
    // source order within each group.
    expect(ordered.map((candidate) => candidate.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('hostile-before-beneficial falls back to the perspective candidate\'s side', () => {
    const ordered = applyOrdering(
      { kind: 'hostile-before-beneficial' },
      [{ id: 'hero', side: 'heroes' }, { id: 'foe', side: 'foes' }],
      { perspectiveActorId: 'hero' },
    );
    expect(ordered.map((candidate) => candidate.id)).toEqual(['foe', 'hero']);
  });

  it('hostile-before-beneficial fails closed without a perspective actor (keeps source order)', () => {
    expect(applyOrdering({ kind: 'hostile-before-beneficial' }, candidates).map((candidate) => candidate.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('non-active-owner-first puts the active owner last (p.107)', () => {
    const ordered = applyOrdering(
      { kind: 'non-active-owner-first' },
      [{ id: 'hero', isActiveOwner: true }, { id: 'foe' }, { id: 'ally' }],
      { activeActorId: 'hero' },
    );
    expect(ordered.map((candidate) => candidate.id)).toEqual(['foe', 'ally', 'hero']);
  });

  it('explicit-list orders by the id list; unknown ids keep source order after', () => {
    const ordered = applyOrdering(
      { kind: 'explicit-list', order: ['d', 'a'] },
      candidates,
    );
    expect(ordered.map((candidate) => candidate.id)).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('U17 — policy → choice seam and durable identity', () => {
  it('controller-choice yields a typed U4 choice and never invents an order', () => {
    const choice = { key: 'order-effects', label: 'Order the effects', kind: 'option' as const, required: true, options: ['a-first', 'b-first'] };
    const policy = { kind: 'controller-choice' as const, choice };
    const spec = policyYieldsChoice(policy);
    expect(spec).toBe(choice);
    // applyOrdering passes the candidates through in source order: the
    // recorded player decision reorders them durably — the engine never
    // picks an order.
    expect(applyOrdering(policy, candidates).map((candidate) => candidate.id)).toEqual(['a', 'b', 'c', 'd']);
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
});
