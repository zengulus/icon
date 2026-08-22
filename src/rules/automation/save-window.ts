import { rollBoonOrCurse } from '../dice.js';
import type { RuleActorView, RuleExecutionContext, RuleMutation } from './types.js';

/**
 * A replay-stable save record.  It is intentionally independent of a status:
 * status-clearing, effect-resistance, and movement-gate saves share the roll
 * arithmetic but differ in their denial/continuation policy.
 *
 * TODO(ICON-rules, pp.94, 102, 129, 143–144, 186): expose choices by this
 * stable id (rather than the current actor/status map), route Six Hells and
 * Sucker Punch through it, and retain continuation branches in a first-class
 * SaveWindow event record.
 */
export type SaveWindowKind = 'status-clear' | 'cure-immediate' | 'effect' | 'movement';

export interface SaveWindowSpec {
  id: string;
  kind: SaveWindowKind;
  sourceId: string;
  actorId: string;
  /** Present for a p.94 ordinary status-clear save. */
  statusId?: string;
  /** Already evaluated source boon/curse, before persistent save policy. */
  sourceModifier?: number;
  /** A source effect can force a failure without consuming a roll. */
  forceFailure?: boolean;
  /** The caller validated an explicit Blessing spend for this one window. */
  spendBlessing?: boolean;
  threshold?: number;
}

export interface ResolvedSaveWindow {
  mutation: Extract<RuleMutation, { kind: 'save' }>;
  spentBlessing: boolean;
}

/**
 * Resolve one save under the target's durable policy.  Rot's curse applies to
 * saves generally; Sweet Torment's status-clear/Cure denial is checked by the
 * caller because it suppresses a whole window rather than changing its roll.
 */
export function resolveSaveWindow(
  context: RuleExecutionContext,
  target: RuleActorView,
  spec: SaveWindowSpec,
): ResolvedSaveWindow {
  if (spec.forceFailure) {
    return {
      mutation: {
        kind: 'save', sourceId: spec.sourceId, actorId: target.id,
        ...(spec.statusId ? { statusId: spec.statusId } : {}),
        windowId: spec.id, roll: 0, boon: 0, total: 0, success: false,
      },
      spentBlessing: false,
    };
  }
  const spendBlessing = spec.spendBlessing === true;
  const modifier = Math.trunc(spec.sourceModifier ?? 0)
    + target.statusSavePolicy.saveBoon
    - target.statusSavePolicy.saveCurse
    + (spendBlessing ? 1 : 0);
  const roll = context.dice.die(20);
  const boon = rollBoonOrCurse(modifier, context.dice).modifier;
  const total = roll + boon;
  return {
    mutation: {
      kind: 'save', sourceId: spec.sourceId, actorId: target.id,
      ...(spec.statusId ? { statusId: spec.statusId } : {}),
      windowId: spec.id, roll, boon, total, success: total >= (spec.threshold ?? 10),
    },
    spentBlessing: spendBlessing,
  };
}
