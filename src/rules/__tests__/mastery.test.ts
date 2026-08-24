import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { hasMastery } from '../automation/kernels/mastery.js';
import { auraStateView, isInAura } from '../automation/kernels/aura.js';
import { auraDefinitionFor } from '../automation/kernels/aura.js';
import { determineEncounterDamage, encounterRuleState } from '../automation/kernels/encounter-adapter.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand, migrateEncounter } from '../encounter.js';
import type { DiceSource } from '../dice.js';
import type { EncounterActor, EncounterCommand, EncounterEvent, EncounterState, Position } from '../types.js';
import { scriptedDice, validCharacter } from './fixtures.js';

/**
 * F8 mastery attachment fixtures (docs/rules-foundations.md §Mastery).
 *
 * A mastery is not an independently activated ability — it modifies or
 * extends the ability that owns it, and only when the parent ability is
 * equipped AND mastered (the shared `hasMastery` gate). Every mastery below
 * is exercised through the real encounter command path and must replay to
 * the identical state. The regression half of each fixture (the unmastered
 * parent) must behave exactly as before this patch.
 */

interface MasteryFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally?: EncounterActor;
}

function masteryEncounter(options: {
  mastered: string[];
  heroAt?: Position;
  foeAt?: Position;
  allyAt?: Position | null;
}): MasteryFixture {
  let state = createEncounter('Mastery fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), options.heroAt ?? { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  hero.traitIds = hero.traitIds.filter((id) => id !== 'bastion:trait:bull-s-strength');
  hero.masteredAbilityIds = [...options.mastered];
  const foe = createFoe('Relict', options.foeAt ?? { x: 2, y: 1 });
  // The ally is a hero-side character so relation-gated projections (Rook's
  // "allies in the aura") see it as an ally; it never acts in these fixtures.
  const ally = options.allyAt === null ? null : actorFromCharacter(validCharacter('Allied'), options.allyAt ?? { x: 3, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;
  return { state, hero, foe, ally: ally ?? undefined };
}

/** A command chain that records every event so the whole flow replays from
 * the initial state to the identical final state. */
class Chain {
  events: EncounterEvent[] = [];
  state: EncounterState;
  constructor(state: EncounterState) { this.state = state; }
  run(command: EncounterCommand, dice?: DiceSource): this {
    const result = executeCommand(this.state, command, dice ?? scriptedDice());
    this.events.push(...result.events);
    this.state = result.state;
    return this;
  }
  replayFrom(initial: EncounterState): void {
    expect(applyEvents(initial, this.events)).toEqual(this.state);
  }
}

/** The mutations of the LAST RULE_MUTATIONS_APPLIED event for a source (a
 * command chain can emit several — the first use and a re-use). */
const mutationsOf = (events: EncounterEvent[], sourceId: string) => {
  const matches = events.filter((candidate): candidate is Extract<EncounterEvent, { type: 'RULE_MUTATIONS_APPLIED' }> =>
    candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return matches.length > 0 ? matches[matches.length - 1].mutations : [];
};

describe('F8 mastery attachment foundation', () => {
  it('the shared gate requires the parent ability to be BOTH equipped and mastered', () => {
    // Unmastered parent: equipped but not mastered.
    expect(hasMastery({ abilityIds: ['knave:intimidate'], masteredAbilityIds: [] }, 'knave:intimidate')).toBe(false);
    // Mastered and equipped: fires.
    expect(hasMastery({ abilityIds: ['knave:intimidate'], masteredAbilityIds: ['knave:intimidate'] }, 'knave:intimidate')).toBe(true);
    // Mastered but not equipped: never fires.
    expect(hasMastery({ abilityIds: [], masteredAbilityIds: ['knave:intimidate'] }, 'knave:intimidate')).toBe(false);
    // Another mastered ability does not activate this mastery.
    expect(hasMastery({ abilityIds: ['knave:intimidate', 'knave:bleak-mercy'], masteredAbilityIds: ['knave:bleak-mercy'] }, 'knave:intimidate')).toBe(false);
  });

  it('encounter conversion projects only equipped-and-mastered abilities, and foes default to none', () => {
    const character = validCharacter();
    const masteredId = character.abilities[0].abilityId;
    character.abilities = character.abilities.map((ability, index) => (index === 0 ? { ...ability, mastered: true } : ability));
    const hero = actorFromCharacter(character, { x: 1, y: 1 });
    expect(hero.masteredAbilityIds).toEqual([masteredId]);

    // A mastered-but-unequipped ability is never projected (unequipped parents
    // must not fire).
    character.abilities.push({ abilityId: 'bastion:rook', talent: null, mastered: true });
    expect(actorFromCharacter(character, { x: 1, y: 1 }).masteredAbilityIds).not.toContain('bastion:rook');

    // Unmastered abilities stay out.
    const plain = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    expect(plain.masteredAbilityIds).toEqual([]);
    expect(createFoe('Relict', { x: 2, y: 1 }).masteredAbilityIds).toEqual([]);
  });

  it('historical snapshots without mastery ownership migrate deterministically to none', () => {
    const original = createEncounter('Mastery migration');
    const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const legacyActor = { ...hero } as Record<string, unknown>;
    delete legacyActor.masteredAbilityIds;
    const migrated = migrateEncounter({ ...original, schemaVersion: 1, actors: { [hero.id]: legacyActor } });
    expect(migrated.actors[hero.id].masteredAbilityIds).toEqual([]);
  });
});

describe('Rook mastery — Implacable Fortress (p.123)', () => {
  it('allies in the mastered Rook aura reduce all damage by 2 as if by armor', () => {
    // Hero at (2,1) uses Rook (aura 1) on the adjacent foe; the ally at (1,1)
    // stays inside the aura.
    const fixture = masteryEncounter({ mastered: ['bastion:rook'], heroAt: { x: 2, y: 1 }, foeAt: { x: 3, y: 1 }, allyAt: { x: 1, y: 1 } });
    fixture.state.actors[fixture.ally!.id].armor = 0; // isolate the aura's armor contribution
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'bastion:rook', targetIds: [fixture.foe.id] });
    expect(chain.state.actors[fixture.hero.id].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
    const determined = determineEncounterDamage(chain.state, {
      targetId: fixture.ally!.id, sourceActorId: fixture.foe.id,
      sourceRuleId: 'fixture:strike', amount: 10, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
    });
    expect(determined.amount).toBe(8); // 10 - 2 aura armor

    // Regression: the same layout without the mastery reduces nothing.
    const plain = masteryEncounter({ mastered: [], heroAt: { x: 2, y: 1 }, foeAt: { x: 3, y: 1 }, allyAt: { x: 1, y: 1 } });
    plain.state.actors[plain.ally!.id].armor = 0;
    const plainChain = new Chain(plain.state);
    plainChain.run({ type: 'USE_ABILITY', actorId: plain.hero.id, abilityId: 'bastion:rook', targetIds: [plain.foe.id] });
    const plainDetermined = determineEncounterDamage(plainChain.state, {
      targetId: plain.ally!.id, sourceActorId: plain.foe.id,
      sourceRuleId: 'fixture:strike', amount: 10, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
    });
    expect(plainDetermined.amount).toBe(10);
    chain.replayFrom(fixture.state);
  });

  it('leaving the aura removes the reduction immediately (no stale projection)', () => {
    const fixture = masteryEncounter({ mastered: ['bastion:rook'], heroAt: { x: 2, y: 1 }, foeAt: { x: 3, y: 1 }, allyAt: { x: 1, y: 1 } });
    fixture.state.actors[fixture.ally!.id].armor = 0;
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'bastion:rook', targetIds: [fixture.foe.id] });
    const foeId = fixture.foe.id;
    // Ally walks out of the aura.
    chain.state.actors[fixture.ally!.id].position = { x: 6, y: 1 };
    const outside = determineEncounterDamage(chain.state, {
      targetId: fixture.ally!.id, sourceActorId: foeId, sourceRuleId: 'fixture:strike',
      amount: 10, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
    });
    expect(outside.amount).toBe(10);
    // The aura origin moving away removes it too.
    chain.state.actors[fixture.ally!.id].position = { x: 1, y: 1 };
    chain.state.actors[fixture.hero.id].position = { x: 6, y: 1 };
    const movedOrigin = determineEncounterDamage(chain.state, {
      targetId: fixture.ally!.id, sourceActorId: foeId, sourceRuleId: 'fixture:strike',
      amount: 10, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
    });
    expect(movedOrigin.amount).toBe(10);
  });
});

describe('Dark Knight mastery — Infectious Hatred (p.143)', () => {
  it('a mastered dark knight emanates Aura 1; a foe ending its turn inside fails its save and gains hatred', () => {
    const fixture = masteryEncounter({ mastered: ['knave:dark-knight'], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'knave:dark-knight', targetIds: [] });
    expect(chain.state.actors[fixture.hero.id].stance?.stanceId).toBe('dark-knight');
    chain.run({ type: 'END_TURN', actorId: fixture.hero.id });
    // The foe ends its turn inside the mastered aura: the command boundary
    // pre-rolls the save (d20 3 → fail vs 10).
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id }, scriptedDice(3));
    expect(chain.state.actors[fixture.foe.id].statuses).toContain('hatred');
    expect(chain.state.actors[fixture.foe.id].ruleState['hatred-of']).toBe(fixture.hero.id);
    chain.replayFrom(fixture.state);
  });

  it('a successful save grants nothing, and an unmastered dark knight has no aura at all', () => {
    const fixture = masteryEncounter({ mastered: ['knave:dark-knight'], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'knave:dark-knight', targetIds: [] });
    chain.run({ type: 'END_TURN', actorId: fixture.hero.id });
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id }, scriptedDice(12)); // d20 12 ≥ 10
    expect(chain.state.actors[fixture.foe.id].statuses).not.toContain('hatred');
    expect(chain.state.actors[fixture.foe.id].ruleState['hatred-of']).toBeUndefined();

    // Regression: the unmastered stance emanates no aura, so the foe's turn
    // end has no save window and no hatred.
    const plain = masteryEncounter({ mastered: [], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 } });
    const plainChain = new Chain(plain.state);
    plainChain.run({ type: 'USE_ABILITY', actorId: plain.hero.id, abilityId: 'knave:dark-knight', targetIds: [] });
    plainChain.run({ type: 'END_TURN', actorId: plain.hero.id });
    plainChain.run({ type: 'END_TURN', actorId: plain.foe.id });
    expect(plainChain.state.actors[plain.foe.id].statuses).not.toContain('hatred');
    expect(plainChain.state.actors[plain.foe.id].ruleState['hatred-of']).toBeUndefined();
  });
});

describe('Intimidate mastery — Iron Skull (p.143)', () => {
  it('after the stun triggers, the mastered user becomes unstoppable until the end of their next turn', () => {
    // Foe at (5,1) is exactly at Intimidate's minimum range 4; it walks in
    // during its own turn (a real MOVE command, so the whole chain replays)
    // until it is adjacent to the hero.
    const fixture = masteryEncounter({ mastered: ['knave:intimidate'], heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 }, allyAt: { x: 7, y: 1 } });
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'knave:intimidate', targetIds: [fixture.foe.id] });
    chain.run({ type: 'MOVE', actorId: fixture.foe.id, path: [{ x: 4, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }], mode: 'standard' });
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id });
    chain.run({ type: 'END_TURN', actorId: fixture.ally!.id });
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id }); // back to the hero's turn start, where the stun triggers
    const unstoppable = chain.state.actors[fixture.hero.id].conditions.find(({ id }) => id === 'unstoppable');
    expect(unstoppable).toBeDefined();
    expect(unstoppable!.duration).toEqual({ kind: 'turn-end', actor: { kind: 'self' }, turns: 2 });
    chain.replayFrom(fixture.state);
  });

  it('regression: without the mastery the stun fires but grants no unstoppable', () => {
    const fixture = masteryEncounter({ mastered: [], heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 }, allyAt: { x: 7, y: 1 } });
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'knave:intimidate', targetIds: [fixture.foe.id] });
    chain.run({ type: 'MOVE', actorId: fixture.foe.id, path: [{ x: 4, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 1 }], mode: 'standard' });
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id });
    chain.run({ type: 'END_TURN', actorId: fixture.ally!.id });
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id }); // back to the hero's turn start, where the stun triggers
    expect(chain.state.actors[fixture.foe.id].statuses).toContain('stunned'); // stun still fires
    expect(chain.state.actors[fixture.hero.id].conditions.some(({ id }) => id === 'unstoppable')).toBe(false);
  });
});

describe('Bleak Mercy mastery — Painkiller (p.144)', () => {
  const sweetTorment = (chain: Chain, heroId: string, foeId: string, dice: DiceSource) =>
    chain.run({ type: 'EXECUTE_RULE', actorId: heroId, sourceId: 'knave:bleak-mercy', actionId: 'combo', timing: 'use', input: {}, attackTargetId: foeId }, dice);

  it('the mastered Sweet Torment aura lasts indefinitely, and re-using it deals status-counted damage instead of replacing it', () => {
    const fixture = masteryEncounter({ mastered: ['knave:bleak-mercy'], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    fixture.state.actors[fixture.hero.id].resources.combo = 2;
    const chain = new Chain(fixture.state);
    sweetTorment(chain, fixture.hero.id, fixture.foe.id, scriptedDice(12, 4));
    const aura = chain.state.actors[fixture.hero.id].activeEffects.filter(({ effectId }) => effectId === 'sweet-torment');
    expect(aura).toHaveLength(1);
    expect(aura[0]!.duration).toEqual({ kind: 'combat' }); // indefinite = the engine's combat boundary

    // A foe with two statuses inside the aura: the re-use deals 2 × 2 damage.
    // (The ledger fields are cleared to exercise the same-turn re-use branch;
    // this is deliberate test manipulation, not a command sequence.)
    chain.state.actors[fixture.hero.id].usedAbilityIds = [];
    chain.state.actors[fixture.hero.id].attackedThisTurn = false;
    chain.state.actors[fixture.hero.id].actionsRemaining = 2;
    chain.state.actors[fixture.hero.id].resources.combo = 1;
    chain.state.actors[fixture.foe.id].statuses = ['slashed', 'dazed'];
    sweetTorment(chain, fixture.hero.id, fixture.foe.id, scriptedDice(12, 4));
    expect(chain.state.actors[fixture.hero.id].activeEffects.filter(({ effectId }) => effectId === 'sweet-torment')).toHaveLength(1); // not replaced
    expect(mutationsOf(chain.events, 'knave:bleak-mercy')).toContainEqual(expect.objectContaining({ kind: 'damage', actorId: fixture.foe.id, amount: 4 }));
    // The combo attack rides every use (scripted d6 rolls 4 and 1 + fray 4 = 9
    // each use); the painkiller re-use adds the 2-per-status damage (4):
    // 32 - 9 - 9 - 4 = 10.
    expect(chain.state.actors[fixture.foe.id].hp).toBe(10);
  });

  it('regression: the unmastered combo keeps the turn-bounded aura and re-gains it on re-use', () => {
    const fixture = masteryEncounter({ mastered: [], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    fixture.state.actors[fixture.hero.id].resources.combo = 1;
    const chain = new Chain(fixture.state);
    sweetTorment(chain, fixture.hero.id, fixture.foe.id, scriptedDice(12, 4));
    const aura = chain.state.actors[fixture.hero.id].activeEffects.filter(({ effectId }) => effectId === 'sweet-torment');
    expect(aura).toHaveLength(1);
    expect(aura[0]!.duration).not.toEqual({ kind: 'combat' });
  });
});

describe('Warding Bolts mastery — Phantom Bolts (p.158)', () => {
  const phantomBolts = (chain: Chain, heroId: string, dice: DiceSource) =>
    chain.run({ type: 'EXECUTE_RULE', actorId: heroId, sourceId: 'freelancer:warding-bolts', actionId: 'default', timing: 'interrupt', input: {} }, dice);

  it('the mastered area hovers as an Aura 2 for the rest of combat, and a foe leaving it is struck', () => {
    const fixture = masteryEncounter({ mastered: ['freelancer:warding-bolts'], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    const chain = new Chain(fixture.state);
    phantomBolts(chain, fixture.hero.id, scriptedDice());
    const aura = chain.state.actors[fixture.hero.id].activeEffects.filter(({ effectId }) => effectId === 'phantom-bolts');
    expect(aura).toHaveLength(1);
    expect(aura[0]!.duration).toEqual({ kind: 'combat' });
    expect(aura[0]!.modifiers).toContainEqual(expect.objectContaining({ stat: 'aura', operation: 'grant' }));

    // A foe that starts its turn inside the aura and ends it outside is struck.
    chain.run({ type: 'END_TURN', actorId: fixture.hero.id });
    expect(chain.state.actors[fixture.foe.id].ruleState['warding-bolts:owner']).toBe(fixture.hero.id); // recorded at the foe's turn start
    // The first step out of the adjacent space costs 2 (engagement), the rest
    // 1 each: 2 + 1 + 1 = 4, exactly the foe's allowance, ending outside the aura.
    chain.run({ type: 'MOVE', actorId: fixture.foe.id, path: [{ x: 3, y: 1 }, { x: 4, y: 1 }, { x: 5, y: 1 }], mode: 'standard' });
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id });
    expect(chain.state.actors[fixture.foe.id].hp).toBe(30); // 32 - 2 unerring
    expect(chain.state.actors[fixture.foe.id].statuses).toContain('dazed');
    chain.replayFrom(fixture.state);
  });

  it('using it again while the aura is active deals 2 unerring to all foes in it instead of replacing it', () => {
    const fixture = masteryEncounter({ mastered: ['freelancer:warding-bolts'], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    const chain = new Chain(fixture.state);
    phantomBolts(chain, fixture.hero.id, scriptedDice());
    const before = chain.state.actors[fixture.hero.id].activeEffects.filter(({ effectId }) => effectId === 'phantom-bolts').length;
    phantomBolts(chain, fixture.hero.id, scriptedDice());
    expect(chain.state.actors[fixture.hero.id].activeEffects.filter(({ effectId }) => effectId === 'phantom-bolts')).toHaveLength(before); // not replaced
    expect(mutationsOf(chain.events, 'freelancer:warding-bolts')).toContainEqual(expect.objectContaining({ kind: 'damage', actorId: fixture.foe.id, amount: 2, ignoreCover: true }));
  });

  it('regression: the unmastered interrupt still raises the terrain hover zone', () => {
    const fixture = masteryEncounter({ mastered: [], heroAt: { x: 1, y: 1 }, foeAt: { x: 2, y: 1 }, allyAt: null });
    const chain = new Chain(fixture.state);
    phantomBolts(chain, fixture.hero.id, scriptedDice());
    expect(chain.state.actors[fixture.hero.id].activeEffects.some(({ effectId }) => effectId === 'phantom-bolts')).toBe(false);
    expect(chain.state.terrainEffects.some((effect) => effect.terrain === 'warding-bolts')).toBe(true);
  });
});

describe('Gentleness mastery — Gentle Prayer (p.179)', () => {
  it('on refresh the mastered user may resize the aura by +1 and foes inside save or are pacified', () => {
    const fixture = masteryEncounter({ mastered: ['chanter:gentleness'], heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 }, allyAt: null });
    // Foe at (3,1) is outside aura 1 but inside a resized aura 2.
    const chain = new Chain(fixture.state);
    chain.run({
      type: 'EXECUTE_RULE', actorId: fixture.hero.id, sourceId: 'chanter:gentleness', actionId: 'default', timing: 'use',
      input: { options: { 'aura-resize': 'increase' } },
    }, scriptedDice(3));
    expect(chain.state.actors[fixture.hero.id].stance?.stanceId).toBe('gentleness');
    expect(chain.state.actors[fixture.hero.id].ruleState['gentleness:aura-radius']).toBe(2);
    // d20 3 fails the pacify save.
    expect(chain.state.actors[fixture.foe.id].statuses).toContain('pacified');
    // The resized radius is the shared aura authority: the foe at distance 2
    // is now inside.
    const definition = auraDefinitionFor('chanter:gentleness')!;
    expect(isInAura(auraStateView(chain.state), definition, fixture.foe.id)).toBe(true);
    chain.replayFrom(fixture.state);
  });

  it('regression: without the mastery the stance enters at aura 1 with no resize or pacify', () => {
    const fixture = masteryEncounter({ mastered: [], heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 }, allyAt: null });
    const chain = new Chain(fixture.state);
    chain.run({
      type: 'EXECUTE_RULE', actorId: fixture.hero.id, sourceId: 'chanter:gentleness', actionId: 'default', timing: 'use',
      input: { options: { 'aura-resize': 'increase' } },
    }, scriptedDice(3));
    expect(chain.state.actors[fixture.hero.id].ruleState['gentleness:aura-radius']).toBeUndefined();
    expect(chain.state.actors[fixture.foe.id].statuses).not.toContain('pacified');
    const definition = auraDefinitionFor('chanter:gentleness')!;
    expect(isInAura(auraStateView(chain.state), definition, fixture.foe.id)).toBe(false);
  });
});

describe('Rampant Nail mastery — Voracious Nail (p.227)', () => {
  it('characters starting adjacent to the nail become vulnerable, which becomes vulnerable+ only while inside its aura', () => {
    const fixture = masteryEncounter({ mastered: ['spellblade:rampant-nail'], heroAt: { x: 1, y: 1 }, foeAt: { x: 3, y: 1 }, allyAt: null });
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'spellblade:rampant-nail', targetIds: [] });
    const spikeId = Object.keys(chain.state.entities).find((id) => chain.state.entities[id].type === 'lightning-spike')!;
    chain.state.entities[spikeId].positions = [{ x: 2, y: 1 }];
    chain.run({ type: 'END_TURN', actorId: fixture.hero.id });
    // The foe starts its turn adjacent to the nail at (3,1): durable vulnerable.
    expect(chain.state.actors[fixture.foe.id].statuses).toContain('vulnerable');
    expect(encounterRuleState(chain.state).actors[fixture.foe.id].statuses).toContainEqual({ id: 'vulnerable', potency: 'plus' }); // inside the aura 2
    // Leaving the aura drops the upgrade but keeps the durable vulnerable.
    chain.state.actors[fixture.foe.id].position = { x: 7, y: 1 };
    expect(encounterRuleState(chain.state).actors[fixture.foe.id].statuses).toContainEqual({ id: 'vulnerable', potency: 'normal' });
  });

  it('the upgrade-only aura never grants vulnerable by itself (a character inside who never started adjacent is not vulnerable)', () => {
    // The ally starts its turn at (4,1): inside the nail's aura 2 but NOT
    // adjacent to the nail at (2,1) — the upgrade-only aura must not grant
    // vulnerable to it.
    const fixture = masteryEncounter({ mastered: ['spellblade:rampant-nail'], heroAt: { x: 1, y: 1 }, foeAt: { x: 5, y: 1 }, allyAt: { x: 4, y: 1 } });
    const chain = new Chain(fixture.state);
    chain.run({ type: 'USE_ABILITY', actorId: fixture.hero.id, abilityId: 'spellblade:rampant-nail', targetIds: [] });
    const spikeId = Object.keys(chain.state.entities).find((id) => chain.state.entities[id].type === 'lightning-spike')!;
    chain.state.entities[spikeId].positions = [{ x: 2, y: 1 }];
    chain.run({ type: 'END_TURN', actorId: fixture.hero.id });
    chain.run({ type: 'END_TURN', actorId: fixture.foe.id }); // the foe is next; its turn start is not adjacent either
    // The ally's turn start: inside the aura but not adjacent — no vulnerable
    // from the turn-start grant, and the aura only upgrades, so none at all.
    const allyView = encounterRuleState(chain.state).actors[fixture.ally!.id];
    expect(allyView.statuses.some(({ id }) => id === 'vulnerable')).toBe(false);
  });
});
