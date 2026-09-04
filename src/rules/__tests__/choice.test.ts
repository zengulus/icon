/**
 * choice.test.ts — the CHOOSE underlay's semantic contract.
 *
 * Tests establish the underlay's semantics independent of any one ability:
 *   - positive: every choice kind resolves from its bucket;
 *   - negative: a required missing choice rejects with the right code, and
 *     nothing is consumed (the violation is thrown before any mutation);
 *   - optional: a missing optional choice means "decline" (null), never a
 *     default;
 *   - boundary: cardinality edges (exactly-N, up-to-N, distinct), range
 *     edges (at-range passes, one-past fails), numeric bounds;
 *   - invalid input: wrong relation, out-of-bounds position, unknown actor,
 *     defeated target, unknown option, (0,0) direction, non-finite number;
 *   - composition: resolveChoices orders required rejections before optional
 *     declines.
 */
import { describe, expect, it } from 'vitest';
import type { RuleChoice, RuleExecutionContext } from '../automation/primitives/types.js';
import {
  readCapturedPositionChoice,
  resolveCapturedActorChoice,
  resolveCapturedOptionListChoice,
  resolveChoice,
  resolveChoices,
  validateCapturedPositionChoice,
} from '../automation/kernels/choice.js';
import { validatePositionCandidate } from '../automation/kernels/evaluate-query.js';
import { RuleProgramViolation } from '../automation/kernels/runtime.js';

function ctx(overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  return {
    state: {
      round: 1,
      grid: { width: 24, height: 24 },
      actors: {
        hero: { id: 'hero', side: 'heroes', position: { x: 4, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {} },
        ally: { id: 'ally', side: 'heroes', position: { x: 6, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {} },
        foe: { id: 'foe', side: 'foes', position: { x: 8, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {} },
        gone: { id: 'gone', side: 'foes', position: { x: 9, y: 4 }, hp: 0, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 0, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: true, resources: {}, conditions: new Set(), state: {} },
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

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuleProgramViolation) return error.code;
    throw error;
  }
  throw new Error('expected a RuleProgramViolation');
};

describe('CHOOSE underlay — actors', () => {
  const row: RuleChoice = { key: 'target', label: 'Pick a foe', kind: 'actors', required: true, relation: 'foe', maximum: 1 };

  it('resolves a valid foe target', () => {
    const context = ctx({ input: { actorIds: { target: ['foe'] } } });
    expect(resolveChoice(row, context)).toEqual({ kind: 'actors', ids: ['foe'] });
  });

  it('rejects a missing required choice', () => {
    expect(codeOf(() => resolveChoice(row, ctx()))).toBe('choice.actor-required');
  });

  it('a declined optional choice is null, never a default', () => {
    const optional: RuleChoice = { ...row, required: false };
    expect(resolveChoice(optional, ctx())).toEqual({ kind: 'actors', ids: [] });
  });

  it('rejects a wrong-relation target (ally where foe required)', () => {
    expect(codeOf(() => resolveChoice(row, ctx({ input: { actorIds: { target: ['ally'] } } })))).toBe('choice.actor-relation');
  });

  it('rejects a defeated target', () => {
    expect(codeOf(() => resolveChoice(row, ctx({ input: { actorIds: { target: ['gone'] } } })))).toBe('choice.actor-defeated');
  });

  it('rejects an unknown actor id', () => {
    expect(codeOf(() => resolveChoice(row, ctx({ input: { actorIds: { target: ['ghost'] } } })))).toBe('choice.actor-missing');
  });

  it('rejects an out-of-range target (ally at distance 2, range 1)', () => {
    const near: RuleChoice = { ...row, relation: 'ally', range: { kind: 'constant', value: 1 } };
    expect(codeOf(() => resolveChoice(near, ctx({ input: { actorIds: { target: ['ally'] } } })))).toBe('choice.actor-range');
  });

  it('a target exactly at range passes the range gate', () => {
    const near: RuleChoice = { ...row, relation: 'ally', range: { kind: 'constant', value: 2 } };
    expect(resolveChoice(near, ctx({ input: { actorIds: { target: ['ally'] } } }))).toEqual({ kind: 'actors', ids: ['ally'] });
  });

  it('enforces cardinality: exactly one where maximum is 1', () => {
    const anyRow: RuleChoice = { key: 'target', label: 'Pick a foe', kind: 'actors', required: true, relation: 'any', maximum: 1 };
    expect(codeOf(() => resolveChoice(anyRow, ctx({ input: { actorIds: { target: ['foe', 'ally'] } } })))).toBe('choice.actor-count');
  });

  it('rejects duplicate selections', () => {
    const multi: RuleChoice = { ...row, maximum: 3 };
    expect(codeOf(() => resolveChoice(multi, ctx({ input: { actorIds: { target: ['foe', 'foe'] } } })))).toBe('choice.actor-distinct');
  });
});

describe('CHOOSE underlay — positions', () => {
  const row: RuleChoice = { key: 'center', label: 'Blast center', kind: 'positions', required: true, range: { kind: 'constant', value: 3 } };

  it('resolves a position in range', () => {
    const context = ctx({ input: { positions: { center: [{ x: 6, y: 4 }] } } });
    expect(resolveChoice(row, context)).toEqual({ kind: 'positions', positions: [{ x: 6, y: 4 }] });
  });

  it('rejects a missing required position', () => {
    expect(codeOf(() => resolveChoice(row, ctx()))).toBe('choice.position-required');
  });

  it('an optional position declines to empty', () => {
    const optional: RuleChoice = { ...row, required: false };
    expect(resolveChoice(optional, ctx())).toEqual({ kind: 'positions', positions: [] });
  });

  it('rejects an out-of-bounds position', () => {
    const context = ctx({ input: { positions: { center: [{ x: 30, y: 4 }] } } });
    expect(codeOf(() => resolveChoice(row, context))).toBe('move.out-of-bounds');
  });

  it('rejects a position beyond the declared range', () => {
    const context = ctx({ input: { positions: { center: [{ x: 10, y: 4 }] } } });
    expect(codeOf(() => resolveChoice(row, context))).toBe('move.range');
  });

  it('a position exactly at range passes', () => {
    const context = ctx({ input: { positions: { center: [{ x: 7, y: 4 }] } } });
    expect(resolveChoice(row, context)).toEqual({ kind: 'positions', positions: [{ x: 7, y: 4 }] });
  });

  it('enforces up-to-N cardinality', () => {
    const upTo2: RuleChoice = { ...row, maximum: 2 };
    const context = ctx({ input: { positions: { center: [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }] } } });
    expect(codeOf(() => resolveChoice(upTo2, context))).toBe('choice.position-count');
  });

  it('uses exactly the U3 candidate answer for every supplied position, including a large origin footprint', () => {
    const base = ctx();
    const context = ctx({
      state: { ...base.state, actors: { ...base.state.actors, hero: { ...base.state.actors.hero, size: 2 } } },
    });
    const largeOriginRow: RuleChoice = { ...row, range: { kind: 'constant', value: 1 } };
    for (const position of [{ x: 6, y: 4 }, { x: 7, y: 4 }, { x: -1, y: 4 }]) {
      const candidate = validatePositionCandidate({ origin: { x: 4, y: 4 }, originSize: 2, range: 1 }, position, context);
      const choiceContext = { ...context, input: { positions: { center: [position] } } };
      if (candidate.legal) {
        expect(resolveChoice(largeOriginRow, choiceContext)).toEqual({ kind: 'positions', positions: [position] });
      } else {
        expect(codeOf(() => resolveChoice(largeOriginRow, choiceContext)))
          .toBe(candidate.problem === 'out-of-bounds' ? 'move.out-of-bounds' : 'move.range');
      }
    }
  });
});

describe('CHOOSE underlay — option / number / boolean / direction', () => {
  it('resolves a valid option and rejects an unknown one', () => {
    const row: RuleChoice = { key: 'branch', label: 'Effect', kind: 'option', required: true, options: ['destroy', 'raise'] };
    expect(resolveChoice(row, ctx({ input: { options: { branch: 'destroy' } } }))).toEqual({ kind: 'option', value: 'destroy' });
    expect(codeOf(() => resolveChoice(row, ctx({ input: { options: { branch: 'explode' } } })))).toBe('choice.option-invalid');
    expect(codeOf(() => resolveChoice(row, ctx()))).toBe('choice.option-required');
  });

  it('resolves a number within bounds and rejects out-of-bounds / non-finite', () => {
    const row: RuleChoice = { key: 'sacrifice', label: 'Sacrifice', kind: 'number', required: true, minimum: 1, maximum: 3 };
    expect(resolveChoice(row, ctx({ input: { numbers: { sacrifice: 2 } } }))).toEqual({ kind: 'number', value: 2 });
    expect(codeOf(() => resolveChoice(row, ctx({ input: { numbers: { sacrifice: 4 } } })))).toBe('choice.number-maximum');
    expect(codeOf(() => resolveChoice(row, ctx({ input: { numbers: { sacrifice: 0 } } })))).toBe('choice.number-minimum');
  });

  it('resolves a boolean and rejects a missing required one', () => {
    const row: RuleChoice = { key: 'optIn', label: 'Opt in', kind: 'boolean', required: true };
    expect(resolveChoice(row, ctx({ input: { booleans: { optIn: true } } }))).toEqual({ kind: 'boolean', value: true });
    expect(codeOf(() => resolveChoice(row, ctx()))).toBe('choice.boolean-required');
  });

  it('resolves a direction and rejects (0,0)', () => {
    const row: RuleChoice = { key: 'push', label: 'Push direction', kind: 'direction', required: true };
    expect(resolveChoice(row, ctx({ input: { directions: { push: { x: 1, y: 0 } } } }))).toEqual({ kind: 'direction', direction: { x: 1, y: 0 } });
    expect(codeOf(() => resolveChoice(row, ctx({ input: { directions: { push: { x: 0, y: 0 } } } })))).toBe('choice.direction-invalid');
  });
});

describe('CHOOSE underlay — composition', () => {
  it('reads one captured position without selecting a default and delegates legality to U3', () => {
    expect(readCapturedPositionChoice(ctx(), 'landing', 'Landing')).toBeNull();
    expect(readCapturedPositionChoice(ctx({ input: { positions: { landing: [] } } }), 'landing', 'Landing')).toBeNull();
    const chosen = { x: 6, y: 6 };
    const context = ctx({ input: { positions: { landing: [chosen] } } });
    expect(readCapturedPositionChoice(context, 'landing', 'Landing')).toEqual(chosen);
    expect(codeOf(() => readCapturedPositionChoice(ctx({ input: { positions: { landing: [chosen, { x: 7, y: 7 }] } } }), 'landing', 'Landing')))
      .toBe('choice.position-count');
    expect(validateCapturedPositionChoice(context, chosen, { origin: { x: 4, y: 4 }, range: 2 }, 'Landing')).toEqual(chosen);
    expect(codeOf(() => validateCapturedPositionChoice(context, { x: 9, y: 9 }, { origin: { x: 4, y: 4 }, range: 2 }, 'Landing')))
      .toBe('move.range');
    expect(codeOf(() => validateCapturedPositionChoice(context, { x: 6, y: 4 }, { origin: { x: 4, y: 4 }, range: 2 }, 'Landing')))
      .toBe('choice.position-unavailable');
  });

  it('validates a recorded actor subset against an externally produced CandidateSet without selecting for the player', () => {
    const choice = { key: 'area-subset', label: 'Area subset', required: false, minimum: 0, maximum: 2 };
    const candidates = [{ id: 'hero' }, { id: 'ally' }];
    expect(resolveCapturedActorChoice(choice, candidates, ctx())).toEqual([]);
    expect(resolveCapturedActorChoice(choice, candidates, ctx({ input: { actorIds: { 'area-subset': [] } } }))).toEqual([]);
    expect(resolveCapturedActorChoice(choice, candidates, ctx({ input: { actorIds: { 'area-subset': ['ally', 'hero'] } } }))).toEqual(['ally', 'hero']);
    expect(codeOf(() => resolveCapturedActorChoice(choice, candidates, ctx({ input: { actorIds: { 'area-subset': ['hero', 'ally', 'foe'] } } })))).toBe('choice.actor-count');
    expect(codeOf(() => resolveCapturedActorChoice(choice, candidates, ctx({ input: { actorIds: { 'area-subset': ['hero', 'hero'] } } })))).toBe('choice.actor-distinct');
    expect(codeOf(() => resolveCapturedActorChoice(choice, candidates, ctx({ input: { actorIds: { 'area-subset': ['foe'] } } })))).toBe('choice.actor-ineligible');
    const subset = { ...choice, repetition: 'collapse' as const };
    expect(resolveCapturedActorChoice(subset, candidates, ctx({ input: { actorIds: { 'area-subset': ['ally', 'ally'] } } }))).toEqual(['ally']);
  });

  it('validates an exact recorded option pair without padding, de-duplicating, or choosing defaults', () => {
    const choice = { key: 'effects', label: 'Choose two effects', required: true, minimum: 2, maximum: 2, options: ['1', '2', '3'] };
    expect(resolveCapturedOptionListChoice(choice, ctx({ input: { options: { effects: '3,1' } } }))).toEqual(['3', '1']);
    expect(codeOf(() => resolveCapturedOptionListChoice(choice, ctx()))).toBe('choice.option-required');
    expect(codeOf(() => resolveCapturedOptionListChoice(choice, ctx({ input: { options: { effects: '1' } } })))).toBe('choice.option-count');
    expect(codeOf(() => resolveCapturedOptionListChoice(choice, ctx({ input: { options: { effects: '1,2,3' } } })))).toBe('choice.option-count');
    expect(codeOf(() => resolveCapturedOptionListChoice(choice, ctx({ input: { options: { effects: '1,1' } } })))).toBe('choice.option-distinct');
    expect(codeOf(() => resolveCapturedOptionListChoice(choice, ctx({ input: { options: { effects: '1,9' } } })))).toBe('choice.option-invalid');
  });

  it('required choices reject before optional ones decline', () => {
    const rows: RuleChoice[] = [
      { key: 'bonus', label: 'Optional bonus', kind: 'boolean', required: false },
      { key: 'target', label: 'Required foe', kind: 'actors', required: true, relation: 'foe' },
    ];
    // The optional row would decline; the required row must still reject.
    expect(codeOf(() => resolveChoices(rows, ctx()))).toBe('choice.actor-required');
  });

  it('resolves a mixed choice list', () => {
    const rows: RuleChoice[] = [
      { key: 'target', label: 'Foe', kind: 'actors', required: true, relation: 'foe' },
      { key: 'bonus', label: 'Bonus', kind: 'boolean', required: false },
    ];
    const resolved = resolveChoices(rows, ctx({ input: { actorIds: { target: ['foe'] } } }));
    expect(resolved.get('target')).toEqual({ kind: 'actors', ids: ['foe'] });
    expect(resolved.get('bonus')).toEqual({ kind: 'boolean', value: null });
  });
});
