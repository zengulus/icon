/**
 * fidelity/mutation.ts — semantic mutation resistance for the audit itself.
 *
 * The property to guarantee: deliberately violating a proven semantic
 * obligation must cause the corresponding semantic audit/proof to fail.
 *
 * This is NOT generic mutation testing. It is a small, rules-aware suite
 * built entirely on SYNTHETIC fixtures (a bounded mitigation-style rule with
 * no ICON mechanic behind it), so the framework's own correctness tests never
 * couple to production mechanics:
 *
 *   - an independent contract table over a fully enumerable domain;
 *   - a correct reference implementation;
 *   - four named semantic mutants (floor dropped, divine pierced,
 *     off-by-one floor, swapped kind);
 *   - a naive positive-only "test suite" that some mutants pass — proving
 *     that ordinary passing tests are insufficient evidence;
 *   - the exhaustive contract oracle that rejects every mutant.
 *
 * The CLI runs `runMutationResistanceSuite()`; if any mutant is accepted by
 * the oracle, or the correct implementation is rejected, the audit fails.
 */

// ---------------------------------------------------------------------------
// Synthetic domain: "mitigation" — deliberately mechanic-agnostic
//
// Source-of-truth SPEC (the contract, written as data + derivation):
//   R1. base <= 0            → 0
//   R2. divine ignores armor → base
//   R3. physical subtracts armor, floored at 0
//   R4. any positive result floors at 1
// Domain: base ∈ 0..5, armor ∈ 0..3, kind ∈ {physical, divine} = 48 rows.
// ---------------------------------------------------------------------------

export type MitigationKind = 'physical' | 'divine';
export interface MitigationInput { base: number; armor: number; kind: MitigationKind }
export interface MitigationContractRow extends MitigationInput { expected: number }
export type MitigationImplementation = (input: MitigationInput) => number;

export const SYNTHETIC_DOMAIN = {
  bases: [0, 1, 2, 3, 4, 5],
  armors: [0, 1, 2, 3],
  kinds: ['physical', 'divine'] as const,
};

/** The DECLARED finite legal-input domain (48 members). Declared separately
 * from the expectation rows so the audit can verify evaluated-input-set ==
 * declared-domain structurally instead of trusting an 'exhaustive' label. */
export const MITIGATION_DOMAIN: readonly MitigationInput[] = (() => {
  const inputs: MitigationInput[] = [];
  for (const base of SYNTHETIC_DOMAIN.bases) {
    for (const armor of SYNTHETIC_DOMAIN.armors) {
      for (const kind of SYNTHETIC_DOMAIN.kinds) {
        inputs.push({ base, armor, kind });
      }
    }
  }
  return inputs;
})();

/** Independent expectation derivation — the ORACLE. Written from the spec
 * above; implementations under test share nothing with it but the types. */
export function deriveExpectedMitigation({ base, armor, kind }: MitigationInput): number {
  if (base <= 0) return 0;
  const afterArmor = kind === 'divine' ? base : Math.max(0, base - armor);
  return Math.max(1, afterArmor);
}

/** The full exhaustive contract table (48 rows), derived once, deterministically. */
export const MITIGATION_CONTRACT_ROWS: readonly MitigationContractRow[] = (() => {
  const rows: MitigationContractRow[] = [];
  for (const base of SYNTHETIC_DOMAIN.bases) {
    for (const armor of SYNTHETIC_DOMAIN.armors) {
      for (const kind of SYNTHETIC_DOMAIN.kinds) {
        rows.push({ base, armor, kind, expected: deriveExpectedMitigation({ base, armor, kind }) });
      }
    }
  }
  return rows;
})();

export const CORRECT_MITIGATION: MitigationImplementation = ({ base, armor, kind }) => {
  if (base <= 0) return 0;
  if (kind === 'divine') return Math.max(1, base);
  return Math.max(1, base - armor);
};

/** A naive positive-only example suite in the shape most hand tests take:
 * happy-path rows only. Mutants M1/M3 pass it — that is exactly the failure
 * mode this audit architecture exists to defeat. */
export function naivePositiveSuite(impl: MitigationImplementation): boolean {
  const happyRows: Array<{ base: number; armor: number; kind: MitigationKind }> = [
    { base: 3, armor: 1, kind: 'physical' },
    { base: 4, armor: 2, kind: 'divine' },
    { base: 2, armor: 0, kind: 'physical' },
    { base: 0, armor: 2, kind: 'divine' },
  ];
  return happyRows.every((row) => impl(row) === deriveExpectedMitigation(row));
}

export interface ContractFailure {
  row: MitigationInput;
  actual: number;
  expected: number;
}

export function evaluateMitigationContract(
  impl: MitigationImplementation,
  rows: readonly MitigationContractRow[] = MITIGATION_CONTRACT_ROWS,
): ContractFailure[] {
  return rows.flatMap((row) => {
    const actual = impl(row);
    return actual === row.expected ? [] : [{ row, actual, expected: row.expected }];
  });
}

// ---------------------------------------------------------------------------
// Named semantic mutations
// ---------------------------------------------------------------------------

export interface SemanticMutation {
  id: string;
  description: string;
  /** Which spec rule it violates. */
  violatedRule: string;
  impl: MitigationImplementation;
  /** Whether the naive positive-only suite passes the mutant (documenting
   * why passing implementation tests are not evidence). */
  passesNaiveSuite: boolean;
}

function passesNaive(impl: MitigationImplementation): boolean {
  return naivePositiveSuite(impl);
}

export const SEMANTIC_MUTATIONS: readonly SemanticMutation[] = ([
  {
    id: 'drop-floor',
    description: 'R4 violated: positive results are no longer floored at 1.',
    violatedRule: 'R4',
    impl: ({ base, armor, kind }: MitigationInput) => (base <= 0 ? 0 : kind === 'divine' ? base : Math.max(0, base - armor)),
  },
  {
    id: 'divine-pierced',
    description: 'R2 violated: divine now subtracts armor like physical.',
    violatedRule: 'R2',
    impl: ({ base, armor }: MitigationInput) => (base <= 0 ? 0 : Math.max(1, base - armor)),
  },
  {
    id: 'floor-off-by-one',
    description: 'R4 mutated: the floor is 2 instead of 1 (passes every happy-path row).',
    violatedRule: 'R4',
    impl: ({ base, armor, kind }: MitigationInput) => (base <= 0 ? 0 : Math.max(2, kind === 'divine' ? base : base - armor)),
  },
  {
    id: 'kind-swapped',
    description: 'R2/R3 swapped: physical ignores armor, divine subtracts it.',
    violatedRule: 'R2,R3',
    impl: ({ base, armor, kind }: MitigationInput) => (base <= 0 ? 0 : Math.max(1, kind === 'physical' ? base : base - armor)),
  },
] as Array<Omit<SemanticMutation, 'passesNaiveSuite'>>).map((mutation) => ({ ...mutation, passesNaiveSuite: passesNaive(mutation.impl) }));

export interface MutationResistanceReport {
  domainSize: number;
  referenceFailures: number;
  checkedMutations: Array<{ id: string; rejectedByOracle: boolean; passesNaiveSuite: boolean }>;
  violations: string[];
}

/** Runs the whole resistance suite. Violations mean the audit machinery
 * itself is broken (a mutant was accepted, or the reference rejected). */
export function runMutationResistanceSuite(): MutationResistanceReport {
  const violations: string[] = [];
  const referenceFailures = evaluateMitigationContract(CORRECT_MITIGATION).length;
  if (referenceFailures !== 0) {
    violations.push(`reference implementation rejected by its own contract (${referenceFailures} failures)`);
  }

  const checkedMutations = SEMANTIC_MUTATIONS.map((mutation) => {
    const failures = evaluateMitigationContract(mutation.impl);
    const rejectedByOracle = failures.length > 0;
    if (!rejectedByOracle) violations.push(`semantic mutation "${mutation.id}" (${mutation.description}) was ACCEPTED by the exhaustive contract oracle`);
    if (rejectedByOracle === false && !mutation.passesNaiveSuite) {
      // The registered expectation about the naive suite disagrees with
      // reality — the fixture bookkeeping itself has drifted.
      violations.push(`fixture drift: mutation "${mutation.id}" naive-suite expectation does not match reality`);
    }
    return { id: mutation.id, rejectedByOracle, passesNaiveSuite: mutation.passesNaiveSuite };
  });

  const naivePassers = SEMANTIC_MUTATIONS.filter((mutation) => mutation.passesNaiveSuite);
  if (naivePassers.length === 0) {
    violations.push('no mutation passes the naive suite — the "tests pass but semantics are wrong" demonstration is vacuous');
  }

  return {
    domainSize: MITIGATION_CONTRACT_ROWS.length,
    referenceFailures,
    checkedMutations,
    violations,
  };
}
