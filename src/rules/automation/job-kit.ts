import { resolveCureMutations } from './status-saves.js';
import { attackDamageProvenance, resolveAttackRoll, type AttackDamageProvenance } from './attack-resolution.js';
import { axisDirection, lineCells, orthogonalNeighbors, sameCell, squareArea } from '../area-geometry.js';
import type { Position } from '../types.js';
import type { RuleSourceUnit } from '../source-units.js';
import type {
  RuleAction,
  RuleActorView,
  RuleClauseCompilation,
  RuleCost,
  RuleDuration,
  RuleEffect,
  RuleExecutionContext,
  RuleMutation,
  RuleNumber,
  RulePredicate,
  RuleProgram,
  RuleProgramCompilation,
  RuleSelector,
} from './types.js';

/**
 * job-kit.ts — the shared building blocks every job's ability program is
 * assembled from.
 *
 * The first five job slices (Bastion, Demon Slayer, Colossus, Knave, Fool)
 * each inlined their own copies of these helpers. They have been consolidated
 * here so a new job only has to author its ability-specific resolvers and the
 * `*_ABILITY_PROGRAMS` map; everything else is imported from one place.
 *
 * A job file still exports two things, unchanged:
 * - `X_RULE_RESOLVERS: RuleResolverRegistry` — named, deterministic resolvers.
 * - `X_ABILITY_PROGRAMS: Readonly<Record<string, (unit) => RuleProgramCompilation>>`
 *   — the typed program + clause map, keyed by `sourceId` (e.g. `stray:…`).
 *
 * See `docs/job-template.md` for the step-by-step recipe, the four wiring
 * points, and the fixture pattern.
 *
 * Semantics notes:
 * - `walk` is entity-aware: non-phasing movement stops at other characters and
 *   entities; phasing movement passes through both. Both stop at impassable
 *   terrain and the grid edge. (This is the stricter, more correct of the two
 *   movement helpers the earlier jobs inlined — the Knave variant ignored
 *   entities.)
 * - `resolveAttack` mirrors the generic VM's `attack` effect so resolver-driven
 *   attacks report the identical mutation shape and honor evasion, elevation,
 *   boons, and the Dazed curse.
 */

// Re-export area geometry so a job file has a single import point.
export { axisDirection, lineCells, orthogonalNeighbors, sameCell, squareArea };

// ── Selectors ────────────────────────────────────────────────────────────────
export const self: RuleSelector = { kind: 'self' };
export const attackTarget: RuleSelector = { kind: 'attack-target' };
export const triggerSource: RuleSelector = { kind: 'trigger-source' };
export const triggerTargets: RuleSelector = { kind: 'trigger-targets' };

/** Single-actor choice selector: "choose one {relation} in range". */
export const inputTarget = (relation: 'ally' | 'foe' | 'any', range: number): RuleSelector => ({
  kind: 'input', key: 'target', relation, minimum: 1, maximum: 1, range: constant(range),
});

// ── Numbers ──────────────────────────────────────────────────────────────────
export const constant = (value: number): RuleNumber => ({ kind: 'constant', value });
export const damageDie = (dice: number): RuleNumber => ({ kind: 'damage-roll', actor: self, dice: constant(dice) });
export const fray = (): RuleNumber => ({ kind: 'stat', actor: self, stat: 'fray' });
export const die = (sides: number, count: RuleNumber = constant(1)): RuleNumber => ({ kind: 'die', sides, count });
export const add = (...values: RuleNumber[]): RuleNumber => ({ kind: 'add', values });

// ── Effects ──────────────────────────────────────────────────────────────────
type DamageDelivery = 'hit' | 'miss' | 'area' | 'effect' | 'save-success' | 'terrain';
type DamageType = 'normal' | 'piercing' | 'divine' | 'sacrifice';
type StateValue = string | number | boolean | null;

export const normalDamage = (amount: RuleNumber, delivery: 'hit' | 'miss' = 'hit'): RuleEffect => ({
  kind: 'damage', target: attackTarget, amount, damageType: 'normal', delivery,
});

/** Declarative condition-application effects (resolved by the generic VM). */
export const status = (conditionId: string): RuleEffect => ({ kind: 'condition', target: attackTarget, conditionId, operation: 'apply', potency: 'normal' });
export const statusOn = (target: RuleSelector, conditionId: string): RuleEffect => ({ kind: 'condition', target, conditionId, operation: 'apply', potency: 'normal' });

/** The canonical weapon attack: [D]+fray on a hit, fray on a miss, +1[D] on a
 * critical. `boons` and `trueStrike` are optional; the VM resolves the roll. */
export const attackStep = (overrides: Partial<{ boons: number; trueStrike: boolean; dice: number }> = {}): RuleEffect => ({
  kind: 'attack',
  target: attackTarget,
  trueStrike: overrides.trueStrike ?? false,
  ...(overrides.boons ? { boons: constant(overrides.boons) } : {}),
  onHit: [normalDamage(add(damageDie(overrides.dice ?? 1), fray()))],
  onMiss: [normalDamage(fray(), 'miss')],
  onCritical: [normalDamage(damageDie(1))],
});

// ── Geometry / state ─────────────────────────────────────────────────────────
export const distance = (first: Position, second: Position) =>
  Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));

export const withinGrid = (position: Position, context: RuleExecutionContext) =>
  position.x >= 0 && position.y >= 0 && position.x < context.state.grid.width && position.y < context.state.grid.height;

export const sourceActor = (context: RuleExecutionContext, id: string): RuleActorView =>
  context.state.actors[id];

/** True when a character (other than `excludeId`) or an entity occupies the cell. */
export const occupied = (position: Position, context: RuleExecutionContext, excludeId = '') =>
  Object.values(context.state.actors).some((actor) => actor.id !== excludeId && actor.position && sameCell(actor.position, position))
  || Object.values(context.state.entities).some((entity) => entity.position && sameCell(entity.position, position));

export const impassable = (position: Position, context: RuleExecutionContext) =>
  !withinGrid(position, context) || context.state.terrainAt(position).has('impassable');

// ── Movement ─────────────────────────────────────────────────────────────────
/**
 * Walk up to `steps` cells in one orthogonal direction from `start`, returning
 * the final position. Stops at the grid edge, impassable terrain, and — unless
 * `phasing` — another character or entity. `excludeIds` names additional
 * actors whose cells do not block the walk.
 */
export function walk(
  context: RuleExecutionContext,
  start: Position,
  direction: Position,
  steps: number,
  phasing: boolean,
  moverId: string,
  options: { excludeIds?: ReadonlySet<string> } = {},
): Position {
  const excludeIds = options.excludeIds ?? new Set<string>();
  let position = { ...start };
  for (let step = 0; step < steps; step += 1) {
    const next = { x: position.x + Math.sign(direction.x), y: position.y + Math.sign(direction.y) };
    if (impassable(next, context)) break;
    if (!phasing) {
      const blockedByActor = Object.values(context.state.actors).some(
        (actor) => actor.id !== moverId && !excludeIds.has(actor.id) && actor.position && sameCell(actor.position, next),
      );
      const blockedByEntity = Object.values(context.state.entities).some((entity) => entity.position && sameCell(entity.position, next));
      if (blockedByActor || blockedByEntity) break;
    }
    position = next;
  }
  return position;
}

/** All in-grid, unoccupied cells within Chebyshev radius of `center`, sorted by
 * distance then coordinates so default placement is stable. */
export function freeCellsInRange(context: RuleExecutionContext, center: Position, radius: number): Position[] {
  const cells: Position[] = [];
  for (const cell of squareArea(center, radius)) {
    if (!withinGrid(cell, context) || sameCell(cell, center)) continue;
    if (occupied(cell, context, '')) continue;
    cells.push(cell);
  }
  return cells.sort((a, b) => distance(center, a) - distance(center, b) || a.x - b.x || a.y - b.y);
}

/** The first in-grid, unoccupied cell from a candidate list, else null. */
export function firstFreeCell(context: RuleExecutionContext, cells: Position[], excludeId: string): Position | null {
  return cells.find((cell) => withinGrid(cell, context) && !occupied(cell, context, excludeId)) ?? null;
}

// ── Selection ────────────────────────────────────────────────────────────────
/** The nearest foe to `position`, ties broken by id for determinism. */
export function nearestFoe(context: RuleExecutionContext, position: Position, selfId: string): RuleActorView | undefined {
  const selfView = context.state.actors[selfId];
  return Object.values(context.state.actors)
    .filter((actor) => actor.id !== selfId && selfView && actor.side !== selfView.side && actor.position)
    .sort((a, b) => distance(a.position!, position) - distance(b.position!, position) || a.id.localeCompare(b.id))[0];
}

/** Dominant-axis direction toward the nearest foe (context.actorId), else +x. */
export function rushTowardFoes(context: RuleExecutionContext, position: Position): Position {
  const selfView = context.state.actors[context.actorId];
  const foes = Object.values(context.state.actors)
    .filter((candidate) => selfView && candidate.side !== selfView.side && candidate.position)
    .sort((a, b) => distance(a.position!, position) - distance(b.position!, position) || a.id.localeCompare(b.id));
  return foes[0]?.position ? axisDirection(position, foes[0].position) : { x: 1, y: 0 };
}

/** The eight surrounding cells in clockwise order, starting directly north. */
export function ringAround(center: Position): Position[] {
  return [
    { x: center.x, y: center.y - 1 },
    { x: center.x + 1, y: center.y - 1 },
    { x: center.x + 1, y: center.y },
    { x: center.x + 1, y: center.y + 1 },
    { x: center.x, y: center.y + 1 },
    { x: center.x - 1, y: center.y + 1 },
    { x: center.x - 1, y: center.y },
    { x: center.x - 1, y: center.y - 1 },
  ];
}

// ── Attack ───────────────────────────────────────────────────────────────────
export interface AttackResolution {
  attackMutation: RuleMutation;
  hit: boolean;
  critical: boolean;
  /** Explicit p.89/p.104 facts for direct hit/miss damage emitted after this
   * resolver attack. */
  damageProvenance: AttackDamageProvenance;
}

/** Resolver functions emit mutations synchronously. This private weak map
 * lets the common damage builder consume the immediately preceding attack's
 * durable rules facts without mutating command input or leaking them into VM
 * branches. It is restricted to the matching target and hit/miss delivery. */
const resolvedAttackDamage = new WeakMap<RuleExecutionContext, Map<string, AttackDamageProvenance>>();

function rememberAttackDamage(context: RuleExecutionContext, targetId: string, provenance: AttackDamageProvenance) {
  const byTarget = resolvedAttackDamage.get(context) ?? new Map<string, AttackDamageProvenance>();
  byTarget.set(targetId, provenance);
  resolvedAttackDamage.set(context, byTarget);
}

function directAttackDamageProvenance(
  context: RuleExecutionContext,
  targetId: string,
  delivery: DamageDelivery,
): AttackDamageProvenance | undefined {
  if (delivery !== 'hit' && delivery !== 'miss') return undefined;
  const remembered = resolvedAttackDamage.get(context)?.get(targetId);
  if (remembered) return remembered;
  // Auto-hit named resolvers can intentionally emit a direct attack mutation
  // without calling resolveAttack. They still receive the universal p.89
  // high-ground cover exception; auto-hits never need a miss-Dodge exception.
  const source = context.state.actors[context.actorId];
  const target = context.state.actors[targetId];
  if (!source?.position || !target?.position) return undefined;
  return attackDamageProvenance({
    elevationModifier: context.state.elevationAt(source.position) - context.state.elevationAt(target.position),
  });
}

/** Deterministic attack roll shared with the generic VM and basic attack path. */
export function resolveAttack(
  context: RuleExecutionContext,
  source: RuleActorView,
  target: RuleActorView,
  options: { boons?: number; trueStrike?: boolean; autoHit?: boolean } = {},
): AttackResolution {
  const attack = resolveAttackRoll({
    defense: target.defense,
    sourceBoon: options.boons ?? 0,
    elevationModifier: source.position && target.position ? context.state.elevationAt(source.position) - context.state.elevationAt(target.position) : 0,
    sourceDazed: source.conditions.has('dazed'),
    targetEvasion: target.conditions.has('evasion'),
    trueStrike: options.trueStrike ?? false,
    autoHit: options.autoHit ?? false,
  }, context.dice);
  const { d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit, ignoreDodge, ignoreCover } = attack;
  const damageProvenance = { ignoreDodge, ignoreCover };
  rememberAttackDamage(context, target.id, damageProvenance);
  const attackMutation: RuleMutation = {
    kind: 'attack', sourceId: context.sourceId, actorId: source.id, targetId: target.id, d20, boon, total, hit, critical, evasionRoll, trueStrike, autoHit,
  };
  return { attackMutation, hit, critical, damageProvenance };
}

// ── Durations ────────────────────────────────────────────────────────────────
export const untilNextTurnEnd: RuleDuration = { kind: 'turn-end', actor: self, turns: 2 };
export const untilNextTurnStart: RuleDuration = { kind: 'turn-start', actor: self, turns: 1 };

// ── Mutation builders ────────────────────────────────────────────────────────
/**
 * Exact source-specific damage exceptions. Do not substitute a broader damage
 * type (especially Divine) for a partial exception: p.144 Bleak Mercy ignores
 * Armor, Defiance, and Vigor but still permits Resistance, Cover, Aetherwall,
 * Pacified, and Hatred mitigation. Add a field only with source text, event
 * replay coverage, and held-damage persistence where it affects application.
 */
export interface DamageProvenance extends Partial<AttackDamageProvenance> {
  bypassVigor?: boolean;
  ignoreArmor?: boolean;
  ignoreDefiance?: boolean;
}

export const damageMutation = (
  context: RuleExecutionContext,
  actorId: string,
  amount: number,
  delivery: DamageDelivery = 'effect',
  damageType: DamageType = 'normal',
  provenance: DamageProvenance = {},
): RuleMutation => {
  const inherited = directAttackDamageProvenance(context, actorId, delivery);
  const ignoreCover = Boolean(provenance.ignoreCover || inherited?.ignoreCover);
  const ignoreDodge = Boolean(provenance.ignoreDodge || inherited?.ignoreDodge);
  return {
    kind: 'damage', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, amount, damageType, instance: 1, delivery, ignoreCover,
    ...(ignoreDodge ? { ignoreDodge: true } : {}),
    ...(provenance.bypassVigor ? { bypassVigor: true } : {}),
    ...(provenance.ignoreArmor ? { ignoreArmor: true } : {}),
    ...(provenance.ignoreDefiance ? { ignoreDefiance: true } : {}),
  };
};

export const conditionMutation = (
  context: RuleExecutionContext,
  actorId: string,
  conditionId: string,
  potency: 'normal' | 'plus' = 'normal',
  duration?: RuleDuration,
): RuleMutation => ({
  kind: 'condition', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, conditionId, operation: 'apply', potency, ...(duration ? { duration } : {}),
});

export const stateMutation = (context: RuleExecutionContext, actorId: string, key: string, value: StateValue): RuleMutation => ({
  kind: 'state', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, key, operation: 'set', value,
});

export const vigorMutation = (context: RuleExecutionContext, actorId: string, amount: number): RuleMutation => ({
  kind: 'vigor', sourceId: context.sourceId, actorId, amount, uncapped: false,
});

/** Command-time Cure, including p.94 status saves and explicit Blessings. */
export const cureMutations = (context: RuleExecutionContext, actorId: string): RuleMutation[] => {
  const target = sourceActor(context, actorId);
  return target ? resolveCureMutations(context, target) : [];
};

export const resourceMutation = (
  context: RuleExecutionContext,
  actorId: string,
  resourceId: string,
  operation: 'gain' | 'spend',
  amount: number,
): RuleMutation => ({
  kind: 'resource', sourceId: context.sourceId, actorId, resourceId, operation, amount, minimum: 0, maximum: null,
});

export const stanceMutation = (
  context: RuleExecutionContext,
  actorId: string,
  operation: 'enter' | 'refresh' | 'exit',
  stanceId: string,
  state: Record<string, StateValue> = {},
): RuleMutation => ({
  kind: 'stance', sourceId: context.sourceId, sourceActorId: context.actorId, operation, actorId, stanceId, state,
});

export const markMutation = (
  context: RuleExecutionContext,
  actorId: string,
  markId: string,
  state: Record<string, StateValue> = {},
): RuleMutation => ({
  kind: 'mark', sourceId: context.sourceId, ownerId: context.actorId, operation: 'apply', actorId, markId, state,
});

export const shoveMutation = (context: RuleExecutionContext, actorId: string, distance: number, direction: Position): RuleMutation => ({
  kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, movement: 'shove', distance, positions: [], direction, phasing: false,
});

export const removeMutation = (context: RuleExecutionContext, actorId: string): RuleMutation => ({
  kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, movement: 'remove', distance: null, positions: [], direction: null, phasing: false,
});

export const rushMutation = (context: RuleExecutionContext, actorId: string, destination: Position | Position[]): RuleMutation => ({
  kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, movement: 'rush', distance: null,
  positions: Array.isArray(destination) ? destination : [destination], direction: null, phasing: false,
});

export const flyMutation = (context: RuleExecutionContext, actorId: string, destination: Position): RuleMutation => ({
  kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, movement: 'fly', distance: null, positions: [destination], direction: null, phasing: false,
});

export const placeMutation = (context: RuleExecutionContext, actorId: string, destination: Position): RuleMutation => ({
  kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, movement: 'place', distance: null, positions: [destination], direction: null, phasing: false,
});

export const teleportMutation = (context: RuleExecutionContext, actorId: string, destination: Position): RuleMutation => ({
  kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, movement: 'teleport', distance: null, positions: [destination], direction: null, phasing: false,
});

export const entityMutation = (
  context: RuleExecutionContext,
  ownerId: string,
  position: Position,
  entityType: string,
  state: Record<string, StateValue>,
): RuleMutation => ({
  kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType, ownerId, positions: [position], count: 1, state,
});

export const terrainMutation = (
  context: RuleExecutionContext,
  operation: 'create' | 'remove',
  terrain: string,
  positions: Position[],
): RuleMutation => ({
  kind: 'terrain', sourceId: context.sourceId, sourceActorId: context.actorId, operation, terrain, positions, height: null,
});

// ── Compilation ──────────────────────────────────────────────────────────────
export function clause(unit: RuleSourceUnit, label: string, complete = true): RuleClauseCompilation {
  return {
    id: `${unit.id}:${label}:clause`,
    label,
    text: unit.rulesText,
    effects: [],
    complete,
    unsupportedText: complete ? '' : `${unit.kind} requires a complete typed resolver before it can execute through the generic RuleProgram VM.`,
  };
}

export const action = (partial: Partial<RuleAction> & Pick<RuleAction, 'name' | 'timing'>): RuleAction => ({
  id: 'default',
  area: null,
  range: null,
  choices: [],
  tags: [],
  ...partial,
  costs: partial.costs ?? [],
  steps: partial.steps ?? [],
});

export const comboCost = (amount = 1): RuleCost => ({ kind: 'combo', amount: constant(amount) });

export const notHeroic: RulePredicate = { kind: 'not', predicate: { kind: 'trigger', trigger: 'heroic' } };

export function compilation(unit: RuleSourceUnit, actions: RuleAction[], clauseLabels: string[]): RuleProgramCompilation {
  const program: RuleProgram = {
    schemaVersion: 1,
    rulesVersion: '1.5',
    id: `program:${unit.id}`,
    sourceId: unit.id,
    source: unit.source,
    name: unit.name,
    actions,
    dependencies: [unit.parentId ?? ''],
    classification: 'encounter',
  };
  return { program, clauses: clauseLabels.map((label) => clause(unit, label)), unsupportedClauses: [] };
}
