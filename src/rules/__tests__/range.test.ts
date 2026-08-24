import { describe, expect, it } from 'vitest';
import type { DiceSource } from '../dice.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterCommand, EncounterEvent, EncounterState, Position } from '../types.js';
import '../automation/content/registry.js';
import { distanceBetween, effectiveAbilityRange, isExactlyRange, isWithinRange } from '../automation/kernels/range.js';
import { determineEncounterDamage, rangeStateView } from '../automation/kernels/encounter-adapter.js';
import { traitAttackModifier } from '../automation/kernels/attack-modifiers.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/**
 * F9 range semantics fixtures (docs/rules-foundations.md §Range).
 *
 * The range kernel splits ICON's range family into target legality (the
 * listed range of an ability, possibly overridden/conditioned/dynamic —
 * Valkyrie talent 1, Incubus talent 1, Harvest talent 2, Open the Gates
 * talent 2) and distance-dependent effects (exact-range attack modifiers —
 * Trigrammaton — and distance-gated defense — Aetherwall). Every distance
 * read is the shared p.92 footprint metric; the exact-range rules never
 * widen a targeting range, and the listed-range rules never affect a damage
 * halving. Each behavior has a control, a movement boundary where the rule
 * changes immediately, and a replay pair where events rebuild the identical
 * state.
 */

interface RangeFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function rangeEncounter(options: {
  heroTraits?: string[];
  heroAbilities?: string[];
  heroTalents?: Record<string, 1 | 2>;
  heroAt?: Position;
  foeAt?: Position;
  foeTraits?: string[];
}): RangeFixture {
  let state = createEncounter('Range fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt ?? { x: 1, y: 1 });
  hero.traitIds = [...(options.heroTraits ?? [])];
  hero.abilityIds = [...(options.heroAbilities ?? [])];
  hero.talents = { ...(options.heroTalents ?? {}) };
  const foe = createFoe('Relict', options.foeAt ?? { x: 3, y: 1 });
  if (options.foeTraits) foe.traitIds = [...options.foeTraits];
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

/** End every actor's turn in insertion order, advancing through the round.
 * Each boundary leaves the scheduler awaiting a controller choice, so the
 * fixture explicitly selects the next actor in insertion order (ICON p.87). */
function endAllTurns(state: EncounterState, dice = scriptedDice()): EncounterState {
  let next = state;
  for (const id of Object.keys(state.actors)) {
    if (next.activeActorId !== id) {
      if (next.activeActorId !== null) next = executeCommand(next, { type: 'END_TURN', actorId: next.activeActorId }, dice).state;
      const eligible = turnEligibleActorIds(next);
      if (!eligible.includes(id)) throw new Error('endAllTurns: ' + id + ' is not eligible here.');
      next = executeCommand(next, { type: 'TAKE_TURN', actorId: id }, dice).state;
    }
    next = executeCommand(next, { type: 'END_TURN', actorId: id }, dice).state;
  }
  return next;
}

const attackEventOf = (result: ReturnType<typeof executeCommand>) =>
  result.events.find((event) => event.type === 'ATTACK_RESOLVED') as Extract<EncounterEvent, { type: 'ATTACK_RESOLVED' }> | undefined;

/** The LAST ATTACK_RESOLVED event of a command chain (chains accumulate the
 * events of every command; the round-2/3 attacks are not the first). */
const lastAttackEventOf = (events: EncounterEvent[]) =>
  [...events].reverse().find((event) => event.type === 'ATTACK_RESOLVED') as Extract<EncounterEvent, { type: 'ATTACK_RESOLVED' }> | undefined;

/** A command chain that records every event so the whole flow replays from
 * the initial state to the identical final state. */
class Chain {
  events: EncounterEvent[] = [];
  state: EncounterState;
  constructor(state: EncounterState) { this.state = state; }
  run(command: EncounterCommand, dice?: DiceSource): this {
    const result = executeCommand(this.state, command, dice ?? scriptedDice());
    this.events.push(...result.events);
    this.state = result.state;
    return this;
  }
  replayFrom(initial: EncounterState): void {
    expect(applyEvents(initial, this.events)).toEqual(this.state);
  }
}

describe('F9 range foundation — one canonical distance', () => {
  it('the p.92 footprint metric: size-1 Chebyshev, diagonal, and large-foe footprints', () => {
    const view = {
      round: 1,
      actors: {
        hero: { id: 'hero', position: { x: 1, y: 1 } },
        diag: { id: 'diag', position: { x: 4, y: 3 } },
        near: { id: 'near', position: { x: 3, y: 1 } },
        far: { id: 'far', position: { x: 4, y: 1 } },
        large: { id: 'large', position: { x: 4, y: 1 }, size: 2 },
        anchorBehind: { id: 'anchor', position: { x: 6, y: 1 } },
      },
      conditionsFor: () => new Set<string>(),
    };
    // Straight-line and diagonal Chebyshev agree with the targeting metric.
    expect(distanceBetween(view, 'hero', 'far')).toBe(3);
    expect(distanceBetween(view, 'hero', 'diag')).toBe(3); // max(3, 2)
    expect(isWithinRange(view, 'hero', 'near', 2)).toBe(true);
    expect(isWithinRange(view, 'hero', 'far', 2)).toBe(false);
    expect(isExactlyRange(view, 'hero', 'far', 3)).toBe(true);
    expect(isExactlyRange(view, 'hero', 'near', 3)).toBe(false);
    // A size-2 foe anchored behind a range-1 hero is one space closer than
    // its anchor cell: the metric measures edge-to-edge, never point-to-point.
    expect(distanceBetween(view, 'anchorBehind', 'large')).toBe(1);
    expect(distanceBetween(view, 'anchorBehind', 'far')).toBe(2);
  });
});

describe('F9.1 target legality — Valkyrie talent 1 (listed-range override)', () => {
  const valkyrieUse = (state: EncounterState, hero: EncounterActor, foe: EncounterActor) =>
    executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:valkyrie', targetIds: [foe.id],
    }, scriptedDice(10, 1, 2));

  it('without its talent, Valkyrie stays a range-1 melee attack (regression)', () => {
    const { state, hero, foe } = rangeEncounter({
      heroAbilities: ['colossus:valkyrie'],
      heroTraits: ['colossus:trait:pulverize'],
      foeAt: { x: 3, y: 1 }, // distance 2 — beyond the base melee range
    });
    expect(() => valkyrieUse(state, hero, foe)).toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('with talent 1, the attack target may be chosen at range 4 — and no further', () => {
    for (const foeX of [3, 4, 5]) {
      const { state, hero, foe } = rangeEncounter({
        heroAbilities: ['colossus:valkyrie'],
        heroTraits: ['colossus:trait:pulverize'],
        heroTalents: { 'colossus:valkyrie': 1 },
        foeAt: { x: foeX, y: 1 },
      });
      // Distance 2..4 are newly legal: the command resolves and the attack
      // lands damage (the override widens authoritative target validation,
      // not UI display).
      const result = valkyrieUse(state, hero, foe);
      expect(result.state.actors[foe.id].hp).toBeLessThan(32);
    }
    const { state, hero, foe } = rangeEncounter({
      heroAbilities: ['colossus:valkyrie'],
      heroTraits: ['colossus:trait:pulverize'],
      heroTalents: { 'colossus:valkyrie': 1 },
      foeAt: { x: 6, y: 1 }, // distance 5 — beyond the override
    });
    expect(() => valkyrieUse(state, hero, foe)).toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('the effective range folds against authoritative command-time state and replays', () => {
    const { state, hero, foe } = rangeEncounter({
      heroAbilities: ['colossus:valkyrie'],
      heroTraits: ['colossus:trait:pulverize'],
      heroTalents: { 'colossus:valkyrie': 1 },
      foeAt: { x: 5, y: 1 }, // distance 4 — legal only with the talent
    });
    expect(effectiveAbilityRange(rangeStateView(state), hero.id, 'colossus:valkyrie', 1)).toBe(4);
    const chain = new Chain(state);
    chain.run({ type: 'USE_ABILITY', actorId: hero.id, abilityId: 'colossus:valkyrie', targetIds: [foe.id] }, scriptedDice(10, 1, 2));
    chain.run({ type: 'END_TURN', actorId: hero.id });
    // The scheduler never auto-selects (ICON p.87): the GM selects the foe.
    chain.run({ type: 'TAKE_TURN', actorId: foe.id });
    chain.run({ type: 'END_TURN', actorId: foe.id });
    chain.replayFrom(state);
  });
});

describe('F9.2 conditional and dynamic range (kernel gates)', () => {
  it('Incubus talent 1: range 3, or 5 from stealth — and only when the talent is selected', () => {
    const { state, hero, foe } = rangeEncounter({
      heroAbilities: ['shade:incubus'],
      heroTalents: { 'shade:incubus': 1 },
    });
    const view = () => rangeStateView(state);
    // No talent selected: the ability keeps its base melee range 1.
    const { state: unselected } = rangeEncounter({ heroAbilities: ['shade:incubus'] });
    expect(effectiveAbilityRange(rangeStateView(unselected), hero.id, 'shade:incubus', 1)).toBe(1);
    // Talent selected: 3, then 5 from stealth, then back to 3 when stealth ends.
    expect(effectiveAbilityRange(view(), hero.id, 'shade:incubus', 1)).toBe(3);
    state.actors[hero.id].conditions.push({ id: 'stealth', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    expect(effectiveAbilityRange(view(), hero.id, 'shade:incubus', 1)).toBe(5);
    state.actors[hero.id].conditions = state.actors[hero.id].conditions.filter((condition) => condition.id !== 'stealth');
    expect(effectiveAbilityRange(view(), hero.id, 'shade:incubus', 1)).toBe(3);
  });

  it('Harvest talent 2: range 2, or 5 while bloodied (Comeback) — HP crossing flips it immediately', () => {
    const { state, hero, foe } = rangeEncounter({
      heroAbilities: ['harvester:harvest'],
      heroTalents: { 'harvester:harvest': 2 },
    });
    const view = () => rangeStateView(state);
    // Harvest's base range is the Arc 6 origin; the talent overrides it.
    expect(effectiveAbilityRange(view(), hero.id, 'harvester:harvest', 6)).toBe(2);
    state.actors[hero.id].hp = 15; // 40 max — bloodied (at or under half)
    expect(effectiveAbilityRange(view(), hero.id, 'harvester:harvest', 6)).toBe(5);
    state.actors[hero.id].hp = 30; // healed back above half
    expect(effectiveAbilityRange(view(), hero.id, 'harvester:harvest', 6)).toBe(2);
  });

  it('Open the Gates talent 2: both versions gain a range equal to the round number', () => {
    const { state, hero, foe } = rangeEncounter({
      heroAbilities: ['sealer:open-the-gates'],
      heroTalents: { 'sealer:open-the-gates': 2 },
    });
    const view = () => rangeStateView(state);
    expect(effectiveAbilityRange(view(), hero.id, 'sealer:open-the-gates', 1)).toBe(1); // round 1
    expect(effectiveAbilityRange(view(), hero.id, 'sealer:open-the-gates', 1, 'combo')).toBe(1);
    let next = endAllTurns(state); // round 2
    expect(effectiveAbilityRange(rangeStateView(next), hero.id, 'sealer:open-the-gates', 1)).toBe(2);
    expect(effectiveAbilityRange(rangeStateView(next), hero.id, 'sealer:open-the-gates', 1, 'combo')).toBe(2);
    next = endAllTurns(next); // round 3
    expect(effectiveAbilityRange(rangeStateView(next), hero.id, 'sealer:open-the-gates', 1)).toBe(3);
  });
});

describe('F9.3 Trigrammaton (exact-distance attack modifier)', () => {
  it('the kernel read: +1 boon and unerring at exactly range 3 only (unit)', () => {
    const owner = { traitIds: ['freelancer:trait:trigrammaton'], state: {} };
    const target = (distance: number) => ({ hp: 20, maxHp: 40, distance });
    expect(traitAttackModifier(owner, 0, target(2))).toMatchObject({ boons: 0, unerring: false });
    expect(traitAttackModifier(owner, 0, target(3))).toMatchObject({ boons: 1, unerring: true });
    expect(traitAttackModifier(owner, 0, target(4))).toMatchObject({ boons: 0, unerring: false });
  });

  it('attacks at exactly range 3 gain +1 boon; at range 2 they do not', () => {
    const { state, hero, foe } = rangeEncounter({
      heroTraits: ['freelancer:trait:trigrammaton'],
      foeAt: { x: 4, y: 1 }, // distance 3
    });
    const hit = executeCommand(state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(8, 1, 2)); // d20 8, boon die 1, damage 2
    expect(attackEventOf(hit)?.boonDie).toBe(1);
    // Range 2: the same d20 without the boon die still hits, but no boon.
    const { state: close, hero: h2, foe: f2 } = rangeEncounter({
      heroTraits: ['freelancer:trait:trigrammaton'],
      foeAt: { x: 3, y: 1 }, // distance 2
    });
    const near = executeCommand(close, {
      type: 'BASIC_ATTACK', actorId: h2.id, targetId: f2.id, weight: 'light',
    }, scriptedDice(8, 2)); // d20 8 (no boon die to consume), damage 2
    expect(attackEventOf(near)?.boonDie).toBe(0);
  });

  it('diagonal distance uses the canonical Chebyshev metric (exactly range 3 diagonally)', () => {
    const { state, hero, foe } = rangeEncounter({
      heroTraits: ['freelancer:trait:trigrammaton'],
      foeAt: { x: 4, y: 3 }, // max(|3|, |2|) = 3
    });
    const result = executeCommand(state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(8, 1, 2));
    expect(attackEventOf(result)?.boonDie).toBe(1);
  });

  it('the exact-distance rule never widens targeting range', () => {
    // A target at range 4 is beyond the hero's range-3 basic attack: the
    // trait's exactly-range-3 effect must not make it legal.
    const { state, hero, foe } = rangeEncounter({
      heroTraits: ['freelancer:trait:trigrammaton'],
      foeAt: { x: 5, y: 1 }, // distance 4
    });
    expect(() => executeCommand(state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(8))).toThrowError(expect.objectContaining({ code: 'attack.range' }));
    // Same through the ability path: Valkyrie (base range 1) with the trait
    // still cannot reach distance 3 — the trait changes attack results, not
    // the ability's listed range.
    const { state: ab, hero: h2, foe: f2 } = rangeEncounter({
      heroAbilities: ['colossus:valkyrie'],
      heroTraits: ['colossus:trait:pulverize', 'freelancer:trait:trigrammaton'],
      foeAt: { x: 4, y: 1 }, // distance 3
    });
    expect(() => executeCommand(ab, {
      type: 'USE_ABILITY', actorId: h2.id, abilityId: 'colossus:valkyrie', targetIds: [f2.id],
    }, scriptedDice(8, 1, 2))).toThrowError(expect.objectContaining({ code: 'ability.range' }));
  });

  it('unerring suppresses Aetherwall at exactly range 3 (the attack-path projection)', () => {
    // Foe defender with the Aetherwall trait at (1,1); the trigrammaton hero
    // attacks from exactly range 3 — unerring (p.105) ignores the aetherwall
    // halving, so full damage lands.
    const { state, hero, foe } = rangeEncounter({
      heroTraits: ['freelancer:trait:trigrammaton'],
      heroAt: { x: 4, y: 1 },
      foeAt: { x: 1, y: 1 },
      foeTraits: ['wright:trait:aetherwall'],
    });
    const result = executeCommand(state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice(10, 1, 5)); // d20 10 (+boon 1), damage d6 5 + fray 4 = 9
    expect(attackEventOf(result)?.appliedDamage).toBe(9); // no aetherwall halving
    // Control: the same attack without Trigrammaton is halved by Aetherwall.
    const { state: control, hero: h2, foe: f2 } = rangeEncounter({
      heroAt: { x: 4, y: 1 },
      foeAt: { x: 1, y: 1 },
      foeTraits: ['wright:trait:aetherwall'],
    });
    const halved = executeCommand(control, {
      type: 'BASIC_ATTACK', actorId: h2.id, targetId: f2.id, weight: 'light',
    }, scriptedDice(10, 5)); // d20 10, damage d6 5 + fray 4 = 9 → ceil(9/2) = 5
    expect(attackEventOf(halved)?.appliedDamage).toBe(5);
    expect(halved.state.actors[f2.id].hp).toBe(32 - 5);
  });
});

describe('F9.4 Aetherwall (distance-gated defense)', () => {
  it('resistance outside range 2 only, changing immediately with movement, replayable', () => {
    // The Aetherwall defender is the foe at (1,1); the hero attacks from
    // distance 3, moves to distance 2 (no resistance), then back to 3.
    const { state, hero, foe } = rangeEncounter({
      heroAt: { x: 4, y: 1 },
      foeAt: { x: 1, y: 1 },
      foeTraits: ['wright:trait:aetherwall'],
    });
    const chain = new Chain(state);
    // Round 1 — distance 3: outside range 2 → halved. Raw 9 (d6 5 + fray 4).
    chain.run({ type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(10, 5));
    expect(lastAttackEventOf(chain.events)?.appliedDamage).toBe(5);
    // The defender's projection is a pure state read: stepping to distance 2
    // removes the halving immediately (verified on the round-2 attack).
    chain.run({ type: 'MOVE', actorId: hero.id, path: [{ x: 3, y: 1 }], mode: 'standard' });
    chain.run({ type: 'END_TURN', actorId: hero.id });
    chain.run({ type: 'TAKE_TURN', actorId: foe.id });
    chain.run({ type: 'END_TURN', actorId: foe.id });
    // Round 2 opens with the player side; the player selects the hero again.
    chain.run({ type: 'TAKE_TURN', actorId: hero.id });
    chain.run({ type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(10, 5));
    expect(lastAttackEventOf(chain.events)?.appliedDamage).toBe(9);
    // Back outside range 2: the halving returns.
    chain.run({ type: 'MOVE', actorId: hero.id, path: [{ x: 4, y: 1 }], mode: 'standard' });
    chain.run({ type: 'END_TURN', actorId: hero.id });
    chain.run({ type: 'TAKE_TURN', actorId: foe.id });
    chain.run({ type: 'END_TURN', actorId: foe.id });
    chain.run({ type: 'TAKE_TURN', actorId: hero.id });
    chain.run({ type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(10, 5));
    expect(lastAttackEventOf(chain.events)?.appliedDamage).toBe(5);
    chain.replayFrom(state);
  });

  it('the damage authority reads the canonical footprint distance for the boundary', () => {
    const { state, hero, foe } = rangeEncounter({
      heroAt: { x: 4, y: 1 },
      foeAt: { x: 1, y: 1 },
      foeTraits: ['wright:trait:aetherwall'],
    });
    const at = (fromX: number) => {
      state.actors[hero.id].position = { x: fromX, y: 1 };
      return determineEncounterDamage(state, {
        targetId: foe.id, sourceActorId: hero.id, sourceRuleId: 'core:light-attack',
        amount: 9, damageType: 'normal', delivery: 'hit', instance: 1, ignoreCover: false,
      });
    };
    expect(at(4).halvings).toContain('aetherwall');
    expect(at(4).amount).toBe(5);
    expect(at(3).halvings).not.toContain('aetherwall'); // exactly range 2 — inside
    expect(at(3).amount).toBe(9);
    expect(at(2).halvings).not.toContain('aetherwall'); // adjacent
    expect(at(2).amount).toBe(9);
  });
});
