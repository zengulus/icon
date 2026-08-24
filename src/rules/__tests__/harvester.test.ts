import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { encounterConditionSet } from '../automation/kernels/encounter-adapter.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnOnly, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Harvester
 * ability set (ICON p.182–188), the second Mendicant job. Thralls and plants
 * are `thrall` / `plant` entities, the undergrowth is `undergrowth` terrain,
 * and the fairy ring is `fairy-ring` terrain. Each scenario must replay to the
 * identical state through applyEvents.
 */

interface HarvesterFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

function harvesterEncounter(options: {
  foe?: Position; second?: Position | null; ally?: Position | null;
} = {}): HarvesterFixture {
  let state = createEncounter('Harvester fixture');
  const hero = actorFromCharacter(validCharacter('Green Witch'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second, ally };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

const thrallsOf = (state: EncounterState) => Object.values(state.entities).filter((entity) => entity.type === 'thrall');

describe('Harvester ability automation (p.182–188)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('harvester:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const harvesterIds = JOBS.find((job) => job.id === 'harvester')!.abilities.map(({ id }) => id);
    expect(harvesterIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Sow: auto-hits fray, seals the foe, and marks them', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:sow', targetIds: [foe.id] }, scriptedDice());
    expect(mutationsOf(result.events, 'harvester:sow')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', actorId: hero.id, targetId: foe.id, autoHit: true },
      { kind: 'damage', actorId: foe.id, amount: 4 },
      { kind: 'condition', actorId: foe.id, conditionId: 'sealed' },
      { kind: 'mark', actorId: foe.id, markId: 'sow' },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - fray 4
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'sow')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Sow combo (REAP): attacks [D]+fray, summons a Thrall, and repeats on Slay', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'harvester:sow',
      actionId: 'combo',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
      triggers: ['slay'],
    }, scriptedDice(12, 4, 4));
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(16); // 32 - 8 (hit) - 8 (slay repeat)
    expect(thrallsOf(result.state)).toHaveLength(2); // one for the effect, one for the slay
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Growing Season: marks a character in range 4', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:growing-season', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'growing-season')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Gravebirth: enters the stance and summons a Thrall in range 2', () => {
    const { state, hero } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:gravebirth', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'gravebirth' });
    expect(thrallsOf(result.state)).toHaveLength(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Harvest: 2[D]+fray to the target, fray to the small blast, and a Slay summons thralls and repeats damage', () => {
    const { state, hero, foe, second } = harvesterEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'harvester:harvest',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
      triggers: ['slay'],
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - (4 + 5 + fray 4) - 2 (slay)
    expect(result.state.actors[second!.id].hp).toBe(26); // 32 - fray 4 (area) - 2 (slay)
    expect(thrallsOf(result.state).length).toBeGreaterThanOrEqual(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Blood Grove: grows a medium blast of undergrowth centered in range 2', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:blood-grove', targetIds: [foe.id] }, scriptedDice());
    const grove = result.state.terrainEffects.filter((effect) => effect.terrain === 'undergrowth');
    expect(grove).toHaveLength(1);
    expect(grove[0]?.positions.length).toBeGreaterThanOrEqual(9); // a medium blast on the 10×10 grid
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rot: marks a foe (noDefiance when at 25% hp or lower)', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:rot', targetIds: [foe.id] }, scriptedDice());
    const mark = result.state.actors[foe.id].marks.find(({ markId }) => markId === 'rot');
    expect(mark).toBeDefined();
    expect(mark?.state.kind).toBe('foe');
    expect(mark?.state.noDefiance).toBe(false); // above 25% hp
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rot combo (REGENERATE): marks an ally with regeneration', () => {
    const { state, hero, foe, ally } = harvesterEncounter({ second: null, ally: { x: 3, y: 1 } });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'harvester:rot',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    const mark = result.state.actors[ally!.id].marks.find(({ markId }) => markId === 'rot');
    expect(mark).toBeDefined();
    expect(mark?.state.kind).toBe('ally');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rot: a noDefiance foe-mark suppresses Defiance while the mark is active (p.186)', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    // Marking a foe at 25% of Relict's 32 HP (8) records noDefiance; the
    // closed mark projection then removes Defiance from the ephemeral set, so
    // a lethal blow defeats the marked foe instead of flooring at 1 HP.
    state.actors[foe.id].hp = 8;
    state.actors[foe.id].vigor = 0;
    state.actors[foe.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:rot', targetIds: [foe.id] }, scriptedDice());
    const mark = result.state.actors[foe.id].marks.find(({ markId }) => markId === 'rot');
    expect(mark?.state.noDefiance).toBe(true);
    expect(encounterConditionSet(result.state.actors[foe.id]).has('defiance')).toBe(false);

    const blown = applyEvents(result.state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: hero.id,
      sourceId: 'fixture:lethal',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:lethal', sourceActorId: hero.id, actorId: foe.id, amount: 999, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: true }],
    }]);
    expect(blown.actors[foe.id]).toMatchObject({ hp: 0, defeated: true });
    // The baseline is an explicit false (encounter start); the immunity grant
    // would flip it to true, which must not happen without Defiance.
    expect(blown.actors[foe.id].ruleState['damage-immune']).not.toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rot: a foe above 25% keeps Defiance while marked (noDefiance false)', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    state.actors[foe.id].hp = 16;
    state.actors[foe.id].vigor = 0;
    state.actors[foe.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:rot', targetIds: [foe.id] }, scriptedDice());
    const mark = result.state.actors[foe.id].marks.find(({ markId }) => markId === 'rot');
    expect(mark?.state.noDefiance).toBe(false);
    expect(encounterConditionSet(result.state.actors[foe.id]).has('defiance')).toBe(true);

    // Above 25% the mark does not suppress Defiance, so the same lethal blow
    // floors at 1 HP, consumes the condition, and grants the temporary
    // immunity instead of defeating the foe.
    const blown = applyEvents(result.state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: hero.id,
      sourceId: 'fixture:lethal',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:lethal', sourceActorId: hero.id, actorId: foe.id, amount: 999, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: true }],
    }]);
    expect(blown.actors[foe.id]).toMatchObject({ hp: 1, defeated: false });
    expect(blown.actors[foe.id].ruleState['damage-immune']).toBe(true);
    expect(blown.actors[foe.id].conditions.some(({ id }) => id === 'defiance')).toBe(false); // consumed
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rot combo (REGENERATE): the ally-mark projects regeneration at turn end while bloodied (p.186)', () => {
    const { state, hero, foe, ally } = harvesterEncounter({ second: null, ally: { x: 3, y: 1 } });
    state.actors[hero.id].resources.combo = 1;
    const marked = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'harvester:rot',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    // The reviewed mark projection grants a literal regeneration condition
    // (p.104: gain 4 vigor at turn end while bloodied).
    expect(encounterConditionSet(marked.state.actors[ally!.id]).has('regeneration')).toBe(true);
    expect(applyEvents(state, marked.events)).toEqual(marked.state);

    // Bloodied (at or below half of 40 HP), ending the ally's own turn
    // restores 4 vigor through the shared kernel.
    marked.state.actors[ally!.id].hp = 20;
    marked.state.actors[ally!.id].vigor = 0;
    const afterHero = endTurnTo(marked.state, foe.id, scriptedDice());
    const afterFoe = endTurnTo(afterHero, ally!.id, scriptedDice());
    const activeActorId = afterFoe.activeActorId;
    if (!activeActorId) throw new Error('endTurnTo requires an active actor.');
    const endedResult = executeCommand(afterFoe, { type: 'END_TURN', actorId: activeActorId }, scriptedDice());
    expect(endedResult.state.actors[ally!.id].vigor).toBe(4);
    expect(applyEvents(afterFoe, endedResult.events)).toEqual(endedResult.state);
  });

  it('Rot projection is closed: non-recipe marks and trait IDs stay unprojected (negative)', () => {
    const { state, hero, foe, ally } = harvesterEncounter({ second: null, ally: { x: 3, y: 1 } });
    // A mark that merely resembles Rot (same markId from a non-recipe source)
    // must never project: the registry is keyed on the exact sourceId +
    // markId + reviewed state, never on shape or prose.
    state.actors[ally!.id].marks.push({ id: 'x:fake-source', sourceId: 'fixture:fake-rot', ownerId: hero.id, markId: 'rot', duration: null, state: { kind: 'ally' } });
    expect(encounterConditionSet(state.actors[ally!.id]).has('regeneration')).toBe(false);
    // An unreviewed mark kind carrying a noDefiance-shaped state is inert too.
    state.actors[foe.id].hp = 8;
    state.actors[foe.id].vigor = 0;
    state.actors[foe.id].conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    state.actors[foe.id].marks.push({ id: 'x:fake-kind', sourceId: 'harvester:rot', ownerId: hero.id, markId: 'rot', duration: null, state: { kind: 'fixture', noDefiance: true } });
    expect(encounterConditionSet(state.actors[foe.id]).has('defiance')).toBe(true);
    // A fabricated trait ID adds nothing (no title or prose inference): the
    // hero's only projected condition is the reviewed Fortify recipe.
    const before = encounterConditionSet(state.actors[hero.id]);
    expect([...before]).toEqual(['fortify']);
    state.actors[hero.id].traitIds.push('fixture:fake-trait');
    expect([...encounterConditionSet(state.actors[hero.id])]).toEqual(['fortify']);
  });

  it('Crimson Bloom: marks a character with a d6 power die starting at 0', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:crimson-bloom', targetIds: [foe.id] }, scriptedDice());
    const mark = result.state.actors[foe.id].marks.find(({ markId }) => markId === 'crimson-bloom');
    expect(mark).toBeDefined();
    expect(mark?.state.die).toBe(0);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Fairy Ring: ends the turn and creates a burst 2 ring of mushrooms', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:fairy-ring', targetIds: [] }, scriptedDice());
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'fairy-ring')).toBe(true);
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Spirit Away: teleports the entering foe 2 and seals them', () => {
    const { state, hero, foe } = harvesterEncounter({ foe: { x: 3, y: 1 }, second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'harvester:fairy-ring',
      actionId: 'spirit-away',
      timing: 'interrupt',
      input: {},
      triggerTargetIds: [foe.id],
    }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[foe.id].position).toEqual({ x: 5, y: 1 }); // teleported 2 east
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Dark Sliver: [D]+fray on hit, cuts away the soul space, and marks it', () => {
    const { state, hero, foe } = harvesterEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:dark-sliver', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'soul-space')).toBe(true);
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'dark-sliver')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
