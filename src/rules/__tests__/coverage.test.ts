import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { auditRuleCompilations, compileRuleSourceUnit } from '../automation/content/glue/compiler.js';
import { actorFromCharacter, createEncounter, createFoe, executeCommand } from '../encounter.js';
import { collectRuleSourceUnits, findRuleSourceUnit } from '../source-units.js';
import {validCharacter, endTurnTo, startEncounterTo} from './fixtures.js';

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
    state = startEncounterTo(state, hero.id);

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
    // F6: the 27 wired Job traits (incl. the attack-path modifier group —
    // Demon Edge, Hissatsu, Pulverize, Bull's Strength, Trigrammaton's
    // exactly-range-3 row, the F9 once-per-round reactive fold row Dash on
    // the Rocks, and Shieldmaster's aura + turn-end membership recipe)
    // + 6 summon suites are complete programs; F7: the 30 wired talents
    // (the closed `talent-recipes.ts` tranche) plus the seven program-level
    // talents, the three aura projection talents (Rook t1, Dervish t1,
    // Gentleness t1, which register as continuous passive-projection rows),
    // the four range-modifier talents (Valkyrie t1, Incubus t1,
    // Harvest t2, Open the Gates t2, executed by the shared range kernel),
    // and the one area-modifier talent (Soul Shot t2) audit as complete —
    // 288 source talents, 45 complete / 243 documented. F1 promote-after-
    // landing: Strongarm t1 (program-level F1 remove/place + range-kernel
    // comeback range) and Nothung t2 (program-level comeback teleport width)
    // joined the complete set. F8: the eight
    // complete mastery rows are complete
    // through the typed mastery attachment (each audits as one reviewed
    // passive clause — the parent resolver/lifecycle/aura path, not parsed
    // text — instead of the generic parser's split clauses). The reviewed
    // aura (Commander's Aura, Aura of Shielding), HP-threshold (Slippery,
    // the Enrage family, the hover chair), and attack-modifier (Blood
    // Hunger) foe traits compile complete through their kernels. The 38
    // documented Job traits and every other kind stay source-visible.
    // F9 range: the four range-modifier talents, Trigrammaton, and the
    // Aetherwall trait compile complete through the shared range kernel.
    // F10 area: Soul Shot t2 (Line 6), Pyre t2 (exceed shove), Eye of the
    // Storm t2 (count damage), and the Sturmreiten MJÖLLNIR mastery (arc 5)
    // compile complete through the shared area authority. F14 cost-payment:
    // the four wired proofs (Provoke t2, Pyroclast t2, Blackstar t1,
    // Masquerade t1's turn-ledger evasion) audit complete through the talent
    // fold. F5 mark-modifier fold: the three mark-modifier rows (Grand Seal
    // t1's save curse, Grand Seal t2's pacified+, Rot t2's turn-start
    // adjacency damage) audit complete at the engine's mark query points —
    // 56 complete / 231 documented. F7 mastery-modifier fold: the
    // three promoted modifier-family masteries (Catapult t2's MANGONEL,
    // Nothung's EXCALIBUR conversion, Open the Gates' PERFECT BATTLEMENT)
    // audit complete through the registered kernel rows.
    // 2026-08-28: +3 action-cost-override masteries (Valiant, Shadow Play,
    // Polaris) promoted through the cost-payment fold.
    // 2026-08-29: +3 program-level resolver-gated charge talents (Spinning
    // Top t2, Chaos Tarot t2, Terraforming t1) promoted (gated on equipped
    // talent rank), so the generic slow-turn `charge` trigger alone never
    // grants a talent effect.
    expect(audit).toMatchObject({
      totalPrograms: 3275,
      totalClauses: 4700,
      completePrograms: 479,
      unsupportedPrograms: 2796,
      completeClauses: 1619,
      unsupportedClauses: 3081,
      unsupportedByKind: {
        core: 70, 'class-trait': 6, 'job-trait': 38, 'limit-break': 16, 'talent': 227, 'mastery': 129,
        'relic-rank': 120, 'relic-aspect': 40, 'foe-ability': 1247, 'foe-trait': 590,
        'foe-phase': 19, 'foe-chapter-rule': 116, trophy: 68, 'camp-fixture': 16, 'camp-feature': 85, 'reward-rule': 9,
      },
    });
    expect(audit.completePrograms + audit.unsupportedPrograms).toBe(audit.totalPrograms);
    expect(audit.completeClauses + audit.unsupportedClauses).toBe(audit.totalClauses);
    expect(audit.unsupportedClauses).toBeGreaterThan(0);
  });
});
