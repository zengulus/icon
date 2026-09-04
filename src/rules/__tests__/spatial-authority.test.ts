import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { createEncounter, createFoe, executeCommand, hasLineOfSight } from '../encounter.js';
import { hasLineOfEffect, hasLineOfSight as kernelLineOfSight, hasLineOfSightBetween, lineOfSightCells, type SpatialLineView } from '../automation/primitives/line-of-sight.js';
import { computeSpatialArea, footprintCells, footprintsAdjacent, footprintDistance, footprintIntersectsCells } from '../automation/primitives/spatial-intent.js';
import { applyRuleMutations, encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { queryDirectTarget } from '../automation/primitives/targeting.js';
import type { RelationActor } from '../automation/primitives/roles.js';
import type { Position } from '../types.js';

/**
 * F1 spatial authority fixtures (ICON p.92 line of sight + Size footprints,
 * p.95 Burst X line-of-sight inclusion, p.96 AoE origin counting, p.109 line
 * of effect, p.290 large-foe area inclusion).
 *
 * The primitives are framework-independent (reducer EncounterState and rule
 * runtime RuleRuntimeState both satisfy the views), deterministic, and carry
 * no content source IDs — a future content row can only block LoS/LoE by
 * registering an explicit effect type, never by prose inference.
 */

const emptyView = (width = 10, height = 10): SpatialLineView => ({ grid: { width, height, terrain: [] } });

const terrainView = (terrain: { position: Position; type: string }[]): SpatialLineView => ({
  grid: { width: 10, height: 10, terrain },
});

/** Union view: base terrain + overlay effects, like the reducer adapter. */
function effectView(effects: { type: string; positions: Position[] }[]): SpatialLineView {
  const base = terrainView([]);
  return {
    ...base,
    terrainAt: (position) => {
      const types = new Set<string>();
      for (const effect of effects) {
        if (effect.positions.some((cell) => cell.x === position.x && cell.y === position.y)) types.add(effect.type);
      }
      return types;
    },
  };
}

describe('shared line of sight (ICON p.92)', () => {
  it('same space and adjacent spaces always have line of sight', () => {
    expect(kernelLineOfSight(emptyView(), { x: 3, y: 3 }, { x: 3, y: 3 })).toBe(true);
    expect(kernelLineOfSight(emptyView(), { x: 3, y: 3 }, { x: 4, y: 3 })).toBe(true);
    expect(kernelLineOfSight(emptyView(), { x: 3, y: 3 }, { x: 4, y: 4 })).toBe(true);
  });

  it('unobstructed long lines keep line of sight', () => {
    expect(kernelLineOfSight(emptyView(), { x: 0, y: 0 }, { x: 9, y: 9 })).toBe(true);
    expect(kernelLineOfSight(emptyView(), { x: 0, y: 0 }, { x: 9, y: 0 })).toBe(true);
  });

  it('impassable terrain between the spaces blocks line of sight', () => {
    const view = terrainView([
      { position: { x: 2, y: 0 }, type: 'impassable' },
    ]);
    expect(kernelLineOfSight(view, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('Size>1 LoS is existential over the occupied footprint, not anchor-only (p.92)', () => {
    // Size 2 at (1,1) occupies (1,1)-(2,2). The wall blocks the canonical
    // anchor's horizontal trace to (5,1), but the non-anchor cell (2,2) has a
    // clear trace. P.92 permits a trace from any edge of the character's
    // space, so the footprint frame has LoS.
    const partlyBlocked = terrainView([{ position: { x: 3, y: 1 }, type: 'impassable' }]);
    expect(kernelLineOfSight(partlyBlocked, { x: 1, y: 1 }, { x: 5, y: 1 })).toBe(false);
    expect(hasLineOfSightBetween(
      partlyBlocked,
      { position: { x: 1, y: 1 }, size: 2 },
      { position: { x: 5, y: 1 }, size: 1 },
    )).toBe(true);

    // Closing both rows proves the existential frame still fails when every
    // footprint trace is blocked.
    const fullyBlocked = terrainView([
      { position: { x: 3, y: 1 }, type: 'impassable' },
      { position: { x: 3, y: 2 }, type: 'impassable' },
    ]);
    expect(hasLineOfSightBetween(
      fullyBlocked,
      { position: { x: 1, y: 1 }, size: 2 },
      { position: { x: 5, y: 1 }, size: 1 },
    )).toBe(false);

    // The same existential rule applies to the other character's footprint:
    // its anchor can be hidden while a different occupied cell remains clear.
    const targetEdgeClear = terrainView([{ position: { x: 2, y: 1 }, type: 'impassable' }]);
    expect(kernelLineOfSight(targetEdgeClear, { x: 1, y: 1 }, { x: 3, y: 2 })).toBe(false);
    expect(hasLineOfSightBetween(
      targetEdgeClear,
      { position: { x: 1, y: 1 }, size: 1 },
      { position: { x: 3, y: 2 }, size: 2 },
    )).toBe(true);
  });

  it('runtime-created impassable terrain blocks line of sight without explicit-blocker registration', () => {
    // Hellerwind-style terrain is a live terrain effect, not a map-authored
    // grid cell. Its semantic `impassable` property is sufficient under p.92.
    const view = effectView([{ type: 'impassable', positions: [{ x: 2, y: 0 }] }]);
    expect(kernelLineOfSight(view, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
  });

  it('terrain away from the straight line does not block', () => {
    const view = terrainView([
      { position: { x: 2, y: 1 }, type: 'impassable' },
    ]);
    expect(kernelLineOfSight(view, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('ordinary base and live terrain do not block by default (p.92)', () => {
    const view = terrainView([
      { position: { x: 2, y: 0 }, type: 'difficult' },
      { position: { x: 3, y: 0 }, type: 'dangerous' },
    ]);
    expect(kernelLineOfSight(view, { x: 0, y: 0 }, { x: 5, y: 0 })).toBe(true);

    const liveView = effectView([
      { type: 'basic', positions: [{ x: 2, y: 0 }] },
      { type: 'difficult', positions: [{ x: 2, y: 0 }] },
      { type: 'dangerous', positions: [{ x: 2, y: 0 }] },
      { type: 'pit', positions: [{ x: 2, y: 0 }] },
      { type: 'slope', positions: [{ x: 2, y: 0 }] },
    ]);
    expect(kernelLineOfSight(liveView, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('an overlay effect blocks line of sight only when its type is explicitly registered (p.92 smog/poison clouds)', () => {
    const smog = effectView([{ type: 'smog', positions: [{ x: 2, y: 0 }] }]);
    // Non-impassable effects remain transparent unless explicitly registered.
    expect(kernelLineOfSight(smog, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    const view: SpatialLineView = { ...smog, lineOfSightBlockingEffectTypes: new Set(['smog']) };
    expect(kernelLineOfSight(view, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    // A different registered type cannot block a smog cell.
    const other: SpatialLineView = { ...smog, lineOfSightBlockingEffectTypes: new Set(['mist']) };
    expect(kernelLineOfSight(other, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });
});

describe('shared line of effect (ICON p.109)', () => {
  it('defaults to a clear path — nothing in the current catalog blocks line of effect', () => {
    const view = terrainView([{ position: { x: 2, y: 0 }, type: 'impassable' }]);
    // LoS is blocked but LoE is still clear: they are distinct gates.
    expect(kernelLineOfSight(view, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(hasLineOfEffect(view, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('a transparent forcefield blocks line of effect while sight remains (p.109 example)', () => {
    const field = effectView([{ type: 'forcefield', positions: [{ x: 2, y: 0 }] }]);
    expect(kernelLineOfSight(field, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    const view: SpatialLineView = { ...field, lineOfEffectBlockingEffectTypes: new Set(['forcefield']) };
    expect(hasLineOfEffect(view, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    // Unregistered effect types never block the path (closed negative).
    expect(hasLineOfEffect(field, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });
});

describe('lineOfSightCells — Burst X inclusion (p.95)', () => {
  it('includes only spaces in range and line of sight from the burst center', () => {
    // A wall at (2,1) sits directly between the center (2,2) and the cells
    // below it on the same column.
    const view = terrainView([{ position: { x: 2, y: 1 }, type: 'impassable' }]);
    const cells = lineOfSightCells(view, { x: 2, y: 2 }, 2);
    const has = (position: Position) => cells.some((cell) => cell.x === position.x && cell.y === position.y);
    // Clear cells.
    expect(has({ x: 2, y: 1 })).toBe(true); // the wall space itself, adjacent
    expect(has({ x: 3, y: 2 })).toBe(true);
    expect(has({ x: 4, y: 2 })).toBe(true);
    expect(has({ x: 3, y: 1 })).toBe(true);
    expect(has({ x: 3, y: 3 })).toBe(true);
    // The far side of the wall on the same column is shadowed, as is the
    // diagonal that passes through the wall cell.
    expect(has({ x: 2, y: 0 })).toBe(false);
    expect(has({ x: 1, y: 0 })).toBe(false);
  });
});

describe('Size footprints (ICON p.92, p.290)', () => {
  it('footprintCells is the deterministic N×N square anchored at the position cell', () => {
    expect(footprintCells({ x: 1, y: 1 }, 1)).toEqual([{ x: 1, y: 1 }]);
    expect(footprintCells({ x: 1, y: 1 }, 2)).toEqual([
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 },
    ]);
    expect(footprintCells({ x: 1, y: 1 }, 3)).toHaveLength(9);
  });

  it('footprintDistance equals the point Chebyshev metric for Size-1 actors', () => {
    expect(footprintDistance({ position: { x: 1, y: 1 } }, { position: { x: 4, y: 1 } })).toBe(3);
    expect(footprintDistance({ position: { x: 1, y: 1 } }, { position: { x: 3, y: 3 } })).toBe(2);
    expect(footprintDistance({ position: { x: 1, y: 1 } }, { position: { x: 1, y: 1 } })).toBe(0);
  });

  it('overlapping footprints have distance 0 and separated footprints keep the space gap (p.92)', () => {
    // Size-2 at (1,1) occupies (1,1)-(2,2); a Size-2 at (2,1) shares its (2,1)
    // column — the footprints overlap.
    expect(footprintDistance({ position: { x: 1, y: 1 }, size: 2 }, { position: { x: 2, y: 1 }, size: 2 })).toBe(0);
    // One space gap between (1,1)-(2,2) and (3,1)-(4,2).
    expect(footprintDistance({ position: { x: 1, y: 1 }, size: 2 }, { position: { x: 3, y: 1 }, size: 2 })).toBe(1);
  });

  it('footprintsAdjacent: Size-1 diagonal adjacency => engaged', () => {
    // Diagonal neighbors at Chebyshev distance 1
    expect(footprintsAdjacent({ position: { x: 1, y: 1 } }, { position: { x: 2, y: 2 } })).toBe(true);
    expect(footprintsAdjacent({ position: { x: 0, y: 0 } }, { position: { x: 1, y: 1 } })).toBe(true);
    // Not adjacent: Chebyshev distance > 1
    expect(footprintsAdjacent({ position: { x: 0, y: 0 } }, { position: { x: 2, y: 2 } })).toBe(false);
  });

  it('footprintsAdjacent: Size-2+ footprints touching diagonally => engaged', () => {
    // Two Size-2 actors whose corners touch diagonally:
    // A at (1,1) occupies (1,1)-(2,2); B at (3,3) occupies (3,3)-(4,4).
    // B cell (3,3) is Chebyshev distance 1 from A cell (2,2).
    expect(footprintsAdjacent({ position: { x: 1, y: 1 }, size: 2 }, { position: { x: 3, y: 3 }, size: 2 })).toBe(true);
    // Two Size-2 actors whose edges touch diagonally:
    // A at (0,0) occupies (0,0)-(1,1); B at (2,2) occupies (2,2)-(3,3).
    // B cell (2,2) is Chebyshev distance 1 from A cell (1,1).
    expect(footprintsAdjacent({ position: { x: 0, y: 0 }, size: 2 }, { position: { x: 2, y: 2 }, size: 2 })).toBe(true);
    // Separated by more than one cell:
    expect(footprintsAdjacent({ position: { x: 0, y: 0 }, size: 2 }, { position: { x: 3, y: 3 }, size: 2 })).toBe(false);
  });

  it('footprintsAdjacent: footprints separated by more than one cell => not engaged', () => {
    expect(footprintsAdjacent({ position: { x: 0, y: 0 } }, { position: { x: 3, y: 0 } })).toBe(false);
    expect(footprintsAdjacent({ position: { x: 0, y: 0 }, size: 2 }, { position: { x: 5, y: 5 }, size: 2 })).toBe(false);
  });

  it('footprintsAdjacent: overlap (the space underneath a character) counts as adjacent', () => {
    // Same Size-1 cell: the space under a character is adjacent to itself.
    expect(footprintsAdjacent({ position: { x: 2, y: 2 } }, { position: { x: 2, y: 2 } })).toBe(true);
    // Overlapping large footprints: two Size-2 actors sharing cells are
    // adjacent even though no edge-to-edge gap exists.
    // A at (1,1) occupies (1,1)-(2,2); B at (2,2) occupies (2,2)-(3,3).
    expect(footprintsAdjacent({ position: { x: 1, y: 1 }, size: 2 }, { position: { x: 2, y: 2 }, size: 2 })).toBe(true);
    // Touching large footprints (edges meet, no gap) are adjacent too.
    expect(footprintsAdjacent({ position: { x: 1, y: 1 }, size: 2 }, { position: { x: 3, y: 1 }, size: 2 })).toBe(true);
  });

  it('a large foe counts as inside an area when any footprint space is hit (p.290)', () => {
    const area = [{ x: 3, y: 1 }, { x: 3, y: 2 }];
    // Anchor at (2,1) is outside the area, but the (3,1) footprint space is hit.
    expect(footprintIntersectsCells({ position: { x: 2, y: 1 }, size: 2 }, area)).toBe(true);
    // Size-1 control at the same anchor cell is not hit.
    expect(footprintIntersectsCells({ position: { x: 2, y: 1 }, size: 1 }, area)).toBe(false);
  });
});

describe('computeSpatialArea — inclusion and center authority', () => {
  const source = { id: 'caster', position: { x: 0, y: 0 }, onBattlefield: true, defeated: false };

  it('the blast shape derives the EXACT template cells — the small template is a plus, not a radius square', () => {
    // ICON p.97: small blast = center + 4 orthogonal squares. A size-1 actor
    // diagonal to the center is OUTSIDE the small template but would be
    // inside a radius-1 burst square — the gateway must use the template.
    const diagonal = { id: 'diag', position: { x: 4, y: 3 }, onBattlefield: true, defeated: false };
    const orthogonal = { id: 'ortho', position: { x: 3, y: 2 }, onBattlefield: true, defeated: false };
    const small = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, diagonal, orthogonal },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'blast', blastSize: 'small',
      center: { x: 3, y: 2 }, radius: 0, requireCenterInBounds: true,
    });
    expect(small.legal).toBe(true);
    expect(small.includedActorIds).toContain('ortho'); // the (3,2) center cell is in the small template
    expect(small.includedActorIds).not.toContain('diag'); // (4,3) is diagonal to the center
    // The same center as a burst radius 1 is a 3×3 square and DOES include the
    // diagonal cell — the two shapes are provably distinct.
    const burst = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, diagonal, orthogonal },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 3, y: 2 }, radius: 1, requireCenterInBounds: true,
    });
    expect(burst.includedActorIds).toContain('diag');
  });

  it('includes a large foe whose footprint — not its anchor cell — lies in the burst (p.290)', () => {
    // Burst centered (3,2) r1 covers x∈[2,4], y∈[1,3]. The size-2 actor
    // anchored at (4,0) has its (4,1) space inside; its anchor is outside.
    const big = { id: 'big', position: { x: 4, y: 0 }, size: 2, onBattlefield: true, defeated: false };
    const small = { id: 'small', position: { x: 4, y: 0 }, size: 1, onBattlefield: true, defeated: false };
    const area = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, big, small },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 3, y: 2 }, radius: 1, requireCenterInBounds: true,
    });
    expect(area.legal).toBe(true);
    // The size-2 actor's (4,1) space is inside the burst; the size-1 control
    // at the same anchor cell is outside.
    expect(area.includedActorIds).toContain('big');
    expect(area.includedActorIds).not.toContain('small');
  });

  it('filters burst cells by line of sight from the center when asked (p.95)', () => {
    // Wall one space right of the center (4,2) shadows (6,2) on the same row.
    const wall = { position: { x: 5, y: 2 }, type: 'impassable' };
    const area = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [wall] },
      actors: { caster: source },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 4, y: 2 }, radius: 2, requireCenterInBounds: true,
      cellsRequireLineOfSightFromCenter: true,
    });
    expect(area.legal).toBe(true);
    const has = (position: Position) => area.cells.some((cell) => cell.x === position.x && cell.y === position.y);
    expect(has({ x: 4, y: 3 })).toBe(true);
    expect(has({ x: 5, y: 2 })).toBe(true); // the wall space itself, adjacent to the center
    expect(has({ x: 3, y: 2 })).toBe(true);
    // The far side of the wall on the center row is shadowed.
    expect(has({ x: 6, y: 2 })).toBe(false);
    // Without the flag the cells are the plain unclipped square.
    const plain = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [wall] },
      actors: { caster: source },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 4, y: 2 }, radius: 2, requireCenterInBounds: true,
    });
    expect(plain.cells.some((cell) => cell.x === 6 && cell.y === 2)).toBe(true);
  });

  it('filters AoE cells through runtime-created impassable terrain using the encounter semantic view', () => {
    let state = createEncounter('Runtime terrain AoE fixture');
    const caster = createFoe('Caster', { x: 0, y: 0 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: caster }).state;
    state.terrainEffects.push({
      id: 'runtime-wall', sourceId: 'fixture:runtime-impassable', ownerId: caster.id,
      terrain: 'impassable', positions: [{ x: 2, y: 0 }], height: null, duration: null,
    });

    const area = computeSpatialArea(encounterRuleState(state), {
      kind: 'area', sourceActorId: caster.id, sourceRuleId: 'fixture:area', shape: 'burst',
      center: caster.position, radius: 3, requireCenterInBounds: true,
      cellsRequireLineOfSightFromCenter: true,
    });
    const has = (position: Position) => area.cells.some((cell) => cell.x === position.x && cell.y === position.y);
    expect(has({ x: 2, y: 0 })).toBe(true); // the blocking terrain's own cell is visible
    expect(has({ x: 3, y: 0 })).toBe(false); // its far side is shadowed
  });

  it('measures the center range from the edge of a large caster footprint (p.92)', () => {
    const giant = { id: 'giant', position: { x: 0, y: 0 }, size: 2, onBattlefield: true, defeated: false };
    const area = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { giant },
    }, {
      kind: 'area', sourceActorId: 'giant', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 2, y: 0 }, radius: 1, requireCenterInBounds: true, maximumRangeFromSource: 1,
    });
    // The giant's footprint spans x∈[0,1]; the center at x=2 is one space from
    // its edge, so range 1 is legal — a point metric from the anchor would reject it.
    expect(area.legal).toBe(true);
  });

  it('requireFreeCenter: the center is occupied on a Size-2 anchor cell (p.92)', () => {
    const big = { id: 'big', position: { x: 1, y: 1 }, size: 2, onBattlefield: true, defeated: false };
    const area = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, big },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 1, y: 1 }, radius: 1, requireCenterInBounds: true, requireFreeCenter: true,
    });
    expect(area).toMatchObject({ legal: false, problem: 'occupied' });
  });

  it('requireFreeCenter: the center is occupied on a non-anchor Size-2 footprint cell', () => {
    // Big occupies (1,1)-(2,2); the center (2,2) is a footprint cell but not
    // the anchor — the sameCell(candidate.position, center) check used to
    // declare it free.
    const big = { id: 'big', position: { x: 1, y: 1 }, size: 2, onBattlefield: true, defeated: false };
    const area = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, big },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 2, y: 2 }, radius: 1, requireCenterInBounds: true, requireFreeCenter: true,
    });
    expect(area).toMatchObject({ legal: false, problem: 'occupied' });
  });

  it('requireFreeCenter: a center immediately outside a Size-2 footprint is free', () => {
    // Big occupies (1,1)-(2,2); (3,1) is one space past the footprint edge.
    // The center is legal even though the radius-1 burst still overlaps the
    // footprint's (2,1)/(2,2) cells — inclusion and center legality are
    // distinct gates.
    const big = { id: 'big', position: { x: 1, y: 1 }, size: 2, onBattlefield: true, defeated: false };
    const area = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, big },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 3, y: 1 }, radius: 1, requireCenterInBounds: true, requireFreeCenter: true,
    });
    expect(area).toMatchObject({ legal: true, problem: null });
  });

  it('requireFreeCenter: Size-1 behavior is unchanged', () => {
    const small = { id: 'small', position: { x: 1, y: 1 }, size: 1, onBattlefield: true, defeated: false };
    const blocked = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, small },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 1, y: 1 }, radius: 1, requireCenterInBounds: true, requireFreeCenter: true,
    });
    expect(blocked).toMatchObject({ legal: false, problem: 'occupied' });
    const free = computeSpatialArea({
      grid: { width: 10, height: 10, terrain: [] },
      actors: { caster: source, small },
    }, {
      kind: 'area', sourceActorId: 'caster', sourceRuleId: 'fixture', shape: 'burst',
      center: { x: 2, y: 1 }, radius: 1, requireCenterInBounds: true, requireFreeCenter: true,
    });
    expect(free.legal).toBe(true);
  });
});

describe('shoveResolution — footprint-aware shove authority (p.92)', () => {
  it('a Size-2 mover stops before its footprint leaves the grid', () => {
    let state = createEncounter('Shove bounds');
    const giant = createFoe('Giant', { x: 0, y: 1 });
    giant.size = 2;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: giant }).state;
    applyRuleMutations(state, [{
      kind: 'move', sourceId: 'fixture:shove', sourceActorId: giant.id, actorId: giant.id,
      movement: 'shove', distance: 10, positions: [], direction: { x: 1, y: 0 }, phasing: false,
    }]);
    // Anchor-only bounds would shove the anchor to x=9 with the footprint
    // (9,1)-(10,2) hanging off the 10-wide grid; footprint authority stops at
    // x=8 where the whole 2×2 footprint is still on the battlefield.
    expect(state.actors[giant.id].position).toEqual({ x: 8, y: 1 });
    // Size-1 control at the same anchor row reaches the edge exactly.
    const small = createFoe('Scout', { x: 0, y: 3 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: small }).state;
    applyRuleMutations(state, [{
      kind: 'move', sourceId: 'fixture:shove', sourceActorId: small.id, actorId: small.id,
      movement: 'shove', distance: 10, positions: [], direction: { x: 1, y: 0 }, phasing: false,
    }]);
    expect(state.actors[small.id].position).toEqual({ x: 9, y: 3 });
  });

  it('a Size-2 mover stops before its footprint enters another large footprint', () => {
    let state = createEncounter('Shove occupancy');
    const mover = createFoe('Mover', { x: 0, y: 0 });
    mover.size = 2;
    const blocker = createFoe('Blocker', { x: 4, y: 0 });
    blocker.size = 2;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: mover }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: blocker }).state;
    applyRuleMutations(state, [{
      kind: 'move', sourceId: 'fixture:shove', sourceActorId: mover.id, actorId: mover.id,
      movement: 'shove', distance: 10, positions: [], direction: { x: 1, y: 0 }, phasing: false,
    }]);
    // The blocker's footprint spans x∈[4,5]; the mover's next footprint at
    // anchor (3,0) would overlap it, so it stops at (2,0). An anchor-only
    // check would let it stop at (3,0) with its own (4,0) cell inside the
    // blocker.
    expect(state.actors[mover.id].position).toEqual({ x: 2, y: 0 });
  });
});

describe('queryDirectTarget — footprint-aware range (p.92)', () => {
  // The relation SOURCE is a U2-branded `RelationActor` (the relation operation
  // refuses a plain actor; production only derives it through the U2 producer).
  const source = { id: 'hero', side: 'heroes', position: { x: 5, y: 5 }, size: 1 } as RelationActor;

  it('a Size-2 foe within range by its area is a legal target even beyond point range', () => {
    // Foe footprint (3,3)-(4,4) — its (4,4) space is one space from the source.
    const bigFoe = { id: 'big', side: 'foes', position: { x: 3, y: 3 }, size: 2, defeated: false, onBattlefield: true };
    const result = queryDirectTarget(source, bigFoe, { relation: 'foe', maximumRange: 1 });
    expect(result.legal).toBe(true);
    expect(result.distance).toBe(1);

    // Control: a Size-1 foe at the same anchor cell is two spaces away.
    const smallFoe = { id: 'small', side: 'foes', position: { x: 3, y: 3 }, size: 1, defeated: false, onBattlefield: true };
    expect(queryDirectTarget(source, smallFoe, { relation: 'foe', maximumRange: 1 })).toMatchObject({ legal: false, problem: 'range', distance: 2 });
  });
});

describe('reducer routing — one line-of-sight truth', () => {
  it('encounter hasLineOfSight delegates base and runtime impassable terrain to the shared kernel', () => {
    let state = createEncounter('LoS routing fixture');
    const hero = createFoe('Sight witness', { x: 0, y: 0 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    expect(hasLineOfSight(state, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);

    state = {
      ...state,
      grid: { ...state.grid, terrain: [{ position: { x: 2, y: 0 }, type: 'impassable', elevation: 0 }] },
    };
    expect(hasLineOfSight(state, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);

    state = { ...state, grid: { ...state.grid, terrain: [] } };
    state.terrainEffects.push({
      id: 'runtime-wall', sourceId: 'fixture:runtime-impassable', ownerId: null,
      terrain: 'impassable', positions: [{ x: 2, y: 0 }], height: null, duration: null,
    });
    expect(hasLineOfSight(state, { x: 0, y: 0 }, { x: 3, y: 0 })).toBe(false);
  });
});
