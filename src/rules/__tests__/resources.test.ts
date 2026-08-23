import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { initialCharacterResources, perEncounterCharacterResourceIds, resourceMaximum, SHARED_RESOURCE_IDS, SHARED_RESOURCE_RULES } from '../core.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * Source-derived golden fixtures for the shared resource registry (ICON p.99
 * Resolve, p.102 Blessing, p.103 Combo, p.105 Vigilance, and p.204 Aether).
 * Every resource has a typed registry entry (cap, per-encounter scope, and
 * source text); the reducer resets per-encounter resources at encounter
 * start/end, caps gains at the registry maximum, and grants one combo token on
 * the base version of a combo ability. Each scenario must replay to the
 * identical state through applyEvents.
 */

interface ResourceFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

function resourceEncounter(options: { foe?: Position; second?: Position | null; ally?: Position | null } = {}): ResourceFixture {
  let state = createEncounter('Resource fixture');
  const hero = actorFromCharacter(validCharacter('Flying Skald'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe, second, ally };
}

describe('shared resources (p.99–105, p.204)', () => {
  it('registers every shared resource with its source page, cap, and scope', () => {
    expect(SHARED_RESOURCE_IDS).toEqual(['aether', 'combo', 'blessing', 'resolve', 'personal-resolve', 'vigilance', 'bonus-damage', 'effort', 'strain']);
    const byId = Object.fromEntries(SHARED_RESOURCE_RULES.map((rule) => [rule.id, rule]));
    expect(byId.aether?.source.page).toBe(204);
    expect(byId.combo?.source.page).toBe(103);
    expect(byId.blessing?.source.page).toBe(102);
    expect(byId['bonus-damage']?.source.page).toBe(102);
    expect(byId.resolve?.source.page).toBe(99);
    expect(byId['personal-resolve']?.source.page).toBe(99);
    expect(byId.vigilance?.source.page).toBe(105);
    expect(byId.effort?.source.page).toBe(56);
    expect(byId.strain?.source.page).toBe(56);
    expect(byId.effort?.resource.tier).toBe('narrative');
    expect(byId.strain?.resource.tier).toBe('narrative');
    expect(byId.aether?.resource.tier).toBe('encounter');
    // Only Combo caps: one token at once (p.103).
    expect(resourceMaximum('combo')).toBe(1);
    expect(resourceMaximum('aether')).toBeNull();
    expect(resourceMaximum('blessing')).toBeNull();
    expect(resourceMaximum('bonus-damage')).toBeNull();
    // Per-encounter resources reset at encounter start/end; personal resolve
    // and the narrative effort/strain survive combat (resetting only on camp,
    // interlude, or expedition boundaries). Bonus-damage is a per-encounter
    // counter that resets with the rest.
    expect(perEncounterCharacterResourceIds().sort()).toEqual(['aether', 'blessing', 'bonus-damage', 'combo', 'vigilance'].sort());
    expect(initialCharacterResources(3)).toMatchObject({ aether: 0, combo: 0, blessing: 0, vigilance: 0, 'bonus-damage': 0, 'personal-resolve': 3 });
  });

  it('Combo: using the base version of a combo ability grants one token', () => {
    const { state, hero, foe } = resourceEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:holy', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].resources.combo).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Combo: the cap holds at one token across repeated base uses', () => {
    const { state, hero, foe, ally } = resourceEncounter({ second: null, ally: { x: 3, y: 1 } });
    const first = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:holy', targetIds: [foe.id] }, scriptedDice()).state;
    expect(first.actors[hero.id].resources.combo).toBe(1);
    const second = executeCommand(first, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:felicity', targetIds: [ally!.id] }, scriptedDice()).state;
    expect(second.actors[hero.id].resources.combo).toBe(1); // already holds a token; cannot hold two
  });

  it('Combo: abilities without a combo version never grant a token', () => {
    const { state, hero, foe } = resourceEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:gentleness', targetIds: [] }, scriptedDice()).state;
    expect(result.actors[hero.id].resources.combo).toBe(0);
  });

  it('Combo: the combo version spends the token and never re-grants on that use', () => {
    const { state, hero, foe, ally } = resourceEncounter({ foe: { x: 3, y: 1 }, second: null, ally: { x: 4, y: 1 } });
    const based = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:holy', targetIds: [foe.id] }, scriptedDice()).state;
    expect(based.actors[hero.id].resources.combo).toBe(1);
    // FLEET is a non-attack combo action, so it may follow the base attack this turn.
    const comboUse = executeCommand(based, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'chanter:felicity',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [ally!.id] } },
    }, scriptedDice());
    expect(comboUse.state.actors[hero.id].resources.combo).toBe(0); // FLEET spent the token
    expect(comboUse.state.actors[ally!.id].resources.blessing).toBe(1); // FLEET still blesses
    expect(applyEvents(based, comboUse.events)).toEqual(comboUse.state);
  });

  it('Combo: tokens are discarded at the end of combat', () => {
    const { state, hero, foe } = resourceEncounter({ second: null });
    const gained = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:holy', targetIds: [foe.id] }, scriptedDice()).state;
    expect(gained.actors[hero.id].resources.combo).toBe(1);
    const ended = executeCommand(gained, { type: 'END_ENCOUNTER' }).state;
    expect(ended.actors[hero.id].resources.combo).toBe(0);
  });

  it('caps gains at the registry maximum even when a mutation asks for more', () => {
    const { state, hero } = resourceEncounter({ second: null });
    const capped = applyEvents(state, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: hero.id,
      sourceId: 'fixture:combo-gain',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'resource', sourceId: 'fixture', actorId: hero.id, resourceId: 'combo', operation: 'gain', amount: 3, minimum: 0, maximum: null }],
    }]);
    expect(capped.actors[hero.id].resources.combo).toBe(1);
  });

  it('Aether: a Wright starts at 0 and gains 1 at the start of each of their turns', () => {
    const { state, hero, foe } = resourceEncounter({ second: null });
    state.actors[hero.id].traitIds.push('wright:trait:aether');
    expect(state.actors[hero.id].resources.aether).toBe(0);
    const heroEnded = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(heroEnded.actors[hero.id].resources.aether).toBe(0); // hero has not started a turn since
    expect(heroEnded.actors[foe.id].resources.aether ?? 0).toBe(0); // foe has no Aether trait
    const foeEnded = executeCommand(heroEnded, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(foeEnded.actors[hero.id].resources.aether).toBe(1); // hero's next turn start
  });

  it('Aether: Chain Reaction grants 1 once per round after damaging two foes', () => {
    const { state, hero, foe, second } = resourceEncounter({ foe: { x: 2, y: 1 }, second: { x: 3, y: 1 } });
    state.actors[hero.id].traitIds.push('wright:trait:chain-reaction');
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:land-waster', targetIds: [foe.id] }, scriptedDice(15, 3, 5));
    expect(result.state.actors[hero.id].resources.aether).toBe(1);
    expect(result.state.actors[hero.id].ruleState['chain-reaction-used']).toBe(true);
  });

  it('Vigilance: spending a charge validates that a charge exists', () => {
    const { state, hero, foe } = resourceEncounter({ second: null });
    expect(() => executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: foe.id, use: 'punish' }, scriptedDice(4))).toThrow('No vigilance charges remain');
    state.actors[hero.id].resources.vigilance = 1;
    const spent = executeCommand(state, { type: 'SPEND_VIGILANCE', actorId: hero.id, targetId: foe.id, use: 'punish' }, scriptedDice(4));
    expect(spent.state.actors[hero.id].resources.vigilance).toBe(0);
    expect(spent.state.actors[foe.id].hp).toBe(28); // d6 roll of 4, punished
  });

  it('Blessing: Felicity grants a token to an ally in range', () => {
    const { state, hero, ally } = resourceEncounter({ second: null, ally: { x: 3, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:felicity', targetIds: [ally!.id] }, scriptedDice());
    expect(result.state.actors[ally!.id].resources.blessing).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Blessing: Symphony spends tokens, and any remainder is discarded at the end of combat', () => {
    const { state, hero, ally } = resourceEncounter({ second: null, ally: { x: 3, y: 1 } });
    state.actors[ally!.id].resources.blessing = 1;
    const symph = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'chanter:symphony', targetIds: [] }, scriptedDice()).state;
    expect(symph.actors[ally!.id].resources.blessing).toBe(0);
    const ended = executeCommand(symph, { type: 'END_ENCOUNTER' }).state;
    expect(ended.actors[hero.id].resources.blessing).toBe(0);
  });

  it('Bonus damage: the per-encounter counter is discarded at the end of combat', () => {
    const { state, hero, foe } = resourceEncounter({ second: null });
    state.actors[hero.id].resources['bonus-damage'] = 2;
    const ended = executeCommand(state, { type: 'END_ENCOUNTER' }).state;
    expect(ended.actors[hero.id].resources['bonus-damage']).toBe(0);
  });

  it('Resolve: party resolve rises each round and depletes after combat; personal resolve survives', () => {
    const { state, hero, foe } = resourceEncounter({ second: null });
    expect(state.partyResolve).toBe(1); // start of round 1
    state.actors[hero.id].resources['personal-resolve'] = 3;
    const afterHero = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    const afterFoe = executeCommand(afterHero, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(afterFoe.partyResolve).toBe(2); // start of round 2
    expect(afterFoe.actors[hero.id].resources['personal-resolve']).toBe(3);
    const ended = executeCommand(afterFoe, { type: 'END_ENCOUNTER' }).state;
    expect(ended.partyResolve).toBe(0);
    expect(ended.actors[hero.id].resources['personal-resolve']).toBe(3); // survives combat
  });
});
