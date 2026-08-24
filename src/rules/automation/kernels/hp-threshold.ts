import type { RuleSourceUnit } from '../../source-units.js';
import type { RuleAction, RuleClauseCompilation, RuleEffect, RuleProgramCompilation, RuleSelector } from '../primitives/types.js';

/**
 * HP-threshold passive projection kernel (docs/rules-foundations.md §7).
 *
 * ICON defines two canonical HP states that passives key off:
 *
 *   - Bloodied — "at or under 50% hp" (p.94/p.104 special states). The
 *     threshold is measured against the character's CURRENT maximum after
 *     wounds (the same authority as the engine's long-standing `isBloodied`):
 *     `hp <= max(1, baseMaxHp - wounds * vitality) / 2`.
 *   - At or under 25% hp — the quarter mark of the same wounds-adjusted
 *     maximum: `hp <= max(1, baseMaxHp - wounds * vitality) / 4`. (The p.107
 *     "% HEALTH" rule — percentage COSTS/DAMAGE use the base maximum — does
 *     not apply to state thresholds; a character at 26% of a 30-max bar is
 *     not "at or under 25%", so the exact comparison is `hp * 4 <= maxHp`.)
 *
 * This module is the single reusable, source-ID-free authority answering the
 * two generic questions:
 *
 *   - Is this passive currently active?  (`isAtHpThreshold`)
 *   - What does the active threshold project onto its owner? (conditions /
 *     +actions, folded through the shared condition and turn-start authority)
 *
 * Membership is always derived from current authoritative HP: nothing here
 * persists a "bloodied active" boolean, so healing across the threshold
 * removes the projection immediately, taking damage across it adds it, and
 * replay needs no redundant derived state.
 *
 * A content module registers a reviewed `HpThresholdProjection` per source
 * passive (`content/foes/hp-threshold-recipes.ts`, `content/jobs/`): the row
 * declares the threshold, the (optional) inverted gate ("Loses X when
 * bloodied"), and the ephemeral conditions/actions membership projects. The
 * kernel never branches on a source ID: `sourceId` is provenance only, used
 * to pair the owning trait with its reviewed row.
 *
 * The kernel only answers "is this passive active" and projects conditions /
 * the turn-start action bonus. It does not absorb the semantics of any
 * payload: a source whose gated effect needs another missing foundation
 * (movement, summoning, aura-radius growth, …) stays unresolved.
 */

export type HpThreshold = 'bloodied' | 'quarter';

/** The minimal actor read surface both `EncounterActor` and the rule runtime
 * view satisfy (all threshold inputs live on the actor itself). */
export interface HpThresholdActor {
  hp: number;
  baseMaxHp: number;
  wounds: number;
  vitality: number;
  traitIds?: readonly string[];
}

/** The wounds-adjusted maximum: every HP threshold is measured against the
 * current maximum after wounds, matching the engine's `isBloodied` authority
 * (p.94: "at or below 50% of maximum HP"; wounds shrink the bar). */
export function maximumHp(actor: Pick<HpThresholdActor, 'baseMaxHp' | 'wounds' | 'vitality'>): number {
  return Math.max(1, actor.baseMaxHp - actor.wounds * actor.vitality);
}

/** ICON p.94/p.104 Bloodied: "at or under 50% hp" of the wounds-adjusted
 * maximum. Exact comparison (integers: `hp <= floor(max/2)`), so a character
 * at exactly half is bloodied and one point above is not. */
export function isBloodied(actor: HpThresholdActor): boolean {
  return actor.hp <= maximumHp(actor) / 2;
}

/** "At 25% hp or lower": at or under 25% of the wounds-adjusted maximum.
 * Exact comparison (`hp * 4 <= max`), so a character at exactly a quarter is
 * at the threshold and one point above it is not. */
export function isAtOrUnderQuarterHp(actor: HpThresholdActor): boolean {
  return actor.hp <= maximumHp(actor) / 4;
}

/** The reusable question at boundaries: "is this passive's threshold met?"
 * (turn start, condition fold, ability programs, …). */
export function isAtHpThreshold(actor: HpThresholdActor, threshold: HpThreshold): boolean {
  return threshold === 'bloodied' ? isBloodied(actor) : isAtOrUnderQuarterHp(actor);
}

/**
 * A reviewed HP-threshold passive row. `inverted` expresses the source's
 * "loses X when bloodied" shape (Arkentech Hover Chair: "Flying and Sturdy.
 * Loses both when bloodied"): the projections apply while the owner is NOT
 * at the threshold.
 */
export interface HpThresholdProjection {
  /** Provenance — the owning source trait id. The kernel never branches on
   * it; it only pairs the trait with its reviewed row. */
  sourceId: string;
  threshold: HpThreshold;
  /** Invert the gate: project while the owner is NOT at the threshold. */
  inverted?: boolean;
  /** Conditions projected onto the owner while the gate holds (evasion,
   * sturdy, unstoppable, flying, …). */
  conditions?: readonly string[];
  /** +N actions while the gate holds (Enrage: "+1 action while bloodied").
   * Derived at turn start from current HP — never a persisted boolean. */
  actions?: number;
}

const projections: HpThresholdProjection[] = [];

/** Register a reviewed HP-threshold passive row (content/). */
export function registerHpThresholdProjection(projection: HpThresholdProjection): void {
  projections.push(projection);
}

/** The registered row for a source passive, or null when none exists. */
export function hpThresholdProjectionFor(sourceId: string): HpThresholdProjection | null {
  return projections.find((projection) => projection.sourceId === sourceId) ?? null;
}

function gateActive(actor: HpThresholdActor, projection: HpThresholdProjection): boolean {
  const atThreshold = isAtHpThreshold(actor, projection.threshold);
  return projection.inverted ? !atThreshold : atThreshold;
}

/** Conditions the owner's active HP-threshold passives project. Ephemeral by
 * construction: nothing is written into the durable condition list, so
 * crossing back over the threshold removes the projection immediately. */
export function projectedHpThresholdConditions(actor: HpThresholdActor & { traitIds: readonly string[] }): ReadonlySet<string> {
  const conditions = new Set<string>();
  for (const projection of projections) {
    if (!actor.traitIds.includes(projection.sourceId)) continue;
    if (!gateActive(actor, projection)) continue;
    for (const condition of projection.conditions ?? []) conditions.add(condition);
  }
  return conditions;
}

/** The +actions the owner's active HP-threshold passives project at turn
 * start (Enrage family). Summed over the registered rows; derived from
 * current HP every turn. */
export function projectedHpThresholdActionBonus(actor: HpThresholdActor & { traitIds: readonly string[] }): number {
  let bonus = 0;
  for (const projection of projections) {
    if (!actor.traitIds.includes(projection.sourceId)) continue;
    if (!gateActive(actor, projection)) continue;
    bonus += projection.actions ?? 0;
  }
  return bonus;
}

// ── Foe-trait audit compilation ──────────────────────────────────────────────

const self: RuleSelector = { kind: 'self' };

/** Compile a reviewed HP-threshold foe trait (Slippery, Enrage, …) into the
 * same typed passive vocabulary the keyword and aura manifests use. The
 * conditions are already projected whenever the gate holds, so the program
 * is audit-complete without adding EXECUTE_RULE authority. */
export function compileHpThresholdFoeTraitRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  const projection = hpThresholdProjectionFor(unit.id);
  if (!projection) return null;
  const conditions = projection.conditions ?? [];
  const effects: RuleEffect[] = [...conditions].map((conditionId) => ({
    kind: 'condition',
    target: self,
    conditionId,
    operation: 'apply',
    potency: 'normal',
  } as const));
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: 'passive',
    text: unit.rulesText,
    effects,
    complete: true,
    unsupportedText: '',
  };
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing: 'passive',
    costs: [],
    tags: [...conditions],
    range: null,
    area: null,
    choices: [],
    steps: [{ id: `${unit.id}:projection`, timing: 'passive', effects }],
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
      dependencies: unit.parentId ? [unit.parentId] : [],
      classification: 'encounter',
    },
    clauses: [clause],
    unsupportedClauses: [],
  };
}
