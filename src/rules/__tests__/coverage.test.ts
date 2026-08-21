import { describe, expect, it } from 'vitest';
import { auditRuleCompilations, compileRuleSourceUnit } from '../automation/compiler.js';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { collectRuleSourceUnits, findRuleSourceUnit } from '../source-units.js';
import { validCharacter } from './fixtures.js';

describe('rules automation coverage gate', () => {
  it('does not count reducer-only or placeholder manual rules as generic VM programs', () => {
    const standardMove = findRuleSourceUnit('core:standard-move');
    const skirmisher = findRuleSourceUnit('vagabond:trait:skirmisher');
    expect(standardMove).toBeDefined();
    expect(skirmisher).toBeDefined();

    const standardMoveCompilation = compileRuleSourceUnit(standardMove!);
    expect(standardMoveCompilation.unsupportedClauses).toHaveLength(1);
    expect(standardMoveCompilation.unsupportedClauses[0]?.unsupportedText).toContain('dedicated encounter reducer path');

    // Skirmisher is a deliberately small, independently executable passive:
    // it creates the condition consumed by the shared movement planner.
    expect(compileRuleSourceUnit(skirmisher!).unsupportedClauses).toEqual([]);
  });

  it('does not allow a reducer-only core rule to silently take the generic VM path', () => {
    const hero = actorFromCharacter(validCharacter(), { x: 1, y: 1 });
    const foe = createFoe('Coverage fixture foe', { x: 2, y: 1 });
    let state = createEncounter('Coverage fixture');
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
    state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
    state = executeCommand(state, { type: 'START_ENCOUNTER' }).state;

    try {
      executeCommand(state, {
        type: 'EXECUTE_RULE',
        actorId: hero.id,
        sourceId: 'core:light-attack',
        actionId: 'default',
        timing: 'use',
        input: {},
        attackTargetId: foe.id,
      });
      throw new Error('Expected reducer-only core rule to be rejected by the generic VM.');
    } catch (error) {
      expect(error).toMatchObject({ code: 'rule.not-executable' });
    }
  });

  it('reports every source unit and leaves unresolved mechanics visible', () => {
    const { audit } = auditRuleCompilations(collectRuleSourceUnits());
    expect(audit).toMatchObject({
      totalPrograms: 3261,
      totalClauses: 4884,
      completePrograms: 104,
      unsupportedPrograms: 3157,
      completeClauses: 1014,
      unsupportedClauses: 3870,
      unsupportedByKind: { core: 56, 'class-trait': 12, 'foe-ability': 1262 },
    });
    expect(audit.completePrograms + audit.unsupportedPrograms).toBe(audit.totalPrograms);
    expect(audit.completeClauses + audit.unsupportedClauses).toBe(audit.totalClauses);
    expect(audit.unsupportedClauses).toBeGreaterThan(0);
  });
});
