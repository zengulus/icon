import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { computeFidelityAudit, passageFingerprint, withFingerprints } from '../fidelity/engine.js';
import {
  CORRECT_MITIGATION,
  MITIGATION_CONTRACT_ROWS,
  SEMANTIC_MUTATIONS,
  evaluateMitigationContract,
  naivePositiveSuite,
  runMutationResistanceSuite,
} from '../fidelity/mutation.js';
import { buildProductionWorld } from '../fidelity/world.js';
import { checkDocumentationClaims, generateMarkdown } from '../fidelity/docs.js';
import type { FidelityWorld, ProofRecord, SemanticContract, SourceObligation } from '../fidelity/types.js';

const REPO_ROOT = join(import.meta.dirname, '../../..');

// ---------------------------------------------------------------------------
// Synthetic world builders — mechanic-agnostic fixtures for the audit itself
// ---------------------------------------------------------------------------

const SYNTHETIC_SCOPE = {
  id: 'synthetic-selftest',
  title: 'Synthetic self-test scope',
  aliases: [],
  description: 'Fixture scope used by the audit framework tests.',
};

function passage(quote = 'Synthetic source passage.') {
  return { page: 1, sectionId: null, quote, sha256: passageFingerprint(quote) };
}

function obligation(overrides: Partial<SourceObligation> = {}): SourceObligation {
  return withFingerprints({
    id: 'synthetic:rule',
    scopeId: SYNTHETIC_SCOPE.id,
    disposition: 'deterministic-executable',
    summary: 'Synthetic deterministic rule.',
    passages: [passage()],
    origin: { kind: 'curated' },
    consumerIds: ['synthetic.impl'],
    ...overrides,
  });
}

function contract(overrides: Partial<SemanticContract> = {}): SemanticContract {
  return {
    obligationId: 'synthetic:rule',
    kind: 'exhaustive-finite',
    stateful: false,
    statement: 'Synthetic exhaustive contract.',
    ...overrides,
  };
}

function proof(overrides: Partial<ProofRecord> = {}): ProofRecord {
  return {
    obligationId: 'synthetic:rule',
    kind: 'exhaustive',
    file: 'src/rules/fidelity/mutation.ts',
    test: 'MITIGATION_CONTRACT_ROWS',
    ...overrides,
  };
}

function world(overrides: Partial<FidelityWorld> = {}): FidelityWorld {
  return {
    scopes: [SYNTHETIC_SCOPE],
    obligations: [obligation()],
    consumers: [{ id: 'synthetic.impl', location: 'fixture', description: 'fixture consumer' }],
    contracts: [contract()],
    proofs: [proof()],
    adjudications: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Failure classes A–I
// ---------------------------------------------------------------------------

describe('fidelity audit framework (synthetic fixtures)', () => {
  it('A. detects a deterministic obligation with no executable consumer', () => {
    const result = computeFidelityAudit(world({ obligations: [obligation({ consumerIds: [] })] }));
    const finding = result.findings[0];
    expect(finding.status).toBe('unimplemented');
    expect(result.scopes[0].status).toBe('partial');
    expect(result.scopes[0].blockers.join(' ')).toMatch(/without a registered consumer/);
  });

  it('B. downgrades an implementation claim with no semantic contract or proof', () => {
    const noContract = computeFidelityAudit(world({ contracts: [] }));
    expect(noContract.findings[0].status).toBe('implemented-no-contract');

    const noProofs = computeFidelityAudit(world({ proofs: [] }));
    expect(noProofs.findings[0].status).toBe('implemented-unproven');
    expect(noProofs.summary.lackingRequiredProof[0].missing).toEqual(['exhaustive']);
    // An implemented-but-unproven claim must never count toward closure.
    expect(noProofs.scopes[0].status).toBe('partial');
  });

  it('C. catches behavior that passes naive tests but violates the contract', () => {
    const mutant = SEMANTIC_MUTATIONS.find(({ id }) => id === 'floor-off-by-one')!;
    // Its own happy-path "tests" pass…
    expect(mutant.passesNaiveSuite).toBe(true);
    expect(naivePositiveSuite(mutant.impl)).toBe(true);
    // …yet the independent exhaustive contract rejects it.
    expect(evaluateMitigationContract(mutant.impl).length).toBeGreaterThan(0);
    expect(naivePositiveSuite(CORRECT_MITIGATION)).toBe(true);
    expect(evaluateMitigationContract(CORRECT_MITIGATION)).toEqual([]);
  });

  it('D. requires the proof shape the contract class demands (boundary missing)', () => {
    const result = computeFidelityAudit(
      world({
        contracts: [contract({ kind: 'boundary-constant', statement: 'pins an edge', boundary: { kind: 'count', value: 7 } })],
        proofs: [proof({ kind: 'positive' })],
      }),
    );
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].missingProofKinds).toEqual(['boundary']);
  });

  it('E. refuses executability for a source conflict without an adopted adjudication', () => {
    const unlinked = computeFidelityAudit(world({ obligations: [obligation({ disposition: 'conflicted' })] }));
    expect(unlinked.findings[0].status).toBe('conflicted-unadjudicated');
    expect(unlinked.scopes[0].status).toBe('blocked');

    const dangling = computeFidelityAudit(
      world({ obligations: [obligation({ disposition: 'conflicted', adjudicationId: 'icon-1.5:nope' })] }),
    );
    expect(dangling.summary.integrityViolations.map((v) => v.check)).toContain('dangling-adjudication-reference');

    const unresolvedAdjudication = computeFidelityAudit(
      world({
        obligations: [obligation({ disposition: 'conflicted', adjudicationId: 'icon-1.5:test' })],
        adjudications: [{ id: 'icon-1.5:test', status: 'unresolved' }],
      }),
    );
    expect(unresolvedAdjudication.findings[0].status).toBe('conflicted-unadjudicated');

    // With an ADOPTED adjudication the obligation may proceed down the
    // executable path — and still needs contract + proof.
    const adopted = computeFidelityAudit(
      world({
        obligations: [obligation({ disposition: 'conflicted', adjudicationId: 'icon-1.5:test' })],
        adjudications: [{ id: 'icon-1.5:test', status: 'adopted' }],
      }),
    );
    expect(adopted.findings[0].status).toBe('proven-supported');
  });

  it('F. fails documentation claiming stronger status than computed', () => {
    const docsDir = mkdtempSync(join(tmpdir(), 'fidelity-docs-'));
    mkdirSync(docsDir, { recursive: true });
    writeFileSync(join(docsDir, 'notes.md'), '# Notes\n\nThe synthetic self-test scope is COMPLETE.\n');
    const scopes = [{ ...SYNTHETIC_SCOPE, aliases: ['synthetic self-test'] }];
    // The scope is INCOMPLETE here (no recorded proof) while the prose claims COMPLETE.
    const result = computeFidelityAudit(world({ scopes, proofs: [] }));
    expect(result.scopes[0].status).not.toBe('closed');
    const violations = checkDocumentationClaims(docsDir, result, scopes, ['notes.md']);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].detail).toMatch(/claims COMPLETE.*computed status is/i);

    // And once the scope genuinely closes, the same prose is accepted.
    const closedResult = computeFidelityAudit(world({ scopes }));
    expect(checkDocumentationClaims(docsDir, closedResult, scopes, ['notes.md'])).toEqual([]);
  });

  it('G. unknown/unclassified obligations block completeness claims', () => {
    const complete = computeFidelityAudit(world());
    expect(complete.scopes[0].status).toBe('closed');

    const withUnknown = computeFidelityAudit(
      world({
        obligations: [
          obligation(),
          obligation({ id: 'synthetic:new-material', disposition: 'unclassified' }),
        ],
      }),
    );
    expect(withUnknown.scopes[0].status).toBe('blocked');
    expect(withUnknown.summary.unclassified).toBe(1);
  });

  it('H. rejects every deliberate semantic mutation', () => {
    const report = runMutationResistanceSuite();
    expect(report.referenceFailures).toBe(0);
    expect(report.violations).toEqual([]);
    expect(report.checkedMutations.length).toBeGreaterThanOrEqual(4);
    for (const mutation of report.checkedMutations) expect(mutation.rejectedByOracle).toBe(true);
    // The exhaustive domain really is exhausted.
    expect(MITIGATION_CONTRACT_ROWS.length).toBe(6 * 4 * 2);
  });

  it('I. a fully satisfied synthetic subsystem reaches CLOSED', () => {
    const result = computeFidelityAudit(world());
    expect(result.findings[0].status).toBe('proven-supported');
    expect(result.scopes[0].status).toBe('closed');
    expect(result.summary.integrityViolations).toEqual([]);
  });

  it('a stateful contract without replay evidence caps below closed', () => {
    const result = computeFidelityAudit(world({ contracts: [contract({ stateful: true })] }));
    expect(result.findings[0].missingProofKinds).toEqual(['replay']);
    expect(result.scopes[0].status).toBe('partial');
    const withReplay = computeFidelityAudit(world({ contracts: [contract({ stateful: true })], proofs: [proof(), proof({ kind: 'replay' })] }));
    expect(withReplay.scopes[0].status).toBe('closed');
  });

  it('integrity: dangling references are hard failures', () => {
    const danglingConsumer = computeFidelityAudit(world({ obligations: [obligation({ consumerIds: ['synthetic:missing'] })] }));
    expect(danglingConsumer.summary.integrityViolations.map((v) => v.check)).toContain('dangling-consumer-reference');

    const tamperedQuote = computeFidelityAudit(
      world({
        obligations: [{
          ...obligation(),
          passages: [{ page: 1, sectionId: null, quote: 'Edited after fingerprinting.', sha256: passageFingerprint('Original text.') }],
        }],
      }),
    );
    expect(tamperedQuote.summary.integrityViolations.map((v) => v.check)).toContain('passage-fingerprint-mismatch');
  });
});

// ---------------------------------------------------------------------------
// Production world sanity
// ---------------------------------------------------------------------------

describe('production fidelity world', () => {
  const result = computeFidelityAudit(buildProductionWorld());

  it('has no integrity violations', () => {
    expect(result.summary.integrityViolations).toEqual([]);
  });

  it('seeds unit-grain obligations for every catalogued source unit, all unclassified', () => {
    expect(result.summary.totalObligations).toBeGreaterThan(3000);
    expect(result.summary.unclassified).toBe(result.summary.totalObligations - 3);
    const largeScope = result.scopes.find(({ scopeId }) => scopeId === 'sourcebook-at-large')!;
    expect(largeScope.status).toBe('blocked');
  });

  it('computes the fully-evidenced advancement scope as CLOSED via adopted adjudications', () => {
    const advancement = result.scopes.find(({ scopeId }) => scopeId === 'advancement')!;
    expect(advancement.status).toBe('closed');
    expect(advancement.provenSupported).toBe(3);
    expect(advancement.unresolvedConflicts).toEqual([]);
    for (const finding of result.findings.filter(({ scopeId }) => scopeId === 'advancement')) {
      expect(['proven-supported']).toContain(finding.status);
    }
  });

  it('every registered proof names evidence that actually exists', () => {
    const world_ = buildProductionWorld();
    for (const p of world_.proofs) {
      const content = readFileSync(join(REPO_ROOT, p.file), 'utf8');
      expect(content.includes(p.test), `${p.file} should contain "${p.test}"`).toBe(true);
    }
  });

  it('the committed generated document matches the canonical output byte-for-byte', () => {
    const committed = readFileSync(join(REPO_ROOT, 'docs/source-fidelity.md'), 'utf8');
    expect(committed).toBe(generateMarkdown(result));
  });
});
