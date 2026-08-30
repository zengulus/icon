/**
 * t4-dedup.test.ts — Phase T4 U16 completion, corrected: U10 fact-backed
 * de-duplication with ICON's once-per-ability semantics (p.107).
 *
 * The DEFAULT de-dup identity is RESOLUTION-scoped:
 *   { sourceId, ownerId, scope, resolutionId, trigger (the triggering step) }
 * This is deliberately NOT per-fact. U10 facts answer WHY an effect became
 * eligible; they do NOT imply one execution per qualifying fact. Within ONE
 * resolution (one ability use), a triggered step resolves ONCE however many
 * facts qualify (three Collides → one Collide triggered effect). Across TWO
 * separate resolutions (two uses of the ability), each may trigger again.
 * Per-target de-dup is keyed in ONLY when a source rule genuinely declares
 * once-per-target (`oncePerTarget`); per-event re-triggering only when the
 * source distinguishes trigger instances (`perEvent`).
 *
 * Distinct owners using the same source stay distinct; different triggered
 * STEPS on the same fact stay distinct; and resolution captures the recorded
 * result identically.
 */
import { describe, expect, it } from 'vitest';
import {
  hasResolvedAsFact,
  resolveIdentitiesEqual,
  resolveIdentityForFact,
  resolveIdentityForTrigger,
  resolveIdentityKey,
  triggerResolvedFact,
  type Fact,
  type ResolveIdentity,
} from '../automation/primitives/facts.js';
import { usageIdentitiesEqual, usageIdentity, usageIdentityKey } from '../automation/primitives/usage.js';

const RES = 'res:fixture:gate:use:1';
const damageFact = (sourceId = 'fixture:gate', ownerId = 'hero'): Extract<Fact, { kind: 'damage-applied' }> => ({
  kind: 'damage-applied', instanceId: `fact:${sourceId}:damage-applied:0`, sourceId, ownerId, recipientId: 'foe', amount: 3, delivery: 'hit',
});

describe('U16 completion — resolution-scoped once-per-ability de-dup', () => {
  it('two different owners using the same source produce distinct de-dup identities', () => {
    const fHero = damageFact();
    const fVillain = damageFact('fixture:gate', 'villain');
    const idHero = resolveIdentityForFact(fHero, 'round', 'hit', { resolutionId: RES });
    const idVillain = resolveIdentityForFact(fVillain, 'round', 'hit', { resolutionId: RES });
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

  it('one ability, multiple routing facts for the same step → resolves ONCE (once-per-ability)', () => {
    // THREE Collide facts establish that Collide occurred within one ability.
    const collideA = { kind: 'collide' as const, instanceId: 'fact:g:collide:0', sourceId: 'fixture:shove', ownerId: 'hero', shovedActorId: 'foe1' };
    const collideB = { kind: 'collide' as const, instanceId: 'fact:g:collide:1', sourceId: 'fixture:shove', ownerId: 'hero', shovedActorId: 'foe2' };
    const collideC = { kind: 'collide' as const, instanceId: 'fact:g:collide:2', sourceId: 'fixture:shove', ownerId: 'hero', shovedActorId: 'foe3' };
    // The same triggered STEP identity — once per resolution, NOT per fact.
    const step = resolveIdentityForTrigger('fixture:shove', 'hero', 'round', RES, 'collide');
    const facts = [collideA, collideB, collideC, triggerResolvedFact(step)];
    expect(hasResolvedAsFact(step, facts)).toBe(true); // ONE Collide resolution
  });

  it('the same triggered step reachable through overlapping routes resolves once', () => {
    const fact = damageFact();
    // Route A and route B respond to the SAME ability's HIT.
    const routeA = resolveIdentityForFact(fact, 'round', 'hit', { resolutionId: RES });
    const routeB = resolveIdentityForFact(fact, 'round', 'hit', { resolutionId: RES });
    expect(resolveIdentityKey(routeA)).toBe(resolveIdentityKey(routeB));
    const recorded = [triggerResolvedFact(routeA)];
    expect(hasResolvedAsFact(routeA, recorded)).toBe(true);
    expect(hasResolvedAsFact(routeB, recorded)).toBe(true); // resolves ONCE
  });

  it('a second use of the same ability can trigger the step again (different resolution)', () => {
    const resOne = 'res:fixture:gate:ability:1';
    const resTwo = 'res:fixture:gate:ability:2';
    const useOne = resolveIdentityForTrigger('fixture:gate', 'hero', 'round', resOne, 'hit');
    const useTwo = resolveIdentityForTrigger('fixture:gate', 'hero', 'round', resTwo, 'hit');
    expect(resolveIdentitiesEqual(useOne, useTwo)).toBe(false); // distinct resolutions
    // Resolving the first does NOT resolve the second.
    const recorded = [triggerResolvedFact(useOne)];
    expect(hasResolvedAsFact(useOne, recorded)).toBe(true);
    expect(hasResolvedAsFact(useTwo, recorded)).toBe(false);
  });

  it('two distinct triggered steps responding to the same fact stay independent', () => {
    const fact = damageFact();
    const hit = resolveIdentityForFact(fact, 'round', 'hit', { resolutionId: RES });
    const crit = resolveIdentityForFact(fact, 'round', 'critical-hit', { resolutionId: RES });
    expect(resolveIdentityKey(hit)).not.toBe(resolveIdentityKey(crit));
    const recorded = [triggerResolvedFact(hit)];
    expect(hasResolvedAsFact(hit, recorded)).toBe(true);
    expect(hasResolvedAsFact(crit, recorded)).toBe(false);
  });

  it('per-target de-dup is keyed in ONLY when a source declares once-per-target', () => {
    // Default: no per-target dimension — two targets under the same step in
    // one resolution share the identity (the triggered effect resolves once).
    const defaultA = resolveIdentityForTrigger('fixture:gate', 'hero', 'round', RES, 'hit');
    const defaultB = resolveIdentityForTrigger('fixture:gate', 'hero', 'round', RES, 'hit', { targetId: 'foe' });
    expect(resolveIdentityKey(defaultA)).toBe(resolveIdentityKey(defaultB));
    // Source-declared once-per-target: the target becomes part of the identity.
    const perTargetA = resolveIdentityForTrigger('fixture:gate', 'hero', 'round', RES, 'hit', { targetId: 'foe1', oncePerTarget: true });
    const perTargetB = resolveIdentityForTrigger('fixture:gate', 'hero', 'round', RES, 'hit', { targetId: 'foe2', oncePerTarget: true });
    expect(resolveIdentityKey(perTargetA)).not.toBe(resolveIdentityKey(perTargetB));
  });

  it('serialization is unambiguous over delimiter-bearing opaque ids', () => {
    const build = (sourceId: string, ownerId: string): ResolveIdentity => ({ sourceId, ownerId, scope: 'round', resolutionId: 'res:1' });
    expect(resolveIdentityKey(build('a:b', 'c'))).not.toBe(resolveIdentityKey(build('a', 'b:c')));
    // Resolution dimension is structurally part of the identity (never array-order).
    const a = resolveIdentityForTrigger('s', 'hero', 'round', 'res:1', 'hit');
    const b = resolveIdentityForTrigger('s', 'hero', 'round', 'res:2', 'hit');
    expect(resolveIdentityKey(a)).not.toBe(resolveIdentityKey(b));
  });

  it('missing/ambiguous identity fails closed: hasResolvedAsFact never guesses', () => {
    // No recorded marker → not resolved.
    const step = resolveIdentityForTrigger('s', 'hero', 'round', RES, 'hit');
    expect(hasResolvedAsFact(step, [])).toBe(false);
    // A marker for a DIFFERENT resolution does not satisfy this one.
    const otherRes = resolveIdentityForTrigger('s', 'hero', 'round', 'res:other', 'hit');
    expect(hasResolvedAsFact(step, [triggerResolvedFact(otherRes)])).toBe(false);
  });
});