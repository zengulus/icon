import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeFidelityAudit,
  passageFingerprint,
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
import { generateMarkdown } from '../fidelity/docs.js';
import { checkProjectClaims, PROJECT_CLAIMS } from '../fidelity/claims.js';
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
import { runPipelineMutationSelfCheck, runStrictFidelityAudit } from '../fidelity/strict.js';
import type {
  ContractEvaluation,
  ConsumerRegistration,
  FidelityWorld,
  ProofRecord,
  ScopeFrontierInput,
  SemanticContract,
  SourceClause,
  SourceObligation,
} from '../fidelity/types.js';

const REPO_ROOT = join(import.meta.dirname, '../../..');

// ---------------------------------------------------------------------------
// Synthetic world builders — mechanic-agnostic fixtures for the audit itself
// ---------------------------------------------------------------------------

const SYNTHETIC_SCOPE = {
  id: 'synthetic-selftest',
  title: 'Synthetic self-test scope',
  description: 'Fixture scope used by the audit framework tests.',
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

function passage(quote = SYNTHETIC_PAGE) {
  return { page: 7, sectionId: null, quote, sha256: passageFingerprint(quote) };
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
    { label: 'invoke at exactly 3 succeeds', cls: 'boundary' as const, input: { charges: 3 }, expected: { invoked: true, charges: 0 } },
    { label: 'invoke above threshold also succeeds', cls: 'positive' as const, input: { charges: 4 }, expected: { invoked: true, charges: 0 } },
  ];
}

function contract(overrides: Partial<SemanticContract> = {}): SemanticContract {
  return {
    obligationId: 'synthetic:rule',
    kind: 'boundary-constant',
    stateful: false,
    statement: 'Synthetic boundary contract over the widget rule.',
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
    kind: 'boundary',
    evidence: 'declared',
    file: 'src/rules/fidelity/mutation.ts',
    test: 'MITIGATION_CONTRACT_ROWS',
    ...overrides,
  };
}

function frontierInput(clauses: SourceClause[], irrelevantIds: string[] = []): ScopeFrontierInput {
  return { scopeId: SYNTHETIC_SCOPE.id, clauses, irrelevantIds };
}

function fullSyntheticFrontier(): ScopeFrontierInput {
  return frontierInput(pageClauses(syntheticCorpus(), 7));
}

/** Fully-evidenced synthetic world: covered frontier + resolving consumer +
 * row-carrying contract + passing evaluation + declared proof coverage. */
function provenWorld(overrides: Partial<FidelityWorld> & { evaluations?: ContractEvaluation[]; frontiers?: ScopeFrontierInput[]; resolvedConsumerIds?: string[] } = {}) {
  const base: FidelityWorld = {
    scopes: [SYNTHETIC_SCOPE],
    obligations: [obligation()],
    consumers: [{ id: 'synthetic.impl', file: 'src/rules/character.ts', symbol: 'awardXp', description: 'fixture consumer' }],
    contracts: [contract()],
    proofs: [proof({ kind: 'boundary' }), proof({ kind: 'positive', test: 'CORRECT_MITIGATION' })],
    adjudications: [],
  };
  const { evaluations, frontiers, resolvedConsumerIds, ...worldOverrides } = overrides;
  const world = { ...base, ...worldOverrides };
  return {
    world,
    inputs: {
      frontiers: frontiers ?? [fullSyntheticFrontier()],
      evaluations: evaluations ?? [passingEvaluation()],
      resolvedConsumerIds: resolvedConsumerIds ?? ['synthetic.impl'],
    },
  };
}

// ---------------------------------------------------------------------------
// Required self-test classes A–P through the real audit machinery
// ---------------------------------------------------------------------------

describe('fidelity hardening: required self-tests A–P', () => {
  it('A. missing source material prevents a scope from closing', () => {
    const { world, inputs } = provenWorld();
    // An uncovered clause present in the frontier — cited by nobody,
    // dispositioned by nobody — blocks closure.
    const withUncovered = computeFidelityAudit(world, {
      ...inputs,
      frontiers: [frontierInput([...inputs.frontiers![0].clauses, clause(7, 'A hidden clause about taxes that nobody cited.')])],
    });
    expect(withUncovered.scopes[0].status).not.toBe('closed');
    expect(withUncovered.scopes[0].status).toBe('partial');
    expect(withUncovered.scopes[0].blockers.join(' ')).toMatch(/uncovered frontier clause/);
  });

  it('B. a partially decomposed source unit prevents source-complete closure', () => {
    const unitOb = withFingerprints({
      id: 'unit:synthetic:parent',
      scopeId: SYNTHETIC_SCOPE.id,
      disposition: 'unclassified',
      summary: 'Unit-grain catch-all.',
      passages: [passage('The widget gauge is 5 ticks long.')],
      origin: { kind: 'derived-unit', unitId: 'synthetic:parent' },
    });
    const partial = computeFidelityAudit(provenWorld({
      obligations: [obligation(), unitOb],
    }).world, {
      ...provenWorld().inputs,
    });
    // Without ANY decomposition record the derived obligation stays unclassified → blocked.
    expect(partial.findings.find((f) => f.obligationId === 'unit:synthetic:parent')?.status).toBe('unclassified');
    expect(partial.scopes[0].status).toBe('blocked');

    // With only a PARTIAL decomposition record it becomes partially-decomposed —
    // still conservative, still blocking.
    const partialRecord = computeFidelityAudit(
      { ...provenWorld({ obligations: [obligation(), unitOb] }).world, decompositions: [{ unitId: 'synthetic:parent', obligationIds: ['synthetic:rule'], complete: false }] },
      provenWorld().inputs,
    );
    expect(partialRecord.findings.find((f) => f.obligationId === 'unit:synthetic:parent')?.status).toBe('partially-decomposed');
    expect(partialRecord.scopes[0].status).toBe('blocked');
  });

  it('C. a curated obligation cannot silently leave its parent unit fully accounted-for', () => {
    const unitOb = withFingerprints({
      id: 'unit:synthetic:parent',
      scopeId: SYNTHETIC_SCOPE.id,
      disposition: 'unclassified',
      summary: 'Unit-grain catch-all.',
      passages: [passage('The widget gauge is 5 ticks long.')],
      origin: { kind: 'derived-unit', unitId: 'synthetic:parent' },
    });
    // Curated obligation claims to supersede the unit but no decomposition record exists.
    const orphan = computeFidelityAudit(
      provenWorld({ obligations: [obligation({ supersedesUnits: ['synthetic:parent'] }), unitOb] }).world,
      provenWorld().inputs,
    );
    expect(orphan.summary.integrityViolations.map((v) => v.check)).toContain('decomposition-supersede-mismatch');
    // The unit remains unclassified — never silently accounted-for.
    expect(orphan.summary.unitsFullyDecomposed).toEqual([]);
    expect(orphan.findings.find((f) => f.obligationId === 'unit:synthetic:parent')?.status).toBe('unclassified');

    // Only an explicit COMPLETE decomposition record retires the catch-all.
    const complete = computeFidelityAudit(
      { ...provenWorld({ obligations: [obligation(), unitOb] }).world, decompositions: [{ unitId: 'synthetic:parent', obligationIds: ['synthetic:rule'], complete: true }] },
      provenWorld().inputs,
    );
    expect(complete.findings.find((f) => f.obligationId === 'unit:synthetic:parent')?.status).toBe('decomposed');
    expect(complete.summary.integrityViolations).toEqual([]);
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

    // And the engine downgrades an obligation whose consumer did NOT resolve.
    const unresolvedCase = provenWorld({ resolvedConsumerIds: [] });
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
    const world = provenWorld({
      evaluations: [failing],
      // Keep all declared proofs intact — metadata untouched.
    });
    const result = computeFidelityAudit(world.world, world.inputs);
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].blockers.join(' ')).toMatch(/semantic evaluation FAILED/);
    expect(result.scopes[0].blockers.join(' ')).toMatch(/evaluation FAILED/);
  });

  it('G. a prose-only contract cannot reach the strongest semantic proof state', () => {
    const proseOnly = provenWorld({ contracts: [contract({ rows: undefined })] });
    proseOnly.inputs.evaluations = [];
    const result = computeFidelityAudit(proseOnly.world, proseOnly.inputs);
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].blockers.join(' ')).toMatch(/no machine-checkable expectation rows/);
    expect(result.scopes[0].status).toBe('partial');
  });

  it('H. missing required boundary/invariant/exhaustive evidence downgrades status', () => {
    // Boundary-constant requires positive + boundary; rows only carry positive.
    const rowsMissingBoundary = provenWorld({
      contracts: [contract({ rows: contractRows().filter((row) => row.cls !== 'boundary') })],
      evaluations: [passingEvaluation()],
    });
    const result = computeFidelityAudit(rowsMissingBoundary.world, rowsMissingBoundary.inputs);
    expect(result.findings[0].status).toBe('implemented-unproven');
    expect(result.findings[0].missingProofKinds).toContain('boundary');
    expect(result.scopes[0].status).toBe('partial');

    // Exhaustive-finite demands the exhaustive class specifically.
    const exhaustiveContract: SemanticContract = {
      ...contract({ kind: 'exhaustive-finite', rows: [contractRows()[0]] }),
    };
    const finding = computeFidelityAudit(
      { ...provenWorld().world, contracts: [exhaustiveContract] },
      { ...provenWorld().inputs, evaluations: [evaluateContract(exhaustiveContract, syntheticAdapterFor(correctWidget))!] },
    );
    expect(finding.findings[0].missingProofKinds).toContain('exhaustive');
  });

  it('I. a stateful rule without replay evidence cannot close', () => {
    const stateful = provenWorld({ contracts: [contract({ stateful: true })] });
    const result = computeFidelityAudit(stateful.world, stateful.inputs);
    expect(result.findings[0].missingProofKinds).toContain('replay');
    expect(result.scopes[0].status).toBe('executable'); // executed semantics done; replay missing
    expect(result.scopes[0].blockers.join(' ')).toMatch(/replay/);

    const withReplay = computeFidelityAudit(
      { ...stateful.world, proofs: [...stateful.world.proofs, proof({ kind: 'replay', evidence: 'replay', test: 'naivePositiveSuite' })] },
      stateful.inputs,
    );
    expect(withReplay.scopes[0].status).toBe('closed');
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
    const { violations } = checkProjectClaims(
      weakResult,
      { root: repo, readFile: (p: string) => readFileSync(p, 'utf8') },
      [{
        id: 'claim:widget',
        file: 'docs/kernel.md',
        anchor: anchorText,
        strength: 'closed',
        subject: 'Widget kernel',
        binding: { kind: 'fidelity-scope', scopeId: SYNTHETIC_SCOPE.id },
      }],
    );
    expect(violations.some((v) => v.check === 'claim-stronger-than-evidence')).toBe(true);
    // And when the computed status supports the claim, it passes.
    const closedScope = { ...partialScope, status: 'closed' as const, blockers: [] };
    const ok = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [{ ...closedScope }] } as never,
      { root: repo, readFile: (p: string) => readFileSync(p, 'utf8') },
      [{
        id: 'claim:widget',
        file: 'docs/kernel.md',
        anchor: anchorText,
        strength: 'closed',
        subject: 'Widget kernel',
        binding: { kind: 'fidelity-scope', scopeId: SYNTHETIC_SCOPE.id },
      }],
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
          rows: MITIGATION_CONTRACT_ROWS.map((row) => ({ label: '', cls: 'exhaustive' as const, input: row, expected: row.expected })),
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
    expect(evaluateMitigation(sneaky.impl).length).toBeGreaterThan(0);
    function evaluateMitigation(impl: typeof sneaky.impl) {
      return MITIGATION_CONTRACT_ROWS.flatMap((row) => (impl(row) === row.expected ? [] : [row]));
    }
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

  it('P. the small real production scope reaches strong status ONLY because its implementation was actually executed', () => {
    const report = runStrictFidelityAudit(REPO_ROOT);
    const advancement = report.result.scopes.find(({ scopeId }) => scopeId === 'advancement')!;
    expect(advancement.status).toBe('closed');
    expect(report.result.summary.evaluationsRun).toBeGreaterThanOrEqual(3);
    expect(report.result.summary.evaluationsPassed).toBe(report.result.summary.evaluationsRun);

    // Negative control: remove the EXECUTED evaluations and the same world
    // drops below closed — proving execution, not declarations, carries it.
    const world = buildProductionWorld();
    const corpus = corpusFromPages(JSON.parse(readFileSync(join(REPO_ROOT, 'src/content/generated/icon-1.5.json'), 'utf8')).pages);
    const { inputs: frontiers } = resolveScopeFrontiers(world.scopes, corpus);
    const withoutExecution = computeFidelityAudit(world, { frontiers });
    const dropped = withoutExecution.scopes.find(({ scopeId }) => scopeId === 'advancement')!;
    expect(dropped.status).not.toBe('closed');
    expect(dropped.status).toBe('partial');
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
    const corpus = loadRealCorpus();
    expect(verifyPassageProvenance(refingerprinted, corpus).length).toBeGreaterThan(0);
    function loadRealCorpus() {
      const parsed = JSON.parse(readFileSync(join(REPO_ROOT, 'src/content/generated/icon-1.5.json'), 'utf8')) as { pages: { number: number; text: string }[] };
      return corpusFromPages(parsed.pages);
    }
  });

  it('4. removing one clause disposition while claiming completeness blocks closure', () => {
    const world = buildProductionWorld();
    const corpusJson = JSON.parse(readFileSync(join(REPO_ROOT, 'src/content/generated/icon-1.5.json'), 'utf8')) as { pages: { number: number; text: string }[] };
    const corpus = corpusFromPages(corpusJson.pages);
    const advancement = world.scopes.find(({ id }) => id === 'advancement')!;
    // Drop ONE irrelevant disposition (a clause nothing cites).
    const victim = advancement.frontier!.irrelevant![0];
    const narrowedScopes = world.scopes.map((scope) =>
      scope.id === 'advancement'
        ? { ...scope, frontier: { ...scope.frontier!, irrelevant: scope.frontier!.irrelevant!.filter((entry) => entry.text !== victim.text) } }
        : scope,
    );
    const narrowedWorld = { ...world, scopes: narrowedScopes };
    const { inputs: reResolved } = resolveScopeFrontiers(narrowedWorld.scopes, corpus);
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

  it('clause resolution is exhaustive per page under the include filter', () => {
    const corpus = syntheticCorpus();
    const all = pageClauses(corpus, 7);
    expect(all.length).toBe(SYNTHETIC_PAGE.split('\n').length);
    const filtered = resolveScopeFrontiers(
      [{ ...SYNTHETIC_SCOPE, frontier: { pages: [7], include: 'gauge|invok' } }],
      corpus,
    );
    expect(filtered.violations).toEqual([]);
    expect(filtered.inputs[0].clauses.length).toBe(all.length - 1);
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
    expect(filtered.violations.map((v) => v.check)).toContain('frontier-irrelevant-entry-dangling');
  });

  it('the evidence graph cannot import the implementation layer (anti-circularity guard)', () => {
    // §7 mechanical circularity guard: the evidence modules must stay
    // observation-only. If any of them starts importing the adapter layer or
    // runtime rules code, contracts could trivially agree with the code they
    // certify — this test fails BEFORE that design can take hold.
    const evidenceModules = [
      'src/rules/fidelity/types.ts',
      'src/rules/fidelity/world.ts',
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
