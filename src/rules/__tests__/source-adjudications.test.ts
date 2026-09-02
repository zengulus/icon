import { describe, expect, it } from 'vitest';
import { LIMIT_BREAK_UNLOCK_LEVEL, abilityPointAllowance, awardXp, spendLevelUp } from '../character.js';
import { SOURCE_ADJUDICATIONS, findAdjudication } from '../source-adjudications.js';
import { dangerousOncePerTurnKey } from '../automation/kernels/use-ledger.js';
import { isAtOrUnderQuarterHp, isBloodied } from '../automation/kernels/hp-threshold.js';
import {validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

describe('source adjudication registry invariants', () => {
  it('every record carries a unique stable ID', () => {
    const ids = SOURCE_ADJUDICATIONS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('every record pins the ICON 1.5 rules version', () => {
    for (const adjudication of SOURCE_ADJUDICATIONS) {
      expect(adjudication.rulesVersion).toBe('1.5');
    }
  });

  it('every adopted conflict cites at least two conflicting source passages with pages', () => {
    for (const adjudication of SOURCE_ADJUDICATIONS.filter(({ status }) => status === 'adopted')) {
      expect(adjudication.sources.length).toBeGreaterThanOrEqual(2);
      for (const source of adjudication.sources) {
        expect(Number.isInteger(source.page)).toBe(true);
        expect(source.page).toBeGreaterThan(0);
        expect(source.statement.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('every adopted conflict has a non-empty rationale and adopted reading', () => {
    for (const adjudication of SOURCE_ADJUDICATIONS.filter(({ status }) => status === 'adopted')) {
      expect(adjudication.rationale.trim().length).toBeGreaterThan(0);
      expect(adjudication.adopted.trim().length).toBeGreaterThan(0);
      expect(adjudication.conflict.trim().length).toBeGreaterThan(0);
    }
  });

  it('every adopted conflict identifies affected implementation locations', () => {
    for (const adjudication of SOURCE_ADJUDICATIONS.filter(({ status }) => status === 'adopted')) {
      expect(adjudication.affectedCode.length).toBeGreaterThan(0);
      for (const location of adjudication.affectedCode) {
        expect(location.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe('adopted advancement boundary — mid-level Ability Point (icon-1.5:advancement:mid-level-ap)', () => {
  const adjudication = findAdjudication('icon-1.5:advancement:mid-level-ap');
  it('is an adopted record pinning the 7-XP breakpoint', () => {
    expect(adjudication?.status).toBe('adopted');
    expect(adjudication?.boundary).toEqual({ kind: 'xp', value: 7 });
  });

  it('the engine claims the mid-level AP at exactly 7 XP, not at 5 or 10', () => {
    expect(awardXp(validCharacter(), 5).xpAbilityPointClaimed).toBe(false);
    expect(awardXp(validCharacter(), 6).xpAbilityPointClaimed).toBe(false);
    const claimed = awardXp(validCharacter(), 7);
    expect(claimed.xpAbilityPointClaimed).toBe(true);
    expect(claimed.xp).toBe(7);
    // Claiming at 10 is true only because 10 crosses the 7-XP boundary —
    // there is no separate 10-XP unlock (the rejected p.44 reading).
    expect(awardXp(validCharacter(), 10).xpAbilityPointClaimed).toBe(true);
  });

  it('the claimed mid-level AP is included in the ability-point allowance', () => {
    const character = validCharacter();
    const claimed = awardXp(character, 7);
    expect(abilityPointAllowance(claimed)).toBe(abilityPointAllowance(character) + 1);
    // Unclaimed characters at the same level do not get the extra point.
    expect(abilityPointAllowance({ ...character, level: 1 })).toBe(abilityPointAllowance({ ...character, level: 1, xpAbilityPointClaimed: true }) - 1);
  });

  it('the engine banks a level at exactly 15 XP, resets the bar, and allows one banked level', () => {
    expect(awardXp(validCharacter(), 14).pendingLevelUps).toBe(0);
    const banked = awardXp(validCharacter(), 15);
    expect(banked.pendingLevelUps).toBe(1);
    expect(banked.xp).toBe(0);
    // p.44: "A character can only 'save' one banked level up at once." — a
    // second 15 XP cannot bank while one is pending, so the XP stays in the
    // bar (capped at 14) instead of being lost.
    const second = awardXp(banked, 15);
    expect(second.pendingLevelUps).toBe(1);
    expect(second.xp).toBe(14);
  });

  it('the AP claim is once per level: it resets when the banked level is spent', () => {
    const banked = awardXp(validCharacter(), 15);
    const advanced = spendLevelUp(banked, 1);
    expect(advanced.level).toBe(1);
    expect(advanced.xpAbilityPointClaimed).toBe(false);
    // The next level's 7-XP AP can be claimed again.
    expect(awardXp(advanced, 7).xpAbilityPointClaimed).toBe(true);
  });
});

describe('adopted advancement boundary — Limit Break unlock (icon-1.5:advancement:limit-break-level)', () => {
  const adjudication = findAdjudication('icon-1.5:advancement:limit-break-level');
  it('is an adopted record pinning the level-1 unlock boundary', () => {
    expect(adjudication?.status).toBe('adopted');
    expect(adjudication?.boundary).toEqual({ kind: 'level', value: 1 });
  });

  it('the engine boundary constant matches the adjudication and cannot drift', () => {
    expect(LIMIT_BREAK_UNLOCK_LEVEL).toBe(1);
    const boundary = adjudication?.boundary;
    expect(LIMIT_BREAK_UNLOCK_LEVEL).toBe(boundary && boundary.kind === 'level' ? boundary.value : undefined);
    // Level 0 sits below the boundary (p.240: level 0 has no limit break).
    expect(0).toBeLessThan(LIMIT_BREAK_UNLOCK_LEVEL);
  });

  it('the advancement table the engine implements grants the boundary row at level 1', () => {
    // The level-1 table row that unlocks the Limit Break is the same row that
    // grants +2 AP (Total AP 2 → 5); the engine implements that row.
    expect(abilityPointAllowance({ ...validCharacter(), level: 1, xpAbilityPointClaimed: false })).toBe(5);
    expect(abilityPointAllowance({ ...validCharacter(), level: 0, xpAbilityPointClaimed: false })).toBe(2);
  });
});

describe('adopted combat boundary — dangerous terrain cadence (icon-1.5:dangerous-terrain:damage-cadence)', () => {
  const adjudication = findAdjudication('icon-1.5:dangerous-terrain:damage-cadence');
  it('is an adopted record citing both the p.89 general rule and the p.183 Harvester reprint', () => {
    expect(adjudication?.status).toBe('adopted');
    const pages = adjudication?.sources.map(({ page }) => page).sort((a, b) => a - b);
    expect(pages).toEqual([89, 183]);
    // The adopted reading must be the p.89 general rule (once per turn), not
    // the p.183 Harvester recap (once per round).
    expect(adjudication?.adopted).toMatch(/once per TURN/i);
  });

  it('the engine keys the dangerous-terrain claim to the any-turn window the adjudication adopts', () => {
    // The adopted once-per-turn boundary is implemented as a per-actor
    // any-turn usage mark (reopened at each turn start), distinct from the
    // per-interrupt and once-per-round buckets. The key is the typed authority,
    // never a bare battlefield scan or a per-owner `turn`/`round` ledger key.
    const key = dangerousOncePerTurnKey();
    expect(key.startsWith('ledger:any-turn:')).toBe(true);
    expect(key).not.toMatch(/^ledger:(turn|round):/);
  });
});

describe('adopted combat boundary — bloodied / HP-percent thresholds (icon-1.5:combat:bloodied-base-max)', () => {
  const adjudication = findAdjudication('icon-1.5:combat:bloodied-base-max');
  it('is an adopted record pinning the BASE-maximum bar (never the wounds-adjusted bar)', () => {
    expect(adjudication?.status).toBe('adopted');
    expect(adjudication?.boundary).toEqual({ kind: 'hp-threshold-base', baseMaximum: true });
    const pages = adjudication?.sources.map(({ page }) => page).sort((a, b) => a - b);
    expect(pages).toEqual([81, 81, 94, 104]);
    expect(adjudication?.adopted).toMatch(/BASE maximum/i);
  });

  it('bloodied measures the BASE maximum even with wounds in play (hp·2 <= baseMaxHp)', () => {
    // base 40, one wound (vitality 10) → live max 30. The p.81 base bar is
    // 20: a character at 20 is bloodied, where the rejected wounds-adjusted
    // reading (half of 30 = 15) would demand 15 or less.
    expect(isBloodied({ hp: 20, baseMaxHp: 40 })).toBe(true);
    expect(isBloodied({ hp: 21, baseMaxHp: 40 })).toBe(false);
    expect(isBloodied({ hp: 15, baseMaxHp: 40 })).toBe(true);
  });

  it('the quarter reads the same base bar (hp·4 <= baseMaxHp)', () => {
    expect(isAtOrUnderQuarterHp({ hp: 7, baseMaxHp: 30 })).toBe(true); // 28 <= 30
    expect(isAtOrUnderQuarterHp({ hp: 8, baseMaxHp: 30 })).toBe(false); // 32 > 30
  });
});
