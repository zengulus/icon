/**
 * rules/phase-gates.ts — THE single machine-readable source of truth for the
 * project phase gates (`PHASE_TWO_READY`, `PHASE_THREE_READY`).
 *
 * There is deliberately NO independent boolean constant and no parallel
 * criteria list: everything that asserts a phase gate consumes THIS registry.
 *
 * Three kinds of machine-auditable requirement, plus one explicit placeholder
 * kind that can never verify by construction:
 *
 * - `generated-audit` — a package.json script whose RECORDED passing run (in
 *                       the aggregate authority path,
 *                       `npm run audit:source-fidelity -- --strict
 *                       --run-prereqs`) is required evidence.
 * - `fidelity-scope`  — a computed strict source-fidelity scope status must
 *                       reach the given minimum. Enforced by the project-claims
 *                       audit; can never be flipped by hand.
 * - `coverage-item`   — a RULES_COVERAGE entry (src/rules/catalog.ts) marked
 *                       `complete`. NOT currently used by either gate: broad
 *                       sourcebook coverage is progress telemetry, never phase
 *                       readiness. The kind remains part of the vocabulary for
 *                       future machine-backed rows.
 * - `acceptance-criterion` — a real roadmap criterion (docs/roadmap.md) for
 *                       which NO machine-auditable proxy exists yet. It is
 *                       UNMET by construction: a gate carrying one cannot pass
 *                       until the row is explicitly upgraded to a machine kind
 *                       (`generated-audit` or `fidelity-scope`). This keeps an
 *                       unrepresentable criterion visible and load-bearing
 *                       instead of approximating it with weaker evidence.
 *
 * Both gates below encode docs/roadmap.md's acceptance criteria DIRECTLY; the
 * coverage ladder lives in COVERAGE_ITEM_IDS, deliberately outside the gates.
 *
 * A phase gate may therefore never outrun its evidence: no app-side constant
 * can assert a full gate true, while the claims audit enforces ALL
 * requirements and reports the gate LEGACY/UNVERIFIED until every one holds.
 * A later gate must always be strictly stronger than the gate it builds on.
 */

export type PhaseGateRequirement =
  | { kind: 'coverage-item'; id: string }
  | { kind: 'generated-audit'; command: string }
  | { kind: 'fidelity-scope'; scopeId: string; minStatus: 'source-tested' | 'closed' }
  | { kind: 'acceptance-criterion'; id: string };

export interface PhaseGateDefinition {
  id: 'PHASE_TWO_READY' | 'PHASE_THREE_READY';
  title: string;
  /** Human-readable prose criteria live in docs/roadmap.md; they are
   * documentation OF this registry, never an independent authority. */
  requirements: readonly PhaseGateRequirement[];
}

/** The RULES_COVERAGE progress ladder (src/rules/catalog.ts): sourcebook
 * automation breadth tracked for UI/audit telemetry. DELIBERATELY NOT part of
 * either phase gate's requirements — completing this ladder never asserts
 * phase readiness. */
export const COVERAGE_ITEM_IDS = [
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

/** The roadmap's PHASE_TWO_READY criteria (docs/roadmap.md), one row each in
 * roadmap order. Criteria with a recorded-run proxy use `generated-audit`;
 * everything else is an explicit acceptance-criterion row that stays unmet by
 * construction until real machine evidence becomes bindable. Broad coverage
 * rows were removed: sourcebook breadth is not Phase Two readiness. */
const PHASE_TWO_REQUIREMENTS: readonly PhaseGateRequirement[] = [
  // Roadmap criterion 1: no known P0/P1 correctness defects open in TODO.md.
  { kind: 'acceptance-criterion', id: 'todo-no-open-p0-p1-correctness-defects' },
  // Roadmap criterion 2: command purity + exact-replay suites green.
  { kind: 'acceptance-criterion', id: 'command-purity-and-exact-replay-green' },
  // Roadmap criterion 3: combat settlement implemented (P1 acceptance tests).
  { kind: 'acceptance-criterion', id: 'combat-settlement-p1-acceptance-green' },
  // Roadmap criterion 4: encounter-closure Slices A and D close end to end.
  { kind: 'acceptance-criterion', id: 'encounter-slices-a-and-d-close-end-to-end' },
  // Roadmap criterion 5: automation/architecture audits green; conservative
  // counts unregressed.
  { kind: 'generated-audit', command: 'audit:automation' },
  { kind: 'generated-audit', command: 'audit:architecture' },
  // Strict-authority binding retained beyond the literal roadmap list: the
  // "rules-authoritative tactical core" title still demands the closed
  // sourcebook fidelity scope from the strict claims path.
  { kind: 'fidelity-scope', scopeId: 'sourcebook-at-large', minStatus: 'closed' },
  // Roadmap criterion 6: full CI green.
  { kind: 'acceptance-criterion', id: 'full-ci-green' },
];

/** The roadmap's PHASE_THREE_READY-only criteria (docs/roadmap.md), each
 * carried as its own requirement. None has a faithful single-script or
 * single-scope proxy yet — in particular no committed e2e suite yet proves
 * reconnect recovery against a configured deployment — so they are recorded
 * as acceptance criteria rather than approximated by weaker machine rows.
 * Each must be upgraded to a machine kind when real evidence becomes
 * bindable; until then PHASE_THREE_READY cannot pass even if every
 * PHASE_TWO_READY requirement holds. */
const PHASE_THREE_ONLY_REQUIREMENTS: readonly PhaseGateRequirement[] = [
  // Roadmap criterion 2: Encounter Slices B (player complexity) and C (foe
  // complexity) close end to end (docs/deliverables.md §Encounter closure).
  { kind: 'acceptance-criterion', id: 'encounter-slices-b-and-c-close-end-to-end' },
  // Roadmap criterion 3: local VTT covers setup, selection, Slow, targeting,
  // movement, abilities, interrupts, reload/replay without UI-local mechanics
  // decisions.
  { kind: 'acceptance-criterion', id: 'local-vtt-full-gameplay-loop-without-ui-local-rules' },
  // Roadmap criteria 4 + 5: multiplayer transport + browser acceptance suites
  // green against a configured deployment, reconnect recovery tested, and no
  // hidden-state oracle leaks in the server projection test suite.
  { kind: 'acceptance-criterion', id: 'multiplayer-transport-and-browser-acceptance-against-configured-deployment' },
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
    // Roadmap criterion 1 is literally "PHASE_TWO_READY true" — inherited
    // wholesale — PLUS the phase-three-specific requirements above, so this
    // gate is strictly conjunctively stronger than PHASE_TWO_READY: it can
    // never become ready merely because Phase Two is ready.
    requirements: [...PHASE_TWO_REQUIREMENTS, ...PHASE_THREE_ONLY_REQUIREMENTS],
  },
};

export type PhaseGateId = keyof typeof PHASE_GATES;

/** Runtime/UI evaluation of the COVERAGE LADDER ONLY — never a phase gate.
 * Deliberately conservative: an unknown item never counts as complete. The
 * full PHASE_*_READY gates are evaluated exclusively by the strict claims
 * path; no runtime boolean can assert them. */
export function coverageLadderComplete(
  coverage: ReadonlyArray<{ id: string; status: string }>,
): boolean {
  return COVERAGE_ITEM_IDS.every(
    (id) => coverage.find((item) => item.id === id)?.status === 'complete',
  );
}
