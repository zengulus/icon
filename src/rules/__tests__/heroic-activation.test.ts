import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState, IconCharacter } from '../types.js';
import { JOBS } from '../catalog.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * Heroic activation transaction (ICON pp.116, 121, 127, 134, 141): Heroic is
 * a DECLARATION ("I use this ability's heroic effects") that becomes a
 * validated-player-activation ONLY through the generic transaction against
 * the content-registered heroic-granting recipes. Owning a trait is never
 * proof that a specific activation was legal and paid; naming `heroic` never
 * bypasses the transaction.
 *
 * Proven per source:
 * - no granting recipe → reject before any cost/effect/RNG;
 * - Strive → FAILS CLOSED (the shove-distance and half-damage halves have no
 *   generic seam yet; granting the lockout while omitting the mandatory
 *   half-damage downside would be a partial source unit);
 * - Wolfheart → FAILS CLOSED (the +1 flight/rush/dash distance half has no
 *   generic movement-distance seam; the sacrifice is a mandatory half);
 * - Demon Strength → lockout blocks both later Heroics AND attacks;
 * - Spite → Hatred+ of the closest foe + lockout apply AFTER the ability
 *   resolves (post-resolution continuation against THEN-CURRENT state): a
 *   unique closest foe is source-determined, an equidistant tie is a
 *   recorded U4 choice through the post-resolution window (never an
 *   invented tie-break);
 * - Stalwart Gambit → a non-Stalwart character using a Stalwart ability may
 *   declare Heroic for free once per combat.
 *
 * Every accepted activation rides the resolution's own event with the
 * recorded mutations + `triggerActivations` provenance; replay applies
 * exactly what the command decided. A post-resolution continuation is
 * resumed by the reducer after the ability's own mutations apply, and its
 * tie window's recorded answer is consumed by DECISION_ANSWERED — replay
 * never re-queries the choice.
 */
interface HeroicFixture {
  state: EncounterState;
  hero: EncounterActor;
  foes: EncounterActor[];
}

function heroicFixture(traitIds: readonly string[], foePositions: { x: number; y: number }[] = [{ x: 2, y: 1 }]): HeroicFixture {
  let state = createEncounter('Heroic activation fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  // Explicit trait set — the fixture never depends on catalog defaults.
  hero.traitIds = [...traitIds];
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  const foes: EncounterActor[] = [];
  for (const position of foePositions) {
    const foe = createFoe('Relict', position);
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    foes.push(foe);
  }
  state = startEncounterTo(state, hero.id);
  const actors = Object.values(state.actors);
  return { state, hero: actors.find((actor) => actor.id === hero.id)!, foes };
}

/** A character whose primary job is NOT a Stalwart-class job (Fool →
 * Vagabond class), for the Stalwart Gambit path. */
function nonStalwartCharacter(name = 'Foolio'): IconCharacter {
  const base = validCharacter(name);
  const job = JOBS.find((candidate) => candidate.id === 'fool')!;
  return {
    ...base,
    jobs: [job.id],
    primaryJobId: job.id,
    abilities: job.abilities.slice(0, 2).map(({ id }) => ({ abilityId: id, talent: null, mastered: false })),
    equippedAbilityIds: job.abilities.slice(0, 2).map(({ id }) => id),
  };
}

/** The EXECUTE_RULE heroic declaration used throughout: a 1-action bastion
 * ability whose heroic arm refunds the action, so the trait's transaction is
 * the only thing under test. */
const heroicRam = (state: EncounterState, heroId: string, targetId: string, extraInput: Record<string, unknown> = {}) =>
  executeCommand(state, {
    type: 'EXECUTE_RULE',
    actorId: heroId,
    sourceId: 'bastion:battering-ram',
    actionId: 'default',
    timing: 'use',
    input: { actorIds: { target: [targetId] }, ...extraInput },
    triggers: ['heroic'],
  }, scriptedDice());

const conditionIdOn = (actor: EncounterActor, conditionId: string) => actor.conditions.some(({ id }) => id === conditionId);

const ruleEvent = (result: ReturnType<typeof executeCommand>) =>
  result.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED' && event.sourceId === 'bastion:battering-ram');

/** A SECOND heroic declaration in the same turn on a DIFFERENT 1-action,
 * non-attack, no-input ability (`knave:provoke`): the no-repeat gate is
 * per-ability, so the second declaration reaches the heroic transaction —
 * which must reject it (round/combat spent or locked out) before ANY effect. */
const secondHeroic = (state: EncounterState, heroId: string) => executeCommand(state, {
  type: 'EXECUTE_RULE',
  actorId: heroId,
  sourceId: 'knave:provoke',
  actionId: 'default',
  timing: 'use',
  input: {},
  triggers: ['heroic'],
}, scriptedDice());

describe('heroic activation transaction', () => {
  it('rejects Heroic on an actor with no granting recipe — before any cost, effect, or RNG, with nothing consumed', () => {
    const { state, hero, foes } = heroicFixture([]);
    const before = JSON.stringify(state);
    expect(() => heroicRam(state, hero.id, foes[0]!.id)).toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
    expect(JSON.stringify(state)).toBe(before);
    expect(state.actors[hero.id].actionsRemaining).toBe(2);
    expect(state.actors[foes[0]!.id].hp).toBe(32);
  });

  it('Strive FAILS CLOSED — the half-damage downside and shove-distance halves have no generic seam yet, so no partial version executes', () => {
    const { state, hero, foes } = heroicFixture(['bastion:trait:strive']);
    const before = JSON.stringify(state);
    expect(() => heroicRam(state, hero.id, foes[0]!.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-incomplete' }));
    expect(JSON.stringify(state)).toBe(before);
    // Nothing was granted: no lockout, no heroic effect, no cost.
    expect(state.actors[hero.id].conditions.length).toBe(0);
    expect(state.actors[foes[0]!.id].hp).toBe(32);
  });

  it('Wolfheart FAILS CLOSED — the +1 flight/rush/dash distance half has no generic seam yet, so the sacrifice is never offered', () => {
    const { state, hero, foes } = heroicFixture(['colossus:trait:wolfheart']);
    const before = JSON.stringify(state);
    expect(() => heroicRam(state, hero.id, foes[0]!.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-incomplete' }));
    expect(JSON.stringify(state)).toBe(before);
    // The fail-closed gate precedes the sacrifice logic — nothing consumed.
    expect(state.actors[hero.id].hp).toBe(hero.hp);
    expect(state.actors[foes[0]!.id].hp).toBe(32);
  });

  it('Wolfheart at 0 hp — the fail-closed rejection precedes the sacrifice availability check, nothing consumed', () => {
    const { state, hero, foes } = heroicFixture(['colossus:trait:wolfheart']);
    state.actors[hero.id].hp = 0;
    const before = JSON.stringify(state);
    expect(() => heroicRam(state, hero.id, foes[0]!.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-incomplete' }));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('Demon Strength: the post-use lockout prevents a later illegal Heroic AND a later attack', () => {
    const { state, hero, foes } = heroicFixture(['demon-slayer:trait:demon-strength']);
    const first = heroicRam(state, hero.id, foes[0]!.id);
    const afterHeroic = first.state.actors[hero.id];
    expect(conditionIdOn(afterHeroic, 'demon-strength:heroic-lockout')).toBe(true);
    expect(applyEvents(state, first.events)).toEqual(first.state);
    // Second heroic → locked out (the transaction's own availability row).
    const lockedBefore = JSON.stringify(first.state);
    expect(() => secondHeroic(first.state, hero.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-lockout' }));
    expect(JSON.stringify(first.state)).toBe(lockedBefore);
    // Attack → locked out (the attack gate reads the SAME durable condition).
    expect(() => executeCommand(first.state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foes[0]!.id, weight: 'light',
    }, scriptedDice())).toThrowError(expect.objectContaining({ code: 'attack.locked' }));
  });

  it('Spite: Hatred+ of the unique closest foe is evaluated POST-resolution, recorded with hatred-of provenance, plus lockout', () => {
    const { state, hero, foes } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }]);
    const first = heroicRam(state, hero.id, foes[0]!.id);
    const afterHeroic = first.state.actors[hero.id];
    // The shared `hatred` condition (potency plus) whose apply path records
    // `ruleState['hatred-of']` = the chosen closest foe's id — the damage
    // authority halves damage against every OTHER foe (ICON p.104).
    expect(afterHeroic.conditions.some(({ id, potency }) => id === 'hatred' && potency === 'plus')).toBe(true);
    expect(afterHeroic.ruleState['hatred-of']).toBe(foes[0]!.id);
    expect(conditionIdOn(afterHeroic, 'spite:heroic-lockout')).toBe(true);
    // The consequence is NOT in the recorded event mutations — the reducer
    // resumed the post-resolution continuation against then-current state.
    const event = ruleEvent(first);
    expect(event && event.type === 'RULE_MUTATIONS_APPLIED'
      ? !event.mutations.some((mutation) => mutation.kind === 'condition' && mutation.conditionId === 'hatred')
      : false).toBe(true);
    expect(applyEvents(state, first.events)).toEqual(first.state);
    // Lockout blocks a later Heroic.
    expect(() => secondHeroic(first.state, hero.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-lockout' }));
  });

  it('Spite: an ability that moves the Knave re-evaluates the closest foe POST-resolution (the movement is final before the query)', () => {
    const { state, hero } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }, { x: 1, y: 3 }]);
    const [foeA, foeB] = Object.values(state.actors).filter((actor) => actor.id !== hero.id);
    // Pre-resolution: foeA (2,1) is the closest (distance 1 vs 2).
    const first = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:valiant',
      actionId: 'default',
      timing: 'use',
      input: { directions: { rush1: { x: 0, y: 1 }, rush2: { x: 0, y: 1 }, rush3: { x: 0, y: 1 } } },
      triggers: ['heroic'],
    }, scriptedDice());
    // The heroic valiant rushed the Knave down the column, shoving foeB
    // ahead of it: the Knave ends at (1,4) and foeB at (1,6) — the closest
    // foe is now foeB, computed from the RESOLVED battlefield.
    expect(first.state.actors[hero.id].position).toEqual({ x: 1, y: 4 });
    expect(first.state.actors[hero.id].ruleState['hatred-of']).toBe(foeB!.id);
    expect(first.state.actors[hero.id].ruleState['hatred-of']).not.toBe(foeA!.id);
    expect(applyEvents(state, first.events)).toEqual(first.state);
  });

  it('Spite: an ability that defeats the former closest foe selects the survivor POST-resolution', () => {
    const { state, hero } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }, { x: 5, y: 1 }]);
    const [foeA, foeB] = Object.values(state.actors).filter((actor) => actor.id !== hero.id);
    // Pre-resolution: foeA (2,1) is the closest. The heroic takedown attack
    // defeats it; the post-resolution query must exclude the defeated foe
    // and select foeB.
    state.actors[foeA!.id].hp = 5;
    const first = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'colossus:takedown',
      actionId: 'default',
      timing: 'use',
      attackTargetId: foeA!.id,
      input: {},
      triggers: ['heroic'],
    }, scriptedDice(15, 6));
    expect(first.state.actors[foeA!.id].defeated).toBe(true);
    expect(first.state.actors[hero.id].ruleState['hatred-of']).toBe(foeB!.id);
    expect(applyEvents(state, first.events)).toEqual(first.state);
  });

  it('Spite: an equidistant post-resolution tie opens the U4 window — no invented tie-break, consequences wait for the recorded choice', () => {
    const { state, hero } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }, { x: 1, y: 2 }]);
    const foes = Object.values(state.actors).filter((actor) => actor.id !== hero.id);
    expect(foes).toHaveLength(2);
    // The heroic valiant's rush toward foeB is blocked at (1,2) — no
    // movement, so both foes stay equidistant (distance 1). The command
    // SUCCEEDS; the tie is not a pre-resolution failure.
    const first = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:valiant',
      actionId: 'default',
      timing: 'use',
      input: { directions: { rush1: { x: 0, y: 1 }, rush2: { x: 0, y: 1 }, rush3: { x: 0, y: 1 } } },
      triggers: ['heroic'],
    }, scriptedDice());
    // The post-resolution tie window is open; hatred+ and lockout are NOT
    // applied while the recorded choice is pending (never an invented
    // tie-break).
    const window = first.state.decisionWindows.find((candidate) => candidate.choice?.key === 'closest-foe');
    expect(window).toBeDefined();
    expect(first.state.actors[hero.id].ruleState['hatred-of']).toBeUndefined();
    expect(conditionIdOn(first.state.actors[hero.id], 'spite:heroic-lockout')).toBe(false);
    expect(applyEvents(state, first.events)).toEqual(first.state);
  });

  it('Spite: the recorded U4 choice through the post-resolution window applies hatred+ toward the chosen foe; replay consumes the choice', () => {
    const { state, hero } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }, { x: 1, y: 2 }]);
    const foes = Object.values(state.actors).filter((actor) => actor.id !== hero.id);
    const first = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:valiant',
      actionId: 'default',
      timing: 'use',
      input: { directions: { rush1: { x: 0, y: 1 }, rush2: { x: 0, y: 1 }, rush3: { x: 0, y: 1 } } },
      triggers: ['heroic'],
    }, scriptedDice());
    const window = first.state.decisionWindows.find((candidate) => candidate.choice?.key === 'closest-foe');
    expect(window).toBeDefined();
    const chosen = foes[1]!;
    const answer = executeCommand(first.state, {
      type: 'ANSWER_DECISION_WINDOW',
      windowId: window!.id,
      input: { actorIds: { 'closest-foe': [chosen.id] } },
    }, scriptedDice());
    const after = answer.state.actors[hero.id];
    expect(after.ruleState['hatred-of']).toBe(chosen.id);
    expect(conditionIdOn(after, 'spite:heroic-lockout')).toBe(true);
    // Replay consumes the recorded choice — never re-queries it.
    expect(applyEvents(state, [...first.events, ...answer.events])).toEqual(answer.state);
  });

  it('Spite: a post-resolution tie answered with a non-closest foe FAILS CLOSED', () => {
    const { state, hero } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }, { x: 1, y: 2 }, { x: 6, y: 1 }]);
    const first = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'bastion:valiant',
      actionId: 'default',
      timing: 'use',
      input: { directions: { rush1: { x: 0, y: 1 }, rush2: { x: 0, y: 1 }, rush3: { x: 0, y: 1 } } },
      triggers: ['heroic'],
    }, scriptedDice());
    const window = first.state.decisionWindows.find((candidate) => candidate.choice?.key === 'closest-foe');
    expect(window).toBeDefined();
    const farFoe = Object.values(first.state.actors).find((actor) => actor.id !== hero.id && actor.position!.x === 6)!;
    const before = JSON.stringify(first.state);
    expect(() => executeCommand(first.state, {
      type: 'ANSWER_DECISION_WINDOW',
      windowId: window!.id,
      input: { actorIds: { 'closest-foe': [farFoe.id] } },
    }, scriptedDice())).toThrowError(/not among the equidistant closest foes/);
    expect(JSON.stringify(first.state)).toBe(before);
  });
});

describe('Stalwart Gambit heroic path', () => {
  const gambitFixture = (foePositions: { x: number; y: number }[] = [{ x: 2, y: 1 }]) => {
    let state = createEncounter('Stalwart Gambit fixture');
    const hero = actorFromCharacter(nonStalwartCharacter(), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.traitIds = [];
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    const foes: EncounterActor[] = [];
    for (const position of foePositions) {
      const foe = createFoe('Relict', position);
      state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
      foes.push(foe);
    }
    state = startEncounterTo(state, hero.id);
    return { state, hero: Object.values(state.actors).find((actor) => actor.id === hero.id)!, foes };
  };

  it('a non-Stalwart character using a Stalwart ability may declare Heroic once per combat, free', () => {
    const { state, hero, foes } = gambitFixture();
    const first = heroicRam(state, hero.id, foes[0]!.id);
    // No cost: the gambit Heroic is free (no sacrifice, no lockout).
    expect(first.state.actors[hero.id].hp).toBe(hero.hp);
    expect(first.state.actors[hero.id].conditions.length).toBe(0);
    const event = ruleEvent(first);
    expect(event && event.type === 'RULE_MUTATIONS_APPLIED'
      ? event.triggerActivations?.some(({ trigger, provenance }) => trigger === 'heroic' && provenance === 'validated-player-activation')
      : false).toBe(true);
    expect(applyEvents(state, first.events)).toEqual(first.state);
    // The once-per-combat ledger is consumed on the recorded event.
    expect(first.state.actors[hero.id].ruleState['ledger:combat:stalwart:gambit:heroics']).toBe(true);
  });

  it('a second Gambit Heroic in the same combat is rejected', () => {
    const { state, hero, foes } = gambitFixture();
    const first = heroicRam(state, hero.id, foes[0]!.id);
    const secondBefore = JSON.stringify(first.state);
    expect(() => secondHeroic(first.state, hero.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-combat' }));
    expect(JSON.stringify(first.state)).toBe(secondBefore);
  });

  it('a Gambit Heroic on an unrelated (non-Stalwart) ability is rejected', () => {
    const { state, hero } = gambitFixture();
    // `fool:party-favor` is a Vagabond-class ability — the gambit never
    // covers it, and the Fool owns no heroic-granting trait.
    const before = JSON.stringify(state);
    expect(() => executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'fool:party-favor',
      actionId: 'default',
      timing: 'use',
      input: {},
      triggers: ['heroic'],
    }, scriptedDice())).toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('ordinary Stalwart-class job paths are unaffected by the gambit (their own trait recipe governs)', () => {
    // A Bastion (Stalwart class) with Strive: the gambit row never applies
    // (actor classId IS 'stalwart'); the Strive recipe's fail-closed
    // rejection governs, and no once-per-combat gambit ledger is consumed.
    const { state, hero, foes } = heroicFixture(['bastion:trait:strive']);
    expect(() => heroicRam(state, hero.id, foes[0]!.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-incomplete' }));
    expect(state.actors[hero.id].ruleState['ledger:combat:stalwart:gambit:heroics']).toBeUndefined();
  });
});
