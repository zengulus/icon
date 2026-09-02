import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import { executeRuleProgram, RuleProgramViolation } from '../automation/kernels/runtime.js';
import { occupied, walk } from '../automation/primitives/job-kit.js';
import type { RuleActorView, RuleExecutionContext, RuleProgram, RuleRuntimeState } from '../automation/primitives/types.js';
import {scriptedDice, endTurnTo, startEncounterTo} from './fixtures.js';

const actor = (id: string, side: RuleActorView['side'], x: number, overrides: Partial<RuleActorView> = {}): RuleActorView => ({
  id,
  side,
  position: { x, y: 0 },
  hp: 20,
  maxHp: 40,
  baseMaxHp: 40, // the encounter adapter always projects the base bar (p.81 percent reads)
  vitality: 10,
  vigor: 0,
  defense: 8,
  armor: 0,
  speed: 4,
  dash: 2,
  fray: 3,
  damageDie: 8,
  actions: 2,
  attacked: false,
  size: 1,
  defeated: false,
  conditions: new Set(),
  resources: {},
  state: {},
  traitIds: [],
  talents: {},
  abilityIds: [],
  masteredAbilityIds: [],
  marks: [],
  ...overrides,
  statuses: overrides.statuses ?? [],
  statusSavePolicy: overrides.statusSavePolicy ?? { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
});

const state: RuleRuntimeState = {
  round: 3,
  grid: { width: 10, height: 10 },
  actors: {
    hero: actor('hero', 'heroes', 0, { resources: { aether: 4 } }),
    ally: actor('ally', 'heroes', 1),
    foe: actor('foe', 'foes', 2, { conditions: new Set(['slashed']) }),
    far: actor('far', 'foes', 8),
  },
  entities: {},
  terrainEffects: [],
  terrainAt: () => new Set(),
  elevationAt: () => 0,
};

const program: RuleProgram = {
  schemaVersion: 1,
  rulesVersion: '1.5',
  id: 'program:test-strike',
  sourceId: 'test-strike',
  source: { page: 1, sectionId: 'test' },
  name: 'Test Strike',
  classification: 'encounter',
  dependencies: [],
  actions: [{
    id: 'use',
    name: 'Test Strike',
    timing: 'use',
    costs: [
      { kind: 'action', amount: { kind: 'constant', value: 1 } },
      { kind: 'aether', amount: { kind: 'constant', value: 2 } },
    ],
    tags: ['attack'],
    range: { kind: 'constant', value: 3 },
    area: null,
    choices: [],
    steps: [{
      id: 'hit',
      timing: 'use',
      effects: [{
        kind: 'damage',
        target: { kind: 'attack-target' },
        amount: { kind: 'add', values: [
          { kind: 'damage-die', actor: { kind: 'self' }, count: { kind: 'constant', value: 1 } },
          { kind: 'stat', actor: { kind: 'self' }, stat: 'fray' },
        ] },
        damageType: 'normal',
      }, {
        kind: 'if',
        predicate: { kind: 'has-condition', target: { kind: 'attack-target' }, conditionId: 'slashed' },
        then: [{ kind: 'condition', target: { kind: 'attack-target' }, conditionId: 'stunned', operation: 'apply' }],
      }],
    }],
  }],
};

const context = (overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext => ({
  state,
  actorId: 'hero',
  sourceId: 'test-strike',
  actionId: 'use',
  timing: 'use',
  input: {},
  dice: scriptedDice(5),
  attackTargetId: 'foe',
  triggers: new Set(),
  ...overrides,
});

describe('declarative ICON rule runtime', () => {
  it('resolves attack, evasion, hit, critical, miss, and Exceed timing in the VM', () => {
    const attackProgram: RuleProgram = {
      ...program,
      id: 'program:attack',
      sourceId: 'attack',
      actions: [{ ...program.actions[0], costs: [], steps: [{ id: 'attack', timing: 'use', effects: [{
        kind: 'attack',
        target: { kind: 'attack-target' },
        boons: { kind: 'constant', value: 0 },
        onHit: [{ kind: 'damage', target: { kind: 'attack-target' }, amount: { kind: 'constant', value: 5 }, damageType: 'normal' }, {
          kind: 'if',
          predicate: { kind: 'trigger', trigger: 'exceed' },
          then: [{ kind: 'condition', target: { kind: 'attack-target' }, conditionId: 'shattered', operation: 'apply' }],
        }],
        onMiss: [{ kind: 'damage', target: { kind: 'attack-target' }, amount: { kind: 'constant', value: 3 }, damageType: 'normal' }],
        onCritical: [{ kind: 'condition', target: { kind: 'attack-target' }, conditionId: 'stunned', operation: 'apply' }],
      }] }] }],
    };
    const critical = executeRuleProgram(attackProgram, context({ sourceId: 'attack', dice: scriptedDice(20) }));
    expect(critical.mutations).toMatchObject([
      { kind: 'attack', d20: 20, hit: true, critical: true },
      { kind: 'damage', amount: 5 },
      { kind: 'condition', conditionId: 'shattered' },
      { kind: 'condition', conditionId: 'stunned' },
    ]);

    const evasionState: RuleRuntimeState = { ...state, actors: { ...state.actors, foe: actor('foe', 'foes', 2, { conditions: new Set(['evasion']) }) } };
    const evaded = executeRuleProgram(attackProgram, context({ sourceId: 'attack', state: evasionState, dice: scriptedDice(4) }));
    expect(evaded.mutations).toMatchObject([{ kind: 'attack', d20: null, evasionRoll: 4, hit: false }, { kind: 'damage', amount: 3 }]);
  });

  it('carries True Strike and high-ground provenance into its direct damage branch', () => {
    const provenanceProgram: RuleProgram = {
      ...program,
      id: 'program:attack-provenance',
      sourceId: 'attack-provenance',
      actions: [{ ...program.actions[0], costs: [], steps: [{ id: 'attack', timing: 'use', effects: [{
        kind: 'attack',
        target: { kind: 'attack-target' },
        trueStrike: true,
        onHit: [],
        onMiss: [{ kind: 'damage', target: { kind: 'attack-target' }, amount: { kind: 'constant', value: 3 }, damageType: 'normal' }],
      }] }] }],
    };
    const highGroundState: RuleRuntimeState = {
      ...state,
      elevationAt: (position) => position.x === 0 ? 1 : 0,
      actors: {
        ...state.actors,
        foe: actor('foe', 'foes', 2, { defense: 20, conditions: new Set(['dodge']) }),
      },
    };

    // ICON pp.89/104: higher elevation ignores the lower target's cover and
    // True Strike ignores Dodge even when the attack misses.
    const result = executeRuleProgram(provenanceProgram, context({
      sourceId: 'attack-provenance',
      state: highGroundState,
      dice: scriptedDice(1, 1),
    }));
    expect(result.mutations).toMatchObject([
      { kind: 'attack', hit: false, trueStrike: true },
      { kind: 'damage', actorId: 'foe', delivery: 'miss', ignoreDodge: true, ignoreCover: true },
    ]);
  });

  it('emits deterministic costs, expressions, damage, and conditional effects', () => {
    const result = executeRuleProgram(program, context());
    expect(result.mutations).toEqual([
      { kind: 'actions', sourceId: 'test-strike', actorId: 'hero', operation: 'spend', amount: 1 },
      { kind: 'resource', sourceId: 'test-strike', actorId: 'hero', resourceId: 'aether', operation: 'spend', amount: 2, minimum: 0, maximum: null },
      { kind: 'damage', sourceId: 'test-strike', sourceActorId: 'hero', actorId: 'foe', amount: 8, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false },
      { kind: 'condition', sourceId: 'test-strike', sourceActorId: 'hero', actorId: 'foe', conditionId: 'stunned', operation: 'apply', potency: 'normal' },
    ]);
  });

  it('validates actor input cardinality and range', () => {
    const selectorProgram: RuleProgram = {
      ...program,
      id: 'program:selector',
      sourceId: 'selector',
      actions: [{ ...program.actions[0], steps: [{ id: 'move', timing: 'use', effects: [{ kind: 'move', target: { kind: 'input', key: 'target', relation: 'ally', minimum: 1, maximum: 1, range: { kind: 'constant', value: 2 } }, movement: 'shove', distance: { kind: 'constant', value: 2 }, directionInput: 'direction' }] }] }],
    };
    expect(() => executeRuleProgram(selectorProgram, context({ sourceId: 'selector', input: { actorIds: { target: ['far'] }, directions: { direction: { x: 1, y: 0 } } } }))).toThrow(RuleProgramViolation);
    expect(executeRuleProgram(selectorProgram, context({ sourceId: 'selector', input: { actorIds: { target: ['ally'] }, directions: { direction: { x: 1, y: 0 } } } })).mutations.at(-1)).toMatchObject({ kind: 'move', actorId: 'ally', distance: 2 });
  });

  it('branches saves deterministically and emits the roll before its outcome', () => {
    const saveProgram: RuleProgram = {
      ...program,
      id: 'program:save',
      sourceId: 'save',
      actions: [{ ...program.actions[0], costs: [], steps: [{ id: 'save', timing: 'use', effects: [{ kind: 'save', target: { kind: 'attack-target' }, onSuccess: [{ kind: 'damage', target: { kind: 'trigger-targets' }, amount: { kind: 'constant', value: 2 }, damageType: 'piercing' }], onFailure: [{ kind: 'condition', target: { kind: 'trigger-targets' }, conditionId: 'stunned', operation: 'apply' }] }] }] }],
    };
    const failed = executeRuleProgram(saveProgram, context({ sourceId: 'save', dice: scriptedDice(9) }));
    expect(failed.mutations).toMatchObject([{ kind: 'save', roll: 9, success: false }, { kind: 'condition', actorId: 'foe', conditionId: 'stunned' }]);
    const passed = executeRuleProgram(saveProgram, context({ sourceId: 'save', dice: scriptedDice(10) }));
    expect(passed.mutations).toMatchObject([{ kind: 'save', roll: 10, success: true }, { kind: 'damage', actorId: 'foe', amount: 2 }]);

    // Generic effect saves share the durable save policy: Rot's curse is not
    // limited to Cure/end-turn status windows.
    const cursedState: RuleRuntimeState = {
      ...state,
      actors: {
        ...state.actors,
        foe: actor('foe', 'foes', 2, { statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 1 } }),
      },
    };
    const cursed = executeRuleProgram(saveProgram, context({ sourceId: 'save', state: cursedState, dice: scriptedDice(10, 1) }));
    expect(cursed.mutations[0]).toMatchObject({ kind: 'save', windowId: 'save:use:effect-save:1:foe', roll: 10, boon: -1, total: 9, success: false });
  });
});

describe('VM footprint geometry (ICON p.92)', () => {
  it('walk stops a large mover before its footprint enters a large blocker', () => {
    // Mover footprint (0,0)-(1,1); blocker footprint (3,0)-(4,1). The step to
    // anchor (2,0) would put the mover's (3,0) cell inside the blocker, so
    // the walk stops at (1,0) — an anchor-only walk would step to (2,0).
    const mover = actor('mover', 'heroes', 0, { size: 2 });
    const blocker = actor('blocker', 'foes', 3, { size: 2 });
    const wide = context({ state: { ...state, actors: { mover, blocker } }, actorId: 'mover' });
    expect(walk(wide, { x: 0, y: 0 }, { x: 1, y: 0 }, 4, false, 'mover')).toEqual({ x: 1, y: 0 });
    // Size-1 control: the same walk against the same large blocker stops at
    // the blocker's anchor-adjacent cell.
    const scout = actor('scout', 'heroes', 0);
    const narrow = context({ state: { ...state, actors: { scout, blocker } }, actorId: 'scout' });
    expect(walk(narrow, { x: 0, y: 0 }, { x: 1, y: 0 }, 4, false, 'scout')).toEqual({ x: 2, y: 0 });
  });

  it('occupied reports every large-actor footprint cell as taken', () => {
    const big = actor('big', 'heroes', 2, { size: 2 }); // footprint (2,0)-(3,1)
    const wide = context({ state: { ...state, actors: { big } }, actorId: 'big' });
    expect(occupied({ x: 2, y: 0 }, wide)).toBe(true); // anchor cell
    expect(occupied({ x: 3, y: 1 }, wide)).toBe(true); // non-anchor footprint cell
    expect(occupied({ x: 3, y: 0 }, wide)).toBe(true); // anchor row, second column
    expect(occupied({ x: 4, y: 0 }, wide)).toBe(false); // outside the footprint
    // Size-1 control: only the anchor cell is taken.
    const small = actor('small', 'heroes', 2);
    const narrow = context({ state: { ...state, actors: { small } }, actorId: 'small' });
    expect(occupied({ x: 2, y: 0 }, narrow)).toBe(true);
    expect(occupied({ x: 3, y: 1 }, narrow)).toBe(false);
  });
});
