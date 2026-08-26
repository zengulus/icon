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
 * Source-derived golden fixtures for the independently executable Shade
 * ability set (ICON p.159–164), the third Vagabond job. Shadows are `shadow`
 * entities; Assassinate's delayed shot, Incubus's adjacency detonation, and
 * Umbral Echo's turn-end refresh resolve through reducer lifecycle hooks.
 */

interface ShadeFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

function shadeEncounter(options: { foe?: Position; second?: Position | null; ally?: Position | null } = {}): ShadeFixture {
  let state = createEncounter('Shade fixture');
  const hero = actorFromCharacter(validCharacter('Nightblade'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  // Drop the Stalwart Fortify trait so the hero's own rampart doesn't block the
  // job's teleports (Shade is a Vagabond job; the fixture focuses on its mechanics).
  hero.traitIds = hero.traitIds.filter((id) => id !== 'stalwart:trait:fortify');
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

describe('Shade ability automation (p.159–164)', () => {
  it('marks all nine abilities executable in the catalog and audit', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('shade:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const shadeIds = JOBS.find((job) => job.id === 'shade')!.abilities.map(({ id }) => id);
    expect(shadeIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(9);
  });

  it('Umbra: teleports toward the target, attacks with a boon, and blinds', () => {
    const { state, hero, foe } = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:umbra', targetIds: [foe.id] }, scriptedDice(15, 4, 4));
    expect(result.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(24); // 32 - (4 + 4)
    expect(result.state.actors[foe.id].statuses).toContain('blind');
    expect(mutationsOf(result.events, 'shade:umbra').some((mutation) => mutation.kind === 'move' && mutation.movement === 'teleport')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Umbra: a Finishing Blow summons a shadow adjacent to the target', () => {
    const fixture = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const result = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'shade:umbra', targetIds: [fixture.foe.id] }, scriptedDice(15, 4, 4));
    const shadows = Object.values(result.state.entities).filter((entity) => entity.type === 'shadow' && entity.ownerId === fixture.hero.id);
    expect(shadows).toHaveLength(1);
  });

  it('Umbra Combo (Penumbra): a failed save teleports the foe up to 3 toward the user', () => {
    const { state, hero, foe } = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'shade:umbra',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
    }, scriptedDice(5, 15, 4, 4)); // save 5 (fail) → teleport; attack 15 hits for [D]+fray
    expect(mutationsOf(result.events, 'shade:umbra').find((mutation) => mutation.kind === 'save')).toMatchObject({ kind: 'save', actorId: foe.id, roll: 5, success: false });
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 });
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Umbra Combo (Penumbra): a successful save resists the teleport, and blinded foes fail automatically', () => {
    const { state, hero, foe } = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    state.actors[hero.id].resources.combo = 1;
    const resisted = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'shade:umbra',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
    }, scriptedDice(15, 15, 4, 4)); // save 15 (success) → no teleport
    expect(resisted.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(resisted.state.actors[foe.id].hp).toBe(24); // attack still lands

    const blindedFixture = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    blindedFixture.state.actors[blindedFixture.hero.id].resources.combo = 1;
    blindedFixture.state.actors[blindedFixture.foe.id].statuses.push('blind');
    const blinded = executeCommand(blindedFixture.state, {
      type: 'EXECUTE_RULE',
      actorId: blindedFixture.hero.id,
      sourceId: 'shade:umbra',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [blindedFixture.foe.id] } },
      attackTargetId: blindedFixture.foe.id,
    }, scriptedDice(15, 4, 4)); // blinded: no save roll; a 15 would save, but blinded foes fail
    expect(mutationsOf(blinded.events, 'shade:umbra').find((mutation) => mutation.kind === 'save')).toMatchObject({ kind: 'save', actorId: blindedFixture.foe.id, success: false });
    expect(blinded.state.actors[blindedFixture.foe.id].position).toEqual({ x: 2, y: 1 });
    expect(applyEvents(blindedFixture.state, blinded.events)).toEqual(blinded.state);
  });

  it('Umbra Combo (Penumbra): uses the shared Rot save curse', () => {
    const { state, hero, foe } = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    state.actors[hero.id].resources.combo = 1;
    state.actors[foe.id].marks.push({
      id: 'fixture-rot', sourceId: 'harvester:rot', ownerId: hero.id,
      markId: 'rot', duration: null, state: { kind: 'foe' },
    });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE', actorId: hero.id, sourceId: 'shade:umbra',
      actionId: 'combo', timing: 'use', input: { actorIds: { target: [foe.id] } }, attackTargetId: foe.id,
    }, scriptedDice(10, 1, 15, 4, 4));

    expect(mutationsOf(result.events, 'shade:umbra').find((mutation) => mutation.kind === 'save')).toMatchObject({
      windowId: `shade:umbra:combo:penumbra:${foe.id}`, roll: 10, boon: -1, total: 9, success: false,
    });
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Harrow: marks a character, and a Finishing Blow teleports and damages them', () => {
    const { state, hero, foe } = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:harrow', targetIds: [foe.id] }, scriptedDice()).state;
    expect(marked.actors[foe.id].marks.some(({ markId, ownerId }) => markId === 'harrow' && ownerId === hero.id)).toBe(true);

    const fixture = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const finishing = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'shade:harrow', targetIds: [fixture.foe.id] }, scriptedDice()).state;
    expect(finishing.actors[fixture.foe.id].position).toEqual({ x: 3, y: 1 });
    expect(finishing.actors[fixture.foe.id].hp).toBe(8); // 10 - 2
  });

  it('Death Blossom: a burst attack that splashes fray to every other foe in the burst', () => {
    const { state, hero, foe, second } = shadeEncounter({ foe: { x: 2, y: 1 }, second: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:death-blossom', targetIds: [foe.id] }, scriptedDice(15, 4, 4));
    expect(result.state.actors[foe.id].hp).toBe(20); // 32 - (4 + 4 + 4)
    expect(result.state.actors[second!.id].hp).toBe(28); // 32 - 4 splash
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Death Blossom: a Finishing Blow drops a pit under the target', () => {
    const fixture = shadeEncounter({ foe: { x: 2, y: 1 }, second: null });
    fixture.state.actors[fixture.foe.id].hp = 10;
    const result = executeCommand(fixture.state, { type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'shade:death-blossom', targetIds: [fixture.foe.id] }, scriptedDice(15, 4, 4));
    expect(result.state.terrainEffects.some((effect) => effect.terrain === 'pit' && effect.positions.some((cell) => cell.x === 2 && cell.y === 1))).toBe(true);
  });

  it('Nightmare: summons two shadows in range 2 and raises the aura', () => {
    const { state, hero } = shadeEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:nightmare', targetIds: [] }, scriptedDice());
    const shadows = Object.values(result.state.entities).filter((entity) => entity.type === 'shadow' && entity.ownerId === hero.id);
    expect(shadows).toHaveLength(2);
    expect(result.state.actors[hero.id].ruleState['nightmare:aura']).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Shadow Play: swaps two characters, dazing foes and granting allies stealth', () => {
    const { state, hero, foe, ally } = shadeEncounter({ foe: { x: 3, y: 1 }, ally: { x: 4, y: 1 }, second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:shadow-play', targetIds: [foe.id, ally!.id] }, scriptedDice());
    expect(result.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.state.actors[ally!.id].position).toEqual({ x: 3, y: 1 });
    // p.163 has no movement word: this is a REMOVE/PLACE swap through the
    // shared Swap primitive — neither leg is a teleport (contrast Masquerade,
    // p.151, whose legs are movement 'teleport').
    expect(mutationsOf(result.events, 'shade:shadow-play').filter((mutation) => mutation.kind === 'move')).toMatchObject([
      { actorId: foe.id, movement: 'place' },
      { actorId: ally!.id, movement: 'place' },
    ]);
    expect(result.state.actors[foe.id].statuses).toContain('dazed');
    expect(result.state.actors[ally!.id].conditions.some(({ id }) => id === 'stealth')).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Shadow Play: the remove/place swap crosses a Rampart boundary that would deny a teleport (p.104 vs p.163)', () => {
    const { state, foe, second, ally } = shadeEncounter({ foe: { x: 3, y: 1 }, ally: { x: 4, y: 1 }, second: { x: 4, y: 2 } });
    // The extra foe carries a hostile rampart adjacent to the ally's
    // destination cell (3,1). If the swap legs were teleports, the ally could
    // not enter; being remove/place repositioning, p.104 does not apply.
    state.actors[second!.id].conditions.push({ id: 'rampart', sourceId: 'fixture:rampart', ownerId: second!.id, potency: 'normal', duration: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: state.activeActorId!, abilityId: 'shade:shadow-play', targetIds: [foe.id, ally!.id] }, scriptedDice());
    expect(result.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(result.state.actors[ally!.id].position).toEqual({ x: 3, y: 1 }); // crossed freely
  });

  it('Umbral Echo: enters the stance with a d4 power die at 2, refreshing at turn end', () => {
    const { state, hero } = shadeEncounter({ foe: { x: 5, y: 1 }, second: null });
    const entered = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:umbral-echo', targetIds: [] }, scriptedDice()).state;
    expect(entered.actors[hero.id].stance).toMatchObject({ stanceId: 'umbral-echo' });
    expect(entered.actors[hero.id].ruleState['umbral-echo:die']).toBe(2);

    const ended = endTurnOnly(entered, scriptedDice());
    expect(ended.actors[hero.id].ruleState['umbral-echo:die']).toBe(3); // no adjacent foe
  });

  it('Assassinate: ends the turn, then teleports adjacent, blinds, and deals 2 three times at the foe turn end', () => {
    const { state, hero, foe } = shadeEncounter({ foe: { x: 4, y: 1 }, second: null });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:assassinate', targetIds: [foe.id] }, scriptedDice()).state;
    // The ability ended the hero's turn; the GM selects the foe (TAKE_TURN).
    expect(marked.activeActorId).toBeNull();
    expect(marked.eligibleSide).toBe('foes');
    expect(marked.actors[foe.id].marks.some(({ markId }) => markId === 'assassinate')).toBe(true);

    // The delayed effect resolves at the foe's turn end.
    const foeTurn = executeCommand(marked, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const resolved = endTurnOnly(foeTurn, scriptedDice());
    expect(resolved.actors[foe.id].hp).toBe(26); // 32 - 6
    expect(resolved.actors[foe.id].statuses).toContain('blind');
    expect(resolved.actors[hero.id].position).toEqual({ x: 7, y: 1 }); // adjacent then fly 2 away
    expect(resolved.actors[foe.id].marks.some(({ markId }) => markId === 'assassinate')).toBe(false);
  });

  it('Nocturne: raises a small-blast shadow-cloud terrain effect', () => {
    const { state, hero } = shadeEncounter({ second: null });
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'shade:nocturne',
      actionId: 'default',
      timing: 'interrupt',
      input: { positions: { 'area-center': [{ x: 2, y: 1 }] } },
    }, scriptedDice());
    const effect = result.state.terrainEffects.find((candidate) => candidate.terrain === 'shadow-cloud');
    expect(effect).toBeDefined();
    expect(effect!.positions).toHaveLength(9);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Incubus: attacks, marks, and detonates adjacent foes with 2 damage and dazed', () => {
    const { state, hero, foe, second } = shadeEncounter({ foe: { x: 2, y: 1 }, second: { x: 3, y: 1 } });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'shade:incubus', targetIds: [foe.id] }, scriptedDice(15, 4, 4)).state;
    expect(marked.actors[foe.id].hp).toBe(24); // 32 - (4 + 4)
    expect(marked.actors[foe.id].marks.some(({ markId, ownerId }) => markId === 'incubus' && ownerId === hero.id)).toBe(true);

    const heroTurn = endTurnTo(marked, foe.id, scriptedDice());
    // The mark detonates when the marked foe ends its turn.
    const resolved = endTurnOnly(heroTurn, scriptedDice());
    expect(resolved.actors[foe.id].hp).toBe(22); // 24 - 2
    expect(resolved.actors[second!.id].hp).toBe(30); // 32 - 2
    expect(resolved.actors[foe.id].statuses).toContain('dazed');
    expect(resolved.actors[second!.id].statuses).toContain('dazed');
    expect(resolved.actors[hero.id].ruleState['incubus:triggered']).toBe(true);
  });

  it('Incubus Combo (Succubus): deals 3 to every marked character and teleports them away', () => {
    const fixture = shadeEncounter({ foe: { x: 2, y: 1 }, second: null });
    fixture.state.actors[fixture.hero.id].resources.combo = 1;
    fixture.state.actors[fixture.foe.id].marks = [{
      id: 'mark', sourceId: 'shade:incubus', ownerId: fixture.hero.id, markId: 'incubus', duration: null, state: {},
    }];
    const result = executeCommand(fixture.state, {
      type: 'EXECUTE_RULE',
      actorId: fixture.hero.id,
      sourceId: 'shade:incubus',
      actionId: 'combo',
      timing: 'use',
      input: {},
    }, scriptedDice());
    expect(result.state.actors[fixture.foe.id].hp).toBe(29); // 32 - 3
    expect(result.state.actors[fixture.foe.id].position).toEqual({ x: 4, y: 1 }); // teleported 2 away
    expect(applyEvents(fixture.state, result.events)).toEqual(result.state);
  });
});
