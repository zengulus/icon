import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Freelancer
 * ability set (ICON p.153–158), the second Vagabond job. Each scenario resolves
 * through the shared encounter reducer and must replay to the identical state
 * through applyEvents. Cross-command lifecycles (Exorcism's power die, Astral
 * Chain's lightning, Showdown's delayed shot, Warding Bolts' hover zone, and
 * Ace's armed next attack) resolve through the TURN_ENDED/turn-start hooks and
 * the next-attack consumption in the reducer.
 */

interface FreelancerFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
}

function freelancerEncounter(options: { foe?: Position; second?: Position | null } = {}): FreelancerFixture {
  let state = createEncounter('Freelancer fixture');
  const hero = actorFromCharacter(validCharacter('Deadeye'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 3, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 5, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Freelancer ability automation (p.153–158)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('freelancer:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const freelancerIds = JOBS.find((job) => job.id === 'freelancer')!.abilities.map(({ id }) => id);
    expect(freelancerIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Strafe Shot: dashes 1, attacks with a boon, blinds, and dashes again', () => {
    const { state, hero, foe } = freelancerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:strafe-shot', targetIds: [foe.id] }, scriptedDice(15, 4, 4));
    expect(mutationsOf(result.events, 'freelancer:strafe-shot')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 15, boon: 4, total: 19, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
      { kind: 'condition', actorId: foe.id, conditionId: 'blind' },
      { kind: 'move', actorId: hero.id, movement: 'rush' },
    ]);
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[foe.id].statuses).toContain('blind');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Strafe Shot: a Finishing Blow flurries for 2 unerring against foes at exactly range 3', () => {
    const fixture = freelancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 1 } });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const result = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'freelancer:strafe-shot', targetIds: [fixture.foe.id] }, scriptedDice(15, 4, 4));
    expect(result.state.actors[fixture.foe.id].hp).toBe(2); // 10 - 8
    expect(result.state.actors[fixture.second!.id].hp).toBe(30); // 32 - 2 flurry
  });

  it('Exorcism: marks a foe, and ending the turn in range shoots a 2-damage projectile', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 4, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:exorcism', targetIds: [foe.id] }, scriptedDice()).state;
    const mark = marked.actors[foe.id].marks.find(({ markId }) => markId === 'exorcism');
    expect(mark).toMatchObject({ ownerId: hero.id, state: { die: 0, charges: 0 } });

    const ended = endTurnTo(marked, foe.id, scriptedDice());
    const ticked = ended.actors[foe.id].marks.find(({ markId }) => markId === 'exorcism');
    expect(ticked?.state).toEqual({ die: 1, charges: 1 });
    expect(ended.actors[foe.id].hp).toBe(30); // 32 - 2
  });

  it('Exorcism: the die reaches maximum, releasing every projectile and ending the mark', () => {
    const fixture = freelancerEncounter({ foe: { x: 4, y: 1 }, second: null });
    fixture.state.actors[fixture.foe.id].marks = [{
      id: 'mark', sourceId: 'freelancer:exorcism', ownerId: fixture.hero.id, markId: 'exorcism', duration: null,
      state: { die: 3, charges: 3 },
    }];
    const ended = endTurnTo(fixture.state, fixture.foe.id, scriptedDice());
    expect(ended.actors[fixture.foe.id].hp).toBe(22); // 32 - 2 (4th shot) - 8 (volley)
    expect(ended.actors[fixture.foe.id].marks.some(({ markId }) => markId === 'exorcism')).toBe(false);
  });

  it('Trick Shot: arms the next attack, and an asserted Finishing Blow grants stealth', () => {
    const { state, hero } = freelancerEncounter({ second: null });
    const armed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:trick-shot', targetIds: [] }, scriptedDice()).state;
    expect(armed.actors[hero.id].ruleState['trick-shot:armed']).toBe(true);
    expect(armed.actors[hero.id].conditions.some(({ id }) => id === 'stealth')).toBe(false);

    const finishing = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'freelancer:trick-shot',
      actionId: 'default',
      timing: 'use',
      input: {},
      triggers: ['finishing-blow'],
    }, scriptedDice()).state;
    expect(finishing.actors[hero.id].conditions.some(({ id }) => id === 'stealth')).toBe(true);
  });

  it('Trick Shot: the armed next ranged ability gains +1 boon and is consumed on the attack', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 3, y: 1 }, second: null });
    const armed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:trick-shot', targetIds: [] }, scriptedDice()).state;
    // Strafe Shot normally rolls with +1 boon; the armed flag adds one more, so
    // the attack mutation reports boon +2 (the boon die rolls are scripted).
    const shot = executeCommand(armed, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:strafe-shot', targetIds: [foe.id] }, scriptedDice(10, 6, 6, 4));
    const attack = mutationsOf(shot.events, 'freelancer:strafe-shot').find((mutation) => mutation.kind === 'attack');
    expect(attack).toMatchObject({ d20: 10, boon: 6, total: 16, hit: true });
    expect(shot.state.actors[hero.id].ruleState['trick-shot:armed']).toBeUndefined(); // consumed
    expect(shot.state.actors[foe.id].hp).toBe(24); // 32 - (4 die + 4 fray)
    expect(applyEvents(armed, shot.events)).toEqual(shot.state);
  });

  it('Astral Chain: attacks for 2[D]+fray, marks, and bolts the foe at the start of your next turn', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 3, y: 1 }, second: null });
    const chained = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:astral-chain', targetIds: [foe.id] }, scriptedDice(15, 4, 4)).state;
    expect(chained.actors[foe.id].hp).toBe(20); // 32 - (4 + 4 + 4)
    expect(chained.actors[foe.id].marks.some(({ markId, ownerId }) => markId === 'astral-chain' && ownerId === hero.id)).toBe(true);

    const foeTurn = endTurnTo(chained, foe.id, scriptedDice());
    const backToHero = endTurnTo(foeTurn, hero.id, scriptedDice());
    expect(backToHero.actors[foe.id].hp).toBe(18); // 20 - 2 lightning (range 2)
  });

  it('Astral Chain: doubles the lightning to 4 at exactly range 3', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 4, y: 1 }, second: null });
    const chained = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:astral-chain', targetIds: [foe.id] }, scriptedDice(15, 4, 4)).state;
    const foeTurn = endTurnTo(chained, foe.id, scriptedDice());
    const backToHero = endTurnTo(foeTurn, hero.id, scriptedDice());
    expect(backToHero.actors[foe.id].hp).toBe(16); // 20 - 4 lightning (range 3)
  });

  it('Deus Ex Machina: marks a character, and Divine Intervention teleports them 1 closer', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 4, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:deus-ex-machina', targetIds: [foe.id] }, scriptedDice()).state;
    expect(marked.actors[foe.id].marks.some(({ markId, ownerId }) => markId === 'deus-ex-machina' && ownerId === hero.id)).toBe(true);

    const intervened = executeCommand(marked, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'freelancer:deus-ex-machina',
      actionId: 'intervention',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice()).state;
    expect(intervened.actors[foe.id].position).toEqual({ x: 3, y: 1 });
  });

  it('Ace: enters the stance, dashes 1, and ends the turn', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 3, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:ace', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'ace' });
    expect(result.state.actors[hero.id].ruleState['ace:armed']).toBe(true);
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Ace: the armed next attack triggers exceed effects, dazes the foe, and consumes the flag', () => {
    const { state, hero, foe, second } = freelancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 1 } });
    state.actors[hero.id].ruleState['ace:armed'] = true;
    state.actors[hero.id].ruleStateOwners['ace:armed'] = hero.id;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:strafe-shot', targetIds: [foe.id] }, scriptedDice(15, 4, 4));
    expect(result.state.actors[foe.id].statuses).toContain('dazed');
    expect(result.state.actors[second!.id].hp).toBe(30); // 32 - 2 exceed flurry
    expect(result.state.actors[hero.id].ruleState['ace:armed']).toBeUndefined();
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Showdown: a fleeing foe takes 2 unerring damage twice when their turn ends at range 4+', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 4, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:showdown', targetIds: [foe.id] }, scriptedDice()).state;
    expect(marked.actors[hero.id].conditions.some(({ id }) => id === 'immobile')).toBe(true);
    expect(marked.actors[foe.id].marks.some(({ markId }) => markId === 'showdown')).toBe(true);

    const foeTurn = endTurnTo(marked, foe.id, scriptedDice());
    foeTurn.actors[foe.id].position = { x: 6, y: 1 };
    const resolved = endTurnTo(foeTurn, hero.id, scriptedDice());
    expect(resolved.actors[foe.id].hp).toBe(28); // 32 - 4
    expect(resolved.actors[foe.id].marks.some(({ markId }) => markId === 'showdown')).toBe(false);
    expect(resolved.actors[hero.id].conditions.some(({ id }) => id === 'immobile')).toBe(false);
  });

  it('Showdown: a Finishing Blow deals 2 damage four times instead', () => {
    const fixture = freelancerEncounter({ foe: { x: 4, y: 1 }, second: null });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const marked = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'freelancer:showdown', targetIds: [fixture.foe.id] }, scriptedDice()).state;
    expect(marked.actors[fixture.foe.id].marks.find(({ markId }) => markId === 'showdown')?.state).toEqual({ finishing: true });

    const foeTurn = endTurnTo(marked, fixture.foe.id, scriptedDice());
    foeTurn.actors[fixture.foe.id].position = { x: 6, y: 1 };
    const resolved = endTurnTo(foeTurn, fixture.hero.id, scriptedDice());
    expect(resolved.actors[fixture.foe.id].hp).toBe(2); // 10 - 8
  });

  it('Warding Bolts: a foe that starts inside and ends outside the zone is struck and dazed', () => {
    const { state, hero, foe } = freelancerEncounter({ foe: { x: 2, y: 1 }, second: null });
    const placed = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'freelancer:warding-bolts',
      actionId: 'default',
      timing: 'interrupt',
      input: { positions: { 'area-center': [{ x: 2, y: 1 }] } },
    }, scriptedDice()).state;
    expect(placed.terrainEffects.some((effect) => effect.terrain === 'warding-bolts')).toBe(true);

    const foeStarts = endTurnTo(placed, foe.id, scriptedDice());
    expect(foeStarts.actors[foe.id].ruleState['warding-bolts:owner']).toBe(hero.id);

    foeStarts.actors[foe.id].position = { x: 6, y: 1 };
    const resolved = endTurnTo(foeStarts, hero.id, scriptedDice());
    expect(resolved.actors[foe.id].hp).toBe(30); // 32 - 2 unerring
    expect(resolved.actors[foe.id].statuses).toContain('dazed');
    expect(resolved.actors[foe.id].ruleState['warding-bolts:owner']).toBeUndefined();
  });

  it('Soul Shot: a line attack that blinds the target and splashes fray along the line', () => {
    const { state, hero, foe, second } = freelancerEncounter({ foe: { x: 4, y: 1 }, second: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'freelancer:soul-shot', targetIds: [foe.id] }, scriptedDice(15, 4, 4));
    expect(mutationsOf(result.events, 'freelancer:soul-shot')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 15, boon: 4, total: 19, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8, delivery: 'hit' },
      { kind: 'condition', actorId: foe.id, conditionId: 'blind' },
      { kind: 'damage', actorId: second!.id, amount: 4, delivery: 'area' },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[foe.id].statuses).toContain('blind');
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - 4 splash fray
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
