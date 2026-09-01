/**
 * Trigger activation provenance (ICON p.95 + the trigger-authority gate).
 *
 * A trigger (charge, comeback, finishing-blow, exceed, collide, slay,
 * heroic, infuse) becomes active for a resolution through one of exactly
 * three owning paths, and that ownership is durable and auditable:
 *
 * - `natural` — derived from AUTHORITATIVE state or the resolution's OWN
 *   facts: charge (the durable slow-turn flag), comeback (the user is
 *   bloodied), finishing-blow (the primary target is bloodied), exceed (the
 *   ability's own attack roll totals 15+, p.93), collide (the resolution's
 *   own shove actually collided, p.102/103), slay (the resolution's own
 *   damage reduced a character to 0, p.95 glossary).
 * - `source-forced` — the SOURCE's own text forces the trigger without its
 *   ordinary natural condition: Gallows Humor's empowered ability "triggers
 *   any slay effects, hit or miss" (p.151), Ace "the next attack triggers
 *   every exceed effect" (p.157), Blessing of War's 3-blessing forced exceed
 *   (p.191), Massive Overhead's armed exceed (p.134). These are NOT forged
 *   triggers — they are source-authorized forced activations of the SAME
 *   trigger semantics.
 * - `validated-player-activation` — the player DECLARED the trigger and an
 *   entitlement/economy authority validated it before execution: Heroic when
 *   the character owns a heroic-granting trait (Strive / Demon Strength /
 *   Wolfheart / Spite). A declaration is intent only until validated; it
 *   never becomes semantic truth by being named.
 *
 * Invariant: natural and source-forced activation of the SAME trigger
 * collapse to ONE semantic activation unless the source explicitly says
 * otherwise (a trigger's effects fire once per resolution). The effective
 * trigger set is the union; the provenance map records how each member
 * became active (a trigger that arrived both ways is recorded once per
 * arrival order, first write wins).
 *
 * This module is source-ID-free: it owns the vocabulary and the collapse
 * bookkeeping, never a named ability.
 */

export type TriggerProvenance = 'natural' | 'source-forced' | 'validated-player-activation';

export interface TriggerActivation {
  trigger: string;
  provenance: TriggerProvenance;
}

export const TRIGGER_PROVENANCES: readonly TriggerProvenance[] = [
  'natural',
  'source-forced',
  'validated-player-activation',
] as const;

/** Record one activation into a provenance map. The effective trigger set is
 * the map's key set; a trigger already recorded keeps its earlier provenance
 * (the activation collapsed — never double-fired), and a trigger arriving
 * through a new path is recorded with its own provenance. */
export function recordTriggerActivation(
  provenance: Map<string, TriggerProvenance>,
  trigger: string,
  path: TriggerProvenance,
): void {
  if (!provenance.has(trigger)) provenance.set(trigger, path);
}

/** Project a provenance map onto a deterministic activation list (sorted by
 * trigger) for the durable event record. */
export function triggerActivationsFrom(
  provenance: ReadonlyMap<string, TriggerProvenance>,
): TriggerActivation[] {
  return [...provenance.keys()]
    .sort()
    .map((trigger) => ({ trigger, provenance: provenance.get(trigger)! }));
}