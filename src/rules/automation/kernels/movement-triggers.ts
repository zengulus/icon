import type { DiceSource } from '../../dice.js';
import type { EncounterActor, EncounterState, Position } from '../../types.js';
import type { RuleMutation } from '../primitives/types.js';

/**
 * Movement-entry trigger kernel (ICON p.151 Party Favor, p.353 bubbles,
 * p.95 Burst X placement, p.178 Symphony motes — "when any character enters
 * the space" effects).
 *
 * One generic registry replaces per-ability entry emulation: content modules
 * register a trigger whose `matchesCell` names the durable state it owns (a
 * terrain effect position, an entity space) and whose `mutations` fold
 * returns the deterministic mutations for one entered cell. The MOVE/DASH
 * command boundary folds every registered trigger over the movement's
 * entered cells and carries the resulting mutations on `RULE_MUTATIONS_APPLIED`
 * events, so the recorded mutation sequence replays identically and any roll
 * the trigger takes (a Party Favor gamble) is rolled once at the command
 * boundary with the caller's dice source.
 *
 * The kernel holds no content source IDs — `sourceId` is a content-owned
 * provenance string recorded verbatim. Forced movement (ability-mutation
 * rushes, shoves, teleports) is a separate fold concern; this kernel covers
 * voluntary standard MOVE/DASH commands.
 */

/** The movement the trigger is evaluated against. */
export interface MovementTriggerContext {
  /** Cells entered along the movement, in path order (the mover's starting
   * cell is not included). */
  enteredCells: readonly Position[];
  /** Cells vacated along the movement, in path order: the mover's origin,
   * then every intermediate cell left behind. */
  exitedCells: readonly Position[];
  /** True for a standard MOVE/DASH command. False would mark forced
   * movement (an ability mutation), which this fold does not run for. */
  voluntary: boolean;
  /** The command boundary dice source — any roll the trigger takes is baked
   * into the mutations it returns and replays identically. */
  dice: DiceSource;
}

export interface MovementTrigger {
  /** Content-owned source ID for audit provenance (never parsed or matched
   * by the kernel). */
  sourceId: string;
  /** Does this trigger watch the entered cell? Content matches against the
   * durable state it owns (a terrain effect position, an entity space). */
  matchesCell: (state: EncounterState, cell: Position) => boolean;
  /** The deterministic mutations for one entered cell, in path order. The
   * `state` and `mover` arguments are a view with the mover positioned at
   * the entered cell, so area inclusion and fly destinations see the mover
   * at the moment of entry. */
  mutations: (state: EncounterState, mover: EncounterActor, cell: Position, context: MovementTriggerContext) => readonly RuleMutation[];
}

const movementEntryTriggers: MovementTrigger[] = [];

/** Register a content-owned movement-entry trigger (content/jobs/…). */
export function registerMovementEntryTrigger(trigger: MovementTrigger): void {
  movementEntryTriggers.push(trigger);
}

export interface MovementEntryFold {
  sourceId: string;
  mutations: RuleMutation[];
}

/** Fold the registered entry triggers over a voluntary movement's entered
 * cells. Deterministic: registration order, then path order. Pure — returns
 * mutation batches without mutating state. */
export function movementEntryTriggerMutations(
  state: EncounterState,
  mover: EncounterActor,
  path: readonly Position[],
  dice: DiceSource,
): MovementEntryFold[] {
  const entered = path.map((cell) => ({ ...cell }));
  const exited = mover.position
    ? [mover.position, ...path.slice(0, -1)].map((cell) => ({ ...cell }))
    : [];
  const context: MovementTriggerContext = { enteredCells: entered, exitedCells: exited, voluntary: true, dice };
  const folds: MovementEntryFold[] = [];
  for (const trigger of movementEntryTriggers) {
    let folded: RuleMutation[] = [];
    for (const cell of entered) {
      if (!trigger.matchesCell(state, cell)) continue;
      // The mover is at the entered cell at the moment of entry; a shallow
      // actor-record copy is enough for the trigger's read-only view.
      const view = { ...state, actors: { ...state.actors, [mover.id]: { ...mover, position: { ...cell } } } };
      folded.push(...trigger.mutations(view, view.actors[mover.id], cell, context));
    }
    if (folded.length > 0) folds.push({ sourceId: trigger.sourceId, mutations: folded });
  }
  return folds;
}
