import '../automation/content/registry.js';
import { windowHeldDamage } from '../automation/kernels/decision-window.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { planMovement } from '../movement.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position, TerrainCell } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo, slashedTriggeredThisTurn} from './fixtures.js';

/**
 * F0 damage-ledger matrix (ICON pp.89, 93–107).
 *
 * The foundation requirement: the same damage must resolve identically
 * whether it arrives as a basic attack, a VM rule mutation, dangerous
 * terrain, a held when-damaged blow, a delayed effect, a Slashed ability
 * move, or reactive Counter damage — and every serialized instance must
 * declare which side of the handoff it is ('source' replays through
 * determineAndApplyEncounterDamage, 'determined' through
 * applyDeterminedEncounterDamage). Each scenario below pins the durable
 * ledger fields and verifies applyEvents replays to the identical state.
 */

interface LedgerFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally: EncounterActor | null;
}

function ledgerEncounter(options: {
  foe?: Position;
  stripInterrupts?: boolean;
  terrain?: TerrainCell[];
  ally?: Position | null;
} = {}): LedgerFixture {
  let state = createEncounter('Damage ledger fixture');
  if (options.terrain) state.grid = { ...state.grid, terrain: options.terrain };
  const hero = actorFromCharacter(validCharacter('Green Witch'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  // Fixture convention: strip the when-damaged (p.128) and defeated (p.138)
  // interrupts so a foe blow applies instead of being held — unless the test
  // is explicitly about the held-damage window.
  if (options.stripInterrupts !== false) {
    hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
  }
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, ally };
}

/** A VM damage mutation with a fixed source amount (the generic mutation shape). */
const vmDamageEvent = (sourceActorId: string, actorId: string, amount: number): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:vm-blow',
  actionId: 'default',
  timing: 'use',
  tags: ['attack'],
  mutations: [{ kind: 'damage', sourceId: 'fixture:vm-blow', sourceActorId, actorId, amount, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
});

describe('F0 damage ledger (pp.89, 93–107)', () => {
  it('a basic attack serializes a determined-handoff ledger', () => {
    const { state, hero, foe } = ledgerEncounter();
    const foeTurn = endTurnTo(state, foe.id, scriptedDice());
    const result = executeCommand(foeTurn, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 3));
    const attack = result.events.find((event) => event.type === 'ATTACK_RESOLVED');
    expect(attack).toBeDefined();
    if (!attack || attack.type !== 'ATTACK_RESOLVED') return;
    // The AttackResolution ledger records the authority provenance the direct
    // gate validated (pp.87–92) plus the attack-window choice.
    const resolution = attack.attackResolution;
    expect(resolution).toBeDefined();
    expect(resolution!.target).toEqual({ relation: 'foe', maximumRange: foe.basicAttackRange, lineOfSight: true });
    expect(resolution!.covered).toBe(false);
    expect(resolution!.window).toBeNull();
    // Its downstream damage ledger is the determined-handoff application record.
    const ledger = resolution!.damage;
    expect(ledger.handoff).toBe('determined');
    expect(ledger.sourceActorId).toBe(foe.id);
    expect(ledger.sourceRuleId).toBe('core:light-attack');
    expect(ledger.delivery).toBe('hit');
    expect(ledger.damageType).toBe('normal');
    expect(ledger.ignoreCover).toBe(false);
    expect(ledger.covered).toBe(false);
    // The recorded amount is the post-mitigation determined amount (armor 2),
    // not the raw 6 — a 'determined' entry must never be re-mitigated.
    expect(attack.rawDamage).toBe(6); // d8 3 + fray 3
    expect(ledger.amount).toBe(4);
    expect(ledger.appliedAmount).toBe(attack.appliedDamage);
    expect(ledger.hpDamage).toBe(4);
    expect(ledger.vigorDamage).toBe(0);
    expect(ledger.flooredAt1).toBeNull();
    expect(ledger.defeated).toBe(false);
    expect(ledger.window).toBeNull();
    expect(result.state.actors[hero.id].hp).toBe(36); // 40 - 4
    expect(applyEvents(foeTurn, result.events)).toEqual(result.state);
  });

  it('the same source amount applies identically through a basic attack and VM damage', () => {
    const { state, hero, foe } = ledgerEncounter();
    const foeTurn = endTurnTo(state, foe.id, scriptedDice());
    const attacked = executeCommand(foeTurn, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 3));
    const attack = attacked.events.find((event) => event.type === 'ATTACK_RESOLVED');
    expect(attack).toBeDefined();
    if (!attack || attack.type !== 'ATTACK_RESOLVED') return;
    // The VM path serializes the source amount (raw 6); the attack serializes
    // the determined amount (4 after armor). Both must land the same blow.
    const vm = applyEvents(state, [vmDamageEvent(foe.id, hero.id, attack.rawDamage)]);
    expect(attack.attackResolution!.damage.amount).toBe(attack.rawDamage - hero.armor);
    expect(vm.actors[hero.id].hp).toBe(attacked.state.actors[hero.id].hp);
    expect(vm.actors[hero.id].hp).toBe(36);
  });

  it('dangerous terrain serializes a source-handoff ledger and replays through the kernel', () => {
    const { state, hero } = ledgerEncounter({ foe: { x: 4, y: 1 }, terrain: [{ position: { x: 2, y: 1 }, type: 'dangerous', elevation: 0 }] });
    state.actors[hero.id].vigor = 5;
    const path = planMovement(state, hero.id, { x: 2, y: 1 }, 'standard').path;
    const result = executeCommand(state, { type: 'MOVE', actorId: hero.id, path, mode: 'standard' }, scriptedDice());
    const moved = result.events.find((event) => event.type === 'ACTOR_MOVED');
    expect(moved).toBeDefined();
    if (!moved || moved.type !== 'ACTOR_MOVED') return;
    const ledger = moved.ledger;
    expect(ledger).toBeDefined();
    expect(ledger!.handoff).toBe('source'); // a raw p.89 amount re-derives mitigation
    expect(ledger!.sourceActorId).toBeNull();
    expect(ledger!.sourceRuleId).toBe('core:dangerous-terrain');
    expect(ledger!.delivery).toBe('terrain');
    expect(ledger!.damageType).toBe('piercing');
    expect(ledger!.bypassVigor).toBe(true);
    expect(ledger!.ignoreCover).toBe(true);
    expect(ledger!.amount).toBe(2);
    expect(ledger!.appliedAmount).toBe(2);
    expect(ledger!.hpDamage).toBe(2);
    expect(ledger!.vigorDamage).toBe(0); // explicit vigor bypass
    expect(ledger!.flooredAt1).toBeNull();
    expect(ledger!.defeated).toBe(false);
    expect(result.state.actors[hero.id]).toMatchObject({ hp: 38, vigor: 5 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('a held when-damaged blow carries the same determined amount the kernel derives', () => {
    // p.128: the foe's blow targets the ALLY in range 2 of the owner; the
    // hero (owner) holds the ally's determined 4 in its when-damaged window.
    const { state, hero, foe, ally } = ledgerEncounter({ stripInterrupts: false, foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 } });
    const damaged = applyEvents(state, [vmDamageEvent(foe.id, ally!.id, 6)]);
    // The hero's when-damaged interrupt (Righteous Disdain) holds the ally's
    // blow: 6 raw - 2 armor = the same 4 the basic-attack ledger records.
    expect(damaged.actors[ally!.id].hp).toBe(40); // held, not applied
    const window = damaged.decisionWindows.find((pending) => pending.actorId === hero.id && pending.kind === 'when-damaged');
    expect(window).toBeDefined();
    expect(windowHeldDamage(window!)).toMatchObject({ amount: 4, damageType: 'normal', sourceActorId: foe.id, targetId: ally!.id });
    // No interrupt answers, so the turn boundary resolves the held 4 through
    // the shared kernel — identical to an immediate blow, to the ALLY.
    const endedResult = executeCommand(damaged, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    expect(endedResult.state.actors[ally!.id].hp).toBe(36);
    expect(endedResult.state.actors[hero.id].hp).toBe(40);
    expect(applyEvents(damaged, endedResult.events)).toEqual(endedResult.state);
  });

  it('Counter reactive damage replays through the shared kernel (2 back, armor-reduced)', () => {
    const { state, hero, foe } = ledgerEncounter();
    state.actors[hero.id].armor = 0; // make the retaliation visible
    state.actors[foe.id].conditions.push({ id: 'counter', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const events = [vmDamageEvent(hero.id, foe.id, 6)];
    const result = applyEvents(state, events);
    expect(result.actors[foe.id].hp).toBe(26); // 32 - 6
    expect(result.actors[hero.id].hp).toBe(38); // 40 - counter 2 (armor 0)
    expect(applyEvents(state, events)).toEqual(result);
  });

  it('a defiant target records the Defiance floor in the ledger and replay consumes it', () => {
    const { state, hero, foe } = ledgerEncounter();
    state.actors[hero.id].hp = 3;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const foeTurn = endTurnTo(state, foe.id, scriptedDice());
    const result = executeCommand(foeTurn, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 8));
    const attack = result.events.find((event) => event.type === 'ATTACK_RESOLVED');
    expect(attack).toBeDefined();
    if (!attack || attack.type !== 'ATTACK_RESOLVED') return;
    // d8 8 + fray 3 = 11 raw, minus armor 2 = 9 determined — still lethal, but
    // the ledger records the application floor that kept the hero at 1 hp.
    expect(attack.rawDamage).toBe(11);
    expect(attack.attackResolution!.target.maximumRange).toBe(foe.basicAttackRange);
    expect(attack.attackResolution!.damage.amount).toBe(9);
    expect(attack.attackResolution!.damage.flooredAt1).toBe('defiance');
    expect(attack.attackResolution!.damage.defeated).toBe(false);
    expect(attack.appliedDamage).toBe(2);
    const heroState = result.state.actors[hero.id];
    expect(heroState.hp).toBe(1);
    expect(heroState.conditions.some(({ id }) => id === 'defiance')).toBe(false); // consumed
    expect(heroState.ruleState['damage-immune']).toBe(true); // temporary immunity
    expect(applyEvents(foeTurn, result.events)).toEqual(result.state);
  });

  it('legacy events without a ledger replay through the historical path identically', () => {
    const { state, hero, foe } = ledgerEncounter();
    state.actors[hero.id].hp = 3;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const foeTurn = endTurnTo(state, foe.id, scriptedDice());
    // Historical ATTACK_RESOLVED records the post-floor applied amount (2) and
    // the durable defiance flag, with no ledger. Replay must land the same
    // floor, consume Defiance, and grant the immunity the ledger path does.
    const legacy: EncounterEvent[] = [{
      type: 'ATTACK_RESOLVED',
      actorId: foe.id,
      targetId: hero.id,
      weight: 'light',
      d20: 14,
      boonDie: 0,
      total: 14,
      evasionRoll: null,
      hit: true,
      critical: false,
      rawDamage: 11,
      appliedDamage: 2,
      defianceTriggered: true,
    }];
    const replayed = applyEvents(foeTurn, legacy);
    expect(replayed.actors[hero.id].hp).toBe(1);
    expect(replayed.actors[hero.id].conditions.some(({ id }) => id === 'defiance')).toBe(false);
    expect(replayed.actors[hero.id].ruleState['damage-immune']).toBe(true);
  });

  it('replay consumes the ledger: a ledger-only event triggers Defiance from the recorded determined amount', () => {
    const { state, hero, foe } = ledgerEncounter();
    state.actors[hero.id].hp = 3;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const foeTurn = endTurnTo(state, foe.id, scriptedDice());
    const result = executeCommand(foeTurn, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 8));
    const attack = result.events.find((event) => event.type === 'ATTACK_RESOLVED');
    expect(attack).toBeDefined();
    if (!attack || attack.type !== 'ATTACK_RESOLVED') return;
    // Strip the legacy defiance flag (and reduce appliedDamage to a number a
    // legacy replay would never re-infer Defiance from): only the resolution
    // ledger's recorded determined amount (9, still lethal) can re-trigger the
    // floor.
    const ledgerOnly: EncounterEvent[] = [{ ...attack, appliedDamage: 2, defianceTriggered: undefined }];
    const replayed = applyEvents(foeTurn, ledgerOnly);
    expect(replayed.actors[hero.id].hp).toBe(1);
    expect(replayed.actors[hero.id].conditions.some(({ id }) => id === 'defiance')).toBe(false); // consumed from the ledger
    expect(replayed.actors[hero.id].ruleState['damage-immune']).toBe(true);
  });
});

describe('F0 matrix: delayed and Slashed damage through the shared kernel', () => {
  function delayedEncounter(): LedgerFixture {
    let state = createEncounter('Delayed ledger fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 4, y: 1 });
    const second = createFoe('Grim', { x: 7, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
    state = startEncounterTo(state, hero.id);
    return { state, hero, foe, ally: null };
  }

  it('a delayed effect (Great Giorgios rush) determines its raw damage through the shared kernel', () => {
    const { state, hero, foe } = delayedEncounter();
    state.actors[foe.id].armor = 2;
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    // U13: the trigger opens the "may rush" choice window (the mark was
    // consumed; the engine never chooses "yes"); accepting resolves the
    // delayed rush.
    const rushWindow = ended.decisionWindows.find((candidate) => candidate.kind === 'choice');
    expect(rushWindow).toBeDefined();
    const answered = executeCommand(ended, { type: 'ANSWER_DECISION_WINDOW', windowId: rushWindow!.id, input: { booleans: { rush: true } } }, scriptedDice());
    // The delayed rush travels two spaces (source damage 4); armor 2 reduces
    // it through the common p.93 determination before application.
    expect(answered.state.actors[foe.id].hp).toBe(30);
    expect(applyEvents(ended, answered.events)).toEqual(answered.state);
  });

  it('Slashed ability-move damage determines through the shared kernel (armor applies)', () => {
    const { state, hero, foe } = delayedEncounter();
    state.actors[hero.id].statuses.push('slashed');
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    // U13: the trigger opens the "may rush" choice window; accepting resolves
    // the delayed rush through the shared kernel.
    const rushWindow = ended.decisionWindows.find((candidate) => candidate.kind === 'choice');
    expect(rushWindow).toBeDefined();
    const answered = executeCommand(ended, { type: 'ANSWER_DECISION_WINDOW', windowId: rushWindow!.id, input: { booleans: { rush: true } } }, scriptedDice());
    // The single raw Slashed instance is determined by the shared kernel:
    // 4 normal - armor 2 = exactly 2 applied HP damage.
    expect(answered.state.actors[hero.id]).toMatchObject({ hp: 38 });
    expect(slashedTriggeredThisTurn(answered.state.actors[hero.id])).toBe(true);
    expect(applyEvents(ended, answered.events)).toEqual(answered.state);
  });
});
