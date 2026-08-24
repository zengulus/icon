import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { FOE_ROLE_BASELINE_RECIPES } from '../automation/content/foes/role-baseline-recipes.js';
import { projectedRoleConditions } from '../automation/kernels/passive-projection.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoeFromProfile, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * F5 role-baseline fixtures (docs/rules-foundations.md §6, ICON p.298).
 *
 * A foe role projects conditions only through the closed
 * `FOE_ROLE_BASELINE_RECIPES` table — Skirmisher Dodge, Heavy Rampart/Guard
 * armor, Artillery Slip/Aetherwall — never from `traitsText` prose. Each
 * behavioral case asserts the projected condition actually changes combat,
 * and the closed-registry negatives pin that roles without a recipe (mob,
 * leader) and conditions without a source (Defiance, Counter, Sturdy,
 * Stealth, Unstoppable) stay unprojected.
 */

interface RoleFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

/** A VM damage mutation with a fixed source amount and delivery. */
const vmDamageEvent = (sourceActorId: string, actorId: string, amount: number, delivery: EncounterEvent extends never ? never : 'hit' | 'miss' | 'area' = 'hit'): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:vm-blow',
  actionId: 'default',
  timing: 'use',
  tags: ['attack'],
  mutations: [{ kind: 'damage', sourceId: 'fixture:vm-blow', sourceActorId, actorId, amount, damageType: 'normal', instance: 1, delivery, ignoreCover: false }],
});

function profileFixture(profileId: string, options: { heroAt?: { x: number; y: number }; foeAt?: { x: number; y: number }; playerCount?: number } = {}): RoleFixture {
  let state = createEncounter('Role-baseline fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt ?? { x: 1, y: 1 });
  hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
  hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
  const foe = createFoeFromProfile(profileId, options.foeAt ?? { x: 3, y: 1 }, options.playerCount ?? 4);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

describe('F5 role baselines — Skirmisher Dodge (p.298)', () => {
  it('projects dodge: a missed attack and an area effect deal no damage to a skirmisher', () => {
    const { state, hero, foe } = profileFixture('basic:pepperbox:302');
    expect([...projectedRoleConditions(foe.roleId)]).toEqual(['dodge']);
    const missed = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6, 'miss')]);
    expect(missed.actors[foe.id].hp).toBe(foe.hp); // dodged
    const area = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6, 'area')]);
    expect(area.actors[foe.id].hp).toBe(foe.hp); // dodged
  });

  it('does not dodge a direct hit (delivery hit) — Dodge prevents missed/area damage only', () => {
    const { state, hero, foe } = profileFixture('basic:pepperbox:302');
    const hit = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6)]);
    expect(hit.actors[foe.id].hp).toBeLessThan(foe.hp);
  });

  it('a role without the recipe stays unprojected (negative control)', () => {
    const { state, hero, foe } = profileFixture('basic:errant:303'); // leader role
    expect([...projectedRoleConditions(foe.roleId)]).toEqual([]);
    const missed = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6, 'miss')]);
    expect(missed.actors[foe.id].hp).toBeLessThan(foe.hp); // no dodge
  });
});

describe('F5 role baselines — Artillery Slip + Aetherwall (p.298)', () => {
  it('projects slip + aetherwall and halved ranged damage from beyond range 2', () => {
    const { state, hero, foe } = profileFixture('basic:blaster:305', { heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 } });
    expect([...projectedRoleConditions(foe.roleId)].sort()).toEqual(['aetherwall', 'slip']);
    // 6 normal from range 4 (Chebyshev 4 > 2): aetherwall halves to 3.
    const ranged = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6)]);
    expect(ranged.actors[foe.id].hp).toBe(foe.hp - 3);
  });

  it('the same blow from within range 2 is not halved', () => {
    const { state, hero, foe } = profileFixture('basic:blaster:305', { heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 } });
    const close = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6)]);
    expect(close.actors[foe.id].hp).toBe(foe.hp - 6);
  });

  it('slip ignores rampart: an artillery may dash into a space adjacent to a Fortify hero', () => {
    const { state, hero, foe } = profileFixture('basic:blaster:305', { heroAt: { x: 3, y: 1 }, foeAt: { x: 1, y: 1 } });
    // Arm the Fortify trait so the hero projects rampart adjacent to itself.
    state.actors[hero.id].traitIds = [...state.actors[hero.id].traitIds, 'stalwart:trait:fortify'];
    const foeTurn = endTurnTo(state, foe.id, scriptedDice());
    // Dash into the cell adjacent to the fortify hero — allowed for slip.
    const dashed = executeCommand(foeTurn, { type: 'MOVE', actorId: foe.id, path: [{ x: 2, y: 1 }], mode: 'dash' }, scriptedDice());
    expect(dashed.state.actors[foe.id].position).toEqual({ x: 2, y: 1 });
  });
});

describe('F5 role baselines — Heavy Guard Rampart + armor (p.298)', () => {
  it('projects rampart: a hero cannot dash into a space adjacent to the heavy', () => {
    const { state, hero, foe } = profileFixture('basic:warrior:300', { heroAt: { x: 5, y: 1 }, foeAt: { x: 2, y: 1 } });
    expect([...projectedRoleConditions(foe.roleId)]).toEqual(['rampart']);
    // Hand the turn back to the hero (hero → heavy → hero) so the hero dashes.
    const heavyTurn = endTurnTo(state, foe.id, scriptedDice());
    const heroTurn = executeCommand(heavyTurn, { type: 'END_TURN', actorId: heavyTurn.activeActorId! }, scriptedDice()).state;
    // The cell (3,1) is adjacent to the heavy (2,1): dash into it is denied.
    expect(() => executeCommand(heroTurn, { type: 'MOVE', actorId: hero.id, path: [{ x: 4, y: 1 }, { x: 3, y: 1 }], mode: 'dash' }, scriptedDice())).toThrow();
  });

  it('guard armor stacks with the heavy’s own armor: 6 normal lands as 2', () => {
    const { state, hero, foe } = profileFixture('basic:warrior:300', { heroAt: { x: 4, y: 1 }, foeAt: { x: 2, y: 1 } });
    const before = state.actors[foe.id].hp;
    const damaged = applyEvents(state, [vmDamageEvent(hero.id, foe.id, 6)]);
    // The heavy carries the role baseline armor 2 plus the Guard armor 2:
    // 6 - 2 - 2 = exactly 2 applied HP damage.
    expect(damaged.actors[foe.id].hp).toBe(before - 2);
  });

  it('guard armor protects an orthogonally adjacent foe ally, not a diagonal one', () => {
    let state = createEncounter('Guard armor fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
    hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
    const heavy = createFoeFromProfile('basic:warrior:300', { x: 3, y: 2 });
    // Non-heavy allies (artillery carry no base armor), so the only mitigation
    // is the guard bonus from the adjacent heavy.
    const orthogonal = createFoeFromProfile('basic:blaster:305', { x: 2, y: 2 }); // shares an edge with the heavy
    const diagonal = createFoeFromProfile('basic:blaster:305', { x: 2, y: 3 }); // diagonal to the heavy, still within the hero's range 2 (no aetherwall)
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: orthogonal }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: diagonal }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: heavy }).state;
    state = startEncounterTo(state, hero.id);
    const after = applyEvents(state, [
      vmDamageEvent(hero.id, orthogonal.id, 6),
      vmDamageEvent(hero.id, diagonal.id, 6),
    ]);
    // Orthogonal ally: 6 - 2 guard armor = 4. Diagonal ally: full 6.
    expect(after.actors[orthogonal.id].hp).toBe(state.actors[orthogonal.id].hp - 4);
    expect(after.actors[diagonal.id].hp).toBe(state.actors[diagonal.id].hp - 6);
  });
});

describe('F5 role baselines — Legend Juggernaut (p.298)', () => {
  it('clears the legend’s statuses and marks when a new round starts', () => {
    const { state, hero, foe } = profileFixture('basic:demolisher:310', { heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, playerCount: 1 });
    state.actors[foe.id].statuses = ['weakened', 'dazed'];
    state.actors[foe.id].conditions = [{ id: 'weakened', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null }];
    state.actors[foe.id].marks = [{ id: 'mark', sourceId: 'fixture', ownerId: hero.id, markId: 'fixture-mark', duration: null, state: {} }];
    // A full round of END_TURNs: hero → legend → back to hero advances the round.
    const roundOne = endTurnTo(state, foe.id, scriptedDice());
    const roundTwo = executeCommand(roundOne, { type: 'END_TURN', actorId: roundOne.activeActorId! }, scriptedDice());
    expect(roundTwo.state.round).toBe(2);
    const legend = roundTwo.state.actors[foe.id];
    expect(legend.statuses).toEqual([]);
    expect(legend.conditions).toEqual([]);
    expect(legend.marks).toEqual([]);
    expect(applyEvents(roundOne, roundTwo.events)).toEqual(roundTwo.state);
  });
});

describe('F5 closed registry — role baselines never inferred from prose', () => {
  it('is exactly the six roles, with only skirmisher/heavy/artillery projecting', () => {
    expect(Object.keys(FOE_ROLE_BASELINE_RECIPES).sort()).toEqual(['artillery', 'heavy', 'leader', 'legend', 'mob', 'skirmisher', 'special']);
    expect(FOE_ROLE_BASELINE_RECIPES.skirmisher).toEqual(['dodge']);
    expect(FOE_ROLE_BASELINE_RECIPES.heavy).toEqual(['rampart']);
    expect(FOE_ROLE_BASELINE_RECIPES.artillery).toEqual(['slip', 'aetherwall']);
    expect(FOE_ROLE_BASELINE_RECIPES.mob).toEqual([]);
    expect(FOE_ROLE_BASELINE_RECIPES.leader).toEqual([]);
    expect(FOE_ROLE_BASELINE_RECIPES.legend).toEqual([]);
  });

  it('conditions without a reviewed source stay unprojected (Defiance/Counter/Sturdy/Stealth/Unstoppable)', () => {
    const projected = new Set<string>(Object.values(FOE_ROLE_BASELINE_RECIPES).flat());
    for (const condition of ['defiance', 'counter', 'sturdy', 'stealth', 'unstoppable']) {
      expect(projected.has(condition)).toBe(false);
    }
    expect(projectedRoleConditions(null)).toEqual(new Set());
  });
});
