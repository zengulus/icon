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
  ProofRecord,
  ScopeDefinition,
  ScopeFrontierInput,
  ScopeResult,
  ScopeStatus,
  SemanticContract,
  SourceObligation,
} from './types.js';
import { REQUIRED_PROOF_KINDS } from './types.js';
import { clauseCoveredBy } from './provenance.js';

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
}

const ROW_CLASS_PROOF_KINDS: readonly string[] = ['positive', 'boundary', 'negative', 'invariant', 'exhaustive'];

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
  }
  for (const [obligationId, count] of contractsByObligation) {
    if (count > 1) violations.push({ check: 'duplicate-contract', detail: obligationId });
  }

  for (const proof of world.proofs) {
    if (!obligationIds.has(proof.obligationId)) {
      violations.push({ check: 'dangling-proof-obligation', detail: `${proof.file} (${proof.kind}) → ${proof.obligationId}` });
    }
  }

  // Decomposition records: explicit unit → obligations relationship. Prevents
  // shadow double-counting where curated fragments coexist with the original
  // unit-grain catch-all without any linkage.
  const derivedUnitIds = new Set(
    world.obligations.filter((o) => o.origin.kind === 'derived-unit').map((o) => o.origin.kind === 'derived-unit' ? o.origin.unitId : ''),
  );
  const decompositionsByUnit = new Map<string, number>();
  for (const decomposition of world.decompositions ?? []) {
    const count = decompositionsByUnit.get(decomposition.unitId) ?? 0;
    decompositionsByUnit.set(decomposition.unitId, count + 1);
    if (!derivedUnitIds.has(decomposition.unitId)) {
      violations.push({ check: 'decomposition-dangling-obligation', detail: `decomposition names unknown source unit ${decomposition.unitId}` });
    }
    for (const obligationId of decomposition.obligationIds) {
      const obligation = obligationsById.get(obligationId);
      if (!obligation || obligation.origin.kind !== 'curated') {
        violations.push({ check: 'decomposition-dangling-obligation', detail: `decomposition of ${decomposition.unitId} → non-curated obligation ${obligationId}` });
      }
    }
  }
  for (const [, count] of decompositionsByUnit) {
    if (count > 1) violations.push({ check: 'duplicate-unit-decomposition', detail: `unit has more than one decomposition record` });
  }
  for (const obligation of world.obligations) {
    for (const unitId of obligation.supersedesUnits ?? []) {
      const record = (world.decompositions ?? []).find((d) => d.unitId === unitId);
      if (!record || !record.obligationIds.includes(obligation.id)) {
        violations.push({
          check: 'decomposition-supersede-mismatch',
          detail: `${obligation.id} supersedes ${unitId} without a matching decomposition record listing it`,
        });
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
}

/** Which required proof classes a PASSING evaluation covers with its rows. */
function evaluatedProofKinds(contract: SemanticContract, evaluation: ContractEvaluation | undefined): { kinds: string[]; passed: boolean; ran: boolean } {
  if (!evaluation) return { kinds: [], passed: false, ran: false };
  if (!evaluation.passed) return { kinds: [], passed: false, ran: true };
  const coveredClasses = new Set<ContractRowClass>(contract.rows?.map((row) => row.cls) ?? []);
  return {
    kinds: REQUIRED_PROOF_KINDS[contract.kind].filter((kind) => ROW_CLASS_PROOF_KINDS.includes(kind) && coveredClasses.has(kind as ContractRowClass)),
    passed: true,
    ran: true,
  };
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
    case 'player-choice':
      return { status: 'player-choice', blockers: ['requires a durable player choice'] };
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
  const evaluated = evaluatedProofKinds(contract, evaluation);
  if (!evaluated.ran) {
    return {
      status: 'implemented-unproven',
      blockers: ['semantic contract was never executed against the implementation'],
      missingProofKinds: [...REQUIRED_PROOF_KINDS[contract.kind]],
    };
  }
  if (!evaluated.passed) {
    return {
      status: 'implemented-unproven',
      blockers: [`semantic evaluation FAILED (${evaluation!.failures.length} row(s))`],
      missingProofKinds: [...REQUIRED_PROOF_KINDS[contract.kind]],
    };
  }

  const provided = new Set<string>([
    ...evaluated.kinds,
    ...(context.proofs.get(obligation.id) ?? [])
      .filter((proof) => proof.evidence !== 'declared')
      .map((proof) => proof.kind),
  ]);
  const missing = REQUIRED_PROOF_KINDS[contract.kind].filter((kind) => !provided.has(kind));
  if (contract.stateful && !provided.has('replay')) missing.push('replay');
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
  uncoveredIds: string[];
}

function accountFrontier(input: ScopeFrontierInput, scopeObligations: readonly SourceObligation[]): FrontierAccounting {
  const irrelevant = new Set(input.irrelevantIds);
  const uncoveredIds: string[] = [];
  let covered = 0;
  let irrelevantCount = 0;
  for (const clause of input.clauses) {
    if (irrelevant.has(clause.id)) {
      irrelevantCount += 1;
      continue;
    }
    if (clauseCoveredBy(clause, scopeObligations)) {
      covered += 1;
    } else {
      uncoveredIds.push(clause.id);
    }
  }
  return { total: input.clauses.length, covered, irrelevant: irrelevantCount, uncoveredIds };
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
  const context: DerivationContext = { consumers, resolvedConsumers, contracts, proofs, evaluations, adjudications };

  // Decomposition census over catalogued units.
  const decompositionByUnit = new Map<string, { obligationIds: readonly string[]; complete: boolean }>();
  for (const decomposition of world.decompositions ?? []) {
    if (!decompositionByUnit.has(decomposition.unitId)) {
      decompositionByUnit.set(decomposition.unitId, { obligationIds: decomposition.obligationIds, complete: decomposition.complete });
    }
  }
  const supersededUnits = new Set<string>();
  for (const obligation of world.obligations) {
    if (obligation.origin.kind === 'derived-unit' && decompositionByUnit.get(obligation.origin.unitId)?.complete) {
      supersededUnits.add(obligation.id);
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
    const frontier = frontierInput ? accountFrontier(frontierInput, scopeObligations) : null;

    // Per-deterministic-obligation evidence flags.
    const evidence = deterministicFindingsInScope.map((finding) => {
      const obligation = world.obligations.find((o) => o.id === finding.obligationId)!;
      const contract = contracts.get(obligation.id);
      const registeredConsumers = (obligation.consumerIds ?? []).filter((id) => consumers.has(id));
      const consumersResolve = registeredConsumers.length > 0
        && (resolvedConsumers === null || registeredConsumers.every((id) => resolvedConsumers.has(id)));
      const hasRows = contract !== undefined && (contract.rows?.length ?? 0) > 0;
      const evaluation = evaluations.get(obligation.id);
      const evaluatedPass = hasRows && evaluation !== undefined && evaluation.passed;
      const evaluatedKinds = evaluatedPass ? evaluatedProofKinds(contract!, evaluation).kinds : [];
      const provided = new Set<string>([
        ...evaluatedKinds,
        ...(proofs.get(obligation.id) ?? []).filter((p) => p.evidence !== 'declared').map((p) => p.kind),
      ]);
      const requiredKinds = hasRows ? [...REQUIRED_PROOF_KINDS[contract!.kind]] : [];
      if (hasRows && contract!.stateful) requiredKinds.push('replay');
      const classesOk = hasRows && requiredKinds.every((kind) => provided.has(kind));
      return { obligation, contract, consumersResolve, hasRows, evaluatedPass, classesOk, fullyProven: finding.status === 'proven-supported' };
    });

    const allDeterministicResolvedAndExecuted = evidence.length > 0
      && evidence.every((entry) => entry.consumersResolve && entry.hasRows && entry.evaluatedPass && entry.classesOk);
    const statefulWithoutReplay = evidence.some((entry) => {
      if (!entry.contract?.stateful) return false;
      return !(proofs.get(entry.obligation.id) ?? []).some((proof) => proof.kind === 'replay');
    });
    const integrationRequired = scopeDef.closure?.requiresIntegrationEvidence ?? false;
    const integrationPresent = !integrationRequired
      || (proofs.get(`scope:${scopeDef.id}`) ?? []).some((proof) => proof.kind === 'integration');

    // Rung selection — each rung strictly adds one predicate.
    let status: ScopeStatus;
    if (unknownMaterial || conflictedUnadjudicated.length > 0) {
      status = 'blocked';
    } else if (evidence.length === 0 || !allDeterministicResolvedAndExecuted || (frontier !== null && frontier.uncoveredIds.length > 0)) {
      status = 'partial';
    } else if (statefulWithoutReplay) {
      status = 'executable';
    } else if (!integrationPresent) {
      status = 'source-tested';
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
    if (statefulWithoutReplay) blockers.push('a stateful contract lacks replay evidence');
    if (!integrationPresent) blockers.push('required integration evidence is absent');
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
        const accounting = accountFrontier(input, obligationsByScope.get(input.scopeId) ?? []);
        return { scopeId: input.scopeId, total: accounting.total, covered: accounting.covered, irrelevant: accounting.irrelevant, uncovered: accounting.uncoveredIds.length };
      }),
    },
    findings,
    scopes: scopeResults,
  };
}
