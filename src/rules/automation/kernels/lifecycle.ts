import { applyRuleMutations } from './encounter-adapter.js';
import { orthogonalNeighbors, squareArea } from '../../area-geometry.js';
import type { DiceSource } from '../../dice.js';
import type { EncounterActor, EncounterState, Position, TurnEndCause } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';
import { turnBoundaryOrdering } from '../primitives/ordering.js';
import { nextWindowId, openTurnBoundaryOrderingWindow } from './decision-window.js';

/**
 * F3 turn lifecycle kernel (docs/rules-foundations.md §4).
 *
 * Every turn boundary is a durable **intent**: the end cause, the dice/save
 * windows pre-rolled at the command boundary (so replay never re-rolls), and
 * the ordered lifecycle participants that ran. Replay consumes the intent
 * through the lifecycle registry — a hook registers as a row (exact source
 * ID + phase + applies gate + deterministic body) instead of being
 * hand-wired into `encounter.ts`, so new stances, marks, summons, and relic
 * effects join the boundary declaratively.
 *
 * The rows themselves live in `content/jobs/lifecycle-recipes.ts` (they are
 * source-ID content and register through `registerLifecycleRecipe`); this
 * module contains only the machinery and deliberately no source IDs.
 *
 * T6.3 — registration order is a DISCOVERY mechanism, never the mechanical
 * boundary-order authority. The command boundary records a durable per-phase
 * candidate plan (source id + mechanical owner + side + phase) in the intent,
 * and runLifecyclePhase routes that plan through the U17 turn-boundary
 * ordering authority (p.108: non-turn-owner first, hostile before beneficial,
 * same-owner tie becomes a recorded decision) so the registry's insertion
 * order is never the answer to a simultaneous ordering ambiguity. ONLY legacy
 * events without a phase plan fall back to the applies-gate enumeration (in
 * registration order) for pre-T6.3 replay compatibility — the durable plan is
 * authoritative for every new boundary.
 */

export type LifecyclePhase = 'turn-start' | 'turn-end' | 'delayed' | 'round-start' | 'round-end';

export interface LifecycleRecipe {
  /** Exact source ID that owns this hook (ability/stance/mark id). */
  sourceId: string;
  phase: LifecyclePhase;
  /** Cheap precondition deciding whether the hook participates in a boundary.
   * The body keeps its own early returns as defense; both must agree. */
  applies(actor: EncounterActor, state: EncounterState, diceWindows: TurnDiceWindows): boolean;
  /** T6.3 — the mechanical OWNER of the effects this recipe resolves at the
   * boundary: the p.108 same-owner read ("If effects are owned by the same
   * character, they can choose the order they resolve"). Defaults to the
   * boundary actor (a stance/trait/state recipe is owned by the character
   * whose turn boundary runs it). Mark/zone/aura recipes whose effects belong
   * to ANOTHER character (the mark owner, the aura origin, the mote owner)
   * declare it. Returns null when the recipe has NO mechanically relevant
   * effect at this boundary (its body no-ops by construction) — such a
   * participant is EXCLUDED from U17 arbitration: ordering a no-op is
   * meaningless, and it must never drag a real effect into a spurious
   * same-owner tie. A recipe whose effects are owned by several different
   * characters in one instance returns null too — its multiple instances
   * resolve in the source-listed order inside the ability (p.107 "effects
   * happen in the order they are listed"), never a fabricated single owner. */
  ownerOf?(actor: EncounterActor, state: EncounterState, diceWindows: TurnDiceWindows): string | null;
  /** The deterministic hook body. */
  resolve(state: EncounterState, actor: EncounterActor, diceWindows: TurnDiceWindows): void;
}

export interface TurnDiceWindows {
  /** Pre-rolled Carnevale detonation gamble (p.150), rolled at the boundary. */
  carnevaleGamble?: number;
  /** Pre-rolled Monogatari song gamble (p.179), rolled at the boundary. */
  monogatariGamble?: number;
  /** F6: the status count Blackheart (p.141) counted at the command boundary,
   * before the end-of-turn saves consume it. The turn-end phase replays after
   * those saves, so the recorded count is the only faithful input. */
  blackheartStatusCount?: number;
  /** ICON p.143 Infectious Hatred (Dark Knight mastery): the pre-rolled save
   * for a foe ending its turn inside a mastered dark knight's aura — save or
   * gain hatred of the knight. Resolved at the command boundary so replay
   * never re-rolls or re-decides the outcome. */
  darkKnightHatredSave?: { roll: number; total: number; success: boolean };
  /** Generic pre-rolled dice keyed by content-owned name. Lifecycle recipes
   * can register arbitrary gamble windows here without modifying this
   * interface — the fold merges every planner's partial windows. */
  recordedDice?: Record<string, number>;
}

export interface TurnTransitionIntent {
  /** Why the turn ended (voluntary / ability-tag / forced-status / rule-requested). */
  cause: TurnEndCause;
  /** The ordered lifecycle participants that ran at this boundary. Empty for
   * legacy events without an intent (replay falls back to the applies gates). */
  participants: string[];
  /** T6.3 — the durable per-phase turn-boundary candidate plan: the
   * mechanically necessary ordering facts (source id, mechanical owner, owner
   * side) for every pending lifecycle effect, recorded at the command
   * boundary so replay applies the p.108 ordering authority from the record
   * — NEVER from registry insertion order or from re-derived ambient state.
   * Absent for legacy events (replay falls back to the applies gates in
   * registry order). */
  phases?: TurnBoundaryPhasePlan[];
  /** Dice/save windows resolved at the command boundary. */
  diceWindows: TurnDiceWindows;
  /** Whether this boundary advances the round. */
  roundAdvance: boolean;
}

/** T6.3 — one pending lifecycle effect at a turn boundary, recorded durably
 * in the F3 intent (p.108 ordering facts, never ambient state). `id` is the
 * durable candidate identity (recipe source id for the single-actor phases;
 * `<sourceId>:<actorId>` for the per-actor round-start phase); `actorId` is
 * the character whose boundary runs the recipe instance. `ownerId`/`side`
 * are the MECHANICAL OWNER of the resolved effects (the p.108 same-owner /
 * hostile-before-beneficial reads); both null when the recipe has no
 * mechanically relevant effect at this boundary (excluded from arbitration). */
export interface TurnBoundaryCandidatePlan {
  id: string;
  sourceId: string;
  /** The actor the recipe instance runs for (the boundary actor for the
   * single-actor phases; the individual actor for round-start instances). */
  actorId: string;
  ownerId: string | null;
  side: string | null;
}

/** T6.3 — the per-phase candidate plan inside the durable intent. */
export interface TurnBoundaryPhasePlan {
  phase: LifecyclePhase;
  candidates: TurnBoundaryCandidatePlan[];
}

/** The lifecycle registry. Content rows register through
 * `registerLifecycleRecipe`. Registration order is DISCOVERY/enumeration
 * order only (and the legacy-replay enumeration order): the mechanical
 * boundary order is decided by the recorded per-phase candidate plan through
 * the U17 authority (T6.3), never by this array's insertion order. */
const lifecycleRecipes: LifecycleRecipe[] = [];

/** Register a lifecycle row (content/jobs/lifecycle-recipes.ts). Appends in
 * its phase's section (discovery order; not a mechanical ordering decision). */
export function registerLifecycleRecipe(recipe: LifecycleRecipe): void {
  lifecycleRecipes.push(recipe);
}

/** The closed lifecycle registry (registration order = discovery order). */
export const LIFECYCLE_RECIPES: readonly LifecycleRecipe[] = lifecycleRecipes;

export type TurnDiceWindowPlanner = (state: EncounterState, actor: EncounterActor, dice: DiceSource) => TurnDiceWindows;

const turnDiceWindowPlanners: TurnDiceWindowPlanner[] = [];

/** Register a command-boundary dice-window planner (content/jobs). Each
 * planner returns the partial windows it owns, or `{}` when none apply — the
 * intent must stay JSON-clean, so omitted windows are absent, not null. */
export function registerTurnDiceWindowPlanner(planner: TurnDiceWindowPlanner): void {
  turnDiceWindowPlanners.push(planner);
}

/**
 * F6 combat-start trait recipe (docs/rules-foundations.md §7): the durable
 * consumable-condition grants, power-die initialization, and persistent
 * companion summons a Job trait applies once on ENCOUNTER_STARTED. Content
 * rows register through `registerCombatStartTraitRecipe` (content/jobs).
 */
export interface CombatStartTraitRecipe {
  /** Durable conditions to grant if absent (consumable/gated only). */
  grantConditions?: readonly string[];
  /** Per-combat rule-state seeds (set once, never overwritten). */
  initState?: Readonly<Record<string, number | boolean>>;
  /** Persistent companion summon (once per combat, survives defeat). */
  summon?: { entityType: string; range: number };
}

const combatStartTraitRecipes: Record<string, CombatStartTraitRecipe> = {};

/** Register a combat-start trait recipe (content/jobs/job-trait-recipes.ts). */
export function registerCombatStartTraitRecipe(traitId: string, recipe: CombatStartTraitRecipe): void {
  combatStartTraitRecipes[traitId] = recipe;
}

const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const distance = (first: Position, second: Position) => Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));
const positionWithinGrid = (position: Position, state: Pick<EncounterState, 'grid'>) =>
  position.x >= 0 && position.y >= 0 && position.x < state.grid.width && position.y < state.grid.height;

/** The ORDERED in-grid candidate cells within Chebyshev `radius` of `center`
 * (excluding the center), sorted by distance then coordinates so default
 * placement is deterministic (mirrors the position-candidate ordering in
 * `kernels/evaluate-query.ts` `evaluatePositions` with the
 * distance-from-origin ordering policy).
 * This is a pure geometric enumeration — it does NOT decide creation
 * legality. The entity mutation carries the ordered list and the shared
 * `validateEntityCreation` authority picks the first legal candidate
 * (bounds, footprint occupancy, impassable terrain, LoS, range, cap), so
 * lifecycle code never re-implements a legality check. */
export function orderedFreeCellsNear(state: EncounterState, center: Position, radius: number, orthogonalOnly = false): Position[] {
  const cells = orthogonalOnly ? orthogonalNeighbors(center) : squareArea(center, radius);
  const candidates: Position[] = [];
  for (const cell of cells) {
    if (samePosition(cell, center) || !positionWithinGrid(cell, state)) continue;
    candidates.push(cell);
  }
  return candidates.sort((a, b) => distance(center, a) - distance(center, b) || a.x - b.x || a.y - b.y);
}

/** First in-grid, unoccupied, non-impassable cell within Chebyshev `radius` of
 * `center` (orthogonal neighbors when `orthogonalOnly`), sorted by distance
 * then coordinates so default placement is deterministic (mirrors the
 * position-candidate ordering in `kernels/evaluate-query.ts`
 * `evaluatePositions` with the distance-from-origin ordering policy).
 * This is the LIFECYCLE summon-placement specialist: its occupancy read
 * (any on-battlefield character or entity record, summons included) is
 * intentionally conservative for the beast/portal summon actions that pin
 * it in `__tests__/summons.test.ts` — it is NOT the generic obstruction
 * predicate (`primitives/job-kit.ts` `occupied`), which per ICON p.95
 * ignores intangible summons. */
export function freeCellNear(state: EncounterState, center: Position, radius: number, orthogonalOnly = false): Position | null {
  const occupiedCell = (cell: Position) => Object.values(state.actors).some((candidate) => candidate.onBattlefield && !candidate.defeated && candidate.position && samePosition(candidate.position, cell))
    || Object.values(state.entities).some((entity) => entity.positions.some((position) => samePosition(position, cell)));
  const cells = orthogonalOnly ? orthogonalNeighbors(center) : squareArea(center, radius);
  const candidates: Position[] = [];
  for (const cell of cells) {
    if (samePosition(cell, center) || !positionWithinGrid(cell, state)) continue;
    if (state.grid.terrain.some((t) => samePosition(t.position, cell) && t.type === 'impassable')) continue;
    if (occupiedCell(cell)) continue;
    candidates.push(cell);
  }
  return candidates.sort((a, b) => distance(center, a) - distance(center, b) || a.x - b.x || a.y - b.y)[0] ?? null;
}

/**
 * F6 combat-start trait effects (docs/rules-foundations.md §7): the durable
 * consumable-condition grants, power-die initialization, and persistent
 * companion summons from the registered combat-start recipes. Runs once on
 * ENCOUNTER_STARTED (round 1); every grant is idempotent so the replayed
 * event can never double-apply.
 *
 * Consumable conditions (Defiance) must be durable here, never projected:
 * a projection is re-derived on every `encounterConditionSet` call and would
 * resurrect a condition the damage kernel already consumed.
 */
export function applyCombatStartTraitEffects(state: EncounterState) {
  for (const [traitId, recipe] of Object.entries(combatStartTraitRecipes)) {
    for (const actor of Object.values(state.actors)) {
      if (actor.defeated || !actor.traitIds.includes(traitId)) continue;
      for (const conditionId of recipe.grantConditions ?? []) {
        if (!actor.conditions.some((candidate) => candidate.id === conditionId && candidate.sourceId === traitId)) {
          actor.conditions.push({ id: conditionId, sourceId: traitId, ownerId: actor.id, potency: 'normal', duration: null });
        }
      }
      for (const [key, value] of Object.entries(recipe.initState ?? {})) {
        if (!(key in actor.ruleState)) {
          actor.ruleState[key] = value;
          actor.ruleStateOwners[key] = actor.id;
        }
      }
      if (recipe.summon && !Object.values(state.entities).some((entity) => entity.type === recipe.summon!.entityType && entity.ownerId === actor.id)) {
        // ONE legality authority: lifecycle only deterministically enumerates
        // the ordered candidate cells; it never decides creation legality
        // itself. The entity mutation carries the full ordered candidate list
        // and `validateEntityCreation` (bounds, full-footprint occupancy,
        // impassable terrain, LoS, range, cap) picks the FIRST legal
        // candidate — so a Size>1 actor can never hide behind a non-anchor
        // footprint cell, and a LoS-blocked first candidate falls through to
        // the next legal cell instead of rejecting the whole summon.
        const candidates = orderedFreeCellsNear(state, actor.position, recipe.summon.range);
        if (candidates.length > 0) {
          applyRuleMutations(state, [{
            kind: 'entity', sourceId: traitId, operation: 'create', entityType: recipe.summon.entityType, ownerId: actor.id, positions: candidates, count: 1, state: { companion: true },
            creationSpatial: { origin: actor.position, originSize: actor.size, maxRange: recipe.summon.range },
          }]);
        }
      }
    }
  }
}

/** Deterministic, lifecycle-owned ability movement through the same mutation
 * boundary as command-time movement (F1 spatial intent applies on replay). */
export function applyLifecycleAbilityMove(
  state: EncounterState,
  actor: EncounterActor,
  sourceId: string,
  movement: Extract<RuleMutation, { kind: 'move' }>['movement'],
  destination: Position,
) {
  applyRuleMutations(state, [{
    kind: 'move',
    sourceId,
    sourceActorId: actor.id,
    actorId: actor.id,
    movement,
    distance: null,
    positions: [{ ...destination }],
    direction: null,
    phasing: false,
  }]);
}

/** T6.3 — the durable candidate record for one participating recipe at a
 * boundary: the p.108 ordering facts (mechanical owner + owner side) derived
 * from durable state at the command boundary. A recipe whose `ownerOf`
 * declares NO mechanically relevant effect at this boundary (its body
 * no-ops) records a null owner/side and is excluded from arbitration. */
function candidatePlanFor(
  recipe: LifecycleRecipe,
  actor: EncounterActor,
  stateFor: EncounterState,
  diceWindows: TurnDiceWindows,
): TurnBoundaryCandidatePlan {
  const ownerId = recipe.ownerOf ? recipe.ownerOf(actor, stateFor, diceWindows) : actor.id;
  const side = ownerId !== null ? (stateFor.actors[ownerId]?.side ?? null) : null;
  return {
    id: `${recipe.sourceId}:${actor.id}`,
    sourceId: recipe.sourceId,
    actorId: actor.id,
    ownerId,
    side,
  };
}

/** Plan one turn boundary at the command side: roll the dice windows and
 * precompute the ordered participants (the recipes whose applies gates pass
 * for the ending actor's turn-end phase and the next actor's turn-start
 * phase), plus the T6.3 durable per-phase candidate plan (the p.108 ordering
 * facts every pending effect carries). Replay consumes the intent, so it
 * never re-rolls, never re-decides which hooks run, and never re-derives the
 * ordering from registry insertion order. */
export function planTurnTransition(
  state: EncounterState,
  actor: EncounterActor,
  dice: DiceSource,
  options: { cause: TurnEndCause; nextActorId?: string; nextRound: number },
): { intent: TurnTransitionIntent } {
  // The durable intent must stay JSON-clean: the checkpoint boundary rejects
  // explicit undefined values, so omitted dice windows are absent, not null.
  const diceWindows: TurnDiceWindows = Object.assign({}, ...turnDiceWindowPlanners.map((planner) => planner(state, actor, dice)));
  const next = options.nextActorId ? state.actors[options.nextActorId] : undefined;
  // The turn-start and round-start phases replay after the round advances, so
  // their recipes' gates must be evaluated against the *next* round here — a
  // round-gated row (Godly Smite's round > 1 mantra tick, the round-5 rages)
  // would otherwise never be recorded as a participant and replay would skip
  // it. The turn-end/delayed phases run before the advance and keep the
  // current round. A shallow round override is safe: recipe applies gates
  // only read state.round, never mutate. Legacy automatic-scheduler events
  // name the next actor and record its turn-start participants here; the
  // explicit TAKE_TURN flow plans the next actor's turn-start participants
  // separately (planTurnStartParticipants) because the controller has not
  // chosen the actor yet.
  const nextRoundState: EncounterState = { ...state, round: options.nextRound };
  const phases: TurnBoundaryPhasePlan[] = [];
  const participants: string[] = [];
  const recordPhase = (phase: LifecyclePhase, entries: Array<{ recipe: LifecycleRecipe; actor: EncounterActor; stateFor: EncounterState }>) => {
    if (entries.length === 0) return;
    phases.push({ phase, candidates: entries.map(({ recipe, actor: entryActor, stateFor }) => candidatePlanFor(recipe, entryActor, stateFor, diceWindows)) });
    for (const { recipe } of entries) participants.push(recipe.sourceId);
  };
  recordPhase('turn-end', LIFECYCLE_RECIPES
    .filter((recipe) => recipe.phase === 'turn-end' && recipe.applies(actor, state, diceWindows))
    .map((recipe) => ({ recipe, actor, stateFor: state })));
  recordPhase('delayed', LIFECYCLE_RECIPES
    .filter((recipe) => recipe.phase === 'delayed' && recipe.applies(actor, state, diceWindows))
    .map((recipe) => ({ recipe, actor, stateFor: state })));
  if (next) {
    recordPhase('turn-start', LIFECYCLE_RECIPES
      .filter((recipe) => recipe.phase === 'turn-start' && recipe.applies(next, nextRoundState, diceWindows))
      .map((recipe) => ({ recipe, actor: next, stateFor: nextRoundState })));
  }
  // F6: a round-start participant is recorded when the boundary advances the
  // round AND any living actor's applies gate passes (round-start recipes run
  // per actor, e.g. True Horn for every true-horn hero). The candidate plan
  // records each (recipe × actor) INSTANCE — the per-instance owner is the
  // actor the recipe runs for, and a round-start with two different owners in
  // the same p.108 bucket has no source-defined order (fail closed, never
  // registry order).
  if (options.nextRound > state.round) {
    const entries: Array<{ recipe: LifecycleRecipe; actor: EncounterActor; stateFor: EncounterState }> = [];
    for (const recipe of LIFECYCLE_RECIPES) {
      if (recipe.phase !== 'round-start') continue;
      for (const candidate of Object.values(state.actors)) {
        if (candidate.defeated || !candidate.onBattlefield) continue;
        if (!recipe.applies(candidate, nextRoundState, diceWindows)) continue;
        entries.push({ recipe, actor: candidate, stateFor: nextRoundState });
      }
    }
    recordPhase('round-start', entries);
  }
  return {
    intent: {
      cause: options.cause,
      participants: [...new Set(participants)],
      phases,
      diceWindows,
      roundAdvance: options.nextRound > state.round,
    },
  };
}

/** Plan the turn-start lifecycle participants (and the T6.3 per-phase
 * candidate plan) for an actor selected via TAKE_TURN. Runs against the
 * authoritative state at selection time (the round has already advanced if
 * the boundary advanced it), so round-gated recipes evaluate their real
 * gate. Turn-start recipes never consume dice windows — those belong to the
 * ending actor's turn-end boundary. */
export function planTurnStartParticipants(
  state: EncounterState,
  actor: EncounterActor,
): { participants: string[]; phases: TurnBoundaryPhasePlan[] } {
  const recipes = LIFECYCLE_RECIPES.filter((recipe) => recipe.phase === 'turn-start' && recipe.applies(actor, state, {}));
  return {
    participants: [...new Set(recipes.map((recipe) => recipe.sourceId))],
    phases: recipes.length > 0
      ? [{ phase: 'turn-start', candidates: recipes.map((recipe) => candidatePlanFor(recipe, actor, state, {})) }]
      : [],
  };
}

/** T6.3 — resolve ONE lifecycle recipe instance by its recorded source id
 * against then-current state. Used by the U13 ordering window's answer (the
 * reducer executes a deferred tied effect exactly once, in the recorded
 * order) and by the arbitrated phase runner. Deterministic: the recipe body
 * is a pure function of state/actor/diceWindows. Returns false when the
 * source id names no recipe for the phase (replay corruption — the recorded
 * candidate must exist in the registry). */
export function resolveLifecycleRecipeById(
  state: EncounterState,
  actor: EncounterActor,
  phase: LifecyclePhase,
  sourceId: string,
  diceWindows: TurnDiceWindows,
): boolean {
  const recipe = LIFECYCLE_RECIPES.find((candidate) => candidate.phase === phase && candidate.sourceId === sourceId);
  if (!recipe) return false;
  recipe.resolve(state, actor, diceWindows);
  return true;
}

/** Execute the recorded recipe instances of a phase plan in the given order
 * (each candidate names the actor its instance runs for — the boundary actor
 * for the single-actor phases, the individual actor for round-start
 * instances). */
function executeCandidatePlans(
  state: EncounterState,
  phase: LifecyclePhase,
  candidates: readonly TurnBoundaryCandidatePlan[],
  diceWindows: TurnDiceWindows,
): void {
  for (const candidate of candidates) {
    const actor = state.actors[candidate.actorId];
    if (!actor) continue;
    resolveLifecycleRecipeById(state, actor, phase, candidate.sourceId, diceWindows);
  }
}

/** T6.3 — run one phase's recorded candidate plan through the U17
 * turn-boundary ordering authority (p.108): the deterministic stages
 * (non-active-owner-first, hostile-before-beneficial) execute immediately;
 * a remaining SAME-OWNER tie opens the ONE U13 ordering decision window
 * carrying exactly the tied effects (deferred until the recorded answer); a
 * remaining CROSS-OWNER tie (or missing ownership/side) FAILS CLOSED — the
 * registry/participant array order is never a mechanical ordering authority.
 *
 * The window opens at the REDUCER (this function is reducer-side), so replay
 * re-opens the identical window from the recorded intent. The answer's
 * DECISION_ANSWERED reducer resolves the deferred tied effects in the
 * recorded order (see encounter.ts). */
function runPhaseFromPlan(
  state: EncounterState,
  phase: LifecyclePhase,
  plan: TurnBoundaryPhasePlan,
  turnActor: EncounterActor,
  diceWindows: TurnDiceWindows,
): void {
  const meaningful = plan.candidates.filter((candidate) => candidate.ownerId !== null && candidate.side !== null);
  const noops = plan.candidates.filter((candidate) => candidate.ownerId === null || candidate.side === null);
  if (meaningful.length === 0) {
    executeCandidatePlans(state, phase, noops, diceWindows);
    return;
  }
  const result = turnBoundaryOrdering(
    meaningful.map((candidate) => ({ id: candidate.id, sourceId: candidate.sourceId, ownerId: candidate.ownerId!, side: candidate.side! })),
    { turnActorId: turnActor.id, turnSide: turnActor.side, spec: { key: `ordering:${phase}`, label: `Order your simultaneous ${phase} effects` } },
  );
  if (result.ok) {
    const byId = new Map(plan.candidates.map((candidate) => [candidate.id, candidate]));
    executeCandidatePlans(state, phase, [...result.ordered.map((candidate) => byId.get(candidate.id)!).filter(Boolean), ...noops], diceWindows);
    return;
  }
  if (result.problem === 'yields-choice') {
    // The ONE same-owner tie (p.108 bullet 3): defer exactly the tied effects
    // until the owner records their order through the T6.2 U4/U13 path; the
    // deterministic remainder resolves now. The window carries the deferred
    // effects + the recorded dice windows so the answer resolves them against
    // the SAME recorded input (never a re-roll, never re-derived state).
    openTurnBoundaryOrderingWindow(state, {
      id: nextWindowId(state, 'choice', result.ownerId),
      phase,
      actorId: turnActor.id,
      tied: result.tied.map((candidate) => ({
        id: candidate.id,
        sourceId: candidate.sourceId,
        ownerId: candidate.ownerId,
        side: candidate.side,
        actorId: turnActor.id,
        kind: 'recipe',
      })),
      frame: { sourceId: result.ownerId, ownerId: result.ownerId },
      diceWindows,
    });
    const byId = new Map(plan.candidates.map((candidate) => [candidate.id, candidate]));
    executeCandidatePlans(state, phase, [...result.deterministic.map((candidate) => byId.get(candidate.id)!).filter(Boolean), ...noops], diceWindows);
    return;
  }
  throw new Error(`lifecycle.ordering.${result.problem}: the ${phase} phase's simultaneous effects cannot be ordered by the p.108 authority (${result.problem}); ICON grants no deterministic order here — fail closed, never registry order, never an invented tie-break.`);
}

/** Run one lifecycle phase. New boundaries execute exactly the recorded
 * participants through the U17 turn-boundary ordering authority (T6.3 — the
 * intent's durable candidate plan decides the order, never the registry
 * insertion order), with same-owner ties routed to the recorded U4/U13
 * ordering decision and cross-owner ties failing closed. Legacy events
 * without a phase plan keep the historical applies-gate fallback (registry
 * order — the pre-T6.3 replay contract for old event logs). Each recipe's
 * resolve re-checks its own durable preconditions as the safety net. */
export function runLifecyclePhase(
  state: EncounterState,
  actor: EncounterActor,
  phase: LifecyclePhase,
  intent: TurnTransitionIntent,
): void {
  const plan = intent.phases?.find((candidate) => candidate.phase === phase);
  if (plan !== undefined) {
    runPhaseFromPlan(state, phase, plan, actor, intent.diceWindows);
    return;
  }
  const recorded = intent.participants.length > 0;
  for (const recipe of LIFECYCLE_RECIPES) {
    if (recipe.phase !== phase) continue;
    if (recorded && !intent.participants.includes(recipe.sourceId)) continue;
    if (!recorded && !recipe.applies(actor, state, intent.diceWindows)) continue;
    recipe.resolve(state, actor, intent.diceWindows);
  }
}

/** F6 round-start phase: a round-start recipe runs for every living actor
 * when the boundary recorded it (round-start hooks are per-actor — each True
 * Horn hero, each godly-smite sealer — unlike the single-actor turn phases).
 * The T6.3 candidate plan records each (recipe × actor) instance and the
 * p.108 authority orders them (a round-start with two different owners in
 * the same bucket has no source-defined order — fail closed). The
 * ENCOUNTER_STARTED boundary has no intent and falls back to the gates. */
export function runLifecyclePhaseForAll(
  state: EncounterState,
  phase: LifecyclePhase,
  intent: TurnTransitionIntent,
): void {
  const plan = intent.phases?.find((candidate) => candidate.phase === phase);
  if (plan !== undefined) {
    const turnActor = state.activeActorId ? state.actors[state.activeActorId] : undefined;
    if (turnActor) {
      runPhaseFromPlan(state, phase, plan, turnActor, intent.diceWindows);
      return;
    }
    // No active actor (defensive): fall through to the recorded-participant
    // execution below — a boundary without a turn actor cannot apply the
    // non-active-owner-first read.
  }
  const recorded = intent.participants.length > 0;
  for (const recipe of LIFECYCLE_RECIPES) {
    if (recipe.phase !== phase) continue;
    if (recorded && !intent.participants.includes(recipe.sourceId)) continue;
    for (const actor of Object.values(state.actors)) {
      if (actor.defeated || !actor.onBattlefield) continue;
      if (!recorded && !recipe.applies(actor, state, intent.diceWindows)) continue;
      recipe.resolve(state, actor, intent.diceWindows);
    }
  }
}
