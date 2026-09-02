/**
 * source-adjudications.ts — the authoritative record of ICON 1.5 source
 * contradictions and the interpretation the engine adopts.
 *
 * Authority hierarchy (AGENTS.md, "Rules Authority"):
 *
 *     ordinary source text
 *         ↓
 *     source adjudication ONLY when source passages conflict
 *         ↓
 *     executable implementation
 *         ↓
 *     tests/audits proving implementation matches adopted semantics
 *
 * This registry exists for ONE purpose: when two explicit ICON 1.5 passages
 * make mutually incompatible claims about the same mechanic, record the
 * conflict and the interpretation the engine commits to, so the contradiction
 * is never resolved by whichever passage an agent happens to read, a buried
 * code comment, or silently choosing the reading that makes a test pass.
 *
 * It is NOT a rules engine and it must never override an unambiguous source
 * rule. An adjudication may only exist where the source itself conflicts.
 * A record may bundle the conflict-resolved reading with same-family derived
 * interpretations (an underspecified sibling rule resolved by the same
 * semantic question) — but the derived part is always labeled as such
 * (`adopted` part 2) and never presented as a second passage conflict.
 * Records are pure data: deterministic, human-readable, machine-queryable,
 * with stable IDs and page references. No prose is parsed at runtime and no
 * gameplay callbacks live in a record.
 *
 * The typed records below are the authority; docs/source-adjudications.md is
 * conceptual and must not drift into a second copy of these fields.
 */

export interface SourceConflictPassage {
  /** ICON 1.5 PDF page the statement appears on. */
  page: number;
  /** The conflicting statement, quoted from the source. */
  statement: string;
}

/** An optional machine-readable boundary the adopted reading pins, so engine
 * constants and tests can be checked against the adjudication without
 * parsing prose. `level` pins an unlock/benefit level; `xp` pins an XP
 * breakpoint; `hp-threshold-base` pins that every percent-of-maximum-HP
 * read (bloodied/quarter state thresholds AND percent costs/damage) uses
 * the BASE maximum, never the wounds-adjusted bar. */
export type SourceAdjudicationBoundary =
  | { kind: 'level'; value: number }
  | { kind: 'xp'; value: number }
  | { kind: 'hp-threshold-base'; baseMaximum: true };

export interface SourceAdjudication {
  /** Stable conflict ID (never rename; tests and docs reference it). */
  id: string;
  rulesVersion: '1.5';
  /** Short topic label, e.g. "Character advancement — mid-level Ability Point". */
  topic: string;
  /** The mutually incompatible source passages (two or more). */
  sources: readonly SourceConflictPassage[];
  /** Concise statement of the incompatibility. */
  conflict: string;
  /** The interpretation the engine adopts. */
  adopted: string;
  /** Why this reading wins (specificity, corroboration, cross-references). */
  rationale: string;
  /** Implementation locations governed by the adopted reading. */
  affectedCode: readonly string[];
  status: 'adopted' | 'unresolved';
  /** Machine-readable boundary (see SourceAdjudicationBoundary). */
  boundary?: SourceAdjudicationBoundary;
}

export const SOURCE_ADJUDICATIONS: readonly SourceAdjudication[] = [
  {
    id: 'icon-1.5:advancement:mid-level-ap',
    rulesVersion: '1.5',
    topic: 'Character advancement — mid-level Ability Point (XP breakpoints)',
    sources: [
      {
        page: 44,
        statement: 'Each time the characters fill the xp bar to 5 or 10 xp, they can unlock an ability or talent at the end of that session or during a camp or interlude. If a character’s xp bar is full (15 xp), they can clear the bar and gain a level up.',
      },
      {
        page: 240,
        statement: 'The xp bar is 15 ticks long. At 7 xp gained, during an interlude, at the end of a session or at camp characters can gain +1 ap, and spend it to unlock a new combat ability in any job they have, or gain a new talent for an ability they already have. This only triggers once per level. Once the bar is full (15 xp), a character can clear all xp and mark a level up.',
      },
      {
        page: 241,
        statement: 'At level 1 and every level afterwards, characters gain +1 ap when they hit 7 xp and go into a camp, enter an interlude, or at the end of a session. When a character hits 15 xp, they clear their xp bar and accumulate a level up.',
      },
    ],
    conflict: 'The Expeditions section (p.44) grants the mid-level ability/talent unlock at 5 and 10 XP; the Book of Adventure advancement procedure (p.240 and p.241) grants a single mid-level +1 AP at 7 XP, once per level, with a 15-tick bar and a level-up banked at 15 XP. Both sides agree the bar is 15 ticks and full means 15 XP; they disagree on the mid-level breakpoint (5/10 vs 7).',
    adopted: 'The Book of Adventure procedure: the XP bar is 15 ticks; a character gains +1 AP at 7 XP (once per level), and clears the bar to bank a level at 15 XP. There are no ability/talent unlocks at 5 or 10 XP.',
    rationale: 'The Book of Adventure is the book’s dedicated advancement chapter (p.3 update notes: "Character advancement has been reorganized — less narrative action dots, more ability points"), and its procedure is restated consistently four times: p.112 ("At level 1 and higher, once you hit 7 xp, you gain an ability point"), p.240, p.241, and the Getting Started Character Advancement block on p.15. The 5/10-XP passage on p.44 appears in the older Expeditions section and contradicts all four restatements. The engine implements the Book of Adventure reading (see affectedCode), so the adjudication records existing behavior rather than changing it.',
    affectedCode: [
      'src/rules/character.ts — awardXp (7 XP sets xpAbilityPointClaimed; 15 XP banks a level and resets XP)',
      'src/rules/character.ts — abilityPointAllowance (the claimed mid-level AP is included in the allowance)',
      'src/rules/character.ts — validateCharacter (XP range 0–14; 15 banks and resets)',
      'src/pages/CharacterEditor.tsx — XP progression controls ("Gain 7 XP to claim +1 AP")',
    ],
    status: 'adopted',
    boundary: { kind: 'xp', value: 7 },
  },
  {
    id: 'icon-1.5:advancement:limit-break-level',
    rulesVersion: '1.5',
    topic: 'Character advancement — Limit Break unlock level',
    sources: [
      {
        page: 115,
        statement: 'Tactical Combat Advancement table, Level 1 row: "Gain +2 ap and unlock Limit Break".',
      },
      {
        page: 99,
        statement: 'Every character unlocks limit break at level 2.',
      },
      {
        page: 112,
        statement: 'After you play your first session, you’ll level up to level 1, unlock your limit break, and gain +2 ap to choose new abilities, or unlock the talents of your existing ones.',
      },
    ],
    conflict: 'The advancement tables (p.15, p.115, p.241) and the "Improving" prose (p.112) grant the Limit Break at level 1 (the level-1 row is "Gain +2 ap and unlock Limit Break"); the Resolve and Limit Break section (p.99) states "Every character unlocks limit break at level 2".',
    adopted: 'The Limit Break unlocks at level 1, with the +2 AP of the level-1 advancement row. Level 0 has no Limit Break.',
    rationale: 'Three independent advancement tables (pp.15, 115, 241) agree the level-1 row grants "+2 ap and unlock Limit Break", p.112’s prose explicitly says leveling up to level 1 unlocks the limit break, and p.240’s level-0 description ("no limit break, no relics, only 2 combat abilities and 1 narrative power") corroborates that level 0 lacks it. The single p.99 sentence ("level 2") contradicts the tables and prose and reads as a leftover from an earlier draft. The engine currently has no Limit Break availability gate at all (the character model has no limit-break ownership field), so adopting level 1 requires no behavioral change today; the executable boundary is recorded as LIMIT_BREAK_UNLOCK_LEVEL so a future availability gate cannot silently choose level 2.',
    affectedCode: [
      'src/rules/character.ts — LIMIT_BREAK_UNLOCK_LEVEL (the adopted boundary constant)',
      'src/rules/catalog.ts — limitBreak definitions (ownership/execution surface once availability lands)',
      'src/rules/source-units.ts — limit-break source units',
      'src/rules/encounter.ts — EXECUTE_RULE ownership gate (actor.abilityIds.includes); no level gate exists yet',
    ],
    status: 'adopted',
    boundary: { kind: 'level', value: 1 },
  },
  {
    id: 'icon-1.5:dangerous-terrain:damage-cadence',
    rulesVersion: '1.5',
    topic: 'Dangerous terrain — damage cadence (once per turn vs once per round)',
    sources: [
      {
        page: 89,
        statement: 'Dangerous Terrain - Entering or exiting a dangerous terrain space causes a character to take 2 piercing damage, (ignoring armor and vigor). Characters can only take this damage once a turn, even if they enter new dangerous terrain spaces.',
      },
      {
        page: 183,
        statement: 'Dangerous Terrain (Harvester “Relevant Rules” keyword recap) - Entering or exiting a dangerous terrain space causes a character to take 2 piercing damage. Characters can only take this damage once a round,.',
      },
    ],
    conflict: 'Two passages state the same mechanic — the cadence of the 2 piercing dangerous-terrain damage per character — with contradictory windows. The core Battlefield/Terrain rule (p.89) says “once a turn”; the Harvester job sheet’s “Relevant Rules” keyword recap (p.183) reprints the same rule as “once a round”. These are materially different: once-a-turn allows the damage again in a later turn of the same round, whereas once-a-round caps the damage across the entire round.',
    adopted: 'Dangerous terrain deals its 2 piercing damage (ignoring armor and vigor) to a character at most once per TURN. The per-turn window reopens at each turn start. The engine scopes this as a per-actor `any-turn` usage mark cleared by the turn-start sweep.',
    rationale: 'p.89 is the canonical global definition of terrain in the Book of Battle (“The Battlefield”), while the p.183 sentence is one item in a condensed job-sheet keyword recap intended to jog a Harvester player’s memory. The recap itself shows the reprint is careless: it drops the clarifying “(ignoring armor and vigor)” and the “even if they enter new dangerous terrain spaces” clause, and carries a stray comma (“once a round,”). ICON restates dangerous terrain consistently as once-per-turn everywhere the full rule appears (the glossary and the core rule; see affectedCode). Against a general rule restated consistently and a single localized recap with evident transcription errors, the general definition is authoritative; adopting once-per-turn also preserves the established engine behavior (p.89 reading) rather than changing it.',
    affectedCode: [
      'src/rules/core.ts — core:terrain dangerous definition (“at most once per turn”)',
      'src/rules/automation/kernels/use-ledger.ts — dangerousOncePerTurnKey (per-actor any-turn usage mark, cleared by the turn-start sweep)',
      'src/rules/movement.ts — planMovementPath de-duplicates dangerous-terrain damage through the U16 any-turn window',
      'src/rules/encounter.ts — ACTOR_MOVED reducer records the once-per-turn dangerous-terrain mark; refreshAnyTurnLedgersForAll reopens every actor’s window at each turn start',
    ],
    status: 'adopted',
  },
  {
    id: 'icon-1.5:combat:bloodied-base-max',
    rulesVersion: '1.5',
    topic: 'Bloodied and the percent-of-maximum-HP threshold family — base maximum vs wounds-adjusted maximum',
    sources: [
      {
        page: 81,
        statement: 'Certain abilities care about if a character is bloodied, which is at or below 50% your base maximum hp.',
      },
      {
        page: 81,
        statement: 'Wound: When you take a wound, fill in 25% of your HP (a value equal to your VIT value) from the right side of your hp bar, temporarily reducing your maximum HP.',
      },
      {
        page: 94,
        statement: 'Bloodied - When a character is at or under 50% maximum HP, they are bloodied.',
      },
      {
        page: 104,
        statement: 'Bloodied - At or under 50% hp',
      },
    ],
    conflict: 'The primary HP/Wound rule (p.81) defines bloodied as "at or below 50% your base maximum hp" and, in the very next bullet, defines the wound as filling "25% of your HP (a value equal to your VIT value)" and "temporarily reducing your maximum HP" — so the base maximum (the un-wounded 4xVIT bar) is deliberately distinct from the wound-reduced bar. The terse Special States (p.94, "at or under 50% maximum HP") and Combat Glossary (p.104, "at or under 50% hp") recaps omit the "base" qualifier, which admits the reading that the threshold measures the wound-reduced maximum the Wound rule creates. (The "at 25% hp or lower" quarter family is NOT part of this conflict — no passage measures a percent-of-HP threshold against the wound-reduced bar — it is the derived interpretation recorded in `adopted` part 2, with its evidence in `rationale`.)',
    adopted: 'PART 1 — CONFLICT-RESOLVED (bloodied): bloodied is hp at or below 50% of the BASE maximum, the character\'s un-wounded 4xVIT bar (exactly hp*2 <= baseMaxHp); p.81\'s explicit "base maximum hp" qualifier wins over the unqualified p.94/p.104 recaps. PART 2 — DERIVED INTERPRETATION (the "at 25% hp or lower" family — Rot p.186, the marks/status Regeneration "cure yourself" gate, the Harvester 25% gates, sealer/relic "at or under 25% hp" gates, and the p.86 post-combat "heals to the next 25% hp segment" rule): the same base bar (exactly hp*4 <= baseMaxHp), derived from p.81\'s definition that 25% of maximum HP equals VIT and p.107\'s base-maximum percent-of-health policy — not from any passage that qualifies the quarter gates themselves. In both parts, wounds shrink the LIVE maximum (maxHp = baseMaxHp - wounds x vitality), which caps healing/vigor and describes the current bar, but never move a percent-of-maximum threshold.',
    rationale: 'Bloodied (part 1): p.81 is the primary, most specific statement of the bloodied rule and it explicitly qualifies "base maximum hp" immediately before introducing wound-based max-HP reduction — the two sentences only compose coherently if the threshold base and the wound-reduced bar are different numbers. p.94/p.104 are condensed recaps that drop the qualifier without contradicting it ("maximum HP" reads naturally as the printed base bar). The engine previously read the terse p.94 wording as the wound-reduced bar (the long-standing wounds-adjusted `isBloodied`, canonized by the U5 tranche-22 percent-max-hp scalar); that reading conflicts with the p.81 qualifier. Quarter family (part 2 — derived, not a second conflict): the book itself defines "25% of your maximum HP" as a FIXED, base-derived quantity — p.81 (HP rule): "Other effects can heal or damage you equal to a multiple of your VIT value (25% of your maximum HP), so it\'s a quick shorthand", and the wound bullet fills "25% of your HP (a value equal to your VIT value)"; VIT does not change with wounds, so a 25%-of-HP gate cannot move as wounds accumulate. p.86\'s post-combat healing reads the same base-defined segments ("heals to the next 25% hp segment of your hp bar, or to the 50% mark if you are at 25% hp or lower"), and p.107 states the base-maximum policy for percent-of-health costs/damage ("Any ability that costs or damages a certain percent of health always considers maximum base hp, and not max hp based on wounds, etc.") with "VIT (25% HP) as a quick shorthand". No passage anywhere measures a percent-of-HP threshold against the wound-reduced bar, so this record adopts the base-maximum reading for the whole family and the engine is repaired to it.',
    affectedCode: [
      'src/rules/automation/kernels/hp-threshold.ts — isBloodied / isAtOrUnderQuarterHp (hp*2 <= baseMaxHp / hp*4 <= baseMaxHp)',
      'src/rules/automation/kernels/evaluate-predicate.ts — bloodied/quarter predicates (percent of baseMaxHp)',
      'src/rules/automation/kernels/evaluate-value.ts — percent-base-max + percentOfMaximum (the single BASE-bar scalar; percent-max-hp removed)',
      'src/rules/automation/content/jobs/programs/harvester-programs.ts — Rot "at 25% hp or lower" mark gate',
      'src/rules/automation/kernels/talent-recipes.ts / bonus-damage.ts / primitives/modifiers.ts — comeback/self/target-bloodied fold gates',
      'src/rules/automation/kernels/encounter-adapter.ts — Cure/regeneration bloodied reads and the fold-view maximumHp projections',
      'src/rules/automation/content/jobs/programs/demon-slayer-programs.ts — Raging Demon missing-HP percent read (baseMaximumHp fail-closed; the encounterState/baseMaxHp fallback removed)',
      'src/rules/automation/content/jobs/programs/spellblade-programs.ts / freelancer-programs.ts — inline effectiveAreaFor fold views project the base bar (maximumHp: source.baseMaxHp)',
    ],
    status: 'adopted',
    boundary: { kind: 'hp-threshold-base', baseMaximum: true },
  },
];

/** Stable-ID lookup used by tests and documentation generation. */
export function findAdjudication(id: string): SourceAdjudication | undefined {
  return SOURCE_ADJUDICATIONS.find((adjudication) => adjudication.id === id);
}
