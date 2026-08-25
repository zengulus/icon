/**
 * Canonical SOURCE-FIDELITY AUDIT CLI.
 *
 * Computes the strict source → semantics → execution → proof → status chain
 * from the evidence graph in src/rules/fidelity/, verifies that every
 * registered proof's evidence file actually exists and names its test,
 * checks documentation claims against the computed state, regenerates (or
 * drift-checks) docs/source-fidelity.md, and runs the semantic
 * mutation-resistance suite.
 *
 * Exit status (with --strict):
 *   fails on INTEGRITY violations and INCONSISTENT CLAIMS OF COMPLETENESS —
 *   dangling references, executable claims without consumers, proven claims
 *   without required proof evidence, conflicts used without adjudication,
 *   documentation claiming stronger status than computed, generated-doc
 *   drift, or a semantic mutation accepted by the oracle.
 *
 *   Legitimate INCOMPLETENESS (unclassified obligations, unimplemented
 *   content) does NOT fail the build; it lowers computed status instead.
 *
 * Usage:
 *   node --import tsx scripts/audit-source-fidelity.ts [--strict] [--write] [--json]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeFidelityAudit } from '../src/rules/fidelity/engine.js';
import { buildProductionWorld } from '../src/rules/fidelity/world.js';
import { checkDocumentationClaims, checkGeneratedDocDrift, generateMarkdown, GENERATED_DOC_PATH } from '../src/rules/fidelity/docs.js';
import { runMutationResistanceSuite } from '../src/rules/fidelity/mutation.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const write = process.argv.includes('--write');
const json = process.argv.includes('--json');

const world = buildProductionWorld();
const result = computeFidelityAudit(world);

// --- Proof evidence: static verification (file exists + test name present) ---
interface EvidenceFailure {
  obligationId: string;
  kind: string;
  detail: string;
}
const evidenceFailures: EvidenceFailure[] = [];
for (const proof of world.proofs) {
  const path = join(repoRoot, proof.file);
  if (!existsSync(path)) {
    evidenceFailures.push({ obligationId: proof.obligationId, kind: proof.kind, detail: `evidence file missing: ${proof.file}` });
    continue;
  }
  if (!readFileSync(path, 'utf8').includes(proof.test)) {
    evidenceFailures.push({ obligationId: proof.obligationId, kind: proof.kind, detail: `test name not found in ${proof.file}: "${proof.test}"` });
  }
}

// --- Mutation resistance ---
const mutations = runMutationResistanceSuite();

// --- Documentation ---
const docsDir = join(repoRoot, 'docs');
if (write) {
  writeFileSync(join(docsDir, GENERATED_DOC_PATH.split('/').pop()!), generateMarkdown(result));
}
const docDrift = write ? [] : checkGeneratedDocDrift(docsDir, result);
const docClaims = checkDocumentationClaims(docsDir, result, world.scopes);

// --- Output ---
if (json) {
  console.log(JSON.stringify({ summary: result.summary, scopes: result.scopes, evidenceFailures, mutations, docDrift, docClaims }, null, 2));
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
  console.log(`  table-facing:           ${summary.tableFacing}`);
  console.log(`  deferred/unsupported:   ${summary.deferredUnsupported}`);
  console.log('');
  for (const scope of result.scopes) {
    console.log(`  [${scope.status.toUpperCase()}] ${scope.title} — ${scope.totalObligations} obligation(s), ${scope.blockers.length} blocker(s)`);
    for (const blocker of scope.blockers) console.log(`          · ${blocker}`);
  }
  console.log('');
  console.log(`mutation resistance: ${mutations.checkedMutations.length} mutants over a ${mutations.domainSize}-row domain, ${mutations.violations.length} violation(s)`);
  for (const violation of mutations.violations) console.log(`  ✗ ${violation}`);
  for (const failure of evidenceFailures) console.log(`  ✗ proof evidence: ${failure.obligationId} (${failure.kind}) ${failure.detail}`);
  for (const violation of summary.integrityViolations) console.log(`  ✗ integrity: ${violation.check} — ${violation.detail}`);
  for (const violation of docDrift) console.log(`  ✗ doc drift: ${violation.detail}`);
  for (const violation of docClaims) console.log(`  ✗ doc claim: docs/${violation.file.split('/').pop()}:${violation.line} ${violation.detail}`);
}

// --- Strict exit behavior ---
const hardFailures = [
  ...result.summary.integrityViolations.map((v) => `integrity: ${v.check} — ${v.detail}`),
  ...mutations.violations,
  ...evidenceFailures.map((f) => `proof evidence: ${f.obligationId} (${f.kind}) ${f.detail}`),
  ...docDrift.map((v) => `doc drift: ${v.detail}`),
  ...docClaims.map((v) => `doc claim (${v.file}:${v.line}): ${v.detail}`),
];
if (strict && hardFailures.length > 0) {
  console.error(`\nsource-fidelity audit FAILED with ${hardFailures.length} integrity/claim violation(s):`);
  for (const failure of hardFailures) console.error(`  - ${failure}`);
  process.exitCode = 1;
} else if (!json && hardFailures.length === 0) {
  console.log('\nNo integrity violations. Incompleteness is reported as lowered status, not build failure.');
}
