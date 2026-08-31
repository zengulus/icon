/**
 * Shared target-eligibility primitives. The direct-target query additionally
 * receives a line-of-sight result from its encounter caller, but line of
 * effect and movement legality still require a fuller EncounterState spatial
 * gateway. These give the VM and command gates one source of truth for
 * relation, self, defeated, off-board eligibility, range, and footprint.
 *
 * TODO(ICON-rules, pp.87–92, 94, 107): extend TargetQuery from direct
 * Blind/True Strike/Stealth/LoS checks to line of effect and movement
 * destinations.
 */

import { footprintDistance } from './spatial-intent.js';
import type { RelationActor } from './roles.js';

export type TargetRelation = 'self' | 'ally' | 'foe' | 'any';

export interface TargetCandidate {
  id: string;
  side: string;
  position: { x: number; y: number } | null;
  /** Encounter actors retain their last cell after leaving the battlefield. */
  onBattlefield?: boolean;
  defeated: boolean;
  /** ICON p.92 Size — the N×N footprint range is measured against, not the
   * point cell. Absent means Size 1 (the historical point metric). */
  size?: number;
}

export interface TargetEligibility {
  /** Self selectors are explicit. `ally` means another living ally (p.92). */
  relation: TargetRelation;
  includeDefeated?: boolean;
  includeOffBattlefield?: boolean;
}

export function matchesTargetRelation(
  // The SOURCE is the actor relative to whom the relation is interpreted. It
  // MUST be a U2-produced `RelationActor` (T8d): the self/ally/foe semantic
  // decision structurally requires a perspective that flowed through the U2
  // authority, so a plain/aliased actor lookup (`state.actors[context.actorId]`)
  // cannot substitute — it is not assignable to `RelationActor`.
  source: RelationActor,
  target: Pick<TargetCandidate, 'id' | 'side'>,
  relation: TargetRelation,
): boolean {
  if (relation === 'self') return source.id === target.id;
  if (relation === 'ally') return source.id !== target.id && source.side === target.side;
  if (relation === 'foe') return source.side !== target.side;
  return true;
}

export function isEligibleTarget(
  source: RelationActor,
  target: TargetCandidate,
  options: TargetEligibility,
): boolean {
  if (!matchesTargetRelation(source, target, options.relation)) return false;
  if (!options.includeDefeated && target.defeated) return false;
  if (!options.includeOffBattlefield && (target.position === null || target.onBattlefield === false)) return false;
  return true;
}

export function eligibleTargets<T extends TargetCandidate>(
  source: RelationActor,
  candidates: readonly T[],
  options: TargetEligibility,
): T[] {
  return candidates.filter((target) => isEligibleTarget(source, target, options));
}

/**
 * The reducer-facing seed of the eventual TargetQuery gateway. It centralizes
 * the rules shared by a single directly nominated target while leaving area,
 * footprint, line-of-effect, and movement-space semantics explicitly out of
 * scope until they have a source-tested spatial model.
 */
export interface DirectTargetQuery {
  relation: TargetRelation;
  maximumRange: number | null;
  /** True Strike ignores both Blind and Stealth (ICON p.104). */
  trueStrike?: boolean;
  sourceBlind?: boolean;
  targetStealth?: boolean;
  requireLineOfSight?: boolean;
  hasLineOfSight?: boolean;
}

export type DirectTargetProblem = 'unavailable' | 'relation' | 'stealth' | 'range' | 'line-of-sight';

export interface DirectTargetResult {
  legal: boolean;
  problem: DirectTargetProblem | null;
  /** The range after Blind/True Strike policy, useful for a caller message. */
  maximumRange: number | null;
  distance: number | null;
}

/**
 * Validate a one-target direct nomination. The live command gate
 * (`src/rules/encounter.ts` `assertDirectTarget`) now routes base
 * eligibility — relation, defeated/off-battlefield exclusion, and the p.92
 * footprint range from the source — through the U3 candidate authority
 * (`kernels/candidate.ts::validateActorCandidate`); this primitive pins the
 * direct-target problem vocabulary (including the Blind/True Strike/
 * Stealth/LoS specialist reads) as the reducer-facing spec fixture and the
 * seed of the eventual TargetQuery gateway. Range uses the shared p.92
 * footprint distance ("a target must have at least 1 space of its area
 * within the listed range"), which for Size-1 actors is exactly the
 * point-cell Chebyshev metric the reducer historically used.
 */
export function queryDirectTarget(
  source: RelationActor,
  target: TargetCandidate,
  query: DirectTargetQuery,
): DirectTargetResult {
  if (target.defeated || target.position === null || target.onBattlefield === false) {
    return { legal: false, problem: 'unavailable', maximumRange: query.maximumRange, distance: null };
  }
  if (!matchesTargetRelation(source, target, query.relation)) {
    return { legal: false, problem: 'relation', maximumRange: query.maximumRange, distance: null };
  }
  if (!source.position) return { legal: false, problem: 'unavailable', maximumRange: query.maximumRange, distance: null };
  const distance = footprintDistance({ position: source.position, size: source.size }, { position: target.position, size: target.size });
  const trueStrike = query.trueStrike ?? false;
  const maximumRange = query.maximumRange === null
    ? null
    : Math.max(0, Math.floor(query.sourceBlind && !trueStrike ? Math.min(2, query.maximumRange) : query.maximumRange));
  if (query.targetStealth && !trueStrike && distance > 1) {
    return { legal: false, problem: 'stealth', maximumRange, distance };
  }
  if (maximumRange !== null && distance > maximumRange) {
    return { legal: false, problem: 'range', maximumRange, distance };
  }
  if (query.requireLineOfSight && !query.hasLineOfSight) {
    return { legal: false, problem: 'line-of-sight', maximumRange, distance };
  }
  return { legal: true, problem: null, maximumRange, distance };
}
