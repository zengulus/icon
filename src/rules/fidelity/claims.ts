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

export type ClaimStrength = 'authoritative' | 'complete' | 'closed';

/** One machine-audited input of a compound (phase-gate) claim. */
export type CompoundRequirement =
  | { kind: 'fidelity-scope'; scopeId: string; minStatus: ScopeStatus }
  | { kind: 'generated-audit'; command: string };

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

const STRONG_TOKEN = /\b(AUTHORITATIVE|CLOSED|COMPLETE)\b/;

/** Lines that mention strong tokens without claiming authority (vocabulary
 * definitions, generated-doc references). Each entry must still match a real
 * line prefix, so stale allowlist entries surface as drift. */
export const CLAIM_ALLOWLIST: readonly { file: string; linePrefix: string; reason: string }[] = [
  { file: 'docs/deliverables.md', linePrefix: '[`roadmap.md`](roadmap.md). Status vocabulary:', reason: 'definitional status-vocabulary legend' },
  { file: 'docs/rules-foundations.md', linePrefix: '| AUTHORITATIVE | Execution matches source semantics for its scope |', reason: 'capability-ladder vocabulary definition' },
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
    anchor: '| Interrupt/window engine | AUTHORITATIVE (when-damaged, defeated, uses-ability, area-inclusion, targeted-by-ability, save-rolled) |',
    strength: 'authoritative',
    subject: 'Interrupt/window engine for wired triggers',
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
      requirements: [
        { kind: 'generated-audit', command: 'audit:automation' },
        { kind: 'fidelity-scope', scopeId: 'sourcebook-at-large', minStatus: 'closed' },
      ],
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
      requirements: [
        { kind: 'generated-audit', command: 'audit:automation' },
        { kind: 'fidelity-scope', scopeId: 'sourcebook-at-large', minStatus: 'closed' },
      ],
    },
  },

  // --- docs/rules-foundations.md maturity sections ---------------------------
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
