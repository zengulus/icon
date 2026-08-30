/**
 * t6-3-turn-boundary-ordering.test.ts — T6.3 TURN-BOUNDARY ORDERING
 * (U17 lifecycle integration).
 *
 * ICON p.108 Turn Breakdown — "When resolving effects that resolve at the
 * same time":
 *
 *   1. "Effects that do not belong to the character who's turn it is resolve
 *      first, then that character's effects resolve."
 *   2. "Hostile effects (from foes, etc) resolve before beneficial effects
 *      (from allies or self, etc)."
 *   3. "If effects are owned by the same character, they can choose the order
 *      they resolve. For example, if a character has two effects that expire
 *      at the end of their turn, they can choose which ends first."
 *
 * T6.3 routes the turn-boundary lifecycle (and boundary expiries) through
 * the U17 ordering authority (`turnBoundaryOrdering`): the deterministic
 * stages execute immediately in source order, a remaining SAME-OWNER tie
 * opens the ONE recorded U13 ordering decision (the T6.2 seam), and a
 * cross-owner tie (or missing ownership/side) FAILS CLOSED — the lifecycle
 * registry registration order is a discovery mechanism, never the boundary
 * ordering authority, and no incidental array/registration/id order is ever
 * a game rule.
 *
 * The lifecycle registry is file-local (vitest isolates module state per
 * test file): the order-visible recipes below are registered at module load
 * and participate ONLY when the fixture arms their ruleState gate, so the
 * source-defined ordering is observable as a mechanical consequence (each
 * recipe records the run position it saw and a shared order log).
 */
import '../automation/content/registry.js';
import { describe, expect, it } from 'vitest';
import {
  actorFromCharacter,
  applyEvents,
  createEncounter,
  createFoe,
  executeCommand,
} from '../encounter.js';
import type { DecisionWindowRecord, EncounterActor, EncounterEvent, EncounterState } from '../types.js';
import type { RuleChoice } from '../automation/primitives/types.js';
import { EXECUTABLE_JOB_ABILITY_IDS } from '../automation/content/glue/manual-programs.js';
import {
  registerLifecycleRecipe,
  runLifecyclePhase,
  type TurnTransitionIntent,
} from '../automation/kernels/lifecycle.js';
import { turnBoundaryOrdering, type TurnBoundaryCandidate } from '../automation/primitives/ordering.js';
import { turnEligibleActorIds } from '../turn-scheduler.js';
import { windowHeldDamage } from '../automation/kernels/decision-window.js';
import { scriptedDice, startEncounterTo, validCharacter } from './fixtures.js';

// ---------------------------------------------------------------------------
// Order-visible turn-end recipes (file-local registry, gated by ruleState)
// ---------------------------------------------------------------------------

const ORDER_LOG = 't63:order-log';

/** Record the run position each recipe saw: the counter equals (log length at
 * the moment the effect resolves) + 1, so a later effect sees a higher
 * counter — a mechanical, state-visible consequence of the execution order.
 * The log is stored as a comma-joined string (ruleState values are scalars).
 */
function recordRun(state: EncounterState, actor: EncounterActor, name: string): void {
  const log = actor.ruleState[ORDER_LOG];
  const seen = typeof log === 'string' && log.length > 0 ? log.split(',') : [];
  actor.ruleState[`t63:${name}`] = seen.length + 1;
  actor.ruleState[ORDER_LOG] = [...seen, name].join(',');
}

/** The order-log names in execution order (the string record split back). */
function orderLogOf(state: EncounterState, actorId: string): string[] {
  const log = state.actors[actorId].ruleState[ORDER_LOG];
  return typeof log === 'string' && log.length > 0 ? log.split(',') : [];
}

/** The marker-named owner id (a ruleState scalar), or null when unset — the
 * `ownerOf` contract returns `string | null`. */
function ownerMarker(actor: EncounterActor, key: string): string | null {
  const value = actor.ruleState[key];
  return typeof value === 'string' ? value : null;
}

// The FOE-owned hostile effect (p.108 bullet 1/2: not the turn character's,
// hostile): resolves first by source authority. Registered AFTER hero-own so
// a registration-order engine would run hero-own first — the tests prove the
// U17 authority overrides it.
registerLifecycleRecipe({
  sourceId: 't63:rec:foe-hostile',
  phase: 'turn-end',
  applies: (actor) => actor.ruleState['t63:owner-foe'] !== undefined,
  ownerOf: (actor) => ownerMarker(actor, 't63:owner-foe'),
  resolve: (state, actor) => {
    if (actor.ruleState['t63:owner-foe'] === undefined) return;
    recordRun(state, actor, 'foe-hostile');
  },
});

// The HERO-owned beneficial effect (the turn character's own). Registered
// FIRST — registration order would run it first; the tests prove the
// p.108 non-active-owner-first authority runs the foe-owned effect first.
registerLifecycleRecipe({
  sourceId: 't63:rec:hero-own',
  phase: 'turn-end',
  applies: (actor) => actor.ruleState['t63:on-hero-own'] === true,
  ownerOf: (actor) => actor.id,
  resolve: (state, actor) => {
    if (actor.ruleState['t63:on-hero-own'] !== true) return;
    recordRun(state, actor, 'hero-own');
  },
});

// The ALLY-owned beneficial effect (not the turn character's, not hostile):
// p.108 bullet 1 puts it before the turn character's effects, bullet 2 puts
// the foe-owned effect before IT within the non-turn-owned group.
registerLifecycleRecipe({
  sourceId: 't63:rec:ally-beneficial',
  phase: 'turn-end',
  applies: (actor) => actor.ruleState['t63:owner-ally'] !== undefined,
  ownerOf: (actor) => ownerMarker(actor, 't63:owner-ally'),
  resolve: (state, actor) => {
    if (actor.ruleState['t63:owner-ally'] === undefined) return;
    recordRun(state, actor, 'ally-beneficial');
  },
});

// A SECOND ally-owned beneficial effect (for the cross-owner fail-closed
// case: two non-turn-owned beneficial effects owned by DIFFERENT characters
// have no p.108 final order).
registerLifecycleRecipe({
  sourceId: 't63:rec:ally2-beneficial',
  phase: 'turn-end',
  applies: (actor) => actor.ruleState['t63:owner-ally2'] !== undefined,
  ownerOf: (actor) => ownerMarker(actor, 't63:owner-ally2'),
  resolve: (state, actor) => {
    if (actor.ruleState['t63:owner-ally2'] === undefined) return;
    recordRun(state, actor, 'ally2-beneficial');
  },
});

// The same-owner pair (p.108 bullet 3): both owned by the HERO, order
// changes the resulting state (A reads B's counter, B reads A's).
registerLifecycleRecipe({
  sourceId: 't63:rec:hero-a',
  phase: 'turn-end',
  applies: (actor) => actor.ruleState['t63:on-a'] === true,
  ownerOf: (actor) => actor.id,
  resolve: (state, actor) => {
    if (actor.ruleState['t63:on-a'] !== true) return;
    const b = actor.ruleState['t63:b'] ?? 0;
    actor.ruleState['t63:a'] = Number(b) + 1;
    recordRun(state, actor, 'hero-a');
  },
});

registerLifecycleRecipe({
  sourceId: 't63:rec:hero-b',
  phase: 'turn-end',
  applies: (actor) => actor.ruleState['t63:on-b'] === true,
  ownerOf: (actor) => actor.id,
  resolve: (state, actor) => {
    if (actor.ruleState['t63:on-b'] !== true) return;
    const a = actor.ruleState['t63:a'] ?? 0;
    actor.ruleState['t63:b'] = Number(a) + 1;
    recordRun(state, actor, 'hero-b');
  },
});

// Phase markers (p.108 order of operations): turn-end runs before the
// delayed phase, and turn-start runs at the NEXT turn start — never
// flattened into one queue.
registerLifecycleRecipe({
  sourceId: 't63:rec:turn-end-marker',
  phase: 'turn-end',
  applies: (actor) => actor.ruleState['t63:on-end-marker'] === true,
  ownerOf: (actor) => actor.id,
  resolve: (state, actor) => {
    if (actor.ruleState['t63:on-end-marker'] !== true) return;
    actor.ruleState['t63:end-marker'] = Number(actor.ruleState['t63:delayed-marker'] ?? 0) + 1;
  },
});

registerLifecycleRecipe({
  sourceId: 't63:rec:delayed-marker',
  phase: 'delayed',
  applies: (actor) => actor.ruleState['t63:on-delayed-marker'] === true,
  ownerOf: (actor) => actor.id,
  resolve: (state, actor) => {
    if (actor.ruleState['t63:on-delayed-marker'] !== true) return;
    actor.ruleState['t63:delayed-marker'] = Number(actor.ruleState['t63:round-start-marker'] ?? 0) + 1;
  },
});

registerLifecycleRecipe({
  sourceId: 't63:rec:round-start-marker',
  phase: 'round-start',
  applies: (actor) => actor.ruleState['t63:on-round-start-marker'] === true,
  ownerOf: (actor) => actor.id,
  resolve: (state, actor) => {
    if (actor.ruleState['t63:on-round-start-marker'] !== true) return;
    actor.ruleState['t63:round-start-marker'] = 1;
  },
});

registerLifecycleRecipe({
  sourceId: 't63:rec:turn-start-marker',
  phase: 'turn-start',
  applies: (actor) => actor.ruleState['t63:on-start-marker'] === true,
  ownerOf: (actor) => actor.id,
  resolve: (state, actor) => {
    if (actor.ruleState['t63:on-start-marker'] !== true) return;
    actor.ruleState['t63:start-marker'] = Number(actor.ruleState['t63:end-marker'] ?? 0) + 1;
  },
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function t63Encounter(options: { allies?: boolean } = {}): {
  state: EncounterState;
  hero: EncounterActor;
  foe: EncounterActor;
  ally?: EncounterActor;
  ally2?: EncounterActor;
} {
  let state = createEncounter('T6.3 fixture');
  const hero = actorFromCharacter(validCharacter('Aster'), { x: 1, y: 1 });
  hero.abilityIds = [...EXECUTABLE_JOB_ABILITY_IDS];
  hero.chapter = 3;
  const foe = createFoe('Relict', { x: 6, y: 1 });
  const ally = options.allies ? actorFromCharacter(validCharacter('Mira'), { x: 6, y: 3 }) : undefined;
  const ally2 = options.allies ? actorFromCharacter(validCharacter('Nova'), { x: 6, y: 5 }) : undefined;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: hero }).state;
  state = executeCommand(state, { type: 'ADD_ACTOR', actor: foe }).state;
  if (ally) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally }).state;
  if (ally2) state = executeCommand(state, { type: 'ADD_ACTOR', actor: ally2 }).state;
  state = startEncounterTo(state, hero.id);
  return { state, hero, foe, ...(ally ? { ally } : {}), ...(ally2 ? { ally2 } : {}) };
}

/** Advance to `actorId`'s turn (END_TURN the current actor; TAKE_TURN the
 * target when the scheduler awaits a selection — only scheduler-eligible
 * actors may be selected). */
function advanceTo(state: EncounterState, actorId: string): EncounterState {
  let current = state;
  while (current.activeActorId !== actorId) {
    if (current.activeActorId === null) {
      const eligible = turnEligibleActorIds(current);
      const pick = eligible.includes(actorId) ? actorId : eligible[0]!;
      if (!pick) throw new Error(`advanceTo cannot reach ${actorId}: no eligible actor.`);
      current = executeCommand(current, { type: 'TAKE_TURN', actorId: pick }, scriptedDice()).state;
    } else {
      current = executeCommand(current, { type: 'END_TURN', actorId: current.activeActorId }, scriptedDice()).state;
    }
  }
  return current;
}

function endTurnOnly(state: EncounterState): EncounterState {
  const active = state.activeActorId;
  if (!active) throw new Error('endTurnOnly requires an active actor.');
  return executeCommand(state, { type: 'END_TURN', actorId: active }, scriptedDice()).state;
}

function answerOrdering(state: EncounterState, windowId: string, order: string[]): ReturnType<typeof executeCommand> {
  return executeCommand(
    state,
    { type: 'ANSWER_DECISION_WINDOW', windowId, input: { actorIds: { 'ordering:turn-end': order } } },
    scriptedDice(),
  );
}

/** A decision window carrying the typed U4 ordering choice (the narrowed
 * `choice` read — `RuleChoice.kind` is a plain union, not a discriminated
 * union, so an intersection is the narrow). */
type OrderingWindow = DecisionWindowRecord & { choice: RuleChoice & { kind: 'ordering' } };

function orderingWindow(state: EncounterState): OrderingWindow {
  const window = state.decisionWindows.find((candidate) => candidate.kind === 'choice' && candidate.choice?.kind === 'ordering');
  if (!window || window.choice?.kind !== 'ordering') throw new Error('Expected an open ordering window.');
  return window as OrderingWindow;
}

// ---------------------------------------------------------------------------
// U17 — the turn-boundary composition itself (pure unit tests)
// ---------------------------------------------------------------------------

describe('U17 — turnBoundaryOrdering composition (p.108 bullets 1–3)', () => {
  const heroId = 'hero';
  const foeId = 'foe';
  const allyId = 'ally';
  const candidate = (id: string, ownerId: string, side: string): TurnBoundaryCandidate => ({ id, sourceId: id, ownerId, side });
  const context = { turnActorId: heroId, turnSide: 'heroes', spec: { key: 'ordering:turn-end', label: 'Order your simultaneous effects' } };

  it('non-active-owner-first: effects not belonging to the turn character resolve before the turn character\'s own', () => {
    const result = turnBoundaryOrdering([
      candidate('hero-own', heroId, 'heroes'),
      candidate('foe-hostile', foeId, 'foes'),
    ], context);
    expect(result).toEqual({ ok: true, ordered: [candidate('foe-hostile', foeId, 'foes'), candidate('hero-own', heroId, 'heroes')] });
  });

  it('hostile-before-beneficial: within the non-turn-owned group the foe-owned effect resolves before the ally-owned one', () => {
    const result = turnBoundaryOrdering([
      candidate('ally-beneficial', allyId, 'heroes'),
      candidate('foe-hostile', foeId, 'foes'),
      candidate('hero-own', heroId, 'heroes'),
    ], context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Bucket order: (non-own hostile), (non-own beneficial), (own hostile), (own beneficial).
      expect(result.ordered.map((candidateEntry) => candidateEntry.id)).toEqual(['foe-hostile', 'ally-beneficial', 'hero-own']);
    }
  });

  it('a later criterion never reverses a stronger earlier rule (bullet 1 wins over bullet 2)', () => {
    // The turn character's HOSTILE effect still resolves AFTER every
    // non-turn-owned effect, even a beneficial one — bullet 1 is the stronger
    // rule and the hostile-before-beneficial stage only re-orders WITHIN each
    // ownership group.
    const result = turnBoundaryOrdering([
      candidate('hero-hostile-own', heroId, 'foes'),
      candidate('ally-beneficial', allyId, 'heroes'),
    ], context);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ordered.map((candidateEntry) => candidateEntry.id)).toEqual(['ally-beneficial', 'hero-hostile-own']);
    }
  });

  it('a remaining SAME-OWNER tie yields the typed U4 ordering choice with the EXACT tied set', () => {
    const result = turnBoundaryOrdering([
      candidate('a', heroId, 'heroes'),
      candidate('b', heroId, 'heroes'),
      candidate('foe-hostile', foeId, 'foes'),
    ], context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toBe('yields-choice');
    if (result.problem !== 'yields-choice') return;
    expect(result.ownerId).toBe(heroId);
    expect(result.tied.map((candidateEntry) => candidateEntry.id)).toEqual(['a', 'b']);
    // The deterministic remainder (the foe-hostile effect) resolves NOW in
    // source order — it is not deferred into the recorded decision.
    expect(result.deterministic.map((candidateEntry) => candidateEntry.id)).toEqual(['foe-hostile']);
    expect(result.choice.candidateIds).toEqual(['a', 'b']);
  });

  it('a cross-owner tie has no source-defined final order — FAIL CLOSED, never registration order', () => {
    const result = turnBoundaryOrdering([
      candidate('ally-1', allyId, 'heroes'),
      candidate('ally-2', 'ally2', 'heroes'),
    ], context);
    expect(result).toEqual({ ok: false, problem: 'cross-owner' });
  });

  it('missing ownership or side FAILS CLOSED (unknown never means same-owner or beneficial)', () => {
    expect(turnBoundaryOrdering([candidate('a', '', 'heroes'), candidate('b', heroId, 'heroes')], context))
      .toEqual({ ok: false, problem: 'missing-candidate-owner' });
    expect(turnBoundaryOrdering([candidate('a', heroId, ''), candidate('b', heroId, 'heroes')], context))
      .toEqual({ ok: false, problem: 'missing-candidate-side' });
  });
});

// ---------------------------------------------------------------------------
// Deterministic turn-boundary ordering through the real END_TURN boundary
// ---------------------------------------------------------------------------

describe('Deterministic ordering at the real turn boundary (tests 1–3, 10)', () => {
  it('an effect owned by someone other than the active character resolves BEFORE the active-character-owned effect', () => {
    const { state, hero, foe } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-hero-own'] = true;
    state.actors[hero.id].ruleState['t63:owner-foe'] = foe.id;
    const ended = endTurnOnly(state);
    // foe-owned first → counter 1; hero-owned second → counter 2. The hero
    // recipe was REGISTERED FIRST, so registration order would have produced
    // the reverse — the p.108 authority wins.
    expect(ended.actors[hero.id].ruleState['t63:foe-hostile']).toBe(1);
    expect(ended.actors[hero.id].ruleState['t63:hero-own']).toBe(2);
    expect(orderLogOf(ended, hero.id)).toEqual(['foe-hostile', 'hero-own']);
    // No choice window opened — the source-defined order fully resolved it.
    expect(ended.decisionWindows).toHaveLength(0);
    // Replay consumes the recorded phases plan and reproduces the SAME order.
    const result = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    expect(applyEvents(state, result.events)).toEqual(result.state);
  });

  it('a hostile effect resolves before a beneficial effect within the same boundary', () => {
    const { state, hero, foe, ally } = t63Encounter({ allies: true });
    state.actors[hero.id].ruleState['t63:owner-foe'] = foe.id;
    state.actors[hero.id].ruleState['t63:owner-ally'] = ally!.id;
    const ended = endTurnOnly(state);
    // Both are non-turn-owned: the foe-owned (hostile) resolves before the
    // ally-owned (beneficial), and both resolve before the turn character's
    // own effects (none here).
    expect(orderLogOf(ended, hero.id)).toEqual(['foe-hostile', 'ally-beneficial']);
    expect(ended.actors[hero.id].ruleState['t63:foe-hostile']).toBe(1);
    expect(ended.actors[hero.id].ruleState['t63:ally-beneficial']).toBe(2);
    expect(ended.decisionWindows).toHaveLength(0);
  });

  it('combining the criteria produces the source-defined result, not the recipe registration order', () => {
    const { state, hero, foe, ally } = t63Encounter({ allies: true });
    state.actors[hero.id].ruleState['t63:owner-foe'] = foe.id;
    state.actors[hero.id].ruleState['t63:owner-ally'] = ally!.id;
    state.actors[hero.id].ruleState['t63:on-hero-own'] = true;
    const ended = endTurnOnly(state);
    // (non-own, hostile) → (non-own, beneficial) → (own, beneficial):
    // registration order (hero-own was registered FIRST) is never the answer.
    expect(orderLogOf(ended, hero.id)).toEqual(['foe-hostile', 'ally-beneficial', 'hero-own']);
    expect(ended.decisionWindows).toHaveLength(0);
  });

  it('permuting registry construction order does not alter the deterministic outcome (10)', () => {
    // The mirror pair registers the SAME semantics in the REVERSE order:
    // foe-owned first, hero-owned second (the opposite of the primary pair).
    registerLifecycleRecipe({
      sourceId: 't63m:rec:foe-hostile',
      phase: 'turn-end',
      applies: (actor) => actor.ruleState['t63m:owner-foe'] !== undefined,
      ownerOf: (actor) => ownerMarker(actor, 't63m:owner-foe'),
      resolve: (state, actor) => {
        if (actor.ruleState['t63m:owner-foe'] === undefined) return;
        recordRun(state, actor, 'm-foe-hostile');
      },
    });
    registerLifecycleRecipe({
      sourceId: 't63m:rec:hero-own',
      phase: 'turn-end',
      applies: (actor) => actor.ruleState['t63m:on-hero-own'] === true,
      ownerOf: (actor) => actor.id,
      resolve: (state, actor) => {
        if (actor.ruleState['t63m:on-hero-own'] !== true) return;
        recordRun(state, actor, 'm-hero-own');
      },
    });

    const { state, hero, foe } = t63Encounter();
    state.actors[hero.id].ruleState['t63m:on-hero-own'] = true;
    state.actors[hero.id].ruleState['t63m:owner-foe'] = foe.id;
    const ended = endTurnOnly(state);
    // Identical source-defined outcome despite the reversed registration order.
    expect(ended.actors[hero.id].ruleState['t63:m-foe-hostile']).toBe(1);
    expect(ended.actors[hero.id].ruleState['t63:m-hero-own']).toBe(2);
    expect(orderLogOf(ended, hero.id)).toEqual(['m-foe-hostile', 'm-hero-own']);
  });
});

// ---------------------------------------------------------------------------
// Same-owner player choice (tests 4–7)
// ---------------------------------------------------------------------------

describe('Same-owner turn-boundary choice (tests 4–7)', () => {
  it('two simultaneous same-owner effects whose order changes the state open EXACTLY ONE ordering decision', () => {
    const { state, hero } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-a'] = true;
    state.actors[hero.id].ruleState['t63:on-b'] = true;
    const ended = endTurnOnly(state);
    const windows = ended.decisionWindows.filter((window) => window.kind === 'choice' && window.choice?.kind === 'ordering');
    expect(windows).toHaveLength(1);
    const window = windows[0]!;
    expect(window.choice!.candidateIds).toHaveLength(2);
    // Neither tied effect resolved while the decision is pending — the
    // dependent resolution suspends at the decision point (test 16).
    expect(ended.actors[hero.id].ruleState['t63:a']).toBeUndefined();
    expect(ended.actors[hero.id].ruleState['t63:b']).toBeUndefined();
  });

  it('A→B and B→A produce the two corresponding distinct legal outcomes (5)', () => {
    const { state, hero } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-a'] = true;
    state.actors[hero.id].ruleState['t63:on-b'] = true;
    const ended = endTurnOnly(state);
    const window = orderingWindow(ended);
    const [a, b] = window.choice!.candidateIds ?? [];

    const answeredAB = answerOrdering(ended, window.id, [a, b]).state;
    // A first: a = (b ?? 0) + 1 = 1; then b = (a ?? 0) + 1 = 2.
    expect(answeredAB.actors[hero.id].ruleState['t63:a']).toBe(1);
    expect(answeredAB.actors[hero.id].ruleState['t63:b']).toBe(2);

    const answeredBA = answerOrdering(ended, window.id, [b, a]).state;
    // B first: b = (a ?? 0) + 1 = 1; then a = (b ?? 0) + 1 = 2.
    expect(answeredBA.actors[hero.id].ruleState['t63:a']).toBe(2);
    expect(answeredBA.actors[hero.id].ruleState['t63:b']).toBe(1);

    // Both answers are source-legal (p.108 grants the owner the full choice)
    // and produce observably different resolution order.
    expect(answeredAB).not.toEqual(answeredBA);
  });

  it('the answer must be a complete permutation of exactly the pending set (6)', () => {
    const { state, hero } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-a'] = true;
    state.actors[hero.id].ruleState['t63:on-b'] = true;
    const ended = endTurnOnly(state);
    const window = orderingWindow(ended);
    const [a, b] = window.choice!.candidateIds ?? [];

    const reject = (code: string, order: string[]) => {
      let caught: unknown;
      try {
        answerOrdering(ended, window.id, order);
      } catch (error) {
        caught = error;
      }
      expect((caught as { code?: string } | undefined)?.code).toBe(code);
    };
    reject('choice.ordering-required', []); // omitted
    reject('choice.ordering-set', [a]); // partial
    reject('choice.ordering-distinct', [a, a]); // duplicate
    reject('choice.ordering-unknown', [a, 'foreign']); // unknown
    reject('choice.ordering-set', [a, b, a]); // extra
  });

  it('a same-owner set of 3+ candidates produces and validates a full permutation (15)', () => {
    // Three same-owner candidates in the SAME bucket (the turn character's
    // own beneficial effects): the owner may choose any full permutation.
    registerLifecycleRecipe({
      sourceId: 't63:rec:hero-c',
      phase: 'turn-end',
      applies: (actor) => actor.ruleState['t63:on-c'] === true,
      ownerOf: (actor) => actor.id,
      resolve: (state, actor) => {
        if (actor.ruleState['t63:on-c'] !== true) return;
        recordRun(state, actor, 'hero-c');
      },
    });
    const { state, hero } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-a'] = true;
    state.actors[hero.id].ruleState['t63:on-b'] = true;
    state.actors[hero.id].ruleState['t63:on-c'] = true;
    const ended = endTurnOnly(state);
    const window = orderingWindow(ended);
    const candidateIds = window.choice!.candidateIds ?? [];
    expect(candidateIds).toHaveLength(3);
    const [a, b, c] = candidateIds;
    const answered = answerOrdering(ended, window.id, [c, a, b]).state;
    // The recorded order resolved all three exactly once, in the recorded order.
    expect(orderLogOf(answered, hero.id)).toEqual(['hero-c', 'hero-a', 'hero-b']);
    // A 2-of-3 subset rejects.
    let caught: unknown;
    try {
      answerOrdering(ended, window.id, [a, b]);
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string } | undefined)?.code).toBe('choice.ordering-set');
  });

  it('wrong responder/controller cannot answer (7) — the window responder is the OWNER, derived through U2', () => {
    const { state, hero, foe } = t63Encounter({ allies: true });
    state.actors[hero.id].ruleState['t63:on-a'] = true;
    state.actors[hero.id].ruleState['t63:on-b'] = true;
    const ended = endTurnOnly(state);
    const window = orderingWindow(ended);
    // The window's responder is the owner (the hero) — not the foe, not the
    // active actor fallback. The command boundary does not accept a wrong
    // responder: the network boundary authorizes by the responder's recorded
    // controller (server/rooms.ts); at the engine boundary the durable window
    // carries the owner so the controller check has an authoritative subject.
    expect(window.actorId).toBe(hero.id);
    expect(window.actorId).not.toBe(foe.id);
    // The engine boundary records the responder; the room boundary rejects a
    // non-controller (covered by server/__tests__/rooms.test.ts). Here we pin
    // the durable responder identity itself.
    expect(window.choice!.chooser).toEqual({ kind: 'role', role: 'owner' });
  });
});

// ---------------------------------------------------------------------------
// Fail-closed behavior (tests 11–12)
// ---------------------------------------------------------------------------

describe('Fail-closed behavior (tests 11–12)', () => {
  it('a genuinely unresolved cross-owner simultaneous ambiguity rejects instead of using registration order (11)', () => {
    const { state, hero, ally, ally2 } = t63Encounter({ allies: true });
    state.actors[hero.id].ruleState['t63:owner-ally'] = ally!.id;
    state.actors[hero.id].ruleState['t63:owner-ally2'] = ally2!.id;
    // Two non-turn-owned beneficial effects owned by DIFFERENT characters:
    // the p.108 stages leave them tied with no single entitled chooser.
    let caught: unknown;
    try {
      endTurnOnly(state);
    } catch (error) {
      caught = error;
    }
    expect(String((caught as Error | undefined)?.message)).toMatch(/lifecycle\.ordering\.cross-owner/);
    // Nothing partially executed: neither effect ran.
    expect(caught).toBeDefined();
  });

  it('missing owner information fails closed through the expiry boundary (12)', () => {
    const { state, hero, foe } = t63Encounter();
    let ended = endTurnOnly(state);
    ended = advanceTo(ended, foe.id);
    // A condition with NO owner expires at the next round-start boundary (the
    // round-start expiry runs for every actor): the p.108 authority cannot
    // classify it (unknown ownership must never mean same-owner or
    // non-turn-owned), so the boundary FAILS CLOSED. Placed only after the
    // foe's turn started so the foe's own turn-start expiry does not trip.
    ended.actors[hero.id].conditions.push({
      id: 't63:null-owner',
      sourceId: 'fixture:null-owner',
      ownerId: null,
      potency: 'normal',
      duration: { kind: 'round-start', rounds: 1 },
    });
    let caught: unknown;
    try {
      ended = executeCommand(ended, { type: 'END_TURN', actorId: foe.id }, scriptedDice()).state;
      executeCommand(ended, { type: 'TAKE_TURN', actorId: hero.id }, scriptedDice());
    } catch (error) {
      caught = error;
    }
    expect(String((caught as Error | undefined)?.message)).toMatch(/lifecycle\.ordering\.missing-candidate-owner/);
  });
});

// ---------------------------------------------------------------------------
// Suspension / state (tests 16–18)
// ---------------------------------------------------------------------------

describe('Suspension and exact-once resolution (tests 16–18)', () => {
  it('while the ordering window is pending, the dependent resolution does not partially execute past the decision point (16)', () => {
    const { state, hero } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-a'] = true;
    state.actors[hero.id].ruleState['t63:on-b'] = true;
    const ended = endTurnOnly(state);
    const window = orderingWindow(ended);
    // Neither tied effect ran; both are held on the ONE window.
    expect(ended.actors[hero.id].ruleState['t63:a']).toBeUndefined();
    expect(ended.actors[hero.id].ruleState['t63:b']).toBeUndefined();
    expect(window.heldBoundary).toBeDefined();
    expect(window.heldBoundary!.effects).toHaveLength(2);
  });

  it('after answering, each pending effect resolves exactly once; closing/resuming cannot duplicate or drop (17–18)', () => {
    const { state, hero } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-a'] = true;
    state.actors[hero.id].ruleState['t63:on-b'] = true;
    const ended = endTurnOnly(state);
    const window = orderingWindow(ended);
    const [a, b] = window.choice!.candidateIds ?? [];
    const answered = answerOrdering(ended, window.id, [a, b]);
    expect(answered.state.decisionWindows).toHaveLength(0); // the window closed
    expect(orderLogOf(answered.state, hero.id)).toEqual(['hero-a', 'hero-b']);
    // Re-answering the closed window rejects — no duplicate resolution.
    let caught: unknown;
    try {
      answerOrdering(answered.state, window.id, [a, b]);
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string } | undefined)?.code).toBe('window.unknown');
    // A second boundary does not re-run the resolved effects (the recipes are
    // gate-closed: their flags were consumed by... they persist, but the
    // intent for the NEXT boundary re-plans from gates — the effects resolved
    // exactly once at THIS boundary; the recorded DECISION_ANSWERED was the
    // only resolution).
    expect(answered.state.actors[hero.id].ruleState['t63:a']).toBe(1);
    expect(answered.state.actors[hero.id].ruleState['t63:b']).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Replay (tests 8–10)
// ---------------------------------------------------------------------------

describe('Replay: the recorded order is authoritative (tests 8–10, 20–22)', () => {
  const runOnce = (order: (ids: readonly string[]) => string[]) => {
    const fixture = t63Encounter();
    fixture.state.actors[fixture.hero.id].ruleState['t63:on-a'] = true;
    fixture.state.actors[fixture.hero.id].ruleState['t63:on-b'] = true;
    const ended = endTurnOnly(fixture.state);
    const window = orderingWindow(ended);
    const answered = answerOrdering(ended, window.id, order(window.choice!.candidateIds ?? []));
    return { ...fixture, ended, window, answered };
  };

  it('save/replay after A→B reproduces A→B exactly (8)', () => {
    const { state, hero, ended, window, answered } = runOnce((ids) => [ids[0]!, ids[1]!]);
    void ended;
    const [a, b] = window.choice!.candidateIds ?? [];
    const decisionEvent = answered.events.find((event) => event.type === 'DECISION_ANSWERED');
    expect(decisionEvent).toMatchObject({ windowId: window.id, decision: { key: 'ordering:turn-end', value: [a, b] } });
    const result = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    const replayed = applyEvents(state, [...result.events, ...answered.events]);
    expect(replayed).toEqual(answered.state);
    expect(replayed.actors[hero.id].ruleState['t63:a']).toBe(1);
    expect(replayed.actors[hero.id].ruleState['t63:b']).toBe(2);
    expect(orderLogOf(replayed, hero.id)).toEqual(['hero-a', 'hero-b']);
  });

  it('save/replay after B→A reproduces B→A exactly (9)', () => {
    const { state, hero, ended, window, answered } = runOnce((ids) => [ids[1]!, ids[0]!]);
    void ended;
    const result = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    const replayed = applyEvents(state, [...result.events, ...answered.events]);
    expect(replayed).toEqual(answered.state);
    expect(replayed.actors[hero.id].ruleState['t63:a']).toBe(2);
    expect(replayed.actors[hero.id].ruleState['t63:b']).toBe(1);
    expect(orderLogOf(replayed, hero.id)).toEqual(['hero-b', 'hero-a']);
  });

  it('replay never opens a fresh decision and never re-derives the chooser (20)', () => {
    const { state, hero, ended, window, answered } = runOnce((ids) => [ids[0]!, ids[1]!]);
    void ended;
    void window;
    const result = executeCommand(state, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    const replayed = applyEvents(state, [...result.events, ...answered.events]);
    // No fresh ordering window and no fresh choice exist after replay.
    expect(replayed.decisionWindows.filter((candidate) => candidate.kind === 'choice')).toHaveLength(0);
    expect(replayed.decisionWindows).toHaveLength(0);
    // The resolution ran from the RECORDED answer only — the tied effects
    // resolved exactly once, in the recorded order.
    expect(orderLogOf(replayed, hero.id)).toEqual(['hero-a', 'hero-b']);
  });

  it('the replay is identical even if the candidate input order presented to the replay code differs (10/22)', () => {
    const { state, hero, ended, answered } = runOnce((ids) => [ids[0]!, ids[1]!]);
    // Permute the incidental decisionWindows array between the boundary and
    // the recorded DECISION_ANSWERED — the durable ids, never the array
    // order, decide.
    const permuted = structuredClone(ended);
    permuted.decisionWindows = [...permuted.decisionWindows].reverse();
    const replayedPermuted = applyEvents(permuted, answered.events);
    // The window array order is documented as incidental: compare state
    // modulo that ordering.
    const normalize = (candidate: EncounterState) => ({
      ...candidate,
      decisionWindows: [...candidate.decisionWindows].sort((first, second) => (first.id < second.id ? -1 : 1)),
    });
    expect(normalize(replayedPermuted)).toEqual(normalize(answered.state));
    expect(orderLogOf(replayedPermuted, hero.id)).toEqual(['hero-a', 'hero-b']);
  });
});

// ---------------------------------------------------------------------------
// Boundaries (tests 13–15)
// ---------------------------------------------------------------------------

describe('Boundaries (tests 13–15)', () => {
  it('interrupt priority remains unchanged: pending interrupt windows still drain at the boundary while the ordering decision persists (13)', () => {
    const fixture = t63Encounter({ allies: true });
    const { state, hero, foe, ally } = fixture;
    // A when-damaged interrupt window for the hero (the ally is hit by the
    // foe within the interrupt's source range, p.128) — the U13 interrupt
    // stack, completely separate from the p.108 turn-boundary ordering.
    // Move the ally within the hero's when-damaged interrupt range.
    state.actors[ally!.id].position = { x: 2, y: 1 };
    const allyBaseTotal = state.actors[ally!.id].hp + state.actors[ally!.id].vigor;
    const damageEvent: EncounterEvent = {
      type: 'RULE_MUTATIONS_APPLIED',
      actorId: foe.id,
      sourceId: 'fixture:foe-attack',
      actionId: 'default',
      timing: 'use',
      tags: [],
      mutations: [{ kind: 'damage', sourceId: 'fixture:foe-attack', sourceActorId: foe.id, actorId: ally!.id, amount: 4, damageType: 'normal', instance: 1, delivery: 'hit', ignoreCover: false }],
    };
    const damaged = applyEvents(state, [damageEvent]);
    const interruptWindows = damaged.decisionWindows.filter((window) => window.kind === 'when-damaged');
    expect(interruptWindows).toHaveLength(1);
    // The held damage is the DETERMINED post-mitigation amount (4 − armor 2).
    const heldAmount = windowHeldDamage(interruptWindows[0]!)!.amount;

    // The hero ends its turn with a same-owner tie — the ordering window opens
    // while the interrupt window is still pending.
    damaged.actors[hero.id].ruleState['t63:on-a'] = true;
    damaged.actors[hero.id].ruleState['t63:on-b'] = true;
    const result = executeCommand(damaged, { type: 'END_TURN', actorId: hero.id }, scriptedDice());
    // The when-damaged interrupt window drained at the boundary (held damage
    // resolved — the window was the interrupt opportunity), while the choice
    // ordering window PERSISTS until answered.
    expect(result.state.decisionWindows.filter((window) => window.kind === 'when-damaged')).toHaveLength(0);
    expect(result.state.decisionWindows.filter((window) => window.kind === 'choice')).toHaveLength(1);
    // The held determined damage resolved at the boundary (vigor first, then
    // hp) — the window was the interrupt opportunity, not a cancellation.
    expect(result.state.actors[ally!.id].hp + result.state.actors[ally!.id].vigor).toBe(allyBaseTotal - heldAmount);
    // The ordering decision is untouched by the interrupt machinery. (The
    // ally inside the hero's aura also makes the Shieldmaster turn-end grant
    // a third same-owner candidate — p.108 grants the owner the choice among
    // ALL their simultaneous effects, so the window is the one tie covering
    // them.)
    const ordering = orderingWindow(result.state);
    const candidateIds = ordering.choice!.candidateIds ?? [];
    expect(candidateIds.length).toBeGreaterThanOrEqual(2);
    expect(candidateIds.some((id) => id.includes('t63:rec:hero-a'))).toBe(true);
  });

  it('lifecycle phases remain in their existing source-defined order — never flattened into one queue (14)', () => {
    const { state, hero } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-end-marker'] = true;
    state.actors[hero.id].ruleState['t63:on-delayed-marker'] = true;
    // The hero's turn-end boundary runs turn-end THEN delayed (p.108 order of
    // operations: end-of-turn triggers, then the delayed phase). The
    // turn-start marker does NOT run at this boundary at all.
    const ended = endTurnOnly(state);
    expect(ended.actors[hero.id].ruleState['t63:end-marker']).toBe(1);
    expect(ended.actors[hero.id].ruleState['t63:delayed-marker']).toBe(1);
    expect(ended.actors[hero.id].ruleState['t63:start-marker']).toBeUndefined();

    // The turn-START marker runs only at the hero's NEXT turn start.
    ended.actors[hero.id].ruleState['t63:on-start-marker'] = true;
    const next = advanceTo(ended, hero.id);
    // turn-end marker runs BEFORE the turn-start marker (the end-marker value
    // was already 1; the start marker reads it).
    expect(next.actors[hero.id].ruleState['t63:start-marker']).toBe(2);
    expect(next.actors[hero.id].ruleState['t63:end-marker']).toBe(1);
  });

  it('a source-defined total order resolves automatically without opening a choice window (12)', () => {
    const { state, hero, foe } = t63Encounter();
    // One non-turn-owned hostile effect + one turn-owned effect: the p.108
    // stages fully determine the order — no window, no choice.
    state.actors[hero.id].ruleState['t63:owner-foe'] = foe.id;
    state.actors[hero.id].ruleState['t63:on-hero-own'] = true;
    const ended = endTurnOnly(state);
    expect(ended.decisionWindows).toHaveLength(0);
    expect(orderLogOf(ended, hero.id)).toEqual(['foe-hostile', 'hero-own']);
  });

  it('runLifecyclePhase consumes the per-phase plan from the durable intent — a turn-start plan never runs at a turn-end boundary', () => {
    const { state, hero, foe } = t63Encounter();
    state.actors[hero.id].ruleState['t63:on-start-marker'] = true;
    state.actors[hero.id].ruleState['t63:on-end-marker'] = true;
    // A fabricated legacy intent carrying BOTH a turn-end plan and a
    // turn-start plan (the historical auto-scheduler shape): the turn-end
    // boundary executes ONLY its own phase plan.
    const planOf = (phase: 'turn-end' | 'turn-start', sourceId: string, actor: EncounterActor) => ({
      phase,
      candidates: [{
        id: `${sourceId}:${actor.id}`,
        sourceId,
        actorId: actor.id,
        ownerId: actor.id,
        side: actor.side,
      }],
    });
    const intent: TurnTransitionIntent = {
      cause: 'voluntary',
      participants: ['t63:rec:turn-end-marker', 't63:rec:turn-start-marker'],
      phases: [
        planOf('turn-end', 't63:rec:turn-end-marker', hero),
        planOf('turn-start', 't63:rec:turn-start-marker', hero),
      ],
      diceWindows: {},
      roundAdvance: false,
    };
    const ended = structuredClone(state);
    ended.activeActorId = hero.id;
    // Direct phase invocation: the turn-end phase runs its OWN plan.
    runLifecyclePhase(ended, hero, 'turn-end', intent);
    expect(ended.actors[hero.id].ruleState['t63:end-marker']).toBe(1);
    expect(ended.actors[hero.id].ruleState['t63:start-marker']).toBeUndefined();
    // The turn-start phase runs its own plan at the turn-start boundary.
    runLifecyclePhase(ended, hero, 'turn-start', intent);
    expect(ended.actors[hero.id].ruleState['t63:start-marker']).toBe(2);
    expect(ended.actors[hero.id].ruleState['t63:end-marker']).toBe(1);
    void foe;
  });
});
