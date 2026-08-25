/**
 * fidelity/world.ts — assembles the PRODUCTION evidence graph for the strict
 * source-fidelity audit.
 *
 * Two kinds of obligations live here:
 *
 * 1. CURATED atomic obligations — hand-decomposed semantic propositions with
 *    stable `icon-1.5:<topic>:<mechanic>` IDs, exact quoted passages with
 *    SHA-256 fingerprints, explicit dispositions, typed consumers,
 *    independent contracts, and statically verifiable proofs.
 *
 * 2. DERIVED unit-grain obligations — one per `collectRuleSourceUnit()`,
 *    disposition `unclassified`, fingerprinted against the catalog text.
 *    They exist so the audit can answer "what is not yet accounted for" and
 *    so unclassified material blocks strong claims by construction. This is
 *    the conservative migration state: legacy allowlist membership is NOT
 *    silently grandfathered in as authoritative.
 *
 * Migration rule (AGENTS.md §18 style): a derived unit becomes a curated
 * obligation only when someone decomposes its semantics, classifies them,
 * writes an independent contract, registers the consumer, and records real
 * proof — never automatically.
 */

import { collectRuleSourceUnits } from '../source-units.js';
import { SOURCE_ADJUDICATIONS } from '../source-adjudications.js';
import type { AdjudicationLink, ConsumerRegistration, FidelityWorld, ProofRecord, ScopeDefinition, SemanticContract, SourceObligation } from './types.js';
import { withFingerprints } from './engine.js';

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

const SCOPES: readonly ScopeDefinition[] = [
  {
    id: 'advancement',
    title: 'Character advancement',
    aliases: ['character advancement', 'advancement'],
    description:
      'The ICON 1.5 XP bar / ability-point / level-banking procedure and the Limit Break unlock boundary. Includes both adopted source adjudications.',
  },
  {
    id: 'sourcebook-at-large',
    title: 'Sourcebook at large (unit-grain)',
    aliases: [],
    description:
      'Every catalogued RuleSourceUnit not yet decomposed into curated obligations. Everything here is deliberately unclassified: this scope cannot be closed, and that is the honest migration state, not a failure of the build.',
  },
];

// ---------------------------------------------------------------------------
// Consumers — typed implementation-coverage registrations
// ---------------------------------------------------------------------------

const CONSUMERS: readonly ConsumerRegistration[] = [
  {
    id: 'character.awardXp',
    location: 'src/rules/character.ts — awardXp',
    description: 'Applies XP to the 15-tick bar: claims the mid-level AP at exactly 7 XP (once per level) and banks a level-up at 15 XP with a bar reset.',
  },
  {
    id: 'character.spendLevelUp',
    location: 'src/rules/character.ts — spendLevelUp',
    description: 'Spends a banked level-up; resets the per-level AP claim so the next level’s 7 XP boundary applies again.',
  },
  {
    id: 'character.limit-break-unlock-level',
    location: 'src/rules/character.ts — LIMIT_BREAK_UNLOCK_LEVEL',
    description: 'The durable executable boundary for the adopted Limit Break unlock level; any future availability gate must agree with it.',
  },
];

// ---------------------------------------------------------------------------
// Curated obligations + contracts + proofs
// ---------------------------------------------------------------------------

const CURATED_OBLIGATIONS: readonly SourceObligation[] = [
  withFingerprints({
    id: 'icon-1.5:advancement:xp-bar-bank',
    scopeId: 'advancement',
    disposition: 'deterministic-executable',
    summary:
      'The XP bar is 15 ticks long; awarding XP up to a full bar banks exactly one level-up and resets the bar. A second full bar while a level is banked stays capped in the bar rather than being lost or double-banked.',
    passages: [
      {
        page: 240,
        sectionId: null,
        quote:
          'The xp bar is 15 ticks long. At 7 xp gained, during an interlude, at the end of a session or at camp characters can gain +1 ap, and spend it to unlock a new combat ability in any job they have, or gain a new talent for an ability they already have. This only triggers once per level. Once the bar is full (15 xp), a character can clear all xp and mark a level up.',
        sha256: '',
      },
      {
        page: 241,
        sectionId: null,
        quote:
          'At level 1 and every level afterwards, characters gain +1 ap when they hit 7 xp and go into a camp, enter an interlude, or at the end of a session. When a character hits 15 xp, they clear their xp bar and accumulate a level up.',
        sha256: '',
      },
    ],
    origin: { kind: 'curated' },
    consumerIds: ['character.awardXp', 'character.spendLevelUp'],
  }),
  withFingerprints({
    id: 'icon-1.5:advancement:mid-level-ap-boundary',
    scopeId: 'advancement',
    disposition: 'conflicted',
    summary:
      'CONFLICTED SOURCE: p.44 grants mid-level unlocks at 5 and 10 XP; the Book of Adventure procedure (pp.112, 240, 241) grants a single +1 AP at exactly 7 XP, once per level. The engine adopts the 7 XP reading via adjudication icon-1.5:advancement:mid-level-ap.',
    passages: [
      {
        page: 44,
        sectionId: null,
        quote:
          'Each time the characters fill the xp bar to 5 or 10 xp, they can unlock an ability or talent at the end of that session or during a camp or interlude. If a character’s xp bar is full (15 xp), they can clear the bar and gain a level up.',
        sha256: '',
      },
      {
        page: 240,
        sectionId: null,
        quote:
          'At 7 xp gained, during an interlude, at the end of a session or at camp characters can gain +1 ap, and spend it to unlock a new combat ability in any job they have, or gain a new talent for an ability they already have. This only triggers once per level.',
        sha256: '',
      },
    ],
    adjudicationId: 'icon-1.5:advancement:mid-level-ap',
    consumerIds: ['character.awardXp'],
    origin: { kind: 'curated' },
  }),
  withFingerprints({
    id: 'icon-1.5:advancement:limit-break-unlock-level',
    scopeId: 'advancement',
    disposition: 'conflicted',
    summary:
      'CONFLICTED SOURCE: pp.15/115/241 tables and p.112 prose grant the Limit Break at level 1; p.99 says level 2. The engine adopts level 1, recorded durably as LIMIT_BREAK_UNLOCK_LEVEL, via adjudication icon-1.5:advancement:limit-break-level.',
    passages: [
      {
        page: 115,
        sectionId: null,
        quote: 'Tactical Combat Advancement table, Level 1 row: "Gain +2 ap and unlock Limit Break".',
        sha256: '',
      },
      {
        page: 99,
        sectionId: null,
        quote: 'Every character unlocks limit break at level 2.',
        sha256: '',
      },
    ],
    adjudicationId: 'icon-1.5:advancement:limit-break-level',
    consumerIds: ['character.limit-break-unlock-level'],
    origin: { kind: 'curated' },
  }),
];

const CONTRACTS: readonly SemanticContract[] = [
  {
    obligationId: 'icon-1.5:advancement:xp-bar-bank',
    kind: 'input-output-table',
    stateful: false,
    statement:
      'awardXp over character state: total < 15 keeps the bar (capped at 14); total >= 15 banks pendingLevelUps=1 and resets the bar to 0; banking is refused while a level is already banked (bar caps at 14). Derived from pp.240–241, independent of awardXp’s code.',
  },
  {
    obligationId: 'icon-1.5:advancement:mid-level-ap-boundary',
    kind: 'boundary-constant',
    stateful: false,
    statement:
      'The mid-level AP is claimed at EXACTLY 7 XP (not 5, not 10) and only once per level until spendLevelUp resets the claim. Matches the adopted adjudication boundary.',
    boundary: { kind: 'xp', value: 7 },
  },
  {
    obligationId: 'icon-1.5:advancement:limit-break-unlock-level',
    kind: 'boundary-constant',
    stateful: false,
    statement:
      'The Limit Break unlock boundary is level EXACTLY 1: level 0 has none, level 1 does. Matches the adopted adjudication boundary recorded in LIMIT_BREAK_UNLOCK_LEVEL.',
    boundary: { kind: 'level', value: 1 },
  },
];

const ADJUDICATION_TEST_FILE = 'src/rules/__tests__/source-adjudications.test.ts';

const PROOFS: readonly ProofRecord[] = [
  // xp-bar-bank: positive + negative from the existing semantic pins.
  { obligationId: 'icon-1.5:advancement:xp-bar-bank', kind: 'positive', file: ADJUDICATION_TEST_FILE, test: 'the engine banks a level at exactly 15 XP, resets the bar, and allows one banked level' },
  { obligationId: 'icon-1.5:advancement:xp-bar-bank', kind: 'negative', file: ADJUDICATION_TEST_FILE, test: 'the AP claim is once per level: it resets when the banked level is spent' },
  // mid-level AP boundary: positive + boundary on both sides of the edge.
  { obligationId: 'icon-1.5:advancement:mid-level-ap-boundary', kind: 'boundary', file: ADJUDICATION_TEST_FILE, test: 'the engine claims the mid-level AP at exactly 7 XP, not at 5 or 10' },
  { obligationId: 'icon-1.5:advancement:mid-level-ap-boundary', kind: 'positive', file: ADJUDICATION_TEST_FILE, test: 'the claimed mid-level AP is included in the ability-point allowance' },
  // limit break boundary.
  { obligationId: 'icon-1.5:advancement:limit-break-unlock-level', kind: 'boundary', file: ADJUDICATION_TEST_FILE, test: 'the engine boundary constant matches the adjudication and cannot drift' },
  { obligationId: 'icon-1.5:advancement:limit-break-unlock-level', kind: 'positive', file: ADJUDICATION_TEST_FILE, test: 'the advancement table the engine implements grants the boundary row at level 1' },
];

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function derivedUnitObligations(): SourceObligation[] {
  return collectRuleSourceUnits().map((unit) =>
    withFingerprints({
      id: `unit:${unit.id}`,
      scopeId: 'sourcebook-at-large',
      disposition: 'unclassified',
      summary: `${unit.name} — awaiting semantic decomposition into curated obligations.`,
      passages: [{ page: unit.source.page, sectionId: unit.source.sectionId ?? null, quote: unit.rulesText, sha256: '' }],
      origin: { kind: 'derived-unit', unitId: unit.id },
      sourceKind: unit.kind,
    }),
  );
}

export function buildProductionWorld(): FidelityWorld {
  return {
    scopes: SCOPES,
    obligations: [...CURATED_OBLIGATIONS, ...derivedUnitObligations()],
    consumers: CONSUMERS,
    contracts: CONTRACTS,
    proofs: PROOFS,
    adjudications: SOURCE_ADJUDICATIONS.map(({ id, status }): AdjudicationLink => ({ id, status })),
  };
}
