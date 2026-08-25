/**
 * fidelity/advancement-frontier.ts — the explicit irrelevance dispositions
 * for the `advancement` scope's source frontier.
 *
 * Every entry dispositions exactly one canonical frontier clause (matched by
 * normalized text) that this scope deliberately does NOT implement, with a
 * recorded reason. This is the conservative accounting that prevents
 * omission-based false closure: an uncovered clause without an entry here
 * blocks scope closure. Entries were curated against the pinned extraction of
 * ICON 1.5 pp.44/99/112/115/240/241; `npm run audit:source-fidelity -- --strict`
 * fails on any entry that no longer matches exactly one clause (stale policy)
 * and on any newly uncovered clause without an entry.
 */

import type { OccurrenceCount } from './types.js';

export const ADVANCEMENT_IRRELEVANT_CLAUSES: readonly {
  text: string;
  reason: string;
  occurrences?: OccurrenceCount;
}[] = [
  {
    text: 'around the table and check your xp triggers, then',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'gain xp depending on which you fulfilled them or',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'xp. two or more? 2 xp 2. was your character challenged or tested ,',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'through combat or otherwise ? 1 xp. multiple',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'times? 2 xp 3. accomplished an ambition (group or',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'personal) - 1-3 xp 4. invoked burdens at least once - 1 xp leveling up each time the characters fill the xp bar to 5 or 10',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'the bar and gain a level up. any character that has',
    reason: 'Line merges the conflict-sentence tail (quoted in icon-1.5:advancement:mid-level-ap-boundary) with the banking-cap sentence start (quoted in icon-1.5:advancement:xp-bar-bank).',
  },
  {
    text: '\'save\' one banked level up at once. spending dust at the end of a session, characters can also spend',
    reason: 'Line merges the banking-cap tail (quoted in icon-1.5:advancement:xp-bar-bank) with dust-spending prose (camp subsystem).',
  },
  {
    text: 'icon. every character unlocks limit break at level',
    reason: 'Line merges the "level 2" conflict sentence (quoted verbatim in icon-1.5:advancement:limit-break-unlock-level) with the section heading.',
  },
  {
    text: 'a character can only use a limit break once per',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'every combat • when you limit break, you may give 1',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'not used a limit break this expedition. • personal resolve resets to 0 after you camp, meaning you might want to push on instead of',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'abilities. • when you spend resolve to use a limit break,',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'opportunities to choose others. improving after you play your first session, you\'ll level up to',
    reason: 'Line merges section heading/adjacent guidance with the improvement sentences corroborating the adopted adjudications (recorded in the adjudication records); surrounding job-selection prose is not runtime semantics.',
  },
  {
    text: 'level 1, unlock your limit break , and gain +2 ap',
    reason: 'Line merges section heading/adjacent guidance with the improvement sentences corroborating the adopted adjudications (recorded in the adjudication records); surrounding job-selection prose is not runtime semantics.',
  },
  {
    text: 'your existing ones. at level 1 and higher, once you hit 7 xp, you gain',
    reason: 'Line merges section heading/adjacent guidance with the improvement sentences corroborating the adopted adjudications (recorded in the adjudication records); surrounding job-selection prose is not runtime semantics.',
  },
  {
    text: 'pick up a new job and two bonus ap, or keep the',
    reason: 'Level 4/8 new-job/bonus-AP/mastery choice: player-choice workflow intentionally not automated by this scope.',
  },
  {
    text: 'traits and limit break are unique to your active',
    reason: 'Job-structure ownership rule (traits/limit break unique to active job): separate subsystem, not advancement arithmetic.',
  },
  {
    text: 'tactical combat advancement *does not include bonus ap from choosing new jobs lvl chapter combat benefit total ap* 0 1 choose a job and two abilities. 2 1 1 gain +2 ap and unlock limit break 5 2 1 gain your first relic 6 3 1 gain a mastery point 7 4 1 choose a second job and gain +2 ap or the same job and',
    reason: 'Advancement-table rows above level 1 (relics, mastery points, +1ap, job slots): future scope; only the level-1 row is claimed here and is quoted verbatim in icon-1.5:advancement:limit-break-unlock-level. The header also notes bonus AP from new jobs is excluded from this table.',
  },
  {
    text: 'gain a mastery point. 8 5 2 gain +1ap 10 6 2 get your second relic 11 7 2 gain a mastery point 12 8 2 choose a third job and gain +2 ap or the same job and',
    reason: 'Advancement-table rows above level 1 (relics, mastery points, +1ap, job slots): future scope; only the level-1 row is claimed here and is quoted verbatim in icon-1.5:advancement:limit-break-unlock-level. The header also notes bonus AP from new jobs is excluded from this table.',
  },
  {
    text: 'gain a mastery point. 13 9 3 get your third relic 14 10 3 gain a mastery point 15 11 3 gain +1ap 17 12 3 gain a mastery point 18',
    reason: 'Advancement-table rows above level 1 (relics, mastery points, +1ap, job slots): future scope; only the level-1 row is claimed here and is quoted verbatim in icon-1.5:advancement:limit-break-unlock-level. The header also notes bonus AP from new jobs is excluded from this table.',
  },
  {
    text: 'their level . characters start at level 0 and level up',
    reason: 'Descriptive overview of the level range/bar length; the operative procedure sentences are quoted verbatim in icon-1.5:advancement:xp-bar-bank.',
  },
  {
    text: 'to a maximum of level 12. by default, xp bars are 15 long. the first session and level 0 this game suggests you start new characters at',
    reason: 'Descriptive overview of the level range/bar length; the operative procedure sentences are quoted verbatim in icon-1.5:advancement:xp-bar-bank.',
  },
  {
    text: 'a slightly more limited space (no limit break, no',
    reason: 'First-session onboarding guidance and its scripted award: expedition/session scene flow is intentionally not automated (roadmap F10); no distinct runtime semantic beyond the quoted bar procedure.',
  },
  {
    text: 'necessary to track xp during the first session but',
    reason: 'First-session onboarding guidance and its scripted award: expedition/session scene flow is intentionally not automated (roadmap F10); no distinct runtime semantic beyond the quoted bar procedure.',
  },
  {
    text: 'characters gain enough xp to take them to 15 xp',
    reason: 'First-session onboarding guidance and its scripted award: expedition/session scene flow is intentionally not automated (roadmap F10); no distinct runtime semantic beyond the quoted bar procedure.',
  },
  {
    text: 'and accumulate a level up, leaving them at level 1 for the next section. chapters every chapter of the game represents 4 levels',
    reason: 'First-session onboarding guidance and its scripted award: expedition/session scene flow is intentionally not automated (roadmap F10); no distinct runtime semantic beyond the quoted bar procedure.',
  },
  {
    text: 'that are maxed out on xp can donate it to',
    reason: 'Group XP donation for catch-up: group-session policy, not individual advancement mechanics.',
  },
  {
    text: 'only gained on level up. characters gain xp the following ways: when you start an interlude , immediately',
    reason: 'Line merges "certain benefits are only gained on level up" (quoted verbatim in icon-1.5:advancement:xp-bar-bank) with the XP-award list heading (trigger table).',
  },
  {
    text: 'gain xp for any expedition or quests you finished',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'xp. two or more? 2 xp 2. did your character overcome a challenge? 1',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'xp. many times? 2 xp. 3. accomplished an ambition (group or',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'personal) - 1-3 xp 4. invoked burdens at least once - 1 xp choosing new jobs if you choose a new job at level 4 and 8, you gain',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: '+2 ap each time. you may forgo choosing a new job at level 4 and',
    reason: 'Level 4/8 new-job/bonus-AP/mastery choice: player-choice workflow intentionally not automated by this scope.',
  },
  {
    text: 'an additional mastery point. alternate xp if you want to set a different or slower pace for',
    reason: 'Level 4/8 new-job/bonus-AP/mastery choice: player-choice workflow intentionally not automated by this scope.',
  },
  {
    text: 'your campaign, you can set escalating xp tracks.',
    reason: 'Explicitly optional variant rules ("Alternate XP"): intentionally not automated.',
  },
  {
    text: 'in chapter 1, all tracks are 12 long, with +1 ap at 6.',
    reason: 'Explicitly optional variant rules ("Alternate XP"): intentionally not automated.',
  },
  {
    text: 'in chapter 2, they are 18 long, with +1 ap at 9. in',
    reason: 'Explicitly optional variant rules ("Alternate XP"): intentionally not automated.',
  },
  {
    text: 'chapter 3, they are 24 xp long, with +1ap at 12. you can play with slower xp (using the longer',
    reason: 'Explicitly optional variant rules ("Alternate XP"): intentionally not automated.',
  },
  {
    text: 'character advancement - characters level from level 0 to level 1 after the first session . - at the end of each session, each player checks the xp triggers for their character and gains xp if the',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'trigger was fulfilled. - at certain level ups, characters gain +1 ability point (ap). this ability point can be spent to gain a new',
    reason: 'Session-end XP-award trigger table: award INPUTS to the bar procedure, not bar/bank semantics; no automation claimed by this scope.',
  },
  {
    text: 'ability, or unlock one of the two talents for an existing ability. talents are mutually exclusive. - at level 1 and every level afterwards, characters gain +1 ap when they hit 7 xp and go into a camp, enter',
    reason: 'Summary bullets: AP-spending/talent choice is player-choice workflow; the operative breakpoint sentences are quoted verbatim in icon-1.5:advancement:xp-bar-bank.',
  },
  {
    text: 'an interlude, or at the end of a session. - when a character hits 15 xp, they clear their xp bar and accumulate a level up, which can be spent at',
    reason: 'Line merges the breakpoint-sentence tail (quoted verbatim in icon-1.5:advancement:xp-bar-bank) with the next summary bullet.',
  },
  {
    text: 'level 0. 1 1 gain +2 ap and unlock limit break gain a bond power and improve an action 2 1 gain your first relic gain a bond power and improve an action 3 1 gain a mastery point gain a bond power 4 1 choose a second job and gain +2ap',
    reason: 'Character-advancement table rows above level 0/1 and narrative benefits: future scope; only the level-1 combat row is claimed here and is quoted via icon-1.5:advancement:limit-break-unlock-level.',
  },
  {
    text: 'point. improve two actions or gain a bond power 5 2 gain +1ap improve an action 6 2 get your second relic gain a bond power 7 2 gain a mastery point improve an action 8 2 choose a third job and gain +2ap or',
    reason: 'Character-advancement table rows above level 0/1 and narrative benefits: future scope; only the level-1 combat row is claimed here and is quoted via icon-1.5:advancement:limit-break-unlock-level.',
  },
  {
    text: 'point. improve two actions or gain a bond power 9 3 get your third relic gain a bond power 10 3 gain a mastery point improve an action 11 3 gain +1ap improve an action 12 3 gain a mastery point gain a bond power',
    reason: 'Character-advancement table rows above level 0/1 and narrative benefits: future scope; only the level-1 combat row is claimed here and is quoted via icon-1.5:advancement:limit-break-unlock-level.',
  },

  // -------------------------------------------------------------------------
  // Exhaustive-page accounting (third hardening pass): with the selection
  // filter removed, EVERY line on pp.44/99/112/115/240/241 must be accounted.
  // Entries below cover the remaining non-selected lines, categorized per
  // subsystem. Each still matches exactly one canonical clause.
  // -------------------------------------------------------------------------

  // --- p.44 session-end procedure framing ----------------------------------
  {
    text: 'session end whenever you end a session of icon, go',
    reason: 'Session-end section heading and table-flow framing: session scene flow is intentionally not automated.',
  },
  {
    text: 'not. these triggers are on pg. xx but are repeated',
    reason: 'XP-trigger cross-reference prose: award INPUTS to the bar procedure, not bar/bank semantics.',
  },
  {
    text: 'here for your convenience: check at the end of a session : 1. did you fulfill at least one of your ideals? 1',
    reason: 'XP-trigger checklist: award INPUTS to the bar procedure, not bar/bank semantics.',
  },
  {
    text: 'any dust they have unlocking additional features',
    reason: 'Dust spending (camp/relic subsystem): outside the advancement-arithmetic scope.',
  },
  {
    text: 'for their camp, or infusing them into their relics.',
    reason: 'Dust spending (camp/relic subsystem): outside the advancement-arithmetic scope.',
  },

  // --- p.99 resolve economy / limit-break usage ----------------------------
  {
    text: 'resolve and limit',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'break limit breaks are the most powerful abilities in',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: '2. limit breaks are special abilities (with an action',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'cost, etc) that do not count against the max',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'number of abilities taken. all limit breaks depend',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'on a unique resource, called resolve , to use, and',
    reason: 'Resolve economy and limit-break USAGE rules (pools, once-per-combat, spending): outside this unlock-boundary scope.',
  },
  {
    text: 'combat unless specified. resolve is split into two pools, party and personal resolve. • party resolve goes up by 1 at the start of each',
    reason: 'Resolve pool mechanics: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'round in combat, and depletes to 0 after combat',
    reason: 'Resolve pool mechanics: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'ends. you can use a die to track it. • personal resolve is gained the following ways: • all characters gain 1 personal resolve after',
    reason: 'Resolve pool mechanics: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'personal resolve to another character who has',
    reason: 'Resolve pool mechanics: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'resting in order to get the most out of your',
    reason: 'Resolve pool mechanics: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'you can use any combination of party or',
    reason: 'Resolve spending rules: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'personal resolve, but party resolve is shared',
    reason: 'Resolve spending rules: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'between all members of the group, so any use of',
    reason: 'Resolve spending rules: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'it must be used with the consent of your your',
    reason: 'Resolve spending rules: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'team members . resolve is always spent at the',
    reason: 'Resolve spending rules: separate resource subsystem, not advancement arithmetic.',
  },
  {
    text: 'beginning of the action.',
    reason: 'Resolve spending rules: separate resource subsystem, not advancement arithmetic.',
  },

  // --- p.112 job selection / AP-spending choices / ability limits -----------
  {
    text: 'choosing your job to make the tactical combat part of your character',
    reason: 'Level-0 job/ability selection guidance: player-choice workflow of a separate character-construction subsystem.',
  },
  {
    text: 'at level 0, pick a job and two abilities from your',
    reason: 'Level-0 job/ability selection guidance: player-choice workflow of a separate character-construction subsystem.',
  },
  {
    text: "job. you get all the traits or actions from your class (basically a meta-job, of which there are 4),",
    reason: 'Class/job structure description: separate character-construction subsystem.',
  },
  {
    text: "plus the traits from your job itself. if you're unsure about which abilities to pick, pick",
    reason: 'Ability-selection advice prose: player-choice workflow, not runtime semantics.',
  },
  {
    text: "the first two abilities listed, you'll have plenty of",
    reason: 'Ability-selection advice prose: player-choice workflow, not runtime semantics.',
  },
  {
    text: 'to choose new abilities, or unlock the talents of',
    reason: 'Line merges the improvement-sentence tail with AP-spending choice workflow; the operative breakpoint sentences are quoted verbatim in icon-1.5:advancement:xp-bar-bank.',
  },
  {
    text: 'an ability point. you can use this point during a camp, interlude, or at the end of any',
    reason: 'AP-spending/talent choice is player-choice workflow; the operative breakpoint sentences are quoted verbatim in icon-1.5:advancement:xp-bar-bank.',
  },
  {
    text: 'session to gain a new ability from one of your jobs or unlock a talent for an existing ability,',
    reason: 'AP-spending/talent choice is player-choice workflow; the operative breakpoint sentences are quoted verbatim in icon-1.5:advancement:xp-bar-bank.',
  },
  {
    text: 'choosing either the first or second choice. at other levels you will also gain additional bonus',
    reason: 'Talent mutual exclusivity choice and higher-level bonus AP: future scope beyond the level-0/1 boundary rows claimed here.',
  },
  {
    text: 'ability points, which can be spent along the way. at level 4 and 8 you will get the opportunity to',
    reason: 'Higher-level bonus AP and new-job opportunity: future scope beyond the boundary rows claimed here.',
  },
  {
    text: 'same job and get an extra mastery. you can',
    reason: 'New-job/mastery alternative choice: player-choice workflow intentionally not automated by this scope.',
  },
  {
    text: 'choose to train broadly or deeply - choose wisely! ability limits you can only take at most 6 abilities into any',
    reason: 'Mastery training choice plus ABILITY LIMITS (expedition deck-building constraint): separate loadout subsystem.',
  },
  {
    text: 'expedition, though you can change these out every',
    reason: 'ABILITY LIMITS (expedition deck-building constraint): separate loadout subsystem.',
  },
  {
    text: 'expedition. at least half these abilities must be the',
    reason: 'ABILITY LIMITS (expedition deck-building constraint): separate loadout subsystem.',
  },
  {
    text: 'same class (color) as your job. traits and limit breaks your traits are unique passive or active abilities',
    reason: 'ABILITY LIMITS plus trait-ownership rule: separate loadout/job subsystems.',
  },
  {
    text: 'that you get from both your job and class . your',
    reason: 'Trait ownership description: separate job/class subsystem.',
  },
  {
    text: 'job only, so think carefully when selecting your',
    reason: 'Trait ownership advice: separate job/class subsystem.',
  },
  {
    text: 'jobs.',
    reason: 'Trait ownership advice: separate job/class subsystem.',
  },

  // --- p.240 narrative/pacing/onboarding ------------------------------------
  {
    text: 'advancement the power of characters in icon is measured by',
    reason: 'Section heading and descriptive framing; the operative procedure sentences are quoted verbatim in icon-1.5:advancement:xp-bar-bank.',
  },
  {
    text: 'level 0 for the first session only. this is to let',
    reason: 'First-session onboarding guidance: expedition/session scene flow intentionally not automated (roadmap F10).',
  },
  {
    text: 'players familiarize themselves with the system in',
    reason: 'First-session onboarding guidance: expedition/session scene flow intentionally not automated (roadmap F10).',
  },
  {
    text: 'relics, only 2 combat abilities and 1 narrative',
    reason: 'First-session starting-loadout limits: separate character-construction subsystem.',
  },
  {
    text: "power). it's perfectly possible to start a game at",
    reason: 'Optional start-at-level guidance: campaign setup policy, not runtime semantics.',
  },
  {
    text: "level 1 or later if you so choose. if you're playing with the level 0 rule, it's not",
    reason: 'Optional start-at-level guidance: campaign setup policy, not runtime semantics.',
  },
  {
    text: "it's good practice. after the first session, all",
    reason: 'First-session onboarding guidance: scene flow intentionally not automated (roadmap F10).',
  },
  {
    text: '(1-4, 5-8, 9-12). moving up a chapter is a group',
    reason: 'Chapter banding and group progression decision: campaign pacing policy; the cap VALUE enters spending as game state (contract row covers the p.44 cap sentence).',
  },
  {
    text: 'decision and represents a different scale of',
    reason: 'Chapter banding and group progression decision: campaign pacing policy.',
  },
  {
    text: 'power, scale, influence, and danger for',
    reason: 'Chapter banding and group progression decision: campaign pacing policy.',
  },
  {
    text: 'characters . certain abilities cannot be gained until later',
    reason: 'Chapter gating of abilities/foes: future availability-gate scope; the durable unlock boundary claimed here is Limit Break (adjudicated level 1).',
  },
  {
    text: 'chapters, and certain foes are powerful and are',
    reason: 'Chapter gating of abilities/foes: future availability-gate scope.',
  },
  {
    text: 'generally not encountered until later chapters. until the chapter passes, characters cannot level',
    reason: 'Chapter gating of leveling: the cap VALUE enters spending as game state; group-pacing prose itself is not automated here.',
  },
  {
    text: 'up past the cap of each chapter, and characters',
    reason: 'Chapter gating of leveling: cap VALUE enters spending as game state; pacing prose not automated here.',
  },
  {
    text: 'any character . this is to allow characters to',
    reason: 'Group XP donation for catch-up: group-session policy, not individual advancement mechanics.',
  },
  {
    text: "catch up on experience if they're behind, invest",
    reason: 'Group XP donation / dust investment policy: not individual advancement mechanics.',
  },
  {
    text: 'dust they have earned, and also allows them to set',
    reason: 'Pacing-policy prose: not individual advancement mechanics.',
  },
  {
    text: 'the pace of the game, since foes become slightly',
    reason: 'Pacing-policy prose: not individual advancement mechanics.',
  },
  {
    text: 'more complicated in higher chapters of the game. experience during their adventures, characters earn',
    reason: 'Line merges chapter-pacing prose with the opening of the XP-bar procedure sentence quoted verbatim in icon-1.5:advancement:xp-bar-bank; the pacing half is not runtime semantics.',
  },
  {
    text: '(6 for expedition, 1 per expedition for a quest) check at the end of a session : 1. did you fulfill at least one of your ideals? 1',
    reason: 'XP-trigger checklist (award INPUTS): trigger-table inputs, not bar/bank semantics.',
  },
  {
    text: "level 8. if you don't choose a new job, you can gain",
    reason: 'New-job/mastery alternative at level 8: player-choice workflow intentionally not automated by this scope.',
  },
  {
    text: 'tracks in low chapters) but it will mean characters',
    reason: 'Explicitly optional variant rules ("Alternate XP"): intentionally not automated.',
  },
  {
    text: 'will take a while to fill out their abilities.',
    reason: 'Explicitly optional variant rules ("Alternate XP"): intentionally not automated.',
  },

  // --- p.241 advancement table ----------------------------------------------
  {
    text: "characters can't level higher than the chapter the game is currently in. lvl chapter combat benefit narrative benefit 0 1 choose a job and two abilities. choose a culture and kin type. then choose",
    reason: 'Chapter-cap restatement plus advancement-table header/level-0 row: the cap VALUE enters spending as game state; table rows below are future scope.',
  },
  {
    text: 'a bond and gets 2 dots in a specific action, a',
    reason: 'Level-0 narrative-benefit table (Bond/culture/kin construction): separate character-construction subsystem.',
  },
  {
    text: 'bond power, then gain 4 extra dots to',
    reason: 'Level-0 narrative-benefit table (Bond construction): separate character-construction subsystem.',
  },
  {
    text: 'improve actions. none can be taken past 3 at',
    reason: 'Level-0 narrative-benefit table (action-dot limits): separate character-construction subsystem.',
  },
  {
    // Repeated occurrences have DISTINCT identities: this entry explicitly
    // covers BOTH identical occurrences of this table fragment on p.241.
    text: 'or the same job and gain a mastery',
    occurrences: 'all',
    reason: 'Advancement-table row fragments (levels 4/8 new-job/mastery alternative, two identical lines): player-choice workflow intentionally not automated by this scope.',
  },
  {
    text: 'the same job and gain a mastery',
    occurrences: 'all',
    reason: 'Advancement-table row fragment (merged-line tail where the leading "or" ended the previous extraction line): same player-choice workflow as the sibling fragment above.',
  },
];

/**
 * Explicit FRONTIER COVERAGE claims: each entry names the curated obligation
 * whose VERIFIED passages semantically account for the matched frontier
 * clause(s). Containment alone is provenance, never coverage — these entries
 * ARE the per-clause coverage decision, mechanically re-verified against the
 * canonical corpus on every audit run (an entry whose text stops matching a
 * clause, or whose obligation does not actually quote it, is an integrity
 * violation).
 */
export const ADVANCEMENT_ATTRIBUTED_CLAUSES: readonly { text: string; obligationId: string }[] = [
  // --- icon-1.5:advancement:xp-bar-bank (pp.44/240/241 procedure) -----------
  { text: 'experience points, filling out an experience bar. at', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'certain breakpoints in the bar, they will unlock', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'new abilities or talents. the xp bar is 15 ticks long. at 7 xp gained, during', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'an interlude, at the end of a session or at', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'camp characters can gain +1 ap, and spend it to unlock a new combat ability in any job they', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'have, or gain a new talent for an ability they', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'already have. this only triggers once per level. once the bar is full (15 xp), a character can clear', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'all xp and mark a level up . at the end of an', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'interlude or session, they may cash in that level up', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'the end of a interlude (a downtime period) or at the end of a session to level up their character.', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'to increase their level by 1. certain benefits are', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'a level up banked at the end of a session can', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'increase their level by 1, but no higher than the', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  { text: 'current chapter number. a character can only', obligationId: 'icon-1.5:advancement:xp-bar-bank' },
  // --- icon-1.5:advancement:mid-level-ap-boundary (conflicted p.44 reading) --
  { text: "xp, they can unlock an ability or talent at the end", obligationId: 'icon-1.5:advancement:mid-level-ap-boundary' },
  { text: "of that session or during a camp or interlude. if a character's xp bar is full (15 xp), they can clear", obligationId: 'icon-1.5:advancement:mid-level-ap-boundary' },
];
