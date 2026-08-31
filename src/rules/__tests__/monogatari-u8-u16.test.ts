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
import { endTurnOnly, endTurnTo, scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

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

/** Insertion order is deliberately configurable: `bFirst` adds the second
 * Chanter BEFORE the first, so `Object.values(state.actors)` iteration order
 * reverses while every semantic identity (owner × song instance) is
 * unchanged. The multi-owner grant path must produce the identical outcome in
 * both orders. */
function mmFixture(options: { ally?: boolean; chanterB?: boolean; bFirst?: boolean } = {}): Fixture {
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
  const inserted = options.bFirst ? [chanterB, hero, foe, ally] : [hero, foe, ally, chanterB];
  for (const actor of inserted) {
    if (!actor) continue;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor }).state;
  }
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, ally, chanterB };
}

/** Two independently active songs: `hero` (Chanter A) sings `aTale`, `chanterB`
 * (Chanter B) sings `bTale`, both established before the recipient (the ally)
 * is selected at round 1. Returns the state with the ALLY selected as the
 * pending recipient (both songs active) plus each song's durable U8 instance.
 * `bFirst` reverses ADD_ACTOR insertion order for the actor map.
 *
 * Cadence (3 heroes + 1 foe): round 1 = hero A, foe, hero B, ally; the round
 * advances only when every actor's round entitlement is spent, so the foe is
 * NOT selectable after B ends — the ally is. The recipient's turn is therefore
 * the state returned; tests end it with `endTurnOnly`/`executeCommand END_TURN`. */
function twoSongFixture(aTale: number, bTale: number, options: { bFirst?: boolean } = {}): {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally: EncounterActor;
  chanterB: EncounterActor;
  aInstance: string;
  bInstance: string;
} {
  const { state, hero, foe, ally, chanterB } = mmFixture({ ally: true, chanterB: true, bFirst: options.bFirst });
  const usedA = executeCommand(state, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
  const aEst = endTurnTo(usedA, foe.id, scriptedDice(aTale)); // A ends -> foe (round 1)
  const aInstance = currentSong(aEst.actors[hero.id])!;
  const olinTurn = endTurnTo(aEst, chanterB!.id, scriptedDice()); // foe ends -> B (round 1)
  const usedB = executeCommand(olinTurn, { type: 'USE_ABILITY', actorId: chanterB!.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
  const bEst = endTurnTo(usedB, ally!.id, scriptedDice(bTale)); // B ends -> ally (round 1)
  const bInstance = currentSong(bEst.actors[chanterB!.id])!;
  expect(bEst.activeActorId).toBe(ally!.id);
  expect(typeof aInstance).toBe('string');
  expect(typeof bInstance).toBe('string');
  return { state: bEst, hero, foe, ally: ally!, chanterB: chanterB!, aInstance, bInstance };
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

  // ---------------------------------------------------------------------------
  // MULTI-OWNER adversarial matrix: two independent ACTIVE songs, every
  // recipient evaluated independently against each, never a first-match
  // `Object.values(state.actors).find(...)` owner selection.
  // ---------------------------------------------------------------------------

  it('a recipient that fulfills ONLY song B receives exactly B\'s blessing (no first-match aliasing onto A)', () => {
    // A sings Tale 2 (Travels: move 4+ from start); B sings Tale 3 (Green: do
    // not attack). The recipient stays put and does not attack → satisfies B
    // only. The pre-fix first-match read found A (inserted first) and granted
    // nothing; the correct result is B's independent blessing.
    const { state, ally, hero, chanterB, aInstance, bInstance } = twoSongFixture(2, 3);
    const grant = endTurnOnly(state, scriptedDice());
    expect(blessingOf(grant, ally.id)).toBe(1);
    // B's entitlement consumed under B's song instance; A's untouched.
    expect(usageCount(grant.actors[ally.id], songLedgerKey(chanterB.id, ally.id, bInstance))).toBe(1);
    expect(usageCount(grant.actors[ally.id], songLedgerKey(hero.id, ally.id, aInstance))).toBe(0);
  });

  it('a recipient that fulfills both songs is blessed once per song — independent simultaneous consumes', () => {
    const { state, ally, hero, chanterB, aInstance, bInstance } = twoSongFixture(3, 3); // both Green
    const grant = endTurnOnly(state, scriptedDice());
    expect(blessingOf(grant, ally.id)).toBe(2); // both songs' rewards, not one
    expect(usageCount(grant.actors[ally.id], songLedgerKey(hero.id, ally.id, aInstance))).toBe(1);
    expect(usageCount(grant.actors[ally.id], songLedgerKey(chanterB.id, ally.id, bInstance))).toBe(1);
  });

  it('consuming song A never marks song B consumed (and vice versa)', () => {
    // Two active songs with DIFFERENT tales; the recipient satisfies A (Green:
    // no attack) but never B (Travels: move 4+). Only A's ledger key exists.
    const { state, ally, hero, chanterB, aInstance, bInstance } = twoSongFixture(3, 2);
    const grant = endTurnOnly(state, scriptedDice());
    expect(blessingOf(grant, ally.id)).toBe(1);
    expect(usageCount(grant.actors[ally.id], songLedgerKey(hero.id, ally.id, aInstance))).toBe(1);
    expect(usageCount(grant.actors[ally.id], songLedgerKey(chanterB.id, ally.id, bInstance))).toBe(0); // B clean
    // The symmetric trace (satisfy B only) left A clean — asserted above.
  });

  it('a same recipient cannot fulfill song A twice during the same A instance, even with B active', () => {
    const { state, ally, hero, chanterB, aInstance, bInstance } = twoSongFixture(3, 3);
    const granted = endTurnOnly(state, scriptedDice());
    expect(blessingOf(granted, ally.id)).toBe(2);
    // Round 1 is exhausted (all four actors took their turn), so round 2 opens
    // with the foe; after the foe, the heroes side selects the ally again. She
    // ends WITHOUT attacking again → no third grant, neither key advances.
    const foeId = Object.values(granted.actors).find((candidate) => candidate.side === 'foes')!.id;
    const foeTake = executeCommand(granted, { type: 'TAKE_TURN', actorId: foeId }).state;
    const foeEnd = endTurnOnly(foeTake, scriptedDice());
    const allyTake = executeCommand(foeEnd, { type: 'TAKE_TURN', actorId: ally.id }).state;
    const again = endTurnOnly(allyTake, scriptedDice());
    expect(blessingOf(again, ally.id)).toBe(2); // no third grant
    expect(usageCount(again.actors[ally.id], songLedgerKey(hero.id, ally.id, aInstance))).toBe(1);
    expect(usageCount(again.actors[ally.id], songLedgerKey(chanterB.id, ally.id, bInstance))).toBe(1);
    void hero;
    void chanterB;
  });

  it('replacing song A reopens A for the recipient without reopening or otherwise changing B', () => {
    const { state, hero, ally, chanterB, aInstance, bInstance } = twoSongFixture(2, 3);
    // The ally satisfies B's Green tale only, once.
    const granted = endTurnOnly(state, scriptedDice());
    expect(blessingOf(granted, ally.id)).toBe(1);
    // Round 2: the foe opens, then the heroes side selects A, who RE-SINGS →
    // A's instance ADVANCES; B's instance is untouched.
    const foeId = Object.values(granted.actors).find((candidate) => candidate.side === 'foes')!.id;
    const foeTake = executeCommand(granted, { type: 'TAKE_TURN', actorId: foeId }).state;
    const foeEnd = endTurnOnly(foeTake, scriptedDice());
    const heroTake = executeCommand(foeEnd, { type: 'TAKE_TURN', actorId: hero.id }).state;
    const reusedA = executeCommand(heroTake, { type: 'USE_ABILITY', actorId: hero.id, abilityId: MONOGATARI, targetIds: [] }, scriptedDice()).state;
    const afterReuse = endTurnOnly(reusedA, scriptedDice(3)); // new A song, Green
    const aNew = currentSong(afterReuse.actors[hero.id])!;
    expect(aNew).not.toBe(aInstance); // A's instance advanced
    expect(currentSong(afterReuse.actors[chanterB.id])).toBe(bInstance); // B untouched
    // B's remaining round-2 hero still acts (no assertion), then the ally is
    // selected and fulfills A's NEW Green tale: blessed under A-new only; B's
    // entitlement stays consumed under the ORIGINAL B instance (not reopened).
    const olinTake = executeCommand(afterReuse, { type: 'TAKE_TURN', actorId: chanterB.id }).state;
    const olinEnd = endTurnOnly(olinTake, scriptedDice());
    const allyTake = executeCommand(olinEnd, { type: 'TAKE_TURN', actorId: ally.id }).state;
    const granted2 = endTurnOnly(allyTake, scriptedDice());
    expect(blessingOf(granted2, ally.id)).toBe(2); // B's old grant + A-new grant
    expect(usageCount(granted2.actors[ally.id], songLedgerKey(hero.id, ally.id, aNew))).toBe(1);
    expect(usageCount(granted2.actors[ally.id], songLedgerKey(hero.id, ally.id, aInstance))).toBe(0);
    expect(usageCount(granted2.actors[ally.id], songLedgerKey(chanterB.id, ally.id, bInstance))).toBe(1); // B still spent
  });

  it('two Chanters singing the same tale still remain independent lifecycle/usage identities', () => {
    const { state, ally, hero, chanterB, aInstance, bInstance } = twoSongFixture(3, 3);
    expect(aInstance).not.toBe(bInstance); // distinct song instances
    expect(songLedgerKey(hero.id, ally.id, aInstance)).not.toBe(songLedgerKey(chanterB.id, ally.id, bInstance));
    const grant = endTurnOnly(state, scriptedDice());
    expect(blessingOf(grant, ally.id)).toBe(2);
    expect(usageCount(grant.actors[ally.id], songLedgerKey(hero.id, ally.id, aInstance))).toBe(1);
    expect(usageCount(grant.actors[ally.id], songLedgerKey(chanterB.id, ally.id, bInstance))).toBe(1);
  });

  it('reversing actor insertion/iteration order produces the same semantic outcome', () => {
    // A: Travels (2), B: Green (3); the recipient satisfies B only. Under the
    // first-match read the outcome depended on which Chanter happened to be
    // first in `Object.values(state.actors)` (grant vs no grant); the corrected
    // per-song enumeration grants B in BOTH insertion orders.
    const run = (bFirst: boolean) => {
      const { state, ally, hero, chanterB, aInstance, bInstance } = twoSongFixture(2, 3, { bFirst });
      const grant = endTurnOnly(state, scriptedDice());
      return {
        blessing: blessingOf(grant, ally.id),
        aCount: usageCount(grant.actors[ally.id], songLedgerKey(hero.id, ally.id, aInstance)),
        bCount: usageCount(grant.actors[ally.id], songLedgerKey(chanterB.id, ally.id, bInstance)),
      };
    };
    const forward = run(false);
    const reversed = run(true);
    expect(reversed).toEqual(forward);
    expect(forward).toEqual({ blessing: 1, aCount: 0, bCount: 1 });
  });

  it('exact command replay reproduces the simultaneous two-song grant byte-identically without re-deciding eligibility', () => {
    const { state, ally } = twoSongFixture(3, 3);
    // The current actor is the allly, both songs active, no grants yet.
    const allyEnd = executeCommand(state, { type: 'END_TURN', actorId: ally.id }, scriptedDice());
    expect(applyEvents(state, allyEnd.events)).toEqual(allyEnd.state);
    expect(blessingOf(allyEnd.state, ally.id)).toBe(2);
  });
});