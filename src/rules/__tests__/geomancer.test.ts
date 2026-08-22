import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Geomancer
 * ability set (ICON p.215–221), the second Wright job. Boulders and statues
 * are `boulder` / `statue` entities; pits and difficult terrain are `pit` /
 * `difficult` terrain. Each scenario must replay to the identical state
 * through applyEvents.
 */

interface GeomancerFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
}

function geomancerEncounter(options: {
  foe?: Position; second?: Position | null;
} = {}): GeomancerFixture {
  let state = createEncounter('Geomancer fixture');
  const hero = actorFromCharacter(validCharacter('Earth Shaper'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 3, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 5, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe, second };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Geomancer ability automation (p.215–221)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('geomancer:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const geomancerIds = JOBS.find((job) => job.id === 'geomancer')!.abilities.map(({ id }) => id);
    expect(geomancerIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Bio: shatters the target, [D]+fray on hit, and frays the small blast', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:bio', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (area)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Bio infuse (BIOTIC): spends 3 aether, widens the blast, and shatters everyone inside', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    state.actors[hero.id].resources.aether = 3;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:bio',
      actionId: 'infuse',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(12, 4));
    expect(result.state.actors[hero.id].resources.aether).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[second!.id].hp).toBe(28);
    expect(result.state.actors[second!.id].statuses).toContain('shattered');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Dragon Dive: ends the turn and delays the dive toward the chosen character', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:dragon-dive', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].ruleState['dragon-dive:target']).toBe(foe.id);
    expect(result.state.activeActorId).toBe(foe.id); // the turn ended
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Geo: 2[D]+fray on hit, frays the blast, creates a boulder, and a Charge explodes the target', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:geo',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
      triggers: ['charge'],
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - (4 + 5 + fray 4) - 2 piercing (charge blast)
    expect(result.state.actors[second!.id].hp).toBe(26); // 32 - fray 4 (area) - 2 piercing (charge blast)
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'boulder')).toBe(true);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Helix Heel: shocks the line for 2 piercing and a Charge shatters damaged foes', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 1 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:helix-heel',
      actionId: 'default',
      timing: 'use',
      input: { directions: { line: { x: 1, y: 0 } } },
      triggers: ['charge'],
    }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    expect(result.state.actors[second!.id].hp).toBe(30); // 32 - 2 piercing
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Terraforming: a Charge creates two boulders and two pits in the burst 2 area', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:terraforming',
      actionId: 'default',
      timing: 'use',
      input: { actorIds: { target: [foe.id] }, options: { effects: 'boulders,pits' } },
      triggers: ['charge'],
    }, scriptedDice());
    expect(Object.values(result.state.entities).filter((entity) => entity.type === 'boulder')).toHaveLength(2);
    expect(result.state.terrainEffects.filter((effect) => effect.terrain === 'pit')).toHaveLength(2);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Obsidian Flesh: enters the stance with a d6 power die at 1', () => {
    const { state, hero } = geomancerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:obsidian-flesh', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'obsidian-flesh' });
    expect(result.state.actors[hero.id].ruleState['obsidian-flesh:die']).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Realignment: ends the statuses and damages the burst once per purged effect', () => {
    const { state, hero, foe, second } = geomancerEncounter({ foe: { x: 2, y: 1 }, second: { x: 2, y: 0 } });
    state.actors[foe.id].statuses = ['sealed', 'vulnerable'];
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:realignment', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).not.toContain('sealed');
    expect(result.state.actors[foe.id].statuses).not.toContain('vulnerable');
    expect(result.state.actors[second!.id].hp).toBe(24); // 32 - 2 purged × fray 4 piercing
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Midas: replaces the targeted character with a height 1 statue', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'geomancer:midas',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice());
    expect(result.state.actors[foe.id].onBattlefield).toBe(false);
    const statue = Object.values(result.state.entities).find((entity) => entity.type === 'statue');
    expect(statue).toBeDefined();
    expect(statue?.state.held).toBe(foe.id);
    expect(result.state.actors[hero.id].ruleState['midas:used']).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Quaking Palm: [D]+1 on hit, makes the foe vulnerable, and sets up vibrations', () => {
    const { state, hero, foe } = geomancerEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'geomancer:quaking-palm', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(27); // 32 - (4 + 1)
    expect(result.state.actors[foe.id].statuses).toContain('vulnerable');
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'quaking-palm')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
