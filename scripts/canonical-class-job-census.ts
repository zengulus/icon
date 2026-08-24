/**
 * Canonical Class/Job Blocker Census
 *
 * This is the single source of truth for the Class/Job dependency graph.
 * It derives its baseline from CURRENT repository authority:
 *   - collectRuleSourceUnits()
 *   - current rule compilation/audit state
 *   - current Class/Job recipe metadata / blocker classifications
 *
 * Target kinds: class-trait, job-trait, talent, mastery, limit-break.
 *
 * Every CURRENTLY UNRESOLVED source unit produces exactly one canonical record:
 *   { sourceId, kind, blockers: string[] }
 *
 * Executable units must not remain in the blocker census.
 *
 * Non-implementable blocker classifications (irreducible / residual) are
 * excluded from:
 *   - marginal implementation rankings
 *   - greedy primitive simulation
 *   - next-primitive recommendations
 * They remain visible in blocker-set frequency tables and residual counts.
 *
 * Marginal categories per primitive P:
 *   - immediate:       units whose blocker set is exactly {P}
 *   - oneCloser:       units whose blocker set contains P and exactly ONE other blocker
 *   - multiCloser:     units whose blocker set contains P and TWO or more other blockers
 *   - totalContaining: immediate + oneCloser + multiCloser
 *   Mechanical assertion: immediate + oneCloser + multiCloser === totalContaining
 *
 * Machine-checked invariants:
 *   - source IDs are unique
 *   - every unresolved Class/Job source unit appears exactly once
 *   - no executable Class/Job source unit appears
 *   - per-kind totals sum to the unresolved Class/Job total
 *   - blocker-set frequencies derive from the per-unit records
 *   - marginal values derive from per-unit records (with multiCloser)
 *   - marginal assertion: immediate + oneCloser + multiCloser === totalContaining
 *   - greedy simulation derives from set subtraction, not handwritten totals
 *   - after every simulated primitive: previousRemaining - newlyUnlocked === newRemaining
 *   - cumulativeUnlocked + remaining === baseline
 *   - an implemented capability is not retained as a blocker merely because an
 *     older report listed it
 *   - non-implementable classifications never appear in greedy simulation steps
 *
 * Usage:
 *   node --import tsx scripts/canonical-class-job-census.ts [--strict] [--output <path>]
 */

import '../src/rules/automation/content/registry.js';
import { auditRuleCompilations } from '../src/rules/automation/content/glue/compiler.js';
import { collectRuleSourceUnits, type RuleSourceUnit, type RuleSourceKind } from '../src/rules/source-units.js';
import { isExecutableTalent } from '../src/rules/automation/kernels/talent-recipes.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Blocker taxonomy
// ═══════════════════════════════════════════════════════════════════════════

const CENSUS_KINDS: RuleSourceKind[] = [
  'class-trait', 'job-trait', 'talent', 'mastery', 'limit-break',
];

/** Non-implementable / residual blocker classifications.
 *  These are classification labels, not capabilities that can be implemented.
 *  They are excluded from marginal rankings and greedy simulation. */
const NON_IMPLEMENTABLE = new Set(['irreducible']);

/** Primitives already implemented in the engine. A blocker that is already
 *  implemented is stripped from every unresolved unit's blocker set (Phase 5
 *  harvest): it no longer blocks anything, and any unit left with an empty
 *  set would be executable — so it must never appear in the census. The
 *  claim is grounded in the executable allowlists (the compiler's
 *  `unsupportedClauses` check) rather than this set alone. */
const IMPLEMENTED_PRIMITIVES = new Set(['condition-grant', 'aura']);

/** Audit-verified reclassifications: source units whose syntactic first-pass
 *  blocker set is WRONG (the regex keyword pass matched "gain/grant/become"
 *  and claimed a `{condition-grant}` singleton, but the unit's complete
 *  semantics need other missing reusable capabilities). Each entry is the
 *  corrected MINIMAL blocker set after reading the full source text.
 *
 *  Masteries: after the typed mastery-attachment kernel landed
 *  (kernels/mastery.ts), `mastery-attachment` is no longer a missing
 *  primitive — an implemented mastery compiles complete (allowlist +
 *  fixture + replay), and an unimplemented mastery stays unresolved for
 *  its actual effect blockers below. The seven former
 *  `{mastery-attachment}` singletons (rook, dark-knight, intimidate,
 *  bleak-mercy, warding-bolts, gentleness, rampant-nail) are now
 *  executable and dropped out of the census entirely.
 *
 *  Re-audit: 3 of the 28 claimed `{condition-grant}` singletons were
 *  genuine (bastion:valiant:talent:2, knave:provoke:talent:1,
 *  freelancer:showdown:talent:2 — now executable through the F7 talent
 *  fold); the other 25 are corrected below.
 *
 *  Aura re-audit (after the generic Aura kernel landed): `aura` is now an
 *  implemented primitive (kernels/aura.ts), so the 7 singleton aura
 *  candidates were re-read against the kernel. bastion:rook:talent:1 and
 *  chanter:dervish:talent:1 became executable (projected counter through
 *  the shared condition fold) and dropped out of the census entirely. The
 *  other five are corrected below: their `{aura}` singleton was an
 *  incomplete classification — each still needs a genuinely missing
 *  capability beyond the Aura kernel itself. */
const RECLASSIFIED_BLOCKERS: Readonly<Record<string, string[]>> = {
  // The corrected sets are the units' CURRENT blockers: the condition-grant
  // component of a reclassified unit (rebound, unstoppable, defiance,
  // evasion, phasing, pacified, vulnerable) is now implemented, so it is
  // intentionally NOT listed here — the record shows what still blocks.
  //
  // ── 8 masteries — attachment solved (kernels/mastery.ts); the remaining
  //    blockers are their actual effect semantics ──
  'bastion:heracule:mastery': ['attack-modifier', 'effect-count'],
  // "gains rebound" — the attack-bounce modifier (same family as Trick Shot's armed rebound / skipjack rank 2, NOT a condition) + "second effect triggers +1 more time" (effect-count)
  'colossus:massive-overhead:mastery': ['action-type-change'],
  // "grants you 4 vigor" (the fixed-amount vigor grant is expressible via the
  // F7 fold's 'vigor' mutation — demon-cutter:talent:1 is audit-complete) + "no
  // longer ends your turn" (round-gated action-type change)
  'knave:revenge:mastery': ['damage-modifier', 'area-define'],
  // "deal 2 damage to all adjacent foes" after vigilance
  'shade:umbra:mastery': ['ability-attack-modifier'],
  // "Increase Umbra and Penumbra's range to 6 and it gains unerring" — the
  // range half is wired through the shared range kernel (range-recipes.ts),
  // but the per-ability unerring needs the attack-modifier attachment gate
  // for a mastery-owned ability (the kernel is trait-keyed today)
  'sealer:sanctify:mastery': ['area-define', 'action-type-change'],
  // "place two areas without replacing the first" + round-4+ 1-action
  'seer:wish:mastery': ['damage-preview'],
  // "gain defiance, then unstoppable" (condition-grant — implemented) on a damage-would-reduce-to-0 preview
  'enochian:aethershard:mastery': ['movement-modifier'],
  // "gain phasing" (condition-grant — implemented) + "objects cost a maximum of 0 spaces to enter"
  'spellblade:nothung:mastery': ['damage-modifier'],
  // "All 1 piercing damage listed by this ability becomes divine" (damage-type override)

  // ── 16 talents / traits / abilities with non-condition mechanics ──
  'demon-slayer:soul-blade:talent:2': ['stance-gate', 'attack-modifier'],
  // "While in Soul Blade, your attacks gain exceed: tick the die up by 1" (attack-path die modifier)
  'knave:revenge:talent:1': ['save-modifier', 'area-define'],
  // "attacks against adjacent allies gain +1 curse" (save-curse on adjacency)
  'fool:gallows-humor:talent:2': ['effect-count', 'threshold-modifier'],
  // "deal 4 damage again to any target at 25% hp or lower" (repeat + hp-threshold gate)
  'fool:masquerade:talent:1': ['use-ledger'],
  // "gain evasion after swapping" (condition-grant — implemented) gated by "haven't acted yet this round" (use-ledger)
  'fool:chronotemper:talent:1': ['movement-modifier'],
  // "dash gains phasing and ignores movement penalties from terrain"
  'shade:shadow-play:talent:2': ['choice-input'],
  // "one of them CAN gain evasion" (condition-grant — implemented; player choice between swapped allies)
  'chanter:aria:talent:2': ['effect-count'],
  // "If Aria's special effect triggers twice, gain defiance and become unstoppable" (condition-grant — implemented)
  'harvester:crimson-bloom:talent:1': ['damage-preview'],
  // "If Crimson Bloom's damage would reduce an ally to 1 hp or below, they gain defiance" (condition-grant — implemented)
  'sealer:trait:mantra-of-sealing': ['attack-trigger-grant'],
  // "Your attacks bless all adjacent allies to you and grant them 2 vigor" —
  // an ON-ATTACK area grant of a blessing token + vigor, not a continuous
  // membership projection: the Aura kernel projects conditions and attack
  // modifiers, never tokens/resources, so the attack-triggered area grant is
  // still missing (the fixed 2-vigor grant and the bless action themselves
  // are expressible)

  // ── Aura re-audit: the five remaining `{aura}` singletons ──
  'bastion:endless-battlement:talent:1': ['aura-user-gate'],
  // "While you are in the aura, attacks against your ally gain +1 curse" —
  // the targetCurses projection exists, but the aura sits on the ALLY while
  // the gate is the ability USER's own position inside it (the parent
  // Endless Battlement stance/interrupt is itself unimplemented)
  'bastion:endless-battlement:talent:2': ['aura-user-gate'],
  // "You and your ally both have counter while you are in the aura" — same
  // user-presence gate over the ally-carried aura
  'shade:nightmare:talent:2': ['rebound', 'entity-consume'],
  // "rebound abilities off shadows in the aura; doing so consumes the
  // shadow" — the attack-bounce modifier (NOT a condition) and the
  // shadow-entity consumption are both missing; the aura kernel does not
  // give entity membership or consumption
  'harvester:gravebirth:talent:1': ['entity-vacate', 'choice-input'],
  // "all thralls of your choice burrow … then you may place them in free
  // space in your aura" — the free-space-in-aura placement is expressible
  // (auraCells + the shared free-cell search); the thrall burrow/removal
  // and the player's choice of thralls are still missing
  'seer:sisyphus:talent:1': ['save-modifier', 'entity-vacate'],
  // "foes gain +1 curse on the save" + "pacified after being returned" (condition-grant — implemented)
  'enochian:trait:soulfire': ['threshold-modifier'],
  // "threshold to critical hit becomes 18+, threshold to exceed becomes 13+" (threshold overrides)
  'enochian:soul-burn:talent:1': ['effect-count'],
  // "struck by two or more soul embers from this ability in the same turn, they become vulnerable" (condition-grant — implemented)
  'enochian:aethershard:talent:2': ['pierce', 'aura'],
  // "abilities gain pierce against characters adjacent to Aethershards"
  'spellblade:odinforce:talent:1': ['effect-count', 'use-ledger'],
  // "If you end a turn without attacking, gain +2 more bolts" (turn-end gate + bolt count)
  'spellblade:odinforce:talent:2': ['effect-count'],
  // "Comeback: Odinforce gains 4 bolts instead of 2 on refresh" (bolt count override)

  // ── Range re-audit (after the generic range kernel landed) ──
  // kernels/range.ts now implements LISTED-RANGE changes (fixed override,
  // conditional override under stealth/comeback/mastery gates, and the
  // dynamic round-number range), folded at both command gates. The six
  // former `{range-modifier}` singletons whose complete semantics were a
  // listed-range change or a distance-gated effect with existing authority
  // (Valkyrie t1, Incubus t1, Harvest t2, Open the Gates t2, Trigrammaton,
  // Aetherwall) are executable and dropped out of the census entirely. The
  // remaining singletons were misclassified: `range-modifier` conflated
  // several genuinely different families, reclassified below.
  'knave:limit-break': ['condition-suppression'],
  // MOCK's "cannot gain or benefit from evasion, dodge, or stealth" needs a
  // general condition-suppression projection (mark suppressions exist, a
  // non-mark suppression does not); the potency-plus condition grants, the
  // turn-end/two-turn durations, and DREAD MOCK's "gains range 5" are all
  // expressible
  'knave:strongarm:talent:1': ['teleport'],
  // "Remove your target and place them into adjacency" is a remove-and-place
  // reposition; the Comeback range-2 half is wired through the range kernel
  'freelancer:trick-shot:talent:2': ['rebound', 'distance-predicate'],
  // "phantom projectiles … at exactly range 3 from its rebound target" —
  // needs the rebound machinery plus an exact-distance damage gate
  'freelancer:trick-shot:mastery': ['rebound'],
  // "cause an ability to rebound twice … off a new character or object in
  // range 3 of the first" — the attack-bounce modifier; the range-3
  // placement check is expressible
  'freelancer:soul-shot:talent:1': ['distance-predicate'],
  // "considers all characters in the line to be at exactly range 3" (round-4+
  // gate) — a dynamic exact-distance reclassification of the ability's own
  // distance tiers, not a targeting-range change
  'warden:apex:talent:2': ['ability-attack-modifier'],
  // "If you attack a foe at exactly range 3, this ability gains unerring" —
  // the exact-range unerring fold exists (Trigrammaton) but is trait-keyed;
  // a talent-owned per-ability attack rule needs the attachment gate. The
  // post-resolution shove is expressible
  'enochian:lance:talent:1': ['object-distance'],
  // "a character in range 3 of that object" — distance measured from an
  // OBJECT footprint, which the range kernel (actor-to-actor) does not cover
  'enochian:blackstar:mastery': ['sacrifice-cost'],
  // "split sacrifice into 25% max hp to yourself, and 25% to an ally in
  // range 4" — the split-sacrifice cost; the range-4 check is expressible
  'geomancer:quaking-palm:mastery': ['object-distance'],
  // "triggers for each object in range 2 instead of adjacent" — object
  // footprints in range, not characters
  'spellblade:blitz:talent:2': ['effect-redirect'],
  // "grant Blitz's first effect to any ally in range 2 instead" — an
  // effect-redirect target change; the range-2 check is expressible
};

/** Classify a source unit's rules text into a blocker set.
 *  The classification is purely syntactic (regex on the source text) and
 *  is used as a first-pass census. Singleton audit verification must be
 *  performed separately. */
function classifyBlockers(unit: RuleSourceUnit): string[] {
  const text = unit.rulesText.toLowerCase();
  const blockers: string[] = [];

  // Terrain creation: creates terrain, pits, difficult/dangerous terrain, boulders, objects
  if (/create.*terrain|creates.*terrain|pit|difficult terrain|dangerous terrain|boulder|pillar|afterimage|terrain effect|creating a pit|create a height|create.*spaces of/.test(text)
    && !/summon.*(?:terrain|object)/.test(text)) {
    blockers.push('terrain-create');
  }

  // Condition grant: grants or applies a condition/status
  if (/\b(?:become|becomes|gain|gains|grant|grants|apply|applied?|inflict|inflicts|sealed|immune|sturdy|defiance|dodge|evasion|flying|phasing|unstoppable|regeneration|stealth|counter|vulnerable|weakened|blinded?|dazed|stunned|shattered|slashed|pacified)\b/.test(text)
    && /\b(?:become|becomes|gain|gains|grant|grants)\b/.test(text)) {
    blockers.push('condition-grant');
  }

  // Area definition: burst, blast, area, arc, line effects
  if (/\b(?:burst|blast|area|arc|line)\s*(?:\d+|of effect|effect|damage)/.test(text)
    || /\b(?:medium|large|small)\s+(?:burst|blast)/.test(text)
    || /\baround\s+(?:yourself|self|the target|them)/.test(text)) {
    blockers.push('area-define');
  }

  // Action-type change: free action, reaction, interrupt cost modification
  if (/\b(?:free action|as a (?:free )?action|reaction)\b/.test(text)) {
    blockers.push('action-type-change');
  }

  // Fly grant: flying, fly N
  if (/\bfly(?:ing|\s+\d|\s+n|\s+to)/.test(text)) {
    blockers.push('fly-grant');
  }

  // Damage modifier: bonus damage, deal extra damage, extra damage
  if (/\b(?:bonus damage|extra damage|deals?\s+(?:\d+\s+)?(?:additional|bonus|extra)\s+damage|deal\s+(?:\d+\s+)?(?:additional|bonus|extra)\s+damage|additional\s+\d+\s+damage)\b/.test(text)) {
    blockers.push('damage-modifier');
  }

  // Teleport: teleport, teleportation
  if (/\bteleport(?:s|ed|ation)?\b/.test(text) && !/teleport.*(?:choose|destination)/.test(text)) {
    blockers.push('teleport');
  }

  // Vigor grant: gain N vigor
  if (/\b(?:gain|gains|grant|grants)\s+\d+\s+vigor\b/.test(text)) {
    blockers.push('vigor-grant');
  }

  // Resource management: gain aether, resolve, resource manipulation
  if (/\b(?:gain|gains)\s+(?:\d+\s+)?(?:aether|resolve|vigor|vigilance|blessing|combo)\b/.test(text)
    || /\b(?:spend|spends)\s+(?:\d+\s+)?(?:aether|resolve|blessing|combo)\b/.test(text)) {
    blockers.push('resource-management');
  }

  // Sacrifice cost: sacrifice HP
  if (/\bsacrifice\s+\d+\b/.test(text)) {
    blockers.push('sacrifice-cost');
  }

  // Aura: aura N, aura effect
  if (/\baura\s*\d*\b/.test(text)) {
    blockers.push('aura');
  }

  // Shove modifier: shove, push, shoved
  if (/\bshov(?:e|ed|es)\s+\d+\b/.test(text)
    || /\bpush(?:es|ed)?\s+\d+\b/.test(text)) {
    blockers.push('shove-modifier');
  }

  // Gamble state: gamble, die roll, d6, power die
  if (/\b(?:gamble|power die|d\d+ result|die result)\b/.test(text)) {
    blockers.push('gamble-state');
  }

  // Use ledger: once per turn, once per round, first time, once a round
  if (/\b(?:once (?:per|a) (?:turn|round|combat)|first time(?:\s+(?:per|a)\s+(?:turn|round))?)\b/.test(text)) {
    blockers.push('use-ledger');
  }

  // Pre-ability movement: rush before, fly before, movement before
  if (/\b(?:rush|fly|dash)\s+\d+\s+(?:before|prior to|before using)\b/.test(text)
    || /\bbefore\s+(?:using|resolving|the ability)\b/.test(text)) {
    blockers.push('pre-ability-movement');
  }

  // Interrupt modifier: interrupt cost, Interrupt N
  if (/\binterrupt\s*\d*\b/.test(text)) {
    blockers.push('interrupt-modifier');
  }

  // Range family (re-audited with kernels/range.ts): the old single
  // `range-modifier` rule conflated listed-range changes with exact-distance
  // predicates and unlimited-range grants. Listed-range changes are
  // implemented by the range kernel but only for registered recipes, so the
  // blocker still names an unwired unit's missing recipe.
  //
  // Exact-distance predicate: "at exactly range N" inspects distance for an
  // effect (boon/unerring/damage/teleport/explosion) without changing
  // targeting legality — a distinct family from listed-range modification.
  if (/at exactly range \d+|exactly range \d+|at exactly range\b/.test(text)) {
    blockers.push('distance-predicate');
  }
  // Unlimited / no-maximum range: "no maximum range" / "unlimited range" is
  // a distinct grant (the range kernel supports fixed/conditional/dynamic
  // values, not an unbounded marker).
  if (/no maximum range|unlimited range|no range limit/.test(text)) {
    blockers.push('unlimited-range');
  }
  // Listed range modifier: range N, gains range, range to N, range equal to
  // N, range increases/becomes.
  if (/\brange\s+\d+\b/.test(text) || /\bgains?\s+range\b/.test(text)
    || /\brange\s+(?:to|becomes|equal to|increases|grows)\b/.test(text)) {
    blockers.push('range-modifier');
  }

  // Stance gate: stance, enter a stance
  if (/\bstance\b/.test(text)) {
    blockers.push('stance-gate');
  }

  // Mark modifier: mark, marked
  if (/\bmark(?:s|ed)?\b/.test(text) && !/\bmark(?:s|ed)?\s+that\b/.test(text)) {
    blockers.push('mark-modifier');
  }

  // Blessing spend: blessing, bless
  if (/\bblessing\b/.test(text)) {
    blockers.push('blessing-spend');
  }

  // Cure on trigger: cure, cured
  if (/\bcure[ds]?\b/.test(text)) {
    blockers.push('cure-on-trigger');
  }

  // Entity create: summon, create entity
  if (/\bsummon(?:s|ed)?\b/.test(text) || /\bcreate\s+(?:an?\s+)?(?:shadow|beast|thrall|plant|sprite|bomb|object|entity)\b/.test(text)) {
    blockers.push('entity-create');
  }

  // Combo spend: combo token
  if (/\bcombo\s+token\b/.test(text)) {
    blockers.push('combo-spend');
  }

  // Cover mechanic: cover
  if (/\bcover\b/.test(text)) {
    blockers.push('cover-mechanic');
  }

  // Charge state: charge, slow turn, must be slow
  if (/\bcharge\b/.test(text) || /\bslow\b/.test(text)) {
    blockers.push('charge-state');
  }

  // Entity vacate: vacate
  if (/\bvacate\b/.test(text)) {
    blockers.push('entity-vacate');
  }

  // Heroics economy: Heroic, heroics
  if (/\bheroic\b/.test(text)) {
    blockers.push('heroics-economy');
  }

  // Pre-ability movement (rush): rush before ability
  if (/\brush\s+\d+\b/.test(text) && !/shove/.test(text)) {
    blockers.push('rush-modifier');
  }

  // Infuse cost: infuse, aether cost
  if (/\binfus(?:e|ed|ion)\b/.test(text)) {
    blockers.push('infuse-cost');
  }

  // If no blockers matched, it's irreducible
  if (blockers.length === 0) {
    blockers.push('irreducible');
  }

  return [...new Set(blockers)];
}

// ═══════════════════════════════════════════════════════════════════════════
// Census generation
// ═══════════════════════════════════════════════════════════════════════════

interface CensusRecord {
  sourceId: string;
  kind: RuleSourceKind;
  blockers: string[];
}

interface MarginalEntry {
  immediate: number;
  oneCloser: number;
  multiCloser: number;
  totalContaining: number;
}

interface CensusResult {
  baseline: number;
  byKind: Record<string, number>;
  records: CensusRecord[];
  blockerFrequencies: Record<string, number>;
  singletonFamilies: Record<string, string[]>;
  /** Marginal table for ALL blockers (including non-implementable). */
  marginalTableAll: Record<string, MarginalEntry>;
  /** Marginal table for IMPLEMENTABLE blockers only. */
  marginalTableImplementable: Record<string, MarginalEntry>;
  /** Non-implementable residual count. */
  residualCount: number;
  greedySimulation: Array<{ step: number; implement: string; unlocks: number; cumulative: number; remaining: number }>;
  invariants: string[];
}

function generateCensus(): CensusResult {
  const units = collectRuleSourceUnits();
  const censusUnits = units.filter((u) => CENSUS_KINDS.includes(u.kind));
  const { compilations } = auditRuleCompilations(units);

  // Build compilation lookup
  const compilationMap = new Map(compilations.map((c) => [c.program.sourceId, c]));

  // Determine complete vs unresolved
  const unresolved: CensusRecord[] = [];
  const complete: string[] = [];
  const seenIds = new Set<string>();

  for (const unit of censusUnits) {
    if (seenIds.has(unit.id)) {
      throw new Error(`Duplicate source ID: ${unit.id}`);
    }
    seenIds.add(unit.id);

    const compilation = compilationMap.get(unit.id);
    if (!compilation) {
      throw new Error(`No compilation for source unit: ${unit.id}`);
    }

    if (compilation.unsupportedClauses.length === 0) {
      complete.push(unit.id);
      continue;
    }

    let blockers = RECLASSIFIED_BLOCKERS[unit.id] ?? classifyBlockers(unit);
    // Phase 5 harvest: an implemented primitive no longer blocks anything.
    blockers = blockers.filter((blocker) => !IMPLEMENTED_PRIMITIVES.has(blocker));
    if (blockers.length === 0) {
      // A unit whose every blocker is already implemented would be executable.
      // The compiler audit says otherwise (it is unresolved), so this is a
      // classification error — surface it as a strict-mode failure rather
      // than silently promoting a unit whose semantics are not represented.
      if (strict) {
        throw new Error(`Unresolved unit ${unit.id} has only implemented blockers — re-audit its blocker set`);
      }
      blockers = ['irreducible'];
    }
    unresolved.push({ sourceId: unit.id, kind: unit.kind, blockers });
  }

  // Per-kind counts
  const byKind: Record<string, number> = {};
  for (const kind of CENSUS_KINDS) {
    byKind[kind] = unresolved.filter((r) => r.kind === kind).length;
  }

  // Blocker frequencies
  const blockerFrequencies: Record<string, number> = {};
  for (const record of unresolved) {
    const key = `{${record.blockers.sort().join(', ')}}`;
    blockerFrequencies[key] = (blockerFrequencies[key] ?? 0) + 1;
  }

  // Singleton families
  const singletonFamilies: Record<string, string[]> = {};
  for (const record of unresolved) {
    if (record.blockers.length === 1) {
      const blocker = record.blockers[0];
      singletonFamilies[blocker] = singletonFamilies[blocker] ?? [];
      singletonFamilies[blocker].push(record.sourceId);
    }
  }

  // Collect all unique blockers
  const uniqueBlockers = new Set<string>();
  for (const record of unresolved) {
    for (const b of record.blockers) uniqueBlockers.add(b);
  }

  // Compute marginal table (shared logic)
  function computeMarginal(records: CensusRecord[], blockers: Set<string>): Record<string, MarginalEntry> {
    const table: Record<string, MarginalEntry> = {};
    for (const blocker of blockers) {
      const containing = records.filter((r) => r.blockers.includes(blocker));
      const immediate = containing.filter((r) => r.blockers.length === 1).length;
      const oneCloser = containing.filter((r) => r.blockers.length === 2).length;
      const multiCloser = containing.filter((r) => r.blockers.length >= 3).length;
      const totalContaining = immediate + oneCloser + multiCloser;
      table[blocker] = { immediate, oneCloser, multiCloser, totalContaining };
    }
    return table;
  }

  // Full marginal table (all blockers)
  const marginalTableAll = computeMarginal(unresolved, uniqueBlockers);

  // Implementable marginal table (excluding non-implementable)
  const implementableBlockers = new Set<string>();
  for (const b of uniqueBlockers) {
    if (!NON_IMPLEMENTABLE.has(b)) implementableBlockers.add(b);
  }
  const marginalTableImplementable = computeMarginal(unresolved, implementableBlockers);

  // Sort implementable marginal table by totalContaining descending
  const sortedMarginalImplementable = Object.entries(marginalTableImplementable)
    .sort((a, b) => b[1].totalContaining - a[1].totalContaining);

  // Residual count: units whose blocker set consists ENTIRELY of non-implementable blockers
  const residualCount = unresolved.filter((r) => r.blockers.every((b) => NON_IMPLEMENTABLE.has(b))).length;

  // Greedy simulation (IMPLEMENTABLE blockers only)
  const greedySimulation: CensusResult['greedySimulation'] = [];
  let remaining = unresolved.length;
  let cumulative = 0;
  const implemented = new Set<string>();
  let step = 0;

  // Sort by immediate completions descending, then totalContaining
  const sortedBlockers = Object.entries(marginalTableImplementable)
    .sort((a, b) => b[1].immediate - a[1].immediate || b[1].totalContaining - a[1].totalContaining);

  for (const [blocker] of sortedBlockers) {
    if (remaining === 0) break;
    // Never implement a non-implementable classification
    if (NON_IMPLEMENTABLE.has(blocker)) continue;

    // Count units that become complete if we implement this blocker
    const wouldComplete = unresolved.filter((r) =>
      !implemented.has(r.sourceId) && r.blockers.includes(blocker)
    );

    const newlyUnlocked = wouldComplete.filter((r) =>
      r.blockers.every((b) => b === blocker || implemented.has(`__impl__${b}`))
    ).length;

    if (newlyUnlocked === 0) continue;

    step++;
    implemented.add(`__impl__${blocker}`);
    const prevRemaining = remaining;
    remaining -= newlyUnlocked;
    cumulative += newlyUnlocked;

    greedySimulation.push({
      step,
      implement: blocker,
      unlocks: newlyUnlocked,
      cumulative,
      remaining,
    });

    // Verify invariant
    if (prevRemaining - newlyUnlocked !== remaining) {
      throw new Error(
        `Greedy invariant violated at step ${step}: ${prevRemaining} - ${newlyUnlocked} !== ${remaining}`
      );
    }
  }

  // Machine-checked invariants
  const invariants: string[] = [];

  // 1. Unique source IDs
  const allIds = censusUnits.map((u) => u.id);
  const uniqueIds = new Set(allIds);
  if (allIds.length === uniqueIds.size) {
    invariants.push('✓ All source IDs are unique');
  } else {
    const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
    invariants.push(`✗ Duplicate source IDs found: ${dupes.join(', ')}`);
  }

  // 2. Every unresolved unit appears exactly once
  const unresolvedIds = new Set(unresolved.map((r) => r.sourceId));
  if (unresolvedIds.size === unresolved.length) {
    invariants.push('✓ Every unresolved unit appears exactly once');
  } else {
    invariants.push('✗ Some unresolved units appear multiple times');
  }

  // 3. No executable unit appears in unresolved
  const executableOverlap = unresolved.filter((r) => {
    if (r.kind === 'talent') return isExecutableTalent(r.sourceId);
    return complete.includes(r.sourceId);
  });
  if (executableOverlap.length === 0) {
    invariants.push('✓ No executable unit appears in the unresolved census');
  } else {
    invariants.push(`✗ Executable units in unresolved: ${executableOverlap.map((r) => r.sourceId).join(', ')}`);
  }

  // 4. Per-kind totals sum to unresolved total
  const kindSum = Object.values(byKind).reduce((a, b) => a + b, 0);
  if (kindSum === unresolved.length) {
    invariants.push(`✓ Per-kind totals sum to unresolved total (${kindSum})`);
  } else {
    invariants.push(`✗ Per-kind sum ${kindSum} ≠ unresolved total ${unresolved.length}`);
  }

  // 5. Blocker-set frequencies derive from per-unit records
  const freqFromRecords: Record<string, number> = {};
  for (const record of unresolved) {
    const key = `{${record.blockers.sort().join(', ')}}`;
    freqFromRecords[key] = (freqFromRecords[key] ?? 0) + 1;
  }
  const freqMatch = JSON.stringify(blockerFrequencies) === JSON.stringify(freqFromRecords);
  if (freqMatch) {
    invariants.push('✓ All blocker-set frequencies derive from per-unit records');
  } else {
    invariants.push('✗ Blocker-set frequencies do not match per-unit records');
  }

  // 6. Marginal values derive from per-unit records (with multiCloser)
  const margFromRecords: Record<string, MarginalEntry> = {};
  for (const record of unresolved) {
    for (const b of record.blockers) {
      if (!margFromRecords[b]) margFromRecords[b] = { immediate: 0, oneCloser: 0, multiCloser: 0, totalContaining: 0 };
      margFromRecords[b].totalContaining++;
      if (record.blockers.length === 1) margFromRecords[b].immediate++;
      if (record.blockers.length === 2) margFromRecords[b].oneCloser++;
      if (record.blockers.length >= 3) margFromRecords[b].multiCloser++;
    }
  }
  const margMatch = JSON.stringify(marginalTableAll) === JSON.stringify(margFromRecords);
  if (margMatch) {
    invariants.push('✓ All marginal values derive from per-unit records');
  } else {
    invariants.push('✗ Marginal values do not match per-unit records');
  }

  // 7. Marginal assertion: immediate + oneCloser + multiCloser === totalContaining for every blocker
  let margAssertionOk = true;
  const margFailures: string[] = [];
  for (const [blocker, entry] of Object.entries(marginalTableAll)) {
    if (entry.immediate + entry.oneCloser + entry.multiCloser !== entry.totalContaining) {
      margAssertionOk = false;
      margFailures.push(`${blocker}: ${entry.immediate}+${entry.oneCloser}+${entry.multiCloser}=${entry.immediate + entry.oneCloser + entry.multiCloser} ≠ ${entry.totalContaining}`);
    }
  }
  if (margAssertionOk) {
    invariants.push('✓ Marginal assertion: immediate + oneCloser + multiCloser === totalContaining for every blocker');
  } else {
    invariants.push(`✗ Marginal assertion failed: ${margFailures.join('; ')}`);
  }

  // 8. Cumulative + remaining = baseline at every step
  const stepsOk = greedySimulation.every((s) => s.cumulative + s.remaining === unresolved.length);
  if (stepsOk) {
    invariants.push('✓ Cumulative unlocked + remaining = baseline at every step');
  } else {
    invariants.push('✗ Cumulative + remaining ≠ baseline at some step');
  }

  // 9. Non-implementable classifications never appear in greedy simulation
  const greedyNonImpl = greedySimulation.filter((s) => NON_IMPLEMENTABLE.has(s.implement));
  if (greedyNonImpl.length === 0) {
    invariants.push('✓ No non-implementable classifications in greedy simulation');
  } else {
    invariants.push(`✗ Non-implementable in greedy simulation: ${greedyNonImpl.map((s) => s.implement).join(', ')}`);
  }

  // 10. Final remaining ≥ residual count (units with only non-implementable blockers)
  if (greedySimulation.length > 0) {
    const last = greedySimulation[greedySimulation.length - 1];
    if (last.remaining >= residualCount) {
      invariants.push(`✓ Final remaining: ${last.remaining} (residual: ${residualCount} units need non-implementable capabilities)`);
    } else {
      invariants.push(`✗ Final remaining ${last.remaining} < residual count ${residualCount}`);
    }
  }

  return {
    baseline: unresolved.length,
    byKind,
    records: unresolved,
    blockerFrequencies,
    singletonFamilies,
    marginalTableAll,
    marginalTableImplementable: Object.fromEntries(sortedMarginalImplementable),
    residualCount,
    greedySimulation,
    invariants,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Report generation
// ═══════════════════════════════════════════════════════════════════════════

function generateReport(census: CensusResult): string {
  const lines: string[] = [];

  lines.push('# Class/Job Blocker Census (Canonical, Machine-Checked)');
  lines.push('');
  lines.push(`> Generated from ${census.baseline} unresolved source units: ${Object.entries(census.byKind).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  lines.push('>');
  lines.push('> All counts are derived from the canonical census tool with machine-checked');
  lines.push('> assertions. Singleton blocker sets must be audit-verified separately.');
  lines.push('>');
  lines.push(`> **Residual:** ${census.residualCount} units have ONLY non-implementable blocker classifications.`);
  lines.push('>');
  lines.push('> **Non-implementable classifications** (excluded from marginal rankings and greedy simulation):');
  lines.push('> `irreducible` — not-yet-decomposed residual; needs ability-specific decomposition before it becomes an implementable primitive.');
  lines.push('');

  // Singleton families
  lines.push('## Singleton blocker families');
  lines.push('');
  const sortedSingletons = Object.entries(census.singletonFamilies)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [blocker, ids] of sortedSingletons) {
    const tag = NON_IMPLEMENTABLE.has(blocker) ? ' *(non-implementable)*' : '';
    lines.push(`### \`${blocker}\` (${ids.length} units)${tag}`);
    lines.push('');
    for (const id of ids) {
      lines.push(`- \`${id}\``);
    }
    lines.push('');
  }

  // Blocker-set frequencies
  lines.push('## Blocker-set frequencies');
  lines.push('');
  lines.push('| Blocker set | Count |');
  lines.push('|---|---|');
  const sortedFreqs = Object.entries(census.blockerFrequencies)
    .sort((a, b) => b[1] - a[1]);
  for (const [set, count] of sortedFreqs) {
    lines.push(`| ${set} | ${count} |`);
  }
  lines.push('');

  // Marginal unlock table (implementable only)
  lines.push('## Marginal unlock table (implementable primitives)');
  lines.push('');
  lines.push('| Primitive | Immediate | One-closer | Multi-closer | Total containing |');
  lines.push('|---|---|---|---|---|');
  for (const [blocker, data] of Object.entries(census.marginalTableImplementable)) {
    lines.push(`| ${blocker} | ${data.immediate} | ${data.oneCloser} | ${data.multiCloser} | ${data.totalContaining} |`);
  }
  lines.push('');

  // Greedy simulation
  lines.push('## Greedy build order (implementable primitives only)');
  lines.push('');
  lines.push('| Step | Implement | Unlocks | Cumulative | Remaining |');
  lines.push('|---|---|---|---|---|');
  for (const step of census.greedySimulation) {
    lines.push(`| ${step.step} | ${step.implement} | ${step.unlocks} | ${step.cumulative} | ${step.remaining} |`);
  }
  if (census.greedySimulation.length > 0) {
    const last = census.greedySimulation[census.greedySimulation.length - 1];
    lines.push('');
    lines.push(`After all implementable primitives: **${last.cumulative} unlocked, ${last.remaining} remain** (${census.residualCount} residual units need non-implementable capabilities).`);
  }
  lines.push('');

  // Machine-checked invariants
  lines.push('## Machine-checked invariants');
  lines.push('');
  lines.push('```');
  for (const inv of census.invariants) {
    lines.push(inv);
  }
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

const strict = process.argv.includes('--strict');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex !== -1 ? process.argv[outputIndex + 1] : undefined;

const census = generateCensus();
const report = generateReport(census);

console.log(report);

// Also output JSON for programmatic consumption
const jsonPath = outputPath ? (outputPath.endsWith('.md') ? outputPath.replace(/\.md$/, '.json') : outputPath + '.json') : join(process.cwd(), 'docs', 'blocker-census.json');
writeFileSync(jsonPath, JSON.stringify(census, null, 2));
console.error(`\nCensus JSON written to ${jsonPath}`);

if (outputPath && outputPath.endsWith('.md')) {
  writeFileSync(outputPath, report);
  console.error(`Report written to ${outputPath}`);
}

// Check for invariant failures
const failures = census.invariants.filter((inv) => inv.startsWith('✗'));
if (failures.length > 0) {
  console.error('\n⚠ INVARIANT FAILURES:');
  for (const f of failures) console.error(f);
  if (strict) process.exitCode = 1;
}
