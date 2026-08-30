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
  | { kind: 'effect'; instanceId: string; instanceKey: string; sourceId: string; ownerId: string; targetId: string; effectKind: EffectInstanceKind; effectId: string; operation: 'apply' | 'remove' | 'enter' | 'exit'; provenance?: Provenance }
  | { kind: 'entity'; instanceId: string; sourceId: string; ownerId: string; entityType: string; operation: 'create' | 'remove' | 'summon' | 'update'; provenance?: Provenance }
  | { kind: 'terrain'; instanceId: string; sourceId: string; ownerId: string; terrain: string; operation: 'create' | 'remove' | 'raise' | 'lower'; provenance?: Provenance }
  | { kind: 'save-resolved'; instanceId: string; sourceId: string; ownerId: string; actorId: string; success: boolean; provenance?: Provenance }
  | { kind: 'trigger-resolved'; instanceId: string; sourceId: string; ownerId: string; trigger: string; targetId?: string; provenance?: Provenance };

/** The single deterministic event identity of one fact — a pure function of
 * the resolution (source + kind + the mutation's position in the recorded
 * mutation list). Same resolved event sequence ⇒ same instance id; it is
 * NEVER inferred from later mutable state or array construction order of a
 * Set. */
export function factInstanceId(sourceId: string, kind: Fact['kind'], index: number): string {
  return `fact:${sourceId}:${kind}:${index}`;
}

/** The LIVE effect-instance identity: WHICH specific effect instance on a
 * target the `effect-still-exists` question is about. `instanceKey` is the
 * explicit discriminator a caller must supply when multiple same-source
 * instances could coexist and its illegal to guess which one; single-instance
 * kinds (condition/status/stance) omit it. */
export interface EffectInstanceIdentity {
  kind: EffectInstanceKind;
  sourceId: string;
  targetId: string;
  effectId: string;
  ownerId?: string;
  /** Explicit discriminator for coexisting same-source-and-kind instances
   * (persistent active-effects, marks). Absent when the kind is
   * single-instance on the live view OR the caller is only asking "any". */
  instanceKey?: string;
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
export function recordFacts(
  mutations: readonly RuleMutation[],
  options: { ownerId?: string; actionId?: string } = {},
): Fact[] {
  const facts: Fact[] = [];
  let index = 0;
  const ownerId = options.ownerId;
  for (const mutation of mutations) {
    const kind = mutation.kind;
    if (kind === 'attack') {
      facts.push({
        kind: 'attack-resolved',
        instanceId: factInstanceId(mutation.sourceId, 'attack-resolved', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.actorId,
        targetId: mutation.targetId,
        hit: mutation.hit,
        critical: mutation.critical,
        ...(mutation.exceed === true ? { exceed: true } : {}),
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'damage') {
      facts.push({
        kind: 'damage-applied',
        instanceId: factInstanceId(mutation.sourceId, 'damage-applied', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.sourceActorId,
        recipientId: mutation.actorId,
        amount: mutation.amount,
        delivery: mutation.delivery,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'condition') {
      facts.push(effectFact(mutation.sourceId, mutation.sourceActorId, mutation.actorId, 'condition', mutation.conditionId, mutation.operation === 'apply' ? 'apply' : 'remove', index, ownerId, options.actionId));
    } else if (kind === 'stance') {
      facts.push(effectFact(mutation.sourceId, mutation.sourceActorId, mutation.actorId, 'stance', mutation.stanceId, mutation.operation === 'enter' ? 'enter' : mutation.operation === 'exit' ? 'exit' : 'apply', index, ownerId, options.actionId));
    } else if (kind === 'mark') {
      facts.push(effectFact(mutation.sourceId, mutation.ownerId, mutation.actorId, 'mark', mutation.markId, mutation.operation, index, ownerId, options.actionId));
    } else if (kind === 'persistent') {
      facts.push(effectFact(mutation.sourceId, mutation.ownerId, mutation.actorId, 'persistent', mutation.effectId, 'apply', index, ownerId, options.actionId));
    } else if (kind === 'move') {
      facts.push({
        kind: 'movement',
        instanceId: factInstanceId(mutation.sourceId, 'movement', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.sourceActorId,
        actorId: mutation.actorId,
        mode: mutation.movement,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'entity') {
      facts.push({
        kind: 'entity',
        instanceId: factInstanceId(mutation.sourceId, 'entity', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.ownerId,
        entityType: mutation.entityType,
        operation: mutation.operation,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'terrain') {
      facts.push({
        kind: 'terrain',
        instanceId: factInstanceId(mutation.sourceId, 'terrain', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.sourceActorId,
        terrain: mutation.terrain,
        operation: mutation.operation,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'save') {
      facts.push({
        kind: 'save-resolved',
        instanceId: factInstanceId(mutation.sourceId, 'save-resolved', index),
        sourceId: mutation.sourceId,
        ownerId: ownerId ?? mutation.actorId,
        actorId: mutation.actorId,
        success: mutation.success,
        provenance: provenanceOfMutation(mutation, { ownerId, actionId: options.actionId }),
      });
    } else if (kind === 'defeat') {
      facts.push({
        kind: 'actor-defeated',
        instanceId: factInstanceId(mutation.sourceId, 'actor-defeated', index),
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
  sourceId: string,
  mutationOwner: string | undefined,
  targetId: string,
  effectKind: EffectInstanceKind,
  effectId: string,
  operation: 'apply' | 'remove' | 'enter' | 'exit',
  index: number,
  ownerId: string | undefined,
  actionId: string | undefined,
): Fact {
  const residentOwner = ownerId ?? mutationOwner ?? targetId;
  // Coexist-capable kinds (persistent/mark) embed the deterministic
  // application index so two same-source-and-kind applications never alias.
  const instanceKey = effectInstanceKey(effectKind, sourceId, targetId, effectId, String(index));
  return {
    kind: 'effect',
    instanceId: factInstanceId(sourceId, 'effect', index),
    instanceKey,
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
      return { ok: true, exists: view.stance?.stanceId === identity.effectId };
    case 'mark': {
      const marks = view.marks.filter((mark) => mark.markId === identity.effectId);
      if (identity.anyInstance) return { ok: true, exists: marks.length > 0 };
      if (identity.instanceKey !== undefined) {
        // The view projects marks as {markId, ownerId} without a per-instance
        // discriminator — a specific instance cannot be singled out.
        return { ok: false, problem: 'effect-instance-unrepresentable' };
      }
      return { ok: true, exists: marks.length > 0 };
    }
    case 'persistent': {
      const effects = (view.activeEffects ?? []).filter((effect) => effect.effectId === identity.effectId && effect.sourceId === identity.sourceId);
      if (identity.anyInstance) return { ok: true, exists: effects.length > 0 };
      if (identity.instanceKey !== undefined) {
        // The view projects active-effects as {sourceId, effectId, radius?}
        // without a per-instance id — a specific coexisting instance cannot
        // be disambiguated; FAIL CLOSED rather than guessing.
        return { ok: false, problem: 'effect-instance-unrepresentable' };
      }
      return { ok: true, exists: effects.length > 0 };
    }
  }
}

// ── U16 fact-backed de-duplication identity ────────────────────────────────

/**
 * The full de-dup identity T4 completes for U16: the U16 USAGE identity
 * (source + owner + scope + optional target) PLUS the U10 FACT dimension —
 * WHICH specific resolved fact/event this use answers against.
 *
 * This distinguishes exactly the cases the plan requires:
 *   - two different OWNERS using the same source → different `ownerId`;
 *   - the same logical trigger reachable through two ROUTES → both routes
 *     reference the SAME fact dimension → `hasResolvedAsFact` resolves once;
 *   - two genuinely SEPARATE triggering facts from the same source → different
 *     fact dimensions → each may resolve;
 *   - same source/owner against DIFFERENT targets → different `targetId`;
 *   - repeated legitimate triggers from different underlying events → different
 *     fact dimensions.
 * It never uses sourceId alone, array position, current mutable state, or a
 * broad once-per-scope ledger mark as trigger-event de-duplication. Ordinary
 * entitlement COUNTS stay in the U16 ledger (`used-scope`); THIS read answers
 * "has this logical use already resolved for this fact/event?"
 */
export interface ResolveIdentity {
  sourceId: string;
  ownerId: string;
  scope: 'turn' | 'round' | 'combat';
  targetId?: string;
  /** The logical trigger/use name (hit, critical-hit, collide, slay, …) —
   * included so different trigger routes responding to the same event stay
   * distinct. Absent for a plain use entitlement. */
  trigger?: string;
  /** The U10 fact/event dimension this resolve answers against: a recorded
   * fact's `instanceId` (the specific outcome event). Two routes to the SAME
   * outcome share it; two separate outcomes differ. */
  factDimension: string;
}

/** Canonical, UNAMBIGUOUS serialization of a resolve identity (a JSON tuple
 * over the six dimensions incl. trigger + target). Collision-safe over
 * opaque ids — same delimiter lesson as `usageIdentityKey`. This is the
 * durable event-de-dup key (U16 completion): the exact `instanceId` a
 * `trigger-resolved` marker is recorded under. */
export function resolveIdentityKey(identity: ResolveIdentity): string {
  return JSON.stringify([identity.sourceId, identity.ownerId, identity.scope, identity.targetId ?? null, identity.trigger ?? null, identity.factDimension]);
}

/** Boolean structural equality of two resolve identities. */

export function resolveIdentitiesEqual(first: ResolveIdentity, second: ResolveIdentity): boolean {
  return first.sourceId === second.sourceId
    && first.ownerId === second.ownerId
    && first.scope === second.scope
    && (first.targetId ?? null) === (second.targetId ?? null)
    && (first.trigger ?? null) === (second.trigger ?? null)
    && first.factDimension === second.factDimension;
}

/** Build a resolve identity from an outcome fact + a usage scope (+ the
 * logical trigger): `fact` is the specific recorded fact this use answers,
 * its `instanceId` is the fact dimension, its source/owner/target fill the
 * usage identity. Two routes to the SAME fact produce the SAME identity;
 * two separate facts differ. */
export function resolveIdentityForFact(
  fact: Fact,
  scope: 'turn' | 'round' | 'combat',
  trigger?: string,
  targetId?: string,
): ResolveIdentity {
  return {
    sourceId: fact.sourceId,
    ownerId: fact.ownerId,
    scope,
    ...(trigger !== undefined ? { trigger } : {}),
    ...((targetId ?? factTargetId(fact)) !== undefined ? { targetId: targetId ?? factTargetId(fact) } : {}),
    factDimension: fact.instanceId,
  };
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