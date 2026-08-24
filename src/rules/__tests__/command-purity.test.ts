import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import type { EncounterState } from '../types.js';
import { expectCommandPurity, expectRejectedCommandPurity, scriptedDice, validCharacter } from './fixtures.js';

interface PurityFixture {
  state: EncounterState;
  heroId: string;
  foeId: string;
}

/** A two-hero-two-foe active encounter with the full executable ability set,
 * positioned so movement, attacks, and abilities are all legal. */
function activeEncounter(): PurityFixture {
  let state = createEncounter('Purity fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const ally = actorFromCharacter(validCharacter('Bryn'), { x: 1, y: 3 });
  ally.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  ally.chapter = 3;
  const foe = createFoe('Relict', { x: 2, y: 1 });
  const second = createFoe('Grim', { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  // The new scheduler leaves the player side eligible without naming an actor
  // (ICON p.87): the player selects the first PC explicitly.
  state = executeCommand(state, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
  return { state, heroId: hero.id, foeId: foe.id };
}

function armMassiveOverhead(state: EncounterState, heroId: string): EncounterState {
  return executeCommand(state, {
    type: 'EXECUTE_RULE',
    actorId: heroId,
    sourceId: 'colossus:massive-overhead',
    actionId: 'default',
    timing: 'use',
    input: {},
  }, scriptedDice()).state;
}

describe('encounter command purity', () => {
  it('Massive Overhead USE_ABILITY planning does not mutate the armed state', () => {
    const { state, heroId, foeId } = activeEncounter();
    const armed = armMassiveOverhead(state, heroId);
    expect(armed.actors[heroId].ruleState['massive-overhead']).toBe(true);

    // ICON p.134: the next attack gains a bonus damage die. Planning that
    // attack used to write the +1 into the caller's actor resources, leaving
    // `armed` polluted after the call.
    const attack = expectCommandPurity(armed, {
      type: 'USE_ABILITY',
      actorId: heroId,
      abilityId: 'colossus:valkyrie',
      targetIds: [foeId],
    }, scriptedDice(12, 6, 4));
    expect(attack.state.actors[heroId].resources['bonus-damage']).toBe(0);
    expect(attack.state.actors[heroId].ruleState['massive-overhead']).toBeUndefined();
    expect(attack.state.terrainEffects.some((effect) => effect.terrain === 'pit')).toBe(true);
  });

  it('Massive Overhead EXECUTE_RULE planning does not mutate the armed state', () => {
    const { state, heroId, foeId } = activeEncounter();
    const armed = armMassiveOverhead(state, heroId);

    const attack = expectCommandPurity(armed, {
      type: 'EXECUTE_RULE',
      actorId: heroId,
      sourceId: 'colossus:valkyrie',
      actionId: 'default',
      timing: 'use',
      input: {},
      attackTargetId: foeId,
    }, scriptedDice(12, 4));
    expect(attack.state.actors[heroId].resources['bonus-damage']).toBe(0);
    expect(attack.state.actors[heroId].ruleState['massive-overhead']).toBeUndefined();
  });

  it('a pre-existing bonus-damage charge survives the Massive Overhead attack replay-exactly', () => {
    const { state, heroId, foeId } = activeEncounter();
    const armed = armMassiveOverhead(state, heroId);
    // Simulate a durable charge from another source (e.g. Demon Edge, p.127):
    // its +1 bonus damage lasts until the end of the owner's next turn, so it
    // must survive this attack — and replay from the pre-command snapshot must
    // land on the same number.
    armed.actors[heroId].resources['bonus-damage'] = 1;

    const attack = expectCommandPurity(armed, {
      type: 'USE_ABILITY',
      actorId: heroId,
      abilityId: 'colossus:valkyrie',
      targetIds: [foeId],
    }, scriptedDice(12, 6, 4));
    // The overhead die is baked into the recorded roll; the durable charge is
    // untouched by this attack.
    expect(attack.state.actors[heroId].resources['bonus-damage']).toBe(1);
  });

  it('accepts a sweep of representative commands without mutating their input', () => {
    // Setup-phase commands.
    const setup = createEncounter('Setup sweep');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const started = expectCommandPurity(setup, { type: 'ADD_ACTOR', actor: hero });
    const setup2 = expectCommandPurity(started.state, { type: 'ADD_ACTOR', actor: foe });
    expectCommandPurity(setup2.state, { type: 'SET_TERRAIN', cell: { position: { x: 5, y: 5 }, type: 'difficult', elevation: 0 } });
    expectCommandPurity(setup2.state, { type: 'REMOVE_ACTOR', actorId: foe.id });

    const { state, heroId, foeId } = activeEncounter();
    // Movement and the movement-entry trigger fold (a standard move once per
    // turn, then a dash).
    const move = expectCommandPurity(state, { type: 'MOVE', actorId: heroId, path: [{ x: 1, y: 2 }], mode: 'standard' }, scriptedDice());
    const move2 = expectCommandPurity(move.state, { type: 'MOVE', actorId: heroId, path: [{ x: 2, y: 2 }], mode: 'dash' }, scriptedDice());
    // Basic attack (the overhead-free bonus-die parameter path).
    expectCommandPurity(move2.state, { type: 'BASIC_ATTACK', actorId: heroId, targetId: foeId, weight: 'light' }, scriptedDice(10, 4));
    // A resolver-based non-attack ability.
    const upheavalFixture = activeEncounter();
    expectCommandPurity(upheavalFixture.state, { type: 'USE_ABILITY', actorId: upheavalFixture.heroId, abilityId: 'colossus:upheaval', targetIds: [] }, scriptedDice());
    // A resolver-based attack ability.
    const ruleFixture = activeEncounter();
    expectCommandPurity(ruleFixture.state, { type: 'EXECUTE_RULE', actorId: ruleFixture.heroId, sourceId: 'colossus:valkyrie', actionId: 'default', timing: 'use', input: {}, attackTargetId: ruleFixture.foeId }, scriptedDice(12, 4));
    // Recover (the preview-clone path).
    const recoverFixture = activeEncounter();
    expectCommandPurity(recoverFixture.state, { type: 'RECOVER', actorId: recoverFixture.heroId, input: {} }, scriptedDice());
    // Interact.
    const interactFixture = activeEncounter();
    expectCommandPurity(interactFixture.state, { type: 'INTERACT', actorId: interactFixture.heroId, position: { x: 2, y: 1 }, description: 'test' });
    // Rescue an adjacent defeated ally.
    const allyId = Object.values(state.actors).find((actor) => actor.id !== heroId && actor.id !== foeId && actor.side === 'heroes')!.id;
    const wounded = structuredClone(state);
    wounded.actors[allyId].defeated = true;
    wounded.actors[allyId].hp = 0;
    wounded.actors[allyId].position = { x: 1, y: 2 };
    expectCommandPurity(wounded, { type: 'RESCUE', actorId: heroId, targetId: allyId });
    // Vigilance spend.
    const vigilant = structuredClone(state);
    vigilant.actors[allyId].resources['vigilance'] = 1;
    expectCommandPurity(vigilant, { type: 'SPEND_VIGILANCE', actorId: allyId, targetId: foeId, use: 'punish' }, scriptedDice(4));
    // End turn (the planned turn transition).
    expectCommandPurity(state, { type: 'END_TURN', actorId: heroId }, scriptedDice());
  });

  it('accepts a Massive Overhead-armed BASIC_ATTACK without mutating the input', () => {
    const { state, heroId, foeId } = activeEncounter();
    const armed = armMassiveOverhead(state, heroId);
    const attack = expectCommandPurity(armed, { type: 'BASIC_ATTACK', actorId: heroId, targetId: foeId, weight: 'light' }, scriptedDice(10, 6, 4));
    expect(attack.state.actors[heroId].resources['bonus-damage']).toBe(0);
    expect(attack.state.actors[heroId].ruleState['massive-overhead']).toBeUndefined();
  });

  it('accepts APPLY_STATUS, START_ENCOUNTER, and END_ENCOUNTER without mutating their input', () => {
    const { state, heroId, foeId } = activeEncounter();
    expectCommandPurity(state, { type: 'APPLY_STATUS', actorId: heroId, targetId: foeId, status: 'weakened' });
    expectCommandPurity(state, { type: 'END_ENCOUNTER' });

    const setup = createEncounter('Start sweep');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foe = createFoe('Relict', { x: 3, y: 1 });
    const withHero = executeCommand(setup, { type: 'ADD_ACTOR', actor: hero }).state;
    const withFoe = executeCommand(withHero, { type: 'ADD_ACTOR', actor: foe }).state;
    const begun = expectCommandPurity(withFoe, { type: 'START_ENCOUNTER' });
    expect(begun.state.phase).toBe('active');
  });

  it('rejects representative invalid commands without mutating their input', () => {
    const { state, heroId, foeId } = activeEncounter();
    // Repeating a costed ability in the same turn.
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'colossus:valkyrie', targetIds: [foeId] }, scriptedDice(12, 4)).state;
    expectRejectedCommandPurity(used, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'colossus:valkyrie', targetIds: [foeId] }, scriptedDice(12, 4));
    // An attack ability without exactly one target.
    expectRejectedCommandPurity(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'colossus:valkyrie', targetIds: [] }, scriptedDice(12, 4));
    // A rule program the actor does not own.
    expectRejectedCommandPurity(state, { type: 'EXECUTE_RULE', actorId: heroId, sourceId: 'bastion:battering-ram', actionId: 'default', timing: 'use', input: {} });
    // A movement that is not legal (diagonal).
    expectRejectedCommandPurity(state, { type: 'MOVE', actorId: heroId, path: [{ x: 2, y: 2 }], mode: 'standard' });
    // An out-of-turn action.
    const foeTurn = executeCommand(state, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
    expectRejectedCommandPurity(foeTurn, { type: 'BASIC_ATTACK', actorId: heroId, targetId: foeId, weight: 'light' }, scriptedDice(10, 4));
    // A cost that cannot be paid (2-action ability with 1 action left).
    const spent = structuredClone(state);
    spent.actors[heroId].actionsRemaining = 1;
    expectRejectedCommandPurity(spent, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'colossus:takedown', targetIds: [foeId] }, scriptedDice(12, 4));
  });

  it('rejects an invalid start without mutating setup state', () => {
    const state = createEncounter('Setup purity');
    expectRejectedCommandPurity(state, { type: 'START_ENCOUNTER' });
    expect(state.phase).toBe('setup');
  });
});
