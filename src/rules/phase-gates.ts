/**
 * rules/phase-gates.ts — THE single machine-readable source of truth for the
 * project phase gates (`PHASE_TWO_READY`, `PHASE_THREE_READY`).
 *
 * There is deliberately NO independent boolean constant and no parallel
 * criteria list: everything that asserts a phase gate consumes THIS registry.
 *
 * Three kinds of machine-auditable requirement:
 *
 * - `coverage-item`   — a RULES_COVERAGE entry (src/rules/catalog.ts) must be
 *                       `complete`. Evaluable at runtime/UI time; the app-side
 *                       gate constants are derived from exactly these.
 * - `generated-audit` — a package.json script whose RECORDED passing run (in
 *                       the aggregate authority path,
 *                       `npm run audit:source-fidelity -- --strict
 *                       --run-prereqs`) is required evidence.
 * - `fidelity-scope`  — a computed strict source-fidelity scope status must
 *                       reach the given minimum. Enforced by the project-claims
 *                       audit; can never be flipped by hand.
 *
 * A phase gate may therefore never outrun its evidence: the UI constants only
 * see the coverage half, while the claims audit enforces ALL requirements and
 * reports the gate LEGACY/UNVERIFIED until every one holds.
 */

export type PhaseGateRequirement =
  | { kind: 'coverage-item'; id: string }
  | { kind: 'generated-audit'; command: string }
  | { kind: 'fidelity-scope'; scopeId: string; minStatus: 'source-tested' | 'closed' };

export interface PhaseGateDefinition {
  id: 'PHASE_TWO_READY' | 'PHASE_THREE_READY';
  title: string;
  /** Human-readable prose criteria live in docs/roadmap.md; they are
   * documentation OF this registry, never an independent authority. */
  requirements: readonly PhaseGateRequirement[];
}

const ALL_COVERAGE_ITEMS = [
  'source',
  'creation',
  'narrative',
  'bond-structure',
  'combat-core',
  'advancement',
  'job-structure',
  'job-ability-automation',
  'job-automation',
  'relic-structure',
  'relic-automation',
  'foe-structure',
  'foe-automation',
  'reward-structure',
] as const;

const PHASE_TWO_REQUIREMENTS: readonly PhaseGateRequirement[] = [
  ...ALL_COVERAGE_ITEMS.map((id): PhaseGateRequirement => ({ kind: 'coverage-item', id })),
  { kind: 'generated-audit', command: 'audit:automation' },
  { kind: 'generated-audit', command: 'audit:architecture' },
  { kind: 'fidelity-scope', scopeId: 'sourcebook-at-large', minStatus: 'closed' },
];

export const PHASE_GATES: Readonly<
  Record<'PHASE_TWO_READY' | 'PHASE_THREE_READY', PhaseGateDefinition>
> = {
  PHASE_TWO_READY: {
    id: 'PHASE_TWO_READY',
    title: 'Rules-authoritative tactical core',
    requirements: PHASE_TWO_REQUIREMENTS,
  },
  PHASE_THREE_READY: {
    id: 'PHASE_THREE_READY',
    title: 'Closed local gameplay, shared authority released',
    // Criterion 1 is literally "PHASE_TWO_READY true", so the requirements are
    // inherited wholesale plus the phase-three-specific coverage bars.
    requirements: [...PHASE_TWO_REQUIREMENTS],
  },
};

export type PhaseGateId = keyof typeof PHASE_GATES;

/** Runtime/UI evaluation: ONLY the coverage half can be evaluated inside the
 * app (audit and fidelity-scope requirements are enforced by the strict
 * authority path in CI). Deliberately conservative: an unknown item never
 * counts as complete, and a gate whose audit/scope halves are unmet cannot be
 * asserted true from this function alone. */
export function phaseGateCoverageMet(
  gate: PhaseGateDefinition,
  coverage: ReadonlyArray<{ id: string; status: string }>,
): boolean {
  return gate.requirements.every(
    (requirement) =>
      requirement.kind !== 'coverage-item'
      || coverage.find((item) => item.id === requirement.id)?.status === 'complete',
  );
}
