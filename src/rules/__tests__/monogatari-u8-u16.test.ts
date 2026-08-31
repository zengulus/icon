import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import {
  actorFromCharacter, applyEvents, createEncounter, createFoe, executeCommand,
} from '../encounter.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { capturedActor } from '../automation/primitives/reference.js';
import { lifecycleGroupKey, lifecycleIdentityKey } from '../automation/primitives/scope.js';
import { lifecycleScopedUsageKey, usageCount } from '../automation/primitives/usage.js';
import {
  applyLifecycleScopedUsage, currentLifecycleInstanceFor, lifecycleObservationForGroup,
} from '../automation/kernels/use-ledger.js';
import type { LifecycleIdentity } from '../automation/primitives/scope.js';
import type { EncounterActor, EncounterState } from '../types.js';
import { endTurnTo, scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

/**
 * Stage B proof: Monogatari is the FIRST real U8 source-defined-lifecycle
 * consumer, integrated with the U16 ledger. A song is a U8 lifecycle INSTANCE
 * (owner = the Chanter, source = chanter:monogatari, advanced every time
 * Monogatari is used again); the once-per-song blessing is a U16 entitlement
 * keyed by that lifecycle identity so it reopens only when a NEW song is sung.
 *
 * Authority split exercised here:
 *   U8  — which lifecycle instance is current / when it was replaced;
 *   U16 — has THIS recipient already fulfilled within THAT instance;
 *   content — the trigger/effect and that its scope is the current song.
 *
 * No 'song' usage period is invented; no source-id branching lives in generic
 * primitives/kernels; no owner/source identity is hidden in a magic string.
 *
 * Placement note: heroes carry `bastion:trait:shieldmaster` (aura radius 1).
 * Two heroes placed within range 1 open a legitimate same-owner U13 ordering
 * window that defers a turn-end recipe — correct engine behavior, but it would
 * obscure the Monogatari lifecycle assertions. Second heroes/allies are placed
 * at Chebyshev distance >= 2 so the aura covers no ally and the Monogatari
 * turn-end resolves immediately.
 */

const MONOGATARI = 'chanter:monogatari';

function songSourceRef() {
  return { kind: 'live' as const, domain: 'rule-source' as const, name: { kind: 'id' as const, id: MONOGATARI } };
}

/** The group key whose durable value IS the Chanter's current song instance. */
function songGroup(chanterId: string): string {
  return lifecycleGroupKey(capturedActor(chanterId), songSourceRef());
}

/** The current song instance of `chanter` (U8 durable read), or undefined. */
function currentSong(chanter: EncounterActor): string | undefined {
  return currentLifecycleInstanceFor(chanter, capturedActor(chanter.id), songSourceRef());
}

/** The U16 once-per-song ledger key for `recipient` under a song owned by
 * `chanterOwner`. The lifecycle identity OWNER is the Chanter who holds the
 * song (not the recipient); the durable key is stored on the RECIPIENT's
 * ruleState. */
function songLedgerKey(chanterOwner: string, recipientId: string, instance: string): string {
  return lifecycleScopedUsageKey(MONOGATARI, lifecycleIdentityKey({
    owner: capturedActor(chanterOwner), source: songSourceRef(), instance,
  }));
}

interface Fixture {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally: EncounterActor | null;
  chanterB: EncounterActor | null;
}

function mmFixture(options: { ally?: boolean; chanterB?: boolean } = {}): Fixture {
  let state = createEncounter('Monogatari fixture');
  const hero = actorFromCharacter(validCharacter('Flying Skald'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', { x: 9, y: 9 });
  const ally = options.ally ? (() => {
    const a = actorFromCharacter(validCharacter('Mira'), { x: 1, y: 3 });
    a.chapter = 3;
    return a;
  })() : null;
  const chanterB = options.chanterB ? (() => {
    const b = actorFromCharacter(validCharacter('Olin'), { x: 3, y: 3 });
    b.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
    b.chapter = 3;
    return b;
  })() : null;
  for (const actor of [hero, foe, ally, chanterB]) {
    if (!actor) continue;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor }).state;
  }
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, ally, chanterB };
}

function blessingOf(state: EncounterState, actorId: string): number {
  return state.actors[actorId].resources.blessing ?? 0;
}

describe('Monogatari as U8 source-defined-lifecycle × U16 entitlement (p.179)', () => {
  it('a recipient that fulfills the one song once is blessed exactly once (same-song repeat blocked)', () => {
    const { state, hero, foe } = mmFixture();
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    // End the Chanter's turn -> gamble Tale 3 (Green: do not attack), song minted.
    const established = endTurnTo(used, foe.id, scriptedDice(3));

    // The song instance exists durably on the Chanter (U8).
    const first = currentSong(established.actors[hero.id]);
    expect(typeof first).toBe('string');

    // Foe takes a turn, then the hero ends WITHOUT attacking -> fulfills Tale 3.
    const foeTurn = endTurnTo(established, hero.id, scriptedDice());
    const blessed = endTurnTo(foeTurn, foe.id, scriptedDice());
    expect(blessingOf(blessed, hero.id)).toBe(1);
    expect(usageCount(blessed.actors[hero.id], songLedgerKey(hero.id, hero.id, first!))).toBe(1);

    // Same song, the hero ends WITHOUT attacking again -> NO second grant.
    const foeAgain = endTurnTo(blessed, hero.id, scriptedDice());
    const again = endTurnTo(foeAgain, foe.id, scriptedDice());
    expect(blessingOf(again, hero.id)).toBe(1);
    expect(usageCount(again.actors[hero.id], songLedgerKey(hero.id, hero.id, first!))).toBe(1);
    expect(currentSong(again.actors[hero.id])).toBe(first); // instance unchanged
  });

  it('a second recipient may fulfill the same song independently', () => {
    const { state, hero, foe, ally } = mmFixture({ ally: true });
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    const established = endTurnTo(used, foe.id, scriptedDice(3));
    const instance = currentSong(established.actors[hero.id])!;

    // The hero already took round 1's opening slot; after the foe ends, the
    // heroes-side controller selects the ALLY (the hero's round-1 turn is done).
    const allyTurn = endTurnTo(established, ally!.id, scriptedDice());
    const blessedAlly = endTurnTo(allyTurn, foe.id, scriptedDice()); // ally ends WITHOUT attacking
    expect(blessingOf(blessedAlly, ally!.id)).toBe(1);
    // Independent: the ally consumed its OWN ledger under the SAME instance.
    expect(usageCount(blessedAlly.actors[ally!.id], songLedgerKey(hero.id, ally!.id, instance))).toBe(1);
  });

  it('using Monogatari again creates a NEW lifecycle instance and reopens the once-per-song', () => {
    const { state, hero, foe } = mmFixture();
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    const s1 = endTurnTo(used, foe.id, scriptedDice(3));
    const first = currentSong(s1.actors[hero.id])!;
    const f1 = endTurnTo(s1, hero.id, scriptedDice());
    const b1 = endTurnTo(f1, foe.id, scriptedDice()); // hero blessed under first
    expect(blessingOf(b1, hero.id)).toBe(1);

    // Re-sing on a later hero turn: using Monogatari nulls the tale, and the
    // hero's next turn-end gambles a NEW tale -> a NEW song instance.
    const heroActive = endTurnTo(b1, hero.id, scriptedDice()); // foe ends -> hero round N+1
    const reused = executeCommand(heroActive, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    const s2 = endTurnTo(reused, foe.id, scriptedDice(3));
    const second = currentSong(s2.actors[hero.id])!;
    expect(second).not.toBe(first); // instance replaced

    // The hero fulfills the NEW tale -> reopens under the new song.
    const f2 = endTurnTo(s2, hero.id, scriptedDice());
    const b2 = endTurnTo(f2, foe.id, scriptedDice());
    expect(blessingOf(b2, hero.id)).toBe(2); // a new song reopens the once-per-song
    expect(usageCount(b2.actors[hero.id], songLedgerKey(hero.id, hero.id, second))).toBe(1);
  });

  it('two Chanters’ songs never alias, and replacing A’s song leaves B untouched', () => {
    const { state, hero, foe, chanterB } = mmFixture({ chanterB: true });
    // Hero sings (round 1 hero slot).
    const usedA = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    const aEst = endTurnTo(usedA, foe.id, scriptedDice(3));
    const aInstance = currentSong(aEst.actors[hero.id])!;
    // The foe ends round 1; the heroes-side controller selects OLIN (the hero's
    // round-1 opening slot is already spent), who sings his OWN song.
    const foeTurnB = endTurnTo(aEst, chanterB!.id, scriptedDice());
    const usedB = executeCommand(foeTurnB, { type: 'USE_ABILITY', actorId: chanterB!.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    const bEst = endTurnTo(usedB, foe.id, scriptedDice(4));
    const bInstance = currentSong(bEst.actors[chanterB!.id])!;
    expect(bInstance).not.toBe(aInstance); // two Chanters never alias

    // A re-sings on a later hero turn -> A's instance ADVANCES, B's is untouched.
    const aRound = endTurnTo(bEst, hero.id, scriptedDice()); // foe round N -> hero round N+1
    const reusedA = executeCommand(aRound, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    const afterAReuse = endTurnTo(reusedA, chanterB!.id, scriptedDice(3)); // A re-gambles -> new song
    const aNew = currentSong(afterAReuse.actors[hero.id])!;
    expect(aNew).not.toBe(aInstance); // A advanced
    expect(currentSong(afterAReuse.actors[chanterB!.id])).toBe(bInstance); // B untouched
  });

  it('a malformed/missing lifecycle identity fails closed and never falls back to a turn/round/combat scope', () => {
    const actor = { id: 'hero', ruleState: {} } as Pick<EncounterActor, 'id' | 'ruleState'>;
    const source = songSourceRef();
    const ownerRef = capturedActor('hero');
    // Missing lifecycle observation (no active song): nothing current -> unavailable.
    const noSong = applyLifecycleScopedUsage({
      recipient: actor,
      lifecycle: { owner: ownerRef, source, instance: 'nope' },
      now: lifecycleObservationForGroup(ownerRef, source, undefined),
      sourceId: MONOGATARI,
      mutations: [],
    });
    expect(noSong).toEqual({ available: false, mutations: [] });

    // A mismatch between the identity and the observed current instance fails closed.
    const other = applyLifecycleScopedUsage({
      recipient: actor,
      lifecycle: { owner: ownerRef, source, instance: 'song:1:hero' },
      now: lifecycleObservationForGroup(ownerRef, source, 'song:99:hero'),
      sourceId: MONOGATARI,
      mutations: [],
    });
    expect(other.available).toBe(false);
    expect(other.mutations).toEqual([]);
    void songGroup;
  });

  it('exact command replay applies the recorded mint AND grant decisions byte-identically', () => {
    const { state, hero, foe } = mmFixture();
    const used = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice());
    const end1 = executeCommand(used.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice(3)); // gamble + mint
    expect(applyEvents(used.state, end1.events)).toEqual(end1.state);
    const foeTurn = executeCommand(end1.state, { type: 'TAKE_TURN', actorId: foe.id });
    expect(applyEvents(end1.state, foeTurn.events)).toEqual(foeTurn.state);
    const heroTurn = executeCommand(foeTurn.state, { type: 'END_TURN', actorId: foe.id });
    const heroTake = executeCommand(heroTurn.state, { type: 'TAKE_TURN', actorId: hero.id });
    expect(applyEvents(heroTurn.state, heroTake.events)).toEqual(heroTake.state);
    const end2 = executeCommand(heroTake.state, { type: 'END_TURN', actorId: hero.id }, scriptedDice()); // hero fulfills -> grant
    expect(applyEvents(heroTake.state, end2.events)).toEqual(end2.state);
    expect(blessingOf(end2.state, hero.id)).toBe(1);
  });
});