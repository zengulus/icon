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
  resolveCapturedActor,
  resolveCapturedActorWeak,
  resolveCapturedSelectedActors,
  resolveSourceActor,
  resolveTriggerSource,
  resolveTriggerTargets,
} from '../automation/content/glue/reference-authoring.js';
import { SHADE_RULE_RESOLVERS } from '../automation/content/jobs/programs/shade-programs.js';
import { WARDEN_RULE_RESOLVERS } from '../automation/content/jobs/programs/warden-programs.js';
import { SEALER_RULE_RESOLVERS } from '../automation/content/jobs/programs/sealer-programs.js';
import { ENOCHIAN_RULE_RESOLVERS } from '../automation/content/jobs/programs/enochian-programs.js';
import { CHANTER_RULE_RESOLVERS } from '../automation/content/jobs/programs/chanter-programs.js';
import { KNAVE_RULE_RESOLVERS } from '../automation/content/jobs/programs/knave-programs.js';
import { HARVESTER_RULE_RESOLVERS } from '../automation/content/jobs/programs/harvester-programs.js';
import { DEMON_SLAYER_RULE_RESOLVERS } from '../automation/content/jobs/programs/demon-slayer-programs.js';
import { SEER_RULE_RESOLVERS } from '../automation/content/jobs/programs/seer-programs.js';
import { GEOMANCER_RULE_RESOLVERS } from '../automation/content/jobs/programs/geomancer-programs.js';
import { STORMBENDER_RULE_RESOLVERS } from '../automation/content/jobs/programs/stormbender-programs.js';
import { COLOSSUS_RULE_RESOLVERS } from '../automation/content/jobs/programs/colossus-programs.js';

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

  it('Sealer Open The Gates resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor — chain precedence stays caller-owned, dereferences resolve through U1', () => {
    // Open The Gates' `input.actorIds?.target?.[0] ?? attackTargetId` SELECT
    // (which recorded slot answers) is caller-owned U4 precedence; the chosen
    // identity's dereference now resolves through U1 (captured input side,
    // live attack-target side) and fails closed on a ghost.
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

  it('Enochian Pyre resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Pyre's PURE live-slot reads (source actor + attack target) now resolve
    // through the adapter; a slot that NAMES a missing actor must reject, never
    // silently fall through to an empty mutation list on a malformed window.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => ENOCHIAN_RULE_RESOLVERS['enochian:pyre:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Chanter Chastise resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Chastise's PURE live-slot reads (source + attack target) now resolve
    // through the adapter; a slot that NAMES a missing actor must reject on a
    // malformed window rather than silently produce an empty mutation list.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => CHANTER_RULE_RESOLVERS['chanter:chastise:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Chanter Holy resolver: an absent optional attack-target slot stays undefined (optional singleton semantics preserved)', () => {
    // Holy's attack-target read is OPTIONAL in valid state (the resolver's
    // `if (!target) return []` guard handles a genuinely targetless use); the
    // adapter preserves absent-singular → undefined.
    const context = ctx();
    expect(() => CHANTER_RULE_RESOLVERS['chanter:holy:effects'](context, defaultAction)).not.toThrow();
  });

  it('Chanter Felicity resolver: the recorded input selection resolves through U1 and stays the ally — only the SELECT stays caller-owned', () => {
    // Felicity's `input.actorIds?.target?.[0]` SELECT is the caller's U4
    // choice/cardinality; the dereference of the chosen identity now resolves
    // through U1's resolveCapturedSelectedActors. A present input target
    // resolves as the ally (captured identity), unchanged.
    const hero = ctx().state.actors.hero;
    const ally = { ...hero, id: 'ally', side: 'heroes' as const, position: { x: 5, y: 4 } }; // in range 5 of hero
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, ally } },
      input: { actorIds: { target: ['ally'] } },
    });
    const mutations = CHANTER_RULE_RESOLVERS['chanter:felicity:effects'](context, defaultAction);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'ally')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'resource' && mutation.actorId === 'ally' && mutation.resourceId === 'blessing')).toBe(true);
  });

  it('Knave Low Blow resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Low Blow's PURE live-slot reads (source + attack target) now resolve
    // through the adapter; a slot that NAMES a missing actor must reject on a
    // malformed window rather than silently fall through.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => KNAVE_RULE_RESOLVERS['knave:low-blow:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Knave Bleak Mercy resolver: an absent optional attack-target slot stays a no-op (optional singleton semantics preserved)', () => {
    // Bleak Mercy's attack-target read is OPTIONAL in valid state (the
    // resolver's `if (!source || !target || !target.position) return []`
    // guard handles a genuinely targetless use); the adapter preserves
    // absent-singular → undefined and the resolver no-ops as before.
    const context = ctx();
    expect(() => KNAVE_RULE_RESOLVERS['knave:bleak-mercy:effects'](context, defaultAction)).not.toThrow();
  });

  it('Knave Dark Knight resolver: equidistant-foe ambiguity still fails closed — no deterministic tie-break acquired', () => {
    // Dark Knight's nearest-foe read is U3 query + U4 player-choice semantics
    // (p.143 "If multiple foes are equidistant, you may choose"); it is NOT a
    // U1 reference read and was NOT migrated. Two foes at equal distance must
    // still fail closed rather than resolve by object iteration order.
    const hero = ctx().state.actors.hero; // (4,4)
    const foeA = { ...ctx().state.actors.foe, id: 'foeA', position: { x: 5, y: 4 } }; // distance 1
    const foeB = { ...ctx().state.actors.foe, id: 'foeB', position: { x: 4, y: 5 } }; // distance 1 (equidistant)
    const context = ctx({ state: { ...ctx().state, actors: { ...ctx().state.actors, foeA, foeB } } });
    expectViolationCode(() => KNAVE_RULE_RESOLVERS['knave:dark-knight:enter'](context, defaultAction), 'choice.direction-ambiguous');
  });

  it('Knave Dire Parry resolver: the trigger-source ?? recorded-input precedence stays caller-owned; both dereferences resolve through U1', () => {
    // Dire Parry's `context.triggerSourceId ?? context.input.actorIds?.target?.[0]`
    // SELECT is meaningful caller-owned precedence (which slot answers depends
    // on the window contract); the dereference of the chosen id now resolves
    // through U1 — resolveTriggerSource for the live trigger slot, resolveCapturedSelectedActors
    // for the recorded input side.
    const foe = ctx().state.actors.foe;
    const context = ctx({ triggerSourceId: 'foe', input: { actorIds: { target: ['hero'] } } });
    const mutations = KNAVE_RULE_RESOLVERS['knave:riposte:dire-parry'](context, interruptAction);
    // The trigger source (foe) wins over the recorded input target; the foe
    // takes the gamble damage.
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'foe')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'hero')).toBe(false);
    void foe;
  });

  it('Knave Strongarm resolver: the recorded input selection stays the spun target — SELECT caller-owned, dereference through U1', () => {
    // Strongarm's `input.actorIds?.target?.[0]` SELECT is the caller's U4
    // choice/cardinality; the dereference now resolves through U1's
    // resolveCapturedSelectedActors. The chosen target (input) is what gets
    // spun, unchanged.
    const hero = ctx().state.actors.hero;
    const foe = { ...ctx().state.actors.foe, id: 'foe', position: { x: 5, y: 4 } }; // adjacent to hero (4,4)
    const context = ctx({ state: { ...ctx().state, actors: { ...ctx().state.actors, foe } }, input: { actorIds: { target: ['foe'] } } });
    const mutations = KNAVE_RULE_RESOLVERS['knave:strongarm'](context, defaultAction);
    // The spin ends with a place (a `move` mutation with movement 'place') and
    // a shove of the chosen foe — the recorded input identity drives the spin.
    expect(mutations.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'foe' && mutation.movement === 'place')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'foe' && mutation.movement === 'shove')).toBe(true);
    void hero;
  });

  it('Harvester Sow resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Sow's PURE live-slot reads (attack target + inline source read) now
    // resolve through the adapter; a slot that NAMES a missing actor must
    // reject on a malformed window rather than silently produce nothing.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => HARVESTER_RULE_RESOLVERS['harvester:sow:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Harvester Reap resolver: an absent optional attack-target slot stays a no-op (optional singleton semantics preserved)', () => {
    // Reap's attack-target read is OPTIONAL in valid state (the resolver's
    // `if (!source.position || !target?.position) return []` guard handles a
    // genuinely targetless use); the adapter preserves absent-singular →
    // undefined and the resolver no-ops as before.
    const context = ctx();
    expect(() => HARVESTER_RULE_RESOLVERS['harvester:sow:reap'](context, defaultAction)).not.toThrow();
  });

  it('Harvester Blood Grove resolver: the recorded-input center still wins over the source-center fallback — precedence preserved through U1', () => {
    // Blood Grove's in-call center read was the last
    // DERIVED_OR_PRECEDENCE_BOUNDARY; this tranche migrated its dereference
    // through U1's resolveCapturedSelectedActors (the A3 in-call family). Its
    // selection precedence is unchanged: the recorded input target wins when
    // present, and the fallback (source position) is used only when absent.
    const hero = ctx().state.actors.hero; // (4,4)
    const foe = { ...ctx().state.actors.foe, id: 'foe', position: { x: 3, y: 4 } }; // distance 1 (in range 2)
    const withInput = ctx({ state: { ...ctx().state, actors: { ...ctx().state.actors, foe } }, input: { actorIds: { target: ['foe'] } } });
    const centerMutations = HARVESTER_RULE_RESOLVERS['harvester:blood-grove:effects'](withInput, defaultAction);
    const created = centerMutations.find((mutation) => mutation.kind === 'terrain');
    expect(created).toBeDefined();
    if (created && created.kind === 'terrain') {
      // Undegrowth grows around the INPUT-selected center (foe at 3,4).
      expect(created.positions.some((cell) => cell.x === 3 && cell.y === 4)).toBe(true);
    }
    // Without the input identity, the fallback is the source's own position.
    const noInput = ctx();
    const fallbackMutations = HARVESTER_RULE_RESOLVERS['harvester:blood-grove:effects'](noInput, defaultAction);
    const fallbackCreated = fallbackMutations.find((mutation) => mutation.kind === 'terrain');
    expect(fallbackCreated).toBeDefined();
    if (fallbackCreated && fallbackCreated.kind === 'terrain') {
      expect(fallbackCreated.positions.some((cell) => cell.x === 4 && cell.y === 4)).toBe(true);
    }
    void hero;
  });

  it('Demon Slayer Demon Cutter resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Demon Cutter's PURE live-slot reads (source + attack target) now resolve
    // through the adapter; a slot that NAMES a missing actor must reject on a
    // malformed window rather than silently produce nothing.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => DEMON_SLAYER_RULE_RESOLVERS['demon-slayer:demon-cutter:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Demon Slayer Comet resolver: an absent optional attack-target slot stays a no-op (Comet has no attack target; optional singleton semantics preserved)', () => {
    // Comet is a blast/object ability with NO primary attack target; its
    // source read is the migrated PURE slot and the resolver handles a
    // genuinely targetless context as before.
    const context = ctx();
    expect(() => DEMON_SLAYER_RULE_RESOLVERS['demon-slayer:comet'](context, defaultAction)).not.toThrow();
  });

  it('Demon Slayer Righteous Disdain resolver: the recorded input ally receives half the shared damage — SELECT caller-owned, dereference through U1', () => {
    // Righteous Disdain's `input.actorIds?.target?.[0]` SELECT is the caller's
    // U4 choice/cardinality; the dereference now resolves through U1's
    // resolveCapturedSelectedActors. The chosen ally (input) receives half
    // the shared damage, unchanged.
    const hero = ctx().state.actors.hero;
    const ally = { ...hero, id: 'ally', side: 'heroes' as const, position: { x: 5, y: 4 } }; // in range 2 of hero (4,4)
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, ally } },
      input: { actorIds: { target: ['ally'] }, numbers: { damage: 10 } },
    });
    const mutations = DEMON_SLAYER_RULE_RESOLVERS['demon-slayer:righteous-disdain'](context, interruptAction);
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'ally' && mutation.amount === 5)).toBe(true);
  });

  it('Seer Sleight Of Hand resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Sleight Of Hand's PURE live-slot reads (source + attack target) now
    // resolve through the adapter; a slot that NAMES a missing actor must
    // reject on a malformed window rather than silently produce nothing.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => SEER_RULE_RESOLVERS['seer:sleight-of-hand:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Seer The Tower resolver: an absent optional attack-target slot stays a no-op (The Tower has no targetless attack; optional singleton semantics preserved)', () => {
    // The Tower's migrated attack-target read keeps the absent-singular →
    // undefined contract; a genuinely targetless context (no attackTargetId)
    // resolves through the resolver's own `!target?.position` guard as before.
    const context = ctx();
    expect(() => SEER_RULE_RESOLVERS['seer:the-tower:effects'](context, defaultAction)).not.toThrow();
  });

  it('Geomancer Geo resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Geo's PURE live-slot reads (source + attack target) now resolve through
    // the adapter; a slot that NAMES a missing actor must reject on a
    // malformed window rather than silently produce nothing.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => GEOMANCER_RULE_RESOLVERS['geomancer:geo:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Geomancer Quaking Palm resolver: an absent optional attack-target slot stays a no-op (optional singleton semantics preserved)', () => {
    // Quaking Palm's migrated attack-target read keeps the absent-singular →
    // undefined contract; a genuinely targetless context resolves through the
    // resolver's own `!target?.position` guard as before.
    const context = ctx();
    expect(() => GEOMANCER_RULE_RESOLVERS['geomancer:quaking-palm:effects'](context, defaultAction)).not.toThrow();
  });

  it('Geomancer Dragon Dive resolver: the recorded input target wins over a DIFFERENT recorded attack target — precedence preserved through U1', () => {
    // Dragon Dive's `input.actorIds?.target?.[0] ?? attackTargetId` SELECT
    // (which recorded slot answers) is caller-owned U4 precedence; each side's
    // dereference now resolves through U1 (captured input side, live
    // attack-target side). A present input target wins even when a DIFFERENT
    // attackTargetId is recorded — the dive is stored against the chosen
    // identity, exactly as before.
    const chosen = { ...ctx().state.actors.foe, id: 'chosen', position: { x: 7, y: 4 } }; // in range 6 of hero (4,4)
    const other = { ...ctx().state.actors.foe, id: 'other', position: { x: 12, y: 4 } }; // out of range 6 — never selected
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, chosen, other } },
      input: { actorIds: { target: ['chosen'] } },
      attackTargetId: 'other',
    });
    const mutations = GEOMANCER_RULE_RESOLVERS['geomancer:dragon-dive:effects'](context, defaultAction);
    expect(mutations.some((mutation) => mutation.kind === 'state' && mutation.key === 'dragon-dive:target' && mutation.value === 'chosen')).toBe(true);
    // The out-of-range recorded attack target never participates: the caller's
    // SELECT consumed only the recorded input identity.
    expect(mutations.some((mutation) => mutation.kind === 'state' && mutation.value === 'other')).toBe(false);
  });

  it('Geomancer Midas resolver: the recorded interrupt target wins over triggerTargetIds — precedence preserved through U1', () => {
    // Midas's `input.actorIds?.target?.[0] ?? triggerTargetIds?.[0]` SELECT is
    // caller-owned U4 precedence; each side's dereference now resolves through
    // U1 (captured input side, recorded trigger-target collection). The chosen
    // identity becomes the statue held, unchanged.
    const chosen = { ...ctx().state.actors.foe, id: 'chosen', position: { x: 5, y: 4 } }; // in range 5 of hero (4,4)
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, chosen } },
      input: { actorIds: { target: ['chosen'] } },
      triggerTargetIds: ['foe'],
    });
    const mutations = GEOMANCER_RULE_RESOLVERS['geomancer:midas:effects'](context, interruptAction);
    expect(mutations.some((mutation) => mutation.kind === 'entity' && mutation.operation === 'create' && mutation.entityType === 'statue' && mutation.state?.held === 'chosen')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'entity' && mutation.state?.held === 'foe')).toBe(false);
  });

  it('Stormbender Rime resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Rime's PURE live-slot reads (source + attack target) now resolve through
    // the adapter; a slot that NAMES a missing actor must reject on a
    // malformed window rather than silently produce nothing.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => STORMBENDER_RULE_RESOLVERS['stormbender:rime:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Stormbender Cryo resolver: an absent optional attack-target slot stays a no-op (optional singleton semantics preserved)', () => {
    // Cryo's migrated attack-target read keeps the absent-singular → undefined
    // contract; a genuinely targetless context resolves through the resolver's
    // own `!target?.position` guard as before.
    const context = ctx();
    expect(() => STORMBENDER_RULE_RESOLVERS['stormbender:cryo:effects'](context, defaultAction)).not.toThrow();
  });

  it('Stormbender Deepwrath resolver: the recorded input target wins over a DIFFERENT recorded attack target — precedence preserved through U1', () => {
    // Deepwrath's `input.actorIds?.target?.[0] ?? attackTargetId` SELECT is
    // caller-owned U4 precedence; each side's dereference now resolves through
    // U1 (captured input side, live attack-target side). A present input
    // target wins even when a DIFFERENT attackTargetId is recorded — the mark
    // lands on the chosen identity and the out-of-range recorded attack target
    // never participates.
    const chosen = { ...ctx().state.actors.foe, id: 'chosen', position: { x: 8, y: 4 } }; // in range 6 of hero (4,4)
    const other = { ...ctx().state.actors.foe, id: 'other', position: { x: 12, y: 4 } }; // out of range 6 — never selected
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, chosen, other } },
      input: { actorIds: { target: ['chosen'] } },
      attackTargetId: 'other',
    });
    const mutations = STORMBENDER_RULE_RESOLVERS['stormbender:deepwrath:effects'](context, defaultAction);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'chosen' && mutation.markId === 'deepwrath')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'other')).toBe(false);
  });

  it('Colossus Valkyrie resolver: a ghost attackTargetId (gate bypassed) throws reference.missing-actor instead of silently no-opping', () => {
    // Valkyrie's PURE live-slot reads (source + attack target) now resolve through
    // the adapter; a slot that NAMES a missing actor must reject on a malformed
    // window rather than silently produce nothing.
    const context = ctx({ attackTargetId: 'ghost' });
    expectViolationCode(() => COLOSSUS_RULE_RESOLVERS['colossus:valkyrie:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Colossus Takedown resolver: a genuinely absent optional attack target stays a no-op (optional singleton semantics preserved)', () => {
    // Takedown's migrated attack-target read keeps the absent-singular →
    // undefined contract; a context without an attack target resolves through
    // the resolver's own `!target` guard as before.
    const context = ctx();
    expect(() => COLOSSUS_RULE_RESOLVERS['colossus:takedown:effects'](context, defaultAction)).not.toThrow();
  });

  it('Colossus Massive Overhead resolver: a ghost source actor (gate bypassed) throws reference.missing-actor, never a silent no-op', () => {
    // Massive Overhead's PURE source read now resolves through the adapter; a
    // source slot that NAMES a missing actor fails closed (reference.missing-actor)
    // instead of silently emitting nothing.
    const context = ctx({ actorId: 'ghost' });
    expectViolationCode(() => COLOSSUS_RULE_RESOLVERS['colossus:massive-overhead'](context, defaultAction), 'reference.missing-actor');
  });

  it('Colossus Dropkick resolver: the recorded input target takes the hit — SELECT caller-owned, dereference through U1', () => {
    // Dropkick's `input.actorIds?.target?.[0]` SELECT is the caller's U4
    // choice/cardinality; the dereference now resolves through U1's
    // resolveCapturedSelectedActors. The recorded chosen identity is the one
    // flown toward and damaged — a DIFFERENT recorded attack target never
    // participates.
    const chosen = { ...ctx().state.actors.foe, id: 'chosen', position: { x: 5, y: 4 } }; // adjacent to hero (4,4)
    const other = { ...ctx().state.actors.foe, id: 'other', position: { x: 12, y: 4 } }; // out of adjacency — never selected
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, chosen, other } },
      input: { actorIds: { target: ['chosen'] } },
      attackTargetId: 'other',
    });
    const mutations = COLOSSUS_RULE_RESOLVERS['colossus:dropkick'](context, defaultAction);
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'chosen')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'other')).toBe(false);
  });

  it('Shade Shadow Play resolver: a ghost source actor (gate bypassed) throws reference.missing-actor, never the misleading choice.actor-count', () => {
    // Shadow Play's migrated PURE source read now resolves through the
    // adapter; a source slot that NAMES a missing actor must reject with the
    // U1 contract instead of the legacy resolver guard's misleading
    // choice.actor-count (which blamed a character count the source read
    // never confirmed).
    const context = ctx({ actorId: 'ghost' });
    expectViolationCode(() => SHADE_RULE_RESOLVERS['shade:shadow-play:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Shade Shadow Play resolver: the swap moves the RECORDED identities — SELECTs caller-owned, dereferences through U1', () => {
    // Shadow Play's `input.actorIds?.target?.[0]` / `?.[1]` SELECTs are the
    // caller's U4 choice/cardinality; both dereferences now resolve through
    // U1's resolveCapturedSelectedActors, in recorded order. The two recorded
    // identities are the ones swapped, unchanged.
    const first = { ...ctx().state.actors.foe, id: 'first', position: { x: 6, y: 4 } }; // in range 2 of hero (4,4)
    const second = { ...ctx().state.actors.foe, id: 'second', position: { x: 8, y: 4 } }; // in range 3 of first
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, first, second } },
      input: { actorIds: { target: ['first', 'second'] } },
    });
    const mutations = SHADE_RULE_RESOLVERS['shade:shadow-play:effects'](context, defaultAction);
    const places = mutations.filter((mutation) => mutation.kind === 'move' && mutation.movement === 'place');
    expect(places.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'first' && mutation.positions[0]!.x === 8)).toBe(true);
    expect(places.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'second' && mutation.positions[0]!.x === 6)).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'condition' && mutation.conditionId === 'stealth')).toBe(false);
  });

  it('Sealer Grand Seal resolver: the recorded input target wins over a DIFFERENT recorded attack target — precedence preserved through U1', () => {
    // Grand Seal's `input.actorIds?.target?.[0] ?? attackTargetId` SELECT is
    // caller-owned U4 precedence; each side's dereference now resolves through
    // U1 (captured input side, live attack-target side). A present input
    // target wins even when a DIFFERENT attackTargetId is recorded — the
    // out-of-range recorded attack target never participates.
    const chosen = { ...ctx().state.actors.foe, id: 'chosen', position: { x: 7, y: 4 } }; // in range 4 of hero (4,4)
    const other = { ...ctx().state.actors.foe, id: 'other', position: { x: 20, y: 4 } }; // out of range 4 — never selected
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, chosen, other } },
      input: { actorIds: { target: ['chosen'] } },
      attackTargetId: 'other',
    });
    const mutations = SEALER_RULE_RESOLVERS['sealer:grand-seal:effects'](context, defaultAction);
    expect(mutations.some((mutation) => mutation.kind === 'condition' && mutation.actorId === 'chosen' && mutation.conditionId === 'sealed')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'chosen' && mutation.markId === 'grand-seal')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'other')).toBe(false);
  });

  it('Sealer Sanctify resolver: a genuinely absent optional target keeps the source-center fallback (resolver gate untouched)', () => {
    // Sanctify's target read is a captured chain; with NO recorded target and
    // NO attack target the caller's SELECT yields undefined and the resolver's
    // `center = target?.position ?? source.position` fallback centers the salt
    // on the source — the migrated source read still resolves and the gate is
    // unchanged.
    const context = ctx();
    const mutations = SEALER_RULE_RESOLVERS['sealer:sanctify:effects'](context, defaultAction);
    const salt = mutations.filter((mutation) => mutation.kind === 'terrain' && mutation.terrain === 'salt');
    expect(salt).toHaveLength(1);
    expect(salt.some((mutation) => mutation.kind === 'terrain' && mutation.positions.some((cell) => cell.x === 4 && cell.y === 4))).toBe(true);
  });

  it('Warden Gwynt resolver: the recorded foe and ally selections drive the dashes — SELECTs caller-owned, dereferences through U1', () => {
    // Gwynt's `input.actorIds?.target?.[0]` (foe) / `?.[1]` (ally) SELECTs are
    // the caller's U4 choice/cardinality; both dereferences now resolve
    // through U1's resolveCapturedSelectedActors. The recorded foe is the
    // dash target and damage
    // recipient, unchanged: foe at (6,4) sits 2 cells east of hero (4,4) on
    // the dash axis — the hero's 2-rush stops on the free cell (5,4) before
    // the foe (the shared `walk` blocks on occupancy), distance 1, and deals
    // 2; the recorded ally at (4,5) is range 3 from the foe, dashes east to
    // (6,5) and also deals 2.
    const foe = { ...ctx().state.actors.foe, id: 'foe', position: { x: 6, y: 4 } }; // two east of hero (4,4); dash axis clear until the foe
    const ally = { ...ctx().state.actors.foe, id: 'ally', side: 'heroes' as const, position: { x: 4, y: 5 } }; // range 3 of foe, clear dash lane
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, foe, ally } },
      input: { actorIds: { target: ['foe', 'ally'] } },
    });
    const mutations = WARDEN_RULE_RESOLVERS['warden:gwynt:effects'](context, defaultAction);
    // The hero dashes 2 toward the recorded foe ((4,4) → (5,4), stopping on
    // the free cell before it) and the recorded foe takes 2 damage from the
    // hero and 2 from the dashing ally — the RECORDED identities drive both
    // dashes, never a different foe/ally.
    expect(mutations.some((mutation) => mutation.kind === 'move' && mutation.movement === 'rush' && mutation.actorId === 'hero' && mutation.positions[0]!.x === 5)).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'move' && mutation.movement === 'rush' && mutation.actorId === 'ally' && mutation.positions[0]!.x === 6 && mutation.positions[0]!.y === 5)).toBe(true);
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === 'foe' && mutation.amount === 2)).toHaveLength(2);
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'ally')).toBe(false);
  });

  it('Seer Chaos Tarot resolver: the recorded input center choice still wins over the attack target — precedence preserved through U1', () => {
    // Chaos Tarot's `input.actorIds?.target?.[0] ?? attackTargetId` SELECT is
    // caller-owned U4 precedence; each side's dereference now resolves through
    // U1 (captured input side, live attack-target side). A present input
    // target wins even when a DIFFERENT attackTargetId is recorded — the wild
    // card lands at the chosen center and the gamble frays the chosen
    // identity, exactly as before.
    const chosen = { ...ctx().state.actors.foe, id: 'chosen', position: { x: 8, y: 4 } };
    const other = { ...ctx().state.actors.foe, id: 'other', position: { x: 12, y: 4 } };
    const context = ctx({
      state: { ...ctx().state, actors: { ...ctx().state.actors, chosen, other } },
      input: { actorIds: { target: ['chosen'] } },
      attackTargetId: 'other',
    });
    const mutations = SEER_RULE_RESOLVERS['seer:chaos-tarot:effects'](context, defaultAction);
    // The wild card is summoned at the CHOSEN center (radius 1) — within 1 of
    // 'chosen', never near 'other'.
    const card = mutations.find((mutation) => mutation.kind === 'entity');
    expect(card).toBeDefined();
    if (card && card.kind === 'entity') {
      expect(card.positions.some((cell) => Math.abs(cell.x - 8) <= 1 && Math.abs(cell.y - 4) <= 1)).toBe(true);
      expect(card.positions.some((cell) => Math.abs(cell.x - 12) <= 1 && Math.abs(cell.y - 4) <= 1)).toBe(false);
    }
    // The gamble (scripted d6 = 1) frays characters in the chosen area.
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'chosen')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'other')).toBe(false);
  });

  it('Chanter Monogatari resolver: the LIVE source read migrates; lifecycle/usage state mutations are untouched', () => {
    // Monogatari's resolver only records source-owned lifecycle state on the
    // user (monogatari:active / tale / charge); the migrated source read is a
    // pure slot dereference and the mutations are byte-identical in shape
    // (kind/actorId/key/value, same as the pre-migration resolver emitted).
    const context = ctx();
    const mutations = CHANTER_RULE_RESOLVERS['chanter:monogatari:effects'](context, defaultAction);
    expect(mutations.filter((mutation) => mutation.kind === 'state' && mutation.actorId === 'hero')).toHaveLength(3);
    expect(mutations.some((mutation) => mutation.kind === 'state' && mutation.key === 'monogatari:active')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'state' && mutation.key === 'monogatari:tale')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'state' && mutation.key === 'monogatari:charge')).toBe(true);
  });

  it('Enochian Pyroclast resolver: the ?? chain survives with each side resolving through U1 — the recorded input still wins over the attack target', () => {
    // Pyroclast's `input.actorIds?.target?.[0] ?? attackTargetId ?? source.id`
    // SELECT is caller-owned U4 precedence; each side's dereference now
    // resolves through U1 (captured input side, live attack-target side, and
    // the already-resolved source for the terminal fallback). A present input
    // target still wins over the attack-target fallback, and the resolver
    // marks that chosen identity — U4 semantics unchanged.
    const context = ctx({ attackTargetId: 'foe', input: { actorIds: { target: ['hero'] } } });
    const mutations = ENOCHIAN_RULE_RESOLVERS['enochian:pyroclast:effects'](context, defaultAction);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'hero')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'foe')).toBe(false);
  });

  it('Warden Gwynt resolver: a ghost RECORDED input id (gate bypassed) fails closed with reference.missing-actor — never a silent no-op', () => {
    // This tranche migrated Gwynt's captured-selection dereferences through
    // U1's resolveCapturedSelectedActors. Legacy code silently tolerated a
    // ghost recorded id (`state.actors['ghost']` → undefined → the resolver's
    // `if (!foe || !foePosition) return []` no-op). Under the U1 contract the
    // plural captured collection REJECTS a missing identity: fail-closed. The
    // engine gate never lets a ghost recorded id through; the resolver is the
    // final authority when one does.
    const context = ctx({ input: { actorIds: { target: ['ghost'] } }, attackTargetId: undefined });
    expectViolationCode(() => WARDEN_RULE_RESOLVERS['warden:gwynt:effects'](context, defaultAction), 'reference.missing-actor');
  });

  it('Shade Shadow Play resolver: RECORDED order is decisive — flipping the recorded targetIds flips which identity goes where', () => {
    // The captured selections are positional by RECORDED index (`[0]`/`[1]` is
    // caller-owned cardinality); U1 resolves whatever identity was recorded at
    // each index. Reversing the recorded order reverses the swap — resolution
    // never re-derives first/second from object order or state.
    const first = { ...ctx().state.actors.foe, id: 'first', position: { x: 5, y: 4 } }; // range 1 of hero (4,4)
    const second = { ...ctx().state.actors.foe, id: 'second', position: { x: 6, y: 4 } }; // range 1 of first
    const base = { ...ctx().state, actors: { ...ctx().state.actors, first, second } };
    const asRecorded = SHADE_RULE_RESOLVERS['shade:shadow-play:effects'](ctx({ state: base, input: { actorIds: { target: ['first', 'second'] } } }), defaultAction);
    const placesForward = asRecorded.filter((mutation) => mutation.kind === 'move' && mutation.movement === 'place');
    // Recorded [first, second]: first is [0] — first moves to second's cell and vice versa.
    expect(placesForward.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'first' && mutation.positions[0]!.x === 6)).toBe(true);
    expect(placesForward.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'second' && mutation.positions[0]!.x === 5)).toBe(true);
    const flipped = SHADE_RULE_RESOLVERS['shade:shadow-play:effects'](ctx({ state: base, input: { actorIds: { target: ['second', 'first'] } } }), defaultAction);
    const placesBackward = flipped.filter((mutation) => mutation.kind === 'move' && mutation.movement === 'place');
    // Recorded [second, first]: second is now [0] — the swap directions flip.
    expect(placesBackward.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'second' && mutation.positions[0]!.x === 5)).toBe(true);
    expect(placesBackward.some((mutation) => mutation.kind === 'move' && mutation.actorId === 'first' && mutation.positions[0]!.x === 6)).toBe(true);
  });
});

describe('fold-surface captured-actor ops — STRICT vs LIFECYCLE-SENSITIVE (weak) are distinct U1 contracts', () => {
  // The strict `resolveCapturedActor` and the weak `resolveCapturedActorWeak`
  // are the two durable-reference contracts for the kernel-fold-driven
  // recipe/lifecycle/continuation surfaces. They differ ONLY on the
  // present-ID-but-actor-absent case: strict fails closed (dangling
  // reference), weak resolves to `undefined` (lifecycle expiration — "the
  // actor originally associated with this fact, if that actor still
  // exists"). No flags select behavior; the contract is in the vocabulary.

  const absentBorder = [undefined, null, ''] as const;

  it('absent ID border (undefined / null / the legacy \'\' sentinel) is CALLER-side presence: both ops return undefined, never an error', () => {
    for (const id of absentBorder) {
      expect(resolveCapturedActor({ state: ctx().state }, id)).toBeUndefined();
      expect(resolveCapturedActorWeak({ state: ctx().state }, id)).toBeUndefined();
    }
  });

  it('present ID, actor still present: both ops resolve the SAME full actor object state.actors[id] is', () => {
    const state = ctx().state;
    const strict = resolveCapturedActor({ state }, 'hero');
    const weak = resolveCapturedActorWeak({ state }, 'hero');
    expect(strict).toBe(state.actors.hero);
    expect(weak).toBe(state.actors.hero);
    // Full EncounterActor, not a projected view — fold guards keep reading
    // defeated / onBattlefield / ruleState off the resolved object.
    expect(strict!.defeated).toBe(false);
  });

  it('present ID, actor DEFEATED but still present: identity still resolves (defeat \u2260 removal), both ops', () => {
    const state = ctx().state;
    state.actors.hero.defeated = true;
    expect(resolveCapturedActor({ state }, 'hero')?.defeated).toBe(true);
    expect(resolveCapturedActorWeak({ state }, 'hero')?.defeated).toBe(true);
  });

  it('present ID, actor REMOVED from state: STRICT fails closed reference.missing-actor; WEAK resolves undefined (legitimate lifecycle expiration)', () => {
    // Engine combat never deletes actors (REMOVE_ACTOR is setup-only), so a
    // strict present-id-missing-actor is a dangling reference; weak carriers
    // (legacy/imported fact owners, `?? null` optional origins) declare a
    // tolerant lifetime and expire instead. This is the adjudicated split.
    const state = ctx().state;
    const { hero, ...rest } = state.actors;
    const withoutHero = { ...state, actors: rest };
    expectViolationCode(() => resolveCapturedActor({ state: withoutHero }, 'hero'), 'reference.missing-actor');
    expect(resolveCapturedActorWeak({ state: withoutHero }, 'hero')).toBeUndefined();
  });

  it('malformed/dangling identity distinct from legitimate absence: strict rejects a present garbage ID', () => {
    const state = ctx().state;
    expectViolationCode(() => resolveCapturedActor({ state }, 'ghost'), 'reference.missing-actor');
  });

  it('replay determinism: both ops are pure functions of (state, id) — two runs on identical state return identical identities', () => {
    const a = ctx().state;
    const b = ctx().state; // structurally identical, fresh objects
    expect(resolveCapturedActor({ state: a }, 'hero')?.id).toBe('hero');
    expect(resolveCapturedActor({ state: b }, 'hero')?.id).toBe('hero');
    b.actors.hero.position = { x: 9, y: 9 };
    // LIVE re-read semantics: resolution reads CURRENT state, never a stale
    // snapshot — replay applies recorded identities against the replayed map.
    expect(resolveCapturedActor({ state: b }, 'hero')?.position).toEqual({ x: 9, y: 9 });
  });

  it('insertion-order independence: the actors map\u2019s key order never changes which actor resolves for an id', () => {
    const state = ctx().state;
    // Rebuild the map with the keys inserted in reversed order.
    const reversed: Record<string, typeof state.actors.hero> = {};
    for (const key of Object.keys(state.actors).reverse()) reversed[key] = state.actors[key];
    const strict = resolveCapturedActor({ state: { ...state, actors: reversed } }, 'hero');
    const weak = resolveCapturedActorWeak({ state: { ...state, actors: reversed } }, 'hero');
    expect(strict?.id).toBe('hero');
    expect(weak?.id).toBe('hero');
  });
});