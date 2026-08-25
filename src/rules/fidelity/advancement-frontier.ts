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

export const ADVANCEMENT_IRRELEVANT_CLAUSES: readonly { text: string; reason: string }[] = [
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
];
