import { describe, expect, it } from 'vitest';
import {
  recipientBranchEligibility,
  resolveRecipientBranch,
  resolveRecipientBranches,
  type AreaOriginChoiceRequirement,
  type AreaRecipientBranchEligibility,
  type AreaRecipientChoiceRequirement,
  type RecordedAreaChoice,
  type RecipientBranchScope,
  type ResolvedArea,
} from '../automation/primitives/area-resolution.js';

const placement = {
  rule: 'listed-range-any-cell' as const,
  qualifyingCells: [{ x: 4, y: 4 }],
};

describe('Region / ResolvedArea compile-level contract', () => {
  it('represents Blast and Burst attacks with fixed-center attack selectors', () => {
    const blast = {
      region: { cells: [{ x: 3, y: 3 }, { x: 4, y: 3 }] },
      origin: { x: 3, y: 3 }, placement,
      attackSelector: { kind: 'fixed-space', position: { x: 3, y: 3 } },
    } satisfies ResolvedArea;
    const burst = {
      region: { cells: [{ x: 6, y: 6 }, { x: 6, y: 7 }] },
      origin: { x: 6, y: 6 }, placement,
      attackSelector: { kind: 'fixed-space', position: { x: 6, y: 6 } },
    } satisfies ResolvedArea;
    expect(blast.attackSelector).toEqual({ kind: 'fixed-space', position: blast.origin });
    expect(burst.attackSelector).toEqual({ kind: 'fixed-space', position: burst.origin });
  });

  it('represents Line and Arc attack-character candidates without embedding the U4 answer', () => {
    const line = {
      region: { cells: [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }] },
      origin: { x: 2, y: 1 }, placement,
      attackSelector: { kind: 'choose-character-in-region' },
    } satisfies ResolvedArea;
    const arc = {
      region: { cells: [{ x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }] },
      origin: { x: 1, y: 1 }, placement,
      attackSelector: { kind: 'choose-character-in-region' },
    } satisfies ResolvedArea;
    const recorded: RecordedAreaChoice = { kind: 'attack-character', actorId: 'foe-a' };
    expect(line.attackSelector.kind).toBe('choose-character-in-region');
    expect(arc.attackSelector.kind).toBe('choose-character-in-region');
    expect(recorded).toEqual({ kind: 'attack-character', actorId: 'foe-a' });
  });

  it('keeps large-target branch arbitration downstream and records the owner choice', () => {
    const eligibility: AreaRecipientBranchEligibility = {
      actorId: 'large-target', branches: ['attack', 'area'],
    };
    const requirement: AreaRecipientChoiceRequirement = {
      kind: 'choose-effect-branch', actorId: eligibility.actorId,
      chooser: { kind: 'role', role: 'owner' }, options: ['attack', 'area'],
    };
    const recorded: RecordedAreaChoice = {
      kind: 'effect-branch', actorId: eligibility.actorId, branch: 'area',
    };
    expect(new Set(eligibility.branches)).toEqual(new Set(['attack', 'area']));
    expect(requirement.chooser).toEqual({ kind: 'role', role: 'owner' });
    expect(recorded.branch).toBe('area');
  });

  it('represents large-foe own-area opt-in separately from self-origin selection', () => {
    const origin: AreaOriginChoiceRequirement = {
      kind: 'choose-self-origin', actorId: 'large-foe', chooser: { kind: 'role', role: 'source' },
      candidates: [{ x: 4, y: 4 }, { x: 5, y: 4 }, { x: 4, y: 5 }, { x: 5, y: 5 }],
    };
    const inclusion: AreaRecipientChoiceRequirement = {
      kind: 'choose-own-area-inclusion', actorId: 'large-foe', chooser: { kind: 'role', role: 'recipient' },
      options: ['included', 'excluded'],
    };
    const recordedOrigin: RecordedAreaChoice = { kind: 'self-origin', position: { x: 5, y: 4 } };
    const recordedInclusion: RecordedAreaChoice = { kind: 'own-area-inclusion', actorId: 'large-foe', included: false };
    expect(origin.candidates).toHaveLength(4);
    expect(inclusion.kind).toBe('choose-own-area-inclusion');
    expect(recordedOrigin.kind).toBe('self-origin');
    expect(recordedInclusion).toMatchObject({ kind: 'own-area-inclusion', included: false });
  });
});

describe('large-target branch arbitration seam (p.290)', () => {
  /** A fixed-center blast every scenario shares: a medium template centered
   * (3,2); the attack space is the central cell; the area-only cells are the
   * other template cells. This is a SYNTHETIC Region fixture — labeled only
   * by its real template source, never approximated. */
  const scope = (actors: RecipientBranchScope['actors']): RecipientBranchScope => ({
    areaCells: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }, { x: 2, y: 3 }, { x: 4, y: 3 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }],
    attackSpaceCells: [{ x: 3, y: 3 }],
    actors,
  });

  it('a size-1 character in the attack space is attack-branch only (no area branch, no choice)', () => {
    const rows = recipientBranchEligibility(scope([{ id: 'solo', position: { x: 3, y: 3 } }]));
    expect(rows).toEqual([{ actorId: 'solo', branches: ['attack'] }]);
    expect(resolveRecipientBranch(rows[0]!)).toBe('attack');
  });

  it('a size-1 character in the area-only cells is area-branch only', () => {
    const rows = recipientBranchEligibility(scope([{ id: 'solo', position: { x: 4, y: 3 } }]));
    expect(rows).toEqual([{ actorId: 'solo', branches: ['area'] }]);
    expect(resolveRecipientBranch(rows[0]!)).toBe('area');
  });

  it('a size-2 target straddling the attack space AND area cells carries BOTH branches — the owner must choose', () => {
    // Anchor at (2,2), size 2 → footprint (2,2),(3,2),(2,3),(3,3): the (3,3)
    // attack-space cell plus the area-only cells (2,2),(3,2),(2,3).
    const rows = recipientBranchEligibility(scope([{ id: 'large', position: { x: 2, y: 2 }, size: 2 }]));
    expect(rows).toEqual([{ actorId: 'large', branches: ['attack', 'area'] }]);
    // A recorded owner decision resolves it to ONE branch…
    expect(resolveRecipientBranch(rows[0]!, 'attack')).toBe('attack');
    expect(resolveRecipientBranch(rows[0]!, 'area')).toBe('area');
    // …and a missing decision fails closed ('unresolved'), never a default.
    expect(resolveRecipientBranch(rows[0]!)).toBe('unresolved');
  });

  it('a multi-cell area-only large target is one row, applied once', () => {
    // Size-2 anchor at (2,4) → footprint (2,4),(3,4),(2,5),(3,5): (2,4),(3,4)
    // are area cells, the rest are outside — one area row, not per-cell.
    const rows = recipientBranchEligibility(scope([{ id: 'areaonly', position: { x: 2, y: 4 }, size: 2 }]));
    expect(rows).toEqual([{ actorId: 'areaonly', branches: ['area'] }]);
    const resolved = resolveRecipientBranches(rows);
    const applied = resolved.filter((row) => row.actorId === 'areaonly');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual({ actorId: 'areaonly', branch: 'area' });
  });

  it('a both-eligible row applies exactly one branch once under a recorded owner choice', () => {
    const rows = recipientBranchEligibility(scope([{ id: 'large', position: { x: 2, y: 2 }, size: 2 }]));
    const resolved = resolveRecipientBranches(rows, { large: 'attack' });
    expect(resolved).toEqual([{ actorId: 'large', branch: 'attack' }]);
    // The same row under the area answer is still exactly one row.
    expect(resolveRecipientBranches(rows, { large: 'area' })).toEqual([{ actorId: 'large', branch: 'area' }]);
    // And a missing answer surfaces as unresolved so the caller fails closed.
    expect(resolveRecipientBranches(rows)).toEqual([{ actorId: 'large', branch: 'unresolved' }]);
  });
});
