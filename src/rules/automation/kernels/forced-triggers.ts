/**
 * Forced combat-trigger kernel (trigger provenance, ICON p.95).
 *
 * A source clause that reads "…triggers any <trigger> effects the first time
 * it is used in combat" (e.g. Sealer Open The Gates, p.194) is a
 * SOURCE-FORCED activation: the source's own text forces the trigger without
 * its ordinary natural condition, once per combat. This kernel owns the
 * generic seam — a content-registered table of (sourceId → trigger) whose
 * availability is a U16 once-per-combat entitlement on the acting actor.
 *
 * The command boundary checks availability from the PRE-command state and
 * turns it into a source-forced trigger activation; the reducer records the
 * consume on that ability's own event (replay applies the recorded consume
 * exactly once, and the planning never writes to the caller's state). The
 * kernel contains no source IDs; content (content/jobs/forced-trigger-
 * recipes.ts) registers the named rows.
 */
import type { EncounterActor } from '../../types.js';
import { recordUsageKey, usageCount } from './use-ledger.js';
import { usageKey } from '../primitives/usage.js';

const rules = new Map<string, string>();

/** Register a forced once-per-combat trigger (content-owned row). */
export function registerForcedCombatTrigger(rule: { sourceId: string; trigger: string }): void {
  rules.set(rule.sourceId, rule.trigger);
}

/** The trigger a source forces on its first combat use, or undefined. */
export function forcedCombatTriggerFor(sourceId: string): string | undefined {
  return rules.get(sourceId);
}

/** The durable U16 once-per-combat gate key for a source's forced trigger.
 * Actor-local (stored on the acting actor's ruleState), combat scope — never
 * refreshes mid-encounter. The sourceId is content provenance; the key stays
 * opaque. */
export function forcedCombatTriggerKey(sourceId: string): string {
  return usageKey({ sourceId: `core:forced-combat-trigger:${sourceId}`, ownerId: '', scope: 'combat' });
}

/** True when the actor's first-use entitlement for this source is still
 * available at the command boundary (the PRE-command state). */
export function forcedCombatTriggerAvailable(
  actor: Pick<EncounterActor, 'id' | 'ruleState' | 'ruleStateOwners'>,
  sourceId: string,
): boolean {
  return usageCount(actor, forcedCombatTriggerKey(sourceId)) === 0;
}

/** Record the once-per-combat consume on the ability's event (reducer side,
 * exactly when the boundary derived the forced activation). */
export function consumeForcedCombatTrigger(
  actor: Pick<EncounterActor, 'id' | 'ruleState' | 'ruleStateOwners'>,
  sourceId: string,
): void {
  recordUsageKey(actor, forcedCombatTriggerKey(sourceId));
}