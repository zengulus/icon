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
 * enumerable boundary over the canonical corpus. There is deliberately NO
 * selector/filter escape hatch: EVERY clause on the declared pages must be
 * either covered by a classified obligation's passages or explicitly
 * dispositioned (irrelevant / subdivided). "Not mentioned" never means
 * "irrelevant", and a narrow selection policy cannot make omitted material
 * disappear from the completeness proof. A scope whose frontier has uncovered
 * clauses cannot close; a frontier that resolves to ZERO clauses is vacuous
 * and equally cannot close.
 */
export interface ScopeFrontier {
  /** Pages of the canonical corpus inside this scope's boundary. The whole
   * page is inside the boundary — there is no clause-selection filter. */
  pages: readonly number[];
  /** Explicit accounting for frontier clauses this scope does not implement
   * (narrative guidance, other-scope material, merged lines quoted across
   * obligations). Every entry must match at least one resolved clause. */
  irrelevant?: readonly ClauseDisposition[];
  /** Explicit per-clause coverage claims tying frontier clauses to the
   * curated obligations that account for them. A clause is covered ONLY
   * through an entry here — never merely because some large quotation
   * happens to contain it. */
  attributed?: readonly ClauseAttribution[];
}

/**
 * How many identical frontier occurrences one accounting entry covers.
 * Repeated source occurrences have DISTINCT identities, so an entry covers
 * exactly `count` occurrences (the first unaccounted ones in deterministic
 * page/line order) unless it explicitly declares `'all'`.
 */
export type OccurrenceCount = number | 'all';

/**
 * The explicit accounting of one frontier clause this scope deliberately
 * does NOT implement.
 *
 * - `irrelevant` (default): the clause is outside this scope's claimed
 *   semantics entirely.
 * - `subdivided`: the extraction line MERGES several semantic pieces; the
 *   named curated obligations jointly quote it. This keeps extraction-line
 *   accounting honest WITHOUT pretending one line is one semantic proposition
 *   (the line granularity is stable, not semantic).
 *
 * Every entry must match at least one resolved clause by normalized text;
 * a stale entry is an integrity violation, and an uncovered clause without
 * an entry blocks closure.
 */
export interface ClauseDisposition {
  text: string;
  reason: string;
  kind?: 'irrelevant' | 'subdivided';
  /** Required for `subdivided`: curated obligations whose passages jointly contain the clause. */
  subdividedInto?: readonly string[];
  /** Default 1: repeated occurrences have distinct identities and must be
   * accounted individually. Use `'all'` only when every identical occurrence
   * genuinely carries the same disposition. */
  occurrences?: OccurrenceCount;
}

/**
 * An explicit FRONTIER COVERAGE claim: the named obligation declares that the
 * frontier clause(s) matching `text` are semantically ACCOUNTED FOR by its
 * classification + contract. This deliberately separates the two evidence
 * acts:
 *
 *     provenance — the obligation's passages really quote this material
 *                 (verified against the canonical corpus);
 *     coverage   — a human decided THIS obligation accounts for THIS clause,
 *                 clause by clause.
 *
 * Containment alone is provenance, never coverage: a page-spanning quotation
 * cannot silently sweep every clause inside it into "covered". Each
 * attribution is verified mechanically: the text must resolve to frontier
 * clause occurrence(s), and each must be contained in the named obligation's
 * own verified passages. Stale/unquoted/attribution-of-nothing are integrity
 * violations.
 */
export interface ClauseAttribution {
  text: string;
  /** Curated obligation claiming semantic accountability for this clause. */
  obligationId: string;
  /** Default 1 (distinct identities per occurrence); `'all'` for genuinely
   * identical repeated fragments. */
  occurrences?: OccurrenceCount;
}

/** Frontier input resolved from the canonical corpus and handed to the pure
 * audit engine. Produced by `provenance.resolveScopeFrontiers`. */
export interface ScopeFrontierInput {
  scopeId: string;
  clauses: readonly SourceClause[];
  /** Clause IDs matched by the scope's explicit irrelevant dispositions. */
  irrelevantIds: readonly string[];
  /** Clause IDs explicitly ATTRIBUTED to a classified curated obligation
   * (verified: contained in that obligation's own passages). Coverage is
   * attribution-based; containment alone never covers a clause. */
  attributedIds: readonly string[];
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
  /** For `player-choice` obligations only: does the software intentionally
   * leave this choice to the table, or does it claim runtime workflow
   * support? Classification alone is never completion:
   * - `table-only`: explicit non-runtime disposition (with reason) — the
   *   scope may still close; the delegation is the intended product behavior.
   * - `runtime-supported`: the software claims the choice workflow (pending
   *   representation, legal-choice validation, persistence, deterministic
   *   replay). This demands the SAME evidence as a deterministic obligation
   *   PLUS replay proof — a missing workflow blocks closure.
   * A player-choice obligation WITHOUT this field is conservative: it can
   * neither close its scope nor claim support.
   */
  choice?: { automation: 'table-only'; reason: string } | { automation: 'runtime-supported' };
}

// ---------------------------------------------------------------------------
// Unit decompositions — COMPUTED completeness of semantic decomposition
// ---------------------------------------------------------------------------

/** One explicitly declared semantic subdivision of a parent source unit's
 * rulesText, assigned to the curated obligation that carries it — or
 * explicitly disposed irrelevant. The TEXT must be a verbatim substring of
 * the parent unit's rules text and must be quoted by the named child's
 * passages: the audit verifies correspondence mechanically. */
export interface UnitDecompositionPiece {
  text: string;
  /** Curated child obligation carrying this piece, or null when explicitly
   * disposed as not requiring representation. */
  obligationId: string | null;
  /** Required when `obligationId` is null. */
  reason?: string;
}

/**
 * Declares how a catalogued RuleSourceUnit has been semantically subdivided
 * into curated obligations. There is deliberately NO load-bearing
 * `complete: true` flag: the audit COMPUTES decomposition completeness by
 * checking that every semantic sentence of the parent unit's rulesText is
 * represented by a declared piece whose child actually quotes it. An
 * incomplete piece list leaves the unit partially decomposed — visible,
 * conservative, and blocking strong claims.
 */
export interface UnitDecomposition {
  /** Catalogued RuleSourceUnit ID (`unit:<id>` obligation grain). */
  unitId: string;
  /** Explicit subdivision/assignment of the parent's source material. */
  pieces: readonly UnitDecompositionPiece[];
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
  /** Public name of an explicit runtime export implementing the consumer.
   * Named re-exports/import aliases must resolve to a value implementation;
   * erased types, ambient declarations and wildcard-only barrels do not
   * establish this identity. Omit only for a file-level registration. */
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
 * requirements are derived from this class AND from structural checks on the
 * declared domain/probe data, so the required evidence matches the semantics
 * instead of being uniform boilerplate — and row CLASS LABELS alone can never
 * manufacture a proof shape.
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
  /** Machine-checkable boundary pinned by a `boundary-constant` contract.
   * The PROBE INPUTS are load-bearing structure: the audit requires rows
   * realizing each side (below/at/above), each labelled `boundary`, so a
   * relabelled positive row cannot manufacture boundary proof. */
  boundary?: {
    kind: 'level' | 'xp' | 'count';
    value: number;
    probes: { below: unknown; at: unknown; above: unknown };
    /** Dotted paths extracting, from each probe INPUT, the numeric scalar
     * compared against `value`. REQUIRED: every side must resolve to a finite
     * number, and the relations are enforced strictly — below < value,
     * at === value, above > value. Probes that cannot prove their side of
     * the edge are integrity violations, not silently accepted structure. */
    probeValuePaths: { below: string; at: string; above: string };
  };
  /** Declared finite legal-input domain for an `exhaustive-finite` contract.
   * Exhaustive proof is satisfied ONLY when the evaluated row inputs equal
   * this domain exactly (no missing member, no extra case, no duplicate).
   * A single row labelled `exhaustive` over a larger declared domain fails. */
  domain?: readonly unknown[];
  /** Executable expectation rows. Strong ("proven-supported") status requires
   * rows covering every proof class the contract kind demands — with the
   * STRUCTURAL shape checks above — AND a passing evaluation against the
   * registered adapter. A prose-only contract caps at implemented-unproven. */
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
 * - `replay`/`integration` proofs are EXECUTED evidence: they additionally
 *   REQUIRE `command` — a package.json script whose RECORDED PASSING RUN
 *   (from the aggregate authority runner) constitutes the evidence. A test
 *   name substring in a file is traceability, never execution. Without a
 *   recorded passing result the proof provides nothing. */
export interface ProofRecord {
  obligationId: string;
  kind: ProofKind;
  file: string;
  test: string;
  evidence: 'declared' | 'replay' | 'integration';
  /** Required for replay/integration evidence: the npm script whose recorded
   * passing run IS the evidence. */
  command?: string;
}

// ---------------------------------------------------------------------------
// Contract evaluation — EXECUTED semantic evidence
// ---------------------------------------------------------------------------

/** Result of actually running a contract's rows against the registered
 * adapter (which calls the production implementation). Recorded as part of
 * the audit computation; strong status consumes these results directly.
 *
 * Two anti-staleness bindings: `contractFingerprint` pins the EXACT contract
 * identity+rows evaluated (a result computed against a since-changed contract
 * is discarded as stale, never counted as passing evidence), and
 * `executedInputKeys` records the canonical fixture keys ACTUALLY run, so
 * exhaustive/boundary proof shapes verify against execution, not declaration. */
export interface ContractEvaluation {
  obligationId: string;
  adapterId: string | null;
  rowsRun: number;
  passed: boolean;
  /** SHA-256 of the evaluated contract's canonical serialization. */
  contractFingerprint: string;
  /** Deduplicated canonical fixture keys of the rows actually executed. */
  executedInputKeys: readonly string[];
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
 * Scope capability ladder. Each rung adds exactly one mechanical predicate on
 * top of the previous one — this ordering is canonical and enforced by
 * `engine.ts`, documented identically in generated docs, and exercised rung
 * by rung in the self-tests:
 *
 * - blocked            — unknown material (unclassified or partially-
 *                        decomposed obligations) or an unadjudicated source
 *                        conflict is present in the scope.
 * - partial            — known scope whose execution/accounting evidence is
 *                        incomplete: some deterministic obligation lacks a
 *                        resolving consumer / structural contract proof /
 *                        passing evaluation; OR a relevant `deferred`
 *                        obligation exists; OR a runtime-supported player
 *                        choice lacks its workflow evidence.
 * - executable         — every executable-semantics obligation resolves,
 *                        carries structurally sufficient contract proof, and
 *                        PASSED evaluation — but the source frontier is not
 *                        yet fully accounted (missing, vacuous, or has
 *                        uncovered clauses). A scope with NO declared
 *                        frontier can never rise past this rung.
 * - source-tested      — executable + the declared source frontier resolves
 *                        non-vacuously and every clause inside it is covered
 *                        or explicitly dispositioned.
 * - replay-tested      — source-tested + every stateful contract has
 *                        declared replay evidence.
 * - closed             — replay-tested + the scope's required integration
 *                        evidence exists. (Deferred obligations and
 *                        unevidenced runtime-supported choices already cap
 *                        at partial.)
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
  | 'proof-evidence-command-missing'
  | 'missing-passages'
  | 'passage-fingerprint-mismatch'
  | 'passage-not-in-canonical-source'
  | 'passage-outside-frontier'
  | 'frontier-disposition-entry-dangling'
  | 'frontier-page-outside-corpus'
  | 'subdivision-unsupported'
  | 'decomposition-dangling-piece'
  | 'decomposition-piece-not-in-unit'
  | 'decomposition-piece-unquoted-by-child'
  | 'decomposition-irrelevant-piece-missing-reason'
  | 'duplicate-unit-decomposition'
  | 'duplicate-contract-input'
  | 'contradictory-contract-expectations'
  | 'exhaustive-domain-duplicate'
  | 'boundary-probe-duplicate'
  | 'boundary-probe-scalar-missing'
  | 'boundary-probe-relation-wrong'
  | 'decomposition-overlapping-pieces'
  | 'frontier-attribution-entry-dangling'
  | 'frontier-attribution-unquoted'
  | 'frontier-double-accounting'
  | 'adapter-does-not-exercise-consumer';

/** Deterministic canonicalization of a fixture input for duplicate/coverage
 * accounting: stable key ordering so structurally equal objects collide and
 * arbitrary key order cannot hide duplicates. Deliberately NOT symbolic
 * equivalence — just deterministic JSON-shaped keys. */
export function canonicalFixtureKey(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalFixtureKey).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalFixtureKey(v)}`).join(',')}}`;
}

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
