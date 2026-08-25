/**
 * fidelity/engine.ts — the pure status-derivation core of the strict
 * source-fidelity audit.
 *
 * Given a `FidelityWorld` (obligations, dispositions, contracts, proofs,
 * consumers, adjudications, scopes) this module COMPUTES:
 *
 *   - per-obligation status (never asserted anywhere);
 *   - per-scope capability/closure status on the repository's ladder;
 *   - global counters answering the canonical audit questions;
 *   - integrity violations (dangling references, fingerprint mismatches).
 *
 * Failure philosophy: legitimate incompleteness (unclassified obligations,
 * unimplemented rules) LOWERS status but does not by itself make the build
 * red. INCONSISTENT CLAIMS OF COMPLETENESS — an executable claim without a
 * consumer, a proven claim without required proof, a conflict used without
 * adjudication, dangling references — are integrity violations and fail
 * strict mode. Unknown never collapses into supported.
 */

import { createHash } from 'node:crypto';
import type {
  AdjudicationLink,
  ConsumerRegistration,
  FidelityAuditResult,
  FidelityIntegrityViolation,
  FidelityWorld,
  ObligationFinding,
  ObligationStatus,
  ProofRecord,
  ScopeDefinition,
  ScopeResult,
  ScopeStatus,
  SemanticContract,
  SourceObligation,
} from './types.js';
import { REQUIRED_PROOF_KINDS } from './types.js';

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
  for (const obligation of world.obligations) {
    if (seenObligationIds.has(obligation.id)) {
      violations.push({ check: 'duplicate-obligation-id', detail: obligation.id });
    }
    seenObligationIds.add(obligation.id);
    obligationIds.add(obligation.id);

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
  }

  const contractsByObligation = new Map<string, number>();
  for (const contract of world.contracts) {
    if (!obligationIds.has(contract.obligationId)) {
      violations.push({ check: 'dangling-contract-obligation', detail: contract.obligationId });
    }
    const count = contractsByObligation.get(contract.obligationId) ?? 0;
    if (count > 0) {
      violations.push({ check: 'duplicate-contract', detail: contract.obligationId });
    }
    contractsByObligation.set(contract.obligationId, count + 1);
  }

  for (const proof of world.proofs) {
    if (!obligationIds.has(proof.obligationId)) {
      violations.push({ check: 'dangling-proof-obligation', detail: `${proof.file} (${proof.kind}) → ${proof.obligationId}` });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Per-obligation status derivation
// ---------------------------------------------------------------------------

interface DerivationContext {
  consumers: ReadonlySet<string>;
  contracts: ReadonlyMap<string, SemanticContract>;
  proofs: ReadonlyMap<string, ProofRecord[]>;
  adjudications: ReadonlyMap<string, AdjudicationLink>;
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
  if (registeredConsumers.length === 0) {
    return { status: 'unimplemented', blockers: ['no registered executable consumer'] };
  }
  const contract = context.contracts.get(obligation.id);
  if (!contract) {
    return { status: 'implemented-no-contract', blockers: ['no independent semantic contract'] };
  }

  const provided = new Set<string>((context.proofs.get(obligation.id) ?? []).map((proof) => proof.kind));
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
// Scope closure
// ---------------------------------------------------------------------------

function scopeIntegrationEvidencePresent(scope: ScopeDefinition, proofs: ReadonlyMap<string, ProofRecord[]>): boolean {
  if (!scope.closure?.requiresIntegrationEvidence) return true;
  return (proofs.get(`scope:${scope.id}`) ?? []).some((proof) => proof.kind === 'integration');
}

function computeScopeStatus(scope: ScopeResult, scopeDef: ScopeDefinition, statefulWithoutReplay: boolean, integrationOk: boolean): ScopeStatus {
  if (scope.unclassified > 0 || scope.conflictedUnadjudicated > 0) return 'blocked';
  const deterministic = scope.deterministicExecutable;
  if (deterministic === 0) {
    // Every obligation carries an explicit non-executable disposition;
    // closure needs only the declared extra evidence.
    return integrationOk ? 'closed' : 'source-tested';
  }
  if (scope.provenSupported < deterministic) return 'partial';
  if (statefulWithoutReplay) return 'source-tested';
  if (!integrationOk) return 'replay-tested';
  void scopeDef;
  return 'closed';
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeFidelityAudit(world: FidelityWorld): FidelityAuditResult {
  const integrityViolations = checkIntegrity(world);
  const consumers = new Set(world.consumers.map(({ id }) => id));
  const contracts = new Map(world.contracts.map((contract) => [contract.obligationId, contract]));
  const proofs = new Map<string, ProofRecord[]>();
  for (const proof of world.proofs) {
    const list = proofs.get(proof.obligationId) ?? [];
    list.push(proof);
    proofs.set(proof.obligationId, list);
  }
  const adjudications = new Map(world.adjudications.map((adjudication) => [adjudication.id, adjudication]));
  const context: DerivationContext = { consumers, contracts, proofs, adjudications };

  const findings: ObligationFinding[] = world.obligations.map((obligation) => {
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
  for (const finding of findings) {
    const list = findingsByScope.get(finding.scopeId) ?? [];
    list.push(finding);
    findingsByScope.set(finding.scopeId, list);
  }

  const scopeResults: ScopeResult[] = world.scopes.map((scopeDef) => {
    const scopeFindings = findingsByScope.get(scopeDef.id) ?? [];
    const result: ScopeResult = {
      scopeId: scopeDef.id,
      title: scopeDef.title,
      totalObligations: scopeFindings.length,
      unclassified: scopeFindings.filter(({ status }) => status === 'unclassified').length,
      deterministicExecutable: scopeFindings.filter(({ disposition }) => disposition === 'deterministic-executable' || disposition === 'conflicted').length,
      provenSupported: scopeFindings.filter(({ status }) => status === 'proven-supported').length,
      implementedUnproven: scopeFindings.filter(({ status }) => status === 'implemented-unproven').length,
      implementedNoContract: scopeFindings.filter(({ status }) => status === 'implemented-no-contract').length,
      unimplemented: scopeFindings.filter(({ status }) => status === 'unimplemented').length,
      conflictedUnadjudicated: scopeFindings.filter(({ status }) => status === 'conflicted-unadjudicated').length,
      tableFacing: scopeFindings.filter(({ status }) => status === 'table-facing').length,
      deferred: scopeFindings.filter(({ status }) => status === 'deferred').length,
      descriptive: scopeFindings.filter(({ status }) => status === 'descriptive').length,
      gmFacing: scopeFindings.filter(({ status }) => status === 'gm-facing').length,
      playerChoice: scopeFindings.filter(({ status }) => status === 'player-choice').length,
      unimplementedIds: scopeFindings.filter(({ status }) => status === 'unimplemented').map(({ obligationId }) => obligationId),
      lackingRequiredProof: scopeFindings
        .filter(({ missingProofKinds }) => missingProofKinds && missingProofKinds.length > 0)
        .map(({ obligationId, missingProofKinds }) => ({ obligationId, missing: missingProofKinds ?? [] })),
      unresolvedConflicts: scopeFindings.filter(({ status }) => status === 'conflicted-unadjudicated').map(({ obligationId }) => obligationId),
      status: 'blocked',
      blockers: [],
    };

    const deterministicObligations = world.obligations.filter(
      (obligation) => obligation.scopeId === scopeDef.id
        && (obligation.disposition === 'deterministic-executable' || obligation.disposition === 'conflicted'),
    );
    const statefulWithoutReplay = deterministicObligations.some((obligation) => {
      const contract = contracts.get(obligation.id);
      if (!contract?.stateful) return false;
      return !(proofs.get(obligation.id) ?? []).some((proof) => proof.kind === 'replay');
    });
    const integrationOk = scopeIntegrationEvidencePresent(scopeDef, proofs);
    result.status = computeScopeStatus(result, scopeDef, statefulWithoutReplay, integrationOk);

    const blockers: string[] = [];
    if (result.unclassified > 0) blockers.push(`${result.unclassified} unclassified obligation(s)`);
    if (result.conflictedUnadjudicated > 0) blockers.push(`${result.conflictedUnadjudicated} unresolved source conflict(s)`);
    if (result.unimplemented > 0) blockers.push(`${result.unimplemented} deterministic obligation(s) without a registered consumer`);
    if (result.implementedNoContract > 0) blockers.push(`${result.implementedNoContract} implemented claim(s) without a semantic contract`);
    if (result.implementedUnproven > 0) blockers.push(`${result.implementedUnproven} implemented claim(s) lacking required proof`);
    if (statefulWithoutReplay) blockers.push('a stateful contract lacks replay evidence');
    if (!integrationOk) blockers.push('required integration evidence is absent');
    result.blockers = blockers;

    return result;
  });

  const deterministicFindings = findings.filter(({ disposition }) => disposition === 'deterministic-executable' || disposition === 'conflicted');
  const lackingRequiredProof = findings
    .filter(({ missingProofKinds }) => missingProofKinds && missingProofKinds.length > 0)
    .map(({ obligationId, missingProofKinds }) => ({ obligationId, missing: missingProofKinds ?? [] }));

  return {
    summary: {
      totalObligations: findings.length,
      classified: findings.filter(({ status }) => status !== 'unclassified').length,
      unclassified: findings.filter(({ status }) => status === 'unclassified').length,
      deterministicObligations: deterministicFindings.length,
      implementedDeterministic: deterministicFindings.filter(({ status }) => ['proven-supported', 'implemented-unproven', 'implemented-no-contract'].includes(status)).length,
      lackingExecution: deterministicFindings.filter(({ status }) => status === 'unimplemented').map(({ obligationId }) => obligationId),
      lackingRequiredProof,
      unresolvedConflicts: findings.filter(({ status }) => status === 'conflicted-unadjudicated').map(({ obligationId }) => obligationId),
      tableFacing: findings.filter(({ status }) => status === 'table-facing').length,
      deferredUnsupported: findings.filter(({ status }) => status === 'deferred').length,
      integrityViolations,
    },
    findings,
    scopes: scopeResults,
  };
}
