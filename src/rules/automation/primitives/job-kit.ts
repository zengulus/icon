import { resolveCureMutations } from './status-saves.js';
import { directAttackDamageProvenance, type AttackDamageProvenance } from './attack-resolution.js';
import { arcCells, axisDirection, cellKey, lineCells, orthogonalNeighbors, ringAround as ringAroundGeometry, sameCell, squareArea } from '../../area-geometry.js';
import * as battlefield from './battlefield.js';
import { footprintCells, footprintsOverlap } from './spatial-intent.js';
import { rollDamageDice as rollDamageDicePrimitive } from './damage-roll.js';
import type { Position } from '../../types.js';
import type { RuleSourceUnit } from '../../source-units.js';
import type { DiceSource } from '../../dice.js';
import { entityKind, entityKindOf } from './entity-kind.js';
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
 * - `walk` is a retained compatibility authoring helper, not the shared
 *   movement authority. Non-phasing movement stops at other characters and
 *   entities; phasing movement passes through both. Both stop at impassable
 *   terrain and the grid edge. This preserves the stricter of the two legacy
 *   helper behaviors; it does not claim p.88 Standard Move parity (notably,
 *   ordinary ally transit belongs to the shared movement authority).
 * - Ordinary attacks made by named resolvers go through the shared
 *   authoritative attack kernel (`kernels/attack-resolution.ts`,
 *   `resolveAuthoritativeAttack`), which folds the F6 trait modifiers, aura
 *   boons/curses, F10 ability-use modifiers, footprint distance, and the
 *   damage-die override — the same authority the declarative VM attack
 *   effect uses. This module keeps only the mutation builders (including the
 *   provenance-aware `damageMutation`) that consume a resolved attack.
 */

// Re-export area geometry so a job file has a single import point.
export { arcCells, axisDirection, cellKey, lineCells, orthogonalNeighbors, sameCell, squareArea };

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
  battlefield.distance(first, second);

export const withinGrid = (position: Position, context: RuleExecutionContext) =>
  battlefield.withinGrid(position, context);

export const sourceActor = (context: RuleExecutionContext, id: string): RuleActorView =>
  context.state.actors[id];

/** True when a character's final space is unavailable because of a character
 * footprint or OBJECT entity. ICON p.92: a Size-N actor occupies its whole
 * N×N footprint, so any cell inside a large actor's footprint is occupied —
 * not only its anchor cell. ICON p.95: summons are Size 1 and intangible — they do not
 * cause obstruction or engagement and may share a space with characters — so
 * a cell holding ONLY an intangible summon is NOT occupied by this generic
 * predicate (a bomb's own "can't share space with other bombs" rule is a
 * specialist placement constraint applied by the bomb placement resolver,
 * never this predicate). This is not a generic transit-obstruction test
 * (p.88 allows movement through allies); nor does it fully answer whether a
 * space is available for a particular placement (object stacking,
 * teleport unoccupied, summon placement each carry their own specialist
 * rules on top of this predicate). */
export const occupied = (position: Position, context: RuleExecutionContext, excludeId = '') =>
  battlefield.finalSpaceOccupied(position, context, excludeId);

export const impassable = (position: Position, context: RuleExecutionContext) =>
  battlefield.impassable(position, context);

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
  const moverSize = Math.max(1, context.state.actors[moverId]?.size ?? 1);
  let position = { ...start };
  for (let step = 0; step < steps; step += 1) {
    const next = { x: position.x + Math.sign(direction.x), y: position.y + Math.sign(direction.y) };
    if (footprintCells(next, moverSize).some((cell) => !withinGrid(cell, context)
      || context.state.terrainAt(cell).has('impassable'))) break;
    if (!phasing) {
      const blockedByActor = Object.values(context.state.actors).some(
        (actor) => actor.id !== moverId && !excludeIds.has(actor.id) && actor.position
          && footprintsOverlap(
            { position: next, size: moverSize },
            { position: actor.position, size: actor.size ?? 1 },
          ),
      );
      const blockedByEntity = Object.values(context.state.entities).some(
        (entity) => entityKindOf(entity) === 'object'
          && entity.positions.some((cell) => sameCell(cell, next)),
      );
      if (blockedByActor || blockedByEntity) break;
    }
    position = next;
  }
  return position;
}

/** The first in-grid, unoccupied cell from a candidate list, else null. */
export function firstFreeCell(context: RuleExecutionContext, cells: Position[], excludeId: string): Position | null {
  return cells.find((cell) => withinGrid(cell, context)
    && !battlefield.finalSpaceOccupied(cell, context, excludeId)) ?? null;
}

// ── Selection ────────────────────────────────────────────────────────────────
/** The eight surrounding cells in clockwise order, starting directly north. */
export function ringAround(center: Position): Position[] {
  return ringAroundGeometry(center);
}

// ── Durations ────────────────────────────────────────────────────────────────
export const untilNextTurnEnd: RuleDuration = { kind: 'turn-end', actor: self, turns: 2 };
export const untilNextTurnStart: RuleDuration = { kind: 'turn-start', actor: self, turns: 1 };

// ── Damage rolls ─────────────────────────────────────────────────────────────
/**
 * ICON p.102 bonus damage: "roll one more die than normal, then pick the
 * highest." Rolls `count + bonusDice` dice of `die` sides and keeps the
 * highest `count` rolls. This is the SAME evaluation the declarative VM's
 * `damage-roll` performs (kernels/runtime.ts), so a named resolver that uses
 * this helper and a VM-executed ability can never disagree about how a bonus
 * die resolves. Deterministic: reads only the recorded dice source, so
 * replay applies the recorded roll exactly.
 */
export const rollDamageDice = rollDamageDicePrimitive;

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
  const ignoreAetherwall = Boolean(provenance.ignoreAetherwall || inherited?.ignoreAetherwall);
  return {
    kind: 'damage', sourceId: context.sourceId, sourceActorId: context.actorId, actorId, amount, damageType, instance: 1, delivery, ignoreCover,
    ...(ignoreDodge ? { ignoreDodge: true } : {}),
    ...(ignoreAetherwall ? { ignoreAetherwall: true } : {}),
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

/** How a swap's legs move — a source-defined distinction, not an
 * implementation detail (ICON p.151 vs p.163/p.300):
 * - `'teleport'`: the source text says the characters **teleport** (Masquerade
 *   p.151 "swap places … teleporting both"). Each leg is a real teleport and
 *   carries teleport authority: Rampart (p.104) can deny it, and any
 *   "when you teleport" reactive semantics see it.
 * - `'place'`: the source text **removes and places** the characters (Redondo
 *   p.300; Shadow Play p.163 says only "swap", with no movement word). The
 *   legs are instantaneous repositioning that is NOT a teleport: no rampart
 *   boundary check, no teleport trigger surface.
 * Both flavors preserve forced-movement semantics at application time:
 * movement-entry triggers stay voluntary-MOVE/DASH-only (AGENTS §8), turn
 * entitlement is untouched (an ability effect, not a move command), and the
 * declared group's co-moved set makes each destination legal despite being
 * occupied pre-batch — the exemption is scoped to the legs of THIS swap
 * group, never to unrelated movers in the same event. */
export type SwapMovement = 'teleport' | 'place';

/** The shared Swap primitive: paired destination mutations for two or more
 * actors trading positions in one batch (`swaps` is a full permutation of the
 * participants' destinations, so N-party rotations work). Every swap emitter
 * routes through here so the movement kind is chosen once per source unit,
 * explicitly, instead of every resolver hand-rolling place pairs that silently
 * erase the teleport/remove-place distinction.
 *
 * Every leg carries the same `spatialBatchId`, the source-declared atomic
 * spatial group: the reducer prevalidates the whole permutation against the
 * same pre-swap state and applies every leg or none
 * (kernels/encounter-adapter.ts `deniedAtomicSpatialLegIndices`). Only
 * explicitly grouped legs get that all-or-none treatment; ordinary
 * multi-target movement is not grouped and resolves per-leg. Pass a distinct
 * `options.spatialBatchId` when a resolver emits more than one swap group in
 * one event. */
export const swapMutations = (
  context: RuleExecutionContext,
  movement: SwapMovement,
  swaps: ReadonlyArray<{ actorId: string; destination: Position }>,
  options: { spatialBatchId?: string } = {},
): RuleMutation[] => {
  const batchId = options.spatialBatchId ?? `${context.sourceId}:spatial-swap`;
  return swaps.map(({ actorId, destination }) => ({
    kind: 'move', sourceId: context.sourceId, sourceActorId: context.actorId, actorId,
    movement, distance: null, positions: [destination], direction: null, phasing: false,
    spatialBatchId: batchId,
  }));
};

export const entityMutation = (
  context: RuleExecutionContext,
  ownerId: string,
  position: Position,
  entityType: string,
  state: Record<string, StateValue>,
): RuleMutation => ({
  kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType, ownerId, positions: [position], count: 1, state, category: entityKindOf({ type: entityType, state }),
});

/** Non-authoritative candidate DOMAIN for a creation intent: every in-grid
 * cell within the placement region (Chebyshev `radius` of `region`),
 * deterministically ordered nearest-first (region distance, then x, then y).
 * It deliberately filters NOTHING but grid bounds — no occupancy, no
 * impassable, no line of sight, no footprint/range — because ALL of those
 * final legality decisions belong to `validateEntityCreation` (the single
 * authority). Placement region is a source-declared AREA, not an
 * anchor-distance legality filter. */
export function creationCandidateCells(context: RuleExecutionContext, region: Position, radius: number): Position[] {
  const cells: Position[] = [];
  for (const cell of squareArea(region, radius)) {
    if (!withinGrid(cell, context)) continue;
    cells.push(cell);
  }
  return cells.sort((a, b) => distance(region, a) - distance(region, b) || a.x - b.x || a.y - b.y);
}

/** The single-authority creation-INTENT seam ordinary creation routes through.
 * It declares INTENT only and never decides legality or selects the final
 * cells itself. It emits a single creation mutation carrying an ordered
 * candidate list (the placement REGION: every in-grid cell within `radius` of
 * `region`, un-filtered — bounds/occupancy/impassable/LoS/footprint-range/cap
 * all remain with the validator), the requested `count`, and an explicit
 * PAIRED `creationSpatial` contract.
 *
 * The contract SEPARATES placement region from the creator's LoS authority:
 * `region`/`radius` say WHERE the summon/object may appear (often centered on
 * a target or area, e.g. Warden Apex's beast adjacent to its target);
 * `losOrigin`/`originSize`/`maxRange` are the CREATOR/SOURCE authority
 * (ICON p.108: summoning/creating always needs the USER's line of sight
 * unless explicitly overridden) and are measured in canonical footprint
 * distance. These are deliberately independent — a target-placed creature is
 * validated for LoS from the creator, never from the target. `maxRange`
 * defaults to the placement `radius` from the Los origin; pass an explicit
 * value when the source defines a different reach.
 *
 * `countMode`: 'up-to' (default) creates as many legal cells as exist;
 * 'exact' fails the whole creation unless it can land exactly `count`. The
 * per-owner summon cap always bounds the result.
 *
 * MIGRATION NOTE: pre-existing ability resolvers that still hand-roll
 * free-cell scans (an `evaluatePositions(...)` candidate set indexed by
 * position) + `entityMutation(...)` for ordinary summons are tracked for
 * migration onto this seam. A few are deliberate
 * exceptions that are NOT ordinary intent-declaration summons — e.g. a
 * resolver that needs the exact resolved cell back to compute a follow-on
 * effect (the Seer meteor's proximity damage) or a mandatory in-place
 * object placement (the Warden's required portal) — because the
 * intent-declaration contract does not expose the chosen cell to the
 * resolver. */
export function summonEntity(
  context: RuleExecutionContext,
  ownerId: string,
  entityType: string,
  region: Position,
  options: {
    radius?: number;
    count?: number;
    countMode?: 'exact' | 'up-to';
    /** The creator/source actor's LoS origin. REQUIRED — the placement region's
     * center is NOT the LoS authority unless the creator is there. */
    losOrigin: Position;
    /** The creator/source actor's resolved U7 footprint size. Required so an
     * actor-originated creation cannot silently degrade to point LoS. */
    originSize: number;
    maxRange?: number;
    category?: 'summon' | 'object';
    state?: Record<string, StateValue>;
  },
): RuleMutation[] {
  const radius = options.radius ?? 1;
  const count = options.count ?? 1;
  // The category is derived from the CENTRAL registry by default so ordinary
  // objects (boulder/shrine/geyser/…) need no redundant explicit `category`;
  // an explicit override is reserved for source semantics the registry cannot
  // express (e.g. a persistent companion summon).
  const category = options.category ?? entityKind(entityType);
  // Creator LoS authority only by default: placement region bounds the cells;
  // an explicit source range (footprint distance from the creator) is added
  // when the source defines one. The placement radius is NEVER converted into
  // a creator range — the two are independent (PART 2).
  const creationSpatial = {
    origin: options.losOrigin,
    originSize: options.originSize,
    ...(options.maxRange !== undefined ? { maxRange: options.maxRange } : {}),
  };
  return [{
    kind: 'entity', sourceId: context.sourceId, operation: 'create', entityType, ownerId,
    positions: creationCandidateCells(context, region, radius),
    count,
    category,
    countMode: options.countMode ?? 'up-to',
    state: options.state ?? {},
    creationSpatial,
  }];
}

export const terrainMutation = (
  context: RuleExecutionContext,
  operation: 'create' | 'remove',
  terrain: string,
  positions: Position[],
): RuleMutation => ({
  kind: 'terrain', sourceId: context.sourceId, sourceActorId: context.actorId, operation, terrain, positions, height: null,
});

// ── Gamble ──────────────────────────────────────────────────────────────────

/** The result of a Gamble roll (ICON Combat Glossary). The caller owns
 * the source-defined threshold — the kernel provides the die value and the
 * pass/fail test. Consumers that need only the roll can ignore `success`;
 * consumers that branch on the exact result read `roll`. */
export interface GambleResult {
  /** The d6 result, 1–6. */
  roll: number;
  /** True when `roll >= threshold`. */
  success: boolean;
}

/** Roll a single d6 Gamble through the deterministic dice source.
 * Accepts either a DiceSource directly or a RuleExecutionContext (which
 * has a `.dice` property). Usage in a resolver:
 * ```ts
 * const { roll, success } = gambleD6(context.dice, 4); // threshold 4+
 * if (success) mutations.push(...);
 * ```
 *
 * The die is consumed from the dice source so replay uses the same
 * recorded value. There is no parallel RNG. */
export function gambleD6(diceOrContext: DiceSource | { dice: DiceSource }, threshold = 1): GambleResult {
  const dice = 'die' in diceOrContext ? diceOrContext : diceOrContext.dice;
  const roll = dice.die(6);
  return { roll, success: roll >= threshold };
}

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
