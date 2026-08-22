import { describe, expect, it } from 'vitest';
import { abilityPointAllowance, aspectRelicFromSharedQuest, awardXp, chapterForLevel, completeRelicAspectQuest, createCharacter, infuseRelicDust, jobSlotsForLevel, masteryPointAllowance, migrateCharacter, narrativeBudgets, REFOCUS_DUST_COST, REFOCUS_KEEP_JOBS_DUST_COST, refocusCharacter, refocusDustCost, relicMinimumInfusedDust, relicRankForDust, relicSlotsForLevel, resolveRelicAspect, spendLevelUp, validateCharacter } from '../character.js';
import { JOBS, RELICS } from '../catalog.js';
import { validCharacter } from './fixtures.js';

/** A level 1 character that can legally spend its level-0 abilities and AP. */
function refocusableCharacter(): ReturnType<typeof validCharacter> {
  const character = validCharacter();
  character.level = 1;
  character.dust = 8;
  return character;
}

function relicCharacter(): ReturnType<typeof validCharacter> {
  const character = validCharacter();
  character.level = 12;
  character.dust = 8;
  character.relics = [{ relicId: RELICS[0].id, rank: 1, aspectState: 'none', dustInfused: 0 }];
  return character;
}

function pushDust(character: ReturnType<typeof validCharacter>, amount: number) {
  character.dust = amount;
  return character;
}

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

  it('rejects identity values outside the source-derived Kin and Culture catalogs', () => {
    const character = validCharacter();
    character.kin = 'NOT-A-KIN';
    character.culture = 'NOT-A-CULTURE';
    expect(validateCharacter(character).map(({ code }) => code)).toEqual(expect.arrayContaining(['kin.unknown', 'culture.unknown']));
  });

  it('tracks the source-required relic advancement path rather than accepting a free Aspect', () => {
    const character = validCharacter();
    character.level = 12;
    character.relics = [{ relicId: RELICS[0].id, rank: 4, aspectState: 'none', dustInfused: 0 }];
    expect(validateCharacter(character).map(({ code }) => code)).toEqual(expect.arrayContaining(['relic.aspect-required', 'relic.infusion-required']));

    character.relics = [{ relicId: RELICS[0].id, rank: 4, aspectState: 'dust', dustInfused: relicMinimumInfusedDust(4, 'dust') }];
    expect(validateCharacter(character).map(({ code }) => code)).not.toContain('relic.infusion-required');
    expect(relicMinimumInfusedDust(2)).toBe(6);
    expect(relicMinimumInfusedDust(3)).toBe(12);
    expect(relicMinimumInfusedDust(4, 'shared-quest')).toBe(16);
  });

  it('migrates historical Aspected relics without silently inventing their advancement path', () => {
    const legacy = validCharacter() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 2;
    legacy.level = 12;
    legacy.relics = [{ relicId: RELICS[0].id, rank: 4, dustInfused: 12 }];

    const migrated = migrateCharacter(legacy);
    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.relics).toEqual([{ relicId: RELICS[0].id, rank: 4, dustInfused: 12, aspectState: 'unresolved' }]);
    expect(validateCharacter(migrated).map(({ code }) => code)).toContain('relic.aspect-unresolved');
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

describe('ICON Refocus (p.113)', () => {
  it('refunds abilities, talents, and masteries while keeping narrative state', () => {
    const character = refocusableCharacter();
    character.abilities = [
      { abilityId: character.abilities[0].abilityId, talent: 1, mastered: true },
      { abilityId: character.abilities[1].abilityId, talent: null, mastered: false },
    ];
    const refocused = refocusCharacter(character, {
      jobs: [...character.jobs],
      primaryJobId: character.primaryJobId,
      abilities: [],
      equippedAbilityIds: [],
    });
    expect(refocused.abilities).toEqual([]);
    expect(refocused.equippedAbilityIds).toEqual([]);
    expect(refocused.jobs).toEqual(character.jobs);
    expect(refocused.bondId).toBe(character.bondId);
    expect(refocused.actions).toEqual(character.actions);
    expect(refocused.level).toBe(character.level);
    expect(refocused.dust).toBe(character.dust - REFOCUS_KEEP_JOBS_DUST_COST);
    expect(validateCharacter(refocused).filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('charges 8 dust when Jobs change and 4 dust when they stay', () => {
    const character = refocusableCharacter();
    expect(refocusDustCost(character, [...character.jobs])).toBe(REFOCUS_KEEP_JOBS_DUST_COST);
    const otherJob = JOBS.find(({ id }) => !character.jobs.includes(id))!;
    expect(refocusDustCost(character, [otherJob.id])).toBe(REFOCUS_DUST_COST);
    const reordered = refocusCharacter(character, {
      jobs: [...character.jobs],
      primaryJobId: character.primaryJobId,
      abilities: [],
      equippedAbilityIds: [],
    });
    expect(reordered.dust).toBe(4);
    const changed = refocusCharacter(pushDust({ ...character }, 8), {
      jobs: [otherJob.id],
      primaryJobId: otherJob.id,
      abilities: [],
      equippedAbilityIds: [],
    });
    expect(changed.dust).toBe(0);
    expect(changed.jobs).toEqual([otherJob.id]);
  });

  it('rejects level 0 characters, insufficient dust, and a different Job count', () => {
    const levelZero = validCharacter();
    expect(() => refocusCharacter(levelZero, { jobs: [], primaryJobId: null, abilities: [], equippedAbilityIds: [] })).toThrow(/level 1 or higher/);
    const broke = pushDust(refocusableCharacter(), 2);
    expect(() => refocusCharacter(broke, { jobs: [...broke.jobs], primaryJobId: broke.primaryJobId, abilities: [], equippedAbilityIds: [] })).toThrow(/costs 4 dust/);
    const character = refocusableCharacter();
    expect(() => refocusCharacter(character, { jobs: [], primaryJobId: null, abilities: [], equippedAbilityIds: [] })).toThrow(/same number of Jobs/);
  });

  it('re-picks a legal build and rejects an illegal one', () => {
    const character = refocusableCharacter();
    const otherJob = JOBS.find(({ id }) => !character.jobs.includes(id))!;
    const repicked = refocusCharacter(pushDust({ ...character }, 8), {
      jobs: [otherJob.id],
      primaryJobId: otherJob.id,
      abilities: [{ abilityId: otherJob.abilities[0].id, talent: null, mastered: false }],
      equippedAbilityIds: [otherJob.abilities[0].id],
    });
    expect(repicked.dust).toBe(0);
    expect(repicked.abilities).toEqual([{ abilityId: otherJob.abilities[0].id, talent: null, mastered: false }]);
    expect(validateCharacter(repicked).filter(({ severity }) => severity === 'error')).toEqual([]);
    expect(() => refocusCharacter(pushDust({ ...character }, 8), {
      jobs: [otherJob.id],
      primaryJobId: otherJob.id,
      abilities: [],
      equippedAbilityIds: ['not-a-learned-ability'],
    })).toThrow(/Only learned abilities can be equipped/);
  });
});

describe('ICON relic advancement (p.245)', () => {
  it('advances rank deterministically from infused dust', () => {
    expect([0, 5, 6, 11, 12].map(relicRankForDust)).toEqual([1, 1, 2, 2, 3]);
  });

  it('infuses carried dust and advances rank at 6, 12, and 24', () => {
    let character = relicCharacter();
    character = infuseRelicDust(character, RELICS[0].id);
    expect(character.dust).toBe(7);
    expect(character.relics[0]).toMatchObject({ rank: 1, dustInfused: 1, aspectState: 'none' });
    character = infuseRelicDust(pushDust(character, 8), RELICS[0].id, 5);
    expect(character.relics[0]).toMatchObject({ rank: 2, dustInfused: 6 });
    character = infuseRelicDust(pushDust(character, 8), RELICS[0].id, 6);
    expect(character.relics[0]).toMatchObject({ rank: 3, dustInfused: 12 });
    character = infuseRelicDust(pushDust(character, 12), RELICS[0].id, 12);
    expect(character.relics[0]).toMatchObject({ rank: 4, aspectState: 'dust', dustInfused: 24 });
    expect(validateCharacter(character).filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('rejects unknown relics, non-positive amounts, and infusion past Aspect', () => {
    const character = relicCharacter();
    expect(() => infuseRelicDust(character, 'no-such-relic')).toThrow(/not recorded/);
    expect(() => infuseRelicDust(character, RELICS[0].id, 0)).toThrow(/at least one dust/);
    expect(() => infuseRelicDust(pushDust(character, 1), RELICS[0].id, 2)).toThrow(/requires 2 carried dust/);
    const aspected = { ...character, relics: [{ ...character.relics[0], rank: 4 as const, aspectState: 'dust' as const, dustInfused: 24 }] };
    expect(() => infuseRelicDust(pushDust(aspected, 4), RELICS[0].id)).toThrow(/already Aspected/);
  });

  it('Aspects a level III relic through a legendary task or a shared quest', () => {
    let character = relicCharacter();
    character.relics[0] = { ...character.relics[0], rank: 3, dustInfused: 12 };
    const quested = completeRelicAspectQuest(character, RELICS[0].id);
    expect(quested.relics[0]).toMatchObject({ rank: 4, aspectState: 'quest', dustInfused: 12 });
    expect(validateCharacter(quested).filter(({ severity }) => severity === 'error')).toEqual([]);
    const shared = aspectRelicFromSharedQuest(pushDust({ ...character, relics: [{ ...character.relics[0], rank: 3, dustInfused: 12 }] }, 4), RELICS[0].id);
    expect(shared.relics[0]).toMatchObject({ rank: 4, aspectState: 'shared-quest', dustInfused: 16 });
    expect(shared.dust).toBe(0);
    expect(validateCharacter(shared).filter(({ severity }) => severity === 'error')).toEqual([]);
  });

  it('guards quest and shared-quest preconditions', () => {
    let character = relicCharacter();
    character.relics[0] = { ...character.relics[0], rank: 2, dustInfused: 6 };
    expect(() => completeRelicAspectQuest(character, RELICS[0].id)).toThrow(/level III/);
    character.relics[0] = { ...character.relics[0], rank: 3, dustInfused: 6 };
    expect(() => completeRelicAspectQuest(character, RELICS[0].id)).toThrow(/12 infused dust/);
    character.relics[0] = { ...character.relics[0], rank: 3, dustInfused: 12 };
    expect(() => aspectRelicFromSharedQuest(pushDust(character, 2), RELICS[0].id)).toThrow(/costs 4 dust/);
  });

  it('resolves a migrated Aspect without inventing or discarding dust', () => {
    const character = relicCharacter();
    character.relics[0] = { ...character.relics[0], rank: 4, aspectState: 'unresolved', dustInfused: 12 };
    const quest = resolveRelicAspect(character, RELICS[0].id, 'quest');
    expect(quest.relics[0]).toMatchObject({ rank: 4, aspectState: 'quest', dustInfused: 12 });
    expect(validateCharacter(quest).filter(({ severity }) => severity === 'error')).toEqual([]);
    const shared = resolveRelicAspect(character, RELICS[0].id, 'shared-quest');
    expect(shared.relics[0].dustInfused).toBe(16);
    const dust = resolveRelicAspect(character, RELICS[0].id, 'dust');
    expect(dust.relics[0].dustInfused).toBe(24);
    expect(dust.relics[0].aspectState).toBe('dust');
    expect(() => resolveRelicAspect({ ...character, relics: [{ ...character.relics[0], aspectState: 'dust' }] }, RELICS[0].id, 'quest')).toThrow(/unresolved/);
  });
});
