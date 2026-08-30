/**
 * t2-expression-algebra.test.ts — Phase T2 U5 VALUE + U6 PREDICATE (core)
 * extensions.
 *
 * U5: the single numeric-expression authority (`evaluateNumber`, now in
 * `kernels/evaluate-value.ts`, barrel re-exported) gains `count-query` over
 * the general U3 domains, `distance` between arbitrary endpoints (U1
 * references / U7 anchors), and `percent-base-max` (ICON p.107 "% HEALTH":
 * percentage costs/damage use the BASE maximum, never the wounds-adjusted
 * bar). Expressions fail closed on unrepresentable reads.
 *
 * U6 (CORE, Phase T2): the predicate algebra (`evaluatePredicate`, now in
 * `kernels/evaluate-predicate.ts`) gains mark-exists, in-stance,
 * inside-aura (through the shared aura kernel), and acted-this-round.
 * `effect-still-exists` (U10 facts) and `used-scope` (U16 ledger) are
 * deliberately NOT here — they land with their declared dependencies (T4/T3).
 *
 * Determinism: every expression is a pure function of state, so each is
 * evaluated twice and asserted identical (the replay property).
 */
import { describe, expect, it } from 'vitest';
import type { RuleActorView, RuleExecutionContext } from '../automation/primitives/types.js';
import { evaluateNumber, evaluatePredicate } from '../automation/kernels/runtime.js';
import { registerAuraDefinition } from '../automation/kernels/aura.js';
import { RuleProgramViolation } from '../automation/kernels/violations.js';

function actorView(
  id: string,
  side: 'heroes' | 'foes',
  position: { x: number; y: number } | null,
  extra: Partial<RuleActorView> = {},
): RuleActorView {
  return {
    id,
    side,
    position,
    hp: 10,
    maxHp: 10,
    vitality: 1,
    vigor: 0,
    defense: 10,
    armor: 0,
    speed: 6,
    dash: 12,
    fray: 2,
    damageDie: 8,
    actions: 2,
    attacked: false,
    traitIds: [],
    abilityIds: [],
    talents: {},
    masteredAbilityIds: [],
    size: 1,
    defeated: false,
    conditions: new Set<string>(),
    statuses: [],
    statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
    resources: {},
    state: {},
    marks: [],
    ...extra,
  };
}

function ctx(overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  return {
    state: {
      round: 1,
      grid: { width: 24, height: 24 },
      actors: {
        hero: actorView('hero', 'heroes', { x: 4, y: 4 }),
        ally: actorView('ally', 'heroes', { x: 6, y: 4 }),
        allyFar: actorView('allyFar', 'heroes', { x: 10, y: 4 }),
        near: actorView('near', 'foes', { x: 5, y: 4 }),
        foe: actorView('foe', 'foes', { x: 8, y: 4 }),
        slashed: actorView('slashed', 'foes', { x: 8, y: 5 }, { conditions: new Set(['slashed']) }),
        marked: actorView('marked', 'foes', { x: 9, y: 5 }, { state: { 'mark:m1': true } }),
        ghost: actorView('ghost', 'foes', null),
      },
      entities: {
        beast: { id: 'beast', type: 'beast', ownerId: 'hero', position: { x: 7, y: 4 }, state: { actorId: 'summon1' } },
        wisp: { id: 'wisp', type: 'wisp', ownerId: 'ally', position: { x: 11, y: 4 }, state: { actorId: 'summon1' } },
      },
      terrainAt: () => new Set<string>(),
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

describe('U5 — count-query over the general query domains', () => {
  it('counts actor candidates through the one query evaluator', () => {
    const context = ctx();
    const expression = { kind: 'count-query' as const, query: { domain: 'actors' as const, query: { relation: 'foe' as const } } };
    expect(evaluateNumber(expression, context)).toBe(4);
    // Determinism (replay property).
    expect(evaluateNumber(expression, context)).toBe(4);
  });

  it('counts entities through the entity domain', () => {
    expect(evaluateNumber({
      kind: 'count-query',
      query: { domain: 'entities', query: { owner: { kind: 'self' } } },
    }, ctx())).toBe(1);
    expect(evaluateNumber({
      kind: 'count-query',
      query: { domain: 'entities', query: { owner: { kind: 'any' } } },
    }, ctx())).toBe(2);
  });

  it('counts positions through the position domain', () => {
    // Radius 1 around (4,4), origin cell excluded → 8 cells.
    expect(evaluateNumber({
      kind: 'count-query',
      query: { domain: 'positions', query: { origin: { x: 4, y: 4 }, radius: 1, space: { kind: 'any' } } },
    }, ctx())).toBe(8);
  });

  it('counts terrain cells through the terrain domain', () => {
    const context = {
      ...ctx(),
      state: {
        ...ctx().state,
        terrainAt: (position: { x: number; y: number }) => new Set(
          (position.x === 5 && position.y === 4) || (position.x === 5 && position.y === 5) ? ['pit'] : [],
        ),
      },
    };
    expect(evaluateNumber({
      kind: 'count-query',
      query: { domain: 'terrain-cells', query: { origin: { x: 4, y: 4 }, radius: 2, terrain: 'pit' } },
    }, context)).toBe(2);
  });
});

describe('U5 — distance between arbitrary endpoints (U1 references / U7 anchors)', () => {
  it('selector endpoints keep the legacy actor-to-actor behavior', () => {
    // hero(4,4) → foe(8,4) is footprint distance 4.
    const expression = { kind: 'distance' as const, from: { kind: 'self' as const }, to: { kind: 'attack-target' as const } };
    expect(evaluateNumber(expression, { ...ctx(), attackTargetId: 'foe' })).toBe(4);
  });

  it('reference endpoints resolve through the U1 reference authority (captured actor / captured position)', () => {
    const expression = {
      kind: 'distance' as const,
      from: { ref: { kind: 'captured-position' as const, position: { x: 4, y: 4 } } },
      to: { ref: { kind: 'captured-actor' as const, actorId: 'foe' } },
    };
    expect(evaluateNumber(expression, ctx())).toBe(4);
  });

  it('anchor endpoints resolve through the U7 anchor authority (entity footprint)', () => {
    // hero(4,4) → beast entity (7,4) is footprint distance 3.
    const expression = {
      kind: 'distance' as const,
      from: { anchor: { kind: 'actor' as const } },
      to: { anchor: { kind: 'entity' as const, entityId: 'beast' } },
    };
    expect(evaluateNumber(expression, ctx())).toBe(3);
  });

  it('a position-less actor endpoint measures as infinity (legacy contract)', () => {
    const expression = {
      kind: 'distance' as const,
      from: { kind: 'self' as const },
      to: { ref: { kind: 'captured-actor' as const, actorId: 'ghost' } },
    };
    expect(evaluateNumber(expression, ctx())).toBe(Number.POSITIVE_INFINITY);
  });

  it('an unresolvable reference endpoint fails closed', () => {
    const expression = {
      kind: 'distance' as const,
      from: { kind: 'self' as const },
      to: { ref: { kind: 'captured-actor' as const, actorId: 'missing' } },
    };
    expect(() => evaluateNumber(expression, ctx())).toThrowError(expect.objectContaining({ code: 'value.distance-ref' }));
  });
});

describe('U5 — percent-base-max (ICON p.107 "% HEALTH")', () => {
  it('uses the BASE maximum — different from the wounds-adjusted bar when wounds exist', () => {
    // maxHp 8 (wounds-adjusted: base 10 - 2 wounds × 1 vitality), baseMaxHp 10.
    const context = {
      ...ctx(),
      state: {
        ...ctx().state,
        actors: { ...ctx().state.actors, hero: actorView('hero', 'heroes', { x: 4, y: 4 }, { maxHp: 8, baseMaxHp: 10 }) },
      },
    };
    expect(evaluateNumber({ kind: 'percent-base-max' as const, target: { kind: 'self' as const }, percent: 50, rounding: 'down' }, context)).toBe(5);
    // The generic `percent` of the wounds-adjusted `max-hp` read gives 4 —
    // the p.107 distinction: percentage COSTS use the base maximum.
    expect(evaluateNumber({
      kind: 'percent' as const,
      value: { kind: 'stat' as const, actor: { kind: 'self' as const }, stat: 'max-hp' },
      percent: 50,
      rounding: 'down',
    }, context)).toBe(4);
  });

  it('fails closed when the view does not project the base maximum', () => {
    const context = ctx(); // actorView default carries no baseMaxHp
    expect(() => evaluateNumber({ kind: 'percent-base-max' as const, target: { kind: 'self' as const }, percent: 50, rounding: 'down' }, context))
      .toThrowError(expect.objectContaining({ code: 'value.base-max-missing' }));
  });
});

describe('U6 (CORE) — predicate extensions', () => {
  it('mark-exists: presence of the mark on the target (explicit and default mark id)', () => {
    const context = ctx();
    expect(evaluatePredicate({ kind: 'mark-exists', target: { kind: 'self' }, markId: 'm1' }, {
      ...context,
      state: { ...context.state, actors: { ...context.state.actors, hero: actorView('hero', 'heroes', { x: 4, y: 4 }, { state: { 'mark:m1': true } }) } },
    })).toBe(true);
    // Default mark id = the source unit id.
    expect(evaluatePredicate({ kind: 'mark-exists', target: { kind: 'self' } }, {
      ...context,
      state: { ...context.state, actors: { ...context.state.actors, hero: actorView('hero', 'heroes', { x: 4, y: 4 }, { state: { 'mark:test:source': true } }) } },
    })).toBe(true);
    expect(evaluatePredicate({ kind: 'mark-exists', target: { kind: 'self' }, markId: 'm2' }, context)).toBe(false);
  });

  it('in-stance: the target currently holds the stance', () => {
    const context = {
      ...ctx(),
      state: { ...ctx().state, actors: { ...ctx().state.actors, ally: actorView('ally', 'heroes', { x: 6, y: 4 }, { stance: { stanceId: 'vigilance' } }) } },
    };
    expect(evaluatePredicate({ kind: 'in-stance', target: { kind: 'input', key: 't', relation: 'any' }, stanceId: 'vigilance' }, {
      ...context,
      input: { actorIds: { t: ['ally'] } },
    })).toBe(true);
    expect(evaluatePredicate({ kind: 'in-stance', target: { kind: 'input', key: 't', relation: 'any' }, stanceId: 'battle-meditation' }, {
      ...context,
      input: { actorIds: { t: ['ally'] } },
    })).toBe(false);
  });

  it('inside-aura: membership is derived through the shared aura kernel (aura-effect provenance)', () => {
    registerAuraDefinition({
      sourceId: 'fixture:t2-aura',
      origin: { kind: 'actor-state', stateKey: 't2-aura-active' },
      radius: 2,
      relations: ['allies'],
      includesOrigin: true,
    });
    const context = {
      ...ctx(),
      state: {
        ...ctx().state,
        actors: {
          ...ctx().state.actors,
          hero: actorView('hero', 'heroes', { x: 4, y: 4 }, { state: { 't2-aura-active': true } }),
          ally: actorView('ally', 'heroes', { x: 6, y: 4 }),   // distance 2 → inside
          allyFar: actorView('allyFar', 'heroes', { x: 10, y: 4 }), // distance 6 → outside
        },
      },
    };
    expect(evaluatePredicate({ kind: 'inside-aura', target: { kind: 'input', key: 't', relation: 'any' }, sourceId: 'fixture:t2-aura' }, {
      ...context,
      input: { actorIds: { t: ['ally'] } },
    })).toBe(true);
    expect(evaluatePredicate({ kind: 'inside-aura', target: { kind: 'input', key: 't', relation: 'any' }, sourceId: 'fixture:t2-aura' }, {
      ...context,
      input: { actorIds: { t: ['allyFar'] } },
    })).toBe(false);
  });

  it('inside-aura with an unregistered provenance fails closed', () => {
    expect(() => evaluatePredicate({ kind: 'inside-aura', target: { kind: 'self' }, sourceId: 'fixture:never-registered' }, ctx()))
      .toThrowError(expect.objectContaining({ code: 'predicate.aura-unknown' }));
  });

  it('acted-this-round: reads the durable attack-made-this-turn state (p.129 Special)', () => {
    const context = {
      ...ctx(),
      state: { ...ctx().state, actors: { ...ctx().state.actors, foe: actorView('foe', 'foes', { x: 8, y: 4 }, { attacked: true }) } },
    };
    expect(evaluatePredicate({ kind: 'acted-this-round', target: { kind: 'attack-target' } }, { ...context, attackTargetId: 'foe' })).toBe(true);
    expect(evaluatePredicate({ kind: 'acted-this-round', target: { kind: 'self' } }, context)).toBe(false);
  });

  it('count-query comparisons compose through compare (count(foes) == 4)', () => {
    const predicate = {
      kind: 'compare' as const,
      left: { kind: 'count-query' as const, query: { domain: 'actors' as const, query: { relation: 'foe' as const } } },
      operator: '=' as const,
      right: { kind: 'constant' as const, value: 4 },
    };
    expect(evaluatePredicate(predicate, ctx())).toBe(true);
    expect(evaluatePredicate({ ...predicate, right: { kind: 'constant', value: 3 } }, ctx())).toBe(false);
  });

  it('distance comparisons compose through compare (distance(source, target) >= 3)', () => {
    const predicate = {
      kind: 'compare' as const,
      left: { kind: 'distance' as const, from: { kind: 'self' as const }, to: { kind: 'attack-target' as const } },
      operator: '>=' as const,
      right: { kind: 'constant' as const, value: 3 },
    };
    expect(evaluatePredicate(predicate, { ...ctx(), attackTargetId: 'foe' })).toBe(true); // 4 >= 3
    expect(evaluatePredicate(predicate, { ...ctx(), attackTargetId: 'near' })).toBe(false); // 1 >= 3
  });

  it('a missing value read inside a predicate fails closed through the value algebra', () => {
    expect(() => evaluatePredicate({
      kind: 'compare',
      left: { kind: 'percent-base-max', target: { kind: 'self' }, percent: 50, rounding: 'down' },
      operator: '>',
      right: { kind: 'constant', value: 1 },
    }, ctx())).toThrow(RuleProgramViolation);
  });
});
