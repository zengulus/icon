import type { EncounterActiveEffect, EncounterActor, EncounterState } from '../../types.js';

/**
 * Aura membership kernel (docs/rules-foundations.md §6 "Aura membership").
 *
 * ICON Aura X is a continuous ongoing effect on all characters in range X of
 * an origin while they remain inside (glossary). The engine represents an
 * active aura as a durable `persistent` effect whose radius is carried by a
 * `grant`/`aura` modifier; this kernel reads that durable record (never prose)
 * and answers spatial membership from the single source of truth.
 *
 * It is deliberately source-ID-free: content registers aura effects with a
 * typed radius modifier, and this kernel only interprets that typed record.
 * All aura producers and consumers (Rook, Shieldmaster, Sweet Torment,
 * Gentleness, the foe-trait aura rows) read membership here, so there is one
 * authoritative distance rule rather than per-content inline scans.
 */

/** The effective aura radius carried by a bearer's persistent aura effects
 * (the largest `grant`/`aura` constant across the bearer's aura effects), or
 * `null` when the bearer projects no active aura. Includes the bearer's own
 * aura so a self-grant like Rook's "you also have counter while the aura is
 * active" is represented as the bearer always being a member of their own
 * aura. */
export function auraRadius(effects: readonly EncounterActiveEffect[]): number | null {
  let radius: number | null = null;
  for (const effect of effects) {
    // Any active effect carrying a `grant`/`aura` modifier is an aura;
    // producers may key the effect as `aura` (Rook) or by another id with the
    // aura modifier (e.g. Sweet Torment).
    for (const modifier of effect.modifiers) {
      if (modifier.operation !== 'grant' || modifier.stat !== 'aura') continue;
      const value = modifier.value;
      if (typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'constant'
        && 'value' in value && typeof value.value === 'number') {
        radius = Math.max(radius ?? 0, Math.max(0, value.value));
      } else if (typeof value === 'number') {
        radius = Math.max(radius ?? 0, Math.max(0, value));
      }
    }
  }
  return radius;
}

/** True when `target` is inside `bearer`'s active aura radius (Chebyshev, the
 * ICON L∞ `footprintDistance` used everywhere else in the engine). A bearer is
 * always a member of its own active aura. */
export function inAura(state: EncounterState, bearer: EncounterActor, target: EncounterActor): boolean {
  if (target.defeated || !target.onBattlefield || !target.position) return false;
  if (bearer === target) return true;
  if (bearer.defeated || !bearer.onBattlefield || !bearer.position) return false;
  const radius = auraRadius(bearer.activeEffects);
  if (radius === null) return false;
  return Math.max(Math.abs(bearer.position.x - target.position.x), Math.abs(bearer.position.y - target.position.y)) <= radius;
}

/** All on-battlefield, undefeated actors inside `bearer`'s active aura
 * (including the bearer itself). Deterministic order by id for replay. */
export function charactersInAura(state: EncounterState, bearer: EncounterActor): EncounterActor[] {
  return Object.values(state.actors)
    .filter((candidate) => inAura(state, bearer, candidate))
    .sort((first, second) => first.id.localeCompare(second.id));
}
