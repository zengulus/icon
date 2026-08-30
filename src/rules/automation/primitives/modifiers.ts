/**
 * modifiers.ts — U14 MODIFIER / POLICY vocabulary: ONE recipe shape for
 * "how an attached rule alters a typed query point", plus typed PERMISSION
 * query points with closed negatives.
 *
 * ICON modifies its typed query points in many places — listed range
 * (Dark Sliver "gains range 6", p.187), area shape/size overrides (line →
 * arc, line 3 → 6), movement distance, attack boons/curses (p.102), save
 * boons/curses (p.105), interrupt rank, damage die, damage type
 * conversion, bonus damage dice (p.102), and the delivery permissions
 * (cover, aetherwall, dodge, armor, defiance, vigor — p.102/p.104/p.105).
 * Before this module each domain kernel carried its own bespoke recipe
 * shape and fold (range/area/mastery/bonus-damage). This module is the
 * ONE recipe shape + ONE deterministic fold discipline they all read:
 *
 *   ModifierRule { sourceId, ownerId, queryPoint, scope, operation,
 *                  value, gates, talent, actionId, ordering }
 *
 * QUERY POINTS STAY TYPED. A listed range is never a damage die; an
 * interrupt rank is never a movement distance. Each query point folds
 * through the same discipline (registration order, `add` accumulates,
 * the last `override`/`set` wins) but the VALUE means what ITS query
 * point means.
 *
 * PERMISSION is a typed policy query, NOT a separate underlay and NOT a
 * numeric modifier: `cannot` / `ignore` / `immune` are DISTINCT kinds,
 * and the negatives a query point may carry form a CLOSED set
 * (`PERMISSION_NEGATIVES`). A permission rule whose (queryPoint, kind)
 * pair is not in the closed set is rejected at registration — a wildcard
 * "bypass everything" is unrepresentable. This is the plan's "never alias
 * every bypass to Divine" rule: cover-ignore, aetherwall-ignore,
 * armor-ignore, defiance-ignore, and vigor-bypass are distinct pairs.
 *
 * Ownership gate: a rule's `ownerId` is the opaque parent-ability key the
 * fold filters on (the acting actor's ability set — U2 role reads derive
 * WHO the acting actor is; the fold never applies a rule whose owner is
 * not the queried ability). Gates are evaluated against the shared
 * `ModifierFoldView` (conditions, hp ratio, mastery, round, talent,
 * declared choice, target state) — one gate evaluator, never a per-kernel
 * re-implementation.
 *
 * Foundation: no source IDs (sourceId/ownerId are opaque provenance keys),
 * no kernel imports. Uses U1 Reference identity (ownerId is the U1
 * reference key form), U2 ownership (the fold is evaluated for the acting
 * actor), U5 values (numeric folds), U6 predicate gates (the shared gate
 * union is the U6-flavored gate surface), U8 scope (the `scope` string is
 * the named scope within a query point, e.g. 'attack' vs a source-declared
 * internal placement range).
 */
import type { RuleNumber } from './types.js';

// ── Query points ────────────────────────────────────────────────────────────

/** The typed query points the generic modifier fold understands. Each name
 * means exactly its domain-authority meaning: 'listed-range' is the
 * ability's top-level target range, 'internal-range' a source-declared
 * internal placement/selector range, 'area-size' the AoE length/radius,
 * 'interrupt-rank' the per-round interrupt use allowance (p.91), etc. A
 * rule targeting an unknown query point is rejected at registration —
 * never silently folded somewhere else. */
export type ModifierQueryPoint =
  | 'listed-range'
  | 'internal-range'
  | 'area-size'
  | 'area-shape'
  | 'movement-distance'
  | 'target-count'
  | 'damage-dealt'
  | 'damage-taken'
  | 'damage-die'
  | 'attack-boon'
  | 'attack-curse'
  | 'attack-threshold'
  | 'save-boon'
  | 'save-curse'
  | 'save-threshold'
  | 'use-cap'
  | 'interrupt-rank'
  | 'duration'
  | 'resource-cap'
  | 'bonus-damage-dice'
  | 'bonus-damage-flat'
  | 'damage-type';

/** How a rule alters its query point. `add` accumulates (range +1, one more
 * bonus die); `set`/`override` replace the current value (range becomes 6,
 * shape becomes arc, rank becomes 3). The fold applies `add` rules in
 * registration order; the LAST `set`/`override` rule whose gates hold wins,
 * exactly the discipline the range/area kernels already used. */
export type ModifierOperation = 'add' | 'set' | 'override';

// ── Shared gate vocabulary ──────────────────────────────────────────────────

/** The source-defined conditions under which a modifier applies — ONE gate
 * union shared by every fold (range, area, mastery, bonus-damage, …).
 * `talent`/`actionId` are rule-level fields rather than gates because they
 * select the equipped talent rank / action scope of the OWNER ability. */
export type ModifierGate =
  /** Unconditional. */
  | { kind: 'always' }
  /** The acting actor has the stealth condition. */
  | { kind: 'stealth' }
  /** The acting actor is bloodied ("Comeback", at or under 50% of the
   * wounds-adjusted maximum). */
  | { kind: 'comeback' }
  /** The current round is at least `value` (ICON "at round 4 or later"). */
  | { kind: 'round-at-least'; value: number }
  /** The acting actor has mastered the named parent ability. */
  | { kind: 'mastery'; abilityId: string }
  /** The player declared the named talent-use choice at command time
   * (sacrifice-gated range, etc.). Replay carries the recorded choice. */
  | { kind: 'choice'; sourceId: string }
  /** The acting actor is bloodied (self-focused variant; identical to
   * `comeback` — kept as its own kind so the bonus-damage fold's source
   * text maps one-to-one). */
  | { kind: 'self-bloodied' }
  /** The ability's attack target is a bloodied foe. */
  | { kind: 'target-bloodied' }
  /** The ability's attack target is suffering from a status. Without
   * `conditionId`, ANY status qualifies; with one, only that exact
   * condition. */
  | { kind: 'target-has-condition'; conditionId?: string };

/** The shared view gates evaluate against. Every fold adapter (range,
 * area, mastery, bonus-damage) projects its own state onto this shape, so
 * the gate evaluator lives once. Optional members stay absent for the
 * gates that do not need them. */
export interface ModifierFoldView {
  round: number;
  actor: {
    id: string;
    hp?: number;
    maximumHp?: number;
    abilityIds?: readonly string[];
    masteredAbilityIds?: readonly string[];
    talents?: Readonly<Record<string, 1 | 2>>;
    conditions?: ReadonlySet<string>;
    side?: string;
  };
  /** Encounter condition lookup (the stealth gate). */
  conditionsFor(actorId: string): ReadonlySet<string>;
  /** Player-declared talent-use source IDs at command time (the `choice`
   * gate). Absent = no choices declared. */
  selectedTalentSourceIds?: ReadonlySet<string>;
  /** The attack target (the target-bloodied / target-has-condition gates). */
  target?: {
    id: string;
    side: string;
    hp: number;
    maxHp: number;
    conditions: ReadonlySet<string> | ReadonlyArray<{ id: string }>;
  };
}

// ── The one recipe shape ────────────────────────────────────────────────────

/** A value a rule contributes to its query point. Numbers fold arithmetically
 * (ranges, lengths, ranks, dice, flat amounts); `'round'` is the DYNAMIC
 * round number (Open the Gates' "range equal to the round number"); a string
 * is an enumerated replacement (area shape 'arc'/'line', damage-type
 * conversion target). */
export type ModifierValue = number | 'round' | string;

/** ONE recipe shape: how one content unit alters one typed query point. */
export interface ModifierRule {
  /** Exact source unit id that owns this rule (talent/mastery/trait id).
   * Provenance only — never parsed. */
  sourceId: string;
  /** The opaque parent-ability key this rule modifies (the U1 reference-key
   * form). The fold applies the rule only for queries against this owner. */
  ownerId: string;
  /** The typed query point this rule alters. Unknown points reject at
   * registration. */
  queryPoint: ModifierQueryPoint;
  /** A named scope within the query point: 'attack' (the top-level listed
   * range), a source-declared internal placement scope, or 'default' when
   * the query point has no named scopes. Scope filtering keeps e.g. a
   * "increase ALL ranges" rule from leaking into every query point. */
  scope: string;
  operation: ModifierOperation;
  value: ModifierValue;
  /** All listed gates must hold for the rule to apply (absent = always). */
  gates?: readonly ModifierGate[];
  /** Optional talent-equip gate: applies only while the acting actor has
   * this rank selected for the owner ability. */
  talent?: 1 | 2;
  /** Optional action-scope filter (default: all actions of the owner). */
  actionId?: string;
  /** Optional "current value equals" guard (the damage-type conversion's
   * `from` side: convert only while the current type is `from`). Generic —
   * a rule that applies only while the current folded value matches. */
  from?: string;
  /** Explicit fold order (default: registration order). */
  ordering?: number;
}

const modifierRules: ModifierRule[] = [];

/** Register a modifier rule (domain kernels convert their content rows onto
 * this registry). Unknown query points reject at registration — a typo can
 * never silently fold into the wrong authority. */
export function registerModifierRule(rule: ModifierRule): void {
  if (!isModifierQueryPoint(rule.queryPoint)) {
    throw new Error(`Unknown modifier query point '${String(rule.queryPoint)}' — a modifier rule must name a typed query point.`);
  }
  modifierRules.push(rule);
}

/** Closed type guard over the query-point union. */
export function isModifierQueryPoint(value: unknown): value is ModifierQueryPoint {
  return typeof value === 'string' && MODIFIER_QUERY_POINTS.has(value as ModifierQueryPoint);
}

const MODIFIER_QUERY_POINTS: ReadonlySet<string> = new Set<ModifierQueryPoint>([
  'listed-range', 'internal-range', 'area-size', 'area-shape', 'movement-distance',
  'target-count', 'damage-dealt', 'damage-taken', 'damage-die', 'attack-boon',
  'attack-curse', 'attack-threshold', 'save-boon', 'save-curse', 'save-threshold',
  'use-cap', 'interrupt-rank', 'duration', 'resource-cap', 'bonus-damage-dice',
  'bonus-damage-flat', 'damage-type',
]);

/** Evaluate one gate against the shared view. Pure — a deterministic
 * function of the durable view; replay folds identically. */
export function modifierGateHolds(gate: ModifierGate, view: ModifierFoldView): boolean {
  const actor = view.actor;
  switch (gate.kind) {
    case 'always':
      return true;
    case 'stealth':
      return view.conditionsFor(actor.id).has('stealth');
    case 'comeback':
    case 'self-bloodied': {
      const maximum = actor.maximumHp ?? 0;
      return maximum > 0 && (actor.hp ?? 0) <= maximum / 2;
    }
    case 'round-at-least':
      return view.round >= gate.value;
    case 'mastery':
      // The shared mastery gate matches `kernels/mastery.ts` `hasMastery`:
      // the parent ability must be equipped AND mastered — a mastery must
      // never fire for an unequipped parent.
      return Boolean((actor.abilityIds ?? []).includes(gate.abilityId)
        && (actor.masteredAbilityIds ?? []).includes(gate.abilityId));
    case 'choice':
      return view.selectedTalentSourceIds?.has(gate.sourceId) ?? false;
    case 'target-bloodied': {
      const target = view.target;
      return Boolean(target && target.side !== actor.side && target.maxHp > 0 && target.hp <= target.maxHp / 2);
    }
    case 'target-has-condition': {
      const target = view.target;
      if (!target || target.side === actor.side) return false;
      const conditions = target.conditions;
      // The target's condition surface is Set-shaped (rule view) or
      // array-shaped (encounter actor) — one shared read either way.
      if ('size' in conditions) {
        if (gate.conditionId === undefined) return conditions.size > 0;
        return conditions.has(gate.conditionId);
      }
      if (gate.conditionId === undefined) return conditions.length > 0;
      return conditions.some((condition) => condition.id === gate.conditionId);
    }
  }
}

/** Whether ONE registered rule applies right now (owner matches, action
 * scope matches, talent rank matches, every gate holds). The shared gate
 * evaluator — exported so the mastery-fold's whole-source check and any
 * other kernel read the same holds test. */
export function modifierRuleHolds(
  rule: ModifierRule,
  view: ModifierFoldView,
  ownerAbilityId: string,
  options: { actionId?: string },
): boolean {
  if (rule.ownerId !== ownerAbilityId) return false;
  if (rule.actionId !== undefined && rule.actionId !== options.actionId) return false;
  if (rule.talent !== undefined && view.actor.talents?.[ownerAbilityId] !== rule.talent) return false;
  return (rule.gates ?? []).every((gate) => modifierGateHolds(gate, view));
}

/** The registered rules that apply to `queryPoint` at `scope` for `ownerId`
 * right now, in deterministic fold order (explicit `ordering` asc, then
 * registration order). The domain kernels keep their typed result assembly
 * but read this shared selection — no kernel re-implements a gate. */
export function applicableModifierRules(
  queryPoint: ModifierQueryPoint,
  scope: string,
  ownerAbilityId: string,
  view: ModifierFoldView,
  options: { actionId?: string } = {},
): ModifierRule[] {
  return modifierRules
    .filter((rule) => rule.queryPoint === queryPoint && rule.scope === scope)
    .filter((rule) => modifierRuleHolds(rule, view, ownerAbilityId, options))
    .sort((a, b) => (a.ordering ?? Number.MAX_SAFE_INTEGER) - (b.ordering ?? Number.MAX_SAFE_INTEGER));
}

/** The registered rows owned by one source unit at one query point (or any
 * query point when omitted). Audit compilers use this to decide whether a
 * source unit's semantics are genuinely wired — a compile never audits
 * complete on a bare allowlist. */
export function modifierRulesForSource(
  sourceId: string,
  queryPoint?: ModifierQueryPoint,
): ModifierRule[] {
  return modifierRules.filter((rule) => rule.sourceId === sourceId
    && (queryPoint === undefined || rule.queryPoint === queryPoint));
}

/** Resolve a rule's dynamic value: `'round'` → the current round. */
export function resolvedModifierValue(rule: ModifierRule, view: ModifierFoldView): number | string {
  return rule.value === 'round' ? view.round : rule.value;
}

/** The numeric fold for a query point: start from `base` and apply every
 * applicable rule — `add` accumulates, the LAST `set`/`override` wins
 * (deterministic, registration order). `'round'` values resolve to the
 * current round. This is the ONE numeric fold discipline every numeric
 * query point uses. */
export function foldNumberModifiers(
  queryPoint: ModifierQueryPoint,
  scope: string,
  base: number,
  ownerAbilityId: string,
  view: ModifierFoldView,
  options: { actionId?: string } = {},
): number {
  let value = base;
  for (const rule of applicableModifierRules(queryPoint, scope, ownerAbilityId, view, options)) {
    const resolved = resolvedModifierValue(rule, view);
    if (typeof resolved !== 'number') continue;
    value = rule.operation === 'add' ? value + resolved : resolved;
  }
  return value;
}

/** The last-applied enumerated value for a query point (shape overrides,
 * damage-type conversions): iterate applicable rules, the last `set`/
 * `override` wins. `from`-guarded rules apply only while the current value
 * equals `from` (chained conversions compose deterministically). Returns
 * the base value when no rule replaces it — the fold never invents a
 * replacement. */
export function foldEnumeratedModifiers(
  queryPoint: ModifierQueryPoint,
  scope: string,
  base: string,
  ownerAbilityId: string,
  view: ModifierFoldView,
  options: { actionId?: string } = {},
): string {
  let value = base;
  for (const rule of applicableModifierRules(queryPoint, scope, ownerAbilityId, view, options)) {
    const resolved = resolvedModifierValue(rule, view);
    if (typeof resolved !== 'string') continue;
    if (rule.from !== undefined && rule.from !== value) continue;
    value = resolved;
  }
  return value;
}

// ── Permission query points (closed negatives) ──────────────────────────────

/** The distinct permission kinds a permission rule may carry. NEVER
 * collapsed into one boolean: `cannot` (prohibited), `ignore` (bypass one
 * named defense), and `immune` (the query point does not apply) are
 * different semantics. */
export type PermissionKind = 'cannot' | 'ignore' | 'immune';

/** The typed permission query points. Each is a distinct defense/delivery
 * boundary — cover is not aetherwall is not armor — so a grant for one
 * never aliases to "bypass everything" (the plan's never-alias-to-Divine
 * rule). */
export type PermissionQueryPoint =
  | 'cover'
  | 'aetherwall'
  | 'dodge'
  | 'armor'
  | 'defiance'
  | 'vigor'
  | 'range-bound'
  | 'delivery'
  | 'trigger';

/** The CLOSED negative registry: for each permission query point, exactly
 * the negative kinds the source defines. A rule requesting a pair outside
 * this set is rejected at registration — a wildcard bypass is
 * unrepresentable. 'range-bound' is immune-only ("no maximum range"); the
 * defense boundaries (cover/aetherwall/dodge/armor/defiance/vigor) are
 * ignore-only as negatives today; 'delivery'/'trigger' are cannot-only
 * (permission to deny a delivery/trigger). */
export const PERMISSION_NEGATIVES: Readonly<Record<PermissionQueryPoint, readonly PermissionKind[]>> = {
  cover: ['ignore'],
  aetherwall: ['ignore'],
  dodge: ['ignore'],
  armor: ['ignore'],
  defiance: ['ignore'],
  vigor: ['ignore'],
  'range-bound': ['immune'],
  delivery: ['cannot'],
  trigger: ['cannot'],
};

/** A registered permission rule: one source unit grants/denies one typed
 * permission under its gates. */
export interface PermissionRule {
  /** Exact source unit id that owns this rule (provenance only). */
  sourceId: string;
  /** The opaque owner-ability key this permission is scoped to. */
  ownerId: string;
  queryPoint: PermissionQueryPoint;
  kind: PermissionKind;
  /** Named scope within the query point (default 'default'). */
  scope?: string;
  gates?: readonly ModifierGate[];
  talent?: 1 | 2;
  actionId?: string;
}

const permissionRules: PermissionRule[] = [];

/** Register a permission rule. The (queryPoint, kind) pair MUST be in the
 * closed negative registry — a rule like `{ queryPoint: 'cover', kind:
 * 'immune' }` or any unlisted pair rejects, so a typo can never silently
 * widen a bypass. */
export function registerPermissionRule(rule: PermissionRule): void {
  const allowed = PERMISSION_NEGATIVES[rule.queryPoint];
  if (!allowed) {
    throw new Error(`Unknown permission query point '${rule.queryPoint}'.`);
  }
  if (!allowed.includes(rule.kind)) {
    throw new Error(`Permission ${rule.kind} is not a closed negative of ${rule.queryPoint} (allowed: ${allowed.join(', ')}) — a wildcard bypass is unrepresentable.`);
  }
  permissionRules.push(rule);
}

function permissionHolds(rule: PermissionRule, view: ModifierFoldView, ownerAbilityId: string, options: { actionId?: string }): boolean {
  if (rule.ownerId !== ownerAbilityId) return false;
  if (rule.actionId !== undefined && rule.actionId !== options.actionId) return false;
  if (rule.talent !== undefined && view.actor.talents?.[ownerAbilityId] !== rule.talent) return false;
  return (rule.gates ?? []).every((gate) => modifierGateHolds(gate, view));
}

/** The effective permission at a query point: the LAST applicable rule's
 * kind, or null when no rule grants/denies. Deterministic in registration
 * order. `cannot`/`ignore`/`immune` stay distinct — a caller asking
 * "can this delivery happen?" must compare against its own query point's
 * semantics, never against one collapsed boolean. */
export function effectivePermission(
  queryPoint: PermissionQueryPoint,
  ownerAbilityId: string,
  view: ModifierFoldView,
  scope: string = 'default',
  options: { actionId?: string } = {},
): PermissionKind | null {
  let effective: PermissionKind | null = null;
  for (const rule of permissionRules) {
    if (rule.queryPoint !== queryPoint) continue;
    if ((rule.scope ?? 'default') !== scope) continue;
    if (!permissionHolds(rule, view, ownerAbilityId, options)) continue;
    effective = rule.kind;
  }
  return effective;
}

/** Convenience: is the named permission currently granted (any kind)? */
export function permissionGranted(
  queryPoint: PermissionQueryPoint,
  ownerAbilityId: string,
  view: ModifierFoldView,
  scope: string = 'default',
  options: { actionId?: string } = {},
): boolean {
  return effectivePermission(queryPoint, ownerAbilityId, view, scope, options) !== null;
}
