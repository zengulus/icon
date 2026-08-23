import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { auditRuleCompilations, compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { collectRuleSourceUnits, findRuleSourceUnit } from '../source-units.js';
import { validCharacter } from './fixtures.js';

describe('rules automation coverage gate', () => {
  it('does not count reducer-only or placeholder manual rules as generic VM programs', () => {
    const standardMove = findRuleSourceUnit('core:standard-move');
    const skirmisher = findRuleSourceUnit('vagabond:trait:skirmisher');
    const prowl = findRuleSourceUnit('vagabond:trait:prowl');
    const diaga = findRuleSourceUnit('mendicant:trait:diaga');
    const bless = findRuleSourceUnit('mendicant:trait:bless');
    const succor = findRuleSourceUnit('mendicant:trait:succor');
    expect(standardMove).toBeDefined();
    expect(skirmisher).toBeDefined();
    expect(prowl).toBeDefined();
    expect(diaga).toBeDefined();
    expect(bless).toBeDefined();
    expect(succor).toBeDefined();

    const standardMoveCompilation = compileRuleSourceUnit(standardMove!);
    expect(standardMoveCompilation.unsupportedClauses).toHaveLength(1);
    expect(standardMoveCompilation.unsupportedClauses[0]?.unsupportedText).toContain('dedicated encounter reducer path');

    // Skirmisher is a deliberately small, independently executable passive:
    // it creates the condition consumed by the shared movement planner.
    expect(compileRuleSourceUnit(skirmisher!).unsupportedClauses).toEqual([]);

    // Prowl is source-specific rather than a generic "gain Stealth" parse:
    // its resolver charges an action only when a living foe is in range 2.
    expect(compileRuleSourceUnit(prowl!).unsupportedClauses).toEqual([]);

    // Diaga uses the shared command-time Cure/status-save resolver: p.94
    // ongoing statuses are excluded and p.102 Blessing choices are explicit.
    expect(compileRuleSourceUnit(diaga!).unsupportedClauses).toEqual([]);

    // ICON p.172: Bless has a one-character, range-4 resolver, while Succor
    // is a source-ID-gated passive consumed by the Rescue reducer.
    expect(compileRuleSourceUnit(bless!).unsupportedClauses).toEqual([]);
    expect(compileRuleSourceUnit(succor!).unsupportedClauses).toEqual([]);
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
    // F6: the 22 wired Job traits (incl. the attack-path modifier group —
    // Demon Edge, Hissatsu, Pulverize, Bull's Strength) + 6 summon suites
    // are complete programs; F7: the 10 wired talents (the closed
    // `talent-recipes.ts` tranche: exceed, comeback, finishing-blow with
    // per-row eligibility extensions, the always trigger for unconditional
    // charge-scaled augmentations, and the slay/collide post-application
    // fold) plus the three program-level talents (Demon Cutter t2's
    // pre-ability rush, Draken Cross t2's charged medium blasts, and Pyre
    // t1's comeback ally immunity, implemented in the ability programs and
    // gated on the equipped choice through the projected `talents` surface)
    // audit as complete — 288 source talents, 10 wired / 3 program-level /
    // 275 documented. The 43 documented Job traits and every other kind
    // stay source-visible.
    expect(audit).toMatchObject({
      totalPrograms: 3275,
      totalClauses: 4750,
      completePrograms: 387,
      unsupportedPrograms: 2888,
      completeClauses: 1527,
      unsupportedClauses: 3223,
      unsupportedByKind: {
        core: 70, 'class-trait': 8, 'job-trait': 43, 'limit-break': 16, 'talent': 275, 'mastery': 144,
        'relic-rank': 120, 'relic-aspect': 40, 'foe-ability': 1247, 'foe-trait': 612,
        'foe-phase': 19, 'foe-chapter-rule': 116, trophy: 68, 'camp-fixture': 16, 'camp-feature': 85, 'reward-rule': 9,
      },
    });
    expect(audit.completePrograms + audit.unsupportedPrograms).toBe(audit.totalPrograms);
    expect(audit.completeClauses + audit.unsupportedClauses).toBe(audit.totalClauses);
    expect(audit.unsupportedClauses).toBeGreaterThan(0);
  });
});
