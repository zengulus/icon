import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { isAtHpThreshold, isAtOrUnderQuarterHp, isBloodied, projectedHpThresholdActionBonus, projectedHpThresholdConditions } from '../automation/kernels/hp-threshold.js';
import { encounterConditionSet } from '../automation/kernels/encounter-adapter.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, createFoeFromProfile, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnOnly, endTurnTo, startEncounterTo} from './fixtures.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';

/**
 * HP-threshold passive projection kernel (docs/rules-foundations.md §7).
 *
 * ICON passives gate on two canonical HP states — bloodied (at or under 50%
 * of the BASE maximum, p.81: "at or below 50% your base maximum hp"; the
 * p.94/p.104 recaps drop the qualifier) and "at 25% hp or lower" (the exact
 * quarter mark of the same base bar). Wounds temporarily reduce the LIVE
 * maximum (p.81) but NEVER move these thresholds (adjudication
 * icon-1.5:combat:bloodied-base-max). This suite proves the generic kernel:
 * activation is derived continuously from authoritative HP, effects
 * deactivate the moment HP crosses back over the threshold, no "bloodied
 * active" boolean is ever persisted, and fresh execution replays
 * identically. Canonical source consumers: the Enrage family (+1 action
 * while bloodied), Rogue Slippery (evasion while bloodied), Churn Baron's
 * hover chair (flying + sturdy while NOT bloodied), Furious Berserk (sturdy
 * while bloodied), Strigoi Blood Hunger (+2 damage against bloodied foes),
 * and Divine Aegis talent 2 (defiance when an ally marked at 25% hp or
 * lower).
 */

const bloodiedActor = (hp: number, overrides: Partial<{ baseMaxHp: number; wounds: number; vitality: number }> = {}) => ({
  hp,
  baseMaxHp: overrides.baseMaxHp ?? 40,
  wounds: overrides.wounds ?? 0,
  vitality: overrides.vitality ?? 10,
});

/** One profile foe + one hero, encounter started. */
function foeFixture(profileId: string, foeAt: Position, heroAt: Position): { state: EncounterState; hero: EncounterActor; foe: EncounterActor } {
  let state = createEncounter('HP threshold fixture');
  const hero = actorFromCharacter(validCharacter('Threshold witness'), heroAt);
  const foe = createFoeFromProfile(profileId, foeAt);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero: state.actors[hero.id], foe: state.actors[foe.id] };
}

/** Advance the active actor until `actorId` is active (END_TURN each current
 * active actor; replayable by construction). */
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

describe('HP-threshold predicates (p.81 base bar)', () => {
  it('bloodied: exactly 50% of the BASE maximum is bloodied, one above is not, one below is', () => {
    const base = bloodiedActor(0).baseMaxHp; // 40
    expect(isBloodied(bloodiedActor(base / 2))).toBe(true); // exactly half
    expect(isBloodied(bloodiedActor(Math.floor(base / 2) + 1))).toBe(false); // one above
    expect(isBloodied(bloodiedActor(Math.floor(base / 2) - 1))).toBe(true); // one below
  });

  it('quarter: exactly 25% of the BASE maximum is at-or-under, one above is not', () => {
    const base = bloodiedActor(0).baseMaxHp; // 40
    expect(isAtOrUnderQuarterHp(bloodiedActor(base / 4))).toBe(true); // exactly a quarter (10)
    expect(isAtOrUnderQuarterHp(bloodiedActor(Math.floor(base / 4) + 1))).toBe(false); // 11
    expect(isAtOrUnderQuarterHp(bloodiedActor(1))).toBe(true);
  });

  it('bloodied and quarter are distinct predicates (never interchangeable)', () => {
    const base = bloodiedActor(0).baseMaxHp; // 40, quarter = 10, half = 20
    // Between a quarter and half: quarter inactive, bloodied active.
    const mid = Math.floor(base / 4) + 1; // 11
    expect(isAtOrUnderQuarterHp(bloodiedActor(mid))).toBe(false);
    expect(isBloodied(bloodiedActor(mid))).toBe(true);
    expect(isAtHpThreshold(bloodiedActor(mid), 'quarter')).toBe(false);
    expect(isAtHpThreshold(bloodiedActor(mid), 'bloodied')).toBe(true);
  });

  it('wounds do NOT move the threshold bar — the BASE maximum governs (p.81; adjudication icon-1.5:combat:bloodied-base-max)', () => {
    // baseMaxHp 40, one wound (vitality 10) → live maximum 30, but the
    // bloodied bar stays base 40/2 = 20: a character at 20 is bloodied
    // even though that is 2/3 of the reduced bar. The pre-adjudication
    // wounds-adjusted reading (half of 30 = 15) is rejected.
    expect(isBloodied(bloodiedActor(20, { wounds: 1 }))).toBe(true); // 20 = base/2, though maxHp is 30
    expect(isBloodied(bloodiedActor(21, { wounds: 1 }))).toBe(false);
    expect(isBloodied(bloodiedActor(15, { wounds: 1 }))).toBe(true); // far below
    // Quarter: base 40/4 = 10 — 10 is at the quarter despite the 30 live bar.
    expect(isAtOrUnderQuarterHp(bloodiedActor(10, { wounds: 1 }))).toBe(true);
    expect(isAtOrUnderQuarterHp(bloodiedActor(11, { wounds: 1 }))).toBe(false);
  });
});

describe('HP-threshold projection kernel', () => {
  const slippery = 'basic:rogue:308:trait:slippery';
  const enrage = 'basic:archon:308:trait:enrage';
  const hoverChair = 'scavenger:churn-baron:375:trait:arkentech-hover-chair';

  it('projects a condition only while the owner is bloodied, and drops it the moment HP crosses back', () => {
    const actor = { ...bloodiedActor(20), traitIds: [slippery] as readonly string[] };
    expect(projectedHpThresholdConditions(actor).has('evasion')).toBe(true); // exactly half
    expect(projectedHpThresholdConditions({ ...actor, hp: 21 }).has('evasion')).toBe(false);
    expect(projectedHpThresholdConditions({ ...actor, hp: 10 }).has('evasion')).toBe(true);
  });

  it('projects +1 action while bloodied (Enrage)', () => {
    const actor = { ...bloodiedActor(20), traitIds: [enrage] as readonly string[] };
    expect(projectedHpThresholdActionBonus(actor)).toBe(1);
    expect(projectedHpThresholdActionBonus({ ...actor, hp: 21 })).toBe(0);
  });

  it('combines conditions and actions from multiple simultaneous passives', () => {
    const actor = { ...bloodiedActor(10), traitIds: [slippery, enrage, 'jotunn:bloody-companion:450:trait:true-enrage'] as readonly string[] };
    const conditions = projectedHpThresholdConditions(actor);
    expect(conditions.has('evasion')).toBe(true);
    expect(conditions.has('unstoppable')).toBe(true);
    expect(projectedHpThresholdActionBonus(actor)).toBe(2); // Enrage + True Enrage
  });

  it('inverted gate: the hover chair projects flying + sturdy while NOT bloodied (p.375)', () => {
    const actor = { ...bloodiedActor(20), traitIds: [hoverChair] as readonly string[] };
    expect(projectedHpThresholdConditions(actor).has('flying')).toBe(false); // bloodied: chair lost
    expect(projectedHpThresholdConditions(actor).has('sturdy')).toBe(false);
    const healed = { ...actor, hp: 21 };
    expect(projectedHpThresholdConditions(healed).has('flying')).toBe(true);
    expect(projectedHpThresholdConditions(healed).has('sturdy')).toBe(true);
  });
});

describe('Rogue Slippery execution (p.308: evasion while bloodied)', () => {
  it('the shared condition consumer sees evasion only while the rogue is bloodied', () => {
    const { state, hero, foe } = foeFixture('basic:rogue:308', { x: 2, y: 1 }, { x: 1, y: 1 });
    const max = foe.baseMaxHp; // bloodied bar = BASE maximum (p.81)
    foe.hp = Math.floor(max / 2); // exactly bloodied
    expect(encounterConditionSet(foe, state).has('evasion')).toBe(true);
    foe.hp = Math.floor(max / 2) + 1; // healed one point above
    expect(encounterConditionSet(foe, state).has('evasion')).toBe(false);
    foe.hp = 1; // dropped far below
    expect(encounterConditionSet(foe, state).has('evasion')).toBe(true);
  });

  it('a projected evasion actually evades: an attack vs the bloodied rogue rolls the d6 first', () => {
    let { state, hero, foe } = foeFixture('basic:rogue:308', { x: 2, y: 1 }, { x: 1, y: 1 });
    const max = foe.baseMaxHp; // bloodied bar = BASE maximum (p.81)
    foe.hp = Math.floor(max / 2);
    state = advanceTo(state, hero.id);
    const evaded = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(6));
    // First die is the evasion d6 (p.104: "Check before the attack roll").
    expect(evaded.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', hit: false, evasionRoll: 6, d20: null });
    expect(applyEvents(state, evaded.events)).toEqual(evaded.state);
  });
});

describe('Enrage execution (p.298: +1 action while bloodied)', () => {
  it('a bloodied Archon acts with 3 actions, and 2 once healed above the threshold', () => {
    let { state, hero, foe } = foeFixture('basic:archon:308', { x: 3, y: 3 }, { x: 1, y: 1 });
    const max = foe.baseMaxHp; // bloodied bar = BASE maximum (p.81)
    foe.hp = Math.floor(max / 2); // bloodied
    // The hero acts first; the GM selects the Archon, whose turn derives
    // 2 + 1 actions (ICON p.87 — the scheduler never auto-selects).
    const turnEvent = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    const awaiting = turnEvent.state;
    expect(awaiting.activeActorId).toBeNull();
    expect(awaiting.eligibleSide).toBe('foes');
    const archonTurn = executeCommand(awaiting, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(archonTurn.activeActorId).toBe(foe.id);
    expect(archonTurn.actors[foe.id].actionsRemaining).toBe(3);
    // The derived action pool replays from the pre-turn state with no extra record.
    expect(applyEvents(state, turnEvent.events)).toEqual(awaiting);
    // Heal above half: the next Archon turn derives 2 actions. The Archon is
    // an ELITE (p.299), so it owes a SECOND hostile slot this round before
    // the round can end; round 2 then opens with the player side.
    state = archonTurn;
    state.actors[foe.id].hp = max;
    let current = endTurnOnly(state, scriptedDice());
    expect(current.eligibleSide).toBe('foes'); // still owed its second entitlement
    current = executeCommand(current, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    // Ending the second slot ends round 1; round 2 opens with the player
    // side, whose turn passes back to the healed Archon.
    current = endTurnTo(current, hero.id, scriptedDice());
    expect(current.round).toBe(2);
    const passedBack = endTurnOnly(current, scriptedDice());
    expect(passedBack.eligibleSide).toBe('foes');
    const heroAgain = executeCommand(passedBack, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(heroAgain.activeActorId).toBe(foe.id);
    expect(heroAgain.actors[foe.id].actionsRemaining).toBe(2);
  });

  it('True Enrage grants the extra action and unstoppable while bloodied', () => {
    const { state, hero, foe } = foeFixture('jotunn:bloody-companion:450', { x: 3, y: 3 }, { x: 1, y: 1 });
    const max = foe.baseMaxHp; // bloodied bar = BASE maximum (p.81)
    foe.hp = Math.floor(max / 2);
    expect(encounterConditionSet(foe, state).has('unstoppable')).toBe(true);
    const archonTurn = endTurnTo(state, foe.id, scriptedDice());
    expect(archonTurn.activeActorId).toBe(foe.id);
    expect(archonTurn.actors[foe.id].actionsRemaining).toBe(3);
  });
});

describe('Churn Baron hover chair (p.375: flying + sturdy while NOT bloodied)', () => {
  it('the chair is present at full HP and lost the moment the baron is bloodied', () => {
    const { state, foe } = foeFixture('scavenger:churn-baron:375', { x: 2, y: 1 }, { x: 1, y: 1 });
    const max = foe.baseMaxHp; // bloodied bar = BASE maximum (p.81)
    foe.hp = max;
    expect(encounterConditionSet(foe, state).has('flying')).toBe(true);
    expect(encounterConditionSet(foe, state).has('sturdy')).toBe(true);
    foe.hp = Math.floor(max / 2);
    expect(encounterConditionSet(foe, state).has('flying')).toBe(false);
    expect(encounterConditionSet(foe, state).has('sturdy')).toBe(false);
  });
});

describe('Furious Berserk execution (p.192: sturdy while bloodied)', () => {
  it('the bloodied-gated sturdy half projects through the shared condition fold', () => {
    let state = createEncounter('Furious Berserk');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.traitIds = ['colossus:trait:furious-berserk'];
    const foe = createFoe('Relict', { x: 5, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const heroId = hero.id;
    const max = state.actors[heroId].baseMaxHp; // bloodied bar = BASE maximum (p.81)
    state.actors[heroId].hp = Math.floor(max / 2);
    expect(encounterConditionSet(state.actors[heroId], state).has('sturdy')).toBe(true);
    // Crossing back above the threshold removes the projection immediately.
    state.actors[heroId].hp = Math.floor(max / 2) + 1;
    expect(encounterConditionSet(state.actors[heroId], state).has('sturdy')).toBe(false);
  });
});

describe('Strigoi Blood Hunger execution (p.330: +2 damage against bloodied foes)', () => {
  it('attacks against a bloodied foe deal 2 more damage, and none against a healed one', () => {
    let { state, hero, foe } = foeFixture('relict:strigoi:330', { x: 2, y: 1 }, { x: 1, y: 1 });
    const heroMax = hero.baseMaxHp; // bloodied bar = BASE maximum (p.81)
    hero.hp = Math.floor(heroMax / 2); // bloodied target
    state = advanceTo(state, foe.id);
    const bloodied = executeCommand(state, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(20, 4));
    expect(bloodied.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', hit: true });
    expect(applyEvents(state, bloodied.events)).toEqual(bloodied.state);

    // Heal the hero above half, then come back around to the strigoi: the
    // identical roll against a non-bloodied target deals 2 less.
    state = bloodied.state;
    state.actors[hero.id].hp = heroMax;
    state = executeCommand(state, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    state = advanceTo(state, foe.id);
    const healed = executeCommand(state, { type: 'BASIC_ATTACK', actorId: foe.id, targetId: hero.id, weight: 'light' }, scriptedDice(20, 4));
    expect(healed.events[0]).toMatchObject({ type: 'ATTACK_RESOLVED', hit: true });
    const bloodiedEvent = bloodied.events[0] as { rawDamage: number };
    const healedEvent = healed.events[0] as { rawDamage: number };
    expect(bloodiedEvent.rawDamage).toBe(healedEvent.rawDamage + 2);
    expect(applyEvents(state, healed.events)).toEqual(healed.state);
  });
});

describe('Divine Aegis talent 2 (p.193: marked ally at 25% hp or lower gains defiance)', () => {
  function aegisFixture(allyHp: number, talent: 1 | 2) {
    let state = createEncounter('Divine Aegis');
    const hero = actorFromCharacter(validCharacter('Exorcist'), { x: 1, y: 1 });
    hero.abilityIds = ['sealer:divine-aegis'];
    hero.chapter = 3;
    hero.talents = { 'sealer:divine-aegis': talent };
    const ally = actorFromCharacter(validCharacter('Mira'), { x: 3, y: 1 });
    ally.hp = allyHp;
    const foe = createFoe('Relict', { x: 8, y: 8 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    state = advanceTo(state, hero.id);
    return { state, hero: state.actors[hero.id], ally: state.actors[ally.id] };
  }

  it('marking an ally at exactly 25% or lower grants defiance; one point above does not', () => {
    const { state, hero, ally } = aegisFixture(10, 2); // maxHp 40 → 10 is exactly 25%
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:divine-aegis', targetIds: [ally.id] }, scriptedDice());
    expect(marked.state.actors[ally.id].conditions.some(({ id }) => id === 'defiance')).toBe(true);
    expect(applyEvents(state, marked.events)).toEqual(marked.state);

    const above = aegisFixture(11, 2); // one above the quarter mark
    const markedAbove = executeCommand(above.state, { type: 'USE_ABILITY', actorId: above.hero.id, abilityId: 'sealer:divine-aegis', targetIds: [above.ally.id] }, scriptedDice());
    expect(markedAbove.state.actors[above.ally.id].conditions.some(({ id }) => id === 'defiance')).toBe(false);
    expect(applyEvents(above.state, markedAbove.events)).toEqual(markedAbove.state);
  });

  it('without talent 2 the mark never grants defiance', () => {
    const { state, hero, ally } = aegisFixture(8, 1);
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'sealer:divine-aegis', targetIds: [ally.id] }, scriptedDice());
    expect(marked.state.actors[ally.id].conditions.some(({ id }) => id === 'defiance')).toBe(false);
  });
});

describe('HP-threshold replay (F0 durable record)', () => {
  it('damage crossing the threshold activates the projection and replay agrees at every point', () => {
    // The rogue starts one point above bloodied: no evasion. A hit crosses it
    // below the threshold, and the very next condition read (fresh or
    // replayed) sees evasion — no persisted "bloodied active" flag anywhere.
    let { state, hero, foe } = foeFixture('basic:rogue:308', { x: 2, y: 1 }, { x: 1, y: 1 });
    const max = foe.baseMaxHp; // bloodied bar = BASE maximum (p.81)
    foe.hp = Math.floor(max / 2) + 1;
    expect(encounterConditionSet(foe, state).has('evasion')).toBe(false);
    state = advanceTo(state, hero.id);
    const crossed = executeCommand(state, { type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light' }, scriptedDice(20, 5));
    const after = crossed.state;
    expect(after.actors[foe.id].hp).toBeLessThanOrEqual(Math.floor(max / 2));
    expect(encounterConditionSet(after.actors[foe.id], after).has('evasion')).toBe(true);
    // Replay from the exact pre-attack state reproduces the identical state.
    expect(applyEvents(state, crossed.events)).toEqual(after);
  });
});
