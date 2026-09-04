import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { resolveAttackRoll } from '../automation/primitives/attack-resolution.js';
import { scriptedDice } from './fixtures.js';

describe('attack-resolution kernel', () => {
  it('combines source boons, elevation, and Dazed into one capped boon roll', () => {
    const result = resolveAttackRoll({
      defense: 15,
      sourceBoon: 1,
      elevationModifier: 1,
      sourceDazed: true,
    }, scriptedDice(12, 5));

    // +1 boon + high ground - Dazed's +1 curse = one boon; the d20 and d6
    // are both recorded by the shared kernel instead of path-specific code.
    // ICON p.89: the higher attacker also ignores the lower target's cover.
    expect(result).toMatchObject({ d20: 12, boon: 5, total: 17, hit: true, critical: false, netBoon: 1, ignoreCover: true, ignoreDodge: false });
  });

  it('resolves Evasion before consuming an attack d20', () => {
    const result = resolveAttackRoll({ defense: 1, targetEvasion: true }, scriptedDice(4));

    expect(result).toEqual({
      d20: null,
      boon: 0,
      total: null,
      hit: false,
      critical: false,
      evasionRoll: 4,
      trueStrike: false,
      autoHit: false,
      exceedThreshold: null,
      ignoreDodge: false,
      ignoreCover: false,
      ignoreAetherwall: false,
      netBoon: 0,
      bonusFlat: 0,
      bonusDice: 0,
    });
  });

  it('lets True Strike bypass Evasion but retains Dazed’s separate curse', () => {
    const result = resolveAttackRoll({
      defense: 14,
      sourceBoon: 1,
      sourceDazed: true,
      targetEvasion: true,
      trueStrike: true,
    }, scriptedDice(14));

    // ICON p.104: True Strike keeps Dazed's curse but carries an explicit
    // direct-damage exception for Dodge downstream.
    expect(result).toMatchObject({
      evasionRoll: null,
      d20: 14,
      boon: 0,
      total: 14,
      hit: true,
      trueStrike: true,
      ignoreDodge: true,
      ignoreCover: false,
      netBoon: 0,
    });
  });
});
