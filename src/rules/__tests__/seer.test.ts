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
  state = startEncounterTo(state, hero.id);
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

  it('Sleight Of Hand wild card: placement region is the FOE but the LoS authority is the CREATOR (hero)', () => {
    const { state, hero, foe } = seerEncounter({ foe: { x: 3, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:sleight-of-hand', targetIds: [foe.id] }, scriptedDice());
    const card = mutationsOf(result.events, 'seer:sleight-of-hand').find((m) => m.kind === 'entity' && m.entityType === 'wild-card');
    expect(card).toBeDefined();
    if (card && card.kind === 'entity') {
      // PART 2: region candidates are the foe's vicinity, but creationSpatial
      // carries the CREATOR origin (hero at (1,1)), never the foe/target.
      expect(card.creationSpatial?.origin).toEqual({ x: 1, y: 1 });
    }
  });

  it('Chaos Tarot: a gamble of 1 explodes the card for fray damage', () => {
    const { state, hero, foe, second } = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:chaos-tarot', targetIds: [foe.id] }, scriptedDice(1));
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - fray 4
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - fray 4
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'wild-card')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Chaos Tarot effects 4/5: absent and explicit-empty subsets choose zero, never automatic targets', () => {
    const blessFixture = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 }, ally: { x: 4, y: 1 } });
    const blessed = executeCommand(blessFixture.state, {
      type: 'USE_ABILITY', actorId: blessFixture.hero.id, abilityId: 'seer:chaos-tarot', targetIds: [blessFixture.foe.id],
    }, scriptedDice(4));
    expect(Object.values(blessed.state.actors).every((actor) => (actor.resources.blessing ?? 0) === 0)).toBe(true);
    expect(applyEvents(blessFixture.state, blessed.events)).toEqual(blessed.state);

    const sealFixture = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 }, ally: { x: 4, y: 1 } });
    const sealed = executeCommand(sealFixture.state, {
      type: 'USE_ABILITY', actorId: sealFixture.hero.id, abilityId: 'seer:chaos-tarot', targetIds: [sealFixture.foe.id],
      input: { actorIds: { 'chaos-tarot-seal': [] } },
    }, scriptedDice(5));
    expect(Object.values(sealed.state.actors).every((actor) => !actor.statuses.includes('sealed'))).toBe(true);
    expect(applyEvents(sealFixture.state, sealed.events)).toEqual(sealed.state);
  });

  it('Chaos Tarot effects 4/5: applies exactly one or two legal recorded characters regardless of side', () => {
    const blessFixture = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 }, ally: { x: 4, y: 1 } });
    const blessed = executeCommand(blessFixture.state, {
      type: 'USE_ABILITY', actorId: blessFixture.hero.id, abilityId: 'seer:chaos-tarot', targetIds: [blessFixture.foe.id],
      input: { actorIds: { 'chaos-tarot-bless': [blessFixture.foe.id, blessFixture.ally!.id] } },
    }, scriptedDice(4));
    expect(blessed.state.actors[blessFixture.foe.id].resources.blessing).toBe(1);
    expect(blessed.state.actors[blessFixture.ally!.id].resources.blessing).toBe(1);
    expect(blessed.state.actors[blessFixture.second!.id].resources.blessing ?? 0).toBe(0);
    expect(applyEvents(blessFixture.state, blessed.events)).toEqual(blessed.state);

    const sealFixture = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 }, ally: { x: 4, y: 1 } });
    const sealed = executeCommand(sealFixture.state, {
      type: 'USE_ABILITY', actorId: sealFixture.hero.id, abilityId: 'seer:chaos-tarot', targetIds: [sealFixture.foe.id],
      input: { actorIds: { 'chaos-tarot-seal': [sealFixture.ally!.id] } },
    }, scriptedDice(5));
    expect(sealed.state.actors[sealFixture.ally!.id].statuses).toContain('sealed');
    expect(sealed.state.actors[sealFixture.foe.id].statuses).not.toContain('sealed');
    expect(applyEvents(sealFixture.state, sealed.events)).toEqual(sealed.state);
  });

  it('Chaos Tarot effects 4/5: rejects over-cardinality and ineligible actors; repeated ids remain one subset member', () => {
    const { state, hero, foe, second, ally } = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 }, ally: { x: 4, y: 1 } });
    const run = (roll: 4 | 5, key: string, ids: string[]) => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:chaos-tarot', targetIds: [foe.id],
      input: { actorIds: { [key]: ids } },
    }, scriptedDice(roll));
    expect(() => run(4, 'chaos-tarot-bless', [foe.id, second!.id, ally!.id])).toThrowError(expect.objectContaining({ code: 'choice.actor-count' }));
    expect(() => run(5, 'chaos-tarot-seal', [hero.id])).toThrowError(expect.objectContaining({ code: 'choice.actor-ineligible' }));
    const repeated = run(4, 'chaos-tarot-bless', [foe.id, foe.id]);
    expect(repeated.state.actors[foe.id].resources.blessing).toBe(1);
    expect(applyEvents(state, repeated.events)).toEqual(repeated.state);
  });

  it('Chaos Tarot effect 6: missing, wrong-cardinality, duplicate, and invalid effect recordings reject', () => {
    const { state, hero, foe } = seerEncounter({ second: null });
    const run = (effects?: string) => executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:chaos-tarot', targetIds: [foe.id],
      input: effects === undefined ? {} : { options: { 'chaos-tarot-effects': effects } },
    }, scriptedDice(6));
    expect(() => run()).toThrowError(expect.objectContaining({ code: 'choice.option-required' }));
    expect(() => run('1')).toThrowError(expect.objectContaining({ code: 'choice.option-count' }));
    expect(() => run('1,2,3')).toThrowError(expect.objectContaining({ code: 'choice.option-count' }));
    expect(() => run('1,1')).toThrowError(expect.objectContaining({ code: 'choice.option-distinct' }));
    expect(() => run('1,6')).toThrowError(expect.objectContaining({ code: 'choice.option-invalid' }));
  });

  it('Chaos Tarot effect 6 executes exactly the captured pair; the old automatic 1+3 result is impossible', () => {
    const { state, hero, foe, second, ally } = seerEncounter({ foe: { x: 3, y: 1 }, second: { x: 3, y: 0 }, ally: { x: 4, y: 1 } });
    const result = executeCommand(state, {
      type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:chaos-tarot', targetIds: [foe.id],
      input: {
        options: { 'chaos-tarot-effects': '5,4' },
        actorIds: {
          'chaos-tarot-bless': [foe.id, ally!.id],
          'chaos-tarot-seal': [second!.id],
        },
      },
    }, scriptedDice(6));
    expect(result.state.actors[foe.id].hp).toBe(32);
    expect(result.state.actors[foe.id].resources.blessing).toBe(1);
    expect(result.state.actors[ally!.id].resources.blessing).toBe(1);
    expect(result.state.actors[second!.id].statuses).toContain('sealed');
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'difficult')).toBe(false);
    expect(Object.values(result.state.entities).some((entity) => entity.type === 'wild-card')).toBe(true);
    const mutations = mutationsOf(result.events, 'seer:chaos-tarot');
    expect(mutations.findIndex((mutation) => mutation.kind === 'resource')).toBeLessThan(
      mutations.findIndex((mutation) => mutation.kind === 'condition' && mutation.conditionId === 'sealed'),
    ); // p.108 listed order: effect 4 before effect 5 despite recorded "5,4"
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
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
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

  it('The Tower: reversing actor INSERTION order changes nothing — the migrated reference reads resolve by recorded slot identity, not iteration order', () => {
    // The migrated source/attack-target reads are singular slot dereferences
    // (context.actorId / attackTargetId → adapter), deterministic by the
    // RECORDED identity; object-iteration order of state.actors cannot select
    // who the ability user or its target is. Insert the second foe BEFORE the
    // target so object order differs from the canonical fixture, and assert
    // the same seal/mark/damage outcome and replay state.
    let setup = createEncounter('Seer insertion-order fixture');
    const hero = actorFromCharacter(validCharacter('Fate Weaver'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const second = createFoe('Grim', { x: 5, y: 1 });
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: hero }).state;
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: second }).state; // second BEFORE target
    setup = executeCommand(setup, { type: 'ADD_ACTOR', actor: foe }).state;
    setup = startEncounterTo(setup, hero.id);
    const result = executeCommand(setup, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'seer:the-tower', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].hp).toBe(31); // 32 - 1
    expect(result.state.actors[foe.id].statuses).toContain('sealed');
    expect(result.state.actors[foe.id].marks.some(({ markId }) => markId === 'the-tower')).toBe(true);
    expect(result.state.actors[second.id].hp).toBe(32); // untouched
    expect(applyEvents(setup, result.events)).toEqual(result.state);
  });
});
