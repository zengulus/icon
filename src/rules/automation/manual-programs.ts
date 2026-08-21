import type { RuleSourceUnit } from '../source-units.js';
import type { RuleAction, RuleClauseCompilation, RuleProgramCompilation, RuleTiming } from './types.js';

const coreUseCosts: Record<string, number> = {
  'core:dash': 1,
  'core:interact': 1,
  'core:rescue': 1,
  'core:light-attack': 1,
  'core:heavy-attack': 2,
  'core:recover': 2,
};

const coreUseRules = new Set(['core:standard-move', ...Object.keys(coreUseCosts)]);
const activeClassTraits: Record<string, { cost: number; range: number | null }> = {
  'vagabond:trait:prowl': { cost: 1, range: null },
  'mendicant:trait:diaga': { cost: 1, range: 4 },
  'mendicant:trait:bless': { cost: 1, range: 4 },
};

/**
 * These are the only hand-authored programs that are independently safe to
 * execute through the generic RuleProgram VM.  Other core rules are enforced
 * by dedicated encounter commands or reducer lifecycle code, while the
 * remaining class traits still need a complete typed resolver.  Keeping that
 * distinction here prevents a passive placeholder from being reported as a
 * fully executable source rule.
 */
const independentlyExecutableManualPrograms = new Set([
  'vagabond:trait:skirmisher',
]);

/**
 * Catalogued job abilities remain source-visible but none has yet passed the
 * source-specific resolver + replay-fixture bar. Keep this explicit empty
 * allowlist separate from the generic RuleProgram list so a future
 * `automation: "executable"` metadata edit cannot accidentally unlock the
 * old generic cost/attack approximation.
 */
const independentlyExecutableAbilityIds = new Set<string>();

export function isIndependentlyExecutableManualProgram(sourceId: string) {
  return independentlyExecutableManualPrograms.has(sourceId);
}

export function isIndependentlyExecutableAbility(abilityId: string) {
  return independentlyExecutableAbilityIds.has(abilityId);
}

export function compileManualRuleProgram(unit: RuleSourceUnit): RuleProgramCompilation | null {
  if (unit.kind !== 'core' && unit.kind !== 'class-trait') return null;
  const classActivation = activeClassTraits[unit.id];
  const timing: RuleTiming = unit.kind === 'core' ? coreUseRules.has(unit.id) ? 'use' : 'passive' : classActivation ? 'use' : 'passive';
  const cost = unit.kind === 'core' ? coreUseCosts[unit.id] ?? 0 : classActivation?.cost ?? 0;
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing,
    costs: cost ? [{ kind: 'action', amount: { kind: 'constant', value: cost } }] : [],
    tags: unit.id === 'core:light-attack' || unit.id === 'core:heavy-attack' ? ['attack'] : [],
    range: unit.kind === 'class-trait' ? classActivation?.range === null || classActivation?.range === undefined ? null : { kind: 'constant', value: classActivation.range } : unit.id === 'core:interact' || unit.id === 'core:rescue' ? { kind: 'constant', value: 1 } : null,
    area: null,
    choices: [],
    resolverId: unit.id,
    steps: [],
  };
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: timing,
    text: unit.rulesText,
    effects: [],
    complete: isIndependentlyExecutableManualProgram(unit.id),
    unsupportedText: isIndependentlyExecutableManualProgram(unit.id)
      ? ''
      : unit.kind === 'core'
        ? 'Implemented by a dedicated encounter reducer path; it has no complete generic RuleProgram resolver yet.'
        : 'Class trait requires a complete typed resolver before it can execute through the generic RuleProgram VM.',
  };
  return {
    program: {
      schemaVersion: 1,
      rulesVersion: '1.5',
      id: `program:${unit.id}`,
      sourceId: unit.id,
      source: unit.source,
      name: unit.name,
      actions: [action],
      dependencies: [],
      classification: 'encounter',
    },
    clauses: [clause],
    unsupportedClauses: clause.complete ? [] : [clause],
  };
}
