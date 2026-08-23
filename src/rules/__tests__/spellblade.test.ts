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
 * Source-derived golden fixtures for the independently executable Spellblade
 * ability set (ICON p.222–229), the third Wright job. The wind wall and the
 * lightning arch are `atherwand` / `bifrost-arch` terrain effects; spikes are
 * `lightning-spike` entities. Each scenario must replay to the identical state
 * through applyEvents.
 */

interface SpellbladeFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
}

function spellbladeEncounter(options: {
  foe?: Position; second?: Position | null;
} = {}): SpellbladeFixture {
  let state = createEncounter('Spellblade fixture');
  const hero = actorFromCharacter(validCharacter('Aether Duelist'), { x: 1, y: 1 });
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

describe('Spellblade ability automation (p.222–229)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('spellblade:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const spellbladeIds = JOBS.find((job) => job.id === 'spellblade')!.abilities.map(({ id }) => id);
    expect(spellbladeIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Blitz: attacks [D], makes the foe vulnerable, then teleports and pierces twice', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:blitz', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(26); // 32 - [D] 4 - 1 - 1
    expect(result.state.actors[foe.id].statuses).toContain('vulnerable');
    expect(result.state.actors[hero.id].position).not.toEqual({ x: 1, y: 1 }); // teleported toward the foe
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Odinforce: enters the stance with a d6 power die at 3, and a bolt spends one', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const stanced = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:odinforce', targetIds: [] }, scriptedDice());
    expect(stanced.state.actors[hero.id].stance).toMatchObject({ stanceId: 'odinforce' });
    expect(stanced.state.actors[hero.id].ruleState['spellblade:odinforce:die']).toBe(3);

    // The bolt is a free action on the same source program, so the fixture
    // clears the same-turn repeat gate.
    stanced.state.actors[hero.id].usedAbilityIds = [];
    const bolt = executeCommand(stanced.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:odinforce',
      actionId: 'bolt',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice());
    expect(bolt.state.actors[hero.id].ruleState['spellblade:odinforce:die']).toBe(2);
    expect(bolt.state.actors[foe.id].hp).toBe(31); // 32 - 1 piercing
    const replayed = applyEvents(stanced.state, []);
    replayed.actors[hero.id].usedAbilityIds = [];
    expect(applyEvents(replayed, bolt.events)).toEqual(bolt.state);
  });

  it('Nothung: 2[D]+fray on hit, frays the arc, and pierces once per adjacent character', () => {
    const { state, hero, foe, second } = spellbladeEncounter({ foe: { x: 2, y: 1 }, second: { x: 2, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:nothung', targetIds: [foe.id] }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(18); // 32 - (4 + 5 + fray 4) - 1 piercing (adjacent second)
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (arc)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Nothung slay/infuse (GRAM): flurries 1 piercing twice to foes in a burst 2 (self)', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    state.actors[hero.id].resources.aether = 3;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:nothung',
      actionId: 'gram',
      timing: 'use',
      input: {},
    }, scriptedDice());
    expect(result.state.actors[hero.id].resources.aether).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 1 - 1
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Ätherwand: creates a line 3 wall of crackling winds in range 4', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:atherwand', targetIds: [foe.id] }, scriptedDice());
    const wall = result.state.terrainEffects.filter((effect) => effect.terrain === 'atherwand');
    expect(wall).toHaveLength(1);
    expect(wall[0]?.positions.length).toBeGreaterThanOrEqual(3);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Fulminate: marks a character in range 6, giving them aura 2', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:fulminate', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'fulminate')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Bifröst: sweeps a line 3 arch dealing 2 piercing, leaving the arch behind', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:bifrost',
      actionId: 'default',
      timing: 'use',
      input: { directions: { line: { x: 1, y: 0 } } },
    }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'bifrost-arch')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rampant Nail: impales a lightning spike in range 3 with a d6 power die at 0', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:rampant-nail', targetIds: [foe.id] }, scriptedDice());
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'lightning-spike')).toBe(true);
    expect(result.state.actors[hero.id].ruleState['spellblade:rampant-nail:die']).toBe(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Sturmreiten: teleports to the end of a line 3 and pierces the characters in it', () => {
    const { state, hero, foe } = spellbladeEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'spellblade:sturmreiten',
      actionId: 'default',
      timing: 'interrupt',
      input: { directions: { line: { x: 1, y: 0 } } },
    }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 4, y: 1 }); // end of the line 3
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Drifting Leaf: 2[D]+fray on hit, shatters the foe, frays the line, and gains Leaf on the Wind', () => {
    const { state, hero, foe, second } = spellbladeEncounter({ foe: { x: 3, y: 1 }, second: { x: 2, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'spellblade:drifting-leaf', targetIds: [foe.id] }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - (4 + 5 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (line)
    expect(result.state.actors[hero.id].ruleState['spellblade:leaf-on-the-wind']).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
