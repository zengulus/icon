/**
 * fidelity/engine.ts — the pure status-derivation core of the strict
 * source-fidelity audit.
 *
 * Given a `FidelityWorld` plus resolved inputs (scope frontiers, recorded
 * contract evaluations, consumer-resolution results) this module COMPUTES:
 *
 *   - per-obligation status, consuming EXECUTED evaluator results for strong
 *     status rather than declarations;
 *   - per-scope capability/closure status where each ladder rung adds exactly
 *     one mechanical predicate (see types.ts ScopeStatus);
 *   - global counters answering the canonical audit questions;
 *   - integrity violations (dangling references, fingerprint mismatches,
 *     decomposition shadowing, frontier policy staleness).
 *
 * Failure philosophy: legitimate incompleteness (unclassified obligations,
 * unimplemented rules, uncovered frontier clauses) LOWERS status but does not
 * by itself make the build red. INCONSISTENT CLAIMS OF COMPLETENESS — an
 * executable claim whose consumer resolves nowhere, a proven claim whose
 * evaluation failed or never ran, a conflict used without adjudication,
 * dangling references — are integrity violations and fail strict mode.
 * Unknown never collapses into supported.
 */

import { createHash } from 'node:crypto';
import type {
  AdjudicationLink,
  ContractEvaluation,
  ContractRowClass,
  FidelityAuditResult,
  FidelityIntegrityViolation,
  FidelityWorld,
  ObligationFinding,
  ObligationStatus,
  ProofRecord, ScopeFrontierInput,
  ScopeResult,
  ScopeStatus,
  SemanticContract,
  SourceObligation,
  UnitDecompositionPiece
} from './types.js';
import { REQUIRED_PROOF_KINDS } from './types.js';
import { canonicalFixtureKey } from './types.js';
import { contractFingerprint } from './evaluate.js';

export function passageFingerprint(quote: string): string {
  return createHash('sha256').update(quote).digest('hex');
}

/** Convenience for world authors: fingerprint passages at definition time so
 * a curated quote cannot drift silently. */
export function withFingerprints(obligation: SourceObligation): SourceObligation {
  return {
    ...obligation,
    passages: obligation.passages.map((passage) => ({
      ...passage,
      sha256: passage.sha256 || passageFingerprint(passage.quote),
    })),
  };
}

/** Resolved external inputs to an audit run. All optional so synthetic tests
 * can exercise narrow slices; production strict runs provide all of them. */
export interface AuditInputs {
  /** Resolved scope frontiers (from `provenance.resolveScopeFrontiers`). */
  frontiers?: readonly ScopeFrontierInput[];
  /** Recorded EXECUTED semantic evaluations (from `evaluate.evaluateContracts`). */
  evaluations?: readonly ContractEvaluation[];
  /** IDs of consumers that actually resolved to files/symbols. When absent,
   * every registered consumer id is assumed resolvable (pure mode); strict
   * runs always pass resolution results. */
  resolvedConsumerIds?: readonly string[];
  /** RECORDED prerequisite-audit results ({command: 'passed'|'failed'}) from
   * the aggregate authority runner. Replay/integration proof records provide
   * evidence ONLY when their bound command has a recorded passing run here —
   * a test-name substring in a file is traceability, never execution. */
  auditResults?: Readonly<Record<string, 'passed' | 'failed'>>;
}

/** Whitespace-stripped containment — matches the subdivision/correspondence policy. */
function containsStripped(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  return haystack.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''));
}

/** Resolves a dotted path ('a.b.0.c') through a structured probe input. */
function resolveProbePath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) return acc[Number(segment)];
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[segment];
    return undefined;
  }, value);
}

/** Boundary probes must PROVE their side of the edge: each probe declares a
 * dotted path extracting, from its own INPUT, the numeric scalar compared
 * against the pinned value. Probes that cannot extract a finite scalar, or
 * whose extracted value sits on the wrong side of the edge, are integrity
 * violations — a relabelled positive row cannot manufacture boundary proof. */
export function validateBoundaryProbes(contract: SemanticContract): FidelityIntegrityViolation[] {
  const violations: FidelityIntegrityViolation[] = [];
  const boundary = contract.boundary;
  if (!boundary) return violations;
  const sides = ['below', 'at', 'above'] as const;
  for (const side of sides) {
    const path = boundary.probeValuePaths?.[side];
    const input = boundary.probes[side];
    if (!path) {
      violations.push({
        check: 'boundary-probe-scalar-missing',
        detail: `${contract.obligationId}: boundary probe "${side}" declares no scalar extraction path`,
      });
      continue;
    }
    const scalar = resolveProbePath(input, path);
    if (typeof scalar !== 'number' || !Number.isFinite(scalar)) {
      violations.push({
        check: 'boundary-probe-scalar-missing',
        detail: `${contract.obligationId}: boundary probe "${side}" path "${path}" does not resolve to a finite number`,
      });
      continue;
    }
    const holds = side === 'below'
      ? scalar < boundary.value
      : side === 'at'
        ? scalar === boundary.value
        : scalar > boundary.value;
    if (!holds) {
      violations.push({
        check: 'boundary-probe-relation-wrong',
        detail: `${contract.obligationId}: probe "${side}" extracts ${scalar} via "${path}" — must be ${side === 'below' ? '<' : side === 'at' ? '===' : '>'} ${boundary.value}`,
      });
    }
  }
  return violations;
}

/** COMPUTED decomposition completeness: every sentence of the parent unit's
 * rules text must be represented by some declared piece (assigned to a child
 * or explicitly disposed). Missing pieces ⇒ partially decomposed. */
export function unitDecompositionComplete(parentRulesText: string, pieces: readonly { text: string }[]): boolean {
  const accounted = pieces.map((piece) => piece.text.replace(/\s+/g, '')).join('');
  if (accounted.length === 0) return false;
  const sentences = parentRulesText
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  return sentences.every((sentence) => containsStripped(accounted, sentence));
}

// ---------------------------------------------------------------------------
// Integrity checks
// ---------------------------------------------------------------------------

export function checkIntegrity(world: FidelityWorld): FidelityIntegrityViolation[] {
  const violations: FidelityIntegrityViolation[] = [];

  const scopeIds = new Set(world.scopes.map((scope) => scope.id));
  const consumerIds = new Set(world.consumers.map((consumer) => consumer.id));
  const adjudicationIds = new Set(world.adjudications.map((adjudication) => adjudication.id));

  const seenObligationIds = new Set<string>();
  const obligationIds = new Set<string>();
  const obligationsById = new Map<string, SourceObligation>();
  for (const obligation of world.obligations) {
    if (seenObligationIds.has(obligation.id)) {
      violations.push({ check: 'duplicate-obligation-id', detail: obligation.id });
    }
    seenObligationIds.add(obligation.id);
    obligationIds.add(obligation.id);
    obligationsById.set(obligation.id, obligation);

    if (!scopeIds.has(obligation.scopeId)) {
      violations.push({ check: 'dangling-scope-reference', detail: `${obligation.id} → scope ${obligation.scopeId}` });
    }
    for (const consumerId of obligation.consumerIds ?? []) {
      if (!consumerIds.has(consumerId)) {
        violations.push({ check: 'dangling-consumer-reference', detail: `${obligation.id} → consumer ${consumerId}` });
      }
    }
    if (obligation.adjudicationId !== undefined && !adjudicationIds.has(obligation.adjudicationId)) {
      violations.push({ check: 'dangling-adjudication-reference', detail: `${obligation.id} → adjudication ${obligation.adjudicationId}` });
    }
    if (obligation.disposition === 'deterministic-executable' && obligation.passages.length === 0) {
      violations.push({ check: 'missing-passages', detail: `${obligation.id} claims deterministic execution with no source passage` });
    }
    for (const [index, passage] of obligation.passages.entries()) {
      if (passage.sha256 !== passageFingerprint(passage.quote)) {
        violations.push({ check: 'passage-fingerprint-mismatch', detail: `${obligation.id} passage #${index + 1}: recorded sha256 does not match its quote` });
      }
    }
    // Curated passages must sit inside their scope's declared frontier pages
    // when one exists — citing material your boundary does not even claim is
    // incoherent evidence.
    const scopeDef = world.scopes.find((scope) => scope.id === obligation.scopeId);
    if (scopeDef?.frontier && obligation.origin.kind === 'curated') {
      for (const [index, passage] of obligation.passages.entries()) {
        if (!scopeDef.frontier.pages.includes(passage.page)) {
          violations.push({
            check: 'passage-outside-frontier',
            detail: `${obligation.id} passage #${index + 1} cites p.${passage.page}, outside the frontier of scope ${scopeDef.id}`,
          });
        }
      }
    }
  }

  const contractsByObligation = new Map<string, number>();
  for (const contract of world.contracts) {
    if (!obligationIds.has(contract.obligationId)) {
      violations.push({ check: 'dangling-contract-obligation', detail: contract.obligationId });
    }
    const count = contractsByObligation.get(contract.obligationId) ?? 0;
    contractsByObligation.set(contract.obligationId, count + 1);

    // Case-shape integrity over fixture inputs (deterministic canonicalization;
    // no symbolic equivalence).
    const casesByKey = new Map<string, unknown>();
    for (const row of contract.rows ?? []) {
      const key = canonicalFixtureKey(row.input);
      const existing = casesByKey.get(key);
      if (existing !== undefined) {
        violations.push({ check: 'duplicate-contract-input', detail: `${contract.obligationId} row "${row.label}": duplicate input case` });
        if (JSON.stringify(existing) !== JSON.stringify(row.expected)) {
          violations.push({ check: 'contradictory-contract-expectations', detail: `${contract.obligationId}: contradictory expectations for input ${key}` });
        }
        continue;
      }
      casesByKey.set(key, row.expected);
    }
    if (contract.domain) {
      const domainKeys = contract.domain.map(canonicalFixtureKey);
      if (new Set(domainKeys).size !== domainKeys.length) {
        violations.push({ check: 'exhaustive-domain-duplicate', detail: `${contract.obligationId}: declared exhaustive domain contains duplicate member(s)` });
      }
    }
    if (contract.boundary) {
      const probeKeys = Object.values(contract.boundary.probes).map(canonicalFixtureKey);
      if (new Set(probeKeys).size !== probeKeys.length) {
        violations.push({ check: 'boundary-probe-duplicate', detail: `${contract.obligationId}: boundary probes below/at/above are not distinct inputs` });
      }
      violations.push(...validateBoundaryProbes(contract));
    }
  }
  for (const [obligationId, count] of contractsByObligation) {
    if (count > 1) violations.push({ check: 'duplicate-contract', detail: obligationId });
  }

  for (const proof of world.proofs) {
    if (!obligationIds.has(proof.obligationId)) {
      violations.push({ check: 'dangling-proof-obligation', detail: `${proof.file} (${proof.kind}) → ${proof.obligationId}` });
    }
    // Replay/integration claims point at EXECUTED evidence: without the bound
    // command they can never be more than traceability prose.
    if (
      (proof.evidence === 'replay' || proof.evidence === 'integration')
      && proof.command === undefined
    ) {
      violations.push({
        check: 'proof-evidence-command-missing',
        detail: `${proof.obligationId} (${proof.kind}): ${proof.evidence} evidence requires the npm script whose recorded passing run IS the evidence`,
      });
    }
  }

  // Decomposition records: ONE authoritative unit → pieces relationship.
  // Completeness is COMPUTED against the parent's actual rules text and each
  // piece must genuinely correspond to the child that claims it — an
  // unrelated obligation cannot retire a parent unit, and a missing sentence
  // leaves the unit partially decomposed. There is no load-bearing
  // "complete" flag to assert.
  const derivedUnitById = new Map<string, SourceObligation>();
  for (const obligation of world.obligations) {
    if (obligation.origin.kind === 'derived-unit') derivedUnitById.set(obligation.origin.unitId, obligation);
  }
  const decompositionsByUnit = new Map<string, number>();
  for (const decomposition of world.decompositions ?? []) {
    const count = decompositionsByUnit.get(decomposition.unitId) ?? 0;
    decompositionsByUnit.set(decomposition.unitId, count + 1);
    const parent = derivedUnitById.get(decomposition.unitId);
    if (!parent) {
      violations.push({ check: 'decomposition-dangling-piece', detail: `decomposition names unknown source unit ${decomposition.unitId}` });
      continue;
    }
    const parentText = parent.passages[0]?.quote ?? '';
    if (decomposition.pieces.length === 0) {
      violations.push({ check: 'decomposition-dangling-piece', detail: `decomposition of ${decomposition.unitId} declares no pieces` });
    }
    for (const piece of decomposition.pieces) {
      if (!containsStripped(parentText, piece.text)) {
        violations.push({ check: 'decomposition-piece-not-in-unit', detail: `${decomposition.unitId}: piece is not part of the unit's rules text: "${piece.text.slice(0, 80)}"` });
      }
      if (piece.obligationId === null) {
        if (!piece.reason || piece.reason.trim().length === 0) {
          violations.push({ check: 'decomposition-irrelevant-piece-missing-reason', detail: `${decomposition.unitId}: irrelevant piece lacks a recorded reason: "${piece.text.slice(0, 80)}"` });
        }
        continue;
      }
      const child = obligationsById.get(piece.obligationId);
      if (!child || child.origin.kind !== 'curated') {
        violations.push({ check: 'decomposition-dangling-piece', detail: `decomposition of ${decomposition.unitId} → non-curated obligation ${piece.obligationId}` });
        continue;
      }
      const childQuotes = child.passages.map((passage) => passage.quote).join(' ');
      if (!containsStripped(childQuotes, piece.text)) {
        violations.push({
          check: 'decomposition-piece-unquoted-by-child',
          detail: `${decomposition.unitId}: piece assigned to ${piece.obligationId} is not quoted by its passages — unrelated obligations cannot retire a parent unit`,
        });
      }
    }

    // Span integrity: two declared pieces may not OVERLAP — an overlap makes
    // span-coverage accounting untrustworthy even when every individual
    // sentence is present.
    const declared = decomposition.pieces;
    for (let i = 0; i < declared.length; i += 1) {
      for (let j = i + 1; j < declared.length; j += 1) {
        if (containsStripped(declared[i].text, declared[j].text) || containsStripped(declared[j].text, declared[i].text)) {
          violations.push({
            check: 'decomposition-overlapping-pieces',
            detail: `${decomposition.unitId}: declared pieces "${declared[i].text.slice(0, 40)}" and "${declared[j].text.slice(0, 40)}" overlap`,
          });
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Per-obligation status derivation
// ---------------------------------------------------------------------------

interface DerivationContext {
  consumers: ReadonlySet<string>;
  resolvedConsumers: ReadonlySet<string> | null;
  contracts: ReadonlyMap<string, SemanticContract>;
  proofs: ReadonlyMap<string, ProofRecord[]>;
  evaluations: ReadonlyMap<string, ContractEvaluation>;
  adjudications: ReadonlyMap<string, AdjudicationLink>;
  auditResults: Readonly<Record<string, 'passed' | 'failed'>> | null;
}

/** Kinds provided by non-declared proof records that carry a RECORDED PASSING
 * run of their bound command. Without the recording, replay/integration
 * evidence provides nothing (it is reported as unverified upstream). */
function recordedEvidenceKinds(
  proofs: readonly ProofRecord[] | undefined,
  auditResults: Readonly<Record<string, 'passed' | 'failed'>> | null,
): string[] {
  return (proofs ?? [])
    .filter((proof) => proof.evidence !== 'declared')
    .filter((proof) => proof.command !== undefined && auditResults?.[proof.command] === 'passed')
    .map((proof) => proof.kind);
}

// ---------------------------------------------------------------------------
// Structural proof shape — row CLASS LABELS alone prove nothing
// ---------------------------------------------------------------------------

/** Boundary proof is satisfied STRUCTURALLY: the contract must declare
 * below/at/above probe INPUTS, and each probe must appear as a passing,
 * boundary-labelled row. Relabelling a positive row cannot manufacture this:
 * the probe inputs themselves must realize all three sides of the edge. */
export function boundaryShapeSatisfied(contract: SemanticContract): boolean {
  const probes = contract.boundary?.probes;
  if (!probes) return false;
  const keys = ['below', 'at', 'above'] as const;
  const seen = new Set<string>();
  for (const side of keys) {
    const probeKey = canonicalFixtureKey(probes[side]);
    if (seen.has(probeKey)) return false; // duplicated slot proves nothing extra
    seen.add(probeKey);
    const matched = contract.rows?.some(
      (row) => row.cls === 'boundary' && canonicalFixtureKey(row.input) === probeKey,
    );
    if (!matched) return false;
  }
  return true;
}

/** Exhaustive proof is satisfied STRUCTURALLY: the declared finite domain and
 * the evaluated row inputs must be the SAME SET under deterministic
 * canonicalization — no missing member, no extra case. Duplicate cases within
 * either side are separate integrity violations, not silent collapse. */
export function exhaustiveShapeSatisfied(contract: SemanticContract): boolean {
  if (!contract.domain || contract.domain.length === 0) return false;
  const domainKeys = contract.domain.map(canonicalFixtureKey);
  if (new Set(domainKeys).size !== domainKeys.length) return false;
  const rowKeys = (contract.rows ?? []).filter((row) => row.cls === 'exhaustive').map((row) => canonicalFixtureKey(row.input));
  return new Set(rowKeys).size === domainKeys.length && domainKeys.every((key) => new Set(rowKeys).has(key));
}

/** Which required proof classes a PASSING evaluation covers with its rows —
 * verified against what was actually EXECUTED plus the contract's DECLARED
 * STRUCTURE, never just row labels:
 *
 * - the evaluation's fingerprint must match the CURRENT contract exactly
 *   (otherwise the result is STALE and certifies nothing);
 * - a passing result must record having executed EVERY row input;
 * - boundary/exhaustive proof additionally requires the probe/domain fixture
 *   keys among the recorded EXECUTED inputs. */
function structuralEvaluatedProofKinds(
  contract: SemanticContract,
  evaluation: ContractEvaluation | undefined,
): { kinds: string[]; passed: boolean; ran: boolean; stale?: boolean } {
  if (!evaluation) return { kinds: [], passed: false, ran: false };
  // Anti-staleness binding: a result computed against a DIFFERENT VERSION of
  // this contract says nothing about the current one.
  if (evaluation.contractFingerprint !== contractFingerprint(contract)) {
    return { kinds: [], passed: false, ran: true, stale: true };
  }
  if (!evaluation.passed) return { kinds: [], passed: false, ran: true };
  const executed = new Set(evaluation.executedInputKeys ?? []);
  const rowKeys = (contract.rows ?? []).map((row) => canonicalFixtureKey(row.input));
  if (rowKeys.length === 0 || !rowKeys.every((key) => executed.has(key))) {
    // Claims a pass over rows that were never run.
    return { kinds: [], passed: false, ran: true };
  }
  const coveredClasses = new Set<ContractRowClass>(contract.rows?.map((row) => row.cls) ?? []);
  const kinds = REQUIRED_PROOF_KINDS[contract.kind].filter((kind) => {
    if (kind === 'positive' || kind === 'negative') return coveredClasses.has(kind as ContractRowClass);
    if (kind === 'boundary') {
      return boundaryShapeSatisfied(contract)
        && (['below', 'at', 'above'] as const).every((side) =>
          executed.has(canonicalFixtureKey(contract.boundary!.probes[side])));
    }
    if (kind === 'exhaustive') {
      return exhaustiveShapeSatisfied(contract)
        && (contract.domain ?? []).every((member) => executed.has(canonicalFixtureKey(member)));
    }
    return false; // invariant/replay are never evaluator-derived
  });
  return { kinds, passed: true, ran: true };
}

function deriveStatus(
  obligation: SourceObligation,
  context: DerivationContext,
): { status: ObligationStatus; blockers: string[]; missingProofKinds?: string[] } {
  if (obligation.disposition === 'unclassified') {
    return { status: 'unclassified', blockers: ['obligation is not yet classified'] };
  }

  if (obligation.disposition === 'conflicted') {
    if (!obligation.adjudicationId) {
      return { status: 'conflicted-unadjudicated', blockers: ['source conflict has no linked adjudication'] };
    }
    const adjudication = context.adjudications.get(obligation.adjudicationId);
    if (!adjudication || adjudication.status !== 'adopted') {
      return { status: 'conflicted-unadjudicated', blockers: [`adjudication ${obligation.adjudicationId} is not adopted`] };
    }
    // An adopted adjudication governs the reading; the obligation continues
    // down the executable path below.
  }

  switch (obligation.disposition) {
    case 'table-facing':
      return { status: 'table-facing', blockers: [] };
    case 'deferred':
      return { status: 'deferred', blockers: ['intentionally deferred'] };
    case 'descriptive':
      return { status: 'descriptive', blockers: [] };
    case 'gm-facing':
      return { status: 'gm-facing', blockers: ['requires GM/table judgment'] };
    case 'player-choice': {
      // The source says the PLAYER chooses — that is not the same as "the
      // software has nothing to implement". An explicit automation decision
      // is required either way.
      const automation = obligation.choice?.automation;
      if (automation === 'table-only') {
        // Intentional non-runtime disposition; delegation is the product behavior.
        return { status: 'player-choice', blockers: [] };
      }
      if (automation === 'runtime-supported') {
        // Claims the full choice workflow (pending representation, legal-
        // choice validation, persistence, replay): same evidence path as a
        // deterministic obligation, PLUS mandatory replay proof below.
        break;
      }
      return { status: 'player-choice', blockers: ['player-choice obligation has no explicit table-only/runtime-supported automation decision'] };
    }
    case 'conflicted':
    case 'deterministic-executable':
      break;
  }

  // Deterministic-executable path.
  const registeredConsumers = (obligation.consumerIds ?? []).filter((id) => context.consumers.has(id));
  const unresolvedConsumer = registeredConsumers.some((id) => context.resolvedConsumers !== null && !context.resolvedConsumers.has(id));
  if (registeredConsumers.length === 0 || unresolvedConsumer) {
    return {
      status: 'unimplemented',
      blockers: [unresolvedConsumer ? 'a registered consumer does not resolve' : 'no registered executable consumer'],
    };
  }
  const contract = context.contracts.get(obligation.id);
  if (!contract) {
    return { status: 'implemented-no-contract', blockers: ['no independent semantic contract'] };
  }
  if (!contract.rows || contract.rows.length === 0) {
    // A prose-only contract cannot certify semantics.
    const required = [...REQUIRED_PROOF_KINDS[contract.kind]];
    if (contract.stateful) required.push('replay');
    return {
      status: 'implemented-unproven',
      blockers: ['semantic contract carries no machine-checkable expectation rows'],
      missingProofKinds: required,
    };
  }

  const evaluation = context.evaluations.get(obligation.id);
  const evaluated = structuralEvaluatedProofKinds(contract, evaluation);
  if (!evaluated.ran) {
    return {
      status: 'implemented-unproven',
      blockers: ['semantic contract was never executed against the implementation'],
      missingProofKinds: [...REQUIRED_PROOF_KINDS[contract.kind]],
    };
  }
  if (evaluated.stale) {
    return {
      status: 'implemented-unproven',
      blockers: ['recorded evaluation is STALE: it was computed against a different version of this contract'],
      missingProofKinds: [...REQUIRED_PROOF_KINDS[contract.kind]],
    };
  }
  if (!evaluated.passed) {
    const reason = evaluation!.passed
      ? 'passing evaluation did not actually execute every contract row'
      : `semantic evaluation FAILED (${evaluation!.failures.length} row(s))`;
    return {
      status: 'implemented-unproven',
      blockers: [reason],
      missingProofKinds: [...REQUIRED_PROOF_KINDS[contract.kind]],
    };
  }

  const provided = new Set<string>([
    ...evaluated.kinds,
    ...recordedEvidenceKinds(context.proofs.get(obligation.id), context.auditResults),
  ]);
  const missing = REQUIRED_PROOF_KINDS[contract.kind].filter((kind) => !provided.has(kind));
  if (contract.stateful && !provided.has('replay')) missing.push('replay');
  if (obligation.disposition === 'player-choice' && !provided.has('replay')) missing.push('replay');
  if (missing.length > 0) {
    return {
      status: 'implemented-unproven',
      blockers: missing.map((kind) => `missing required ${kind} proof`),
      missingProofKinds: missing,
    };
  }
  return { status: 'proven-supported', blockers: [] };
}

// ---------------------------------------------------------------------------
// Frontier coverage
// ---------------------------------------------------------------------------

interface FrontierAccounting {
  total: number;
  covered: number;
  irrelevant: number;
  doubleAccounted: number;
  uncoveredIds: string[];
}

/** Attribution-based frontier accounting: a clause counts as COVERED only
 * through an explicit attribution entry — verified at resolution time against
 * the named obligation's own passages. Containment alone is PROVENANCE, never
 * coverage: a large quotation cannot sweep every clause inside it into
 * "covered". A clause both dispositioned and attributed is conservatively
 * UNCOVERED here; resolution already raised the integrity violation. */
function accountFrontier(input: ScopeFrontierInput): FrontierAccounting {
  const irrelevant = new Set(input.irrelevantIds);
  const attributed = new Set(input.attributedIds);
  const uncoveredIds: string[] = [];
  let covered = 0;
  let irrelevantCount = 0;
  let doubleAccounted = 0;
  for (const clause of input.clauses) {
    const dispositioned = irrelevant.has(clause.id);
    const attributedClause = attributed.has(clause.id);
    if (dispositioned && attributedClause) {
      doubleAccounted += 1;
      uncoveredIds.push(clause.id);
      continue;
    }
    if (dispositioned) {
      irrelevantCount += 1;
      continue;
    }
    if (attributedClause) {
      covered += 1;
    } else {
      uncoveredIds.push(clause.id);
    }
  }
  return { total: input.clauses.length, covered, irrelevant: irrelevantCount, doubleAccounted, uncoveredIds };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeFidelityAudit(world: FidelityWorld, inputs: AuditInputs = {}): FidelityAuditResult {
  const integrityViolations = checkIntegrity(world);
  const consumers = new Set(world.consumers.map(({ id }) => id));
  const resolvedConsumers = inputs.resolvedConsumerIds ? new Set(inputs.resolvedConsumerIds) : null;
  const contracts = new Map(world.contracts.map((contract) => [contract.obligationId, contract]));
  const proofs = new Map<string, ProofRecord[]>();
  for (const proof of world.proofs) {
    const list = proofs.get(proof.obligationId) ?? [];
    list.push(proof);
    proofs.set(proof.obligationId, list);
  }
  const evaluations = new Map((inputs.evaluations ?? []).map((evaluation) => [evaluation.obligationId, evaluation]));
  const adjudications = new Map(world.adjudications.map((adjudication) => [adjudication.id, adjudication]));
  const auditResults = inputs.auditResults ?? null;
  const context: DerivationContext = { consumers, resolvedConsumers, contracts, proofs, evaluations, adjudications, auditResults };

  // Decomposition census over catalogued units — completeness is COMPUTED
  // from piece coverage of each parent's rules text, never asserted.
  const decompositionByUnit = new Map<string, { pieces: readonly UnitDecompositionPiece[]; complete: boolean }>();
  for (const decomposition of world.decompositions ?? []) {
    if (!decompositionByUnit.has(decomposition.unitId)) {
      const parent = world.obligations.find(
        (obligation) => obligation.origin.kind === 'derived-unit' && obligation.origin.unitId === decomposition.unitId,
      );
      const parentRulesText = parent?.passages[0]?.quote ?? '';
      decompositionByUnit.set(decomposition.unitId, {
        pieces: decomposition.pieces,
        complete: unitDecompositionComplete(parentRulesText, decomposition.pieces),
      });
    }
  }

  const findings: ObligationFinding[] = world.obligations.map((obligation) => {
    if (
      obligation.origin.kind === 'derived-unit'
      && obligation.disposition === 'unclassified'
      && decompositionByUnit.has(obligation.origin.unitId)
    ) {
      const record = decompositionByUnit.get(obligation.origin.unitId)!;
      if (record.complete) {
        return {
          obligationId: obligation.id,
          scopeId: obligation.scopeId,
          disposition: obligation.disposition,
          status: 'decomposed',
          blockers: [],
        } satisfies ObligationFinding;
      }
      return {
        obligationId: obligation.id,
        scopeId: obligation.scopeId,
        disposition: obligation.disposition,
        status: 'partially-decomposed',
        blockers: [`unit ${obligation.origin.unitId} has only a partial decomposition`],
      } satisfies ObligationFinding;
    }
    const { status, blockers, missingProofKinds } = deriveStatus(obligation, context);
    return {
      obligationId: obligation.id,
      scopeId: obligation.scopeId,
      disposition: obligation.disposition,
      status,
      blockers,
      ...(missingProofKinds ? { missingProofKinds } : {}),
    };
  });

  const findingsByScope = new Map<string, ObligationFinding[]>();
  const obligationsByScope = new Map<string, SourceObligation[]>();
  for (let i = 0; i < findings.length; i += 1) {
    const finding = findings[i];
    const obligation = world.obligations[i];
    (findingsByScope.get(finding.scopeId) ?? findingsByScope.set(finding.scopeId, []).get(finding.scopeId)!).push(finding);
    (obligationsByScope.get(obligation.scopeId) ?? obligationsByScope.set(obligation.scopeId, []).get(obligation.scopeId)!).push(obligation);
  }

  const frontierInputs = new Map((inputs.frontiers ?? []).map((input) => [input.scopeId, input]));
  const failingEvaluationSummaries = (inputs.evaluations ?? [])
    .filter(({ passed }) => !passed)
    .map(({ obligationId, failures }) => ({ obligationId, failures: failures.length }));

  const scopeResults: ScopeResult[] = world.scopes.map((scopeDef) => {
    const scopeFindings = findingsByScope.get(scopeDef.id) ?? [];
    const scopeObligations = obligationsByScope.get(scopeDef.id) ?? [];
    const deterministicFindingsInScope = scopeFindings.filter(
      ({ disposition }) => disposition === 'deterministic-executable' || disposition === 'conflicted',
    );

    // Ladder predicates, computed bottom-up per rung.
    const unknownMaterial = scopeFindings.some(({ status }) => status === 'unclassified' || status === 'partially-decomposed');
    const conflictedUnadjudicated = scopeFindings.filter(({ status }) => status === 'conflicted-unadjudicated');

    const frontierInput = frontierInputs.get(scopeDef.id);
    const frontier = frontierInput ? accountFrontier(frontierInput) : null;

    // Per-deterministic-obligation evidence flags.
    const evidence = deterministicFindingsInScope.map((finding) => {
      const obligation = world.obligations.find((o) => o.id === finding.obligationId)!;
      const contract = contracts.get(obligation.id);
      const registeredConsumers = (obligation.consumerIds ?? []).filter((id) => consumers.has(id));
      const consumersResolve = registeredConsumers.length > 0
        && (resolvedConsumers === null || registeredConsumers.every((id) => resolvedConsumers.has(id)));
      const hasRows = contract !== undefined && (contract.rows?.length ?? 0) > 0;
      const evaluated = hasRows ? structuralEvaluatedProofKinds(contract!, evaluations.get(obligation.id)) : null;
      // Stale or row-skipping results do not count as executed evidence.
      const evaluatedPass = evaluated !== null && evaluated.ran && !evaluated.stale && evaluated.passed;
      const evaluatedKinds = evaluatedPass ? evaluated.kinds : [];
      const provided = new Set<string>([
        ...evaluatedKinds,
        ...(proofs.get(obligation.id) ?? []).filter((p) => p.evidence !== 'declared').map((p) => p.kind),
      ]);
      // Replay is deliberately NOT folded into the class gate: a stateful
      // contract without declared replay evidence must land on the
      // `executable` rung (via statefulWithoutReplay below), not on
      // `partial` — each ladder rung adds exactly one predicate.
      const requiredKinds = hasRows ? REQUIRED_PROOF_KINDS[contract!.kind] : [];
      const classesOk = hasRows && requiredKinds.every((kind) => provided.has(kind));
      return { obligation, contract, consumersResolve, hasRows, evaluatedPass, classesOk, fullyProven: finding.status === 'proven-supported' };
    });

    const allDeterministicResolvedAndExecuted = evidence.length > 0
      && evidence.every((entry) => entry.consumersResolve && entry.hasRows && entry.evaluatedPass && entry.classesOk);
    const statefulWithoutReplay = evidence.some((entry) => {
      if (!entry.contract?.stateful) return false;
      return !recordedEvidenceKinds(proofs.get(entry.obligation.id), auditResults).includes('replay');
    });
    const integrationRequired = scopeDef.closure?.requiresIntegrationEvidence ?? false;
    // Integration evidence is EXECUTED evidence: the bound command must have
    // a recorded passing run in this authority pass.
    const integrationPresent = !integrationRequired
      || recordedEvidenceKinds(proofs.get(`scope:${scopeDef.id}`), auditResults).includes('integration');

    // Non-deterministic closure gates.
    const deferredPresent = scopeFindings.some(({ status: s }) => s === 'deferred');
    const findingsByObligation = new Map(scopeFindings.map(({ obligationId, status: s }) => [obligationId, s]));
    const runtimeChoiceGapIds = scopeObligations
      .filter((obligation) => obligation.disposition === 'player-choice')
      .filter((obligation) => {
        // Undecided choices can never support closure; table-only choices are
        // intentionally non-runtime and accounted; runtime-supported claims
        // must actually be PROVEN.
        if (obligation.choice === undefined) return true;
        if (obligation.choice.automation === 'runtime-supported') {
          return findingsByObligation.get(obligation.id) !== 'proven-supported';
        }
        return false;
      })
      .map(({ id }) => id);

    // Frontier gates: a scope without a declared source frontier can never
    // be source-accounted; a frontier resolving to ZERO clauses is vacuous;
    // uncovered clauses mean incomplete accounting.
    const declaredFrontier = scopeDef.frontier !== undefined;
    const frontierAccounted = declaredFrontier && frontier !== null && frontier.total > 0 && frontier.uncoveredIds.length === 0;
    const frontierVacuousOrUnresolved = declaredFrontier && (frontier === null || frontier.total === 0);

    // Rung selection — each rung strictly adds exactly one predicate:
    //   closed ⊃ replay-tested ⊃ source-tested ⊃ executable ⊃ partial ⊃ blocked
    let status: ScopeStatus;
    if (unknownMaterial || conflictedUnadjudicated.length > 0) {
      status = 'blocked';
    } else if (
      evidence.length === 0
      || !allDeterministicResolvedAndExecuted
      || deferredPresent
      || runtimeChoiceGapIds.length > 0
    ) {
      status = 'partial';
    } else if (!frontierAccounted) {
      status = 'executable';
    } else if (statefulWithoutReplay) {
      status = 'source-tested';
    } else if (!integrationPresent) {
      status = 'replay-tested';
    } else {
      status = 'closed';
    }

    const result: ScopeResult = {
      scopeId: scopeDef.id,
      title: scopeDef.title,
      totalObligations: scopeFindings.length,
      unclassified: scopeFindings.filter(({ status: s }) => s === 'unclassified').length,
      deterministicExecutable: deterministicFindingsInScope.length,
      provenSupported: scopeFindings.filter(({ status: s }) => s === 'proven-supported').length,
      implementedUnproven: scopeFindings.filter(({ status: s }) => s === 'implemented-unproven').length,
      implementedNoContract: scopeFindings.filter(({ status: s }) => s === 'implemented-no-contract').length,
      unimplemented: scopeFindings.filter(({ status: s }) => s === 'unimplemented').length,
      conflictedUnadjudicated: conflictedUnadjudicated.length,
      decomposed: scopeFindings.filter(({ status: s }) => s === 'decomposed').length,
      partiallyDecomposed: scopeFindings.filter(({ status: s }) => s === 'partially-decomposed').length,
      tableFacing: scopeFindings.filter(({ status: s }) => s === 'table-facing').length,
      deferred: scopeFindings.filter(({ status: s }) => s === 'deferred').length,
      descriptive: scopeFindings.filter(({ status: s }) => s === 'descriptive').length,
      gmFacing: scopeFindings.filter(({ status: s }) => s === 'gm-facing').length,
      playerChoice: scopeFindings.filter(({ status: s }) => s === 'player-choice').length,
      unimplementedIds: scopeFindings.filter(({ status: s }) => s === 'unimplemented').map(({ obligationId }) => obligationId),
      lackingRequiredProof: scopeFindings
        .filter(({ missingProofKinds }) => missingProofKinds && missingProofKinds.length > 0)
        .map(({ obligationId, missingProofKinds }) => ({ obligationId, missing: missingProofKinds ?? [] })),
      unresolvedConflicts: conflictedUnadjudicated.map(({ obligationId }) => obligationId),
      evaluatorFailures: failingEvaluationSummaries,
      frontierTotalClauses: frontier?.total ?? 0,
      frontierCoveredClauses: frontier?.covered ?? 0,
      frontierIrrelevantClauses: frontier?.irrelevant ?? 0,
      frontierUncoveredIds: frontier?.uncoveredIds ?? [],
      status,
      blockers: [],
    };

    const blockers: string[] = [];
    if (result.unclassified > 0) blockers.push(`${result.unclassified} unclassified obligation(s)`);
    if (result.partiallyDecomposed > 0) blockers.push(`${result.partiallyDecomposed} partially-decomposed unit(s)`);
    if (result.conflictedUnadjudicated > 0) blockers.push(`${result.conflictedUnadjudicated} unresolved source conflict(s)`);
    if (result.unimplemented > 0) blockers.push(`${result.unimplemented} deterministic obligation(s) without a resolving registered consumer`);
    if (result.implementedNoContract > 0) blockers.push(`${result.implementedNoContract} implemented claim(s) without a machine-readable semantic contract`);
    if (result.implementedUnproven > 0) blockers.push(`${result.implementedUnproven} implemented claim(s) lacking executed/declared proof`);
    for (const failure of result.evaluatorFailures) {
      blockers.push(`semantic evaluation FAILED for ${failure.obligationId} (${failure.failures} row(s))`);
    }
    if (deferredPresent) blockers.push('a relevant deferred obligation blocks closure');
    for (const gapId of runtimeChoiceGapIds) {
      blockers.push(`player-choice obligation ${gapId} lacks an explicit table-only disposition or proven runtime workflow`);
    }
    if (statefulWithoutReplay) blockers.push('a stateful contract lacks replay evidence');
    if (!integrationPresent) blockers.push('required integration evidence is absent');
    if (!declaredFrontier) blockers.push('scope has no declared source frontier');
    if (frontierVacuousOrUnresolved) blockers.push('declared source frontier resolves to zero clauses (vacuous boundary)');
    if (frontier && frontier.doubleAccounted > 0) {
      blockers.push(`${frontier.doubleAccounted} frontier clause(s) are DOUBLE-accounted (both dispositioned and attributed)`);
    }
    if (frontier && frontier.uncoveredIds.length > 0) {
      blockers.push(`${frontier.uncoveredIds.length} uncovered frontier clause(s): ${frontier.uncoveredIds.slice(0, 5).join(', ')}${frontier.uncoveredIds.length > 5 ? ', …' : ''}`);
    }
    result.blockers = blockers;

    return result;
  });

  const deterministicFindings = findings.filter(({ disposition }) => disposition === 'deterministic-executable' || disposition === 'conflicted');
  const failingEvaluations = (inputs.evaluations ?? []).filter(({ passed }) => !passed);

  const unitsFullyDecomposed = [...decompositionByUnit.entries()]
    .filter(([, record]) => record.complete)
    .map(([unitId]) => unitId)
    .sort();
  const unitsPartiallyDecomposed = [...decompositionByUnit.entries()]
    .filter(([, record]) => !record.complete)
    .map(([unitId]) => unitId)
    .sort();
  const derivedTotal = world.obligations.filter((o) => o.origin.kind === 'derived-unit').length;

  return {
    summary: {
      totalObligations: findings.length,
      classified: findings.filter(({ status }) => status !== 'unclassified' && status !== 'partially-decomposed').length,
      unclassified: findings.filter(({ status }) => status === 'unclassified' || status === 'partially-decomposed').length,
      deterministicObligations: deterministicFindings.length,
      implementedDeterministic: deterministicFindings.filter(({ status }) => ['proven-supported', 'implemented-unproven', 'implemented-no-contract'].includes(status)).length,
      lackingExecution: deterministicFindings.filter(({ status }) => status === 'unimplemented').map(({ obligationId }) => obligationId),
      lackingRequiredProof: findings
        .filter(({ missingProofKinds }) => missingProofKinds && missingProofKinds.length > 0)
        .map(({ obligationId, missingProofKinds }) => ({ obligationId, missing: missingProofKinds ?? [] })),
      unresolvedConflicts: findings.filter(({ status }) => status === 'conflicted-unadjudicated').map(({ obligationId }) => obligationId),
      tableFacing: findings.filter(({ status }) => status === 'table-facing').length,
      deferredUnsupported: findings.filter(({ status }) => status === 'deferred').length,
      integrityViolations,
      evaluationsRun: (inputs.evaluations ?? []).length,
      evaluationsPassed: (inputs.evaluations ?? []).filter(({ passed }) => passed).length,
      evaluationsFailed: failingEvaluations.map(({ obligationId }) => obligationId),
      unitsFullyDecomposed,
      unitsPartiallyDecomposed,
      unitsUntouched: Math.max(0, derivedTotal - decompositionByUnit.size),
      frontierScopes: (inputs.frontiers ?? []).map((input) => {
        const accounting = accountFrontier(input);
        return { scopeId: input.scopeId, total: accounting.total, covered: accounting.covered, irrelevant: accounting.irrelevant, uncovered: accounting.uncoveredIds.length };
      }),
    },
    findings,
    scopes: scopeResults,
  };
}
