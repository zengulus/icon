import type { EncounterActor } from '../../types.js';

/**
 * Power-die kernel (docs/primitives-needed.md §"Power-die stance"; ICON
 * pp.118–130, 151).
 *
 * A power die is a persistent per-actor counter (a `ruleState` number) that
 * starts at a source-defined value, ticks up by 1 at a source-defined
 * lifecycle/trigger boundary, and is consumed/empowered by an owner spend.
 * The durable `ruleState[KEY]` value is the single source of truth; these
 * helpers standardize the read / tick-up / consume operations so content
 * rows share one rule instead of re-inlining `Number(ruleState[KEY] ?? S) + 1`
 * (previously duplicated across the soul-blade, gallows-humor, umbral-echo,
 * and mantra stance dies).
 *
 * Deliberately source-ID-free: the caller supplies the ruleState key and the
 * source-defined start/max, and this kernel only mutates the durable counter
 * with deterministic clamping and ownership. Replay-safe because it writes
 * the recorded `ruleState`/`ruleStateOwners` fields the event already owns.
 */

/** Read the current power-die value, defaulting to `start` when unset. */
export function readPowerDie(actor: EncounterActor, key: string, start: number): number {
  return Number(actor.ruleState[key] ?? start);
}

/** Tick the power-die up by 1, clamped to `max`, recording the owner. Returns
 * the new value. `start` is the value used when the die has not been set yet
 * (its initial value on first tick). */
export function tickPowerDie(actor: EncounterActor, key: string, start: number, max: number): number {
  const next = Math.min(max, Number(actor.ruleState[key] ?? start) + 1);
  actor.ruleState[key] = next;
  actor.ruleStateOwners[key] = actor.id;
  return next;
}

/** Set the power-die to an exact value (empower / start override), recording
 * the owner. Returns the value actually set (clamped to `max`). */
export function setPowerDie(actor: EncounterActor, key: string, value: number, max: number): number {
  const next = Math.max(0, Math.min(max, value));
  actor.ruleState[key] = next;
  actor.ruleStateOwners[key] = actor.id;
  return next;
}
