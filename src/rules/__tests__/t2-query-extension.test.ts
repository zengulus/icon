/**
 * t2-query-extension.test.ts — Phase T2 U3 QUERY extensions.
 *
 * The actor-domain operator list is completed (line of sight / line of
 * effect composition from the query's anchor, occupying-position, terrain
 * predicate, owned-by, set composition with distinct-by-identity), and the
 * entity + terrain query domains land beside the existing actor/position
 * domains. The p.108 placement-legality boundary (line of sight for
 * summoning/teleporting/creating objects) is resolved through the shared
 * position-legality operator + the generic position query policy — never
 * bolted onto one resolver.
 *
 * Determinism: every operator is a pure function of state, so each query is
 * evaluated twice and asserted identical (the replay property).
 */
import { describe, expect, it } from 'vitest';
import type { RuleActorView, RuleExecutionContext } from '../automation/primitives/types.js';
import type { Position } from '../types.js';
import {
  composeActorQueries,
  evaluateActorQuery,
  evaluateEntityQuery,
  evaluatePositions,
  evaluateTerrainCells,
  validatePositionLegality,
} from '../automation/kernels/evaluate-query.js';
import { resolveSpatialAnchor } from '../automation/kernels/candidate.js';
import { anchorFromActorSelector } from '../automation/primitives/anchor.js';

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

/** A context whose terrain union is exactly the declared cells. */
function terrainCtx(cells: Array<{ position: Position; types: string[] }>, overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  const base = ctx(overrides);
  return {
    ...base,
    state: {
      ...base.state,
      terrainAt: (position: Position) => new Set(
        cells.filter((cell) => cell.position.x === position.x && cell.position.y === position.y)
          .flatMap((cell) => cell.types),
      ),
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
        beast: { id: 'beast', type: 'beast', ownerId: 'hero', positions: [{ x: 7, y: 4 }], state: { actorId: 'summon1' } },
        wisp: { id: 'wisp', type: 'wisp', ownerId: 'ally', positions: [{ x: 11, y: 4 }], state: { actorId: 'summon1' } },
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

describe('U3 actor-domain operators — line of sight / effect composition', () => {
  // hero(4,4); wall at (5,4); foeBehind(6,4) is beyond the wall; foeClear(6,6)
  // is diagonally clear (the sampled line passes only (5,5)).
  const blocked = terrainCtx([{ position: { x: 5, y: 4 }, types: ['impassable'] }], {
    state: {
      ...ctx().state,
      actors: {
        ...ctx().state.actors,
        foeBehind: actorView('foeBehind', 'foes', { x: 6, y: 4 }),
        foeClear: actorView('foeClear', 'foes', { x: 6, y: 6 }),
      },
    },
  });

  it('lineOfSight excludes actors whose line passes through impassable terrain (p.92 composed as a query operator)', () => {
    const context = blocked;
    const sight = evaluateActorQuery({ relation: 'foe', lineOfSight: true }, context).map((a) => a.id).sort();
    expect(sight).toContain('foeClear');
    expect(sight).not.toContain('foeBehind');
    // Determinism: evaluating the same query twice yields the same set.
    const again = evaluateActorQuery({ relation: 'foe', lineOfSight: true }, context).map((a) => a.id).sort();
    expect(again).toEqual(sight);
  });

  it('lineOfEffect is a DISTINCT gate: impassable terrain blocks sight but not effect (p.109)', () => {
    const context = blocked;
    // LoE is blocked only by effects that explicitly block it (transparent
    // forcefields/windows) — nothing in the catalog creates such an effect,
    // so the foe behind the wall keeps line of effect.
    const effect = evaluateActorQuery({ relation: 'foe', lineOfEffect: true }, context).map((a) => a.id);
    expect(effect).toContain('foeBehind');
  });

  it('line of sight is measured from the query ANCHOR, not the acting actor (U7 frame)', () => {
    // Anchor = the ally at (7,4). Wall at (9,5): foeNear(8,4) is clear from
    // the ally; foeFar(10,6) is behind the wall from the ally (the sampled
    // line passes (9,5)) but clear from the hero at (4,4) (whose line passes
    // (8,5)/(9,6), never (9,5)).
    const context = terrainCtx([{ position: { x: 9, y: 5 }, types: ['impassable'] }], {
      state: {
        ...ctx().state,
        actors: {
          ...ctx().state.actors,
          ally: actorView('ally', 'heroes', { x: 7, y: 4 }),
          foeNear: actorView('foeNear', 'foes', { x: 8, y: 4 }),
          foeFar: actorView('foeFar', 'foes', { x: 10, y: 6 }),
        },
      },
      input: { actorIds: { anchor: ['ally'] } },
    });
    const fromAlly = evaluateActorQuery(
      { relation: 'foe', lineOfSight: true, rangeOrigin: anchorFromActorSelector({ kind: 'input', key: 'anchor' }, context)! },
      context,
    ).map((a) => a.id).sort();
    expect(fromAlly).toContain('foeNear');
    expect(fromAlly).not.toContain('foeFar');
    // From the acting actor (default anchor) foeFar keeps a clear line.
    const fromSelf = evaluateActorQuery({ relation: 'foe', lineOfSight: true }, context).map((a) => a.id).sort();
    expect(fromSelf).toContain('foeFar');
  });

  it('actor-query LoS retains both Size>1 source and target frames', () => {
    const base = ctx();
    const context = terrainCtx([{ position: { x: 6, y: 4 }, types: ['impassable'] }], {
      state: {
        ...base.state,
        actors: {
          hero: actorView('hero', 'heroes', { x: 4, y: 4 }, { size: 2 }),
          foe: actorView('foe', 'foes', { x: 8, y: 4 }, { size: 2 }),
        },
      },
    });
    // Anchor-to-anchor is blocked, but alternate occupied cells retain a
    // clear p.92 trace. The actor query must not collapse either frame.
    expect(evaluateActorQuery({ relation: 'foe', lineOfSight: true }, context).map(({ id }) => id))
      .toEqual(['foe']);
  });
});

describe('U3 actor-domain operators — occupying, terrain predicate, owned-by', () => {
  it('occupying: only actors whose footprint contains the space', () => {
    const context = ctx();
    const atNear = evaluateActorQuery({ relation: 'any', occupying: { position: { x: 5, y: 4 } } }, context).map((a) => a.id);
    expect(atNear).toEqual(['near']);
    // A Size-2 actor counts through any footprint cell (p.92).
    const withBig = {
      ...ctx(),
      state: { ...ctx().state, actors: { ...ctx().state.actors, big: actorView('big', 'foes', { x: 7, y: 5 }, { size: 2 }) } },
    };
    const atBigEdge = evaluateActorQuery({ relation: 'any', occupying: { position: { x: 8, y: 6 } } }, withBig).map((a) => a.id);
    expect(atBigEdge).toEqual(['big']);
  });

  it('onTerrain: only actors standing on a cell whose terrain union contains the type', () => {
    const context = terrainCtx([
      { position: { x: 5, y: 4 }, types: ['pit'] },
      { position: { x: 8, y: 4 }, types: ['pit'] },
    ]);
    const ids = evaluateActorQuery({ relation: 'any', onTerrain: 'pit' }, context).map((a) => a.id).sort();
    expect(ids).toEqual(['foe', 'near']);
  });

  it('ownedBy: the summon filter accepts an explicit owning actor id', () => {
    const context = ctx();
    // beast (owner hero) and wisp (owner ally) both resolve to summon1.
    const ownedByAlly = evaluateActorQuery({ relation: 'any', summon: { owner: { actorId: 'ally' } } }, context).map((a) => a.id);
    expect(ownedByAlly).toEqual(['summon1']);
    const ownedByHero = evaluateActorQuery({ relation: 'any', summon: { owner: { actorId: 'hero' } } }, context).map((a) => a.id);
    expect(ownedByHero).toEqual(['summon1']);
    const ownedByNobody = evaluateActorQuery({ relation: 'any', summon: { owner: { actorId: 'allyFar' } } }, context);
    expect(ownedByNobody).toEqual([]);
  });
});

describe('U3 set composition — union / intersection / difference over actor queries', () => {
  it('union de-duplicates by identity and preserves first-seen order', () => {
    const context = ctx();
    // near is d1; ally is d2. The union of "foes in range 1" and "allies" is
    // [near] ∪ [ally, allyFar] — no duplicates, order follows the first query.
    const union = composeActorQueries({
      operator: 'union',
      queries: [
        { relation: 'foe', range: 1 },
        { relation: 'ally' },
      ],
    }, context).map((a) => a.id);
    // Allies are [ally, allyFar, summon1] (summon1 is on the heroes side);
    // union with the d1 foe adds near — no duplicates, first-seen order.
    expect(union).toEqual(['near', 'ally', 'allyFar', 'summon1']);
    // Determinism (replay property).
    const again = composeActorQueries({
      operator: 'union',
      queries: [
        { relation: 'foe', range: 1 },
        { relation: 'ally' },
      ],
    }, context).map((a) => a.id);
    expect(again).toEqual(union);
  });

  it('intersection keeps only ids present in every member query', () => {
    const context = ctx();
    // "foes" ∩ "within range 2 of the hero" = { near }.
    const intersection = composeActorQueries({
      operator: 'intersection',
      queries: [
        { relation: 'foe' },
        { relation: 'any', origins: [context.state.actors.hero], originDistance: 2 },
      ],
    }, context).map((a) => a.id);
    expect(intersection).toEqual(['near']);
  });

  it('difference removes the later queries\' ids from the first', () => {
    const context = ctx();
    // All foes minus the marked one.
    const difference = composeActorQueries({
      operator: 'difference',
      queries: [
        { relation: 'foe' },
        { mark: { markId: 'm1' } },
      ],
    }, context).map((a) => a.id).sort();
    expect(difference).toEqual(['foe', 'near', 'slashed']);
  });

  it('the same actor under several member queries is never duplicated (distinct-by-identity)', () => {
    const context = ctx();
    const union = composeActorQueries({
      operator: 'union',
      queries: [
        { relation: 'foe' },
        { relation: 'foe' },
        { conditionId: 'slashed' },
      ],
    }, context).map((a) => a.id).sort();
    expect(union).toEqual(['foe', 'marked', 'near', 'slashed']);
    expect(new Set(union).size).toBe(union.length);
  });
});

describe('U3 entity domain — evaluateEntityQuery', () => {
  it('owner filter: self / explicit id / any', () => {
    const context = ctx();
    const selfOwned = evaluateEntityQuery({ owner: { kind: 'self' } }, context).map((e) => e.id);
    expect(selfOwned).toEqual(['beast']);
    const allyOwned = evaluateEntityQuery({ owner: { kind: 'id', actorId: 'ally' } }, context).map((e) => e.id);
    expect(allyOwned).toEqual(['wisp']);
    const anyOwned = evaluateEntityQuery({ owner: { kind: 'any' } }, context).map((e) => e.id).sort();
    expect(anyOwned).toEqual(['beast', 'wisp']);
  });

  it('entityType filter', () => {
    expect(evaluateEntityQuery({ entityType: 'wisp' }, ctx()).map((e) => e.id)).toEqual(['wisp']);
  });

  it('range from a U7 anchor (captured position) uses the p.92 footprint metric', () => {
    const context = ctx();
    // beast at (7,4) is distance 1 from the captured anchor (6,4); wisp at
    // (11,4) is distance 5.
    const near = evaluateEntityQuery({
      rangeOrigin: { kind: 'captured-position', position: { x: 6, y: 4 } },
      range: 1,
    }, context).map((e) => e.id);
    expect(near).toEqual(['beast']);
    const far = evaluateEntityQuery({
      rangeOrigin: { kind: 'captured-position', position: { x: 6, y: 4 } },
      range: 0,
    }, context).map((e) => e.id);
    expect(far).toEqual([]);
    // Determinism.
    const again = evaluateEntityQuery({
      rangeOrigin: { kind: 'captured-position', position: { x: 6, y: 4 } },
      range: 1,
    }, context).map((e) => e.id);
    expect(again).toEqual(['beast']);
  });

  it('range from an ENTITY anchor resolves the entity footprint (U7)', () => {
    const context = ctx();
    // Anchor = the beast at (7,4); the wisp at (11,4) is distance 4 away.
    const near = evaluateEntityQuery({
      rangeOrigin: { kind: 'entity', entityId: 'beast' },
      range: 1,
    }, context).map((e) => e.id);
    expect(near).toEqual(['beast']);
    const wide = evaluateEntityQuery({
      rangeOrigin: { kind: 'entity', entityId: 'beast' },
      range: 4,
    }, context).map((e) => e.id).sort();
    expect(wide).toEqual(['beast', 'wisp']);
  });

  it('a missing entity anchor fails closed', () => {
    expect(() => evaluateEntityQuery({ rangeOrigin: { kind: 'entity', entityId: 'nope' } }, ctx()))
      .toThrowError(expect.objectContaining({ code: 'selector.entity-missing' }));
  });

  it('atPosition: the occupying-position read for the entity domain', () => {
    const context = ctx();
    const atBeastCell = evaluateEntityQuery({ atPosition: { x: 7, y: 4 } }, context).map((e) => e.id);
    expect(atBeastCell).toEqual(['beast']);
  });

  it('range and atPosition consume every cell of a multi-cell entity region', () => {
    const base = ctx();
    const context: RuleExecutionContext = {
      ...base,
      state: {
        ...base.state,
        entities: {
          ...base.state.entities,
          wall: {
            id: 'wall', type: 'unlisted-wall', kind: 'object', ownerId: 'hero',
            positions: [{ x: 12, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 }], state: {},
          },
        },
      },
    };
    expect(evaluateEntityQuery({
      entityType: 'unlisted-wall',
      rangeOrigin: { kind: 'captured-position', position: { x: 5, y: 4 } },
      range: 1,
    }, context).map((entity) => entity.id)).toEqual(['wall']);
    expect(evaluateEntityQuery({ atPosition: { x: 6, y: 5 } }, context).map((entity) => entity.id)).toContain('wall');
    expect(evaluateEntityQuery({ entityType: 'unlisted-wall' }, context)[0]?.positions).toEqual([
      { x: 12, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 },
    ]);
  });
});

describe('U3 terrain domain — evaluateTerrainCells', () => {
  it('returns every in-grid cell within radius whose terrain union contains the type', () => {
    const context = terrainCtx([
      { position: { x: 5, y: 4 }, types: ['pit'] },
      { position: { x: 5, y: 5 }, types: ['pit', 'rampart'] },
    ]);
    const cells = evaluateTerrainCells({ origin: { x: 4, y: 4 }, radius: 2, terrain: 'pit' }, context)
      .map((cell) => `${cell.x},${cell.y}`)
      .sort();
    expect(cells).toEqual(['5,4', '5,5']);
    const rampart = evaluateTerrainCells({ origin: { x: 4, y: 4 }, radius: 2, terrain: 'rampart' }, context)
      .map((cell) => `${cell.x},${cell.y}`);
    expect(rampart).toEqual(['5,5']);
  });

  it('deterministic ordering only when requested', () => {
    const context = terrainCtx([
      { position: { x: 5, y: 4 }, types: ['pit'] },
      { position: { x: 6, y: 4 }, types: ['pit'] },
    ]);
    const ordered = evaluateTerrainCells(
      { origin: { x: 4, y: 4 }, radius: 3, terrain: 'pit', ordering: { kind: 'distance-from-origin' } },
      context,
    );
    expect(ordered).toEqual([{ x: 5, y: 4 }, { x: 6, y: 4 }]);
  });
});

describe('U3 position domain — the p.108 line-of-sight policy and the footprint origin', () => {
  it('evaluatePositions excludes cells without line of sight from the declared origin (p.108 policy)', () => {
    // Origin (4,4), wall at (5,4): the cell (6,4) behind the wall is
    // excluded; (6,6) keeps a clear diagonal.
    const context = terrainCtx([{ position: { x: 5, y: 4 }, types: ['impassable'] }]);
    const visible = evaluatePositions(
      { origin: { x: 4, y: 4 }, radius: 2, space: { kind: 'any' }, lineOfSightFrom: { position: { x: 4, y: 4 }, size: 1 } },
      context,
    ).map((cell) => `${cell.x},${cell.y}`);
    expect(visible).not.toContain('6,4');
    expect(visible).toContain('6,6');
    // Determinism.
    const again = evaluatePositions(
      { origin: { x: 4, y: 4 }, radius: 2, space: { kind: 'any' }, lineOfSightFrom: { position: { x: 4, y: 4 }, size: 1 } },
      context,
    ).map((cell) => `${cell.x},${cell.y}`);
    expect(again).toEqual(visible);
  });

  it('validatePositionLegality: a destination behind impassable terrain reports line-of-sight (p.108)', () => {
    // A minimal empty grid: hero(4,4), wall at (5,4). The destination (6,4)
    // is in-grid, within range 2, and unoccupied — only the p.108 line of
    // sight rejects it.
    const context = terrainCtx([{ position: { x: 5, y: 4 }, types: ['impassable'] }], {
      state: {
        ...ctx().state,
        actors: { hero: ctx().state.actors.hero },
      },
    });
    const query = { origin: { x: 4, y: 4 }, range: 2, lineOfSightFrom: { position: { x: 4, y: 4 }, size: 1 } };
    expect(validatePositionLegality(query, { x: 6, y: 4 }, context)).toEqual({ legal: false, problem: 'line-of-sight' });
    expect(validatePositionLegality(query, { x: 6, y: 6 }, context)).toEqual({ legal: true, problem: null });
  });

  it('position queries and legality accept LoS from any cell of a Size-2 U7 frame', () => {
    const base = ctx();
    const context = terrainCtx([{ position: { x: 6, y: 4 }, types: ['impassable'] }], {
      state: {
        ...base.state,
        actors: { hero: actorView('hero', 'heroes', { x: 4, y: 4 }, { size: 2 }) },
      },
    });
    const pointFrame = { position: { x: 4, y: 4 }, size: 1 };
    const actorFrame = { position: { x: 4, y: 4 }, size: 2 };
    const destination = { x: 8, y: 4 };
    expect(evaluatePositions({ origin: { x: 4, y: 4 }, originSize: 2, radius: 3, space: { kind: 'any' }, lineOfSightFrom: pointFrame }, context))
      .not.toContainEqual(destination);
    expect(evaluatePositions({ origin: { x: 4, y: 4 }, originSize: 2, radius: 3, space: { kind: 'any' }, lineOfSightFrom: actorFrame }, context))
      .toContainEqual(destination);
    expect(validatePositionLegality({ origin: { x: 4, y: 4 }, originSize: 2, range: 3, excludeActorId: 'hero', lineOfSightFrom: pointFrame }, destination, context))
      .toEqual({ legal: false, problem: 'line-of-sight' });
    expect(validatePositionLegality({ origin: { x: 4, y: 4 }, originSize: 2, range: 3, excludeActorId: 'hero', lineOfSightFrom: actorFrame }, destination, context))
      .toEqual({ legal: true, problem: null });
  });

  it('validatePositionLegality: originSize measures the p.92 footprint (a Size>1 origin edge)', () => {
    const context = ctx();
    // Origin (4,4) size 2 spans (4,4)-(5,5); (4,6) touches the footprint edge
    // (distance 1) but is anchor-distance 2 — and it is empty.
    const point = validatePositionLegality({ origin: { x: 4, y: 4 }, range: 1 }, { x: 4, y: 6 }, context);
    expect(point).toEqual({ legal: false, problem: 'range' });
    const footprint = validatePositionLegality({ origin: { x: 4, y: 4 }, originSize: 2, range: 1 }, { x: 4, y: 6 }, context);
    expect(footprint).toEqual({ legal: true, problem: null });
  });

  it('resolveSpatialAnchor resolves an entity footprint anchor (U7)', () => {
    expect(resolveSpatialAnchor({ kind: 'entity', entityId: 'beast' }, ctx())).toEqual({ position: { x: 7, y: 4 }, size: 1 });
  });

  it('a malformed entity anchor fails closed through the anchor authority', () => {
    expect(() => resolveSpatialAnchor({ kind: 'entity', entityId: 'missing' }, ctx()))
      .toThrowError(expect.objectContaining({ code: 'selector.entity-missing' }));
  });
});
