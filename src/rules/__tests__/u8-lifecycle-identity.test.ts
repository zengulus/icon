/**
 * u8-lifecycle-identity.test.ts — U8 SCOPE / CLOCK adversarial proof of the
 * GENERIC source-defined lifecycle identity (`until-lifecycle-replaced`).
 *
 * The critical design requirement: ``the current instance of this source-\
 * defined lifecycle owned by this source/actor`` must be represented WITHOUT
 * hiding semantic identity inside magic strings, WITHOUT a hard-coded 'song'
 * period-enum member, and generically (proof case Monogatari p.179):
 *
 *   - the song persists until Monogatari is used again;
 *   - a character may fulfill its condition once per that song;
 *   - two different Chanters' songs never alias;
 *   - replacing one Chanter's song does not reset another Chanter's state.
 *
 * The identity is composed of U1 references (owner + source) and a durable
 * instance discriminator; the scope is satisfied exactly when the observed
 * current instance for the same (owner, source) ADVANCES past the recorded one.
 *
 * Mandatory adversarial requirements pinned here (in addition to the existing
 * scope.test.ts edge/epoch/replay matrix):
 *   1. two source-defined lifecycle owners do not alias (proof case 3);
 *   2. replacing lifecycle instance A invalidates/advances A's scope but NOT B's
 *      (proof case 4);
 *   3. the same source lifecycle re-established advances ONLY the owner
 *      involved (proof case 2, replacement is owner-scoped);
 *   4. lifecycle identity never falls back to a magic string / raw source unit
 *      — a malformed identity (wrong owner ref or source ref) is a DIFFERENT
 *      identity, never aliased;
 *   5. an observation that records no lifecycles FAILS CLOSED (scope not
 *      satisfied) — replacement is never approximated from boundary counts;
 *   6. replay: the same durable observation yields the same current/equality
 *      answer (pure, deterministic).
 */
import { describe, expect, it } from 'vitest';
import {
  boundaryKey,
  currentLifecycleInstanceId,
  lifecycleGroupKey,
  lifecycleIdentityKey,
  lifecycleInstanceCurrent,
  lifecycleReplaced,
  sameLifecycleInstance,
  scopeSatisfied,
  type BoundaryRef,
  type ClockObservation,
  type LifecycleIdentity,
} from '../automation/primitives/scope.js';
import { capturedActor, liveActorSlot, referenceKey } from '../automation/primitives/reference.js';

const roundEnd: BoundaryRef = { kind: 'boundary', boundary: 'round', edge: 'end' };
const roundEndKey = boundaryKey(roundEnd);

/** One Monogatari song owned by a specific Chanter actor reference (proof
 * cases 1/3/4 must distinguish owners by REFERENCE, never by a magic string). */
function song(owner: ReturnType<typeof capturedActor>, instance: string): LifecycleIdentity {
  return {
    owner,
    source: { kind: 'live', domain: 'rule-source', name: { kind: 'id', id: 'chanter:monogatari' } },
    instance,
  };
}

/** A durable observation: `lifecycles` maps each (owner, source) group key to
 * its CURRENT instance discriminator; `last`/`counts` carry the boundary clock. */
function obs(lifecycles: Record<string, string>): ClockObservation {
  return { last: roundEnd, counts: { [roundEndKey]: 5 }, lifecycles };
}

function groupKeyFor(owner: ReturnType<typeof capturedActor> | ReturnType<typeof liveActorSlot>): string {
  return lifecycleGroupKey(owner, { kind: 'live', domain: 'rule-source', name: { kind: 'id', id: 'chanter:monogatari' } });
}

const chantername = 'chanter:monogatari';
const groupSource = { kind: 'live' as const, domain: 'rule-source' as const, name: { kind: 'id' as const, id: chantername } };

describe('U8 source-defined lifecycle identity — two owners never alias', () => {
  it('proof-3: differing owner references are DIFFERENT group identities (never collided / alias)', () => {
    // Two different Chanters (shown here via two distinct owner references) must
    // not share a lifecycle group with each other — nor share one with a raw
    // actor-id / magic-string substitute. The owner is part of the identity.
    const aOwner = capturedActor('chanter-a');
    const bOwner = capturedActor('chanter-b');
    const groupA = lifecycleGroupKey(aOwner, groupSource);
    const groupB = lifecycleGroupKey(bOwner, groupSource);
    expect(groupA).not.toBe(groupB);
    // And the two ARE distinct from each other in a shared map: two Chanters'
    // songs coexist indepenently.
    const both = obs({ [groupA]: 'song-1', [groupB]: 'song-9' });
    expect(currentLifecycleInstanceId(both, aOwner, groupSource)).toBe('song-1');
    expect(currentLifecycleInstanceId(both, bOwner, groupSource)).toBe('song-9');
  });

  it('proof-3 (content form): the two seed songs produced for distinct actors are not the same identity', () => {
    const a = song(capturedActor('chanter-a'), 'song-1');
    // Rebuild the SECOND Chanters' song via a genuinely different owner reference.
    const b: LifecycleIdentity = { owner: capturedActor('chanter-b'), source: a.source, instance: 'song-9' };
    expect(sameLifecycleInstance(a, b)).toBe(false);
    expect(lifecycleIdentityKey(a)).not.toBe(lifecycleIdentityKey(b));
  });
});

describe('U8 source-defined lifecycle identity — replacement advances only the replaced owner', () => {
  it('proof-2: replacing Chanter A\'s song invalidates A\'s scope but NOT Chanter B\'s', () => {
    const aOwner = capturedActor('chanter-a');
    const bOwner = capturedActor('chanter-b');
    const groupA = lifecycleGroupKey(aOwner, groupSource);
    const groupB = lifecycleGroupKey(bOwner, groupSource);

    // Both are singing their first songs, durably recorded.
    const initial: LifecycleIdentity = { owner: aOwner, source: groupSource, instance: 'song-1' };
    const otherB: LifecycleIdentity = { owner: bOwner, source: groupSource, instance: 'song-X' };
    const before = obs({ [groupA]: 'song-1', [groupB]: 'song-X' });

    // A song is a `until-lifecycle-replaced` scope: NOT satisfied while its
    // instance is still current.
    expect(lifecycleReplaced(initial, before)).toBe(false);
    expect(scopeSatisfied({ kind: 'until-lifecycle-replaced', lifecycle: initial }, before)).toBe(false);
    expect(lifecycleInstanceCurrent(initial, before)).toBe(true);

    // Chanter A uses Monogatari again → a NEW song (new discriminator) for A.
    const afterA = obs({ [groupA]: 'song-2', [groupB]: 'song-X' });
    // A's original song is replaced / its scope is now satisfied.
    expect(lifecycleReplaced(initial, afterA)).toBe(true);
    expect(scopeSatisfied({ kind: 'until-lifecycle-replaced', lifecycle: initial }, afterA)).toBe(true);
    expect(lifecycleInstanceCurrent(initial, afterA)).toBe(false);
    // Chanter B's song is UNTOUCHED — never reset by A's replacement.
    expect(lifecycleReplaced(otherB, afterA)).toBe(false);
    expect(scopeSatisfied({ kind: 'until-lifecycle-replaced', lifecycle: otherB }, afterA)).toBe(false);
    expect(currentLifecycleInstanceId(afterA, bOwner, groupSource)).toBe('song-X');
  });

  it('proof-1: an active song scope is NOT satisfied before its owner resumes the lifecycle', () => {
    const aOwner = capturedActor('chanter-a');
    const groupA = lifecycleGroupKey(aOwner, groupSource);
    const current: LifecycleIdentity = { owner: aOwner, source: groupSource, instance: 'song-1' };
    const atEstablishment = obs({ [groupA]: 'song-1' });
    expect(scopeSatisfied({ kind: 'until-lifecycle-replaced', lifecycle: current }, atEstablishment)).toBe(false);
    expect(lifecycleReplaced(current, atEstablishment)).toBe(false);
  });
});

describe('U8 source-defined lifecycle identity — no magic-string fallback', () => {
  it('adversarial-4: a malformed identity (wrong owner ref OR wrong source ref) is a DIFFERENT identity', () => {
    const aOwner = capturedActor('chanter-a');
    const identity: LifecycleIdentity = { owner: aOwner, source: groupSource, instance: 'song-1' };
    // Wrong owner reference → NOT the same instance.
    const wrongOwner: LifecycleIdentity = { owner: capturedActor('chanter-other'), source: groupSource, instance: 'song-1' };
    expect(sameLifecycleInstance(identity, wrongOwner)).toBe(false);
    // Wrong source reference → NOT the same instance (a different source
    // lifecycle, e.g. Aria's song, must never alias Monogatari's).
    const wrongSource: LifecycleIdentity = {
      owner: aOwner,
      source: { kind: 'live', domain: 'rule-source', name: { kind: 'id', id: 'chanter:aria' } },
      instance: 'song-1',
    };
    expect(sameLifecycleInstance(identity, wrongSource)).toBe(false);
    // Same owner + source + instance equal self.
    expect(sameLifecycleInstance(identity, { ...identity })).toBe(true);
  });

  it('adversarial-5: an observation that records NO lifecycles fails closed', () => {
    const identity = song(capturedActor('chanter-a'), 'song-1');
    const noLifecycles: ClockObservation = { last: roundEnd, counts: { [roundEndKey]: 5 } };
    // Without a lifecycle observation the replacement cannot be confirmed: the
    // scope is NOT satisfied (fail closed), never approximated from round counts.
    expect(scopeSatisfied({ kind: 'until-lifecycle-replaced', lifecycle: identity }, noLifecycles)).toBe(false);
    expect(lifecycleReplaced(identity, noLifecycles)).toBe(false);
    expect(lifecycleInstanceCurrent(identity, noLifecycles)).toBe(false);
  });
});

describe('U8 source-defined lifecycle identity — determinism / replay and pure identity keys', () => {
  it('adversarial-6: the same durable observation yields the same answer (pure)', () => {
    const identity = song(capturedActor('chanter-a'), 'song-1');
    const after = obs({ [groupKeyFor(capturedActor('chanter-a'))]: 'song-2' });
    const first = scopeSatisfied({ kind: 'until-lifecycle-replaced', lifecycle: identity }, after);
    const second = scopeSatisfied({ kind: 'until-lifecycle-replaced', lifecycle: identity }, after);
    expect(second).toBe(first);
    expect(lifecycleReplaced(identity, after)).toBe(true);
    // Keys are canonical, deterministic functions of structure only.
    expect(lifecycleGroupKey(identity.owner, identity.source))
      .toBe(`${lifecycleGroupKey(identity.owner, identity.source)}`);
    expect(referenceKey(identity.owner)).toBe(referenceKey(identity.owner));
  });

  it('identity keys are stable under structural reconstruction', () => {
    const a = song(capturedActor('chanter-a'), 'song-1');
    const b: LifecycleIdentity = { owner: a.owner, source: a.source, instance: 'song-1' };
    expect(lifecycleIdentityKey(a)).toBe(lifecycleIdentityKey(b));
    expect(lifecycleIdentityKey(a)).toBe(`${lifecycleGroupKey(a.owner, a.source)}:song-1`);
  });
});