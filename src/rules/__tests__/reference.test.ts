/**
 * reference.test.ts — the U1 REFERENCE underlay's semantic contract.
 *
 * The underlay is ONE typed way to name a thing a later rule clause refers
 * to, distinguishing LIVE refs (resolve against current state at use time)
 * from CAPTURED refs (durable literals determined earlier, never re-derived
 * from later state). Corrective pass (2026-08-30):
 *   - captured refs are SELF-DESCRIBING kinds: a captured actor structurally
 *     cannot contain a position literal; a captured position cannot contain
 *     an actor id;
 *   - a bound name must resolve to the DECLARED domain — a bound actor ref
 *     resolving to a bound position is domain-mismatch (reject/);
 *   - the plural trigger-targets slot resolves as an ORDERED COLLECTION of
 *     every target, never one arbitrary member; an absent slot is a
 *     legitimate EMPTY collection, distinct from a missing singular slot;
 *   - the Binder is pure/immutable and resolution is replay-deterministic;
 *   - captured durability after movement, live re-read of current state, and
 *     captured defeated-actor identity remain.
 */
import { describe, expect, it } from 'vitest';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import {
  actorReferenceForSelector, bind, capturedActor, capturedEntity, capturedPosition, capturedValue, EMPTY_BINDER, liveActorBound, liveActorSlot,
  liveRef, liveTriggerTargets, referenceCollection, resolveActorSelectorReference, resolveReference,
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

describe('U1 REFERENCE — captured refs are durable, self-describing literals', () => {
  it('positive: a captured position resolves exactly, even after the actor moved', () => {
    const context = ctx();
    const landing = capturedPosition({ x: 3, y: 2 });
    // The actor moves before the later clause resolves.
    context.state.actors.hero.position = { x: 9, y: 9 };
    const resolution = resolveReference(landing, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'position') expect(resolution.value.position).toEqual({ x: 3, y: 2 });
  });

  it('1, 2: a captured actor structurally cannot hold a position, and a captured position structurally cannot hold an actor id', () => {
    // The captured literals are SELF-DESCRIBING kinds: the actor literal
    // carries only an actorId; the position literal carries only a Position.
    const actorRef = capturedActor('foe');
    expect(actorRef).toEqual({ kind: 'captured-actor', actorId: 'foe' });
    expect('position' in actorRef).toBe(false);

    const positionRef = capturedPosition({ x: 3, y: 2 });
    expect(positionRef).toEqual({ kind: 'captured-position', position: { x: 3, y: 2 } });
    expect('actorId' in positionRef).toBe(false);

    // Entity, value literals are the same discipline.
    expect(capturedEntity('shrine')).toEqual({ kind: 'captured-entity', entityId: 'shrine' });
    expect(capturedValue(7)).toEqual({ kind: 'captured-value', value: 7 });
  });

  it('negative: a captured ref never re-reads later state', () => {
    const context = ctx();
    const landing = capturedPosition({ x: 3, y: 2 });
    const first = resolveReference(landing, context);
    context.state.actors.hero.position = { x: 9, y: 9 };
    const second = resolveReference(landing, context);
    expect(first).toEqual(second);
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
    expect(resolveReference(ref, context)).toEqual(resolveReference(ref, context));
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
    const ref = liveRef('position', { kind: 'id', id: 'hero' });
    context.state.actors.hero.position = { x: 2, y: 2 };
    const resolution = resolveReference(ref, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'position') {
      expect(resolution.value.position).toEqual({ x: 2, y: 2 });
    }
  });

  it('negative: a live actor ref to a missing actor rejects', () => {
    const context = ctx();
    const resolution = resolveReference(liveRef('actor', { kind: 'id', id: 'nobody' }), context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('missing-actor');
  });

  it('negative: an absent singular legacy slot rejects (no silent default)', () => {
    const context = ctx(); // no attackTargetId
    const resolution = resolveReference(liveActorSlot('attack-target'), context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('missing-slot');
  });

  it('boundary: a position-less actor rejects a live position read', () => {
    const context = ctx();
    context.state.actors.hero.position = null;
    const resolution = resolveReference(liveRef('position', { kind: 'id', id: 'hero' }), context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('actor-without-position');
  });
});

describe('U1 REFERENCE — Binder and collections', () => {
  it('positive: a bound name resolves through the Binder (BIND a chosen position AS landing)', () => {
    const context = ctx();
    const bound = bind(EMPTY_BINDER, 'landing', capturedPosition({ x: 5, y: 5 }));
    context.boundNames = bound;
    const resolution = resolveReference(liveRef('position', { kind: 'bound', name: 'landing' }), context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'position') {
      expect(resolution.value.position).toEqual({ x: 5, y: 5 });
    }
  });

  it('3: a bound ACTOR ref resolving to a bound POSITION rejects (domain-mismatch)', () => {
    const context = ctx();
    context.boundNames = bind(EMPTY_BINDER, 'landing', capturedPosition({ x: 5, y: 5 }));
    // Declared domain 'actor' but the bound reference is a position.
    const resolution = resolveReference(liveActorBound('landing'), context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('domain-mismatch');
  });

  it('negative: an unbound name rejects (unknown-bound-name)', () => {
    const context = ctx();
    const resolution = resolveReference(liveActorBound('nobody'), context);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) expect(resolution.problem).toBe('unknown-bound-name');
  });

  it('positive: a bound actor name bound to a captured actor resolves', () => {
    const context = ctx();
    context.boundNames = bind(EMPTY_BINDER, 'slain', capturedActor('foe'));
    const resolution = resolveReference(liveActorBound('slain'), context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'actor') expect(resolution.value.actor.id).toBe('foe');
  });

  it('5: an empty collection resolves to a legitimate empty collection', () => {
    const context = ctx();
    const resolution = resolveReference(referenceCollection([]), context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'collection') expect(resolution.value.items).toEqual([]);
  });

  it('6: a collection of refs resolves item-by-item, PRESERVING ORDER', () => {
    const context = ctx();
    const resolution = resolveReference(referenceCollection([capturedActor('hero'), capturedActor('foe')]), context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'collection') {
      expect(resolution.value.items.map((item) => (item.kind === 'actor' ? item.actor.id : '?')))
        .toEqual(['hero', 'foe']); // order preserved, no sorting
    }
  });
});

describe('U1 REFERENCE — plural trigger-targets resolve as an ordered collection', () => {
  it('4: every target is preserved as a collection, never the first element', () => {
    const context = ctx({ triggerTargetIds: ['hero', 'foe'] });
    const resolution = resolveReference(liveTriggerTargets(), context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'collection') {
      expect(resolution.value.items.map((item) => (item.kind === 'actor' ? item.actor.id : '?')))
        .toEqual(['hero', 'foe']);
    }
  });

  it('5: an absent trigger-target slot is a legitimate EMPTY collection, distinct from a missing singular slot', () => {
    const noTargets = ctx(); // triggerTargetIds undefined
    const plural = resolveReference(liveTriggerTargets(), noTargets);
    expect(plural.ok).toBe(true);
    if (plural.ok && plural.value.kind === 'collection') expect(plural.value.items).toEqual([]);

    // The singular attack-target slot for the same context rejects instead.
    const singular = resolveReference(liveActorSlot('attack-target'), noTargets);
    expect(singular.ok).toBe(false);
    if (!singular.ok) expect(singular.problem).toBe('missing-slot');
  });
});

describe('U1 REFERENCE — RuleSelector adapter is the single actor-reference route', () => {
  it('maps LIVE slot selectors through U1 and preserves missing-slot semantics', () => {
    const context = ctx({ attackTargetId: 'foe' });
    const selected = resolveActorSelectorReference({ kind: 'attack-target' }, context);
    expect(selected.ok).toBe(true);
    if (selected.ok && selected.value.kind === 'actor') expect(selected.value.actor.id).toBe('foe');

    const missing = resolveActorSelectorReference({ kind: 'trigger-source' }, context);
    expect(missing).toEqual({ ok: false, problem: 'missing-slot' });
  });

  it('captures recorded input identities in order instead of re-reading later input', () => {
    const context = ctx({ input: { actorIds: { targets: ['foe', 'hero'] } } });
    const ref = actorReferenceForSelector({ kind: 'input', key: 'targets' }, context);
    expect(ref).toEqual(referenceCollection([capturedActor('foe'), capturedActor('hero')]));
    context.input = { actorIds: { targets: ['hero'] } };
    const resolution = resolveReference(ref!, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'collection') {
      expect(resolution.value.items.map((item) => item.kind === 'actor' ? item.actor.id : '?'))
        .toEqual(['foe', 'hero']);
    }
  });

  it('routes bound selectors through domain-checked U1 binding', () => {
    const context = ctx({ boundNames: bind(EMPTY_BINDER, 'target', capturedActor('foe')) });
    const resolution = resolveActorSelectorReference({ kind: 'bound', name: 'target' }, context);
    expect(resolution.ok).toBe(true);
    if (resolution.ok && resolution.value.kind === 'actor') expect(resolution.value.actor.id).toBe('foe');
  });

  it('rejects query-shaped selectors instead of treating a CandidateSet as a reference', () => {
    expect(resolveActorSelectorReference({ kind: 'all', relation: 'foe' }, ctx()))
      .toEqual({ ok: false, problem: 'selector-not-reference' });
  });
});

describe('U1 REFERENCE — the Binder is pure and replay-deterministic', () => {
  it('10: bind returns a new Binder and never mutates the original', () => {
    const original = EMPTY_BINDER;
    const extended = bind(original, 'landing', capturedPosition({ x: 1, y: 1 }));
    expect(original.names).toEqual({}); // original untouched
    expect(extended).not.toBe(original);
    expect(extended.names.landing).toEqual({ kind: 'captured-position', position: { x: 1, y: 1 } });
  });

  it('10: the same context + binder resolves the same collection under replay', () => {
    const context = ctx({ triggerTargetIds: ['hero', 'foe'] });
    expect(resolveReference(liveTriggerTargets(), context))
      .toEqual(resolveReference(liveTriggerTargets(), context));
  });
});
