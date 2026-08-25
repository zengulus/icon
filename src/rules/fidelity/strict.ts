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

import { spawnSync } from 'node:child_process';
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
import type { FidelityReport } from './docs.js';
import {
  CORRECT_MITIGATION,
  SEMANTIC_MUTATIONS,
  MITIGATION_CONTRACT_ROWS,
  MITIGATION_DOMAIN,
  runMutationResistanceSuite,
} from './mutation.js';
import type { AdapterRegistry, ContractRow, FidelityAuditResult, FidelityIntegrityViolation, SemanticContract, SourceObligation } from './types.js';
import type { ProjectClaim } from './claims.js';
// NOTE: `ProjectClaim` is imported as a type only; the evidence layer stays
// observation-only (see the anti-circularity guard in fidelity-audit tests).

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
  /** STABLE DOC-MODE report: the same evidence pipeline computed WITHOUT any
   * recorded per-run prerequisite evidence. `docs/source-fidelity.md` renders
   * THIS and only this, so doc-drift comparison happens in one deterministic,
   * non-ephemeral mode and can never fail merely because a real prerequisite
   * execution elevated claim/scope verification state this run. When no
   * per-run evidence was supplied, this is the same object as the authority
   * report above. */
  stableReport: FidelityReport;
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

/** Orchestration-level options. Prerequisite audit RESULTS come only from
 * the aggregate authority path (`--run-prereqs` runs each bound script here
 * and records its exit status); generated-audit/replay/integration evidence
 * verifies ONLY against those recordings — there is no trusted hand-written
 * results file.
 *
 * These recordings are PER-RUN AUTHORITY EVIDENCE ONLY. They deliberately do
 * NOT feed the generated documentation: see `stableReport` below. */
export interface StrictAuditOptions {
  auditResults?: Readonly<Record<string, 'passed' | 'failed'>>;
  /** RULES_COVERAGE lookup for coverage-item phase-gate requirements (wired
   * by the CLI; the fidelity layer never imports runtime rules code). */
  coverageStatus?: (id: string) => string | undefined;
}

// ---------------------------------------------------------------------------
// Aggregate authority — real prerequisite executions, recorded once
// ---------------------------------------------------------------------------

/** Every npm script bound as EXECUTED evidence anywhere in the registry:
 * generated-audit/compound claim requirements plus replay/integration proofs. */
export function boundEvidenceCommands(
  world: ReturnType<typeof buildProductionWorld>,
  claims: readonly ProjectClaim[] = PROJECT_CLAIMS,
): string[] {
  const commands = new Set<string>();
  for (const claim of claims) {
    if (claim.binding.kind === 'generated-audit') commands.add(claim.binding.command);
    if (claim.binding.kind === 'compound') {
      for (const requirement of claim.binding.requirements) {
        if (requirement.kind === 'generated-audit') commands.add(requirement.command);
      }
    }
  }
  for (const proof of world.proofs) {
    if ((proof.evidence === 'replay' || proof.evidence === 'integration') && proof.command !== undefined) {
      commands.add(proof.command);
    }
  }
  return [...commands].sort();
}

export interface PrereqRunnerDeps {
  npm?(args: readonly string[]): { status: number | null };
}

/** The aggregate authority runner: executes each bound npm script ONCE with
 * inherited stdio and records its exit status. These recordings are the ONLY
 * input by which generated-audit/replay/integration evidence can verify. */
export function runPrerequisiteAudits(commands: readonly string[], deps: PrereqRunnerDeps = {}): Record<string, 'passed' | 'failed'> {
  const npm = deps.npm ?? ((args: readonly string[]) => spawnSync('npm', [...args], { stdio: 'inherit' }));
  const results: Record<string, 'passed' | 'failed'> = {};
  for (const command of [...new Set(commands)].sort()) {
    const outcome = npm(['run', command]);
    results[command] = outcome.status === 0 ? 'passed' : 'failed';
  }
  return results;
}

/** Convenience for the CLI: binds the CURRENT world + registry to a single
 * recorded prerequisite pass. */
export function runRecordedPrerequisiteAudits(): Record<string, 'passed' | 'failed'> {
  return runPrerequisiteAudits(boundEvidenceCommands(buildProductionWorld()));
}

// ---------------------------------------------------------------------------
// Adapter-exercise verification
// ---------------------------------------------------------------------------

const DEFAULT_ADAPTER_SOURCE_PATH = 'src/rules/fidelity/adapters.ts';

/** Mechanically verifies that every production adapter EXERCISES the
 * registered production consumers of its obligation: for each obligation with
 * a contract AND a registered adapter, every consumer registration's declared
 * export symbol must appear in the adapter module's source. A stub adapter
 * (or one calling unrelated code) fails this check — and combined with the
 * executed passing evaluations, the registered production implementation is
 * provably what produced the evidence. */
export function verifyAdaptersExerciseConsumers(
  world: Parameters<typeof computeFidelityAudit>[0],
  adapters: AdapterRegistry,
  deps: { root: string; adapterSourcePath?: string; readFile?(path: string): string },
): FidelityIntegrityViolation[] {
  const sourcePath = deps.adapterSourcePath ?? DEFAULT_ADAPTER_SOURCE_PATH;
  let source: string;
  try {
    source = (deps.readFile ?? ((path: string) => readFileSync(path, 'utf8')))(join(deps.root, sourcePath));
  } catch {
    return [{ check: 'adapter-does-not-exercise-consumer', detail: `adapter module ${sourcePath} could not be read` }];
  }
  const consumersById = new Map(world.consumers.map((consumer) => [consumer.id, consumer]));
  const violations: FidelityIntegrityViolation[] = [];
  for (const contract of world.contracts) {
    if (!adapters.has(contract.obligationId)) continue; // a missing adapter fails evaluation outright
    const obligation = world.obligations.find((candidate) => candidate.id === contract.obligationId);
    if (!obligation) continue;
    for (const consumerId of obligation.consumerIds ?? []) {
      const registration = consumersById.get(consumerId);
      if (!registration) continue; // dangling reference reported by the engine
      const symbol = registration.symbol;
      if (symbol === undefined || !new RegExp(`\\b${symbol}\\b`).test(source)) {
        violations.push({
          check: 'adapter-does-not-exercise-consumer',
          detail: `${contract.obligationId}: adapter does not exercise registered consumer ${consumerId}${symbol ? ` (symbol "${symbol}" absent from ${sourcePath})` : ` (registration declares no symbol)`}`,
        });
      }
    }
  }
  return violations;
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

  // 3b. Adapters must actually EXERCISE the registered production consumers.
  const adapterViolations = verifyAdaptersExerciseConsumers(world, PRODUCTION_ADAPTERS, { root: repoRoot });

  // 4. Pure audit computation over the assembled evidence.
  const result = computeFidelityAudit(world, { frontiers: frontierInputs, evaluations, resolvedConsumerIds, auditResults: options.auditResults });

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
  const claims = checkProjectClaims(
    result,
    { root: repoRoot, auditResults: options.auditResults, coverageStatus: options.coverageStatus },
    PROJECT_CLAIMS,
  );

  // 7b. Stable DOC-MODE projection. Recorded prerequisite evidence is
  // load-bearing for AUTHORITY (hard failures above) but is ephemeral:
  // re-rendering the canonical document around it would make a committed
  // artifact depend on whichever audits happened to run this time. The doc is
  // therefore rendered from the SAME pipeline recomputed with NO recorded
  // evidence — one deterministic mode for generation and drift-checking.
  const toUnverified = (list: readonly ProjectClaim[]) => list.map((claim) => ({
    id: claim.id,
    file: claim.file,
    subject: claim.subject,
    strength: claim.strength,
    reason: claim.binding.kind === 'legacy-unverified' ? claim.binding.reason : '',
  }));
  const stableReport: FidelityReport =
    options.auditResults === undefined
      ? { result, unverifiedClaims: toUnverified(claims.unverifiedClaims) }
      : (() => {
          const stableResult = computeFidelityAudit(world, { frontiers: frontierInputs, evaluations, resolvedConsumerIds });
          const stableClaims = checkProjectClaims(
            stableResult,
            { root: repoRoot, coverageStatus: options.coverageStatus },
            PROJECT_CLAIMS,
          );
          return { result: stableResult, unverifiedClaims: toUnverified(stableClaims.unverifiedClaims) };
        })();

  // 8. Aggregate hard failures.
  const hardFailures: string[] = [
    ...result.summary.integrityViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
    ...provenanceViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
    ...consumerViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
    ...evaluations.filter(({ passed }) => !passed).flatMap(({ obligationId, failures }) =>
      failures.map((f) => `semantic evaluation: ${obligationId} row "${f.row}" expected ${f.expected}, received ${f.actual}`),
    ),
    ...evidenceFailures,
    ...adapterViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
    ...mutations.violations,
    ...pipelineSelfCheck,
    ...claims.violations.map((v) => `project claim: ${v.check} — ${v.detail}`),
  ];

  return {
    result,
    hardFailures,
    evidenceFailures,
    unverifiedClaims: toUnverified(claims.unverifiedClaims),
    mutationViolations,
    stableReport,
  };
}
