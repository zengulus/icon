import { applyRuleMutations } from './encounter-adapter.js';
import { orthogonalNeighbors, squareArea } from '../../area-geometry.js';
import type { DiceSource } from '../../dice.js';
import type { EncounterActor, EncounterState, Position, TurnEndCause } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';

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
 * The participant order is the established hook order — it is a recorded
 * contract, never flattened: runLifecyclePhase executes exactly the recipes
 * the command boundary planned, in registration order. The rows themselves
 * live in `content/jobs/lifecycle-recipes.ts` (they are source-ID content and
 * register through `registerLifecycleRecipe`); this module contains only the
 * machinery and deliberately no source IDs.
 */

export type LifecyclePhase = 'turn-start' | 'turn-end' | 'delayed' | 'round-start' | 'round-end';

export interface LifecycleRecipe {
  /** Exact source ID that owns this hook (ability/stance/mark id). */
  sourceId: string;
  phase: LifecyclePhase;
  /** Cheap precondition deciding whether the hook participates in a boundary.
   * The body keeps its own early returns as defense; both must agree. */
  applies(actor: EncounterActor, state: EncounterState, diceWindows: TurnDiceWindows): boolean;
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
  /** Dice/save windows resolved at the command boundary. */
  diceWindows: TurnDiceWindows;
  /** Whether this boundary advances the round. */
  roundAdvance: boolean;
}

/** The lifecycle registry. Content rows register through
 * `registerLifecycleRecipe`; registration order IS the boundary order. */
const lifecycleRecipes: LifecycleRecipe[] = [];

/** Register a lifecycle row (content/jobs/lifecycle-recipes.ts). Order is the
 * recorded boundary order — a new hook appends in its phase's section. */
export function registerLifecycleRecipe(recipe: LifecycleRecipe): void {
  lifecycleRecipes.push(recipe);
}

/** The closed lifecycle registry (registration order = boundary order). */
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

/** First in-grid, unoccupied, non-impassable cell within Chebyshev `radius` of
 * `center` (orthogonal neighbors when `orthogonalOnly`), sorted by distance
 * then coordinates so default placement is deterministic (mirrors job-kit's
 * freeCellsInRange ordering). */
export function freeCellNear(state: EncounterState, center: Position, radius: number, orthogonalOnly = false): Position | null {
  const occupiedCell = (cell: Position) => Object.values(state.actors).some((candidate) => candidate.onBattlefield && !candidate.defeated && candidate.position && samePosition(candidate.position, cell))
    || Object.values(state.entities).some((entity) => entity.positions[0] && samePosition(entity.positions[0], cell));
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
        const cell = freeCellNear(state, actor.position, recipe.summon.range);
        if (cell) {
          applyRuleMutations(state, [{
            kind: 'entity', sourceId: traitId, operation: 'create', entityType: recipe.summon.entityType, ownerId: actor.id, positions: [cell], count: 1, state: { companion: true },
            creationOrigin: actor.position, creationOriginSize: actor.size, creationMaxRange: recipe.summon.range,
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

/** Plan one turn boundary at the command side: roll the dice windows and
 * precompute the ordered participants (the recipes whose applies gates pass
 * for the ending actor's turn-end phase and the next actor's turn-start
 * phase). Replay consumes the intent, so it never re-rolls or re-decides
 * which hooks run. */
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
  const participants = [...new Set([
    ...LIFECYCLE_RECIPES.filter((recipe) => recipe.phase === 'turn-end' && recipe.applies(actor, state, diceWindows)).map((recipe) => recipe.sourceId),
    ...LIFECYCLE_RECIPES.filter((recipe) => recipe.phase === 'delayed' && recipe.applies(actor, state, diceWindows)).map((recipe) => recipe.sourceId),
    ...LIFECYCLE_RECIPES.filter((recipe) => recipe.phase === 'turn-start' && next && recipe.applies(next, nextRoundState, diceWindows)).map((recipe) => recipe.sourceId),
    // F6: a round-start participant is recorded when the boundary advances
    // the round AND any living actor's applies gate passes (round-start
    // recipes run per actor, e.g. True Horn for every true-horn hero).
    ...(options.nextRound > state.round
      ? LIFECYCLE_RECIPES.filter((recipe) => recipe.phase === 'round-start'
          && Object.values(state.actors).some((candidate) => !candidate.defeated && candidate.onBattlefield && recipe.applies(candidate, nextRoundState, diceWindows)))
          .map((recipe) => recipe.sourceId)
      : []),
  ])];
  return {
    intent: {
      cause: options.cause,
      participants,
      diceWindows,
      roundAdvance: options.nextRound > state.round,
    },
  };
}

/** Plan the turn-start lifecycle participants for an actor selected via
 * TAKE_TURN. Runs against the authoritative state at selection time (the
 * round has already advanced if the boundary advanced it), so round-gated
 * recipes evaluate their real gate. Turn-start recipes never consume dice
 * windows — those belong to the ending actor's turn-end boundary. */
export function planTurnStartParticipants(state: EncounterState, actor: EncounterActor): string[] {
  return [...new Set(LIFECYCLE_RECIPES
    .filter((recipe) => recipe.phase === 'turn-start' && recipe.applies(actor, state, {}))
    .map((recipe) => recipe.sourceId))];
}

/** Run one lifecycle phase. New boundaries execute exactly the recorded
 * participants (in registry order) — the participant list is the decision,
 * never re-decided at replay, because the boundary itself can consume a
 * recipe's gate precondition before its phase runs (e.g. the end-of-turn
 * status saves clear the statuses Blackheart counts). Legacy events without
 * an intent fall back to the applies gates. Each recipe's resolve re-checks
 * its own durable preconditions as the safety net. */
export function runLifecyclePhase(
  state: EncounterState,
  actor: EncounterActor,
  phase: LifecyclePhase,
  intent: TurnTransitionIntent,
): void {
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
 * The ENCOUNTER_STARTED boundary has no intent and falls back to the gates. */
export function runLifecyclePhaseForAll(
  state: EncounterState,
  phase: LifecyclePhase,
  intent: TurnTransitionIntent,
): void {
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

