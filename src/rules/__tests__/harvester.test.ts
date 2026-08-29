import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { encounterConditionSet } from '../automation/kernels/encounter-adapter.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { RuleMutation } from '../automation/primitives/types.js';
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

/** Occupy every in-grid cell within Chebyshev `radius` of `center` (except the
 * center itself and the hero's cell) with blocker entities, so the Dark
 * Sliver soul-space / plant selectors can only find free cells BEYOND the
 * radius — pinning the exact placement range a test wants to prove. */
function blockCellsNear(state: EncounterState, center: Position, radius: number): EncounterState {
  const hero = Object.values(state.actors).find((actor) => actor.side === 'heroes')!;
  const cells: Position[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      const cell = { x: center.x + dx, y: center.y + dy };
      if (dx === 0 && dy === 0) continue;
      if (cell.x < 0 || cell.y < 0 || cell.x >= state.grid.width || cell.y >= state.grid.height) continue;
      if (cell.x === hero.position.x && cell.y === hero.position.y) continue; // already occupied by the hero
      cells.push(cell);
    }
  }
  const mutations: RuleMutation[] = cells.map((position, index) => ({
    kind: 'entity', sourceId: 'fixture:blocker', operation: 'create', entityType: 'blocker',
    ownerId: hero.id, positions: [position], count: 1, state: {},
  }));
  return applyEvents(state, [{
    type: 'RULE_MUTATIONS_APPLIED', actorId: hero.id, sourceId: 'fixture:blocker', actionId: 'default', timing: 'use', tags: [],
    mutations,
  }]);
}

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
    // Slay fired (confirmed below), and the creation seam lands the slay bonus
    // Thrall in a DISTINCT free adjacent cell — two Thralls total (base + slay),
    // the source-correct outcome rather than the old duplicate-cell collapse to 1.
    expect(thrallsOf(result.state)).toHaveLength(2);
    const cells = thrallsOf(result.state).map((t) => t.positions[0]);
    expect(new Set(cells.map((c) => `${c.x},${c.y}`)).size).toBe(2);
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

  it('Dark Sliver talent 1: healthy — the terrain-effect soul-space selector stays at Range 3 (p.185)', () => {
    // Talent 1 equipped but NOT bloodied: no Comeback, so the attack range
    // stays 2 (target at distance 2 is legal) and the soul-space selector
    // stays at its source Range 3. Blocking every cell within distance 2 of
    // the foe leaves the first free cell at exactly distance 3 — the
    // soul-space must land there, proving the healthy placement range.
    const fixture = harvesterEncounter({ second: null });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 1 };
    fixture.state.actors[fixture.hero.id].hp = fixture.state.actors[fixture.hero.id].baseMaxHp; // healthy
    fixture.state.actors[fixture.foe.id].position = { x: 0, y: 0 };
    fixture.state.actors[fixture.hero.id].position = { x: 2, y: 0 }; // distance 2: legal at base Range 2
    const blocked = blockCellsNear(fixture.state, { x: 0, y: 0 }, 2);
    const result = executeCommand(blocked, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:dark-sliver', targetIds: [fixture.foe.id] }, scriptedDice(12, 4));
    const soul = Object.values(result.state.entities).find((entity) => entity.type === 'soul-space');
    expect(soul).toBeDefined();
    expect(soul!.positions[0]).toEqual({ x: 0, y: 3 }); // the first free cell at exactly distance 3
    expect(applyEvents(blocked, result.events)).toEqual(result.state); // replay
  });

  it('Dark Sliver talent 1 Comeback: the soul-space selector legally reaches Range 4, never Range 5 (p.185)', () => {
    // Bloodied → Comeback: "increase all ranges by +1" widens the soul-space
    // selector 3 → 4. Blocking every cell within distance 3 of the foe leaves
    // the first free cell at distance 4 — the soul-space lands there. A
    // second layout blocks everything within distance 4, leaving only
    // distance-5 cells free: no soul-space is created, proving the selector
    // never uses Range 5.
    const fixture = harvesterEncounter({ second: null });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 1 };
    fixture.state.actors[fixture.hero.id].hp = 1; // bloodied
    fixture.state.actors[fixture.foe.id].position = { x: 0, y: 0 };
    fixture.state.actors[fixture.hero.id].position = { x: 2, y: 0 }; // distance 2: legal under Comeback Range 3
    const range4 = blockCellsNear(fixture.state, { x: 0, y: 0 }, 3);
    const at4 = executeCommand(range4, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:dark-sliver', targetIds: [fixture.foe.id] }, scriptedDice(12, 4));
    const soul = Object.values(at4.state.entities).find((entity) => entity.type === 'soul-space');
    expect(soul).toBeDefined();
    expect(soul!.positions[0]).toEqual({ x: 0, y: 4 }); // the first free cell at exactly distance 4
    expect(applyEvents(range4, at4.events)).toEqual(at4.state); // replay

    const range5 = blockCellsNear(fixture.state, { x: 0, y: 0 }, 4);
    const noSoul = executeCommand(range5, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:dark-sliver', targetIds: [fixture.foe.id] }, scriptedDice(12, 4));
    expect(Object.values(noSoul.state.entities).some((entity) => entity.type === 'soul-space')).toBe(false);
    // The ability itself still resolved normally (attack + damage); replay is
    // stable with the declined placement.
    expect(applyEvents(range5, noSoul.events)).toEqual(noSoul.state);
  });

  it('Dark Sliver talent 1 Comeback: the Slay plant placement legally reaches Range 4, never Range 5 (p.185)', () => {
    // The Slay clause's "create a plant in range 3 of your foe" is an "all
    // ranges" scope too: under Comeback it becomes range 4. Blocking every
    // cell within distance 3 leaves the first free cell at distance 4 — the
    // plant lands there. With everything within distance 4 blocked, no plant
    // is created even though distance-5 cells are free.
    const fixture = harvesterEncounter({ second: null });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 1 };
    fixture.state.actors[fixture.hero.id].hp = 1; // bloodied
    fixture.state.actors[fixture.foe.id].position = { x: 0, y: 0 };
    fixture.state.actors[fixture.hero.id].position = { x: 2, y: 0 };
    const range4 = blockCellsNear(fixture.state, { x: 0, y: 0 }, 3);
    const slay4 = executeCommand(range4, {
      type: 'EXECUTE_RULE', actorId: fixture.hero.id, sourceId: 'harvester:dark-sliver',
      actionId: 'default', timing: 'use', attackTargetId: fixture.foe.id, input: {}, triggers: ['slay'],
    }, scriptedDice(12, 4));
    const plant = Object.values(slay4.state.entities).find((entity) => entity.type === 'plant');
    expect(plant).toBeDefined();
    expect(plant!.positions[0]).toEqual({ x: 0, y: 4 }); // the first free cell at exactly distance 4
    expect(applyEvents(range4, slay4.events)).toEqual(slay4.state); // replay

    const range5 = blockCellsNear(fixture.state, { x: 0, y: 0 }, 4);
    const noPlant = executeCommand(range5, {
      type: 'EXECUTE_RULE', actorId: fixture.hero.id, sourceId: 'harvester:dark-sliver',
      actionId: 'default', timing: 'use', attackTargetId: fixture.foe.id, input: {}, triggers: ['slay'],
    }, scriptedDice(12, 4));
    expect(Object.values(noPlant.state.entities).some((entity) => entity.type === 'plant')).toBe(false);
    expect(applyEvents(range5, noPlant.events)).toEqual(noPlant.state);
  });

  it('Dark Sliver talent 2: "Sacrifice 2: Ability gains range 6" (p.187)', () => {
    // ICON p.187 + Combat Glossary Sacrifice (p.103): "Sacrifice costs are
    // paid at the start of an ability". The sacrifice-2 is validated and
    // paid through the cost-payment authority before any effect or RNG, and
    // the range becomes 6 through the range kernel's choice gate — both
    // halves resolved from the SAME validated pre-use augmentation.
    const fixture = harvesterEncounter({ second: null, foe: { x: 6, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 2 };
    fixture.state.actors[fixture.hero.id].hp = 12; // enough to sacrifice 2
    const result = executeCommand(fixture.state, {
      type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:dark-sliver',
      targetIds: [fixture.foe.id],
      input: { talentChoices: ['harvester:dark-sliver:talent:2'] },
    }, scriptedDice(12, 4));
    // Sacrifice 2 HP: 12 → 10 (sacrifice applies before ability effects).
    expect(result.state.actors[fixture.hero.id].hp).toBe(10);
    // [D] 4 + fray 4 = 8 damage to foe: 32 - 8 = 24.
    expect(result.state.actors[fixture.foe.id].hp).toBe(24);
    // The nominal Sacrifice-2 mutation rides the recorded event.
    const sacrifice = mutationsOf(result.events, 'harvester:dark-sliver').find((mutation) =>
      mutation.kind === 'damage' && mutation.damageType === 'sacrifice' && mutation.actorId === fixture.hero.id);
    expect(sacrifice).toMatchObject({ kind: 'damage', amount: 2, damageType: 'sacrifice' });
    // The command-time decision and payment replay to the identical state.
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Dark Sliver talent 2: no declaration → base range and no sacrifice', () => {
    // Without declaring the talent choice, the sacrifice is not paid and
    // the range stays at 2 (base range) — the range-6 target is rejected.
    const fixture = harvesterEncounter({ second: null, foe: { x: 6, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 2 };
    fixture.state.actors[fixture.hero.id].hp = 12;
    expect(() => executeCommand(fixture.state, {
      type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:dark-sliver',
      targetIds: [fixture.foe.id],
    }, scriptedDice(12, 4))).toThrow(); // out of range 2
    expect(fixture.state.actors[fixture.hero.id].hp).toBe(12); // nothing paid
  });

  it('Dark Sliver talent 2: sacrifice with insufficient HP still pays (floor 1)', () => {
    // ICON Sacrifice p.103: the cost "cannot bring your hp below 1, and you
    // can pay them even if you don't have enough hp left" — floor 1 HP.
    const fixture = harvesterEncounter({ second: null, foe: { x: 6, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 2 };
    fixture.state.actors[fixture.hero.id].hp = 1; // only 1 HP, sacrifice 2
    const result = executeCommand(fixture.state, {
      type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:dark-sliver',
      targetIds: [fixture.foe.id],
      input: { talentChoices: ['harvester:dark-sliver:talent:2'] },
    }, scriptedDice(12, 4));
    // Floor 1 HP: sacrifice reduces from 1 to 1.
    expect(result.state.actors[fixture.hero.id].hp).toBe(1);
    // The ability still resolves normally.
    expect(result.state.actors[fixture.foe.id].hp).toBe(24);
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state); // replay
  });

  it('Dark Sliver talent 2: declared but not equipped — no sacrifice and no Range 6 when the target is otherwise in base range', () => {
    // The augmentation authority ignores a declared choice the actor does
    // not have equipped at the required rank: no sacrifice is paid and the
    // range gate never fires, even though the command succeeded on base
    // range — the choice created no mechanical state change.
    const fixture = harvesterEncounter({ second: null, foe: { x: 2, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = {}; // talent 2 NOT equipped
    fixture.state.actors[fixture.hero.id].hp = 12;
    const result = executeCommand(fixture.state, {
      type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:dark-sliver',
      targetIds: [fixture.foe.id],
      input: { talentChoices: ['harvester:dark-sliver:talent:2'] },
    }, scriptedDice(12, 4));
    // Legal at base range 2, and NO sacrifice was paid.
    expect(result.state.actors[fixture.hero.id].hp).toBe(12);
    expect(result.state.actors[fixture.foe.id].hp).toBe(24); // 32 - (4 + 4)
    expect(mutationsOf(result.events, 'harvester:dark-sliver').some((mutation) =>
      mutation.kind === 'damage' && mutation.damageType === 'sacrifice')).toBe(false);
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Dark Sliver talent 2: declared while using a different legal ability — no sacrifice, no effect on that ability', () => {
    // A talentChoices source ID unrelated to the ability being used is
    // ignored by the augmentation authority: it cannot pay a cost or alter
    // another ability's resolution.
    const fixture = harvesterEncounter({ second: null, foe: { x: 2, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 2 }; // equipped, but used with Sow
    fixture.state.actors[fixture.hero.id].hp = 12;
    const result = executeCommand(fixture.state, {
      type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:sow',
      targetIds: [fixture.foe.id],
      input: { talentChoices: ['harvester:dark-sliver:talent:2'] },
    }, scriptedDice());
    // Sow resolves exactly as usual (auto-hit fray 4) with NO sacrifice paid.
    expect(result.state.actors[fixture.hero.id].hp).toBe(12);
    expect(result.state.actors[fixture.foe.id].hp).toBe(28); // 32 - fray 4
    expect(mutationsOf(result.events, 'harvester:sow').some((mutation) =>
      mutation.kind === 'damage' && mutation.damageType === 'sacrifice')).toBe(false);
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Dark Sliver talent 2: declared but not equipped — the range-6 gate cannot fire through a different legal ability either', () => {
    // Even through a different ability, an unrelated declared choice never
    // widens any range: the validated augmentation set for THIS ability is
    // empty, so the range kernel's choice gate reads nothing.
    const fixture = harvesterEncounter({ second: null, foe: { x: 6, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 2 };
    fixture.state.actors[fixture.hero.id].hp = 12;
    // Sow's target is limited by its own base range 4 (target at range 5):
    // the Dark Sliver declaration must not leak Range 6 into Sow.
    expect(() => executeCommand(fixture.state, {
      type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'harvester:sow',
      targetIds: [fixture.foe.id],
      input: { talentChoices: ['harvester:dark-sliver:talent:2'] },
    }, scriptedDice())).toThrow(); // out of Sow's range
    expect(fixture.state.actors[fixture.hero.id].hp).toBe(12); // nothing paid
  });

  it('Dark Sliver talent 2 through EXECUTE_RULE: same payment and range semantics as USE_ABILITY', () => {
    // EXECUTE_RULE consumes the same validated pre-use augmentation: Range 6
    // through the choice gate AND the Sacrifice-2 payment ride the event.
    const fixture = harvesterEncounter({ second: null, foe: { x: 6, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 2 };
    fixture.state.actors[fixture.hero.id].hp = 12;
    const result = executeCommand(fixture.state, {
      type: 'EXECUTE_RULE', actorId: fixture.hero.id, sourceId: 'harvester:dark-sliver',
      actionId: 'default', timing: 'use', attackTargetId: fixture.foe.id,
      input: { talentChoices: ['harvester:dark-sliver:talent:2'] },
    }, scriptedDice(12, 4));
    // Sacrifice 2 HP: 12 → 10, exactly like USE_ABILITY.
    expect(result.state.actors[fixture.hero.id].hp).toBe(10);
    expect(result.state.actors[fixture.foe.id].hp).toBe(24);
    const sacrifice = mutationsOf(result.events, 'harvester:dark-sliver').find((mutation) =>
      mutation.kind === 'damage' && mutation.damageType === 'sacrifice' && mutation.actorId === fixture.hero.id);
    expect(sacrifice).toMatchObject({ kind: 'damage', amount: 2, damageType: 'sacrifice' });
    // Replay applies exactly what the command decided.
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });

  it('Dark Sliver talent 2 through EXECUTE_RULE: no declaration stays at base range with no sacrifice', () => {
    const fixture = harvesterEncounter({ second: null, foe: { x: 6, y: 1 } });
    fixture.state.actors[fixture.hero.id].talents = { 'harvester:dark-sliver': 2 };
    fixture.state.actors[fixture.hero.id].hp = 12;
    expect(() => executeCommand(fixture.state, {
      type: 'EXECUTE_RULE', actorId: fixture.hero.id, sourceId: 'harvester:dark-sliver',
      actionId: 'default', timing: 'use', attackTargetId: fixture.foe.id,
      input: {},
    }, scriptedDice(12, 4))).toThrow(); // out of base range 2
    expect(fixture.state.actors[fixture.hero.id].hp).toBe(12); // nothing paid
  });
});
