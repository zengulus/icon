import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS, EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Stormbender
 * ability set (ICON p.230–236), the fourth Wright job. Salt sprites, geysers,
 * and waterspouts are `salt-sprite` / `geyser` / `waterspout` entities and
 * terrain; pits are `pit` terrain. Each scenario must replay to the identical
 * state through applyEvents.
 */

interface StormbenderFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
}

function stormbenderEncounter(options: {
  foe?: Position; second?: Position | null;
} = {}): StormbenderFixture {
  let state = createEncounter('Stormbender fixture');
  const hero = actorFromCharacter(validCharacter('Elemental Savant'), { x: 1, y: 1 });
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

describe('Stormbender ability automation (p.230–236)', () => {
  it('marks the eight executable abilities in the catalog and audit (Eye Of The Storm retracted)', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('stormbender:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const stormbenderIds = JOBS.find((job) => job.id === 'stormbender')!.abilities.map(({ id }) => id);
    // Eye Of The Storm (p.236) is retracted: its ally-center fly-4 is a free
    // player-chosen flight (corrective underlay pass 2026-08-30).
    expect(stormbenderIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(8);
    expect(stormbenderIds.filter((id) => DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS.has(id))).toEqual(['stormbender:eye-of-the-storm']);
  });

  it('Rime: 2[D]+fray in a line 6, shoves the line to the sides, shoves the target, and summons a salt sprite', () => {
    const { state, hero, foe, second } = stormbenderEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:rime', targetIds: [foe.id] }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - (4 + 5 + fray 4)
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 }); // shoved 1 toward the user
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (line)
    expect(result.state.actors[second!.id].position).not.toEqual({ x: 4, y: 1 }); // shoved to a side
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'salt-sprite')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Tsunami: creates a medium blast swell of difficult, dangerous water', () => {
    const { state, hero } = stormbenderEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:tsunami', targetIds: [] }, scriptedDice());
    const swell = result.state.terrainEffects.filter((effect) => effect.terrain === 'tsunami');
    expect(swell).toHaveLength(1);
    expect(swell[0]?.positions.length).toBeGreaterThanOrEqual(9); // a medium blast
    expect(result.state.actors[hero.id].ruleState['stormbender:tsunami:origin']).toBeDefined();
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Cryo: shatters the foe, shoves them 1 toward you, autohits 1, and gains 1 aether', () => {
    const { state, hero, foe, second } = stormbenderEncounter({ foe: { x: 3, y: 1 }, second: { x: 4, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:cryo', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(31); // 32 - 1
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 }); // shoved 1 toward the user
    expect(result.state.actors[second!.id].hp).toBe(31); // 32 - 1 (line)
    expect(result.state.actors[hero.id].resources.aether).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Geyser: summons a height 1 geyser object in range 4', () => {
    const { state, hero } = stormbenderEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:geyser', targetIds: [] }, scriptedDice());
    const geysers = Object.values(result.state.entities).filter((entity) => entity.type === 'geyser');
    expect(geysers).toHaveLength(1);
    expect(geysers[0]?.state.height).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Gust: creates a line 3 terrain effect', () => {
    const { state, hero } = stormbenderEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:gust', targetIds: [] }, scriptedDice());
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'gust')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Heave-Ho: crashes a wave in a medium blast, shoving characters and making foes vulnerable', () => {
    const { state, hero, foe } = stormbenderEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'stormbender:heave-ho',
      actionId: 'default',
      timing: 'interrupt',
      input: {},
    }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).toContain('vulnerable');
    expect(result.state.actors[foe.id].position).not.toEqual({ x: 3, y: 1 }); // shoved 1 away
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Deepwrath: marks a character in range 6', () => {
    const { state, hero, foe } = stormbenderEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:deepwrath', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'deepwrath')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Waterspout: summons a waterspout that is difficult terrain', () => {
    const { state, hero } = stormbenderEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:waterspout', targetIds: [] }, scriptedDice());
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'waterspout')).toBe(true);
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'difficult')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rime under reversed actor insertion order is byte-identical: the migrated live slots resolve by recorded identity, never object order', () => {
    // Rebuild the canonical Rime fixture with the second foe ADDED BEFORE the
    // target, so the actors map iteration order differs from every other
    // fixture in this file. The migrated source/attack-target reads must
    // resolve by recorded slot identity (context.actorId / attackTargetId),
    // never object iteration order — the outcome and the replay reproduce the
    // canonical result exactly.
    let setup = createEncounter('Stormbender insertion-order fixture');
    const hero = actorFromCharacter(validCharacter('Elemental Savant'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const second = createFoe('Grim', { x: 4, y: 1 });
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: hero }).state;
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: second }).state; // second BEFORE target
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: foe }).state;
    setup = startEncounterTo(setup, hero.id);
    const result = executeCommand(setup, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:rime', targetIds: [foe.id] }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - (4 + 5 + fray 4)
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 }); // shoved 1 toward the user
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (line)
    expect(result.state.actors[second!.id].position).not.toEqual({ x: 4, y: 1 }); // shoved to a side
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'salt-sprite')).toBe(true);
    expect(applyEvents(setup, result.events)).toEqual(result.state); // replay byte-identical
  });

  it('Eye Of The Storm: retracted — the ally-center fly-4 is a free player-chosen flight (p.236)', () => {
    // ICON p.236: "If an ally is in the center space, they may fly 4 after
    // the ability resolves." The flight direction is a player choice the
    // source never names; the old "away from the nearest foe" resolution
    // invented a rule, so the ability is documented as non-executable until
    // a movement-choice seam exists (see manual-programs.ts
    // DOCUMENTED_NON_EXECUTABLE).
    const { state, hero, foe } = stormbenderEncounter({ foe: { x: 4, y: 1 }, second: null });
    // The fixture's loadout comes from EXECUTABLE_JOB_ABILITY_IDS; put the
    // retracted ability back so the command reaches the executability gate
    // (rather than failing earlier as not-equipped).
    state.actors[hero.id].abilityIds = [...state.actors[hero.id].abilityIds, 'stormbender:eye-of-the-storm'];
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'stormbender:eye-of-the-storm', targetIds: [foe.id] }, scriptedDice(4)))
      .toThrow('not an independently executable ICON rule yet');
  });
});
