/**
 * Player-selected Teleport destinations (F1 foundation, Nothung repair harvest).
 *
 * ICON p.88: "Teleport X: move instantly to an unoccupied space within range
 * X." When an ability's source text says "Teleport X" without a direction, the
 * destination is a durable player choice — never an engine-invented
 * direction. This kernel is the single reusable seam for reading and
 * validating such a choice from the generic position input
 * (`RuleExecutionInput.positions`, the same mechanism Klingenkunst's
 * `destination` key uses), so every resolver that hosts an unqualified
 * Teleport X validates identically:
 *
 *   - a missing choice for a REQUIRED teleport rejects the command
 *     (`choice.position-required`, nothing consumed);
 *   - a missing choice for an OPTIONAL teleport ("may teleport X") means the
 *     actor simply does not teleport;
 *   - a chosen destination must be in-grid, within `range` of `origin` (the
 *     position the teleport is measured from at that point in the program),
 *     and unoccupied at the moment of the program's own pre-check;
 *   - the F1 spatial gateway re-validates bounds/occupancy/rampart when the
 *     emitted teleportMutation is applied, so a hostile Rampart still blocks
 *     the leg.
 *
 * The kernel carries no source IDs: `actorId`/`key`/`label` are supplied by
 * the calling content resolver, and `key` names the command input slot.
 */
import type { EncounterActor, Position } from '../../types.js';
import type { RuleExecutionContext } from '../primitives/types.js';
import { validateSpatialIntent } from '../primitives/spatial-intent.js';
import { rampartObstructs } from './encounter-adapter.js';
import { validatePositionLegality } from './evaluate-query.js';
import { RuleProgramViolation } from './runtime.js';

export interface TeleportChoiceOptions {
  /** Whether the teleport may be declined. Default false (required). */
  optional?: boolean;
}

/**
 * The chosen destination for one unqualified "Teleport X" clause, or `null`
 * when the teleport is optional and the player supplied no choice. Throws a
 * `RuleProgramViolation` for a missing required choice, an out-of-bounds
 * destination, an out-of-range destination, or an occupied destination —
 * the same violation codes Nothung's original repair established, so the
 * command boundary rejects the whole ability (nothing consumed) instead of
 * silently dropping the leg.
 */
export function chosenTeleportDestination(
  context: RuleExecutionContext,
  actorId: string,
  key: string,
  origin: Position,
  range: number,
  label: string,
  options?: TeleportChoiceOptions,
): Position | null {
  const destination = context.input.positions?.[key]?.[0];
  if (!destination) {
    if (options?.optional) return null;
    throw new RuleProgramViolation('choice.position-required', `${label} requires a chosen teleport destination.`);
  }
  // Position legality (in-grid / footprint range / occupied / line of sight)
  // routes through the U3 position-domain predicates — the same authority the
  // free-cell candidate scans use — mapped onto the teleport kernel's
  // historical violation codes so the command boundary rejects the whole
  // ability identically.
  //
  // ICON p.108: "For a space to be valid for summoning, teleporting, or
  // creating objects, unless specified it must be free and unobstructed, and
  // you also need line of sight." The player-chosen destination must have
  // line of sight from the teleporter's current position (the same origin the
  // range is measured from); a destination behind impassable terrain or an
  // LoS-blocking effect is rejected here, at the generic legality operator,
  // exactly like an out-of-bounds or occupied one. (Forced/derived teleports
  // — save-driven or swap legs whose LoS source the source text does not
  // define — stay the movement gateway's application-time authority; this
  // gate governs player-chosen Teleport X destinations.)
  //
  // p.92: "range is measured from the edge of the origin space (or
  // character)" — the mover's own FOOTPRINT (size 1 → the origin point cell;
  // size N → the edge of the N×N footprint), the same canonical frame every
  // other legality/measurement consumer reads from the resolved anchor. The
  // mover id is an already-resolved identity supplied by the caller; reading
  // its factual size alongside the equally-factual current position is a
  // frame read, never a new identity interpretation. A Size-1 mover is
  // unchanged (originSize 1 ≡ today's point-cell metric). The mover record
  // is REQUIRED: a missing mover has no footprint to measure from, and
  // absence must never be silently treated as Size 1 — that would restore
  // the degenerate point frame this seam exists to repudiate. The caller's
  // id is already-resolved, so a missing record is invalid/unreachable
  // state and fails closed with the shared missing-actor violation before
  // any destination legality is accepted.
  const mover = context.state.actors[actorId];
  if (!mover) {
    throw new RuleProgramViolation('selector.actor-missing', `Teleport mover ${actorId} does not exist; p.92 range cannot be measured from a missing footprint.`);
  }
  const originFrame = { position: origin, size: mover.size };
  const legality = validatePositionLegality({
    origin,
    originSize: mover.size,
    range,
    excludeActorId: actorId,
    lineOfSightFrom: originFrame,
  }, destination, context);
  if (!legality.legal) {
    switch (legality.problem) {
      case 'out-of-bounds':
        throw new RuleProgramViolation('move.out-of-bounds', `${label} teleport destination is outside the battlefield.`);
      case 'range':
        throw new RuleProgramViolation('move.range', `${label} teleport is limited to ${range} space${range === 1 ? '' : 's'} (Teleport ${range}).`);
      case 'occupied':
        throw new RuleProgramViolation('choice.position-unavailable', `${label} teleport destination is occupied.`);
      case 'line-of-sight':
        throw new RuleProgramViolation('move.line-of-sight', `${label} teleport destination is outside line of sight.`);
    }
  }
  return destination;
}

/** One leg of an ordered "Teleport X … Teleport X" sequence (Nothung's two
 * teleports, p.225). `range` is that leg's listed distance and `key` names
 * the command input slot for its destination. */
export interface PlannedTeleportLeg {
  key: string;
  label: string;
  range: number;
  /** Whether this leg may be declined ("may teleport X"). */
  optional?: boolean;
}

/**
 * Resolve an ordered sequence of unqualified "Teleport X" clauses as one
 * PLANNED PATH, validating every destination against the actor's position
 * AFTER the preceding legs were actually applied — never against a
 * destination the actor never reached.
 *
 * Each leg's chosen destination passes the ordinary in-grid / range /
 * occupancy pre-check from the current SIMULATED position, then the shared
 * F1 spatial gateway (bounds, occupancy, impassable terrain, Rampart) is
 * consulted the same way the reducer applies the emitted teleport mutation:
 * a leg the gateway would deny leaves the simulated position UNCHANGED (that
 * teleport simply fails at application, exactly as the reducer behaves), so
 * the NEXT leg's choice is validated against the actor's true position. A
 * later choice that was only legal from an unreached destination is therefore
 * rejected at the command boundary (nothing consumed) instead of executing a
 * teleport from the wrong origin.
 *
 * Returns one destination per leg in order (null for a declined optional
 * leg); the caller emits the teleport mutations in the same order. When the
 * context carries no encounter state (isolated VM fixtures), the gateway
 * cannot be consulted and each leg falls back to validating against the
 * intended previous destination — the historical behavior.
 */
export function chosenTeleportPath(
  context: RuleExecutionContext,
  actorId: string,
  legs: PlannedTeleportLeg[],
): Array<Position | null> {
  const actor = context.encounterState?.actors[actorId];
  if (!context.encounterState || !actor) {
    // No authoritative state: validate each leg against the intended previous
    // destination (the historical sequential behavior).
    let intendedOrigin: Position | null = null;
    const results: Array<Position | null> = [];
    for (const leg of legs) {
      const origin = intendedOrigin ?? currentActorPosition(context, actorId);
      const destination = chosenTeleportDestination(context, actorId, leg.key, origin, leg.range, leg.label, { optional: leg.optional });
      results.push(destination);
      if (destination) intendedOrigin = destination;
    }
    return results;
  }
  // Planned-path simulation: the simulated position advances only when the
  // preceding leg is actually valid through the shared spatial gateway.
  const results: Array<Position | null> = [];
  let simulated = actor.position;
  if (!simulated) return legs.map(() => null);
  for (const leg of legs) {
    const destination = chosenTeleportDestination(context, actorId, leg.key, simulated, leg.range, leg.label, { optional: leg.optional });
    results.push(destination);
    if (!destination) continue;
    if (teleportLegApplies(context.encounterState, actor, simulated, destination)) simulated = destination;
  }
  return results;
}

function currentActorPosition(context: RuleExecutionContext, actorId: string): Position {
  const position = context.state.actors[actorId]?.position;
  if (!position) throw new RuleProgramViolation('selector.actor-position', `${actorId} has no position.`);
  return position;
}

/** True when the reducer's F1 gateway would actually apply a teleport leg
 * from `from` to `to` (bounds, occupancy, impassable terrain, and Rampart —
 * the exact `movementSpatialIntent` construction). The ordinary in-grid /
 * range / occupancy pre-check has already passed. */
function teleportLegApplies(
  state: Parameters<typeof validateSpatialIntent>[0],
  actor: EncounterActor,
  from: Position,
  to: Position,
): boolean {
  // p.104 Rampart blocks teleporting: a teleport is denied when entering or
  // leaving rampart differs (the same formula movementSpatialIntent uses).
  const rampartObstructed = rampartObstructs(state, actor, from) !== rampartObstructs(state, actor, to);
  const validation = validateSpatialIntent(state, {
    kind: 'teleport',
    actorId: actor.id,
    sourceActorId: actor.id,
    sourceRuleId: 'teleport-choice',
    from,
    to,
    rampartObstructed,
  });
  return validation.legal;
}
