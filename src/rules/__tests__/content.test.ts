import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import sourcebook from '../../content/generated/icon-1.5.json';
import { ABILITIES, BONDS, JOBS, PHASE_TWO_COVERAGE_READY, RELICS, RULES_COVERAGE } from '../catalog.js';
import { DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS, EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import { FOE_ABILITIES, FOE_PROFILES, FOE_ROLES } from '../foes.js';
import { CAMP_FIXTURES, GENERAL_TROPHIES, REWARD_RULES } from '../rewards.js';
import { auditRuleSourceUnits } from '../source-units.js';

describe('ICON 1.5 content artifact', () => {
  it('contains the complete extracted source and required credit', () => {
    expect(sourcebook.metadata.pageCount).toBe(501);
    expect(sourcebook.pages).toHaveLength(501);
    expect(sourcebook.sections).toHaveLength(75);
    expect(sourcebook.sections.find(({ id }) => id === 'relics')).toMatchObject({ startPage: 245, endPage: 252 });
    expect(sourcebook.pages[1].text).toContain('Tom Bloom');
    expect(sourcebook.pages.filter(({ text }) => text.length > 0).length).toBeGreaterThan(490);
  });

  it('indexes the character-facing catalog without duplicate identifiers', () => {
    expect(BONDS).toHaveLength(12);
    expect(BONDS.every(({ ideals, powerDetails, kits }) => ideals.length === 3 && powerDetails.length === 10 && kits.length >= 2)).toBe(true);
    expect(BONDS.flatMap(({ powerDetails }) => powerDetails)).toHaveLength(120);
    expect(BONDS.find(({ id }) => id === 'mender')?.effort).toBe(6);
    expect(JOBS).toHaveLength(16);
    expect(JOBS.flatMap(({ traits }) => traits)).toHaveLength(65);
    expect(JOBS.every(({ limitBreak }) => limitBreak && limitBreak.resolveCost > 0)).toBe(true);
    expect(JOBS.filter(({ summonRulesText }) => summonRulesText)).toHaveLength(6);
    expect(new Set(JOBS.map(({ id }) => id)).size).toBe(JOBS.length);
    expect(new Set(ABILITIES.map(({ id }) => id)).size).toBe(ABILITIES.length);
    expect(ABILITIES).toHaveLength(144);
    for (const job of JOBS) {
      expect(job.abilities).toHaveLength(9);
      expect(job.abilities.filter(({ chapter }) => chapter === 1)).toHaveLength(6);
      expect(job.abilities.filter(({ chapter }) => chapter === 2)).toHaveLength(2);
      expect(job.abilities.filter(({ chapter }) => chapter === 3)).toHaveLength(1);
    }
    expect(ABILITIES.every(({ talents }) => talents.length === 2)).toBe(true);
    expect(ABILITIES.every(({ mastery }) => mastery !== null)).toBe(true);
    expect(RELICS).toHaveLength(40);
    expect(RELICS.every(({ ranks, aspect, aspectQuest }) => ranks.every(Boolean) && Boolean(aspect) && Boolean(aspectQuest))).toBe(true);
  });

  it('keeps Phase 2 closed while executable coverage is incomplete', () => {
    expect(RULES_COVERAGE.some(({ status }) => status !== 'complete')).toBe(true);
    expect(RULES_COVERAGE.find(({ id }) => id === 'job-ability-automation')).toMatchObject({ status: 'complete' });
    expect(RULES_COVERAGE.find(({ id }) => id === 'job-automation')).toMatchObject({ status: 'partial' });
    expect(PHASE_TWO_COVERAGE_READY).toBe(false);
  });

  it('keeps the independently reviewed Job allowlist in lockstep with the source catalog', () => {
    // Ultra Part 1 deliberately took colossus:raging-wolf out of the
    // executable set (its Heroic immunity + defeated-free-action semantics
    // are not yet represented), so the allowlist is the catalog minus that
    // documented exception.
    const nonExecutable = DOCUMENTED_NON_EXECUTABLE_JOB_ABILITY_IDS;
    const catalogAbilityIds = new Set(ABILITIES.map(({ id }) => id).filter((id) => !nonExecutable.has(id)));
    expect(EXECUTABLE_JOB_ABILITY_IDS.size).toBe(catalogAbilityIds.size);
    expect([...EXECUTABLE_JOB_ABILITY_IDS].sort()).toEqual([...catalogAbilityIds].sort());
    expect(ABILITIES.filter(({ id }) => !nonExecutable.has(id)).every(({ automation }) => automation === 'executable')).toBe(true);
    expect(ABILITIES.filter(({ id }) => nonExecutable.has(id)).every(({ automation }) => automation != null && automation !== 'executable')).toBe(true);
  });

  it('structures every color-coded foe role, profile, variant, and legend component', () => {
    expect(FOE_ROLES.map(({ id }) => id)).toEqual(['mob', 'heavy', 'skirmisher', 'leader', 'artillery', 'legend']);
    expect(FOE_ROLES.find(({ id }) => id === 'legend')).toMatchObject({ hpPerPlayer: 50, minimumHp: 100, defense: 8 });
    expect(FOE_PROFILES).toHaveLength(449);
    expect(FOE_ABILITIES).toHaveLength(1365);
    expect(new Set(FOE_PROFILES.map(({ id }) => id)).size).toBe(FOE_PROFILES.length);
    expect(new Set(FOE_ABILITIES.map(({ id }) => id)).size).toBe(FOE_ABILITIES.length);
    expect(FOE_PROFILES.every(({ source }) => source.page >= 300 && source.page <= 490)).toBe(true);

    const rogue = FOE_PROFILES.find(({ id }) => id === 'basic:rogue:308');
    expect(rogue).toMatchObject({ roleId: 'skirmisher', kind: 'elite' });
    expect(rogue?.abilities.find(({ name }) => name === 'Disappearing Act')?.cost).toEqual({ kind: 'interrupt', value: 1 });

    const bouncer = FOE_PROFILES.find(({ id }) => id === 'scavenger:bouncer:367');
    expect(bouncer).toMatchObject({ kind: 'variant', parentId: 'scavenger:scrapper:367', abilities: [] });
    expect(FOE_PROFILES.find(({ name }) => name === 'I. RIDER OF THE PRIMAL STORM')).toMatchObject({ kind: 'legend', roleId: 'legend' });
    expect(FOE_PROFILES.filter(({ id }) => [
      'folk:chronicler:315',
      'folk:churner:316',
      'folk:yeokin:322',
      'lowlander:special-mechanics-blightland-survivalists:428',
    ].includes(id))).toHaveLength(4);
  });

  it('structures encounter rewards and audits every traceable mechanical source unit', () => {
    expect(GENERAL_TROPHIES).toHaveLength(20);
    expect(CAMP_FIXTURES).toHaveLength(16);
    expect(CAMP_FIXTURES.flatMap(({ features }) => features)).toHaveLength(87);
    expect(REWARD_RULES).toHaveLength(9);
    expect(GENERAL_TROPHIES.every(({ rulesText, source }) => rulesText && source.page >= 99)).toBe(true);

    const audit = auditRuleSourceUnits();
    expect(audit.total).toBe(3275);
    expect(audit.byKind).toMatchObject({
      core: 70,
      'job-ability': 144,
      talent: 288,
      mastery: 144,
      'foe-ability': 1365,
      trophy: 68,
      'camp-fixture': 16,
    });
    expect(audit.duplicateIds).toEqual([]);
    expect(audit.emptyRules).toEqual([]);
    expect(audit.invalidSources).toEqual([]);
  });
});
