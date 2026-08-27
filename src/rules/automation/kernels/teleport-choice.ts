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
import type { Position } from '../../types.js';
import type { RuleExecutionContext } from '../primitives/types.js';
import { distance, occupied, withinGrid } from '../primitives/job-kit.js';
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
  if (!withinGrid(destination, context)) {
    throw new RuleProgramViolation('move.out-of-bounds', `${label} teleport destination is outside the battlefield.`);
  }
  if (distance(origin, destination) > range) {
    throw new RuleProgramViolation('move.range', `${label} teleport is limited to ${range} space${range === 1 ? '' : 's'} (Teleport ${range}).`);
  }
  if (occupied(destination, context, actorId)) {
    throw new RuleProgramViolation('choice.position-unavailable', `${label} teleport destination is occupied.`);
  }
  return destination;
}
