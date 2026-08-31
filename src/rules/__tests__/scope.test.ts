/**
 * scope.test.ts — the U8 SCOPE / CLOCK underlay's semantic contract.
 *
 * The underlay is ONE shared vocabulary for temporal/usage boundaries.
 * Corrective pass (2026-08-30) fixes the temporal semantics the T1 slice
 * discarded:
 *   - boundaries carry an EDGE (`start`/`end`) — turn-start ≠ turn-end,
 *     round-start ≠ round-end, combat-start ≠ combat-end are NEVER collapsed;
 *   - boundaries can carry a U1 SUBJECT when actor-relative ("end of YOUR
 *     turn" vs "end of TARGET's turn" are distinct); `slow-turn` start is
 *     representationally distinct from ordinary turn start;
 *   - COUNTED / next forms are RELATIVE to a recorded epoch — an effect
 *     created on round 5 "for 3 rounds" completes only after three matching
 *     round boundaries from its origin, NOT because `5 >= 3`;
 *   - `permanent` is a scope with no expiration, never "reached";
 *   - non-boundary step timings ('use', attack-*) are NOT boundaries —
 *     `clockForTiming`/`currentClock` return null for them;
 *   - `boundaryReached`/`scopeSatisfied` fail closed without a recorded epoch
 *     for relative reads instead of inventing answers;
 *   - replay over the same durable clock/boundary record gives the same answer.
 */
import { describe, expect, it } from 'vitest';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import { boundaryKey, boundaryEquals, boundaryReached, clockForTiming, currentClock, durationSurvivesCombatEnd, scopeForDuration, scopeSatisfied, type BoundaryRef, type ClockObservation } from '../automation/primitives/scope.js';
import { liveActorSlot } from '../automation/primitives/reference.js';

function ctx(timing: RuleExecutionContext['timing'], round = 3): RuleExecutionContext {
  return {
    state: {
      round,
      grid: { width: 24, height: 24 },
      actors: {},
      entities: {},
      terrainAt: () => new Set(),
      elevationAt: () => 0,
      terrainEffects: [],
    },
    actorId: 'hero',
    sourceId: 'test:source',
    actionId: 'default',
    timing,
    input: {},
    dice: { die: () => 1 },
  };
}

function obs(last: BoundaryRef, counts: Record<string, number> = {}): ClockObservation {
  return { last, counts };
}

// Canonical boundary fixtures.
const roundEnd = { kind: 'boundary' as const, boundary: 'round' as const, edge: 'end' as const };
const roundStart = { kind: 'boundary' as const, boundary: 'round' as const, edge: 'start' as const };
const roundEndKey = boundaryKey(roundEnd);
const ordinaryTurnStart = { kind: 'boundary' as const, boundary: 'turn' as const, edge: 'start' as const };
const sourceTurnEnd = { kind: 'boundary' as const, boundary: 'turn' as const, edge: 'end' as const, subject: liveActorSlot('source') };
const targetTurnStart = { kind: 'boundary' as const, boundary: 'turn' as const, edge: 'start' as const, subject: liveActorSlot('attack-target') };
const sourceTurnStart = { kind: 'boundary' as const, boundary: 'turn' as const, edge: 'start' as const, subject: liveActorSlot('source') };

describe('U8 SCOPE/CLOCK — edges and subjects are never collapsed', () => {
  it('1: turn-start ≠ turn-end', () => {
    expect(clockForTiming('turn-start')).toEqual({ kind: 'boundary', boundary: 'turn', edge: 'start' });
    expect(clockForTiming('turn-end')).toEqual({ kind: 'boundary', boundary: 'turn', edge: 'end' });
    expect(clockForTiming('turn-start')).not.toEqual(clockForTiming('turn-end'));
  });

  it('2: round-start ≠ round-end and combat-start ≠ combat-end', () => {
    expect(clockForTiming('round-start')).toEqual(roundStart);
    expect(clockForTiming('round-end')).toEqual(roundEnd);
    expect(roundStart).not.toEqual(roundEnd);
    expect(clockForTiming('combat-start')).toEqual({ kind: 'boundary', boundary: 'combat', edge: 'start' });
    expect(clockForTiming('combat-end')).toEqual({ kind: 'boundary', boundary: 'combat', edge: 'end' });
    expect(clockForTiming('combat-start')).not.toEqual(clockForTiming('combat-end'));
  });

  it('3: source turn ≠ target turn (the subject is retained)', () => {
    expect(boundaryEquals(sourceTurnEnd, { ...sourceTurnEnd, subject: liveActorSlot('attack-target') })).toBe(false);
    expect(boundaryEquals(sourceTurnStart, targetTurnStart)).toBe(false);
  });

  it('6: "next target turn start" does not fire on source turn start', () => {
    const clock = { kind: 'next' as const, boundary: targetTurnStart };
    const epoch = obs(sourceTurnStart, { [boundaryKey(targetTurnStart)]: 0 });
    // The SOURCE turn start happens (target occurrences stay 0) -> not reached.
    expect(boundaryReached(clock, obs(sourceTurnStart, { [boundaryKey(targetTurnStart)]: 0 }), epoch)).toBe(false);
    // The TARGET turn start happens (target occurrences now 1) -> reached.
    expect(boundaryReached(clock, obs(targetTurnStart, { [boundaryKey(targetTurnStart)]: 1 }), epoch)).toBe(true);
  });

  it('7: slow-turn start is representationally distinct from ordinary turn start', () => {
    const slowTurnStart = { kind: 'boundary' as const, boundary: 'slow-turn' as const, edge: 'start' as const };
    expect(boundaryEquals(ordinaryTurnStart, slowTurnStart)).toBe(false);
    expect(slowTurnStart.boundary).not.toBe(ordinaryTurnStart.boundary);
  });
});

describe('U8 SCOPE/CLOCK — counted boundaries are RELATIVE to the recorded origin, not absolute round numbers', () => {
  it('4: an effect created on round 5 "for 3 rounds" is NOT complete on round 5 merely because 5 >= 3', () => {
    const scope = { kind: 'for-n' as const, boundary: roundEnd, n: 3 };
    // Created during round 5: the epoch counts 4 completed round-ends.
    const epoch = obs(roundStart, { [roundEndKey]: 4 });
    // At creation (round 5 in progress): 0 round-ends have elapsed since the epoch.
    const atCreation = obs(roundStart, { [roundEndKey]: 4 });
    expect(scopeSatisfied(scope, atCreation, epoch)).toBe(false);
  });

  it('5: it completes only after three matching round boundaries from its recorded origin', () => {
    const scope = { kind: 'for-n' as const, boundary: roundEnd, n: 3 };
    const epoch = obs(roundStart, { [roundEndKey]: 4 });
    // After round 5 ends (1 elapsed) — not done.
    expect(scopeSatisfied(scope, obs(roundEnd, { [roundEndKey]: 5 }), epoch)).toBe(false);
    // After round 6 ends (2 elapsed) — not done.
    expect(scopeSatisfied(scope, obs(roundEnd, { [roundEndKey]: 6 }), epoch)).toBe(false);
    // After round 7 ends (3 elapsed) — done, even though the absolute round
    // is 7 and the absolute round number is much larger than 3.
    expect(scopeSatisfied(scope, obs(roundEnd, { [roundEndKey]: 7 }), epoch)).toBe(true);
    // It stays done on a later round.
    expect(scopeSatisfied(scope, obs(roundStart, { [roundEndKey]: 8 }), epoch)).toBe(true);
  });

  it('negative: a relative count/next read without the recorded epoch fails closed (never invents an absolute answer)', () => {
    expect(boundaryReached({ kind: 'next', boundary: roundEnd }, obs(roundEnd, { [roundEndKey]: 1 }))).toBe(false);
    expect(scopeSatisfied({ kind: 'for-n', boundary: roundEnd, n: 1 }, obs(roundEnd, { [roundEndKey]: 5 }))).toBe(false);
  });
});

describe('U8 SCOPE/CLOCK — permanent and named-event extents', () => {
  it('9: permanent scope does not expire (never "reached")', () => {
    // Permanent is a scope with NO expiration, NOT an event that already fired.
    const anyNow = obs(roundEnd, { [roundEndKey]: 99 });
    expect(scopeSatisfied({ kind: 'permanent' }, anyNow)).toBe(false);
    expect(scopeSatisfied({ kind: 'permanent' }, anyNow)).toBe(false);
  });

  it('10: a named-event scope expires only from the matching recorded event', () => {
    const scope = { kind: 'until-event' as const, event: 'six-hells-detonate' };
    expect(scopeSatisfied(scope, obs({ kind: 'event', event: 'other-thing' }))).toBe(false);
    expect(scopeSatisfied(scope, obs({ kind: 'event', event: 'six-hells-detonate' }))).toBe(true);
    // A boundary transition is not the named event.
    expect(scopeSatisfied(scope, obs(roundEnd))).toBe(false);
  });
});

describe('U8 SCOPE/CLOCK — non-boundary timings and the current clock', () => {
  it('8: non-boundary step timings do NOT masquerade as a round boundary', () => {
    for (const timing of ['use', 'passive', 'interrupt', 'attack-hit', 'attack-miss', 'damaged', 'defeated'] as const) {
      expect(clockForTiming(timing)).toBeNull();
    }
    // A command executing at `use` is not "at the round boundary".
    expect(currentClock(ctx('use'))).toBeNull();
    expect(currentClock(ctx('attack-hit'))).toBeNull();
  });

  it('positive: the current clock sits on the matching boundary for boundary timings', () => {
    expect(currentClock(ctx('round-end'))).toEqual(roundEnd);
    expect(currentClock(ctx('turn-start'))).toEqual(ordinaryTurnStart);
  });
});

describe('U8 SCOPE/CLOCK — scopeForDuration preserves temporal semantics', () => {
  it('turn-start/turn-end durations keep their EDGE and their actor-relative SUBJECT', () => {
    expect(scopeForDuration({ kind: 'turn-end', actor: { kind: 'self' }, turns: 1 })).toEqual({
      kind: 'for-n',
      boundary: { kind: 'boundary', boundary: 'turn', edge: 'end', subject: liveActorSlot('source') },
      n: 1,
    });
    expect(scopeForDuration({ kind: 'turn-start', actor: { kind: 'attack-target' }, turns: 1 })).toEqual({
      kind: 'for-n',
      boundary: { kind: 'boundary', boundary: 'turn', edge: 'start', subject: liveActorSlot('attack-target') },
      n: 1,
    });
    // An "end of YOUR turn" duration and an "end of TARGET's turn" duration are distinct Scopes.
    const selfEnd = scopeForDuration({ kind: 'turn-end', actor: { kind: 'self' }, turns: 1 });
    const targetEnd = scopeForDuration({ kind: 'turn-end', actor: { kind: 'attack-target' }, turns: 1 });
    expect((selfEnd as { kind: 'for-n'; boundary: BoundaryRef }).boundary)
      .not.toEqual((targetEnd as { kind: 'for-n'; boundary: BoundaryRef }).boundary);
  });

  it('routes combat cleanup through U8: only expedition scope survives', () => {
    expect(durationSurvivesCombatEnd({ kind: 'expedition' })).toBe(true);
    expect(durationSurvivesCombatEnd({ kind: 'combat' })).toBe(false);
    expect(durationSurvivesCombatEnd({ kind: 'round-end', rounds: 3 })).toBe(false);
    expect(durationSurvivesCombatEnd({ kind: 'turn-end', actor: { kind: 'self' }, turns: 2 })).toBe(false);
    expect(durationSurvivesCombatEnd({ kind: 'until', event: 'some-later-event' })).toBe(false);
    expect(durationSurvivesCombatEnd({ kind: 'instant' })).toBe(false);
  });

  it('counted rounds are relative N-forms, never absolute round 3', () => {
    expect(scopeForDuration({ kind: 'round-end', rounds: 3 })).toEqual({ kind: 'for-n', boundary: roundEnd, n: 3 });
    expect(scopeForDuration({ kind: 'round-start', rounds: 1 })).toEqual({ kind: 'for-n', boundary: roundStart, n: 1 });
  });

  it('combat/expedition are until-next extents with the correct edge', () => {
    expect(scopeForDuration({ kind: 'combat' })).toEqual({ kind: 'until-next', boundary: { kind: 'boundary', boundary: 'combat', edge: 'end' } });
    expect(scopeForDuration({ kind: 'expedition' })).toEqual({ kind: 'until-next', boundary: { kind: 'boundary', boundary: 'expedition', edge: 'end' } });
  });

  it('a named lifecycle event maps to the until-event scope', () => {
    expect(scopeForDuration({ kind: 'until', event: 'six-hells-detonate' }))
      .toEqual({ kind: 'until-event', event: 'six-hells-detonate' });
  });
});

describe('U8 SCOPE/CLOCK — replay determinism', () => {
  it('11: the same durable clock/boundary record gives the same answer', () => {
    const epoch = obs(roundStart, { [roundEndKey]: 4 });
    const now = obs(roundEnd, { [roundEndKey]: 7 });
    const scope = { kind: 'for-n' as const, boundary: roundEnd, n: 3 };
    const first = scopeSatisfied(scope, now, epoch);
    const second = scopeSatisfied(scope, now, epoch);
    expect(second).toBe(first);
    expect(boundaryReached({ kind: 'next', boundary: roundEnd }, now, epoch)).toBe(true);
    expect(boundaryReached({ kind: 'next', boundary: roundEnd }, now, epoch)).toBe(true);
  });
});
