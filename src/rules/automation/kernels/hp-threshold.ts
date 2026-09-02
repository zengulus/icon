import type { RuleSourceUnit } from '../../source-units.js';
import type { RuleAction, RuleClauseCompilation, RuleEffect, RuleProgramCompilation, RuleSelector } from '../primitives/types.js';

/**
 * HP-threshold passive projection kernel (docs/rules-foundations.md §7).
 *
 * ICON defines two canonical HP states that passives key off:
 *
 *   - Bloodied — "at or below 50% your base maximum hp" (p.81, the primary
 *     HP/Wound rule). The threshold is measured against the character's
 *     BASE maximum (4×VIT, the un-wounded bar): `hp <= baseMaxHp / 2 `
 *     (exactly: `hp * 2 <= baseMaxHp`). Wounds "temporarily reduc[e] your
 *     maximum HP" (p.81) — they shrink the LIVE bar (`maxHp =
 *     baseMaxHp − wounds×vitality`) but NEVER move the threshold.
 *   - At or under 25% hp — the quarter mark of the same BASE maximum:
 *     `hp <= baseMaxHp / 4` (exactly: `hp * 4 <= baseMaxHp`). A character
 *     at 26% of a 30-max bar is not "at or under 25%", so the exact
 *     comparison is required, never a round-up.
 *
 * The p.94/p.104 recaps ("at or under 50% maximum HP") drop the "base"
 * qualifier; the engine's long-standing wounds-adjusted reading of those
 * terse summaries conflicts with the p.81 qualifier. The adopted reading
 * (BASE maximum for every percent-of-maximum-HP threshold AND cost/damage,
 * p.107 "% HEALTH" stating the same policy for costs) is recorded as
 * adjudication `icon-1.5:combat:bloodied-base-max` in
 * `src/rules/source-adjudications.ts`.
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
 * view satisfy. Thresholds read ONLY `baseMaxHp` (the p.81 base bar); the
 * wounds-adjusted live maximum is deliberately absent — wounds do not move
 * the threshold (adjudication `icon-1.5:combat:bloodied-base-max`). */
export interface HpThresholdActor {
  hp: number;
  baseMaxHp: number;
  traitIds?: readonly string[];
}

/** ICON p.81 Bloodied: "at or below 50% your base maximum hp" — at or under
 * half the BASE maximum. Exact comparison (integer HP: `hp * 2 <=
 * baseMaxHp`), so a character at exactly half is bloodied and one point
 * above is not. Wounds never shift this bar. */
export function isBloodied(actor: HpThresholdActor): boolean {
  return actor.hp <= actor.baseMaxHp / 2;
}

/** "At 25% hp or lower" (Rot p.186): at or under a quarter of the BASE
 * maximum. Exact comparison (`hp * 4 <= baseMaxHp`), so a character at
 * exactly a quarter is at the threshold and one point above it is not.
 * Wounds never shift this bar. */
export function isAtOrUnderQuarterHp(actor: HpThresholdActor): boolean {
  return actor.hp <= actor.baseMaxHp / 4;
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
