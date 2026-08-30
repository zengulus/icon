import '../automation/content/registry.js';
import { windowHeldSave } from '../automation/kernels/decision-window.js';
import { describe, expect, it } from 'vitest';
import { DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS, EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { JOBS, findAbility } from '../catalog.js';
import { findRuleSourceUnit } from '../source-units.js';
import type { EncounterActor, EncounterState, Position } from '../types.js';
import {scriptedDice, validCharacter, endTurnOnly, endTurnTo, startEncounterTo} from './fixtures.js';

/**
 * Source-derived golden fixtures for the independently executable Knave
 * ability set (ICON p.139–144). Each scenario resolves through the shared
 * encounter reducer and must replay to the identical state through applyEvents.
 * Combo upgrades and sub-actions (Dire Parry) are exercised through
 * EXECUTE_RULE with the matching action id.
 */

interface KnaveFixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor;
}

function knaveEncounter(options: { foe?: Position; second?: Position | null } = {}): KnaveFixture {
  let state = createEncounter('Knave fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  // Isolate knave mechanics: the shared bastion fixture character carries
  // Bull's Strength, whose collide fold would add incidental 2 damage to
  // shove tests.
  hero.traitIds = hero.traitIds.filter((id) => id !== 'bastion:trait:bull-s-strength');
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second: second! };
}

const mutationsOf = (events: ReturnType<typeof executeCommand>['events'], sourceId: string) => {
  const event = events.find((candidate) => candidate.type === 'RULE_MUTATIONS_APPLIED' && candidate.sourceId === sourceId);
  return event && event.type === 'RULE_MUTATIONS_APPLIED' ? event.mutations : [];
};

describe('Knave ability automation (p.139–144)', () => {
  it('marks the eight executable abilities in the catalog and audit (Dark Knight retracted)', () => {
    for (const abilityId of EXECUTABLE_JOB_ABILITY_IDS) {
      if (!abilityId.startsWith('knave:')) continue;
      const ability = findAbility(abilityId)!;
      expect(ability.automation).toBe('executable');
      const unit = findRuleSourceUnit(abilityId)!;
      expect(compileRuleSourceUnit(unit).unsupportedClauses).toEqual([]);
    }
    const knaveIds = JOBS.find((job) => job.id === 'knave')!.abilities.map(({ id }) => id);
    // Dark Knight (p.143) is retracted: its hatred+ clause grants a player
    // choice among equidistant closest foes (corrective underlay pass
    // 2026-08-30).
    expect(knaveIds.filter((id) => EXECUTABLE_JOB_ABILITY_IDS.has(id))).toHaveLength(8);
    expect(knaveIds.filter((id) => DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS.has(id))).toEqual(['knave:dark-knight']);
  });

  it('Low Blow: true-strike attack slashes the target, and an already-slashed target gains hatred', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:low-blow', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(mutationsOf(result.events, 'knave:low-blow')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'condition', actorId: foe.id, conditionId: 'slashed' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(24);
    expect(result.state.actors[foe.id].statuses).toContain('slashed');
    expect(result.state.actors[foe.id].statuses).not.toContain('hatred');

    const preslashed = knaveEncounter({ second: null });
    preslashed.state.actors[preslashed.foe.id].statuses.push('slashed');
    const hatred = executeCommand(preslashed.state, { type: 'USE_ABILITY', actorId: preslashed.hero.id, abilityId: 'knave:low-blow', targetIds: [preslashed.foe.id] }, scriptedDice(12, 4));
    expect(hatred.state.actors[preslashed.foe.id].statuses).toContain('hatred');
    expect(hatred.state.actors[preslashed.foe.id].ruleState['hatred-of']).toBe(preslashed.hero.id);

    const dodging = knaveEncounter({ second: null });
    dodging.state.actors[dodging.foe.id].conditions.push({ id: 'dodge', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const missed = executeCommand(dodging.state, {
      type: 'USE_ABILITY', actorId: dodging.hero.id, abilityId: 'knave:low-blow', targetIds: [dodging.foe.id],
    }, scriptedDice(1));
    // Low Blow's True Strike still misses its Defense 8 target, but p.104
    // makes the resulting miss branch ignore Dodge. The source exception is
    // carried on the damage mutation instead of disabling Dodge globally.
    expect(mutationsOf(missed.events, 'knave:low-blow')).toContainEqual(expect.objectContaining({
      kind: 'damage', actorId: dodging.foe.id, delivery: 'miss', ignoreDodge: true,
    }));
    expect(missed.state.actors[dodging.foe.id].hp).toBe(28);
    expect(applyEvents(dodging.state, missed.events)).toEqual(missed.state);
  });

  it('Low Blow talent 1: "Deals bonus damage if your foe is suffering from a status" (p.139)', () => {
    // F6a: the registered bonus-damage rule folds one bonus die at the
    // USE_ABILITY boundary when the attack target already suffers a status;
    // the [D] roll resolves keep-highest (ICON p.102).
    const { state, hero, foe } = knaveEncounter({ second: null });
    state.actors[hero.id].talents = { 'knave:low-blow': 1 };
    state.actors[foe.id].conditions.push({ id: 'slashed', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    // Attack d20 12 (hit vs defense 8 under true strike); damage dice roll 2
    // then 6 — bonus damage rolls one more die and keeps the highest → 6 + fray 4.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:low-blow', targetIds: [foe.id] }, scriptedDice(12, 2, 6));
    expect(result.state.actors[foe.id].hp).toBe(22); // 32 - (6 + 4)
    expect(applyEvents(state, result.events)).toEqual(result.state);

    // Same talent, target with no status: base [D]+fray (one die, no bonus).
    const clean = knaveEncounter({ second: null });
    clean.state.actors[clean.hero.id].talents = { 'knave:low-blow': 1 };
    const plain = executeCommand(clean.state, { type: 'USE_ABILITY', actorId: clean.hero.id, abilityId: 'knave:low-blow', targetIds: [clean.foe.id] }, scriptedDice(12, 5));
    expect(plain.state.actors[clean.foe.id].hp).toBe(23); // 32 - (5 + 4)
    expect(applyEvents(clean.state, plain.events)).toEqual(plain.state);

    // Talent not equipped: identical base roll against a statused foe.
    const bare = knaveEncounter({ second: null });
    bare.state.actors[bare.foe.id].conditions.push({ id: 'slashed', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const noTalent = executeCommand(bare.state, { type: 'USE_ABILITY', actorId: bare.hero.id, abilityId: 'knave:low-blow', targetIds: [bare.foe.id] }, scriptedDice(12, 5));
    expect(noTalent.state.actors[bare.foe.id].hp).toBe(23); // 32 - (5 + 4)
    expect(applyEvents(bare.state, noTalent.events)).toEqual(noTalent.state);
  });

  it('Low Blow Combo (The Hook): spends combo, rushes, and slashes at range 2', () => {
    const { state, hero, foe } = knaveEncounter({ foe: { x: 3, y: 1 }, second: null });
    state.actors[hero.id].resources.combo = 1;
    const result = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:low-blow',
      actionId: 'combo',
      timing: 'use',
      input: {},
      attackTargetId: foe.id,
    }, scriptedDice(12, 4));
    expect(result.state.actors[hero.id].resources.combo).toBe(0);
    expect(result.state.actors[hero.id].position).toEqual({ x: 2, y: 1 }); // rushed toward the target
    expect(result.state.actors[foe.id].statuses).toContain('slashed');
    expect(result.state.actors[foe.id].hp).toBe(24);
  });

  it('Provoke: adjacent foes deal 1 piercing damage back, then 2 damage to all adjacent foes', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:provoke', targetIds: [] }, scriptedDice());
    expect(mutationsOf(result.events, 'knave:provoke')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 1 },
      { kind: 'damage', actorId: hero.id, amount: 1, damageType: 'piercing' },
      { kind: 'damage', actorId: foe.id, amount: 2 },
    ]);
    expect(result.state.actors[hero.id].hp).toBe(39);
    expect(result.state.actors[foe.id].hp).toBe(30);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Revenge: attack, then unstoppable and counter until the end of the next turn', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:revenge', targetIds: [foe.id] }, scriptedDice(12, 4));
    expect(mutationsOf(result.events, 'knave:revenge')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'condition', actorId: hero.id, conditionId: 'unstoppable' },
      { kind: 'condition', actorId: hero.id, conditionId: 'counter' },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 8 },
    ]);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(0);
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'unstoppable')).toBe(true);
    expect(result.state.actors[hero.id].conditions.some(({ id }) => id === 'counter')).toBe(true);
    expect(result.state.actors[foe.id].hp).toBe(24);
  });

  it('Riposte: enters the stance and arms the Dire Parry interrupt', () => {
    const { state, hero } = knaveEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:riposte', targetIds: [] }, scriptedDice());
    expect(result.state.actors[hero.id].stance).toMatchObject({ stanceId: 'riposte' });
    expect(result.state.actors[hero.id].ruleState['riposte:armed']).toBe(true);
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
  });

  it('Riposte: Dire Parry gambles, deals that damage, and slashes plus shoves on a 6', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const parry = executeCommand(state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:riposte',
      actionId: 'dire-parry',
      timing: 'interrupt',
      input: {},
      triggerSourceId: foe.id,
    }, scriptedDice(6));
    expect(parry.state.actors[foe.id].hp).toBe(26); // 6 gamble damage
    expect(parry.state.actors[foe.id].statuses).toContain('slashed');
    expect(parry.state.actors[foe.id].position).toEqual({ x: 3, y: 1 }); // shoved 1 away
    expect(parry.state.actors[hero.id].interruptUses['knave:riposte']).toBe(1);
  });

  it('Dark Knight: retracted — hatred+ of the closest foe grants a player choice on equidistant ties (p.143)', () => {
    // ICON p.143: "You gain hatred+ of the closest foe to you at the start of
    // your turn or when you enter this stance. If multiple foes are
    // equidistant, you may choose." No player-choice seam exists at that
    // timing (U4 CHOOSE is not built), so the ability is documented as
    // non-executable rather than silently picking an actor by id tie-break.
    const { state, hero } = knaveEncounter({ second: null });
    // The fixture loadout comes from EXECUTABLE_JOB_ABILITY_IDS; put the
    // retracted ability back so the command reaches the executability gate
    // (rather than failing earlier as not-equipped).
    state.actors[hero.id].abilityIds = [...state.actors[hero.id].abilityIds, 'knave:dark-knight'];
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:dark-knight', targetIds: [] }, scriptedDice()))
      .toThrow('not an independently executable ICON rule yet');
  });

  it('Strongarm: shoves an adjacent foe around the user, then shoves 1 more', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:strongarm', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    expect(result.state.actors[hero.id].actionsRemaining).toBe(1);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Strongarm talent 1: a comeback range-2 target is removed and placed into adjacency before the spin (F1 remove/place)', () => {
    const { state, hero, foe } = knaveEncounter({ foe: { x: 3, y: 1 }, second: null });
    state.actors[hero.id].talents = { 'knave:strongarm': 1 };
    state.actors[hero.id].hp = 1; // bloodied → the comeback range override holds
    // Range 2 is only legal with the talent's comeback override. The program
    // then emits the F1 remove/place reposition BEFORE the spin: the target
    // is removed and placed into the canonical first free adjacent cell
    // (0,1), from which the circular spin starts.
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:strongarm', targetIds: [foe.id] }, scriptedDice());
    // The event's mutation stream is [actions spend, remove, place, shove…]:
    // the F1 remove/place reposition precedes the spin.
    const moves = mutationsOf(result.events, 'knave:strongarm').filter((mutation) => mutation.kind === 'move');
    expect(moves[0]).toMatchObject({ actorId: foe.id, movement: 'remove' });
    // The canonical first free adjacent cell (diagonals included, sorted by
    // distance then coordinates) around the user at (1,1) is (0,0).
    expect(moves[1]).toMatchObject({ actorId: foe.id, movement: 'place', positions: [{ x: 0, y: 0 }] });
    // The spin (a place around the ring) then the final shove follow.
    expect(moves.some((mutation) => mutation.movement === 'shove' && mutation.actorId === foe.id)).toBe(true);
    expect(result.state.actors[foe.id].position).not.toEqual({ x: 1, y: 1 });
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('Strongarm talent 1: equipped but NOT bloodied — an adjacent target gets base Strongarm with NO remove/place (F1 gating regression)', () => {
    // The talent text is "Comeback: …" — the ENTIRE talent effect is gated on
    // active Comeback (user bloodied). A full-HP user with the talent
    // equipped must resolve EXACTLY like base Strongarm: adjacent hold, the
    // circular spin, the passed-through damage, the final shove — and no
    // remove/place reposition mutation stream at all.
    const { state, hero, foe } = knaveEncounter({ second: null });
    state.actors[hero.id].talents = { 'knave:strongarm': 1 };
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:strongarm', targetIds: [foe.id] }, scriptedDice());
    // Same final position as the no-talent base fixture (the spin around
    // (1,1) then the final shove): the talent changed nothing.
    expect(result.state.actors[foe.id].position).toEqual({ x: 3, y: 1 });
    const moves = mutationsOf(result.events, 'knave:strongarm').filter((mutation) => mutation.kind === 'move');
    // No remove/place reposition: the first move mutation is the spin's
    // place/shove, never a `remove`.
    expect(moves.some((mutation) => mutation.movement === 'remove')).toBe(false);
    expect(moves.some((mutation) => mutation.movement === 'place' && mutation.actorId === foe.id && mutation.positions[0] && mutation.positions[0].x === 0)).toBe(false);
    expect(applyEvents(state, result.events)).toEqual(result.state); // replay
  });

  it('Strongarm talent 1: without the comeback trigger (or the talent) the range-2 target stays denied', () => {
    // Strongarm is an effect ability (no Attack: line), so its hold range is
    // enforced by the program's own gate mirroring the registered range rule:
    // a range-2 target is only legal while the user is bloodied AND the
    // talent is equipped. The remove/place reposition is never reached when
    // the hold is denied.
    const { state, hero, foe } = knaveEncounter({ foe: { x: 3, y: 1 }, second: null });
    state.actors[hero.id].talents = { 'knave:strongarm': 1 };
    expect(() => executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:strongarm', targetIds: [foe.id] }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'choice.actor-range' }));
    // No talent at all: the base ability stays a range-1 melee hold.
    const plain = knaveEncounter({ foe: { x: 3, y: 1 }, second: null });
    expect(() => executeCommand(plain.state, { type: 'USE_ABILITY', actorId: plain.hero.id, abilityId: 'knave:strongarm', targetIds: [plain.foe.id] }, scriptedDice()))
      .toThrowError(expect.objectContaining({ code: 'choice.actor-range' }));
  });

  it('Intimidate: marks a distant foe and ends the turn', () => {
    const { state, hero, foe } = knaveEncounter({ foe: { x: 6, y: 1 }, second: { x: 7, y: 1 } });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:intimidate', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[foe.id].marks.some(({ markId, ownerId }) => markId === 'intimidate' && ownerId === hero.id)).toBe(true);
    expect(result.state.actors[hero.id].turnTaken).toBe(true);
    // The ability ended the hero's turn; the GM selects the foe via TAKE_TURN
    // (the scheduler never auto-selects, ICON p.87).
    expect(result.state.activeActorId).toBeNull();
    expect(result.state.eligibleSide).toBe('foes');
    const foeTurn = executeCommand(result.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(foeTurn.activeActorId).toBe(foe.id);
  });

  it('Intimidate: starting the turn adjacent to the marked foe deals fray, stuns, and ends the mark', () => {
    const { state, hero, foe, second } = knaveEncounter({ foe: { x: 6, y: 1 }, second: { x: 7, y: 1 } });
    const marked = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:intimidate', targetIds: [foe.id] }, scriptedDice()).state;
    marked.actors[hero.id].position = { x: 5, y: 1 };
    // Intimidate ended the hero's turn; both foes pass, then round 2 opens
    // with the player side and the hero's next turn-start resolves the mark.
    const foe1 = executeCommand(marked, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const afterFoe1 = endTurnOnly(foe1, scriptedDice());
    const foe2 = executeCommand(afterFoe1, { type: 'TAKE_TURN', actorId: second.id }, scriptedDice()).state;
    const afterSecond = endTurnOnly(foe2, scriptedDice());
    expect(afterSecond.round).toBe(2);
    expect(afterSecond.eligibleSide).toBe('heroes');
    const heroTurn = executeCommand(afterSecond, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice()).state;
    expect(heroTurn.actors[foe.id].hp).toBe(28); // fray 4
    expect(heroTurn.actors[foe.id].statuses).toContain('stunned');
    expect(heroTurn.actors[foe.id].marks).toEqual([]);
  });

  it('Sucker Punch: an adjacent-foe interrupt that tracks its usage', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:sucker-punch', targetIds: [foe.id] }, scriptedDice());
    expect(result.state.actors[hero.id].interruptUses['knave:sucker-punch']).toBe(1);
    expect(result.state.actors[hero.id].interruptUsedThisTurn).toBe(true);
    expect(result.state.actors[hero.id].ruleState['sucker-punch:used']).toBe(true);
  });

  /** The hero's ability makes the adjacent foe save: a success branch (2
   * damage, delivery `save-success`) and a failure branch (8 damage). The
   * save rolled a 12, so the event carries the success branch. */
  const saveAbilityEvent = (heroId: string, foeId: string) => ({
    type: 'RULE_MUTATIONS_APPLIED' as const,
    actorId: heroId,
    sourceId: 'fixture:save-ability',
    actionId: 'default',
    timing: 'use' as const,
    tags: [],
    mutations: [
      { kind: 'actions' as const, sourceId: 'fixture:save-ability', actorId: heroId, operation: 'spend' as const, amount: 1 },
      {
        kind: 'save' as const,
        sourceId: 'fixture:save-ability',
        actorId: foeId,
        // The F2 durable SaveWindow record: an effect-kind save with a
        // declarative continuation branch and its modifier breakdown.
        windowKind: 'effect' as const,
        windowId: 'fixture:save-ability:default:effect-save:1:foe',
        roll: 12,
        boon: 0,
        total: 12,
        success: true,
        threshold: 10,
        modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
        branch: {
          boon: 0,
          threshold: 10,
          onSuccess: [{ kind: 'damage' as const, target: { kind: 'trigger-targets' as const }, amount: { kind: 'constant' as const, value: 2 }, damageType: 'normal' as const, delivery: 'save-success' as const }],
          onFailure: [{ kind: 'damage' as const, target: { kind: 'trigger-targets' as const }, amount: { kind: 'constant' as const, value: 8 }, damageType: 'normal' as const, delivery: 'effect' as const }],
        },
      },
      { kind: 'damage' as const, sourceId: 'fixture:save-ability', sourceActorId: heroId, actorId: foeId, amount: 2, damageType: 'normal' as const, instance: 1, delivery: 'save-success' as const, ignoreCover: false },
    ],
  });

  it('Sucker Punch: holds an adjacent foe’s save and re-rolls it, keeping the second result (p.143)', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    // The save's branch (2 damage) is held; the ability's cost already paid.
    expect(deferred.actors[foe.id].hp).toBe(32);
    const window = deferred.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'save-rolled');
    expect(window).toBeDefined();
    expect(windowHeldSave(window!)).toMatchObject({ targetId: foe.id, boon: 0, sourceId: 'fixture:save-ability' });
    expect(window!.heldEffects).toHaveLength(2); // the save record + the 2-damage success branch

    // Sucker Punch re-rolls the save: the second roll (3) fails, so the held
    // 2-damage success branch is replaced by the 8-damage failure branch.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice(3));
    expect(interrupt.state.actors[foe.id].hp).toBe(24); // 32 - 8; the held 2 never applied
    expect(interrupt.state.actors[hero.id].interruptUses['knave:sucker-punch']).toBe(1);
    expect(interrupt.state.actors[hero.id].ruleState['sucker-punch:used']).toBe(true);
    expect(interrupt.state.decisionWindows.some((candidate) => candidate.actorId === hero.id && candidate.kind === 'save-rolled')).toBe(false);
    // The regenerated save carries the same durable F2 record as the original
    // (windowKind, modifiers, threshold), so the re-roll stays replay-exact.
    const rerollEvent = interrupt.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED' && 'reroll' in event);
    expect(rerollEvent).toBeDefined();
    const regenerated = (rerollEvent as { reroll: { mutations: { kind: string }[] } }).reroll.mutations[0];
    expect(regenerated).toMatchObject({
      kind: 'save', actorId: foe.id, windowKind: 'effect', windowId: 'fixture:save-ability:default:effect-save:1:foe',
      roll: 3, boon: 0, total: 3, success: false, threshold: 10,
      modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
    });
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Sucker Punch: a re-roll that keeps the save result applies the same branch', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice(14));
    expect(interrupt.state.actors[foe.id].hp).toBe(30); // 32 - 2, the regenerated success branch
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Sucker Punch Heroic: the re-rolled save is made with +1 curse', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    // The base save had boon 0; Heroic's curse means the re-roll is rolled with
    // +1 curse, so a 10 succeeds without the curse but fails with it.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
      triggers: ['heroic'],
      // The re-roll rolls a new d20 and a new boon/curse die from the same
      // modifier (-1 with Heroic's curse): d20 10, d6 1 → boon -1.
    }, scriptedDice(10, 1));
    const rerollEvent = interrupt.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED' && 'reroll' in event);
    expect(rerollEvent).toBeDefined();
    const reroll = (rerollEvent as { reroll?: { roll: number; boon: number; total: number; success: boolean } }).reroll;
    expect(reroll).toMatchObject({ roll: 10, boon: -1, total: 9, success: false });
    expect(interrupt.state.actors[foe.id].ruleState['sucker-punch:curse']).toBe(true);
    // The failure branch (8 damage) replaces the held success branch (2).
    expect(interrupt.state.actors[foe.id].hp).toBe(24); // 32 - 8
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('Sucker Punch: an unanswered save-rolled window resolves the original save at the end of the turn', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    expect(deferred.actors[foe.id].hp).toBe(32);
    const ended = endTurnTo(deferred, foe.id, scriptedDice());
    expect(ended.actors[foe.id].hp).toBe(30); // 32 - 2, the original success branch resolved
    expect(ended.decisionWindows).toHaveLength(0);
  });

  it('Bleak Mercy: 2[D]+fray attack, with only its named defenses bypassed at three statuses', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:bleak-mercy', targetIds: [foe.id] }, scriptedDice(12, 4, 4));
    expect(mutationsOf(result.events, 'knave:bleak-mercy')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 12, hit: true },
      { kind: 'damage', actorId: foe.id, amount: 12 },
    ]);
    expect(result.state.actors[foe.id].hp).toBe(20);

    const stacked = knaveEncounter({ second: null });
    const stackedFoe = stacked.state.actors[stacked.foe.id];
    stackedFoe.statuses.push('slashed', 'blind', 'dazed');
    stackedFoe.armor = 10;
    stackedFoe.vigor = 5;
    stackedFoe.hp = 10;
    stackedFoe.conditions.push({ id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const empowered = executeCommand(stacked.state, { type: 'USE_ABILITY', actorId: stacked.hero.id, abilityId: 'knave:bleak-mercy', targetIds: [stacked.foe.id] }, scriptedDice(12, 4, 4));
    // p.144 bypasses exactly Armor, Vigor, and Defiance. The source damage is
    // normal rather than Divine, so this assertion does not accidentally
    // grant bypasses for unrelated defenses.
    expect(empowered.state.actors[stacked.foe.id]).toMatchObject({ hp: 0, defeated: true });
    expect(mutationsOf(empowered.events, 'knave:bleak-mercy')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 12, hit: true, trueStrike: true },
      {
        kind: 'damage', actorId: stacked.foe.id, amount: 12, damageType: 'normal',
        bypassVigor: true, ignoreArmor: true, ignoreDefiance: true,
      },
    ]);

    const resisted = knaveEncounter({ second: null });
    const resistedFoe = resisted.state.actors[resisted.foe.id];
    resistedFoe.statuses.push('slashed', 'blind', 'dazed');
    resistedFoe.armor = 10;
    resistedFoe.vigor = 5;
    resistedFoe.conditions.push({ id: 'resistance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null });
    const resistedResult = executeCommand(resisted.state, { type: 'USE_ABILITY', actorId: resisted.hero.id, abilityId: 'knave:bleak-mercy', targetIds: [resisted.foe.id] }, scriptedDice(12, 4, 4));
    // The same source flags leave Resistance intact: p.93 halves the
    // Armor-ignored 12 once, then p.144 routes the final 6 straight to HP.
    expect(resistedResult.state.actors[resisted.foe.id]).toMatchObject({ hp: 26, vigor: 5, defeated: false });
  });

  it('Bleak Mercy: three positive conditions that are not statuses do not empower it (p.144)', () => {
    const { state, hero, foe } = knaveEncounter({ second: null });
    // Counter, Defiance, and Resistance are conditions, not statuses. Counting
    // the broad projected condition set would reach three and grant true
    // strike plus the bypass package; p.144's escalation sees only statuses.
    const foeActor = state.actors[foe.id];
    foeActor.armor = 10;
    foeActor.vigor = 5;
    foeActor.conditions.push(
      { id: 'counter', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null },
      { id: 'defiance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null },
      { id: 'resistance', sourceId: 'fixture', ownerId: null, potency: 'normal', duration: null },
    );
    const result = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'knave:bleak-mercy', targetIds: [foe.id] }, scriptedDice(12, 4, 4));
    // Not empowered: normal determination applies armor (12 - 10 = 2) and then
    // the single Resistance halving (ceil(2 / 2) = 1) to vigor. No defense is
    // bypassed and the attack stays a plain roll.
    expect(result.state.actors[foe.id]).toMatchObject({ hp: 32, vigor: 4, defeated: false });
    expect(mutationsOf(result.events, 'knave:bleak-mercy')).toMatchObject([
      { kind: 'actions', operation: 'spend', amount: 2 },
      { kind: 'attack', d20: 12, hit: true, trueStrike: false },
      { kind: 'damage', actorId: foe.id, amount: 12, damageType: 'normal' },
    ]);
    const damageMutations = mutationsOf(result.events, 'knave:bleak-mercy').filter((mutation) => mutation.kind === 'damage');
    expect(damageMutations.every((mutation) => !('bypassVigor' in mutation || 'ignoreArmor' in mutation || 'ignoreDefiance' in mutation))).toBe(true);
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });
});
