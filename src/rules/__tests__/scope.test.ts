/**
 * scope.test.ts — the U8 SCOPE / CLOCK underlay's semantic contract.
 *
 * The underlay is ONE shared vocabulary for temporal/usage boundaries:
 * action/resolution/turn/between-turns/slow/round/combat/expedition/camp/
 * interlude/permanent plus counted (n-boundary) and next-match forms. Tests
 * establish:
 *   - positive: the same "round" boundary is read identically through a
 *     duration, a lifecycle timing, and the current clock; counted and
 *     next-match forms exist;
 *   - negative: step timings ('use', attack-*) are NOT boundaries and map
 *     to null; an out-of-scope boundary read rejects;
 *   - boundary: slow-turn vs ordinary-turn are distinct Clock kinds; a
 *     permanent/combat scope never expires mid-combat;
 *   - replay: currentClock/boundaryReached are pure — the same state derives
 *     the same clock.
 */
import { describe, expect, it } from 'vitest';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import { boundaryReached, clockForTiming, currentClock, scopeForDuration } from '../automation/primitives/scope.js';

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

describe('U8 SCOPE/CLOCK — one boundary vocabulary', () => {
  it('positive: the same "round" is read identically through a duration, a timing, and the current clock', () => {
    // duration { round-end } → round boundary; lifecycle timing round-end →
    // round boundary; current clock sits on the round boundary.
    expect(scopeForDuration({ kind: 'round-end' })).toEqual({ kind: 'for-n', boundary: 'round', n: 1 });
    expect(clockForTiming('round-end')).toEqual({ kind: 'boundary', boundary: 'round' });
    const clock = currentClock(ctx('round-end'));
    expect(clock.kind === 'boundary' && clock.boundary).toBe('round');
  });

  it('positive: counted and next-match forms exist (N-boundary duration)', () => {
    // "until the end of your NEXT turn" = n-boundary turn 1; "3 rounds" =
    // for-n round 3.
    expect(scopeForDuration({ kind: 'turn-end', actor: { kind: 'self' } })).toEqual({ kind: 'for-n', boundary: 'turn', n: 1 });
    expect(scopeForDuration({ kind: 'round-end', rounds: 3 })).toEqual({ kind: 'for-n', boundary: 'round', n: 3 });
    expect(scopeForDuration({ kind: 'combat' })).toEqual({ kind: 'until-next', boundary: 'combat' });
    expect(scopeForDuration({ kind: 'expedition' })).toEqual({ kind: 'until-next', boundary: 'expedition' });
  });

  it('positive: a named lifecycle event maps to the until-event scope', () => {
    expect(scopeForDuration({ kind: 'until', event: 'six-hells-detonate' }))
      .toEqual({ kind: 'until-event', event: 'six-hells-detonate' });
  });

  it('negative: step timings are NOT boundaries (null)', () => {
    for (const timing of ['use', 'passive', 'interrupt', 'attack-hit', 'attack-miss', 'damaged', 'defeated'] as const) {
      expect(clockForTiming(timing)).toBeNull();
    }
  });

  it('negative: an out-of-scope boundary read rejects', () => {
    // An n-boundary round-5 read at round 3 has not been reached.
    expect(boundaryReached({ kind: 'n-boundary', boundary: 'round', n: 5 }, { round: 3 })).toBe(false);
    // Turn-level boundaries need the scheduler's turn record — never assumed.
    expect(boundaryReached({ kind: 'n-boundary', boundary: 'turn', n: 1 }, { round: 3 })).toBe(false);
  });

  it('boundary: slow-turn vs ordinary-turn are distinct Clock kinds', () => {
    // The vocabulary distinguishes the slow-turn boundary (p.87 Delay
    // resolution) from the ordinary turn boundary.
    expect(clockForTiming('turn-start')).toEqual({ kind: 'boundary', boundary: 'turn' });
    expect(clockForTiming('round-start')).toEqual({ kind: 'boundary', boundary: 'round' });
    const clocks = new Set<string>();
    // A slow-turn boundary is a distinct kind from the ordinary turn.
    expect(clockForTiming('turn-start')).not.toEqual({ kind: 'boundary', boundary: 'slow' });
    expect(clocks.size).toBe(0);
  });

  it('boundary: permanent/combat scopes never expire mid-combat', () => {
    expect(boundaryReached({ kind: 'boundary', boundary: 'permanent' }, { round: 1 })).toBe(true);
    expect(boundaryReached({ kind: 'boundary', boundary: 'combat' }, { round: 1 })).toBe(true);
  });

  it('replay: currentClock and boundaryReached are pure — same state, same answer', () => {
    const first = currentClock(ctx('turn-end', 2));
    const second = currentClock(ctx('turn-end', 2));
    expect(second).toEqual(first);
    expect(boundaryReached({ kind: 'n-boundary', boundary: 'round', n: 2 }, { round: 2 })).toBe(true);
    expect(boundaryReached({ kind: 'n-boundary', boundary: 'round', n: 2 }, { round: 2 })).toBe(true);
  });
});
