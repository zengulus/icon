/**
 * Typed contract for the future area domain authority. This file deliberately
 * contains vocabulary only: geometry validation, U3 candidate evaluation,
 * U4 capture, and effect execution remain unimplemented until their owning
 * tranches land.
 */
import type { Position } from '../../types.js';
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
