/**
 * continuation-resolvers.ts — U12/U13 content rows: the deferred-rule
 * resolvers and DECISION continuations registered against program ids. The
 * U12 machinery (`kernels/continuation-runtime.ts`) dispatches armed
 * continuations at resume time; the reducer arms mark-driven continuations
 * through `registerMarkContinuationProgramId`. Content owns source-specific
 * behavior; the kernel and primitives never branch on source ids.
 *
 * A resolver is PURE over state: it reads current state (LIVE
 * re-resolution) and returns deterministic mutations — it never mutates the
 * encounter directly, never consumes dice, never makes a choice.
 * `applyRuleMutations` applies the returned list through the shared mutation
 * authority. A DECISION continuation (U13) gates the same pure computation
 * behind a recorded player/GM choice: `consume` retires the trigger at
 * window-open; `resolve` runs on accept at the command boundary.
 */
import type { ArmedContinuation, RuleMutation } from '../../../automation/primitives/types.js';
import type { EncounterState, Position } from '../../../types.js';
import { registerDecisionContinuation } from '../../../automation/kernels/continuation-runtime.js';
import { resolveCapturedActor } from '../../../automation/content/glue/reference-authoring.js';
import { collidingShoveTargets, registerMarkContinuationProgramId } from '../../../automation/kernels/encounter-adapter.js';

const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const distance = (first: Position, second: Position) => Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));

/**
 * ICON p.124 Great Giorgios (U13 migration, T5c): when the marked foe's turn
 * ends, its user MAY rush up to 4 spaces (each strictly closer), then the
 * foe is shoved that many spaces and takes that many + 2 damage. The "may"
 * is a genuine player decision — T5b's automatic rush was a known
 * approximation (it predated T5b; T5b preserved it). U13 now provides the
 * correct seam: the armed continuation opens a CHOICE window at the marked
 * foe's turn-end; the user accepts (rush) or declines (nothing), and the
 * engine never chooses a default.
 *
 * The mark is CONSUMED at window-open — the challenge's opportunity passed
 * at the end of the marked foe's turn whether or not the user rushes. The
 * accept body is the historical recipe, made pure: compute the rush
 * (strictly closer, blocked by occupancy/impassable/bounds), then shove and
 * damage — all as emitted mutations the shared mutation authority applies
 * against THEN-CURRENT state at answer time (the owner is a LIVE
 * re-resolution; the mark id is the CAPTURED value recorded at arming). The
 * rush is a fresh ability-move on the *next* turn's clock, so Slashed may
 * trigger again. The source-required "as long as you end each space of your
 * movement closer to them from when you started" is the deterministic path
 * rule — NO destination/path choice is invented by the engine.
 */
/** The pure THEN-CURRENT rush/shove/damage computation shared by the accept
 * answer (command boundary) and the replay of the recorded accept event. */
function greatGiorgiosRushMutations(state: EncounterState, continuation: ArmedContinuation): RuleMutation[] {
  const mutations: RuleMutation[] = [];
  const ownerId = continuation.refs[0]?.kind === 'captured-actor' ? continuation.refs[0].actorId : undefined;
  const targetId = continuation.refs[1]?.kind === 'captured-actor' ? continuation.refs[1].actorId : undefined;
  // The recorded continuation refs ARE the typed U1 captured-actor
  // identities; a present id must resolve (the defeated/onBattlefield
  // lifecycle check below stays caller-side on the RESOLVED actor — a
  // fallen or departed owner legitimately expires the continuation, a
  // dangling id fails closed). Absent ref (no recorded actor) → undefined.
  const owner = resolveCapturedActor({ state }, ownerId);
  const target = resolveCapturedActor({ state }, targetId);
  if (!owner || !target || !owner.position || !target.position || owner.defeated || !owner.onBattlefield) return mutations;
  const blockedCell = (candidate: Position, moverId: string) => candidate.x < 0 || candidate.y < 0
    || candidate.x >= state.grid.width || candidate.y >= state.grid.height
    || Object.values(state.actors).some((actor) => actor.id !== moverId && actor.onBattlefield && !actor.defeated && samePosition(actor.position, candidate))
    || state.grid.terrain.some((cell) => samePosition(cell.position, candidate) && cell.type === 'impassable');
  // The rush: each step strictly closer to the target, blocked like the
  // historical recipe. Computed PURELY against current state — the owner's
  // LIVE position at answer/resume time.
  const startPosition = { ...owner.position };
  let position = { ...owner.position };
  let steps = 0;
  while (steps < 4) {
    const dx = target.position.x - position.x;
    const dy = target.position.y - position.y;
    const next = Math.abs(dx) >= Math.abs(dy)
      ? { x: position.x + Math.sign(dx), y: position.y }
      : { x: position.x, y: position.y + Math.sign(dy) };
    // Each step must be strictly closer AND actually reachable — a step
    // into the target's occupied cell is blocked (the historical recipe's
    // blockedCell gate), so the hero never rushes into the foe and `rushed`
    // reflects the distance the move can actually travel.
    if (distance(next, target.position) >= distance(position, target.position)) break;
    if (blockedCell(next, owner.id)) break;
    position = next;
    steps += 1;
  }
  const rushed = distance(startPosition, position);
  if (steps > 0) {
    // A fresh ability-move through the shared mutation authority — the
    // Slashed after-ability-move gate reads it exactly as it reads any
    // ability move. The destination is the reached position (a blocked
    // step never became part of the move), so `rushed` and the applied
    // movement always agree.
    mutations.push({
      kind: 'move',
      sourceId: 'stalwart:great-giorgios',
      sourceActorId: owner.id,
      actorId: owner.id,
      movement: 'rush',
      distance: null,
      positions: [{ ...position }],
      direction: null,
      phasing: false,
    });
  }
  // The shove+damage resolve when the owner is adjacent after the rush — an
  // owner already adjacent rushes 0 but still shoves 0 and deals the +2
  // damage (the historical recipe's `distanceTo(owner.position) > 1` gate,
  // not a rushed>0 gate). The mark is NOT part of this body — it was
  // consumed at window-open.
  if (target.defeated || distance(target.position, position) > 1) {
    return mutations;
  }
  const dx = target.position.x - position.x;
  const dy = target.position.y - position.y;
  const direction = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 0, y: 0 } : { x: 0, y: Math.sign(dy) || 0 };
  // The shove expresses the FULL source distance (p.124: "shoved a number of
  // spaces equal to the spaces you just moved"); the shared movement
  // authority stops it at the first obstruction, so the target's final
  // position and the p.95 Collide derivation come from the SAME spatial
  // simulation — no pre-simulation truncation that would swallow the
  // collision event.
  if (rushed > 0) {
    mutations.push({
      kind: 'move',
      sourceId: 'stalwart:great-giorgios',
      sourceActorId: owner.id,
      actorId: target.id,
      movement: 'shove',
      distance: rushed,
      positions: [],
      direction,
      phasing: false,
    });
  }
  // Delayed raw damage routes through the shared damage kernel (the target
  // is adjacent after the shove; the raw amount is `rushed + 2`).
  mutations.push({
    kind: 'damage',
    sourceId: 'stalwart:great-giorgios',
    sourceActorId: owner.id,
    actorId: target.id,
    amount: rushed + 2,
    damageType: 'normal',
    instance: 1,
    delivery: 'effect',
    ignoreCover: true,
  });
  // ICON p.124 "Collide or Heroic: Foe also gains hatred of you after this
  // ability resolves." The only shove this ability ever makes is this
  // delayed one, so its collide fact derives through the ONE shared spatial
  // authority (the same fold the reactive trigger set uses) over the
  // assembled mutations — a caller can never assert it at the command
  // boundary. The hatred clause lands AFTER the damage, in mutation order.
  if (collidingShoveTargets(state, mutations).includes(target.id)) {
    mutations.push({
      kind: 'condition',
      sourceId: 'bastion:great-giorgios',
      sourceActorId: owner.id,
      actorId: target.id,
      conditionId: 'hatred',
      operation: 'apply',
      potency: 'normal',
    });
  }
  return mutations;
}

/** The decision row: at the marked foe's turn-end the armed continuation
 * opens a U13 choice window. The user's recorded answer decides whether the
 * rush resolves — the engine never chooses "yes" automatically and never
 * invents a destination/path. The mark is consumed at window-open (the
 * challenge's opportunity passed); accepting resolves the pure rush against
 * THEN-CURRENT state. */
registerDecisionContinuation({
  programId: 'bastion:great-giorgios',
  choice: {
    key: 'rush',
    label: 'Rush 4 toward the marked foe?',
    kind: 'boolean',
    required: true,
  },
  consume(state: EncounterState, continuation: ArmedContinuation): RuleMutation[] {
    const ownerId = continuation.refs[0]?.kind === 'captured-actor' ? continuation.refs[0].actorId : undefined;
    const targetId = continuation.refs[1]?.kind === 'captured-actor' ? continuation.refs[1].actorId : undefined;
    const owner = resolveCapturedActor({ state }, ownerId);
    const target = resolveCapturedActor({ state }, targetId);
    if (!owner || !target) return [];
    // The mark is consumed at window-open either way (the historical
    // recipe's "consumed either way" preserved — now decoupled from the
    // rush decision itself).
    const pending = target.marks.filter((mark) => mark.markId === 'great-giorgios' && mark.ownerId === owner.id);
    if (pending.length === 0) return [];
    return [{
      kind: 'mark',
      sourceId: 'bastion:great-giorgios',
      ownerId: owner.id,
      operation: 'remove',
      actorId: target.id,
      markId: 'great-giorgios',
      state: {},
    }];
  },
  resolve: greatGiorgiosRushMutations,
});
// The reducer arms the deferred continuation when this program's mark is
// applied — the single arming point for command and replay alike.
registerMarkContinuationProgramId('bastion:great-giorgios');
