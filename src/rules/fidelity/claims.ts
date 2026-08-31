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
 * A secondary guard scans the canonical documents for potentially strong
 * statements and classifies each occurrence: only statements that occupy a
 * canonical status SURFACE (a status heading, a table status cell, or a
 * state-verb predicate over a named subject) are treated as project claims
 * requiring registration. Strong VOCABULARY is never forbidden; ordinary
 * prose using the words ("fail closed", "closed set", definitions, changelog
 * operation descriptions) passes without any exemption. Any unregistered
 * strong CLAIM on a status surface is a hard failure: it means project prose
 * is asserting rules authority outside machine-audited state.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FidelityAuditResult } from './types.js';
import { SCOPE_STATUS_RANK, type ScopeStatus } from './types.js';
import { PHASE_GATES, type PhaseGateId } from '../phase-gates.js';

export type ClaimStrength =
  /** "Execution matches source semantics" — the highest claim. */
  | 'authoritative'
  /** "Semantically complete" — the underlay/shared authority fully represents
   * the declared scope. Stronger than `landed`: a LANDED slice is NOT an
   * underlay-completeness claim. */
  | 'complete'
  /** Slice/closure marker. */
  | 'closed'
  /** EXPLICIT SLICE-PROGRESS, never completeness: "a slice of this subsystem
   * landed", deliberately weaker than `complete`. The claim machinery must
   * never reinterpret a LANDED status heading as a COMPLETE-strength
   * semantic-authority claim — the underlay itself may remain PARTIAL. */
  | 'landed';

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
  /** Verbatim substring locating the claimed line. Must exist (dangling = hard
   * failure). */
  anchor: string;
  /** Additional verbatim substrings that are RESTATEMENTS of the same claim in
   * any canonical document (e.g. a status heading and its changelog mirrors).
   * Each entry names its own file, so a claim can legitimately span documents.
   * An anchor covers EVERY occurrence of that line in its file. */
  anchors?: readonly { file: string; anchor: string }[];
  strength: ClaimStrength;
  subject: string;
  binding: ClaimBinding;
}

/** Minimum computed scope rank each claim strength demands when bound to a
 * fidelity scope. `authoritative` ("execution matches source semantics") maps
 * to source-tested; complete/closed demand full closure. `landed` is a
 * slice-progress marker, NOT a completeness/authority claim — bound to a
 * fidelity scope it demands only the minimum progress rank, so a PARTIAL
 * underlay with a landed slice never over-claims. */
const REQUIRED_RANK: Readonly<Record<ClaimStrength, ScopeStatus>> = {
  authoritative: 'source-tested',
  complete: 'closed',
  closed: 'closed',
  landed: 'partial',
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

// ---------------------------------------------------------------------------
// Strong-claim surface classifier
//
// A strong WORD is never forbidden. Only a strong CLAIM — a statement that
// asserts project/rules authority on a canonical status surface — must be
// registered. The classifier decides which strong-token occurrences are
// claims; everything else is ordinary prose or an explicit vocabulary
// definition and passes with no exemption database.
// ---------------------------------------------------------------------------

const CORE_STRONG_RE = /\b(authoritative|complete|closed)\b/i;

/** Status markers accepted in the STATUS SLOT of an ATX heading. This is
 * surface-only vocabulary (a heading "— DONE" or "— COMPLETE" still asserts a
 * state); it is never applied to prose. Keeping a small explicit set means a
 * heading cannot be reworded with an equivalent marker to dodge registration
 * while ordinary prose never triggers on these words. */
const HEADING_STATUS_MARKERS = [
  'authoritative',
  'complete',
  'closed',
  'done',
  'canonical',
  'landed',
  'fully',
  'full',
];

const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+)$/;

/** A strong word used as a compound or noun-modifier is ordinary prose
 * ("fail closed", "fail-closed", "closed set", "complete mapping",
 * "Closed-negative tests", "source-complete"). */
function isModifierOrCompoundUsage(line: string): boolean {
  const lower = line.toLowerCase();
  if (/\bfail(?:s|ed|ing)?\s+closed\b/.test(lower)) return true;
  if (/\bfail\s*[-–]\s*closed\b/.test(lower)) return true;
  // hyphen-adjoined modifiers on either side of the strong word.
  if (/[-–]\s*(closed|complete)\b/.test(lower)) return true;
  if (/\b(closed|complete)\s*[-–]/.test(lower)) return true;
  // noun-modifier adjectives: "closed set", "closed manifest", "complete mapping", …
  if (/\bclosed\s+(set|manifests?|circle|negative|source[- ]id|sourcebook|manifest[- ]pattern)\b/.test(lower)) return true;
  if (/\bcomplete\s+mapping\b/.test(lower)) return true;
  return false;
}

/** A capability-ladder or status-vocabulary legend (defines the terms, does
 * not assert a state). */
function isDefinitionLegend(line: string): boolean {
  const lower = line.toLowerCase();
  // ordering ladder — at least two "x < y < z" steps and a strong word.
  // The strong rung is usually the LAST term, so we do not require a trailing
  // "<": e.g. "(blocked < partial < executable < source-tested < replay-tested
  // < closed)".
  if (/(?:<\s*[a-z][a-z0-9-]*\s*){2,}/i.test(line) && CORE_STRONG_RE.test(lower)) return true;
  // explicit status-vocabulary legend line.
  if (/\bstatus\s+vocabulary\b/.test(lower)) return true;
  // A table cell that is itself followed by a definition ("Execution matches…").
  if (isTableDefinition(rowCells(lower))) return true;
  return false;
}

function rowCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed.slice(1, -1).split('|').map((cell) => cell.trim());
}

const TABLE_STATUS_CELL_RE = /^(authoritative|complete|closed|done|canonical)(\([^)]*\))?(\s*\/\s*[^|]*)?$/i;

/** A markdown table row whose strong token is a canonical STATUS CELL (a bare
 * strong word in its own cell) with a named subject before it is a status
 * surface. A row that merely DEFINES the term is a legend, not a claim. */
function classifyTableRow(line: string): 'claim' | 'definition' | null {
  const cells = rowCells(line);
  if (cells.length === 0) return null;
  const statusIdx = cells.findIndex((cell) => TABLE_STATUS_CELL_RE.test(cell));
  if (statusIdx === -1) return null;
  const next = cells[statusIdx + 1];
  // Definitional legend: the adjacent cell explains what the term means.
  if (next !== undefined && /^(execution matches|means|defined as|is when|refers to|-\s)/i.test(next)) {
    return 'definition';
  }
  if (statusIdx >= 1) {
    const subject = cells[statusIdx - 1];
    const isIndex = subject === '' || /^\d+$/.test(subject);
    if (!isIndex) return 'claim';
  }
  return next !== undefined ? 'definition' : 'claim';
}

function isTableDefinition(cells: string[]): boolean {
  if (cells.length < 2) return false;
  const idx = cells.findIndex((cell) => TABLE_STATUS_CELL_RE.test(cell));
  if (idx === -1) return false;
  return cells[idx + 1] !== undefined && /^(execution matches|means|defined as|is when|refers to|-\s)/i.test(cells[idx + 1]);
}

/** The STATUS SLOT of an ATX heading (: the trailing `—`/`-`/`:`-delimited
 * segment). Returns the lowercase leading marker if it reads as a status, else
 * null. A heading declaring a state here is a surface; a narrative/goal heading
 * whose strong word is mid-sentence is handled as prose below. */
function headingStatusSlot(line: string): string | null {
  const m = line.match(HEADING_RE);
  if (!m) return null;
  const text = m[1].trim();
  const segments = text.split(/\s+(?:—|–|-)\s+/);
  let last = segments[segments.length - 1].replace(/^[*_"\s]+/, '').replace(/[*_"\s]+$/, '');
  const lead = (last.match(/^([a-zA-Z][a-zA-Z/_-]*)/)?.[1] ?? '').toLowerCase();
  for (const marker of HEADING_STATUS_MARKERS) {
    if (lead === marker || lead === `${marker}/` || lead.startsWith(`${marker} +`) || lead.startsWith(`${marker}/`)) {
      return marker;
    }
  }
  return null;
}

const STATE_VERB_RE = /\b(?:is|are|was|were|be|been|being|remains?|remain|becomes?|stays?|stay)\s+(?:still\s+|no\s+longer\s+)?(authoritative|complete|closed)\b/i;
const SUBJECT_ELLIPSIS_RE = /\b(?:U\d+|P\d+|Slice\s+[A-Z])\s+(?:now|already|currently|is\s+now)?\s*(?:authoritative|complete|closed|done)(?:\s*[/.,;:)\]—]|$)/i;

/** Whether the SUBJECT POSITION (the noun phrase immediately preceding the
 * state verb) names a PARTICULAR, project-bearing subject — a U#/P# underlay
 * or phase id, a backticked/ALL-CAPS code name, or a noun headed by a DEFINING
 * determiner/possessive/demonstrative ("the advancement rules", "this
 * subsystem", "our space kernel"). Only the IMMEDIATE subject decides, so a
 * sentence-leading capitalized common word elsewhere in the line ("Encounter
 * and table commands are authoritative…") never counts. A BARE common noun
 * right before the verb ("…commands are authoritative", "…result) are
 * closed") names no particular project artifact and is ordinary prose.
 *
 * The indefinite/generic determiners (a/an/each/every/any/some) are excluded
 * — they make a class-generic definition, handled before this test. */
function isProjectStatusSubject(before: string): boolean {
  const tail = before.slice(-64);
  // Underlay/phase ids and backticked code names.
  if (/\b[Uu]\d+\b|\b[Pp]\d+\b|`[A-Za-z0-9_:/.#-]+`/.test(tail)) return true;
  // ALL-CAPS acronym/identifier (VTT, README, DONE is not here). Case-sensitive:
  // "Encounter"/"Spells" (initial-cap only) never match.
  if (/\b[A-Z][A-Z0-9]{1,}\b/.test(tail)) return true;
  // A noun headed by a DEFINING determiner.
  if (/\b(?:the|this|that|these|those|our|my|its|his|her|their)\s+\w[\w .-]{0,50}$/i.test(tail)) return true;
  return false;
}

/** A state-verb predicate over a project-bearing subject ("U17 is COMPLETE",
 * "the summon engine is complete", "U2/U13/U17 remain AUTHORITATIVE") is a
 * genuine status surface. It is NOT a claim when the subject is a generic
 * class ("A phase is complete"), when a conditional/definitional qualifier
 * follows ("closed only when…"), when it is a negation, or when the subject is
 * a BARE common noun ("results are closed") that names no particular project
 * artifact. There is NO blanket "by design"/"architecturally" qualifier
 * exemption: "U8 is AUTHORITATIVE by design" is a claim because the SUBJECT
 * (a project underlay id) is the meaning-bearing surface. THIS treats
 * "X re-certified AUTHORITATIVE" as a narrated event, not a current-state
 * claim: the guard protects current-state authority, not descriptions of
 * certification actions or of closed local operations. */
function isSubjectPredicateClaim(line: string): boolean {
  const s = line.trim();
  const pred = s.match(STATE_VERB_RE);
  if (pred) {
    if (/\b(?:is|are|was|were|remains?|remain)\s+not\s+(?:authoritative|complete|closed)\b/i.test(pred[0])) return false;
    const before = s.slice(0, pred.index!);
    const after = s.slice(pred.index! + pred[0].length, pred.index! + pred[0].length + 90);
    // A continuation/definitional qualifier means the token is explanatory,
    // not a bare status declaration.
    if (/\b(only when|only if|whenever|\bwhen\b|\bif\b|by itself|means|provided|is defined as)\b/i.test(after)) return false;
    // The subject must actually appear on this line (a continuation fragment
    // like "> remain AUTHORITATIVE" whose subject is on the previous line is
    // prose, not a claim).
    if (!/\b[a-zA-Z][\w-]*\b/.test(before)) return false;
    // A generic-class definition with an indefinite determiner subject
    // ("A phase is complete", "a slice is closed") — explanatory, not a claim.
    if (/(?:a|an|each|every|any|some)\s+\w+[\w .-]{0,60}\s*$/i.test(before)) return false;
    // The surface meaning comes from the SUBJECT: a bare common noun does not
    // assert project authority. No blanket by-design/architecturally bypass.
    return isProjectStatusSubject(before);
  }
  if (SUBJECT_ELLIPSIS_RE.test(s)) return true;
  return false;
}

type StrongLineClass = 'claim' | 'definition' | 'prose' | 'none';

/** Classify a strong-token (or status-heading) line. 'none' means there is
 * nothing to guard; 'claim' means unregistered instances must be reported;
 * 'definition' and 'prose' pass without any registration. */
export function classifyStrongLine(line: string): StrongLineClass {
  // A heading status slot is a surface even when the marker is an equivalent
  // word ("— DONE") that is not one of the three core strong tokens.
  if (headingStatusSlot(line) !== null) return 'claim';

  const lower = line.toLowerCase();
  if (!CORE_STRONG_RE.test(lower)) return 'none';

  // A genuine claim SURFACE must WIN over unrelated ordinary prose on the same
  // line: "U8 is AUTHORITATIVE; the reducer fails closed on malformed state"
  // is a claim despite also containing "fails closed". Only when NO occurrence
  // on the line is a claim surface do the modifier/legend/prose fast-outs
  // decide how the strong vocabulary reads.
  if (isSubjectPredicateClaim(line)) return 'claim';
  const table = classifyTableRow(line);
  if (table !== null) return table;

  if (isModifierOrCompoundUsage(line)) return 'prose';
  if (isDefinitionLegend(line)) return 'definition';

  return 'prose';
}

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

  // --- eponymous status headings surfaced by the surface guard (these are
  //     real canonical status surfaces, now audited instead of allowlisted) --
  {
    id: 'claim:foundations:u2-authoritative',
    file: 'docs/rules-foundations.md',
    anchor: '### Role / Perspective (U2 underlay) — AUTHORITATIVE (T1 + T2 + T7; T8b repair+re-cert, 2026-08-31; T8c branded-seam + owner-contract re-cert, 2026-08-31)',
    strength: 'authoritative',
    subject: 'Role / Perspective (U2 underlay)',
    binding: legacy('U2 status re-certified at T8c by roles.ts + candidate/aura/choice/decision-window routing; no strict fidelity scope'),
  },
  {
    id: 'claim:foundations:u8-authoritative',
    file: 'docs/rules-foundations.md',
    anchor: '### Scope / Clock (U8 underlay) — AUTHORITATIVE (residual audit + combat-cleanup repair, 2026-09-01)',
    strength: 'authoritative',
    subject: 'Scope / Clock (U8 underlay)',
    binding: legacy('U8 HUMAN-CERTIFIED re-audit 2026-09-01 (whole-consumer residual audit + combat-cleanup routing repair + replay proof + u8-scope-clock-routing mutation guard; multi-owner Monogatari correction re-verified the declared contract — no competing Scope/Clock interpreter, retained counters are specialist state, source-defined lifecycle routes through U8). NOT machine-verified: no strict fidelity scope.'),
  },
  {
    id: 'claim:foundations:u17-complete',
    file: 'docs/rules-foundations.md',
    anchor: '### Ordering / Arbitration (U17 underlay) — LANDED/COMPLETE (T3 + T6.2 + T6.3, 2026-08-31)',
    anchors: [
      { file: 'docs/rules-foundations.md', anchor: 'genuine U17 consumer remains. U17 is COMPLETE. The blocking families it' },
      { file: 'TODO.md', anchor: '  U17 now COMPLETE/AUTHORITATIVE.** Finished the remaining U17' },
      { file: 'TODO.md', anchor: '  audit confirmed no other genuine U17 consumer remains — U17 is COMPLETE.' },
      { file: 'docs/roadmap.md', anchor: 'COMPLETE/AUTHORITATIVE.** `primitives/ordering.ts` gains' },
    ],
    strength: 'complete',
    subject: 'Ordering / Arbitration (U17 underlay)',
    binding: legacy('U17 status landed at T6.3 scrutinized by a fresh-audit residual census; no strict fidelity scope'),
  },
  {
    id: 'claim:foundations:u16-complete',
    file: 'docs/rules-foundations.md',
    anchor: '### Usage / Entitlement Ledger (U16 underlay, CORE) — COMPLETE (T3 core',
    anchors: [
      { file: 'docs/rules-foundations.md', anchor: 'U16 is therefore recertified **COMPLETE** (2026-09-01)' },
    ],
    strength: 'complete',
    subject: 'Usage / Entitlement Ledger (U16 underlay)',
    binding: legacy('U16 HUMAN-CERTIFIED recertification 2026-09-01: fresh residual census found no remaining unresolved U16 consumer and no competing usage authority after the Monogatari once-per-song consumer was integrated onto the U8 lifecycle scope (proven by monogatari-u8-u16.test.ts); 2026-09-01 multi-owner correction re-audited the same contract — every active song runs its own U16 applyLifecycleScopedUsage transaction, multiple simultaneous Chanters stay independent ledger identities, and no content path reconstructs a lifecycle ledger key. NOT machine-verified: no strict fidelity scope.'),
  },
  // LANDED is explicitly SLICE-PROGRESS, deliberately weaker than 'complete':
  // a landed slice is NOT an underlay-completeness claim, and the fresh
  // U1–U17 underlay census keeps U9/U14 PARTIAL. The strength below says
  // exactly that — the claim machinery never reinterprets the LANDED heading
  // as a COMPLETE-strength semantic-authority claim.
  {
    id: 'claim:foundations:u9-landed',
    file: 'docs/rules-foundations.md',
    anchor: '### Provenance / Delivery Dimensions (U9 underlay) — LANDED slice (T4, 2026-08-30); underlay remains PARTIAL',
    strength: 'landed',
    subject: 'Provenance / Delivery Dimensions (U9 underlay) — LANDED slice (T4 seam), not an underlay-completeness claim',
    binding: legacy('U9 landed-status heading (T4 seam): a landed slice is NOT underlay completeness — the fresh underlay census keeps U9 PARTIAL; not bound to a strict fidelity scope, human-audited only'),
  },
  {
    id: 'claim:foundations:u14-landed',
    file: 'docs/rules-foundations.md',
    anchor: '### Modifier / Policy (U14 underlay) — LANDED slice (T3, 2026-08-30); underlay remains PARTIAL',
    strength: 'landed',
    subject: 'Modifier / Policy (U14 underlay) — LANDED slice (T3 seam), not an underlay-completeness claim',
    binding: legacy('U14 landed-status heading (T3 seam): a landed slice is NOT underlay completeness — the fresh underlay census keeps U14 PARTIAL; not bound to a strict fidelity scope, human-audited only'),
  },
  {
    id: 'claim:roadmap:p1-settlement-done',
    file: 'docs/roadmap.md',
    anchor: '## P1 — Combat settlement and cross-combat character continuity (REPAIR) — **DONE 2026-08-25**',
    strength: 'complete',
    subject: 'P1 combat-settlement repair slice (DONE)',
    binding: legacy('roadmap slice-progress marker; tracked by the deliverables census, no fidelity scope'),
  },
  {
    id: 'claim:roadmap:p2-foe-done',
    file: 'docs/roadmap.md',
    anchor: '## P2 — Foe role entitlements and the first closed foe-complexity slice (REPAIR + VERTICAL SLICE) — **DONE 2026-08-26** (entitlements; Slice C itself stays blocked on phases/traits)',
    strength: 'complete',
    subject: 'P2 foe-role entitlements slice (DONE)',
    binding: legacy('roadmap slice-progress marker; tracked by the deliverables census, no fidelity scope'),
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

/** Collect every canonical line covered by a registered claim (its primary
 * anchor plus any restatement anchors). An anchor covers EVERY occurrence of
 * its line, so a duplicated canonical heading is still fully covered. */
function collectClaimLines(deps: ClaimCheckDeps, claims: readonly ProjectClaim[]): { covered: Map<string, Set<string>>; violations: ProjectClaimViolation[] } {
  const covered = new Map<string, Set<string>>();
  const violations: ProjectClaimViolation[] = [];
  for (const claim of claims) {
    const pairs = [{ file: claim.file, anchor: claim.anchor }, ...(claim.anchors ?? [])];
    for (const { file, anchor } of pairs) {
      const text = read(deps, file);
      if (text === null) {
        violations.push({ check: 'claim-anchor-missing', detail: `${claim.id}: canonical file ${file} is missing` });
        continue;
      }
      const lines = text.split('\n');
      const indices: number[] = [];
      lines.forEach((line, index) => {
        if (line.includes(anchor)) indices.push(index);
      });
      if (indices.length === 0) {
        violations.push({ check: 'claim-anchor-missing', detail: `${claim.id}: anchor not found in ${file}: "${anchor}"` });
        continue;
      }
      const set = covered.get(file) ?? new Set<string>();
      for (const index of indices) set.add(lines[index]);
      covered.set(file, set);
    }
  }
  return { covered, violations };
}

/**
 * Full project-claim audit:
 * 1. every registered claim's anchor must exist in its file;
 * 2. fidelity-scope bindings must be backed by at least the required
 *    computed scope rank;
 * 3. generated-audit bindings must name a real package.json script;
 * 4. legacy-unverified bindings are legal and REPORTED (returned separately);
 * 5. every strong CLAIM in a canonical file (a status heading, table status
 *    cell, or state-verb predicate over a named subject) must be covered by a
 *    registered claim anchor. Ordinary prose that merely uses strong
 *    vocabulary passes without exemption; only unregistered strong CLAIMS are
 *    hard failures.
 */
export function checkProjectClaims(
  result: FidelityAuditResult,
  deps: ClaimCheckDeps,
  claims: readonly ProjectClaim[] = PROJECT_CLAIMS,
): { violations: ProjectClaimViolation[]; unverifiedClaims: ProjectClaim[] } {
  const violations = collectClaimLines(deps, claims).violations;
  const unverifiedClaims: ProjectClaim[] = [];
  const scripts = packageScripts(deps);
  const scopeById = new Map(result.scopes.map((scope) => [scope.scopeId, scope]));

  const coveredLines = collectClaimLines(deps, claims).covered;

  for (const claim of claims) {
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

  // Secondary guard: unregistered strong CLAIMS on canonical status surfaces.
  for (const file of CANONICAL_CLAIM_FILES) {
    const text = read(deps, file);
    if (text === null) continue;
    const covered = coveredLines.get(file) ?? new Set<string>();
    text.split('\n').forEach((line, index) => {
      const cls = classifyStrongLine(line);
      if (cls !== 'claim') return;
      if (covered.has(line)) return;
      violations.push({
        check: 'unregistered-strong-claim',
        detail: `${file}:${index + 1}: strong claim on a canonical status surface but outside the audited registry: "${line.trim().slice(0, 140)}"`,
      });
    });
  }

  return { violations, unverifiedClaims };
}
