import { describe, expect, it } from 'vitest';
import type {
  AreaOriginChoiceRequirement,
  AreaRecipientBranchEligibility,
  AreaRecipientChoiceRequirement,
  RecordedAreaChoice,
  ResolvedArea,
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
