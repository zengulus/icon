import type { DiceSource } from '../../dice.js';

/**
 * F10 Gambled-die seam (docs/rules-foundations.md §8).
 *
 * A Gamble is a small, deterministic, recorded operation — the textual cousin
 * of the durable SaveWindow (save-window.ts). It answers three questions the
 * engine and replay both need:
 *
 *   - **what dice were rolled?** (`rolls`)
 *   - **which result was used?** (`result`, via a source-defined `pick`)
 *   - **why were extra dice rolled?** (the caller supplies `count` from its
 *     source rule — e.g. Bonus Damage "keep the higher of two", a Blessing
 *     spend for extra d6s, or a Power-die influence)
 *
 * It is deliberately NOT a second RNG subsystem and holds no hidden state:
 * every die comes from the caller's `DiceSource` (owned by the command
 * boundary), so replay never re-rolls. This primitive only *records* and
 * *picks*, mirroring how `rollBoonOrCurse` records its rolls. The simplest
 * source rule is a single d6 used directly; the common modifier is "roll N
 * dice, keep the highest".
 */
export type GamblePick = 'single' | 'highest' | 'lowest';

export interface GambleRoll {
  /** Every die rolled, in roll order. */
  rolls: number[];
  /** Which roll(s) were kept. */
  kept: number[];
  /** The chosen result used by the source rule. */
  result: number;
  pick: GamblePick;
}

/** Roll `count` d6s, record them all, and pick the used result deterministically. */
export function resolveGamble(dice: DiceSource, count: number, pick: GamblePick = 'single'): GambleRoll {
  const n = Math.max(1, Math.trunc(count));
  const rolls = Array.from({ length: n }, () => dice.die(6));
  const kept = pick === 'highest' || pick === 'lowest'
    ? [Math[pick === 'highest' ? 'max' : 'min'](...rolls)]
    : [rolls[rolls.length - 1]];
  return { rolls, kept, result: kept[0], pick };
}
