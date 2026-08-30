/**
 * t2-choice-roles.test.ts — Phase T2 U4 CHOICE completions.
 *
 * 1. Position legality routes through the shared U3 position-domain
 *    predicates (`withinGrid` + the canonical p.92 footprint metric) and the
 *    range frame is a U7 ANCHOR (`RuleChoice.rangeOrigin`, default the acting
 *    actor) resolved through the shared anchor authority — a malformed anchor
 *    FAILS CLOSED instead of silently skipping the range check.
 * 2. The U2 chooser/controller substrate: `choiceEntitledPlayer` derives the
 *    entitled chooser from the durable role frame (declared `chooser`, else
 *    `controller`, else the source). A DECLARED role that cannot be derived
 *    returns null — the command/network boundary rejects rather than guesses;
 *    a choice with no declared role defaults to the source (the legacy
 *    contract).
 */
import { describe, expect, it } from 'vitest';
import type { RuleChoice, RuleExecutionContext } from '../automation/primitives/types.js';
import { choiceEntitledPlayer, choiceEntitledPlayerFromContext, resolveChoice } from '../automation/kernels/choice.js';
import type { RoleFrame } from '../automation/primitives/roles.js';
import { RuleProgramViolation } from '../automation/kernels/runtime.js';

function actor(
  id: string,
  side: 'heroes' | 'foes',
  position: { x: number; y: number } | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id, side, position, hp: 10, maxHp: 10, vitality: 1, vigor: 0, defense: 10, armor: 0, speed: 6, dash: 12, fray: 2,
    damageDie: 8, actions: 2, attacked: false, traitIds: [], abilityIds: [], talents: {}, masteredAbilityIds: [],
    size: 1, defeated: false, resources: {}, conditions: new Set<string>(), statuses: [],
    statusSavePolicy: { cureDenied: false, statusSaveDenied: false, saveBoon: 0, saveCurse: 0 },
    state: {}, marks: [], ...extra,
  } as RuleExecutionContext['state']['actors'][string];
}

function ctx(overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  return {
    state: {
      round: 1,
      grid: { width: 24, height: 24 },
      actors: {
        hero: actor('hero', 'heroes', { x: 4, y: 4 }),
        ally: actor('ally', 'heroes', { x: 6, y: 4 }),
        foe: actor('foe', 'foes', { x: 8, y: 4 }),
      },
      entities: {},
      terrainAt: () => new Set<string>(),
      elevationAt: () => 0,
      terrainEffects: [],
    },
    actorId: 'hero',
    sourceId: 'test:source',
    actionId: 'default',
    timing: 'use',
    input: {},
    dice: { die: () => 1, float: () => 0.5 },
    ...overrides,
  } as RuleExecutionContext;
}

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuleProgramViolation) return error.code;
    throw error;
  }
  throw new Error('expected a RuleProgramViolation');
};

describe('U4 — position choices route through the shared U3 predicates with a U7 anchor frame', () => {
  const row: RuleChoice = { key: 'center', label: 'Blast center', kind: 'positions', required: true, range: { kind: 'constant', value: 2 } };

  it('the default anchor is the acting actor (legacy contract preserved)', () => {
    // hero(4,4): (6,4) is distance 2 (at range), (7,4) is distance 3 (past).
    const at = resolveChoice(row, ctx({ input: { positions: { center: [{ x: 6, y: 4 }] } } }));
    expect(at).toEqual({ kind: 'positions', positions: [{ x: 6, y: 4 }] });
    expect(codeOf(() => resolveChoice(row, ctx({ input: { positions: { center: [{ x: 7, y: 4 }] } } })))).toBe('move.range');
    expect(codeOf(() => resolveChoice(row, ctx({ input: { positions: { center: [{ x: -1, y: 4 }] } } })))).toBe('move.out-of-bounds');
  });

  it('a declared rangeOrigin CAPTURED-position anchor moves the range frame', () => {
    // Measured from the captured anchor (10,4): (8,4) is distance 2 (at
    // range) even though it is distance 4 from the acting actor.
    const anchored: RuleChoice = { ...row, rangeOrigin: { kind: 'captured-position', position: { x: 10, y: 4 } } };
    expect(resolveChoice(anchored, ctx({ input: { positions: { center: [{ x: 8, y: 4 }] } } }))).toEqual({ kind: 'positions', positions: [{ x: 8, y: 4 }] });
    // One past the captured anchor's range fails.
    expect(codeOf(() => resolveChoice(anchored, ctx({ input: { positions: { center: [{ x: 7, y: 4 }] } } })))).toBe('move.range');
  });

  it('a declared rangeOrigin LIVE-actor anchor resolves through the anchor authority', () => {
    // Anchor = the ally at (6,4) via the input selector. (8,4) is distance 2
    // from the ally, so range 2 passes even though it is distance 4 from the
    // acting actor.
    const anchored: RuleChoice = { ...row, rangeOrigin: { kind: 'actor', selector: { kind: 'input', key: 'anchor' } } };
    const context = ctx({ input: { actorIds: { anchor: ['ally'] }, positions: { center: [{ x: 8, y: 4 }] } } });
    expect(resolveChoice(anchored, context)).toEqual({ kind: 'positions', positions: [{ x: 8, y: 4 }] });
  });

  it('a malformed rangeOrigin anchor fails closed (zero actors cannot frame a range)', () => {
    const anchored: RuleChoice = { ...row, rangeOrigin: { kind: 'actor', selector: { kind: 'input', key: 'anchor' } } };
    expect(codeOf(() => resolveChoice(anchored, ctx({ input: { actorIds: { anchor: [] }, positions: { center: [{ x: 6, y: 4 }] } } }))))
      .toBe('selector.origin-invalid');
  });

  it('a position-less anchor actor fails closed (no range can be measured)', () => {
    const context = ctx({ state: { ...ctx().state, actors: { ...ctx().state.actors, off: actor('off', 'heroes', null) } } });
    const anchored: RuleChoice = { ...row, rangeOrigin: { kind: 'actor', selector: { kind: 'input', key: 'anchor' } } };
    expect(codeOf(() => resolveChoice(anchored, { ...context, input: { actorIds: { anchor: ['off'] }, positions: { center: [{ x: 6, y: 4 }] } } })))
      .toBe('selector.origin-invalid');
  });
});

describe('U4 — the U2 chooser/controller entitlement seam', () => {
  const baseFrame: RoleFrame = {
    sourceId: 'hero',
    targetId: 'foe',
    controllers: { target: 'player-b' },
  };

  it('a choice with no declared role defaults to the source (legacy contract)', () => {
    const choice: RuleChoice = { key: 'target', label: 'Pick', kind: 'actors', required: true };
    expect(choiceEntitledPlayer(choice, baseFrame)).toBe('hero');
  });

  it('a declared chooser role resolves from the durable role frame', () => {
    const choice: RuleChoice = { key: 'target', label: 'Pick', kind: 'actors', required: true, chooser: { kind: 'role', role: 'target' } };
    expect(choiceEntitledPlayer(choice, baseFrame)).toBe('foe');
  });

  it('controller-of(subject) is subject-relative: the recorded controller of the TARGET', () => {
    const choice: RuleChoice = { key: 'target', label: 'Pick', kind: 'actors', required: true, controller: { kind: 'controller-of', subject: 'target' } };
    expect(choiceEntitledPlayer(choice, baseFrame)).toBe('player-b');
  });

  it('a declared role that cannot be derived fails closed (null — never a fallback to the source)', () => {
    // No controller recorded for the subject.
    const choice: RuleChoice = { key: 'target', label: 'Pick', kind: 'actors', required: true, controller: { kind: 'controller-of', subject: 'target' } };
    expect(choiceEntitledPlayer(choice, { ...baseFrame, controllers: {} })).toBeNull();
    // The subject role itself is underivable.
    const missing: RuleChoice = { key: 'target', label: 'Pick', kind: 'actors', required: true, chooser: { kind: 'role', role: 'carrier' } };
    expect(choiceEntitledPlayer(missing, baseFrame)).toBeNull();
  });

  it('the context convenience seam defaults to the source over the legacy slots', () => {
    const choice: RuleChoice = { key: 'target', label: 'Pick', kind: 'actors', required: true };
    expect(choiceEntitledPlayerFromContext(choice, ctx())).toBe('hero');
    // The legacy context carries no recorded controllers, so a declared
    // controller-of fails closed rather than guessing.
    const declared: RuleChoice = { key: 'target', label: 'Pick', kind: 'actors', required: true, controller: { kind: 'controller-of', subject: 'target' } };
    expect(choiceEntitledPlayerFromContext(declared, ctx({ attackTargetId: 'foe' }))).toBeNull();
  });
});
