import { hasMastery, type MasteryOwnerView } from './mastery.js';
import type { RuleExecutionContext } from '../primitives/types.js';

/**
 * Mastery modifier-fold kernel (docs/rules-foundations.md K-P5).
 *
 * ICON 1.5 masteries modify their parent ability's execution. Most mastery
 * texts decompose into the same reusable modifier families the engine already
 * answers at execution time (listed-range, area shape, attack modifiers…);
 * this module is the single reusable, source-ID-free seam for the families
 * that had no queryable authority before:
 *
 *   - `interrupt-rank` — an interrupt's rank IS its per-round use count
 *     (p.91); a mastery like MANGONEL ("Catapult becomes Interrupt 3",
 *     p.123) or PERFECT BATTLEMENT ("becomes interrupt 2", p.122) overrides
 *     that authority. The fold is consumed wherever the engine reads an
 *     interrupt's per-round allowance (the USE_ABILITY gate, window
 *     availability scans), so the extra uses are mechanically real.
 *   - `damage-type` — a delivery conversion on the parent ability's damage
 *     instances (EXCALIBUR: "All 1 piercing damage listed by this ability
 *     becomes divine", p.225). Content resolvers ask for the effective type
 *     of the instance they are about to emit; the shared damage pipeline
 *     then applies the converted type's exact semantics (divine bypasses
 *     Defiance and vigor).
 *   - `unlimited-range` — "has no maximum range" (PERFECT BATTLEMENT,
 *     p.122): a bounded range check the caller owns collapses to unbounded
 *     while the rule holds. This is the source's own wording — not a large
 *     numeric approximation.
 *
 * A content module registers one reviewed `MasteryModifierRule` per source
 * clause (`content/jobs/mastery-modifier-recipes.ts`). The kernel never
 * branches on a source ID: `sourceId` is provenance/registry key only and
 * `abilityId` selects the parent ability. Every query requires the parent
 * ability to be equipped AND mastered (`hasMastery`) AND its gate to hold
 * against current state — a mastery must never fire for an unequipped
 * parent, for a different mastered ability, or outside its source
 * conditions. Queries are pure functions of the supplied view, so command
 * planning and replay read the same authority.
 */

/** The source-defined conditions under which a mastery modifier applies. */
export type MasteryFoldGate =
  /** Unconditional. */
  | { kind: 'always' }
  /** The encounter round is at least `value` (ICON "at round 4 or higher"). */
  | { kind: 'round-at-least'; value: number };

/** The reusable modifier families this kernel owns. */
export type MasteryModifier =
  /** Override the parent interrupt's rank (= uses per round). Last match wins. */
  | { kind: 'interrupt-rank'; rank: number }
  /** Convert the parent ability's damage instances of type `from` to `to`. */
  | { kind: 'damage-type'; from: string; to: string }
  /** Remove the parent ability's maximum-range bound ("no maximum range"). */
  | { kind: 'unlimited-range' };

/** The minimal actor read the gates need — satisfied by both the encounter
 * actor and the resolver runtime actor view. */
export interface MasteryFoldActorView extends MasteryOwnerView {
  hp?: number;
  maximumHp?: number;
}

/** The minimal state read the gates need: the round number plus the acting
 * actor's ownership/mastery surface. */
export interface MasteryFoldStateView {
  round: number;
  actors: Readonly<Record<string, MasteryFoldActorView>>;
}

/** The fold read for a rule-program execution: resolvers inside an ability
 * program ask the same authority the command gates do, built from the runtime
 * actor views (which carry `abilityIds`/`masteredAbilityIds`/hp surfaces
 * structurally). */
export function masteryFoldRuleRuntimeView(context: RuleExecutionContext): MasteryFoldStateView {
  return { round: context.state.round, actors: context.state.actors };
}

export interface MasteryModifierRule {
  /** Exact source id of the mastery unit (e.g. `bastion:catapult:mastery`). */
  sourceId: string;
  /** The parent ability whose execution this rule modifies. */
  abilityId: string;
  /** Source conditions (default: unconditional). */
  gate?: MasteryFoldGate;
  modifier: MasteryModifier;
}

const masteryModifierRules: MasteryModifierRule[] = [];

/** Register a reviewed mastery-modifier rule (content/jobs). */
export function registerMasteryModifierRule(rule: MasteryModifierRule): void {
  masteryModifierRules.push(rule);
}

function ruleHolds(rule: MasteryModifierRule, view: MasteryFoldStateView, actorId: string): boolean {
  const actor = view.actors[actorId];
  if (!actor || !hasMastery(actor, rule.abilityId)) return false;
  switch (rule.gate?.kind ?? 'always') {
    case 'always':
      return true;
    case 'round-at-least':
      return view.round >= rule.gate.value;
    default:
      return false;
  }
}

/**
 * True when every registered rule of the named mastery source unit is
 * satisfied for this actor right now (parent equipped AND mastered AND all
 * source gates holding). Program-level folds that alter a value inside a
 * parent resolver (PERFECT BATTLEMENT's "deals 4 damage instead of 2") ask
 * this instead of re-stating the gate locally, so the source conditions
 * live in exactly one place — the registered rows.
 */
export function masteryModifierActive(
  view: MasteryFoldStateView,
  actorId: string,
  sourceId: string,
): boolean {
  const rules = masteryModifierRules.filter((rule) => rule.sourceId === sourceId);
  if (rules.length === 0) return false;
  return rules.every((rule) => ruleHolds(rule, view, actorId));
}

/**
 * The authoritative per-round interrupt allowance for `abilityId`: the base
 * rank the caller would otherwise use (the source catalog cost value), after
 * every registered `interrupt-rank` mastery rule whose parent is mastered
 * and whose gate holds. Deterministic in registration order; the last match
 * wins, exactly like the range/area kernels' override semantics.
 */
export function effectiveInterruptRank(
  view: MasteryFoldStateView,
  actorId: string,
  abilityId: string,
  baseRank: number,
): number {
  let rank = baseRank;
  for (const rule of masteryModifierRules) {
    if (rule.abilityId !== abilityId || rule.modifier.kind !== 'interrupt-rank') continue;
    if (!ruleHolds(rule, view, actorId)) continue;
    rank = rule.modifier.rank;
  }
  return Math.max(1, Math.floor(rank));
}

/**
 * The authoritative delivery type for a damage instance the parent ability's
 * resolver is about to emit: every registered `damage-type` conversion whose
 * parent is mastered and whose gate hold applies in registration order, so
 * chained conversions compose deterministically. An unmatched base type
 * passes through unchanged — the fold never invents a conversion.
 */
export function convertedDamageType(
  view: MasteryFoldStateView,
  actorId: string,
  abilityId: string,
  baseType: string,
): string {
  let type = baseType;
  for (const rule of masteryModifierRules) {
    if (rule.abilityId !== abilityId || rule.modifier.kind !== 'damage-type') continue;
    if (!ruleHolds(rule, view, actorId)) continue;
    if (rule.modifier.from === type) type = rule.modifier.to;
  }
  return type;
}

/**
 * True when the parent ability's maximum-range bound is removed for this
 * actor ("no maximum range") — the caller keeps owning what its bound
 * applies to; the fold only answers whether it collapses.
 */
export function hasUnlimitedRange(
  view: MasteryFoldStateView,
  actorId: string,
  abilityId: string,
): boolean {
  return masteryModifierRules.some((rule) =>
    rule.abilityId === abilityId
    && rule.modifier.kind === 'unlimited-range'
    && ruleHolds(rule, view, actorId));
}
