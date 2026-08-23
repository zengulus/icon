import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterEvent, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * F2 SaveWindow foundation fixtures (docs/rules-foundations.md §3): every
 * save kind resolves through the generalized record — `windowKind`, the
 * `modifiers` breakdown, the `threshold`, the denial `forced` flag, and the
 * continuation `branch` — and every accepted command must replay to the exact
 * same state through applyEvents (one replay pair per kind).
 */

interface SaveEncounter {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function saveEncounter(options: { foe?: Position } = {}): SaveEncounter {
  let state = createEncounter('Save window fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe };
}

const mutationsOf = (events: EncounterEvent[], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('F2 SaveWindow foundation (docs/rules-foundations.md §3)', () => {
  it('status-clear: the recorded window carries kind, modifiers (Rot curse), and the remove-on-success branch, and replays identically', () => {
    const { state, hero, foe } = saveEncounter();
    const foeActor = state.actors[foe.id];
    foeActor.statuses.push('blind');
    foeActor.conditions.push({ id: 'blind', sourceId: 'fixture', ownerId: hero.id, potency: 'normal', duration: null });
    // A Rot foe-mark (p.186) projects the shared save curse onto the foe's saves.
    foeActor.marks.push({ id: 'fixture-rot', sourceId: 'harvester:rot', ownerId: hero.id, markId: 'rot', duration: null, state: { kind: 'foe' } });

    const heroEnded = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(heroEnded.activeActorId).toBe(foe.id);
    // d20 12, curse boon die 1 → boon -1 → total 11 → the save succeeds.
    const ended = executeCommand(heroEnded, { type: 'END_TURN', actorId: foe.id }, scriptedDice(12, 1));
    const turnEndedEvent = ended.events.find((candidate) => candidate.type === 'TURN_ENDED' && candidate.actorId === foe.id);
    expect(turnEndedEvent?.type).toBe('TURN_ENDED');
    const turnEnded = turnEndedEvent as Extract<EncounterEvent, { type: 'TURN_ENDED' }>;
    const save = turnEnded.statusSaveMutations?.find((mutation) => mutation.kind === 'save');
    expect(save).toMatchObject({
      kind: 'save',
      actorId: foe.id,
      windowKind: 'status-clear',
      windowId: `core:end-turn:status:${foe.id}:blind`,
      statusId: 'blind',
      roll: 12,
      boon: -1,
      total: 11,
      success: true,
      threshold: 10,
      modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 1, blessing: false },
      branch: {
        boon: -1,
        threshold: 10,
        onSuccess: [{ kind: 'condition', target: { kind: 'trigger-targets' }, conditionId: 'blind', operation: 'remove', potency: 'normal' }],
        onFailure: [],
      },
    });
    expect(ended.state.actors[foe.id].statuses).not.toContain('blind');
    expect(applyEvents(heroEnded, ended.events)).toEqual(ended.state);
  });

  it('cure-immediate: a Cure’s saves are their own window kind and replay identically', () => {
    const { state, hero } = saveEncounter();
    const heroActor = state.actors[hero.id];
    heroActor.statuses.push('slashed', 'blind');
    heroActor.conditions.push(
      { id: 'slashed', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null },
      { id: 'blind', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null },
    );

    const recovered = executeCommand(state, { type: 'RECOVER', actorId: hero.id, input: {} }, scriptedDice(12, 12));
    const recoveredEvent = recovered.events.find((candidate) => candidate.type === 'ACTOR_RECOVERED');
    expect(recoveredEvent?.type).toBe('ACTOR_RECOVERED');
    const event = recoveredEvent as Extract<EncounterEvent, { type: 'ACTOR_RECOVERED' }>;
    const saves = (event.statusSaveMutations ?? []).filter((mutation) => mutation.kind === 'save');
    expect(saves).toHaveLength(2);
    expect(saves[0]).toMatchObject({
      kind: 'save', actorId: hero.id, windowKind: 'cure-immediate', statusId: 'slashed',
      roll: 12, boon: 0, total: 12, success: true, threshold: 10,
      modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
      branch: { boon: 0, threshold: 10, onSuccess: [{ kind: 'condition', conditionId: 'slashed', operation: 'remove' }], onFailure: [] },
    });
    expect(saves[1]).toMatchObject({ kind: 'save', actorId: hero.id, windowKind: 'cure-immediate', statusId: 'blind', roll: 12, success: true });
    expect(recovered.state.actors[hero.id].statuses).toEqual([]);
    expect(recovered.state.actors[hero.id].vigor).toBe(4); // the Cure vigor part
    expect(applyEvents(state, recovered.events)).toEqual(recovered.state);
  });

  it('effect: Penumbra’s save is a recorded effect-kind window and replays identically', () => {
    const { state, hero, foe } = saveEncounter();
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'shade:umbra',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
    }, scriptedDice(5, 15, 4, 4)); // save 5 fails → teleport; attack 15 hits for [D]+fray
    const save = mutationsOf(result.events, 'shade:umbra').find((mutation) => mutation.kind === 'save');
    expect(save).toMatchObject({
      kind: 'save',
      actorId: foe.id,
      windowKind: 'effect',
      windowId: `shade:umbra:combo:penumbra:${foe.id}`,
      roll: 5,
      boon: 0,
      total: 5,
      success: false,
      threshold: 10,
      modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
    });
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('denial policy: a blinded foe’s Penumbra save is forced (roll 0, forced true) without consuming dice', () => {
    const { state, hero, foe } = saveEncounter();
    state.actors[hero.id].resources.combo = 1;
    state.actors[foe.id].statuses.push('blind');
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'shade:umbra',
      actionId: 'combo',
      timing: 'use',
      input: { actorIds: { target: [foe.id] } },
      attackTargetId: foe.id,
    }, scriptedDice(15, 4, 4)); // no save die: blinded foes fail automatically
    const save = mutationsOf(result.events, 'shade:umbra').find((mutation) => mutation.kind === 'save');
    expect(save).toMatchObject({
      kind: 'save', actorId: foe.id, windowKind: 'effect', roll: 0, boon: 0, total: 0, success: false, forced: true, threshold: 10,
    });
    expect(result.state.actors[foe.id].position).toEqual({ x: 2, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('movement: the Six Hells exit save is a recorded movement-kind window; a failed save rejects the exit (p.129)', () => {
    const { state, hero, foe } = saveEncounter({ foe: { x: 2, y: 1 } });
    const heroActor = state.actors[hero.id];
    heroActor.ruleState['six-hells:stage'] = 'active';
    heroActor.ruleStateOwners['six-hells:stage'] = hero.id;
    state.terrainEffects.push({
      id: 'six-hells-trigram:fixture', sourceId: 'demon-slayer:six-hells-trigram', ownerId: hero.id,
      terrain: 'six-hells-trigram', positions: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], height: null, duration: null,
    });
    const exitPath = [{ x: 3, y: 1 }, { x: 4, y: 1 }];
    // Only the active actor can move: pass the turn to the trapped foe first.
    const heroEnded = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(heroEnded.activeActorId).toBe(foe.id);

    // A successful exit save rides the ACTOR_MOVED event as the recorded window.
    const escaped = executeCommand(heroEnded, { type: 'MOVE', actorId: foe.id, path: exitPath, mode: 'standard' }, scriptedDice(12));
    const moved = escaped.events.find((event) => event.type === 'ACTOR_MOVED');
    expect(moved?.type).toBe('ACTOR_MOVED');
    if (moved?.type === 'ACTOR_MOVED') {
      expect(moved.exitSave).toMatchObject({
        kind: 'save',
        actorId: foe.id,
        windowKind: 'movement',
        windowId: `demon-slayer:six-hells-trigram:exit:${foe.id}`,
        roll: 12,
        boon: 0,
        total: 12,
        success: true,
        threshold: 10,
        modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
      });
    }
    expect(escaped.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(applyEvents(heroEnded, escaped.events)).toEqual(escaped.state);

    // A failed exit save rejects the move: the outside space is not valid.
    expect(() => executeCommand(heroEnded, { type: 'MOVE', actorId: foe.id, path: exitPath, mode: 'standard' }, scriptedDice(5)))
      .toThrow(/trapped: the save to leave/);
    expect(heroEnded.actors[foe.id].position).toEqual({ x: 2, y: 1 });
  });
});
