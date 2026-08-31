/**
 * fidelity/claims.ts — the machine-audited registry of project-level
 * rules-authority claims.
 *
 * Policy: no project-level rules-authority claim (subsystem AUTHORITATIVE,
 * rules engine COMPLETE, encounter slice CLOSED, phase-ready gate) may remain
 * completely outside this registry. Each claim is either:
 *
 *   - bound to a registered fidelity SCOPE, and then enforced: the computed
 *     scope status must be at least as strong as the claim; or
 *   - bound to another canonical GENERATED audit (a package.json script whose
 *     own exit status is the evidence); or
 *   - explicitly declared LEGACY/UNVERIFIED, with a recorded reason — which
 *     is reported in every audit output instead of being silently accepted.
 *
 * A secondary guard scans the canonical documents for strong tokens
 * (AUTHORITATIVE / CLOSED / COMPLETE, uppercase) and requires every such line
 * to be covered by a registered claim anchor or an explicit definitional
 * allowlist entry. An unregistered strong claim is a hard failure: it means
 * project prose is asserting rules authority outside machine-audited state.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FidelityAuditResult } from './types.js';
import { SCOPE_STATUS_RANK, type ScopeStatus } from './types.js';
import { PHASE_GATES, type PhaseGateId } from '../phase-gates.js';

export type ClaimStrength = 'authoritative' | 'complete' | 'closed';

/** One machine-audited input of a compound (phase-gate) claim. The
 * requirement LIST is not maintained here: it is projected from the single
 * phase-gate registry (`src/rules/phase-gates.ts`). */
export type CompoundRequirement =
  | { kind: 'fidelity-scope'; scopeId: string; minStatus: ScopeStatus }
  | { kind: 'generated-audit'; command: string }
  | { kind: 'coverage-item'; id: string }
  /** Projected from the phase-gate registry's acceptance-criterion rows:
   * real roadmap criteria with no machine-auditable proxy yet. They are UNMET
   * by construction and keep their gate LEGACY/UNVERIFIED until upgraded to a
   * machine kind in `src/rules/phase-gates.ts`. */
  | { kind: 'acceptance-criterion'; id: string };

export type ClaimBinding =
  | { kind: 'fidelity-scope'; scopeId: string }
  /** Bound to a package.json audit script AND its RECORDED RESULT. A script
   * merely existing proves nothing: without a recorded 'passed' result the
   * claim cannot verify, and a recorded 'failed' result is a hard violation. */
  | { kind: 'generated-audit'; command: string }
  /** Phase-gate style compound evidence: EVERY requirement must hold for the
   * claim to verify; otherwise it is reported LEGACY/UNVERIFIED rather than
   * silently accepted. */
  | { kind: 'compound'; subject: string; requirements: readonly CompoundRequirement[] }
  | { kind: 'legacy-unverified'; reason: string };

export interface ProjectClaim {
  id: string;
  /** Canonical document carrying the claim. */
  file: string;
  /** Verbatim substring locating the claimed line. Must exist (dangling = hard failure). */
  anchor: string;
  strength: ClaimStrength;
  subject: string;
  binding: ClaimBinding;
}

/** Minimum computed scope rank each claim strength demands when bound to a
 * fidelity scope. `authoritative` ("execution matches source semantics") maps
 * to source-tested; complete/closed demand full closure. */
const REQUIRED_RANK: Readonly<Record<ClaimStrength, ScopeStatus>> = {
  authoritative: 'source-tested',
  complete: 'closed',
  closed: 'closed',
};

/** Canonical documents the secondary guard scans for strong claims. Every
 * document that can make project-level rules-authority or phase-gate claims
 * is inside this list — a strong claim cannot hide in an unscanned status
 * file. */
export const CANONICAL_CLAIM_FILES = [
  'TODO.md',
  'README.md',
  'docs/deliverables.md',
  'docs/rules-foundations.md',
  'docs/rules-coverage.md',
  'docs/roadmap.md',
] as const;

/** Strong authority tokens are matched CASE-INSENSITIVELY: writing "complete"
 * or "closed" in lowercase does not downgrade a claim's meaning, so a strong
 * claim cannot hide from the registry by changing its letter case. Definitional
 * prose is handled by the visible allowlist below, never by case games. */
const STRONG_TOKEN = /\b(AUTHORITATIVE|CLOSED|COMPLETE)\b/i;

/** Lines that mention strong tokens without claiming authority (vocabulary
 * definitions, generated-doc references). Each entry must still match a real
 * line prefix, so stale allowlist entries surface as drift. */
export const CLAIM_ALLOWLIST: readonly { file: string; linePrefix: string; reason: string }[] = [
  { file: 'docs/deliverables.md', linePrefix: '[`roadmap.md`](roadmap.md). Status vocabulary:', reason: 'definitional status-vocabulary legend' },
  { file: 'docs/rules-foundations.md', linePrefix: '| AUTHORITATIVE | Execution matches source semantics for its scope |', reason: 'capability-ladder vocabulary definition' },
  // --- descriptive architecture / product prose (README) -------------------
  { file: 'README.md', linePrefix: 'A rules-first ICON 1.5 character manager', reason: 'product summary; "authoritative" describes server topology, not audit status' },
  { file: 'README.md', linePrefix: '`#/lab` is a public, browser-local human-testing service', reason: 'phase-gate behavior description' },
  { file: 'README.md', linePrefix: 'Render exposes `/health` and `/realtime`.', reason: 'architecture description of command authority' },
  { file: 'README.md', linePrefix: '| `npm run test:e2e` | Run both authoritative transport', reason: 'test-suite table description' },
  // --- definitional closure legend (deliverables) --------------------------
  { file: 'docs/deliverables.md', linePrefix: 'What must exist for the product to be genuinely complete', reason: 'section intro defining scope of document' },
  { file: 'docs/deliverables.md', linePrefix: '> A slice is **closed** when', reason: 'definitional slice-closure criterion' },
  // --- capability-ladder definitions + pattern names (foundations) ---------
  { file: 'docs/rules-foundations.md', linePrefix: "Authoritative map of the engine's reusable mechanical foundations", reason: 'document self-description' },
  { file: 'docs/rules-foundations.md', linePrefix: '    (blocked < partial < executable < source-tested < replay-tested < closed)', reason: 'ladder-order definition' },
  { file: 'docs/rules-foundations.md', linePrefix: 'source-complete).', reason: 'wrapped sentence continuation describing coverage policy' },
  { file: 'docs/rules-foundations.md', linePrefix: 'Closed source-ID manifests, never runtime prose parsing', reason: 'implementation-pattern description' },
  { file: 'docs/rules-foundations.md', linePrefix: 'projection (Rot → Regeneration / defiance suppression). Closed-negative tests', reason: 'test-pattern name in wrapped sentence' },
  { file: 'docs/rules-foundations.md', linePrefix: '| K-P5 | Mastery fold |', reason: 'foundations ledger row; status vocabulary in notes column' },
  { file: 'docs/rules-foundations.md', linePrefix: 'closed-manifest pattern; the foe declarative recipe factories', reason: 'pattern reference in wrapped sentence' },
  { file: 'docs/rules-foundations.md', linePrefix: 'Fail-closed at both layers regardless of typing: the runtime rejects an', reason: 'implementation-pattern description (paired creation-spatial contract enforcement), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'mark a source unit complete by itself ONLY when the unit\'s complete', reason: 'implementation-pattern description (compound-talent completeness contract), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'a unit complete only when every component is wired; removing any one', reason: 'implementation-pattern description (compound-talent completeness contract), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'fail-closed: an un-migrated legacy-shaped mutation is declined, not', reason: 'implementation-pattern description (legacy entity-mutation normalization), not an authority claim' },
  { file: 'TODO.md', linePrefix: '   `RuleMutation.creationSpatial`), fail-closed at the runtime (zero/multi/', reason: 'implementation-pattern description in the corrective-repair changelog, not an authority claim' },
  { file: 'TODO.md', linePrefix: '   audits such a unit complete only when every component is genuinely wired,', reason: 'implementation-pattern description in the corrective-repair changelog, not an authority claim' },
  { file: 'TODO.md', linePrefix: '   the reducer fail-closed declines an un-migrated legacy-shaped mutation —', reason: 'implementation-pattern description in the corrective-repair changelog, not an authority claim' },
  { file: 'TODO.md', linePrefix: '  Closed the U17 gap where multiple effects owned by the same character', reason: 'tranche-changelog status entry describing the landed T6.2 seam, not a subsystem authority claim' },
  { file: 'TODO.md', linePrefix: '  selected order durably, instead of failing closed or inventing a', reason: 'implementation-pattern description in the T6.2 changelog, not an authority claim' },
  { file: 'TODO.md', linePrefix: '     window instead of failing closed, and the `ANSWER_DECISION_WINDOW`', reason: 'implementation-pattern description in the T6.2 changelog, not an authority claim' },
  { file: 'TODO.md', linePrefix: '     effect resolves exactly once; re-answering a closed window rejects;', reason: 'implementation-pattern description in the T6.2 changelog, not an authority claim' },
  // --- ladder rung definition (coverage) -----------------------------------
  { file: 'docs/rules-coverage.md', linePrefix: '| 5 | Authoritative | Execution matches source semantics without hidden bypasses |', reason: 'capability-ladder vocabulary definition' },
  // --- gate/criterion definitions (roadmap) --------------------------------
  { file: 'docs/roadmap.md', linePrefix: 'Phase gates are acceptance criteria, not feature lists. A phase is complete', reason: 'gate-completion definition' },
  { file: 'docs/roadmap.md', linePrefix: '  authoritative with replay fixtures.', reason: 'gate-criterion continuation fragment' },
  { file: 'docs/roadmap.md', linePrefix: 'closed); the recorded order stamps durable `resolvedOrder` ranks and the', reason: 'implementation-pattern description (U17 recorded-ordering semantics), not an authority claim' },
  { file: 'docs/roadmap.md', linePrefix: '## P2 — Foe role entitlements and the first closed foe-complexity slice', reason: 'phase heading naming a GOAL, not a status claim' },
  { file: 'docs/roadmap.md', linePrefix: 'replay; closed negative for unequipped mastery.', reason: 'test-plan continuation fragment' },
  { file: 'docs/roadmap.md', linePrefix: '(P1–P2) does multiplayer have something authoritative to share.', reason: 'rhetorical phase-justification criterion' },
  { file: 'docs/roadmap.md', linePrefix: 'promoting any further source units, with its UNDERLAY PHASE COMPLETE gate', reason: 'phase-gate name reference (proper noun from underlay-completion-plan.md §4), not a status claim' },
  { file: 'docs/roadmap.md', linePrefix: 'census regeneration resumes only after the UNDERLAY PHASE COMPLETE gate.', reason: 'phase-gate name reference (proper noun from underlay-completion-plan.md §4), not a status claim' },
  { file: 'TODO.md', linePrefix: '> resume only after the UNDERLAY PHASE COMPLETE gate', reason: 'phase-gate name reference (proper noun from underlay-completion-plan.md §4), not a status claim' },
  { file: 'TODO.md', linePrefix: '     selection and fails closed on equidistant ties.', reason: 'implementation-pattern description (nearest tie policy), not an authority claim' },
  { file: 'TODO.md', linePrefix: '     their resolvers fail closed on those clauses;', reason: 'implementation-pattern description (retraction fail-closed semantics), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: '`evaluate-query.ts` and fails closed on equidistant ties.', reason: 'implementation-pattern description (nearest tie policy), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'choosers fail closed, cross-owner groups never open a same-owner window);', reason: 'implementation-pattern description (U17 fail-closed semantics), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'invented) are documented non-executable, their resolvers fail closed on', reason: 'implementation-pattern description (retraction fail-closed semantics), not an authority claim' },
  { file: 'TODO.md', linePrefix: '     position reject fail-closed); `RuleExecutionContext.boundNames`', reason: 'implementation-pattern description (reference resolution fail-closed semantics), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'position reject fail-closed; a captured defeated-actor ref stays', reason: 'implementation-pattern description (reference resolution fail-closed semantics), not an authority claim' },
  // --- T6.3 (U17 turn-boundary consumers, 2026-08-31) ----------------------
  { file: 'docs/rules-foundations.md', linePrefix: '### Ordering / Arbitration (U17 underlay) — LANDED/COMPLETE (T3 + T6.2 + T6.3, 2026-08-31)', reason: 'tranche-status heading naming the landed U17 state, not a subsystem authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'decision → a remaining cross-owner/missing-owner tie fails closed). The', reason: 'implementation-pattern description (U17 turn-boundary fail-closed semantics), not an authority claim' },
  { file: 'docs/rules-foundations.md', linePrefix: 'genuine U17 consumer remains. U17 is COMPLETE. The blocking families it', reason: 'tranche-status changelog sentence (fresh-audit conclusion), not a subsystem authority claim' },
  { file: 'docs/roadmap.md', linePrefix: 'COMPLETE/AUTHORITATIVE.** `primitives/ordering.ts` gains', reason: 'tranche-changelog status entry describing the landed T6.3 seam, not a subsystem authority claim' },
  { file: 'docs/roadmap.md', linePrefix: 'and any remaining cross-owner/missing-owner tie fails closed. The command', reason: 'implementation-pattern description (U17 turn-boundary fail-closed semantics), not an authority claim' },
  { file: 'TODO.md', linePrefix: '  U13 seam; U17 remains PARTIAL with exactly that residual — closed by', reason: 'tranche-changelog residual note (T6.2 residual closed by T6.3), not a subsystem authority claim' },
  { file: 'TODO.md', linePrefix: '  U17 now COMPLETE/AUTHORITATIVE.** Finished the remaining U17', reason: 'tranche-changelog status entry describing the landed T6.3 seam, not a subsystem authority claim' },
  { file: 'TODO.md', linePrefix: '     FAILS CLOSED. Never one numeric priority; never array/registration', reason: 'implementation-pattern description (U17 turn-boundary fail-closed semantics), not an authority claim' },
  { file: 'TODO.md', linePrefix: '  responder, permutation validation, fail-closed cross-owner +', reason: 'implementation-pattern description in the T6.3 changelog, not an authority claim' },
  { file: 'TODO.md', linePrefix: '  audit confirmed no other genuine U17 consumer remains — U17 is COMPLETE.', reason: 'tranche-changelog status sentence (fresh-audit conclusion), not a subsystem authority claim' },
  // --- T7 (U2 downstream consumers, 2026-08-31) ----------------------------
  { file: 'docs/rules-foundations.md', linePrefix: '### Role / Perspective (U2 underlay) — AUTHORITATIVE (T1 + T2 + T7, 2026-08-31)', reason: 'tranche-status heading naming the landed U2 consumer-consolidation state, not a standalone subsystem claim (backed by roles.ts + candidate/aura/choice/decision-window routing)' },
];

// ---------------------------------------------------------------------------
// The registry itself
//
// The repository's real, current strong claims. None of these subsystems has
// yet been migrated into strict fidelity scopes, so they are declared
// LEGACY/UNVERIFIED here rather than silently accepted; migrating one means
// building its scope and rebinding the claim.
// ---------------------------------------------------------------------------

const legacy = (reason: string): ClaimBinding => ({ kind: 'legacy-unverified', reason });

/** Projects a phase-gate definition from the single registry into auditable
 * compound requirements. There is deliberately no independent copy of the
 * criteria here — editing the registry edits every consumer at once. */
function gateRequirements(gateId: PhaseGateId): readonly CompoundRequirement[] {
  return PHASE_GATES[gateId].requirements.map((requirement) =>
    requirement.kind === 'coverage-item'
      ? { kind: 'coverage-item' as const, id: requirement.id }
      : requirement.kind === 'generated-audit'
        ? { kind: 'generated-audit' as const, command: requirement.command }
        : requirement.kind === 'acceptance-criterion'
          ? { kind: 'acceptance-criterion' as const, id: requirement.id }
          : { kind: 'fidelity-scope' as const, scopeId: requirement.scopeId, minStatus: requirement.minStatus },
  );
}

export const PROJECT_CLAIMS: readonly ProjectClaim[] = [
  // --- docs/deliverables.md subsystem table ---------------------------------
  {
    id: 'claim:deliverables:source-provenance-pipeline',
    file: 'docs/deliverables.md',
    anchor: '| Source provenance pipeline | COMPLETE |',
    strength: 'complete',
    subject: 'Source provenance/extraction pipeline',
    binding: { kind: 'generated-audit', command: 'verify:source-artifacts' },
  },
  {
    id: 'claim:deliverables:character-rules-engine',
    file: 'docs/deliverables.md',
    anchor: '| Character rules engine | COMPLETE |',
    strength: 'complete',
    subject: 'Character creation/advancement engine breadth',
    binding: legacy('character validation is tested but not decomposed into a strict fidelity scope'),
  },
  {
    id: 'claim:deliverables:encounter-command-event-core',
    file: 'docs/deliverables.md',
    anchor: '| Encounter command/event engine | COMPLETE (core) / PARTIAL (breadth) |',
    strength: 'complete',
    subject: 'Encounter command/event core purity + replay',
    binding: legacy('purity/replay contract is tested directly; no strict fidelity scope exists yet'),
  },
  {
    id: 'claim:deliverables:turn-scheduler',
    file: 'docs/deliverables.md',
    anchor: '| Turn scheduler | COMPLETE |',
    strength: 'complete',
    subject: 'Turn-order scheduler',
    binding: legacy('scheduler replay matrix exists; not bound to a fidelity scope'),
  },
  {
    id: 'claim:deliverables:damage-kernel',
    file: 'docs/deliverables.md',
    anchor: '| Damage kernel | AUTHORITATIVE |',
    strength: 'authoritative',
    subject: 'Damage determination/apply kernel',
    binding: legacy('kernel tests are extensive but no independent source-derived oracle is wired into the fidelity evaluator'),
  },
  {
    id: 'claim:deliverables:attack-kernel',
    file: 'docs/deliverables.md',
    anchor: '| Attack kernel | AUTHORITATIVE |',
    strength: 'authoritative',
    subject: 'Attack resolution/modifiers kernel',
    binding: legacy('kernel tests are extensive but no independent source-derived oracle is wired into the fidelity evaluator'),
  },
  {
    id: 'claim:deliverables:targeting-spatial-kernels',
    file: 'docs/deliverables.md',
    anchor: '| Targeting & spatial kernels | AUTHORITATIVE (core) |',
    strength: 'authoritative',
    subject: 'Targeting/area/range/movement spatial kernels',
    binding: legacy('core geometry is source-tested via fixtures; not bound to a fidelity scope'),
  },
  {
    id: 'claim:deliverables:interrupt-window-engine',
    file: 'docs/deliverables.md',
    anchor: '| Interrupt/window engine | AUTHORITATIVE (U13: when-damaged, defeated, uses-ability, area-inclusion, targeted-by-ability, save-rolled, choice) |',
    strength: 'authoritative',
    subject: 'Interrupt/window engine (U13 decision-window record)',
    binding: legacy('replay-tested via encounter fixtures; not bound to a fidelity scope'),
  },
  {
    id: 'claim:deliverables:lifecycle-engine',
    file: 'docs/deliverables.md',
    anchor: '| Lifecycle engine | AUTHORITATIVE |',
    strength: 'authoritative',
    subject: 'Turn/round boundary lifecycle engine',
    binding: legacy('replay-tested via lifecycle fixtures; not bound to a fidelity scope'),
  },
  {
    id: 'claim:deliverables:resource-registry',
    file: 'docs/deliverables.md',
    anchor: '| Resource registry | COMPLETE |',
    strength: 'complete',
    subject: 'Shared resource registry (nine resources)',
    binding: legacy('reducer-enforced with source pages; not bound to a fidelity scope'),
  },
  {
    id: 'claim:deliverables:combat-settlement',
    file: 'docs/deliverables.md',
    anchor: '| Combat settlement | COMPLETE |',
    strength: 'complete',
    subject: 'Combat settlement & attrition handoff',
    binding: legacy('settlement regression suite exists; not decomposed into a strict fidelity scope'),
  },
  {
    id: 'claim:deliverables:local-vtt-lab',
    file: 'docs/deliverables.md',
    anchor: '| Local VTT (Lab) | COMPLETE (harness) |',
    strength: 'complete',
    subject: 'Local lab harness (#/lab)',
    binding: legacy('phase-exempt human-test surface by design (AGENTS.md §16)'),
  },
  {
    id: 'claim:deliverables:checkpoint-persistence',
    file: 'docs/deliverables.md',
    anchor: '| Checkpoint persistence & recovery | COMPLETE |',
    strength: 'complete',
    subject: 'Checkpoint persistence & recovery',
    binding: legacy('transport/e2e coverage exists; not bound to a fidelity scope'),
  },

  // --- encounter-closure slices ---------------------------------------------
  {
    id: 'claim:slice-a-baseline',
    file: 'docs/deliverables.md',
    anchor: '### Slice A — Baseline encounter — *CLOSED*',
    strength: 'closed',
    subject: 'Encounter closure Slice A (baseline)',
    binding: legacy('closure rests on the P1 integration suites; slice semantics are not yet a strict fidelity scope'),
  },
  {
    id: 'claim:slice-a-todo-mirror',
    file: 'TODO.md',
    anchor: '- **Slice A (baseline)**: CLOSED',
    strength: 'closed',
    subject: 'Encounter closure Slice A (baseline), TODO mirror',
    binding: legacy('mirror of claim:slice-a-baseline'),
  },
  {
    id: 'claim:slice-d-mechanics',
    file: 'docs/deliverables.md',
    anchor: '### Slice D — Attrition chain — *mechanics CLOSED; scene flow open*',
    strength: 'closed',
    subject: 'Encounter closure Slice D (attrition mechanics)',
    binding: legacy('settlement.test.ts covers the mechanics; scene flow remains open and no fidelity scope exists'),
  },

  // --- phase gates (computed in src/rules/catalog.ts) ------------------------
  // The gates are compound claims: every machine-audited input must hold
  // before the claim verifies. Today the fidelity requirement is far from met,
  // so both gates report LEGACY/UNVERIFIED — matching the roadmap's own
  // "gate stays false" state — instead of being silently accepted.
  {
    id: 'claim:phase-two-ready',
    file: 'docs/roadmap.md',
    anchor: '## PHASE_TWO_READY — "Rules-authoritative tactical core"',
    strength: 'complete',
    subject: 'PHASE_TWO_READY — rules-authoritative tactical core',
    binding: {
      kind: 'compound',
      subject: 'PHASE_TWO_READY',
      requirements: gateRequirements('PHASE_TWO_READY'),
    },
  },
  {
    id: 'claim:phase-three-ready',
    file: 'docs/roadmap.md',
    anchor: '## PHASE_THREE_READY — "Closed local gameplay, shared authority released"',
    strength: 'closed',
    subject: 'PHASE_THREE_READY — closed local gameplay, shared authority released',
    binding: {
      kind: 'compound',
      subject: 'PHASE_THREE_READY',
      requirements: gateRequirements('PHASE_THREE_READY'),
    },
  },

  // --- docs/rules-foundations.md maturity sections ---------------------------
  {
    id: 'claim:foundations:player-choice',
    file: 'docs/rules-foundations.md',
    anchor: '### Player choice (CHOOSE underlay) — AUTHORITATIVE + SOURCE-TESTED (2026-08-29)',
    strength: 'authoritative',
    subject: 'Player choice (CHOOSE underlay)',
    binding: legacy('choice.test.ts semantic contract + protocol parity fixtures; no fidelity scope'),
  },
  {
    id: 'claim:foundations:command-event-purity',
    file: 'docs/rules-foundations.md',
    anchor: '### Command/event purity — AUTHORITATIVE + REPLAY-TESTED',
    strength: 'authoritative',
    subject: 'Command/event purity',
    binding: legacy('mirrors deliverables encounter-command-event-core'),
  },
  {
    id: 'claim:foundations:dice-randomness',
    file: 'docs/rules-foundations.md',
    anchor: '### Dice & randomness — AUTHORITATIVE + REPLAY-TESTED',
    strength: 'authoritative',
    subject: 'Dice & randomness (record-once replay)',
    binding: legacy('replay determinism tests exist; no fidelity scope'),
  },
  {
    id: 'claim:foundations:damage',
    file: 'docs/rules-foundations.md',
    anchor: '### Damage — AUTHORITATIVE + REPLAY-TESTED',
    strength: 'authoritative',
    subject: 'Damage kernel (foundations mirror)',
    binding: legacy('mirrors claim:deliverables:damage-kernel'),
  },
  {
    id: 'claim:foundations:attacks',
    file: 'docs/rules-foundations.md',
    anchor: '### Attacks — AUTHORITATIVE + REPLAY-TESTED',
    strength: 'authoritative',
    subject: 'Attack kernel (foundations mirror)',
    binding: legacy('mirrors claim:deliverables:attack-kernel'),
  },
  {
    id: 'claim:foundations:targeting',
    file: 'docs/rules-foundations.md',
    anchor: '### Targeting & target sets — AUTHORITATIVE + SOURCE-TESTED',
    strength: 'authoritative',
    subject: 'Targeting & target sets',
    binding: legacy('mirrors claim:deliverables:targeting-spatial-kernels'),
  },
  {
    id: 'claim:foundations:spatial-geometry',
    file: 'docs/rules-foundations.md',
    anchor: '### Spatial geometry — AUTHORITATIVE (core)',
    strength: 'authoritative',
    subject: 'Spatial geometry',
    binding: legacy('mirrors claim:deliverables:targeting-spatial-kernels'),
  },
  {
    id: 'claim:foundations:resources',
    file: 'docs/rules-foundations.md',
    anchor: '### Resources — COMPLETE',
    strength: 'complete',
    subject: 'Resource system (foundations mirror)',
    binding: legacy('mirrors claim:deliverables:resource-registry'),
  },
  {
    id: 'claim:foundations:lifecycle',
    file: 'docs/rules-foundations.md',
    anchor: '### Lifecycle (turn/round boundaries) — AUTHORITATIVE + REPLAY-TESTED',
    strength: 'authoritative',
    subject: 'Lifecycle engine (foundations mirror)',
    binding: legacy('mirrors claim:deliverables:lifecycle-engine'),
  },
  {
    id: 'claim:foundations:interrupt-window',
    file: 'docs/rules-foundations.md',
    anchor: '### Interrupt / window engine — AUTHORITATIVE for wired triggers',
    strength: 'authoritative',
    subject: 'Interrupt/window engine (foundations mirror)',
    binding: legacy('mirrors claim:deliverables:interrupt-window-engine'),
  },
  {
    id: 'claim:foundations:turn-scheduler',
    file: 'docs/rules-foundations.md',
    anchor: '### Turn scheduler — AUTHORITATIVE + REPLAY-TESTED',
    strength: 'authoritative',
    subject: 'Turn scheduler (foundations mirror)',
    binding: legacy('mirrors claim:deliverables:turn-scheduler'),
  },
  {
    id: 'claim:foundations:passive-projection',
    file: 'docs/rules-foundations.md',
    anchor: '### Passive projection — AUTHORITATIVE + SOURCE-TESTED',
    strength: 'authoritative',
    subject: 'Passive projection (foe-trait keyword manifests)',
    binding: legacy('closed-manifest negative tests exist; no fidelity scope'),
  },
  {
    id: 'claim:foundations:combat-settlement',
    file: 'docs/rules-foundations.md',
    anchor: '### Combat settlement — AUTHORITATIVE + REPLAY-TESTED',
    strength: 'authoritative',
    subject: 'Combat settlement (foundations mirror)',
    binding: legacy('mirrors claim:deliverables:combat-settlement'),
  },
  {
    id: 'claim:foundations:cost-payment',
    file: 'docs/rules-foundations.md',
    anchor: '### Cost/payment — AUTHORITATIVE + SOURCE-TESTED',
    strength: 'authoritative',
    subject: 'Cost/payment kernel',
    binding: legacy('source-tested via payment fixtures; no fidelity scope'),
  },

  // --- lowercase strong claims surfaced by the case-insensitive scan --------
  {
    id: 'claim:infra:schema-v3-migration',
    file: 'docs/roadmap.md',
    anchor: 'schema v3 migration — complete.',
    strength: 'complete',
    subject: 'Schema v3 checkpoint migration',
    binding: legacy('verified by transport/persistence tests; no fidelity scope'),
  },
  {
    id: 'claim:deliverables:settlement-slice-closed',
    file: 'docs/deliverables.md',
    anchor: 'Mechanically closed by P1 (`settlement.test.ts`)',
    strength: 'closed',
    subject: 'Combat settlement slice (P1)',
    binding: legacy('mirrors claim:deliverables:combat-settlement'),
  },
  {
    id: 'claim:roadmap:p2-slice-a-closed',
    file: 'docs/roadmap.md',
    anchor: 'is close (Slice A closed) but Slice B/C closure',
    strength: 'closed',
    subject: 'P2 Slice A (foe-complexity repair slice)',
    binding: legacy('roadmap progress note; tracked by the deliverables census, no fidelity scope'),
  },
];

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface ProjectClaimViolation {
  check:
    | 'claim-anchor-missing'
    | 'claim-stronger-than-evidence'
    | 'claim-command-missing'
    | 'generated-audit-failed'
    | 'unregistered-strong-claim';
  detail: string;
}

export interface ClaimCheckDeps {
  root: string;
  readFile?(path: string): string;
  /** RECORDED results of prerequisite generated audits (from strict
   * orchestration / CI artifacts). A generated-audit-bound claim verifies only
   * when its command has a recorded 'passed' result here; 'failed' is a hard
   * violation; an absent record means the claim cannot verify. */
  auditResults?: Readonly<Record<string, 'passed' | 'failed'>>;
  /** Current RULES_COVERAGE status lookup for coverage-item requirements,
   * wired in by the CLI (the fidelity layer never imports runtime rules
   * code directly). An absent lookup fails the requirement. */
  coverageStatus?: (id: string) => string | undefined;
}

function read(deps: ClaimCheckDeps, path: string): string | null {
  try {
    return (deps.readFile ?? ((p: string) => readFileSync(p, 'utf8')))(join(deps.root, path));
  } catch {
    return null;
  }
}

function packageScripts(deps: ClaimCheckDeps): ReadonlySet<string> {
  const raw = read(deps, 'package.json');
  if (raw === null) return new Set();
  try {
    return new Set(Object.keys((JSON.parse(raw) as { scripts?: Record<string, string> }).scripts ?? {}));
  } catch {
    return new Set();
  }
}

/**
 * Full project-claim audit:
 * 1. every registered claim's anchor must exist in its file;
 * 2. fidelity-scope bindings must be backed by at least the required
 *    computed scope rank;
 * 3. generated-audit bindings must name a real package.json script;
 * 4. legacy-unverified bindings are legal and REPORTED (returned separately);
 * 5. every strong-token line in a canonical file must be covered by a
 *    registered claim anchor or an allowlisted definitional entry.
 */
export function checkProjectClaims(
  result: FidelityAuditResult,
  deps: ClaimCheckDeps,
  claims: readonly ProjectClaim[] = PROJECT_CLAIMS,
): { violations: ProjectClaimViolation[]; unverifiedClaims: ProjectClaim[] } {
  const violations: ProjectClaimViolation[] = [];
  const unverifiedClaims: ProjectClaim[] = [];
  const scripts = packageScripts(deps);
  const scopeById = new Map(result.scopes.map((scope) => [scope.scopeId, scope]));

  const coveredLines = new Map<string, Set<string>>();
  for (const claim of claims) {
    const text = read(deps, claim.file);
    if (text === null) {
      violations.push({ check: 'claim-anchor-missing', detail: `${claim.id}: canonical file ${claim.file} is missing` });
      continue;
    }
    const lines = text.split('\n');
    const lineIndex = lines.findIndex((line) => line.includes(claim.anchor));
    if (lineIndex === -1) {
      violations.push({ check: 'claim-anchor-missing', detail: `${claim.id}: anchor not found in ${claim.file}: "${claim.anchor}"` });
      continue;
    }
    const covered = coveredLines.get(claim.file) ?? new Set<string>();
    covered.add(lines[lineIndex]);
    coveredLines.set(claim.file, covered);

    if (claim.binding.kind === 'fidelity-scope') {
      const scope = scopeById.get(claim.binding.scopeId);
      if (!scope) {
        violations.push({ check: 'claim-stronger-than-evidence', detail: `${claim.id}: bound scope ${claim.binding.scopeId} does not exist` });
      } else if (SCOPE_STATUS_RANK[scope.status] < SCOPE_STATUS_RANK[REQUIRED_RANK[claim.strength]]) {
        violations.push({
          check: 'claim-stronger-than-evidence',
          detail: `${claim.id}: ${claim.file} claims ${claim.strength.toUpperCase()} for "${claim.subject}" but computed scope status is ${scope.status.toUpperCase()}`,
        });
      }
    } else if (claim.binding.kind === 'generated-audit') {
      if (!scripts.has(claim.binding.command)) {
        violations.push({ check: 'claim-command-missing', detail: `${claim.id}: bound audit script "${claim.binding.command}" is not a package.json script` });
        continue;
      }
      const recorded = deps.auditResults?.[claim.binding.command];
      if (recorded === 'failed') {
        violations.push({
          check: 'generated-audit-failed',
          detail: `${claim.id}: bound audit "${claim.binding.command}" has a recorded FAILED result — the claim does not verify`,
        });
      } else if (recorded === undefined) {
        unverifiedClaims.push({
          ...claim,
          binding: legacy(`prerequisite audit "${claim.binding.command}" exists but no pass/fail result was recorded for this run`),
        });
      }
      // recorded === 'passed': verified.
    } else if (claim.binding.kind === 'compound') {
      const unmet: string[] = [];
      for (const requirement of claim.binding.requirements) {
        if (requirement.kind === 'generated-audit') {
          if (!scripts.has(requirement.command)) unmet.push(`audit script "${requirement.command}" missing`);
          else if (deps.auditResults?.[requirement.command] !== 'passed') unmet.push(`audit "${requirement.command}" not passed`);
        } else if (requirement.kind === 'coverage-item') {
          if (deps.coverageStatus?.(requirement.id) !== 'complete') unmet.push(`coverage item "${requirement.id}" not complete`);
        } else if (requirement.kind === 'acceptance-criterion') {
          // Deliberately unverifiable: an acceptance criterion keeps its gate
          // unmet until it is upgraded to a machine-backed requirement.
          unmet.push(`acceptance criterion "${requirement.id}" not yet bound to machine evidence`);
        } else {
          const scope = scopeById.get(requirement.scopeId);
          if (!scope) unmet.push(`scope ${requirement.scopeId} missing`);
          else if (SCOPE_STATUS_RANK[scope.status] < SCOPE_STATUS_RANK[requirement.minStatus]) {
            unmet.push(`scope ${requirement.scopeId} at ${scope.status} (needs ${requirement.minStatus})`);
          }
        }
      }
      if (unmet.length > 0) {
        unverifiedClaims.push({
          ...claim,
          binding: legacy(`${claim.binding.subject}: unmet machine-audited requirements — ${unmet.join('; ')}`),
        });
      }
    } else {
      unverifiedClaims.push(claim);
    }
  }

  // Secondary guard: unregistered strong claims.
  for (const file of CANONICAL_CLAIM_FILES) {
    const text = read(deps, file);
    if (text === null) continue;
    const covered = coveredLines.get(file) ?? new Set<string>();
    text.split('\n').forEach((line, index) => {
      if (!STRONG_TOKEN.test(line)) return;
      if (covered.has(line)) return;
      const allowlisted = CLAIM_ALLOWLIST.find((entry) => entry.file === file && line.startsWith(entry.linePrefix));
      if (allowlisted) return;
      violations.push({
        check: 'unregistered-strong-claim',
        detail: `${file}:${index + 1}: strong claim outside the audited registry: "${line.trim().slice(0, 140)}"`,
      });
    });
  }

  return { violations, unverifiedClaims };
}
