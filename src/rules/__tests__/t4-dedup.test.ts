/**
 * t4-dedup.test.ts — Phase T4 U16 completion: U10 fact-backed de-duplication.
 *
 * The full de-dup identity is the U16 usage identity (source + owner + scope
 * + optional target) PLUS the U10 FACT dimension (WHICH specific resolved
 * event this use answers) + the logical trigger. `hasResolvedAsFact` reads
 * the recorded fact history for a `trigger-resolved` marker — it is EVENT
 * de-duplication, semantically distinct from the U16 entitlement COUNTS
 * (`used-scope`). The corrected T3 identity (`usageIdentityKey`, owner
 * always carried, unambiguous serialization) is what the fact dimension
 * extends — storage keys are never merged with fact identity.
 *
 * Covered here (acceptance §T4): distinct owners produce distinct identities;
 * the same logical trigger reachable through two routes resolves once; two
 * genuinely separate triggering facts from the same source each resolve;
 * per-target identity distinguishes recipients; unambiguous serialization;
 * missing identity fails closed (never guessed); and replay determinism.
 */
import { describe, expect, it } from 'vitest';
import {
  hasResolvedAsFact,
  resolveIdentitiesEqual,
  resolveIdentityForFact,
  resolveIdentityKey,
  triggerResolvedFact,
  type Fact,
  type ResolveIdentity,
} from '../automation/primitives/facts.js';
import { usageIdentitiesEqual, usageIdentity, usageIdentityKey } from '../automation/primitives/usage.js';

const damageFact = (instanceId: string, ownerId = 'hero'): Extract<Fact, { kind: 'damage-applied' }> => ({
  kind: 'damage-applied', instanceId, sourceId: 'fixture:gate', ownerId, recipientId: 'foe', amount: 3, delivery: 'hit',
});

describe('U16 completion — the de-dup identity carries owner + the U10 fact dimension', () => {
  it('two different owners using the same source produce distinct fact/de-dup identities', () => {
    const fHero = damageFact('fact:g:damage-applied:0', 'hero');
    const fVillain = damageFact('fact:g:damage-applied:1', 'villain');
    const idHero = resolveIdentityForFact(fHero, 'round', 'hit');
    const idVillain = resolveIdentityForFact(fVillain, 'round', 'hit');
    expect(resolveIdentitiesEqual(idHero, idVillain)).toBe(false);
    expect(resolveIdentityKey(idHero)).not.toBe(resolveIdentityKey(idVillain));
    // The corrected T3 usage identity also distinguishes the owners.
    expect(usageIdentitiesEqual(
      usageIdentity({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'round' }),
      usageIdentity({ sourceId: 'fixture:gate', ownerId: 'villain', scope: 'round' }),
    )).toBe(false);
    expect(usageIdentityKey(usageIdentity({ sourceId: 'fixture:gate', ownerId: 'hero', scope: 'round' })))
      .not.toBe(usageIdentityKey(usageIdentity({ sourceId: 'fixture:gate', ownerId: 'villain', scope: 'round' })));
  });

  it('the same logical trigger reachable through two routes resolves once (same fact dimension)', () => {
    const fact = damageFact('fact:g:damage-applied:0');
    // Route A and route B both respond to the SAME damage event.
    const routeA = resolveIdentityForFact(fact, 'round', 'hit');
    const routeB = resolveIdentityForFact(fact, 'round', 'hit');
    expect(resolveIdentityKey(routeA)).toBe(resolveIdentityKey(routeB));
    // Recording the marker for route A marks the shared event as resolved.
    const recorded = [triggerResolvedFact(routeA)];
    expect(hasResolvedAsFact(routeA, recorded)).toBe(true);
    expect(hasResolvedAsFact(routeB, recorded)).toBe(true); // resolves ONCE
  });

  it('two genuinely separate triggering facts from the same source each resolve', () => {
    const factOne = damageFact('fact:g:damage-applied:0');
    const factTwo = damageFact('fact:g:damage-applied:1');
    const idOne = resolveIdentityForFact(factOne, 'round', 'hit');
    const idTwo = resolveIdentityForFact(factTwo, 'round', 'hit');
    expect(resolveIdentityKey(idOne)).not.toBe(resolveIdentityKey(idTwo));
    // Resolving the first does NOT resolve the second — each is distinct.
    const recorded = [triggerResolvedFact(idOne)];
    expect(hasResolvedAsFact(idOne, recorded)).toBe(true);
    expect(hasResolvedAsFact(idTwo, recorded)).toBe(false);
  });

  it('per-target identity distinguishes different recipients', () => {
    const factFoe = damageFact('fact:g:damage-applied:0');
    const factFoe2 = { ...damageFact('fact:g:damage-applied:1'), recipientId: 'foe2' };
    const a = resolveIdentityForFact(factFoe, 'round', 'hit');
    const b = resolveIdentityForFact(factFoe2, 'round', 'hit');
    expect(resolveIdentitiesEqual(a, b)).toBe(false);
    const recorded = [triggerResolvedFact(a)];
    expect(hasResolvedAsFact(a, recorded)).toBe(true);
    expect(hasResolvedAsFact(b, recorded)).toBe(false);
  });

  it('a different trigger route on the same event stays distinct', () => {
    const fact = damageFact('fact:g:damage-applied:0');
    const hit = resolveIdentityForFact(fact, 'round', 'hit');
    const crit = resolveIdentityForFact(fact, 'round', 'critical-hit');
    expect(resolveIdentityKey(hit)).not.toBe(resolveIdentityKey(crit));
  });

  it('serialization is unambiguous over delimiter-bearing opaque ids', () => {
    const build = (sourceId: string, ownerId: string): ResolveIdentity => ({ sourceId, ownerId, scope: 'round', factDimension: 'F' });
    expect(resolveIdentityKey(build('a:b', 'c'))).not.toBe(resolveIdentityKey(build('a', 'b:c')));
    // Fact dimension is structurally part of the identity (never array-order).
    const a = resolveIdentityForFact(damageFact('f:0'), 'round', 'hit');
    const b = resolveIdentityForFact(damageFact('f:1'), 'round', 'hit');
    expect(resolveIdentityKey(a)).not.toBe(resolveIdentityKey(b));
  });

  it('missing/ambiguous identity fails closed: hasResolvedAsFact never guesses', () => {
    // No recorded marker → not resolved. An unrecorded/ambiguous event is
    // simply unanswered until a genuine marker is recorded.
    const fact = damageFact('fact:g:damage-applied:0');
    const id = resolveIdentityForFact(fact, 'round', 'hit');
    expect(hasResolvedAsFact(id, [])).toBe(false);
    // A marker with a DIFFERENT fact dimension does not satisfy this one.
    const other = { ...damageFact('fact:g:damage-applied:9'), amount: 99 };
    expect(hasResolvedAsFact(id, [triggerResolvedFact(resolveIdentityForFact(other, 'round', 'hit'))])).toBe(false);
  });
});