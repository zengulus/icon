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
 * first) — implemented as triggeredAt-desc grouping; same-time windows of
 * the SAME trigger resolve "in the same order as turns (player
 * character/npc, alternating)" — the turn character's side first, then the
 * other side (the alternation's first step), with same-side windows keeping
 * their recorded registration `order` as the deterministic stand-in for the
 * owner's ordering choice (p.107: "If a character owns multiple effects, and
 * there's ambiguity in the order in which they trigger, they can determine
 * the order" — a recorded player ordering decision routes through the U17
 * `controller-choice` policy instead when content declares one). Different
 * triggers at the same moment keep a deterministic listing order by kind.
 * Incidental array insertion order, object-key order, and actor-id sorting
 * are never game rules.
 *
 * No source IDs, no per-source branches: content opens windows through
 * `openDecisionWindow` with its own kind/choice; the engine never branches
 * on a source id here.
 */
import type { ArmedContinuation } from '../primitives/continuation.js';
import { heldDamageContinuation, heldSaveContinuation } from '../primitives/continuation.js';
import type { Binder } from '../primitives/reference.js';
import type { OrderingPolicy } from '../primitives/ordering.js';
import type { SaveWindowKind } from '../primitives/save-window.js';
import type { RuleChoice, RuleEffect, RuleMutation } from '../primitives/types.js';
import type { FlowNode } from './execute-flow.js';
import type { DamageLedgerEntry } from './damage-ledger.js';
import type { EncounterActor, EncounterHeldDamage, EncounterState } from '../../types.js';
import { hasAvailableDefeatedInterrupt, hasAvailableWhenDamagedInterrupt, prospectiveAppliedDefeat } from './encounter-adapter.js';

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

/** A recorded U4 decision value for a `choice` window. */
export type WindowDecisionValue = string | number | boolean;

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

/** Push one typed window record onto the durable collection with the
 * deterministic identity/order fields. The caller supplies the stable `id`
 * (content provenance); `triggeredAt`/`order` are derived deterministically
 * from the current state — never from ambient call-site order. */
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

/** The U12 held-damage projection of a window's held payload. The payload is
 * the authority: the determined post-mitigation amount, never recomputed.
 * Absent for windows that hold no damage. */
export function windowHeldDamage(window: DecisionWindowRecord): EncounterHeldDamage | undefined {
  const payload = window.heldPayload;
  if (!payload || payload.payload.kind !== 'held-result') return undefined;
  const result = payload.payload.result;
  if (result.kind !== 'damage') return undefined;
  return {
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

/** Pop (LIFO) the most recently triggered window for `actorId` (matching
 * `heldOnly`), through the U17 stack rule — the recorded `triggeredAt`
 * decides, never array construction order. Used by the interrupt command
 * path: an interrupt answers the most recently triggered window still
 * holding damage (falls back to a plain window for triggers with no
 * deferral). */
export function popDecisionWindowStack(state: EncounterState, actorId: string, heldOnly: boolean): DecisionWindowRecord | undefined {
  // Choice windows are player decisions — an interrupt execution NEVER pops
  // them; they are answered by id through ANSWER_DECISION_WINDOW.
  const candidates = state.decisionWindows.filter((window) => window.actorId === actorId && isInterruptWindowKind(window.kind) && (!heldOnly || window.heldPayload !== undefined));
  if (candidates.length === 0) return undefined;
  candidates.sort((first, second) => {
    if (first.triggeredAt !== second.triggeredAt) return second.triggeredAt - first.triggeredAt;
    return second.order - first.order;
  });
  const top = candidates[0]!;
  return closeDecisionWindow(state, top.id);
}

/** The deterministic total order for simultaneous windows (ICON p.107). See
 * the module doc for the U17 policy mapping. Returns a NEW array; never
 * mutates the input or the state. */
export function orderDecisionWindows(state: EncounterState, turnActorId: string, pending: DecisionWindowRecord[]): DecisionWindowRecord[] {
  const turnSide = state.actors[turnActorId]?.side;
  const sideRank = (actorId: string): number => (state.actors[actorId]?.side === turnSide ? 0 : 1);
  return [...pending].sort((first, second) => {
    if (first.triggeredAt !== second.triggeredAt) return second.triggeredAt - first.triggeredAt;
    if (first.kind !== second.kind) return first.kind.localeCompare(second.kind);
    const bySide = sideRank(first.actorId) - sideRank(second.actorId);
    if (bySide !== 0) return bySide;
    return first.order - second.order;
  });
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
  /** The authority decision, evaluated from provenance only. */
  opens(state: EncounterState, target: EncounterActor, provenance: DamageWindowProvenance): boolean;
}

/** The closed damage-window eligibility registry. The rows are ordered:
 * when both triggers are armed the more specific one wins (when-damaged —
 * the blow is determined but not applied — before defeated — the blow would
 * defeat the target), matching p.107. */
export const DAMAGE_WINDOW_RECIPES: readonly DamageWindowRecipe[] = [
  {
    // ICON p.107/p.128 Righteous Disdain: foe damage is determined but not yet
    // applied while the target's when-damaged interrupt remains available.
    kind: 'when-damaged',
    opens: (state, target, provenance) => {
      const source = provenance.sourceActorId ? state.actors[provenance.sourceActorId] : undefined;
      return provenance.determinedAmount > 0
        && Boolean(source && source.side !== target.side)
        && hasAvailableWhenDamagedInterrupt(target);
    },
  },
  {
    // ICON p.107/p.138 Boiling Blood: a lethal foe blow is held while the
    // target's defeated interrupt remains available. The prospective-defeat
    // test shares the Defiance/Defy Death application floors with the damage
    // pipeline, so the window gate and the blow that would be held agree.
    kind: 'defeated',
    opens: (state, target, provenance) => {
      const source = provenance.sourceActorId ? state.actors[provenance.sourceActorId] : undefined;
      return Boolean(source && source.side !== target.side)
        && hasAvailableDefeatedInterrupt(target)
        && prospectiveAppliedDefeat(target, provenance.determinedAmount, provenance.bypassVigor, {
          ignoreDefiance: provenance.ignoreDefiance,
          damageType: provenance.damageType,
        }, state);
    },
  },
];

/** Decide, from durable provenance, whether a damage instance is held by an
 * interrupt window and which kind holds it. The first applicable recipe wins
 * (registry order = the p.107 priority). Never re-evaluates availability
 * against live state on the replay side. */
export function decideDamageWindow(
  state: EncounterState,
  target: EncounterActor,
  provenance: DamageWindowProvenance,
): { kind: 'when-damaged' | 'defeated' } | null {
  for (const recipe of DAMAGE_WINDOW_RECIPES) {
    if (recipe.opens(state, target, provenance)) return { kind: recipe.kind };
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
  const id = `${kind}:${entry.targetId}:${state.revision}:${state.decisionWindows.length}`;
  openDecisionWindow(state, {
    id,
    kind,
    actorId: entry.targetId,
    provenance: { sourceId: entry.sourceRuleId, sourceActorId: entry.sourceActorId ?? undefined },
    heldPayload: heldDamageContinuation({
      id: `held:${id}`,
      programId: entry.sourceRuleId,
      ownerActorId: entry.targetId,
      targetId: entry.targetId,
      amount: entry.amount,
      damageType: entry.damageType,
      sourceActorId: entry.sourceActorId ?? entry.sourceRuleId,
      sourceId: entry.sourceRuleId,
      instance: entry.instance,
      delivery: entry.delivery,
      ignoreCover: entry.ignoreCover,
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
