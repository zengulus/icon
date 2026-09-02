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
 * `resolveSpatialAnchor`).
 *
 * LIVE vs CAPTURED: an `actor` anchor is LIVE — it re-resolves against
 * current state whenever it is used ("at the start of its next turn, damage
 * adjacent characters" measures from the character's then-current position).
 * A `captured-position` anchor is a CAPTURED value — the position was
 * determined at an earlier point ("at end of turn, explode at the chosen
 * space", "return relative to your original location") and must never be
 * re-derived from later state.
 *
 * IDENTITY MODEL (U1 INTEGRATION): the LIVE actor anchor's identity is the
 * typed U1 `Reference<'actor'>` — `liveActorSlot('source'|'attack-target'|
 * 'trigger-source')`, `liveActorBound(name)`, the recorded-selection
 * collection, etc. — NOT a reference-style `RuleSelector`. The anchor plays
 * no role/eligibility/selection role: it names ONE actor to measure from, and
 * only the U1 authority interprets the identity. The former
 * `{ kind: 'actor'; selector?: RuleSelector }` scaffolding (which delegated
 * the identity to a resolution-time selector adapter) is removed: identity is
 * decided at CONSTRUCTION through `actorReferenceForSelector` (the U1
 * selector→reference mapping — LIVE slots, bound names, and recorded input
 * selections), so a query-shaped selector (`all`, `within`, `adjacent`, …)
 * CANNOT become an anchor (fail closed at construction: the constructor
 * returns null — the null surface is the primitive's fail-closed contract,
 * the kernel raises the violation). Because the identity is a reference, the
 * anchor also preserves CAPTURED semantics naturally: recorded-input
 * selections are captured at construction as `captured-actor` identities, and
 * the reference resolves against recorded input exactly once.
 *
 * This module holds no source IDs and imports no kernels.
 */
import type { Position } from '../../types.js';
import type { Reference } from './reference.js';
import { actorReferenceForSelector } from './reference.js';
import { liveActorSlot } from './reference.js';
import type { RuleEntityView, RuleExecutionContext, RuleSelector } from './types.js';

/** A resolved spatial origin: a battlefield position plus the footprint size
 * used by the canonical p.92 distance metric. */
export interface SpatialOrigin {
  position: Position;
  size: number;
}

export type SpatialAnchor =
  /** A LIVE actor footprint, named by the typed U1 reference identity — an
   * already-resolved identity the U1 authority interprets (source /
   * attack-target / trigger-source LIVE slots, a bound name, or a recorded
   * input selection captured as captured-actor identities). Only
   * single-origin references may anchor a measurement; a query-shaped
   * selector can never be constructed (see above). */
  | { kind: 'actor'; ref: Reference<'actor'> }
  /** A LIVE entity/object/summon footprint, named by its entity id (p.92
   * "from the edge of the origin space (or character)" — an entity's
   * footprint is a valid origin for range/LoS/area measurements, e.g. a
   * summon-placement or entity-centered query). Entities are size-1 cells. */
  | { kind: 'entity'; entityId: string }
  /** A CAPTURED battlefield position (a chosen or bound space from an
   * earlier operation). Size defaults to 1 (a point cell). */
  | { kind: 'captured-position'; position: Position; size?: number };

/** Pure constructor: a typed-reference LIVE actor anchor. The identity is a
 * U1 `Reference<'actor'>` (LIVE slot, bound name, or recorded-selection
 * collection); resolution composes the ONE `resolveReference` authority. */
export function anchorFromActorRef(ref: Reference<'actor'>): SpatialAnchor {
  return { kind: 'actor', ref };
}

/** The default LIVE actor anchor: the acting actor (source slot). */
export function defaultActorAnchor(): SpatialAnchor {
  return anchorFromActorRef(liveActorSlot('source'));
}

/** Map a reference-shaped `RuleSelector` onto the typed U1 reference
 * identity. `undefined` (and `self`) = the acting actor. Returns null for
 * query-shaped selectors OR an input-keyed selector without a context to
 * capture the recorded selection from — the primitive's fail-closed surface
 * (the kernel raises `selector.origin-invalid` when a caller ignores null).
 * This is the SINGLE selector→reference mapping for anchors, composed through
 * the U1 `actorReferenceForSelector` adapter — never a second identity
 * interpretation. */
export function anchorFromActorSelector(
  selector: RuleSelector | undefined,
  context?: RuleExecutionContext,
): SpatialAnchor | null {
  if (selector !== undefined && selector.kind === 'input' && context === undefined) {
    // An input-keyed anchor MUST capture the recorded selection at
    // construction; without a context there is no recorded identity to
    // capture — fail closed instead of guessing.
    return null;
  }
  // After the guard: input selectors always carry a context, and non-input
  // selectors never consult it — so the context is safe here even when
  // technically undefined.
  const ref = actorReferenceForSelector(selector, context!);
  return ref === null ? null : anchorFromActorRef(ref);
}

/** Pure constructor: a captured position anchor (e.g. a chosen teleport
 * destination, a bound landing space, an original location to return to). */
export function anchorFromPosition(position: Position, size = 1): SpatialAnchor {
  return { kind: 'captured-position', position: { ...position }, size };
}

/** Pure constructor: a live entity footprint anchor. */
export function anchorFromEntity(entityId: string): SpatialAnchor {
  return { kind: 'entity', entityId };
}

/**
 * The explicit singular U7 anchor of an entity whose complete geometry is a
 * region. Existing entity-centered rules use the first recorded cell as the
 * anchor; callers that ask occupancy/intersection questions must consume the
 * complete `positions` region instead.
 */
export function entityAnchorPosition(entity: Pick<RuleEntityView, 'positions'>): Position | null {
  const anchor = entity.positions[0];
  return anchor ? { ...anchor } : null;
}
