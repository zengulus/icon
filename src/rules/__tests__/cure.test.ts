import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { resolveStatusSaveMutations } from '../automation/primitives/status-saves.js';
import type { RuleExecutionContext, RuleExecutionInput } from '../automation/primitives/types.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter, endTurnTo, startEncounterTo } from './fixtures.js';

/** Source-derived command fixtures for Cure / Diaga (ICON pp.94, 102, 144, 172, 186). */
function diagaEncounter(targetPosition: Position = { x: 5, y: 1 }) {
  let state = createEncounter('Diaga fixture');
  const caster = actorFromCharacter(validCharacter('Mender'), { x: 1, y: 1 });
  caster.traitIds.push('mendicant:trait:diaga');
  const target = actorFromCharacter(validCharacter('Patient'), targetPosition);
  const foe = createFoe('Witness', { x: 9, y: 9 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: caster }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: target }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, caster.id);
  return { state, caster, target, foe };
}

function ruleMutations(events: ReturnType<typeof executeCommand>['events']) {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED');
  if (!event || event.type !== 'RULE_MUTATIONS_APPLIED') throw new Error('Expected a rule-mutation event.');
  return event.mutations;
}

function recoveredEvent(events: ReturnType<typeof executeCommand>['events']) {
  const event = events.find((candidate) => candidate.type === 'ACTOR_RECOVERED');
  if (!event || event.type !== 'ACTOR_RECOVERED') throw new Error('Expected a Recover event.');
  return event;
}

function turnEndedEvent(events: ReturnType<typeof executeCommand>['events']) {
  const event = events.find((candidate) => candidate.type === 'TURN_ENDED');
  if (!event || event.type !== 'TURN_ENDED') throw new Error('Expected a turn-end event.');
  return event;
}

function coreStatusEncounter() {
  let state = createEncounter('Core status-save fixture');
  const hero = actorFromCharacter(validCharacter('Patient'), { x: 1, y: 1 });
  const foe = createFoe('Witness', { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe };
}

function markWithFoeRot(state: EncounterState, target: EncounterActor, owner: EncounterActor) {
  state.actors[target.id].marks.push({
    id: 'fixture:rot', sourceId: 'harvester:rot', ownerId: owner.id, markId: 'rot',
    duration: { kind: 'combat' }, state: { kind: 'foe' },
  });
}

function sweetTormentCoreEncounter() {
  let state = createEncounter('Sweet Torment core-status fixture');
  const tormentor = actorFromCharacter(validCharacter('Knave'), { x: 4, y: 1 });
  const target = createFoe('Afflicted foe', { x: 5, y: 1 });
  tormentor.activeEffects.push({
    id: 'fixture:sweet-torment', sourceId: 'knave:bleak-mercy', effectId: 'sweet-torment', ownerId: tormentor.id,
    duration: { kind: 'combat' }, modifiers: [{ operation: 'grant', stat: 'aura', value: { kind: 'constant', value: 1 } }], triggers: [], state: {},
  });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: tormentor }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: target }).state;
  state = startEncounterTo(state, tormentor.id);
  // Hand authority to the affected foe; the tormentor has no statuses, so
  // this setup turn does not consume fixture dice.
  state = endTurnTo(state, target.id, scriptedDice());
  return { state, tormentor, target };
}

function diagaCommand(caster: EncounterActor, target: EncounterActor, input: RuleExecutionInput = {}) {
  return {
    type: 'EXECUTE_RULE' as const,
    actorId: caster.id,
    sourceId: 'mendicant:trait:diaga',
    actionId: 'default',
    timing: 'use' as const,
    input,
    attackTargetId: target.id,
  };
}

describe('Cure and Diaga (ICON pp.94, 102, 144, 172, 186)', () => {
  it('Diaga costs one action, cures in range 4, spends an explicitly selected Blessing, and only saves normal statuses', () => {
    const { state, caster, target } = diagaEncounter();
    // p.94: after a wound, maximum HP is 30; at 15 the target is bloodied
    // and receives the p.172 vigor surge rather than 4 vigor.
    state.actors[target.id].wounds = 1;
    state.actors[target.id].hp = 15;
    state.actors[target.id].vigor = 0;
    state.actors[target.id].statuses = ['blind', 'weakened', 'slashed'];
    state.actors[target.id].conditions.push({
      id: 'slashed', sourceId: 'fixture:ongoing-slashed', ownerId: null,
      potency: 'plus', duration: { kind: 'combat' },
    });
    state.actors[target.id].resources.blessing = 1;

    // Blind: d20 7 + selected Blessing boon 3 = 10 (clear).
    // Weakened: d20 9 (fail).  Slashed+ is never rolled.
    const result = executeCommand(state, diagaCommand(caster, target, {
      statusSaveChoices: { [target.id]: { blind: { spendBlessing: true } } },
    }), scriptedDice(7, 3, 9));
    const mutations = ruleMutations(result.events);

    expect(result.state.actors[caster.id].actionsRemaining).toBe(1);
    expect(result.state.actors[target.id]).toMatchObject({ vigor: 10, resources: { blessing: 0 } });
    expect(result.state.actors[target.id].statuses).toEqual(['weakened', 'slashed']);
    expect(result.state.actors[target.id].conditions).toContainEqual(expect.objectContaining({ id: 'slashed', potency: 'plus' }));
    expect(mutations.filter((mutation) => mutation.kind === 'save')).toEqual([
      expect.objectContaining({ actorId: target.id, roll: 7, boon: 3, total: 10, success: true }),
      expect.objectContaining({ actorId: target.id, roll: 9, boon: 0, total: 9, success: false }),
    ]);
    expect(mutations).toContainEqual(expect.objectContaining({ kind: 'resource', actorId: target.id, resourceId: 'blessing', operation: 'spend', amount: 1 }));
    expect(mutations.some((mutation) => mutation.kind === 'save' && mutation.actorId === target.id && mutation.roll === 3)).toBe(false);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('validates the explicit save choices and Diaga target ownership/range before applying any result', () => {
    const unowned = diagaEncounter();
    unowned.state.actors[unowned.caster.id].traitIds = unowned.state.actors[unowned.caster.id].traitIds.filter((id) => id !== 'mendicant:trait:diaga');
    try {
      executeCommand(unowned.state, diagaCommand(unowned.caster, unowned.target), scriptedDice());
      throw new Error('Expected Diaga ownership to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'rule.not-owned' });
    }

    const outOfRange = diagaEncounter({ x: 6, y: 1 });
    try {
      executeCommand(outOfRange.state, diagaCommand(outOfRange.caster, outOfRange.target), scriptedDice());
      throw new Error('Expected out-of-range Diaga to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ability.range' });
    }

    const invalidChoice = diagaEncounter();
    invalidChoice.state.actors[invalidChoice.target.id].statuses = ['slashed'];
    invalidChoice.state.actors[invalidChoice.target.id].conditions.push({
      id: 'slashed', sourceId: 'fixture:ongoing-slashed', ownerId: null,
      potency: 'plus', duration: { kind: 'combat' },
    });
    invalidChoice.state.actors[invalidChoice.target.id].resources.blessing = 1;
    try {
      executeCommand(invalidChoice.state, diagaCommand(invalidChoice.caster, invalidChoice.target, {
        statusSaveChoices: { [invalidChoice.target.id]: { slashed: { spendBlessing: true } } },
      }), scriptedDice());
      throw new Error('Expected an ongoing status save choice to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'status-save.ongoing' });
    }
    expect(invalidChoice.state.actors[invalidChoice.caster.id].actionsRemaining).toBe(2);
  });

  it('applies Blind’s range cap to a direct reviewed-rule target', () => {
    const { state, caster, target } = diagaEncounter({ x: 4, y: 1 });
    state.actors[caster.id].statuses.push('blind');

    try {
      executeCommand(state, diagaCommand(caster, target), scriptedDice());
      throw new Error('Expected Blind to cap Diaga range at 2.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ability.range' });
    }
    expect(state.actors[caster.id].actionsRemaining).toBe(2);
  });

  it('does not let Cure bypass Shattered’s vigor denial, while its ordinary-status save can clear Shattered', () => {
    const { state, caster, target } = diagaEncounter();
    state.actors[target.id].hp = 15;
    state.actors[target.id].vigor = 0;
    state.actors[target.id].statuses = ['shattered'];

    const result = executeCommand(state, diagaCommand(caster, target), scriptedDice(10));
    expect(result.state.actors[target.id]).toMatchObject({ vigor: 0, statuses: [] });
    expect(ruleMutations(result.events)).toContainEqual(expect.objectContaining({
      kind: 'save', actorId: target.id, roll: 10, boon: 0, total: 10, success: true,
    }));
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Rot blocks Cure/vigor and contributes its source +1 curse to the reusable status-save path', () => {
    const { state, caster, target, foe } = diagaEncounter();
    state.actors[target.id].hp = 15;
    state.actors[target.id].vigor = 0;
    state.actors[target.id].statuses = ['blind'];
    state.actors[target.id].resources.blessing = 1;
    state.actors[target.id].marks.push({
      id: 'fixture:rot', sourceId: 'harvester:rot', ownerId: foe.id, markId: 'rot',
      duration: { kind: 'combat' }, state: { kind: 'foe' },
    });

    const blocked = executeCommand(state, diagaCommand(caster, target), scriptedDice());
    const blockedMutations = ruleMutations(blocked.events);
    expect(blocked.state.actors[caster.id].actionsRemaining).toBe(1);
    expect(blocked.state.actors[target.id]).toMatchObject({ vigor: 0, statuses: ['blind'], resources: { blessing: 1 } });
    expect(blockedMutations).toContainEqual(expect.objectContaining({ kind: 'cure', actorId: target.id }));
    expect(blockedMutations.some((mutation) => mutation.kind === 'save' || mutation.kind === 'resource')).toBe(false);
    expect(applyEvents(state, blocked.events)).toEqual(blocked.state);

    const projected = encounterRuleState(state);
    const saveContext: RuleExecutionContext = {
      state: projected, actorId: caster.id, sourceId: 'fixture:status-save', actionId: 'default', timing: 'use', input: {}, dice: scriptedDice(10, 1),
    };
    const saveMutations = resolveStatusSaveMutations(saveContext, projected.actors[target.id]!);
    expect(saveMutations).toContainEqual(expect.objectContaining({ kind: 'save', actorId: target.id, roll: 10, boon: -1, total: 9, success: false }));
    const saveEvent = {
      type: 'RULE_MUTATIONS_APPLIED' as const,
      actorId: caster.id,
      sourceId: 'fixture:status-save',
      actionId: 'default',
      timing: 'use' as const,
      tags: [],
      mutations: saveMutations,
    };
    const saved = applyEvents(state, [saveEvent]);
    expect(saved.actors[target.id].statuses).toEqual(['blind']);
  });

  it('Sweet Torment blocks Cure and immediate status saves for an affected foe', () => {
    let state: EncounterState = createEncounter('Sweet Torment Cure fixture');
    const caster = actorFromCharacter(validCharacter('Mender'), { x: 1, y: 1 });
    caster.traitIds.push('mendicant:trait:diaga');
    const tormentor = actorFromCharacter(validCharacter('Knave'), { x: 4, y: 1 });
    const target = createFoe('Afflicted foe', { x: 5, y: 1 });
    tormentor.activeEffects.push({
      id: 'fixture:sweet-torment', sourceId: 'knave:bleak-mercy', effectId: 'sweet-torment', ownerId: tormentor.id,
      duration: { kind: 'combat' }, modifiers: [{ operation: 'grant', stat: 'aura', value: { kind: 'constant', value: 1 } }], triggers: [], state: {},
    });
    target.hp = 15;
    target.vigor = 0;
    target.statuses = ['blind'];
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: caster }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: tormentor }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: target }).state;
    state = startEncounterTo(state, caster.id);

    const result = executeCommand(state, diagaCommand(caster, target), scriptedDice());
    const mutations = ruleMutations(result.events);
    expect(result.state.actors[caster.id].actionsRemaining).toBe(1);
    expect(result.state.actors[target.id]).toMatchObject({ vigor: 0, statuses: ['blind'] });
    expect(mutations).toContainEqual(expect.objectContaining({ kind: 'cure', actorId: target.id }));
    expect(mutations.some((mutation) => mutation.kind === 'save')).toBe(false);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('routes Recover through the same Cure sequence as Diaga, with explicit Blessing replay', () => {
    const ordinary = coreStatusEncounter();
    ordinary.state.actors[ordinary.hero.id].statuses = ['blind'];
    ordinary.state.actors[ordinary.hero.id].resources.blessing = 1;
    const recovered = executeCommand(ordinary.state, {
      type: 'RECOVER', actorId: ordinary.hero.id,
      input: { statusSaveChoices: { [ordinary.hero.id]: { blind: { spendBlessing: true } } } },
    }, scriptedDice(7, 3));
    const ordinaryEvent = recoveredEvent(recovered.events);
    expect(recovered.state.actors[ordinary.hero.id]).toMatchObject({ vigor: 4, statuses: [], resources: { blessing: 0 } });
    expect(ordinaryEvent.saves).toEqual([{ status: 'blind', roll: 7, cleared: true }]);
    expect(ordinaryEvent.statusSaveMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'cure', actorId: ordinary.hero.id }),
      expect.objectContaining({ kind: 'resource', actorId: ordinary.hero.id, resourceId: 'blessing', operation: 'spend', amount: 1 }),
      expect.objectContaining({ kind: 'save', actorId: ordinary.hero.id, statusId: 'blind', roll: 7, boon: 3, total: 10, success: true }),
    ]));
    expect(applyEvents(ordinary.state, recovered.events)).toEqual(recovered.state);

    // p.186 says a Rot-marked foe cannot be cured.  Recover therefore uses
    // the same blocked Cure sequence as Diaga; Rot's curse is tested on the
    // independent end-turn save below.
    const rot = coreStatusEncounter();
    rot.state.actors[rot.hero.id].hp = 15;
    rot.state.actors[rot.hero.id].vigor = 0;
    rot.state.actors[rot.hero.id].statuses = ['blind'];
    markWithFoeRot(rot.state, rot.hero, rot.foe);
    const rotRecovered = executeCommand(rot.state, { type: 'RECOVER', actorId: rot.hero.id }, scriptedDice());
    const rotEvent = recoveredEvent(rotRecovered.events);
    expect(rotRecovered.state.actors[rot.hero.id]).toMatchObject({ vigor: 0, statuses: ['blind'] });
    expect(rotEvent.statusSaveMutations).toEqual([expect.objectContaining({ kind: 'cure', actorId: rot.hero.id })]);
    expect(rotEvent.saves).toEqual([]);
    expect(applyEvents(rot.state, rotRecovered.events)).toEqual(rotRecovered.state);

    const sweet = sweetTormentCoreEncounter();
    sweet.state.actors[sweet.target.id].hp = 15;
    sweet.state.actors[sweet.target.id].vigor = 0;
    sweet.state.actors[sweet.target.id].statuses = ['blind'];
    const sweetRecovered = executeCommand(sweet.state, { type: 'RECOVER', actorId: sweet.target.id }, scriptedDice());
    const sweetEvent = recoveredEvent(sweetRecovered.events);
    expect(sweetRecovered.state.actors[sweet.target.id]).toMatchObject({ vigor: 0, statuses: ['blind'] });
    expect(sweetEvent.statusSaveMutations).toEqual([expect.objectContaining({ kind: 'cure', actorId: sweet.target.id })]);
    expect(sweetEvent.saves).toEqual([]);
    expect(applyEvents(sweet.state, sweetRecovered.events)).toEqual(sweetRecovered.state);
  });

  it('applies Blessing, Rot, Sweet Torment, and ongoing-status policy to ordinary end-turn saves', () => {
    const ordinary = coreStatusEncounter();
    ordinary.state.actors[ordinary.hero.id].statuses = ['blind', 'slashed'];
    ordinary.state.actors[ordinary.hero.id].conditions.push({
      id: 'slashed', sourceId: 'fixture:ongoing-slashed', ownerId: null,
      potency: 'plus', duration: { kind: 'combat' },
    });
    ordinary.state.actors[ordinary.hero.id].resources.blessing = 1;
    const ended = executeCommand(ordinary.state, {
      type: 'END_TURN', actorId: ordinary.hero.id,
      input: { statusSaveChoices: { [ordinary.hero.id]: { blind: { spendBlessing: true } } } },
    }, scriptedDice(7, 3));
    const ordinaryEvent = turnEndedEvent(ended.events);
    expect(ordinaryEvent.saves).toEqual([{ status: 'blind', roll: 7, cleared: true }]);
    expect(ordinaryEvent.statusSaveMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resource', actorId: ordinary.hero.id, resourceId: 'blessing', operation: 'spend', amount: 1 }),
      expect.objectContaining({ kind: 'save', actorId: ordinary.hero.id, statusId: 'blind', roll: 7, boon: 3, total: 10, success: true }),
    ]));
    expect(ended.state.actors[ordinary.hero.id]).toMatchObject({ statuses: ['slashed'], resources: { blessing: 0 } });
    expect(ended.state.actors[ordinary.hero.id].conditions).toContainEqual(expect.objectContaining({ id: 'slashed', potency: 'plus' }));
    expect(applyEvents(ordinary.state, ended.events)).toEqual(ended.state);

    const rot = coreStatusEncounter();
    rot.state.actors[rot.hero.id].statuses = ['blind'];
    markWithFoeRot(rot.state, rot.hero, rot.foe);
    const rotEnded = executeCommand(rot.state, { type: 'END_TURN', actorId: rot.hero.id }, scriptedDice(10, 1));
    expect(turnEndedEvent(rotEnded.events).statusSaveMutations).toContainEqual(expect.objectContaining({
      kind: 'save', actorId: rot.hero.id, statusId: 'blind', roll: 10, boon: -1, total: 9, success: false,
    }));
    expect(rotEnded.state.actors[rot.hero.id].statuses).toEqual(['blind']);

    const sweet = sweetTormentCoreEncounter();
    sweet.state.actors[sweet.target.id].statuses = ['blind'];
    const sweetEnded = executeCommand(sweet.state, { type: 'END_TURN', actorId: sweet.target.id }, scriptedDice());
    expect(turnEndedEvent(sweetEnded.events).statusSaveMutations).toEqual([]);
    expect(sweetEnded.state.actors[sweet.target.id].statuses).toEqual(['blind']);
  });

  it('uses the same policy-aware ledger when Stunned forces an end turn', () => {
    const forced = coreStatusEncounter();
    forced.state.actors[forced.hero.id].statuses = ['stunned', 'blind', 'slashed'];
    forced.state.actors[forced.hero.id].conditions.push({
      id: 'slashed', sourceId: 'fixture:ongoing-slashed', ownerId: null,
      potency: 'plus', duration: { kind: 'combat' },
    });
    forced.state.actors[forced.hero.id].resources.blessing = 1;
    const result = executeCommand(forced.state, {
      type: 'MOVE', actorId: forced.hero.id, path: [{ x: 1, y: 2 }], mode: 'standard',
      input: { statusSaveChoices: { [forced.hero.id]: { blind: { spendBlessing: true } } } },
    }, scriptedDice(7, 3));
    const ended = turnEndedEvent(result.events);
    expect(result.events).toContainEqual({ type: 'STATUS_REMOVED', actorId: forced.hero.id, status: 'stunned' });
    expect(ended.statusSaveMutations).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'resource', actorId: forced.hero.id, resourceId: 'blessing', operation: 'spend', amount: 1 }),
      expect.objectContaining({ kind: 'save', actorId: forced.hero.id, statusId: 'blind', roll: 7, boon: 3, total: 10, success: true }),
    ]));
    expect(result.state.actors[forced.hero.id]).toMatchObject({ statuses: ['slashed'], resources: { blessing: 0 } });
    expect(result.state.actors[forced.hero.id].conditions).toContainEqual(expect.objectContaining({ id: 'slashed', potency: 'plus' }));
    expect(applyEvents(forced.state, result.events)).toEqual(result.state);
  });

  it('rejects unused or cross-target Blessing choices instead of silently accepting them', () => {
    const crossTarget = diagaEncounter();
    crossTarget.state.actors[crossTarget.target.id].statuses = ['blind'];
    try {
      executeCommand(crossTarget.state, diagaCommand(crossTarget.caster, crossTarget.target, {
        statusSaveChoices: { [crossTarget.caster.id]: { blind: { spendBlessing: true } } },
      }), scriptedDice(10));
      throw new Error('Expected a cross-target status-save choice to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'status-save.unused-choice' });
    }

    const blocked = diagaEncounter();
    blocked.state.actors[blocked.target.id].statuses = ['blind'];
    markWithFoeRot(blocked.state, blocked.target, blocked.foe);
    try {
      executeCommand(blocked.state, diagaCommand(blocked.caster, blocked.target, {
        statusSaveChoices: { [blocked.target.id]: { blind: { spendBlessing: true } } },
      }), scriptedDice());
      throw new Error('Expected a choice for a blocked Cure save to be rejected.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'status-save.unused-choice' });
    }
  });
});
