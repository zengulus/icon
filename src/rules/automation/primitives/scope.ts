/**
 * scope.ts — U8 SCOPE / CLOCK vocabulary: ONE shared vocabulary for
 * temporal/usage boundaries.
 *
 * ICON durations ride turns/rounds/combat (p.94 statuses, p.95 terrain/
 * entity effects, p.107 end-of-combat cleanup); usage gates are
 * once-per-turn/round/combat (p.99, p.105 Vigilance, p.129 Special); Delay
 * resolves at the start of the slow turn before ordinary activity (p.87,
 * p.95 "your next turn must be a slow turn"; scheduler `delayed` phase);
 * end-of-turn statuses/saves occur at the END of that character's OWN turn;
 * start/end round and start/end combat are mechanically distinct boundaries;
 * camp/expedition reset boundaries exist (p.56, p.113). Before this module
 * every reader re-keyed "round" separately: `RuleDuration`, `ledger:round:*`,
 * lifecycle phases, and `RuleTiming` each carried their own notion. This
 * module defines the ONE Clock concept and a typed Scope over it.
 *
 * Temporal fidelity (corrective pass 2026-08-30):
 *
 *  - Boundaries carry an EDGE (`start`/`end`) — turn-start ≠ turn-end,
 *    round-start ≠ round-end, combat-start ≠ combat-end are NEVER collapsed.
 *  - Boundaries can carry a SUBJECT (a U1 `Reference`) when the source makes
 *    the boundary actor-relative: "end of YOUR turn", "end of TARGET's turn",
 *    "the start of ITS next slow turn". `slow-turn` is its own boundary span,
 *    representationally distinct from an ordinary `turn`.
 *  - COUNTED forms (`n-boundary`, `for-n`) and `next`/`until-next` are RELATIVE
 *    to a recorded EPOCH: they measure occurrences of a matching boundary
 *    since the scope was established — NEVER absolute round numbers. An effect
 *    created on round 5 "for 3 rounds" completes only after three matching
 *    round boundaries from its recorded origin, not because `5 >= 3`.
 *  - `boundaryReached`/`scopeSatisfied` require an observed boundary record
 *    (the boundary that actually transitioned + per-boundary occurrence
 *    counters). Unsupported reads (a relative count with no recorded epoch,
 *    turn-level questions with no turn observation) FAIL CLOSED — the helper
 *    is not kept total by inventing answers.
 *  - `permanent` is a scope with no expiration; it is never "reached".
 *  - Non-boundary step timings ('use', attack-*, …) are NOT boundaries:
 *    `currentClock(context)` returns null for them; a command executing at
 *    `use` is never reported "at the round boundary".
 *
 * The `RuleDuration` union in `primitives/types.ts` is the legacy surface;
 * T1 adds this Clock vocabulary and the boundary-read mapping WITHOUT
 * rewriting the union (behavior-preserving). The full migration of
 * `RuleDuration`/`use-ledger`/lifecycle readers onto the Clock is the U8
 * completion work, not T1.
 *
 * Foundation: no source IDs, no kernel imports. Depends on U1 `Reference` for
 * actor-relative boundaries (never a parallel actor-ID vocabulary).
 */
import type { Reference } from './reference.js';
import { liveActorSlot, referenceKey } from './reference.js';
import type { RuleDuration, RuleExecutionContext, RuleSelector, RuleTiming } from './types.js';

/** The time-spanning boundary kinds the Clock can name. `slow-turn` is
 * representationally distinct from `turn` (Delay resolves at the start of the
 * character's next SLOW turn, p.87/p.95). */
export type BoundarySpan =
  | 'action'
  | 'resolution'
  | 'turn'
  | 'slow-turn'
  | 'between-turns'
  | 'round'
  | 'combat'
  | 'expedition'
  | 'camp'
  | 'interlude';

/** The EDGE / phase of a time-spanning boundary. Start and end are NEVER
 * collapsed. */
export type BoundaryEdge = 'start' | 'end';

/** A concrete boundary point on the shared Clock. Event boundaries (named
 * source-defined lifecycle events) are first-class here too. A boundary can
 * carry an actor-relative `subject` (a U1 Reference) when the source makes it
 * turn-of-a-particular-actor — otherwise the boundary is generic. */
export type BoundaryRef =
  | { kind: 'boundary'; boundary: BoundarySpan; edge: BoundaryEdge; subject?: Reference<'actor'> }
  | { kind: 'event'; event: string };

/** A canonical key for a boundary (span + edge + subject). Occurrence counters
 * in a `ClockObservation` are keyed by this, so subject-relative counting
 * (e.g. "end of YOUR turn" counts only that subject's turn-end) is exact. */
export function boundaryKey(ref: BoundaryRef): string {
  switch (ref.kind) {
    case 'event': return `event:${ref.event}`;
    case 'boundary':
      return `boundary:${ref.boundary}:${ref.edge}${ref.subject ? `:${referenceKey(ref.subject)}` : ''}`;
  }
}

/** Structural boundary equality (canonical-key compare, deterministic). */
export function boundaryEquals(a: BoundaryRef, b: BoundaryRef): boolean {
  return boundaryKey(a) === boundaryKey(b);
}

/** One point on the shared Clock: the next/ounted boundary a scope waits for.
 * `n-boundary` and `next` are RELATIVE to the epoch recorded at establishment
 * (`boundaryReached` treats them via that epoch; with no epoch they fail
 * closed). */
export type Clock =
  | { kind: 'boundary'; boundary: BoundaryRef }
  /** N occurrences of a matching boundary, counted RELATIVE to the scope's
   * established epoch. `n` is a relative count, never an absolute round number. */
  | { kind: 'n-boundary'; boundary: BoundaryRef; n: number }
  /** The next matching boundary after the scope's established epoch. */
  | { kind: 'next'; boundary: BoundaryRef };

/** The durable identity of ONE source-defined lifecycle INSTANCE: "the current
 * occurrence of this source's lifecycle owned by this actor". Composed of U1
 * REFERENCE semantics (the `owner` who the lifecycle belongs to and the
 * `source` that defines it) plus a durable `instance` DISCRIMINATOR that
 * advances every time the lifecycle is re-established (a new song).
 *
 * This is the generic answer to "how is the current instance of a
 * source-defined lifecycle owned by this source/actor represented WITHOUT
 * hiding semantic identity inside magic strings":
 *
 *  - the OWNER is a U1 `Reference<'actor'>` (never a raw actor id) — two
 *    different owners of the same source lifecycle are different identities;
 *  - the SOURCE is a U1 `Reference<'rule-source'>` naming the source-defined
 *    lifecycle (Monogatari's song), opaque and never parsed;
 *  - the INSTANCE discriminator is durable observed state, minted at
 *    establishment and ADVANCED on every re-establishment/replacement.
 *
 * Proof case (Monogatari, p.179): a song persists until Monogatari is used
 * again; a character may fulfill its condition once per that song; two
 * Chanters' songs never alias; replacing one Chanter's song never resets
 * another's usage state. All four hold because the identity is
 * (owner + source + instance): the group key excludes the instance (so two
 * Chanters are distinct) and each Chanter's current discriminator advances
 * only for that owner.
 */
export interface LifecycleIdentity {
  /** U1 OWNER Reference — whom this lifecycle instance belongs to (the
   * Chanter). Part of the identity: two owners never alias. */
  owner: Reference<'actor'>;
  /** U1 SOURCE Reference — the source-defined lifecycle name (the rule that
   * defines the song). Opaque and never parsed; identity only. */
  source: Reference<'rule-source'>;
  /** Durable instance DISCRIMINATOR, minted at establishment and advanced on
   * every re-establishment (a new song). The CURRENT value lives in the
   * durable `ClockObservation.lifecycles` map; this field is the recorded
   * instance a scope was created against. */
  instance: string;
}

/** The stable GROUP key of a lifecycle INSTANCE: "WHOSE song is this" —
 * `(owner, source)` WITHOUT the instance discriminator. Two owners and/or two
 * sources never collide (the owner is part of the key), and the group key is
 * what `ClockObservation.lifecycles` is indexed by: each (owner, source) has
 * exactly ONE current discriminator. */
export function lifecycleGroupKey(owner: Reference<'actor'>, source: Reference<'rule-source'>): string {
  return `lifecycle:${referenceKey(owner)}:${referenceKey(source)}`;
}

/** The FULL identity key of one lifecycle instance: group key + discriminator.
 * Canonical form for deterministic equality / serialization. */
export function lifecycleIdentityKey(identity: LifecycleIdentity): string {
  return `${lifecycleGroupKey(identity.owner, identity.source)}:${identity.instance}`;
}

/** Structural identity equality — the same (owner, source, instance). */
export function sameLifecycleInstance(a: LifecycleIdentity, b: LifecycleIdentity): boolean {
  return lifecycleIdentityKey(a) === lifecycleIdentityKey(b);
}

/** The CURRENT instance discriminator of a (owner, source) lifecycle observed
 * at `now`, or undefined when the lifecycle is not currently active (never
 * established, or its owner's instance was removed). Reads the durable
 * `lifecycles` map keyed by group — never ambient state. */
export function currentLifecycleInstanceId(
  now: ClockObservation,
  owner: Reference<'actor'>,
  source: Reference<'rule-source'>,
): string | undefined {
  return now.lifecycles?.[lifecycleGroupKey(owner, source)];
}

/** Whether a recorded lifecycle instance is CURRENT at the observation: the
 * durable `lifecycles` map still names ITS discriminator for (owner, source).
 * An observation with no `lifecycles` map (or no entry for that group) returns
 * false — a lifecycle that is not observed as active cannot be confirmed
 * current. */
export function lifecycleInstanceCurrent(identity: LifecycleIdentity, now: ClockObservation): boolean {
  const current = currentLifecycleInstanceId(now, identity.owner, identity.source);
  return current !== undefined && current === identity.instance;
}

/** Whether a recorded lifecycle instance has been REPLACED at the observation:
 * the durable current discriminator for (owner, source) has ADVANCED past this
 * recorded one, or the lifecycle is no longer active. Replacing owner A's song
 * advances A's entry only — owner B's entry is untouched.
 *
 * FAIL CLOSED on an observation that records NO lifecycles at all (the caller
 * never supplied a lifecycle observation): absence of data is NOT evidence of
 * replacement, so it returns false rather than approximating from the boundary
 * counts. A PRESENT map whose (owner, source) entry is missing or advanced IS a
 * definite read — that lifecycle is not currently active, so the recorded
 * instance is replaced. */
export function lifecycleReplaced(identity: LifecycleIdentity, now: ClockObservation): boolean {
  if (now.lifecycles === undefined) return false; // no lifecycle observation → unknown, fail closed
  const current = now.lifecycles[lifecycleGroupKey(identity.owner, identity.source)];
  return current === undefined || current !== identity.instance;
}

/** A temporal/usage extent over the Clock. */
export type Scope =
  | { kind: 'until'; clock: Clock }
  /** Exactly N occurrences of the matching boundary, relative to the scope's
   * established epoch. */
  | { kind: 'for-n'; boundary: BoundaryRef; n: number }
  /** Until the next matching boundary after the established epoch. */
  | { kind: 'until-next'; boundary: BoundaryRef }
  /** Permanent — a scope with NO expiration. Never satisfied ("reached"). */
  | { kind: 'permanent' }
  /** Until a named lifecycle event. */
  | { kind: 'until-event'; event: string }
  /** Until this specific source-defined lifecycle INSTANCE is replaced by a new
   * occurrence of the SAME (owner, source) lifecycle — "until this rule is used
   * / refreshed again". The `instance` discriminator IS the epoch: the scope is
   * satisfied exactly when the observed current instance for that (owner, source)
   * advances past it or the lifecycle is no longer active. Generic proof case:
   * Monogatari's "once per song" — a song is this Scope, it persists until
   * Monogatari is used again (a new song mints a new discriminator), two
   * different Chanters' songs never alias (the owner is part of the group key),
   * and replacing one Chanter's song advances only that Chanter's instance.
   * An observation that never records lifecycles FAILS CLOSED (false), never
   * approximated from the boundary map. */
  | { kind: 'until-lifecycle-replaced'; lifecycle: LifecycleIdentity };

/** A durable observation of where the shared Clock is. `last` is the boundary
 * (or event) that most recently actually transitioned; `counts` are per-
 * boundary occurrence counters keyed by `boundaryKey(...)`, captured AT a
 * reference moment (scope establishment or the present). Relative satisfaction
 * compares two observations — never an absolute round number. `lifecycles`
 * (optional) records the CURRENT active source-defined lifecycle instances,
 * keyed by the stable `lifecycleGroupKey(owner, source)` (whose lifecycle) →
 * the CURRENT instance discriminator. It is the durable read the
 * `until-lifecycle-replaced` scope composes. */
export interface ClockObservation {
  last: BoundaryRef;
  counts: Readonly<Record<string, number>>;
  /** Currently ACTIVE source-defined lifecycle instances, keyed by
   * `lifecycleGroupKey(owner, source)` (WHOSE lifecycle — the owner is part of
   * the key, so two owners' instances never alias) → the CURRENT instance
   * discriminator. A `until-lifecycle-replaced` scope named with an older
   * discriminator is REPLACED exactly when this map advances or drops its key. */
  lifecycles?: Readonly<Record<string, string>>;
}

function occurrenceOf(obs: ClockObservation | undefined, key: string): number {
  return obs?.counts[key] ?? 0;
}

function boundaryOccurrence(obs: ClockObservation | undefined, ref: BoundaryRef): number {
  return occurrenceOf(obs, boundaryKey(ref));
}

/** The Clock boundary a RuleTiming names, if any. Boundary timings map to a
 * BoundaryRef carrying their EDGE (start/end are never collapsed). Step timings
 * ('use', 'passive', 'interrupt', attack-*, …) are NOT boundaries — they name a
 * moment INSIDE a resolution — so they map to null. Turn boundaries from a
 * bare timing token are generic (no subject is derivable from the token;
 * actor-relative turn boundaries are constructed with an explicit subject). */
export function clockForTiming(timing: RuleTiming): BoundaryRef | null {
  switch (timing) {
    case 'round-start': return { kind: 'boundary', boundary: 'round', edge: 'start' };
    case 'round-end': return { kind: 'boundary', boundary: 'round', edge: 'end' };
    case 'turn-start': return { kind: 'boundary', boundary: 'turn', edge: 'start' };
    case 'turn-end': return { kind: 'boundary', boundary: 'turn', edge: 'end' };
    case 'stance-refresh': return { kind: 'boundary', boundary: 'turn', edge: 'end' };
    case 'combat-start': return { kind: 'boundary', boundary: 'combat', edge: 'start' };
    case 'combat-end': return { kind: 'boundary', boundary: 'combat', edge: 'end' };
    case 'expedition-start': return { kind: 'boundary', boundary: 'expedition', edge: 'start' };
    case 'camp': return { kind: 'boundary', boundary: 'camp', edge: 'start' };
    case 'interlude': return { kind: 'boundary', boundary: 'interlude', edge: 'start' };
    case 'phase-change': return { kind: 'boundary', boundary: 'between-turns', edge: 'start' };
    default: return null;
  }
}

/** Whether a Clock point has been reached given the observed boundary record.
 *
 * Pure: a function of `now` (the current observation) and, for RELATIVE clocks
 * (`n-boundary` / `next`), `epoch` (the observation recorded when the scope was
 * established). A relative clock WITHOUT an epoch FAILS CLOSED (returns false):
 * without a recorded origin we cannot truthfully answer a relative count. Turn/
 * event/relative questions are answered from the observation — never invented
 * from `{ round }` alone. No RNG, no ambient state: replay derives the same
 * answer from the same durable record. */
export function boundaryReached(clock: Clock, now: ClockObservation, epoch?: ClockObservation): boolean {
  switch (clock.kind) {
    case 'boundary':
      return boundaryEquals(now.last, clock.boundary);
    case 'n-boundary': {
      if (epoch === undefined) return false; // no epoch → relative count unanswerable, fail closed
      const delta = boundaryOccurrence(now, clock.boundary) - boundaryOccurrence(epoch, clock.boundary);
      return delta >= clock.n;
    }
    case 'next': {
      if (epoch === undefined) return false;
      // The NEXT matching boundary must actually have transitioned since the
      // epoch (counted at least once) AND be the boundary now observed.
      if (!boundaryEquals(now.last, clock.boundary)) return false;
      const delta = boundaryOccurrence(now, clock.boundary) - boundaryOccurrence(epoch, clock.boundary);
      return delta >= 1;
    }
  }
}

/** Whether a Scope has been SATISFIED (its extent reached / expired) given the
 * observed boundary record. `permanent` is never satisfied — it is a scope with
 * no expiration, NOT an event that has already fired. Relative extents
 * (`for-n` / `until-next`) require the recorded `epoch` and fail closed without
 * it. Pure and replay-deterministic. */
export function scopeSatisfied(scope: Scope, now: ClockObservation, epoch?: ClockObservation): boolean {
  switch (scope.kind) {
    case 'permanent':
      return false; // never expires, never "reached"
    case 'until-event':
      return now.last.kind === 'event' && now.last.event === scope.event;
    case 'until':
      return boundaryReached(scope.clock, now, epoch);
    case 'for-n': {
      if (epoch === undefined) return false;
      const delta = boundaryOccurrence(now, scope.boundary) - boundaryOccurrence(epoch, scope.boundary);
      return delta >= scope.n;
    }
    case 'until-next': {
      if (epoch === undefined) return false;
      if (!boundaryEquals(now.last, scope.boundary)) return false;
      const delta = boundaryOccurrence(now, scope.boundary) - boundaryOccurrence(epoch, scope.boundary);
      return delta >= 1;
    }
    case 'until-lifecycle-replaced': {
      // RELATIVE scope whose epoch is the recorded instance discriminator: it
      // is satisfied exactly when the observed current instance for the same
      // (owner, source) has advanced past the recorded one (lifecycle
      // replaced) or the lifecycle is no longer active. NO epoch argument is
      // needed — the discriminator IS the epoch. An observation that records
      // no lifecycles fails closed (not satisfied). Deterministic.
      return lifecycleReplaced(scope.lifecycle, now);
    }
  }
}

/** The Clock boundary the context currently sits on, or null when the current
 * timing is NOT a boundary. Derived deterministically from the durable timing:
 * a command executing at `use` is NOT "at the round boundary" and returns null
 * — non-boundary execution never masquerades as a boundary. */
export function currentClock(context: RuleExecutionContext): BoundaryRef | null {
  return clockForTiming(context.timing);
}

const UNSUPPORTED_SUBJECT_SELECTOR = 'scopeForDuration: legacy rule selector cannot name a turn subject; migrate onto a U1 Reference';

/** Map a legacy RuleSelector turn subject onto a U1 actor Reference for an
 * actor-relative boundary. Only single-actor selectors are representable as a
 * turn subject; anything else fails closed (throws) rather than guessing. */
function selectorToSubjectReference(sel: RuleSelector): Reference<'actor'> {
  switch (sel.kind) {
    case 'self': return liveActorSlot('source');
    case 'attack-target': return liveActorSlot('attack-target');
    case 'trigger-source': return liveActorSlot('trigger-source');
    default: throw new Error(UNSUPPORTED_SUBJECT_SELECTOR);
  }
}

/** Map a legacy RuleDuration onto the Clock vocabulary. Behavior-neutral in
 * T1: nothing consumes this mapping yet; it is the prescribed boundary-read
 * surface for the future U8 migration.
 *
 * This mapping PRESERVES temporal semantics the legacy reader could not:
 * turn-start/turn-end durations keep their EDGE AND the actor/Reference they
 * carry (an "end of YOUR turn" duration and an "end of TARGET's turn" duration
 * are distinct Scopes), and counted forms are RELATIVE ('for-n'), so "3 rounds"
 * is N occurrences from the scope's epoch — never absolute round 3. The
 * relative epoch is NOT present in a legacy `RuleDuration`; consumers
 * establish it via `boundaryReached`/`scopeSatisfied`'s `epoch` argument at
 * migration time (unsupported without it → fail closed). */
export function scopeForDuration(duration: RuleDuration): Scope {
  switch (duration.kind) {
    case 'instant':
      return { kind: 'until', clock: { kind: 'boundary', boundary: { kind: 'boundary', boundary: 'resolution', edge: 'end' } } };
    case 'turn-end':
      return {
        kind: 'for-n',
        boundary: { kind: 'boundary', boundary: 'turn', edge: 'end', subject: selectorToSubjectReference(duration.actor) },
        n: duration.turns ?? 1,
      };
    case 'turn-start':
      return {
        kind: 'for-n',
        boundary: { kind: 'boundary', boundary: 'turn', edge: 'start', subject: selectorToSubjectReference(duration.actor) },
        n: duration.turns ?? 1,
      };
    case 'round-end':
      return { kind: 'for-n', boundary: { kind: 'boundary', boundary: 'round', edge: 'end' }, n: duration.rounds ?? 1 };
    case 'round-start':
      return { kind: 'for-n', boundary: { kind: 'boundary', boundary: 'round', edge: 'start' }, n: duration.rounds ?? 1 };
    case 'combat':
      return { kind: 'until-next', boundary: { kind: 'boundary', boundary: 'combat', edge: 'end' } };
    case 'expedition':
      return { kind: 'until-next', boundary: { kind: 'boundary', boundary: 'expedition', edge: 'end' } };
    case 'until':
      return { kind: 'until-event', event: duration.event };
  }
}