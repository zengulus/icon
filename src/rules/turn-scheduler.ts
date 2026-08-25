import type { EncounterActor, EncounterState } from './types.js';

/**
 * ICON 1.5 turn-order scheduler authority (p.87 — "Turn order", "Slow turns").
 *
 * The scheduler decides ONLY which SIDE/PHASE may act next and whether the
 * round has ended. It never chooses an actor: the controlling player(s)/GM
 * choose the actor through the explicit TAKE_TURN / GO_SLOW commands. This
 * module is pure — it reads EncounterState and returns decisions; it never
 * writes. All mutations (turn completion bookkeeping, phase transitions,
 * round advance) are applied by the reducer from the recorded decisions, so
 * replay reproduces them exactly.
 *
 * Source rules implemented here:
 *
 * - A player character always takes the first turn of combat; players decide
 *   which (the engine sets the player side eligible and waits).
 * - Turns alternate sides while both sides have eligible normal actors; a
 *   side with no eligible actors concedes consecutive turns to the other.
 * - When a player character would take a turn, it may elect a Slow turn and
 *   pass the regular slot to another player (GO_SLOW).
 * - Slow characters act only after all non-slow characters have acted (the
 *   Slow mini-round); slow turns alternate sides where slow actors exist on
 *   both sides, exactly like normal turns.
 * - The round ends when every actual turn (normal and slow) is resolved; the
 *   next round opens with the side opposite the side whose character took the
 *   final actual turn of the previous round.
 * - Most enemies cannot elect a Slow turn; a source-backed slow-eligibility
 *   row (registered by content) grants it to a specific foe when a rule says
 *   so. A delay effect forces the character's next turn to be slow.
 */

export type TurnPhase = 'normal' | 'slow';
export type TurnSide = 'heroes' | 'foes';

/** A turn-order decision recorded on a TURN_ENDED event at the command
 * boundary. Replay applies it verbatim — it is never re-decided. */
export interface TurnTransitionDecision {
  /** Whether completing this turn ends the round (the next actual turn opens
   * the next round). */
  roundAdvances: boolean;
  /** The round after the transition (state.round + 1 when advancing). */
  nextRound: number;
  /** The side whose controller may select the next actor. */
  eligibleSide: TurnSide;
  /** The phase after the transition: 'slow' when the normal phase is
   * exhausted and slow actors remain. */
  turnPhase: TurnPhase;
}

/** A slot-pass decision recorded on an ACTOR_WENT_SLOW event. */
export interface SlowPassDecision {
  eligibleSide: TurnSide;
  turnPhase: TurnPhase;
}

const opposite = (side: TurnSide): TurnSide => (side === 'heroes' ? 'foes' : 'heroes');

/** Delay effects (p.95: "your next turn must be a slow turn") force the
 * character into the Slow pool. The durable ruleState key is the same flag
 * the turn-start conversion consumes for the Charge trigger. */
const DELAYED_SLOW_KEY = 'six-hells:slow-turn';

/** True when a persistent source rule requires this actor's NEXT actual turn
 * to be a Slow turn — even across a round boundary. Unlike the current-round
 * commitment (`isActorSlowCommitted`), this state survives the round reset:
 * it is consumed only at the start of the forced Slow turn itself
 * (`resolveTurnStart` converts it to the Charge-visible flag).
 *
 * This predicate is deliberately SEPARATE from the voluntary election:
 * next-round scheduling must read THIS state, never the previous round's
 * GO_SLOW commitments. */
export function mustNextTurnBeSlow(actor: EncounterActor): boolean {
  return actor.ruleState[DELAYED_SLOW_KEY] === true;
}

/** True while the actor is committed to the Slow mini-round of the CURRENT
 * round: either elected via GO_SLOW this round (`slow`, cleared by the round
 * reset — an election belongs only to the round in which it was made) or
 * forced by a pending delay effect (`mustNextTurnBeSlow`). */
export function isActorSlowCommitted(actor: EncounterActor): boolean {
  return actor.slow === true || mustNextTurnBeSlow(actor);
}

// ---------------------------------------------------------------------------
// Turn entitlements (multi-turn elites/legends)
// ---------------------------------------------------------------------------

/** A source-backed turn-entitlement row: content registers the source rule
 * that grants an actor more than one turn per round (e.g. a multi-turn
 * elite/legend). Counts are summed above the default of 1. */
export interface TurnEntitlementSource {
  sourceId: string;
  /** Extra turns beyond the default 1 (clamped to 0+). */
  extraTurns(state: EncounterState, actor: EncounterActor): number;
}

const turnEntitlementSources: TurnEntitlementSource[] = [];

/** Register a turn-entitlement source (content or a test fixture). */
export function registerTurnEntitlementSource(source: TurnEntitlementSource): void {
  turnEntitlementSources.push(source);
}

/** The number of turns an actor is entitled to this round (default 1). Pure —
 * re-derived identically at round start on command and replay. */
export function turnEntitlements(state: EncounterState, actor: EncounterActor): number {
  let extra = 0;
  for (const source of turnEntitlementSources) extra += Math.max(0, Math.floor(source.extraTurns(state, actor)));
  return 1 + extra;
}

// ---------------------------------------------------------------------------
// Slow-turn eligibility
// ---------------------------------------------------------------------------

/** A source-backed slow-eligibility row: content registers the exact source
 * rule that lets a foe take a Slow turn. Player characters are eligible by
 * default; foes are eligible only when a registered rule grants it. */
export interface SlowTurnEligibilitySource {
  sourceId: string;
  eligible(state: EncounterState, actor: EncounterActor): boolean;
}

const slowTurnEligibilitySources: SlowTurnEligibilitySource[] = [];

/** Register a slow-eligibility row (content or a test fixture). */
export function registerSlowTurnEligibilitySource(source: SlowTurnEligibilitySource): void {
  slowTurnEligibilitySources.push(source);
}

/** Whether the actor may elect a Slow turn at a legal normal allied slot.
 * Player characters always may; foes may only when a registered source rule
 * grants it (most enemies cannot take a slow turn, p.87). */
export function canElectSlow(state: EncounterState, actor: EncounterActor): boolean {
  if (actor.side === 'heroes' && actor.actorKind === 'hero') return true;
  return slowTurnEligibilitySources.some((source) => source.eligible(state, actor));
}

// ---------------------------------------------------------------------------
// Eligibility predicates (pure reads of the authoritative state)
// ---------------------------------------------------------------------------

const actable = (actor: EncounterActor) => !actor.defeated && actor.onBattlefield && actor.turnsRemaining > 0;

/** ICON p.87: combat begins with a PLAYER CHARACTER, and the players decide
 * which one. The opening slot is identified by round 1 never having had a
 * turn (`lastSide` still null): only hero-kind actors are legal there.
 * Allied summons/companions on the player side wait for a later slot. */
function isCombatStartSelection(state: EncounterState): boolean {
  return state.phase === 'active' && state.round === 1 && state.lastSide === null && state.activeActorId === null && state.eligibleSide === 'heroes';
}

/** The combat-start legality filter for the opening slot: PCs only. */
function combatStartLegal(actor: EncounterActor): boolean {
  return actor.actorKind === 'hero';
}

/** Actors of `side` that may take a NORMAL turn right now: alive, on the
 * battlefield, with a turn entitlement left, and not committed to Slow. */
export function normalEligibleActors(state: EncounterState, side: TurnSide): EncounterActor[] {
  return Object.values(state.actors).filter((actor) => actor.side === side && actable(actor) && !isActorSlowCommitted(actor));
}

/** Actors of `side` that may take a SLOW turn right now: alive, on the
 * battlefield, with a turn entitlement left, and committed to Slow. */
export function slowEligibleActors(state: EncounterState, side: TurnSide): EncounterActor[] {
  return Object.values(state.actors).filter((actor) => actor.side === side && actable(actor) && isActorSlowCommitted(actor));
}

/** The actor ids the eligible side's controller may select right now via
 * TAKE_TURN (an empty list when the encounter is not awaiting a selection or
 * the side has no eligible actors). UI-friendly, deterministic. */
export function turnEligibleActorIds(state: EncounterState): string[] {
  if (state.phase !== 'active' || state.activeActorId !== null || state.eligibleSide === null) return [];
  const combatStart = isCombatStartSelection(state);
  return (state.turnPhase === 'slow' ? slowEligibleActors(state, state.eligibleSide) : normalEligibleActors(state, state.eligibleSide))
    .filter((actor) => !combatStart || combatStartLegal(actor))
    .map((actor) => actor.id);
}

/** The actor ids that may elect a Slow turn right now via GO_SLOW. */
export function slowElectableActorIds(state: EncounterState): string[] {
  if (state.phase !== 'active' || state.activeActorId !== null || state.turnPhase !== 'normal' || state.eligibleSide === null) return [];
  return Object.values(state.actors)
    .filter((actor) => actor.side === state.eligibleSide && actable(actor) && !isActorSlowCommitted(actor) && canElectSlow(state, actor))
    .map((actor) => actor.id);
}

/** The full TAKE_TURN legality gate (command + reducer share it). */
export function isActorTurnSelectable(state: EncounterState, actor: EncounterActor): boolean {
  if (state.phase !== 'active' || state.activeActorId !== null || state.eligibleSide === null) return false;
  if (actor.side !== state.eligibleSide) return false;
  // The combat-start opening slot admits a PLAYER CHARACTER only (p.87);
  // every later slot follows the ordinary side/phase rules.
  if (isCombatStartSelection(state) && !combatStartLegal(actor)) return false;
  if (!actable(actor)) return false;
  return state.turnPhase === 'slow' ? isActorSlowCommitted(actor) : !isActorSlowCommitted(actor);
}

/** The full GO_SLOW legality gate (command + reducer share it): the allied
 * side holds a NORMAL turn slot, the actor is an eligible non-Slow actor of
 * that side that has not acted yet this round, and the actor may elect a
 * slow turn at all (every player character; a foe only under a registered
 * source rule). */
export function canActorGoSlow(state: EncounterState, actor: EncounterActor): boolean {
  if (state.phase !== 'active' || state.activeActorId !== null || state.turnPhase !== 'normal' || state.eligibleSide === null) return false;
  if (actor.side !== state.eligibleSide) return false;
  if (!actable(actor) || isActorSlowCommitted(actor)) return false;
  return canElectSlow(state, actor);
}

// ---------------------------------------------------------------------------
// Transitions (pure — the reducer applies the recorded decision)
// ---------------------------------------------------------------------------

/** The eligibility sets after `endingActorId` completes one actual turn
 * (its remaining entitlement decremented), used to decide what happens next. */
function postTurnEligibility(state: EncounterState, endingActorId: string): { normal: Record<TurnSide, boolean>; slow: Record<TurnSide, boolean> } {
  const sets = { normal: { heroes: false, foes: false }, slow: { heroes: false, foes: false } } as const;
  for (const actor of Object.values(state.actors)) {
    if (actor.defeated || !actor.onBattlefield) continue;
    const remaining = actor.id === endingActorId ? Math.max(0, actor.turnsRemaining - 1) : actor.turnsRemaining;
    if (remaining <= 0) continue;
    const committed = isActorSlowCommitted(actor);
    if (committed) (sets.slow as Record<TurnSide, boolean>)[actor.side as TurnSide] = true;
    else (sets.normal as Record<TurnSide, boolean>)[actor.side as TurnSide] = true;
  }
  return sets as { normal: Record<TurnSide, boolean>; slow: Record<TurnSide, boolean> };
}

/** The ICON p.87 pass rule applied to a proposed opening slot: a side with no
 * eligible actors in the current phase yields the slot — to the other side in
 * the normal phase, or to the Slow mini-round when no normal actors remain on
 * either side. Pure; the reducer applies the returned decision. */
export function resolveEligiblePhase(state: EncounterState, eligibleSide: TurnSide, turnPhase: TurnPhase): { eligibleSide: TurnSide; turnPhase: TurnPhase } {
  if (turnPhase === 'slow') {
    if (slowEligibleActors(state, eligibleSide).length > 0) return { eligibleSide, turnPhase };
    const other = opposite(eligibleSide);
    if (slowEligibleActors(state, other).length > 0) return { eligibleSide: other, turnPhase };
    return { eligibleSide, turnPhase };
  }
  if (normalEligibleActors(state, eligibleSide).length > 0) return { eligibleSide, turnPhase };
  const other = opposite(eligibleSide);
  if (normalEligibleActors(state, other).length > 0) return { eligibleSide: other, turnPhase };
  // Neither side has normal actors left: the Slow mini-round begins when slow
  // actors remain (the side with them opens it).
  const slowSide: TurnSide = slowEligibleActors(state, eligibleSide).length > 0 ? eligibleSide
    : slowEligibleActors(state, other).length > 0 ? other
    : eligibleSide;
  return { eligibleSide: slowSide, turnPhase: 'slow' };
}

/** The opening slot of the NEXT round, computed from the pre-turn state: the
 * side opposite the side whose actor ended the round opens, in the normal
 * phase unless the pass rule moves it (a side whose whole roster is
 * slow-committed yields; a slow-only opening becomes the Slow mini-round).
 *
 * Round N+1 eligibility is classified from ROUND N+1 semantics: entitlements
 * refresh for everyone and voluntary GO_SLOW elections belong only to round
 * N, so ONLY persistent source-backed pending-Delay state
 * (`mustNextTurnBeSlow`) may place an actor in the next round's Slow pool.
 * Reading the current-round commitment here would leak a spent voluntary
 * election across the boundary and wrongly open the next round in Slow. */
function roundAdvanceTransition(state: EncounterState, endingSide: TurnSide): TurnTransitionDecision {
  const nextRound = state.round + 1;
  const normal: Record<TurnSide, boolean> = { heroes: false, foes: false };
  const slow: Record<TurnSide, boolean> = { heroes: false, foes: false };
  for (const actor of Object.values(state.actors)) {
    if (actor.defeated || !actor.onBattlefield || turnEntitlements(state, actor) <= 0) continue;
    if (mustNextTurnBeSlow(actor)) slow[actor.side as TurnSide] = true;
    else normal[actor.side as TurnSide] = true;
  }
  const opener = opposite(endingSide);
  if (normal[opener]) return { roundAdvances: true, nextRound, eligibleSide: opener, turnPhase: 'normal' };
  if (normal[opposite(opener)]) return { roundAdvances: true, nextRound, eligibleSide: opposite(opener), turnPhase: 'normal' };
  if (slow[opener]) return { roundAdvances: true, nextRound, eligibleSide: opener, turnPhase: 'slow' };
  if (slow[opposite(opener)]) return { roundAdvances: true, nextRound, eligibleSide: opposite(opener), turnPhase: 'slow' };
  return { roundAdvances: true, nextRound, eligibleSide: opener, turnPhase: 'normal' };
}

/** Compute the recorded scheduler transition for completing `endingActorId`'s
 * actual turn from the PRE-turn state (ICON p.87 alternation; the round ends
 * once every actual turn — normal then slow — is resolved). */
export function computeTurnEndTransition(state: EncounterState, endingActorId: string): TurnTransitionDecision {
  const endingSide = state.actors[endingActorId]?.side ?? 'heroes';
  const eligibility = postTurnEligibility(state, endingActorId);
  const phase = state.turnPhase ?? 'normal';

  if (phase === 'normal') {
    if (eligibility.normal.heroes || eligibility.normal.foes) {
      const eligibleSide: TurnSide = eligibility.normal[opposite(endingSide)] ? opposite(endingSide) : endingSide;
      return { roundAdvances: false, nextRound: state.round, eligibleSide, turnPhase: 'normal' };
    }
    if (eligibility.slow.heroes || eligibility.slow.foes) {
      const eligibleSide: TurnSide = eligibility.slow[opposite(endingSide)] ? opposite(endingSide) : endingSide;
      return { roundAdvances: false, nextRound: state.round, eligibleSide, turnPhase: 'slow' };
    }
    return roundAdvanceTransition(state, endingSide);
  }
  // Slow mini-round: alternate while both sides have slow actors.
  if (eligibility.slow.heroes || eligibility.slow.foes) {
    const eligibleSide: TurnSide = eligibility.slow[opposite(endingSide)] ? opposite(endingSide) : endingSide;
    return { roundAdvances: false, nextRound: state.round, eligibleSide, turnPhase: 'slow' };
  }
  return roundAdvanceTransition(state, endingSide);
}

/** Compute the recorded scheduler transition for a GO_SLOW decision: the
 * actor commits to Slow and the allied normal slot is either preserved (CASE
 * A — another allied normal actor remains) or passed (CASE B — the allied
 * side has no normal actors left, so hostile normal turns continue, or the
 * Slow mini-round begins when no normal actors remain). */
export function computeSlowPassTransition(state: EncounterState, slowActorId: string): SlowPassDecision {
  const side = state.actors[slowActorId]?.side ?? 'heroes';
  // Simulate the actor joining the Slow pool (excluded from the normal set).
  const eligibility = { normal: { heroes: false, foes: false }, slow: { heroes: false, foes: false } } as { normal: Record<TurnSide, boolean>; slow: Record<TurnSide, boolean> };
  for (const actor of Object.values(state.actors)) {
    if (actor.defeated || !actor.onBattlefield || actor.turnsRemaining <= 0) continue;
    const committed = actor.id === slowActorId || isActorSlowCommitted(actor);
    if (committed) eligibility.slow[actor.side as TurnSide] = true;
    else eligibility.normal[actor.side as TurnSide] = true;
  }
  // CASE A: another legal non-Slow allied actor keeps the current slot.
  if (eligibility.normal[side]) return { eligibleSide: side, turnPhase: 'normal' };
  // CASE B: the allied normal slot is passed. Hostile normal actors continue
  // when any remain; otherwise the Slow mini-round begins.
  if (eligibility.normal.heroes || eligibility.normal.foes) {
    const eligibleSide: TurnSide = eligibility.normal[opposite(side)] ? opposite(side) : side;
    return { eligibleSide, turnPhase: 'normal' };
  }
  const eligibleSide: TurnSide = eligibility.slow[opposite(side)] ? opposite(side) : side;
  return { eligibleSide, turnPhase: 'slow' };
}
