import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';
import { resolveAbilityUseChoices } from '../automation/kernels/ability-use-choices.js';
import type { AbilityUseChoiceSource } from '../automation/primitives/ability-use-choices.js';

/**
 * F10 ability-use choice seam (docs/rules-foundations.md §8) — the
 * Blessing-of-War / Blessing-of-Rebirth family (ICON p.190 / p.183). The
 * player names a narrow source-backed choice (trait id + spend); the engine
 * derives the resource spends, modifiers, and forced triggers. These tests
 * prove the fold at the kernel level and through the USE_ABILITY command.
 */

interface Fixture {
  state: EncounterState;
  hero: EncounterActor;
  fee: EncounterActor;
  second: EncounterActor | null;
}

function encounter(options: { foe?: Position; second?: Position | null } = {}): Fixture {
  let state = createEncounter('Ability-use choice fixture');
  const hero = actorFromCharacter(validCharacter('Exorcist'), { x: 1, y: 1 });
  // The hero is a Sealer; equip the Blessing of War trait and the God Hand
  // ability (an independently executable attack whose resolve includes an
  // Exceed effect: allies in range 2 gain 3 vigor).
  hero.abilityIds = ['sealer:god-hand'];
  hero.chapter = 3;
  const fee = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: fee }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, fee, second };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events']) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED');
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

const blessingSpends = (mutations: ReturnType<typeof mutationsOf>) =>
  mutations.filter((mutation) => mutation.kind === 'resource' && mutation.resourceId === 'blessing' && mutation.operation === 'spend');

describe('resolveAbilityUseChoices (kernel)', () => {
  const source = (over: Partial<AbilityUseChoiceSource['self']> = {}): AbilityUseChoiceSource => ({
    self: {
      id: 'actor:ally',
      side: 'heroes',
      defeated: false,
      onBattlefield: true,
      traitIds: [],
      resources: { blessing: 5 },
      ...over,
    },
    allies: [],
  });

  it('empty choices yield no costs and no modifiers', () => {
    const resolved = resolveAbilityUseChoices(source(), undefined);
    expect(resolved.costs).toEqual([]);
    expect(resolved.boons).toBe(0);
    expect(resolved.bonusDamage).toBe(0);
    expect(resolved.pierce).toBe(false);
    expect([...resolved.triggers]).toEqual([]);
  });

  it('Blessing of War spend 1 gives +1 boon and bonus damage, no exceed', () => {
    const resolved = resolveAbilityUseChoices(
      source({ traitIds: ['sealer:trait:blessing-of-war'] }),
      [{ traitId: 'sealer:trait:blessing-of-war', spend: 1 }],
    );
    expect(resolved.boons).toBe(1);
    expect(resolved.bonusDamage).toBe(1);
    expect(resolved.pierce).toBe(false);
    expect([...resolved.triggers]).toEqual([]);
    expect(blessingSpends(resolved.costs)).toHaveLength(1);
    expect(resolved.costs[0]).toMatchObject({ resourceId: 'blessing', operation: 'spend', amount: 1, actorId: 'actor:ally' });
  });

  it('Blessing of War spend 3 additionally forces exceed', () => {
    const resolved = resolveAbilityUseChoices(
      source({ traitIds: ['sealer:trait:blessing-of-war'] }),
      [{ traitId: 'sealer:trait:blessing-of-war', spend: 3 }],
    );
    expect(resolved.boons).toBe(1);
    expect(resolved.bonusDamage).toBe(1);
    expect([...resolved.triggers]).toEqual(['exceed']);
    expect(resolved.costs[0]).toMatchObject({ amount: 3 });
  });

  it('Blessing of Rebirth spend 1 gives pierce and bonus damage, no slay', () => {
    const resolved = resolveAbilityUseChoices(
      source({ traitIds: ['harvester:trait:blessing-of-rebirth'] }),
      [{ traitId: 'harvester:trait:blessing-of-rebirth', spend: 1 }],
    );
    expect(resolved.pierce).toBe(true);
    expect(resolved.bonusDamage).toBe(1);
    expect([...resolved.triggers]).toEqual([]);
  });

  it('Blessing of Rebirth spend 3 additionally forces slay', () => {
    const resolved = resolveAbilityUseChoices(
      source({ traitIds: ['harvester:trait:blessing-of-rebirth'] }),
      [{ traitId: 'harvester:trait:blessing-of-rebirth', spend: 3 }],
    );
    expect(resolved.pierce).toBe(true);
    expect([...resolved.triggers]).toEqual(['slay']);
    expect(resolved.costs[0]).toMatchObject({ amount: 3 });
  });

  it('rejects an unknown trait id', () => {
    expect(() => resolveAbilityUseChoices(source({ traitIds: ['sealer:trait:blessing-of-war'] }), [
      { traitId: 'sealer:trait:blessing-of-faith', spend: 1 },
    ])).toThrow(/no registered ability-use choice/);
  });

  it('rejects a spend that the trait does not allow', () => {
    expect(() => resolveAbilityUseChoices(source({ traitIds: ['sealer:trait:blessing-of-war'] }), [
      { traitId: 'sealer:trait:blessing-of-war', spend: 2 },
    ])).toThrow(/does not allow spending 2/);
  });

  it('leaves affordability to the aggregate command transaction', () => {
    const resolved = resolveAbilityUseChoices(source({ traitIds: ['sealer:trait:blessing-of-war'], resources: { blessing: 1 } }), [
      { traitId: 'sealer:trait:blessing-of-war', spend: 3 },
    ]);
    expect(resolved.costs[0]).toMatchObject({ resourceId: 'blessing', amount: 3, operation: 'spend' });
  });

  it('a natural exceed plus a forced exceed still yields one exceed (set-like)', () => {
    // Simulate both paths adding 'exceed' to the same Set: a natural exceed
    // from a high roll and a forced one from spend 3 must not duplicate.
    const forced = resolveAbilityUseChoices(
      source({ traitIds: ['sealer:trait:blessing-of-war'] }),
      [{ traitId: 'sealer:trait:blessing-of-war', spend: 3 }],
    );
    const natural = new Set(['exceed']);
    for (const trigger of forced.triggers) natural.add(trigger);
    expect([...natural].filter((trigger) => trigger === 'exceed')).toHaveLength(1);
  });

  it('rejects when no eligible owner has the trait', () => {
    expect(() => resolveAbilityUseChoices(source({ traitIds: [] }), [
      { traitId: 'sealer:trait:blessing-of-war', spend: 1 },
    ])).toThrow(/no eligible allied owner/);
  });

  it('an enemy-owned trait never grants the option to a hero user', () => {
    const src: AbilityUseChoiceSource = {
      self: { id: 'actor:hero', side: 'heroes', defeated: false, onBattlefield: true, traitIds: [], resources: { blessing: 3 } },
      allies: [],
    };
    // An enemy owner on the opposing side is not an ally, so the choice fails.
    expect(() => resolveAbilityUseChoices(
      {
        self: src.self,
        allies: [{ id: 'actor:foe', side: 'foes', defeated: false, onBattlefield: true, traitIds: ['sealer:trait:blessing-of-war'], resources: {} }],
      },
      [{ traitId: 'sealer:trait:blessing-of-war', spend: 1 }],
    )).toThrow(/no eligible allied owner/);
  });
});

describe('Blessing of War through USE_ABILITY (p.190)', () => {
  it('spend 3: hero spends exactly 3 blessings, forces exceed, and replays exactly', () => {
    const { state, hero, fee } = encounter();
    state.actors[hero.id].traitIds = ['sealer:trait:blessing-of-war'];
    state.actors[hero.id].resources.blessing = 5;
    const result = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'sealer:god-hand',
      targetIds: [fee.id],
      input: { abilityUseChoices: [{ traitId: 'sealer:trait:blessing-of-war', spend: 3 }], positions: { 'teleport': [{ x: 1, y: 2 }] } },
    }, scriptedDice(12, 4));
    // The user spent 3 blessings, then God Hand blessed the hero (self
    // preferred, +1): 5 - 3 + 1 = 3.
    expect(result.state.actors[hero.id].resources.blessing).toBe(3);
    // Forced exceed activated the Exceed effect: the hero (self, in range 2)
    // gains 3 vigor, which a plain spend-1 God Hand would not have granted.
    expect(result.state.actors[hero.id].vigor).toBeGreaterThanOrEqual(3);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('spend 1: the +1 attack boon reaches the VM attack roll and replays (Blessing of War)', () => {
    // Valkyrie (colossus:valkyrie) is a VM-step attack ability, so the F10
    // boon rides the generic attack effect — the merge dropped this term.
    let state = createEncounter('Blessing of War boon fixture');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = ['colossus:valkyrie'];
    hero.chapter = 1;
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    state.actors[hero.id].traitIds = ['sealer:trait:blessing-of-war'];
    state.actors[hero.id].resources.blessing = 5;
    const blessed = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'colossus:valkyrie',
      targetIds: [foe.id],
      input: { abilityUseChoices: [{ traitId: 'sealer:trait:blessing-of-war', spend: 1 }] },
    }, scriptedDice(8, 4)); // d20 8, boon die 4
    // The +1 boon adds one boon die to the VM attack roll (the attack rides
    // the ability's RULE_MUTATIONS_APPLIED event as a recorded mutation).
    const blessedAttack = mutationsOf(blessed.events).find((mutation) => mutation.kind === 'attack');
    expect(blessedAttack).toMatchObject({ kind: 'attack', boon: 4 });
    // The user spent exactly one blessing: 5 - 1 = 4.
    expect(blessed.state.actors[hero.id].resources.blessing).toBe(4);
    expect(applyEvents(state, blessed.events)).toEqual(blessed.state);
    // Control: the same attack without the choice rolls no boon die.
    const plain = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'colossus:valkyrie',
      targetIds: [foe.id],
    }, scriptedDice(8));
    const plainAttack = mutationsOf(plain.events).find((mutation) => mutation.kind === 'attack');
    expect(plainAttack).toMatchObject({ kind: 'attack', boon: 0 });
    expect(applyEvents(state, plain.events)).toEqual(plain.state);
  });

  it('spend 1: no exceed, only one blessing spent', () => {
    const { state, hero, fee } = encounter();
    state.actors[hero.id].traitIds = ['sealer:trait:blessing-of-war'];
    state.actors[hero.id].resources.blessing = 5;
    const result = executeCommand(state, {
      type: 'USE_ABILITY',
      actorId: hero.id,
      abilityId: 'sealer:god-hand',
      targetIds: [fee.id],
      input: { abilityUseChoices: [{ traitId: 'sealer:trait:blessing-of-war', spend: 1 }], positions: { 'teleport': [{ x: 1, y: 2 }] } },
    }, scriptedDice(12, 4));
    // 5 - 1 (spend) + 1 (God Hand blesses self) = 5.
    expect(result.state.actors[hero.id].resources.blessing).toBe(5);
    // The natural attack result is still authoritative: the +1 boon makes
    // this scripted roll Exceed, even though the choice did not force it.
    expect(result.state.actors[hero.id].vigor).toBe(3);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
