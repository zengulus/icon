/**
 * evaluate-query.test.ts — the U3 extended actor-query evaluator
 * (kernels/evaluate-query.ts) and the selectActors migration onto it.
 *
 * The migration claim: `selectActors` (kernels/runtime.ts) is now a THIN
 * ADAPTER — every eligibility decision (relation, defeated, on-battlefield,
 * range, adjacency, within-origin, condition, mark, summon) routes through
 * the ONE U3 authority (kernels/candidate.ts + kernels/evaluate-query.ts).
 * These tests pin each selector kind to the shared query, pin the adapter to
 * the base CandidateSet (no second copy of eligibility), and pin the legacy
 * input-selector enforcement contract (count/range throws) verbatim.
 */
import { describe, expect, it } from 'vitest';
import type { RuleActorView, RuleExecutionContext, RuleSelector } from '../automation/primitives/types.js';
import { RuleProgramViolation, selectActors } from '../automation/kernels/runtime.js';
import { evaluateActorCandidates } from '../automation/kernels/candidate.js';
import { evaluateActorQuery, evaluatePositions, nearestCandidates, validatePositionLegality } from '../automation/kernels/evaluate-query.js';
import { resolveChoice } from '../automation/kernels/choice.js';
import { computeSpatialArea } from '../automation/primitives/spatial-intent.js';

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

/** A context whose `marked` actor carries exactly the given mark state key. */
function ctxWithMarkState(key: string): RuleExecutionContext {
  const base = ctx();
  return {
    ...base,
    state: {
      ...base.state,
      actors: {
        ...base.state.actors,
        marked: { ...base.state.actors.marked, state: { [key]: true } },
      },
    },
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
        summon1: actorView('summon1', 'heroes', { x: 7, y: 4 }),
        ghost: actorView('ghost', 'foes', null),
        gone: actorView('gone', 'foes', { x: 9, y: 4 }, { defeated: true }),
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

const idsOf = (actors: RuleActorView[]) => actors.map((actor) => actor.id).sort();

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

describe('U3 migration — selectActors is a thin adapter over the shared query', () => {
  it('`all` routes through the same CandidateSet as evaluateActorCandidates (one eligibility machinery)', () => {
    const context = ctx();
    const viaSelector = selectActors({ kind: 'all', relation: 'foe' }, context);
    const viaQuery = evaluateActorCandidates({ relation: 'foe' }, context);
    expect(idsOf(viaSelector)).toEqual(idsOf(viaQuery));
    expect(idsOf(viaSelector)).toEqual(['foe', 'marked', 'near', 'slashed']);
  });

  it('reference selectors keep their referent semantics', () => {
    const context = ctx();
    expect(selectActors({ kind: 'self' }, context).map((a) => a.id)).toEqual(['hero']);
    expect(selectActors({ kind: 'trigger-source' }, { ...context, triggerSourceId: 'near' }).map((a) => a.id)).toEqual(['near']);
    expect(selectActors({ kind: 'trigger-targets' }, { ...context, triggerTargetIds: ['ally', 'foe'] }).map((a) => a.id)).toEqual(['ally', 'foe']);
  });

  it('attack-target referent is gated by the shared eligibility (defeated target yields nothing)', () => {
    expect(selectActors({ kind: 'attack-target' }, { ...ctx(), attackTargetId: 'foe' }).map((a) => a.id)).toEqual(['foe']);
    expect(selectActors({ kind: 'attack-target' }, { ...ctx(), attackTargetId: 'gone' })).toEqual([]);
    expect(selectActors({ kind: 'attack-target' }, ctx())).toEqual([]);
  });

  it('adjacent: within footprint distance 1 of the resolved origins', () => {
    // hero(4,4): near(5,4) is d1, ally(6,4) is d2, foe(8,4) is d4.
    const any = selectActors({ kind: 'adjacent', origin: { kind: 'self' }, relation: 'any' }, ctx()).map((a) => a.id);
    expect(any.sort()).toEqual(['hero', 'near']);
    const foes = selectActors({ kind: 'adjacent', origin: { kind: 'self' }, relation: 'foe' }, ctx()).map((a) => a.id);
    expect(foes).toEqual(['near']);
  });

  it('within: within the evaluated range of the resolved origins', () => {
    // hero(4,4): near d1, ally d2, foe d4, summon1 d3. Range 3 foes → near.
    const foes = selectActors({ kind: 'within', origin: { kind: 'self' }, relation: 'foe', range: { kind: 'constant', value: 3 } }, ctx()).map((a) => a.id);
    expect(foes).toEqual(['near']);
  });

  it('condition filter routes through the query', () => {
    const ids = selectActors({ kind: 'condition', conditionId: 'slashed', relation: 'any' }, ctx()).map((a) => a.id);
    expect(ids).toEqual(['slashed']);
  });

  it('marked filter routes through the query (explicit mark id)', () => {
    const ids = selectActors({ kind: 'marked', markId: 'm1' }, ctx()).map((a) => a.id);
    expect(ids).toEqual(['marked']);
  });

  it('marked filter defaults the mark key to the source id', () => {
    expect(evaluateActorQuery({ mark: {} }, ctxWithMarkState('mark:test:source')).map((a) => a.id)).toEqual(['marked']);
  });

  it('summons filter resolves entities to their actor ids through the query', () => {
    // beast is owned by hero → summon1; wisp is owned by ally → also summon1.
    const selfBeasts = selectActors({ kind: 'summons', owner: 'self', summonType: 'beast' }, ctx()).map((a) => a.id);
    expect(selfBeasts).toEqual(['summon1']);
    const anySummons = selectActors({ kind: 'summons', owner: 'any' }, ctx()).map((a) => a.id);
    expect(anySummons).toEqual(['summon1']);
  });

  it('input selector keeps its legacy enforcement contract (count + range throws)', () => {
    const context = ctx();
    // relation filter: ally excludes self and foes.
    const selected = selectActors({ kind: 'input', key: 'targets', relation: 'ally' }, { ...context, input: { actorIds: { targets: ['ally', 'allyFar', 'foe'] } } });
    expect(idsOf(selected)).toEqual(['ally', 'allyFar']);
    // count violation.
    expectViolationCode(() => selectActors({ kind: 'input', key: 'targets', minimum: 3 }, { ...context, input: { actorIds: { targets: ['ally', 'allyFar'] } } }), 'choice.actor-count');
    // range enforcement: a supplied ally outside range throws, it does not silently exclude.
    expectViolationCode(() => selectActors(
      { kind: 'input', key: 'targets', relation: 'ally', range: { kind: 'constant', value: 2 } },
      { ...context, input: { actorIds: { targets: ['allyFar'] } } },
    ), 'choice.actor-range');
  });

  it('a query with origins but an empty origin set yields no candidates (matches the selector fold)', () => {
    expect(evaluateActorQuery({ relation: 'any', origins: [], originDistance: 3 }, ctx())).toEqual([]);
  });

  it('a dangling entity→actor reference fails closed (matches the selector authority)', () => {
    const base = ctx();
    const context = {
      ...base,
      state: {
        ...base.state,
        entities: {
          ...base.state.entities,
          beast: { ...base.state.entities.beast, state: { actorId: 'missing-summon' } },
        },
      },
    };
    expect(() => selectActors({ kind: 'summons', owner: 'self' }, context)).toThrow(RuleProgramViolation);
  });

  it('RuleSelector kinds map one-to-one onto the query evaluator (no hidden eligibility)', () => {
    const context = ctx();
    // For every query-shaped selector kind, the adapter's result equals the
    // shared evaluator's result for the mapped query — the adapter adds no
    // filtering of its own.
    const cases: Array<{ selector: RuleSelector; query: Parameters<typeof evaluateActorQuery>[0] }> = [
      { selector: { kind: 'all', relation: 'foe' }, query: { relation: 'foe' as const } },
      { selector: { kind: 'condition', conditionId: 'slashed', relation: 'any' }, query: { conditionId: 'slashed' as const } },
      { selector: { kind: 'marked', markId: 'm1' }, query: { mark: { markId: 'm1' } } },
      { selector: { kind: 'summons', owner: 'self' as const }, query: { summon: { owner: 'self' as const } } },
    ];
    for (const { selector, query } of cases) {
      expect(idsOf(selectActors(selector, context))).toEqual(idsOf(evaluateActorQuery(query, context)));
    }
  });
});

describe('insideArea — actor inclusion in areas routes through the query authority', () => {
  // Burst-1 cells around (5,4): (4..6) x (3..5). hero(4,4), near(5,4), and
  // ally(6,4) sit inside; summon1(7,4) is one past; foe(8,4) is far out.
  const burstCells = [
    { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 },
    { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 },
    { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 },
  ];

  it('includes on-field living actors whose footprint intersects the area cells (p.95)', () => {
    const ids = evaluateActorQuery({ relation: 'any', insideArea: { cells: burstCells } }, ctx()).map((a) => a.id).sort();
    expect(ids).toEqual(['ally', 'hero', 'near']);
  });

  it('excludes defeated and off-battlefield actors even when their cell is inside', () => {
    // gone is defeated at (9,4); ghost has no position.
    const ids = evaluateActorQuery({ relation: 'any', insideArea: { cells: [{ x: 9, y: 4 }] } }, ctx()).map((a) => a.id);
    expect(ids).toEqual([]);
  });

  it('a large actor counts as inside when any footprint space is hit (p.290)', () => {
    // big (size 2) anchored at (7,5) occupies x 7-8, y 5-6; (7,6) hits only
    // its footprint.
    const context = { ...ctx(), state: { ...ctx().state, actors: { ...ctx().state.actors, big: actorView('big', 'foes', { x: 7, y: 5 }, { size: 2 }) } } };
    const ids = evaluateActorQuery({ relation: 'any', insideArea: { cells: [{ x: 7, y: 6 }] } }, context).map((a) => a.id);
    expect(ids).toEqual(['big']);
  });

  it('a footprint edge one past the area is excluded (boundary)', () => {
    const context = { ...ctx(), state: { ...ctx().state, actors: { ...ctx().state.actors, big: actorView('big', 'foes', { x: 7, y: 5 }, { size: 2 }) } } };
    // (9,5) is one past big's footprint (x 7-8) but on marked's own cell.
    const ids = evaluateActorQuery({ relation: 'any', insideArea: { cells: [{ x: 9, y: 5 }] } }, context).map((a) => a.id);
    expect(ids).toEqual(['marked']);
  });

  it('agrees with the spatial gateway actor inclusion for the same cells (one authority)', () => {
    const context = ctx();
    const area = computeSpatialArea(context.state, {
      kind: 'area',
      sourceActorId: 'hero',
      sourceRuleId: 'fixture:area',
      shape: 'burst',
      center: { x: 5, y: 4 },
      radius: 1,
      requireCenterInBounds: true,
    });
    expect(area.legal).toBe(true);
    const viaQuery = evaluateActorQuery({ relation: 'any', insideArea: { cells: area.cells } }, context).map((a) => a.id).sort();
    expect(viaQuery).toEqual([...area.includedActorIds].sort());
  });
});

describe('position domain — generic space query, teleport legality, and the nearest min-distance set', () => {
  it('evaluatePositions: generic in-grid query with an explicit SPACE policy (no ordering unless requested)', () => {
    const context = ctx(); // 24x24 grid; every actor sits at x >= 4.
    // `any` policy: every in-grid cell within radius, including cells holding
    // characters — ICON p.92 "Space: Any space in range, and any characters
    // or objects occupying it" (occupancy is a query policy, not a property
    // of a position candidate). No ordering is imposed by default.
    const anyCells = evaluatePositions({ origin: { x: 4, y: 4 }, radius: 1, space: { kind: 'any' } }, context);
    expect(anyCells).toHaveLength(8); // hero(4,4) excluded as the origin cell
    // near(5,4) occupies (5,4): under `any` the occupied cell is a candidate.
    expect(anyCells).toContainEqual({ x: 5, y: 4 });
    // Deterministic ordering is ONLY applied when explicitly requested.
    const ordered = evaluatePositions({ origin: { x: 1, y: 1 }, radius: 1, space: { kind: 'any' }, ordering: { kind: 'distance-from-origin' } }, context);
    expect(ordered).toEqual([
      { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 },
      { x: 1, y: 0 }, { x: 1, y: 2 },
      { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    ]);
    // includeOrigin adds the origin first under the ordering policy.
    const withOrigin = evaluatePositions({ origin: { x: 1, y: 1 }, radius: 1, space: { kind: 'any' }, ordering: { kind: 'distance-from-origin' }, includeOrigin: true }, context);
    expect(withOrigin).toHaveLength(9);
    expect(withOrigin[0]).toEqual({ x: 1, y: 1 });
  });

  it('evaluatePositions: the unoccupied policy excludes obstructing characters/objects but NOT intangible summons', () => {
    const context = {
      ...ctx(),
      state: {
        ...ctx().state,
        entities: {
          ...ctx().state.entities,
          bomb: { id: 'bomb', type: 'bomb', ownerId: 'hero', position: { x: 4, y: 5 }, state: {} },
          boulder: { id: 'boulder', type: 'boulder', ownerId: 'hero', position: { x: 3, y: 5 }, state: {} },
        },
      },
    };
    const cells = evaluatePositions({ origin: { x: 4, y: 4 }, radius: 1, space: { kind: 'unoccupied' }, ordering: { kind: 'distance-from-origin' } }, context);
    expect(cells).not.toContainEqual({ x: 4, y: 4 }); // origin excluded
    expect(cells).not.toContainEqual({ x: 5, y: 4 }); // actor near(5,4) obstructs
    expect(cells).not.toContainEqual({ x: 3, y: 5 }); // OBJECT entity obstructs (p.95)
    // The bomb is an intangible SUMMON — it does not obstruct (p.95) — so
    // its cell IS a free cell for the generic policy (a bomb's own
    // cannot-share-with-bombs rule is a specialist constraint, applied by
    // the bomb placement resolver).
    expect(cells).toContainEqual({ x: 4, y: 5 });
    // The mover's own footprint passes when excluded (with the origin cell
    // admitted).
    const own = evaluatePositions({ origin: { x: 4, y: 4 }, radius: 1, space: { kind: 'unoccupied', excludeActorId: 'hero' }, ordering: { kind: 'distance-from-origin' }, includeOrigin: true }, context);
    expect(own).toContainEqual({ x: 4, y: 4 });
  });

  it('validatePositionLegality (teleport specialist): in-grid, range, and unoccupied problems in order', () => {
    const context = ctx();
    const query = { origin: { x: 4, y: 4 }, range: 2, excludeActorId: 'hero' };
    expect(validatePositionLegality(query, { x: 2, y: 4 }, context)).toEqual({ legal: true, problem: null });
    expect(validatePositionLegality(query, { x: -1, y: 4 }, context)).toEqual({ legal: false, problem: 'out-of-bounds' });
    // (7,4) is distance 3 (out of range) and holds summon1 — range wins.
    expect(validatePositionLegality(query, { x: 7, y: 4 }, context)).toEqual({ legal: false, problem: 'range' });
    // near occupies (5,4) within range — occupancy wins there.
    expect(validatePositionLegality(query, { x: 5, y: 4 }, context)).toEqual({ legal: false, problem: 'occupied' });
    // The mover's own cell is legal for its own teleport.
    expect(validatePositionLegality(query, { x: 4, y: 4 }, context)).toEqual({ legal: true, problem: null });
  });

  it('nearestCandidates returns the COMPLETE minimum-distance set — no invented tie-break', () => {
    const context = ctx();
    const foes = evaluateActorQuery({ relation: 'foe' }, context);
    // near(5,4) is the unique closest foe from hero(4,4).
    const fromHero = nearestCandidates(foes, { x: 4, y: 4 });
    expect(fromHero.map((actor) => actor.id)).toEqual(['near']);
    // From (7,4): foe(8,4) and slashed(8,5) are BOTH distance 1 — the full
    // min-distance set is returned in the input's own order, and NO actor-id
    // or array-order rule selects one of them. The source that grants a
    // choice among equidistant candidates (e.g. ICON p.143 Dark Knight:
    // "If multiple foes are equidistant, you may choose") routes that choice
    // through U4 CHOOSE; this operator never picks for it.
    const fromTie = nearestCandidates(foes, { x: 7, y: 4 });
    expect(fromTie.map((actor) => actor.id).sort()).toEqual(['foe', 'slashed']);
    expect(fromTie).toHaveLength(2);
  });

  it('nearestCandidates over the query includeDefeated option: the flag is a query policy, not a nearest rule', () => {
    const context = ctx(); // gone is a defeated foe at (9,4).
    // With the flag, defeated actors are eligible candidates for the query.
    const including = nearestCandidates(evaluateActorQuery({ relation: 'foe', includeDefeated: true }, context), { x: 9, y: 4 });
    expect(including.map((actor) => actor.id)).toEqual(['gone']);
    // Without the flag, the query's default eligibility excludes defeated foes.
    const living = nearestCandidates(evaluateActorQuery({ relation: 'foe' }, context), { x: 9, y: 4 });
    expect(living.map((actor) => actor.id)).not.toContain('gone');
  });
});

describe('input selector range legality routes through the U3 candidate authority (no second actor-range algorithm)', () => {
  function inputContext(foeId: string, overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
    return {
      ...ctx(overrides),
      input: { actorIds: { target: [foeId] } },
    };
  }

  it('a supplied in-range foe passes both the input selector and the CHOOSE validator', () => {
    const context = inputContext('near'); // near(5,4) is d1 from hero(4,4)
    const viaSelector = selectActors({ kind: 'input', key: 'target', relation: 'foe', minimum: 1, maximum: 1, range: { kind: 'constant', value: 1 } }, context);
    expect(viaSelector.map((actor) => actor.id)).toEqual(['near']);
    const viaChoice = resolveChoice({ key: 'target', label: 'target', kind: 'actors', required: true, relation: 'foe', range: { kind: 'constant', value: 1 } }, context);
    expect(viaChoice).toEqual({ kind: 'actors', ids: ['near'] });
  });

  it('exact-range passes and one-past-range fails through BOTH paths with the same violation code', () => {
    // foe(8,4) is footprint distance 4 from hero(4,4): exact range 4 passes.
    const exact = inputContext('foe');
    const viaSelector = selectActors({ kind: 'input', key: 'target', relation: 'foe', minimum: 1, maximum: 1, range: { kind: 'constant', value: 4 } }, exact);
    expect(viaSelector.map((actor) => actor.id)).toEqual(['foe']);
    expect(resolveChoice({ key: 'target', label: 'target', kind: 'actors', required: true, relation: 'foe', range: { kind: 'constant', value: 4 } }, exact)).toEqual({ kind: 'actors', ids: ['foe'] });
    // Range 3: the input selector's legacy contract ENFORCES its range
    // (throws choice.actor-range), and CHOOSE throws the same code via
    // validateActorCandidate — the legality question is one authority.
    const past = inputContext('foe');
    expectViolationCode(() => selectActors({ kind: 'input', key: 'target', relation: 'foe', minimum: 1, maximum: 1, range: { kind: 'constant', value: 3 } }, past), 'choice.actor-range');
    expectViolationCode(() => resolveChoice({ key: 'target', label: 'target', kind: 'actors', required: true, relation: 'foe', range: { kind: 'constant', value: 3 } }, past), 'choice.actor-range');
  });

  it('a Size>1 mover measures the p.92 footprint distance identically through both paths', () => {
    // hero size 2 at (4,4) spans (4,4)-(5,5); foe(6,4) is footprint distance
    // 1 (edges touch) but anchor-to-anchor distance 2. Range 1 must PASS
    // through both the input selector and the CHOOSE validator — a second
    // anchor-only range algorithm would wrongly reject it.
    const wideActors = {
      ...ctx().state.actors,
      hero: { ...ctx().state.actors.hero, size: 2 },
      foe: { ...ctx().state.actors.foe, position: { x: 6, y: 4 } },
    };
    const wide = inputContext('foe', { state: { ...ctx().state, actors: wideActors } });
    const viaSelector = selectActors({ kind: 'input', key: 'target', relation: 'foe', minimum: 1, maximum: 1, range: { kind: 'constant', value: 1 } }, wide);
    expect(viaSelector.map((actor) => actor.id)).toEqual(['foe']);
    expect(resolveChoice({ key: 'target', label: 'target', kind: 'actors', required: true, relation: 'foe', range: { kind: 'constant', value: 1 } }, wide)).toEqual({ kind: 'actors', ids: ['foe'] });
    // One past the footprint edge fails through both paths.
    const pastWide = inputContext('foe', { state: { ...ctx().state, actors: wideActors } });
    expectViolationCode(() => selectActors({ kind: 'input', key: 'target', relation: 'foe', minimum: 1, maximum: 1, range: { kind: 'constant', value: 0 } }, pastWide), 'choice.actor-range');
    expectViolationCode(() => resolveChoice({ key: 'target', label: 'target', kind: 'actors', required: true, relation: 'foe', range: { kind: 'constant', value: 0 } }, pastWide), 'choice.actor-range');
  });
});
