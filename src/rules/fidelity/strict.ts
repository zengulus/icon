/**
 * fidelity/strict.ts — assembles and runs the FULL strict source-fidelity
 * audit pipeline in one place so that every consumer (CLI, generated docs,
 * self-tests) exercises the SAME evidence path:
 *
 *     canonical corpus → frontier resolution → passage provenance
 *       → consumer resolution → contract evaluation (executed)
 *       → pure audit computation → declared-proof verification
 *       → semantic mutation resistance through the generic evaluator
 *       → project-claim audit
 *
 * Hard failures are INTEGRITY violations and INCONSISTENT CLAIMS OF
 * COMPLETENESS. Legitimate incompleteness lowers computed status but never
 * fails the build.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildProductionWorld,
} from './world.js';
import { computeFidelityAudit } from './engine.js';
import { loadCanonicalCorpus, resolveScopeFrontiers, verifyPassageProvenance } from './provenance.js';
import { resolveConsumerRegistrations } from './consumers.js';
import { evaluateContracts } from './evaluate.js';
import { PRODUCTION_ADAPTERS } from './adapters.js';
import { checkProjectClaims, PROJECT_CLAIMS } from './claims.js';
import {
  CORRECT_MITIGATION,
  SEMANTIC_MUTATIONS,
  MITIGATION_CONTRACT_ROWS,
  MITIGATION_DOMAIN,
  runMutationResistanceSuite,
} from './mutation.js';
import type { ContractRow, FidelityAuditResult, FidelityIntegrityViolation, SemanticContract, SourceObligation } from './types.js';

export interface StrictAuditReport {
  result: FidelityAuditResult;
  /** Hard failures: integrity violations, failed evaluations, unresolvable
   * consumers, false provenance, uncovered-but-claimed closure, accepted
   * mutants, unregistered/overstated project claims, doc drift. */
  hardFailures: readonly string[];
  /** Declared proof records whose evidence file/test no longer verifies. */
  evidenceFailures: readonly string[];
  /** Project claims explicitly declared LEGACY/UNVERIFIED (reported, not failed). */
  unverifiedClaims: readonly { id: string; file: string; subject: string; strength: string; reason: string }[];
  /** Domain-level mutation bookkeeping (fixture drift etc.). */
  mutationViolations: readonly string[];
}

/** The generic proof-pipeline mutant self-check (AGENTS.md §13 / task req. N):
 * every registered synthetic mutation must be REJECTED by the same evaluator
 * machinery production contracts go through, via an adapter registry swap —
 * not by any side-channel oracle. */
export function runPipelineMutationSelfCheck(): string[] {
  const obligationId = 'synthetic:mitigation-domain';

  const obligation = {
    id: obligationId,
    scopeId: 'mutation-selftest',
    disposition: 'deterministic-executable',
    summary: 'Synthetic exhaustive mitigation domain.',
    passages: [{ page: 0, sectionId: null, quote: 'synthetic', sha256: '' }],
    origin: { kind: 'curated' },
    consumerIds: [],
  } satisfies SourceObligation;

  const contract: SemanticContract = {
    obligationId,
    kind: 'exhaustive-finite',
    stateful: false,
    statement: 'Exhaustive synthetic mitigation table.',
    // The declared domain makes exhaustive proof STRUCTURAL: the evaluator
    // must cover exactly these inputs, so a subset labelled 'exhaustive'
    // cannot certify the domain.
    domain: MITIGATION_DOMAIN,
    rows: MITIGATION_CONTRACT_ROWS.map((row): ContractRow => ({
      label: `base=${row.base} armor=${row.armor} kind=${row.kind}`,
      cls: 'exhaustive',
      input: row,
      expected: row.expected,
    })),
  };

  const world = {
    scopes: [{ id: 'mutation-selftest', title: 'Mutation self-test', description: 'internal' }],
    obligations: [obligation],
    consumers: [],
    contracts: [contract],
    proofs: [],
    adjudications: [],
  };

  const violations: string[] = [];
  for (const implementation of [
    { id: 'correct', fn: CORRECT_MITIGATION },
    ...SEMANTIC_MUTATIONS.map((m) => ({ id: m.id, fn: m.impl })),
  ]) {
    // Adapter registry swap: exactly how a production consumer is substituted.
    const adapters = new Map([[obligationId, { id: implementation.id, run: (input: unknown) => (implementation.fn as (i: unknown) => number)(input) }]]);
    const [evaluation] = evaluateContracts(world, adapters);
    if (!evaluation) {
      violations.push(`pipeline self-check: ${implementation.id} produced no evaluation`);
      continue;
    }
    const shouldPass = implementation.id === 'correct';
    if (evaluation.passed !== shouldPass) {
      violations.push(
        evaluation.passed
          ? `pipeline self-check: mutated implementation "${implementation.id}" PASSED the generic proof pipeline`
          : `pipeline self-check: correct reference implementation was REJECTED by the generic proof pipeline`,
      );
    }
  }
  return violations;
}

/** Orchestration-level options. Prerequisite audit RESULTS come from outside
 * the pure engine (CI artifacts or an aggregate command that ran the
 * prerequisites once); generated-audit-bound claims verify only against them. */
export interface StrictAuditOptions {
  auditResults?: Readonly<Record<string, 'passed' | 'failed'>>;
}

export function runStrictFidelityAudit(repoRoot: string, options: StrictAuditOptions = {}): StrictAuditReport {
  const world = buildProductionWorld();

  // 1. Canonical corpus + provenance.
  let provenanceViolations: FidelityIntegrityViolation[] = [];
  let frontierInputs: ReturnType<typeof resolveScopeFrontiers>['inputs'] = [];
  try {
    const corpus = loadCanonicalCorpus(repoRoot);
    provenanceViolations = verifyPassageProvenance(world, corpus);
    const resolved = resolveScopeFrontiers(world.scopes, corpus, world.obligations);
    frontierInputs = resolved.inputs;
    provenanceViolations.push(...resolved.violations);
  } catch (error) {
    provenanceViolations.push({
      check: 'passage-not-in-canonical-source',
      detail: `canonical corpus unavailable/unreadable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // 2. Consumer resolution against the real repository tree.
  const consumerViolations = resolveConsumerRegistrations(world.consumers, { root: repoRoot });
  const resolvedConsumerIds = world.consumers
    .filter((consumer) => !consumerViolations.some((v) => v.detail.startsWith(`consumer ${consumer.id}:`)))
    .map(({ id }) => id);

  // 3. Executed semantic evaluation of production contracts.
  const evaluations = evaluateContracts(world, PRODUCTION_ADAPTERS);

  // 4. Pure audit computation over the assembled evidence.
  const result = computeFidelityAudit(world, { frontiers: frontierInputs, evaluations, resolvedConsumerIds });

  // 5. Declared proof traceability: file exists + test name present.
  const evidenceFailures: string[] = [];
  for (const proof of world.proofs) {
    const path = join(repoRoot, proof.file);
    if (!existsSync(path)) {
      evidenceFailures.push(`${proof.obligationId} (${proof.kind}): evidence file missing: ${proof.file}`);
      continue;
    }
    if (!readFileSync(path, 'utf8').includes(proof.test)) {
      evidenceFailures.push(`${proof.obligationId} (${proof.kind}): test name not found in ${proof.file}: "${proof.test}"`);
    }
  }

  // 6. Semantic mutation resistance: domain suite + generic-pipeline self-check.
  const mutations = runMutationResistanceSuite();
  const pipelineSelfCheck = runPipelineMutationSelfCheck();
  const mutationViolations = [...mutations.violations, ...pipelineSelfCheck];

  // 7. Project claims (generated-audit bindings consume RECORDED results).
  const claims = checkProjectClaims(result, { root: repoRoot, auditResults: options.auditResults }, PROJECT_CLAIMS);

  // 8. Aggregate hard failures.
  const hardFailures: string[] = [
    ...result.summary.integrityViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
    ...provenanceViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
    ...consumerViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
    ...evaluations.filter(({ passed }) => !passed).flatMap(({ obligationId, failures }) =>
      failures.map((f) => `semantic evaluation: ${obligationId} row "${f.row}" expected ${f.expected}, received ${f.actual}`),
    ),
    ...evidenceFailures,
    ...mutations.violations,
    ...pipelineSelfCheck,
    ...claims.violations.map((v) => `project claim: ${v.check} — ${v.detail}`),
  ];

  const unverifiedClaims = claims.unverifiedClaims.map((claim) => ({
    id: claim.id,
    file: claim.file,
    subject: claim.subject,
    strength: claim.strength,
    reason: claim.binding.kind === 'legacy-unverified' ? claim.binding.reason : '',
  }));

  return {
    result,
    hardFailures,
    evidenceFailures,
    unverifiedClaims,
    mutationViolations,
  };
}
