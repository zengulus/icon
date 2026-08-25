/**
 * fidelity/world.ts — assembles the PRODUCTION evidence graph for the strict
 * source-fidelity audit.
 *
 * Kinds of obligations:
 *
 * 1. CURATED atomic obligations — hand-decomposed semantic propositions with
 *    stable `icon-1.5:<topic>:<mechanic>` IDs, exact quoted passages
 *    fingerprinted AND verified against the canonical extraction corpus,
 *    explicit dispositions, typed RESOLVABLE consumers, contracts carrying
 *    machine-checkable expectation rows, and statically verifiable proofs.
 *
 * 2. DERIVED unit-grain obligations — one per `collectRuleSourceUnit()`,
 *    disposition `unclassified`, fingerprinted against the catalog text.
 *    They answer "what is not yet accounted for" and block strong claims by
 *    construction. A derived unit leaves the unclassified catch-all only via
 *    an explicit decomposition record.
 *
 * Migration rule: a derived unit becomes curated material only when someone
 * decomposes its semantics, classifies them, writes an independent contract
 * with expectation rows, registers a resolving consumer, and records real
 * proof — never automatically.
 */

import { collectRuleSourceUnits } from '../source-units.js';
import { SOURCE_ADJUDICATIONS } from '../source-adjudications.js';
import type {
  AdjudicationLink,
  ConsumerRegistration,
  FidelityWorld,
  ProofRecord,
  ScopeDefinition,
  SemanticContract,
  SourceObligation,
} from './types.js';
import { withFingerprints } from './engine.js';
import { ADVANCEMENT_IRRELEVANT_CLAUSES } from './advancement-frontier.js';

// ---------------------------------------------------------------------------
// Scopes
//
// `advancement` declares its SOURCE FRONTIER as whole canonical pages: there
// is NO selection filter. EVERY extraction line on these pages must be
// covered by an obligation's passages or explicitly dispositioned
// (irrelevant / subdivided) below — a narrow selection policy can no longer
// make omitted material disappear from the completeness proof.
// ---------------------------------------------------------------------------

const SCOPES: readonly ScopeDefinition[] = [
  {
    id: 'advancement',
    title: 'Advancement procedure — XP bar, AP breakpoint & Limit Break unlock boundary',
    description:
      'The ICON 1.5 XP bar / ability-point / level-banking procedure and the Limit Break unlock boundary across pp.44/99/112/115/240/241, including both adopted source adjudications. The frontier is EXHAUSTIVE over those pages (no selection filter): every line is covered or explicitly accounted.',
    frontier: {
      pages: [44, 99, 112, 115, 240, 241],
      irrelevant: ADVANCEMENT_IRRELEVANT_CLAUSES,
    },
  },
  {
    id: 'sourcebook-at-large',
    title: 'Sourcebook at large (unit-grain)',
    description:
      'Every catalogued RuleSourceUnit not yet decomposed into curated obligations. Everything here is deliberately unclassified: this scope cannot close, and that is the honest migration state, not a failure of the build.',
  },
];

// ---------------------------------------------------------------------------
// Consumers — typed, RESOLVABLE implementation-coverage registrations
// ---------------------------------------------------------------------------

const CONSUMERS: readonly ConsumerRegistration[] = [
  {
    id: 'character.awardXp',
    file: 'src/rules/character.ts',
    symbol: 'awardXp',
    description: 'Applies XP to the 15-tick bar: claims the mid-level AP at exactly 7 XP (once per level) and banks a level-up at 15 XP with a bar reset.',
  },
  {
    id: 'character.spendLevelUp',
    file: 'src/rules/character.ts',
    symbol: 'spendLevelUp',
    description: 'Spends a banked level-up; resets the per-level AP claim so the next level’s 7 XP boundary applies again.',
  },
  {
    id: 'character.limit-break-unlock-level',
    file: 'src/rules/character.ts',
    symbol: 'LIMIT_BREAK_UNLOCK_LEVEL',
    description: 'The durable executable boundary for the adopted Limit Break unlock level; any future availability gate must agree with it.',
  },
];

// ---------------------------------------------------------------------------
// Curated obligations + contracts + proofs
//
// Contract rows are pure EXPECTATION DATA hand-derived from the source
// passages and adopted adjudications below. They are never generated from the
// implementation; adapters.ts maps row inputs onto real code and the
// evaluator compares. Expected values cite their source basis in labels.
// ---------------------------------------------------------------------------

type AwardChar = { level: number; xp: number; pendingLevelUps: number; xpAbilityPointClaimed: boolean };

const fresh: AwardChar = { level: 0, xp: 0, pendingLevelUps: 0, xpAbilityPointClaimed: false };

const CURATED_OBLIGATIONS: readonly SourceObligation[] = [
  withFingerprints({
    id: 'icon-1.5:advancement:xp-bar-bank',
    scopeId: 'advancement',
    disposition: 'deterministic-executable',
    summary:
      'The XP bar is 15 ticks long; awarding XP up to a full bar banks exactly one level-up and resets the bar. A second full bar while a level is banked stays capped in the bar rather than being lost or double-banked; spending the banked level resets the once-per-level AP claim.',
    passages: [
      {
        page: 240,
        sectionId: null,
        quote:
          'Experience during their adventures, characters earn experience points, filling out an experience bar. At certain breakpoints in the bar, they will unlock new abilities or talents. The xp bar is 15 ticks long. At 7 xp gained, during an interlude, at the end of a session or at camp characters can gain +1 ap, and spend it to unlock a new combat ability in any job they have, or gain a new talent for an ability they already have. This only triggers once per level. Once the bar is full (15 xp), a character can clear all xp and mark a level up . At the end of an interlude or session, they may cash in that level up to increase their level by 1. Certain benefits are only gained on level up.',
        sha256: '',
      },
      {
        page: 44,
        sectionId: null,
        quote:
          'Any character that has a level up banked at the end of a session can increase their level by 1, but no higher than the current chapter number. A character can only \'save\' one banked level up at once.',
        sha256: '',
      },
      {
        // Recorded as its own passage because the extraction places a bullet
        // separator between this sentence and the next; each curated quote
        // must be a contiguous canonical span on its cited page.
        page: 241,
        sectionId: null,
        quote:
          'At level 1 and every level afterwards, characters gain +1 ap when they hit 7 xp and go into a camp, enter an interlude, or at the end of a session.',
        sha256: '',
      },
      {
        page: 241,
        sectionId: null,
        quote:
          'When a character hits 15 xp, they clear their xp bar and accumulate a level up, which can be spent at the end of a interlude (a downtime period) or at the end of a session to level up their character.',
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
      'CONFLICTED SOURCE: pp.15/115/241 tables and p.112 prose grant the Limit Break at level 1 (the p.115 Level-1 table row reads "gain +2 ap and unlock limit break", total ap 5); p.99 says level 2. The engine adopts level 1, recorded durably as LIMIT_BREAK_UNLOCK_LEVEL, via adjudication icon-1.5:advancement:limit-break-level.',
    passages: [
      {
        page: 115,
        sectionId: null,
        quote: 'gain +2 ap and unlock limit break 5',
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
      'awardXp/spendLevelUp over advancement state, expectations hand-derived from pp.240–241: total < 15 keeps the bar (capped at 14); total >= 15 banks pendingLevelUps=1 and resets the bar; banking is refused while a level is banked; spending requires a bank and resets the AP claim.',
    rows: [
      { label: '14 XP fills the bar without banking', cls: 'positive', input: { op: 'award', char: fresh, amount: 14 }, expected: { xp: 14, pendingLevelUps: 0, claimed: true, level: 0 } },
      { label: '15 XP banks one level and clears the bar', cls: 'positive', input: { op: 'award', char: fresh, amount: 15 }, expected: { xp: 0, pendingLevelUps: 1, claimed: true, level: 0 } },
      { label: 'a second full bar while banked stays capped — no double-bank', cls: 'negative', input: { op: 'award', char: { ...fresh, pendingLevelUps: 1, xpAbilityPointClaimed: true }, amount: 15 }, expected: { xp: 14, pendingLevelUps: 1, claimed: true, level: 0 } },
      { label: 'spending requires a banked level', cls: 'negative', input: { op: 'spend', char: fresh, chapterCap: 3 }, expected: { error: 'No banked level-up is available.' } },
      { label: 'spending the bank resets the per-level AP claim', cls: 'negative', input: { op: 'spend', char: { ...fresh, pendingLevelUps: 1, xpAbilityPointClaimed: true }, chapterCap: 3 }, expected: { xp: 0, pendingLevelUps: 0, claimed: false, level: 1 } },
      { label: 'spending respects the campaign chapter cap (p.44)', cls: 'negative', input: { op: 'spend', char: { ...fresh, pendingLevelUps: 1 }, chapterCap: 0 }, expected: { error: 'The campaign chapter does not permit this level yet.' } },
    ],
  },
  {
    obligationId: 'icon-1.5:advancement:mid-level-ap-boundary',
    kind: 'boundary-constant',
    stateful: false,
    statement:
      'The mid-level AP is claimed at EXACTLY 7 XP (not 5, not 10) and only once per level until spendLevelUp resets the claim; the claimed point enters the ability-point allowance. Matches the adopted adjudication boundary (xp=7). Expectations from the adjudicated reading, not from awardXp.',
    boundary: {
      kind: 'xp',
      value: 7,
      probes: {
        below: { op: 'award', char: fresh, amount: 6 },
        at: { op: 'award', char: fresh, amount: 7 },
        above: { op: 'award', char: fresh, amount: 10 },
      },
    },
    rows: [
      { label: '6 XP does not claim the mid-level AP (below edge)', cls: 'boundary', input: { op: 'award', char: fresh, amount: 6 }, expected: { xp: 6, pendingLevelUps: 0, claimed: false, level: 0 } },
      { label: 'exactly 7 XP claims it (at edge)', cls: 'boundary', input: { op: 'award', char: fresh, amount: 7 }, expected: { xp: 7, pendingLevelUps: 0, claimed: true, level: 0 } },
      { label: '10 XP crosses the same single boundary — no separate unlock (above edge)', cls: 'boundary', input: { op: 'award', char: fresh, amount: 10 }, expected: { xp: 10, pendingLevelUps: 0, claimed: true, level: 0 } },
      { label: 'an unclaimed level-0 character has 2 AP (base table)', cls: 'positive', input: { op: 'allowance', char: { ...fresh, xpAbilityPointClaimed: false } }, expected: { allowance: 2 } },
      { label: 'the claimed mid-level AP enters the allowance (+1)', cls: 'positive', input: { op: 'allowance', char: { ...fresh, xpAbilityPointClaimed: true } }, expected: { allowance: 3 } },
    ],
  },
  {
    obligationId: 'icon-1.5:advancement:limit-break-unlock-level',
    kind: 'boundary-constant',
    stateful: false,
    statement:
      'The Limit Break unlock boundary is level EXACTLY 1 (adjudicated): the durable engine constant must equal the adopted boundary value, and the level-1 advancement row (+2 AP, total 2→5) sits above level 0. No availability gate exists yet; this constant is what a future gate must agree with.',
    boundary: {
      kind: 'level',
      value: 1,
      probes: {
        below: { op: 'allowance', char: { ...fresh, level: 0, xpAbilityPointClaimed: false } },
        at: { op: 'limitBreakUnlockLevel' },
        above: { op: 'allowance', char: { ...fresh, level: 1, xpAbilityPointClaimed: false } },
      },
    },
    rows: [
      { label: 'engine constant equals the adjudicated boundary (level 1)', cls: 'boundary', input: { op: 'limitBreakUnlockLevel' }, expected: { limitBreakUnlockLevel: 1 } },
      { label: 'a level-0 character has 2 AP — below the advancement row', cls: 'boundary', input: { op: 'allowance', char: { ...fresh, level: 0, xpAbilityPointClaimed: false } }, expected: { allowance: 2 } },
      { label: 'a level-1 character has 5 AP — the "gain +2 ap and unlock limit break" row', cls: 'boundary', input: { op: 'allowance', char: { ...fresh, level: 1, xpAbilityPointClaimed: false } }, expected: { allowance: 5 } },
    ],
  },
];

const ADJUDICATION_TEST_FILE = 'src/rules/__tests__/source-adjudications.test.ts';

/** Declared TRACEABILITY pointers into the human-authored test suite. They
 * document where those tests exercise these semantics; strong status comes
 * from executed evaluator results, so these are never load-bearing alone. */
const PROOFS: readonly ProofRecord[] = [
  { obligationId: 'icon-1.5:advancement:xp-bar-bank', kind: 'positive', evidence: 'declared', file: ADJUDICATION_TEST_FILE, test: 'the engine banks a level at exactly 15 XP, resets the bar, and allows one banked level' },
  { obligationId: 'icon-1.5:advancement:xp-bar-bank', kind: 'negative', evidence: 'declared', file: ADJUDICATION_TEST_FILE, test: 'the AP claim is once per level: it resets when the banked level is spent' },
  { obligationId: 'icon-1.5:advancement:mid-level-ap-boundary', kind: 'boundary', evidence: 'declared', file: ADJUDICATION_TEST_FILE, test: 'the engine claims the mid-level AP at exactly 7 XP, not at 5 or 10' },
  { obligationId: 'icon-1.5:advancement:mid-level-ap-boundary', kind: 'positive', evidence: 'declared', file: ADJUDICATION_TEST_FILE, test: 'the claimed mid-level AP is included in the ability-point allowance' },
  { obligationId: 'icon-1.5:advancement:limit-break-unlock-level', kind: 'boundary', evidence: 'declared', file: ADJUDICATION_TEST_FILE, test: 'the engine boundary constant matches the adjudication and cannot drift' },
  { obligationId: 'icon-1.5:advancement:limit-break-unlock-level', kind: 'positive', evidence: 'declared', file: ADJUDICATION_TEST_FILE, test: 'the advancement table the engine implements grants the boundary row at level 1' },
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
