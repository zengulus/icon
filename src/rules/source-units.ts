import { JOB_CLASSES, JOBS, RELICS } from './catalog.js';
import { CORE_RULES } from './core.js';
import { FOE_PROFILES } from './foes.js';
import { CAMP_FIXTURES, GENERAL_TROPHIES, REWARD_RULES } from './rewards.js';
import type { SourceReference } from './types.js';

export type RuleSourceKind =
  | 'core'
  | 'class-trait'
  | 'job-trait'
  | 'job-summon-rule'
  | 'job-ability'
  | 'talent'
  | 'mastery'
  | 'limit-break'
  | 'relic-rank'
  | 'relic-aspect'
  | 'foe-trait'
  | 'foe-ability'
  | 'foe-phase'
  | 'foe-chapter-rule'
  | 'trophy'
  | 'camp-fixture'
  | 'camp-feature'
  | 'reward-rule';

export interface RuleSourceUnit {
  id: string;
  kind: RuleSourceKind;
  name: string;
  rulesText: string;
  source: SourceReference;
  parentId: string | null;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}

const unit = (
  id: string,
  kind: RuleSourceKind,
  name: string,
  rulesText: string,
  source: SourceReference,
  parentId: string | null = null,
  metadata: RuleSourceUnit['metadata'] = {},
): RuleSourceUnit => ({ id, kind, name, rulesText: rulesText.trim(), source, parentId, metadata });

export function collectRuleSourceUnits(): RuleSourceUnit[] {
  const units: RuleSourceUnit[] = [];
  for (const rule of CORE_RULES) units.push(unit(`core:${rule.id}`, 'core', rule.name, rule.rulesText, rule.source));
  for (const jobClass of JOB_CLASSES) {
    for (const trait of jobClass.traits) units.push(unit(trait.id, 'class-trait', trait.name, trait.rulesText, trait.source, jobClass.id));
  }
  for (const job of JOBS) {
    for (const trait of job.traits) units.push(unit(trait.id, 'job-trait', trait.name, trait.rulesText, trait.source, job.id));
    if (job.summonRulesText) units.push(unit(`${job.id}:summon-rules`, 'job-summon-rule', `${job.name} summons`, job.summonRulesText, job.source, job.id));
    if (job.limitBreak) {
      units.push(unit(job.limitBreak.id, 'limit-break', job.limitBreak.name, job.limitBreak.rulesText, job.source, job.id, {
        resolveCost: job.limitBreak.resolveCost,
        actionCost: job.limitBreak.cost.value,
        actionKind: job.limitBreak.cost.kind,
        range: job.limitBreak.range,
        tags: job.limitBreak.tags.join(', '),
      }));
    }
    for (const ability of job.abilities) {
      units.push(unit(ability.id, 'job-ability', ability.name, ability.rulesText, ability.source, job.id, {
        chapter: ability.chapter,
        actionCost: ability.cost.value,
        actionKind: ability.cost.kind,
        range: ability.range,
        header: ability.header,
        tags: ability.tags.join(', '),
      }));
      ability.talents.forEach((rulesText, index) => units.push(unit(
        `${ability.id}:talent:${index + 1}`,
        'talent',
        `${ability.name} talent ${index + 1}`,
        rulesText,
        ability.source,
        ability.id,
        { talent: index + 1 },
      )));
      if (ability.mastery) units.push(unit(`${ability.id}:mastery`, 'mastery', ability.mastery.name, ability.mastery.text, ability.source, ability.id));
    }
  }
  for (const relic of RELICS) {
    relic.ranks.forEach((rulesText, index) => units.push(unit(
      `relic:${relic.id}:rank:${index + 1}`,
      'relic-rank',
      `${relic.name} ${index + 1}`,
      rulesText,
      relic.source,
      relic.id,
      { rank: index + 1 },
    )));
    units.push(unit(`relic:${relic.id}:aspect`, 'relic-aspect', `${relic.name} Aspect`, relic.aspect, relic.source, relic.id, { rank: 4 }));
  }
  for (const profile of FOE_PROFILES) {
    for (const trait of profile.traits) if (trait.rulesText) units.push(unit(trait.id, 'foe-trait', trait.name, trait.rulesText, trait.source, profile.id, { phaseId: trait.phaseId }));
    for (const ability of profile.abilities) units.push(unit(ability.id, 'foe-ability', ability.name, ability.rulesText, ability.source, profile.id, {
      actionKind: ability.cost.kind,
      actionCost: ability.cost.value,
      phaseId: ability.phaseId,
      range: ability.range,
      header: ability.header,
      tags: ability.tags.join(', '),
    }));
    for (const phase of profile.phases) if (phase.rulesText) units.push(unit(phase.id, 'foe-phase', phase.name, phase.rulesText, phase.source, profile.id));
    profile.chapterRules.forEach((rule, index) => units.push(unit(
      `${profile.id}:chapter:${rule.chapter}:${index + 1}`,
      'foe-chapter-rule',
      `${profile.name} chapter ${rule.chapter}`,
      rule.rulesText || `Available from Chapter ${rule.chapter}.`,
      rule.source,
      profile.id,
      { chapter: rule.chapter },
    )));
    for (const trophy of profile.trophies) units.push(unit(trophy.id, 'trophy', trophy.name, trophy.rulesText, trophy.source, profile.id, {
      uses: trophy.uses.count,
      period: trophy.uses.period,
    }));
  }
  for (const trophy of GENERAL_TROPHIES) units.push(unit(trophy.id, 'trophy', trophy.name, trophy.rulesText, trophy.source, null, {
    uses: trophy.uses.count,
    period: trophy.uses.period,
  }));
  for (const fixture of CAMP_FIXTURES) {
    units.push(unit(fixture.id, 'camp-fixture', fixture.name, fixture.rulesText, fixture.source, null, {
      purchaseCost: fixture.purchaseCost,
      upgradeCost: fixture.upgradeCost,
    }));
    for (const feature of fixture.features) if (feature.rulesText) units.push(unit(feature.id, 'camp-feature', feature.name, feature.rulesText, feature.source, fixture.id));
  }
  for (const rule of REWARD_RULES) units.push(unit(rule.id, 'reward-rule', rule.name, rule.rulesText, rule.source));
  return units;
}

let sourceUnitIndex: Map<string, RuleSourceUnit> | null = null;

export function findRuleSourceUnit(id: string) {
  sourceUnitIndex ??= new Map(collectRuleSourceUnits().map((entry) => [entry.id, entry]));
  return sourceUnitIndex.get(id);
}

export interface SourceUnitAudit {
  total: number;
  byKind: Record<RuleSourceKind, number>;
  duplicateIds: string[];
  emptyRules: string[];
  invalidSources: string[];
}

export function auditRuleSourceUnits(units = collectRuleSourceUnits()): SourceUnitAudit {
  const counts = new Map<RuleSourceKind, number>();
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  const emptyRules: string[] = [];
  const invalidSources: string[] = [];
  for (const entry of units) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
    if (seen.has(entry.id)) duplicateIds.add(entry.id);
    seen.add(entry.id);
    if (!entry.rulesText) emptyRules.push(entry.id);
    if (!Number.isInteger(entry.source.page) || entry.source.page < 1 || !entry.source.sectionId) invalidSources.push(entry.id);
  }
  return {
    total: units.length,
    byKind: Object.fromEntries(counts) as Record<RuleSourceKind, number>,
    duplicateIds: [...duplicateIds],
    emptyRules,
    invalidSources,
  };
}
