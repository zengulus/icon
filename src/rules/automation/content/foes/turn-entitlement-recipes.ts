import { registerTurnEntitlementSource } from '../../../turn-scheduler.js';

/**
 * Foe role turn entitlements (ICON pp.298–299, Glossary of Foes / Elite
 * template). The scheduler machinery (`turn-scheduler.ts`) sums registered
 * sources above the default of 1; these are the PRODUCTION rows for the two
 * source templates that grant more than one turn per round. They are
 * re-derived identically on command and at every round reset, so replay never
 * re-rolls or re-decides them (AGENTS §6).
 *
 * - Elite template (p.299): "This foe takes 2 turns. Double HP for the Foe."
 *   The double-HP half is applied once at construction
 *   (`createFoeFromProfile`); this row owns the TURN half: one extra turn per
 *   round above the default. The row reads the actor's durable `foeKind`
 *   ('elite'), projected at construction from the extracted profile kind —
 *   there is no shared stable trait id across the 39 elite profiles, and no
 *   runtime catalog query (same pattern as the durable `roleId`).
 *
 * - Legend role (p.298): "Takes 1 turn for each player character". The count
 *   reads the AUTHORITATIVE encounter state every time it is derived — it is
 *   never a caller-supplied constant and never frozen at construction.
 *
 * Defeated player characters still count toward a Legend's turns. The source
 * names no exception ("each player character", p.298/p.310–313), and the
 * engine already reads unqualified "characters" as defeated-inclusive where
 * the text is silent (the p.99 settlement grant). This is a PINNED READING OF
 * SOURCE SILENCE, not an adjudicated conflict — ICON 1.5 contains no second
 * passage contradicting it, so no `source-adjudications.ts` record exists
 * (that registry admits genuine two-passage conflicts only). If a future
 * rules revision narrows "player character" to living characters, change the
 * predicate here and its pinning test together.
 */

/** Registered source id of the Elite-template extra-turn row. */
export const ELITE_TURN_ENTITLEMENT_SOURCE_ID = 'role:elite-template';

registerTurnEntitlementSource({
  sourceId: ELITE_TURN_ENTITLEMENT_SOURCE_ID,
  extraTurns: (_state, actor) => (actor.side === 'foes' && actor.foeKind === 'elite' ? 1 : 0),
});

/** Registered source id of the Legend-role per-player-character row. */
export const LEGEND_TURN_ENTITLEMENT_SOURCE_ID = 'role:legend-turns';

registerTurnEntitlementSource({
  sourceId: LEGEND_TURN_ENTITLEMENT_SOURCE_ID,
  extraTurns: (state, actor) => {
    if (actor.side !== 'foes' || actor.roleId !== 'legend') return 0;
    // Defeated player characters keep counting (see the pinned reading above);
    // allied summons/companions are not player characters.
    const playerCharacters = Object.values(state.actors)
      .filter((candidate) => candidate.side === 'heroes' && candidate.actorKind === 'hero');
    return Math.max(0, playerCharacters.length - 1);
  },
});
