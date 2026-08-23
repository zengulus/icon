import { rollBoonOrCurse } from '../../dice.js';
import type { RuleActorView, RuleExecutionContext, RuleEffect, RuleMutation } from './types.js';

/**
 * The F2 durable SaveWindow record (docs/rules-foundations.md §3).  A save is
 * one d20 + boon/curse result with four durable facts, so command
 * construction, replay, and a save-reroll interrupt (Sucker Punch, p.143)
 * all read the same record instead of re-deriving policy from mutable state:
 *
 * - **kind** — what window nature this save has: `status-clear` (ordinary
 *   p.94 status saves), `cure-immediate` (the saves opened by a Cure,
 *   p.102), `effect` (a save against an ability effect, e.g. a generic VM
 *   save effect or Penumbra, p.162), or `movement` (a movement gate such as
 *   the Six Hells Trigram exit save, p.129).  Relic and legend saves are
 *   `effect`-kind windows that construct the same spec when their content is
 *   authored — the record is generic, never per-source.
 * - **modifiers** — the evaluated boon/curse breakdown (source, policy
 *   boon/curse, Blessing) so a re-roll reproduces the exact modifier.
 * - **denial policy** — `forced` (the roll itself was denied and recorded as
 *   an automatic failure, e.g. Penumbra vs a blinded foe).  Window-level
 *   denial (Sweet Torment suppressing a whole Cure/status window, p.144) is
 *   decided by the caller before any record exists, so nothing is emitted.
 * - **continuation branch** — the success/failure continuation as a
 *   declarative AST (`onSuccess` / `onFailure`), retained on the record so a
 *   save-reroll interrupt or a future held window can regenerate either
 *   outcome without re-reading the source ability.
 */
export type SaveWindowKind = 'status-clear' | 'cure-immediate' | 'effect' | 'movement';

export interface SaveWindowModifiers {
  /** Source-provided boon/curse before durable policy (p.94). */
  sourceModifier: number;
  /** Projected policy boon applied to every save (e.g. a talent save bonus). */
  saveBoon: number;
  /** Projected policy curse (e.g. Rot's curse, p.186). */
  saveCurse: number;
  /** Explicit p.102 Blessing spend for this one window. */
  blessing: boolean;
}

/**
 * The save's continuation: what happens on success vs failure.  `boon` is
 * the evaluated modifier (source + policy + Blessing) applied to both the
 * original roll and any re-roll — distinct from the mutation's `boon`, which
 * is the *rolled* boon/curse value of the original d20 result.
 */
export interface SaveWindowBranch {
  boon: number;
  threshold: number;
  onSuccess: RuleEffect[];
  onFailure: RuleEffect[];
}

export interface SaveWindowSpec {
  /** Stable `windowId` provenance for the pending generic SaveWindow choice/
   * interrupt migration (p.102, p.143). */
  id: string;
  kind: SaveWindowKind;
  sourceId: string;
  actorId: string;
  /** Present for an ordinary status-clearing save (p.94). */
  statusId?: string;
  /** Already evaluated source boon/curse, before persistent save policy. */
  sourceModifier?: number;
  /** A source effect can force a failure without consuming a roll. */
  forceFailure?: boolean;
  /** The caller validated an explicit Blessing spend for this one window. */
  spendBlessing?: boolean;
  threshold?: number;
  /** Continuation AST; `boon`/`threshold` are filled in by the resolver. */
  branch?: Pick<SaveWindowBranch, 'onSuccess' | 'onFailure'>;
}

export interface ResolvedSaveWindow {
  mutation: Extract<RuleMutation, { kind: 'save' }>;
  spentBlessing: boolean;
}

/**
 * Resolve one save under the target's durable policy.  Rot's curse applies
 * to saves generally; Sweet Torment's status-clear/Cure denial is checked by
 * the caller because it suppresses a whole window rather than changing its
 * roll.  Every emitted mutation carries the full record — `windowKind`,
 * `windowId`, `modifiers`, `threshold`, the denial `forced` flag, and the
 * continuation `branch` — so replay and re-rolls never re-derive policy.
 */
export function resolveSaveWindow(
  context: RuleExecutionContext,
  target: RuleActorView,
  spec: SaveWindowSpec,
): ResolvedSaveWindow {
  const modifiers: SaveWindowModifiers = {
    sourceModifier: Math.trunc(spec.sourceModifier ?? 0),
    saveBoon: target.statusSavePolicy.saveBoon,
    saveCurse: target.statusSavePolicy.saveCurse,
    blessing: spec.spendBlessing === true,
  };
  const threshold = spec.threshold ?? 10;
  const modifier = modifiers.sourceModifier + modifiers.saveBoon - modifiers.saveCurse + (modifiers.blessing ? 1 : 0);
  const base = {
    kind: 'save' as const,
    sourceId: spec.sourceId,
    actorId: target.id,
    windowKind: spec.kind,
    windowId: spec.id,
    threshold,
    modifiers,
    ...(spec.statusId ? { statusId: spec.statusId } : {}),
    ...(spec.branch ? { branch: { boon: modifier, threshold, onSuccess: spec.branch.onSuccess, onFailure: spec.branch.onFailure } as SaveWindowBranch } : {}),
  };
  if (spec.forceFailure) {
    return {
      mutation: { ...base, roll: 0, boon: 0, total: 0, success: false, forced: true },
      spentBlessing: false,
    };
  }
  // Roll the d20 before the boon/curse die so scripted dice read the d20
  // first (the established fixture convention).
  const roll = context.dice.die(20);
  const rolledBoon = rollBoonOrCurse(modifier, context.dice).modifier;
  const total = roll + rolledBoon;
  return {
    mutation: { ...base, roll, boon: rolledBoon, total, success: total >= threshold },
    spentBlessing: modifiers.blessing,
  };
}
