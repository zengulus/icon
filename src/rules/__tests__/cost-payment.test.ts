import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { executeCommand, applyEvents, createEncounter, createFoe, actorFromCharacter, RuleViolation } from '../encounter.js';
import { applyRuleMutations } from '../automation/kernels/encounter-adapter.js';
import { executeRuleProgram } from '../automation/kernels/runtime.js';
import {
  assertRuleCostsPayable,
  costContextFromRuntime,
  effectiveRuleCosts,
  evaluateCosts,
  registerCostModifierRule,
  ruleCostMutations,
  CostPaymentViolation,
  type CostPaymentContext,
} from '../automation/kernels/cost-payment.js';
import {
  actionSpendMutation,
  assertResourceSufficient,
  assertSacrificePayable,
  availableResource,
  resourceSpendMutation,
  sacrificeMutation,
  type ResourcePayer,
} from '../automation/primitives/cost-payment.js';
import type { RuleActorView, RuleExecutionContext, RuleProgram, RuleRuntimeState } from '../automation/primitives/types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';
import type { EncounterState } from '../types.js';

/**
 * F14 cost-payment transaction foundation (docs/rules-foundations.md §10
 * item 1) — one trustworthy transactional boundary for paying mechanical
 * costs before an effect resolves:
 *
 * - ordinary resource payments validate availability BEFORE resolution and
 *   emit a durable spend mutation (replay applies exactly the recorded
 *   spend — never a re-decided amount);
 * - Sacrifice reduces HP as a cost at the beginning of the action, cannot be
 *   reduced / ignored / transferred / resisted, cannot reduce below 1 HP,
 *   may be paid even when the payer has less HP than the nominal amount, and
 *   never opens ordinary when-damaged / foe-damage windows;
 * - cost modifiers fold the effective costs at the same boundary the runtime
 *   pays them.
 */

// ── Runtime-view fixture (mirrors automation.test.ts) ───────────────────────

const actor = (id: string, side: RuleActorView['side'], x: number, overrides: Partial<RuleActorView> = {}): RuleActorView => ({
  id,
  side,
  position: { x, y: 0 },
  hp: 20,
  maxHp: 40,
  vitality: 10,
  vigor: 0,
  defense: 8,
  armor: 0,
  speed: 4,
  dash: 2,
  fray: 3,
  damageDie: 8,
  actions: 2,
  attacked: false,
  size: 1,
  defeated: false,
  conditions: new Set(),
  resources: {},
  state: {},
  traitIds: [],
  talents: {},
  abilityIds: [],
  masteredAbilityIds: [],
  marks: [],
  ...overrides,
  statuses: overrides.statuses ?? [],
  statusSavePolicy: overrides.statusSavePolicy ?? { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
});

const runtimeState = (overrides: Partial<RuleRuntimeState> = {}): RuleRuntimeState => ({
  round: 3,
  grid: { width: 10, height: 10 },
  actors: {
    hero: actor('hero', 'heroes', 0, { resources: { aether: 4, blessing: 1 } }),
    ally: actor('ally', 'heroes', 1),
    foe: actor('foe', 'foes', 2),
  },
  entities: {},
  terrainEffects: [],
  terrainAt: () => new Set(),
  elevationAt: () => 0,
  ...overrides,
});

const contextFor = (state: RuleRuntimeState, sourceId = 'fixture:cost-ability', label = 'Fixture Cost Ability'): CostPaymentContext =>
  costContextFromRuntime(state, 'hero', sourceId, label);

const constant = (value: number): RuleNumber => ({ kind: 'constant', value });

// ── Ordinary resource payments ──────────────────────────────────────────────

describe('cost-payment: ordinary resource payments', () => {
  it('availableResource combines the party pool with personal resolve (p.99)', () => {
    const payer: ResourcePayer = { resources: { 'personal-resolve': 2, aether: 3 } };
    expect(availableResource(payer, 1, 'resolve')).toBe(3); // party 1 + personal 2
    expect(availableResource(payer, 0, 'aether')).toBe(3);
    expect(availableResource(payer, 0, 'blessing')).toBe(0);
  });

  it('assertResourceSufficient rejects an insufficient payment with the caller message', () => {
    expect(() => assertResourceSufficient({ resources: { aether: 1 } }, 0, 'aether', 3, (available) => `needs 3, have ${available}`))
      .toThrow(CostPaymentViolation);
    expect(() => assertResourceSufficient({ resources: { aether: 1 } }, 0, 'aether', 3, (available) => `needs 3, have ${available}`))
      .toThrow(/needs 3, have 1/);
    // Exactly enough never rejects.
    expect(() => assertResourceSufficient({ resources: { aether: 3 } }, 0, 'aether', 3, () => 'nope')).not.toThrow();
  });

  it('assertRuleCostsPayable aggregates multiple spends of one resource', () => {
    const state = runtimeState({ actors: { hero: actor('hero', 'heroes', 0, { resources: { aether: 3 } }) } });
    const ctx = contextFor(state);
    expect(() => assertRuleCostsPayable(ctx, [
      { kind: 'aether', amount: 2 },
      { kind: 'aether', amount: 2 },
    ])).toThrow(/requires 4 aether, but only 3 is available/);
    expect(() => assertRuleCostsPayable(ctx, [
      { kind: 'aether', amount: 2 },
      { kind: 'aether', amount: 1 },
    ])).not.toThrow();
  });

  it('assertRuleCostsPayable rejects insufficient actions before anything resolves', () => {
    const state = runtimeState({ actors: { hero: actor('hero', 'heroes', 0, { actions: 1 }) } });
    const ctx = contextFor(state);
    expect(() => assertRuleCostsPayable(ctx, [{ kind: 'action', amount: 2 }]))
      .toThrow(/costs more actions than are available/);
  });

  it('assertRuleCostsPayable never rejects a sacrifice on amount — only on payer availability', () => {
    const state = runtimeState({ actors: { hero: actor('hero', 'heroes', 0, { hp: 3 }) } });
    const ctx = contextFor(state);
    // 3 HP < 50 nominal sacrifice: still payable (floor 1, may overpay).
    expect(() => assertRuleCostsPayable(ctx, [{ kind: 'sacrifice', amount: 50 }])).not.toThrow();
  });

  it('assertSacrificePayable rejects only an unavailable payer', () => {
    expect(() => assertSacrificePayable({ defeated: true, onBattlefield: true }, () => 'nope')).toThrow(CostPaymentViolation);
    expect(() => assertSacrificePayable({ defeated: false, onBattlefield: true }, () => 'nope')).not.toThrow();
  });
});

// ── Payment mutations ───────────────────────────────────────────────────────

describe('cost-payment: durable payment mutations', () => {
  it('ruleCostMutations emits the exact reducer shapes in source order', () => {
    const state = runtimeState();
    const ctx = contextFor(state);
    const mutations = ruleCostMutations(ctx, [
      { kind: 'action', amount: 1 },
      { kind: 'aether', amount: 2 },
      { kind: 'sacrifice', amount: 6 },
      { kind: 'resolve', amount: 2 },
    ]);
    expect(mutations).toEqual([
      actionSpendMutation('fixture:cost-ability', 'hero', 1),
      resourceSpendMutation('fixture:cost-ability', 'hero', 'aether', 2),
      sacrificeMutation('fixture:cost-ability', 'hero', 6),
      resourceSpendMutation('fixture:cost-ability', 'hero', 'resolve', 2),
    ]);
  });

  it('a VM program pays its declared costs through the shared kernel', () => {
    const program: RuleProgram = {
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: 'program:fixture-cost-strike',
      sourceId: 'fixture-cost-strike',
      source: { page: 1, sectionId: 'test' },
      name: 'Fixture Cost Strike',
      classification: 'encounter',
      dependencies: [],
      actions: [{
        id: 'use', name: 'Fixture Cost Strike', timing: 'use',
        costs: [
          { kind: 'action', amount: constant(1) },
          { kind: 'aether', amount: constant(2) },
          { kind: 'sacrifice', amount: constant(6) },
        ],
        tags: [], range: null, area: null, choices: [],
        steps: [{ id: 'mark', timing: 'use', effects: [{ kind: 'state', target: { kind: 'self' }, key: 'paid', operation: 'set', value: true }] }],
      }],
    };
    const context: RuleExecutionContext = {
      state: runtimeState({ actors: { hero: actor('hero', 'heroes', 0, { resources: { aether: 2 }, hp: 20 }) } }),
      actorId: 'hero',
      sourceId: 'fixture-cost-strike',
      actionId: 'use',
      timing: 'use',
      input: {},
      dice: scriptedDice(),
    };
    const result = executeRuleProgram(program, context);
    expect(result.mutations).toContainEqual(actionSpendMutation('fixture-cost-strike', 'hero', 1));
    expect(result.mutations).toContainEqual(resourceSpendMutation('fixture-cost-strike', 'hero', 'aether', 2));
    expect(result.mutations).toContainEqual(sacrificeMutation('fixture-cost-strike', 'hero', 6));
    // The cost mutations precede the step effects (payment at the beginning
    // of the action).
    expect(result.mutations.indexOf(actionSpendMutation('fixture-cost-strike', 'hero', 1)))
      .toBeLessThan(result.mutations.findIndex((mutation) => mutation.kind === 'state'));
  });
});

// ── Cost modification ───────────────────────────────────────────────────────

describe('cost-payment: cost modifiers fold the effective costs', () => {
  // Test-scoped modifier (vitest isolates files): reduce aether costs by 1 to
  // a minimum of 1 for one fixture source — the Elden Rune shape (p.209
  // "infuse costs of your spells are reduced by 1, to a minimum of 1").
  const MODIFIER_SOURCE = 'fixture:cost-ability';
  registerCostModifierRule({
    sourceId: 'fixture:cost-modifier',
    applies: (ctx) => ctx.sourceId === MODIFIER_SOURCE,
    modify: (costs) => costs.map((cost) => cost.kind === 'aether'
      ? { ...cost, amount: constant(Math.max(1, (cost.amount as { kind: 'constant'; value: number }).value - 1)) }
      : cost),
  });

  it('effectiveRuleCosts applies the modifier and the gate validates the reduced amount', () => {
    const state = runtimeState({ actors: { hero: actor('hero', 'heroes', 0, { resources: { aether: 2 } }) } });
    const ctx = contextFor(state);
    const effective = effectiveRuleCosts([{ kind: 'aether', amount: constant(3) }], ctx);
    const evaluated = evaluateCosts(effective, (amount) => (amount as { kind: 'constant'; value: number }).value);
    expect(evaluated).toEqual([{ kind: 'aether', amount: 2 }]);
    // 2 aether covers the reduced cost — the modifier makes the payment legal.
    expect(() => assertRuleCostsPayable(ctx, evaluated)).not.toThrow();
    // Without the modifier (a different source) the original 3 is validated.
    const plainCtx = contextFor(state, 'fixture:other-ability', 'Other');
    expect(() => assertRuleCostsPayable(plainCtx, evaluateCosts([{ kind: 'aether', amount: constant(3) }], (amount) => (amount as { kind: 'constant'; value: number }).value)))
      .toThrow(/requires 3 aether, but only 2 is available/);
  });
});

// ── Command-level rejection ─────────────────────────────────────────────────

function pyreEncounter(): { state: EncounterState; heroId: string; foeId: string } {
  let state = createEncounter('Cost-payment fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = ['enochian:pyre'];
  hero.chapter = 3;
  const foe = createFoe('Relict', { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, heroId: hero.id, foeId: foe.id };
}

describe('cost-payment: command boundary rejects before effects', () => {
  it('insufficient aether rejects the whole infuse action before any effect or RNG', () => {
    const { state, heroId, foeId } = pyreEncounter();
    const before = JSON.stringify(state);
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: heroId,
      sourceId: 'enochian:pyre',
      actionId: 'infuse',
      timing: 'use',
      input: {},
      attackTargetId: foeId,
    }, scriptedDice(12, 4, 5))).toThrowError(RuleViolation);
    try {
      executeCommand(state, {
        type: 'EXECUTE_RULE',
        actorId: heroId,
        sourceId: 'enochian:pyre',
        actionId: 'infuse',
        timing: 'use',
        input: {},
        attackTargetId: foeId,
      }, scriptedDice(12, 4, 5));
      expect.unreachable('insufficient aether must reject');
    } catch (error) {
      expect((error as RuleViolation).code).toBe('resource.insufficient');
      expect((error as RuleViolation).message).toMatch(/requires 3 aether/);
    }
    // No events were produced and the state is untouched — nothing resolved.
    expect(JSON.stringify(state)).toBe(before);
    expect(state.actors[heroId].resources.aether ?? 0).toBe(0);
  });

  it('a sufficient payment spends exactly the cost and resolves, and replays identically', () => {
    const { state, heroId, foeId } = pyreEncounter();
    state.actors[heroId].resources.aether = 3;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: heroId,
      sourceId: 'enochian:pyre',
      actionId: 'infuse',
      timing: 'use',
      input: {},
      attackTargetId: foeId,
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[heroId].resources.aether).toBe(0); // spent exactly 3
    expect(result.state.actors[foeId].hp).toBe(19); // the infuse effects resolved
    // Replay: applying the recorded events reproduces the exact state without
    // re-deciding the payment.
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});

// ── Sacrifice application semantics ─────────────────────────────────────────

function sacrificeEncounter(over: { armor?: number; vigor?: number; defiance?: boolean; hp?: number } = {}): { state: EncounterState; heroId: string } {
  let state = createEncounter('Sacrifice fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  if (over.armor) hero.armor = over.armor;
  if (over.vigor) hero.vigor = over.vigor;
  if (over.hp) hero.hp = over.hp;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  const foe = createFoe('Relict', { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  if (over.defiance) {
    state.actors[hero.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: hero.id, potency: 'normal', duration: null });
  }
  return { state, heroId: hero.id };
}

describe('cost-payment: Sacrifice (Combat Glossary p.103)', () => {
  it('with HP above the cost, HP is reduced by exactly the cost', () => {
    const { state, heroId } = sacrificeEncounter({ hp: 40 });
    applyRuleMutations(state, [sacrificeMutation('fixture:sacrifice', heroId, 6)]);
    expect(state.actors[heroId].hp).toBe(34);
  });

  it('with HP at or below the cost, HP stops at 1 and the payment stays legal', () => {
    const { state, heroId } = sacrificeEncounter({ hp: 3 });
    applyRuleMutations(state, [sacrificeMutation('fixture:sacrifice', heroId, 50)]);
    expect(state.actors[heroId].hp).toBe(1);
    expect(state.actors[heroId].defeated).toBe(false);
  });

  it('ignores armor, vigor, and Defiance — it is not incoming damage', () => {
    const { state, heroId } = sacrificeEncounter({ hp: 40, armor: 5, vigor: 10, defiance: true });
    applyRuleMutations(state, [sacrificeMutation('fixture:sacrifice', heroId, 6)]);
    // Full nominal amount: no armor reduction, no vigor absorption, no
    // Defiance consumption.
    expect(state.actors[heroId].hp).toBe(34);
    expect(state.actors[heroId].vigor).toBe(10);
    expect(state.actors[heroId].conditions.some(({ id }) => id === 'defiance')).toBe(true);
  });

  it('does not open a when-damaged window merely because HP changed', () => {
    const { state, heroId } = sacrificeEncounter({ hp: 40 });
    const initialInterrupts = (state.decisionWindows ?? []).length;
    applyRuleMutations(state, [sacrificeMutation('fixture:sacrifice', heroId, 6)]);
    expect(state.decisionWindows ?? []).toHaveLength(initialInterrupts);
  });

  it('control: ordinary foe damage DOES open a when-damaged window', () => {
    const { state, heroId } = sacrificeEncounter({ hp: 40 });
    const foeId = Object.values(state.actors).find((actor) => actor.side === 'foes')!.id;
    const before = (state.decisionWindows ?? []).length;
    applyRuleMutations(state, [{
      kind: 'damage', sourceId: 'fixture:foe-hit', sourceActorId: foeId, actorId: heroId,
      amount: 4, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
    }]);
    expect(state.decisionWindows ?? []).toHaveLength(before + 1);
    expect(state.decisionWindows![state.decisionWindows!.length - 1].kind).toBe('when-damaged');
  });
});

// Re-export the RuleNumber type import used by the fixture helper above.
import type { RuleNumber } from '../automation/primitives/types.js';
