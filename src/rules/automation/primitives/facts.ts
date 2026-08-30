/**
 * facts.ts — U10 FACT / RESOLVED OUTCOME RECORDS: the generic typed history
 * of "what authoritative thing has already resolved" — DISTINCT from a
 * predicate (current state), from mutable encounter state, from the U16
 * usage-count ledger, and from the U13 decision windows.
 *
 * A Fact is a DURABLE/recordable statement about something that actually
 * resolved. Facts are recorded AT the authoritative resolution point and
 * consumed; replay consumes the recorded facts, never re-derives or
 * re-classifies them from later mutable state — the same event sequence
 * yields the same fact sequence. An outcome that a later trigger or
 * predicate needs to know happened is a fact, never a peek at live state.
 *
 * The vocabulary is a CLOSED, DISCRIMINATED FACT UNION over the generic
 * outcomes the engine needs: ability-used; attack-resolved (hit/miss/
 * critical/exceed); damage-applied (with source, owner, recipient and U9
 * provenance); actor-defeated; collide; movement; effect apply/remove
 * (condition/status/mark/stance/persistent with a LIVE instance identity);
 * entity/terrain create/remove; save-resolved. Each fact carries the SMALLEST
 * common envelope necessary for identity/provenance/time: a deterministic
 * `instanceId` (its own event identity), the causal `sourceId`, the
 * initiating `ownerId`, and optional U9 `provenance`. No giant untyped blob.
 *
 * BOUNDARIES (never collapsed):
 *   - encounter EVENTS are the transport/replay container (`RULE_MUTATIONS_APPLIED`);
 *   - U10 FACTS are the typed resolved-outcome history;
 *   - durable MUTABLE STATE is the live reduction the reducer owns;
 *   - U16 USAGE-LEDGER entries count entitlements (used-scope reads them);
 *   - U13 decision WINDOWS hold pending interrupts/saves.
 * `recordFacts` derives the fact history from already-resolved mutations at
 * the command boundary; the fact list rides the recorded event alongside the
 * existing `RuleResolutionFacts` projection.
 *
 * LIVE vs CAPTURED: the recorded FACT is the captured history of what
 * resolved; `effectExistsLive` is the LIVE read answering whether one of
 * those specific effect instances STILL exists on the current actor view. A
 * fact "remains historically true" even after live state changes — the fact
 * list never edits itself; only `effectExistsLive` reflects disappearance.
 *
 * Foundation: no source IDs (ids here are opaque provenance keys, never
 * interpreted), no kernel imports. Uses U1 reference identity (ids are the
 * reference-key forms) and U9 provenance (the cause recorded on a fact).
 */
import type { RuleActorView, RuleMutation } from './types.js';
import type { Provenance, RuleDelivery, RuleMovementMode } from './provenance.js';
import { provenanceOfMutation } from './provenance.js';

/** The live effect families an effect fact / `effect-still-exists` read can
 * name. Each maps to a distinct live surface on the actor view. */
export type EffectInstanceKind = 'condition' | 'status' | 'mark' | 'stance' | 'persistent';

/** The effect-fact operation vocabulary — the actual lifecycle operations a
 * persistent/mark/stance/condition instance undergoes. `apply` creates or
 * refreshes-in-place; `refresh` re-augments an EXISTING instance; `remove`
 * terminates a specific previously-applied instance; `enter`/`exit` are the
 * stance lifecycle. The critical invariant: the instance created as X is
 * later removable/refreshable as X — a removal NEVER mints a new identity.
 *
 * The instance created as X is later removable/refreshable as X because the
 * canonical LIVE instance id (`effectInstanceId`, decided once at the
 * command/event boundary) is carried on the apply/refresh/remove fact — a
 * removal names the ORIGINAL instance, never a freshly-minted one. Where the
 * reducer/domain chooses a replacement identity (e.g. a mark is replaced per
 * owner), that replacement is a NEW instance with its own recorded id, and
 * the owner-scoped natural key (`instanceKey`) stays the secondary
 * disambiguation surface. */
export type EffectOperation = 'apply' | 'refresh' | 'remove' | 'enter' | 'exit';

/** One recorded fact. Every member carries the common envelope — its own
 * deterministic event `instanceId`, the causal `sourceId`, the initiating
 * `ownerId`, and optional U9 `provenance`. */
export type Fact =
  | { kind: 'ability-used'; instanceId: string; sourceId: string; ownerId: string; actionId: string; provenance?: Provenance }
  | { kind: 'attack-resolved'; instanceId: string; sourceId: string; ownerId: string; targetId: string; hit: boolean; critical: boolean; exceed?: boolean; provenance?: Provenance }
  | { kind: 'damage-applied'; instanceId: string; sourceId: string; ownerId: string; recipientId: string; amount: number; delivery: RuleDelivery; provenance?: Provenance }
  | { kind: 'actor-defeated'; instanceId: string; sourceId: string; ownerId: string; defeatedId: string; provenance?: Provenance; /** TRUE only when the defeat is a SLAY (ICON p.95 glossary: THIS ability's
     damage reduced the character to 0 hp). Explicit instant-defeat mutations
     (`defeat`) are outcomes but are NOT Slays — the `slay` trigger gating
     ({@link deriveResolutionFactProjection}) resolves only on `viaSlay`.) */
    viaSlay?: boolean }
  | { kind: 'collide'; instanceId: string; sourceId: string; ownerId: string; shovedActorId: string; provenance?: Provenance }
  | { kind: 'movement'; instanceId: string; sourceId: string; ownerId: string; actorId: string; mode: RuleMovementMode; provenance?: Provenance }
  | { kind: 'effect'; instanceId: string; instanceKey: string; sourceId: string; ownerId: string; targetId: string; effectKind: EffectInstanceKind; effectId: string; operation: EffectOperation; /** The canonical LIVE encounter instance id this fact's operation created /
     removed — the EXACT id the reducer creates on its live surface
     (EncounterActiveEffect.id / EncounterMark.id / EncounterStance.id), decided
     once at the command/event boundary and consumed by the reducer. A removal
     fact naming an instance removes THAT instance only; a later
     `effect-still-exists` read with this id answers about THAT SAME instance.
     Absent for single-instance kinds without a durable per-instance id
     (condition/status) and for legacy removals the boundary could not resolve
     to one specific instance. */
    effectInstanceId?: string; provenance?: Provenance }
  | { kind: 'entity'; instanceId: string; sourceId: string; ownerId: string; entityType: string; operation: 'create' | 'remove' | 'summon' | 'update'; provenance?: Provenance }
  | { kind: 'terrain'; instanceId: string; sourceId: string; ownerId: string; terrain: string; operation: 'create' | 'remove' | 'raise' | 'lower'; provenance?: Provenance }
  | { kind: 'save-resolved'; instanceId: string; sourceId: string; ownerId: string; actorId: string; success: boolean; provenance?: Provenance }
  | { kind: 'trigger-resolved'; instanceId: string; sourceId: string; ownerId: string; trigger: string; targetId?: string; provenance?: Provenance };

/**
 * The single deterministic event identity of one fact — a pure function of
 * the RESOLUTION identity (the replay-stable, globally-unique-per-resolution
 * id owned by the command/event boundary) + the local fact kind + the fact's
 * index within that resolution. Two separate uses of the same ability MUST
 * differ (different `resolutionId`); replaying the same recorded resolution
 * reproduces the SAME ids (same `resolutionId`, same index). It is NEVER
 * inferred from later mutable state or array construction order.
 *
 * INJECTIVITY CONTRACT: the kernel assembler
 * (`kernels/resolution-triggers.ts::renumberFactIds`) assigns every fact of
 * one resolution its FINAL index from a single ordered global sequence, so
 * two distinct facts within a resolution can never share an `instanceId` — an
 * explicit `actor-defeated` mutation fact and a Slay-derived
 * `actor-defeated` fact included. The intermediate per-source indices used
 * while assembling (mutation position, collide/slay offset) are superseded by
 * that final allocation before the event records the fact list.
 */
export function factInstanceId(resolutionId: string, kind: Fact['kind'], index: number): string {
  return `fact:${resolutionId}:${kind}:${index}`;
}

/** The LIVE effect-instance identity: WHICH specific effect instance on a
 * target the `effect-still-exists` question is about. The caller names a
 * specific instance by `instanceId` — the authoritative DURABLE id the
 * encounter owns (EncounterActiveEffect.id / EncounterMark.id /
 * EncounterStance.id), carried through `RuleActorView` — so a recorded U10
 * fact referring to that instance can later ask whether THAT SAME instance
 * exists. `ownerId` is honored for owner-sensitive kinds (marks), so owner A's
 * mark never satisfies owner B's mark. `anyInstance` asks only for presence
 * (coexisting instances are fine). */
export interface EffectInstanceIdentity {
  kind: EffectInstanceKind;
  sourceId: string;
  targetId: string;
  effectId: string;
  ownerId?: string;
  /** The authoritative durable encounter instance id (a U10 fact's
   * `instanceId` / the reducer's `EncounterActiveEffect.id`). When supplied,
   * the read answers whether THAT EXACT instance still exists. */
  instanceId?: string;
  /** Owner-sensitive kinds: when true (and `ownerId` present), only marks from
   * that owner satisfy the read. */
  ownerSensitive?: boolean;
  /** When true, the caller only needs "at least one exists" (any-instance
   * presence), not a specific instance. Coexisting instances are fine. */
  anyInstance?: boolean;
}

/** The canonical, UNAMBIGUOUS instance key for an effect fact — the durable
 * identity a recorded effect fact carries and a live read can be matched
 * against. Ids are opaque strings, so a plain `inst:` delimiter-concatenated
 * key would not be injective (source `a:b`/target `c` would collide with
 * source `a`/target `b:c`); the canonical form length-prefixes each id field
 * (`len:id`), which is unambiguous over any opaque id. Coexist-capable kinds
 * (mark/persistent) embed an explicit discriminator so two
 * same-source-and-kind instances never share a key; single-instance kinds
 * (condition/status/stance) do not need one. */
export function effectInstanceKey(
  kind: EffectInstanceKind,
  sourceId: string,
  targetId: string,
  effectId: string,
  discriminator?: string,
): string {
  const enc = (value: string): string => `${value.length}:${value}`;
  const base = `inst:${kind}:${enc(sourceId)}${enc(targetId)}${enc(effectId)}`;
  const coexistCapable = kind === 'persistent' || kind === 'mark';
  if (discriminator !== undefined && (coexistCapable || discriminator !== base)) {
    return `${base}:#${enc(discriminator)}`;
  }
  return base;
}

/**
 * Record the fact history produced by a set of ALREADY-RESOLVED mutations at
 * the command/window boundary. Pure — a deterministic function of the
 * mutation list and the resolution options (the initiating owner + action),
 * NEVER a read of current live state. Domain outcomes that need an encounter
 * dry-run (collide, slay — spatial/defeat authority) are merged by the
 * kernel layer, not here (primitives never compute spatial/defeat).
 *
 * Each fact gets a deterministic `instanceId` from its position in the
 * recorded mutation list, and a `provenance` derived from the mutation's own
 * fields (U9) — the initiating `sourceActorId`/`ownerId` is preserved as the
 * causal origin. Coexist-capable effect facts (persistent/mark) get a
 * distinct instance key per application via the deterministic index.
 */
export interface RecordFactsOptions {
  ownerId?: string;
  actionId?: string;
  resolutionId?: string;
  /** The RESOLVED (post-mitigation) damage amount per mutation index, when a
   * domain damage authority has determined it. When provided it is the
   * AUTHORITATIVE determination map: `damage-applied` facts record exactly its
   * per-index amount, a 0 records NO fact, and a damage mutation with NO entry
   * records NO fact either (it no-op'd — the target was defeated/immunized by
   * an earlier mutation in the same event). Never the raw proposed
   * `mutation.amount`. Absent for primitive-level convenience (no state) — the
   * recorded amount then equals `mutation.amount` so pure-mutation tests read
   * honestly. */
  resolvedDamage?: ReadonlyMap<number, number>;
}

export function recordFacts(
  mutations: readonly RuleMutation[],
  options: RecordFactsOptions = {},
): Fact[] {
  // A resolution identity is REQUIRED for durable, globally-unique fact ids.
  // Primitive-level convenience (tests): when the caller supplies none, fall
  // back to the first mutation's own sourceId so the recorded fact is still a
  // deterministic pure function of the mutation list. The command/event
  // boundary ALWAYS passes the real resolution identity.
  const resolutionId = options.resolutionId ?? mutations[0]?.sourceId ?? '';
  const facts: Fact[] = [];
  let index = 0;
  const ownerId = options.ownerId;
  for (const mutation of mutations) {
    const kind = mutation.kind;
    if (kind === 'attack') {
      facts.push({
        kind: 'attack-resolved',
        instanceId: factInstanceId(resolutionId, 'attack-resolved', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.actorId,
        targetId: mutation.targetId,
        hit: mutation.hit,
        critical: mutation.critical,
        ...(mutation.exceed === true ? { exceed: true } : {}),
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'damage') {
      // The RESOLVED amount is the damage authority's determined (post-
      // mitigation) result — never a raw proposed amount mislabeled as
      // applied. When the determination map is provided it is AUTHORITATIVE:
      // a 0 (fully prevented) or an ABSENT entry (the mutation no-op'd — the
      // target was already defeated/immunized by an earlier mutation in this
      // event) emits NO damage-applied fact, so U10 never claims a false
      // application. Without the map (primitive convenience) the raw amount
      // is recorded honestly.
      const damageMap = options.resolvedDamage;
      const mapProvided = damageMap !== undefined;
      const resolved = mapProvided ? (damageMap.get(index) ?? 0) : mutation.amount;
      if (resolved > 0) {
        facts.push({
          kind: 'damage-applied',
          instanceId: factInstanceId(resolutionId, 'damage-applied', index),
          sourceId: mutation.sourceId,
          ownerId: ownerId ?? mutation.sourceActorId,
          recipientId: mutation.actorId,
          amount: resolved,
          delivery: mutation.delivery,
          provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
        });
      }
    } else if (kind === 'condition') {
      facts.push(effectFact(resolutionId, mutation.sourceId, mutation.sourceActorId, mutation.actorId, 'condition', mutation.conditionId, mutation.operation === 'apply' ? 'apply' : 'remove', index, ownerId, options.actionId));
    } else if (kind === 'stance') {
      facts.push(effectFact(resolutionId, mutation.sourceId, mutation.sourceActorId, mutation.actorId, 'stance', mutation.stanceId, mutation.operation === 'enter' ? 'enter' : mutation.operation === 'exit' ? 'exit' : 'apply', index, ownerId, options.actionId, mutation.instanceId));
    } else if (kind === 'mark') {
      facts.push(effectFact(resolutionId, mutation.sourceId, mutation.ownerId, mutation.actorId, 'mark', mutation.markId, mutation.operation, index, ownerId, options.actionId, mutation.instanceId));
    } else if (kind === 'persistent') {
      facts.push(effectFact(resolutionId, mutation.sourceId, mutation.ownerId, mutation.actorId, 'persistent', mutation.effectId, mutation.operation === 'remove' ? 'remove' : 'apply', index, ownerId, options.actionId, mutation.instanceId));
    } else if (kind === 'move') {
      facts.push({
        kind: 'movement',
        instanceId: factInstanceId(resolutionId, 'movement', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.sourceActorId,
        actorId: mutation.actorId,
        mode: mutation.movement,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'entity') {
      facts.push({
        kind: 'entity',
        instanceId: factInstanceId(resolutionId, 'entity', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.ownerId,
        entityType: mutation.entityType,
        operation: mutation.operation,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'terrain') {
      facts.push({
        kind: 'terrain',
        instanceId: factInstanceId(resolutionId, 'terrain', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.sourceActorId,
        terrain: mutation.terrain,
        operation: mutation.operation,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'save') {
      facts.push({
        kind: 'save-resolved',
        instanceId: factInstanceId(resolutionId, 'save-resolved', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.actorId,
        actorId: mutation.actorId,
        success: mutation.success,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'defeat') {
      facts.push({
        kind: 'actor-defeated',
        instanceId: factInstanceId(resolutionId, 'actor-defeated', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.actorId,
        defeatedId: mutation.actorId,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    }
    index += 1;
  }
  return facts;
}

function effectFact(
  resolutionId: string,
  sourceId: string,
  mutationOwner: string | undefined,
  targetId: string,
  effectKind: EffectInstanceKind,
  effectId: string,
  operation: EffectOperation,
  index: number,
  ownerId: string | undefined,
  actionId: string | undefined,
  liveInstanceId?: string,
): Fact {
  const residentOwner = ownerId ?? mutationOwner ?? targetId;
  // Instance-config identity: for coexist-capable kinds (persistent/mark) the
  // stable discriminator is the owner + the declared effect/mark id family,
  // NOT the arbitrary mutation index — the same instance created at index 0
  // and removed/became-X is named by the SAME natural key, and two different
  // owners' same-mark never alias. Single-instance kinds (condition/stance)
  // need no discriminator. `instanceId` is the resolution-unique event id
  // (the FACT's own id); `effectInstanceId` is the canonical LIVE encounter
  // instance id the reducer creates/removes (the mutation's command-boundary
  // stamp), so a recorded fact can say exactly WHICH live instance it
  // created/removed.
  const instanceKey = effectInstanceKey(effectKind, sourceId, targetId, effectId, residentOwner === undefined ? undefined : `${residentOwner}`);
  return {
    kind: 'effect',
    instanceId: factInstanceId(resolutionId, 'effect', index),
    instanceKey,
    ...(liveInstanceId !== undefined ? { effectInstanceId: liveInstanceId } : {}),
    sourceId,
    ownerId: residentOwner,
    targetId,
    effectKind,
    effectId,
    operation,
    provenance: {
      sourceId,
      ...(residentOwner !== undefined ? { ownerId: residentOwner } : {}),
      ...(actionId !== undefined ? { actionId } : {}),
      ...(mutationOwner !== undefined && mutationOwner !== residentOwner ? { sourceActorId: mutationOwner } : {}),
      delivery: 'effect',
    },
  };
}

/** The REACTIVE outcome projection from a fact history — the same
 * triggers-set / attack-targets / collide / slay the engine's reactive fold
 * already consumed, now PROJECTED from the typed fact history (the kernel
 * merges the collide/slay facts from the encounter dry-run first). This is
 * the behavior-preserving bridge: resolution-triggers.ts records facts via
 * `recordFacts`, merges domain collide/slay facts, then projects exactly the
 * `ResolutionTriggerFacts` surface encounter.ts consumes. */
export function deriveResolutionFactProjection(facts: readonly Fact[]): {
  triggers: Set<string>;
  attackTargets: string[];
  collidedActorIds: string[];
  slainActorIds: string[];
} {
  const triggers = new Set<string>();
  const attackTargets: string[] = [];
  const collidedActorIds: string[] = [];
  const slainActorIds: string[] = [];
  for (const fact of facts) {
    switch (fact.kind) {
      case 'attack-resolved':
        attackTargets.push(fact.targetId);
        triggers.add(fact.hit ? 'hit' : 'miss');
        if (fact.critical) triggers.add('critical-hit');
        if (fact.exceed === true) triggers.add('exceed');
        break;
      case 'collide':
        collidedActorIds.push(fact.shovedActorId);
        triggers.add('collide');
        break;
      case 'actor-defeated':
        // Only a SLAY (this ability's damage reduced the character to 0, p.95
        // glossary) opens the `slay` trigger — an explicit instant-defeat
        // outcome is not a Slay. Preserves the long-standing reactive fold.
        if (fact.viaSlay === true) {
          slainActorIds.push(fact.defeatedId);
          triggers.add('slay');
        }
        break;
      default:
        break;
    }
  }
  return { triggers, attackTargets, collidedActorIds, slainActorIds };
}

/** The result of the LIVE `effect-still-exists` read. `ok: true` is an exact
 * boolean; `ok: false` is the FAIL-CLOSED outcome — the requested instance
 * identity cannot be faithfully represented on the projected view (a specific
 * coexisting same-source-and-kind instance, without `anyInstance`), so NO
 * answer is guessed. The primitive returns this discriminated result (it
 * never throws); the kernel-level predicate evaluator surfaces an
 * unrepresentable read as a RuleProgramViolation (fail closed).
 */
export type EffectExistsResult =
  | { ok: true; exists: boolean }
  | { ok: false; problem: 'effect-instance-unrepresentable' };

/**
 * The LIVE `effect-still-exists` read: does the SPECIFIC live effect instance
 * still exist on the actor view? Reads the actor view's live effect surfaces
 * (conditions, statuses, marks, stance, active-effects) — never re-derives
 * history. FAILS CLOSED (`{ ok: false }`) when the requested instance
 * identity cannot be represented on the projected view — e.g. a SPECIFIC
 * coexisting mark/persistent instance when only `{effectId, sourceId}`/
 * `{markId, ownerId}` is projected and no `anyInstance` presence was asked
 * for — rather than guessing which instance is meant.
 */
export function effectExistsLive(view: RuleActorView, identity: EffectInstanceIdentity): EffectExistsResult {
  switch (identity.kind) {
    case 'condition':
      return { ok: true, exists: view.conditions.has(identity.effectId) };
    case 'status':
      return { ok: true, exists: view.statuses.some((status) => status.id === identity.effectId) };
    case 'stance':
      // A specific-instance stance read: match the durable instance id when
      // supplied, else compare the stanceId.
      if (identity.instanceId !== undefined) {
        return { ok: true, exists: view.stance?.id === identity.instanceId };
      }
      return { ok: true, exists: view.stance?.stanceId === identity.effectId };
    case 'mark': {
      const byEffect = view.marks.filter((mark) => mark.markId === identity.effectId);
      if (identity.instanceId !== undefined) {
        // Exact: does THIS durable instance still exist?
        return { ok: true, exists: byEffect.some((mark) => mark.id === identity.instanceId) };
      }
      if (identity.anyInstance) return { ok: true, exists: byEffect.length > 0 };
      // Owner-sensitive: honor the owner dimension — owner A's mark must not
      // satisfy owner B's identical markId.
      if (identity.ownerSensitive && identity.ownerId !== undefined) {
        return { ok: true, exists: byEffect.some((mark) => mark.ownerId === identity.ownerId) };
      }
      return { ok: true, exists: byEffect.length > 0 };
    }
    case 'persistent': {
      const byEffect = (view.activeEffects ?? []).filter((effect) => effect.effectId === identity.effectId && effect.sourceId === identity.sourceId);
      if (identity.instanceId !== undefined) {
        // Exact: does THIS durable instance still exist? Two same-source
        // coexisting instances never alias — each has its own durable id.
        return { ok: true, exists: byEffect.some((effect) => effect.id === identity.instanceId) };
      }
      if (identity.anyInstance) return { ok: true, exists: byEffect.length > 0 };
      // No exact id: if more than one such instance exists and the caller did
      // not ask any-instance presence, we cannot say WHICH → fail closed.
      if (byEffect.length > 1) return { ok: false, problem: 'effect-instance-unrepresentable' };
      return { ok: true, exists: byEffect.length > 0 };
    }
  }
}

// ── U16 fact-backed de-duplication identity ────────────────────────────────
/**
 * The full de-dup identity T4 completes for U16 — built around ICON's
 * triggered-effect rule (p.107): a triggered effect can trigger ONCE per
 * ability/action resolution. The DEFAULT identity is RESOLUTION-scoped:
 *
 *   { resolutionId, sourceId, ownerId, scope, trigger (the triggering step),
 *     targetId? (ONLY when the source explicitly declares once-per-target) }
 *
 * This is deliberately NOT per-fact. U10 facts answer WHY an effect became
 * eligible (three Collide facts establish that Collide occurred); they do NOT
 * imply one execution per qualifying fact. Within ONE resolution:
 *   - multiple Collide facts → ONE Collide triggered step;
 *   - the same triggered step reachable through overlapping routes → ONCE;
 * Across TWO separate resolutions (two uses of the ability): each may trigger
 * independently (different `resolutionId`).
 *
 * Per-target de-duplication is NOT automatic — it is keyed in ONLY when a
 * source rule genuinely declares once-per-target triggering (the caller sets
 * `targetId` and `oncePerTarget`). Different routing facts for the same step
 * never mint separate identities by default.
 *
 * It never uses sourceId alone, array position, current mutable state, or a
 * broad once-per-scope ledger mark as trigger-event de-duplication. Ordinary
 * entitlement COUNTS stay in the U16 ledger (`used-scope`); THIS read answers
 * "has this logical trigger step already resolved within this resolution?"
 */
export interface ResolveIdentity {
  sourceId: string;
  ownerId: string;
  scope: 'turn' | 'round' | 'combat';
  /** The durable, replay-stable RESOLUTION identity (owned by the command/
   * event boundary). Two uses of an ability differ here; one use never
   * splits here, so per-fact routing stays ONCE per resolution. */
  resolutionId: string;
  targetId?: string;
  /** The logical trigger/step name (hit, critical-hit, collide, slay, …).
   * Different triggered STEPS responding to the same fact stay distinct.
   * Absent for a plain use entitlement. */
  trigger?: string;
  /** When true, the identity also keys the specific event id — the ONLY
   * source of per-event re-triggering, used when a source explicitly
   * distinguishes trigger instances. Absent (false) for once-per-ability. */
  perEvent?: boolean;
  /** The event/fact dimension, populated only when `perEvent` is true. */
  eventDimension?: string;
}

/** Canonical, UNAMBIGUOUS serialization of a resolve identity (a JSON tuple
 * over the seven dimensions incl. resolution + trigger + target).
 * Collision-safe over opaque ids — same delimiter lesson as
 * `usageIdentityKey`. This is the durable event-de-dup key (U16 completion):
 * the exact `instanceId` a `trigger-resolved` marker is recorded under. */
export function resolveIdentityKey(identity: ResolveIdentity): string {
  return JSON.stringify([
    identity.sourceId,
    identity.ownerId,
    identity.scope,
    identity.resolutionId,
    identity.targetId ?? null,
    identity.trigger ?? null,
    identity.perEvent === true ? (identity.eventDimension ?? null) : null,
  ]);
}

/** Boolean structural equality of two resolve identities. */
export function resolveIdentitiesEqual(first: ResolveIdentity, second: ResolveIdentity): boolean {
  return first.sourceId === second.sourceId
    && first.ownerId === second.ownerId
    && first.scope === second.scope
    && first.resolutionId === second.resolutionId
    && (first.targetId ?? null) === (second.targetId ?? null)
    && (first.trigger ?? null) === (second.trigger ?? null)
    && first.perEvent === second.perEvent
    && (first.perEvent === true ? (first.eventDimension ?? null) === (second.eventDimension ?? null) : true);
}

/** Build the DEFAULT (once-per-ability) resolve identity for a triggering
 * step within a resolution: source + owner + resolution + trigger step. NO
 * per-event/fact dimension, so multiple routing facts for the same step
 * resolve ONCE. Set `targetId` (with `oncePerTarget: true`) only where the
 * source declares once-per-target; set `perEvent: true` + `eventDimension`
 * only where the source genuinely distinguishes trigger instances. */
export function resolveIdentityForTrigger(
  sourceId: string,
  ownerId: string,
  scope: 'turn' | 'round' | 'combat',
  resolutionId: string,
  trigger?: string,
  options: { targetId?: string; perEvent?: boolean; eventDimension?: string; oncePerTarget?: boolean; fact?: Fact } = {},
): ResolveIdentity {
  const targetId = options.oncePerTarget === true
    ? (options.targetId ?? (options.fact !== undefined ? factTargetId(options.fact) : undefined))
    : undefined;
  return {
    sourceId,
    ownerId,
    scope,
    resolutionId,
    ...(trigger !== undefined ? { trigger } : {}),
    ...(targetId !== undefined ? { targetId } : {}),
    ...(options.perEvent === true ? { perEvent: true, eventDimension: options.eventDimension } : {}),
  };
}

/** Build a resolve identity for a specific recorded outcome FACT as the
 * triggering basis. The DEFAULT is once-per-resolution (the fact only partly
 * supplies source/owner/target); pass `perEvent: true` to key the specific
 * fact's event id when the source distinguishes trigger instances. */
export function resolveIdentityForFact(
  fact: Fact,
  scope: 'turn' | 'round' | 'combat',
  trigger?: string,
  options: { resolutionId?: string; perEvent?: boolean; oncePerTarget?: boolean; targetId?: string } = {},
): ResolveIdentity {
  return resolveIdentityForTrigger(
    fact.sourceId,
    fact.ownerId,
    scope,
    options.resolutionId ?? (fact.kind === 'trigger-resolved' ? fact.instanceId : ''),
    trigger,
    {
      ...(options.oncePerTarget === true ? { oncePerTarget: true, targetId: options.targetId, fact } : {}),
      ...(options.perEvent === true ? { perEvent: true, eventDimension: fact.instanceId } : {}),
    },
  );
}

/** The target/recipient id a fact names, when it has one (the per-target
 * de-dup dimension). */
export function factTargetId(fact: Fact): string | undefined {
  switch (fact.kind) {
    case 'attack-resolved': return fact.targetId;
    case 'damage-applied': return fact.recipientId;
    case 'actor-defeated': return fact.defeatedId;
    case 'collide': return fact.shovedActorId;
    case 'movement': return fact.actorId;
    case 'effect': return fact.targetId;
    case 'save-resolved': return fact.actorId;
    case 'trigger-resolved': return fact.targetId;
    default: return undefined;
  }
}

/** Record the trigger-resolved marker (U16 completion): the durable fact that
 * 'the logical use has resolved for the given underlying event'. Its
 * `instanceId` is the canonical resolve identity key — collision-safe and
 * deterministic — so `hasResolvedAsFact` is an exact, replay-reproducible
 * read. A NEW triggering event (a different fact) yields a different key, so
 * repeated legitimate triggers from different underlying events each resolve. */
export function triggerResolvedFact(
  identity: ResolveIdentity,
  options: { provenance?: Provenance } = {},
): Extract<Fact, { kind: 'trigger-resolved' }> {
  return {
    kind: 'trigger-resolved',
    instanceId: resolveIdentityKey(identity),
    sourceId: identity.sourceId,
    ownerId: identity.ownerId,
    trigger: identity.trigger ?? 'use',
    ...(identity.targetId !== undefined ? { targetId: identity.targetId } : {}),
    ...(options.provenance !== undefined ? { provenance: options.provenance } : {}),
  };
}

/** Has THIS exact logical use ALREADY been resolved for the given underlying
 * fact/event? Reads the recorded FACT history (`facts` — the durable,
 * already-resolved records of the resolution scope, NEVER current mutable
 * state): true when a `trigger-resolved` marker with the same resolve
 * identity (source + owner + scope + target + trigger + fact dimension) is
 * already recorded. Two routes to the SAME fact → same identity → resolves
 * once. Two SEPARATE facts → different identities → each resolves. Ordinary
 * entitlement COUNTS stay in the U16 ledger (`used-scope`); this is event
 * de-duplication, semantically distinct. Missing/ambiguous → false (the
 * engine never fabricates a resolution). */
export function hasResolvedAsFact(identity: ResolveIdentity, facts: readonly Fact[]): boolean {
  const key = resolveIdentityKey(identity);
  return facts.some((fact) => fact.kind === 'trigger-resolved' && fact.instanceId === key);
}