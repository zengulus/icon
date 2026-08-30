/**
 * decision-window.ts — U13 WINDOW / DECISION POINT: the single durable
 * authority for a window that holds execution while a player/GM decision or
 * interrupt opportunity is open.
 *
 * T5b's U12 distinction is preserved and consumed, never blurred:
 *
 *   1. DEFERRED RULE — armed now, executes later against THEN-CURRENT state
 *      (a `heldPayload` continuation with `deferred-rule` payload, or a
 *      `resume` flow suspension the U11 flow layer gates).
 *   2. HELD RESULT — already determined, suspended while the window is open,
 *      and NEVER recomputed merely because execution resumes (a
 *      `heldPayload` continuation with `held-result` payload: determined
 *      damage, a determined save).
 *
 * There is ONE typed window record (`DecisionWindowRecord`) — the old
 * `EncounterPendingInterrupt` schema, the `DamageWindowLedger`-side open
 * helpers, and the per-window `heldDamage`/`heldSave`/`heldResult` fields are
 * gone. Every window — damage interrupt (when-damaged / defeated), save
 * reroll (save-rolled), deferred ability (uses-ability / area-inclusion /
 * targeted-by-ability), and genuine player decision (choice) — is this one
 * record. No second quasi-window schema.
 *
 * NON-RESPONSIBILITIES (documented boundaries):
 *   - NOT the scheduler (U8 clocks tell it WHEN a trigger occurs).
 *   - NOT U12 (the held/deferred payloads are U12 continuations carried by
 *     the window; the window decides who may answer, not what resumes).
 *   - NOT RNG (rolls happen once at the command/window boundary and ride
 *     recorded events).
 *   - NOT U4 (a `choice` window carries the U4 `RuleChoice` spec; answering
 *     records the decision — this module never invents a default).
 *   - NOT the eligibility query language (U3 owns queries; the damage-window
 *     registry below is the closed eligibility authority for the two damage
 *     triggers, evaluated from durable provenance — the same rows the
 *     ledger replay path consumes).
 *   - NOT the flow language (a `resume` suspension carries the U11
 *     remaining nodes; the flow planner re-executes them — this module only
 *     stores and gates them).
 *
 * ORDERING (U17): nesting is the p.107 stack rule (most recent trigger
 * first) — implemented as triggeredAt-desc grouping. Same-time windows of
 * the SAME trigger resolve "in the same order as turns (player
 * character/npc, alternating)" — the turn character's side first, then the
 * other side (the alternation's first step). When the source grants an
 * ORDERING CHOICE (p.107: "If a character owns multiple effects, and there's
 * ambiguity in the order in which they trigger, they can determine the
 * order"), the engine FAILS CLOSED instead of silently substituting
 * registration order: a same-instant same-owner ambiguity in the interrupt
 * pop path, or a tie the projection cannot resolve from a source authority,
 * REJECTS as unrepresentable until a recorded player ordering decision
 * (U17 `controller-choice`) exists. Different trigger kinds at the same
 * instant have NO source-defined total order — the engine never invents a
 * lexicographic kind ordering. The recorded `order` field is durable
 * registration metadata only — never a game rule. Incidental array
 * insertion order, object-key order, and actor-id sorting are never game
 * rules.
 *
 * WINDOW IDENTITY: durable window ids are minted from the per-encounter
 * monotonic `windowSerial` (never the collection length — closing a window
 * permits length reuse, which would let a later window reuse a closed
 * window's durable id within the same revision).
 *
 * No source IDs, no per-source branches: content opens windows through
 * `openDecisionWindow` with its own kind/choice; the engine never branches
 * on a source id here.
 */
import type { ArmedContinuation, HeldResult } from '../primitives/continuation.js';
import { heldDamageContinuation, heldSaveContinuation } from '../primitives/continuation.js';
import type { Binder } from '../primitives/reference.js';
import { sameOwnerOrderingDecision, type OrderingCandidate, type OrderingPolicy } from '../primitives/ordering.js';
import { deriveRoles, resolveRoleSelector, type RoleFrame } from '../primitives/roles.js';
import type { SaveWindowKind } from '../primitives/save-window.js';
import type { RuleChoice, RuleEffect, RuleMutation } from '../primitives/types.js';
import type { FlowNode } from './execute-flow.js';
import type { DamageLedgerEntry } from './damage-ledger.js';
import type { EncounterActor, EncounterHeldDamage, EncounterState } from '../../types.js';
import { hasAvailableDefeatedInterrupt, prospectiveAppliedDefeat, whenDamagedInterruptOwner } from './encounter-adapter.js';

/** The closed set of window natures. `choice` is a genuine player/GM
 * decision window (U4 choice); every other kind is an interrupt window that
 * drains at turn boundaries when unanswered. */
export type DecisionWindowKind =
  | 'when-damaged'
  | 'defeated'
  | 'save-rolled'
  | 'uses-ability'
  | 'area-inclusion'
  | 'targeted-by-ability'
  | 'choice';

/** The U10 fact-kind provenance that opened the window. The recorded fact
 * KIND is the trigger provenance; the specific fact `instanceId` is recorded
 * when the opening site knows it (the U12 correlation seam — an unrelated
 * same-kind fact can never satisfy the wrong window). */
export interface WindowOpenedBy {
  factKind: string;
  instanceId?: string;
}

/** Source provenance for the triggering instance (opaque — never branched
 * on by this module; content/consumers may read it for audit). */
export interface WindowProvenance {
  sourceId?: string;
  sourceActorId?: string;
}

/** The recorded outcome of a window that resolved. Durable — replay consumes
 * the recorded outcome, never a re-decision. */
export type WindowResponse =
  | { kind: 'interrupted'; sourceId: string }
  | { kind: 'rerolled'; sourceId: string }
  | { kind: 'declined' }
  | { kind: 'accepted'; sourceId: string; decision?: WindowDecisionValue };

/** A recorded U4 decision value for a `choice` window. An ordering decision
 * (T6.2) records the ORDERED candidate ids — the durable order the U17 pop /
 * projection consume on replay (never re-derived, never re-sorted). */
export type WindowDecisionValue = string | number | boolean | readonly string[];

/** The one U13 window record. Durable, JSON-clean, deterministic. */
export interface DecisionWindowRecord {
  /** Stable deterministic identity. */
  id: string;
  /** The typed window nature. */
  kind: DecisionWindowKind;
  /** The responder/owner whose decision or interrupt entitlement this is. */
  actorId: string;
  /** Encounter revision when the window opened — higher resolves first
   * (the p.107 stack rule). */
  triggeredAt: number;
  /** Registration order within the same trigger event (the recorded
   * deterministic same-side tiebreak, stand-in for the owner's choice). */
  order: number;
  /** The U10 fact-kind provenance that opened the window. */
  openedBy?: WindowOpenedBy;
  /** Source provenance for the triggering instance. */
  provenance?: WindowProvenance;
  /** U12 held payload: the already-determined HELD RESULT (damage/save) or
   * the DEFERRED rule gated by this window. Never recomputed. */
  heldPayload?: ArmedContinuation;
  /** Held ability effects (costs already paid) that resolve after the
   * window answers or at the boundary drain. */
  heldEffects?: RuleMutation[];
  /** Masquerade (p.151) redirect: the held ability targets `toActorId`
   * instead when the window closes through `retargetProgramId`. */
  retarget?: { fromActorId: string; toActorId: string };
  /** The interrupt program that armed `retarget`. */
  retargetProgramId?: string;
  /** The U4 choice spec a `choice` window offers. */
  choice?: RuleChoice;
  /** U17 ordering identity/policy. */
  ordering?: OrderingPolicy;
  /** T6.2 U17 recorded-ordering rank: the durable position of THIS window
   * among the owner's same-instant windows, stamped ONLY by a recorded
   * ordering decision (the U13 ordering window's DECISION_ANSWERED). Absent
   * = unresolved — the LIFO pop and the boundary projection FAIL CLOSED on
   * a same-instant tie without a recorded order, never an invented
   * tie-break and never the incidental registration `order`. */
  resolvedOrder?: number;
  /** U11 flow suspension: the remaining flow nodes + bound names resume
   * when the window is answered (the FLOW → U13 → U12 → answer → resume
   * composition). */
  resume?: { remaining: FlowNode[]; binder: Binder; continuationPoint: string };
  /** The recorded outcome once resolved; null while open. */
  response?: WindowResponse | null;
}

/** Whether a window kind is an interrupt window that drains at turn
 * boundaries when unanswered (`choice` windows persist until answered or
 * drained at a later boundary — they are decisions, not interrupts). */
export function isInterruptWindowKind(kind: DecisionWindowKind): boolean {
  return kind !== 'choice';
}

/** Mint the durable id for a window opened from the per-encounter monotonic
 * `windowSerial` — NEVER from the collection length (closing a window
 * permits length reuse, so a length-derived id could be REUSED by a later
 * window in the same revision). Deterministic: the serial advances in the
 * reducer, so replay mints the identical ids from the identical events. */
export function nextWindowId(state: EncounterState, kind: DecisionWindowKind, actorId: string): string {
  const serial = state.windowSerial;
  state.windowSerial += 1;
  return `${kind}:${actorId}:${serial}`;
}

/** Push one typed window record onto the durable collection with the
 * deterministic identity/order fields. The caller supplies the stable `id`
 * (content provenance — `nextWindowId` for windows without a natural durable
 * identity); `triggeredAt`/`order` are derived deterministically from the
 * current state — never from ambient call-site order. */
export function openDecisionWindow(
  state: EncounterState,
  input: {
    id: string;
    kind: DecisionWindowKind;
    actorId: string;
    openedBy?: WindowOpenedBy;
    provenance?: WindowProvenance;
    heldPayload?: ArmedContinuation;
    heldEffects?: RuleMutation[];
    retarget?: { fromActorId: string; toActorId: string };
    retargetProgramId?: string;
    choice?: RuleChoice;
    ordering?: OrderingPolicy;
    resume?: DecisionWindowRecord['resume'];
  },
): DecisionWindowRecord {
  const record: DecisionWindowRecord = {
    id: input.id,
    kind: input.kind,
    actorId: input.actorId,
    triggeredAt: state.revision,
    order: state.decisionWindows.length,
    ...(input.openedBy !== undefined ? { openedBy: input.openedBy } : {}),
    ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
    ...(input.heldPayload !== undefined ? { heldPayload: input.heldPayload } : {}),
    ...(input.heldEffects !== undefined ? { heldEffects: input.heldEffects } : {}),
    ...(input.retarget !== undefined ? { retarget: input.retarget } : {}),
    ...(input.retargetProgramId !== undefined ? { retargetProgramId: input.retargetProgramId } : {}),
    ...(input.choice !== undefined ? { choice: input.choice } : {}),
    ...(input.ordering !== undefined ? { ordering: input.ordering } : {}),
    ...(input.resume !== undefined ? { resume: input.resume } : {}),
  };
  state.decisionWindows.push(record);
  return record;
}

/** Remove the window with the exact durable id (the only way a window
 * closes: answered, or drained at a boundary). Returns the removed record
 * or undefined. Never by array position. */
export function closeDecisionWindow(state: EncounterState, id: string): DecisionWindowRecord | undefined {
  const index = state.decisionWindows.findIndex((window) => window.id === id);
  if (index < 0) return undefined;
  return state.decisionWindows.splice(index, 1)[0];
}

/** T6.2 — the recorded SAME-OWNER ORDERING decision seam (p.107: "If a
 * character owns multiple effects, and there's ambiguity in the order in
 * which they trigger, they can determine the order"). At a simultaneous
 * ordering point where the U17 authority cannot produce a unique
 * source-defined order AND the tie is one where a SINGLE owner is entitled
 * to choose, this composes the existing underlays:
 *
 *   1. U17 (`sameOwnerOrderingDecision`) classifies the tie and builds the
 *      typed U4 ordering choice over the EXACT candidate set;
 *   2. U2 (`resolveRoleSelector` over the durable `RoleFrame`) derives the
 *      entitled chooser from the choice's declared `chooser: owner` role —
 *      never an ad-hoc actor-id assumption (an underivable chooser FAILS
 *      CLOSED);
 *   3. U13 (`openDecisionWindow`) opens the ONE choice-window record
 *      carrying the ordering choice; the answer (ANSWER_DECISION_WINDOW,
 *      validated through U4) records the order durably and the reducer
 *      (`recordOrderingDecision`) stamps the `resolvedOrder` ranks the U17
 *      pop / projection consume on replay.
 *
 * No second decision system: this is the existing choice window + U4
 * validation + recorded event. The caller suspends whatever resolution
 * must wait for the answer (the pending windows stay open; an interrupt use
 * that would pop them FAILS CLOSED until the order is recorded). */
export function openOrderingDecisionWindow(
  state: EncounterState,
  input: {
    /** Durable window identity (serial-minted via `nextWindowId` or a
     * command-boundary deterministic id). */
    id: string;
    /** The tied candidates, each carrying its owner (the p.107 same-owner
     * read). */
    candidates: readonly OrderingCandidate[];
    /** The durable U2 role frame (the owner + any recorded controllers).
     * Defaults to the shared owner, so a declared `chooser: owner` role
     * resolves to the owner itself — the owner's CONTROLLER authorizes the
     * answer at the network boundary (window.actorId's controllerId). */
    frame?: RoleFrame;
    provenance?: WindowProvenance;
    /** Optional U12 held payload / U11 flow resume the ordering gates. */
    heldPayload?: ArmedContinuation;
    resume?: DecisionWindowRecord['resume'];
    key?: string;
    label?: string;
  },
): DecisionWindowRecord {
  const decision = sameOwnerOrderingDecision(input.candidates, {
    key: input.key ?? 'ordering',
    label: input.label ?? 'Order your simultaneous effects',
  });
  if (decision.kind === 'unresolved') {
    throw new Error(`decision-window.ordering: the candidate set cannot yield a same-owner ordering decision (${decision.problem}) — never an invented order.`);
  }
  const frame: RoleFrame = input.frame ?? { sourceId: decision.ownerId, ownerId: decision.ownerId };
  // The entitled chooser through the U2 role authority: the choice declares
  // `chooser: owner`; an underivable owner role fails closed (never a guess
  // such as the active actor).
  const selector = decision.choice.chooser;
  if (!selector) throw new Error('decision-window.ordering: the same-owner ordering choice must declare its owner chooser role.');
  const chooserId = resolveRoleSelector(selector, deriveRoles(frame));
  if (chooserId === null) {
    throw new Error('decision-window.ordering: the entitled chooser for the same-owner ordering decision cannot be derived from the durable role frame — fail closed, never guess.');
  }
  return openDecisionWindow(state, {
    id: input.id,
    kind: 'choice',
    actorId: chooserId,
    ...(input.provenance !== undefined ? { provenance: input.provenance } : {}),
    ...(input.heldPayload !== undefined ? { heldPayload: input.heldPayload } : {}),
    ...(input.resume !== undefined ? { resume: input.resume } : {}),
    choice: decision.choice,
  });
}

/** T6.2 — apply a RECORDED ordering decision to the tied windows: stamp the
 * durable `resolvedOrder` rank on each candidate window exactly as the
 * player recorded it. The DECISION_ANSWERED reducer consumes this for an
 * ordering window; replay re-stamps the identical ranks from the recorded
 * event (zero fresh choice, zero re-sorting, zero array-order dependence).
 * FAILS CLOSED on a corrupt recorded value: the order must be a permutation
 * of the exact candidate set the window offered, and every named window
 * must still be open. */
export function recordOrderingDecision(state: EncounterState, window: DecisionWindowRecord, value: WindowDecisionValue): void {
  if (window.choice?.kind !== 'ordering') {
    throw new Error('decision-window.ordering: a recorded ordering decision requires the answered window to carry an ordering choice.');
  }
  if (!Array.isArray(value)) {
    throw new Error('decision-window.ordering: the recorded ordering decision must carry the ordered candidate ids.');
  }
  const ordered = value as readonly string[];
  const candidates = window.choice.candidateIds ?? [];
  if (candidates.length !== ordered.length) {
    throw new Error('decision-window.ordering: the recorded ordering is not a permutation of the exact candidate set.');
  }
  if (new Set(ordered).size !== ordered.length) {
    throw new Error('decision-window.ordering: the recorded ordering repeats a candidate.');
  }
  const expected = new Set(candidates);
  for (const id of ordered) {
    if (!expected.has(id)) throw new Error(`decision-window.ordering: the recorded ordering names a candidate that is not in the pending set (${id}).`);
  }
  ordered.forEach((id, rank) => {
    const target = state.decisionWindows.find((candidate) => candidate.id === id);
    if (!target) throw new Error(`decision-window.ordering: candidate window ${id} is no longer open when its recorded ordering is applied.`);
    target.resolvedOrder = rank;
  });
}

/** T6.2 — reducer-side same-owner tie detection: when ONE event opens two or
 * more interrupt windows for the SAME responder at the same instant (e.g. an
 * area blast that opens two when-damaged windows for one owner), the owner
 * is entitled to determine their order (p.107). Opens the U13 ordering
 * decision window (once) so the owner can record their order; while the
 * decision is pending the LIFO pop / boundary projection FAIL CLOSED
 * (never an invented order), and once recorded the pop consumes the ranks.
 *
 * Deterministic and replay-safe: a pure function of the durable window set
 * (the reducer opens it identically on replay); window identity is
 * serial-minted. A tie whose ordering decision is already recorded, or an
 * ordering window already open for the exact tied set, is never reopened. */
export function openOrderingDecisionForSameOwnerTies(state: EncounterState): void {
  const byActor = new Map<string, DecisionWindowRecord[]>();
  for (const window of state.decisionWindows) {
    if (!isInterruptWindowKind(window.kind)) continue;
    if (window.triggeredAt !== state.revision) continue;
    const group = byActor.get(window.actorId) ?? [];
    group.push(window);
    byActor.set(window.actorId, group);
  }
  for (const [actorId, windows] of byActor) {
    if (windows.length < 2) continue;
    // The decision is already recorded — nothing to open.
    if (windows.every((window) => typeof window.resolvedOrder === 'number')) continue;
    // An ordering window for the EXACT tied set is already open — never
    // duplicate the decision (two simultaneous-order decisions must never
    // alias one durable window/choice identity).
    const alreadyOpen = state.decisionWindows.some((window) =>
      window.kind === 'choice'
      && window.choice?.kind === 'ordering'
      && window.choice.candidateIds?.length === windows.length
      && window.choice.candidateIds.every((id) => windows.some((candidate) => candidate.id === id)));
    if (alreadyOpen) continue;
    const decision = sameOwnerOrderingDecision(
      windows.map((window) => ({ id: window.id, ownerId: window.actorId })),
      { key: 'ordering', label: 'Order your simultaneous effects' },
    );
    if (decision.kind === 'unresolved') continue; // not a same-owner tie — fail closed at the pop, never a guess
    const id = nextWindowId(state, 'choice', actorId);
    openDecisionWindow(state, {
      id,
      kind: 'choice',
      actorId: decision.ownerId,
      provenance: { sourceActorId: actorId },
      choice: decision.choice,
    });
  }
}

/** The U12 held-damage projection of a window's held payload. The payload is
 * the authority: the determined post-mitigation amount, never recomputed.
 * Absent for windows that hold no damage. */
export function windowHeldDamage(window: DecisionWindowRecord): EncounterHeldDamage | undefined {
  const payload = window.heldPayload;
  if (!payload || payload.payload.kind !== 'held-result') return undefined;
  const result = payload.payload.result;
  if (result.kind !== 'damage') return undefined;
  return {
    targetId: result.targetId,
    amount: result.amount,
    damageType: result.damageType,
    sourceActorId: result.sourceActorId,
    sourceId: result.sourceId,
    instance: result.instance,
    delivery: result.delivery,
    ignoreCover: result.ignoreCover,
    ...(result.bypassVigor !== undefined ? { bypassVigor: result.bypassVigor } : {}),
    ...(result.ignoreDefiance !== undefined ? { ignoreDefiance: result.ignoreDefiance } : {}),
    ...(result.ignoreDodge !== undefined ? { ignoreDodge: result.ignoreDodge } : {}),
  };
}

/** The U12 held-save projection of a window's held payload — the F2 durable
 * record the command layer reads to re-roll a save (Sucker Punch, p.143)
 * with the EXACT evaluated modifier policy, and the reducer reads to resolve
 * the original branch. The payload is the authority; the projection is a
 * convenience for legacy consumers (never a second record). */
export interface WindowHeldSave {
  targetId: string;
  boon: number;
  sourceId: string;
  sourceActorId: string;
  windowKind?: SaveWindowKind;
  windowId?: string;
  statusId?: string;
  modifiers?: { sourceModifier: number; saveBoon: number; saveCurse: number; blessing: boolean };
  threshold: number;
  onSuccess: RuleEffect[];
  onFailure: RuleEffect[];
}

export function windowHeldSave(window: DecisionWindowRecord): WindowHeldSave | undefined {
  const payload = window.heldPayload;
  if (!payload || payload.payload.kind !== 'held-result') return undefined;
  const result = payload.payload.result;
  if (result.kind !== 'save') return undefined;
  return {
    targetId: result.targetId,
    boon: result.boon,
    // The held-result continuation's program identity IS the source ability
    // identity (heldSaveContinuation arms programId = sourceId).
    sourceId: payload.programId,
    sourceActorId: result.sourceActorId,
    threshold: result.threshold,
    ...(result.windowKind !== undefined ? { windowKind: result.windowKind as SaveWindowKind } : {}),
    ...(result.windowId !== undefined ? { windowId: result.windowId } : {}),
    ...(result.statusId !== undefined ? { statusId: result.statusId } : {}),
    ...(result.modifiers !== undefined ? { modifiers: result.modifiers } : {}),
    onSuccess: result.onSuccess,
    onFailure: result.onFailure,
  };
}

/** The LIFO window selection for `actorId` through the U17 stack rule — the
 * recorded `triggeredAt` decides, never array construction order. A
 * same-instant same-owner ambiguity (p.107: the owner may determine the
 * order of their own simultaneously triggered effects) consumes the
 * RECORDED ordering decision when one exists (the `resolvedOrder` ranks a
 * U13 ordering window's answer stamped — never the incidental registration
 * `order`); when the decision is pending or absent the engine FAILS CLOSED
 * instead of silently substituting the registration order (an incidental
 * array stand-in). Returns the single most-recently-triggered candidate. */
function topDecisionWindowStack(state: EncounterState, actorId: string, heldOnly: boolean): DecisionWindowRecord | undefined {
  // Choice windows are player decisions — an interrupt execution NEVER pops
  // them; they are answered by id through ANSWER_DECISION_WINDOW.
  const candidates = state.decisionWindows.filter((window) => window.actorId === actorId && isInterruptWindowKind(window.kind) && (!heldOnly || window.heldPayload !== undefined));
  if (candidates.length === 0) return undefined;
  const latest = Math.max(...candidates.map((window) => window.triggeredAt));
  const atLatest = candidates.filter((window) => window.triggeredAt === latest);
  if (atLatest.length > 1) {
    // Same-instant same-owner tie (the pop path is per-owner by
    // construction): consume the RECORDED ordering decision when every tied
    // window carries a DISTINCT rank; a pending/absent or inconsistent
    // recording is UNRESOLVED — the engine rejects rather than invent an
    // order (duplicate ranks are corruption — fail closed, never an
    // incidental stable-sort pick).
    const ranks = atLatest.map((window) => window.resolvedOrder);
    if (ranks.every((rank): rank is number => typeof rank === 'number') && new Set(ranks).size === ranks.length) {
      return [...atLatest].sort((first, second) => (first.resolvedOrder ?? 0) - (second.resolvedOrder ?? 0))[0]!;
    }
    throw new Error(`decision-window.ambiguous-order: ${actorId} owns ${atLatest.length} simultaneously triggered windows (triggeredAt ${latest}); ICON p.107 grants the owner the ordering choice — the recorded ordering decision is pending, absent, or inconsistent (route through openOrderingDecisionWindow / the U13 ordering window), and no incidental registration order is used.`);
  }
  return atLatest[0]!;
}

/** Pop (LIFO) the most recently triggered window for `actorId` (matching
 * `heldOnly`), through the U17 stack rule — the recorded `triggeredAt`
 * decides, never array construction order. Used by the interrupt command
 * path: an interrupt answers the most recently triggered window still
 * holding damage (falls back to a plain window for triggers with no
 * deferral). Fails closed on a same-instant same-owner ambiguity (see
 * `topDecisionWindowStack`). */
export function popDecisionWindowStack(state: EncounterState, actorId: string, heldOnly: boolean): DecisionWindowRecord | undefined {
  const top = topDecisionWindowStack(state, actorId, heldOnly);
  if (!top) return undefined;
  return closeDecisionWindow(state, top.id);
}

/** Non-mutating twin of `popDecisionWindowStack`: the same LIFO selection
 * (and the same fail-closed ambiguity) WITHOUT closing the window. The
 * command boundary uses it to inject the window's held payload into an
 * interrupt's planning context — the reducer pops the SAME window.
 * Choice windows are never selected (they are answered by id). */
export function peekDecisionWindowStack(state: EncounterState, actorId: string, heldOnly: boolean): DecisionWindowRecord | undefined {
  return topDecisionWindowStack(state, actorId, heldOnly);
}

/** The U12 held-result of a window's held payload (the determined save or
 * damage) — the durable authority the command boundary injects into an
 * interrupt's planning context. Absent for windows that hold nothing. */
export function windowHeldResult(window: DecisionWindowRecord): HeldResult | undefined {
  const payload = window.heldPayload;
  if (!payload || payload.payload.kind !== 'held-result') return undefined;
  return payload.payload.result;
}

/** The deterministic total order for simultaneous windows (ICON p.107):
 * most-recently-triggered first, then — for windows of the SAME trigger at
 * the same instant — the turn-order rule (the turn character's side first),
 * and within a same-owner tie the RECORDED ordering decision (T6.2: p.107
 * grants the owning character the right to determine the order of their own
 * simultaneously triggered effects). FAILS CLOSED wherever the source
 * grants a choice that has not been recorded or defines no total order: a
 * same-instant same-owner tie WITHOUT a recorded order is a PENDING
 * recorded decision (`ordering.decision-required` — route through the U13
 * ordering window, never an invented tie-break), and a same-instant
 * same-side tie across DIFFERENT owners (no single entitled chooser; no
 * source-defined total order — never an invented lexicographic kind order)
 * REJECTS as unrepresentable. Returns a NEW array; never mutates the input
 * or the state. */
export function orderDecisionWindows(state: EncounterState, turnActorId: string, pending: DecisionWindowRecord[]): DecisionWindowRecord[] {
  const turnSide = state.actors[turnActorId]?.side;
  const sideRank = (actorId: string): number => (state.actors[actorId]?.side === turnSide ? 0 : 1);
  const sorted = [...pending].sort((first, second) => {
    if (first.triggeredAt !== second.triggeredAt) return second.triggeredAt - first.triggeredAt;
    const bySide = sideRank(first.actorId) - sideRank(second.actorId);
    if (bySide !== 0) return bySide;
    // Same-instant same-side: the RECORDED owner-ordering rank when both
    // windows carry one (a recorded decision — never the incidental
    // registration `order`).
    const firstRank = first.resolvedOrder;
    const secondRank = second.resolvedOrder;
    if (typeof firstRank === 'number' && typeof secondRank === 'number') return firstRank - secondRank;
    return 0;
  });
  // Verify the sort is actually a TOTAL order derivable from source
  // authorities: any remaining tie (same instant + same side) is either a
  // same-owner tie whose RECORDED decision is pending/absent, or a
  // different-owner tie (no single chooser; different trigger kinds define
  // no order) — neither has a source-defined order, so the projection
  // rejects instead of inventing one.
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const first = sorted[index]!;
    const second = sorted[index + 1]!;
    if (first.triggeredAt === second.triggeredAt && sideRank(first.actorId) === sideRank(second.actorId)) {
      // A pair BOTH of whose windows carry a DISTINCT recorded rank was
      // resolved by the sort above — the recorded decision, never the
      // incidental registration `order`. Duplicate ranks at the same instant
      // are corruption — fail closed, never a stable-sort pick.
      if (typeof first.resolvedOrder === 'number' && typeof second.resolvedOrder === 'number') {
        if (first.resolvedOrder === second.resolvedOrder) {
          throw new Error(`decision-window.ordering.conflict: windows ${first.id} and ${second.id} carry conflicting recorded ranks (${first.resolvedOrder}) — a recorded ordering decision stamps each window exactly once.`);
        }
        continue;
      }
      const sameOwner = first.actorId === second.actorId;
      throw new Error(sameOwner
        ? `decision-window.ordering.decision-required: windows ${first.id} and ${second.id} are simultaneous and owned by one character; ICON p.107 grants the owner the ordering choice — record it through the U13 ordering decision window (openOrderingDecisionWindow), never an invented tie-break.`
        : `decision-window.ordering-unrepresentable: windows ${first.id} and ${second.id} are simultaneous and same-side with DIFFERENT owners; ICON p.107 grants no single character the choice here and defines no total order across different trigger kinds — a recorded decision is required, never an invented tie-break.`);
    }
  }
  return sorted;
}

// ── Damage-window eligibility (migrated from the F4 trigger-window
//    registry) ─────────────────────────────────────────────────────────────
/** Durable provenance one damage instance carries into the window decision. */
export interface DamageWindowProvenance {
  targetId: string;
  /** Terrain and other non-actor sources are null and never open a window. */
  sourceActorId: string | null;
  /** The post-mitigation determined amount (never the raw source amount). */
  determinedAmount: number;
  bypassVigor: boolean;
  damageType: 'normal' | 'piercing' | 'divine';
  ignoreDefiance?: boolean;
}

interface DamageWindowRecipe {
  kind: 'when-damaged' | 'defeated';
  /** The authority decision, evaluated from provenance only. Returns the
   * responding owner's actor id when the window opens (null = no window). */
  opens(state: EncounterState, target: EncounterActor, provenance: DamageWindowProvenance): string | null;
}

/** The closed damage-window eligibility registry. The rows are ordered:
 * when both triggers are armed the more specific one wins (when-damaged —
 * the blow is determined but not applied — before defeated — the blow would
 * defeat the target), matching p.107. Each row answers WHO the window
 * belongs to: the responding interrupt owner (the window's `actorId`), or
 * null when the row does not open. */
export const DAMAGE_WINDOW_RECIPES: readonly DamageWindowRecipe[] = [
  {
    // ICON p.107/p.128 Righteous Disdain: a foe's determined damage to an
    // ALLY (in range of an available when-damaged interrupt owner) is held
    // while that owner's interrupt remains available. The trigger is the
    // OWNER-ALLY relationship (the interrupt owner is distinct from the
    // damaged character — the owner answers for the ally's blow).
    kind: 'when-damaged',
    opens: (state, target, provenance) => {
      const source = provenance.sourceActorId ? state.actors[provenance.sourceActorId] : undefined;
      if (provenance.determinedAmount <= 0) return null;
      if (!source || source.side === target.side) return null;
      // The eligible when-damaged interrupt OWNER within the source-required
      // range of the damaged ally (owner ≠ target), or null when none.
      return whenDamagedInterruptOwner(state, target, source)?.id ?? null;
    },
  },
  {
    // ICON p.107/p.138 Boiling Blood: a lethal foe blow is held while the
    // target's defeated interrupt remains available. The prospective-defeat
    // test shares the Defiance/Defy Death application floors with the damage
    // pipeline, so the window gate and the blow that would be held agree.
    // The defeated window belongs to the TARGET ("Trigger: You are
    // defeated").
    kind: 'defeated',
    opens: (state, target, provenance) => {
      const source = provenance.sourceActorId ? state.actors[provenance.sourceActorId] : undefined;
      return Boolean(source && source.side !== target.side)
        && hasAvailableDefeatedInterrupt(target)
        && prospectiveAppliedDefeat(target, provenance.determinedAmount, provenance.bypassVigor, {
          ignoreDefiance: provenance.ignoreDefiance,
          damageType: provenance.damageType,
        }, state)
        ? target.id
        : null;
    },
  },
];

/** Decide, from durable provenance, whether a damage instance is held by an
 * interrupt window, which kind holds it, and WHO the window belongs to (the
 * responding interrupt owner). The first applicable recipe wins (registry
 * order = the p.107 priority). Never re-evaluates availability against live
 * state on the replay side. */
export function decideDamageWindow(
  state: EncounterState,
  target: EncounterActor,
  provenance: DamageWindowProvenance,
): { kind: 'when-damaged' | 'defeated'; actorId: string } | null {
  for (const recipe of DAMAGE_WINDOW_RECIPES) {
    const actorId = recipe.opens(state, target, provenance);
    if (actorId !== null) return { kind: recipe.kind, actorId };
  }
  return null;
}

/** Replay-side: open the interrupt window a damage ledger entry records. The
 * record is the authority — replay never re-evaluates the target's
 * availability or the blow's lethality. A held entry is NOT applied here; it
 * applies when the interrupt answers the window or the boundary drains it.
 * Returns true when the window was actually opened; a held record whose kind
 * is outside the closed registry is ignored so the damage still applies
 * normally. */
export function openDamageWindowFromLedger(state: EncounterState, entry: DamageLedgerEntry): boolean {
  if (!entry.window || !entry.window.held) return false;
  if (entry.handoff !== 'determined') return false;
  const kind = entry.window.trigger;
  if (!DAMAGE_WINDOW_RECIPES.some((recipe) => recipe.kind === kind)) return false;
  const target = state.actors[entry.targetId];
  const source = entry.sourceActorId ? state.actors[entry.sourceActorId] : undefined;
  // The window's owner is re-derived deterministically from the SAME
  // pre-event state the command boundary decided against (the recipe is a
  // pure function of state + provenance), so replay reproduces the identical
  // responding owner: the damaged target for a `defeated` blow, the
  // range-satisfying when-damaged interrupt OWNER for a `when-damaged` blow.
  // A held `when-damaged` entry whose owner cannot be re-derived is replay
  // corruption — fail closed, never fall back to the recipient.
  const actorId = kind === 'defeated'
    ? entry.targetId
    : (() => {
      if (!target || !source) throw new Error(`decision-window.ledger-owner: cannot re-derive the when-damaged interrupt owner for held entry ${entry.targetId}.`);
      const owner = whenDamagedInterruptOwner(state, target, source);
      if (!owner) throw new Error(`decision-window.ledger-owner: recorded held when-damaged entry for ${entry.targetId} has no eligible interrupt owner at replay.`);
      return owner.id;
    })();
  const id = nextWindowId(state, kind, actorId);
  openDecisionWindow(state, {
    id,
    kind,
    actorId,
    provenance: { sourceId: entry.sourceRuleId, sourceActorId: entry.sourceActorId ?? undefined },
    heldPayload: heldDamageContinuation({
      id: `held:${id}`,
      programId: entry.sourceRuleId,
      ownerActorId: actorId,
      targetId: entry.targetId,
      amount: entry.amount,
      damageType: entry.damageType,
      sourceActorId: entry.sourceActorId ?? entry.sourceRuleId,
      sourceId: entry.sourceRuleId,
      instance: entry.instance,
      delivery: entry.delivery,
      ignoreCover: entry.ignoreCover,
      windowId: id,
      ...(entry.bypassVigor !== undefined ? { bypassVigor: entry.bypassVigor } : {}),
      ...(entry.ignoreDefiance !== undefined ? { ignoreDefiance: entry.ignoreDefiance } : {}),
      ...(entry.ignoreDodge !== undefined ? { ignoreDodge: entry.ignoreDodge } : {}),
    }),
  });
  return true;
}

/** Convenience: build the U12 held-save continuation a `save-rolled` window
 * carries (the original determined save result, resuming exactly as
 * recorded — a reroll is a separately recorded result). Kept here so the
 * window and its held payload are constructed in ONE place. */
export { heldSaveContinuation };
