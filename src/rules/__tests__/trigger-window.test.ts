import '../automation/content/registry.js';
import { windowHeldDamage } from '../automation/kernels/decision-window.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * F4 trigger/window-provenance fixtures (docs/rules-foundations.md §5).
 *
 * One `TRIGGER_WINDOW_RECIPES` registry decides, from durable provenance,
 * whether a damage instance is held by an interrupt window — shared by the
 * single-pass VM path and the split-event basic-attack path. A basic attack
 * records the decision on its `AttackResolutionLedger.window` (and the nested
 * damage ledger), and replay opens the window from the record: the blow is
 * held, never applied, until the interrupt answers or the boundary drains it.
 */

interface WindowFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function windowEncounter(options: { interrupts?: Array<'righteous-disdain' | 'boiling-blood'>; heroHp?: number } = {}): WindowFixture {
  let state = createEncounter('Trigger-window fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  // Fixture convention: arm exactly the requested interrupts so the window
  // decision is unambiguous (the executable set already carries Righteous
  // Disdain, which would otherwise win as the more specific trigger).
  const armed = options.interrupts ?? [];
  hero.abilityIds = hero.abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain' && id !== 'colossus:boiling-blood');
  if (armed.includes('righteous-disdain')) hero.abilityIds.push('demon-slayer:righteous-disdain');
  if (armed.includes('boiling-blood')) hero.abilityIds.push('colossus:boiling-blood');
  if (options.heroHp !== undefined) hero.hp = options.heroHp;
  const foe = createFoe('Relict', { x: 2, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  const foeTurn = endTurnTo(state, foe.id, scriptedDice());
  return { state: foeTurn, hero: foeTurn.actors[hero.id], foe: foeTurn.actors[foe.id] };
}

const attackOf = (result: ReturnType<typeof executeCommand>) => {
  const event = result.events.find((candidate) => candidate.type === 'ATTACK_RESOLVED');
  if (!event || event.type !== 'ATTACK_RESOLVED') throw new Error('Expected an ATTACK_RESOLVED event.');
  return event;
};

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

describe('F4 attack windows from the ledger', () => {
  it('records the when-damaged decision on the attack and opens the window from it at replay', () => {
    const { state, hero, foe } = windowEncounter({ interrupts: ['righteous-disdain'] });
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 3));
    const attack = attackOf(result);
    // The window decision rides both levels of the attack record.
    expect(attack.attackResolution!.window).toEqual({ trigger: 'when-damaged', held: true, resolution: null });
    expect(attack.attackResolution!.damage.window).toEqual({ trigger: 'when-damaged', held: true, resolution: null });
    // Replay opens the window from the record: the blow is held, not applied.
    expect(result.state.actors[hero.id].hp).toBe(40);
    const window = result.state.decisionWindows.find((pending) => pending.actorId === hero.id && pending.kind === 'when-damaged');
    expect(window).toBeDefined();
    expect(windowHeldDamage(window!)).toMatchObject({ amount: 4, damageType: 'normal', sourceActorId: foe.id });
    // The recorded amount is the kernel's determined amount (6 raw - 2 armor).
    expect(windowHeldDamage(window!)!.amount).toBe(attack.attackResolution!.damage.amount);
    // No interrupt answers, so the boundary resolves the held blow.
    const ended = executeCommand(result.state, { type: 'END_TURN', actorId: foe.id }, scriptedDice());
    expect(ended.state.actors[hero.id].hp).toBe(36);
    expect(ended.state.decisionWindows).toHaveLength(0);
    expect(applyEvents(result.state, ended.events)).toEqual(ended.state);
  });

  it('opens a defeated window for a lethal blow, suppressing the defeat until the window resolves', () => {
    // Boiling Blood (p.138) arms the defeated interrupt; the hero is one hp
    // from a lethal blow so the would-be defeat is held.
    const { state, hero, foe } = windowEncounter({ interrupts: ['boiling-blood'], heroHp: 3 });
    state.actors[hero.id].vigor = 0;
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 8));
    const attack = attackOf(result);
    expect(attack.attackResolution!.window).toEqual({ trigger: 'defeated', held: true, resolution: null });
    // The ledger records the would-be application result (the blow is lethal)
    // while the window defers it — no defeat event, still alive, hp held.
    expect(attack.attackResolution!.damage.defeated).toBe(true);
    expect(result.events.some((event) => event.type === 'ACTOR_DEFEATED')).toBe(false);
    expect(result.state.actors[hero.id].defeated).toBe(false);
    expect(result.state.actors[hero.id].hp).toBe(3);
    const window = result.state.decisionWindows.find((pending) => pending.kind === 'defeated');
    expect(window).toBeDefined();
    expect(windowHeldDamage(window!)!.amount).toBeGreaterThanOrEqual(3 + 0);
    // Unanswered, the boundary resolves the held lethal blow and the hero falls.
    const ended = executeCommand(result.state, { type: 'END_TURN', actorId: foe.id }, scriptedDice());
    expect(ended.state.actors[hero.id].defeated).toBe(true);
    expect(applyEvents(result.state, ended.events)).toEqual(ended.state);
  });

  it('the single-pass VM path opens the identical window through the shared registry decision', () => {
    const { state, hero, foe } = windowEncounter({ interrupts: ['righteous-disdain'] });
    const vm = applyEvents(state, [vmDamageEvent(foe.id, hero.id, 6)]);
    expect(vm.actors[hero.id].hp).toBe(40); // held
    const window = vm.decisionWindows.find((pending) => pending.actorId === hero.id && pending.kind === 'when-damaged');
    expect(window).toBeDefined();
    expect(windowHeldDamage(window!)).toMatchObject({ amount: 4, damageType: 'normal', sourceActorId: foe.id });

    // The same blow through the split attack path holds the same amount —
    // both paths call decideDamageWindow with the same provenance.
    const attackResult = executeCommand(state, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 3));
    const attackWindow = attackResult.state.decisionWindows.find((pending) => pending.actorId === hero.id && pending.kind === 'when-damaged');
    expect(windowHeldDamage(attackWindow!)!.amount).toBe(windowHeldDamage(window!)!.amount);
  });

  it('replay consumes the recorded window — stripping the record applies the blow immediately (bite)', () => {
    const { state, hero, foe } = windowEncounter({ interrupts: ['righteous-disdain'] });
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 3));
    const attack = attackOf(result);
    // Strip the window from both levels: nothing left to hold the blow.
    const stripped: EncounterEvent[] = [{
      ...attack,
      attackResolution: {
        ...attack.attackResolution!,
        window: null,
        damage: { ...attack.attackResolution!.damage, window: null },
      },
    }];
    const replayed = applyEvents(state, stripped);
    expect(replayed.actors[hero.id].hp).toBe(36); // applied immediately
    expect(replayed.decisionWindows.some((pending) => pending.actorId === hero.id)).toBe(false);
  });

  it('a held record outside the closed registry is ignored so the damage still applies', () => {
    const { state, hero, foe } = windowEncounter({ interrupts: ['righteous-disdain'] });
    const result = executeCommand(state, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(14, 3));
    const attack = attackOf(result);
    // Fabricate a trigger the registry does not own: the blow must apply
    // normally, not be dropped and not open a window.
    const fabricated: EncounterEvent[] = [{
      ...attack,
      attackResolution: {
        ...attack.attackResolution!,
        window: { trigger: 'targeted-by-ability' as never, held: true, resolution: null },
        damage: { ...attack.attackResolution!.damage, window: { trigger: 'targeted-by-ability' as never, held: true, resolution: null } },
      },
    }];
    const replayed = applyEvents(state, fabricated);
    expect(replayed.actors[hero.id].hp).toBe(36);
    expect(replayed.decisionWindows.some((pending) => pending.actorId === hero.id)).toBe(false);
  });
});
