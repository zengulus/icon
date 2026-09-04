/**
 * query.ts — U3 QUERY / CANDIDATE typed vocabulary.
 *
 * The one deterministic eligibility contract beneath both automatic targeting
 * and player choices: `Query<T> -> CandidateSet<T>`. This module owns the
 * TYPES (the split plan's `primitives/query.ts`); the evaluation lives in the
 * kernel layer (`kernels/candidate.ts` for the base actor CandidateSet,
 * `kernels/evaluate-query.ts` for the extended actor/position/entity/terrain
 * operators). Keeping the query types here lets other primitive vocabulary
 * (U5 `RuleNumber.count-query`, U6 predicates) reference query specs without
 * primitives importing kernels.
 *
 * Domains: actors/characters, entities (objects + summons), positions,
 * terrain cells. Areas read through `insideArea` (cells from the spatial
 * gateway); persistent instances and rule sources are U10/U12-scoped and not
 * part of the T2 contract.
 *
 * Every operator is a filter over the base CandidateSet; composition is
 * conjunction unless a set operator (`ComposedActorQuery`) is used. Ordering
 * is NEVER invented here: `nearestCandidates` returns the full minimum set
 * and source-defined first/last/nth ordering must be explicit in the query
 * (only where the source defines it).
 *
 * This module holds no source IDs and imports no kernels.
 */
import type { Position } from '../../types.js';
import type { RuleActorView } from './types.js';
import type { SpatialAnchor, SpatialOrigin } from './anchor.js';
import type { TargetRelation } from './targeting.js';

// ─────────────────────────────────────────────────────────────────────────────
// Actor domain
// ─────────────────────────────────────────────────────────────────────────────

/** A candidate-legality query for actors. Every field is optional; absent
 * fields default to the most permissive value that is still source-safe. */
export interface ActorCandidateQuery {
  /** p.92 relation filter: 'self' | 'ally' | 'foe' | 'any'. Default 'any'. */
  relation?: TargetRelation;
  /** Optional maximum range (p.92 footprint distance). A RESOLVED SCALAR:
   * the caller evaluates a dynamic `RuleNumber` through the U5 VALUE
   * authority (`evaluateNumber`) at the query point. */
  range?: number;
  /** Who the range is measured from (U7 SpatialAnchor). Defaults to the
   * acting actor — a LIVE `actor` anchor with no selector. */
  rangeOrigin?: SpatialAnchor;
  /** Whether defeated actors may appear in the CandidateSet. Default false. */
  includeDefeated?: boolean;
  /** Whether off-battlefield actors may appear. Default false. */
  includeOffBattlefield?: boolean;
}

/** An actor query with the selector vocabulary's domain operators on top of
 * the base CandidateSet eligibility. */
export interface ActorQuery extends ActorCandidateQuery {
  /** Present → only actors carrying this condition (selector `condition`). */
  conditionId?: string;
  /** Present → only actors carrying this mark; absent `markId` = the source
   * unit id (selector `marked`). */
  mark?: { markId?: string };
  /** Present → only summon/companion actors of the owner/type (selector
   * `summons`). `owner` may name an explicit owning actor id, `'self'` (the
   * acting actor), or `'any'` (any recorded owner). */
  summon?: { owner: 'self' | 'any' | { actorId: string }; summonType?: string };
  /** Pre-resolved origin actor views for the adjacency/within filters. */
  origins?: readonly RuleActorView[];
  /** When `origins` is present: maximum footprint distance from ANY origin
   * (1 = adjacency). A resolved scalar, like `range`. */
  originDistance?: number;
  /** Present → only actors whose footprint intersects these area cells
   * (p.95 area inclusion; p.290 a large actor counts when any footprint
   * space is hit). The cells come from the spatial gateway
   * (`computeSpatialArea`); the query owns which ACTORS qualify, so the
   * base eligibility (defeated/off-battlefield/relation) applies here too. */
  insideArea?: { cells: readonly Position[] };
  /** Present → only actors with line of sight from the query's anchor
   * (the same frame as `range`, default the acting actor) to the candidate
   * (ICON p.92; p.95 burst inclusion). Measured with the shared
   * line-of-sight kernel. */
  lineOfSight?: boolean;
  /** Present → only actors with line of effect from the query's anchor to
   * the candidate (ICON p.109 — a distinct gate, blocked only by effects
   * that explicitly block LoE). */
  lineOfEffect?: boolean;
  /** Present → only actors whose footprint occupies this space (the
   * "occupying position" read — given a cell, who stands there). */
  occupying?: { position: Position };
  /** Present → only actors standing on a cell whose terrain union contains
   * this terrain type (the terrain predicate read). */
  onTerrain?: string;
}

/** Set composition over actor queries: combine evaluated CandidateSets by
 * identity. `union` — every id in any query (first-seen order); `intersection`
 * — ids in EVERY query; `difference` — ids in the first query not in any
 * later one. Deterministic: the result order follows the first query's
 * result order (no ordering is invented). */
export interface ComposedActorQuery {
  operator: 'union' | 'intersection' | 'difference';
  queries: readonly ActorQuery[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Position domain
// ─────────────────────────────────────────────────────────────────────────────

/** The SPACE POLICY for a position query — what makes a cell a candidate.
 * `unoccupied` is the FREE/PLACEMENT reading: no OBSTRUCTING character or
 * object footprint (ICON p.95: summons are intangible and do not cause
 * obstruction, so a cell holding only an intangible summon is free). `any`
 * represents every in-grid space regardless of contents — ICON p.92 "Space:
 * Any space in range, and any characters or objects occupying it" means
 * generic position querying must be able to represent occupied spaces too.
 * A cell being "unavailable for a particular placement" (object stacking,
 * teleport unoccupied, bomb-can't-share-with-bombs) is a SPECIALIST rule
 * layered on top by the domain authority, never this policy. */
export type PositionSpacePolicy =
  | { kind: 'any' }
  | { kind: 'unoccupied'; excludeActorId?: string };

/** Optional deterministic ordering. The default (`none`) returns candidates
 * in no guaranteed order; a caller that needs a source-defined or
 * caller-requested order (the placement resolvers' "first available by
 * distance" scan) requests it explicitly. */
export type PositionOrderingPolicy = { kind: 'none' } | { kind: 'distance-from-origin' };

/** Base U3 legality for a battlefield-cell candidate. U7 resolves the origin
 * before this query is evaluated; U3 owns only bounds and canonical p.92
 * footprint range membership. */
export interface PositionCandidateQuery {
  origin: Position;
  originSize?: number;
  candidateSize?: number;
  range: number;
}

export type PositionCandidateProblem = 'out-of-bounds' | 'range';

/** A position-domain candidate query. */
export interface PositionQuery {
  /** Optional region/predicate constraints; each composes with range. */
  insideCells?: readonly Position[];
  terrain?: string;
  separatedFrom?: { positions: readonly Position[]; minimumDistance: number };
  /** Character placement delegates full-footprint legality to F1. */
  placementActorId?: string;
  /** The origin whose footprint the radius is measured from. */
  origin: Position;
  /** The p.92 origin footprint size. Default 1 for a point-space query. */
  originSize?: number;
  /** Chebyshev radius. */
  radius: number;
  /** Whether cells in the origin footprint are candidates. Default false —
   * placement helpers exclude the origin itself. */
  includeOrigin?: boolean;
  /** The space policy (see `PositionSpacePolicy`). */
  space: PositionSpacePolicy;
  /** Optional deterministic ordering policy. Default `none`. */
  ordering?: PositionOrderingPolicy;
  /** Present → only cells with line of sight from this resolved U7 frame to the cell
   * (the p.108 "you also need line of sight" policy for summoning,
   * teleporting, and creating objects, made an explicit query policy). */
  lineOfSightFrom?: SpatialOrigin;
}

/** The free-placement legality specialist: in-grid, within footprint
 * `range` of the origin footprint, unoccupied, and — when `lineOfSightFrom`
 * is declared — with line of sight from that position (ICON p.108: \"For a
 * space to be valid for summoning, teleporting, or creating objects, unless
 * specified it must be free and unobstructed, and you also need line of
 * sight\"). Structured so the teleport kernel maps each problem onto its
 * existing violation codes instead of re-implementing the same checks. This
 * is the shared DOMAIN rule for free placement, not a teleport choice policy:
 * the in-grid → range → unoccupied → LoS order is placement's own
 * contract, while each source resolver declares whether LoS applies. */
export interface PositionLegalityQuery {
  origin: Position;
  /** The origin footprint size for the canonical p.92 metric (default 1 = a
   * point cell). A Size>1 origin measures from the edge of its footprint,
   * exactly like every other footprint-distance read. */
  originSize?: number;
  range: number;
  /** The mover whose own footprint is not an obstruction. */
  excludeActorId?: string;
  /** Present → the destination must have line of sight from this resolved
   * U7 frame (p.108). For a teleport this is the teleporter's current
   * footprint, not only its canonical position cell. */
  lineOfSightFrom?: SpatialOrigin;
}

export type PositionLegalityProblem = 'out-of-bounds' | 'range' | 'occupied' | 'line-of-sight';

// ─────────────────────────────────────────────────────────────────────────────
// Entity domain
// ─────────────────────────────────────────────────────────────────────────────

/** An entity-domain candidate query (objects + summons on the battlefield).
 * Ownership is the only relation entities have — \"owned/controlled by\"
 * (p.95 summons belong to their summoner; objects have owners) — so the
 * owner filter is this domain's relation read. */
export interface EntityQuery {
  /** Owner filter. `'self'` = owned by the acting actor; `{ actorId }` = an
   * explicit owner; `'any'` = any recorded owner (p.95: objects may have a
   * null owner). */
  owner?: { kind: 'self' } | { kind: 'any' } | { kind: 'id'; actorId: string };
  /** Present → only entities of this type. */
  entityType?: string;
  /** Present → only entities within footprint range of the anchor (the U7
   * frame — an entity is a size-1 cell, p.92). */
  rangeOrigin?: SpatialAnchor;
  /** The maximum footprint distance from `rangeOrigin` (a resolved scalar). */
  range?: number;
  /** Present → only entities whose footprint includes this position (the
   * entity-domain "occupying position" read). */
  atPosition?: Position;
}

// ─────────────────────────────────────────────────────────────────────────────
// Terrain domain
// ─────────────────────────────────────────────────────────────────────────────

/** A terrain-cell query: every in-grid cell within Chebyshev `radius` of
 * `origin` whose terrain union contains `terrain` (the terrain predicate
 * read — Rampart-adjacent clauses, p.104; movement gates, p.129). Ordering
 * is `none` by default; a caller may request the deterministic
 * distance-from-origin order explicitly. */
export interface TerrainQuery {
  origin: Position;
  /** Chebyshev radius. */
  radius: number;
  /** The terrain type the cell's union must contain. */
  terrain: string;
  /** Optional deterministic ordering policy. Default `none`. */
  ordering?: PositionOrderingPolicy;
}

// ─────────────────────────────────────────────────────────────────────────────
// Value-domain dispatch (U5 count(query) / U6 count-query comparisons)
// ─────────────────────────────────────────────────────────────────────────────

/** A domain-dispatched query spec for `RuleNumber.count-query` (U5) and the
 * count comparisons composed on top of it (U6). Each member carries the
 * RESOLVED query shape for its domain; the kernel evaluator
 * (`kernels/evaluate-query.ts` `evaluateValueQuery`) owns the dispatch. */
export type ValueQuery =
  | { domain: 'actors'; query: ActorQuery }
  | { domain: 'entities'; query: EntityQuery }
  | { domain: 'positions'; query: PositionQuery }
  | { domain: 'terrain-cells'; query: TerrainQuery };
