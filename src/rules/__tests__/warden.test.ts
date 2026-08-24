import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, endTurnOnly, startEncounterTo} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Warden
 * ability set (ICON p.165–171), the fourth Vagabond job. Beasts are `beast`
 * entities and portals are `underway` entities. Cross-command lifecycles
 * (Sidhe's toxin, Stampede's spirit beast, Morrigan's delay, Strength of the
 * Pack's refresh, and Underway's second portal) resolve through the reducer's
 * turn-start/turn-end hooks. Each scenario must replay to the identical state
 * through applyEvents.
 */

interface WardenFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

function wardenEncounter(options: { foe?: Position; second?: Position | null; ally?: Position | null } = {}): WardenFixture {
  let state = createEncounter('Warden fixture');
  const hero = actorFromCharacter(validCharacter('Wild Hunter'), { x: 1, y: 1 });
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

const beastsOf = (state: EncounterState, ownerId: string) =>
  Object.values(state.entities).filter((entity) => entity.type === 'beast' && entity.ownerId === ownerId);

describe('Warden ability automation (p.165–171)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('warden:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const wardenIds = JOBS.find((job) => job.id === 'warden')!.abilities.map(({ id }) => id);
    expect(wardenIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Apex: a range-3 boon attack that dazes and summons a beast adjacent to the target', () => {
    const { state, hero, foe } = wardenEncounter({ foe: { x: 4, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:apex', targetIds: [foe.id] }, scriptedDice(15, 4, 4));
    expect(mutationsOf(result.events, 'warden:apex')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'attack', d20: 15, boon: 4, total: 19, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
      { kind: 'condition', actorId: foe.id, conditionId: 'dazed' },
      { kind: 'entity', entityType: 'beast' },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + fray 4)
    expect(result.state.actors[foe.id].statuses).toContain('dazed');
    expect(beastsOf(result.state, hero.id)).toHaveLength(1);
    expect(beastsOf(result.state, hero.id)[0].positions[0]).toEqual({ x: 3, y: 0 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Apex: a Finishing Blow summons a second beast and grants stealth', () => {
    const fixture = wardenEncounter({ foe: { x: 4, y: 1 }, second: null });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const result = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'warden:apex', targetIds: [fixture.foe.id] }, scriptedDice(15, 4, 4));
    expect(beastsOf(result.state, fixture.hero.id)).toHaveLength(2);
    expect(result.state.actors[fixture.hero.id].conditions.some(({ id }) => id === 'stealth')).toBe(true);
  });

  it('Gwynt: dashes 2 toward the foe and deals 2 damage', () => {
    const { state, hero, foe } = wardenEncounter({ foe: { x: 3, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:gwynt', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(30); // 32 - 2
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Gwynt: an ally in range 3 of the foe dashes too and deals 2 damage', () => {
    const { state, hero, foe, ally } = wardenEncounter({ foe: { x: 3, y: 1 }, second: null, ally: { x: 4, y: 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:gwynt', targetIds: [foe.id, ally!.id] }, scriptedDice());
    expect(result.state.actors[ally!.id].position).toEqual({ x: 2, y: 2 }); // dashed 2 west (dominant axis)
    expect(result.state.actors[foe.id].hp).toBe(28); // 32 - 2 (hero) - 2 (ally)
  });

  it('Circle The Oak: a 2-action attack dealing 2[D] on a hit', () => {
    const { state, hero, foe } = wardenEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:circle-the-oak', targetIds: [foe.id] }, scriptedDice(15, 4, 4));
    expect(mutationsOf(result.events, 'warden:circle-the-oak')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 15, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - 8
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Circle The Oak: a Finishing Blow dashes 5 and shoves the foe 2', () => {
    const fixture = wardenEncounter({ second: null });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const result = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'warden:circle-the-oak', targetIds: [fixture.foe.id] }, scriptedDice(15, 4, 4));
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 4, y: 1 }); // shoved 2 along +x
  });

  it('Mist Strider: creates a small-blast mist cloud at the user, replacing any prior cloud', () => {
    const { state, hero } = wardenEncounter({ second: null });
    const placed = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'warden:mist-strider',
      actionId: 'default',
      timing: 'use',
      input: { positions: { 'area-center': [{ x: 1, y: 1 }] } },
    }, scriptedDice()).state;
    const clouds = placed.terrainEffects.filter((effect) => effect.terrain === 'mist-cloud');
    expect(clouds).toHaveLength(1);
    expect(clouds[0].positions).toHaveLength(9); // small blast
    expect(applyEvents(state, executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'warden:mist-strider',
      actionId: 'default',
      timing: 'use',
      input: { positions: { 'area-center': [{ x: 1, y: 1 }] } },
    }, scriptedDice()).events)).toEqual(placed);
  });

  it('Stampede: marks a foe, then the spirit beast charges at the end of its turn', () => {
    const { state, hero, foe } = wardenEncounter({ foe: { x: 3, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:stampede', targetIds: [foe.id] }, scriptedDice()).state;
    expect(marked.actors[foe.id].marks.some(({ markId, ownerId }) => markId === 'stampede' && ownerId === hero.id)).toBe(true);

    const heroTurn = endTurnTo(marked, foe.id, scriptedDice());
    const resolved = endTurnTo(heroTurn, hero.id, scriptedDice());
    expect(resolved.actors[foe.id].hp).toBe(30); // 32 - 2
    expect(resolved.actors[foe.id].position).toEqual({ x: 4, y: 1 }); // shoved 1 away
    expect(beastsOf(resolved, hero.id)).toHaveLength(1);
    expect(beastsOf(resolved, hero.id)[0].positions[0]).toEqual({ x: 3, y: 1 }); // coalesced adjacent to the foe's origin
  });

  it('Stampede: triggers once per round, charging again on the next round', () => {
    const { state, hero, foe } = wardenEncounter({ foe: { x: 3, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:stampede', targetIds: [foe.id] }, scriptedDice()).state;
    const heroTurn = endTurnTo(marked, foe.id, scriptedDice());
    const first = endTurnTo(heroTurn, hero.id, scriptedDice());
    expect(beastsOf(first, hero.id)).toHaveLength(1);
    const second = endTurnTo(first, foe.id, scriptedDice());
    const again = endTurnTo(second, hero.id, scriptedDice());
    expect(beastsOf(again, hero.id)).toHaveLength(2); // a fresh charge on the next round
    expect(again.actors[foe.id].hp).toBe(28); // 30 - 2
  });

  it('Strength Of The Pack: enters the stance, summons a beast, and dashes allies 1', () => {
    const { state, hero, ally } = wardenEncounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 1, y: 2 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:strength-of-the-pack', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'strength-of-the-pack' });
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[ally!.id].position).toEqual({ x: 2, y: 2 });
    expect(beastsOf(result.state, hero.id)).toHaveLength(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Strength Of The Pack: the stance refreshes with a new beast at the start of your next turn', () => {
    const { state, hero, foe } = wardenEncounter({ second: null });
    const entered = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:strength-of-the-pack', targetIds: [] }, scriptedDice()).state;
    expect(beastsOf(entered, hero.id)).toHaveLength(1);
    const heroTurn = endTurnTo(entered, foe.id, scriptedDice());
    const refreshed = endTurnTo(heroTurn, hero.id, scriptedDice());
    expect(beastsOf(refreshed, hero.id)).toHaveLength(2);
    expect(refreshed.actors[hero.id].stance).toMatchObject({ stanceId: 'strength-of-the-pack' });
  });

  it('Underway: creates a portal, and a second portal grows at the end of your turn', () => {
    const { state, hero } = wardenEncounter({ second: null });
    const placed = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:underway', targetIds: [] }, scriptedDice()).state;
    const portals = Object.values(placed.entities).filter((entity) => entity.type === 'underway');
    expect(portals).toHaveLength(1);

    const ended = endTurnOnly(placed, scriptedDice());
    const after = Object.values(ended.entities).filter((entity) => entity.type === 'underway');
    expect(after).toHaveLength(2);
  });

  it('Morrigan: ends the turn, and the flock lashes out at the start of your slow next turn', () => {
    const { state, hero, foe } = wardenEncounter({ foe: { x: 2, y: 1 }, second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:morrigan', targetIds: [] }, scriptedDice());
    expect(used.state.actors[hero.id].ruleState['morrigan:pending']).toBe(true);
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(used.state.activeActorId).toBeNull();
    expect(used.state.eligibleSide).toBe('foes');

    // The foe's turn ends round 1; round 2 opens with the player side, and the
    // flock lashes out at the start of the hero's next turn.
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const afterFoe = endTurnOnly(foeTurn, scriptedDice());
    expect(afterFoe.round).toBe(2);
    expect(afterFoe.eligibleSide).toBe('heroes');
    const flock = executeCommand(afterFoe, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(flock.round).toBe(2);
    expect(flock.actors[hero.id].ruleState['slow-turn']).toBe(true);
    expect(flock.actors[hero.id].conditions.some(({ id }) => id === 'stealth')).toBe(true);
    expect(flock.actors[foe.id].position).toEqual({ x: 4, y: 1 }); // shoved 2 away
    expect(flock.actors[foe.id].statuses).toContain('blind');
  });

  it('Sidhe: a melee boon attack that blinds, injects the toxin, and detonates it on the foe’s turn', () => {
    const { state, hero, foe } = wardenEncounter({ second: null });
    const injected = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'warden:sidhe', targetIds: [foe.id] }, scriptedDice(15, 4, 4)).state;
    expect(injected.actors[foe.id].hp).toBe(28); // 32 - [D] 4
    expect(injected.actors[foe.id].statuses).toContain('blind');
    expect(injected.actors[foe.id].marks.some(({ markId, ownerId }) => markId === 'sidhe-toxin' && ownerId === hero.id)).toBe(true);

    const heroTurn = endTurnTo(injected, foe.id, scriptedDice());
    // The toxin detonates when the marked foe ends its turn.
    const detonated = endTurnOnly(heroTurn, scriptedDice());
    expect(detonated.actors[foe.id].hp).toBe(22); // 28 - 6 (no adjacent ally)
    expect(detonated.actors[foe.id].marks.some(({ markId }) => markId === 'sidhe-toxin')).toBe(false);
  });

  it('Sidhe: the toxin is halved to 3 when the foe ends its turn adjacent to an ally', () => {
    const fixture = wardenEncounter({ foe: { x: 2, y: 1 }, second: { x: 2, y: 2 } });
    const injected = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'warden:sidhe', targetIds: [fixture.foe.id] }, scriptedDice(15, 4, 4)).state;
    const heroTurn = endTurnTo(injected, fixture.foe.id, scriptedDice());
    // The toxin detonates when the marked foe ends its turn.
    const detonated = endTurnOnly(heroTurn, scriptedDice());
    expect(detonated.actors[fixture.foe.id].hp).toBe(25); // 28 - 3 (adjacent to Grim)
  });
});
