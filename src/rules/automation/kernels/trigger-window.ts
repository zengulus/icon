import type { EncounterActor, EncounterHeldDamage, EncounterPendingInterrupt, EncounterState } from '../../types.js';
import type { DamageLedgerEntry, DamageWindowLedger } from './damage-ledger.js';
import { applyOrdering } from '../primitives/ordering.js';
import { hasAvailableDefeatedInterrupt, hasAvailableWhenDamagedInterrupt, prospectiveAppliedDefeat } from './encounter-adapter.js';

/**
 * F4 Trigger/window provenance (docs/rules-foundations.md §5).
 *
 * The interrupt-window protocol (ICON p.107) has one decision point and one
 * replay entry point. `TRIGGER_WINDOW_RECIPES` is the closed registry keyed
 * by trigger: each row answers, from **durable provenance** — who damaged
 * whom, with what determined amount, through which delivery — whether a
 * window opens. Both the single-pass VM path (`applyDamage`) and the
 * split-event path (a basic attack's `AttackResolutionLedger`) call the same
 * `decideDamageWindow`, so they can never drift; replay of a split event
 * opens the window from the recorded `DamageWindowLedger` via
 * `openDamageWindowFromLedger`, never by re-evaluating mutable window state.
 *
 * The rows are ordered: when both triggers are armed the more specific one
 * wins (when-damaged — the blow is determined but not applied — before
 * defeated — the blow would defeat the target), matching p.107.
 */

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
  trigger: 'when-damaged' | 'defeated';
  /** The authority decision, evaluated from provenance only. */
  opens(state: EncounterState, target: EncounterActor, provenance: DamageWindowProvenance): boolean;
}

export const TRIGGER_WINDOW_RECIPES: readonly DamageWindowRecipe[] = [
  {
    // ICON p.107/p.128 Righteous Disdain: foe damage is determined but not yet
    // applied while the target's when-damaged interrupt remains available.
    trigger: 'when-damaged',
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
    trigger: 'defeated',
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
 * interrupt window and which trigger holds it. Returns the durable
 * `DamageWindowLedger` record, or null when no armed interrupt covers the
 * blow. The first applicable recipe wins (registry order = p.107 priority). */
export function decideDamageWindow(
  state: EncounterState,
  target: EncounterActor,
  provenance: DamageWindowProvenance,
): DamageWindowLedger | null {
  // The recipe order is the U17 `source-order` policy applied against the
  // registry's own listing (when-damaged before defeated, p.107) — the ONE
  // ordering authority, so the recorded boundary contract never depends on
  // array construction order.
  const ordered = applyOrdering(
    { kind: 'source-order' },
    TRIGGER_WINDOW_RECIPES.map((recipe) => ({ id: recipe.trigger })),
    { sourceOrder: TRIGGER_WINDOW_RECIPES.map((recipe) => recipe.trigger) },
  );
  for (const candidate of ordered) {
    const recipe = TRIGGER_WINDOW_RECIPES.find((row) => row.trigger === candidate.id);
    if (recipe && recipe.opens(state, target, provenance)) {
      return { trigger: recipe.trigger, held: true, resolution: null };
    }
  }
  return null;
}

/** Push an interrupt window onto the pending queue with deterministic id and
 * order. Shared by the VM path and the ledger replay path. */
export function openDamageWindow(
  state: EncounterState,
  window: { window: DamageWindowLedger; actorId: string; heldDamage: EncounterHeldDamage },
): EncounterPendingInterrupt {
  const pending: EncounterPendingInterrupt = {
    id: `${window.window.trigger}:${window.actorId}:${state.revision}:${state.pendingInterrupts.length}`,
    actorId: window.actorId,
    trigger: window.window.trigger,
    triggeredAt: state.revision,
    order: state.pendingInterrupts.length,
    heldDamage: window.heldDamage,
  };
  state.pendingInterrupts.push(pending);
  return pending;
}

/** Build the held-damage payload for a recorded determined-handoff entry. The
 * entry's amount is the post-mitigation amount the window holds. */
function heldDamageFromEntry(entry: DamageLedgerEntry): EncounterHeldDamage {
  return {
    amount: entry.amount,
    damageType: entry.damageType,
    bypassVigor: entry.bypassVigor ?? entry.damageType === 'divine',
    ...(entry.ignoreDefiance !== undefined ? { ignoreDefiance: entry.ignoreDefiance } : {}),
    sourceActorId: entry.sourceActorId ?? entry.sourceRuleId,
    sourceId: entry.sourceRuleId,
    instance: entry.instance,
    delivery: entry.delivery,
    ignoreCover: entry.ignoreCover,
    ...(entry.ignoreDodge !== undefined ? { ignoreDodge: entry.ignoreDodge } : {}),
  };
}

/** Replay-side: open the interrupt window a damage ledger entry records. The
 * record (`entry.window`) is the authority — replay never re-evaluates the
 * target's availability or the blow's lethality. A held entry is NOT applied
 * here; it applies when the interrupt answers the window or the boundary
 * drains it (matching the single-pass path). Returns true when the window was
 * actually opened; a held record whose trigger is outside the closed registry
 * (or that rides a source-handoff entry) is ignored so the damage still
 * applies normally. */
export function openDamageWindowFromLedger(state: EncounterState, entry: DamageLedgerEntry): boolean {
  if (!entry.window || !entry.window.held) return false;
  if (entry.handoff !== 'determined') return false;
  if (!TRIGGER_WINDOW_RECIPES.some((recipe) => recipe.trigger === entry.window!.trigger)) return false;
  openDamageWindow(state, {
    window: entry.window,
    actorId: entry.targetId,
    heldDamage: heldDamageFromEntry(entry),
  });
  return true;
}
