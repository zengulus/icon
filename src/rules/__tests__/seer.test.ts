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
 * Source-derived golden fixtures for the independently executable Seer ability
 * set (ICON p.197–203), the fourth Mendicant job. Wild cards are `wild-card`
 * entities; Polaris spaces and star fire are `polaris-space` / `star-fire`
 * terrain; blessings are the `blessing` resource. Each scenario must replay to
 * the identical state through applyEvents.
 */

interface SeerFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

function seerEncounter(options: {
  foe?: Position; second?: Position | null; ally?: Position | null;
} = {}): SeerFixture {
  let state = createEncounter('Seer fixture');
  const hero = actorFromCharacter(validCharacter('Fate Weaver'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 3, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 5, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe, second, ally };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Seer ability automation (p.197–203)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('seer:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const seerIds = JOBS.find((job) => job.id === 'seer')!.abilities.map(({ id }) => id);
    expect(seerIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Sleight Of Hand: auto-hits fray, pacifies the foe, frays the blast, and summons a wild card', () => {
    const { state, hero, foe, second } = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:sleight-of-hand', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - fray 4
    expect(result.state.actors[foe.id].statuses).toContain('pacified');
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (area)
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'wild-card')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Chaos Tarot: a gamble of 1 explodes the card for fray damage', () => {
    const { state, hero, foe, second } = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:chaos-tarot', targetIds: [foe.id] }, scriptedDice(1));
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - fray 4
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'wild-card')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Astra: attacks [D]+fray and gambles the meteor damage across the medium blast', () => {
    const { state, hero, foe, second } = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:astra', targetIds: [foe.id] }, scriptedDice(12, 4, 3));
    expect(result.state.actors[foe.id].hp).toBe(21); // 32 - (4 + fray 4) - gamble 3
    expect(result.state.actors[second!.id].hp).toBe(29); // 32 - gamble 3 (in the medium blast)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Astra combo (FORTUNA): auto-hits [D]+fray, frays foes, and blesses allies with 3 vigor', () => {
    const { state, hero, foe, second, ally } = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 }, ally: { x: 3, y: 3 } });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'seer:astra',
      actionId: 'combo',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(4));
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (area)
    expect(result.state.actors[ally!.id].vigor).toBe(3); // allies gain 3 vigor
    expect(result.state.actors[ally!.id].resources.blessing).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Polaris: marks a chosen space for the end-of-turn meteor gamble', () => {
    const { state, hero, foe } = seerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:polaris', targetIds: [foe.id] }, scriptedDice());
    const space = result.state.terrainEffects.filter((effect) => effect.terrain === 'polaris-space');
    expect(space).toHaveLength(1);
    expect(space[0]?.positions[0]).toEqual(foe.position);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Sisyphus: marks a character with their starting position', () => {
    const { state, hero, foe } = seerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:sisyphus', targetIds: [foe.id] }, scriptedDice());
    const mark = result.state.actors[foe.id].marks.find(({ markId }) => markId === 'sisyphus');
    expect(mark).toBeDefined();
    expect(mark?.state.x).toBe(foe.position!.x);
    expect(mark?.state.y).toBe(foe.position!.y);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Gran Reversa: enters the stance with a d4 power die at 4', () => {
    const { state, hero } = seerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:gran-reversa', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'gran-reversa' });
    expect(result.state.actors[hero.id].ruleState['gran-reversa:die']).toBe(4);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Gran Reversa talent 1: the power die starts at d6 (6 charges) instead of d4 (4)', () => {
    const { state, hero } = seerEncounter({ second: null });
    state.actors[hero.id].talents = { ...state.actors[hero.id].talents, 'seer:gran-reversa': 1 };
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:gran-reversa', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].ruleState['gran-reversa:die']).toBe(6);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Reverse Fate: ticks the die down and grants the ally double the gamble as vigor', () => {
    const { state, hero, ally } = seerEncounter({ second: null, ally: { x: 2, y: 1 } });
    const stanced = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:gran-reversa', targetIds: [] }, scriptedDice());
    const result = executeCommand(stanced.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'seer:gran-reversa',
      actionId: 'reverse-fate',
      timing: 'interrupt',
      input: { actorIds: { target: [ally!.id] }, numbers: { ticks: 2 } },
    }, scriptedDice(3, 5));
    expect(result.state.actors[hero.id].ruleState['gran-reversa:die']).toBe(2); // 4 - 2 ticks
    expect(result.state.actors[ally!.id].vigor).toBe(10); // 2 × (3 + 5) = 16, capped at vitality
    expect(applyEvents(stanced.state, result.events)).toEqual(result.state);
  });

  it('Eclipse: ends the turn, burns star fire in range, and delays the next turn', () => {
    const { state, hero, foe } = seerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:eclipse', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'star-fire' && effect.positions[0]?.x === foe.position!.x)).toBe(true);
    expect(result.state.actors[hero.id].ruleState['eclipse:pending']).toBeDefined();
    expect(result.state.activeActorId).toBe(foe.id); // the turn ended
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Wish: sacrifices 25% max HP, cures the ally, and shields them from the blow', () => {
    const { state, hero, ally } = seerEncounter({ second: null, ally: { x: 2, y: 1 } });
    state.actors[ally!.id].hp = 1; // the triggering blow already landed
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'seer:wish',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(result.state.actors[hero.id].hp).toBe(30); // 40 - 25%
    expect(result.state.actors[ally!.id].vigor).toBe(10); // cured while bloodied
    expect(result.state.actors[ally!.id].ruleState['wish:shield']).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('The Tower: autohits 1 damage, seals the foe, and marks them for the meteor', () => {
    const { state, hero, foe } = seerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:the-tower', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(31); // 32 - 1
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'the-tower')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
