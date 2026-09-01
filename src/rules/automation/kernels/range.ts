import type { RuleSourceUnit } from '../../source-units.js';
import type { Position } from '../../types.js';
import { footprintDistance } from '../primitives/spatial-intent.js';
import {
  constantModifierValue,
  foldNumberModifiers,
  modifierRulesForSource,
  registerModifierRule,
  roundModifierValue,
  type ModifierFoldView,
} from '../primitives/modifiers.js';
import { resolveModifierNumber } from './evaluate-modifiers.js';
import type { RuleAction, RuleClauseCompilation, RuleProgramCompilation } from '../primitives/types.js';

/**
 * Range/distance kernel (docs/rules-foundations.md §Range).
 *
 * ICON range semantics split into two distinct families, and this module is
 * the single reusable authority for both:
 *
 *   1. TARGET LEGALITY — "can this ability legally choose this target?" The
 *      listed range of an ability can be modified (added to, overridden,
 *      conditionally enlarged, made dynamic), and that modification must
 *      affect authoritative target validation, never only UI display.
 *   2. DISTANCE-DEPENDENT EFFECTS — "given a legal use, does the distance
 *      change the result?" Exact-range and distance-gated predicates
 *      (Trigrammaton's "at exactly range 3", Aetherwall's "outside range 2")
 *      inspect distance without ever expanding a targeting range.
 *
 * Distance is always the engine's canonical p.92 footprint metric
 * (`footprintDistance`, L∞ from the edge of the origin space) — there is
 * exactly one distance implementation, shared by targeting, area centers,
 * auras, and these predicates.
 *
 * A content module registers a reviewed `RangeModifierRule` per source unit
 * (`content/jobs/range-recipes.ts`). The kernel never branches on a source
 * ID: `sourceId` is provenance for audit/replay, `abilityId` selects the
 * parent ability the rule modifies, and the gate reads current encounter
 * state (stealth, bloodied/comeback, mastery) at command time.
 */

/** The minimal read surface both the reducer state (`EncounterState`) and the
 * rule runtime view (`RuleRuntimeState`) satisfy: positions/sizes for the
 * canonical distance, the round number for dynamic ranges, and the
 * condition/HP/mastery reads the gates need. */
export interface RangeStateView {
  round: number;
  actors: Readonly<Record<string, {
    id: string;
    position: Position | null;
    size?: number;
    hp?: number;
    maximumHp?: number;
    abilityIds?: readonly string[];
    masteredAbilityIds?: readonly string[];
    /** The equipped talent choice per ability (1 or 2) — a talent-gated rule
     * applies only when the actor selected the rank that owns the rule. */
    talents?: Readonly<Record<string, 1 | 2>>;
    /** The durable slow-turn flag (the `charge` gate — Charge fires on a
     * slow turn; the same flag `deriveTriggers` turns into the `charge`
     * trigger, so a charge-gated rule can never fire on a Heroic alone). */
    slowTurn?: boolean;
  }>>;
  /** The encounter condition set for an actor (the stealth gate). */
  conditionsFor(actorId: string): ReadonlySet<string>;
  /** Player-declared talent-use source IDs at command time (Dark Sliver
   * talent 2's sacrifice-gated range, etc.). Absent = no choices declared. */
  selectedTalentSourceIds?: ReadonlySet<string>;
}

/** The canonical distance between two actors: the shared p.92 footprint
 * metric (L∞ between occupied footprints). Size-1 actors collapse to the
 * point-cell Chebyshev distance. */
export function distanceBetween(view: RangeStateView, fromId: string, toId: string): number {
  const from = view.actors[fromId];
  const to = view.actors[toId];
  if (!from?.position || !to?.position) return Number.POSITIVE_INFINITY;
  return footprintDistance(
    { position: from.position, size: from.size },
    { position: to.position, size: to.size },
  );
}

/** Is `toId` within `range` (inclusive) of `fromId`? */
export function isWithinRange(view: RangeStateView, fromId: string, toId: string, range: number): boolean {
  return distanceBetween(view, fromId, toId) <= range;
}

/** Is `toId` at exactly `range` from `fromId`? Exact-range predicates inspect
 * distance; they never change a targeting range. */
export function isExactlyRange(view: RangeStateView, fromId: string, toId: string, range: number): boolean {
  return distanceBetween(view, fromId, toId) === range;
}

// ── Range modifier registry (U14 shared shape) ─────────────────────────────
//
// The range fold reads the ONE U14 ModifierRule registry
// (`primitives/modifiers.ts`) at the `listed-range` query point: content
// rows registered through `registerRangeModifierRule` are converted to
// shared-shape rows, and `effectiveScopedRange` folds through the shared
// `foldNumberModifiers` discipline (registration order, add accumulates,
// last override wins, shared gate evaluator). The gate vocabulary and the
// `RangeStateView` read surface stay the range kernel's public API — no
// consumer changes.

/** The fold mode: `add` accumulates, `override` replaces (the shared
 * ModifierOperation, restricted to the two the range kernel uses). */
export type RangeModifierMode = 'add' | 'override';

/** The source-defined conditions under which a range rule applies — the
 * shared U14 gate union (stealth / comeback / mastery / choice, plus the
 * other gates the shared evaluator understands). */
export type RangeModifierGate = import('../primitives/modifiers.js').ModifierGate;

/** A registered range-modifier rule: how one content unit modifies its parent
 * ability's listed range. This is the U14 `ModifierRule` shape restricted to
 * the `listed-range` query point — the kernel converts each row to shared
 * rows (one per declared scope) at registration. */
export interface RangeModifierRule {
  /** The exact source unit id that owns this rule (talent/mastery id). */
  sourceId: string;
  /** The parent ability whose listed range this rule modifies. */
  abilityId: string;
  mode: RangeModifierMode;
  /** Fixed value, or `'round'` for a dynamic range equal to the round number
   * (Open the Gates talent 2). */
  value: number | 'round';
  /** Optional action scope (default: all actions of the ability). */
  actionId?: string;
  /** Optional talent-equip gate: the rule applies only while the acting
   * actor has this rank selected for the parent ability (a talent source
   * unit never applies to an actor who did not choose it). */
  talent?: 1 | 2;
  /** Optional condition gate evaluated against the acting actor at command
   * time. Without a gate the rule always applies. */
  gate?: RangeModifierGate;
  /** Optional named range scopes the rule modifies. A rule without an
   * explicit scope list modifies the top-level attack range (`'attack'`).
   * Source-declared INTERNAL ranges (placement selectors such as a soul-
   * space or slay-placement) query the same authority by scope key, so a
   * reviewed modifier like "increase ALL ranges by +1" (Dark Sliver talent
   * 1, p.185) can declare every range it widens — the resolver never
   * duplicates the gate logic. */
  scopes?: ReadonlyArray<string>;
}

/** The scope keys a rule applies to: its declared `scopes`, or the default
 * top-level `'attack'` scope when none are declared. */
function ruleScopes(rule: RangeModifierRule): readonly string[] {
  return rule.scopes ?? ['attack'];
}

/** Register a range-modifier rule (content/jobs/range-recipes.ts). Each
 * declared scope becomes one shared U14 ModifierRule row at the
 * `listed-range` query point; the fold and the content audits read the
 * shared registry, so the range gate logic lives exactly once. */
export function registerRangeModifierRule(rule: RangeModifierRule): void {
  for (const scope of ruleScopes(rule)) {
    registerModifierRule({
      sourceId: rule.sourceId,
      ownerId: rule.abilityId,
      queryPoint: 'listed-range',
      scope,
      operation: rule.mode,
      // The adapter surface keeps the `'round'` shorthand; it translates to
      // the U5 `{ kind: 'round' }` RuleNumber at the boundary — the shared
      // fold itself never special-cases a dynamic literal.
      value: rule.value === 'round' ? roundModifierValue() : constantModifierValue(rule.value),
      ...(rule.gate ? { gates: [rule.gate] } : {}),
      ...(rule.talent !== undefined ? { talent: rule.talent } : {}),
      ...(rule.actionId !== undefined ? { actionId: rule.actionId } : {}),
    });
  }
}

/** The union of scope keys the registered rules for `sourceId` modify, or
 * null when no range rule is registered for the unit. The compound-talent
 * completeness manifest uses this to require every scope a compound talent's
 * complete semantics need. Reads the shared registry. */
export function rangeModifierRuleScopes(sourceId: string): ReadonlySet<string> | null {
  const rules = modifierRulesForSource(sourceId, 'listed-range');
  if (rules.length === 0) return null;
  return new Set(rules.map((rule) => rule.scope));
}

/** Project a RangeStateView + actor onto the shared U14 fold view. */
function rangeFoldView(view: RangeStateView, actorId: string): ModifierFoldView {
  const actor = view.actors[actorId];
  return {
    round: view.round,
    actor: {
      id: actorId,
      hp: actor?.hp,
      maximumHp: actor?.maximumHp,
      abilityIds: actor?.abilityIds,
      masteredAbilityIds: actor?.masteredAbilityIds,
      talents: actor?.talents,
      slowTurn: view.actors[actorId]?.slowTurn === true,
    },
    conditionsFor: (id) => view.conditionsFor(id),
    ...(view.selectedTalentSourceIds ? { selectedTalentSourceIds: view.selectedTalentSourceIds } : {}),
  };
}

/**
 * The authoritative range of `abilityId` at one named scope after every
 * registered modifier for the ability (scoped to `actionId` when given)
 * applies. The `'attack'` scope is the ability's top-level target range;
 * source-declared internal ranges (terrain/slay placement selectors) query
 * the same authority with their own scope key, so a reviewed modifier such
 * as "increase all ranges by +1" widens every range it declares — the
 * resolver never re-implements the gate. The caller supplies the base range
 * it would otherwise use (the source catalog range for USE_ABILITY, the
 * program action's range for EXECUTE_RULE, the source placement radius for
 * an internal selector), so every consumer agrees on the same effective
 * authority. Evaluated against the current encounter state at command time —
 * a conditional gate that stops being true (stealth lost, healed above
 * half) shrinks the range back immediately. Folds through the shared U14
 * `foldNumberModifiers` at the `listed-range` query point.
 */
export function effectiveScopedRange(
  view: RangeStateView,
  actorId: string,
  abilityId: string,
  baseRange: number,
  scope: string,
  actionId?: string,
): number {
  const range = foldNumberModifiers(
    'listed-range',
    scope,
    baseRange,
    abilityId,
    rangeFoldView(view, actorId),
    { actionId },
    // Numeric modifier values are U5 RuleNumbers resolved through the
    // kernel-layer resolver (constants + the dynamic round + pure
    // compositions; anything richer fails closed).
    resolveModifierNumber,
  );
  return Math.max(0, Math.floor(range));
}

/** The authoritative top-level target range of an ability: the `'attack'`
 * scope of `effectiveScopedRange`, kept as the primary command-gate surface.
 * Both USE_ABILITY and EXECUTE_RULE read this before accepting a target. */
export function effectiveAbilityRange(
  view: RangeStateView,
  actorId: string,
  abilityId: string,
  baseRange: number,
  actionId?: string,
): number {
  return effectiveScopedRange(view, actorId, abilityId, baseRange, 'attack', actionId);
}

// ── Audit compilation ────────────────────────────────────────────────────────

/** Compile a reviewed range-modifier source unit (a talent or mastery whose
 * COMPLETE semantics are the listed-range change — never a distance
 * predicate, which belongs to the attack/damage modifiers) into the same
 * typed passive vocabulary the other kernel compilers use. The rule is
 * already folded at both command gates whenever the actor equips the parent
 * ability and the gate holds, so the program is audit-complete without
 * adding EXECUTE_RULE authority. */
export function compileRangeModifierRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  if (!rangeModifierRuleScopes(unit.id)) return null;
  const clause: RuleClauseCompilation = {
    id: `${unit.id}:clause:1`,
    label: 'passive',
    text: unit.rulesText,
    effects: [],
    complete: true,
    unsupportedText: '',
  };
  const action: RuleAction = {
    id: 'default',
    name: unit.name,
    timing: 'passive',
    costs: [],
    tags: [],
    range: null,
    area: null,
    choices: [],
    steps: [{ id: `${unit.id}:projection`, timing: 'passive', effects: [] }],
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
