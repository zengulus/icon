/**
 * Area recipient authority: the typed contract plus the U3 branch-eligibility
 * and U4 branch-resolution seam for AoE attacks (ICON p.97 AoE attacks, p.290
 * large characters). Geometry validation and effect execution stay in their
 * owning authorities; this file owns ONLY the per-recipient branch fold.
 */
import type { Position } from '../../types.js';
import { footprintIntersectsCells } from './spatial-intent.js';
import type { RoleSelector } from './roles.js';

/** Canonical, distinct, in-grid cells. The future geometry authority is the
 * only producer allowed to claim this postcondition. */
export interface Region {
  cells: readonly Position[];
}

/** Source placement rule and the cells that made the resolved placement
 * legal. AoE placement is never reduced to center distance. */
export interface AreaPlacementFacts {
  rule: 'listed-range-any-cell' | 'unlisted-adjacent-any-cell';
  qualifyingCells: readonly Position[];
}

/**
 * How U3 obtains attack-space recipient candidates after geometry resolves.
 * Line/Arc query characters intersecting the whole region; Blast/Burst query
 * the fixed center. A later U4 operation records any character selection —
 * the choice itself is not stored inside ResolvedArea.
 */
export type AttackSelector =
  | { kind: 'none' }
  | { kind: 'fixed-space'; position: Position }
  | { kind: 'choose-character-in-region' };

/** Geometry plus the semantic origin and placement proof needed by cover,
 * LoS, and attack-space candidate evaluation. Recipient relation/exclusion
 * policy is intentionally absent: Region answers WHERE; U3/effects answer WHO. */
export interface ResolvedArea {
  region: Region;
  origin: Position;
  placement: AreaPlacementFacts;
  attackSelector: AttackSelector;
}

/** U3-derived, identity-deduplicated effect branches for one recipient. A
 * large actor intersecting several cells still has one row. */
export interface AreaRecipientBranchEligibility {
  actorId: string;
  branches: readonly ('attack' | 'area')[];
}

/** U4 requirements emitted downstream from recipient eligibility. They are
 * not geometry and their recorded answers must be replayed, never re-asked. */
export type AreaRecipientChoiceRequirement =
  | {
    kind: 'choose-effect-branch';
    actorId: string;
    chooser: RoleSelector;
    options: readonly ['attack', 'area'];
  }
  | {
    kind: 'choose-own-area-inclusion';
    actorId: string;
    chooser: RoleSelector;
    options: readonly ['included', 'excluded'];
  };

/** U3 footprint-origin candidates offered to U4 for a large foe's self-origin
 * area. This selection happens before area geometry resolves. */
export interface AreaOriginChoiceRequirement {
  kind: 'choose-self-origin';
  actorId: string;
  chooser: RoleSelector;
  candidates: readonly Position[];
}

/** Durable U4 answers consumed by later execution/replay. */
export type RecordedAreaChoice =
  | { kind: 'attack-character'; actorId: string }
  | { kind: 'self-origin'; position: Position }
  | { kind: 'effect-branch'; actorId: string; branch: 'attack' | 'area' }
  | { kind: 'own-area-inclusion'; actorId: string; included: boolean };

// ── U3 branch eligibility (ICON p.97 AoE attacks, p.290 large characters) ──

/** The resolved attack-space cells and the area-effect-only cells of one AoE
 * attack. For Blast/Burst the attack space is the fixed central space; for
 * Line/Arc attacks it is the chosen attack character's spaces (the attack
 * selector decides). The area branch covers ONLY the non-attack cells — "For
 * a character in the attack space, make an attack … INSTEAD of the area
 * effect" (p.97). */
export interface RecipientBranchScope {
  /** The area-effect territory: region cells minus the attack-space cells. */
  areaCells: readonly Position[];
  /** The attack-space cells (the fixed center, or the chosen character). */
  attackSpaceCells: readonly Position[];
  /** Living on-battlefield actors with positions; size≥1 footprints. */
  actors: ReadonlyArray<{ id: string; position: Position; size?: number }>;
}

/** U3 identity-deduplicated branch rows for EVERY affected recipient: a large
 * (Size 2+) character whose footprint straddles the attack space and the
 * area-only cells carries BOTH branches — one row per actor, never per cell. */
export function recipientBranchEligibility(scope: RecipientBranchScope): AreaRecipientBranchEligibility[] {
  const rows: AreaRecipientBranchEligibility[] = [];
  for (const actor of scope.actors) {
    if (!actor.position) continue;
    const footprint = { position: actor.position, size: Math.max(1, actor.size ?? 1) };
    const inAttack = footprintIntersectsCells(footprint, scope.attackSpaceCells);
    const inArea = footprintIntersectsCells(footprint, scope.areaCells);
    const branches: ('attack' | 'area')[] = [];
    if (inAttack) branches.push('attack');
    if (inArea) branches.push('area');
    if (branches.length > 0) rows.push({ actorId: actor.id, branches });
  }
  return rows;
}

// ── U4 branch resolution (recorded owner choice, never an invented default) ─

/** The final branch for one recipient after applying the recorded U4 answer:
 * a single-eligibility recipient resolves to its only branch without any
 * choice; a both-eligible (large, straddling) recipient REQUIRES the recorded
 * owner decision — an absent decision returns 'unresolved' (the caller must
 * fail closed) and is never auto-resolved. */
export function resolveRecipientBranch(
  eligibility: AreaRecipientBranchEligibility,
  recordedBranch?: 'attack' | 'area',
): 'attack' | 'area' | 'unresolved' {
  if (eligibility.branches.length === 1) return eligibility.branches[0];
  if (recordedBranch === undefined) return 'unresolved';
  return recordedBranch === 'attack' || recordedBranch === 'area' ? recordedBranch : 'unresolved';
}

/** Resolve every affected recipient to exactly ONE branch, pairing each with
 * its recorded answer (or the 'unresolved' marker when the required U4 answer
 * is missing). The caller applies each row's branch exactly once — a
 * multi-cell large character is never damaged twice. */
export function resolveRecipientBranches(
  eligibilityRows: readonly AreaRecipientBranchEligibility[],
  recordedBranches: Readonly<Record<string, 'attack' | 'area'>> = {},
): Array<{ actorId: string; branch: 'attack' | 'area' | 'unresolved' }> {
  return eligibilityRows.map((row) => ({
    actorId: row.actorId,
    branch: resolveRecipientBranch(row, recordedBranches[row.actorId]),
  }));
}
