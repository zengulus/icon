/**
 * fidelity/types.ts — canonical data structures for the strict
 * source-fidelity audit.
 *
 * The audit chain this module supports:
 *
 *     immutable ICON 1.5 source (SHA-pinned PDF, byte-verified extraction)
 *         ↓
 *     atomic source obligations (stable semantic IDs + passage fingerprints)
 *         ↓
 *     explicit semantic classification (disposition) / semantic contract
 *         ↓
 *     typed implementation consumers
 *         ↓
 *     proof registry (independent evidence, never line coverage)
 *         ↓
 *     computed obligation status and scope closure
 *
 * Everything here is pure data. No runtime rules code is imported: the
 * fidelity layer observes the engine through explicitly registered evidence,
 * never by reimplementing or calling into it.
 */

import type { RuleSourceKind } from '../source-units.js';

// ---------------------------------------------------------------------------
// Dispositions — explicit semantic classification of an obligation
// ---------------------------------------------------------------------------

/**
 * What the source material demands of the engine. `unclassified` is the
 * deliberate default: unknown must never silently count as supported, so an
 * unclassified relevant obligation blocks every strong completeness claim in
 * its scope until a human classifies it.
 */
export type ObligationDisposition =
  /** A deterministic rule the engine claims to automate end-to-end. */
  | 'deterministic-executable'
  /** Requires a durable player choice at execution time. */
  | 'player-choice'
  /** Deliberately resolved by GM/table judgment, not automation. */
  | 'gm-facing'
  /** Descriptive/non-runtime prose (flavor, procedure narrative). */
  | 'descriptive'
  /** Intentionally human-adjudicated; recorded in TABLE_FACING_MECHANICS-style registries. */
  | 'table-facing'
  /** Intentionally deferred engineering work with a recorded reason. */
  | 'deferred'
  /** The source passages conflict; executable only via a linked adopted adjudication. */
  | 'conflicted'
  /** Not yet classified. Blocks strong completeness claims. */
  | 'unclassified';

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------

/** One exact supporting passage from the immutable source, fingerprinted so
 * accidental extraction/prose drift is detectable. */
export interface SourcePassage {
  page: number;
  sectionId: string | null;
  quote: string;
  /** SHA-256 of `quote` (hex). Recomputed by the audit; a mismatch is an
   * integrity violation, so quotes cannot be edited casually. */
  sha256: string;
}

export type ObligationOrigin =
  /** Hand-decomposed atomic obligation with a stable semantic ID. */
  | { kind: 'curated' }
  /** Unit-grain obligation derived deterministically from one RuleSourceUnit;
   * identity = the unit's stable ID, fingerprint = SHA-256 of its rulesText. */
  | { kind: 'derived-unit'; unitId: string };

export interface SourceObligation {
  /**
   * Stable semantic identity. Never location-only: curated IDs are
   * `icon-1.5:<topic>:<mechanic>`; derived IDs reuse the catalog's stable unit
   * ID (`unit:<sourceUnitId>`).
   */
  id: string;
  scopeId: string;
  disposition: ObligationDisposition;
  /** The semantic proposition extracted from the passages. */
  summary: string;
  passages: readonly SourcePassage[];
  origin: ObligationOrigin;
  /** For derived obligations: the catalog kind, kept for reporting only. */
  sourceKind?: RuleSourceKind;
  /** Required when disposition is `conflicted`; must resolve to an accepted
   * (adopted) adjudication before the obligation can become executable. */
  adjudicationId?: string;
  /** Implementation claims, as IDs registered in the consumer registry.
   * Existing somewhere in source code does NOT count — only typed
   * registrations do. */
  consumerIds?: readonly string[];
}

// ---------------------------------------------------------------------------
// Consumers — explicit implementation coverage
// ---------------------------------------------------------------------------

/** A typed registration claiming "this implementation location satisfies the
 * linked obligations". Free-floating code existence is not coverage. */
export interface ConsumerRegistration {
  id: string;
  /** Repo-root-relative implementation location (for humans/audit output). */
  location: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Semantic contracts — source-derived, independent of runtime code
// ---------------------------------------------------------------------------

/**
 * The shape of independent expectation the contract carries. Proof
 * requirements are derived from this class, so the required evidence matches
 * the semantics instead of being uniform boilerplate.
 */
export type ContractKind =
  /** Pins a numeric boundary constant (e.g. AP claimed at exactly 7 XP).
   * Requires positive + boundary proof (both sides of the edge). */
  | 'boundary-constant'
  /** Bounded input→output table derived from the source text.
   * Requires positive + negative/invariant proof. */
  | 'input-output-table'
  /** Deterministic behavior over a small fully-enumerable domain.
   * Requires exhaustive proof over the whole domain. */
  | 'exhaustive-finite';

/** Required proof kinds per contract class. Stateful contracts additionally
 * require replay evidence (see `stateful`). */
export const REQUIRED_PROOF_KINDS: Readonly<Record<ContractKind, readonly string[]>> = {
  'boundary-constant': ['positive', 'boundary'],
  'input-output-table': ['positive', 'negative'],
  'exhaustive-finite': ['exhaustive'],
};

export interface SemanticContract {
  obligationId: string;
  kind: ContractKind;
  /** True when the semantics involve durable state transitions across
   * commands/events; such contracts additionally require a `replay` proof. */
  stateful: boolean;
  /** Human-readable statement of what the contract pins, derived from source. */
  statement: string;
  /** Machine-checkable boundary pinned by a `boundary-constant` contract. */
  boundary?: { kind: 'level' | 'xp' | 'count'; value: number };
  // Note: contracts deliberately carry DATA, never pointers to runtime
  // functions. Oracle adapters that evaluate a runtime implementation against
  // contract rows live beside the tests that exercise them (see the mutation
  // harness), keeping this registry free of gameplay callbacks.
}

// ---------------------------------------------------------------------------
// Proofs
// ---------------------------------------------------------------------------

export type ProofKind =
  | 'positive'
  | 'boundary'
  | 'negative'
  | 'invariant'
  | 'exhaustive'
  | 'replay'
  | 'integration';

/** A pointer to independent verifying evidence. `file` is repo-root-relative
 * and `test` must appear verbatim in that file, so the audit can statically
 * prove the evidence exists without executing anything. Line coverage is
 * never accepted as proof. */
export interface ProofRecord {
  obligationId: string;
  kind: ProofKind;
  file: string;
  test: string;
}

// ---------------------------------------------------------------------------
// Adjudications (link to the existing source-adjudication system)
// ---------------------------------------------------------------------------

export interface AdjudicationLink {
  id: string;
  status: 'adopted' | 'unresolved';
}

// ---------------------------------------------------------------------------
// Scopes — machine-readable vertical slices
// ---------------------------------------------------------------------------

export interface ScopeDefinition {
  id: string;
  title: string;
  /** Prose aliases the documentation-claim checker also watches. */
  aliases: readonly string[];
  description: string;
  /** Closure requirements beyond the default formula. When
   * `requiresIntegrationEvidence` is true, a scope-level proof record with
   * kind `integration` (obligationId `scope:<id>`) must exist to close. */
  closure?: { requiresIntegrationEvidence?: boolean };
}

// ---------------------------------------------------------------------------
// Computed statuses
// ---------------------------------------------------------------------------

export type ObligationStatus =
  /** Executable + contracted + all required proofs present. */
  | 'proven-supported'
  /** Consumer + contract exist but required proof kinds are missing. */
  | 'implemented-unproven'
  /** Consumer exists but no independent semantic contract does. */
  | 'implemented-no-contract'
  /** Deterministic obligation with no valid registered consumer. */
  | 'unimplemented'
  /** Source conflict without a linked ADOPTED adjudication. */
  | 'conflicted-unadjudicated'
  | 'table-facing'
  | 'deferred'
  | 'descriptive'
  | 'gm-facing'
  | 'player-choice'
  | 'unclassified';

export interface ObligationFinding {
  obligationId: string;
  scopeId: string;
  disposition: ObligationDisposition;
  status: ObligationStatus;
  /** Exact machine-readable reasons preventing any stronger status. */
  blockers: readonly string[];
  missingProofKinds?: readonly string[];
}

/** Scope capability ladder, aligned with the repository's rung vocabulary
 * (docs/rules-coverage.md): blocked < partial < executable < source-tested <
 * replay-tested < closed. */
export type ScopeStatus =
  | 'blocked'
  | 'partial'
  | 'executable'
  | 'source-tested'
  | 'replay-tested'
  | 'closed';

export const SCOPE_STATUS_RANK: Readonly<Record<ScopeStatus, number>> = {
  blocked: 0,
  partial: 1,
  executable: 2,
  'source-tested': 3,
  'replay-tested': 4,
  closed: 5,
};

export interface ScopeResult {
  scopeId: string;
  title: string;
  totalObligations: number;
  unclassified: number;
  deterministicExecutable: number;
  provenSupported: number;
  implementedUnproven: number;
  implementedNoContract: number;
  unimplemented: number;
  conflictedUnadjudicated: number;
  tableFacing: number;
  deferred: number;
  descriptive: number;
  gmFacing: number;
  playerChoice: number;
  unimplementedIds: readonly string[];
  lackingRequiredProof: ReadonlyArray<{ obligationId: string; missing: readonly string[] }>;
  unresolvedConflicts: readonly string[];
  status: ScopeStatus;
  blockers: readonly string[];
}

// ---------------------------------------------------------------------------
// Integrity violations — hard failures, distinct from incompleteness
// ---------------------------------------------------------------------------

export interface FidelityIntegrityViolation {
  check:
    | 'duplicate-obligation-id'
    | 'dangling-consumer-reference'
    | 'dangling-adjudication-reference'
    | 'dangling-scope-reference'
    | 'dangling-contract-obligation'
    | 'duplicate-contract'
    | 'dangling-proof-obligation'
    | 'missing-passages'
    | 'passage-fingerprint-mismatch';
  detail: string;
}

// ---------------------------------------------------------------------------
// World + result
// ---------------------------------------------------------------------------

/** The complete evidence graph the audit computes over. Pure data; assembled
 * for production by `world.ts` and synthetically by tests. */
export interface FidelityWorld {
  scopes: readonly ScopeDefinition[];
  obligations: readonly SourceObligation[];
  consumers: readonly ConsumerRegistration[];
  contracts: readonly SemanticContract[];
  proofs: readonly ProofRecord[];
  adjudications: readonly AdjudicationLink[];
}

export interface FidelitySummary {
  totalObligations: number;
  classified: number;
  unclassified: number;
  deterministicObligations: number;
  implementedDeterministic: number;
  lackingExecution: readonly string[];
  lackingRequiredProof: ReadonlyArray<{ obligationId: string; missing: readonly string[] }>;
  unresolvedConflicts: readonly string[];
  tableFacing: number;
  deferredUnsupported: number;
  integrityViolations: readonly FidelityIntegrityViolation[];
}

export interface FidelityAuditResult {
  summary: FidelitySummary;
  findings: readonly ObligationFinding[];
  scopes: readonly ScopeResult[];
}
