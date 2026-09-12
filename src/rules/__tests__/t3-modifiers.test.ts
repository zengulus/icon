/**
 * t3-modifiers.test.ts — Phase T3 U14 MODIFIER / POLICY tests.
 *
 * The ONE ModifierRule recipe shape (`primitives/modifiers.ts`) drives the
 * previously bespoke fold registries (range/area/mastery/bonus-damage) with
 * one U6 applicability authority (the authoring gate shorthand lowers onto
 * `RulePredicate`; `evaluatePredicate` decides) and a deterministic fold
 * discipline, and the typed
 * PERMISSION query points carry CLOSED negatives (never a wildcard bypass,
 * never every-bypass-aliased-to-Divine).
 *
 * Covered here: one-shape numeric/enumerated folds, scope filtering, the
 * ownership gate, gates flipping deterministically with state, the
 * deterministic last-wins winner at a query point, typed permission
 * distinctness + closed-negative rejection, and the replay property (the
 * fold is a pure function — evaluated twice, identical). The modifier
 * registry is module-global, so every test uses its OWN owner ability id —
 * no cross-test leakage.
 */
import { describe, expect, it } from 'vitest';
import {
  applicableModifierRules,
  constantModifierValue,
  effectivePermission,
  enumeratedModifierValue,
  foldEnumeratedModifiers,
  foldNumberModifiers,
  modifierRulesForSource,
  registerModifierRule,
  registerPermissionRule,
  roundModifierValue,
  PERMISSION_NEGATIVES,
  type ModifierFoldView,
  type ModifierGate,
} from '../automation/primitives/modifiers.js';
import { modifierApplicabilityHolds, modifierGatePredicate, resolveModifierNumber } from '../automation/kernels/evaluate-modifiers.js';
import { registerRangeModifierRule, effectiveScopedRange, type RangeStateView } from '../automation/kernels/range.js';
import { registerMasteryModifierRule, effectiveInterruptRank, hasUnlimitedRange } from '../automation/kernels/mastery-fold.js';
import { predicateContext, ruleActorView } from './fixtures.js';
import type { RuleActorView } from '../automation/primitives/types.js';

/** Unique owner ability per test (the registry is module-global). */
let ownerSequence = 0;
const owner = (): string => `t3:ability:${(ownerSequence += 1)}`;

interface ViewOverrides {
  round?: number;
  actor?: Partial<ModifierFoldView['actor']>;
  selectedTalentSourceIds?: ReadonlySet<string>;
  target?: ModifierFoldView['target'];
}

/**
 * A fold view carrying the REAL U6 applicability pair (authority + durable
 * predicate context) exactly as the production adapters project it, so a
 * gated row's truth is decided by `evaluatePredicate` — never locally. The
 * state the predicates read is the same typed `RuleActorView`/`RuntimeState`
 * projection the encounter adapters build.
 */
function gatedView(overrides: {
  round?: number;
  actor?: Partial<RuleActorView>;
  target?: Partial<RuleActorView>;
  selectedTalentSourceIds?: ReadonlySet<string>;
} = {}): ModifierFoldView {
  const actor = ruleActorView({ id: 'hero', ...(overrides.actor ?? {}) });
  const target = overrides.target === undefined ? undefined : ruleActorView({ id: 'foe', side: 'foes', ...overrides.target });
  const context = predicateContext(target === undefined ? [actor] : [actor, target], {
    actorId: actor.id,
    ...(overrides.round === undefined ? {} : { round: overrides.round }),
    ...(target === undefined ? {} : { attackTargetId: target.id }),
    ...(overrides.selectedTalentSourceIds === undefined ? {} : { talentChoices: [...overrides.selectedTalentSourceIds] }),
  });
  return {
    round: overrides.round ?? 1,
    actor: { id: actor.id },
    conditionsFor: () => actor.conditions,
    applies: modifierApplicabilityHolds,
    applicabilityContext: () => context,
    ...(target === undefined ? {} : {
      target: { id: target.id, side: target.side, hp: target.hp, maxHp: target.baseMaxHp ?? 0, conditions: target.conditions },
    }),
  };
}

/** The lowered gate decided by the ONE U6 authority. */
function gateHolds(gate: ModifierGate, view: ModifierFoldView): boolean {
  return modifierApplicabilityHolds(modifierGatePredicate(gate), view);
}

function view(overrides: ViewOverrides = {}): ModifierFoldView {
  const baseActor: ModifierFoldView['actor'] = {
    id: 'hero',
    hp: 15,
    maximumHp: 20,
    abilityIds: [],
    masteredAbilityIds: [],
    talents: {},
    conditions: new Set<string>(),
    side: 'heroes',
  };
  const actor = { ...baseActor, ...(overrides.actor ?? {}) };
  return {
    round: overrides.round ?? 3,
    actor,
    // The stealth gate reads conditionsFor — derive it from the actor's
    // condition set so the gate and the view never disagree.
    conditionsFor: () => new Set([...(actor.conditions ?? [])]),
    ...(overrides.selectedTalentSourceIds ? { selectedTalentSourceIds: overrides.selectedTalentSourceIds } : {}),
    ...(overrides.target ? { target: overrides.target } : {}),
  };
}

describe('U14 — one ModifierRule shape drives numeric folds', () => {
  it('add accumulates and the last override wins at the same query point (deterministic winner)', () => {
    const ability = owner();
    registerModifierRule({ sourceId: 't3:a', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'add', value: constantModifierValue(1) });
    registerModifierRule({ sourceId: 't3:b', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'add', value: constantModifierValue(2) });
    registerModifierRule({ sourceId: 't3:c', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'override', value: constantModifierValue(6) });
    // Adds accumulate to 3, then the last override replaces with 6.
    expect(foldNumberModifiers('listed-range', 'attack', 0, ability, view(), {}, resolveModifierNumber)).toBe(6);
    // Determinism (replay property): the same fold on the same state is identical.
    expect(foldNumberModifiers('listed-range', 'attack', 0, ability, view(), {}, resolveModifierNumber)).toBe(6);
  });

  it('an unowned modifier never folds (ownership gate)', () => {
    const ability = owner();
    registerModifierRule({ sourceId: 't3:other', ownerId: 'other:ability', queryPoint: 'listed-range', scope: 'attack', operation: 'set', value: constantModifierValue(99) });
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, view(), {}, resolveModifierNumber)).toBe(2);
  });

  it('scope filtering keeps a rule inside its declared scope', () => {
    const ability = owner();
    registerModifierRule({ sourceId: 't3:scoped', ownerId: ability, queryPoint: 'listed-range', scope: 'terrain-placement', operation: 'add', value: constantModifierValue(1) });
    // The 'attack' scope is untouched; the internal scope folds.
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, view(), {}, resolveModifierNumber)).toBe(2);
    expect(foldNumberModifiers('listed-range', 'terrain-placement', 3, ability, view(), {}, resolveModifierNumber)).toBe(4);
  });

  it('unknown query points reject at registration (a typo can never fold elsewhere)', () => {
    expect(() => registerModifierRule({
      sourceId: 't3:typo', ownerId: owner(),
      // @ts-expect-error — an unknown query point is not in the typed union.
      queryPoint: 'not-a-query-point', scope: 'default', operation: 'set', value: constantModifierValue(1),
    })).toThrow(/Unknown modifier query point/);
  });

  it('the enumerated fold replaces with the last set and honors the from-guard (damage-type chains)', () => {
    const ability = owner();
    registerModifierRule({ sourceId: 't3:convert', ownerId: ability, queryPoint: 'damage-type', scope: 'default', operation: 'set', value: enumeratedModifierValue('divine'), from: 'piercing' });
    // Unmatched base passes through; matched base converts.
    expect(foldEnumeratedModifiers('damage-type', 'default', 'normal', ability, view())).toBe('normal');
    expect(foldEnumeratedModifiers('damage-type', 'default', 'piercing', ability, view())).toBe('divine');
  });
});

describe('U14 — the authoring gates lower losslessly onto U6 predicates', () => {
  it('maps every authoring gate onto its exact U6 predicate (syntax, never truth)', () => {
    const ability = owner();
    expect(modifierGatePredicate({ kind: 'always' })).toEqual({ kind: 'always' });
    expect(modifierGatePredicate({ kind: 'stealth' })).toEqual({ kind: 'has-condition', target: { kind: 'self' }, conditionId: 'stealth' });
    expect(modifierGatePredicate({ kind: 'comeback' })).toEqual({ kind: 'bloodied', target: { kind: 'self' } });
    expect(modifierGatePredicate({ kind: 'self-bloodied' })).toEqual({ kind: 'bloodied', target: { kind: 'self' } });
    expect(modifierGatePredicate({ kind: 'charge' })).toEqual({ kind: 'slow-turn', target: { kind: 'self' } });
    expect(modifierGatePredicate({ kind: 'round-at-least', value: 4 })).toEqual({
      kind: 'compare', left: { kind: 'round' }, operator: '>=', right: { kind: 'constant', value: 4 },
    });
    expect(modifierGatePredicate({ kind: 'mastery', abilityId: ability })).toEqual({ kind: 'has-mastery', target: { kind: 'self' }, abilityId: ability });
    expect(modifierGatePredicate({ kind: 'choice', sourceId: 't3:choice' })).toEqual({ kind: 'declared-choice', sourceId: 't3:choice' });
    // Target gates compose the state read WITH the hostile-relation read, so a
    // same-side actor can never satisfy "your foe is bloodied" (`all([])`
    // vacuity is not reachable: the relation half is non-vacuous).
    expect(modifierGatePredicate({ kind: 'target-bloodied' })).toEqual({
      kind: 'all',
      predicates: [
        { kind: 'bloodied', target: { kind: 'attack-target' } },
        { kind: 'relation', target: { kind: 'attack-target' }, relation: 'foe' },
      ],
    });
    expect(modifierGatePredicate({ kind: 'target-has-condition' })).toEqual({
      kind: 'all',
      predicates: [
        { kind: 'has-condition', target: { kind: 'attack-target' } },
        { kind: 'relation', target: { kind: 'attack-target' }, relation: 'foe' },
      ],
    });
    expect(modifierGatePredicate({ kind: 'target-has-condition', conditionId: 'burning' })).toEqual({
      kind: 'all',
      predicates: [
        { kind: 'has-condition', target: { kind: 'attack-target' }, conditionId: 'burning' },
        { kind: 'relation', target: { kind: 'attack-target' }, relation: 'foe' },
      ],
    });
  });

  it('every authoring gate is decided by the ONE U6 authority against durable state', () => {
    const ability = owner();
    expect(gateHolds({ kind: 'always' }, gatedView())).toBe(true);

    expect(gateHolds({ kind: 'stealth' }, gatedView())).toBe(false);
    expect(gateHolds({ kind: 'stealth' }, gatedView({ actor: { conditions: new Set(['stealth']) } }))).toBe(true);

    // Bloodied is measured against the BASE maximum (p.81): exactly half is in.
    expect(gateHolds({ kind: 'comeback' }, gatedView({ actor: { hp: 10, baseMaxHp: 20 } }))).toBe(true);
    expect(gateHolds({ kind: 'comeback' }, gatedView({ actor: { hp: 11, baseMaxHp: 20 } }))).toBe(false);

    expect(gateHolds({ kind: 'charge' }, gatedView({ actor: { state: { 'slow-turn': true } } }))).toBe(true);
    expect(gateHolds({ kind: 'charge' }, gatedView({ actor: { state: { 'slow-turn': false } } }))).toBe(false);

    expect(gateHolds({ kind: 'round-at-least', value: 4 }, gatedView({ round: 3 }))).toBe(false);
    expect(gateHolds({ kind: 'round-at-least', value: 4 }, gatedView({ round: 4 }))).toBe(true);

    const mastery: ModifierGate = { kind: 'mastery', abilityId: ability };
    expect(gateHolds(mastery, gatedView())).toBe(false);
    expect(gateHolds(mastery, gatedView({ actor: { abilityIds: [ability] } }))).toBe(false);
    expect(gateHolds(mastery, gatedView({ actor: { masteredAbilityIds: [ability] } }))).toBe(false);
    expect(gateHolds(mastery, gatedView({ actor: { abilityIds: [ability], masteredAbilityIds: [ability] } }))).toBe(true);

    const choice: ModifierGate = { kind: 'choice', sourceId: 't3:declared' };
    expect(gateHolds(choice, gatedView())).toBe(false);
    expect(gateHolds(choice, gatedView({ selectedTalentSourceIds: new Set(['t3:declared']) }))).toBe(true);

    expect(gateHolds({ kind: 'target-bloodied' }, gatedView({ target: { hp: 4, baseMaxHp: 10 } }))).toBe(true);
    expect(gateHolds({ kind: 'target-bloodied' }, gatedView({ target: { hp: 6, baseMaxHp: 10 } }))).toBe(false);
    expect(gateHolds({ kind: 'target-has-condition' }, gatedView({ target: { conditions: new Set(['burning']) } }))).toBe(true);
    expect(gateHolds({ kind: 'target-has-condition' }, gatedView({ target: { conditions: new Set() } }))).toBe(false);
    expect(gateHolds({ kind: 'target-has-condition', conditionId: 'burning' }, gatedView({ target: { conditions: new Set(['burning']) } }))).toBe(true);
    expect(gateHolds({ kind: 'target-has-condition', conditionId: 'weakened' }, gatedView({ target: { conditions: new Set(['burning']) } }))).toBe(false);
    // An ALLIED attack target never satisfies a target-scoped gate, however
    // bloodied/statused it is — the relation half of the composition.
    expect(gateHolds({ kind: 'target-bloodied' }, gatedView({ target: { side: 'heroes', hp: 1, baseMaxHp: 10 } }))).toBe(false);
    expect(gateHolds({ kind: 'target-has-condition' }, gatedView({ target: { side: 'heroes', conditions: new Set(['burning']) } }))).toBe(false);
    // No attack target at all: false, never a vacuous truth.
    expect(gateHolds({ kind: 'target-bloodied' }, gatedView())).toBe(false);
    expect(gateHolds({ kind: 'target-has-condition' }, gatedView())).toBe(false);
  });

  it('fails closed when the applicability authority or its context is missing', () => {
    // A gated rule folded against a view with no injected U6 authority must
    // reject rather than silently apply (or silently skip).
    expect(() => foldNumberModifiers(
      'listed-range', 'attack', 2, owner(), view(), {}, resolveModifierNumber,
    )).not.toThrow();
    const ability = owner();
    registerModifierRule({ sourceId: 't3:ungated', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'add', value: constantModifierValue(1) });
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, view(), {}, resolveModifierNumber)).toBe(3);

    const gated = owner();
    registerModifierRule({ sourceId: 't3:gated-no-context', ownerId: gated, queryPoint: 'listed-range', scope: 'attack', operation: 'add', value: constantModifierValue(1), applicability: { kind: 'always' } });
    expect(() => foldNumberModifiers('listed-range', 'attack', 2, gated, view(), {}, resolveModifierNumber))
      .toThrow(/no applicability authority/);
    // The authority is present but the durable context is not: the boundary
    // reports the missing read rather than guessing.
    const noContext: ModifierFoldView = { ...view(), applies: modifierApplicabilityHolds };
    expect(() => foldNumberModifiers('listed-range', 'attack', 2, gated, noContext, {}, resolveModifierNumber))
      .toThrow(/no U6 predicate context/);
    // A predicate outside the lowered gate vocabulary rejects too — the seam
    // cannot be used to smuggle an unrepresentable clause in.
    const smuggled = owner();
    registerModifierRule({ sourceId: 't3:smuggled', ownerId: smuggled, queryPoint: 'listed-range', scope: 'attack', operation: 'add', value: constantModifierValue(1), applicability: { kind: 'in-terrain', target: { kind: 'self' }, terrain: 'pit' } });
    expect(() => foldNumberModifiers('listed-range', 'attack', 2, smuggled, gatedView(), {}, resolveModifierNumber))
      .toThrow(/not part of the lowered modifier-gate vocabulary/);
  });

  it('a gated rule flips on and off as durable state changes (never a stale fold)', () => {
    const ability = owner();
    registerModifierRule({
      sourceId: 't3:gated', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'set',
      value: constantModifierValue(5), applicability: modifierGatePredicate({ kind: 'comeback' }),
    });
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, gatedView({ actor: { hp: 15, baseMaxHp: 20 } }), {}, resolveModifierNumber)).toBe(2);
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, gatedView({ actor: { hp: 8, baseMaxHp: 20 } }), {}, resolveModifierNumber)).toBe(5);
  });
});

describe('U14 — typed permissions with closed negatives', () => {
  it('cannot / ignore / immune stay distinct typed query points', () => {
    const ability = owner();
    // cover-ignore and range-bound-immune are different pairs on different
    // query points — a grant for one never aliases to the other.
    registerPermissionRule({ sourceId: 't3:unerring', ownerId: ability, queryPoint: 'cover', kind: 'ignore' });
    registerPermissionRule({ sourceId: 't3:norange', ownerId: ability, queryPoint: 'range-bound', kind: 'immune' });
    expect(effectivePermission('cover', ability, view())).toBe('ignore');
    expect(effectivePermission('range-bound', ability, view())).toBe('immune');
    // The dodge/armor/defiance/aetherwall/vigor points stay unset.
    expect(effectivePermission('dodge', ability, view())).toBeNull();
    expect(effectivePermission('aetherwall', ability, view())).toBeNull();
  });

  it('a (queryPoint, kind) pair outside the closed registry rejects — wildcard bypass is unrepresentable', () => {
    expect(() => registerPermissionRule({ sourceId: 't3:bad', ownerId: owner(), queryPoint: 'cover', kind: 'immune' })).toThrow(/not a closed negative/);
    expect(() => registerPermissionRule({ sourceId: 't3:bad2', ownerId: owner(), queryPoint: 'range-bound', kind: 'ignore' })).toThrow(/not a closed negative/);
    // The closed registry enumerates exactly the supported negatives.
    expect(PERMISSION_NEGATIVES.cover).toEqual(['ignore']);
    expect(PERMISSION_NEGATIVES['range-bound']).toEqual(['immune']);
  });

  it('a permission never applies to an unowned ability', () => {
    const ability = owner();
    registerPermissionRule({ sourceId: 't3:owned', ownerId: ability, queryPoint: 'cover', kind: 'ignore' });
    expect(effectivePermission('cover', 'other:ability', view())).toBeNull();
  });
});

describe('U14 — the range and mastery kernels fold through the shared registry (parity)', () => {
  it('effectiveScopedRange reads a range row registered through the kernel surface', () => {
    const ability = owner();
    registerRangeModifierRule({
      sourceId: 't3:range-rule',
      abilityId: ability,
      mode: 'override',
      value: 6,
      gate: { kind: 'choice', sourceId: 't3:range-rule' },
    });
    const rangeContext = (talentChoices: readonly string[]) => predicateContext(
      [ruleActorView({ id: 'hero', abilityIds: [ability] })],
      { actorId: 'hero', round: 2, talentChoices },
    );
    const rangeView: RangeStateView = {
      round: 2,
      actors: {
        hero: { id: 'hero', position: { x: 1, y: 1 }, hp: 20, maximumHp: 20, abilityIds: [ability], masteredAbilityIds: [], talents: {} },
      },
      conditionsFor: () => new Set<string>(),
      selectedTalentSourceIds: new Set<string>(),
      // The U6 applicability pair the production adapter projects.
      applies: modifierApplicabilityHolds,
      applicabilityContext: () => rangeContext([]),
    };
    expect(effectiveScopedRange(rangeView, 'hero', ability, 2, 'attack')).toBe(2);
    // The choice gate holds → the shared fold applies the override.
    const opted = {
      ...rangeView,
      selectedTalentSourceIds: new Set(['t3:range-rule']),
      applicabilityContext: () => rangeContext(['t3:range-rule']),
    };
    expect(effectiveScopedRange(opted, 'hero', ability, 2, 'attack')).toBe(6);
    // The rule is registered as a shared row at the listed-range query point.
    expect(modifierRulesForSource('t3:range-rule', 'listed-range').length).toBe(1);
  });

  it('effectiveInterruptRank and hasUnlimitedRange fold through the shared registry (mastery ownership baked in)', () => {
    const ability = owner();
    registerMasteryModifierRule({
      sourceId: 't3:interrupt',
      abilityId: ability,
      gate: { kind: 'always' },
      modifier: { kind: 'interrupt-rank', rank: 3 },
    });
    const masteryContext = (actor: RuleActorView) => predicateContext([actor], { actorId: actor.id });
    const masteredActor = ruleActorView({ id: 'hero', abilityIds: [ability], masteredAbilityIds: [ability] });
    const foldView = {
      round: 1,
      actors: {
        hero: { abilityIds: [ability], masteredAbilityIds: [ability], hp: 20, maximumHp: 20 },
      },
      applies: modifierApplicabilityHolds,
      applicabilityContext: () => masteryContext(masteredActor),
    };
    expect(effectiveInterruptRank(foldView, 'hero', ability, 1)).toBe(3);
    // Unequipped/unmastered → the baked-in mastery gate holds nothing, so an
    // `always` gate still never fires for an unmastered parent.
    const unequippedActor = ruleActorView({ id: 'hero' });
    const unequipped = {
      round: 1,
      actors: { hero: { abilityIds: [], masteredAbilityIds: [], hp: 20, maximumHp: 20 } },
      applies: modifierApplicabilityHolds,
      applicabilityContext: () => masteryContext(unequippedActor),
    };
    expect(effectiveInterruptRank(unequipped, 'hero', ability, 1)).toBe(1);
    expect(hasUnlimitedRange(foldView, 'hero', ability)).toBe(false);
  });

  it('applicableModifierRules returns the ordered applicable subset', () => {
    const ability = owner();
    registerModifierRule({ sourceId: 't3:app', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'add', value: constantModifierValue(1) });
    const rules = applicableModifierRules('listed-range', 'attack', ability, view());
    expect(rules.every((rule) => rule.ownerId === ability && rule.scope === 'attack')).toBe(true);
  });
});

describe('U14 — numeric values are U5 RuleNumbers (corrected contract)', () => {
  it('parity: a { kind: \'round\' } RuleNumber modifier produces the existing dynamic-round behavior', () => {
    const ability = owner();
    // The old `'round'` special literal is now the U5 `{ kind: 'round' }`
    // expression — same behavior, resolved through the kernel-layer resolver.
    registerModifierRule({ sourceId: 't3:round', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'set', value: roundModifierValue() });
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, view({ round: 3 }), {}, resolveModifierNumber)).toBe(3);
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, view({ round: 7 }), {}, resolveModifierNumber)).toBe(7);
  });

  it('a composed U5 expression folds through the seam (no special-case dynamic literals)', () => {
    const ability = owner();
    // `round + 2` composed entirely in the U5 vocabulary — the seam cannot
    // regress into special literals because the value IS a RuleNumber.
    const expression = {
      kind: 'add' as const,
      values: [
        { kind: 'constant' as const, value: 2 },
        { kind: 'round' as const },
      ],
    };
    registerModifierRule({ sourceId: 't3:composed', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'set', value: { kind: 'number', value: expression } });
    expect(foldNumberModifiers('listed-range', 'attack', 0, ability, view({ round: 3 }), {}, resolveModifierNumber)).toBe(5);
  });

  it('a context-dependent RuleNumber fails closed at resolution (never a guessed value)', () => {
    const ability = owner();
    // `input` needs full execution context — the fold view cannot answer it.
    registerModifierRule({
      sourceId: 't3:unrepresentable', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'set',
      value: { kind: 'number', value: { kind: 'input', key: 'choice' } },
    });
    expect(() => foldNumberModifiers('listed-range', 'attack', 0, ability, view(), {}, resolveModifierNumber))
      .toThrow(/cannot be resolved against the modifier fold view/);
  });
});
