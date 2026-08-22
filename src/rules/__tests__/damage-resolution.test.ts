import { describe, expect, it } from 'vitest';
import { applyDeterminedDamageToVitals, determineDamage } from '../automation/damage-resolution.js';

describe('shared damage resolution kernel', () => {
  it('applies flat reductions before a single shared halving', () => {
    const result = determineDamage({
      amount: 10,
      damageType: 'normal',
      delivery: 'hit',
      sourceWeakened: true,
      sourcePacified: true,
      sourceHatredDiverts: true,
      targetVulnerable: true,
      targetArmor: 3,
      targetResistance: true,
      targetCovered: true,
    });

    // (10 - 2 weakened + 1 vulnerable - 3 armor) / 2 = 3. The three
    // halving causes are provenance, not repeated ceil(/2) operations.
    expect(result).toEqual({
      initialAmount: 10,
      amount: 3,
      prevention: null,
      reductions: ['weakened', 'armor'],
      halvings: ['pacified', 'hatred', 'resistance', 'cover'],
    });
  });

  it('keeps divine damage out of mitigation while allowing immunity', () => {
    expect(determineDamage({
      amount: 8,
      damageType: 'divine',
      delivery: 'area',
      sourceWeakened: true,
      sourcePacified: true,
      targetVulnerable: true,
      targetArmor: 9,
      targetResistance: true,
      targetAetherwall: true,
      targetCovered: true,
      // Dodge is an explicit damage immunity for area/miss/save results; use
      // an ordinary target here to prove divine bypasses *mitigation*.
    })).toMatchObject({ amount: 9, prevention: null, reductions: [], halvings: [] });

    expect(determineDamage({
      amount: 8,
      damageType: 'divine',
      delivery: 'effect',
      targetDamageImmune: true,
    })).toMatchObject({ amount: 0, prevention: 'damage-immune' });
  });

  it('lets True Strike provenance bypass Dodge without weakening Dodge generally', () => {
    // ICON p.104: Dodge prevents miss/area/save-success damage, while True
    // Strike specifically ignores Dodge. This is applied before mitigation.
    expect(determineDamage({
      amount: 4,
      damageType: 'normal',
      delivery: 'miss',
      targetDodge: true,
    })).toMatchObject({ amount: 0, prevention: 'dodge' });

    expect(determineDamage({
      amount: 4,
      damageType: 'normal',
      delivery: 'miss',
      targetDodge: true,
      ignoreDodge: true,
    })).toMatchObject({ amount: 4, prevention: null });
  });

  it('uses one HP/vigor split for ordinary, bypassing, and minimum-HP damage', () => {
    expect(applyDeterminedDamageToVitals({ hp: 8, vigor: 3 }, {
      amount: 7,
      bypassVigor: false,
    })).toMatchObject({ amountApplied: 7, vigorDamage: 3, hpDamage: 4, hp: 4, vigor: 0 });

    expect(applyDeterminedDamageToVitals({ hp: 8, vigor: 3 }, {
      amount: 7,
      bypassVigor: true,
    })).toMatchObject({ amountApplied: 7, vigorDamage: 0, hpDamage: 7, hp: 1, vigor: 3 });

    expect(applyDeterminedDamageToVitals({ hp: 4, vigor: 2 }, {
      amount: 99,
      bypassVigor: false,
      minimumHp: 1,
    })).toMatchObject({ amountApplied: 5, hp: 1, vigor: 0, preventedByMinimumHp: 94 });
  });
});
