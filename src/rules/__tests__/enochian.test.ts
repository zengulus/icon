import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Enochian
 * ability set (ICON p.206–214), the first Wright job. Aether is the `aether`
 * resource; shards and spires are `aethershard` / `magma-spire` entities;
 * pits are `pit` terrain. Each scenario must replay to the identical state
 * through applyEvents.
 */

interface EnochianFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

function enochianEncounter(options: {
  foe?: Position; second?: Position | null; ally?: Position | null;
  talents?: Record<string, 1 | 2>; bloodied?: boolean;
} = {}): EnochianFixture {
  let state = createEncounter('Enochian fixture');
  const hero = actorFromCharacter(validCharacter('Pyromancer'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  if (options.talents) hero.talents = { ...hero.talents, ...options.talents };
  if (options.bloodied) hero.hp = 1;
  const foe = createFoe('Relict', options.foe ?? { x: 3, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 5, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) {
    ally.id = 'actor:mira'; // validCharacter shares the hero's timestamp-derived id
    ally.characterId = 'mira';
    ally.abilityIds = [];
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  }
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second, ally };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Enochian ability automation (p.206–214)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('enochian:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const enochianIds = JOBS.find((job) => job.id === 'enochian')!.abilities.map(({ id }) => id);
    expect(enochianIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Pyre: 2[D]+fray to the target, fray to the medium blast, and an Exceed explodes the area for 2 piercing', () => {
    const { state, hero, foe, second } = enochianEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    // Exceed is the ability's own 15+ attack roll (ICON p.93) — the roll is
    // scripted to 15 so the re-explosion derives from the authoritative roll,
    // never a command assertion.
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'enochian:pyre',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(15, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - (4 + 5 + fray 4) - 2 piercing (exceed)
    expect(result.state.actors[second!.id].hp).toBe(26); // 32 - fray 4 (area) - 2 piercing (exceed)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Pyre talent 1: while bloodied, allies are immune to the ability\u2019s area damage', () => {
    // The first program-level comeback clause (F7): the resolver reads the
    // equipped choice and, on the bloodied trigger, skips allies in both the
    // blast fray and the comeback re-explosion.
    const { state, hero, foe, ally } = enochianEncounter({ foe: { x: 3, y: 1 }, second: null, ally: { x: 2, y: 1 }, talents: { 'enochian:pyre': 1 }, bloodied: true });
    const allyHp = ally!.hp;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:pyre', targetIds: [foe.id] }, scriptedDice(12, 4, 5));
    const mutations = mutationsOf(result.events, 'enochian:pyre');
    expect(mutations.filter((mutation) => mutation.kind === 'damage' && mutation.actorId === ally!.id)).toHaveLength(0);
    expect(result.state.actors[ally!.id].hp).toBe(allyHp);
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - (4 + 5 + fray 4) - 2 piercing (comeback re-explosion)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Pyre talent 1: the ally immunity is gated on the bloodied trigger', () => {
    const { state, hero, foe, ally } = enochianEncounter({ foe: { x: 3, y: 1 }, second: null, ally: { x: 2, y: 1 }, talents: { 'enochian:pyre': 1 } });
    const allyHp = ally!.hp;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:pyre', targetIds: [foe.id] }, scriptedDice(12, 4, 5));
    expect(result.state.actors[ally!.id].hp).toBe(allyHp - 2); // blast fray 4, reduced by the ally's armor 2; no re-explosion without the trigger
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - (4 + 5 + fray 4)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Pyre: without talent 1, a bloodied user still damages allies in the blast', () => {
    const { state, hero, foe, ally } = enochianEncounter({ foe: { x: 3, y: 1 }, second: null, ally: { x: 2, y: 1 }, bloodied: true });
    const allyHp = ally!.hp;
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:pyre', targetIds: [foe.id] }, scriptedDice(12, 4, 5));
    expect(result.state.actors[ally!.id].hp).toBe(allyHp - 4); // blast fray 4 (armor-reduced to 2) + 2 piercing re-explosion
    expect(result.state.actors[foe.id].hp).toBe(17);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Pyre infuse (PYROTIC): spends 3 aether, widens the blast, and opens a pit', () => {
    const { state, hero, foe } = enochianEncounter({ second: null });
    state.actors[hero.id].resources.aether = 3;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'enochian:pyre',
      actionId: 'infuse',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(12, 4, 5));
    expect(result.state.actors[hero.id].resources.aether).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - (4 + 5 + fray 4)
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions[0]?.x === 3 && effect.positions[0]?.y === 1)).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Elden Rune: inscribes a rune on the space underneath you', () => {
    const { state, hero } = enochianEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:elden-rune', targetIds: [] }, scriptedDice());
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'elden-rune' && effect.positions[0]?.x === 1 && effect.positions[0]?.y === 1)).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Lance: [D]+fray in a line 8, makes the foe vulnerable, and frays the line', () => {
    const { state, hero, foe, second } = enochianEncounter({ foe: { x: 3, y: 1 }, second: { x: 2, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:lance', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('vulnerable');
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (line)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Lance infuse (VOLVAGA): spends 3 aether and frays the widened line', () => {
    const { state, hero, foe, second } = enochianEncounter({ foe: { x: 3, y: 1 }, second: { x: 2, y: 0 } });
    state.actors[hero.id].resources.aether = 3;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'enochian:lance',
      actionId: 'infuse',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(12, 4));
    expect(result.state.actors[hero.id].resources.aether).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4 (width +1 catches the adjacent cell)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Soul Burn: enters the stance', () => {
    const { state, hero } = enochianEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:soul-burn', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'soul-burn' });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Soul Burn infuse (INCANDIUS): shoves adjacent characters 3 and sparks a soul ember', () => {
    const { state, hero, foe } = enochianEncounter({ foe: { x: 2, y: 1 }, second: null });
    state.actors[hero.id].resources.aether = 4;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'enochian:soul-burn',
      actionId: 'infuse',
      timing: 'use',
      input: {},
    }, scriptedDice());
    expect(result.state.actors[hero.id].resources.aether).toBe(0);
    expect(result.state.actors[foe.id].hp).toBe(31); // 32 - 1 piercing (soul ember)
    expect(result.state.actors[foe.id].position).toEqual({ x: 5, y: 1 }); // shoved 3 east
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Blazing Bond: marks an ally, and Heartfire sacrifices the partner', () => {
    const { state, hero, ally } = enochianEncounter({ second: null, ally: { x: 2, y: 1 } });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:blazing-bond', targetIds: [ally!.id] }, scriptedDice());
    expect(used.state.actors[ally!.id].marks.some(({ markId }) => markId === 'blazing-bond')).toBe(true);

    const heartfire = executeCommand(used.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'enochian:blazing-bond',
      actionId: 'heartfire',
      timing: 'interrupt',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(heartfire.state.actors[ally!.id].hp).toBe(37); // 40 - 3 (partner sacrifice)
    expect(heartfire.state.actors[ally!.id].ruleState['heartfire:armor']).toBe(true);
    expect(applyEvents(used.state, heartfire.events)).toEqual(heartfire.state);
  });

  it('Aethershard: sacrifices 3 and summons a shard in range 6', () => {
    const { state, hero } = enochianEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:aethershard', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].hp).toBe(37); // 40 - 3 (sacrifice)
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'aethershard')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Implode: ends the turn and marks the delay space', () => {
    const { state, hero, foe } = enochianEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:implode', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].ruleState['implode:pending']).toBeDefined();
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Pyroclast: marks a character for the end-of-next-turn eruption', () => {
    const { state, hero, foe } = enochianEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:pyroclast', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'pyroclast')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Pyre: reversing actor INSERTION order changes nothing — the migrated reference reads resolve by recorded slot identity, not iteration order', () => {
    // The migrated source/attack-target reads are singular slot dereferences
    // (context.actorId / attackTargetId → adapter), deterministic by the
    // RECORDED identity; object-iteration order of state.actors cannot select
    // who the ability user or its target is. Insert the second foe BEFORE the
    // target so object order differs from the canonical fixture, and assert
    // the same damage outcome and replay state.
    let setup = createEncounter('Enochian insertion-order fixture');
    const hero = actorFromCharacter(validCharacter('Pyromancer'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const second = createFoe('Grim', { x: 5, y: 1 });
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: hero }).state;
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: second }).state; // second BEFORE target
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: foe }).state;
    setup = startEncounterTo(setup, hero.id);
    const result = executeCommand(setup, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'enochian:pyre',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(15, 4, 5));
    expect(result.state.actors[foe.id].hp).toBe(17); // 32 - (4 + 5 + fray 4) - 2 piercing (exceed)
    expect(result.state.actors[second.id].hp).toBe(26); // 32 - fray 4 - 2 piercing (exceed)
    expect(applyEvents(setup, result.events)).toEqual(result.state);
  });

  it('Blackstar: 2[D]+fray to the target, [D]+fray to the large blast, shatters, and sacrifices half HP before round 6', () => {
    const { state, hero, foe, second } = enochianEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'enochian:blackstar', targetIds: [foe.id] }, scriptedDice(12, 4, 5, 2));
    expect(result.state.actors[foe.id].hp).toBe(19); // 32 - (4 + 5 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('shattered');
    expect(result.state.actors[second!.id].hp).toBe(26); // 32 - ([D] 2 + fray 4)
    expect(result.state.actors[hero.id].hp).toBe(20); // 40 - 50% (round 1)
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
