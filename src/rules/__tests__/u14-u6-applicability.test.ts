/**
 * u14-u6-applicability.test.ts — U14 → U6 (T-modifiers): the ADVERSARIAL
 * characterization of the ONE modifier applicability authority.
 *
 * A modifier rule's applicability is a U6 `RulePredicate` decided by
 * `evaluatePredicate` (`kernels/evaluate-modifiers.ts`
 * `modifierApplicabilityHolds` over the lowered gate vocabulary). This suite
 * proves the semantic boundaries rather than multiplying content examples:
 *
 *   - every selector-based read is NON-VACUOUS (an absent/unresolvable
 *     reference is false, never `every([]) === true`);
 *   - bloodied/quarter measure the BASE maximum (p.81), so wounds never move
 *     the threshold;
 *   - the self read and the attack-target read are distinct, and an unrelated
 *     actor (an ally, a bystander) can never satisfy either;
 *   - target status reads are positive AND negative, with and without a named
 *     status;
 *   - the round threshold is an exact boundary, evaluated against current
 *     state;
 *   - a slow turn is the DURABLE p.95 state, never an ambient Charge trigger;
 *   - mastery requires equipped AND mastered (composed with the shared
 *     `hasMastery` authority);
 *   - a declared choice applies only when the DURABLE command input records
 *     it — an actor-level flag/condition of the same name never substitutes;
 *   - missing/unrepresentable context FAILS CLOSED (throws), never silently
 *     applies or silently skips;
 *   - replay evaluates the recorded predicate against the recorded state, so
 *     the answer is identical on a second (replayed) evaluation.
 *
 * The final block proves the migration at real production consumers: the
 * range, mastery, and bonus-damage kernels now answer these questions through
 * the U6 authority, and their answers agree with the direct predicate read.
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe } from '../encounter.js';
import { evaluatePredicate } from '../automation/kernels/evaluate-predicate.js';
import {
  modifierApplicabilityHolds,
  modifierGatePredicate,
} from '../automation/kernels/evaluate-modifiers.js';
import { effectiveAbilityRange, registerRangeModifierRule } from '../automation/kernels/range.js';
import { rangeStateView } from '../automation/kernels/encounter-adapter.js';
import { effectiveInterruptRank, registerMasteryModifierRule } from '../automation/kernels/mastery-fold.js';
import { masteryFoldStateView } from '../automation/kernels/encounter-adapter.js';
import { bonusDamageDiceForUse, registerBonusDamageRule } from '../automation/kernels/bonus-damage.js';
import { hasMastery } from '../automation/kernels/mastery.js';
import type { ModifierFoldView } from '../automation/primitives/modifiers.js';
import type { RuleActorView, RuleExecutionContext, RulePredicate } from '../automation/primitives/types.js';
import { predicateContext, ruleActorView, validCharacter } from './fixtures.js';

/** A fold view carrying a REAL U6 applicability pair over `context`. */
function foldViewOf(context: RuleExecutionContext, overrides: Partial<ModifierFoldView> = {}): ModifierFoldView {
  return {
    round: context.state.round,
    actor: { id: context.actorId },
    conditionsFor: () => new Set<string>(),
    applies: modifierApplicabilityHolds,
    applicabilityContext: () => context,
    ...overrides,
  };
}

const hero = (overrides: Partial<RuleActorView> = {}): RuleActorView => ruleActorView({ id: 'hero', ...overrides });
const foe = (overrides: Partial<RuleActorView> = {}): RuleActorView => ruleActorView({ id: 'foe', side: 'foes', ...overrides });

describe('U6 predicate authority — non-vacuous selector reads', () => {
  it('an unresolvable reference is FALSE, never vacuously true', () => {
    // No attack target exists at all: every target-scoped read must fail
    // closed. `selectActors(...).every(...)` alone would return true here,
    // silently granting a "your foe is bloodied/statused" clause.
    const context = predicateContext([hero()], { actorId: 'hero' });
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'attack-target' } }, context)).toBe(false);
    expect(evaluatePredicate({ kind: 'has-condition', target: { kind: 'attack-target' } }, context)).toBe(false);
    expect(evaluatePredicate({ kind: 'defeated', target: { kind: 'attack-target' } }, context)).toBe(false);
    expect(evaluatePredicate({ kind: 'slow-turn', target: { kind: 'attack-target' } }, context)).toBe(false);
    // The same through the modifier boundary (the composition the target gates
    // lower to): the relation half is non-vacuous too.
    const view = foldViewOf(context);
    expect(modifierApplicabilityHolds(modifierGatePredicate({ kind: 'target-bloodied' }), view)).toBe(false);
    expect(modifierApplicabilityHolds(modifierGatePredicate({ kind: 'target-has-condition' }), view)).toBe(false);
  });

  it('a selected reference still reads positively (the fix is not a false-negative)', () => {
    const context = predicateContext([hero(), foe({ hp: 1, baseMaxHp: 20 })], { actorId: 'hero', attackTargetId: 'foe' });
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'attack-target' } }, context)).toBe(true);
  });
});

describe('U6 predicate authority — BASE maximum thresholds (p.81)', () => {
  it('bloodied is measured against the BASE bar, so wounds never move the threshold', () => {
    // The wounds-adjusted live maximum is 15 (a heavily wounded actor), but the
    // BASE maximum is 40: the exact half mark stays 20.
    const wounded = hero({ hp: 20, maxHp: 15, baseMaxHp: 40 });
    const context = predicateContext([wounded], { actorId: 'hero' });
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'self' } }, context)).toBe(true);
    // One point above the BASE half mark is not bloodied.
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'self' } }, predicateContext([{ ...wounded, hp: 21 }], { actorId: 'hero' }))).toBe(false);
    // The quarter mark is the same bar.
    expect(evaluatePredicate({ kind: 'quarter', target: { kind: 'self' } }, predicateContext([{ ...wounded, hp: 10 }], { actorId: 'hero' }))).toBe(true);
    expect(evaluatePredicate({ kind: 'quarter', target: { kind: 'self' } }, predicateContext([{ ...wounded, hp: 11 }], { actorId: 'hero' }))).toBe(false);
  });

  it('the modifier comeback gate agrees with the base-max boundary', () => {
    const gate = modifierGatePredicate({ kind: 'comeback' });
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext([hero({ hp: 20, maxHp: 15, baseMaxHp: 40 })], { actorId: 'hero' })))).toBe(true);
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext([hero({ hp: 21, maxHp: 15, baseMaxHp: 40 })], { actorId: 'hero' })))).toBe(false);
  });

  it('the self read and the attack-target read are DISTINCT', () => {
    const bloodiedHero = hero({ hp: 5, baseMaxHp: 40 });
    const healthyFoe = foe({ hp: 40, baseMaxHp: 40 });
    const context = predicateContext([bloodiedHero, healthyFoe], { actorId: 'hero', attackTargetId: 'foe' });
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'self' } }, context)).toBe(true);
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'attack-target' } }, context)).toBe(false);

    const reversed = predicateContext([hero({ hp: 40, baseMaxHp: 40 }), foe({ hp: 5, baseMaxHp: 40 })], { actorId: 'hero', attackTargetId: 'foe' });
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'self' } }, reversed)).toBe(false);
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'attack-target' } }, reversed)).toBe(true);
  });
});

describe('U6 predicate authority — target status and relation', () => {
  it('reads any status, a named status, and their negatives, on a hostile target only', () => {
    const statused = foe({ conditions: new Set(['burning']) });
    const context = predicateContext([hero(), statused], { actorId: 'hero', attackTargetId: 'foe' });
    expect(evaluatePredicate({ kind: 'has-condition', target: { kind: 'attack-target' } }, context)).toBe(true);
    expect(evaluatePredicate({ kind: 'has-condition', target: { kind: 'attack-target' }, conditionId: 'burning' }, context)).toBe(true);
    expect(evaluatePredicate({ kind: 'has-condition', target: { kind: 'attack-target' }, conditionId: 'weakened' }, context)).toBe(false);

    const clean = predicateContext([hero(), foe()], { actorId: 'hero', attackTargetId: 'foe' });
    expect(evaluatePredicate({ kind: 'has-condition', target: { kind: 'attack-target' } }, clean)).toBe(false);
    expect(evaluatePredicate({ kind: 'has-condition', target: { kind: 'attack-target' }, conditionId: 'burning' }, clean)).toBe(false);

    // An ALLIED attack target never satisfies a hostile target gate, however
    // bloodied/statused it is (the relation half of the lowered composition).
    const allied = predicateContext([hero(), foe({ side: 'heroes', hp: 1, baseMaxHp: 20, conditions: new Set(['burning']) })], { actorId: 'hero', attackTargetId: 'foe' });
    expect(evaluatePredicate({ kind: 'relation', target: { kind: 'attack-target' }, relation: 'foe' }, allied)).toBe(false);
    const view = foldViewOf(allied);
    expect(modifierApplicabilityHolds(modifierGatePredicate({ kind: 'target-bloodied' }), view)).toBe(false);
    expect(modifierApplicabilityHolds(modifierGatePredicate({ kind: 'target-has-condition' }), view)).toBe(false);
  });
});

describe('U6 predicate authority — round, slow turn, mastery, declared choice', () => {
  it('the round threshold is an exact boundary read from current state', () => {
    const predicate = modifierGatePredicate({ kind: 'round-at-least', value: 4 });
    expect(modifierApplicabilityHolds(predicate, foldViewOf(predicateContext([hero()], { actorId: 'hero', round: 3 })))).toBe(false);
    expect(modifierApplicabilityHolds(predicate, foldViewOf(predicateContext([hero()], { actorId: 'hero', round: 4 })))).toBe(true);
    expect(modifierApplicabilityHolds(predicate, foldViewOf(predicateContext([hero()], { actorId: 'hero', round: 9 })))).toBe(true);
  });

  it('slow turn is the durable state, never an ambient Charge trigger', () => {
    const gate = modifierGatePredicate({ kind: 'charge' });
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext([hero({ state: { 'slow-turn': true } })], { actorId: 'hero' })))).toBe(true);
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext([hero({ state: { 'slow-turn': false } })], { actorId: 'hero' })))).toBe(false);
    // The `charge` TRIGGER being active is explicitly not the same thing
    // (Charge and Heroic are distinct ICON triggered effects).
    const triggered: RuleExecutionContext = { ...predicateContext([hero()], { actorId: 'hero' }), triggers: new Set(['charge']) };
    expect(modifierApplicabilityHolds(gate, foldViewOf(triggered))).toBe(false);
  });

  it('mastery requires the parent ability equipped AND mastered (shared authority)', () => {
    const ability = 'test:u6:mastery';
    const gate = modifierGatePredicate({ kind: 'mastery', abilityId: ability });
    const holds = (actor: RuleActorView) => modifierApplicabilityHolds(gate, foldViewOf(predicateContext([actor], { actorId: 'hero' })));
    expect(holds(hero())).toBe(false);
    expect(holds(hero({ masteredAbilityIds: [ability] }))).toBe(false);
    expect(holds(hero({ abilityIds: [ability] }))).toBe(false);
    expect(holds(hero({ abilityIds: [ability], masteredAbilityIds: [ability] }))).toBe(true);
    // The predicate IS the shared `hasMastery` authority — never a second read.
    expect(evaluatePredicate(
      { kind: 'has-mastery', target: { kind: 'self' }, abilityId: ability },
      predicateContext([hero({ abilityIds: [ability], masteredAbilityIds: [ability] })], { actorId: 'hero' }),
    )).toBe(hasMastery(hero({ abilityIds: [ability], masteredAbilityIds: [ability] }), ability));
  });

  it('a declared choice applies only when the DURABLE command input records it', () => {
    const gate = modifierGatePredicate({ kind: 'choice', sourceId: 'test:u6:choice' });
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext([hero()], { actorId: 'hero' })))).toBe(false);
    // An actor-level flag/condition of the same name is NOT a declaration.
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext(
      [hero({ state: { 'test:u6:choice': true }, conditions: new Set(['test:u6:choice']) })], { actorId: 'hero' },
    )))).toBe(false);
    // A declaration for a DIFFERENT source unit is not this one.
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext([hero()], { actorId: 'hero', talentChoices: ['test:u6:other'] })))).toBe(false);
    expect(modifierApplicabilityHolds(gate, foldViewOf(predicateContext([hero()], { actorId: 'hero', talentChoices: ['test:u6:choice'] })))).toBe(true);
    // Replay reads the RECORDED input: the same durable input decides again.
    const recorded = predicateContext([hero()], { actorId: 'hero', talentChoices: ['test:u6:choice'] });
    expect(evaluatePredicate({ kind: 'declared-choice', sourceId: 'test:u6:choice' }, recorded)).toBe(true);
    // Replay rebuilds the context from the SAME recorded input: identical.
    const replayed = predicateContext([hero()], { actorId: 'hero', talentChoices: ['test:u6:choice'] });
    expect(evaluatePredicate({ kind: 'declared-choice', sourceId: 'test:u6:choice' }, replayed)).toBe(true);
  });

  it('an unrelated actor can never satisfy a self-scoped gate', () => {
    const ability = 'test:u6:unrelated';
    const masteredAlly = ruleActorView({ id: 'ally', abilityIds: [ability], masteredAbilityIds: [ability], hp: 1, baseMaxHp: 20 });
    const context = predicateContext([hero(), masteredAlly], { actorId: 'hero' });
    expect(evaluatePredicate({ kind: 'has-mastery', target: { kind: 'self' }, abilityId: ability }, context)).toBe(false);
    expect(evaluatePredicate({ kind: 'bloodied', target: { kind: 'self' } }, context)).toBe(false);
    expect(modifierApplicabilityHolds(modifierGatePredicate({ kind: 'mastery', abilityId: ability }), foldViewOf(context))).toBe(false);
    expect(modifierApplicabilityHolds(modifierGatePredicate({ kind: 'comeback' }), foldViewOf(context))).toBe(false);
  });
});

describe('U6 predicate authority — composition, fail-closed, replay', () => {
  it('multiple predicates compose deterministically (AND, stable across evaluation)', () => {
    const bloodiedAndSlow = modifierGatePredicate({ kind: 'comeback' });
    const combined: RulePredicate = { kind: 'all', predicates: [bloodiedAndSlow, modifierGatePredicate({ kind: 'charge' })] };
    const both = predicateContext([hero({ hp: 10, baseMaxHp: 40, state: { 'slow-turn': true } })], { actorId: 'hero' });
    const onlyBloodied = predicateContext([hero({ hp: 10, baseMaxHp: 40 })], { actorId: 'hero' });
    const onlySlow = predicateContext([hero({ hp: 40, baseMaxHp: 40, state: { 'slow-turn': true } })], { actorId: 'hero' });
    expect(modifierApplicabilityHolds(combined, foldViewOf(both))).toBe(true);
    expect(modifierApplicabilityHolds(combined, foldViewOf(onlyBloodied))).toBe(false);
    expect(modifierApplicabilityHolds(combined, foldViewOf(onlySlow))).toBe(false);
    // A rule with no applicability predicate is unconditional and needs no
    // context at all.
    expect(modifierApplicabilityHolds(undefined, { round: 1, actor: { id: 'hero' }, conditionsFor: () => new Set() })).toBe(true);
  });

  it('fails closed for a missing context and for a predicate outside the lowered vocabulary', () => {
    // No U6 authority on the view at all: an UNGATED rule is unconditional (no
    // decision to make), an applicability predicate cannot be decided.
    const ungated: ModifierFoldView = { round: 1, actor: { id: 'hero' }, conditionsFor: () => new Set() };
    expect(modifierApplicabilityHolds(undefined, ungated)).toBe(true);
    expect(() => modifierApplicabilityHolds({ kind: 'always' }, ungated)).toThrow(/no U6 predicate context/);
    // With the authority and the durable context, `always` is decided true by
    // the ONE predicate evaluator.
    expect(modifierApplicabilityHolds({ kind: 'always' }, foldViewOf(predicateContext([hero()], { actorId: 'hero' })))).toBe(true);

    // An applicability predicate with no durability projection: the boundary
    // must reject rather than guess a truth value.
    const noContext: ModifierFoldView = { ...foldViewOf(predicateContext([hero()], { actorId: 'hero' })), applicabilityContext: undefined };
    expect(() => modifierApplicabilityHolds(modifierGatePredicate({ kind: 'comeback' }), noContext))
      .toThrow(/no U6 predicate context/);

    // A predicate the context cannot represent exactly (a terrain read) never
    // silently evaluates to false — it rejects as unrepresentable.
    expect(() => modifierApplicabilityHolds(
      { kind: 'in-terrain', target: { kind: 'self' }, terrain: 'pit' },
      foldViewOf(predicateContext([hero()], { actorId: 'hero' })),
    )).toThrow(/not part of the lowered modifier-gate vocabulary/);
  });

  it('replay derives the identical result from the identical durable state', () => {
    const gate = modifierGatePredicate({ kind: 'target-has-condition' });
    const context = predicateContext([hero(), foe({ conditions: new Set(['burning']) })], { actorId: 'hero', attackTargetId: 'foe' });
    const first = modifierApplicabilityHolds(gate, foldViewOf(context));
    // The replay path consumes the recorded state, so a second evaluation over
    // a deep copy is identical — no ambient input can change the answer.
    const replayedContext = predicateContext([hero(), foe({ conditions: new Set(['burning']) })], { actorId: 'hero', attackTargetId: 'foe' });
    const replay = modifierApplicabilityHolds(gate, foldViewOf(replayedContext));
    expect(first).toBe(true);
    expect(replay).toBe(first);
  });
});

describe('U6 predicate authority — real production consumers', () => {
  it('the range kernel decides a slow-turn-gated override through U6', () => {
    const ability = 'test:u6:range-charge';
    registerRangeModifierRule({ sourceId: 'test:u6:range-row', abilityId: ability, mode: 'override', value: 5, gate: { kind: 'charge' } });
    const state = createEncounter('u14-u6 range');
    const actor = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    actor.abilityIds = [ability];
    state.actors = { [actor.id]: actor };
    expect(effectiveAbilityRange(rangeStateView(state), actor.id, ability, 3)).toBe(3);
    // The durable slow turn is what the gate reads (never a raw trigger).
    state.actors[actor.id].ruleState['slow-turn'] = true;
    expect(effectiveAbilityRange(rangeStateView(state), actor.id, ability, 3)).toBe(5);
    // Ending the slow turn shrinks the range back immediately — no cache.
    state.actors[actor.id].ruleState['slow-turn'] = false;
    expect(effectiveAbilityRange(rangeStateView(state), actor.id, ability, 3)).toBe(3);
  });

  it('the mastery kernel requires equipped AND mastered through U6', () => {
    const ability = 'test:u6:mastery-interrupt';
    registerMasteryModifierRule({ sourceId: 'test:u6:mastery-row', abilityId: ability, modifier: { kind: 'interrupt-rank', rank: 3 } });
    const state = createEncounter('u14-u6 mastery');
    const actor = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    actor.abilityIds = [ability];
    actor.masteredAbilityIds = [];
    state.actors = { [actor.id]: actor };
    expect(effectiveInterruptRank(masteryFoldStateView(state), actor.id, ability, 1)).toBe(1);
    state.actors[actor.id].masteredAbilityIds = [ability];
    expect(effectiveInterruptRank(masteryFoldStateView(state), actor.id, ability, 1)).toBe(3);
    // Mastered but NOT equipped: the baked-in mastery gate keeps it inert.
    state.actors[actor.id].abilityIds = [];
    expect(effectiveInterruptRank(masteryFoldStateView(state), actor.id, ability, 1)).toBe(1);
  });

  it('the bonus-damage kernel decides a target-status gate through U6', () => {
    const ability = 'test:u6:bonus-status';
    registerBonusDamageRule({ sourceId: 'test:u6:bonus-row', abilityId: ability, gate: { kind: 'target-has-condition', conditionId: 'burning' }, dice: 1 });
    const state = createEncounter('u14-u6 bonus');
    const actor = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const target = createFoe('Target', { x: 3, y: 1 });
    state.actors = { [actor.id]: actor, [target.id]: target };
    expect(bonusDamageDiceForUse(state, actor, ability, [target.id])).toBe(0);
    state.actors[target.id].conditions.push({ id: 'burning', potency: 'normal', sourceId: 'test:status', ownerId: null, duration: null });
    expect(bonusDamageDiceForUse(state, actor, ability, [target.id])).toBe(1);
    // An ALLIED target is never a valid attack target for the gate.
    state.actors[target.id].side = actor.side;
    expect(bonusDamageDiceForUse(state, actor, ability, [target.id])).toBe(0);
  });
});
