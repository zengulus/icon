/**
 * reference.test.ts — the U1 REFERENCE underlay's (U1) semantic contract.
 *
 * The underlay is ONE typed way to name a thing a later rule clause refers
 * to, distinguishing LIVE refs (resolve against current state at use time)
 * from CAPTURED refs (durable literals determined earlier, never re-derived
 * from later state). Tests establish:
 *   - positive: a captured position resolves exactly (even after the actor
 *     moved); a live actor ref resolves its NEW position on a later turn;
 *     a bound name resolves through the Binder;
 *   - negative: an unbound name rejects; a captured ref never re-reads
 *     later state;
 *   - boundary: empty collection; a captured defeated-actor ref stays
 *     resolvable (identity was captured) while a live slot read of an
 *     absent slot rejects;
 *   - replay: resolving a captured position twice yields the identical
 *     literal regardless of intervening state changes.
 */
import { describe, expect, it } from 'vitest';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import {
  bind, capturedActor, capturedPosition, EMPTY_BINDER, liveActorBound, liveActorSlot,
  referenceCollection, resolveReference,
} from '../automation/primitives/reference.js';

function ctx(overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  return {
    state: {
      round: 1,
      grid: { width: 24, height: 24 },
      actors: {
        hero: { id: 'hero', side: 'heroes', position: { x: 4, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
        foe: { id: 'foe', side: 'foes', position: { x: 8, y: 4 }, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2, damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [], size: 1, defeated: false, resources: {}, conditions: new Set(), state: {}, statuses: [], statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 }, marks: [] },
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
    dice: { die: () => 1 },
    ...overrides,
  };
}

describe('U1 REFERENCE — CAPTURED refs are durable literals', () => {
  it('positive: a captured position resolves exactly, even after the actor moved', () => {
    const context = ctx();
    const landing = capturedPosition({ x: 3, y: 2 });
    // The actor moves before the later clause resolves.
    context.state.actors.hero.position = { x: 9, y: 9 };
    const resolution = resolveReference(landing, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok) expect(resolution.value).toEqual({ kind: 'position', position: { x: 3, y: 2 } });
  });

  it('negative: a captured ref never re-reads later state', () => {
    const context = ctx();
    const landing = capturedPosition({ x: 3, y: 2 });
    const first = resolveReference(landing, context);
    context.state.actors.hero.position = { x: 9, y: 9 };
    const second = resolveReference(landing, context);
    expect(first).toEqual(second);
    if (first.ok && second.ok && first.value.kind === 'position' && second.value.kind === 'position') {
      expect(second.value.position).toEqual(first.value.position);
    }
  });

  it('boundary: a captured defeated-actor ref stays resolvable (identity was captured)', () => {
    const context = ctx();
    context.state.actors.foe.defeated = true;
    const ref = capturedActor('foe');
    const resolution = resolveReference(ref, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'actor') expect(resolution.value.actor.id).toBe('foe');
  });

  it('replay: resolving the captured position twice yields the identical literal', () => {
    const context = ctx();
    const ref = capturedPosition({ x: 7, y: 1 });
    const first = resolveReference(ref, context);
    const second = resolveReference(ref, context);
    expect(second).toEqual(first);
  });
});

describe('U1 REFERENCE — LIVE refs re-resolve against current state', () => {
  it('positive: a live actor ref resolves its NEW position on a later turn', () => {
    const context = ctx();
    const ref = liveActorSlot('source');
    context.state.actors.hero.position = { x: 6, y: 6 };
    const resolution = resolveReference(ref, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'actor') {
      expect(resolution.value.actor.position).toEqual({ x: 6, y: 6 });
    }
  });

  it('positive: a live position read tracks the actor\'s current cell', () => {
    const context = ctx();
    const ref = { kind: 'live' as const, domain: 'position' as const, name: { kind: 'id' as const, id: 'hero' } };
    context.state.actors.hero.position = { x: 2, y: 2 };
    const resolution = resolveReference(ref, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'position') {
      expect(resolution.value.position).toEqual({ x: 2, y: 2 });
    }
  });

  it('negative: a live actor ref to a missing actor rejects', () => {
    const context = ctx();
    const resolution = resolveReference({ kind: 'live', domain: 'actor', name: { kind: 'id', id: 'nobody' } }, context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('missing-actor');
  });

  it('negative: an absent legacy slot rejects (no silent default)', () => {
    const context = ctx(); // no attackTargetId
    const resolution = resolveReference(liveActorSlot('attack-target'), context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('missing-slot');
  });

  it('boundary: a position-less actor rejects a live position read', () => {
    const context = ctx();
    context.state.actors.hero.position = null;
    const resolution = resolveReference({ kind: 'live', domain: 'position', name: { kind: 'id', id: 'hero' } }, context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('actor-without-position');
  });
});

describe('U1 REFERENCE — Binder and collections', () => {
  it('positive: a bound name resolves through the Binder (BIND a chosen position AS landing)', () => {
    const context = ctx();
    const bound = bind(EMPTY_BINDER, 'landing', capturedPosition({ x: 5, y: 5 }));
    context.boundNames = bound;
    const resolution = resolveReference({ kind: 'live', domain: 'position', name: { kind: 'bound', name: 'landing' } }, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'position') {
      expect(resolution.value.position).toEqual({ x: 5, y: 5 });
    }
  });

  it('negative: an unbound name rejects (unknown-bound-name)', () => {
    const context = ctx();
    const resolution = resolveReference(liveActorBound('nobody'), context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('unknown-bound-name');
  });

  it('boundary: an empty collection resolves to an empty collection', () => {
    const context = ctx();
    const resolution = resolveReference(referenceCollection([]), context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'collection') expect(resolution.value.items).toEqual([]);
  });

  it('positive: a collection of refs resolves item-by-item (BIND slain actors AS slain)', () => {
    const context = ctx();
    const resolution = resolveReference(referenceCollection([capturedActor('hero'), capturedActor('foe')]), context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'collection') {
      expect(resolution.value.items.map((item) => (item.kind === 'actor' ? item.actor.id : '?')).sort())
        .toEqual(['foe', 'hero']);
    }
  });
});
