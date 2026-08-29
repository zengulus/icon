/**
 * anchor.ts — U7 ANCHOR vocabulary: the typed spatial frame every spatial
 * relationship is measured from.
 *
 * ICON distinguishes the frame a rule is measured FROM from the actor a rule
 * applies TO (ROLE ≠ ANCHOR): "range is measured from the edge of the origin
 * space (or character)" (p.92), burst centers (p.95), aura bearers, teleport
 * origins (p.88), entity-creation LoS origins (p.95/p.107/p.108), and rebound
 * origins all name a frame. Before this module the frame was implicit
 * (`context.actorId` doubling as source, target, and anchor) or re-invented
 * per specialist (`RuleArea.origin`, entity `creationSpatial`, teleport
 * origins). This module owns the typed vocabulary; resolution against live
 * state lives in the kernel layer (`kernels/candidate.ts`
 * `resolveSpatialAnchor`), because naming an actor anchor requires the
 * runtime selector machinery.
 *
 * LIVE vs CAPTURED: an `actor` anchor is LIVE — it re-resolves against
 * current state whenever it is used ("at the start of its next turn, damage
 * adjacent characters" measures from the character's then-current position).
 * A `captured-position` anchor is a CAPTURED value — the position was
 * determined at an earlier point ("at end of turn, explode at the chosen
 * space", "return relative to your original location") and must never be
 * re-derived from later state.
 *
 * This module holds no source IDs and imports no kernels.
 */
import type { Position } from '../../types.js';
import type { RuleSelector } from './types.js';

/** A resolved spatial origin: a battlefield position plus the footprint size
 * used by the canonical p.92 distance metric. */
export interface SpatialOrigin {
  position: Position;
  size: number;
}

export type SpatialAnchor =
  /** A LIVE actor footprint, named by a reference-style RuleSelector
   * (`self` / `attack-target` / `trigger-source` / `trigger-targets` /
   * `input`). Absent selector = the acting actor. Only single-referent
   * selectors may anchor a measurement; query selectors (`all`, `within`,
   * `adjacent`, …) cannot name one origin and are rejected at resolution. */
  | { kind: 'actor'; selector?: RuleSelector }
  /** A CAPTURED battlefield position (a chosen or bound space from an
   * earlier operation). Size defaults to 1 (a point cell). */
  | { kind: 'captured-position'; position: Position; size?: number };

/** Pure constructor: a captured position anchor (e.g. a chosen teleport
 * destination, a bound landing space, an original location to return to). */
export function anchorFromPosition(position: Position, size = 1): SpatialAnchor {
  return { kind: 'captured-position', position: { ...position }, size };
}

/** Pure constructor: a live actor anchor. Absent selector = acting actor. */
export function anchorFromActorSelector(selector?: RuleSelector): SpatialAnchor {
  return { kind: 'actor', selector };
}
