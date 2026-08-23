import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Fool ability
 * set (ICON p.150–152), the first Vagabond job. Each scenario resolves through
 * the shared encounter reducer and must replay to the identical state through
 * applyEvents. Sub-actions (Party Favor detonation, Gallows Humor empowerment,
 * Cheat Time) are exercised through EXECUTE_RULE with the matching action id,
 * and the Carnevale turn-end detonation resolves through the TURN_ENDED hook.
 */

interface FoolFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor;
  ally: EncounterActor | null;
}

function foolEncounter(options: { foe?: Position; second?: Position | null; ally?: Position | null } = {}): FoolFixture {
  let state = createEncounter('Fool fixture');
  const hero = actorFromCharacter(validCharacter('Harlequin'), { x: 1, y: 1 });
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
  return { state, hero, foe, second: second!, ally };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Fool ability automation (p.150–152)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('fool:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const foolIds = JOBS.find((job) => job.id === 'fool')!.abilities.map(({ id }) => id);
    expect(foolIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Cavaliere: dashes 3 with phasing, steps to the side, dazes the target, and attacks', () => {
    const { state, hero, foe } = foolEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:cavaliere', targetIds: [foe.id] }, scriptedDice(12, 4, 4));
    expect(mutationsOf(result.events, 'fool:cavaliere')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'move', actorId: hero.id, movement: 'rush' },
      { kind: 'condition', actorId: foe.id, conditionId: 'dazed' },
      { kind: 'attack', d20: 12, boon: 4, total: 16, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 2 });
    expect(result.state.actors[foe.id].statuses).toContain('dazed');
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Cavaliere: a Finishing Blow against a bloodied foe summons a bomb', () => {
    const fixture = foolEncounter({ second: null });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const result = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'fool:cavaliere', targetIds: [fixture.foe.id] }, scriptedDice(12, 4, 4));
    const bombs = Object.values(result.state.entities).filter((entity) => entity.type === 'bomb' && entity.ownerId === fixture.hero.id);
    expect(bombs).toHaveLength(1);
  });

  it('Carnevale: summons two bombs in range 2, then detonates them on a non-attacking turn end', () => {
    const { state, hero, foe } = foolEncounter({ foe: { x: 1, y: 2 }, second: null });
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:carnevale', targetIds: [] }, scriptedDice());
    const bombs = Object.values(placed.state.entities).filter((entity) => entity.type === 'bomb' && entity.ownerId === hero.id);
    expect(bombs).toHaveLength(2);
    expect(placed.state.actors[hero.id].ruleState['carnevale:armed']).toBe(true);

    const detonated = executeCommand(placed.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice(5));
    expect(Object.values(detonated.state.entities).filter((entity) => entity.type === 'bomb')).toHaveLength(0);
    expect(detonated.state.actors[hero.id].hp).toBe(37); // 40 - (5 - armor 2)
    expect(detonated.state.actors[foe.id].hp).toBe(27); // 32 - 5
    expect(detonated.state.actors[hero.id].ruleState['carnevale:armed']).toBe(false);
    expect(applyEvents(placed.state, detonated.events)).toEqual(detonated.state);
  });

  it('Spinning Top: gambles, dashes the rolled distance +2, and grants evasion at full distance', () => {
    const { state, hero } = foolEncounter({ foe: { x: 9, y: 9 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:spinning-top', targetIds: [] }, scriptedDice(4));
    expect(result.state.actors[hero.id].position).toEqual({ x: 7, y: 1 });
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'evasion')).toBe(true);
  });

  it('Death: gambles the attack space and autohits for 2[D]+fray along the line', () => {
    const { state, hero, foe } = foolEncounter({ foe: { x: 3, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:death', targetIds: [foe.id] }, scriptedDice(2, 4, 4));
    expect(mutationsOf(result.events, 'fool:death')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', autoHit: true, hit: true, d20: null },
      { kind: 'damage', actorId: foe.id, amount: 12 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(20);
  });

  it('Death: a target at 8 hp or less takes 999 divine damage instead', () => {
    const fixture = foolEncounter({ foe: { x: 3, y: 1 }, second: null });
    fixture.state.actors[fixture.foe.id].hp = 8;
    const result = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'fool:death', targetIds: [fixture.foe.id] }, scriptedDice(2));
    expect(mutationsOf(result.events, 'fool:death').some((mutation) => mutation.kind === 'damage' && mutation.actorId === fixture.foe.id && mutation.amount === 999 && mutation.damageType === 'divine')).toBe(true);
    expect(result.state.actors[fixture.foe.id].defeated).toBe(true);
  });

  it('Gallows Humor: enters the stance and its power die ticks up on a miss', () => {
    const { state, hero, foe } = foolEncounter({ second: null });
    const entered = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:gallows-humor', targetIds: [] }, scriptedDice()).state;
    expect(entered.actors[hero.id].stance).toMatchObject({ stanceId: 'gallows-humor' });
    expect(entered.actors[hero.id].ruleState['gallows-humor:die']).toBe(1);

    const missed = executeCommand(entered, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(1)).state;
    expect(missed.actors[hero.id].ruleState['gallows-humor:die']).toBe(2);
  });

  it('Gallows Humor: empowers at maximum, resetting the die and granting bonus damage', () => {
    const { state, hero } = foolEncounter({ second: null });
    state.actors[hero.id].stance = { id: 'stance', sourceId: 'fool:gallows-humor', ownerId: hero.id, stanceId: 'gallows-humor', state: {} };
    state.actors[hero.id].ruleState['gallows-humor:die'] = 6;
    const result = executeCommand(state, { type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'fool:gallows-humor', actionId: 'empower', timing: 'use', input: {} }, scriptedDice());
    expect(result.state.actors[hero.id].ruleState['gallows-humor:die']).toBe(1);
    expect(result.state.actors[hero.id].resources['bonus-damage']).toBe(1);
  });

  it('Party Favor: places a mine, and detonating it deals 2 damage and flies allies away', () => {
    const { state, hero, foe } = foolEncounter({ foe: { x: 1, y: 2 }, second: null });
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:party-favor', targetIds: [] }, scriptedDice()).state;
    expect(placed.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(true);

    const detonated = executeCommand(placed, { type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'fool:party-favor', actionId: 'detonate', timing: 'movement-end', input: {} }, scriptedDice(3));
    expect(detonated.state.actors[foe.id].hp).toBe(30); // 32 - 2
    expect(detonated.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    expect(detonated.state.terrainEffects.some((effect) => effect.terrain === 'party-favor')).toBe(false);
  });

  it('Party Favor: a Finishing Blow doubles foe damage and a 4+ gamble blinds them', () => {
    const { state, hero, foe } = foolEncounter({ foe: { x: 1, y: 2 }, second: null });
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:party-favor', targetIds: [] }, scriptedDice()).state;
    const detonated = executeCommand(placed, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:party-favor',
      actionId: 'detonate',
      timing: 'movement-end',
      input: {},
      triggers: ['finishing-blow'],
    }, scriptedDice(4));
    expect(detonated.state.actors[foe.id].hp).toBe(26); // 32 - 2*3
    expect(detonated.state.actors[foe.id].statuses).toContain('blind');
  });

  it('Masquerade: swaps places with a willing ally in range 3', () => {
    const { state, hero, ally } = foolEncounter({ ally: { x: 4, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:masquerade', targetIds: [ally!.id] }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 });
    expect(result.state.actors[ally!.id].position).toEqual({ x: 1, y: 1 });
  });

  it('Masquerade: holds an ability targeting the user and redirects it to the swap partner (p.151)', () => {
    const { state, hero, foe, ally } = foolEncounter({ foe: { x: 5, y: 1 }, ally: { x: 3, y: 1 }, second: null });
    // Without Righteous Disdain the damage pipeline cannot hold the blow, so
    // the targeted-by-ability window opens instead (a Fool's Masquerade).
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    // A foe ability damages the hero: held until the interrupt resolves.
    const deferred = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-ability',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [
        { kind: 'actions', sourceId: 'fixture:foe-ability', actorId: foe.id, operation: 'spend', amount: 1 },
        { kind: 'damage', sourceId: 'fixture:foe-ability', sourceActorId: foe.id, actorId: hero.id, amount: 10, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false },
      ],
    }]);
    expect(deferred.actors[hero.id].hp).toBe(40); // held, not applied
    const window = deferred.pendingInterrupts.find((candidate) => candidate.actorId === hero.id && candidate.trigger === 'targeted-by-ability');
    expect(window).toBeDefined();
    expect(window!.retarget).toEqual({ fromActorId: hero.id, toActorId: ally!.id });

    // Masquerade resolves first: the hero and ally swap places, then the held
    // ability resolves retargeted — the ally takes the blow instead.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:masquerade',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(interrupt.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(interrupt.state.actors[ally!.id].position).toEqual({ x: 1, y: 1 });
    expect(interrupt.state.actors[hero.id].hp).toBe(40); // the blow redirected
    expect(interrupt.state.actors[ally!.id].hp).toBe(32); // 40 - (10 normal - armor 2)
    expect(interrupt.state.actors[hero.id].interruptUses['fool:masquerade']).toBe(1);
    expect(interrupt.state.pendingInterrupts.some((candidate) => candidate.actorId === hero.id && candidate.trigger === 'targeted-by-ability')).toBe(false);
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Masquerade: an armor-mitigated blow is not preempted by a hypothetical defeated window', () => {
    const { state, hero, foe, ally } = foolEncounter({ foe: { x: 5, y: 1 }, ally: { x: 3, y: 1 }, second: null });
    // Boiling Blood is available but Righteous Disdain is not, so only a
    // defeated window could hold the blow — and it must not open: the raw 30
    // is lethal against 25 HP, but armor 12 leaves a determined 18 that
    // cannot defeat. Judging the priority from the raw amount would suppress
    // Masquerade for that hypothetical window, leaving neither interrupt.
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    state.actors[hero.id].hp = 25;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].armor = 12;
    const deferred = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-ability',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [
        { kind: 'actions', sourceId: 'fixture:foe-ability', actorId: foe.id, operation: 'spend', amount: 1 },
        { kind: 'damage', sourceId: 'fixture:foe-ability', sourceActorId: foe.id, actorId: hero.id, amount: 30, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false },
      ],
    }]);
    expect(deferred.actors[hero.id].hp).toBe(25); // held by Masquerade, not applied
    const window = deferred.pendingInterrupts.find((candidate) => candidate.actorId === hero.id && candidate.trigger === 'targeted-by-ability');
    expect(window).toBeDefined();
    expect(window!.retarget).toEqual({ fromActorId: hero.id, toActorId: ally!.id });
    expect(deferred.pendingInterrupts.some((candidate) => candidate.actorId === hero.id && candidate.trigger === 'defeated')).toBe(false);

    // The redirected mutation re-enters the determination pipeline against the
    // ally's own armor: 30 - 2 = 28.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:masquerade',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(interrupt.state.actors[ally!.id].hp).toBe(12); // 40 - (30 - 2)
    expect(interrupt.state.actors[hero.id].hp).toBe(25);
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Masquerade: Defiance-protected lethal damage opens Masquerade instead of a defeated window', () => {
    const { state, hero, foe, ally } = foolEncounter({ foe: { x: 5, y: 1 }, ally: { x: 3, y: 1 }, second: null });
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    state.actors[hero.id].hp = 25;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].armor = 2;
    state.actors[hero.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });

    // The determined 28 is lethal, but Defiance's application floor means the
    // blow lands at 1 HP — never a defeat, so no defeated window will open
    // and Masquerade must win the redirect instead of being suppressed.
    const deferred = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-ability',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [
        { kind: 'actions', sourceId: 'fixture:foe-ability', actorId: foe.id, operation: 'spend', amount: 1 },
        { kind: 'damage', sourceId: 'fixture:foe-ability', sourceActorId: foe.id, actorId: hero.id, amount: 30, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false },
      ],
    }]);
    expect(deferred.actors[hero.id].hp).toBe(25); // held, not applied
    const window = deferred.pendingInterrupts.find((candidate) => candidate.actorId === hero.id && candidate.trigger === 'targeted-by-ability');
    expect(window).toBeDefined();
    expect(deferred.pendingInterrupts.some((candidate) => candidate.actorId === hero.id && candidate.trigger === 'defeated')).toBe(false);

    // The redirected mutation re-enters the determination pipeline against the
    // ally's own armor: 30 - 2 = 28. The hero's defiance is untouched because
    // the blow was redirected.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:masquerade',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(interrupt.state.actors[ally!.id].hp).toBe(12); // 40 - (30 - 2)
    expect(interrupt.state.actors[hero.id].hp).toBe(25);
    expect(interrupt.state.actors[hero.id].conditions.some(({ id }) => id === 'defiance')).toBe(true);
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Masquerade: a genuinely lethal blow still prefers the defeated window (p.107)', () => {
    const { state, hero, foe, ally } = foolEncounter({ foe: { x: 5, y: 1 }, ally: { x: 3, y: 1 }, second: null });
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    state.actors[hero.id].hp = 25;
    state.actors[hero.id].vigor = 0;
    state.actors[hero.id].armor = 2;

    // Determined 28 >= 25 with no Defiance/Defy Death protection: an actual
    // defeat, so the defeated window holds the blow and Masquerade must not
    // hijack the redirect.
    const deferred = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-ability',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [
        { kind: 'actions', sourceId: 'fixture:foe-ability', actorId: foe.id, operation: 'spend', amount: 1 },
        { kind: 'damage', sourceId: 'fixture:foe-ability', sourceActorId: foe.id, actorId: hero.id, amount: 30, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false },
      ],
    }]);
    const defeated = deferred.pendingInterrupts.find((candidate) => candidate.actorId === hero.id && candidate.trigger === 'defeated');
    expect(defeated).toBeDefined();
    expect(defeated!.heldDamage).toMatchObject({ amount: 28, sourceActorId: foe.id });
    expect(deferred.pendingInterrupts.some((candidate) => candidate.actorId === hero.id && candidate.trigger === 'targeted-by-ability')).toBe(false);
    expect(deferred.actors[hero.id].hp).toBe(25); // held, not applied
  });

  it('Diablo: a +1-boon unerring cross attack that blinds and deals area damage per end-space character', () => {
    const { state, hero, foe } = foolEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:diablo', targetIds: [foe.id] }, scriptedDice(12, 4, 4));
    expect(mutationsOf(result.events, 'fool:diablo')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 12, boon: 4, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 4 },
      { kind: 'condition', actorId: foe.id, conditionId: 'blind' },
      { kind: 'damage', actorId: foe.id, amount: 2 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(26); // 32 - 4 - 2
    expect(result.state.actors[foe.id].statuses).toContain('blind');
  });

  it('Chronotemper: marks an ally in range 2, and only the marked character can use Cheat Time', () => {
    const { state, hero, ally, foe } = foolEncounter({ foe: { x: 5, y: 1 }, ally: { x: 2, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'fool:chronotemper', targetIds: [ally!.id] }, scriptedDice()).state;
    expect(marked.actors[ally!.id].marks.some(({ markId, ownerId }) => markId === 'cheat-time' && ownerId === hero.id)).toBe(true);

    // Cheat Time is granted by the mark: the unmarked hero cannot execute it.
    expect(() => executeCommand(marked, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:chronotemper',
      actionId: 'cheat-time',
      timing: 'interrupt',
      input: {},
    }, scriptedDice(2))).toThrow(/marked by Chronotemper/);

    // The marked ally can — the mark grants the interrupt regardless of the
    // generic ability-ownership gate — dashing and damaging adjacent foes.
    const cheat = foolEncounter({ foe: { x: 4, y: 1 }, ally: { x: 2, y: 1 }, second: null });
    const cheated = executeCommand(cheat.state, { type: 'USE_ABILITY', actorId: cheat.hero.id, abilityId: 'fool:chronotemper', targetIds: [cheat.ally!.id] }, scriptedDice()).state;
    const dashed = executeCommand(cheated, {
      type: 'EXECUTE_RULE',
      actorId: cheat.ally!.id,
      sourceId: 'fool:chronotemper',
      actionId: 'cheat-time',
      timing: 'interrupt',
      input: {},
    }, scriptedDice(2));
    expect(dashed.state.actors[cheat.ally!.id].position).toEqual({ x: 3, y: 1 }); // dashed 1, blocked by the foe at 4
    expect(dashed.state.actors[cheat.foe.id].hp).toBe(30); // 32 - 2
    expect(applyEvents(cheated, dashed.events)).toEqual(dashed.state);
  });
});
