import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand, orderInterrupts } from '../encounter.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/manual-programs.js';
import type { EncounterActor, EncounterEvent, EncounterPendingInterrupt, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Source-derived golden fixtures for ICON p.107 Interrupt Order and the
 * held-damage protocol: interrupts resolve with the most recently triggered
 * interrupt first (LIFO for nested interrupts), and interrupts that share a
 * trigger and trigger at the same time resolve in the same order as turns
 * (player character/npc, alternating). When a character with an available
 * `when-damaged` interrupt (Righteous Disdain, p.128) takes foe damage, the
 * reducer holds the determined damage unapplied and opens a window carrying
 * it; the interrupt resolves before the damage applies, the damage applies
 * after the interrupt (or at the end of the turn) unless the interrupt
 * re-dealt it, and all windows close at the end of the turn.
 */

interface InterruptFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally: EncounterActor | null;
}

function interruptEncounter(options: { foe?: Position; second?: Position | null; ally?: Position | null } = {}): InterruptFixture {
  let state = createEncounter('Interrupt fixture');
  const hero = actorFromCharacter(validCharacter('Flying Skald'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe, ally };
}

/** A foe ability that applies `amount` normal damage to `actorId`. */
const damageEvent = (sourceActorId: string, actorId: string, amount: number): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:foe-attack',
  actionId: 'default',
  timing: 'use',
  tags: ['attack'],
  mutations: [{ kind: 'damage', sourceId: 'fixture:foe-attack', sourceActorId, actorId, amount, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
});

describe('interrupt order (p.107)', () => {
  it('orders nested interrupts most-recently-triggered first (LIFO)', () => {
    const { state, hero, foe } = interruptEncounter({ second: null });
    const pending: EncounterPendingInterrupt[] = [
      { id: 'older', actorId: foe.id, trigger: 'when-damaged', triggeredAt: 5, order: 0 },
      { id: 'newer', actorId: hero.id, trigger: 'when-damaged', triggeredAt: 9, order: 0 },
    ];
    expect(orderInterrupts(state, hero.id, pending).map(({ id }) => id)).toEqual(['newer', 'older']);
  });

  it('orders simultaneous same-trigger interrupts in turn order (turn character’s side first)', () => {
    const { state, hero, foe } = interruptEncounter({ second: null });
    const pending: EncounterPendingInterrupt[] = [
      { id: 'foe-window', actorId: foe.id, trigger: 'when-damaged', triggeredAt: 7, order: 0 },
      { id: 'hero-window', actorId: hero.id, trigger: 'when-damaged', triggeredAt: 7, order: 1 },
    ];
    // Same trigger, same revision: the turn character's side acts first.
    expect(orderInterrupts(state, hero.id, pending).map(({ id }) => id)).toEqual(['hero-window', 'foe-window']);
  });

  it('holds determined foe damage in the when-damaged window and applies it after the interrupt resolves', () => {
    const { state, hero, foe, ally } = interruptEncounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 2, y: 1 } });
    const damaged = applyEvents(state, [damageEvent(foe.id, hero.id, 4)]);
    // The hero has an unused when-damaged interrupt (Righteous Disdain), so
    // the determined damage (4 normal - 2 armor) is held unapplied.
    expect(damaged.actors[hero.id].hp).toBe(40);
    const heroWindow = damaged.pendingInterrupts.find((window) => window.actorId === hero.id && window.trigger === 'when-damaged');
    expect(heroWindow).toBeDefined();
    expect(heroWindow!.heldDamage).toMatchObject({ amount: 2, damageType: 'normal', sourceActorId: foe.id });
    expect(damaged.pendingInterrupts.every((window) => window.triggeredAt <= damaged.revision)).toBe(true);

    // An interrupt answers the most recently triggered window (LIFO); because
    // Catapult does not re-deal damage to the held target, the held damage
    // applies after its own mutations resolve.
    const interrupt = executeCommand(damaged, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally!.id] }, scriptedDice());
    expect(interrupt.state.pendingInterrupts.some((window) => window.actorId === hero.id)).toBe(false); // LIFO pop
    expect(interrupt.state.actors[hero.id].hp).toBe(38); // 40 - held 2, applied after the interrupt
    expect(interrupt.state.actors[hero.id].interruptUses['bastion:catapult']).toBe(1);
    expect(applyEvents(damaged, interrupt.events)).toEqual(interrupt.state);
  });

  it('resolves the most recently triggered window first when an actor accumulates several (LIFO)', () => {
    const { state, hero, foe, ally } = interruptEncounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 2, y: 1 } });
    const first = applyEvents(state, [damageEvent(foe.id, hero.id, 4)]);
    const second = applyEvents(first, [damageEvent(foe.id, hero.id, 4)]);
    const heroWindows = second.pendingInterrupts.filter((window) => window.actorId === hero.id);
    expect(heroWindows).toHaveLength(2);
    expect(heroWindows[1]!.triggeredAt).toBeGreaterThan(heroWindows[0]!.triggeredAt);
    expect(second.actors[hero.id].hp).toBe(40); // both blows still held

    const interrupt = executeCommand(second, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally!.id] }, scriptedDice());
    const remaining = interrupt.state.pendingInterrupts.filter((window) => window.actorId === hero.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.triggeredAt).toBe(heroWindows[0]!.triggeredAt); // the older window remains
    expect(interrupt.state.actors[hero.id].hp).toBe(38); // only the newest held 2 applied
    expect(applyEvents(second, interrupt.events)).toEqual(interrupt.state);
  });

  it('Righteous Disdain resolves before the held damage applies and re-deals it instead (p.128)', () => {
    const { state, hero, foe, ally } = interruptEncounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 2, y: 1 } });
    // 20 normal damage: determined as 18 after the hero's armor 2.
    const damaged = applyEvents(state, [damageEvent(foe.id, hero.id, 20)]);
    expect(damaged.actors[hero.id].hp).toBe(40); // held: not applied yet
    expect(damaged.pendingInterrupts.some((window) => window.actorId === hero.id && window.heldDamage?.amount === 18)).toBe(true);

    // The interrupt answers the window before the blow lands, splitting the
    // held damage: both the hero and the ally take ceil(18/2) = 9, each
    // reduced by their armor 2, and both become sturdy. The original held
    // damage is consumed — it must not apply on top of the split.
    const interrupt = executeCommand(damaged, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:righteous-disdain',
      actionId: 'default',
      timing: 'interrupt',
      input: { numbers: { damage: 18 }, actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(interrupt.state.actors[hero.id].hp).toBe(33); // 40 - (9 - 2); the held 18 did not apply on top
    expect(interrupt.state.actors[ally!.id].hp).toBe(33); // 40 - (9 - 2)
    expect(interrupt.state.actors[hero.id].conditions.some(({ id }) => id === 'sturdy')).toBe(true);
    expect(interrupt.state.actors[ally!.id].conditions.some(({ id }) => id === 'sturdy')).toBe(true);
    expect(interrupt.state.pendingInterrupts.some((window) => window.actorId === hero.id && window.heldDamage)).toBe(false); // consumed
    expect(interrupt.state.actors[hero.id].interruptUses['demon-slayer:righteous-disdain']).toBe(1);
    expect(applyEvents(damaged, interrupt.events)).toEqual(interrupt.state);
  });

  it('an interrupt for a character with no open window leaves other windows untouched', () => {
    const { state, hero, foe, ally } = interruptEncounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 2, y: 1 } });
    // The foe is damaged, so the window belongs to the foe — not the hero.
    const damaged = applyEvents(state, [damageEvent(hero.id, foe.id, 4)]);
    expect(damaged.pendingInterrupts.some((window) => window.actorId === foe.id)).toBe(true);
    const interrupt = executeCommand(damaged, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally!.id] }, scriptedDice());
    expect(interrupt.state.pendingInterrupts).toHaveLength(1);
    expect(interrupt.state.pendingInterrupts[0]?.actorId).toBe(foe.id); // untouched by the hero's interrupt
  });

  it('closes all interrupt windows at the end of the turn, resolving any held damage', () => {
    const { state, hero, foe } = interruptEncounter({ second: null });
    const damaged = applyEvents(state, [damageEvent(foe.id, hero.id, 4)]);
    expect(damaged.pendingInterrupts.length).toBeGreaterThan(0);
    const ended = executeCommand(damaged, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(ended.pendingInterrupts).toHaveLength(0);
    // No interrupt answered the window, so the held 2 resolves at the boundary.
    expect(ended.actors[hero.id].hp).toBe(38);
  });
});
