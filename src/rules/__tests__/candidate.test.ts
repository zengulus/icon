/**
 * candidate.test.ts — the QUERY/CANDIDATE underlay's (U3) semantic contract.
 *
 * The underlay is ONE deterministic eligibility authority beneath both
 * automatic targeting and player choices. Tests establish:
 *   - positive: evaluateActorCandidates returns exactly the actors that
 *     satisfy relation / defeated / on-battlefield / range constraints;
 *   - negative: validateActorCandidate rejects with the SAME violation codes
 *     the choice kernel has always thrown (so the command boundary reads
 *     identically);
 *   - boundary: at-range passes, one-past fails; includeDefeated /
 *     includeOffBattlefield flips;
 *   - parity: a CandidateSet built by evaluateActorCandidates contains every
 *     actor that resolveChoice accepts, and rejects every actor that
 *     resolveChoice rejects — one legality machinery, two consumers.
 */
import { describe, expect, it } from 'vitest';
import type { RuleChoice, RuleExecutionContext } from '../automation/primitives/types.js';
import { evaluateActorCandidates, validateActorCandidate } from '../automation/kernels/candidate.js';
import { resolveChoice } from '../automation/kernels/choice.js';
import { RuleProgramViolation } from '../automation/kernels/runtime.js';
import { anchorFromPosition } from '../automation/primitives/anchor.js';

/** Assert that `fn` throws a RuleProgramViolation carrying exactly `code`. */
function expectViolationCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuleProgramViolation) {
      expect(error.code).toBe(code);
      return;
    }
    throw error;
  }
  throw new Error('expected a RuleProgramViolation');
}

function ctx(overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  return {
    state: {
      round: 1,
      grid: { width: 24, height: 24 },
      actors: {
        hero: { id: 'hero', side: 'heroes', position: { x: 4, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
        ally: { id: 'ally', side: 'heroes', position: { x: 6, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
        allyFar: { id: 'allyFar', side: 'heroes', position: { x: 10, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
        foe: { id: 'foe', side: 'foes', position: { x: 8, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
        gone: { id: 'gone', side: 'foes', position: { x: 9, y: 4 }, hp: 0, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 0, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: true, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
        ghost: { id: 'ghost', side: 'foes', position: null, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
      },
      entities: {},
      terrainAt: () => new Set(),
      elevationAt: () => 0,
      terrainEffects: [],
    },
    actorId: 'hero',
    sourceId: 'test:source',
    actionId: 'default',
    timing: 'use',
    input: {},
    dice: { die: () => 1, float: () => 0.5 },
    ...overrides,
  } as RuleExecutionContext;
}

describe('QUERY underlay — evaluateActorCandidates', () => {
  it('returns all living on-board actors for relation any, no range', () => {
    const ids = evaluateActorCandidates({}, ctx()).map((a) => a.id).sort();
    expect(ids).toEqual(['ally', 'allyFar', 'foe', 'hero']);
  });

  it('filters by relation foe', () => {
    const ids = evaluateActorCandidates({ relation: 'foe' }, ctx()).map((a) => a.id);
    expect(ids).toEqual(['foe']);
  });

  it('filters by relation ally (excludes self)', () => {
    const ids = evaluateActorCandidates({ relation: 'ally' }, ctx()).map((a) => a.id).sort();
    expect(ids).toEqual(['ally', 'allyFar']);
  });

  it('relation self returns only the acting actor', () => {
    const ids = evaluateActorCandidates({ relation: 'self' }, ctx()).map((a) => a.id);
    expect(ids).toEqual(['hero']);
  });

  it('excludes defeated actors by default', () => {
    const ids = evaluateActorCandidates({ relation: 'foe' }, ctx()).map((a) => a.id);
    expect(ids).not.toContain('gone');
  });

  it('includeDefeated flips the defeated filter', () => {
    const ids = evaluateActorCandidates({ relation: 'foe', includeDefeated: true }, ctx()).map((a) => a.id).sort();
    expect(ids).toEqual(['foe', 'gone']);
  });

  it('excludes position-less actors by default', () => {
    const ids = evaluateActorCandidates({ relation: 'foe', includeDefeated: true }, ctx()).map((a) => a.id);
    expect(ids).not.toContain('ghost');
  });

  it('includeOffBattlefield flips the position filter', () => {
    const ids = evaluateActorCandidates({ relation: 'foe', includeDefeated: true, includeOffBattlefield: true }, ctx()).map((a) => a.id).sort();
    expect(ids).toEqual(['foe', 'ghost', 'gone']);
  });

  it('range filters: at-range passes, one-past fails', () => {
    // hero(4,4) → ally(6,4) is distance 2; allyFar(10,4) is distance 6.
    const atRange = evaluateActorCandidates({ relation: 'ally', range: 2 }, ctx()).map((a) => a.id);
    expect(atRange).toEqual(['ally']);
    const onePast = evaluateActorCandidates({ relation: 'ally', range: 1 }, ctx()).map((a) => a.id);
    expect(onePast).toEqual([]);
  });
});

describe('QUERY underlay — validateActorCandidate', () => {
  it('accepts a legal candidate', () => {
    const result = validateActorCandidate('foe', { relation: 'foe' }, ctx());
    expect(result).toEqual({ legal: true, value: 'foe' });
  });

  it('rejects an unknown actor with choice.actor-missing', () => {
    const result = validateActorCandidate('ghost2', { relation: 'foe' }, ctx());
    expect(result.legal).toBe(false);
    if (!result.legal) expect(result.violation.code).toBe('choice.actor-missing');
  });

  it('rejects a defeated actor with choice.actor-defeated', () => {
    const result = validateActorCandidate('gone', { relation: 'foe' }, ctx());
    expect(result.legal).toBe(false);
    if (!result.legal) expect(result.violation.code).toBe('choice.actor-defeated');
  });

  it('rejects a wrong relation with choice.actor-relation', () => {
    const result = validateActorCandidate('ally', { relation: 'foe' }, ctx());
    expect(result.legal).toBe(false);
    if (!result.legal) expect(result.violation.code).toBe('choice.actor-relation');
  });

  it('rejects an out-of-range actor with choice.actor-range', () => {
    const result = validateActorCandidate('allyFar', { relation: 'ally', range: 2 }, ctx());
    expect(result.legal).toBe(false);
    if (!result.legal) expect(result.violation.code).toBe('choice.actor-range');
  });

  it('an actor exactly at range is legal', () => {
    const result = validateActorCandidate('ally', { relation: 'ally', range: 2 }, ctx());
    expect(result).toEqual({ legal: true, value: 'ally' });
  });
});

describe('QUERY ⇄ CHOOSE parity — one legality machinery, two consumers', () => {
  const row: RuleChoice = { key: 'target', label: 'Pick a foe', kind: 'actors', required: true, relation: 'foe', maximum: 1 };

  it('every candidate in the CandidateSet is accepted by resolveChoice', () => {
    const context = ctx();
    const candidates = evaluateActorCandidates({ relation: 'foe' }, context);
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      const resolved = resolveChoice(row, { ...context, input: { actorIds: { target: [candidate.id] } } });
      expect(resolved).toEqual({ kind: 'actors', ids: [candidate.id] });
    }
  });

  it('every actor the CandidateSet excludes is rejected by resolveChoice', () => {
    const context = ctx();
    const accepted = new Set(evaluateActorCandidates({ relation: 'foe' }, context).map((a) => a.id));
    // Every actor NOT in the set must trip a violation when chosen.
    for (const actor of Object.values(context.state.actors)) {
      if (accepted.has(actor.id)) continue;
      expect(() => resolveChoice(row, { ...context, input: { actorIds: { target: [actor.id] } } })).toThrow(RuleProgramViolation);
    }
  });

  it('validateActorCandidate and resolveChoice agree on every actor', () => {
    const context = ctx();
    const query = { relation: 'foe' as const };
    for (const actor of Object.values(context.state.actors)) {
      const validation = validateActorCandidate(actor.id, query, context);
      let choiceOk = true;
      try {
        resolveChoice(row, { ...context, input: { actorIds: { target: [actor.id] } } });
      } catch (error) {
        if (error instanceof RuleProgramViolation && error.code !== 'choice.actor-count') choiceOk = false;
      }
      expect(validation.legal).toBe(choiceOk);
    }
  });
});

describe('QUERY underlay — rangeOrigin anchors (U7)', () => {
  it('measures range from a CAPTURED position anchor', () => {
    // From (6,4): ally is distance 0, hero 2, foe 2, allyFar 4.
    const ids = evaluateActorCandidates({ relation: 'foe', range: 2, rangeOrigin: anchorFromPosition({ x: 6, y: 4 }) }, ctx()).map((a) => a.id);
    expect(ids).toEqual(['foe']);
  });

  it('keeps relation relative to the acting actor while the range moves to the anchor', () => {
    // relation 'ally' is read from hero; range 1 from the ally(6,4) anchor
    // reaches only the ally itself (hero is distance 2, allyFar 4).
    const ids = evaluateActorCandidates({ relation: 'ally', range: 1, rangeOrigin: anchorFromPosition({ x: 6, y: 4 }) }, ctx()).map((a) => a.id);
    expect(ids).toEqual(['ally']);
  });

  it('resolves a LIVE actor anchor via attack-target (range moves to the anchor)', () => {
    // From hero, range 4 reaches ally (d2) but not allyFar (d6). From the
    // attack-target anchor (ally, d0), range 4 reaches allyFar (d4) too.
    const fromSelf = evaluateActorCandidates({ relation: 'ally', range: 4 }, ctx()).map((a) => a.id);
    expect(fromSelf).toEqual(['ally']);
    const fromAlly = evaluateActorCandidates(
      { relation: 'ally', range: 4, rangeOrigin: { kind: 'actor', selector: { kind: 'attack-target' } } },
      { ...ctx(), attackTargetId: 'ally' },
    ).map((a) => a.id).sort();
    expect(fromAlly).toEqual(['ally', 'allyFar']);
  });

  it('resolves a LIVE actor anchor via input', () => {
    const ids = evaluateActorCandidates(
      { relation: 'ally', range: 1, rangeOrigin: { kind: 'actor', selector: { kind: 'input', key: 'origin' } } },
      { ...ctx(), input: { actorIds: { origin: ['ally'] } } },
    ).map((a) => a.id);
    expect(ids).toEqual(['ally']);
  });

  it('rejects a query-shaped selector as an anchor (fail closed)', () => {
    expectViolationCode(() => evaluateActorCandidates(
      { relation: 'foe', range: 3, rangeOrigin: { kind: 'actor', selector: { kind: 'all', relation: 'any' } } },
      ctx(),
    ), 'selector.origin-invalid');
  });

  it('rejects an anchor resolving to zero actors (fail closed)', () => {
    expectViolationCode(() => evaluateActorCandidates(
      { relation: 'foe', range: 3, rangeOrigin: { kind: 'actor', selector: { kind: 'trigger-targets' } } },
      ctx(),
    ), 'selector.origin-invalid');
  });

  it('rejects an anchor actor without a position (fail closed)', () => {
    // ghost has position null.
    expectViolationCode(() => evaluateActorCandidates(
      { relation: 'foe', range: 3, rangeOrigin: { kind: 'actor', selector: { kind: 'input', key: 'origin' } } },
      { ...ctx(), input: { actorIds: { origin: ['ghost'] } } },
    ), 'selector.origin-invalid');
  });

  it('validateActorCandidate uses the same anchor', () => {
    const rejected = validateActorCandidate('allyFar', { relation: 'ally', range: 2, rangeOrigin: anchorFromPosition({ x: 6, y: 4 }) }, ctx());
    expect(rejected.legal).toBe(false);
    if (!rejected.legal) expect(rejected.violation.code).toBe('choice.actor-range');
    const accepted = validateActorCandidate('ally', { relation: 'ally', range: 2, rangeOrigin: anchorFromPosition({ x: 6, y: 4 }) }, ctx());
    expect(accepted).toEqual({ legal: true, value: 'ally' });
  });

  it('default origin stays the acting actor when no rangeOrigin is declared', () => {
    const ids = evaluateActorCandidates({ relation: 'ally', range: 2 }, ctx()).map((a) => a.id);
    expect(ids).toEqual(['ally']);
  });
});
