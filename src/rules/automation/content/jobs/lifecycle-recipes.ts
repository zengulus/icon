import { applyRuleMutations, determineAndApplyEncounterDamage, encounterRuleState } from '../../kernels/encounter-adapter.js';
import { gambleD6 } from '../../primitives/job-kit.js';
import { auraDefinitionFor, auraOriginRefs, auraStateView, isAuraMember, isInAura } from '../../kernels/aura.js';
import { hasMastery } from '../../kernels/mastery.js';
import { resolveSaveWindow } from '../../primitives/save-window.js';
import { isAtHpThreshold } from '../../kernels/hp-threshold.js';
import { applyLifecycleAbilityMove, freeCellNear, registerLifecycleRecipe, registerTurnDiceWindowPlanner, type LifecyclePhase } from '../../kernels/lifecycle.js';
import { tickPowerDie } from '../../kernels/power-die.js';
import { resolveGamble } from '../../primitives/gamble-window.js';
import { registerMovementEntryTrigger } from '../../kernels/movement-triggers.js';
import { nearestCandidates } from '../../kernels/evaluate-query.js';
import { axisDirection, orthogonalNeighbors, squareArea } from '../../../area-geometry.js';
import { clockForTiming } from '../../primitives/scope.js';
import type { BoundaryRef, LifecycleIdentity } from '../../primitives/scope.js';
import type { RuleTiming } from '../../primitives/types.js';
import { capturedActor } from '../../primitives/reference.js';
import { entityAnchorPosition } from '../../primitives/anchor.js';
import { applyLifecycleScopedUsage, currentLifecycleInstanceFor, incubusOncePerRoundKey, lifecycleObservationForGroup, oneInterruptPerTurnWindowKey, recordLifecycleInstance, recordUsageKey, refreshUsageLedgerForBoundary, stampedeOncePerRoundKey, usageCount, usageLedgerHoldsForBoundary, useLedgerAvailable } from '../../kernels/use-ledger.js';
import type { DiceSource } from '../../../dice.js';
import type { EncounterActor, EncounterMark, EncounterState, Position } from '../../../types.js';
import type { RuleMutation } from '../../primitives/types.js';

const samePosition = (first: Position, second: Position) => first.x === second.x && first.y === second.y;
const distance = (first: Position, second: Position) => Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));

/**
 * Job/class lifecycle recipe rows (F6, docs/rules-foundations.md §7).
 *
 * Every turn-boundary hook that runs through the F3 lifecycle kernel
 * registers here as a row — exact source ID + phase + applies gate +
 * deterministic body — in the established boundary order (the order below is
 * a recorded contract, never flattened). The machinery lives in
 * `kernels/lifecycle.ts`; this file is pure content and references it.
 */

// ---------------------------------------------------------------------------
// Content helpers (source-specific, used by the rows and by encounter.ts)
// ---------------------------------------------------------------------------

/** ICON p.151 Gallows Humor: the stance's d6 power die ticks up by 1 (to a
 * maximum of 6) when the stance refreshes at the start of the user's turn, or
 * whenever you or an ally misses or is missed by an attack anywhere. */
export function tickGallowsHumorDie(actor: EncounterActor) {
  if (actor.stance?.stanceId !== 'gallows-humor') return;
  tickPowerDie(actor, 'gallows-humor:die', 1, 6);
}

/** Pure helper: compute the deterministic mutations for a Symphony mote
 * detonation at `position`. No side effects — returns only the mutations that
 * ride on `RULE_MUTATIONS_APPLIED` events. Used by both the movement-entry
 * trigger (ICON p.178 "enters the space") and the turn-start lifecycle hook
 * ("starts a turn on a mote"). */
export function symphonyMoteDetonationMutations(
  state: EncounterState,
  actor: EncounterActor,
  position: Position,
): RuleMutation[] {
  const mote = state.terrainEffects.find((effect) =>
    effect.terrain === 'symphony-mote' && effect.positions.some((cell) => samePosition(cell, position)),
  );
  if (!mote) return [];
  const owner = mote.ownerId ? state.actors[mote.ownerId] : undefined;
  const ownerSide = owner?.side ?? actor.side;
  const center = { ...position };
  const blast = squareArea(center, 1);
  const mutations: RuleMutation[] = [];
  for (const character of Object.values(state.actors)) {
    if (character.defeated || !character.onBattlefield || !character.position) continue;
    if (!blast.some((cell) => samePosition(cell, character.position))) continue;
    if (character.side === ownerSide) {
      mutations.push({ kind: 'vigor', sourceId: 'chanter:symphony', actorId: character.id, amount: 2, uncapped: false });
    } else {
      mutations.push({ kind: 'damage', sourceId: 'chanter:symphony', sourceActorId: actor.id, actorId: character.id, amount: owner?.fray ?? actor.fray, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false });
    }
  }
  if (actor.side === ownerSide) {
    mutations.push({ kind: 'resource', sourceId: 'chanter:symphony', actorId: actor.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null });
    // "May fly 1" — the blessed character's 1-space destination is a player
    // choice. The historical "one step toward the nearest foe" default is an
    // approximation (pre-existing; the direction itself is not source-named).
    // The closest-foe selection is the shared min-distance operator — NO
    // invented actor-id tie-break: when several foes are equidistant the
    // direction is genuinely ambiguous and the optional "may fly 1" is
    // declined instead (declining is always source-valid for "may").
    const nearest = nearestCandidates(
      Object.values(state.actors).filter((candidate) =>
        candidate.side !== actor.side && candidate.onBattlefield && !candidate.defeated && candidate.position,
      ),
      position,
    );
    const direction = nearest.length === 1
      ? axisDirection(position, nearest[0].position!)
      : nearest.length === 0
        ? { x: 1, y: 0 }
        : null;
    if (direction === null) return mutations;
    const next = { x: center.x + Math.sign(direction.x), y: center.y + Math.sign(direction.y) };
    const free = next.x >= 0 && next.y >= 0 && next.x < state.grid.width && next.y < state.grid.height
      && !Object.values(state.actors).some((candidate) =>
        candidate.onBattlefield && !candidate.defeated && candidate.position && samePosition(candidate.position, next),
      )
      && !state.grid.terrain.some((cell) => samePosition(cell.position, next) && cell.type === 'impassable');
    if (free) {
      mutations.push({
        kind: 'move', sourceId: 'chanter:symphony', sourceActorId: actor.id, actorId: actor.id,
        movement: 'fly', distance: 1, positions: [next], direction, phasing: false,
      });
    }
  }
  return mutations;
}

/** ICON p.178 Symphony: a character that enters or starts a turn on a mote
 * detonates it — a small blast centered on them (foes take fray, allies gain
 * 2 vigor); a triggering hero is blessed and flies 1, a triggering foe gets a
 * pit under them. The mote is consumed; the pit is a side effect. */
export function detonateSymphonyMote(state: EncounterState, actor: EncounterActor) {
  if (!actor.position) return;
  const mote = state.terrainEffects.find((effect) => effect.terrain === 'symphony-mote' && effect.positions.some((cell) => samePosition(cell, actor.position)));
  if (!mote) return;
  // Compute mutations while the mote is still in state (the helper reads it).
  const mutations = symphonyMoteDetonationMutations(state, actor, actor.position);
  // Consume the mote.
  state.terrainEffects = state.terrainEffects.filter((effect) => effect !== mote);
  if (mutations.length > 0) applyRuleMutations(state, mutations);
  // Pit creation is a side effect not representable as a pure mutation:
  // the mote owner is a foe of the triggering actor.
  const owner = mote.ownerId ? state.actors[mote.ownerId] : undefined;
  const ownerSide = owner?.side ?? actor.side;
  if (actor.side !== ownerSide) {
    state.terrainEffects.push({
      id: `symphony-pit:${actor.id}:${state.revision}`, sourceId: 'chanter:symphony',
      ownerId: actor.id, terrain: 'pit', positions: [{ ...actor.position }], height: null, duration: null,
    });
  }
}

/** ICON p.178 Symphony mote movement-entry trigger: "a character that enters
 * [a mote] detonates it." Registered as a voluntary-MOVE entry trigger so
 * the detonation fires at the command boundary and replays identically. The
 * mote terrain is consumed through the returned terrain removal mutation;
 * the turn-start lifecycle hook above handles the "starts a turn on a mote"
 * case and is a no-op when the mote was already consumed. */
registerMovementEntryTrigger({
  sourceId: 'chanter:symphony',
  matchesCell: (state, cell) => state.terrainEffects.some((effect) =>
    effect.terrain === 'symphony-mote' && effect.positions.some((position) => samePosition(position, cell)),
  ),
  mutations: (state, mover, cell) => {
    const mote = state.terrainEffects.find((effect) =>
      effect.terrain === 'symphony-mote' && effect.positions.some((position) => samePosition(position, cell)),
    );
    if (!mote) return [];
    // Compute detonation mutations while the mote is still in state.
    const detonation = symphonyMoteDetonationMutations(state, mover, cell);
    const owner = mote.ownerId ? state.actors[mote.ownerId] : undefined;
    const ownerSide = owner?.side ?? mover.side;
    const result: RuleMutation[] = [
      { kind: 'terrain', sourceId: 'chanter:symphony', sourceActorId: mover.id, operation: 'remove', terrain: 'symphony-mote', positions: [...mote.positions], height: null },
      ...detonation,
    ];
    // Pit creation for foes entering the mote (side effect baked into mutations).
    if (mover.side !== ownerSide) {
      result.push({
        kind: 'terrain', sourceId: 'chanter:symphony', sourceActorId: mover.id,
        operation: 'create', terrain: 'pit', positions: [{ ...cell }], height: null,
      });
    }
    return result;
  },
});


/** ICON p.150 Bomb summon effect: when all bombs are detonated, each explodes
 * in a small blast dealing the (pre-rolled) gamble result; characters caught
 * in overlapping blasts are affected only once. The gamble is rolled at the
 * command boundary so replay stays deterministic. */
function detonateBombs(state: EncounterState, owner: EncounterActor, gamble: number) {
  const bombs = Object.values(state.entities).filter((entity) => entity.type === 'bomb' && entity.ownerId === owner.id);
  if (bombs.length === 0) return;
  const affected = new Set<string>();
  for (const bomb of bombs) {
    const bombAnchor = entityAnchorPosition(bomb);
    if (!bombAnchor) continue;
    for (const cell of squareArea(bombAnchor, 1)) {
      for (const character of Object.values(state.actors)) {
        if (!character.defeated && character.onBattlefield && character.position && samePosition(character.position, cell)) affected.add(character.id);
      }
    }
  }
  applyRuleMutations(state, [...affected].map((actorId) => ({
    kind: 'damage' as const, sourceId: 'fool:carnevale', sourceActorId: owner.id, actorId, amount: gamble, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false,
  })));
  for (const bomb of bombs) delete state.entities[bomb.id];
}

/** Roll the Carnevale detonation gamble when the actor armed it, did not
 * attack this turn, and still owns bombs. Rolled at the command boundary so
 * the TURN_ENDED event carries a deterministic value for replay. */
export function carnevaleGambleForTurnEnd(state: EncounterState, actor: EncounterActor, dice: DiceSource): number | undefined {
  if (actor.ruleState['carnevale:armed'] !== true || actor.attackedThisTurn) return undefined;
  return Object.values(state.entities).some((entity) => entity.type === 'bomb' && entity.ownerId === actor.id) ? gambleD6(dice).roll : undefined;
}

/** Roll the Monogatari song gamble when the user has an active song with no
 * tale yet. Charge rolls two d6; the player should choose one result.
 * Rolled at the command boundary so the TURN_ENDED event carries a
 * deterministic value. Both rolls are stored in recordedDice for replay;
 * the first roll is used by default because the lifecycle architecture
 * has no player-choice seam at the boundary. This is a documented
 * unresolved semantic boundary — the source gives the player a choice
 * but the engine cannot express it yet. */
export function monogatariGambleForTurnEnd(state: EncounterState, actor: EncounterActor, dice: DiceSource): { result: number; recordedDice?: Record<string, number> } | undefined {
  const tale = actor.ruleState['monogatari:tale'];
  if (actor.ruleState['monogatari:active'] !== true || tale !== null && tale !== undefined) return undefined;
  if (actor.ruleState['monogatari:charge'] === true) {
    const roll0 = gambleD6(dice).roll;
    const roll1 = gambleD6(dice).roll;
    // UNRESOLVED: source says "choose any result" but the lifecycle
    // boundary has no player-choice seam. Both rolls are preserved
    // durably; the first is used as a faithful-but-not-source-exact
    // default. A recorded-choice primitive would resolve this.
    return { result: roll0, recordedDice: { 'monogatari:roll0': roll0, 'monogatari:roll1': roll1 } };
  }
  return { result: gambleD6(dice).roll };
}

/** The deterministic tale conditions the single-pass VM can evaluate: Travels
 * (moved 4+ from start), Green (did not attack), Cunning (used an interrupt),
 * and Boon Companions (ended adjacent to an ally). */
function monogatariTaleMet(state: EncounterState, actor: EncounterActor, tale: number): boolean {
  switch (tale) {
    case 2: {
      const start = actor.ruleState['monogatari:turn-start-pos'];
      if (typeof start !== 'string' || !actor.position) return false;
      const [sx, sy] = start.split(',').map(Number);
      return Math.max(Math.abs(actor.position.x - sx), Math.abs(actor.position.y - sy)) > 4;
    }
    case 3: return !actor.attackedThisTurn;
    // p.91 Monogatari tale 4 "Cunning": the actor used an interrupt this turn.
    // A durable U16 fact read (the global one-interrupt-during-any-turn window
    // is stored on the actor who fired it) — NOT the availability gate.
    case 4: return usageCount(actor, oneInterruptPerTurnWindowKey()) >= 1;
    case 5: return actor.position !== null && Object.values(state.actors).some((candidate) =>
      candidate.side === actor.side && candidate.id !== actor.id && !candidate.defeated && candidate.onBattlefield && candidate.position && distance(candidate.position, actor.position) <= 1);
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Command-boundary dice-window planners (content rows; the kernel folds them)
// ---------------------------------------------------------------------------

registerTurnDiceWindowPlanner((state, actor, dice) => {
  const carnevaleGamble = carnevaleGambleForTurnEnd(state, actor, dice);
  return carnevaleGamble !== undefined ? { carnevaleGamble } : {};
});

registerTurnDiceWindowPlanner((state, actor, dice) => {
  const monogatari = monogatariGambleForTurnEnd(state, actor, dice);
  if (!monogatari) return {};
  const windows: import('../../kernels/lifecycle.js').TurnDiceWindows = { monogatariGamble: monogatari.result };
  if (monogatari.recordedDice) windows.recordedDice = { ...monogatari.recordedDice };
  return windows;
});

// F6: snapshot Blackheart's status count before the boundary's end-of-turn
// saves clear the statuses (the turn-end phase replays after them).
registerTurnDiceWindowPlanner((state, actor) =>
  (actor.traitIds.includes('knave:trait:blackheart') ? { blackheartStatusCount: actor.statuses.length } : {}));

// ---------------------------------------------------------------------------
// Lifecycle recipes — registration order IS the boundary order (recorded
// contract; do not reorder).
// ---------------------------------------------------------------------------

// --- turn-end (in boundary order) ---

/** ICON p.129 Soul Blade: the stance's d4 power die refreshes at the end of
 * the user's turn when they did not attack. */
registerLifecycleRecipe({
  sourceId: 'demon-slayer:soul-blade',
  phase: 'turn-end',
  applies: (actor) => actor.stance?.stanceId === 'soul-blade' && !actor.attackedThisTurn,
  resolve: (_state, actor) => {
    if (actor.stance?.stanceId !== 'soul-blade' || actor.attackedThisTurn) return;
    tickPowerDie(actor, 'soul-blade:die', 0, 6);
  },
});

/** ICON p.141 Dark Knight: at the end of the turn the stance grants vigilance +1. */
registerLifecycleRecipe({
  sourceId: 'knave:dark-knight',
  phase: 'turn-end',
  applies: (actor) => actor.stance?.stanceId === 'dark-knight',
  resolve: (state, actor) => {
    if (actor.stance?.stanceId !== 'dark-knight') return;
    actor.resources.vigilance = (actor.resources.vigilance ?? 0) + 1;
  },
});

/** ICON p.143 Infectious Hatred (Dark Knight mastery): the mastered dark
 * knight whose stance aura covers `foe` — the aura kernel answers both
 * membership and which origin (deterministic: origins iterate in actor
 * order, and the stance-origin definition only ever emanates from mastered
 * dark knights). */
function coveringDarkKnight(state: EncounterState, foe: EncounterActor): EncounterActor | null {
  const definition = auraDefinitionFor('knave:dark-knight:mastery');
  if (!definition || foe.side !== 'foes' || !foe.position) return null;
  const view = auraStateView(state);
  for (const origin of auraOriginRefs(view, definition)) {
    if (origin.actorId === null) continue;
    if (isAuraMember(view, definition, origin, foe.id)) return state.actors[origin.actorId] ?? null;
  }
  return null;
}

// ICON p.143 Infectious Hatred: a foe that ends its turn in a mastered dark
// knight's aura must save or gain hatred of the knight. The save is pre-rolled
// at the command boundary (the established dice-window pattern, like the
// Carnevale gamble) so the TURN_ENDED intent carries the outcome for replay.
registerTurnDiceWindowPlanner((state, actor, dice) => {
  if (actor.side !== 'foes' || !actor.position) return {};
  const knight = coveringDarkKnight(state, actor);
  if (!knight) return {};
  const projected = encounterRuleState(state);
  const view = projected.actors[actor.id];
  if (!view) return {};
  const save = resolveSaveWindow(
    { state: projected, actorId: actor.id, sourceId: 'knave:dark-knight', actionId: 'turn-end', timing: 'turn-end', input: {}, dice },
    view,
    { id: `knave:dark-knight:hatred:${actor.id}`, kind: 'effect', sourceId: 'knave:dark-knight', actorId: actor.id },
  ).mutation;
  return { darkKnightHatredSave: { roll: save.roll, total: save.total, success: save.success } };
});

/** ICON p.143 Infectious Hatred (Dark Knight mastery): foes that end their
 * turn in the mastered user's aura must save or gain hatred of them. The save
 * was resolved at the command boundary; the failure branch applies the hatred
 * condition (with the hated target, so the shared damage authority's
 * hatred-of-X routing works) through the same mutation boundary. */
registerLifecycleRecipe({
  sourceId: 'knave:dark-knight:mastery',
  phase: 'turn-end',
  applies: (_actor, _state, diceWindows) => diceWindows.darkKnightHatredSave !== undefined,
  // T6.3: the save/hatred effect belongs to the covering KNIGHT (the aura
  // origin), not the ending foe the recipe runs for — the p.108 same-owner
  // read. The dice window exists only when a knight covers the foe, so the
  // owner is always derivable here.
  ownerOf: (actor, state) => coveringDarkKnight(state, actor)?.id ?? null,
  resolve: (state, actor, diceWindows) => {
    const result = diceWindows.darkKnightHatredSave;
    if (!result || actor.side !== 'foes' || !actor.position || result.success) return;
    const knight = coveringDarkKnight(state, actor);
    if (!knight) return;
    applyRuleMutations(state, [{
      kind: 'condition', sourceId: 'knave:dark-knight:mastery', sourceActorId: knight.id, actorId: actor.id, conditionId: 'hatred', operation: 'apply', potency: 'normal',
    }]);
    actor.ruleState['hatred-of'] = knight.id;
    actor.ruleStateOwners['hatred-of'] = knight.id;
  },
});

/** ICON p.156 Exorcism: at the end of any turn where the owner ends in range 3
 * of the marked foe, or that foe ends in range 3 of the owner, set out the d4
 * power die at 1 (or tick it up) and shoot a projectile for 2 unerring damage.
 * When the die reaches its maximum of 4, every projectile flies for 2 damage
 * per charge and the mark ends. */
registerLifecycleRecipe({
  sourceId: 'freelancer:exorcism',
  phase: 'turn-end',
  applies: (actor) => Boolean(actor.position),
  // T6.3: the ticks belong to the MARK OWNERS. At a marked FOE's turn-end the
  // relevant marks sit on the ending actor — a single owner yields that
  // owner; several owners' marks in one recipe resolve in the source-listed
  // order inside the ability (p.107), never a fabricated single owner (null).
  // At the OWNER's own turn-end the ticks are the owner's own marks (the
  // ending actor). No marks at all → the recipe no-ops (null → excluded).
  ownerOf: (actor, state) => {
    const onSelf = actor.marks.filter((mark) => mark.markId === 'exorcism');
    if (onSelf.length > 0) {
      const owners = new Set(onSelf.map((mark) => mark.ownerId));
      return owners.size === 1 ? [...owners][0] ?? null : null;
    }
    const ownsMarks = Object.values(state.actors).some((foe) => foe.marks.some((mark) => mark.markId === 'exorcism' && mark.ownerId === actor.id));
    return ownsMarks ? actor.id : null;
  },
  resolve: (state, actor) => {
    if (!actor.position) return;
    const tick = (mark: EncounterMark, foe: EncounterActor, owner: EncounterActor) => {
      const die = Math.min(4, Number(mark.state.die ?? 0) + 1);
      const charges = Number(mark.state.charges ?? 0) + 1;
      mark.state.die = die;
      mark.state.charges = charges;
      applyRuleMutations(state, [{
        kind: 'damage', sourceId: 'freelancer:exorcism', sourceActorId: owner.id, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
      }]);
      if (die >= 4) {
        applyRuleMutations(state, [{
          kind: 'damage', sourceId: 'freelancer:exorcism', sourceActorId: owner.id, actorId: foe.id, amount: 2 * charges, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
        }]);
        foe.marks = foe.marks.filter((candidate) => candidate !== mark);
      }
    };
    // The owner ended their turn: tick the marks they own whose foe is in range.
    for (const foe of Object.values(state.actors)) {
      const mark = foe.marks.find((candidate) => candidate.markId === 'exorcism' && candidate.ownerId === actor.id);
      if (!mark || foe.defeated || !foe.onBattlefield || !foe.position || distance(actor.position, foe.position) > 3) continue;
      tick(mark, foe, actor);
    }
    // The marked foe ended their turn: tick the marks on this actor whose owner is in range.
    for (const mark of [...actor.marks]) {
      if (mark.markId !== 'exorcism') continue;
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.defeated || !owner.onBattlefield || !owner.position || distance(owner.position, actor.position) > 3) continue;
      tick(mark, actor, owner);
    }
  },
});

/** ICON p.157 Showdown: at the end of the marked foe's next turn the user may
 * dash 2 (if the foe is within range 3) or the foe takes 2 unerring damage
 * twice (four times on a Finishing Blow) when at range 4 or higher; the mark
 * ends either way. */
registerLifecycleRecipe({
  sourceId: 'freelancer:showdown',
  phase: 'turn-end',
  applies: (actor) => actor.marks.some((mark) => mark.markId === 'showdown'),
  // T6.3: the dash/damage belongs to the MARK OWNER (the freelancer who
  // marked the ending foe) — p.108 same-owner read.
  ownerOf: (actor) => actor.marks.find((mark) => mark.markId === 'showdown')?.ownerId ?? null,
  resolve: (state, actor) => {
    const marks = actor.marks.filter((mark) => mark.markId === 'showdown');
    if (marks.length === 0) return;
    actor.marks = actor.marks.filter((mark) => mark.markId !== 'showdown');
    const blocked = (position: Position, moverId: string) => position.x < 0 || position.y < 0
      || position.x >= state.grid.width || position.y >= state.grid.height
      || Object.values(state.actors).some((candidate) => candidate.id !== moverId && candidate.onBattlefield && !candidate.defeated && samePosition(candidate.position, position))
      || state.grid.terrain.some((cell) => samePosition(cell.position, position) && cell.type === 'impassable');
    for (const mark of marks) {
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.defeated || !owner.onBattlefield || !owner.position || !actor.position) continue;
      const d = distance(owner.position, actor.position);
      if (d <= 3) {
        let position = { ...owner.position };
        for (let steps = 0; steps < 2; steps += 1) {
          const dx = actor.position.x - position.x;
          const dy = actor.position.y - position.y;
          const next = Math.abs(dx) >= Math.abs(dy)
            ? { x: position.x + Math.sign(dx), y: position.y }
            : { x: position.x, y: position.y + Math.sign(dy) };
          if (samePosition(next, position) || blocked(next, owner.id)) break;
          position = next;
        }
        applyLifecycleAbilityMove(state, owner, 'freelancer:showdown', 'rush', position);
      } else {
        applyRuleMutations(state, [{
          kind: 'damage', sourceId: 'freelancer:showdown', sourceActorId: owner.id, actorId: actor.id, amount: mark.state.finishing === true ? 8 : 4, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
        }]);
      }
    }
  },
});

/** ICON p.158 Warding Bolts: a foe that starts its turn inside the hover zone
 * and ends it outside is struck for 2 unerring damage and dazed. Mastery
 * (Phantom Bolts): the aura hover form strikes the same way — a foe that
 * started inside the mastered user's aura and ends it outside takes the same
 * strike. Both forms must still exist (the aura ends with its owner, p.94
 * owned effects), mirroring the durable terrain. */
registerLifecycleRecipe({
  sourceId: 'freelancer:warding-bolts',
  phase: 'turn-end',
  applies: (actor) => typeof actor.ruleState['warding-bolts:owner'] === 'string',
  // T6.3: the strike belongs to the ZONE/AURA owner recorded at the start of
  // the ending actor's turn — p.108 same-owner read.
  ownerOf: (actor) => (typeof actor.ruleState['warding-bolts:owner'] === 'string' ? actor.ruleState['warding-bolts:owner'] : null),
  resolve: (state, actor) => {
    const ownerId = actor.ruleState['warding-bolts:owner'];
    if (typeof ownerId !== 'string' || !ownerId) return;
    delete actor.ruleState['warding-bolts:owner'];
    delete actor.ruleStateOwners['warding-bolts:owner'];
    if (!actor.position) return;
    const effect = state.terrainEffects.find((candidate) => candidate.terrain === 'warding-bolts' && candidate.ownerId === ownerId);
    const owner = state.actors[ownerId];
    // The hover form exists while the terrain zone stands OR the mastered
    // owner still carries the phantom-bolts aura (an owned effect ends with
    // its incapacitated owner, p.94). No form → nothing to leave → no strike.
    const auraPresent = owner !== undefined && owner.activeEffects.some(({ effectId }) => effectId === 'phantom-bolts');
    if (!effect && !auraPresent) return;
    if (effect && effect.positions.some((cell) => samePosition(cell, actor.position))) return;
    if (auraPresent) {
      const definition = auraDefinitionFor('freelancer:warding-bolts:mastery');
      if (definition) {
        const view = auraStateView(state);
        for (const origin of auraOriginRefs(view, definition)) {
          if (origin.actorId === ownerId && isAuraMember(view, definition, origin, actor.id)) return; // still inside the aura
        }
      }
    }
    applyRuleMutations(state, [
      { kind: 'damage', sourceId: 'freelancer:warding-bolts', sourceActorId: ownerId, actorId: actor.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true },
      { kind: 'condition', sourceId: 'freelancer:warding-bolts', sourceActorId: ownerId, actorId: actor.id, conditionId: 'dazed', operation: 'apply', potency: 'normal' },
    ]);
  },
});

/** ICON p.163 Assassinate: at the end of the marked foe's turn, if still in
 * range 3, the user teleports adjacent, deals 2 damage three times (or just 2
 * if the foe has an adjacent ally), blinds the foe, then flies 2 away. */
registerLifecycleRecipe({
  sourceId: 'shade:assassinate',
  phase: 'turn-end',
  applies: (actor) => actor.marks.some((mark) => mark.markId === 'assassinate'),
  // T6.3: the strike belongs to the MARK OWNER (the shade) — p.108 same-owner
  // read.
  ownerOf: (actor) => actor.marks.find((mark) => mark.markId === 'assassinate')?.ownerId ?? null,
  resolve: (state, actor) => {
    const marks = actor.marks.filter((mark) => mark.markId === 'assassinate');
    if (marks.length === 0) return;
    actor.marks = actor.marks.filter((mark) => mark.markId !== 'assassinate');
    const blocked = (position: Position, moverId: string) => position.x < 0 || position.y < 0
      || position.x >= state.grid.width || position.y >= state.grid.height
      || Object.values(state.actors).some((candidate) => candidate.id !== moverId && candidate.onBattlefield && !candidate.defeated && samePosition(candidate.position, position))
      || state.grid.terrain.some((cell) => samePosition(cell.position, position) && cell.type === 'impassable');
    for (const mark of marks) {
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.defeated || !owner.onBattlefield || !owner.position || !actor.position) continue;
      if (distance(owner.position, actor.position) > 3) continue;
      const adjacent = orthogonalNeighbors(actor.position).find((cell) => !blocked(cell, owner.id));
      if (adjacent) applyLifecycleAbilityMove(state, owner, 'shade:assassinate', 'teleport', adjacent);
      if (owner.defeated) continue;
      const hasAdjacentAlly = Object.values(state.actors).some((candidate) => candidate.side === actor.side && candidate.id !== actor.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, actor.position) <= 1);
      applyRuleMutations(state, [
        { kind: 'damage', sourceId: 'shade:assassinate', sourceActorId: owner.id, actorId: actor.id, amount: hasAdjacentAlly ? 2 : 6, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true },
        { kind: 'condition', sourceId: 'shade:assassinate', sourceActorId: owner.id, actorId: actor.id, conditionId: 'blind', operation: 'apply', potency: 'normal' },
      ]);
      const away = axisDirection(actor.position, owner.position);
      let position = { ...owner.position };
      for (let step = 0; step < 2; step += 1) {
        const next = { x: position.x + away.x, y: position.y + away.y };
        if (blocked(next, owner.id)) break;
        position = next;
      }
      applyLifecycleAbilityMove(state, owner, 'shade:assassinate', 'fly', position);
    }
  },
});

/** ICON p.164 Incubus: when a foe ends its turn adjacent to the marked foe (or
 * the marked foe ends its turn adjacent to another foe), the marked foe and
 * every adjacent foe take 2 damage and are dazed, once per round. */
registerLifecycleRecipe({
  sourceId: 'shade:incubus',
  phase: 'turn-end',
  applies: (actor) => actor.side === 'foes' && Boolean(actor.position),
  // T6.3: the pulse belongs to the MARK OWNER when the ending foe itself is
  // the marked target. The rarer "an unmarked foe ends adjacent to the marked
  // foe" instance has no owner ON the ending actor — it is excluded from
  // arbitration (its effect resolves in the source-listed order inside the
  // ability, p.107) rather than fabricating an owner.
  ownerOf: (actor) => actor.marks.find((mark) => mark.markId === 'incubus')?.ownerId ?? null,
  resolve: (state, actor) => {
    if (actor.side !== 'foes' || !actor.position) return;
    for (const marked of Object.values(state.actors)) {
      const mark = marked.marks.find((candidate) => candidate.markId === 'incubus');
      if (!mark || marked.defeated || !marked.onBattlefield || !marked.position) continue;
      // Once-per-round entitlement routed through the U16 round ledger
      // (actor-local on the mark owner): availability via useLedgerAvailable,
      // consume via recordUsageKey. The U16 round-start reset reopens it.
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.defeated || !useLedgerAvailable(owner, incubusOncePerRoundKey())) continue;
      const adjacent = actor.id === marked.id
        ? Object.values(state.actors).some((candidate) => candidate.side === 'foes' && candidate.id !== marked.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, marked.position) <= 1)
        : distance(actor.position, marked.position) <= 1;
      if (!adjacent) continue;
      const targets = [marked, ...Object.values(state.actors).filter((candidate) => candidate.side === 'foes' && candidate.id !== marked.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, marked.position) <= 1)];
      for (const target of targets) {
        applyRuleMutations(state, [
          { kind: 'damage', sourceId: 'shade:incubus', sourceActorId: owner.id, actorId: target.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false },
          { kind: 'condition', sourceId: 'shade:incubus', sourceActorId: owner.id, actorId: target.id, conditionId: 'dazed', operation: 'apply', potency: 'normal' },
        ]);
      }
      recordUsageKey(owner, incubusOncePerRoundKey());
    }
  },
});

/** ICON p.163 Umbral Echo: at the end of the user's turn, if no foe is adjacent,
 * the stance refreshes and its power die ticks up by 1 (to a maximum of 4). */
registerLifecycleRecipe({
  sourceId: 'shade:umbral-echo',
  phase: 'turn-end',
  applies: (actor) => actor.stance?.stanceId === 'umbral-echo' && Boolean(actor.position),
  resolve: (state, actor) => {
    if (actor.stance?.stanceId !== 'umbral-echo' || !actor.position) return;
    const adjacentFoe = Object.values(state.actors).some((candidate) => candidate.side !== actor.side && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, actor.position) <= 1);
    if (adjacentFoe) return;
    tickPowerDie(actor, 'umbral-echo:die', 2, 4);
  },
});

/** ICON p.171 Sidhe: at the end of the marked foe's next turn the toxin
 * detonates for 6 damage (reduced to 3 if the foe ends adjacent to an ally),
 * then the mark ends. */
registerLifecycleRecipe({
  sourceId: 'warden:sidhe',
  phase: 'turn-end',
  applies: (actor) => actor.marks.some((mark) => mark.markId === 'sidhe-toxin'),
  // T6.3: the detonation belongs to the MARK OWNER (the warden) — p.108
  // same-owner read.
  ownerOf: (actor) => actor.marks.find((mark) => mark.markId === 'sidhe-toxin')?.ownerId ?? null,
  resolve: (state, actor) => {
    const marks = actor.marks.filter((mark) => mark.markId === 'sidhe-toxin');
    if (marks.length === 0) return;
    actor.marks = actor.marks.filter((mark) => mark.markId !== 'sidhe-toxin');
    for (const mark of marks) {
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.defeated || !owner.onBattlefield || !actor.position) continue;
      const adjacentAlly = Object.values(state.actors).some((candidate) =>
        candidate.side === actor.side && candidate.id !== actor.id && candidate.onBattlefield && !candidate.defeated && candidate.position && distance(candidate.position, actor.position) <= 1);
      applyRuleMutations(state, [{
        kind: 'damage', sourceId: 'warden:sidhe', sourceActorId: owner.id, actorId: actor.id, amount: adjacentAlly ? 3 : 6, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
      }]);
    }
  },
});

/** ICON p.170 Stampede: once per round, at the end of the marked foe's turn,
 * the spirit beast charges in — 2 damage, shove 1 away from the user, then it
 * coalesces into a beast summon adjacent to the foe. */
registerLifecycleRecipe({
  sourceId: 'warden:stampede',
  phase: 'turn-end',
  applies: (actor) => Boolean(actor.position),
  // T6.3: the charge belongs to the MARK OWNER; at any other boundary the
  // recipe no-ops (no stampede mark on the ending actor → null → excluded
  // from arbitration).
  ownerOf: (actor) => actor.marks.find((mark) => mark.markId === 'stampede')?.ownerId ?? null,
  resolve: (state, actor) => {
    if (!actor.position) return;
    for (const mark of [...actor.marks]) {
      if (mark.markId !== 'stampede') continue;
      // Once-per-round entitlement routed through the U16 round ledger
      // (actor-local on the mark owner): availability via useLedgerAvailable,
      // consume via recordUsageKey. The U16 round-start reset reopens it.
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.defeated || !owner.onBattlefield || !useLedgerAvailable(owner, stampedeOncePerRoundKey())) continue;
      recordUsageKey(owner, stampedeOncePerRoundKey());
      applyRuleMutations(state, [{
        kind: 'damage', sourceId: 'warden:stampede', sourceActorId: owner.id, actorId: actor.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false,
      }]);
      if (owner.position) {
        const direction = axisDirection(owner.position, actor.position);
        applyRuleMutations(state, [{
          kind: 'move', sourceId: 'warden:stampede', sourceActorId: owner.id, actorId: actor.id, movement: 'shove', distance: 1, positions: [], direction, phasing: false,
        }]);
      }
      const beastCell = freeCellNear(state, actor.position, 1, true);
      if (beastCell) {
        applyRuleMutations(state, [{
          kind: 'entity', sourceId: 'warden:stampede', operation: 'create', entityType: 'beast', ownerId: owner.id, positions: [beastCell], count: 1, state: {},
        }]);
      }
    }
  },
});

/** ICON p.170 Underway: at the end of the user's turn, a second leafy portal
 * grows in a free adjacent space. */
registerLifecycleRecipe({
  sourceId: 'warden:underway',
  phase: 'turn-end',
  applies: (actor) => Boolean(actor.position),
  // T6.3: the portal growth belongs to the ENDING actor only when they own a
  // portal; any other boundary the recipe no-ops (null → excluded).
  ownerOf: (actor, state) => (Object.values(state.entities).some((entity) => entity.type === 'underway' && entity.ownerId === actor.id) ? actor.id : null),
  resolve: (state, actor) => {
    if (!actor.position) return;
    const ownsPortal = Object.values(state.entities).some((entity) => entity.type === 'underway' && entity.ownerId === actor.id);
    if (!ownsPortal) return;
    const portalCell = freeCellNear(state, actor.position, 1, true);
    if (portalCell) {
      applyRuleMutations(state, [{
        kind: 'entity', sourceId: 'warden:underway', operation: 'create', entityType: 'underway', ownerId: actor.id, positions: [portalCell], count: 1, state: {},
      }]);
    }
  },
});

/** The source-defined lifecycle (ICON p.179 Monogatari song): the ability
 * defines a "song" whose LIFEcycle INSTANCE advances every time Monogatari is
 * used again. Content provenance, never branched on generically. */
const MONOGATARI_SONG = 'chanter:monogatari';

/** A U8 `Reference<'rule-source'>` naming the Monogatari song lifecycle
 * (opaque identity; its key includes the source id verbatim).
 * This module (already `chanter:monogatari`) is the one content owner; a
 * helper keeps the identity wording uniform across the mint + grant recipes. */
function monogatariSongSourceRef() {
  return { kind: 'live' as const, domain: 'rule-source' as const, name: { kind: 'id' as const, id: MONOGATARI_SONG } };
}

/** Deterministic, replay-stable mint of the NEXT song-instance discriminator:
 * the current durable encounter revision names the instance, so every
 * re-sing produces a fresh token and replay reproduces the identical token at
 * the identical reconcile point. The owner id is embedded so two different
 * Chanters' discriminator spaces never collide. */
function mintMonogatariSongInstance(state: EncounterState, chanterId: string): string {
  return `song:${state.revision}:${chanterId}`;
}

/** EVERY actor with a DURABLY active Monogatari tale — each is ONE independent
 * song owner (ICON p.179: each use of Monogatari establishes THAT Chanter's
 * song, which resonates until that ability is used again, and a character may
 * fulfill the condition once per THAT song). A recipient must be evaluated
 * independently against every active song, never against whichever active
 * Chanter happens to appear first in `Object.values(state.actors)` iteration
 * — the FIRST-MATCH read is semantically wrong for simultaneous Chanters.
 *
 * Deterministic enumeration (sorted by actor id), so reversing actor
 * insertion/iteration order can never change which songs a recipient is
 * evaluated against. The grants themselves are independent transactions on
 * disjoint U16 ledger keys and commute, so this ordering is a stable
 * enumeration, never a p.108 ordering arbitration.
 */
function activeMonogatariSongOwners(state: EncounterState): EncounterActor[] {
  return Object.values(state.actors)
    .filter((candidate) => candidate.ruleState['monogatari:tale'] !== null && candidate.ruleState['monogatari:tale'] !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** ICON p.179 Monogatari turn end: a hero that completed the active tale is
 * blessed once per CURRENT song (U16 entitlement keyed by the U8 song lifecycle
 * instance), and the boundary that used the song sets the new tale (pre-rolled
 * gamble) and ADVANCES the Chanter's U8 song instance (a new song reopens the
 * once-per-song entitlement via a fresh ledger key — no global clear). */
registerLifecycleRecipe({
  sourceId: 'chanter:monogatari',
  phase: 'turn-end',
  applies: (actor, _state, diceWindows) => (actor.side === 'heroes' && !actor.defeated && Boolean(actor.position)) || diceWindows.monogatariGamble !== undefined,
  // T6.3: the tale grants belong to the ending hero; the recipe NO-OPS for a
  // hero ending its turn while no tale is active and no gamble was rolled
  // (null → excluded — it must never drag a real effect into a spurious
  // same-owner tie).
  ownerOf: (actor, state, diceWindows) => (diceWindows.monogatariGamble !== undefined
    || Object.values(state.actors).some((candidate) => candidate.ruleState['monogatari:tale'] !== null && candidate.ruleState['monogatari:tale'] !== undefined))
    ? actor.id
    : null,
  resolve: (state, actor, diceWindows) => {
    // 1) GRANT branch FIRST — a hero that completes the described course is
    //    blessed ONCE PER CURRENT SONG. The recipient is evaluated
    //    INDEPENDENTLY against EVERY active song (each is a separate U8
    //    lifecycle identity owned by its own Chanter), and each fulfillment
    //    runs its OWN generic U8×U16 transaction: consuming song A's
    //    entitlement never marks song B consumed, satisfying both songs
    //    yields both rewards, and two songs whose tales happen to be
    //    identical still remain separate lifecycle/usage identities.
    if (actor.side === 'heroes' && !actor.defeated && actor.position) {
      for (const owner of activeMonogatariSongOwners(state)) {
        const chanterRef = capturedActor(owner.id);
        const sourceRef = monogatariSongSourceRef();
        const current = currentLifecycleInstanceFor(owner, chanterRef, sourceRef);
        if (current === undefined) continue;
        if (!monogatariTaleMet(state, actor, Number(owner.ruleState['monogatari:tale']))) continue;
        const identity: LifecycleIdentity = { owner: chanterRef, source: sourceRef, instance: current };
        const txn = applyLifecycleScopedUsage({
          recipient: actor,
          lifecycle: identity,
          now: lifecycleObservationForGroup(chanterRef, sourceRef, current),
          sourceId: MONOGATARI_SONG,
          mutations: [{ kind: 'resource', sourceId: MONOGATARI_SONG, actorId: actor.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }],
        });
        if (txn.available) applyRuleMutations(state, [...txn.mutations]);
      }
    }
    // 2) Song-ESTABLISHMENT branch — a new tale was gambled, so this IS a new
    //    song: set the tale and ADVANCE the Chanter's U8 lifecycle instance.
    //    The new discriminator yields a fresh U16 ledger key, so every eligible
    //    hero's once-per-song entitlement reopens WITHOUT a global clear (and
    //    only for the singer's OWN song — other Chanters' instances are
    //    untouched).
    if (diceWindows.monogatariGamble !== undefined) {
      actor.ruleState['monogatari:tale'] = diceWindows.monogatariGamble;
      actor.ruleStateOwners['monogatari:tale'] = actor.id;
      recordLifecycleInstance(actor, capturedActor(actor.id), monogatariSongSourceRef(), mintMonogatariSongInstance(state, actor.id));
    }
  },
});

/** ICON p.179 Chastise: at the end of the marked foe's next turn, the
 * retribution lands (1 divine three times) if it damaged a chosen character
 * with an ability, and the Charism combo cures or blesses allies in a small
 * blast centered on the foe (opening a pit under it with 2+ allies). */
registerLifecycleRecipe({
  sourceId: 'chanter:chastise',
  phase: 'turn-end',
  applies: (actor) => actor.side === 'foes' && Boolean(actor.position) && actor.marks.some((mark) => mark.markId === 'chastise-retribution' || mark.markId === 'chastise-charism'),
  // T6.3: the retribution belongs to the MARK OWNER (the chanter) — p.108
  // same-owner read. Several chanters' marks in one recipe resolve in the
  // source-listed order inside the ability (p.107), never a fabricated owner.
  ownerOf: (actor) => {
    const marks = actor.marks.filter((mark) => mark.markId === 'chastise-retribution' || mark.markId === 'chastise-charism');
    const owners = new Set(marks.map((mark) => mark.ownerId));
    return owners.size === 1 ? [...owners][0] ?? null : null;
  },
  resolve: (state, actor) => {
    if (actor.side !== 'foes' || !actor.position) return;
    const marks = actor.marks.filter((mark) => mark.markId === 'chastise-retribution' || mark.markId === 'chastise-charism');
    if (marks.length === 0) return;
    actor.marks = actor.marks.filter((mark) => mark.markId !== 'chastise-retribution' && mark.markId !== 'chastise-charism');
    for (const mark of marks) {
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.defeated || !owner.onBattlefield) continue;
      if (mark.markId === 'chastise-retribution') {
        if (mark.state.triggered === true) {
          for (let i = 0; i < 3; i += 1) {
            applyRuleMutations(state, [{ kind: 'damage', sourceId: 'chanter:chastise', sourceActorId: owner.id, actorId: actor.id, amount: 1, damageType: 'divine', instance: i + 1, delivery: 'effect', ignoreCover: false }]);
          }
        }
      } else {
        const allies = Object.values(state.actors).filter((candidate) =>
          candidate.side === owner.side && !candidate.defeated && candidate.onBattlefield && candidate.position && distance(candidate.position, actor.position) <= 1);
        if (mark.state.choice === 'bless') {
          for (const ally of allies) {
            applyRuleMutations(state, [{ kind: 'resource', sourceId: 'chanter:chastise', actorId: ally.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }]);
          }
        } else {
          for (const ally of allies) {
            // TODO(ICON-rules, pp.94/102): see Aria above; Chastise's delayed
            // Cure needs the same explicit lifecycle SaveWindow decision.
            applyRuleMutations(state, [{ kind: 'cure', sourceId: 'chanter:chastise', actorId: ally.id, all: false }]);
          }
        }
        if (allies.length >= 2) {
          state.terrainEffects.push({ id: `charism-pit:${actor.id}:${state.revision}`, sourceId: 'chanter:chastise', ownerId: owner.id, terrain: 'pit', positions: [{ ...actor.position }], height: null, duration: null });
        }
      }
    }
  },
});

/** ICON p.150 Carnevale: ending the turn without attacking detonates all of
 * the user's bombs with the gamble rolled at the command boundary. */
registerLifecycleRecipe({
  sourceId: 'fool:carnevale',
  phase: 'turn-end',
  applies: (_actor, _state, diceWindows) => diceWindows.carnevaleGamble !== undefined,
  resolve: (state, actor, diceWindows) => {
    if (diceWindows.carnevaleGamble === undefined) return;
    detonateBombs(state, actor, diceWindows.carnevaleGamble);
    actor.ruleState['carnevale:armed'] = false;
    actor.ruleStateOwners['carnevale:armed'] ??= null;
  },
});

// --- F6 job-trait turn-end hooks (after the ability mark hooks) ---

/** ICON p.141 Knave Blackheart: at the end of the owner's turn, suffering
 * one or more statuses grants vigilance +1; two or more also grants a
 * bonus-damage charge (the p.102 resource the next damage roll consumes —
 * capped at one so unused charges cannot accumulate across turns). */
registerLifecycleRecipe({
  sourceId: 'knave:trait:blackheart',
  phase: 'turn-end',
  // The statuses are counted at the command boundary (the plan-time gate and
  // the recorded blackheartStatusCount window), before the end-of-turn saves
  // consume them — so the resolve trusts the recorded count and only
  // re-checks the durable trait ownership.
  applies: (actor) => actor.traitIds.includes('knave:trait:blackheart') && actor.statuses.length >= 1,
  resolve: (state, actor, diceWindows) => {
    if (!actor.traitIds.includes('knave:trait:blackheart')) return;
    const statusCount = diceWindows.blackheartStatusCount ?? actor.statuses.length;
    if (statusCount < 1) return;
    actor.resources.vigilance = (actor.resources.vigilance ?? 0) + 1;
    if (statusCount >= 2) actor.resources['bonus-damage'] = Math.max(1, actor.resources['bonus-damage'] ?? 0);
  },
});

/** ICON p.182 Harvester Mark of Tsumi: at the end of the owner's turn every
 * foe marked by the owner takes 2 piercing damage, then the owner is blessed
 * (the first-listed deterministic branch of the either-or blessing choice). */
registerLifecycleRecipe({
  sourceId: 'harvester:trait:mark-of-tsumi',
  phase: 'turn-end',
  applies: (actor) => actor.traitIds.includes('harvester:trait:mark-of-tsumi'),
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('harvester:trait:mark-of-tsumi')) return;
    const mutations: RuleMutation[] = [];
    for (const foe of Object.values(state.actors)) {
      if (foe.side === actor.side || foe.defeated || !foe.onBattlefield) continue;
      if (!foe.marks.some((mark) => mark.ownerId === actor.id)) continue;
      mutations.push({ kind: 'damage', sourceId: 'harvester:trait:mark-of-tsumi', sourceActorId: actor.id, actorId: foe.id, amount: 2, damageType: 'piercing', instance: 1, delivery: 'effect', ignoreCover: false });
    }
    if (mutations.length > 0) applyRuleMutations(state, mutations);
    if (!actor.defeated) applyRuleMutations(state, [{ kind: 'resource', sourceId: 'harvester:trait:mark-of-tsumi', actorId: actor.id, resourceId: 'blessing', operation: 'gain', amount: 1, minimum: 0, maximum: null }]);
  },
});

/** ICON p.192 Colossus Furious Berserk: while bloodied, the owner gains
 * vigilance +1 at the end of their turn (the Defiance/regeneration halves are
 * combat-start; the bloodied Sturdy half is the HP-threshold projection,
 * `content/jobs/hp-threshold-recipes.ts`). The bloodied gate is the shared
 * kernel predicate — never a second distance/HP formula. */
registerLifecycleRecipe({
  sourceId: 'colossus:trait:furious-berserk',
  phase: 'turn-end',
  applies: (actor) => actor.traitIds.includes('colossus:trait:furious-berserk') && isAtHpThreshold(actor, 'bloodied'),
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('colossus:trait:furious-berserk')) return;
    actor.resources.vigilance = (actor.resources.vigilance ?? 0) + 1;
  },
});

/** ICON p.121 Bastion Shieldmaster: "You have aura 1. If you end your turn
 * with an ally in the aura, gain vigilance +1 and become sturdy until the
 * start of your turn." The membership question is the generic aura kernel's
 * (`isInAura` on the trait's aura definition) — the same authority every
 * other consumer uses — and the grants ride the shared mutation boundary. */
registerLifecycleRecipe({
  sourceId: 'bastion:trait:shieldmaster',
  phase: 'turn-end',
  applies: (actor) => actor.traitIds.includes('bastion:trait:shieldmaster'),
  // T6.3: the grants belong to the ending bastion ONLY when an ally is inside
  // the aura (the body's own precondition); a lone bastion's turn-end no-ops
  // (null → excluded from arbitration).
  ownerOf: (actor, state) => {
    if (!actor.traitIds.includes('bastion:trait:shieldmaster')) return null;
    const definition = auraDefinitionFor('bastion:trait:shieldmaster');
    if (!definition) return null;
    const view = auraStateView(state);
    const allyInside = Object.values(state.actors).some((candidate) =>
      candidate.side === actor.side && candidate.id !== actor.id && isInAura(view, definition, candidate.id));
    return allyInside ? actor.id : null;
  },
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('bastion:trait:shieldmaster')) return;
    const definition = auraDefinitionFor('bastion:trait:shieldmaster');
    if (!definition) return;
    const view = auraStateView(state);
    const allyInside = Object.values(state.actors).some((candidate) =>
      candidate.side === actor.side && candidate.id !== actor.id && isInAura(view, definition, candidate.id));
    if (!allyInside) return;
    applyRuleMutations(state, [
      { kind: 'resource', sourceId: 'bastion:trait:shieldmaster', actorId: actor.id, resourceId: 'vigilance', operation: 'gain', amount: 1, minimum: 0, maximum: null },
      { kind: 'condition', sourceId: 'bastion:trait:shieldmaster', sourceActorId: actor.id, actorId: actor.id, conditionId: 'sturdy', operation: 'apply', potency: 'normal', duration: { kind: 'turn-start', actor: { kind: 'self' }, turns: 1 } },
    ]);
  },
});

/** ICON p.141 Demon Slayer Hissatsu: taking a turn without attacking arms
 * the next attack with +1 boon, true strike, and a d10 damage die. The
 * turn-end phase still sees the ending actor's attackedThisTurn flag (the
 * per-actor reset happens after the phase), so an un-attacked turn arms. */
registerLifecycleRecipe({
  sourceId: 'demon-slayer:trait:hissatsu',
  phase: 'turn-end',
  applies: (actor) => actor.traitIds.includes('demon-slayer:trait:hissatsu') && !actor.attackedThisTurn,
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('demon-slayer:trait:hissatsu') || actor.attackedThisTurn) return;
    actor.ruleState['hissatsu:armed'] = true;
    actor.ruleStateOwners['hissatsu:armed'] = actor.id;
  },
});

/** ICON p.140 Demon Edge: the slow-turn/delay-granted bonus damage expires
 * at the end of the owner's next turn — the window the trait opened when it
 * armed. The armed round is recorded, so the end-turn of the same command
 * (a delay/slow-turn ability often ends the turn) never clears it; only a
 * turn-end after a round boundary has passed (the owner's next turn) does.
 * The one-shot true strike is consumed by the next attack instead. */
registerLifecycleRecipe({
  sourceId: 'demon-slayer:trait:demon-edge',
  phase: 'turn-end',
  applies: (actor, state) => actor.traitIds.includes('demon-slayer:trait:demon-edge')
    && actor.ruleState['demon-edge:window'] === true
    && Number(actor.ruleState['demon-edge:window-round'] ?? 0) < state.round,
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('demon-slayer:trait:demon-edge') || actor.ruleState['demon-edge:window'] !== true) return;
    if (Number(actor.ruleState['demon-edge:window-round'] ?? 0) >= state.round) return;
    actor.resources['bonus-damage'] = 0;
    delete actor.ruleState['demon-edge:window'];
    delete actor.ruleStateOwners['demon-edge:window'];
    delete actor.ruleState['demon-edge:window-round'];
    delete actor.ruleStateOwners['demon-edge:window-round'];
  },
});

// --- delayed phase ---
// The Great Giorgios delayed mark effect moved to the U12 armed-continuation
// authority (content/jobs/continuation-resolvers.ts): the reducer arms the
// deferred-rule continuation when the mark is applied, and the deferred-rule
// resolver fires at the marked foe's turn-end against then-current state.
// The lifecycle registry no longer owns any `delayed`-phase recipe.

// --- turn-start (in boundary order) ---

/** ICON p.129 Six Hells Trigram: at the start of the user's next turn the
 * pending burst-2 area activates — foes inside are weakened, and with Heroic
 * the area gains rampart and foes inside take the user's fray damage. */
registerLifecycleRecipe({
  sourceId: 'demon-slayer:six-hells-trigram',
  phase: 'turn-start',
  applies: (actor) => actor.ruleState['six-hells:stage'] === 'pending',
  resolve: (state, owner) => {
    if (owner.ruleState['six-hells:stage'] !== 'pending') return;
    const effect = state.terrainEffects.find((candidate) => candidate.terrain === 'six-hells-trigram' && candidate.ownerId === owner.id);
    if (!effect) return;
    owner.ruleState['six-hells:stage'] = 'active';
    owner.ruleStateOwners['six-hells:stage'] = owner.id;
    const inside = (position: Position) => effect.positions.some((cell) => samePosition(cell, position));
    for (const foe of Object.values(state.actors)) {
      if (foe.side === 'heroes' || !foe.position || !inside(foe.position)) continue;
      applyRuleMutations(state, [
        { kind: 'condition', sourceId: 'demon-slayer:six-hells-trigram', sourceActorId: owner.id, actorId: foe.id, conditionId: 'weakened', operation: 'apply', potency: 'normal' },
        ...(owner.ruleState['six-hells:heroic'] === true ? [{ kind: 'damage', sourceId: 'demon-slayer:six-hells-trigram', sourceActorId: owner.id, actorId: foe.id, amount: owner.fray, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false } as const] : []),
      ]);
    }
    if (owner.ruleState['six-hells:heroic'] === true) {
      state.terrainEffects.push({ id: `six-hells-rampart:${owner.id}:${state.revision}`, sourceId: 'demon-slayer:six-hells-trigram', ownerId: owner.id, terrain: 'rampart', positions: [...effect.positions], height: null, duration: null });
    }
  },
});

/** The Dark Knight turn-start hatred refresh is REMOVED (corrective underlay
 * pass 2026-08-30): ICON p.143 grants the player a choice among equidistant
 * closest foes at this timing, the engine has no player-choice seam there
 * yet, and the old inline sort invented an actor-id tie-break. The whole
 * hatred+ clause is retracted with the ability (see
 * manual-programs.ts DOCUMENTED_NON_EXECUTABLE); the stance itself can no
 * longer be entered through the command layer. The mastery's Infectious
 * Hatred aura + turn-end save (below) are separate, exact, and unchanged. */

/** ICON p.142 Intimidate: starting your turn adjacent to the marked foe deals
 * fray damage, stuns them, and ends the mark. Mastery (Iron Skull, p.143):
 * "After Intimidate's stun triggers, also become unstoppable until the end of
 * your next turn" — attached to the actual stun trigger (the shared mastery
 * gate), never approximated from position alone. */
registerLifecycleRecipe({
  sourceId: 'knave:intimidate',
  phase: 'turn-start',
  applies: (actor) => Boolean(actor.position),
  // T6.3: the strike belongs to the starting actor only when they own an
  // intimidate mark; an unmarked turn-start no-ops (null → excluded from
  // arbitration — it must never drag a real effect into a spurious tie).
  ownerOf: (actor, state) => (Object.values(state.actors).some((foe) =>
    foe.marks.some((mark) => mark.markId === 'intimidate' && mark.ownerId === actor.id)) ? actor.id : null),
  resolve: (state, actor) => {
    if (!actor.position) return;
    for (const foe of Object.values(state.actors)) {
      const mark = foe.marks.find((candidate) => candidate.markId === 'intimidate' && candidate.ownerId === actor.id);
      if (!mark) continue;
      if (foe.defeated || !foe.onBattlefield || !foe.position || distance(actor.position, foe.position) > 1) continue;
      applyRuleMutations(state, [
        { kind: 'damage', sourceId: 'knave:intimidate', sourceActorId: actor.id, actorId: foe.id, amount: actor.fray, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false },
        { kind: 'condition', sourceId: 'knave:intimidate', sourceActorId: actor.id, actorId: foe.id, conditionId: 'stunned', operation: 'apply', potency: 'normal' },
      ]);
      if (hasMastery(actor, 'knave:intimidate')) {
        applyRuleMutations(state, [{
          kind: 'condition', sourceId: 'knave:intimidate:mastery', sourceActorId: actor.id, actorId: actor.id, conditionId: 'unstoppable', operation: 'apply', potency: 'normal', duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: 2 },
        }]);
      }
      foe.marks = foe.marks.filter((candidate) => candidate !== mark);
    }
  },
});

/** ICON p.151 Gallows Humor: the stance's d6 power die ticks up by 1 when the
 * stance refreshes at the start of the user's turn. */
registerLifecycleRecipe({
  sourceId: 'freelancer:gallows-humor',
  phase: 'turn-start',
  applies: (actor) => actor.stance?.stanceId === 'gallows-humor',
  resolve: (_state, actor) => tickGallowsHumorDie(actor),
});

/** ICON p.227 Voracious Nail (Rampant Nail mastery): "Characters that start
 * their turn adjacent to the nail become vulnerable." The grant is durable
 * (it persists until cured/saved); the vulnerable+ upgrade while inside the
 * nail's aura is the aura kernel's upgrade-only projection (aura-recipes.ts),
 * which never grants the condition itself and drops the moment membership
 * ends. The gate checks a mastered nail exists on the field so the recipe
 * only participates in meaningful boundaries. */
registerLifecycleRecipe({
  sourceId: 'spellblade:rampant-nail:mastery',
  phase: 'turn-start',
  applies: (actor, state) => Boolean(actor.position) && Object.values(state.entities).some((entity) =>
    entity.type === 'lightning-spike' && entity.ownerId !== null
    && hasMastery(state.actors[entity.ownerId]!, 'spellblade:rampant-nail')),
  // T6.3: the vulnerable grant belongs to the NAIL OWNER (the mastered
  // spellblade), not the starting actor — p.108 same-owner read. No
  // mastered nail adjacent → the recipe no-ops (null → excluded).
  ownerOf: (actor, state) => {
    if (!actor.position) return null;
    for (const entity of Object.values(state.entities)) {
      if (entity.type !== 'lightning-spike') continue;
      const owner = entity.ownerId ? state.actors[entity.ownerId] : undefined;
      if (!owner || !hasMastery(owner, 'spellblade:rampant-nail')) continue;
      const spike = entityAnchorPosition(entity);
      if (spike && distance(actor.position, spike) <= 1) return owner.id;
    }
    return null;
  },
  resolve: (state, actor) => {
    if (!actor.position) return;
    for (const entity of Object.values(state.entities)) {
      if (entity.type !== 'lightning-spike') continue;
      const owner = entity.ownerId ? state.actors[entity.ownerId] : undefined;
      if (!owner || !hasMastery(owner, 'spellblade:rampant-nail')) continue;
      const spike = entityAnchorPosition(entity);
      if (!spike) continue;
      if (distance(actor.position, spike) <= 1) {
        applyRuleMutations(state, [{
          kind: 'condition', sourceId: 'spellblade:rampant-nail:mastery', sourceActorId: owner.id, actorId: actor.id, conditionId: 'vulnerable', operation: 'apply', potency: 'normal',
        }]);
      }
    }
  },
});

/** ICON p.156 Astral Chain: at the start of the user's turn a marked foe in
 * range 3 takes 2 unerring damage (twice, for 4, if at exactly range 3). */
registerLifecycleRecipe({
  sourceId: 'freelancer:astral-chain',
  phase: 'turn-start',
  applies: (actor) => Boolean(actor.position),
  // T6.3: the strike belongs to the starting actor only when they own an
  // astral-chain mark; an unmarked turn-start no-ops (null → excluded).
  ownerOf: (actor, state) => (Object.values(state.actors).some((foe) =>
    foe.marks.some((mark) => mark.markId === 'astral-chain' && mark.ownerId === actor.id)) ? actor.id : null),
  resolve: (state, actor) => {
    if (!actor.position) return;
    for (const foe of Object.values(state.actors)) {
      const mark = foe.marks.find((candidate) => candidate.markId === 'astral-chain' && candidate.ownerId === actor.id);
      if (!mark || foe.defeated || !foe.onBattlefield || !foe.position) continue;
      const d = distance(actor.position, foe.position);
      if (d > 3) continue;
      applyRuleMutations(state, [{
        kind: 'damage', sourceId: 'freelancer:astral-chain', sourceActorId: actor.id, actorId: foe.id, amount: d === 3 ? 4 : 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: true,
      }]);
    }
  },
});

/** ICON p.186 Rot talent 2: "Foes that start their turn adjacent to a
 * character marked by Rot take 2 piercing damage." A turn-start trigger on
 * the foe's own boundary (the opposite orientation of Astral Chain's
 * owner-turn strike): the starting actor is a foe, and any character marked
 * by Rot — the foe-mark or the REGENERATE ally-mark branch — adjacent to it
 * triggers once. The gate reads the mark owner's equipped talent choice, so
 * the talent's damage only fires for a harvester who actually chose it. */
registerLifecycleRecipe({
  sourceId: 'harvester:rot:talent:2',
  phase: 'turn-start',
  applies: (actor) => actor.side === 'foes' && Boolean(actor.position),
  // T6.3: the piercing belongs to the ROT MARK OWNER (the harvester), not the
  // starting foe — p.108 same-owner read. No adjacent rot-marked character →
  // the recipe no-ops (null → excluded).
  ownerOf: (actor, state) => {
    if (!actor.position) return null;
    for (const marked of Object.values(state.actors)) {
      if (marked.defeated || !marked.onBattlefield || !marked.position) continue;
      const mark = marked.marks.find((candidate) => candidate.markId === 'rot');
      if (!mark) continue;
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.talents?.['harvester:rot'] !== 2) continue;
      if (distance(actor.position, marked.position) <= 1) return mark.ownerId;
    }
    return null;
  },
  resolve: (state, actor) => {
    if (actor.side !== 'foes' || !actor.position) return;
    for (const marked of Object.values(state.actors)) {
      if (marked.defeated || !marked.onBattlefield || !marked.position) continue;
      const mark = marked.marks.find((candidate) => candidate.markId === 'rot');
      if (!mark) continue;
      const owner = state.actors[mark.ownerId];
      if (!owner || owner.talents?.['harvester:rot'] !== 2) continue;
      if (distance(actor.position, marked.position) > 1) continue;
      applyRuleMutations(state, [{
        kind: 'damage', sourceId: 'harvester:rot:talent:2', sourceActorId: owner.id, actorId: actor.id, amount: 2, damageType: 'piercing', instance: 1, delivery: 'effect', ignoreCover: false,
      }]);
      break;
    }
  },
});

/** ICON p.158 Warding Bolts: a foe that starts its turn inside the hover zone
 * records the owner so the turn-end hook can strike it if it leaves. Mastery
 * (Phantom Bolts): the aura hover form records the same way, through the
 * shared aura kernel's membership authority (never a local distance check). */
registerLifecycleRecipe({
  sourceId: 'freelancer:warding-bolts',
  phase: 'turn-start',
  applies: (actor) => Boolean(actor.position),
  // T6.3: the recorded hover-zone ownership belongs to the ZONE/AURA owner
  // when the starting actor is inside; no zone → the recipe no-ops (null →
  // excluded).
  ownerOf: (actor, state) => {
    if (!actor.position) return null;
    const effect = state.terrainEffects.find((candidate) =>
      candidate.terrain === 'warding-bolts'
      && candidate.ownerId
      && state.actors[candidate.ownerId]?.side !== actor.side
      && candidate.positions.some((cell) => samePosition(cell, actor.position)));
    if (effect) return effect.ownerId;
    const definition = auraDefinitionFor('freelancer:warding-bolts:mastery');
    if (!definition) return null;
    const view = auraStateView(state);
    for (const origin of auraOriginRefs(view, definition)) {
      if (origin.actorId === null) continue;
      if (isAuraMember(view, definition, origin, actor.id)) return origin.actorId;
    }
    return null;
  },
  resolve: (state, actor) => {
    if (!actor.position) return;
    const effect = state.terrainEffects.find((candidate) =>
      candidate.terrain === 'warding-bolts'
      && candidate.ownerId
      && state.actors[candidate.ownerId]?.side !== actor.side
      && candidate.positions.some((cell) => samePosition(cell, actor.position)));
    if (effect) {
      actor.ruleState['warding-bolts:owner'] = effect.ownerId;
      actor.ruleStateOwners['warding-bolts:owner'] = actor.id;
      return;
    }
    const definition = auraDefinitionFor('freelancer:warding-bolts:mastery');
    if (!definition) return;
    const view = auraStateView(state);
    for (const origin of auraOriginRefs(view, definition)) {
      if (origin.actorId === null) continue;
      if (isAuraMember(view, definition, origin, actor.id)) {
        actor.ruleState['warding-bolts:owner'] = origin.actorId;
        actor.ruleStateOwners['warding-bolts:owner'] = actor.id;
        break;
      }
    }
  },
});

/** ICON p.171 Morrigan: at the start of the user's (slow) next turn the flock
 * lashes out — allies in range 2 gain stealth, foes in range 2 are shoved 2
 * away and blinded. */
registerLifecycleRecipe({
  sourceId: 'warden:morrigan',
  phase: 'turn-start',
  applies: (actor) => actor.ruleState['morrigan:pending'] === true && Boolean(actor.position),
  resolve: (state, actor) => {
    if (actor.ruleState['morrigan:pending'] !== true || !actor.position) return;
    delete actor.ruleState['morrigan:pending'];
    delete actor.ruleStateOwners['morrigan:pending'];
    actor.ruleState['slow-turn'] = true;
    actor.ruleStateOwners['slow-turn'] = actor.id;
    for (const character of Object.values(state.actors)) {
      if (character.defeated || !character.onBattlefield || !character.position) continue;
      if (distance(character.position, actor.position) > 2) continue;
      if (character.side === actor.side) {
        applyRuleMutations(state, [{
          kind: 'condition', sourceId: 'warden:morrigan', sourceActorId: actor.id, actorId: character.id, conditionId: 'stealth', operation: 'apply', potency: 'normal',
        }]);
      } else {
        const direction = axisDirection(actor.position, character.position);
        applyRuleMutations(state, [
          { kind: 'move', sourceId: 'warden:morrigan', sourceActorId: actor.id, actorId: character.id, movement: 'shove', distance: 2, positions: [], direction, phasing: false },
          { kind: 'condition', sourceId: 'warden:morrigan', sourceActorId: actor.id, actorId: character.id, conditionId: 'blind', operation: 'apply', potency: 'normal' },
        ]);
      }
    }
  },
});

/** ICON p.170 Strength of the Pack: when the stance refreshes at the start of
 * the user's turn, summon a beast in a free space in the aura. */
registerLifecycleRecipe({
  sourceId: 'warden:strength-of-the-pack',
  phase: 'turn-start',
  applies: (actor) => actor.stance?.stanceId === 'strength-of-the-pack' && Boolean(actor.position),
  resolve: (state, actor) => {
    if (actor.stance?.stanceId !== 'strength-of-the-pack' || !actor.position) return;
    const beastCell = freeCellNear(state, actor.position, 2);
    if (beastCell) {
      applyRuleMutations(state, [{
        kind: 'entity', sourceId: 'warden:strength-of-the-pack', operation: 'create', entityType: 'beast', ownerId: actor.id, positions: [beastCell], count: 1, state: {},
      }]);
    }
  },
});

/** ICON p.178 Aria: at the start of the user's (slow) next turn the stunning
 * performance resolves — a blast centered on the user: foes take fray twice
 * and are sealed, sealed or pacified foes are shoved 1 away, allies are cured. */
registerLifecycleRecipe({
  sourceId: 'chanter:aria',
  phase: 'turn-start',
  applies: (actor) => actor.ruleState['aria:pending'] === true && Boolean(actor.position),
  resolve: (state, actor) => {
    if (actor.ruleState['aria:pending'] !== true || !actor.position) return;
    delete actor.ruleState['aria:pending'];
    delete actor.ruleStateOwners['aria:pending'];
    const damaged = Number(actor.ruleState['aria:damaged'] ?? 0);
    delete actor.ruleState['aria:damaged'];
    delete actor.ruleStateOwners['aria:damaged'];
    actor.ruleState['slow-turn'] = true;
    actor.ruleStateOwners['slow-turn'] = actor.id;
    const radius = damaged >= 2 ? 3 : damaged >= 1 ? 2 : 1;
    const area = squareArea(actor.position, radius);
    for (const character of Object.values(state.actors)) {
      if (character.defeated || !character.onBattlefield || !character.position) continue;
      if (!area.some((cell) => samePosition(cell, character.position))) continue;
      if (character.side === actor.side) {
        // TODO(ICON-rules, pp.94/102): Aria's source "Cure" text needs a
        // declared lifecycle SaveWindow policy before this turn-start hook can
        // roll/save deterministically. Preserve the historical vigor-only path
        // rather than inventing unrecorded dice.
        applyRuleMutations(state, [{ kind: 'cure', sourceId: 'chanter:aria', actorId: character.id, all: false }]);
      } else {
        applyRuleMutations(state, [
          { kind: 'damage', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, amount: actor.fray, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
          { kind: 'damage', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, amount: actor.fray, damageType: 'normal', instance: 2, delivery: 'area', ignoreCover: false },
          { kind: 'condition', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, conditionId: 'sealed', operation: 'apply', potency: 'normal' },
        ]);
      }
    }
    for (const character of Object.values(state.actors)) {
      if (character.side === actor.side || character.defeated || !character.onBattlefield || !character.position) continue;
      if (!area.some((cell) => samePosition(cell, character.position))) continue;
      if (!character.statuses.includes('sealed') && !character.statuses.includes('pacified')) continue;
      const direction = axisDirection(actor.position, character.position);
      applyRuleMutations(state, [{
        kind: 'move', sourceId: 'chanter:aria', sourceActorId: actor.id, actorId: character.id, movement: 'shove', distance: 1, positions: [], direction, phasing: false,
      }]);
    }
  },
});

/** ICON p.178 Symphony: a character that starts a turn on a mote detonates it. */
registerLifecycleRecipe({
  sourceId: 'chanter:symphony',
  phase: 'turn-start',
  applies: (actor) => Boolean(actor.position),
  // T6.3: the detonation belongs to the MOTE OWNER (the chanter who placed
  // the mote the starting actor stands on) — p.108 same-owner read. No mote
  // under the starting actor → the recipe no-ops (null → excluded).
  ownerOf: (actor, state) => {
    if (!actor.position) return null;
    const mote = state.terrainEffects.find((effect) =>
      effect.terrain === 'symphony-mote' && effect.positions.some((cell) => samePosition(cell, actor.position!)));
    return mote?.ownerId ?? null;
  },
  resolve: (state, actor) => detonateSymphonyMote(state, actor),
});

/** ICON p.179 Monogatari: while a tale is active, each hero character's
 * starting position is recorded so the Tale of Travels can be checked at
 * their turn end. */
registerLifecycleRecipe({
  sourceId: 'chanter:monogatari',
  phase: 'turn-start',
  applies: (actor) => actor.side === 'heroes' && Boolean(actor.position),
  // T6.3: the recorded start position belongs to the starting hero only while
  // a tale is active; no tale → the recipe no-ops (null → excluded).
  ownerOf: (actor, state) => (Object.values(state.actors).some((candidate) => candidate.ruleState['monogatari:tale'] !== null && candidate.ruleState['monogatari:tale'] !== undefined))
    ? actor.id
    : null,
  resolve: (state, actor) => {
    if (actor.side !== 'heroes' || !actor.position) return;
    const taleActive = Object.values(state.actors).some((candidate) => candidate.ruleState['monogatari:tale'] !== null && candidate.ruleState['monogatari:tale'] !== undefined);
    if (!taleActive) return;
    actor.ruleState['monogatari:turn-start-pos'] = `${actor.position.x},${actor.position.y}`;
    actor.ruleStateOwners['monogatari:turn-start-pos'] = actor.id;
  },
});

// --- F6 job-trait turn-start hooks ---

/** ICON p.127 True Horn: the turn-start half — the round's sturdy ends when
 * the owner's own turn begins (only the trait's grant, never another
 * source's sturdy). */
registerLifecycleRecipe({
  sourceId: 'demon-slayer:trait:true-horn',
  phase: 'turn-start',
  applies: (actor) => actor.traitIds.includes('demon-slayer:trait:true-horn'),
  resolve: (_state, actor) => {
    if (!actor.traitIds.includes('demon-slayer:trait:true-horn')) return;
    actor.conditions = actor.conditions.filter((candidate) => !(candidate.id === 'sturdy' && candidate.sourceId === 'demon-slayer:trait:true-horn'));
  },
});

/** ICON p.208 Enochian Phoenix Rage: from round 5, the owner gains a durable
 * Defiance condition at the start of each of their turns (so it returns each
 * round after the damage kernel consumes it). The wound-gamble half is
 * documented. */
registerLifecycleRecipe({
  sourceId: 'enochian:trait:phoenix-rage',
  phase: 'turn-start',
  applies: (actor, state) => actor.traitIds.includes('enochian:trait:phoenix-rage') && state.round >= 5,
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('enochian:trait:phoenix-rage') || state.round < 5) return;
    if (!actor.conditions.some((candidate) => candidate.id === 'defiance' && candidate.sourceId === 'enochian:trait:phoenix-rage')) {
      actor.conditions.push({ id: 'defiance', sourceId: 'enochian:trait:phoenix-rage', ownerId: actor.id, potency: 'normal', duration: null });
    }
    actor.ruleState['phoenix-rage:active'] = true;
    actor.ruleStateOwners['phoenix-rage:active'] = actor.id;
  },
});

// --- round-start (every living actor, at the round boundary and at
// ENCOUNTER_STARTED for round 1) ---

/** ICON p.127 Demon Slayer True Horn: sturdy from the start of each round
 * until the start of the owner's turn — the round-start half. Idempotent:
 * the condition is only added when the trait's durable grant is absent. */
registerLifecycleRecipe({
  sourceId: 'demon-slayer:trait:true-horn',
  phase: 'round-start',
  applies: (actor) => actor.traitIds.includes('demon-slayer:trait:true-horn'),
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('demon-slayer:trait:true-horn')) return;
    if (actor.conditions.some((candidate) => candidate.id === 'sturdy' && candidate.sourceId === 'demon-slayer:trait:true-horn')) return;
    actor.conditions.push({ id: 'sturdy', sourceId: 'demon-slayer:trait:true-horn', ownerId: actor.id, potency: 'normal', duration: null });
  },
});

/** ICON p.202 Geomancer Orogenic Rage: from round 5 the owner gains a durable
 * Unstoppable condition at the start of every round and the rage marker is
 * set. The aftershock-double-damage half needs the Aftershock mechanic and
 * stays documented with it. */
registerLifecycleRecipe({
  sourceId: 'geomancer:trait:orogenic-rage',
  phase: 'round-start',
  applies: (actor, state) => actor.traitIds.includes('geomancer:trait:orogenic-rage') && state.round >= 5,
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('geomancer:trait:orogenic-rage') || state.round < 5) return;
    if (!actor.conditions.some((candidate) => candidate.id === 'unstoppable' && candidate.sourceId === 'geomancer:trait:orogenic-rage')) {
      actor.conditions.push({ id: 'unstoppable', sourceId: 'geomancer:trait:orogenic-rage', ownerId: actor.id, potency: 'normal', duration: null });
    }
    actor.ruleState['orogenic-rage:active'] = true;
    actor.ruleStateOwners['orogenic-rage:active'] = actor.id;
  },
});

/** ICON p.209 Spellblade Storm Hilt Rage: from round 5 the rage marker is set
 * at the start of every round. The battlefield-range teleports and free
 * pre-ability teleport are documented caller choices on the rage. */
registerLifecycleRecipe({
  sourceId: 'spellblade:trait:storm-hilt-rage',
  phase: 'round-start',
  applies: (actor, state) => actor.traitIds.includes('spellblade:trait:storm-hilt-rage') && state.round >= 5,
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('spellblade:trait:storm-hilt-rage') || state.round < 5) return;
    actor.ruleState['storm-hilt-rage:active'] = true;
    actor.ruleStateOwners['storm-hilt-rage:active'] = actor.id;
  },
});

/** ICON p.196 Sealer Godly Smite: the mantra power die starts at 1 at combat
 * start (applyCombatStartTraitEffects) and ticks +1 at the start of every
 * round after round 1, to a maximum of 6. The attack-roll interrupt half is
 * documented (no attack-roll window exists among the six p.107 triggers). */
registerLifecycleRecipe({
  sourceId: 'sealer:trait:godly-smite',
  phase: 'round-start',
  applies: (actor, state) => actor.traitIds.includes('sealer:trait:godly-smite') && state.round > 1,
  resolve: (state, actor) => {
    if (!actor.traitIds.includes('sealer:trait:godly-smite') || state.round < 2) return;
    tickPowerDie(actor, 'mantra:die', 1, 6);
  },
});

/** The U8 boundary a lifecycle phase runs at. Only the boundary phases have a
 * Clock boundary; driving the reset decision from the U8 BoundaryRef keeps
 * the recipes from independently parsing `ledger:*` period prefixes. */
const boundaryForLifecyclePhase = (phase: LifecyclePhase): BoundaryRef | null => clockForTiming(phase as RuleTiming);

/** Once-per-turn gates hold a durable `ledger:turn:<sourceId>` ruleState flag
 * (the shared use-ledger kernel, `kernels/use-ledger.ts`). The actor's own
 * turn-start boundary resets them, so a once-per-turn gate is fresh at the
 * start of each of the actor's turns (ICON "once per turn"). Registered
 * per-actor; it participates only when the starting actor's turn ledger is
 * set, clearing nothing otherwise.
 *
 * U8 owns WHICH period the turn-start boundary refreshes
 * (`usagePeriodForResetBoundary` via `usageLedgerHoldsForBoundary` /
 * `refreshUsageLedgerForBoundary`); this recipe only names the boundary and
 * feeds the same authority to its applies gate and body so they never differ.
 */
registerLifecycleRecipe({
  sourceId: 'core:turn-ledger-reset',
  phase: 'turn-start',
  applies: (actor) => {
    const boundary = boundaryForLifecyclePhase('turn-start');
    return boundary !== null && usageLedgerHoldsForBoundary(actor, boundary);
  },
  // Ownerless maintenance (ownerOf null): clearing expiry keys is order-
  // independent, so it must NOT participate as a p.108 same-owner ordering
  // candidate alongside a real starting actor's turn-start effect (that would
  // fabricate a tie with e.g. Astral Chain's strike). It runs in the noop
  // bucket, after the ordered meaningful effects, on the starting actor.
  ownerOf: () => null,
  resolve: (state, actor) => {
    const boundary = boundaryForLifecyclePhase('turn-start');
    if (boundary !== null) refreshUsageLedgerForBoundary(actor, boundary);
  },
});

/** Once-per-round reactive gates (e.g. Dash on the Rocks, p.230) hold a durable
 * `ledger:round:<sourceId>` ruleState flag written when the reaction fires. A
 * round boundary resets every actor's round ledger so the gate is fresh each
 * round (ICON "1/round"). Registered per-actor like the other round-start rows;
 * it participates only when some living actor's gate is set, clearing nothing
 * otherwise. U8 owns the round-start→round-period boundary decision; this
 * recipe names the boundary only. */
registerLifecycleRecipe({
  sourceId: 'core:round-ledger-reset',
  phase: 'round-start',
  applies: (actor) => {
    const boundary = boundaryForLifecyclePhase('round-start');
    return boundary !== null && usageLedgerHoldsForBoundary(actor, boundary);
  },
  // Ownerless maintenance (ownerOf null) — see core:turn-ledger-reset above.
  ownerOf: () => null,
  resolve: (state, actor) => {
    const boundary = boundaryForLifecyclePhase('round-start');
    if (boundary !== null) refreshUsageLedgerForBoundary(actor, boundary);
  },
});
