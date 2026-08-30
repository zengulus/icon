/**
 * continuation-resolvers.ts — U12 content rows: the deferred-rule resolvers
 * registered against program ids. The U12 machinery
 * (`kernels/continuation-runtime.ts`) dispatches armed continuations here at
 * resume time; the reducer arms mark-driven continuations through
 * `registerMarkContinuationProgramId`. Content owns source-specific behavior;
 * the kernel and primitives never branch on source ids.
 *
 * A resolver is PURE over state: it reads current state (LIVE re-resolution)
 * and returns deterministic mutations — it never mutates the encounter
 * directly, never consumes dice, never makes a choice. `applyRuleMutations`
 * applies the returned list through the shared mutation authority.
 */
import type { ArmedContinuation, RuleMutation } from '../../../automation/primitives/types.js';
import type { EncounterState, Position } from '../../../types.js';
import { registerContinuationResolver, type ContinuationResolver } from '../../../automation/kernels/continuation-runtime.js';
import { registerMarkContinuationProgramId } from '../../../automation/kernels/encounter-adapter.js';

const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const distance = (first: Position, second: Position) => Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));

/**
 * ICON p.124 Great Giorgios (U12 migration): when the marked foe's turn ends,
 * its user may rush up to 4 spaces (each strictly closer), then the foe is
 * shoved that many spaces and takes that many + 2 damage. The mark is
 * consumed either way.
 *
 * Previously a `delayed`-phase lifecycle recipe; now an ARMED CONTINUATION:
 * the mark mutation arms it (the reducer's single arming point), and the
 * deferred-rule resolver fires at the marked foe's turn-end against
 * THEN-CURRENT state — the owner is a LIVE re-resolution (the armed record
 * captured only the owner id; the current battlefield position is read at
 * resume time), while the mark id it consumes is the CAPTURED value recorded
 * at arming. The resume body is the historical recipe, made pure: consume the
 * mark, compute the rush (strictly closer, blocked by occupancy/impassable/
 * bounds), then shove and damage — all as emitted mutations the shared
 * mutation authority applies. The rush is a fresh ability-move on the *next*
 * turn's clock, so Slashed may trigger again and the flag it sets must
 * survive the boundary.
 */
const greatGiorgiosResolver: ContinuationResolver = {
  programId: 'bastion:great-giorgios',
  resolve(state: EncounterState, continuation: ArmedContinuation): RuleMutation[] {
    const mutations: RuleMutation[] = [];
    const ownerId = continuation.refs[0]?.kind === 'captured-actor' ? continuation.refs[0].actorId : undefined;
    const targetId = continuation.refs[1]?.kind === 'captured-actor' ? continuation.refs[1].actorId : undefined;
    const owner = ownerId ? state.actors[ownerId] : undefined;
    const target = targetId ? state.actors[targetId] : undefined;
    if (!owner || !target || !owner.position || !target.position || owner.defeated || !owner.onBattlefield) return mutations;
    // The mark is consumed either way (matching the historical recipe). The
    // mark lives on the TARGET; the CAPTURED mark id names what armed this
    // continuation.
    const pending = target.marks.filter((mark) => mark.markId === 'great-giorgios' && mark.ownerId === owner.id);
    if (pending.length === 0) return mutations;
    const markRemoval: RuleMutation = {
      kind: 'mark',
      sourceId: 'bastion:great-giorgios',
      ownerId: owner.id,
      operation: 'remove',
      actorId: target.id,
      markId: 'great-giorgios',
      state: {},
    };
    const blockedCell = (candidate: Position, moverId: string) => candidate.x < 0 || candidate.y < 0
      || candidate.x >= state.grid.width || candidate.y >= state.grid.height
      || Object.values(state.actors).some((actor) => actor.id !== moverId && actor.onBattlefield && !actor.defeated && samePosition(actor.position, candidate))
      || state.grid.terrain.some((cell) => samePosition(cell.position, candidate) && cell.type === 'impassable');
    // The rush: each step strictly closer to the target, blocked like the
    // historical recipe. Computed PURELY against current state — the owner's
    // LIVE position at resume time.
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
    // The mark is consumed either way; the shove+damage resolve when the
    // owner is adjacent after the rush — an owner already adjacent rushes 0
    // but still shoves 0 and deals the +2 damage (the historical recipe's
    // `distanceTo(owner.position) > 1` gate, not a rushed>0 gate).
    if (target.defeated || distance(target.position, position) > 1) {
      return [...mutations, markRemoval];
    }
    const dx = target.position.x - position.x;
    const dy = target.position.y - position.y;
    const direction = Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 0, y: 0 } : { x: 0, y: Math.sign(dy) || 0 };
    // The shove: computed PURELY against current state (the target's LIVE
    // position) — a local position, never a mutation of the encounter.
    let shovedPosition = { ...target.position };
    let shoved = 0;
    while (shoved < rushed) {
      const next = { x: shovedPosition.x + direction.x, y: shovedPosition.y + direction.y };
      if (blockedCell(next, target.id)) break;
      shovedPosition = next;
      shoved += 1;
    }
    if (shoved > 0) {
      mutations.push({
        kind: 'move',
        sourceId: 'stalwart:great-giorgios',
        sourceActorId: owner.id,
        actorId: target.id,
        movement: 'shove',
        distance: shoved,
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
    return [...mutations, markRemoval];
  },
};

registerContinuationResolver(greatGiorgiosResolver);
// The reducer arms the deferred continuation when this program's mark is
// applied — the single arming point for command and replay alike.
registerMarkContinuationProgramId('bastion:great-giorgios');
