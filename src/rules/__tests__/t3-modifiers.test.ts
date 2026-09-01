/**
 * t3-modifiers.test.ts — Phase T3 U14 MODIFIER / POLICY tests.
 *
 * The ONE ModifierRule recipe shape (`primitives/modifiers.ts`) drives the
 * previously bespoke fold registries (range/area/mastery/bonus-damage) with
 * a shared gate evaluator and a deterministic fold discipline, and the typed
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
  modifierGateHolds,
  modifierRulesForSource,
  registerModifierRule,
  registerPermissionRule,
  roundModifierValue,
  PERMISSION_NEGATIVES,
  type ModifierFoldView,
  type ModifierGate,
} from '../automation/primitives/modifiers.js';
import { resolveModifierNumber } from '../automation/kernels/evaluate-modifiers.js';
import { registerRangeModifierRule, effectiveScopedRange, type RangeStateView } from '../automation/kernels/range.js';
import { registerMasteryModifierRule, effectiveInterruptRank, hasUnlimitedRange } from '../automation/kernels/mastery-fold.js';

/** Unique owner ability per test (the registry is module-global). */
let ownerSequence = 0;
const owner = (): string => `t3:ability:${(ownerSequence += 1)}`;

interface ViewOverrides {
  round?: number;
  actor?: Partial<ModifierFoldView['actor']>;
  selectedTalentSourceIds?: ReadonlySet<string>;
  target?: ModifierFoldView['target'];
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

describe('U14 — gates flip deterministically with state', () => {
  it('stealth / comeback / mastery / choice gates evaluate against the shared view', () => {
    const ability = owner();
    const stealth: ModifierGate = { kind: 'stealth' };
    const comeback: ModifierGate = { kind: 'comeback' };
    const mastery: ModifierGate = { kind: 'mastery', abilityId: ability };
    const choice: ModifierGate = { kind: 'choice', sourceId: 'fixture:talent-choice' };

    expect(modifierGateHolds(stealth, view())).toBe(false);
    expect(modifierGateHolds(stealth, view({ actor: { conditions: new Set(['stealth']) } }))).toBe(true);

    expect(modifierGateHolds(comeback, view())).toBe(false);
    expect(modifierGateHolds(comeback, view({ actor: { hp: 8 } }))).toBe(true);

    expect(modifierGateHolds(mastery, view())).toBe(false);
    expect(modifierGateHolds(mastery, view({ actor: { abilityIds: [ability], masteredAbilityIds: [ability] } }))).toBe(true);

    expect(modifierGateHolds(choice, view())).toBe(false);
    expect(modifierGateHolds(choice, view({ selectedTalentSourceIds: new Set(['fixture:talent-choice']) }))).toBe(true);
  });

  it('characterizes every retained gate before any U6 migration', () => {
    const ability = owner();
    const foe = (overrides: Partial<NonNullable<ModifierFoldView['target']>> = {}): NonNullable<ModifierFoldView['target']> => ({
      id: 'foe', side: 'foes', hp: 4, maxHp: 10, conditions: new Set(['burning']), ...overrides,
    });

    expect(modifierGateHolds({ kind: 'always' }, view())).toBe(true);
    expect(modifierGateHolds({ kind: 'charge' }, view({ actor: { slowTurn: true } }))).toBe(true);
    expect(modifierGateHolds({ kind: 'charge' }, view({ actor: { slowTurn: false } }))).toBe(false);
    expect(modifierGateHolds({ kind: 'round-at-least', value: 4 }, view({ round: 3 }))).toBe(false);
    expect(modifierGateHolds({ kind: 'round-at-least', value: 4 }, view({ round: 4 }))).toBe(true);
    expect(modifierGateHolds({ kind: 'self-bloodied' }, view({ actor: { hp: 10 } }))).toBe(true);
    expect(modifierGateHolds({ kind: 'target-bloodied' }, view({ target: foe() }))).toBe(true);
    expect(modifierGateHolds({ kind: 'target-has-condition' }, view({ target: foe() }))).toBe(true);
    expect(modifierGateHolds({ kind: 'target-has-condition', conditionId: 'burning' }, view({ target: foe() }))).toBe(true);

    // Mastery is conjunctive: mastered-but-unequipped and
    // equipped-but-unmastered both remain false.
    const mastery: ModifierGate = { kind: 'mastery', abilityId: ability };
    expect(modifierGateHolds(mastery, view({ actor: { masteredAbilityIds: [ability] } }))).toBe(false);
    expect(modifierGateHolds(mastery, view({ actor: { abilityIds: [ability] } }))).toBe(false);
  });

  it('fails target gates closed for missing/allied/malformed targets and never gains truth vacuously', () => {
    const targetBloodied: ModifierGate = { kind: 'target-bloodied' };
    const targetCondition: ModifierGate = { kind: 'target-has-condition' };
    const allied = { id: 'ally', side: 'heroes', hp: 1, maxHp: 10, conditions: new Set(['burning']) };
    const malformed = { id: 'foe', side: 'foes', hp: 0, maxHp: 0, conditions: new Set<string>() };

    for (const gate of [targetBloodied, targetCondition]) {
      expect(modifierGateHolds(gate, view())).toBe(false);
      expect(modifierGateHolds(gate, view({ target: allied }))).toBe(false);
    }
    expect(modifierGateHolds(targetBloodied, view({ target: malformed }))).toBe(false);
    expect(modifierGateHolds(targetCondition, view({ target: malformed }))).toBe(false);
    expect(modifierGateHolds(targetBloodied, view({ target: { ...malformed, hp: 8, maxHp: 10 } }))).toBe(false);
    expect(modifierGateHolds(targetCondition, view({ target: { ...malformed, maxHp: 10 } }))).toBe(false);

    // The intended U6 composition must preserve this existential target
    // requirement; `all([])` alone would incorrectly return true.
    expect([].every(() => false)).toBe(true);
    expect(modifierGateHolds(targetBloodied, view())).toBe(false);
  });

  it('bloodied gates require complete finite HP state before testing the half-HP boundary', () => {
    for (const kind of ['comeback', 'self-bloodied'] as const) {
      const gate: ModifierGate = { kind };
      expect(modifierGateHolds(gate, view({ actor: { hp: 10, maximumHp: 20 } }))).toBe(true);
      expect(modifierGateHolds(gate, view({ actor: { hp: 9, maximumHp: 20 } }))).toBe(true);
      expect(modifierGateHolds(gate, view({ actor: { hp: 11, maximumHp: 20 } }))).toBe(false);
      expect(modifierGateHolds(gate, view({ actor: { hp: undefined, maximumHp: 20 } }))).toBe(false);
      expect(modifierGateHolds(gate, view({ actor: { hp: 5, maximumHp: undefined } }))).toBe(false);
      expect(modifierGateHolds(gate, view({ actor: { hp: 0, maximumHp: 0 } }))).toBe(false);
      expect(modifierGateHolds(gate, view({ actor: { hp: Number.NaN, maximumHp: 20 } }))).toBe(false);
      expect(modifierGateHolds(gate, view({ actor: { hp: 5, maximumHp: Number.POSITIVE_INFINITY } }))).toBe(false);
    }
  });

  it('target-bloodied requires an existing hostile target with complete finite HP state', () => {
    const gate: ModifierGate = { kind: 'target-bloodied' };
    const target = (hp: number, maxHp: number): NonNullable<ModifierFoldView['target']> => ({
      id: 'foe', side: 'foes', hp, maxHp, conditions: new Set(),
    });
    expect(modifierGateHolds(gate, view({ target: target(10, 20) }))).toBe(true);
    expect(modifierGateHolds(gate, view({ target: target(9, 20) }))).toBe(true);
    expect(modifierGateHolds(gate, view({ target: target(11, 20) }))).toBe(false);
    expect(modifierGateHolds(gate, view())).toBe(false);
    expect(modifierGateHolds(gate, view({ target: { ...target(1, 20), side: 'heroes' } }))).toBe(false);
    expect(modifierGateHolds(gate, view({ target: target(0, 0) }))).toBe(false);
    expect(modifierGateHolds(gate, view({ target: target(Number.NaN, 20) }))).toBe(false);
    expect(modifierGateHolds(gate, view({ target: target(5, Number.POSITIVE_INFINITY) }))).toBe(false);
    expect(modifierGateHolds(gate, view({
      target: { ...target(1, 20), hp: undefined } as unknown as NonNullable<ModifierFoldView['target']>,
    }))).toBe(false);
    expect(modifierGateHolds(gate, view({
      target: { ...target(1, 20), maxHp: undefined } as unknown as NonNullable<ModifierFoldView['target']>,
    }))).toBe(false);
  });

  it('a predicate-gated rule flips on and off as state changes (never a stale fold)', () => {
    const ability = owner();
    registerModifierRule({ sourceId: 't3:gated', ownerId: ability, queryPoint: 'listed-range', scope: 'attack', operation: 'set', value: constantModifierValue(5), gates: [{ kind: 'comeback' }] });
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, view(), {}, resolveModifierNumber)).toBe(2);
    expect(foldNumberModifiers('listed-range', 'attack', 2, ability, view({ actor: { hp: 8 } }), {}, resolveModifierNumber)).toBe(5);
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
    const rangeView: RangeStateView = {
      round: 2,
      actors: {
        hero: { id: 'hero', position: { x: 1, y: 1 }, hp: 20, maximumHp: 20, abilityIds: [ability], masteredAbilityIds: [], talents: {} },
      },
      conditionsFor: () => new Set<string>(),
      selectedTalentSourceIds: new Set<string>(),
    };
    expect(effectiveScopedRange(rangeView, 'hero', ability, 2, 'attack')).toBe(2);
    // The choice gate holds → the shared fold applies the override.
    const opted = { ...rangeView, selectedTalentSourceIds: new Set(['t3:range-rule']) };
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
    const foldView = {
      round: 1,
      actors: {
        hero: { abilityIds: [ability], masteredAbilityIds: [ability], hp: 20, maximumHp: 20 },
      },
    };
    expect(effectiveInterruptRank(foldView, 'hero', ability, 1)).toBe(3);
    // Unequipped/unmastered → the baked-in mastery gate holds nothing, so an
    // `always` gate still never fires for an unmastered parent.
    const unequipped = { round: 1, actors: { hero: { abilityIds: [], masteredAbilityIds: [], hp: 20, maximumHp: 20 } } };
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
