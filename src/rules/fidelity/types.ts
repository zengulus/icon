/**
 * fidelity/types.ts — canonical data structures for the strict
 * source-fidelity audit.
 *
 * The audit chain this module supports:
 *
 *     immutable ICON 1.5 source (SHA-pinned PDF, byte-verified extraction)
 *         ↓
 *     canonical extraction corpus (checked-in artifacts, verified hashes)
 *         ↓
 *     scope source FRONTIERS (exhaustive clause enumeration per scope)
 *         ↓
 *     atomic source obligations (stable semantic IDs + passage fingerprints
 *     verified against the canonical corpus — a quote cannot prove itself)
 *         ↓
 *     explicit semantic classification (disposition) / semantic CONTRACT
 *     carrying executable expectation rows, not just prose
 *         ↓
 *     typed implementation consumers that RESOLVE to real exported symbols
 *         ↓
 *     adapter layer feeding real implementations to the contract evaluator;
 *     evaluator RESULTS (not declarations) are the executed semantic evidence
 *         ↓
 *     computed obligation status and scope closure
 *
 * Everything here is pure data. No runtime rules code is imported: the
 * fidelity layer observes the engine through explicitly registered evidence,
 * never by reimplementing or calling into it. Adapters that connect contract
 * rows to production implementations live in `adapters.ts` — one direction
 * only; nothing in the evidence graph may import them.
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
// Canonical clauses + scope frontiers
// ---------------------------------------------------------------------------

/** One atomic piece of canonical extracted source material: an extraction
 * line on a page of the checked-in corpus, normalized and fingerprinted. The
 * id is deterministic (`p<page>:<sha12>`), so frontier accounting can be
 * replayed against the same artifact bytes. */
export interface SourceClause {
  page: number;
  text: string;
  sha256: string;
  id: string;
}

/**
 * The SOURCE FRONTIER of a closable scope: an explicit, mechanically
 * enumerable boundary over the canonical corpus. Every clause selected by the
 * definition must be either covered by a classified obligation's passages or
 * explicitly dispositioned irrelevant — "not mentioned" never means
 * "irrelevant". A scope whose frontier has uncovered clauses cannot close,
 * no matter how complete its curated obligation list looks.
 */
export interface ScopeFrontier {
  /** Pages of the canonical corpus inside this scope's boundary. */
  pages: readonly number[];
  /** Explicit irrelevance dispositions for frontier clauses this scope does
   * not implement (narrative guidance, other-scope material, table-facing
   * prose). Every entry must match exactly one resolved clause. */
  irrelevant?: readonly IrrelevantClauseDisposition[];
  /** Case-insensitive regex (source form) selecting RELEVANT clauses from
   * those pages. Omitting it selects every clause on the pages. The filter
   * is part of the audited scope definition: it is visible, debatable
   * evidence policy, not hidden curation. */
  include?: string;
}

/** An explicit "this clause does not matter to this scope" disposition,
 * recorded with its reason and matched against resolved clauses by exact
 * normalized text. An entry matching no clause is a stale policy and an
 * integrity violation; an uncovered clause without one blocks closure. */
export interface IrrelevantClauseDisposition {
  text: string;
  reason: string;
}

/** Frontier input resolved from the canonical corpus and handed to the pure
 * audit engine. Produced by `provenance.resolveScopeFrontiers`. */
export interface ScopeFrontierInput {
  scopeId: string;
  clauses: readonly SourceClause[];
  /** Clause IDs matched by the scope's explicit irrelevant dispositions. */
  irrelevantIds: readonly string[];
}

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------

/** One exact supporting passage from the immutable source, fingerprinted so
 * accidental extraction/prose drift is detectable. For CURATED obligations
 * the quote must additionally correspond to the canonical extracted corpus
 * for the cited page (verified by the strict audit); a local SHA match alone
 * proves nothing. */
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
   * registrations that RESOLVE to real files/exports do. */
  consumerIds?: readonly string[];
  /** Explicit decomposition relationship: which unit-grain obligations this
   * curated material replaces. Prevents shadow double-counting where a unit
   * keeps its catch-all obligation while curated fragments quietly coexist. */
  supersedesUnits?: readonly string[];
}

// ---------------------------------------------------------------------------
// Unit decompositions — explicit completeness of semantic decomposition
// ---------------------------------------------------------------------------

/**
 * Declares how a catalogued RuleSourceUnit has been semantically decomposed
 * into curated obligations. `complete: true` is a claim that EVERY semantic
 * clause of the unit is represented/disposed in the linked obligations; the
 * strict audit checks the linked obligations exist and carry the unit's
 * material, but the completeness claim itself remains reviewable — an
 * unproven `complete` flag leaves the unit partially decomposed in reports
 * unless the audit can verify coverage.
 */
export interface UnitDecomposition {
  /** Catalogued RuleSourceUnit ID (`unit:<id>` obligation grain). */
  unitId: string;
  /** Curated obligations that together replace the unit-grain catch-all. */
  obligationIds: readonly string[];
  /** Claim: the unit's semantics are fully represented above. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Consumers — typed, RESOLVABLE implementation coverage
// ---------------------------------------------------------------------------

/** A typed registration claiming "this implementation location satisfies the
 * linked obligations". Free-floating code existence is not coverage: the
 * strict audit resolves `file` (must exist) and `symbol` when given (must be
 * exported from that file). A registration that resolves nowhere is a hard
 * failure, not a lowered status. */
export interface ConsumerRegistration {
  id: string;
  /** Repo-root-relative implementation file. Must exist. */
  file: string;
  /** Exported symbol implementing the consumer. When set, the audit verifies
   * the file actually exports it (stale registrations fail). */
  symbol?: string;
  /** Human-facing prose location, derived for output only. */
  location?: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Semantic contracts — executable expectation DATA, independent of runtime
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
 * require replay evidence (see `stateful`). Positive/boundary/negative/
 * invariant/exhaustive kinds must be satisfied by EXECUTED evaluator rows of
 * the corresponding class — static test-file strings alone can never satisfy
 * them. Replay/integration remain declared evidence (recorded proof records),
 * because replaying durable encounter state is outside the evaluator's scope. */
export const REQUIRED_PROOF_KINDS: Readonly<Record<ContractKind, readonly string[]>> = {
  'boundary-constant': ['positive', 'boundary'],
  'input-output-table': ['positive', 'negative'],
  'exhaustive-finite': ['exhaustive'],
};

/** Which proof class one expectation row exercises. */
export type ContractRowClass = 'positive' | 'boundary' | 'negative' | 'invariant' | 'exhaustive';

/** One machine-checkable expectation: a fixture INPUT, the independently
 * derived EXPECTED output, and the proof class it exercises. Rows are pure
 * data — the oracle. They must never be generated by the implementation under
 * test (circularity); adapters map inputs onto production code, expected
 * values come from the source-derived contract. */
export interface ContractRow {
  label: string;
  cls: ContractRowClass;
  input: unknown;
  expected: unknown;
}

export interface SemanticContract {
  obligationId: string;
  kind: ContractKind;
  /** True when the semantics involve durable state transitions across
   * commands/events; such contracts additionally require a `replay` proof. */
  stateful: boolean;
  /** Human-readable statement of what the contract pins, derived from source.
   * Useful for humans; NEVER sufficient for strong status without `rows`. */
  statement: string;
  /** Machine-checkable boundary pinned by a `boundary-constant` contract. */
  boundary?: { kind: 'level' | 'xp' | 'count'; value: number };
  /** Executable expectation rows. Strong ("proven-supported") status requires
   * rows covering every proof class the contract kind demands AND a passing
   * evaluation against the registered adapter. A prose-only contract caps at
   * implemented-unproven. */
  rows?: readonly ContractRow[];
  // Note: contracts deliberately carry DATA, never pointers to runtime
  // functions. Adapter registries mapping row inputs to production code live
  // beside the audit harness (see adapters.ts), keeping this registry free of
  // gameplay callbacks.
}

// ---------------------------------------------------------------------------
// Proof records — DECLARED traceability evidence
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
 * never accepted as proof.
 *
 * Evidence classes:
 * - `declared` proofs (positive/boundary/negative/invariant/exhaustive) are
 *   TRACEABILITY pointers only; they document where human-authored tests
 *   exercise the semantics. They cannot by themselves lift a deterministic
 *   obligation to proven-supported — executed evaluator results do that.
 * - `replay` proofs are required declared evidence for stateful contracts.
 * - `integration` proofs are required declared evidence for scopes whose
 *   closure demands workflow integration. */
export interface ProofRecord {
  obligationId: string;
  kind: ProofKind;
  file: string;
  test: string;
  evidence: 'declared' | 'replay' | 'integration';
}

// ---------------------------------------------------------------------------
// Contract evaluation — EXECUTED semantic evidence
// ---------------------------------------------------------------------------

/** Result of actually running a contract's rows against the registered
 * adapter (which calls the production implementation). Recorded as part of
 * the audit computation; strong status consumes these results directly. */
export interface ContractEvaluation {
  obligationId: string;
  adapterId: string | null;
  rowsRun: number;
  passed: boolean;
  failures: readonly { row: string; cls: ContractRowClass; expected: string; actual: string }[];
}

export type AdapterRegistry = ReadonlyMap<string, { id: string; run: (input: unknown) => unknown }>;

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
  description: string;
  /** The scope's explicit source frontier. Scopes WITHOUT a frontier can
   * never close: an undeclared boundary means completeness is undeclarable. */
  frontier?: ScopeFrontier;
  /** Closure requirements beyond the default formula. When
   * `requiresIntegrationEvidence` is true, a proof record with kind
   * `integration` (obligationId `scope:<id>`) must exist to close. */
  closure?: { requiresIntegrationEvidence?: boolean };
}

// ---------------------------------------------------------------------------
// Computed statuses
// ---------------------------------------------------------------------------

export type ObligationStatus =
  /** Resolvable consumer + machine-readable contract + passing evaluation +
   * all required proof classes covered (+ replay for stateful). */
  | 'proven-supported'
  /** Consumer + contract exist, but required executed/declared evidence is
   * missing, or the evaluation did not pass. */
  | 'implemented-unproven'
  /** Consumer exists but no independent semantic contract does. */
  | 'implemented-no-contract'
  /** Deterministic obligation with no valid registered consumer. */
  | 'unimplemented'
  /** Source conflict without a linked ADOPTED adjudication. */
  | 'conflicted-unadjudicated'
  /** Unit-grain obligation whose unit has a COMPLETE decomposition record. */
  | 'decomposed'
  /** Unit-grain obligation whose unit has only a partial decomposition; still
   * blocks strong claims (conservative), but is distinguishable in reports. */
  | 'partially-decomposed'
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

/**
 * Scope capability ladder. Each rung adds exactly one mechanical predicate
 * on top of the previous one:
 *
 * - blocked            — the scope contains unclassified or
 *                        conflicted-unadjudicated obligations; unknown blocks
 *                        everything stronger.
 * - partial            — no unknown material, but the frontier is incomplete
 *                        or at least one deterministic obligation lacks full
 *                        evidence (consumer / contract / execution / proofs).
 * - executable         — every deterministic obligation resolves to a real
 *                        implementation, carries a machine-readable contract,
 *                        and PASSED evaluation against it.
 * - source-tested      — executable + every stateful contract has declared
 *                        replay evidence.
 * - replay-tested      — source-tested + the scope's required integration
 *                        evidence exists.
 * - closed             — replay-tested + the source frontier is exhaustively
 *                        accounted for (every clause covered or explicitly
 *                        irrelevant) and no integrity violations touch
 *                        the scope.
 */
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
  decomposed: number;
  partiallyDecomposed: number;
  tableFacing: number;
  deferred: number;
  descriptive: number;
  gmFacing: number;
  playerChoice: number;
  unimplementedIds: readonly string[];
  lackingRequiredProof: ReadonlyArray<{ obligationId: string; missing: readonly string[] }>;
  unresolvedConflicts: readonly string[];
  evaluatorFailures: ReadonlyArray<{ obligationId: string; failures: number }>;
  /** Frontier accounting (empty when the scope declares no frontier). */
  frontierTotalClauses: number;
  frontierCoveredClauses: number;
  frontierIrrelevantClauses: number;
  frontierUncoveredIds: readonly string[];
  status: ScopeStatus;
  blockers: readonly string[];
}

// ---------------------------------------------------------------------------
// Integrity violations — hard failures, distinct from incompleteness
// ---------------------------------------------------------------------------

export type IntegrityCheck =
  | 'duplicate-obligation-id'
  | 'dangling-consumer-reference'
  | 'consumer-file-missing'
  | 'consumer-symbol-missing'
  | 'dangling-adjudication-reference'
  | 'dangling-scope-reference'
  | 'dangling-contract-obligation'
  | 'duplicate-contract'
  | 'dangling-proof-obligation'
  | 'missing-passages'
  | 'passage-fingerprint-mismatch'
  | 'passage-not-in-canonical-source'
  | 'passage-outside-frontier'
  | 'frontier-irrelevant-entry-dangling'
  | 'frontier-page-outside-corpus'
  | 'decomposition-dangling-obligation'
  | 'duplicate-unit-decomposition'
  | 'decomposition-supersede-mismatch';

export interface FidelityIntegrityViolation {
  check: IntegrityCheck;
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
  /** Explicit unit → curated-obligation decomposition records. */
  decompositions?: readonly UnitDecomposition[];
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
  /** Executed semantic evidence. */
  evaluationsRun: number;
  evaluationsPassed: number;
  evaluationsFailed: readonly string[];
  /** Decomposition census over catalogued units. */
  unitsFullyDecomposed: readonly string[];
  unitsPartiallyDecomposed: readonly string[];
  unitsUntouched: number;
  /** Frontier accounting across scopes declaring one. */
  frontierScopes: ReadonlyArray<{ scopeId: string; total: number; covered: number; irrelevant: number; uncovered: number }>;
}

export interface FidelityAuditResult {
  summary: FidelitySummary;
  findings: readonly ObligationFinding[];
  scopes: readonly ScopeResult[];
}
