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
    expect(thrallsOf(result.state)).toHaveLength(1); // the generic creation authority declines the second occupied placement
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

  it('Rot talent 2: a foe that starts its turn adjacent to a Rot-marked character takes 2 piercing (p.186)', () => {
    const { state, hero, foe, ally } = harvesterEncounter({ second: null, ally: { x: 3, y: 1 } });
    state.actors[hero.id].talents = { 'harvester:rot': 2 };
    state.actors[hero.id].resources.combo = 1;
    // A second foe sits adjacent to the ally that will carry the rot ally-mark.
    state.actors[foe.id].position = { x: 4, y: 1 };
    const marked = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'harvester:rot',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    const mark = marked.state.actors[ally!.id].marks.find(({ markId }) => markId === 'rot');
    expect(mark).toBeDefined();
    expect(mark?.state.kind).toBe('ally');
    expect(marked.state.actors[foe.id].hp).toBe(32);

    // The foe's own turn-start boundary fires the trigger exactly once.
    const ended = executeCommand(marked.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    const taken = executeCommand(ended.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice());
    expect(taken.state.activeActorId).toBe(foe.id);
    expect(taken.state.actors[foe.id].hp).toBe(30); // 32 - 2 piercing
    // The turn boundary replays identically from its recorded intent.
    expect(applyEvents(ended.state, taken.events)).toEqual(taken.state);
  });

  it('Rot talent 2: gated on adjacency and on the owner\u2019s equipped talent 2', () => {
    // Not adjacent (distance 2 from the marked ally): the trigger stays silent.
    const first = harvesterEncounter({ second: null, ally: { x: 3, y: 1 } });
    first.state.actors[first.hero.id].talents = { 'harvester:rot': 2 };
    first.state.actors[first.hero.id].resources.combo = 1;
    first.state.actors[first.foe.id].position = { x: 5, y: 1 };
    const marked = executeCommand(first.state, {
      type: 'EXECUTE_RULE',
      actorId: first.hero.id,
      sourceId: 'harvester:rot',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [first.ally!.id] } },
    }, scriptedDice());
    expect(marked.state.actors[first.ally!.id].marks.some(({ markId }) => markId === 'rot')).toBe(true);
    const ended = executeCommand(marked.state, { type: 'END_TURN', actorId: first.hero.id }, scriptedDice());
    const taken = executeCommand(ended.state, { type: 'TAKE_TURN', actorId: first.foe.id }, scriptedDice());
    expect(taken.state.actors[first.foe.id].hp).toBe(32);

    // Adjacent, but the harvester chose talent 1: no trigger either.
    const second = harvesterEncounter({ second: null, ally: { x: 3, y: 1 } });
    second.state.actors[second.hero.id].talents = { 'harvester:rot': 1 };
    second.state.actors[second.hero.id].resources.combo = 1;
    second.state.actors[second.foe.id].position = { x: 4, y: 1 };
    const secondMarked = executeCommand(second.state, {
      type: 'EXECUTE_RULE',
      actorId: second.hero.id,
      sourceId: 'harvester:rot',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [second.ally!.id] } },
    }, scriptedDice());
    const secondEnded = executeCommand(secondMarked.state, { type: 'END_TURN', actorId: second.hero.id }, scriptedDice());
    const secondTaken = executeCommand(secondEnded.state, { type: 'TAKE_TURN', actorId: second.foe.id }, scriptedDice());
    expect(secondTaken.state.actors[second.foe.id].hp).toBe(32);
    expect(applyEvents(secondEnded.state, secondTaken.events)).toEqual(secondTaken.state);
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

  it('Spirit Away: player-selected Teleport 2 for the entering foe and seals them', () => {
    const { state, hero, foe } = harvesterEncounter({ foe: { x: 3, y: 1 }, second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'harvester:fairy-ring',
      actionId: 'spirit-away',
      timing: 'interrupt',
      input: { positions: { 'teleport': [{ x: 5, y: 1 }] } },
      triggerTargetIds: [foe.id],
    }, scriptedDice());
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[foe.id].position).toEqual({ x: 5, y: 1 }); // teleported to player choice
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

  it('Dark Sliver talent 1: "Comeback: Deal bonus damage, and increase all ranges by +1" (p.185)', () => {
    // F6a: the comeback-gated range rule (range 2 → 3) and the bonus-damage
    // rule (one bonus die while the user is bloodied) both fire only under
    // active Comeback — never on talent ownership alone.
    const { state, hero, foe } = harvesterEncounter({ second: null });
    state.actors[hero.id].talents = { 'harvester:dark-sliver': 1 };
    state.actors[hero.id].hp = 1; // bloodied → the comeback clause holds
    state.actors[foe.id].position = { x: 4, y: 1 }; // range 3
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'harvester:dark-sliver', targetIds: [foe.id] }, scriptedDice(12, 2, 6));
    // d20 12 hits; damage dice roll 2 then 6 → keep the highest (6) + fray 4.
    expect(result.state.actors[foe.id].hp).toBe(22); // 32 - 10
    expect(applyEvents(state, result.events)).toEqual(result.state);

    // Talent equipped but NOT bloodied: the range-3 target is rejected (no
    // range override) — the range-2→3 rule is comeback-gated.
    const healthy = harvesterEncounter({ second: null });
    healthy.state.actors[healthy.hero.id].talents = { 'harvester:dark-sliver': 1 };
    healthy.state.actors[healthy.foe.id].position = { x: 4, y: 1 };
    expect(() => executeCommand(healthy.state, { type: 'USE_ABILITY', actorId: healthy.hero.id, abilityId: 'harvester:dark-sliver', targetIds: [healthy.foe.id] }, scriptedDice(12, 5))).toThrow();

    // Bloodied + talent at the base range 2: legal, and the roll gains the
    // bonus die.
    const comeback = harvesterEncounter({ second: null });
    comeback.state.actors[comeback.hero.id].talents = { 'harvester:dark-sliver': 1 };
    comeback.state.actors[comeback.hero.id].hp = 1;
    const at2 = executeCommand(comeback.state, { type: 'USE_ABILITY', actorId: comeback.hero.id, abilityId: 'harvester:dark-sliver', targetIds: [comeback.foe.id] }, scriptedDice(12, 2, 6));
    expect(at2.state.actors[comeback.foe.id].hp).toBe(22); // 32 - (6 + 4)
    expect(applyEvents(comeback.state, at2.events)).toEqual(at2.state);
  });
});
