import { describe, expect, it } from 'vitest';
import { abilityPointAllowance, awardXp, chapterForLevel, createCharacter, jobSlotsForLevel, masteryPointAllowance, migrateCharacter, narrativeBudgets, relicSlotsForLevel, spendLevelUp, validateCharacter } from '../character.js';
import { JOBS } from '../catalog.js';
import { validCharacter } from './fixtures.js';

describe('ICON character creation', () => {
  it('accepts a complete level 0 character', () => {
    expect(validateCharacter(validCharacter())).toEqual([]);
  });

  it('reports the actionable requirements of an empty character', () => {
    const issues = validateCharacter(createCharacter());
    expect(issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'required',
      'action.total',
      'bond.power-count',
      'ability.starting-count',
    ]));
  });

  it('enforces six starting action dots and the single rating-four limit', () => {
    const character = validCharacter();
    character.actions.traverse = 4;
    character.actions.study = 4;
    expect(validateCharacter(character).map(({ code }) => code)).toContain('action.four-limit');
  });

  it('banks XP at 15 and respects campaign chapter caps', () => {
    const awarded = awardXp(validCharacter(), 17);
    expect(awarded.xp).toBe(0);
    expect(awarded.pendingLevelUps).toBe(1);
    expect(awarded.xpAbilityPointClaimed).toBe(true);
    const advanced = spendLevelUp(awarded, 1);
    expect(advanced.level).toBe(1);
    expect(advanced.pendingLevelUps).toBe(0);
    expect(advanced.xpAbilityPointClaimed).toBe(false);
    expect(chapterForLevel(advanced.level)).toBe(1);
  });

  it('uses the sourcebook chapter boundaries at levels 5 and 9', () => {
    expect([0, 1, 4, 5, 8, 9, 12].map(chapterForLevel)).toEqual([1, 1, 1, 2, 2, 3, 3]);
  });

  it('matches the sourcebook advancement table', () => {
    const character = validCharacter();
    const totalAp = [2, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 17, 18];
    expect(totalAp.map((_, level) => abilityPointAllowance({ ...character, level, xpAbilityPointClaimed: false }))).toEqual(totalAp);
    expect([0, 4, 8, 12].map(jobSlotsForLevel)).toEqual([1, 2, 3, 3]);
    expect([0, 2, 6, 9, 12].map(relicSlotsForLevel)).toEqual([0, 1, 2, 3, 3]);
    expect([0, 3, 7, 10, 12].map((level) => masteryPointAllowance({ ...character, level, jobs: JOBS.slice(0, jobSlotsForLevel(level)).map(({ id }) => id) }))).toEqual([0, 1, 2, 3, 4]);
    expect(narrativeBudgets(12)).toEqual({ fixedPowers: 7, fixedActionDots: 12, flexibleChoices: 2 });
  });

  it('rejects unknown import schema versions', () => {
    expect(() => migrateCharacter({ schemaVersion: 99 })).toThrow(/Unsupported character schema/);
  });

  it('rejects abilities above the character chapter and unlearned loadout entries', () => {
    const character = validCharacter();
    character.abilities[0].abilityId = JOBS[0].abilities.find(({ chapter }) => chapter === 2)!.id;
    character.equippedAbilityIds = [character.abilities[0].abilityId, 'bastion:heracule'];
    expect(validateCharacter(character).map(({ code }) => code)).toContain('ability.chapter');
    character.equippedAbilityIds.push('bastion:battering-ram');
    expect(validateCharacter(character).map(({ code }) => code)).toContain('ability.not-learned');
  });
});
