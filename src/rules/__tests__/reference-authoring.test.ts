/**
 * reference-authoring.test.ts — the SHARED CONTENT-AUTHORING REFERENCE
 * ADAPTER's semantic contract (U1 Reference / Binding surface for named
 * content resolvers).
 *
 * The adapter (`content/glue/reference-authoring.ts`) is NOT a second
 * reference system and NOT a syntax shortcut: every accessor composes the ONE
 * U1 vocabulary (`primitives/reference.ts`) and expresses REFERENCE INTENT —
 * which thing a later rule clause refers to. This suite proves the six
 * accessors carry the U1 semantics end to end:
 *
 *  - LIVE source/attack-target refs re-read CURRENT actor state at resolve
 *    time (never a stale snapshot);
 *  - CAPTURED command selections preserve the RECORDED identity — replay
 *    applies the recorded choice and never re-derives it from later state;
 *  - an absent optional singular slot is a legitimate absence (`undefined`),
 *    while a slot that NAMES a missing actor rejects (fail closed — the
 *    adapter never guesses);
 *  - plural trigger-targets stay an ORDERED COLLECTION of every recorded
 *    target, never an arbitrary first element;
 *  - bound references are DOMAIN-VERIFIED (a bound non-actor rejects);
 *  - defeated captured actors remain resolvable as identity;
 *  - query-shaped eligibility is untouched: the adapter has deliberately no
 *    generic getActor(id) convenience, and cardinality (`[0]`, minimums,
 *    maximums) remains with the caller's U4 choice policy — proven here by the
 *    ordered-collection cases and the parity cases.
 */
import { describe, expect, it } from 'vitest';
import {
  bind, capturedActor, capturedPosition, EMPTY_BINDER, referenceCollection,
} from '../automation/primitives/reference.js';
import { RuleProgramViolation } from '../automation/kernels/violations.js';
import type { RuleAction, RuleExecutionContext } from '../automation/primitives/types.js';
import {
  capturedSelectedActorsRef,
  resolveAttackTarget,
  resolveBoundActor,
  resolveCapturedSelectedActors,
  resolveSourceActor,
  resolveTriggerSource,
  resolveTriggerTargets,
} from '../automation/content/glue/reference-authoring.js';
import { SHADE_RULE_RESOLVERS } from '../automation/content/jobs/programs/shade-programs.js';
import { WARDEN_RULE_RESOLVERS } from '../automation/content/jobs/programs/warden-programs.js';
import { SEALER_RULE_RESOLVERS } from '../automation/content/jobs/programs/sealer-programs.js';

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

describe('content-authoring adapter — LIVE source/attack/trigger refs re-read current state', () => {
  it('parity: resolveSourceActor resolves the SAME actor view the legacy slot read would', () => {
    const context = ctx();
    const source = resolveSourceActor(context);
    expect(source.id).toBe('hero');
    expect(source).toBe(context.state.actors[context.actorId]);
    const target = resolveAttackTarget(context);
    expect(target).toBeUndefined(); // absent singular slot → legitimate absence
  });

  it('LIVE: moving the source actor before the later clause resolves is visible to resolveSourceActor', () => {
    const context = ctx();
    context.state.actors.hero.position = { x: 9, y: 9 };
    expect(resolveSourceActor(context).position).toEqual({ x: 9, y: 9 });
  });

  it('LIVE: resolveAttackTarget re-reads the target actor at resolve time', () => {
    const context = ctx({ attackTargetId: 'foe' });
    const first = resolveAttackTarget(context);
    expect(first?.id).toBe('foe');
    context.state.actors.foe.position = { x: 1, y: 1 };
    expect(resolveAttackTarget(context)?.position).toEqual({ x: 1, y: 1 });
  });

  it('LIVE: resolveTriggerSource resolves the recorded trigger-source slot, undefined when absent', () => {
    expect(resolveTriggerSource(ctx())).toBeUndefined();
    const context = ctx({ triggerSourceId: 'hero' });
    expect(resolveTriggerSource(context)?.id).toBe('hero');
  });
});

describe('content-authoring adapter — CAPTURED command selections preserve recorded identity', () => {
  it('positive: resolveCapturedSelectedActors returns the RECORDED actors in recorded order', () => {
    const context = ctx({ input: { actorIds: { target: ['foe', 'hero'] } } });
    const selected = resolveCapturedSelectedActors(context, 'target');
    expect(selected.map((actor) => actor.id)).toEqual(['foe', 'hero']);
  });

  it('boundary: an absent key / empty selection is a legitimate empty collection, not an error', () => {
    expect(resolveCapturedSelectedActors(ctx(), 'target')).toEqual([]);
  });

  it('replay: the captured selection identity NEVER re-derives from later state — recorded ids stay the answer after state changes', () => {
    const context = ctx({ input: { actorIds: { target: ['foe'] } } });
    const before = resolveCapturedSelectedActors(context, 'target').map((actor) => actor.id);
    // Later state changes (movement, defeat, new actors) do not change WHICH
    // actors the recorded choice names — the identity is the recorded id.
    const foe = context.state.actors.foe;
    foe.defeated = true;
    foe.position = null;
    // Project a fresh (mutable) copy view with a new member — the parsed
    // READ of the text above proves later state changes are invisible to the
    // recorded identity; adding an actor here mirrors "new actors join"
    // without fighting the read-only view type.
    const extendedState = { ...context.state, actors: { ...context.state.actors, extra: { ...context.state.actors.hero, id: 'extra' } } };
    const after = resolveCapturedSelectedActors({ ...context, state: extendedState }, 'target').map((actor) => actor.id);
    expect(after).toEqual(before);
    expect(after).toEqual(['foe']);
  });

  it('boundary: defeated captured actors remain resolvable as identity', () => {
    const context = ctx({ input: { actorIds: { target: ['foe'] } } });
    context.state.actors.foe.defeated = true;
    expect(resolveCapturedSelectedActors(context, 'target')[0]?.id).toBe('foe');
  });

  it('the captured ref constructor is the durable-literal identity (capturedActor), never a live slot', () => {
    const ref = capturedSelectedActorsRef(['foe', 'hero']);
    expect(ref).toEqual(referenceCollection([capturedActor('foe'), capturedActor('hero')]));
    expect(ref.kind).toBe('collection');
    if (ref.kind === 'collection') {
      expect(ref.refs.every((item) => item.kind === 'captured-actor')).toBe(true);
    }
  });
});

describe('content-authoring adapter — fail closed: reject malformed/missing refs, never guess', () => {
  it('a singular slot that NAMES an actor absent from state is a hard rejection', () => {
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => resolveAttackTarget(context), 'reference.missing-actor');
    const source = ctx({ actorId: 'ghost' });
    expectViolationCode(() => resolveSourceActor(source), 'reference.missing-actor');
    const trigger = ctx({ triggerSourceId: 'ghost' });
    expectViolationCode(() => resolveTriggerSource(trigger), 'reference.missing-actor');
  });

  it('a captured recorded identity that no longer resolves rejects (never silently drops the choice)', () => {
    const context = ctx({ input: { actorIds: { target: ['ghost'] } } });
    expectViolationCode(() => resolveCapturedSelectedActors(context, 'target'), 'reference.missing-actor');
  });

  it('a plural trigger-target id absent from state rejects the whole collection', () => {
    const context = ctx({ triggerTargetIds: ['foe', 'ghost'] });
    expectViolationCode(() => resolveTriggerTargets(context), 'reference.missing-actor');
  });

  it('bound-domain mismatch rejects: a name bound to a POSITION cannot satisfy an actor reference', () => {
    const context = ctx({ boundNames: bind(EMPTY_BINDER, 'landing', capturedPosition({ x: 3, y: 3 })) });
    expectViolationCode(() => resolveBoundActor(context, 'landing'), 'reference.domain-mismatch');
    expectViolationCode(() => resolveBoundActor(context, 'never-bound'), 'reference.unknown-bound');
  });
});

describe('content-authoring adapter — ordered plural collections, never arbitrary first elements', () => {
  it('resolveTriggerTargets returns EVERY recorded target in recorded order', () => {
    const context = ctx({ triggerTargetIds: ['foe', 'hero'] });
    expect(resolveTriggerTargets(context).map((actor) => actor.id)).toEqual(['foe', 'hero']);
    const reversed = ctx({ triggerTargetIds: ['hero', 'foe'] });
    expect(resolveTriggerTargets(reversed).map((actor) => actor.id)).toEqual(['hero', 'foe']);
  });

  it('an empty trigger-target list is a legitimate empty collection', () => {
    expect(resolveTriggerTargets(ctx())).toEqual([]);
  });

  it('cardinality stays with the caller: the adapter never collapses a collection to "first actor"', () => {
    // The adapter returns the FULL ordered array; the caller's own U4
    // single-choice policy takes `[0]` — the adapter cannot be used to hide a
    // first-element collapse (proven structurally: no generic getActor
    // convenience exists on the surface, only the six typed accessors).
    const context = ctx({ input: { actorIds: { mark: ['hero', 'foe'] } } });
    expect(resolveCapturedSelectedActors(context, 'mark').length).toBe(2);
  });
});

describe('content-authoring adapter — migrated-content parity (behavior-preserving migration)', () => {
  it('parity: the adapter result equals the legacy direct reads for identical inputs', () => {
    const context = ctx({ attackTargetId: 'foe', triggerTargetIds: ['foe', 'hero'], input: { actorIds: { target: ['hero', 'foe'] } } });
    // The adapter resolutions above already prove source/target/trigger slots
    // resolve, so the recorded-slot indexes are non-null here (parity read).
    expect(resolveSourceActor(context)).toBe(context.state.actors[context.actorId!]);
    expect(resolveAttackTarget(context)).toBe(context.state.actors[context.attackTargetId!]);
    const recordedTargets: string[] | undefined = context.triggerTargetIds;
    const recordedSelected: string[] | undefined = context.input.actorIds?.target;
    expect(resolveTriggerTargets(context).map((actor) => actor.id)).toEqual(recordedTargets ?? []);
    expect(resolveCapturedSelectedActors(context, 'target').map((actor) => actor.id)).toEqual(recordedSelected ?? []);
  });

  it('parity: a missing attack target slot still yields undefined for effect-only abilities', () => {
    // The migrated Bastion/Spellblade resolvers keep `target?.position`
    // guards; the adapter preserves that absent-slot semantics.
    expect(resolveAttackTarget(ctx())).toBeUndefined();
  });
});

describe('content-authoring adapter — production Shade/Warden resolvers fail closed on gated-bypass context (resolver is the final authority)', () => {
  // The resolvers read the action only for tags/triggers that these
  // fail-closed cases never reach; a minimal well-typed action suffices.
  const defaultAction: RuleAction = {
    id: 'default', name: 'resolver-under-test', timing: 'use',
    costs: [], tags: [], range: null, area: null, choices: [], steps: [],
  };
  const interruptAction: RuleAction = { ...defaultAction, timing: 'interrupt' };

  it('Shade Umbra resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => SHADE_RULE_RESOLVERS['shade:umbra:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Warden Sidhe resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => WARDEN_RULE_RESOLVERS['warden:sidhe:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Sealer God Hand resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => SEALER_RULE_RESOLVERS['sealer:god-hand:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Sealer Open The Gates resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor — the U1×U4 chain sites keep caller-owned precedence; only PURE live-slot reads migrated', () => {
    // Grand Seal's `input.actorIds?.target?.[0] ?? attackTargetId` precedence is
    // caller-owned U4 (inventoried); the PURE God Hand/Open The Gates reads
    // resolve the attack-target slot directly and fail closed on a ghost.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => SEALER_RULE_RESOLVERS['sealer:open-the-gates:effects'](context, defaultAction), 'reference.missing-actor');
    // And the chain site still honors its caller-owned precedence: a present
    // input target is used, and a ghost FALLBACK slot alone would resolve
    // through the caller's `targetId ?` guard (undefined → caller gate).
    const chained = ctx({ attackTargetId: undefined, input: { actorIds: { target: ['foe'] } } });
    const resolved = SEALER_RULE_RESOLVERS['sealer:grand-seal:effects'](chained, defaultAction);
    expect(Array.isArray(resolved)).toBe(true);
  });

  it('Shade Nocturne resolver: a ghost triggerSourceId (gate bypassed) throws instead of degenerating to the source position', () => {
    // The Nocturne fallback chain `area-center ?? triggerSource ?? source` is
    // caller-owned; only the TRIGGER-SOURCE reference itself is U1 — a trigger
    // source that names a missing actor must reject, never silently reinterpret
    // as the user's own position.
    const context = ctx({ triggerSourceId: 'ghost' });
    expectViolationCode(() => SHADE_RULE_RESOLVERS['shade:nocturne:effects'](context, interruptAction), 'reference.missing-actor');
  });
});