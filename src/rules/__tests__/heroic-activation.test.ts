import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { EncounterActor, EncounterState } from '../types.js';
import { scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * Heroic activation transaction (ICON pp.116, 121, 127, 134, 141): Heroic is
 * a DECLARATION ("I use this ability's heroic effects") that becomes a
 * validated-player-activation ONLY through the generic transaction against
 * the content-registered heroic-granting trait rows. Owning a trait is never
 * proof that a specific activation was legal and paid; naming `heroic` never
 * bypasses the transaction.
 *
 * Proven per trait:
 * - no granting trait → reject before any cost/effect/RNG;
 * - Wolfheart → once-per-round + a real 25%-of-base-max sacrifice, second
 *   use in the same round rejected, unpayable (0 hp) rejected atomically;
 * - Demon Strength → lockout blocks both later Heroics AND attacks;
 * - Strive → lockout blocks later Heroics (the shove/half-damage halves stay
 *   precisely-blocked `missingSeams` on the content row — never dropped);
 * - Spite → Hatred+ of the closest foe, equidistant tie is a recorded U4
 *   choice (an unrecorded tie fails — never an invented tie-break), lockout
 *   blocks later Heroics.
 *
 * Every accepted activation rides the resolution's own event with the
 * recorded mutations + `triggerActivations` provenance; replay applies
 * exactly what the command decided.
 */
interface HeroicFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
}

function heroicFixture(traitIds: readonly string[], foePositions: { x: number; y: number }[] = [{ x: 2, y: 1 }]): HeroicFixture {
  let state = createEncounter('Heroic activation fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  // Explicit trait set — the fixture never depends on catalog defaults.
  hero.traitIds = [...traitIds];
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  const foeIds: string[] = [];
  for (const position of foePositions) {
    const foe = createFoe('Relict', position);
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    foeIds.push(foe.id);
  }
  state = startEncounterTo(state, hero.id);
  const actors = Object.values(state.actors);
  const placedHero = actors.find((actor) => actor.id === hero.id)!;
  void foeIds;
  return { state, hero: placedHero, foe: actors.find((actor) => actor.id !== hero.id)! };
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
 * which must reject it (round spent / locked out) before ANY effect. */
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
  it('rejects Heroic on an actor with no granting trait — before any cost, effect, or RNG, with nothing consumed', () => {
    const { state, hero, foe } = heroicFixture([]);
    const before = JSON.stringify(state);
    expect(() => heroicRam(state, hero.id, foe.id)).toThrowError(expect.objectContaining({ code: 'rule.trigger-forged' }));
    expect(JSON.stringify(state)).toBe(before);
    expect(state.actors[hero.id].actionsRemaining).toBe(2);
    expect(state.actors[foe.id].hp).toBe(32);
  });

  it('Wolfheart: entitlement → real 25%-of-base-max sacrifice + Heroic; second use the same round is rejected', () => {
    const { state, hero, foe } = heroicFixture(['colossus:trait:wolfheart']);
    const baseMax = hero.baseMaxHp;
    const sacrifice = Math.ceil(0.25 * baseMax);
    const before = hero.hp;
    const first = heroicRam(state, hero.id, foe.id);
    expect(first.state.actors[hero.id].hp).toBe(before - sacrifice);
    expect(first.state.actors[hero.id].conditions.length).toBe(0); // Wolfheart grants NO post-use lockout (source text)
    // The recorded mutations ride the event: sacrifice + round-consume + the
    // resolution's own effects; replay reproduces the state exactly.
    expect(applyEvents(state, first.events)).toEqual(first.state);
    const event = ruleEvent(first);
    expect(event && event.type === 'RULE_MUTATIONS_APPLIED'
      ? event.triggerActivations?.some(({ trigger, provenance }) => trigger === 'heroic' && provenance === 'validated-player-activation')
      : false).toBe(true);
    // Second Wolfheart heroic in the same round: the once-a-round U16 commit
    // recorded on the FIRST event consumes the round — rejected atomically
    // (round gate fires before any effect of the second ability), with
    // nothing else consumed or resolved.
    const secondState = first.state;
    const secondBefore = JSON.stringify(secondState);
    expect(() => secondHeroic(secondState, hero.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-round' }));
    expect(JSON.stringify(secondState)).toBe(secondBefore);
  });

  it('Wolfheart unable to pay the sacrifice legally → rejected atomically before effects', () => {
    const { state, hero, foe } = heroicFixture(['colossus:trait:wolfheart']);
    // An alive actor at 0 hp cannot legally sacrifice (p.97: sacrifice can
    // never be paid by an owner at 0 hp). The transaction must fail closed
    // with nothing resolved.
    state.actors[hero.id].hp = 0;
    const before = JSON.stringify(state);
    expect(() => heroicRam(state, hero.id, foe.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-unavailable' }));
    expect(JSON.stringify(state)).toBe(before);
    expect(state.actors[foe.id].hp).toBe(32);
  });

  it('Demon Strength: the post-use lockout prevents a later illegal Heroic AND a later attack', () => {
    const { state, hero, foe } = heroicFixture(['demon-slayer:trait:demon-strength']);
    const first = heroicRam(state, hero.id, foe.id);
    const afterHeroic = first.state.actors[hero.id];
    expect(conditionIdOn(afterHeroic, 'demon-strength:heroic-lockout')).toBe(true);
    expect(applyEvents(state, first.events)).toEqual(first.state);
    // Second heroic → locked out (the transaction's own availability row).
    const lockedBefore = JSON.stringify(first.state);
    expect(() => secondHeroic(first.state, hero.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-lockout' }));
    expect(JSON.stringify(first.state)).toBe(lockedBefore);
    // Attack → locked out (the attack gate reads the SAME durable condition).
    expect(() => executeCommand(first.state, {
      type: 'BASIC_ATTACK', actorId: hero.id, targetId: foe.id, weight: 'light',
    }, scriptedDice())).toThrowError(expect.objectContaining({ code: 'attack.locked' }));
  });

  it('Strive: the post-use lockout prevents a later illegal Heroic (shove/half-damage halves stay precisely-blocked seams)', () => {
    const { state, hero, foe } = heroicFixture(['bastion:trait:strive']);
    const first = heroicRam(state, hero.id, foe.id);
    const afterHeroic = first.state.actors[hero.id];
    expect(conditionIdOn(afterHeroic, 'strive:heroic-lockout')).toBe(true);
    expect(applyEvents(state, first.events)).toEqual(first.state);
    const lockedBefore = JSON.stringify(first.state);
    expect(() => secondHeroic(first.state, hero.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-lockout' }));
    expect(JSON.stringify(first.state)).toBe(lockedBefore);
  });

  it('Spite: Hatred+ of the unique closest foe, recorded with hatred-of provenance, plus lockout', () => {
    const { state, hero, foe } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }]);
    const first = heroicRam(state, hero.id, foe.id);
    const afterHeroic = first.state.actors[hero.id];
    // The shared `hatred` condition (potency plus) whose apply path records
    // `ruleState['hatred-of']` = the chosen closest foe's id — the damage
    // authority halves damage against every OTHER foe (ICON p.104).
    expect(afterHeroic.conditions.some(({ id, potency }) => id === 'hatred' && potency === 'plus')).toBe(true);
    expect(afterHeroic.ruleState['hatred-of']).toBe(foe.id);
    expect(conditionIdOn(afterHeroic, 'spite:heroic-lockout')).toBe(true);
    expect(applyEvents(state, first.events)).toEqual(first.state);
    // Lockout blocks a later Heroic.
    expect(() => secondHeroic(first.state, hero.id)).toThrowError(expect.objectContaining({ code: 'rule.heroic-lockout' }));
  });

  it('Spite: an equidistant closest-foe tie with no recorded choice FAILS — never an invented tie-break', () => {
    const { state, hero } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }, { x: 1, y: 2 }]);
    const foes = Object.values(state.actors).filter((actor) => actor.id !== hero.id).map((actor) => actor.id);
    expect(foes).toHaveLength(2);
    const before = JSON.stringify(state);
    expect(() => heroicRam(state, hero.id, foes[0]!)).toThrowError(expect.objectContaining({ code: 'rule.heroic-spite-target' }));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('Spite: an equidistant tie with the RECORDED U4 choice activates toward the chosen foe', () => {
    const { state, hero } = heroicFixture(['knave:trait:spite'], [{ x: 2, y: 1 }, { x: 1, y: 2 }]);
    const foes = Object.values(state.actors).filter((actor) => actor.id !== hero.id).map((actor) => actor.id);
    const chosen = foes[1]!;
    const first = heroicRam(state, hero.id, chosen, { actorIds: { target: [chosen], 'closest-foe': [chosen] } });
    expect(first.state.actors[hero.id].ruleState['hatred-of']).toBe(chosen);
    expect(applyEvents(state, first.events)).toEqual(first.state);
  });
});