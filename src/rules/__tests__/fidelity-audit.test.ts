import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeFidelityAudit,
  passageFingerprint,
  validateBoundaryProbes,
  withFingerprints,
} from '../fidelity/engine.js';
import {
  CORRECT_MITIGATION,
  MITIGATION_CONTRACT_ROWS,
  SEMANTIC_MUTATIONS,
  naivePositiveSuite,
  runMutationResistanceSuite,
} from '../fidelity/mutation.js';
import { buildProductionWorld } from '../fidelity/world.js';
import { checkProjectClaims, PROJECT_CLAIMS } from '../fidelity/claims.js';
import { generateMarkdown } from '../fidelity/docs.js';
import { PHASE_GATES } from '../phase-gates.js';
import { resolveConsumerRegistrations } from '../fidelity/consumers.js';
import { evaluateContract, evaluateContracts } from '../fidelity/evaluate.js';
import { PRODUCTION_ADAPTERS } from '../fidelity/adapters.js';
import {
  corpusFromPages,
  normalizeSourceText,
  pageClauses,
  resolveScopeFrontiers,
  sourceTextContains,
  verifyPassageProvenance,
} from '../fidelity/provenance.js';
import {
  boundEvidenceCommands,
  runPipelineMutationSelfCheck,
  runPrerequisiteAudits,
  runStrictFidelityAudit,
  verifyAdaptersExerciseConsumers,
} from '../fidelity/strict.js';
import type {
  ContractEvaluation,
  ConsumerRegistration,
  FidelityWorld,
  ProofRecord,
  ScopeDefinition,
  ScopeFrontierInput,
  SemanticContract,
  SourceClause,
  SourceObligation,
} from '../fidelity/types.js';
import { canonicalFixtureKey } from '../fidelity/types.js';

const REPO_ROOT = join(import.meta.dirname, '../../..');

// ---------------------------------------------------------------------------
// Synthetic world builders — mechanic-agnostic fixtures for the audit itself
// ---------------------------------------------------------------------------

const SYNTHETIC_SCOPE = {
  id: 'synthetic-selftest',
  title: 'Synthetic self-test scope',
  description: 'Fixture scope used by the audit framework tests.',
  // A scope cannot close without a DECLARED source frontier — even when a
  // fully-accounted ScopeFrontierInput is supplied by the harness.
  frontier: { pages: [7] },
};

const SYNTHETIC_PAGE = [
  'The widget gauge is 5 ticks long.',
  'At exactly 3 charge the widget may be invoked once.',
  'A second invocation while charged is refused and the charge stays capped at 4.',
  'Invoking resets the gauge to zero.',
].join('\n');

function syntheticCorpus() {
  return corpusFromPages([{ number: 7, text: SYNTHETIC_PAGE }]);
}

function clause(page: number, text: string): SourceClause {
  const normalized = normalizeSourceText(text);
  return { page, text: normalized, sha256: passageFingerprint(normalized), id: `p${page}:${normalized.slice(0, 10)}` };
}

function passage(quote = SYNTHETIC_PAGE, page = 7) {
  return { page, sectionId: null, quote, sha256: passageFingerprint(quote) };
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

function contractRows() {
  // Hand-derived expectation table for the synthetic "widget" rule.
  return [
    { label: 'invoke below threshold is refused', cls: 'negative' as const, input: { charges: 2 }, expected: { invoked: false, charges: 2 } },
    { label: 'invoke above threshold succeeds and resets', cls: 'positive' as const, input: { charges: 4 }, expected: { invoked: true, charges: 0 } },
  ];
}

/** A boundary-constant variant of the synthetic contract carrying genuine
 * below/at/above probes over an extracted scalar path. */
function boundaryContract(overrides: Partial<SemanticContract> = {}): SemanticContract {
  return {
    obligationId: 'synthetic:rule',
    kind: 'boundary-constant',
    stateful: false,
    statement: 'Synthetic boundary contract: invocation unlocks at exactly 3 charge.',
    boundary: {
      kind: 'count',
      value: 3,
      probes: { below: { charges: 2 }, at: { charges: 3 }, above: { charges: 4 } },
      probeValuePaths: { below: 'charges', at: 'charges', above: 'charges' },
    },
    rows: [
      { label: 'below the edge: refused', cls: 'boundary', input: { charges: 2 }, expected: { invoked: false, charges: 2 } },
      { label: 'at the edge: unlocked', cls: 'boundary', input: { charges: 3 }, expected: { invoked: true, charges: 0 } },
      { label: 'above the edge: unlocked too', cls: 'boundary', input: { charges: 4 }, expected: { invoked: true, charges: 0 } },
      { label: 'zero-charge baseline', cls: 'positive', input: { charges: 0 }, expected: { invoked: false, charges: 0 } },
    ],
    ...overrides,
  };
}

function contract(overrides: Partial<SemanticContract> = {}): SemanticContract {
  return {
    obligationId: 'synthetic:rule',
    kind: 'input-output-table',
    stateful: false,
    statement: 'Synthetic input-output contract over the widget rule.',
    rows: contractRows(),
    ...overrides,
  };
}

/** Reference implementation of the synthetic widget rule — independent of
 * contract rows (which encode expectations as data). */
function correctWidget(input: unknown): unknown {
  const { charges } = input as { charges: number };
  if (charges < 3) return { invoked: false, charges };
  return { invoked: true, charges: 0 };
}

function syntheticAdapterFor(run: (input: unknown) => unknown) {
  return new Map([['synthetic:rule', { id: 'synthetic.impl', run }]]);
}

const passingEvaluation = (run: (input: unknown) => unknown = correctWidget): ContractEvaluation =>
  evaluateContract(contract(), syntheticAdapterFor(run))!;

function proof(overrides: Partial<ProofRecord> = {}): ProofRecord {
  return {
    obligationId: 'synthetic:rule',
    kind: 'replay',
    evidence: 'replay',
    file: 'src/rules/fidelity/mutation.ts',
    test: 'MITIGATION_CONTRACT_ROWS',
    command: 'audit:fidelity-selftest',
    ...overrides,
  };
}

function frontierInput(
  clauses: SourceClause[],
  irrelevantIds: string[] = [],
  attributedIds: string[] = [],
): ScopeFrontierInput {
  return { scopeId: SYNTHETIC_SCOPE.id, clauses, irrelevantIds, attributedIds };
}

function fullSyntheticFrontier(): ScopeFrontierInput {
  const clauses = pageClauses(syntheticCorpus(), 7);
  // Every clause is attributed to the curated obligation that quotes it —
  // the verified-resolution equivalent of ADVANCEMENT_ATTRIBUTED_CLAUSES.
  return frontierInput(clauses, [], clauses.map(({ id }) => id));
}

/** Fully-evidenced synthetic world: covered frontier + resolving consumer +
 * row-carrying contract + passing evaluation. Declared proofs are traceability
 * only and never load-bearing. */
function provenWorld(overrides: Partial<FidelityWorld> & { evaluations?: ContractEvaluation[]; frontiers?: ScopeFrontierInput[]; resolvedConsumerIds?: string[]; auditResults?: Readonly<Record<string, 'passed' | 'failed'>> } = {}) {
  const base: FidelityWorld = {
    scopes: [SYNTHETIC_SCOPE],
    obligations: [obligation()],
    consumers: [{ id: 'synthetic.impl', file: 'src/rules/character.ts', symbol: 'awardXp', description: 'fixture consumer' }],
    contracts: [contract()],
    proofs: [],
    adjudications: [],
  };
  const { evaluations, frontiers, resolvedConsumerIds, auditResults, ...worldOverrides } = overrides;
  const world = { ...base, ...worldOverrides };
  return {
    world,
    inputs: {
      frontiers: frontiers ?? [fullSyntheticFrontier()],
      evaluations: evaluations ?? [passingEvaluation()],
      resolvedConsumerIds: resolvedConsumerIds ?? ['synthetic.impl'],
      ...(auditResults ? { auditResults } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Required self-tests through the real audit machinery
// ---------------------------------------------------------------------------

describe('fidelity hardening: required self-tests', () => {
  it('A. missing source material prevents a scope from closing', () => {
    const { world, inputs } = provenWorld();
    // An uncovered clause present in the frontier — cited by nobody,
    // attributed by nobody, dispositioned by nobody — blocks closure past
    // source-tested (it caps at `executable`, never `closed`).
    const extraClause = clause(7, 'A hidden clause about taxes that nobody cited.');
    const withUncovered = computeFidelityAudit(world, {
      ...inputs,
      frontiers: [frontierInput([...inputs.frontiers![0].clauses, extraClause], [], [...inputs.frontiers![0].attributedIds])],
    });
    expect(withUncovered.scopes[0].status).not.toBe('closed');
    expect(withUncovered.scopes[0].status).toBe('executable');
    expect(withUncovered.scopes[0].blockers.join(' ')).toMatch(/uncovered frontier clause/);
  });

  it('B. a partially decomposed source unit prevents closure; a complete one retires the catch-all', () => {
    const unitOb = withFingerprints({
      id: 'unit:synthetic:parent',
      scopeId: SYNTHETIC_SCOPE.id,
      disposition: 'unclassified',
      summary: 'Unit-grain catch-all.',
      passages: [passage()],
      origin: { kind: 'derived-unit', unitId: 'synthetic:parent' },
    });
    const base = provenWorld({ obligations: [obligation(), unitOb] });

    // Without ANY decomposition record the derived obligation stays unclassified → blocked.
    const none = computeFidelityAudit(base.world, base.inputs);
    expect(none.findings.find((f) => f.obligationId === 'unit:synthetic:parent')?.status).toBe('unclassified');
    expect(none.scopes[0].status).toBe('blocked');

    // With only a PARTIAL piece list it becomes partially-decomposed —
    // still conservative, still blocking. Completeness is COMPUTED from
    // sentence coverage, never asserted via a flag.
    const sentences = SYNTHETIC_PAGE.split(/(?<=[.!?])\s+/);
    const partialRecord = computeFidelityAudit(
      { ...base.world, decompositions: [{ unitId: 'synthetic:parent', pieces: [{ text: sentences[0], obligationId: 'synthetic:rule' }] }] },
      base.inputs,
    );
    expect(partialRecord.findings.find((f) => f.obligationId === 'unit:synthetic:parent')?.status).toBe('partially-decomposed');
    expect(partialRecord.scopes[0].status).toBe('blocked');

    // The complete piece list (every sentence, each carried by the child that
    // quotes it) genuinely retires the catch-all and restores closure.
    const complete = computeFidelityAudit(
      {
        ...base.world,
        decompositions: [{ unitId: 'synthetic:parent', pieces: sentences.map((text) => ({ text, obligationId: 'synthetic:rule' })) }],
      },
      base.inputs,
    );
    expect(complete.summary.integrityViolations).toEqual([]);
    expect(complete.findings.find((f) => f.obligationId === 'unit:synthetic:parent')?.status).toBe('decomposed');
    expect(complete.scopes[0].status).toBe('closed');
  });

  it('C. decomposition records must PROVE span coverage, not just declare pieces', () => {
    const sentences = SYNTHETIC_PAGE.split(/(?<=[.!?])\s+/);
    const unitOb = withFingerprints({
      id: 'unit:synthetic:parent',
      scopeId: SYNTHETIC_SCOPE.id,
      disposition: 'unclassified',
      summary: 'Unit-grain catch-all.',
      passages: [passage()],
      origin: { kind: 'derived-unit', unitId: 'synthetic:parent' },
    });
    const world = provenWorld({ obligations: [obligation(), unitOb] }).world;
    const decompose = (pieces: readonly { text: string; obligationId: string | null; reason?: string }[]) =>
      ({ ...world, decompositions: [{ unitId: 'synthetic:parent', pieces }] });

    // Piece outside the parent's rules text → hard violation.
    const notInUnit = computeFidelityAudit(
      decompose([...sentences.map((text) => ({ text, obligationId: 'synthetic:rule' as const })), { text: 'Totally invented sentence about taxes.', obligationId: null, reason: 'narrative' }]),
      provenWorld().inputs,
    );
    expect(notInUnit.summary.integrityViolations.map((v) => v.check)).toContain('decomposition-piece-not-in-unit');

    // Piece assigned to a child whose passages do not quote it → hard violation.
    const unquoted = computeFidelityAudit(
      decompose(sentences.map((text) => ({ text, obligationId: 'synthetic:rule' as const })).map((piece, i) => (i === 1 ? { ...piece, obligationId: null, reason: 'descriptive' } : piece))),
      provenWorld().inputs,
    );
    // (sanity: the irrelevant-piece variant is legal when reasoned)
    expect(unquoted.summary.integrityViolations.map((v) => v.check)).not.toContain('decomposition-piece-unquoted-by-child');
    const childlessUnquoted = computeFidelityAudit(
      decompose([
        { text: 'An orphan piece the child never quoted.', obligationId: 'synthetic:rule' },
        ...sentences.map((text) => ({ text, obligationId: 'synthetic:rule' as const })),
      ]),
      provenWorld().inputs,
    );
    expect(childlessUnquoted.summary.integrityViolations.map((v) => v.check)).toContain('decomposition-piece-unquoted-by-child');

    // Irrelevant piece without a recorded reason → hard violation.
    const noReason = computeFidelityAudit(
      decompose([{ text: sentences[0], obligationId: null }, ...sentences.slice(1).map((text) => ({ text, obligationId: 'synthetic:rule' as const }))]),
      provenWorld().inputs,
    );
    expect(noReason.summary.integrityViolations.map((v) => v.check)).toContain('decomposition-irrelevant-piece-missing-reason');

    // Overlapping pieces (double-counted span) → hard violation.
    const overlapping = computeFidelityAudit(
      decompose([...sentences.map((text) => ({ text, obligationId: 'synthetic:rule' as const })), { text: sentences[0], obligationId: 'synthetic:rule' }]),
      provenWorld().inputs,
    );
    expect(overlapping.summary.integrityViolations.map((v) => v.check)).toContain('decomposition-overlapping-pieces');
  });

  it('D. a materially false source quote fails even if its local SHA is recomputed', () => {
    const corpus = corpusFromPages([{ number: 7, text: SYNTHETIC_PAGE }]);
    const falseQuote = 'The widget gauge is 9 ticks long.';
    const falselyFingerprinted = provenWorld({
      obligations: [obligation({ passages: [{ page: 7, sectionId: null, quote: falseQuote, sha256: passageFingerprint(falseQuote) }] })],
    }).world;
    const violations = verifyPassageProvenance(falselyFingerprinted, corpus);
    expect(violations.map((v) => v.check)).toContain('passage-not-in-canonical-source');
    // The local SHA is internally consistent (no fingerprint-mismatch), which
    // is exactly why canonical-corpus verification exists.
    expect(falselyFingerprinted.obligations[0].passages[0].sha256).toBe(passageFingerprint(falseQuote));

    // And a genuine quote verifies against the same corpus.
    expect(verifyPassageProvenance(provenWorld().world, corpus)).toEqual([]);
  });

  it('E. a nonexistent/stale consumer registration fails resolution', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fidelity-consumers-'));
    // Registration naming a nonexistent module.
    const fake: ConsumerRegistration[] = [{ id: 'fake.consumer', file: 'src/rules/does-not-exist.ts', symbol: 'nothing', description: 'fake' }];
    expect(resolveConsumerRegistrations(fake, { root: dir }).map((v) => v.check)).toContain('consumer-file-missing');
    // Registration whose symbol no longer exists in a real module.
    writeFileSync(join(dir, 'impl.ts'), 'export const otherThing = 1;\n');
    const stale: ConsumerRegistration[] = [{ id: 'stale.consumer', file: 'impl.ts', symbol: 'removedExport', description: 'stale' }];
    expect(resolveConsumerRegistrations(stale, { root: dir }).map((v) => v.check)).toContain('consumer-symbol-missing');
    // Correct registrations resolve.
    writeFileSync(join(dir, 'good.ts'), 'export function goodImpl() { return 1; }\n');
    expect(resolveConsumerRegistrations([{ id: 'ok', file: 'good.ts', symbol: 'goodImpl', description: '' }], { root: dir })).toEqual([]);

    // A ghost export must break the same resolution → computed-status chain
    // even when its independent semantic contract still passes.
    const unresolvedCase = provenWorld();
    const ghostViolations = resolveConsumerRegistrations(unresolvedCase.world.consumers, {
      root: dir,
      exists: () => true,
      readFile: () => '// export function awardXp() {}',
    });
    expect(ghostViolations.map(({ check }) => check)).toContain('consumer-symbol-missing');
    unresolvedCase.inputs.resolvedConsumerIds = unresolvedCase.world.consumers
      .filter((consumer) => !ghostViolations.some((violation) => violation.detail.startsWith(`consumer ${consumer.id}:`)))
      .map(({ id }) => id);
    const unresolved = computeFidelityAudit(unresolvedCase.world, unresolvedCase.inputs);
    expect(unresolved.findings[0].status).toBe('unimplemented');
    expect(unresolved.findings[0].blockers.join(' ')).toMatch(/does not resolve/);
  });

  it('F. consumer behaves differently from the contract: implementation tests pass, strict fidelity fails', () => {
    // Mutant passes every DECLARED traceability proof (files/tests exist),
    // yet its recorded evaluation fails.
    const mutantRun = (input: unknown): unknown => {
      const { charges } = input as { charges: number };
      if (charges < 3) return { invoked: false, charges };
      return { invoked: true, charges: 1 }; // semantic drift: reset broken
    };
    const failing = passingEvaluation(mutantRun);
    expect(failing.passed).toBe(false);
    const world = provenWorld({ evaluations: [failing] });
    const result = computeFidelityAudit(world.world, world.inputs);
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].blockers.join(' ')).toMatch(/semantic evaluation FAILED/);
    expect(result.scopes[0].status).toBe('partial');
  });

  it('G. a prose-only contract cannot reach the strongest semantic proof state', () => {
    const proseOnly = provenWorld({ contracts: [contract({ rows: undefined })] });
    proseOnly.inputs.evaluations = [];
    const result = computeFidelityAudit(proseOnly.world, proseOnly.inputs);
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].blockers.join(' ')).toMatch(/no machine-checkable expectation rows/);
    expect(result.scopes[0].status).toBe('partial');
  });

  it('H. missing required proof classes downgrade status', () => {
    // input-output-table requires positive + negative; rows only carry positive.
    const rowsMissingNegative = provenWorld({
      contracts: [contract({ rows: contractRows().filter((row) => row.cls !== 'negative') })],
      evaluations: [evaluateContract(contract({ rows: contractRows().filter((row) => row.cls !== 'negative') }), syntheticAdapterFor(correctWidget))!],
    });
    const result = computeFidelityAudit(rowsMissingNegative.world, rowsMissingNegative.inputs);
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].missingProofKinds).toContain('negative');
    expect(result.scopes[0].status).toBe('partial');

    // exhaustive-finite demands the exhaustive class specifically.
    const exhaustiveContract: SemanticContract = contract({
      kind: 'exhaustive-finite',
      domain: [{ charges: 2 }, { charges: 3 }, { charges: 4 }],
      rows: [
        { label: 'refused below', cls: 'exhaustive', input: { charges: 2 }, expected: { invoked: false, charges: 2 } },
        { label: 'unlocked at', cls: 'exhaustive', input: { charges: 3 }, expected: { invoked: true, charges: 0 } },
        { label: 'unlocked above', cls: 'exhaustive', input: { charges: 4 }, expected: { invoked: true, charges: 0 } },
      ],
    });
    const finding = computeFidelityAudit(
      { ...provenWorld().world, contracts: [exhaustiveContract] },
      { ...provenWorld().inputs, evaluations: [evaluateContract(exhaustiveContract, syntheticAdapterFor(correctWidget))!] },
    );
    expect(finding.findings[0].missingProofKinds ?? []).not.toContain('exhaustive');
    // …but a row set SMALLER than the declared domain proves nothing.
    const shrunken = computeFidelityAudit(
      { ...provenWorld().world, contracts: [{ ...exhaustiveContract, rows: exhaustiveContract.rows!.slice(0, 2) }] },
      { ...provenWorld().inputs, evaluations: [evaluateContract({ ...exhaustiveContract, rows: exhaustiveContract.rows!.slice(0, 2) }, syntheticAdapterFor(correctWidget))!] },
    );
    expect(shrunken.findings[0].missingProofKinds).toContain('exhaustive');
  });
  it('I. a stateful rule closes ONLY on RECORDED passing replay evidence', () => {
    const statefulContract = contract({ stateful: true });
    const stateful = provenWorld({ contracts: [statefulContract], evaluations: [evaluateContract(statefulContract, syntheticAdapterFor(correctWidget))!] });
    const recordedProof = proof({ kind: 'replay', evidence: 'replay', command: 'audit:fidelity-selftest' });

    // No recorded result → replay evidence contributes nothing → capped below closed.
    const withoutRecording = computeFidelityAudit(
      { ...stateful.world, proofs: [recordedProof] },
      stateful.inputs,
    );
    expect(withoutRecording.findings[0].missingProofKinds).toContain('replay');
    expect(withoutRecording.scopes[0].status).not.toBe('closed');

    // A RECORDED FAILURE also contributes nothing.
    const failedRecording = computeFidelityAudit(
      { ...stateful.world, proofs: [recordedProof] },
      { ...stateful.inputs, auditResults: { 'audit:fidelity-selftest': 'failed' } },
    );
    expect(failedRecording.scopes[0].status).not.toBe('closed');

    // Only a recorded PASSING run constitutes executed replay evidence.
    const passedRecording = computeFidelityAudit(
      { ...stateful.world, proofs: [recordedProof] },
      { ...stateful.inputs, auditResults: { 'audit:fidelity-selftest': 'passed' } },
    );
    expect(passedRecording.findings[0].status).toBe('proven-supported');
    expect(passedRecording.scopes[0].status).toBe('closed');

    // A test-name substring alone (declared evidence) can NEVER satisfy replay.
    const declaredOnly = computeFidelityAudit(
      { ...stateful.world, proofs: [proof({ kind: 'replay', evidence: 'declared', command: undefined })] },
      { ...stateful.inputs, auditResults: { 'audit:fidelity-selftest': 'passed' } },
    );
    expect(declaredOnly.scopes[0].status).not.toBe('closed');
  });

  it('J. a source conflict without an adopted adjudication cannot become executable', () => {
    const unlinked = computeFidelityAudit(provenWorld({ obligations: [obligation({ disposition: 'conflicted' })] }).world, provenWorld().inputs);
    expect(unlinked.findings[0].status).toBe('conflicted-unadjudicated');
    expect(unlinked.scopes[0].status).toBe('blocked');

    const dangling = computeFidelityAudit(
      provenWorld({ obligations: [obligation({ disposition: 'conflicted', adjudicationId: 'icon-1.5:nope' })] }).world,
      provenWorld().inputs,
    );
    expect(dangling.summary.integrityViolations.map((v) => v.check)).toContain('dangling-adjudication-reference');

    const withAdjudication = computeFidelityAudit(
      {
        ...provenWorld({ obligations: [obligation({ disposition: 'conflicted', adjudicationId: 'icon-1.5:test' })] }).world,
        adjudications: [{ id: 'icon-1.5:test', status: 'adopted' }],
      },
      provenWorld().inputs,
    );
    expect(withAdjudication.findings[0].status).toBe('proven-supported');
  });

  it('K. an unregistered project-level strong claim is surfaced as a violation', () => {
    // The registry covers the real canonical files; verify the guard catches
    // an uncovered strong line appended to one of them.
    const tamperedRoot = mkdtempSync(join(tmpdir(), 'fidelity-repo-'));
    mkdirSync(join(tamperedRoot, 'docs'), { recursive: true });
    const todo = readFileSync(join(REPO_ROOT, 'TODO.md'), 'utf8')
      + '\n## Fake subsystem\n\nThe fake subsystem rules are AUTHORITATIVE.\n';
    writeFileSync(join(tamperedRoot, 'TODO.md'), todo);
    const claims = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [] } as never,
      { root: tamperedRoot, readFile: (p: string) => readFileSync(p, 'utf8') },
      PROJECT_CLAIMS.map((c) => ({ ...c })),
    );
    expect(claims.violations.some((v) => v.check === 'unregistered-strong-claim' && /fake subsystem/i.test(v.detail))).toBe(true);
  });

  it('L. a registered documentation claim stronger than computed status fails', () => {
    const partialScope = {
      scopeId: SYNTHETIC_SCOPE.id,
      title: SYNTHETIC_SCOPE.title,
      totalObligations: 1,
      unclassified: 0,
      deterministicExecutable: 1,
      provenSupported: 0,
      implementedUnproven: 1,
      implementedNoContract: 0,
      unimplemented: 0,
      conflictedUnadjudicated: 0,
      decomposed: 0,
      partiallyDecomposed: 0,
      tableFacing: 0,
      deferred: 0,
      descriptive: 0,
      gmFacing: 0,
      playerChoice: 0,
      unimplementedIds: [],
      lackingRequiredProof: [],
      unresolvedConflicts: [],
      evaluatorFailures: [],
      frontierTotalClauses: 0,
      frontierCoveredClauses: 0,
      frontierIrrelevantClauses: 0,
      frontierUncoveredIds: [],
      status: 'partial' as const,
      blockers: ['proof missing'],
    };
    const weakResult = { summary: { integrityViolations: [] }, findings: [], scopes: [partialScope] } as never;
    const anchorText = '| Widget kernel | CLOSED |';
    const repo = mkdtempSync(join(tmpdir(), 'fidelity-repo2-'));
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'docs', 'kernel.md'), `${anchorText}\nsome prose\n`);
    const claim = {
      id: 'claim:widget',
      file: 'docs/kernel.md',
      anchor: anchorText,
      strength: 'closed' as const,
      subject: 'Widget kernel',
      binding: { kind: 'fidelity-scope', scopeId: SYNTHETIC_SCOPE.id },
    } as const;
    const { violations } = checkProjectClaims(weakResult, { root: repo, readFile: (p: string) => readFileSync(p, 'utf8') }, [claim]);
    expect(violations.some((v) => v.check === 'claim-stronger-than-evidence')).toBe(true);
    // And when the computed status supports the claim, it passes.
    const closedScope = { ...partialScope, status: 'closed' as const, blockers: [] };
    const ok = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [{ ...closedScope }] } as never,
      { root: repo, readFile: (p: string) => readFileSync(p, 'utf8') },
      [claim],
    );
    expect(ok.violations).toEqual([]);
  });

  it('M. an intentionally incomplete scope stays green while reporting partial/blocked correctly', () => {
    const incomplete = computeFidelityAudit(
      provenWorld({ obligations: [obligation(), obligation({ id: 'synthetic:new-material', disposition: 'unclassified' })] }).world,
      provenWorld().inputs,
    );
    expect(incomplete.scopes[0].status).toBe('blocked');
    expect(incomplete.summary.integrityViolations).toEqual([]);
    // Green build = zero hard failures despite incompleteness.
    const report = runStrictFidelityAudit(REPO_ROOT);
    // The production repository IS intentionally incomplete at scale.
    expect(report.result.summary.unclassified).toBeGreaterThan(3000);
    expect(report.hardFailures).toEqual([]);
  });

  it('N. a deliberately mutated implementation is rejected through the generic proof pipeline', () => {
    const selfCheck = runPipelineMutationSelfCheck();
    expect(selfCheck).toEqual([]);
    // Every registered mutant goes through evaluateContracts (the SAME
    // generic evaluator used for production adapters) via an adapter swap…
    for (const mutation of SEMANTIC_MUTATIONS) {
      const adapters = new Map([['synthetic:mitigation-domain', { id: mutation.id, run: (input: unknown) => mutation.impl(input as never) }]]);
      const world = {
        scopes: [],
        obligations: [],
        consumers: [],
        contracts: [{
          obligationId: 'synthetic:mitigation-domain',
          kind: 'exhaustive-finite' as const,
          stateful: false,
          statement: '',
          rows: MITIGATION_CONTRACT_ROWS.map((row) => ({
            label: '', cls: 'exhaustive' as const,
            input: { base: row.base, armor: row.armor, kind: row.kind },
            expected: row.expected,
          })),
        }],
        proofs: [],
        adjudications: [],
      };
      const [evaluation] = evaluateContracts(world, adapters);
      expect(evaluation?.passed, `mutant ${mutation.id} must be rejected`).toBe(false);
    }
    // …and mutants that pass a naive positive-only suite prove why ordinary
    // tests are insufficient.
    const sneaky = SEMANTIC_MUTATIONS.find(({ id }) => id === 'floor-off-by-one')!;
    expect(naivePositiveSuite(sneaky.impl)).toBe(true);
  });

  it('O. a fully and genuinely evidenced synthetic scope reaches CLOSED', () => {
    const { world, inputs } = provenWorld();
    const result = computeFidelityAudit(world, inputs);
    expect(result.findings[0].status).toBe('proven-supported');
    expect(result.scopes[0].status).toBe('closed');
    expect(result.summary.integrityViolations).toEqual([]);
    // Frontier accounting is visible and complete.
    const frontier = result.scopes[0];
    expect(frontier.frontierTotalClauses).toBe(frontier.frontierCoveredClauses + frontier.frontierIrrelevantClauses);
    expect(frontier.frontierUncoveredIds).toEqual([]);
  });

  it('P. the small real production scope reaches CLOSED only because its implementation was actually executed', () => {
    const report = runStrictFidelityAudit(REPO_ROOT);
    const advancement = report.result.scopes.find(({ scopeId }) => scopeId === 'advancement')!;
    expect(advancement.status).toBe('closed');
    expect(report.result.summary.evaluationsRun).toBeGreaterThanOrEqual(3);
    expect(report.result.summary.evaluationsPassed).toBe(report.result.summary.evaluationsRun);

    // Negative control: remove the EXECUTED evaluations and the same world
    // drops below closed — proving execution, not declarations, carries it.
    const world = buildProductionWorld();
    const corpus = corpusFromPages(JSON.parse(readFileSync(join(REPO_ROOT, 'src/content/generated/icon-1.5.json'), 'utf8')).pages);
    const { inputs: frontiers } = resolveScopeFrontiers(world.scopes, corpus, world.obligations);
    const withoutExecution = computeFidelityAudit(world, { frontiers });
    const dropped = withoutExecution.scopes.find(({ scopeId }) => scopeId === 'advancement')!;
    expect(dropped.status).not.toBe('closed');
    expect(dropped.status).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// Compact regressions — one per loophole closed in this hardening pass
// ---------------------------------------------------------------------------

describe('hardening regressions: attribution-based frontier coverage', () => {
  const ATTRIBUTION_PAGE = [
    'The frobnicator gains two mojo per interlude.',
    'A frobnicator may also hum once per scene.',
  ].join('\n');
  const ATTRIBUTION_CORPUS = corpusFromPages([{ number: 11, text: ATTRIBUTION_PAGE }]);
  const QUOTED_OBLIGATION = () => withFingerprints({
    id: 'synthetic:frob',
    scopeId: SYNTHETIC_SCOPE.id,
    disposition: 'descriptive',
    summary: 'Quotes the frobnicator passage.',
    passages: [passage(ATTRIBUTION_PAGE, 11)],
    origin: { kind: 'curated' },
  });

  function attributionScope(frontier: ScopeDefinition['frontier']): ScopeDefinition {
    return { ...SYNTHETIC_SCOPE, frontier };
  }

  it('R1. containment alone is PROVENANCE, never coverage: an unattributed quoted clause blocks closure', () => {
    // The obligation quotes the WHOLE page, yet with no attribution entries
    // every clause stays uncovered — a large quotation cannot sweep the
    // clauses inside it into "covered".
    const { inputs } = resolveScopeFrontiers(
      [attributionScope({ pages: [11] })],
      ATTRIBUTION_CORPUS,
      [QUOTED_OBLIGATION()],
    );
    expect(inputs[0].clauses.length).toBe(2);
    expect(inputs[0].attributedIds).toEqual([]);

    // With attributions present, both clauses count as covered.
    const covered = resolveScopeFrontiers(
      [attributionScope({ pages: [11], attributed: [
        { text: 'The frobnicator gains two mojo per interlude.', obligationId: 'synthetic:frob' },
        { text: 'A frobnicator may also hum once per scene.', obligationId: 'synthetic:frob' },
      ] })],
      ATTRIBUTION_CORPUS,
      [QUOTED_OBLIGATION()],
    );
    expect(covered.violations).toEqual([]);
    expect(covered.inputs[0].attributedIds.length).toBe(2);

    // Engine-level: identical worlds differ ONLY in attributedIds → closed vs executable.
    const world = provenWorld().world;
    const clauses = pageClauses(syntheticCorpus(), 7);
    const unattributed = computeFidelityAudit(world, { ...provenWorld().inputs, frontiers: [frontierInput(clauses)] });
    expect(unattributed.scopes[0].status).toBe('executable');
  });

  it('R2. an attribution naming an out-of-scope obligation or an unquoted clause is an integrity violation', () => {
    const dangling = resolveScopeFrontiers(
      [attributionScope({ pages: [11], attributed: [{ text: 'The frobnicator gains two mojo per interlude.', obligationId: 'synthetic:nope' }] })],
      ATTRIBUTION_CORPUS,
      [QUOTED_OBLIGATION()],
    );
    expect(dangling.violations.map((v) => v.check)).toContain('frontier-attribution-entry-dangling');
    expect(dangling.inputs[0].attributedIds).toEqual([]);

    // The named obligation exists but its passages do NOT quote the clause.
    const otherQuotes = withFingerprints({
      ...QUOTED_OBLIGATION(),
      passages: [passage('Some entirely unrelated material.', 12)],
    });
    const unquoted = resolveScopeFrontiers(
      [attributionScope({ pages: [11], attributed: [{ text: 'The frobnicator gains two mojo per interlude.', obligationId: 'synthetic:frob' }] })],
      ATTRIBUTION_CORPUS,
      [otherQuotes],
    );
    expect(unquoted.violations.map((v) => v.check)).toContain('frontier-attribution-unquoted');
    expect(unquoted.inputs[0].attributedIds).toEqual([]);
  });

  it('R3. repeated occurrences have DISTINCT identities: one entry covers exactly one occurrence', () => {
    const DOUBLE_PAGE = [
      'or the same job and gain a mastery',
      'choose a new ability from your job',
      'or the same job and gain a mastery',
    ].join('\n');
    const doubleCorpus = corpusFromPages([{ number: 9, text: DOUBLE_PAGE }]);
    const scopeWith = (irrelevant: readonly { text: string; reason: string; occurrences?: number | 'all' }[]) =>
      [{ ...SYNTHETIC_SCOPE, frontier: { pages: [9], irrelevant } }];

    // Default count 1: only the FIRST occurrence is dispositioned; the second
    // remains an independent uncovered clause.
    const one = resolveScopeFrontiers(
      scopeWith([{ text: 'or the same job and gain a mastery', reason: 'table fragment' }]),
      doubleCorpus,
    );
    expect(one.violations).toEqual([]);
    expect(one.inputs[0].irrelevantIds.length).toBe(1);
    expect(one.inputs[0].clauses.length).toBe(3);

    // 'all': every identical occurrence is explicitly accounted for.
    const all = resolveScopeFrontiers(
      scopeWith([{ text: 'or the same job and gain a mastery', reason: 'table fragment', occurrences: 'all' }]),
      doubleCorpus,
    );
    expect(all.violations).toEqual([]);
    expect(all.inputs[0].irrelevantIds.length).toBe(2);

    // Declaring MORE than exist is staleness, not silent saturation.
    const greedy = resolveScopeFrontiers(
      scopeWith([{ text: 'or the same job and gain a mastery', reason: 'table fragment', occurrences: 3 }]),
      doubleCorpus,
    );
    expect(greedy.violations.map((v) => v.check)).toContain('frontier-disposition-entry-dangling');

    // Two default entries consume the two occurrences one at a time.
    const twice = resolveScopeFrontiers(
      scopeWith([
        { text: 'or the same job and gain a mastery', reason: 'first occurrence' },
        { text: 'or the same job and gain a mastery', reason: 'second occurrence' },
      ]),
      doubleCorpus,
    );
    expect(twice.violations).toEqual([]);
    expect(twice.inputs[0].irrelevantIds.length).toBe(2);
  });

  it('R4. double accounting (disposition + attribution for one clause) fails loudly', () => {
    const doubled = resolveScopeFrontiers(
      [attributionScope({
        pages: [11],
        irrelevant: [{ text: 'The frobnicator gains two mojo per interlude.', reason: 'also dispositioned' }],
        attributed: [{ text: 'The frobnicator gains two mojo per interlude.', obligationId: 'synthetic:frob' }],
      })],
      ATTRIBUTION_CORPUS,
      [QUOTED_OBLIGATION()],
    );
    expect(doubled.violations.map((v) => v.check)).toContain('frontier-double-accounting');
    // And engine-level accounting conservatively refuses to count it either way.
    const engineResult = computeFidelityAudit(provenWorld().world, {
      ...provenWorld().inputs,
      frontiers: [frontierInput(pageClauses(syntheticCorpus(), 7), [pageClauses(syntheticCorpus(), 7)[0].id], [pageClauses(syntheticCorpus(), 7)[0].id])],
    });
    expect(engineResult.scopes[0].blockers.join(' ')).toMatch(/DOUBLE-accounted/);
  });
});

describe('hardening regressions: structural proof shapes', () => {
  it('R5. boundary probes must PROVE below/at/above via extracted scalars, not labels', () => {
    // Genuine probes pass validation…
    expect(validateBoundaryProbes(boundaryContract())).toEqual([]);
    // …a missing extraction path cannot.
    const noPaths = boundaryContract({ boundary: { ...boundaryContract().boundary!, probeValuePaths: undefined! } });
    expect(validateBoundaryProbes(noPaths).every((v) => v.check === 'boundary-probe-scalar-missing')).toBe(true);
    // …a probe extracting a value on the WRONG side of the edge cannot.
    const wrongBelow = boundaryContract({
      boundary: { ...boundaryContract().boundary!, probes: { ...boundaryContract().boundary!.probes, below: { charges: 9 } } },
    });
    expect(validateBoundaryProbes(wrongBelow).map((v) => v.check)).toContain('boundary-probe-relation-wrong');
    // …and a path resolving to nothing cannot.
    const deadPath = boundaryContract({
      boundary: { ...boundaryContract().boundary!, probeValuePaths: { below: 'nope.deep', at: 'charges', above: 'charges' } },
    });
    expect(validateBoundaryProbes(deadPath).map((v) => v.check)).toContain('boundary-probe-scalar-missing');

    // Engine level: the genuine boundary contract reaches proven-supported…
    const good = computeFidelityAudit(
      provenWorld({ contracts: [boundaryContract()] }).world,
      { ...provenWorld().inputs, evaluations: [evaluateContract(boundaryContract(), syntheticAdapterFor(correctWidget))!] },
    );
    expect(good.findings[0].status).toBe('proven-supported');

    // …but dropping one probe's key from the EXECUTED set removes boundary proof.
    const evaluation = evaluateContract(boundaryContract(), syntheticAdapterFor(correctWidget))!;
    const atProbeKey = canonicalFixtureKey({ charges: 3 });
    const truncated: ContractEvaluation = {
      ...evaluation,
      executedInputKeys: evaluation.executedInputKeys.filter((key) => key !== atProbeKey),
    };
    const bad = computeFidelityAudit(
      provenWorld({ contracts: [boundaryContract()], evaluations: [truncated] }).world,
      provenWorld({ contracts: [boundaryContract()], evaluations: [truncated] }).inputs,
    );
    expect(bad.findings[0].status).toBe('implemented-unproven');
    expect(bad.findings[0].missingProofKinds).toContain('boundary');
  });

  it('R6. an evaluation is bound to the EXACT current contract: stale results certify nothing', () => {
    const evaluation = passingEvaluation();
    expect(evaluation.passed).toBe(true);
    // Change the contract AFTER the evaluation was recorded (here: tighten a
    // row). The fingerprint no longer matches, so the old pass must be
    // discarded rather than counted as passing evidence.
    const driftedContract = contract({
      rows: [...contractRows(), { label: 'new demand', cls: 'positive' as const, input: { charges: 5 }, expected: { invoked: true, charges: 0 } }],
    });
    const result = computeFidelityAudit(
      provenWorld({ contracts: [driftedContract], evaluations: [evaluation] }).world,
      provenWorld({ contracts: [driftedContract], evaluations: [evaluation] }).inputs,
    );
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].blockers.join(' ')).toMatch(/STALE/i);

    // Re-evaluating the CURRENT contract restores proof.
    const fresh = evaluateContract(driftedContract, syntheticAdapterFor(correctWidget))!;
    const recovered = computeFidelityAudit(
      provenWorld({ contracts: [driftedContract], evaluations: [fresh] }).world,
      provenWorld({ contracts: [driftedContract], evaluations: [fresh] }).inputs,
    );
    expect(recovered.findings[0].status).toBe('proven-supported');
  });

  it('R7. a "passing" evaluation that did not execute every row is rejected', () => {
    const evaluation = passingEvaluation();
    // Hand-truncate the executed-input record: claims a pass over rows that
    // never ran.
    const lying: ContractEvaluation = { ...evaluation, executedInputKeys: evaluation.executedInputKeys.slice(0, 1) };
    const result = computeFidelityAudit(
      provenWorld({ evaluations: [lying] }).world,
      provenWorld({ evaluations: [lying] }).inputs,
    );
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].blockers.join(' ')).toMatch(/did not actually execute|FAILED/);
  });

  it('R8. exhaustive proof requires evaluated inputs == declared domain EXACTLY', () => {
    // Domain superset of rows: a single labelled row cannot fake exhaustiveness.
    const domainMissingRow = contract({
      kind: 'exhaustive-finite',
      domain: [{ charges: 2 }, { charges: 3 }, { charges: 4 }],
      rows: [
        { label: 'refused below', cls: 'exhaustive', input: { charges: 2 }, expected: { invoked: false, charges: 2 } },
      ],
    });
    const partial = computeFidelityAudit(
      provenWorld({ contracts: [domainMissingRow] }).world,
      { ...provenWorld().inputs, evaluations: [evaluateContract(domainMissingRow, syntheticAdapterFor(correctWidget))!] },
    );
    expect(partial.findings[0].missingProofKinds).toContain('exhaustive');

    // Row beyond the declared domain is equally rejected.
    const extraCase = contract({
      kind: 'exhaustive-finite',
      domain: [{ charges: 2 }],
      rows: [
        { label: 'refused below', cls: 'exhaustive', input: { charges: 2 }, expected: { invoked: false, charges: 2 } },
        { label: 'smuggled extra case', cls: 'exhaustive', input: { charges: 7 }, expected: { invoked: true, charges: 0 } },
      ],
    });
    expect(evaluateContract(extraCase, syntheticAdapterFor(correctWidget))!.executedInputKeys.length).toBe(2);
    const smuggled = computeFidelityAudit(
      provenWorld({ contracts: [extraCase] }).world,
      { ...provenWorld().inputs, evaluations: [evaluateContract(extraCase, syntheticAdapterFor(correctWidget))!] },
    );
    expect(smuggled.findings[0].missingProofKinds).toContain('exhaustive');
  });
});

describe('hardening regressions: executed authority chain', () => {
  const ADAPTER_WORLD = (): Parameters<typeof verifyAdaptersExerciseConsumers>[0] => ({
    scopes: [SYNTHETIC_SCOPE],
    obligations: [obligation()],
    consumers: [{ id: 'synthetic.impl', file: 'src/rules/character.ts', symbol: 'awardXp', description: '' }],
    contracts: [contract()],
    proofs: [],
    adjudications: [],
  });

  it('R9. adapters must mechanically exercise their registered production consumers', () => {
    // Adapter source referencing the registered symbol → fine.
    const exercising = verifyAdaptersExerciseConsumers(
      ADAPTER_WORLD(),
      syntheticAdapterFor(correctWidget),
      { root: '/unused', adapterSourcePath: 'adapter-src.ts', readFile: () => 'import { awardXp } from "../character.js";\nexport const run = awardXp;\n' },
    );
    expect(exercising).toEqual([]);

    // Stub adapter calling unrelated code → hard violation.
    const stubbed = verifyAdaptersExerciseConsumers(
      ADAPTER_WORLD(),
      syntheticAdapterFor(correctWidget),
      { root: '/unused', adapterSourcePath: 'adapter-src.ts', readFile: () => 'const run = (input) => ({ invoked: true, charges: 0 });\n' },
    );
    expect(stubbed.map((v) => v.check)).toContain('adapter-does-not-exercise-consumer');

    // Unreadable adapter module → hard violation (fail-closed).
    const unreadable = verifyAdaptersExerciseConsumers(
      ADAPTER_WORLD(),
      syntheticAdapterFor(correctWidget),
      { root: '/unused', adapterSourcePath: 'adapter-src.ts', readFile: () => { throw new Error('missing'); } },
    );
    expect(unreadable.map((v) => v.check)).toContain('adapter-does-not-exercise-consumer');

    // And the production repository passes its own adapter-exercise check.
    const production = verifyAdaptersExerciseConsumers(buildProductionWorld(), PRODUCTION_ADAPTERS, { root: REPO_ROOT });
    expect(production).toEqual([]);
  });

  it('R10. prerequisite recordings come from ACTUAL executions, recorded once', () => {
    const results = runPrerequisiteAudits(['good-script', 'bad-script'], {
      npm: (args) => ({ status: args[1] === 'good-script' ? 0 : 1 }),
    });
    expect(results).toEqual({ 'bad-script': 'failed', 'good-script': 'passed' });

    // Bound commands are derived from the registry itself: generated-audit
    // claim bindings plus every replay/integration proof command.
    const world = buildProductionWorld();
    const commands = boundEvidenceCommands(world);
    expect(commands).toEqual([...commands].sort());
    expect(new Set(commands).size).toBe(commands.length);
  });

  it('R11. recorded prerequisite results are load-bearing for authority claims', () => {
    const repo = mkdtempSync(join(tmpdir(), 'fidelity-recordings-'));
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { 'some:audit': 'true' } }));
    writeFileSync(join(repo, 'docs', 'widget.md'), '| Widget kernel | CLOSED |\n');
    const claim = {
      id: 'claim:widget-audit',
      file: 'docs/widget.md',
      anchor: '| Widget kernel | CLOSED |',
      strength: 'closed' as const,
      subject: 'Widget kernel audit',
      binding: { kind: 'generated-audit' as const, command: 'some:audit' },
    };
    const emptyResult = { summary: { integrityViolations: [] }, findings: [], scopes: [] } as never;

    // No recording → the claim cannot verify (reported, never accepted).
    const unrecorded = checkProjectClaims(emptyResult, { root: repo, readFile: (p: string) => readFileSync(p, 'utf8') }, [claim]);
    expect(unrecorded.violations).toEqual([]);
    expect(unrecorded.unverifiedClaims.map(({ id }) => id)).toContain('claim:widget-audit');

    // A recorded FAILURE is a hard violation.
    const failed = checkProjectClaims(
      emptyResult,
      { root: repo, readFile: (p: string) => readFileSync(p, 'utf8'), auditResults: { 'some:audit': 'failed' } },
      [claim],
    );
    expect(failed.violations.map(({ check }) => check)).toContain('generated-audit-failed');

    // Only a recorded PASSING run verifies the claim.
    const passed = checkProjectClaims(
      emptyResult,
      { root: repo, readFile: (p: string) => readFileSync(p, 'utf8'), auditResults: { 'some:audit': 'passed' } },
      [claim],
    );
    expect(passed.violations).toEqual([]);
    expect(passed.unverifiedClaims).toEqual([]);
  });

  it('R12. doc rendering is identical with and without per-run authority evidence', () => {
    // The stable doc-mode report must be byte-identical whether or not this
    // particular run executed prerequisites — otherwise the committed
    // document could never survive an aggregate-authority run.
    const plain = runStrictFidelityAudit(REPO_ROOT);
    const withEvidence = runStrictFidelityAudit(REPO_ROOT, {
      auditResults: { 'verify:source-artifacts': 'passed' },
    });

    // The AUTHORITY projection reacts to the recording: the bound claim now
    // verifies and leaves the ephemeral LEGACY/UNVERIFIED list…
    const id = 'claim:deliverables:source-provenance-pipeline';
    expect(plain.unverifiedClaims.some((claim) => claim.id === id)).toBe(true);
    expect(withEvidence.unverifiedClaims.some((claim) => claim.id === id)).toBe(false);
    // …while the STABLE doc-mode output is unchanged.
    expect(generateMarkdown(withEvidence.stableReport))
      .toBe(generateMarkdown({ result: plain.result, unverifiedClaims: plain.unverifiedClaims }));
  });
});

// ---------------------------------------------------------------------------
// Phase-gate strictness — PHASE_THREE_READY must outrun PHASE_TWO_READY
// ---------------------------------------------------------------------------

describe('phase-gate strictness regressions', () => {
  const two = PHASE_GATES.PHASE_TWO_READY.requirements;
  const three = PHASE_GATES.PHASE_THREE_READY.requirements;

  it('the Phase Three registry is a strict superset of the Phase Two registry', () => {
    expect(three.length).toBeGreaterThan(two.length);
    for (const requirement of two) {
      expect(three).toContainEqual(requirement);
    }
    const onlyThree = three.filter((requirement) => !two.includes(requirement));
    expect(onlyThree.length).toBeGreaterThanOrEqual(1);
    // Every extra row names a real roadmap criterion, either machine-backed
    // or an explicit (never-verifiable-by-construction) acceptance criterion.
    for (const requirement of onlyThree) {
      expect(['generated-audit', 'fidelity-scope', 'acceptance-criterion']).toContain(requirement.kind);
    }
  });

  it('every machine input satisfied still leaves BOTH gates LEGACY/UNVERIFIED on their acceptance-criterion rows', () => {
    // Every machine-auditable input EITHER gate carries is satisfied: passing
    // prerequisite audits and a closed sourcebook scope. (The coverage ladder
    // is telemetry, not a gate input.) Both claims must still stay unverified,
    // purely because of their explicit acceptance-criterion rows.
    const deps = {
      root: REPO_ROOT,
      auditResults: {
        'audit:automation': 'passed',
        'audit:architecture': 'passed',
        'verify:source-artifacts': 'passed',
      } as Record<string, 'passed' | 'failed'>,
      coverageStatus: () => 'complete',
    };
    const closedSourcebookScope = {
      scopeId: 'sourcebook-at-large',
      status: 'closed',
    };
    const satisfied = { summary: { integrityViolations: [] }, findings: [], scopes: [closedSourcebookScope] } as never;
    const { violations, unverifiedClaims } = checkProjectClaims(satisfied, deps, PROJECT_CLAIMS);

    // No hard violations — and neither gate can be talked into passing.
    expect(violations).toEqual([]);
    const twoClaim = unverifiedClaims.find(({ id }) => id === 'claim:phase-two-ready');
    expect(twoClaim).toBeDefined();
    expect(twoClaim!.binding.kind).toBe('legacy-unverified');
    if (twoClaim!.binding.kind === 'legacy-unverified') {
      expect(twoClaim!.binding.reason).toMatch(/acceptance criterion "todo-no-open-p0-p1-correctness-defects"/);
    }
    // Phase Three additionally stays unmet on its own Phase Three-only rows.
    const threeClaim = unverifiedClaims.find(({ id }) => id === 'claim:phase-three-ready');
    expect(threeClaim).toBeDefined();
    expect(threeClaim!.binding.kind).toBe('legacy-unverified');
    if (threeClaim!.binding.kind === 'legacy-unverified') {
      expect(threeClaim!.binding.reason).toMatch(/acceptance criterion "encounter-slices-b-and-c-close-end-to-end"/);
    }
  });
});

// ---------------------------------------------------------------------------
// Adversarial acceptance simulations
// ---------------------------------------------------------------------------

describe('adversarial acceptance simulations', () => {
  it('1. a fake consumer registration naming nonexistent code fails the strict audit path', () => {
    const violations = resolveConsumerRegistrations(
      [{ id: 'fake', file: 'src/rules/ghost.ts', symbol: 'ghostFn', description: '' }],
      { root: REPO_ROOT },
    );
    expect(violations.map((v) => v.check)).toContain('consumer-file-missing');
  });

  it('2. changed runtime behavior with untouched proof metadata fails semantic evidence', () => {
    // Production world + production METADATA, but the adapter now maps onto a
    // drifted implementation (what a silent behavior change looks like to the
    // evaluator).
    const driftedAward = (input: unknown): unknown => {
      const i = input as { op: string; char?: { xp: number }; amount?: number };
      if (i.op === 'award' && (i.amount ?? 0) >= 15) {
        return { xp: 15, pendingLevelUps: 0, claimed: true, level: 0 }; // banking silently broken
      }
      return PRODUCTION_ADAPTERS.get('icon-1.5:advancement:xp-bar-bank')!.run(input);
    };
    const adapters = new Map(PRODUCTION_ADAPTERS);
    adapters.set('icon-1.5:advancement:xp-bar-bank', { id: 'drifted', run: driftedAward });
    const evaluations = evaluateContracts(buildProductionWorld(), adapters);
    const failed = evaluations.filter(({ passed }) => !passed);
    expect(failed.map(({ obligationId }) => obligationId)).toContain('icon-1.5:advancement:xp-bar-bank');
  });

  it('3. a changed curated quote with recomputed SHA still fails provenance', () => {
    const world = buildProductionWorld();
    const tampered = {
      ...world,
      obligations: world.obligations.map((o) =>
        o.id === 'icon-1.5:advancement:xp-bar-bank'
          ? {
              ...o,
              passages: o.passages.map((p, index) =>
                index === 0 && p.page === 240
                  ? { ...p, quote: p.quote.replace('15 ticks', '16 ticks'), sha256: '' }
                  : p,
              ),
            }
          : o,
      ),
    };
    // Recompute the local fingerprints so they are internally consistent…
    const refingerprinted = { ...tampered, obligations: tampered.obligations.map((o) => withFingerprints(o)) };
    const fingerprintChecks = refingerprinted.obligations.every((o) =>
      o.passages.every((p) => p.sha256 === passageFingerprint(p.quote)),
    );
    expect(fingerprintChecks).toBe(true);
    // …yet canonical correspondence still fails.
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, 'src/content/generated/icon-1.5.json'), 'utf8')) as { pages: { number: number; text: string }[] };
    expect(verifyPassageProvenance(refingerprinted, corpusFromPages(parsed.pages)).length).toBeGreaterThan(0);
  });

  it('4. removing one clause disposition while claiming completeness blocks closure', () => {
    const world = buildProductionWorld();
    const parsed = JSON.parse(readFileSync(join(REPO_ROOT, 'src/content/generated/icon-1.5.json'), 'utf8')) as { pages: { number: number; text: string }[] };
    const corpus = corpusFromPages(parsed.pages);
    const advancement = world.scopes.find(({ id }) => id === 'advancement')!;
    // Drop ONE irrelevant disposition (a clause nothing cites).
    const victim = advancement.frontier!.irrelevant![0];
    const narrowedScopes = world.scopes.map((scope) =>
      scope.id === 'advancement'
        ? { ...scope, frontier: { ...scope.frontier!, irrelevant: scope.frontier!.irrelevant!.filter((entry) => entry.text !== victim.text) } }
        : scope,
    );
    const narrowedWorld = { ...world, scopes: narrowedScopes };
    const { inputs: reResolved } = resolveScopeFrontiers(narrowedWorld.scopes, corpus, narrowedWorld.obligations);
    const result = computeFidelityAudit(narrowedWorld, { frontiers: reResolved });
    const scope = result.scopes.find(({ scopeId }) => scopeId === 'advancement')!;
    expect(scope.frontierUncoveredIds.length).toBe(1);
    expect(scope.status).not.toBe('closed');
  });

  it('5. a strong project claim outside the registry surfaces as unevidenced', () => {
    const repo = mkdtempSync(join(tmpdir(), 'fidelity-adversarial-claims-'));
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'TODO.md'), 'The summon engine is COMPLETE and battle-ready.\n');
    const { violations } = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [] } as never,
      { root: repo, readFile: (p: string) => readFileSync(p, 'utf8') },
      PROJECT_CLAIMS,
    );
    expect(violations.some((v) => v.check === 'claim-anchor-missing' || v.check === 'unregistered-strong-claim')).toBe(true);
  });

  it('6. a semantic mutant passing a deliberately weak positive-only test is rejected by the oracle', () => {
    const report = runMutationResistanceSuite();
    expect(report.violations).toEqual([]);
    expect(CORRECT_MITIGATION(MITIGATION_CONTRACT_ROWS[0])).toBe(MITIGATION_CONTRACT_ROWS[0].expected);
    const mutant = SEMANTIC_MUTATIONS.find(({ id }) => id === 'floor-off-by-one')!;
    expect(mutant.passesNaiveSuite).toBe(true);
    expect(runPipelineMutationSelfCheck()).toEqual([]);
  });

  it('7. lowercase strong tokens are held to the same registration standard', () => {
    const repo = mkdtempSync(join(tmpdir(), 'fidelity-lowercase-claims-'));
    mkdirSync(join(repo, 'docs'), { recursive: true });
    writeFileSync(join(repo, 'TODO.md'), 'the advancement rules are complete and shipped.\n');
    const { violations } = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [] } as never,
      { root: repo, readFile: (p: string) => readFileSync(p, 'utf8') },
      PROJECT_CLAIMS,
    );
    expect(violations.some((v) => v.check === 'unregistered-strong-claim')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Provenance / normalization unit behavior
// ---------------------------------------------------------------------------

describe('canonical provenance primitives', () => {
  it('normalization absorbs extraction artifacts but rejects wording changes', () => {
    const page = 'Once the bar is full (15 xp), a character can clear all xp and mark a level up .';
    expect(sourceTextContains(page, 'Once the bar is full (15 XP), a character can clear all XP and mark a level up.')).toBe(true);
    expect(sourceTextContains(page, 'a character can clear all xp and mark one level up')).toBe(false);
    expect(normalizeSourceText('“curly” — dash\u2019')).toBe('"curly" - dash\'');
  });

  it('clause resolution is exhaustive per page — there is NO selection filter', () => {
    const corpus = syntheticCorpus();
    const all = pageClauses(corpus, 7);
    expect(all.length).toBe(SYNTHETIC_PAGE.split('\n').length);
    // A scope CANNOT narrow its frontier by pattern; every declared page is
    // fully inside the boundary.
    const resolved = resolveScopeFrontiers(
      [{ ...SYNTHETIC_SCOPE, frontier: { pages: [7] } }],
      corpus,
    );
    expect(resolved.violations).toEqual([]);
    expect(resolved.inputs[0].clauses).toEqual(all);
  });

  it('stale irrelevant dispositions are integrity failures, not silent matches', () => {
    const filtered = resolveScopeFrontiers(
      [{
        ...SYNTHETIC_SCOPE,
        frontier: {
          pages: [7],
          irrelevant: [{ text: 'this clause does not exist anywhere', reason: 'stale policy entry' }],
        },
      }],
      syntheticCorpus(),
    );
    expect(filtered.violations.map((v) => v.check)).toContain('frontier-disposition-entry-dangling');
  });

  it('the evidence graph cannot import the implementation layer (anti-circularity guard)', () => {
    // Mechanical circularity guard: the evidence modules must stay
    // observation-only. If any of them starts importing the adapter layer or
    // runtime rules code, contracts could trivially agree with the code they
    // certify — this test fails BEFORE that design can take hold.
    const evidenceModules = [
      'src/rules/fidelity/types.ts',
      'src/rules/fidelity/engine.ts',
      'src/rules/fidelity/provenance.ts',
      'src/rules/fidelity/docs.ts',
      'src/rules/fidelity/claims.ts',
    ];
    for (const modulePath of evidenceModules) {
      const source = readFileSync(join(REPO_ROOT, modulePath), 'utf8');
      expect(source, `${modulePath} must not import the adapter layer`).not.toMatch(/from '\.\/adapters\.js'/);
      expect(source, `${modulePath} must not import runtime rules code`).not.toMatch(/from '\.\.\/(character|encounter|automation)\.js'/);
      expect(source, `${modulePath} must not import the strict pipeline`).not.toMatch(/from '\.\/strict\.js'/);
    }
    // world.ts observes the catalog/adjudications but never the adapter layer
    // or the strict pipeline.
    const worldSource = readFileSync(join(REPO_ROOT, 'src/rules/fidelity/world.ts'), 'utf8');
    expect(worldSource).not.toMatch(/from '\.\/adapters\.js'/);
    expect(worldSource).not.toMatch(/from '\.\.\/(character|encounter|automation)\.js'/);
    expect(worldSource).not.toMatch(/from '\.\/strict\.js'/);
    // And the contract registry stays pure DATA: no runtime callbacks can be
    // smuggled into expectation rows via the production world.
    for (const contractEntry of buildProductionWorld().contracts) {
      for (const row of contractEntry.rows ?? []) {
        expect(typeof row.input === 'object' || typeof row.input === 'number' || typeof row.input === 'string',
          `contract ${contractEntry.obligationId} row "${row.label}" input must be data`).toBe(true);
        expect(typeof row.expected === 'object' || typeof row.expected === 'number' || typeof row.expected === 'string' || typeof row.expected === 'boolean',
          `contract ${contractEntry.obligationId} row "${row.label}" expected must be data`).toBe(true);
      }
    }
  });
});
