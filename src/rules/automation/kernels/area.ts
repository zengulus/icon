import type { RuleSourceUnit } from '../../source-units.js';
import {
  constantModifierValue,
  enumeratedModifierValue,
  foldEnumeratedModifiers,
  foldNumberModifiers,
  modifierRulesForSource,
  registerModifierRule,
  type ModifierFoldView,
  type ModifierGate,
} from '../primitives/modifiers.js';
import { resolveModifierNumber } from './evaluate-modifiers.js';
import type { RuleAction, RuleClauseCompilation, RuleProgramCompilation } from '../primitives/types.js';

/**
 * Area modifier kernel (docs/rules-foundations.md §Area).
 *
 * ICON's AoE vocabulary is the p.97 patterns — Line X, Arc X, Blast
 * (small/medium/large templates), Burst X. The shared geometry
 * (`area-geometry.ts`) owns the deterministic pattern math; this kernel owns
 * the MODIFIER seam: a source unit (talent/mastery) can override the shape
 * or size of its parent ability's area under source-defined gates, and the
 * parent resolver derives its EFFECTIVE area at command time — exactly the
 * shape the range kernel gives listed-range changes.
 *
 * Only the shapes with exact source authority are first-class here: `line`
 * and `arc`. Blast templates are visual-only in the PDF and are deliberately
 * NOT approximated by this kernel; a unit whose complete semantics need an
 * exact blast template stays unresolved (`blast-template`).
 *
 * A content module registers a reviewed `AreaModifierRule` per source unit
 * (`content/jobs/area-recipes.ts`). The kernel never branches on a source
 * ID: `sourceId` is provenance for audit/replay, `abilityId` selects the
 * parent ability the rule modifies, and the gates read current encounter
 * state (round, talent choice, mastery, bloodied/stealth) at command time.
 */

/** The minimal actor read the gates need — satisfied by both the reducer
 * actor and the rule runtime actor view (`RuleActorView`), so resolvers pass
 * their own source actor plus the round. */
export interface AreaStateActor {
  hp?: number;
  maximumHp?: number;
  abilityIds?: readonly string[];
  masteredAbilityIds?: readonly string[];
  talents?: Readonly<Record<string, 1 | 2>>;
  conditions?: ReadonlySet<string>;
}

export interface AreaStateView {
  round: number;
  actor: AreaStateActor;
}

// ── Area modifier registry (U14 shared shape) ───────────────────────────────
//
// The area fold reads the ONE U14 ModifierRule registry
// (`primitives/modifiers.ts`) at the `area-size` (length) and `area-shape`
// (shape override) query points: content rows registered through
// `registerAreaModifierRule` are converted to shared-shape rows, and
// `effectiveAreaFor` folds through the shared `foldNumberModifiers` /
// `foldEnumeratedModifiers` discipline with the shared gate evaluator. The
// `AreaStateActor` / `AreaStateView` read surfaces stay the kernel's public
// API — no consumer changes. The area kernel's historical `talent` gate kind
// maps to the shared rule-level `talent` field (a talent gate reads the
// owner ability's equipped rank).

export type AreaModifierShape = 'line' | 'arc';

/** The source-defined conditions under which an area rule applies — the
 * shared U14 gate union plus the area kernel's historical `talent` gate
 * kind (extracted to the shared rule-level `talent` field at registration). */
export type AreaModifierGate = ModifierGate | { kind: 'talent'; talent: 1 | 2 };

/** A registered area-modifier rule: how one content unit changes its parent
 * ability's area shape/size. The kernel converts each row to shared U14
 * rows — an `area-shape` `set` row and an `area-size` `set` row — so the
 * shape/length fold order and gate logic live exactly once. */
export interface AreaModifierRule {
  /** The exact source unit id that owns this rule (talent/mastery id). */
  sourceId: string;
  /** The parent ability whose area this rule modifies. */
  abilityId: string;
  /** Optional action scope (default: all actions of the ability). */
  actionId?: string;
  /** Shape override (e.g. Sturmreiten mastery: line → arc). */
  shape?: AreaModifierShape;
  /** Length/size override (e.g. Soul Shot talent 2: line 3 → line 6). */
  length?: number;
  /** All listed gates must hold for the rule to apply. */
  gates?: AreaModifierGate[];
}

/** Split a content row's gates into the shared gate list + the extracted
 * rule-level talent rank (the area kernel's `talent` gate kind). */
function splitAreaGates(rule: AreaModifierRule): { gates?: ModifierGate[]; talent?: 1 | 2 } {
  const gates: ModifierGate[] = [];
  let talent: 1 | 2 | undefined;
  for (const gate of rule.gates ?? []) {
    if (gate.kind === 'talent') {
      talent = gate.talent;
    } else {
      gates.push(gate as ModifierGate);
    }
  }
  return {
    ...(gates.length > 0 ? { gates } : {}),
    ...(talent !== undefined ? { talent } : {}),
  };
}

/** Register an area-modifier rule (content/jobs/area-recipes.ts). */
export function registerAreaModifierRule(rule: AreaModifierRule): void {
  const split = splitAreaGates(rule);
  if (rule.shape !== undefined) {
    registerModifierRule({
      sourceId: rule.sourceId,
      ownerId: rule.abilityId,
      queryPoint: 'area-shape',
      scope: 'default',
      operation: 'set',
      // Enumerated replacement (shape is never folded arithmetically).
      value: enumeratedModifierValue(rule.shape),
      ...split,
      ...(rule.actionId !== undefined ? { actionId: rule.actionId } : {}),
    });
  }
  if (rule.length !== undefined) {
    registerModifierRule({
      sourceId: rule.sourceId,
      ownerId: rule.abilityId,
      queryPoint: 'area-size',
      scope: 'default',
      operation: 'set',
      value: constantModifierValue(rule.length),
      ...split,
      ...(rule.actionId !== undefined ? { actionId: rule.actionId } : {}),
    });
  }
}

/** True when any shared-area rule row is registered for `sourceId` (the
 * audit compile reads the shared registry — never a bare allowlist). */
export function hasAreaModifierRule(sourceId: string): boolean {
  return modifierRulesForSource(sourceId, 'area-size').length > 0
    || modifierRulesForSource(sourceId, 'area-shape').length > 0;
}

/** Project an AreaStateView onto the shared U14 fold view. */
function areaFoldView(view: AreaStateView): ModifierFoldView {
  const actor = view.actor;
  return {
    round: view.round,
    actor: {
      id: '',
      hp: actor.hp,
      maximumHp: actor.maximumHp,
      abilityIds: actor.abilityIds,
      masteredAbilityIds: actor.masteredAbilityIds,
      talents: actor.talents,
      conditions: actor.conditions,
    },
    conditionsFor: () => actor.conditions ?? new Set<string>(),
  };
}

/** The authoritative area descriptor for an ability after every registered
 * modifier applies. The caller supplies the base descriptor its program
 * would otherwise use, so both the reducer and the runtime resolvers agree on
 * the same effective authority. Evaluated against current state at command
 * time — a gate that stops holding (round passes, bloodied heals, mastery
 * unequipped) reverts the area immediately. The resolver runs the parent
 * ability, so the ability-equip requirement is implicit. Folds through the
 * shared U14 registry at the `area-size` / `area-shape` query points. */
export function effectiveAreaFor(
  view: AreaStateView,
  actorId: string,
  abilityId: string,
  baseShape: AreaModifierShape,
  baseLength: number,
  actionId?: string,
): { shape: AreaModifierShape; length: number } {
  const foldView = areaFoldView(view);
  const length = foldNumberModifiers('area-size', 'default', baseLength, abilityId, foldView, { actionId }, resolveModifierNumber);
  const shape = foldEnumeratedModifiers('area-shape', 'default', baseShape, abilityId, foldView, { actionId });
  return {
    shape: (shape === 'line' || shape === 'arc' ? shape : baseShape),
    length: Math.max(1, Math.floor(length)),
  };
}

// ── Audit compilation ────────────────────────────────────────────────────────

/** Compile a reviewed area-modifier source unit (a talent or mastery whose
 * COMPLETE semantics are the shape/size change on its parent ability) into
 * the same typed passive vocabulary the other kernel compilers use. The rule
 * is already folded at the parent resolver whenever the actor equips the
 * parent ability and the gates hold, so the program is audit-complete
 * without adding EXECUTE_RULE authority. */
export function compileAreaModifierRecipe(unit: RuleSourceUnit): RuleProgramCompilation | null {
  if (!hasAreaModifierRule(unit.id)) return null;
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
