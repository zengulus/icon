/**
 * Canonical SOURCE-FIDELITY AUDIT CLI.
 *
 * Thin wrapper over the shared strict pipeline (`src/rules/fidelity/strict.ts`)
 * so the command line, generated documentation, and self-tests all exercise
 * the SAME evidence path:
 *
 *     canonical corpus → frontiers → passage provenance → consumer
 *     resolution → executed contract evaluation → pure audit computation
 *     → declared-proof verification → semantic mutation resistance
 *     → project-claim audit
 *
 * Exit status (--strict): fails on INTEGRITY violations and INCONSISTENT
 * CLAIMS OF COMPLETENESS — false source provenance, unresolvable consumers,
 * failed semantic evaluations, dangling references, accepted semantic
 * mutants, unregistered/overstated project claims, generated-doc drift.
 *
 * Legitimate INCOMPLETENESS (unclassified obligations, uncovered frontier
 * clauses, unimplemented content) does NOT fail the build; it lowers computed
 * status instead.
 *
 * Usage:
 *   node --import tsx scripts/audit-source-fidelity.ts [--strict] [--write]
 *        [--json] [--run-prereqs]
 *
 * `--run-prereqs` is the aggregate authority path: it EXECUTES every npm
 * script bound as generated-audit/compound-claim/replay/integration evidence
 * and records the results for this run.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRecordedPrerequisiteAudits, runStrictFidelityAudit } from '../src/rules/fidelity/strict.js';
import { checkGeneratedDocDrift, generateMarkdown, GENERATED_DOC_PATH } from '../src/rules/fidelity/docs.js';
import { RULES_COVERAGE } from '../src/rules/catalog.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const write = process.argv.includes('--write');
const json = process.argv.includes('--json');

// Aggregate authority path: when --run-prereqs is given, this process runs
// every bound prerequisite script ITSELF and records the exit statuses.
// There is no trusted hand-written results file — recorded evidence can only
// come from a real execution in this run. Without --run-prereqs,
// generated-audit/replay/integration-bound claims cannot verify (reported
// unverified, never silently accepted).
const runPrereqs = process.argv.includes('--run-prereqs');
let auditResults: Record<string, 'passed' | 'failed'> | undefined;
if (runPrereqs) {
  console.log('Running bound prerequisite audits (aggregate authority path)...');
  auditResults = runRecordedPrerequisiteAudits();
  for (const [command, outcome] of Object.entries(auditResults)) {
    console.log(`  ${outcome === 'passed' ? '✓' : '✗'} ${command}`);
  }
  console.log('');
}

const report = runStrictFidelityAudit(repoRoot, {
  auditResults,
  coverageStatus: (id: string) => RULES_COVERAGE.find((item) => item.id === id)?.status,
});
const { result, hardFailures, unverifiedClaims } = report;

// --- Documentation -----------------------------------------------------------
const docDrift = write ? [] : checkGeneratedDocDrift(join(repoRoot, 'docs'), report);
if (write) {
  writeFileSync(join(repoRoot, 'docs', GENERATED_DOC_PATH.split('/').pop()!), generateMarkdown(report));
}

// --- Output ------------------------------------------------------------------
if (json) {
  console.log(JSON.stringify({ summary: result.summary, scopes: result.scopes, unverifiedClaims, hardFailures, docDrift }, null, 2));
} else {
  const { summary } = result;
  console.log('Source-fidelity audit');
  console.log(`  obligations:            ${summary.totalObligations}`);
  console.log(`  classified:             ${summary.classified}`);
  console.log(`  unclassified (blocks strong claims): ${summary.unclassified}`);
  console.log(`  deterministic:          ${summary.deterministicObligations}`);
  console.log(`  with registered consumers: ${summary.implementedDeterministic}`);
  console.log(`  lacking execution:      ${summary.lackingExecution.length}`);
  console.log(`  lacking required proof: ${summary.lackingRequiredProof.length}`);
  console.log(`  unresolved conflicts:   ${summary.unresolvedConflicts.length}`);
  console.log(`  contracts evaluated:    ${summary.evaluationsRun} (${summary.evaluationsPassed} passed, ${summary.evaluationsFailed.length} FAILED)`);
  console.log(`  units fully/partially decomposed: ${summary.unitsFullyDecomposed.length}/${summary.unitsPartiallyDecomposed.length} (untouched: ${summary.unitsUntouched})`);
  console.log(`  table-facing:           ${summary.tableFacing}`);
  console.log(`  deferred/unsupported:   ${summary.deferredUnsupported}`);
  console.log('');
  for (const scope of result.scopes) {
    console.log(`  [${scope.status.toUpperCase()}] ${scope.title} — ${scope.totalObligations} obligation(s), ${scope.blockers.length} blocker(s)`);
    if (scope.frontierTotalClauses > 0) {
      console.log(`          · frontier: ${scope.frontierTotalClauses} clause(s) — covered ${scope.frontierCoveredClauses}, irrelevant ${scope.frontierIrrelevantClauses}, UNCOVERED ${scope.frontierUncoveredIds.length}`);
    }
    for (const blocker of scope.blockers) console.log(`          · ${blocker}`);
  }
  console.log('');
  if (unverifiedClaims.length > 0) {
    console.log(`project claims declared LEGACY / UNVERIFIED: ${unverifiedClaims.length}`);
    for (const claim of unverifiedClaims) console.log(`  ~ ${claim.id}: ${claim.subject} (${claim.strength.toUpperCase()}) — ${claim.reason}`);
    console.log('');
  }
  for (const failure of report.mutationViolations) console.log(`  ✗ mutation resistance: ${failure}`);
  for (const failure of report.evidenceFailures) console.log(`  ✗ proof evidence: ${failure}`);
  for (const violation of summary.integrityViolations) console.log(`  ✗ integrity: ${violation.check} — ${violation.detail}`);
  for (const violation of docDrift) console.log(`  ✗ doc drift: ${violation.detail}`);
}

const totalHardFailures = [...hardFailures, ...docDrift.map((v) => `doc drift: ${v.detail}`)];
if (strict && totalHardFailures.length > 0) {
  console.error(`\nsource-fidelity audit FAILED with ${totalHardFailures.length} integrity/claim violation(s):`);
  for (const failure of totalHardFailures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else if (!json && totalHardFailures.length === 0) {
  console.log('\nNo integrity violations. Incompleteness is reported as lowered status, not build failure.');
}
