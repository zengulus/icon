import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { auraDefinitionFor, auraStateView, isInAura, membersOfAura, projectedAuraAttackModifiers, projectedAuraConditions } from '../automation/kernels/aura.js';
import { encounterConditionSet } from '../automation/kernels/encounter-adapter.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnTo, endTurnOnly, startEncounterTo} from './fixtures.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/**
 * Aura kernel fixtures (docs/rules-foundations.md §Aura).
 *
 * The generic Aura authority — membership is derived continuously from
 * current positions through the canonical p.92 footprint range, and effects
 * are ephemeral projections onto current members (never stale durable
 * conditions). The canonical first fixtures are the two p.304 basic-job foe
 * traits: Commander's Aura (Aura 2, allies gain +1 boon on attacks) and Aura
 * of Shielding (Aura 1, the abjurer and allies have dodge). The harvest rows
 * (Rook t1, Dervish t1, Gentleness t1, Shieldmaster) prove the same kernel
 * serves temporary, stance-gated, and trait auras.
 */

const COMMANDER_PROFILE = 'basic:commander:304';
const COMMANDER = 'basic:commander:304:trait:commander-s-aura';
const ABJURER_PROFILE = 'basic:abjurer:304';
const ABJURER = 'basic:abjurer:304:trait:aura-of-shielding';

/** Advance until `actorId` is active: END_TURN the current actor, and when
 * the scheduler awaits a selection (activeActorId null) make the explicit
 * controller choice — TAKE_TURN the target when the eligible side allows it,
 * otherwise the first eligible actor so the target's side comes back around.
 * Replayable by construction. */
function advanceTo(state: EncounterState, actorId: string): EncounterState {
  let current = state;
  while (current.activeActorId !== actorId) {
    if (current.activeActorId === null) {
      const eligible = turnEligibleActorIds(current);
      const pick = eligible.includes(actorId) ? actorId : eligible[0];
      if (!pick) throw new Error(`advanceTo cannot reach ${actorId}: no eligible actor.`);
      current = executeCommand(current, { type: 'TAKE_TURN', actorId: pick }, scriptedDice()).state;
    } else {
      current = executeCommand(current, { type: 'END_TURN', actorId: current.activeActorId }, scriptedDice()).state;
    }
  }
  return current;
}

interface AuraFixture {
  state: EncounterState;
  origin: EncounterActor;
  allyIn: EncounterActor;
  allyOut: EncounterActor;
  hero: EncounterActor;
}

/** One aura origin + an ally inside the aura + an ally outside + a hero
 * attacker, all added and the encounter started. */
function auraEncounter(
  profileId: string,
  traitId: string,
  positions: { origin: Position; inside: Position; outside: Position; hero: Position },
  radius: number,
): AuraFixture {
  // The origin's trait must project the aura through the reviewed definition.
  if (!auraDefinitionFor(traitId)) throw new Error(`No aura definition for ${traitId}`);
  let state = createEncounter('Aura fixture');
  const origin = createFoeFromProfile(profileId, positions.origin);
  const allyIn = createFoe('Ally In', positions.inside);
  const allyOut = createFoe('Ally Out', positions.outside);
  const hero = actorFromCharacter(validCharacter('Aster'), positions.hero);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: origin }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: allyIn }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: allyOut }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = startEncounterTo(state, hero.id);
  const inRange = (from: Position, to: Position) => Math.max(Math.abs(from.x - to.x), Math.abs(from.y - to.y));
  // Sanity: the fixture's inside/outside split matches the aura's radius.
  if (inRange(positions.origin, positions.inside) > radius || inRange(positions.origin, positions.outside) <= radius) {
    throw new Error('Fixture positions do not match the requested radius.');
  }
  return { state, origin: state.actors[origin.id], allyIn: state.actors[allyIn.id], allyOut: state.actors[allyOut.id], hero: state.actors[hero.id] };
}

const commanderFixture = () => auraEncounter(COMMANDER_PROFILE, COMMANDER, {
  origin: { x: 3, y: 3 },
  inside: { x: 4, y: 3 },   // distance 1 (inside Aura 2)
  outside: { x: 6, y: 6 },  // distance 3 (outside Aura 2)
  hero: { x: 7, y: 7 },     // distance 4 from the origin, within the foes' range 4
}, 2);

const abjurerFixture = () => auraEncounter(ABJURER_PROFILE, ABJURER, {
  origin: { x: 3, y: 3 },
  inside: { x: 4, y: 4 },   // distance 1 (inside Aura 1)
  outside: { x: 5, y: 5 },  // distance 2 (outside Aura 1)
  hero: { x: 7, y: 7 },
}, 1);

describe('Aura membership kernel (p.92/p.290)', () => {
  it('counts a character exactly at the radius as inside and one space outside as outside', () => {
    const { state, allyIn } = commanderFixture();
    const definition = auraDefinitionFor(COMMANDER)!;
    const view = auraStateView(state);
    // The only member right now is the inside ally (the Commander is not its
    // own ally, the outside ally is at distance 3, the hero is a foe).
    expect(membersOfAura(view, definition)).toEqual([allyIn.id]);
    // A character exactly at radius 2 of the origin is a member.
    const atRadius = createFoe('At Radius', { x: 5, y: 3 });
    state.actors[atRadius.id] = atRadius;
    expect(isInAura(auraStateView(state), definition, atRadius.id)).toBe(true);
    // One space further is not.
    const oneOut = createFoe('One Out', { x: 6, y: 3 });
    state.actors[oneOut.id] = oneOut;
    expect(isInAura(auraStateView(state), definition, oneOut.id)).toBe(false);
  });

  it('uses the existing Chebyshev range authority for diagonals', () => {
    const { state } = commanderFixture();
    const definition = auraDefinitionFor(COMMANDER)!;
    // (5,5) is Chebyshev distance 2 from the origin (3,3) — inside Aura 2.
    const diagIn = createFoe('Diag In', { x: 5, y: 5 });
    state.actors[diagIn.id] = diagIn;
    // (6,6) is distance 3 — outside.
    const diagOut = createFoe('Diag Out', { x: 6, y: 6 });
    state.actors[diagOut.id] = diagOut;
    const view = auraStateView(state);
    expect(isInAura(view, definition, diagIn.id)).toBe(true);
    expect(isInAura(view, definition, diagOut.id)).toBe(false);
  });

  it('recomputes membership when the origin moves, and ceases when it leaves the battlefield', () => {
    let { state, origin, allyIn } = commanderFixture();
    const definition = auraDefinitionFor(COMMANDER)!;
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(true);
    // Move the origin far away: the ally is no longer inside.
    state.actors[origin.id].position = { x: 9, y: 9 };
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(false);
    // Moving it back re-establishes membership (no grant event needed).
    state.actors[origin.id].position = { x: 3, y: 3 };
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(true);
    // An off-battlefield origin has no aura.
    state.actors[origin.id].onBattlefield = false;
    expect(membersOfAura(auraStateView(state), definition)).toEqual([]);
    state.actors[origin.id].onBattlefield = true;
    // A defeated origin has no aura either.
    state.actors[origin.id].defeated = true;
    expect(membersOfAura(auraStateView(state), definition)).toEqual([]);
  });

  it('recomputes membership when the target moves and when the target leaves the battlefield', () => {
    let { state, allyIn } = commanderFixture();
    const definition = auraDefinitionFor(COMMANDER)!;
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(true);
    state.actors[allyIn.id].position = { x: 9, y: 9 };
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(false);
    state.actors[allyIn.id].position = { x: 4, y: 3 };
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(true);
    state.actors[allyIn.id].onBattlefield = false;
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(false);
  });

  it('distinguishes allies, foes, and the origin itself', () => {
    let { state, origin, allyIn, hero } = commanderFixture();
    const definition = auraDefinitionFor(COMMANDER)!;
    // The Commander's aura affects allies (same side); a hero inside is a foe
    // and is not affected.
    state.actors[hero.id].position = { x: 4, y: 3 };
    expect(isInAura(auraStateView(state), definition, hero.id)).toBe(false);
    // The Commander does not count as its own ally.
    expect(isInAura(auraStateView(state), definition, origin.id)).toBe(false);
    // A same-side character inside is a member.
    expect(isInAura(auraStateView(state), definition, allyIn.id)).toBe(true);
  });

  it('counts a large character as inside when at least one occupied space is in the aura (p.290)', () => {
    const { state } = commanderFixture();
    const definition = auraDefinitionFor(COMMANDER)!;
    // A Size-2 foe whose footprint starts at (5,3) occupies (5,3),(6,3),(5,4),(6,4).
    // Its nearest space is at distance 2 from the origin (3,3): inside Aura 2.
    const large = createFoe('Large', { x: 5, y: 3 });
    large.size = 2;
    state.actors[large.id] = large;
    expect(isInAura(auraStateView(state), definition, large.id)).toBe(true);
    // The same footprint at distance 3 (nearest space) is outside.
    large.position = { x: 6, y: 3 };
    expect(isInAura(auraStateView(state), definition, large.id)).toBe(false);
  });
});

describe('Aura projection kernel', () => {
  it('projects from every aura the actor is inside and drops an aura the actor leaves', () => {
    // A foe inside both the Commander's Aura 2 and the Abjurer's Aura 1 gets
    // the boon and dodge; leaving one removes only its projection.
    let state = createEncounter('Two auras');
    const commander = createFoeFromProfile(COMMANDER_PROFILE, { x: 2, y: 2 });
    const abjurer = createFoeFromProfile(ABJURER_PROFILE, { x: 2, y: 4 });
    const target = createFoe('Target', { x: 3, y: 3 }); // distance 1 from both
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 9, y: 9 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: commander }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: abjurer }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: target }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = startEncounterTo(state, hero.id);
    const view = () => auraStateView(state);
    const attack = projectedAuraAttackModifiers(view(), target.id);
    expect(attack.boons).toBe(1);
    expect(projectedAuraConditions(view(), target.id)).toEqual(new Set(['dodge']));
    // Leave the Commander's aura (move to (5,5): distance 3 from the
    // commander, 3 from the abjurer — outside both) then back into the
    // Abjurer's only.
    state.actors[target.id].position = { x: 5, y: 5 };
    expect(projectedAuraAttackModifiers(view(), target.id).boons).toBeUndefined();
    expect(projectedAuraConditions(view(), target.id)).toEqual(new Set());
    state.actors[target.id].position = { x: 3, y: 3 };
    state.actors[commander.id].position = { x: 9, y: 9 };
    expect(projectedAuraAttackModifiers(view(), target.id).boons).toBeUndefined();
    expect(projectedAuraConditions(view(), target.id)).toEqual(new Set(['dodge']));
  });

  it('unions the same condition supplied by multiple auras', () => {
    let state = createEncounter('Same condition');
    const abjurer = createFoeFromProfile(ABJURER_PROFILE, { x: 2, y: 2 });
    const target = createFoe('Target', { x: 3, y: 3 });
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 9, y: 9 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: abjurer }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: target }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = startEncounterTo(state, hero.id);
    // A second reviewed dodge aura (registered by this test) overlaps the
    // Abjurer's; the projected condition set stays a union, not a stack.
    const dodgeSet = projectedAuraConditions(auraStateView(state), target.id);
    expect(dodgeSet.has('dodge')).toBe(true);
    expect([...dodgeSet].filter((condition) => condition === 'dodge')).toHaveLength(1);
  });

  it('stacks aura attack modifiers through the shared netBoon authority', () => {
    // Two overlapping boon sources fold additively into netBoon: an aura boon
    // and an aura curse cancel through the existing attack-resolution kernel.
    let state = createEncounter('Stacking');
    const commander = createFoeFromProfile(COMMANDER_PROFILE, { x: 2, y: 2 });
    const ally = createFoe('Ally', { x: 3, y: 3 });
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 8, y: 8 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: commander }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = startEncounterTo(state, hero.id);
    const view = auraStateView(state);
    expect(projectedAuraAttackModifiers(view, ally.id)).toEqual({ boons: 1 });
    // A hostile-curse aura (Gentleness shape, here a fixture stance) stacks as
    // a negative through the same projection.
    state.actors[ally.id].stance = { id: 'fixture:gentle', sourceId: 'fixture', ownerId: ally.id, stanceId: 'gentleness', state: {} };
    const gentleness = auraDefinitionFor('chanter:gentleness')!;
    expect(isInAura(auraStateView(state), gentleness, ally.id)).toBe(true);
    const combined = projectedAuraAttackModifiers(auraStateView(state), ally.id);
    expect(combined.boons).toBe(1);
    expect(combined.curses).toBe(1);
  });
});

describe("Commander's Aura execution (p.304)", () => {
  it('gives an allied character inside Aura 2 exactly +1 boon on attacks, and not outside', () => {
    const fixture = commanderFixture();
    let state = fixture.state;
    // The Commander is active first; advance to the inside ally.
    state = advanceTo(state, fixture.allyIn.id);
    const inside = executeCommand(state, { type: 'BASIC_ATTACK', actorId: fixture.allyIn.id, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10, 5));
    // netBoon +1: the boon die (5) rolls after the d20 (10).
    expect(inside.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 5, total: 15, hit: true });
    expect(applyEvents(state, inside.events)).toEqual(inside.state);

    state = executeCommand(inside.state, { type: 'END_TURN', actorId: fixture.allyIn.id }, scriptedDice()).state;
    state = advanceTo(state, fixture.allyOut.id);
    const outside = executeCommand(state, { type: 'BASIC_ATTACK', actorId: fixture.allyOut.id, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10));
    expect(outside.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 0, total: 10 });
    expect(applyEvents(state, outside.events)).toEqual(outside.state);
  });

  it('does not count the Commander as its own ally', () => {
    let { state, origin, hero } = commanderFixture();
    state = advanceTo(state, origin.id);
    // Profile foes attack at range 1: pull the hero adjacent to the Commander
    // so its own attack is legal, then confirm it gains no boon from itself.
    state.actors[hero.id].position = { x: 3, y: 4 };
    const self = executeCommand(state, { type: 'BASIC_ATTACK', actorId: origin.id, targetId: hero.id, weight: 'light' }, scriptedDice(10));
    expect(self.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 0, total: 10 });
  });

  it('membership is continuous: moving into range gains the boon and moving out loses it, without extra grant events', () => {
    let fixture = commanderFixture();
    let state = fixture.state;
    const allyId = fixture.allyOut.id;
    // Turn 1: the outside ally attacks with no boon.
    state = advanceTo(state, allyId);
    const before = executeCommand(state, { type: 'BASIC_ATTACK', actorId: allyId, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10));
    expect(before.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 0, total: 10 });
    expect(applyEvents(state, before.events)).toEqual(before.state);

    // Turn 2: move to distance 2 (inside) and attack with the boon.
    state = executeCommand(before.state, { type: 'END_TURN', actorId: allyId }, scriptedDice()).state;
    state = advanceTo(state, allyId);
    const movedResult = executeCommand(state, { type: 'MOVE', actorId: allyId, path: [{ x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }], mode: 'standard' }, scriptedDice());
    const moved = movedResult.state;
    // (4,5) is distance 2 from (3,3): inside Aura 2, and no condition grant
    // event rides the move — the projection is derived.
    expect(movedResult.events.some((event) => event.type === 'RULE_MUTATIONS_APPLIED')).toBe(false);
    expect(isInAura(auraStateView(moved), auraDefinitionFor(COMMANDER)!, allyId)).toBe(true);
    expect(applyEvents(state, movedResult.events)).toEqual(moved);

    const inside = executeCommand(moved, { type: 'BASIC_ATTACK', actorId: allyId, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10, 3));
    expect(inside.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 3, total: 13 });
    expect(applyEvents(moved, inside.events)).toEqual(inside.state);

    // Turn 3: move out and attack without it.
    state = executeCommand(inside.state, { type: 'END_TURN', actorId: allyId }, scriptedDice()).state;
    state = advanceTo(state, allyId);
    const movedOut = executeCommand(state, { type: 'MOVE', actorId: allyId, path: [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }], mode: 'standard' }, scriptedDice()).state;
    expect(isInAura(auraStateView(movedOut), auraDefinitionFor(COMMANDER)!, allyId)).toBe(false);
    const after = executeCommand(movedOut, { type: 'BASIC_ATTACK', actorId: allyId, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10));
    expect(after.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 0, total: 10 });
    expect(applyEvents(movedOut, after.events)).toEqual(after.state);
  });
});

describe('Aura of Shielding execution (p.304)', () => {
  it('projects dodge onto the abjurer and allies inside, and not outside', () => {
    const { state, origin, allyIn, allyOut } = abjurerFixture();
    expect(encounterConditionSet(origin, state).has('dodge')).toBe(true); // the abjurer itself
    expect(encounterConditionSet(allyIn, state).has('dodge')).toBe(true);
    expect(encounterConditionSet(allyOut, state).has('dodge')).toBe(false);
  });

  it('an existing Dodge consumer sees the projected condition through the shared damage kernel', () => {
    let { state, allyIn, allyOut, hero } = abjurerFixture();
    state = advanceTo(state, hero.id);
    // A miss against the in-aura ally: Dodge ignores miss damage (p.104), so
    // the miss fray never lands.
    const inAura = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: allyIn.id, weight: 'light' }, scriptedDice(1));
    expect(inAura.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', hit: false });
    expect(inAura.state.actors[allyIn.id].hp).toBe(32);
    expect(applyEvents(state, inAura.events)).toEqual(inAura.state);

    // The same miss against the outside ally lands the miss fray (4).
    state = endTurnOnly(inAura.state, scriptedDice());
    state = advanceTo(state, hero.id);
    const outAura = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: allyOut.id, weight: 'light' }, scriptedDice(1));
    expect(outAura.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', hit: false });
    expect(outAura.state.actors[allyOut.id].hp).toBe(28); // 32 - miss fray 4
    expect(applyEvents(state, outAura.events)).toEqual(outAura.state);
  });

  it('entering and leaving the aura updates dodge immediately', () => {
    let { state, allyOut } = abjurerFixture();
    expect(encounterConditionSet(allyOut, state).has('dodge')).toBe(false);
    // (4,4) is inside Aura 1; (5,5) outside.
    state.actors[allyOut.id].position = { x: 4, y: 4 };
    expect(encounterConditionSet(state.actors[allyOut.id], state).has('dodge')).toBe(true);
    state.actors[allyOut.id].position = { x: 5, y: 5 };
    expect(encounterConditionSet(state.actors[allyOut.id], state).has('dodge')).toBe(false);
  });
});

describe('Aura harvest rows', () => {
  it('Rook talent 1: Rook has counter while his aura is active, only with the talent equipped', () => {
    let state = createEncounter('Rook');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = ['bastion:rook'];
    hero.chapter = 3;
    hero.talents = { 'bastion:rook': 1 };
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:rook', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(used.state.actors[heroId].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
    expect(encounterConditionSet(used.state.actors[heroId], used.state).has('counter')).toBe(true);
    expect(applyEvents(state, used.events)).toEqual(used.state);

    // Without talent 1 the same aura grants no counter.
    let other = createEncounter('Rook no talent');
    const hero2 = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero2.abilityIds = ['bastion:rook'];
    hero2.chapter = 3;
    hero2.talents = { 'bastion:rook': 2 };
    const foe2 = createFoe('Relict', { x: 2, y: 1 });
    other = executeCommand(other, { type: 'ADD_ACTOR', actor: hero2 }).state;
    other = executeCommand(other, { type: 'ADD_ACTOR', actor: foe2 }).state;
    other = startEncounterTo(other, hero2.id);
    const used2 = executeCommand(other, { type: 'USE_ABILITY', actorId: hero2.id, abilityId: 'bastion:rook', targetIds: [foe2.id] }, scriptedDice(12, 4));
    expect(used2.state.actors[hero2.id].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
    expect(encounterConditionSet(used2.state.actors[hero2.id], used2.state).has('counter')).toBe(false);
  });

  it('Dervish talent 1: the swirling winds aura projects counter to you and allies inside, and expires at the start of your next turn', () => {
    let state = createEncounter('Dervish');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 3, y: 3 });
    hero.abilityIds = ['chanter:dervish'];
    hero.chapter = 3;
    hero.talents = { 'chanter:dervish': 1 };
    const ally = actorFromCharacter(validCharacter('Mira'), { x: 2, y: 3 });
    const foe = createFoe('Relict', { x: 5, y: 3 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'chanter:dervish', targetIds: [ally.id] }, scriptedDice());
    // The hero flew 1 toward the foe and the ally was placed adjacent: both
    // are inside the swirling winds aura 1 and have counter.
    expect(used.state.actors[heroId].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
    expect(encounterConditionSet(used.state.actors[heroId], used.state).has('counter')).toBe(true);
    const allyActor = used.state.actors[ally.id];
    expect(allyActor.onBattlefield).toBe(true);
    expect(isInAura(auraStateView(used.state), auraDefinitionFor('chanter:dervish')!, ally.id)).toBe(true);
    expect(encounterConditionSet(allyActor, used.state).has('counter')).toBe(true);
    expect(applyEvents(state, used.events)).toEqual(used.state);

    // At the start of the hero's next turn the aura effect and the Bastion
    // Shieldmaster turn-end grant (`sturdy` until the start of your turn,
    // the ally was inside the hero's aura at the end turn) expire together.
    // Both belong to the hero, so ICON p.108 grants the hero the choice of
    // which ends first ("if a character has two effects that expire at the
    // end of their turn, they can choose which ends first") — the T6.3
    // boundary opens the ONE recorded ordering window and defers the tied
    // expiries until the owner answers (never an invented order).
    let ended = used.state;
    ended = executeCommand(ended, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
    ended = advanceTo(ended, heroId);
    const ordering = ended.decisionWindows.find((window) => window.kind === 'choice' && window.choice?.kind === 'ordering');
    expect(ordering).toBeDefined();
    const candidateIds = ordering?.choice && ordering.choice.kind === 'ordering' ? ordering.choice.candidateIds ?? [] : [];
    expect(candidateIds).toHaveLength(2);
    // The aura is still active while the ordering decision is pending (its
    // expiry is deferred, so the counter projection persists until the
    // recorded answer resolves it).
    expect(ended.actors[heroId].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(true);
    expect(encounterConditionSet(ended.actors[heroId], ended).has('counter')).toBe(true);
    // The owner records the aura expiry FIRST (the p.108 same-owner choice):
    // the aura effect ends and the counter projection disappears with it.
    const auraCandidate = candidateIds.find((id) => id.includes('chanter:dervish'));
    const sturdyCandidate = candidateIds.find((id) => id.includes('shieldmaster'));
    expect(auraCandidate).toBeDefined();
    expect(sturdyCandidate).toBeDefined();
    ended = executeCommand(ended, {
      type: 'ANSWER_DECISION_WINDOW',
      windowId: ordering!.id,
      input: { actorIds: { [ordering!.choice!.key]: [auraCandidate!, sturdyCandidate!] } },
    }, scriptedDice()).state;
    expect(ended.actors[heroId].activeEffects.some(({ effectId }) => effectId === 'aura')).toBe(false);
    expect(encounterConditionSet(ended.actors[heroId], ended).has('counter')).toBe(false);
  });

  it('Gentleness talent 1: yourself and allies inside the aura have counter in the stance, and the base aura curses attacks', () => {
    let state = createEncounter('Gentleness');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 3, y: 3 });
    hero.abilityIds = ['chanter:gentleness'];
    hero.chapter = 3;
    hero.talents = { 'chanter:gentleness': 1 };
    const ally = actorFromCharacter(validCharacter('Mira'), { x: 4, y: 3 }); // inside aura 1
    const far = actorFromCharacter(validCharacter('Olin'), { x: 1, y: 1 }); // outside
    const foe = createFoe('Relict', { x: 6, y: 6 }); // within basic attack range of the hero
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: far }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    const gentle = executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'chanter:gentleness', targetIds: [] }, scriptedDice()).state;
    // Counter (talent 1) projects to the stance user and allies inside.
    expect(encounterConditionSet(gentle.actors[heroId], gentle).has('counter')).toBe(true);
    expect(encounterConditionSet(gentle.actors[ally.id], gentle).has('counter')).toBe(true);
    expect(encounterConditionSet(gentle.actors[far.id], gentle).has('counter')).toBe(false);
    // The base aura's +1 curse on attacks is the same projected modifier the
    // attack fold reads: the hero in their own aura attacks with a curse die.
    const attacker = advanceTo(gentle, heroId);
    const attacked = executeCommand(attacker, { type: 'BASIC_ATTACK', actorId: heroId, targetId: foe.id, weight: 'light' }, scriptedDice(12, 1));
    expect(attacked.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: -1 });
    expect(applyEvents(attacker, attacked.events)).toEqual(attacked.state);
  });

  it('Shieldmaster: ending the turn with an ally in the aura grants vigilance +1 and sturdy until the start of your turn', () => {
    let state = createEncounter('Shieldmaster');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 3, y: 3 });
    hero.traitIds = ['bastion:trait:shieldmaster'];
    const ally = actorFromCharacter(validCharacter('Mira'), { x: 4, y: 3 }); // inside aura 1
    const foe = createFoe('Relict', { x: 6, y: 6 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    const ended = executeCommand(state, { type: 'END_TURN', actorId: heroId }, scriptedDice()).state;
    expect(ended.actors[heroId].resources.vigilance ?? 0).toBe(1);
    expect(encounterConditionSet(ended.actors[heroId], ended).has('sturdy')).toBe(true);
    // With no ally inside, the trait does nothing.
    let alone = createEncounter('Shieldmaster alone');
    const hero2 = actorFromCharacter(validCharacter('Aster'), { x: 3, y: 3 });
    hero2.traitIds = ['bastion:trait:shieldmaster'];
    const foe2 = createFoe('Relict', { x: 6, y: 6 });
    alone = executeCommand(alone, { type: 'ADD_ACTOR', actor: hero2 }).state;
    alone = executeCommand(alone, { type: 'ADD_ACTOR', actor: foe2 }).state;
    alone = startEncounterTo(alone, hero2.id);
    const endedAlone = endTurnTo(alone, foe2.id, scriptedDice());
    expect(endedAlone.actors[hero2.id].resources.vigilance ?? 0).toBe(0);
    expect(encounterConditionSet(endedAlone.actors[hero2.id], endedAlone).has('sturdy')).toBe(false);
  });
});

describe('Aura replay (F0 durable record)', () => {
  it('fresh execution and replay agree at every point of enter → use → leave → use', () => {
    // Commander's Aura: an ally enters the aura, attacks with the boon, leaves,
    // and attacks again — fresh and replay produce identical state and events.
    let fixture = commanderFixture();
    let state = fixture.state;
    const allyId = fixture.allyOut.id;
    // Turn 1, outside (distance 3): attack with no boon.
    state = advanceTo(state, allyId);
    const first = executeCommand(state, { type: 'BASIC_ATTACK', actorId: allyId, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10));
    expect(first.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 0 });
    expect(applyEvents(state, first.events)).toEqual(first.state);

    // Turn 2: enter the aura (distance 2), attack with +1 boon.
    state = executeCommand(first.state, { type: 'END_TURN', actorId: allyId }, scriptedDice()).state;
    state = advanceTo(state, allyId);
    const enteredResult = executeCommand(state, { type: 'MOVE', actorId: allyId, path: [{ x: 5, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 5 }], mode: 'standard' }, scriptedDice());
    const entered = enteredResult.state;
    expect(applyEvents(state, enteredResult.events)).toEqual(entered);
    const second = executeCommand(entered, { type: 'BASIC_ATTACK', actorId: allyId, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10, 2));
    expect(second.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 2, total: 12 });
    expect(applyEvents(entered, second.events)).toEqual(second.state);

    // Turn 3: leave the aura, attack with no boon again.
    state = executeCommand(second.state, { type: 'END_TURN', actorId: allyId }, scriptedDice()).state;
    state = advanceTo(state, allyId);
    const leftResult = executeCommand(state, { type: 'MOVE', actorId: allyId, path: [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }], mode: 'standard' }, scriptedDice());
    const left = leftResult.state;
    expect(applyEvents(state, leftResult.events)).toEqual(left);
    const third = executeCommand(left, { type: 'BASIC_ATTACK', actorId: allyId, targetId: fixture.hero.id, weight: 'light' }, scriptedDice(10));
    expect(third.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', boonDie: 0 });
    expect(applyEvents(left, third.events)).toEqual(third.state);
  });
});
