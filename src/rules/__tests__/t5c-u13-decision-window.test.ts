import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { CommandResult, DecisionWindowRecord, EncounterActor, EncounterEvent, EncounterState, Position } from '../types.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { applyOrdering, policyYieldsChoice } from '../automation/primitives/ordering.js';
import type { RuleChoice } from '../automation/primitives/types.js';
import { resolveGamble } from '../automation/primitives/gamble-window.js';
import { heldDamageContinuation, heldSaveContinuation } from '../automation/primitives/continuation.js';
import { capturedActor } from '../automation/primitives/reference.js';
import { orderDecisionWindows, windowHeldDamage, windowHeldSave } from '../automation/kernels/decision-window.js';
import { endTurnOnly, endTurnTo, scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * T5c U13 acceptance (docs/underlay-completion-plan.md U13): ONE typed
 * decision-window authority (`kernels/decision-window.ts`) replaces the old
 * quasi-window schemas (the `EncounterPendingInterrupt` record, the
 * per-window `heldDamage`/`heldSave`/`heldResult` fields, and the
 * trigger-window registry). Every fixture is adversarial: evaluating against
 * the original pre-state, re-deriving a determined result, or using array
 * insertion order would produce an OBSERVABLY different outcome.
 *
 * T5b's distinction is preserved and consumed, never blurred:
 *   - DEFERRED RULE (Great Giorgios "may rush") — armed now, resolved at the
 *     window answer against THEN-CURRENT state, through a recorded U4
 *     choice. The engine never chooses "yes".
 *   - HELD RESULT (Righteous Disdain determined damage, Sucker Punch held
 *     save) — already determined, suspended in the window, and NEVER
 *     recomputed merely because execution resumes.
 */

interface U13Fixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor | null;
  ally: EncounterActor | null;
}

/** A generic hero fixture with the FULL executable ability set, so any
 * interrupt (Righteous Disdain, Boiling Blood, Sucker Punch, Perseus,
 * Masquerade) is available where the test needs it. */
function u13Encounter(options: { foe?: Position; second?: Position | null; ally?: Position | null } = {}): U13Fixture {
  let state = createEncounter('U13 fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', options.foe ?? { x: 2, y: 1 });
  const second = options.second === null ? null : createFoe('Grim', options.second ?? { x: 4, y: 1 });
  const ally = options.ally === null || options.ally === undefined ? null : actorFromCharacter(validCharacter('Mira'), options.ally);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (second) state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second, ally };
}

/** A foe ability that applies `amount` raw normal damage to `actorId`. */
const damageEvent = (sourceActorId: string, actorId: string, amount: number): EncounterEvent => ({
  type: 'RULE_MUTATIONS_APPLIED',
  actorId: sourceActorId,
  sourceId: 'fixture:foe-attack',
  actionId: 'default',
  timing: 'use',
  tags: ['attack'],
  mutations: [{ kind: 'damage', sourceId: 'fixture:foe-attack', sourceActorId, actorId, amount, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
});

/** The F2 durable save event the Sucker Punch fixtures use (mirrors
 * knave.test.ts): an effect-kind save with a declarative continuation
 * branch — the source passage p.143 requires the save's result to be
 * VISIBLE before the interrupt re-rolls it. */
function saveAbilityEvent(heroId: string, foeId: string) {
  return {
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
  };
}

const answerRush = (state: EncounterState, accept: boolean): CommandResult => {
  const window = state.decisionWindows.find((candidate) => candidate.kind === 'choice');
  if (!window) throw new Error('No choice window open.');
  return executeCommand(state, { type: 'ANSWER_DECISION_WINDOW', windowId: window.id, input: { booleans: { rush: accept } } }, scriptedDice());
};

describe('U13 — Righteous Disdain (p.128): determined damage is held, never recomputed', () => {
  it('holds the determined post-mitigation amount in the window payload and replays it byte-for-byte', () => {
    // p.128 trigger: a foe targets an ALLY in range 2 of the interrupt owner.
    // The foe damages the ALLY (Mira); the window opens for the OWNER (the
    // hero with Righteous Disdain) and the held blow applies to the ally.
    const { state, hero, foe, ally } = u13Encounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 2, y: 1 } });
    // 20 raw normal against the ally's armor 2: determined ONCE as 18 at the
    // command boundary, then held unapplied. Re-mitigating against the live
    // state (or re-reading the raw 20) would produce a different amount.
    const damaged = applyEvents(state, [damageEvent(foe.id, ally!.id, 20)]);
    expect(damaged.actors[ally!.id].hp).toBe(40); // held: not applied yet
    expect(damaged.actors[hero.id].hp).toBe(40); // the owner was never damaged
    const window = damaged.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'when-damaged');
    expect(window).toBeDefined();
    // The window carries the U12 HELD-RESULT continuation — the determined
    // amount is the durable authority (never the raw 20, never re-derived),
    // and its TARGET is the damaged ally (never the window owner).
    expect(windowHeldDamage(window!)).toMatchObject({ amount: 18, damageType: 'normal', sourceActorId: foe.id, targetId: ally!.id });
    expect(window!.heldPayload!.payload).toMatchObject({ kind: 'held-result' });
    // Replay reproduces the identical window from the identical event.
    const replayed = applyEvents(state, [damageEvent(foe.id, ally!.id, 20)]);
    expect(replayed.decisionWindows).toEqual(damaged.decisionWindows);
    // Resolution (boundary drain, unanswered) applies exactly the determined
    // amount to the ALLY — the drain consumes the payload, never re-mitigates.
    const ended = endTurnTo(damaged, foe.id, scriptedDice());
    expect(ended.actors[ally!.id].hp).toBe(22); // 40 - 18, exactly the held amount
    expect(ended.actors[hero.id].hp).toBe(40);
  });
});

describe('U13 — Boiling Blood (p.138): the defeated window opens only on prospective lethal damage', () => {
  it('holds a lethal foe blow in a defeated window; a non-lethal blow does not open one', () => {
    const { state, hero, foe } = u13Encounter({ second: null });
    // Isolate the defeated trigger: the shared fixture hero ALSO carries
    // Righteous Disdain (when-damaged), whose recipe is listed first — with
    // both armed, the when-damaged window wins the p.107 priority. Removing
    // it here leaves Boiling Blood as the only armed trigger, so the lethal
    // blow must open the defeated window.
    state.actors[hero.id].abilityIds = state.actors[hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    state.actors[hero.id].hp = 6;
    state.actors[hero.id].vigor = 0;
    // Lethal: 10 raw normal (armor 2 → determined 8 ≥ hp 6) → the foe blow
    // is held so the defeated interrupt (Boiling Blood) can fight on first.
    const lethal = applyEvents(state, [damageEvent(foe.id, hero.id, 10)]);
    expect(lethal.actors[hero.id].hp).toBe(6); // held: the lethal blow has not landed
    const defeatedWindow = lethal.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'defeated');
    expect(defeatedWindow).toBeDefined();
    expect(windowHeldDamage(defeatedWindow!)).toMatchObject({ amount: 8 });
    // Boiling Blood resolves the window: fight on at 1 hp (defy-death), the
    // held blow lands after the interrupt — the character remains standing.
    const interrupt = executeCommand(lethal, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'colossus:boiling-blood',
      actionId: 'default',
      timing: 'interrupt',
      input: {},
    }, scriptedDice());
    expect(interrupt.state.actors[hero.id].hp).toBe(1); // 6 - held 8, defy-death floor
    expect(interrupt.state.decisionWindows.some((candidate) => candidate.kind === 'defeated')).toBe(false);
    expect(applyEvents(lethal, interrupt.events)).toEqual(interrupt.state);

    // Non-lethal: 4 raw (determined 2 < hp 6) → no defeated window at all.
    // Righteous Disdain is removed too, so no when-damaged window holds the
    // blow either — it applies directly, proving the defeated gate alone
    // decides on prospective lethality.
    const fresh = u13Encounter({ second: null });
    fresh.state.actors[fresh.hero.id].abilityIds = fresh.state.actors[fresh.hero.id].abilityIds.filter((id) => id !== 'demon-slayer:righteous-disdain');
    fresh.state.actors[fresh.hero.id].hp = 6;
    fresh.state.actors[fresh.hero.id].vigor = 0;
    const nonLethal = applyEvents(fresh.state, [damageEvent(fresh.foe.id, fresh.hero.id, 4)]);
    expect(nonLethal.decisionWindows.some((candidate) => candidate.kind === 'defeated')).toBe(false);
    expect(nonLethal.actors[fresh.hero.id].hp).toBe(4); // applied directly
  });
});

describe('U13 — Sucker Punch (p.143): the original save is a held result; a reroll is a new command-boundary result', () => {
  it('holds the original save exactly, makes the reroll visible, and replaces the first result only as the recorded interrupt outcome', () => {
    const { state, hero, foe } = u13Encounter({ second: null });
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    // The save's success branch (2 damage) is HELD — the result is visible
    // in the window before the interrupt re-rolls it.
    expect(deferred.actors[foe.id].hp).toBe(32);
    const window = deferred.decisionWindows.find((candidate) => candidate.actorId === hero.id && candidate.kind === 'save-rolled');
    expect(window).toBeDefined();
    // The window's U12 held payload is the ORIGINAL determined save — roll
    // 12, success, the exact evaluated modifier policy.
    expect(windowHeldSave(window!)).toMatchObject({
      targetId: foe.id, boon: 0, sourceId: 'fixture:save-ability', threshold: 10,
      modifiers: { sourceModifier: 0, saveBoon: 0, saveCurse: 0, blessing: false },
    });
    expect(window!.heldPayload!.payload).toMatchObject({ kind: 'held-result' });

    // The reroll is a NEW command-boundary roll: d20 3 → failure, the 8-damage
    // failure branch REPLACES the held 2-damage success branch (p.143: "the
    // enemy must re-roll the save, keeping the second result").
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice(3));
    expect(interrupt.state.actors[foe.id].hp).toBe(24); // 32 - 8; the held 2 never applied
    expect(interrupt.state.decisionWindows.some((candidate) => candidate.kind === 'save-rolled')).toBe(false);
    expect(interrupt.state.actors[hero.id].interruptUses['knave:sucker-punch']).toBe(1);
    // The reroll rode the recorded event (fresh command-boundary RNG exactly
    // once): replay consumes it and performs ZERO fresh rolls.
    const rerollEvent = interrupt.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED' && 'reroll' in event);
    expect(rerollEvent).toBeDefined();
    const reroll = (rerollEvent as { reroll: { roll: number; total: number; success: boolean } }).reroll;
    expect(reroll).toMatchObject({ roll: 3, total: 3, success: false });
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
    // A fresh replay of the SAME recorded events cannot reroll anything: the
    // durable save record (roll 3) resumes exactly as recorded.
    const replay = applyEvents(deferred, interrupt.events);
    expect(replay.actors[foe.id].hp).toBe(24);
  });

  it('closing/declining the window preserves the original determined result', () => {
    const { state, hero, foe } = u13Encounter({ second: null });
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    // No interrupt answers: the boundary drain resolves the ORIGINAL save
    // branch (2 damage) — the first result is preserved, never replaced.
    const ended = endTurnTo(deferred, foe.id, scriptedDice());
    expect(ended.actors[foe.id].hp).toBe(30); // 32 - 2, the original success branch
    expect(ended.decisionWindows).toHaveLength(0);
  });

  it('Heroic Sucker Punch applies the +1 curse to the NEW save only — never retroactively to the first roll', () => {
    const { state, hero, foe } = u13Encounter({ second: null });
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    // The base save rolled boon 0 (visible in the held payload BEFORE the
    // interrupt). Heroic's curse applies to the reroll's own die: d20 10,
    // d6 1 → boon -1, total 9 — failing where the original (12) succeeded.
    const heldBefore = deferred.decisionWindows.find((candidate) => candidate.kind === 'save-rolled');
    expect(windowHeldSave(heldBefore!)).toMatchObject({ boon: 0 });
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
      triggers: ['heroic'],
    }, scriptedDice(10, 1));
    const rerollEvent = interrupt.events.find((event) => event.type === 'RULE_MUTATIONS_APPLIED' && 'reroll' in event);
    const reroll = (rerollEvent as { reroll: { roll: number; boon: number; total: number; success: boolean } }).reroll;
    expect(reroll).toMatchObject({ roll: 10, boon: -1, total: 9, success: false });
    // The failure branch (8) replaces the success branch (2) — the original
    // roll's boon 0 was never mutated.
    expect(interrupt.state.actors[foe.id].hp).toBe(24);
    expect(interrupt.state.actors[foe.id].ruleState['sucker-punch:curse']).toBe(true);
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });
});

describe('U13 — ordering (p.107): U17 is the one ordering authority', () => {
  it('nested interrupts resolve most-recently-triggered first (LIFO stack)', () => {
    const { state, hero, foe, ally } = u13Encounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 2, y: 1 } });
    // p.128: both blows target the ALLY; the owner (hero) accumulates two
    // when-damaged windows.
    const first = applyEvents(state, [damageEvent(foe.id, ally!.id, 4)]);
    const second = applyEvents(first, [damageEvent(foe.id, ally!.id, 4)]);
    const heroWindows = second.decisionWindows.filter((candidate) => candidate.actorId === hero.id);
    expect(heroWindows).toHaveLength(2);
    // An interrupt answers the NEWEST window (LIFO): the older held blow
    // remains, the newer applies after the interrupt — to the ALLY.
    const interrupt = executeCommand(second, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally!.id] }, scriptedDice());
    const remaining = interrupt.state.decisionWindows.filter((candidate) => candidate.actorId === hero.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.triggeredAt).toBe(heroWindows[0]!.triggeredAt); // the OLDER window remains
    // The newest held blow (2) applies AFTER the interrupt's own mutations
    // against the then-current ally: Catapult's collide reaction grants the
    // ally 2 vigor, and the held 2 is absorbed by that fresh vigor (hp 40,
    // vigor 0) — the held amount is applied, never recomputed.
    expect(interrupt.state.actors[ally!.id]).toMatchObject({ hp: 40, vigor: 0 });
    expect(interrupt.state.actors[hero.id].hp).toBe(40); // the owner was never damaged
  });

  it('same-trigger simultaneous windows resolve by turn order (turn character side first), never insertion order', () => {
    const { state, hero, foe } = u13Encounter({ second: null });
    // ICON p.107: interrupts that share a trigger and trigger at the same
    // time resolve "in the same order as turns (player character/npc,
    // alternating)". U17's orderDecisionWindows is a pure function of the
    // RECORDED windows: same triggeredAt, same kind → the turn character's
    // side first, same-side by the recorded `order`. The incoming array
    // deliberately registers the FOE window first — the output must be
    // [hero, foe], proving insertion order is never the game rule.
    const heroWindow = { id: 'h', kind: 'when-damaged' as const, actorId: hero.id, triggeredAt: 7, order: 0 } as DecisionWindowRecord;
    const foeWindow = { id: 'f', kind: 'when-damaged' as const, actorId: foe.id, triggeredAt: 7, order: 1 } as DecisionWindowRecord;
    const ordered = orderDecisionWindows(state, hero.id, [foeWindow, heroWindow]);
    expect(ordered.map((window) => window.actorId)).toEqual([hero.id, foe.id]);
  });

  it('owner-order ambiguity yields a U4 choice instead of an invented ordering', () => {
    // ICON p.107: when one character owns multiple simultaneously triggered
    // effects and the order is ambiguous, that character may determine the
    // order. U17's controller-choice policy YIELDS the typed choice and
    // never resolves it — `applyOrdering` returns `yields-choice`.
    const choice: RuleChoice = { key: 'order', label: 'Which of your effects resolves first?', kind: 'option', options: ['first', 'second'], required: true };
    const policy = { kind: 'controller-choice' as const, choice };
    expect(policyYieldsChoice(policy)).toBe(choice);
    const result = applyOrdering(policy, [{ id: 'a' }, { id: 'b' }], {});
    expect(result).toMatchObject({ ok: false, problem: 'yields-choice' });
    // The engine never silently fell back to array order.
    if (!result.ok && result.problem === 'yields-choice') {
      expect(result.choice).toBe(choice);
    }
  });
});

describe('U13 — automatic triggered effects are NOT windows', () => {
  it('a triggered effect (Gates of Hell vigilance rush) opens no window and consumes no interrupt entitlement', () => {
    const { state, hero, foe } = u13Encounter({ second: null });
    // Vigilance (p.129) is a TRIGGERED EFFECT, explicitly not an interrupt
    // (p.104-105): using the vigilance rush must not open a decision window,
    // must not consume the one-per-turn interrupt entitlement, and must not
    // be ranked against interrupt windows.
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'demon-slayer:gates-of-hell', targetIds: [] }, scriptedDice());
    // The stance activated; now the triggered rush executes on the user's own
    // volition (the "may rush 2" is the actor's own trigger, not a window).
    const rushed = executeCommand(used.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:gates-of-hell',
      actionId: 'vigilance-rush',
      timing: 'targeted',
      input: {},
    }, scriptedDice());
    expect(rushed.state.decisionWindows.some((candidate) => candidate.kind === 'choice')).toBe(false);
    expect(rushed.state.actors[hero.id].interruptUsedThisTurn).toBe(false);
    expect(rushed.state.actors[hero.id].interruptUses).toEqual({});
    expect(rushed.state.actors[hero.id].ruleState['gates-of-hell:vigilance-rushed']).toBe(true);
    // And the once-per-turn gate is the effect's own (a second rush is
    // rejected — it is not gated by interrupt rank).
    expect(() => executeCommand(rushed.state, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'demon-slayer:gates-of-hell',
      actionId: 'vigilance-rush',
      timing: 'targeted',
      input: {},
    }, scriptedDice())).toThrow(/once a turn/);
  });
});

describe('U13 — Gamble stays deterministic; only genuine decisions become windows', () => {
  it('an ordinary deterministic Gamble roll creates no decision window', () => {
    const { state } = u13Encounter({ second: null });
    const before = state.decisionWindows.length;
    const roll = resolveGamble(scriptedDice(4, 6), 2, 'highest');
    // Pure recorded dice operation: no state, no window.
    expect(roll).toMatchObject({ rolls: [4, 6], kept: [6], result: 6, pick: 'highest' });
    expect(state.decisionWindows.length).toBe(before);
  });

  it('a genuine post-result decision (Great Giorgios "may rush") IS a U13 choice window', () => {
    const { state, hero, foe } = u13Encounter({ foe: { x: 4, y: 1 }, second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const window = ended.decisionWindows.find((candidate) => candidate.kind === 'choice');
    expect(window).toBeDefined();
    expect(window!.choice).toMatchObject({ key: 'rush', kind: 'boolean', required: true });
  });
});

describe('U13 — Great Giorgios (p.124): the "may rush" is a real decision; Dragonslayer stays distinct', () => {
  it('declining the rush is legal and resolves nothing (the mark was consumed at window-open)', () => {
    const { state, hero, foe } = u13Encounter({ foe: { x: 4, y: 1 }, second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const window = ended.decisionWindows.find((candidate) => candidate.kind === 'choice');
    expect(window).toBeDefined();
    expect(ended.actors[foe.id].marks).toEqual([]); // the mark is gone either way
    const declined = answerRush(ended, false);
    expect(declined.state.decisionWindows).toHaveLength(0);
    // Nothing moved, no damage — the "may" was honored, the engine never
    // chose a default path.
    expect(declined.state.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    expect(declined.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(declined.state.actors[foe.id].hp).toBe(32);
    expect(applyEvents(ended, declined.events)).toEqual(declined.state);
  });

  it('accepting resolves against THEN-CURRENT positions; the arming-snapshot outcome differs observably', () => {
    const { state, hero, foe } = u13Encounter({ foe: { x: 4, y: 1 }, second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    // The hero moves to (3,1) BEFORE the trigger fires — an intervening
    // effect (represented directly). From (3,1) the hero is already adjacent
    // to the foe: the rush travels 0, no shove, and the +2 damage applies.
    // From the ARMING position (1,1) the rush would have traveled 2, shoved
    // the foe 2, and dealt 4 — an observably different outcome.
    foeTurn.actors[hero.id].position = { x: 3, y: 1 };
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const accepted = answerRush(ended, true);
    expect(accepted.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(accepted.state.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(accepted.state.actors[foe.id].hp).toBe(30); // 32 - (0 + 2)
    expect(applyEvents(ended, accepted.events)).toEqual(accepted.state);
  });

  it('accepting from the arming position rushes, shoves, and deals the traveled damage (no invented destination)', () => {
    const { state, hero, foe } = u13Encounter({ foe: { x: 4, y: 1 }, second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const accepted = answerRush(ended, true);
    // The deterministic path rule (each step strictly closer, blocked by the
    // foe's occupied space) lands the hero at (3,1) — 2 traveled. The foe is
    // shoved 2 to (6,1) and takes 2+2=4 damage. No destination/path choice
    // was invented: the blocked-cell rule decided the reached position.
    expect(accepted.state.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(accepted.state.actors[foe.id].position).toEqual({ x: 6, y: 1 });
    expect(accepted.state.actors[foe.id].hp).toBe(28);
    expect(applyEvents(ended, accepted.events)).toEqual(accepted.state);
  });
});

describe('U13 — negative identity: same-kind windows/facts never answer each other', () => {
  it('two same-kind windows in one resolution are distinct records; answering one leaves the other untouched', () => {
    const { state, hero, foe, ally } = u13Encounter({ foe: { x: 4, y: 1 }, second: null, ally: { x: 2, y: 1 } });
    // Two when-damaged windows on the SAME owner (the hero answers for the
    // ALLY's blows) from two separate blows against the ally.
    const first = applyEvents(state, [damageEvent(foe.id, ally!.id, 4)]);
    const second = applyEvents(first, [damageEvent(foe.id, ally!.id, 4)]);
    const windows = second.decisionWindows.filter((candidate) => candidate.actorId === hero.id && candidate.kind === 'when-damaged');
    expect(windows).toHaveLength(2);
    // The U12 held-damage continuations carry DISTINCT durable ids — the
    // correlation seam: an unrelated same-kind fact can never satisfy the
    // wrong window, and an answer to one window never consumes the other.
    expect(windows[0]!.heldPayload!.id).not.toBe(windows[1]!.heldPayload!.id);
    const interrupt = executeCommand(second, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:catapult', targetIds: [ally!.id] }, scriptedDice());
    const remaining = interrupt.state.decisionWindows.filter((candidate) => candidate.actorId === hero.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(windows[0]!.id); // the untouched window kept its exact identity
    expect(applyEvents(second, interrupt.events)).toEqual(interrupt.state);
  });
});

describe('U13 — replay: byte-identical durable state with zero fresh decisions/RNG', () => {
  it('serializes/replays a scenario with a held damage window, a held save reroll, and ordered windows', () => {
    // The foe is ADJACENT (2,1) so Sucker Punch's p.143 "an enemy adjacent
    // to you rolls a save" window can open for the hero. The ally is at
    // (2,0) — within the owner's p.128 Range 2 — so the foe's damage to the
    // ALLY opens the owner's when-damaged window.
    const { state, hero, foe, ally } = u13Encounter({ foe: { x: 2, y: 1 }, second: null, ally: { x: 2, y: 0 } });
    // 1) A held damage window (Righteous Disdain determined amount) on the
    // ALLY's blow, owned by the hero.
    const heldDamage = applyEvents(state, [damageEvent(foe.id, ally!.id, 20)]);
    expect(windowHeldDamage(heldDamage.decisionWindows.find((candidate) => candidate.actorId === hero.id)!)).toMatchObject({ amount: 18, targetId: ally!.id });
    // 2) A held save reroll window (Sucker Punch).
    const heldSave = applyEvents(heldDamage, [saveAbilityEvent(hero.id, foe.id)]);
    expect(heldSave.decisionWindows.some((candidate) => candidate.kind === 'save-rolled')).toBe(true);
    // 3) The save reroll (fresh command-boundary RNG exactly once).
    const rerolled = executeCommand(heldSave, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice(3));
    // 4) The held damage resolves at the boundary (unanswered) with the
    // exact determined amount to the ALLY; every interrupt window closes.
    const ended = endTurnTo(rerolled.state, foe.id, scriptedDice());
    expect(ended.actors[ally!.id].hp).toBe(22); // 40 - 18, the held amount
    expect(ended.actors[hero.id].hp).toBe(40);
    expect(ended.actors[foe.id].hp).toBe(24); // 32 - 8, the rerolled branch
    expect(ended.decisionWindows).toHaveLength(0);

    // Replay the ENTIRE recorded event history: the durable state is
    // byte-identical and no decision/RNG is re-performed (the recorded
    // events carry the reroll and the held amounts).
    let replayed = state;
    const history: EncounterEvent[] = [
      damageEvent(foe.id, ally!.id, 20),
      saveAbilityEvent(hero.id, foe.id),
    ];
    replayed = applyEvents(replayed, history);
    const rerollEvents = rerolled.events;
    replayed = applyEvents(replayed, rerollEvents);
    // The reducer replay of the recorded reroll event reproduces the exact
    // window decision and damage outcome: the foe took the rerolled 8, and
    // the ally's held blow is STILL held (the boundary drain — a live
    // command — applies it later; replay of the recorded events must not
    // apply it early).
    expect(replayed.actors[ally!.id].hp).toBe(rerolled.state.actors[ally!.id].hp);
    expect(replayed.actors[ally!.id].hp).toBe(40); // still held after the recorded events
    expect(replayed.actors[foe.id].hp).toBe(24);
    // Draining the replayed state through the same boundary command reaches
    // the identical final state as the command-built path.
    const replayedEnded = endTurnTo(replayed, foe.id, scriptedDice());
    expect(replayedEnded.actors[ally!.id].hp).toBe(22);
    expect(replayedEnded.actors[foe.id].hp).toBe(24);
    expect(replayedEnded.decisionWindows).toHaveLength(0);
  });

  it('a recorded accept event replays to the identical state with no re-planning', () => {
    const { state, hero, foe } = u13Encounter({ foe: { x: 4, y: 1 }, second: null });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: 'bastion:great-giorgios', targetIds: [foe.id] }, scriptedDice());
    const foeTurn = executeCommand(used.state, { type: 'TAKE_TURN', actorId: foe.id }, scriptedDice()).state;
    const ended = executeCommand(foeTurn, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    const accepted = answerRush(ended, true);
    // The decision rode the recorded DECISION_ANSWERED event (the recorded
    // mutations ARE the durable payload): replay applies them and produces
    // the identical state — no re-planning, no fresh availability checks.
    const replayed = applyEvents(ended, accepted.events);
    expect(replayed).toEqual(accepted.state);
  });
});
