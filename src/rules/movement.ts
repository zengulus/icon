import type { EncounterActor, EncounterState, Position, TerrainCell } from './types.js';
import { encounterConditionSet, rampartObstructs } from './automation/encounter-adapter.js';

/** The two built-in movement abilities available to an actor. */
export type MovementMode = 'standard' | 'dash';

export interface MovementIssue {
  /** Stable machine-readable rule identifier, suitable for UI treatment. */
  code: string;
  /** Human-readable explanation matching reducer rejections. */
  message: string;
}

/**
 * One resolved leg of a movement route. Penalties are mutually exclusive; the
 * largest one is added to the base cost of one space.
 */
export interface MovementStep {
  from: Position;
  to: Position;
  cost: number;
  difficultTerrainPenalty: number;
  elevationPenalty: number;
  engagementPenalty: number;
  entersOrExitsDangerousTerrain: boolean;
}

/**
 * A deterministic preview of a movement command. `path` excludes the actor's
 * current position and can be submitted directly as an EncounterCommand MOVE
 * path whenever `legal` is true.
 */
export interface MovementPlan {
  actorId: string;
  mode: MovementMode;
  destination: Position;
  path: Position[];
  steps: MovementStep[];
  /** Total movement spent along `path`, including terrain/engagement costs. */
  cost: number;
  /** The actor's speed for standard movement, or Dash value for a dash. */
  allowance: number;
  /** Dash costs one action; a standard move is free. */
  actionCost: number;
  /** Whether execution marks the actor's once-per-turn standard move as used. */
  spendsStandardMove: boolean;
  /** Whether execution records use of the once-per-turn Dash basic ability. */
  spendsDash: boolean;
  /** Damage caused by dangerous terrain after a successful route. */
  dangerousDamage: number;
  /** Damage caused by Slashed after a successful route. */
  slashedDamage: number;
  legal: boolean;
  issue: MovementIssue | null;
}

interface MovementPreflight {
  actor: EncounterActor | null;
  issue: MovementIssue | null;
}

interface ResolvedStep {
  step: MovementStep | null;
  issue: MovementIssue | null;
}

const ORTHOGONAL_DIRECTIONS: readonly Position[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const DIAGONAL_DIRECTIONS: readonly Position[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 },
];

const copyPosition = ({ x, y }: Position): Position => ({ x, y });
const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const positionKey = ({ x, y }: Position) => `${x},${y}`;
const distance = (a: Position, b: Position) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const inBounds = (state: EncounterState, position: Position) => position.x >= 0
  && position.y >= 0
  && position.x < state.grid.width
  && position.y < state.grid.height;
const terrainAt = (state: EncounterState, position: Position): TerrainCell | undefined => state.grid.terrain.find((cell) => samePosition(cell.position, position));

/**
 * Terrain effects can overlap the base map terrain (for example, dangerous
 * terrain over a pit).  The movement rules use their union for the properties
 * that are independent of elevation; elevation remains a property of the base
 * grid cell.
 */
function terrainTypesAt(state: EncounterState, position: Position) {
  const types = new Set<string>();
  const base = terrainAt(state, position);
  if (base) types.add(base.type);
  for (const effect of state.terrainEffects) {
    if (effect.positions.some((candidate) => samePosition(candidate, position))) types.add(effect.terrain);
  }
  return types;
}

function elevationAt(state: EncounterState, position: Position) {
  const cell = terrainAt(state, position);
  if (!cell) return 0;
  // ICON p. 89: pits count as one elevation lower than their base space.
  return cell.elevation - (cell.type === 'pit' ? 1 : 0);
}

function objectAt(state: EncounterState, position: Position) {
  return Object.values(state.entities).find((entity) => entity.type === 'object'
    && entity.positions.some((candidate) => samePosition(candidate, position)));
}

function movementConditions(actor: EncounterActor) {
  return encounterConditionSet(actor);
}

function movementAllowance(actor: EncounterActor, mode: MovementMode) {
  const conditions = movementConditions(actor);
  // ICON p. 105: Skirmisher makes Dash a full-Speed move.
  return mode === 'standard' || conditions.has('skirmisher') ? actor.speed : actor.dash;
}

function canMoveDiagonally(actor: EncounterActor) {
  return movementConditions(actor).has('skirmisher');
}

function ignoresObstructionWhileMoving(actor: EncounterActor) {
  const conditions = movementConditions(actor);
  // ICON p. 104–105: Fly and Phasing pass through obstructions, but neither
  // permits ending movement in an occupied or impassable space.
  return conditions.has('flying') || conditions.has('phasing');
}

function ignoresTerrainCosts(actor: EncounterActor) {
  return movementConditions(actor).has('flying');
}

function ignoresEngagement(actor: EncounterActor, mode: MovementMode) {
  const conditions = movementConditions(actor);
  return mode === 'dash' || conditions.has('flying') || conditions.has('unstoppable');
}

function issue(code: string, message: string): MovementIssue {
  return { code, message };
}

function basePlan(actorId: string, destination: Position, mode: MovementMode, actor?: EncounterActor | null): MovementPlan {
  return {
    actorId,
    mode,
    destination: copyPosition(destination),
    path: [],
    steps: [],
    cost: 0,
    allowance: actor ? movementAllowance(actor, mode) : 0,
    actionCost: mode === 'dash' ? 1 : 0,
    spendsStandardMove: mode === 'standard',
    spendsDash: mode === 'dash',
    dangerousDamage: 0,
    slashedDamage: 0,
    legal: false,
    issue: null,
  };
}

function invalidPlan(plan: MovementPlan, reason: MovementIssue): MovementPlan {
  return { ...plan, legal: false, issue: reason };
}

function preflightActor(state: EncounterState, actorId: string): MovementPreflight {
  if (state.phase !== 'active') {
    return { actor: null, issue: issue('encounter.not-active', 'The encounter is not active.') };
  }
  if (state.activeActorId !== actorId) {
    return { actor: null, issue: issue('turn.not-active-actor', 'Only the active actor can take that action.') };
  }
  const actor = state.actors[actorId];
  if (!actor || actor.defeated || !actor.onBattlefield) {
    return { actor: null, issue: issue('actor.unavailable', 'That actor cannot act.') };
  }
  if (movementConditions(actor).has('immobile')) {
    return { actor: null, issue: issue('move.immobile', 'Immobile characters cannot move.') };
  }
  return { actor, issue: null };
}

function movementAvailabilityIssue(actor: EncounterActor, mode: MovementMode): MovementIssue | null {
  if (mode === 'standard' && actor.standardMoveUsed) {
    return issue('move.standard-used', 'The standard move has already been used this turn.');
  }
  if (mode === 'dash' && actor.actionsRemaining < 1) {
    return issue('action.insufficient', 'Dashing costs one action.');
  }
  if (mode === 'dash' && actor.usedAbilityIds.includes('basic:dash')) {
    return issue('ability.repeat', 'Dash cannot be repeated during the same turn.');
  }
  return null;
}

function preflightMovement(state: EncounterState, actorId: string, mode: MovementMode): MovementPreflight {
  const preflight = preflightActor(state, actorId);
  if (preflight.issue || !preflight.actor) return preflight;
  return { actor: preflight.actor, issue: movementAvailabilityIssue(preflight.actor, mode) };
}

function occupantAt(state: EncounterState, actor: EncounterActor, position: Position): EncounterActor | undefined {
  return Object.values(state.actors).find((other) => !other.defeated && other.onBattlefield && other.id !== actor.id && samePosition(other.position, position));
}

function destinationIssue(state: EncounterState, actor: EncounterActor, destination: Position): MovementIssue | null {
  if (!inBounds(state, destination)) return issue('move.out-of-bounds', 'Movement cannot leave the battlefield.');
  const occupant = occupantAt(state, actor, destination);
  if (occupant) {
    return issue(
      'move.obstructed',
      occupant.side === actor.side
        ? 'Movement can pass through an ally but cannot end in their space.'
        : 'A foe obstructs that space.',
    );
  }
  if (objectAt(state, destination)) {
    return issue('move.obstructed', 'An object obstructs that space.');
  }
  if (terrainTypesAt(state, destination).has('impassable')) {
    return issue('move.impassable', 'Impassable terrain obstructs movement.');
  }
  return null;
}

/**
 * Resolves one ordinary step. It deliberately does not enforce final-space
 * allied occupancy: allies are legal waypoints but not legal destinations.
 */
function resolveStep(
  state: EncounterState,
  actor: EncounterActor,
  from: Position,
  to: Position,
  mode: MovementMode,
): ResolvedStep {
  if (!inBounds(state, to)) {
    return { step: null, issue: issue('move.out-of-bounds', 'Movement cannot leave the battlefield.') };
  }
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const orthogonal = dx + dy === 1;
  const diagonal = dx === 1 && dy === 1;
  if (!orthogonal && !(diagonal && canMoveDiagonally(actor))) {
    return { step: null, issue: issue('move.orthogonal', 'Movement must follow an orthogonal, contiguous path unless the character has Skirmisher.') };
  }
  const occupant = occupantAt(state, actor, to);
  if (occupant && occupant.side !== actor.side && !ignoresObstructionWhileMoving(actor)) {
    return { step: null, issue: issue('move.obstructed', 'A foe obstructs that space.') };
  }
  if ((objectAt(state, to) || terrainTypesAt(state, to).has('impassable')) && !ignoresObstructionWhileMoving(actor)) {
    return { step: null, issue: issue('move.impassable', 'Impassable terrain obstructs movement.') };
  }
  const flying = ignoresTerrainCosts(actor);
  // Rampart (p.104): foes cannot enter or exit affected spaces by dashing or
  // flying. Standard movement is unaffected; Slip and Unstoppable ignore it.
  if (mode === 'dash' || flying) {
    if (rampartObstructs(state, actor, from) !== rampartObstructs(state, actor, to)) {
      return { step: null, issue: issue('move.rampart', 'Rampart obstructs dashing and flying movement.') };
    }
  }
  const currentTerrain = terrainTypesAt(state, from);
  const destinationTerrain = terrainTypesAt(state, to);
  const difficultTerrainPenalty = !flying && currentTerrain.has('difficult') ? 1 : 0;
  const rawElevationPenalty = flying ? 0 : Math.max(0, elevationAt(state, to) - elevationAt(state, from));
  const elevationPenalty = Math.max(0, rawElevationPenalty - (currentTerrain.has('slope') ? 1 : 0));
  if (elevationPenalty >= 4) {
    return { step: null, issue: issue('move.elevation', 'Normal movement cannot climb four or more elevation levels at once.') };
  }
  const engagementPenalty = ignoresEngagement(actor, mode) || !Object.values(state.actors).some((other) => other.side !== actor.side && !other.defeated && other.onBattlefield && distance(other.position, from) <= 1)
    ? 0
    : 1;
  const penalty = Math.max(difficultTerrainPenalty, elevationPenalty, engagementPenalty);
  return {
    step: {
      from: copyPosition(from),
      to: copyPosition(to),
      cost: 1 + penalty,
      difficultTerrainPenalty,
      elevationPenalty,
      engagementPenalty,
      entersOrExitsDangerousTerrain: !flying && (destinationTerrain.has('dangerous') || currentTerrain.has('dangerous')),
    },
    issue: null,
  };
}

function consequences(actor: EncounterActor, steps: readonly MovementStep[]): Pick<MovementPlan, 'dangerousDamage' | 'slashedDamage'> {
  return {
    dangerousDamage: !movementConditions(actor).has('flying') && !actor.dangerousTerrainTriggeredThisTurn && steps.some((step) => step.entersOrExitsDangerousTerrain) ? 2 : 0,
    slashedDamage: actor.statuses.includes('slashed') && !actor.slashedTriggeredThisTurn ? Math.max(0, 4 - actor.armor) : 0,
  };
}

function completePlan(
  plan: MovementPlan,
  actor: EncounterActor,
  path: readonly Position[],
  steps: readonly MovementStep[],
): MovementPlan {
  const cost = steps.reduce((total, step) => total + step.cost, 0);
  const route = path.map(copyPosition);
  const resolved: MovementPlan = {
    ...plan,
    destination: copyPosition(route.at(-1) ?? actor.position),
    path: route,
    steps: steps.map((step) => ({ ...step, from: copyPosition(step.from), to: copyPosition(step.to) })),
    cost,
    ...consequences(actor, steps),
  };
  if (cost > resolved.allowance) {
    return invalidPlan(resolved, issue('move.too-far', `That path costs ${cost} movement; only ${resolved.allowance} is available.`));
  }
  return { ...resolved, legal: true, issue: null };
}

/**
 * Validates an explicitly supplied path with the same rules used by
 * `planMovement`. This is useful at the command boundary, where clients submit
 * a route rather than merely a destination.
 */
export function planMovementPath(
  state: EncounterState,
  actorId: string,
  path: readonly Position[],
  mode: MovementMode,
): MovementPlan {
  const preflight = preflightActor(state, actorId);
  const destination = path.at(-1) ?? state.actors[actorId]?.position ?? { x: 0, y: 0 };
  let plan = basePlan(actorId, destination, mode, preflight.actor);
  if (preflight.issue) return invalidPlan(plan, preflight.issue);
  const actor = preflight.actor!;
  if (path.length === 0) return invalidPlan(plan, issue('move.empty', 'Choose at least one destination space.'));
  const availabilityIssue = movementAvailabilityIssue(actor, mode);
  if (availabilityIssue) return invalidPlan(plan, availabilityIssue);

  const steps: MovementStep[] = [];
  let previous = actor.position;
  for (let index = 0; index < path.length; index += 1) {
    const point = path[index]!;
    const resolved = resolveStep(state, actor, previous, point, mode);
    if (resolved.issue) return invalidPlan(plan, resolved.issue);
    if (index === path.length - 1) {
      const finalIssue = destinationIssue(state, actor, point);
      if (finalIssue) return invalidPlan(plan, finalIssue);
    }
    steps.push(resolved.step!);
    previous = point;
  }
  plan = completePlan(plan, actor, path, steps);
  return plan;
}

interface QueueEntry {
  position: Position;
  cost: number;
}

function findCheapestRoute(state: EncounterState, actor: EncounterActor, destination: Position, mode: MovementMode): Position[] | null {
  const originKey = positionKey(actor.position);
  const destinationKey = positionKey(destination);
  const distances = new Map<string, number>([[originKey, 0]]);
  const previous = new Map<string, Position>();
  const positions = new Map<string, Position>([[originKey, copyPosition(actor.position)]]);
  const queue: QueueEntry[] = [{ position: copyPosition(actor.position), cost: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost || a.position.y - b.position.y || a.position.x - b.position.x);
    const current = queue.shift()!;
    const currentKey = positionKey(current.position);
    if (current.cost !== distances.get(currentKey)) continue;
    if (currentKey === destinationKey) {
      const route: Position[] = [];
      let cursor = destinationKey;
      while (cursor !== originKey) {
        const position = positions.get(cursor)!;
        route.unshift(copyPosition(position));
        cursor = positionKey(previous.get(cursor)!);
      }
      return route;
    }

    for (const direction of canMoveDiagonally(actor) ? [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS] : ORTHOGONAL_DIRECTIONS) {
      const next = { x: current.position.x + direction.x, y: current.position.y + direction.y };
      const nextKey = positionKey(next);
      const isFinalSpace = nextKey === destinationKey;
      const resolved = resolveStep(state, actor, current.position, next, mode);
      if (resolved.issue) continue;
      if (isFinalSpace && destinationIssue(state, actor, next)) continue;
      const nextCost = current.cost + resolved.step!.cost;
      const knownCost = distances.get(nextKey);
      if (knownCost !== undefined && knownCost <= nextCost) continue;
      distances.set(nextKey, nextCost);
      previous.set(nextKey, copyPosition(current.position));
      positions.set(nextKey, copyPosition(next));
      queue.push({ position: next, cost: nextCost });
    }
  }
  return null;
}

/**
 * Finds the least-cost legal orthogonal route to a destination and resolves its
 * effects without mutating encounter state. A plan whose route exceeds the
 * current allowance is returned with its cost and `legal: false`, allowing a
 * caller to explain why a preview cannot be submitted.
 */
export function planMovement(
  state: EncounterState,
  actorId: string,
  destination: Position,
  mode: MovementMode,
): MovementPlan {
  const preflight = preflightMovement(state, actorId, mode);
  let plan = basePlan(actorId, destination, mode, preflight.actor);
  if (preflight.issue) return invalidPlan(plan, preflight.issue);
  const actor = preflight.actor!;
  if (samePosition(actor.position, destination)) {
    return invalidPlan(plan, issue('move.empty', 'Choose at least one destination space.'));
  }
  const finalIssue = destinationIssue(state, actor, destination);
  if (finalIssue) return invalidPlan(plan, finalIssue);
  if (Math.abs(destination.x - actor.position.x) + Math.abs(destination.y - actor.position.y) === 1) {
    const directStep = resolveStep(state, actor, actor.position, destination, mode);
    if (directStep.issue) return invalidPlan(plan, directStep.issue);
  }

  const path = findCheapestRoute(state, actor, destination, mode);
  if (!path) {
    return invalidPlan(plan, issue('move.unreachable', 'No legal route reaches that destination.'));
  }
  plan = planMovementPath(state, actorId, path, mode);
  return plan;
}
