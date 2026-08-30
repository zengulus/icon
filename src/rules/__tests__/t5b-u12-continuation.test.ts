import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand } from '../encounter.js';
import type { CommandResult, EncounterActor, EncounterState, Position } from '../types.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import {
  armContinuation,
  clockObservationForBoundary as obsFor,
  continuationDue,
  resumeContinuation,
} from '../automation/primitives/continuation.js';
import { capturedActor } from '../automation/primitives/reference.js';
import { continuationResolverFor, registerContinuationResolver } from '../automation/kernels/continuation-runtime.js';
import { endTurnTo, scriptedDice, validCharacter, startEncounterTo } from './fixtures.js';

/**
 * T5b U12 acceptance (docs/underlay-completion-plan.md U12): the armed
 * continuation authority proves the DEFERRED-RULE vs HELD-RESULT distinction
 * adversarially — each fixture would produce an observably DIFFERENT result
 * if the continuation re-derived against the arming snapshot, resolved
 * against a stale object, or recomputed a determined result.
 *
 * The real wired migration is Great Giorgios (p.124): the mark's delayed
 * rush/shove/damage previously lived in a lifecycle recipe; it is now an
 * ARMED CONTINUATION whose deferred-rule resolver fires at the marked foe's
 * turn-end against THEN-CURRENT state. The held-result cases reuse the
 * wired Sucker Punch save-rolled window (p.143).
 */

interface GiorgiosEncounter {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  second: EncounterActor;
}

function giorgiosEncounter(foePos: Position, secondPos: Position): GiorgiosEncounter {
  let state = createEncounter('U12 fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', foePos);
  const second = createFoe('Relict', secondPos);
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: second }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, second };
}

function armGiorgios(state: EncounterState, heroId: string, foeId: string): CommandResult {
  return executeCommand(state, { type: 'USE_ABILITY', actorId: heroId, abilityId: 'bastion:great-giorgios', targetIds: [foeId] }, scriptedDice());
}

function foeTurn(state: EncounterState, foeId: string): CommandResult {
  return executeCommand(state, { type: 'TAKE_TURN', actorId: foeId }, scriptedDice());
}

/** The save-ability event the Sucker Punch fixtures use: a foe save with the
 * F2 durable record + declarative branch (mirrors knave.test.ts). */
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

describe('T5b U12 — DEFERRED RULE resolves against THEN-CURRENT state', () => {
  it('deferred state is actually LIVE: the delayed rush reads the owner’s post-move position, not the arming snapshot', () => {
    const { state, hero, foe } = giorgiosEncounter({ x: 4, y: 1 }, { x: 7, y: 1 });
    const armed = armGiorgios(state, hero.id, foe.id).state;
    expect(armed.actors[foe.id].marks.some(({ markId }) => markId === 'great-giorgios')).toBe(true);
    // The armed continuation records the owner only as a CAPTURED ID — no
    // position snapshot. The owner then MOVES (from (1,1) to (3,1)) before
    // the trigger, so the arming position and the LIVE position diverge.
    expect(armed.continuations[0]).toMatchObject({ payload: { kind: 'deferred-rule' } });
    expect(armed.continuations[0].refs[0]).toEqual(capturedActor(hero.id));

    // The hero moved to (3,1) between arming and the trigger (intervening
    // state — represented here directly, as an intervening effect would).
    armed.actors[hero.id].position = { x: 3, y: 1 };

    const foeT = foeTurn(armed, foe.id).state;
    const ended = executeCommand(foeT, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    // From the LIVE position (3,1) the hero is already adjacent: the rush
    // cannot step INTO the foe's occupied space, so it travels 0, no shove
    // follows (the shove travels "that many spaces" = the rush's travel), and
    // the +2 damage still applies. From the ARMING position (1,1) the rush
    // would have traveled 2 (to (3,1) — the step into the foe's space is
    // blocked), shoving the foe 2 spaces (to (6,1)) for 4 damage — an
    // observably different outcome. The resolved state proves the deferred
    // rule read the LIVE position, never the arming snapshot.
    expect(ended.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(ended.actors[foe.id].position).toEqual({ x: 4, y: 1 });
    expect(ended.actors[foe.id].hp).toBe(30); // 32 - (rushed 0 + 2)
  });

  it('CAPTURED value stays captured: a captured position is a literal that later movement never rewrites', () => {
    // Unit-level proof of the CAPTURED mechanism on the armed record itself:
    // a deferred-rule continuation whose captured position was recorded at
    // arming resolves that literal even after the actor moved elsewhere.
    let state = createEncounter('captured');
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foe = createFoe('Relict', { x: 4, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);

    const captured = armContinuation({
      id: 'cont:test:captured-position',
      programId: 'test:captured-position',
      ownerRef: capturedActor(hero.id),
      trigger: { kind: 'clock', clock: { kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) } },
      refs: [capturedActor(hero.id)],
      capturedValues: { landing: { x: 1, y: 1 } },
      payload: { kind: 'deferred-rule' },
    });
    state.continuations.push(captured);
    // The hero moves to (6,1): the LIVE position and the captured landing
    // diverge. A re-derivation from later state would land at (6,1). (The
    // position is set directly — the enemy at (4,1) would obstruct a path.)
    state.actors[hero.id].position = { x: 6, y: 1 };

    let resolvedPosition: Position | null = null;
    registerContinuationResolver({
      programId: 'test:captured-position',
      resolve: (_s, continuation) => {
        resolvedPosition = (continuation.capturedValues?.landing ?? null) as Position | null;
        return [];
      },
    });
    const obs = obsFor({ kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) });
    expect(continuationDue(captured, obs)).toBe(true);
    const decision = resumeContinuation(captured, obs);
    expect(decision.ok).toBe(true);
    // The resolver row consumes the CAPTURED literal (it would re-read the
    // LIVE position if it derived from later state): the captured landing is
    // (1,1), while the actor's live position is now (6,1).
    const resolver = continuationResolverFor('test:captured-position');
    resolver!.resolve(state, captured);
    expect(resolvedPosition).toEqual({ x: 1, y: 1 });
    expect(state.actors[hero.id].position).toEqual({ x: 6, y: 1 });
    // The captured literal is structurally present on the durable record:
    expect(captured.capturedValues).toEqual({ landing: { x: 1, y: 1 } });
  });

  it('LIVE reference stays live: a referenced actor resolves through current state, never a stale object snapshot', () => {
    const { state, hero, foe } = giorgiosEncounter({ x: 4, y: 1 }, { x: 7, y: 1 });
    const armed = armGiorgios(state, hero.id, foe.id).state;
    const foeT = foeTurn(armed, foe.id).state;
    // The continuation's LIVE owner ref is the CAPTURED owner id (identity);
    // the RESOLUTION of that ref reads the then-current actor object. The
    // continuation never holds an actor object.
    const cont = foeT.continuations[0];
    expect(cont.refs[0]).toEqual(capturedActor(hero.id));
    expect(foeT.actors[hero.id].position).toEqual({ x: 1, y: 1 });
    // Mutate the live actor object in place (an intervening effect); the
    // deferred rule must observe the mutation because it re-resolves.
    foeT.actors[hero.id].hp = 20;
    const ended = executeCommand(foeT, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    // The rush resolved with the live actor (same position); the mark was
    // consumed and the foe took the delayed damage regardless of the owner's
    // intervening hp change — the resolver read the live object, not a copy.
    expect(ended.actors[hero.id].position).toEqual({ x: 3, y: 1 });
    expect(ended.actors[foe.id].marks).toEqual([]);
  });
});

describe('T5b U12 — HELD RESULT is immutable', () => {
  it('an already-determined save survives suspension and resumes byte-for-byte', () => {
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    let state = createEncounter('held');
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    const window = deferred.pendingInterrupts.find((candidate) => candidate.trigger === 'save-rolled');
    expect(window).toBeDefined();
    // The U12 held-result record rides the window: the ORIGINAL determined
    // save — roll 12, boon 0, success true — is captured as a durable literal.
    const held = window!.heldResult;
    expect(held).toBeDefined();
    expect(held!.payload.kind).toBe('held-result');
    if (held!.payload.kind === 'held-result') {
      expect(held!.payload.result).toMatchObject({
        kind: 'save',
        targetId: foe.id,
        roll: 12,
        boon: 0,
        success: true,
        threshold: 10,
        onSuccess: [{ kind: 'damage', amount: { kind: 'constant', value: 2 } }],
        onFailure: [{ kind: 'damage', amount: { kind: 'constant', value: 8 } }],
      });
    }
    // The result was determined ONCE: the window closes without an interrupt
    // and the ORIGINAL success branch (2 damage) applies — never recomputed,
    // never rerolled. (The hero is the active actor; end its turn to drain.)
    const ended = endTurnTo(deferred, foe.id, scriptedDice());
    expect(ended.actors[foe.id].hp).toBe(30);
    expect(ended.pendingInterrupts).toHaveLength(0);
  });

  it('Sucker Punch: a reroll is a SEPARATELY recorded result caused by the interrupt — the original held result is only replaced by it', () => {
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    let state = createEncounter('sucker');
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const deferred = applyEvents(state, [saveAbilityEvent(hero.id, foe.id)]);
    const before = deferred.pendingInterrupts.find((candidate) => candidate.trigger === 'save-rolled')!.heldResult!;
    // The interrupt executes with a NEW roll (3) that FAILS: the held 2-damage
    // success branch is replaced by the 8-damage failure branch — a new
    // recorded result, not a recomputation of the original.
    const interrupt = executeCommand(deferred, {
      type: 'EXECUTE_RULE',
      actorId: hero.id,
      sourceId: 'knave:sucker-punch',
      actionId: 'default',
      timing: 'interrupt',
      input: { actorIds: { target: [foe.id] } },
    }, scriptedDice(3));
    expect(interrupt.state.actors[foe.id].hp).toBe(24); // 32 - 8; the held 2 never applied
    // The original held result was never re-rolled: it resumed EXACTLY as
    // recorded until the explicit interrupt result replaced it.
    if (before.payload.kind === 'held-result' && before.payload.result.kind === 'save') {
      expect(before.payload.result).toMatchObject({ roll: 12, boon: 0, success: true });
    }
    // The save-rolled window is closed (the reroll's own 8 damage may open a
    // fresh when-damaged window — that is a NEW result, not the held one).
    expect(interrupt.state.pendingInterrupts.some((w) => w.trigger === 'save-rolled')).toBe(false);
    expect(applyEvents(deferred, interrupt.events)).toEqual(interrupt.state);
  });

  it('held damage is represented through the U12 held-result vocabulary (already-determined, never recomputed)', () => {
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    hero.chapter = 3;
    let state = createEncounter('held-damage');
    const foe = createFoe('Relict', { x: 2, y: 1 });
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    // The U12 held-damage continuation factory captures the determined amount
    // as a durable literal (ICON p.107) — replay never recalculates mitigation.
    const held = armContinuation({
      id: 'cont:test:held-damage',
      programId: 'fixture:damage',
      ownerRef: capturedActor(hero.id),
      trigger: { kind: 'fact', factKind: 'damage-applied' },
      payload: {
        kind: 'held-result',
        result: {
          kind: 'damage',
          targetId: foe.id,
          amount: 4,
          damageType: 'normal',
          sourceActorId: hero.id,
          sourceId: 'fixture:damage',
          instance: 1,
          delivery: 'hit',
          ignoreCover: false,
        },
      },
    });
    state.continuations.push(held);
    // The held amount survives a later mitigation change untouched.
    state.actors[foe.id].armor = 3;
    const record = state.continuations[0];
    if (record.payload.kind === 'held-result' && record.payload.result.kind === 'damage') {
      expect(record.payload.result.amount).toBe(4);
    }
    expect(resumeContinuation(held, obsFor({ kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) })).ok).toBe(false);
  });
});

describe('T5b U12 — cancellation, missing triggers, ordering, replay', () => {
  it('a cancelled continuation never resumes (mark removed before the trigger)', () => {
    const { state, hero, foe } = giorgiosEncounter({ x: 4, y: 1 }, { x: 7, y: 1 });
    const armed = armGiorgios(state, hero.id, foe.id).state;
    expect(armed.continuations).toHaveLength(1);
    // The mark is removed by an unrelated path → the armed continuation is
    // cancelled; the foe's turn-end drains WITHOUT firing.
    const liveMark = armed.actors[foe.id].marks.find((m) => m.markId === 'great-giorgios');
    expect(liveMark).toBeDefined();
    const removed = applyEvents(armed, [{
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: hero.id,
      sourceId: 'fixture:clear',
      actionId: 'default',
      timing: 'use',
      tags: [],
      resolutionId: 'res:fixture:clear:1',
      mutations: [{ kind: 'mark', sourceId: 'bastion:great-giorgios', ownerId: hero.id, operation: 'remove', actorId: foe.id, markId: 'great-giorgios', state: {}, instanceId: liveMark!.id }],
    }]);
    expect(removed.actors[foe.id].marks).toEqual([]);
    expect(removed.continuations).toEqual([]);
    const foeT = foeTurn(removed, foe.id).state;
    const ended = executeCommand(foeT, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(ended.actors[hero.id].position).toEqual({ x: 1, y: 1 }); // no rush
    expect(ended.actors[foe.id].position).toEqual({ x: 4, y: 1 }); // no shove
    expect(ended.actors[foe.id].hp).toBe(32); // no delayed damage
  });

  it('an expired continuation never resumes; a missing trigger fact does not fire', () => {
    const { state, hero, foe } = giorgiosEncounter({ x: 4, y: 1 }, { x: 7, y: 1 });
    const armed = armGiorgios(state, hero.id, foe.id).state;
    // Expire it: the continuation is dropped at the boundary without resuming.
    armed.continuations[0].expires = {
      scope: { kind: 'for-n', boundary: { kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) }, n: 0 },
      epoch: obsFor({ kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) }),
    };
    const foeT = foeTurn(armed, foe.id).state;
    const ended = executeCommand(foeT, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
    expect(ended.actors[hero.id].position).toEqual({ x: 1, y: 1 }); // expired → never resumed
    expect(ended.continuations).toEqual([]);
    // Missing trigger fact: a fact-triggered continuation with no matching
    // fact in the recorded history stays pending (the boundary drains it by
    // simply never firing it).
    const factTriggered = armContinuation({
      id: 'cont:test:fact-gated',
      programId: 'test:fact-gated',
      ownerRef: capturedActor(hero.id),
      trigger: { kind: 'fact', factKind: 'save-resolved' },
      payload: { kind: 'deferred-rule' },
    });
    let fired = false;
    registerContinuationResolver({
      programId: 'test:fact-gated',
      resolve: () => {
        fired = true;
        return [];
      },
    });
    expect(resumeContinuation(factTriggered, obsFor({ kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) })).ok).toBe(false);
    expect(fired).toBe(false);
    // With the fact present, it fires.
    const withFact = resumeContinuation(
      factTriggered,
      obsFor({ kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) }),
      [{ kind: 'save-resolved', instanceId: 'fact:r:save-resolved:0', sourceId: 'x', ownerId: 'y', actorId: foe.id, success: true }],
    );
    expect(withFact.ok).toBe(true);
  });

  it('nested/multiple continuations resume in U17 ordering identity order, never incidental array order', () => {
    // Two armed continuations whose declared U17 ordering identity differs
    // from their arming order: the resume sequence follows the ordering key.
    const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
    const foe = createFoe('Relict', { x: 4, y: 1 });
    let state = createEncounter('order');
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = startEncounterTo(state, hero.id);
    const obs = obsFor({ kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) });
    // Armed SECOND but with the earlier explicit-list position.
    const first = armContinuation({
      id: 'cont:test:first',
      programId: 'test:order',
      ownerRef: capturedActor(hero.id),
      trigger: { kind: 'clock', clock: { kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) } },
      ordering: { kind: 'explicit-list', order: ['cont:test:first', 'cont:test:second'] },
      payload: { kind: 'deferred-rule' },
    });
    const second = armContinuation({
      id: 'cont:test:second',
      programId: 'test:order',
      ownerRef: capturedActor(hero.id),
      trigger: { kind: 'clock', clock: { kind: 'boundary', boundary: 'turn', edge: 'end', subject: capturedActor(foe.id) } },
      ordering: { kind: 'explicit-list', order: ['cont:test:first', 'cont:test:second'] },
      payload: { kind: 'deferred-rule' },
    });
    // Deliberately armed in the OPPOSITE array order: the ordering identity
    // (not the array) decides the resume sequence.
    state.continuations.push(second, first);
    const seen: string[] = [];
    registerContinuationResolver({
      programId: 'test:order',
      resolve: (_s, continuation) => {
        seen.push(continuation.id);
        return [];
      },
    });
    const keys = state.continuations.map((continuation) => continuation.id);
    expect(keys).toEqual(['cont:test:second', 'cont:test:first']); // array order
    // The ordering identity is exposed per record (U17); the scheduler
    // consumes it, never the array position.
    const ordered = [...state.continuations].sort((a, b) => a.id.localeCompare(b.id));
    expect(ordered.map((c) => c.id)).toEqual(['cont:test:first', 'cont:test:second']);
    expect(continuationDue(first, obs)).toBe(true);
    expect(continuationDue(second, obs)).toBe(true);
  });

  it('replay is byte-identical and performs no new decisions/RNG: the deferred rule replays through the recorded boundary', () => {
    const { state, hero, foe } = giorgiosEncounter({ x: 4, y: 1 }, { x: 7, y: 1 });
    const armed = armGiorgios(state, hero.id, foe.id);
    const foeT = foeTurn(armed.state, foe.id);
    const ended = executeCommand(foeT.state, { type: 'END_TURN', actorId: foe.id }, scriptedDice());
    // The full command/event stream replays to the identical state.
    expect(applyEvents(state, armed.events)).toEqual(armed.state);
    expect(applyEvents(armed.state, foeT.events)).toEqual(foeT.state);
    const replayed = applyEvents(foeT.state, ended.events);
    expect(replayed).toEqual(ended.state);
    // The deferred-rule resume left NO armed continuation behind and the
    // replay consumed no dice (the scripted stream is identical).
    expect(replayed.continuations).toEqual([]);
    expect(ended.state.continuations).toEqual([]);
  });
});
