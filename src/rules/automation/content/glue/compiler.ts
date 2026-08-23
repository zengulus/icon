import type { RuleSourceKind, RuleSourceUnit } from '../../../source-units.js';
import type {
  RuleAction,
  RuleClauseCompilation,
  RuleCost,
  RuleEffect,
  RuleNumber,
  RuleProgram,
  RuleProgramCompilation,
  RuleSelector,
  RuleStep,
  RuleTiming,
} from '../../primitives/types.js';
import { compileManualRuleProgram } from './manual-programs.js';

const self: RuleSelector = { kind: 'self' };
const attackTarget: RuleSelector = { kind: 'attack-target' };
const constant = (value: number): RuleNumber => ({ kind: 'constant', value });
const sourceKindsWithDirectActivation = new Set<RuleSourceKind>(['job-ability', 'foe-ability', 'limit-break', 'trophy']);
const parserExecutableKinds = new Set<RuleSourceKind>(['job-ability', 'foe-ability', 'limit-break']);
const triggerLabels = new Set(['collide', 'charge', 'comeback', 'heroic', 'infuse', 'exceed', 'finishing blow', 'slay', 'chain reaction']);
const statusNames = ['slashed', 'blind', 'dazed', 'pacified', 'sealed', 'shattered', 'stunned', 'weakened', 'vulnerable'] as const;
const positiveNames = ['counter', 'defiance', 'dodge', 'evasion', 'flying', 'intangible', 'phasing', 'regeneration', 'stealth', 'sturdy', 'unstoppable'] as const;
const labelPattern = /(?:^|\s)(Attack|On hit|Miss|Critical Hit|Area effect|Effect|Terrain effect|Object effect|Summon effect|Summon action|Summon|Mark|Stance|Refresh|Trigger|Delay|Special(?: Effect)?|Ultimate|Collide|Charge|Comeback|Heroic|Infuse(?:\s+\d+|\s+X)?|Exceed|Finishing Blow|Slay|Chain Reaction)\s*:/gi;
const mechanicWordPattern = /\b(?:action|attack|damage|fray|vigor|status|save|move|rush|shove|teleport|fly|place|remove|summon|terrain|object|mark|stance|interrupt|turn|round|range|area|blast|burst|line|arc|aura|adjacent|ally|foe|character|space|bloodied|defeated|resolve|aether|power die|sacrifice|cure|immune|resistance|cover|collide|charge|comeback|heroic|infuse|exceed|finishing blow|slay|piercing|divine|slashed|blind|dazed|pacified|sealed|shattered|stunned|weakened|vulnerable|counter|defiance|dodge|evasion|flying|intangible|phasing|regeneration|stealth|sturdy|unstoppable)\b|\[D\]/i;

interface RawClause {
  label: string;
  text: string;
}

function splitClauses(text: string): RawClause[] {
  const matches = [...text.matchAll(labelPattern)];
  if (matches.length === 0) return [{ label: 'effect', text: text.trim() }];
  const clauses: RawClause[] = [];
  const prefix = text.slice(0, matches[0].index).trim();
  if (prefix && mechanicWordPattern.test(prefix)) clauses.push({ label: 'effect', text: prefix });
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    clauses.push({ label: match[1].toLocaleLowerCase().replace(/\s+\d+$/, '').trim(), text: text.slice(start, end).trim() });
  });
  return clauses.filter(({ text: clauseText }) => clauseText.length > 0);
}

function selectorFor(text: string, label: string): RuleSelector {
  const lower = text.toLocaleLowerCase();
  if (/\b(?:yourself|you gain|you become|cure yourself|self)\b/.test(lower)) return self;
  if (/\ball (?:adjacent )?foes\b/.test(lower)) return { kind: 'adjacent', origin: self, relation: 'foe' };
  if (/\ball (?:adjacent )?(?:characters|allies)\b/.test(lower)) return { kind: 'adjacent', origin: self, relation: lower.includes('allies') ? 'ally' : 'any' };
  if (label === 'area effect') return { kind: 'input', key: 'area-targets', relation: lower.includes('foes') ? 'foe' : lower.includes('allies') ? 'ally' : 'any' };
  return attackTarget;
}

function damageExpression(text: string, actorSelector: RuleSelector = self): RuleNumber | null {
  const die = text.match(/(?:(\d+)\s*)?\[D\]/i);
  const fixed = text.match(/(?:^|\s)(\d+)\s+(?:(?:piercing|divine)\s+)?damage\b/i);
  const hasFray = /\bfray(?:\s+damage)?\b/i.test(text);
  if (!die && !fixed && !hasFray) return null;
  const values: RuleNumber[] = [];
  if (die) values.push({ kind: 'damage-roll', actor: actorSelector, dice: constant(Number(die[1] || 1)) });
  if (fixed) values.push(constant(Number(fixed[1])));
  if (hasFray) values.push({ kind: 'stat', actor: actorSelector, stat: 'fray' });
  return values.length === 1 ? values[0] : { kind: 'add', values };
}

function consumeMatch(remaining: string, match: RegExpMatchArray) {
  const index = match.index ?? remaining.indexOf(match[0]);
  return `${remaining.slice(0, index)} ${remaining.slice(index + match[0].length)}`;
}

function compileEffects(label: string, text: string): { effects: RuleEffect[]; unsupportedText: string } {
  const effects: RuleEffect[] = [];
  let remaining = text;
  const target = selectorFor(text, label);
  const formula = damageExpression(text);
  if (formula) {
    const damageMatch = text.match(/(?:(?:deal|take|takes|inflict|hit for|miss(?:es)? for)\s+)?(?:(?:\d+\s*)?\[D\](?:\s*\+\s*fray)?|(?:\d+)\s+(?:(?:piercing|divine)\s+)?damage|(?:piercing\s+)?fray(?:\s+damage)?)/i);
    if (damageMatch) {
      effects.push({ kind: 'damage', target, amount: formula, damageType: /\bdivine\b/i.test(damageMatch[0]) ? 'divine' : /\bpiercing\b/i.test(damageMatch[0]) ? 'piercing' : 'normal' });
      remaining = consumeMatch(remaining, damageMatch);
    }
  }

  const vigorPattern = /(?:gain|gains|grant(?:s)?)\s+(\d+)\s+vigor\b/gi;
  for (const match of [...text.matchAll(vigorPattern)]) {
    effects.push({ kind: 'vigor', target: selectorFor(match[0], label), amount: constant(Number(match[1])) });
    remaining = remaining.replace(match[0], ' ');
  }
  if (/\bcure (?:yourself|self|the target|target|them|character)\b/i.test(text)) {
    effects.push({ kind: 'cure', target, all: false });
    remaining = remaining.replace(/\bcure (?:yourself|self|the target|target|them|character)\b/i, ' ');
  }

  for (const conditionId of [...statusNames, ...positiveNames]) {
    const expression = new RegExp(`(?:is|are|become|becomes|gain|gains|inflict|inflicts)\\s+${conditionId}(\\+)?\\b`, 'i');
    const match = remaining.match(expression);
    if (match) {
      effects.push({ kind: 'condition', target, conditionId, operation: 'apply', potency: match[1] ? 'plus' : 'normal' });
      remaining = consumeMatch(remaining, match);
    }
  }

  const movePatterns: Array<{ expression: RegExp; movement: 'rush' | 'shove' | 'fly' | 'teleport' }> = [
    { expression: /\brush(?:es)?\s+(\d+)\b/i, movement: 'rush' },
    { expression: /\bshov(?:e|ed|es)\s+(?:[^.]{0,35}?\s)?(\d+)\s*(?:spaces?)?/i, movement: 'shove' },
    { expression: /\bfly\s+(\d+)\b/i, movement: 'fly' },
    { expression: /\bteleport(?:s|ed)?\s+(\d+)\b/i, movement: 'teleport' },
  ];
  for (const { expression, movement } of movePatterns) {
    const match = remaining.match(expression);
    if (!match) continue;
    effects.push({ kind: 'move', target: movement === 'rush' || movement === 'fly' || movement === 'teleport' ? self : target, movement, distance: constant(Number(match[1])), directionInput: movement === 'shove' ? 'direction' : undefined, positionInput: movement === 'teleport' ? 'destination' : undefined });
    remaining = consumeMatch(remaining, match);
  }

  const summonMatch = remaining.match(/\bsummon(?:s|ed)?\s+(?:(\d+|two|three|a|an)\s+)?([a-z][a-z -]+?)(?=\s+(?:in|adjacent|at|after|and)|[.,;]|$)/i);
  if (summonMatch) {
    const words: Record<string, number> = { a: 1, an: 1, two: 2, three: 3 };
    effects.push({ kind: 'entity', operation: 'summon', entityType: summonMatch[2].trim().replace(/s$/i, ''), owner: self, positionInput: 'summon-positions', count: constant(Number(summonMatch[1]) || words[summonMatch[1]?.toLocaleLowerCase()] || 1) });
    remaining = consumeMatch(remaining, summonMatch);
  }

  const resourcePattern = /\b(?:gain|gains)\s+(\d+)\s+(Aether|Resolve|Vigilance)\b/gi;
  for (const match of [...text.matchAll(resourcePattern)]) {
    effects.push({ kind: 'resource', target: self, resourceId: match[2].toLocaleLowerCase(), operation: 'gain', amount: constant(Number(match[1])) });
    remaining = remaining.replace(match[0], ' ');
  }

  remaining = remaining
    .replace(/\b(?:then|and|or|also|may|can|must|the|a|an|your|their|this|that|target|character|foe|ally|effect|after|before|ability|resolves?|once|again|immediately|up to|all|different|main|from|in|of|to|for|with|by|on|each|any|space|spaces|away|towards?)\b/gi, ' ')
    .replace(/[+.,;:()•-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { effects, unsupportedText: mechanicWordPattern.test(remaining) || remaining.length > 24 ? remaining : '' };
}

function timingFor(kind: RuleSourceKind, actionKind: unknown): RuleTiming {
  if (actionKind === 'interrupt') return 'interrupt';
  if (actionKind === 'passive' || !sourceKindsWithDirectActivation.has(kind)) return 'passive';
  if (actionKind === 'round') return 'round-start';
  return 'use';
}

function classificationFor(kind: RuleSourceKind): RuleProgram['classification'] {
  if (kind === 'reward-rule' || kind === 'camp-fixture' || kind === 'camp-feature' || kind === 'trophy') return 'reward';
  if (kind === 'core' || kind.includes('trait') || kind.includes('ability') || kind === 'limit-break' || kind === 'talent' || kind === 'mastery' || kind.startsWith('relic') || kind.startsWith('foe') || kind === 'job-summon-rule') return 'encounter';
  return 'narrative';
}

export function compileRuleSourceUnit(unit: RuleSourceUnit): RuleProgramCompilation {
  const manual = compileManualRuleProgram(unit);
  if (manual) return manual;
  const tags = typeof unit.metadata.tags === 'string' ? unit.metadata.tags.split(',').map((tag) => tag.trim()).filter(Boolean) : [];
  const rawClauses = splitClauses(unit.rulesText);
  const clauses: RuleClauseCompilation[] = rawClauses.map((clause, index) => {
    const result = compileEffects(clause.label, clause.text);
    const effects = result.effects.map((effect): RuleEffect => effect.kind === 'damage' ? {
      ...effect,
      damageType: tags.includes('divine') ? 'divine' : tags.includes('pierce') ? 'piercing' : effect.damageType,
      delivery: clause.label === 'area effect' ? 'area' : effect.delivery,
      ignoreCover: tags.includes('unerring') || effect.ignoreCover,
    } : effect);
    const attachmentRequired = !parserExecutableKinds.has(unit.kind);
    const unsupportedText = attachmentRequired ? `${unit.kind} requires an explicit typed attachment or lifecycle resolver` : result.unsupportedText;
    return { id: `${unit.id}:clause:${index + 1}`, label: clause.label, text: clause.text, effects, complete: !unsupportedText, unsupportedText };
  });
  const actionKind = unit.metadata.actionKind;
  const timing = timingFor(unit.kind, actionKind);
  const costs: RuleCost[] = typeof unit.metadata.actionCost === 'number' && unit.metadata.actionCost > 0
    ? [{ kind: actionKind === 'interrupt' ? 'interrupt' as const : 'action' as const, amount: constant(unit.metadata.actionCost) }]
    : [];
  if (typeof unit.metadata.resolveCost === 'number' && unit.metadata.resolveCost > 0) costs.push({ kind: 'resolve', amount: constant(unit.metadata.resolveCost) });
  const onHit = clauses.find(({ label }) => label === 'on hit');
  const onMiss = clauses.find(({ label }) => label === 'miss');
  const onCritical = clauses.find(({ label }) => label === 'critical hit');
  const normalClauses = clauses.filter(({ label }) => !['attack', 'on hit', 'miss', 'critical hit'].includes(label));
  const effects: RuleEffect[] = [];
  const criticalDamage = (effectsToUpgrade: RuleEffect[]) => effectsToUpgrade.map((effect): RuleEffect => effect.kind === 'damage' ? {
    ...effect,
    amount: {
      kind: 'add',
      values: [effect.amount, { kind: 'if', predicate: { kind: 'trigger', trigger: 'critical-hit' }, then: { kind: 'damage-roll', actor: self, dice: constant(1) }, otherwise: constant(0) }],
    },
  } : effect);
  if (onHit || onMiss) effects.push({ kind: 'attack', target: attackTarget, autoHit: /\bauto.?hit\b/i.test(unit.rulesText), trueStrike: tags.includes('true strike'), onHit: criticalDamage(onHit?.effects ?? []), onMiss: onMiss?.effects ?? [], onCritical: onCritical?.effects ?? [] });
  const steps: RuleStep[] = [{ id: `${unit.id}:base`, timing, effects: [...effects, ...normalClauses.filter(({ label }) => !triggerLabels.has(label)).flatMap(({ effects: clauseEffects }) => clauseEffects)] }];
  for (const clause of normalClauses.filter(({ label }) => triggerLabels.has(label))) steps.push({ id: `${unit.id}:${clause.label.replaceAll(' ', '-')}`, timing, trigger: clause.label.replaceAll(' ', '-'), effects: clause.effects });
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing,
    costs,
    tags,
    range: typeof unit.metadata.range === 'number' ? constant(unit.metadata.range) : null,
    area: null,
    choices: [],
    steps,
  };
  const program: RuleProgram = {
    schemaVersion: 1,
    rulesVersion: '1.5',
    id: `program:${unit.id}`,
    sourceId: unit.id,
    source: unit.source,
    name: unit.name,
    actions: [action],
    dependencies: unit.parentId ? [unit.parentId] : [],
    classification: classificationFor(unit.kind),
  };
  return { program, clauses, unsupportedClauses: clauses.filter(({ complete }) => !complete) };
}

export interface RuleCompilationAudit {
  totalPrograms: number;
  totalClauses: number;
  completeClauses: number;
  unsupportedClauses: number;
  completePrograms: number;
  unsupportedPrograms: number;
  unsupportedByKind: Partial<Record<RuleSourceKind, number>>;
}

export function auditRuleCompilations(units: RuleSourceUnit[]) {
  const compilations = units.map(compileRuleSourceUnit);
  const unsupportedByKind: Partial<Record<RuleSourceKind, number>> = {};
  compilations.forEach((compilation, index) => {
    if (compilation.unsupportedClauses.length === 0) return;
    const kind = units[index].kind;
    unsupportedByKind[kind] = (unsupportedByKind[kind] ?? 0) + 1;
  });
  const totalClauses = compilations.reduce((total, { clauses }) => total + clauses.length, 0);
  const unsupportedClauses = compilations.reduce((total, compilation) => total + compilation.unsupportedClauses.length, 0);
  return {
    compilations,
    audit: {
      totalPrograms: compilations.length,
      totalClauses,
      completeClauses: totalClauses - unsupportedClauses,
      unsupportedClauses,
      completePrograms: compilations.filter(({ unsupportedClauses: unsupported }) => unsupported.length === 0).length,
      unsupportedPrograms: compilations.filter(({ unsupportedClauses: unsupported }) => unsupported.length > 0).length,
      unsupportedByKind,
    } satisfies RuleCompilationAudit,
  };
}
