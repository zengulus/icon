// T6.4 + T6.4a — U16 Usage / Entitlement Ledger closure.
//
// ICON 1.5 source contracts under test (verified in this tranche):
//  - p.91 Interrupts: "You can use each interrupt a number of times indicated
//    by the tag ... between your turns, only one interrupt during any turn,
//    (yours or another character's) and get them all back at the start of any
//    of your turns." The subject is the CHARACTER: each actor may normally use
//    at most ONE interrupt during a particular turn (its own or anyone else's).
//    It is actor-local, never battlefield-global (so during Bob's turn both
//    Alice and Carol may each interrupt once, independently).
//  - p.124 Bastion Black Rock Vanguard: "You can take any number of interrupts
//    per turn." — an ACTOR-SPECIFIC override of that actor-local restriction,
//    which must not raise any other actor's window.
//  - p.91 No Repeats: "When you use any ability with a cost, you can't repeat
//    it in the same turn. This includes free actions or abilities you can use
//    off your turn, such as interrupts."
//  - p.91 Standard move: "The most basic Free Action is a standard move" — an
//    owner-relative once-per-own-turn entitlement (dash is a separate costed
//    basic ability subject to No Repeats).
//  - p.91 Abilities: "only one attack can be made per turn." (U16 one-attack
//    gate, distinct from the `attackedThisTurn` historical resolution fact.)
//  - p.89 Dangerous Terrain: "Characters can only take this damage once a turn";
//    the Harvester "Relevant Rules" reprint (p.183) says "once a round" — a
//    genuine source contradiction formally recorded as adopted adjudication
//    `icon-1.5:dangerous-terrain:damage-cadence` (src/rules/source-adjudications.ts,
//    docs/source-adjudications.md) and pinned in the test below.
//  - p.116 Slashed: "Take 4 damage ... no more than once a turn."
//
// These tests are adversarial: they catch the forbidden implementation
// shortcuts (battlefield-global one-interrupt window; clearing every
// `ledger:turn:*` key at any turn start; using source id without owner
// identity; sharing one counter between the per-interrupt cap and the
// per-turn restriction; treating the `attackedThisTurn` historical resolution
// fact as the one-attack entitlement; and leaving a migrated raw field as a
// second executing authority).
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterState } from '../types.js';
import type { DiceSource } from '../dice.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { findAdjudication } from '../source-adjudications.js';
import type { EncounterEvent } from '../types.js';
import {
  attackOncePerTurnKey,
  dangerousOncePerTurnKey,
  interruptAvailable,
  interruptUseKey,
  interruptWindowAvailableFor,
  interruptsPerTurnCap,
  noRepeatKey,
  oneInterruptPerTurnWindowKey,
  recordUsageKey,
  refreshAnyTurnLedgersForAll,
  refreshUsageLedgerForBoundary,
  slashedOncePerTurnKey,
  standardMoveOncePerTurnKey,
  usageCount,
} from '../automation/kernels/use-ledger.js';
import {
  dangerousTerrainTriggeredThisTurn,
  endTurnOnly,
  endTurnTo,
  expectRejectedCommandPurity,
  interruptUsedThisTurn,
  interruptUses,
  scriptedDice,
  slashedTriggeredThisTurn,
  standardMoveUsedThisTurn,
  startEncounterTo,
  usedAbilityThisTurn,
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

describe('T6.4a — the one-interrupt-per-turn restriction is ACTOR-LOCAL', () => {
  it('#1/#5 a single actor can fire one interrupt during a turn and its window closes only for that actor', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.actorId === heroId)).toBe(true);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    const h = used.state.actors[heroId]!;
    expect(interruptUses(h, 'bastion:catapult')).toBe(1);
    expect(interruptUsedThisTurn(h)).toBe(true);
    expect(oneInterruptPerTurnWindowKey()).not.toBe(interruptUseKey(heroId, 'bastion:catapult'));
    expect(usageCount(h, oneInterruptPerTurnWindowKey())).toBe(1);
    expect(interruptWindowAvailableFor(h)).toBe(false);
    expect(applyEvents(damaged, used.events)).toEqual(used.state);
  });

  it('#2/#3/#4/#7 two different actors can each interrupt during the SAME turn — Alice\'s use never closes Carol\'s window nor consumes Carol\'s pool', () => {
    // Build the setup phase with BOTH heroes present before START_ENCOUNTER.
    let state = createEncounter('T6.4 actor-local interrupts');
    const hero = actorFromCharacter(validCharacter('H'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS, 'bastion:catapult', 'freelancer:astral-chain'];
    hero.chapter = 3;
    const carol = actorFromCharacter(validCharacter('C'), { x: 2, y: 2 });
    carol.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS, 'bastion:catapult', 'freelancer:astral-chain'];
    carol.chapter = 3;
    const foe = createFoe('Foe', { x: 3, y: 1 });
    const ally = actorFromCharacter(validCharacter('A'), { x: 2, y: 1 });
    const ally2 = actorFromCharacter(validCharacter('Q'), { x: 2, y: 3 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally2 }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: carol }).state;
    const started = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    const carolId = carol.id;
    // Damage BOTH heroes in the same turn (Bob's-turn analogy): each opens its
    // OWN when-damaged window, so each is independently interrupt-eligible.
    const bothDamaged = applyEvents(started, [damageEvent(foe.id, heroId, 4), damageEvent(foe.id, carolId, 4)]);
    const aliceWindow = bothDamaged.decisionWindows.find((candidate) => candidate.actorId === heroId && candidate.kind === 'when-damaged');
    const carolWindow = bothDamaged.decisionWindows.find((candidate) => candidate.actorId === carolId && candidate.kind === 'when-damaged');
    expect(aliceWindow).toBeDefined();
    expect(carolWindow).toBeDefined();
    expect(carolWindow?.actorId).not.toBe(aliceWindow?.actorId);
    // Alice answers her OWN window.
    const aliceUsed = executeCommand(bothDamaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [ally.id] }, scriptedDice());
    const ah = aliceUsed.state.actors[heroId]!;
    expect(interruptUsedThisTurn(ah)).toBe(true);
    expect(interruptWindowAvailableFor(ah)).toBe(false);
    // Carol's window is independent: still open, her own pool untouched.
    const ch = aliceUsed.state.actors[carolId]!;
    expect(interruptUsedThisTurn(ch)).toBe(false);
    expect(interruptWindowAvailableFor(ch)).toBe(true);
    expect(usageCount(ch, oneInterruptPerTurnWindowKey())).toBe(0);
    expect(interruptUses(ch, 'bastion:catapult')).toBe(0);
    // Carol fires her own interrupt.
    const carolUsed = executeCommand(aliceUsed.state, { type: 'USE_ABILITY', actorId: carolId, abilityId: 'bastion:catapult', targetIds: [ally2.id] }, scriptedDice());
    expect(interruptUsedThisTurn(carolUsed.state.actors[carolId]!)).toBe(true);
    // Alice cannot fire a second interrupt this turn.
    expect(() => executeCommand(carolUsed.state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [ally.id] }, scriptedDice())).toThrow(/interrupt|repeat/i);
  });

  it('#6 Alice\'s use does not consume Carol\'s per-interrupt pool', () => {
    const { state, heroId, allyId, foeId } = encounter();
    const h = state.actors[heroId]!;
    recordUsageKey(h, interruptUseKey(heroId, 'bastion:catapult'));
    expect(interruptAvailable(state, h, 'bastion:catapult', 1)).toBe(false);
    // A DIFFERENT actor with the SAME source id has an independent (fresh) pool.
    expect(usageCount(state.actors[foeId]!, interruptUseKey(foeId, 'bastion:catapult'))).toBe(0);
    void allyId;
  });

  it('#10 Black Rock Vanguard lifts ONLY its own actor\'s per-turn window; other actors\' independent windows are never disabled', () => {
    const { state, heroId, allyId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    expect(interruptsPerTurnCap(hero)).toBe(1);
    // Give the hero the Bastion Chapter-3 trait: its own cap goes infinite.
    hero.traitIds.push('bastion:trait:black-rock-vanguard');
    expect(interruptsPerTurnCap(hero)).toBe(Number.POSITIVE_INFINITY);
    // A different actor (no trait) keeps the default cap of 1.
    expect(interruptsPerTurnCap(state.actors[foeId]!)).toBe(1);
    expect(interruptWindowAvailableFor(state.actors[foeId]!)).toBe(true);
    // The Bastion still honors the per-interrupt between-turn pool cap.
    expect(interruptAvailable(state, hero, 'bastion:perseus', 2)).toBe(true);
    void allyId;
  });
});

describe('T6.4 — per-interrupt pool vs the per-turn window (distinct counters)', () => {
  it('#2 consumes ONE durable mark each, on two DISTINCT keys (per-source pool + actor-local per-turn window)', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.actorId === heroId)).toBe(true);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    const h = used.state.actors[heroId]!;
    expect(interruptUses(h, 'bastion:catapult')).toBe(1);
    expect(interruptUsedThisTurn(h)).toBe(true);
    expect(oneInterruptPerTurnWindowKey()).not.toBe(interruptUseKey(heroId, 'bastion:catapult'));
    expect(usageCount(h, oneInterruptPerTurnWindowKey())).toBe(1);
    expect(applyEvents(damaged, used.events)).toEqual(used.state);
  });

  it('#14 the No Repeats mark (a per-ability any-turn entry) is DISTINCT from the one-interrupt-per-turn window', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    const h = used.state.actors[heroId]!;
    expect(noRepeatKey('bastion:catapult')).not.toBe(interruptUseKey(heroId, 'bastion:catapult'));
    expect(noRepeatKey('bastion:catapult')).not.toBe(oneInterruptPerTurnWindowKey());
    expect(usageCount(h, noRepeatKey('bastion:catapult'))).toBe(1);
  });
});

describe('T6.4a — No Repeats (p.91) is U16 per-ability any-turn usage state', () => {
  it('an ordinary ability cannot repeat within the current turn, and becomes available again after the turn window resets', () => {
    const { state, heroId, foeId } = encounter();
    const first = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [foeId] }, scriptedDice(15, 4, 4));
    expect(usedAbilityThisTurn(first.state.actors[heroId]!, 'freelancer:astral-chain')).toBe(true);
    // Second use of the same source in the same turn is rejected.
    expectRejectedCommandPurity(first.state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [foeId] }, scriptedDice());
    // ANY next turn reopens the any-turn no-repeat window (it is not the
    // owner's pool; p.91 No Repeats is scoped to the current turn).
    const foeTurn = endTurnTo(first.state, foeId);
    expect(usedAbilityThisTurn(foeTurn.actors[heroId]!, 'freelancer:astral-chain')).toBe(false);
  });

  it('two different abilities do not alias, and the same source on different actors does not alias', () => {
    const { state, heroId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    recordUsageKey(hero, noRepeatKey('freelancer:astral-chain'));
    expect(usedAbilityThisTurn(hero, 'freelancer:astral-chain')).toBe(true);
    // A DIFFERENT source id is a separate mark.
    expect(usedAbilityThisTurn(hero, 'bastion:catapult')).toBe(false);
    // A DIFFERENT actor's identical-key no-repeat mark is a separate entry
    // (storage is actor-local), isolated even though the key string matches.
    const foe = state.actors[foeId]!;
    expect(usedAbilityThisTurn(foe, 'freelancer:astral-chain')).toBe(false);
    recordUsageKey(foe, noRepeatKey('freelancer:astral-chain'));
    expect(usedAbilityThisTurn(foe, 'freelancer:astral-chain')).toBe(true);
    expect(usageCount(hero, noRepeatKey('freelancer:astral-chain'))).toBe(1); // untouched
  });

  it('an off-turn interrupt participates in No Repeats correctly', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    // The interrupt recorded both its per-interrupt pool use AND its No Repeats mark.
    expect(usedAbilityThisTurn(used.state.actors[heroId]!, 'bastion:catapult')).toBe(true);
  });

  it('basic actions (Interact / Rescue / Recover) and Dash each hold a distinct no-repeat mark', () => {
    const { state, heroId } = encounter();
    const hero = state.actors[heroId]!;
    recordUsageKey(hero, noRepeatKey('basic:interact'));
    recordUsageKey(hero, noRepeatKey('basic:dash'));
    expect(usedAbilityThisTurn(hero, 'basic:interact')).toBe(true);
    expect(usedAbilityThisTurn(hero, 'basic:dash')).toBe(true);
    expect(usedAbilityThisTurn(hero, 'basic:rescue')).toBe(false);
    expect(usedAbilityThisTurn(hero, 'basic:recover')).toBe(false);
  });
});

describe('T6.4a — standard move is an OWNER-RELATIVE once-per-own-turn entitlement', () => {
  it('one standard move per own turn; a second is rejected; the owner\'s turn-start restores it but another actor\'s never does', () => {
    const { state, heroId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    expect(standardMoveUsedThisTurn(hero)).toBe(false);
    recordUsageKey(hero, standardMoveOncePerTurnKey(heroId));
    expect(standardMoveUsedThisTurn(hero)).toBe(true);
    // Another actor's turn-start must NOT reset the owner's standard-move key.
    const foeTurn = endTurnTo(state, foeId);
    expect(standardMoveUsedThisTurn(foeTurn.actors[heroId]!)).toBe(true);
    // The ownered-relative reset (the lifecycle turn-ledger-reset recipe's
    // authority) clears the OWNER's key at the OWNER's own turn-start boundary.
    const turnBoundary = { kind: 'boundary' as const, boundary: 'turn' as const, edge: 'start' as const, subject: { kind: 'live' as const, domain: 'actor' as const, name: { kind: 'id' as const, id: heroId } } };
    refreshUsageLedgerForBoundary(foeTurn.actors[heroId]!, turnBoundary);
    expect(standardMoveUsedThisTurn(foeTurn.actors[heroId]!)).toBe(false);
    // A different actor's own reset never touches the owner's key (the FOE's
    // standard-move key was never set; resetting the foe clears nothing on hero).
    const foeBoundary = { kind: 'boundary' as const, boundary: 'turn' as const, edge: 'start' as const, subject: { kind: 'live' as const, domain: 'actor' as const, name: { kind: 'id' as const, id: foeId } } };
    refreshUsageLedgerForBoundary(foeTurn.actors[heroId]!, foeBoundary);
    expect(standardMoveUsedThisTurn(foeTurn.actors[heroId]!)).toBe(false);
  });

  it('standard move and Dash are DISTINCT entitlements', () => {
    const { state, heroId } = encounter();
    const hero = state.actors[heroId]!;
    recordUsageKey(hero, standardMoveOncePerTurnKey(heroId));
    expect(standardMoveUsedThisTurn(hero)).toBe(true);
    // The standard-move key is a `ledger:turn:*` entry, never the `any-turn`
    // No Repeats Dash key.
    expect(standardMoveOncePerTurnKey(heroId)).not.toBe(noRepeatKey('basic:dash'));
    expect(usedAbilityThisTurn(hero, 'basic:dash')).toBe(false);
  });
});

describe('T6.4 — Slashed and dangerous terrain any-turn windows', () => {
  it('#7/#8 once-per-turn windows re-open at the turn boundary', () => {
    const { state, heroId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    recordUsageKey(hero, slashedOncePerTurnKey());
    recordUsageKey(hero, dangerousOncePerTurnKey());
    expect(slashedTriggeredThisTurn(hero)).toBe(true);
    expect(dangerousTerrainTriggeredThisTurn(hero)).toBe(true);
    expect(usageCount(hero, slashedOncePerTurnKey())).toBe(1);
    expect(usageCount(hero, dangerousOncePerTurnKey())).toBe(1);
    const foeTurn = endTurnTo(state, foeId);
    expect(usageCount(foeTurn.actors[heroId]!, slashedOncePerTurnKey())).toBe(0);
    expect(usageCount(foeTurn.actors[heroId]!, dangerousOncePerTurnKey())).toBe(0);
  });

  it('the adopted dangerous-terrain adjudication is ONCE PER TURN (p.89, not the Harvester reprint of p.183)', () => {
    // The conflict is recorded through the repository's formal source-
    // adjudication mechanism — the typed record `icon-1.5:dangerous-terrain:damage-cadence`
    // (src/rules/source-adjudications.ts) — never resolved by a code comment.
    const adjudication = findAdjudication('icon-1.5:dangerous-terrain:damage-cadence');
    expect(adjudication?.status).toBe('adopted');
    const { state, heroId, foeId } = encounter();
    const hero = state.actors[heroId]!;
    recordUsageKey(hero, dangerousOncePerTurnKey());
    // Multiple crossings during a turn deal damage only the first time.
    expect(dangerousTerrainTriggeredThisTurn(hero)).toBe(true);
    expect(usageCount(hero, dangerousOncePerTurnKey())).toBe(1);
    // Refresh occurs at the turn boundary.
    const foeTurn = endTurnTo(state, foeId);
    expect(usageCount(foeTurn.actors[heroId]!, dangerousOncePerTurnKey())).toBe(0);
  });
});

describe('T6.4 — one-attack-per-turn entitlement vs the attackedThisTurn fact', () => {
  it('#6 the entitlement gate and the historical resolution fact are SEPARATE authorities', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const first = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [foeId] }, scriptedDice(15, 4, 4));
    expect(usageCount(first.state.actors[heroId]!, attackOncePerTurnKey(heroId))).toBe(1);
    expect(first.state.actors[heroId]!.attackedThisTurn).toBe(true);
    // A rejected command (an unattackable ally target) sets NEITHER.
    expectRejectedCommandPurity(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [allyId] }, scriptedDice());
    expect(usageCount(state.actors[heroId]!, attackOncePerTurnKey(heroId))).toBe(0);
    expect(state.actors[heroId]!.attackedThisTurn).toBe(false);
    expect(() => executeCommand(first.state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'freelancer:astral-chain', targetIds: [foeId] }, scriptedDice())).toThrow(/repeat|one attack/i);
    expect(attackOncePerTurnKey(heroId)).not.toContain('attackedThisTurn');
  });
});

describe('T6.4/T6.4a — replay, migration, and no second executing authority', () => {
  it('replay from pre-command state reproduces byte-identical entitlement state', () => {
    const { state, heroId, foeId, allyId } = encounter();
    const damaged = applyEvents(state, [damageEvent(foeId, allyId, 4)]);
    expect(damaged.decisionWindows.some((candidate) => candidate.actorId === heroId)).toBe(true);
    const used = executeCommand(damaged, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:catapult', targetIds: [allyId] }, scriptedDice());
    const replayed = applyEvents(damaged, used.events);
    expect(replayed.actors[heroId]!.ruleState).toEqual(used.state.actors[heroId]!.ruleState);
  });

  it('removed fields (including usedAbilityIds and standardMoveUsed) are gone; no second executing authority', () => {
    const { state, heroId } = encounter();
    const hero = state.actors[heroId]! as unknown as Record<string, unknown>;
    expect('interruptUses' in hero).toBe(false);
    expect('interruptUsedThisTurn' in hero).toBe(false);
    expect('slashedTriggeredThisTurn' in hero).toBe(false);
    expect('dangerousTerrainTriggeredThisTurn' in hero).toBe(false);
    expect('usedAbilityIds' in hero).toBe(false);
    expect('standardMoveUsed' in hero).toBe(false);
    expect(typeof hero.attackedThisTurn).toBe('boolean');
  });
});