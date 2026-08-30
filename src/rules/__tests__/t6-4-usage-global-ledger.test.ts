// T6.4 — U16 Usage / Entitlement Ledger consolidation.
//
// ICON 1.5 source contracts under test (verified in this tranche):
//  - p.91 Interrupts: "You can use each interrupt a number of times indicated
//    by the tag ... between your turns, only one interrupt during any turn,
//    (yours or another character's) and get them all back at the start of any
//    of your turns."
//  - p.91 Abilities: "each ability ... only one attack can be made per turn."
//  - p.89 Dangerous Terrain: "Characters can only take this damage once a
//    turn, even if they enter new dangerous terrain spaces."
//  - p.116 Slashed: "Take 4 damage ... no more than once a turn."
//
// These tests are adversarial: they catch the forbidden implementation
// shortcuts (clearing every turn-local key at any turn start; using source id
// without owner identity; sharing one counter between the per-interrupt cap
// and the global one-interrupt window; treating the `attackedThisTurn`
// historical resolution fact as the one-attack entitlement; and leaving a
// migrated raw field as a second executing authority).
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterState } from '../types.js';
import type { DiceSource } from '../dice.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import type { EncounterEvent } from '../types.js';
import {
  attackOncePerTurnKey,
  dangerousOncePerTurnKey,
  interruptAvailable,
  interruptUseKey,
  interruptWindowUsedBy,
  oneInterruptPerTurnWindowKey,
  recordUsageKey,
  refreshAnyTurnLedgersForAll,
  refreshUsageLedgerForBoundary,
  slashedOncePerTurnKey,
  usageCount,
} from '../automation/kernels/use-ledger.js';
import {
  dangerousTerrainTriggeredThisTurn,
  endTurnTo,
  expectRejectedCommandPurity,
  interruptUsedThisTurn,
  interruptUses,
  scriptedDice,
  slashedTriggeredThisTurn,
  startEncounterTo,
  validCharacter,
} from './fixtures.js';

function encounter(): {
  state: EncounterState;
  heroId: string;
  foeId: string;
  allyId: string;
} {
  let state = createEncounter('T6.4 usage-ledger');
  const hero = actorFromCharacter(validCharacter('H'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS, 'bastion:catapult', 'freelancer:astral-chain'];
  hero.chapter = 3;
  const foe = createFoe('Foe', { x: 3, y: 1 });
  const ally = actorFromCharacter(validCharacter('A'), { x: 2, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  const started = startEncounterTo(state, hero.id);
  return { state: started, heroId: hero.id, foeId: foe.id, allyId: ally.id };
}

/** A foe ability that applies `amount` normal damage to `actorId` — opens the
 * when-damaged interrupt window for any surviving hero with an unused
 * when-damaged interrupt (Righteous Disdain / Catapult). */
const damageEvent = (sourceActorId: string, actorId: string, amount: number): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:foe-attack',
  actionId: 'default',
  timing: 'use',
  tags: ['attack'],
  mutations: [{ kind: 'damage', sourceId: 'fixture:foe-attack', sourceActorId, actorId, amount, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
});

describe('T6.4 — per-interrupt pool vs the global one-interrupt-during-any-turn', () => {
  it('#1/#9 an N-use interrupt pool is owner+source scoped and spends to its own cap', () => {
    const { state, heroId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    // Interrupt 2 (Perseus) = 2 uses between the owner's turns.
    expect(interruptUses(hero, 'bastion:perseus')).toBe(0);
    expect(interruptAvailable(state, hero, 'bastion:perseus', 2)).toBe(true);
    recordUsageKey(hero, interruptUseKey(heroId, 'bastion:perseus'));
    expect(interruptUses(hero, 'bastion:perseus')).toBe(1);
    expect(interruptAvailable(state, state.actors[heroId]!, 'bastion:perseus', 2)).toBe(true);
    recordUsageKey(hero, interruptUseKey(heroId, 'bastion:perseus'));
    expect(interruptUses(hero, 'bastion:perseus')).toBe(2);
    // Cap reached until the owner's own turn-start refreshes it.
    expect(interruptAvailable(state, state.actors[heroId]!, 'bastion:perseus', 2)).toBe(false);
    // Same source id on DIFFERENT owners is isolated actor-locally: spending
    // the hero's pool never touches the foe's identical-key pool.
    expect(usageCount(state.actors[foeId]!, interruptUseKey(foeId, 'bastion:perseus'))).toBe(0);
  });

  it('#2 consumes ONE durable mark each, on two DISTINCT keys (per-source pool + battlefield window)', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.actorId === heroId)).toBe(true);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    const h = used.state.actors[heroId]!;
    expect(interruptUses(h, 'bastion:catapult')).toBe(1);
    expect(interruptUsedThisTurn(h)).toBe(true);
    expect(oneInterruptPerTurnWindowKey()).not.toBe(interruptUseKey(heroId, 'bastion:catapult'));
    expect(usageCount(h, oneInterruptPerTurnWindowKey())).toBe(1);
    // The battlefield window is stored on the actor who fired it.
    expect(interruptWindowUsedBy(used.state)).toBe(heroId);
    expect(applyEvents(damaged, used.events)).toEqual(used.state);
  });

  it('#3/#4 one-interrupt-during-any-turn is battlefield-wide and blocks a second before it opens a window', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.actorId === heroId)).toBe(true);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    // A second foe blow within the SAME turn: even a fresh when-damaged
    // trigger cannot open another window — the battlefield window is closed.
    const second = applyEvents(used.state, [damageEvent(foeId, allyId, 4)]);
    expect(second.decisionWindows.some((candidate) => candidate.actorId === heroId && candidate.kind === 'when-damaged')).toBe(false);
    // And a same-turn repeat of the interrupt is rejected without mutation
    // (p.91 no-repeat includes interrupts; the battlefield window is closed too).
    expectRejectedCommandPurity(second, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    expect(() => executeCommand(second, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice())).toThrow(/repeat/i);
  });
});

describe('T6.4 — owner-relative refresh boundaries', () => {
  it('#4 another character’s turn-start does not refresh the owner’s between-turn interrupt pool', () => {
    const { state, heroId, foeId } = encounter();
    const h = state.actors[heroId]!;
    h.ruleState[interruptUseKey(heroId, 'bastion:perseus')] = true; // Interrupt 2, one used
    expect(usageCount(h, interruptUseKey(heroId, 'bastion:perseus'))).toBe(1);
    // The FOE's turn-start must NOT refresh the OWNER's (hero) pool — only the
    // owner's own turn-start boundary does (p.91 "get them all back at the
    // start of any of your turns"). #5 proves the owner-side reset precisely.
    const foeStart = endTurnTo(state, foeId);
    expect(usageCount(foeStart.actors[heroId]!, interruptUseKey(heroId, 'bastion:perseus'))).toBe(1);
  });

  it('#5 the owner-relative reset seam clears exactly the owner’s turn keys', () => {
    const { state, heroId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    const foe = state.actors[foeId]!;
    hero.ruleState[interruptUseKey(heroId, 'bastion:catapult')] = true;
    hero.ruleState[attackOncePerTurnKey(heroId)] = true;
    foe.ruleState[interruptUseKey(foeId, 'bastion:catapult')] = true;
    const turnBoundary = { kind: 'boundary' as const, boundary: 'turn' as const, edge: 'start' as const, subject: { kind: 'live' as const, domain: 'actor' as const, name: { kind: 'id' as const, id: heroId } } };
    refreshUsageLedgerForBoundary(hero, turnBoundary);
    expect(usageCount(hero, interruptUseKey(heroId, 'bastion:catapult'))).toBe(0);
    expect(usageCount(hero, attackOncePerTurnKey(heroId))).toBe(0);
    // Another owner's keys are never touched by the HERO's reset.
    expect(usageCount(foe, interruptUseKey(foeId, 'bastion:catapult'))).toBe(1);
  });
});

describe('T6.4 — Slashed and dangerous terrain any-turn windows', () => {
  it('#7/#8 once-per-turn windows are shared by scope, not by a stale per-actor flag, and re-open at the turn boundary', () => {
    const { state, heroId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    recordUsageKey(hero, slashedOncePerTurnKey());
    recordUsageKey(hero, dangerousOncePerTurnKey());
    expect(slashedTriggeredThisTurn(hero)).toBe(true);
    expect(dangerousTerrainTriggeredThisTurn(hero)).toBe(true);
    expect(usageCount(hero, slashedOncePerTurnKey())).toBe(1);
    expect(usageCount(hero, dangerousOncePerTurnKey())).toBe(1);
    // A boundary reopens the any-turn windows for every actor.
    const foeTurn = endTurnTo(state, foeId);
    expect(usageCount(foeTurn.actors[heroId]!, slashedOncePerTurnKey())).toBe(0);
    expect(usageCount(foeTurn.actors[heroId]!, dangerousOncePerTurnKey())).toBe(0);
  });
});

describe('T6.4 — one-attack-per-turn entitlement vs the attackedThisTurn fact', () => {
  it('#6 the entitlement gate and the historical resolution fact are SEPARATE authorities', () => {
    const { state, heroId, foeId, allyId } = encounter();
    // Astral Chain is an attack-tag ability.
    const first = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [foeId] }, scriptedDice(15, 4, 4));
    // Using it consumed the one-attack entitlement...
    expect(usageCount(first.state.actors[heroId]!, attackOncePerTurnKey(heroId))).toBe(1);
    // ...and (it resolved) recorded the historical attack fact.
    expect(first.state.actors[heroId]!.attackedThisTurn).toBe(true);
    // A rejected command (an unattackable ally target) sets NEITHER the gate
    // NOR the historical fact — proving they are not one interchangeable flag.
    expectRejectedCommandPurity(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [allyId] }, scriptedDice());
    expect(usageCount(state.actors[heroId]!, attackOncePerTurnKey(heroId))).toBe(0);
    expect(state.actors[heroId]!.attackedThisTurn).toBe(false);
    // The gate blocks a second attack-tag ability in the same turn.
    expect(() => executeCommand(first.state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [foeId] }, scriptedDice())).toThrow(/repeat|one attack/i);
    // The fact is a distinct U10 record: the gate key is a typed ledger entry,
    // never the `attackedThisTurn` boolean itself.
    expect(attackOncePerTurnKey(heroId)).not.toContain('attackedThisTurn');
  });
});

describe('T6.4 — replay and schema migration', () => {
  it('#11 replay from pre-command state reproduces byte-identical entitlement state', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.actorId === heroId)).toBe(true);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    const replayed = applyEvents(damaged, used.events);
    expect(replayed.actors[heroId]!.ruleState).toEqual(used.state.actors[heroId]!.ruleState);
    expect(interruptWindowUsedBy(replayed)).toBe(heroId);
  });

  it('#12 the removed raw fields are gone from the canonical actor (no second executing authority)', () => {
    const { state, heroId } = encounter();
    const hero = state.actors[heroId]! as unknown as Record<string, unknown>;
    expect('interruptUses' in hero).toBe(false);
    expect('interruptUsedThisTurn' in hero).toBe(false);
    expect('slashedTriggeredThisTurn' in hero).toBe(false);
    expect('dangerousTerrainTriggeredThisTurn' in hero).toBe(false);
    expect(typeof hero.attackedThisTurn).toBe('boolean');
  });
});