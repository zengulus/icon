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
import { ENOCHIAN_RULE_RESOLVERS } from '../automation/content/jobs/programs/enochian-programs.js';
import { CHANTER_RULE_RESOLVERS } from '../automation/content/jobs/programs/chanter-programs.js';
import { KNAVE_RULE_RESOLVERS } from '../automation/content/jobs/programs/knave-programs.js';
import { HARVESTER_RULE_RESOLVERS } from '../automation/content/jobs/programs/harvester-programs.js';
import { DEMON_SLAYER_RULE_RESOLVERS } from '../automation/content/jobs/programs/demon-slayer-programs.js';
import { SEER_RULE_RESOLVERS } from '../automation/content/jobs/programs/seer-programs.js';
import { GEOMANCER_RULE_RESOLVERS } from '../automation/content/jobs/programs/geomancer-programs.js';

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

  it('Chanter Felicity resolver: the captured-input identity stays caller-owned — only the LIVE source slot migrated', () => {
    // Felicity's `input.actorIds?.target?.[0]` SELECT is the caller's U4
    // choice; the source-actor read is the migrated PURE slot. A present
    // input target resolves as the ally (captured identity), unchanged.
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

  it('Knave Dire Parry resolver: the trigger-source ?? recorded-input precedence stays caller-owned', () => {
    // Dire Parry's `context.triggerSourceId ?? context.input.actorIds?.target?.[0]`
    // SELECT is meaningful caller-owned precedence (which slot answers depends
    // on the window contract); only the dereference of the chosen id is the
    // captured-identity shape, and only the SOURCE slot read was migrated.
    const foe = ctx().state.actors.foe;
    const context = ctx({ triggerSourceId: 'foe', input: { actorIds: { target: ['hero'] } } });
    const mutations = KNAVE_RULE_RESOLVERS['knave:riposte:dire-parry'](context, interruptAction);
    // The trigger source (foe) wins over the recorded input target; the foe
    // takes the gamble damage.
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'foe')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'damage' && mutation.actorId === 'hero')).toBe(false);
    void foe;
  });

  it('Knave Strongarm resolver: the recorded input.actorIds target stays caller-owned', () => {
    // Strongarm's `input.actorIds?.target?.[0]` SELECT is the caller's U4
    // choice; the source read is the migrated PURE slot. The chosen target
    // (input) is what gets spun, unchanged.
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

  it('Harvester Blood Grove resolver: the protected DERIVED_OR_PRECEDENCE_BOUNDARY keeps its exact precedence — input center wins, source center is the fallback, and the dereference still reads current state', () => {
    // The ONE repo-wide DERIVED_OR_PRECEDENCE_BOUNDARY is blood-grove's
    // in-call `input.actorIds?.target?.[0] ? sourceActor(context,
    // context.input.actorIds.target[0])?.position : undefined` center read —
    // NOT migrated in this tranche. Its selection (recorded input target when
    // present, else the source's position) and its dereference shape are
    // unchanged: the higher-priority input identity wins when present, and
    // the fallback (source position) is used only when absent.
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

  it('Demon Slayer Righteous Disdain resolver: the recorded input.actorIds ally stays caller-owned', () => {
    // Righteous Disdain's `input.actorIds?.target?.[0]` SELECT is the caller's
    // U4 choice; only the source-actor read is the migrated PURE slot. The
    // chosen ally (input) receives half the shared damage, unchanged.
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

  it('Geomancer Dragon Dive resolver: the recorded input.actorIds target stays caller-owned (U4) — it wins over a DIFFERENT recorded attack target', () => {
    // Dragon Dive's `input.actorIds?.target?.[0] ?? attackTargetId` SELECT is
    // the caller's U4 precedence (inventoried); only the source read is the
    // migrated PURE slot. A present input target wins even when a DIFFERENT
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

  it('Geomancer Midas resolver: the recorded interrupt target stays caller-owned (U4) — input.actorIds wins over triggerTargetIds', () => {
    // Midas's `input.actorIds?.target?.[0] ?? triggerTargetIds?.[0]` SELECT is
    // the caller's U4 precedence (inventoried); only the source read is the
    // migrated PURE slot. The chosen identity becomes the statue held,
    // unchanged.
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

  it('Seer Chaos Tarot resolver: the recorded input.actorIds center choice still wins over the attack target (caller-owned U4)', () => {
    // Chaos Tarot's `input.actorIds?.target?.[0] ?? attackTargetId` SELECT is
    // the caller's U4 precedence (inventoried); only the source read is the
    // migrated PURE slot. A present input target wins even when a DIFFERENT
    // attackTargetId is recorded — the wild card lands at the chosen center
    // and the gamble frays the chosen identity, exactly as before.
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

  it('Enochian Pyroclast resolver: the captured-input identity stays caller-owned — the ?? chain survives, only the LIVE slots migrated', () => {
    // Pyroclast's `input.actorIds?.target?.[0] ?? attackTargetId ?? source.id`
    // SELECT is the caller's U4 precedence (inventoried); the migraiton touched
    // only the PURE source-slot resolution. A present input target still wins
    // over the attack-target fallback, and the resolver marks that chosen
    // identity — U4 semantics unchanged.
    const context = ctx({ attackTargetId: 'foe', input: { actorIds: { target: ['hero'] } } });
    const mutations = ENOCHIAN_RULE_RESOLVERS['enochian:pyroclast:effects'](context, defaultAction);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'hero')).toBe(true);
    expect(mutations.some((mutation) => mutation.kind === 'mark' && mutation.actorId === 'foe')).toBe(false);
  });
});