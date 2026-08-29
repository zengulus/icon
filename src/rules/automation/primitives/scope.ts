/**
 * scope.ts — U8 SCOPE / CLOCK vocabulary: ONE shared vocabulary for
 * temporal/usage boundaries.
 *
 * ICON durations ride turns/rounds/combat (p.94 statuses, p.95 terrain/
 * entity effects, p.107 end-of-combat cleanup); usage gates are
 * once-per-turn/round/combat (p.99, p.105 Vigilance, p.129 Special); Delay
 * resolves at the start of the slow turn (p.87); camp/expedition reset
 * boundaries exist (p.56, p.113). Before this module every reader re-keyed
 * "round" separately: `RuleDuration`, `ledger:round:*`, lifecycle phases,
 * and `RuleTiming` each carried their own notion. This module defines the
 * ONE Clock concept and a typed Scope over it.
 *
 * The `RuleDuration` union in `primitives/types.ts` is the legacy surface;
 * T1 adds this Clock vocabulary and the boundary-read mapping WITHOUT
 * rewriting the union (behavior-preserving). The full migration of
 * `RuleDuration`/`use-ledger`/lifecycle readers onto the Clock is the U8
 * completion work, not T1.
 *
 * Foundation: no source IDs, no kernel imports.
 */
import type { RuleDuration, RuleExecutionContext, RuleTiming } from './types.js';

/** The boundary kinds the Clock can name. */
export type ClockBoundary =
  | 'action'
  | 'resolution'
  | 'turn'
  | 'between-turns'
  | 'slow'
  | 'round'
  | 'combat'
  | 'expedition'
  | 'camp'
  | 'interlude'
  | 'permanent';

/** The recurring boundaries that support counted / next-match forms. */
export type RecurringBoundary = 'turn' | 'round' | 'combat' | 'expedition' | 'camp' | 'interlude';

/** One point on the shared Clock. */
export type Clock =
  /** A plain boundary (current or target). */
  | { kind: 'boundary'; boundary: ClockBoundary }
  /** N occurrences of a boundary ("at the end of your NEXT turn" = 1). */
  | { kind: 'n-boundary'; boundary: RecurringBoundary; n: number }
  /** The next matching boundary after the current one. */
  | { kind: 'next-match'; boundary: RecurringBoundary }
  /** A source-defined lifecycle event ("until the Six Hell's Trigram
   * detonates"). */
  | { kind: 'event'; event: string };

/** A temporal/usage extent over the Clock. */
export type Scope =
  | { kind: 'until'; clock: Clock }
  /** Exactly N occurrences of a recurring boundary. */
  | { kind: 'for-n'; boundary: RecurringBoundary; n: number }
  /** Until the next matching boundary. */
  | { kind: 'until-next'; boundary: RecurringBoundary }
  /** Permanent (never expires). */
  | { kind: 'permanent' }
  /** Until a named lifecycle event. */
  | { kind: 'until-event'; event: string };

/** The Clock boundary a RuleTiming names, if any. Step timings ('use',
 * 'passive', 'interrupt', attack-* , …) are NOT boundaries — they name a
 * moment inside a resolution — so they map to null. */
export function clockForTiming(timing: RuleTiming): Clock | null {
  switch (timing) {
    case 'round-start':
    case 'round-end':
      return { kind: 'boundary', boundary: 'round' };
    case 'turn-start':
    case 'turn-end':
    case 'stance-refresh':
      return { kind: 'boundary', boundary: 'turn' };
    case 'combat-start':
    case 'combat-end':
      return { kind: 'boundary', boundary: 'combat' };
    case 'expedition-start':
      return { kind: 'boundary', boundary: 'expedition' };
    case 'camp':
      return { kind: 'boundary', boundary: 'camp' };
    case 'interlude':
      return { kind: 'boundary', boundary: 'interlude' };
    case 'phase-change':
      return { kind: 'boundary', boundary: 'between-turns' };
    default:
      return null;
  }
}

/** Map a legacy RuleDuration onto the Clock vocabulary. Behavior-neutral in
 * T1: nothing consumes this mapping yet; it is the prescribed boundary-read
 * surface for the future U8 migration. */
export function scopeForDuration(duration: RuleDuration): Scope {
  switch (duration.kind) {
    case 'instant':
      return { kind: 'until', clock: { kind: 'boundary', boundary: 'action' } };
    case 'turn-end':
    case 'turn-start':
      return { kind: 'for-n', boundary: 'turn', n: duration.turns ?? 1 };
    case 'round-end':
    case 'round-start':
      return { kind: 'for-n', boundary: 'round', n: duration.rounds ?? 1 };
    case 'combat':
      return { kind: 'until-next', boundary: 'combat' };
    case 'expedition':
      return { kind: 'until-next', boundary: 'expedition' };
    case 'until':
      return { kind: 'until-event', event: duration.event };
  }
}

/** The Clock point the context currently sits on. Derived deterministically
 * from the durable round counter plus the resolution timing. */
export function currentClock(context: RuleExecutionContext): Clock {
  const timingClock = clockForTiming(context.timing);
  return timingClock ?? { kind: 'boundary', boundary: 'round' };
}

/** Whether the current state has reached `clock`. Pure: reads the durable
 * round counter only (boundary advancement is a recorded transition; replay
 * never re-decides whether a boundary was crossed). Turn-level boundaries
 * need the scheduler's turn record and return false here — the scheduler
 * keeps its own turn authority (U8 completion reads it through this API). */
export function boundaryReached(clock: Clock, state: { round: number }): boolean {
  switch (clock.kind) {
    case 'boundary':
      return clock.boundary === 'permanent' || clock.boundary === 'round' || clock.boundary === 'combat';
    case 'n-boundary': {
      if (clock.boundary === 'round') return state.round >= clock.n;
      return false;
    }
    case 'next-match':
      return clock.boundary === 'round' || clock.boundary === 'combat';
    case 'event':
      return false;
  }
}
