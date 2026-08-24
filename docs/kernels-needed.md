# Kernels needed for full automation coverage

Reference ledger of the shared engine kernels that must exist before the
`documented` / table-facing content rows in **Job**, **foe**, **advancement**,
and **Relic** automation can promote to `wired`. This is a planning document,
not a coverage claim — `npm run audit:automation`, the phase gates, and the
source fixtures remain the only authority for "done".

**Authority:** [`rules-foundations.md`](rules-foundations.md) is the primary
source-ontology-first map (combat ontology → primitive/kernel → consumer
matrices → dependency graph → build order → `FOUNDATION_COMPLETE` gate). This
file is its kernel-level build ledger; `primitives-needed.md` is the primitive-
level ledger. Both defer to `rules-foundations.md` for ordering and status.

A **kernel** is a shared, framework-free engine mechanic (pure function,
recipe registry, or reducer seam) that content rows plug into instead of
getting their own per-content resolver. A content row promotes only when its
kernel exists and it has a durable record, a closed source-ID manifest, and a
deterministic replay fixture — the same five foundation requirements the F6
job-trait and F7 talent slices already ship.

**Status recap.** Foundations F0–F5 are executed (damage ledger, spatial
gateway, save window, turn lifecycle, trigger windows, passive projection +
role baselines). Wired slices: 27/65 Job traits (incl. the F9 once-per-round
reactive fold row Dash on the Rocks, Shieldmaster's aura + turn-end
membership recipe, and Trigrammaton's exactly-range-3 attack-path row),
43/288 talents executable (30 fold-wired + 5 program-level — Demon Cutter
t2's pre-ability rush, Draken Cross t2's charged medium blasts, Pyre t1's
comeback ally immunity, Divine Aegis t2's quarter-HP defiance, and Eye of
the Storm t2's area-count damage; 3 aura passive-projection rows — Rook t1,
Dervish t1, Gentleness t1; 4 range-modifier rows — Valkyrie t1, Incubus t1,
Harvest t2, Open the Gates t2; and 1 area-modifier row — Soul Shot t2 —
see docs/condition-grant-handoff.md for the re-audit and the MiMo harvest
boundary), 22 foe ability recipes,
36 foe movement-trait IDs, the p.298 role baselines. The audit backlog that
the kernels below unblock:

| Kind | Units | Kind | Units |
| --- | ---: | --- | ---: |
| core | 70 | relic-rank | 120 |
| class-trait | 7 | relic-aspect | 40 |
| job-trait | 38 | foe-ability | 1,247 |
| talent | 245 | foe-trait | 590 |
| mastery | 136 | foe-phase | 19 |
| limit-break | 16 | foe-chapter-rule | 116 |
| trophy | 68 | camp-fixture | 16 |
| camp-feature | 85 | reward-rule | 9 |
| bond-power (narrative) | 120 | | |

## 1. Job kernels

### 1.1 Job traits — 38 documented rows in `JOB_TRAIT_RECIPES`

| Kernel | Consumers (exact trait ids) | Prerequisite |
| --- | --- | --- |
| **Heroics economy** — make-any-ability-Heroic choice, no-attack/no-Heroics lockout, half-damage-until-next-turn penalty, +1 shove/movement distance | `bastion:trait:strive`, `demon-slayer:trait:demon-strength`, `knave:trait:spite`, `colossus:trait:wolfheart` (sacrifice-25%-to-Heroic) | F0, F3 (lockout boundary) |
| **Attack-path modifier gates** — extend the shared `kernels/attack-modifiers.ts` fold with distance / round / terrain / stealth reads | distance: `freelancer:trait:trigrammaton` (exactly range 3), `geomancer:trait:resonance` (exactly range 3); round: `freelancer:trait:aether-shot` (rounds 3/6); terrain: `shade:trait:underworld`, `stormbender:trait:sea-legs`; stealth: `warden:trait:ambush-master` | F6 kernel exists; extend the `traitAttackModifier` read surface |
| **Comeback-gated threshold hook** — critical/exceed thresholds conditioned on the user's HP (18+/13+, 15+/10+ at 1 hp) | `enochian:trait:soulfire` | F0, attack-path kernel |
| **Attack-miss reactive window** | `fool:trait:cheap-trick` | F4 (new trigger) |
| **Attack-completion hook** — attacks bless adjacent allies + 2 vigor | `sealer:trait:mantra-of-sealing` | F0, F4 |
| **Slay-trigger cure hook** | `harvester:trait:balance` | F7 fold exists (slay); extend to cure |
| **Once-a-round reactive windows** — the round-ledger + reactive job-trait
  fold is **DONE** (F9, `kernels/trait-reactions.ts`, wired row Dash on the
  Rocks p.230). Remaining reactive rows need extra seams: shove→rush (Press
  the Advantage needs the ally-choice-input seam), finishing-blow/slay→
  stacked die (Stack Dice needs the gamble/die-state seam), combo
  gain/spend→fly+Bless (Divine Grace needs the ally-choice seam) | `bastion:trait:press-the-advantage`, `fool:trait:stack-dice`, `chanter:trait:divine-grace` | F9 fold exists; per-row choice-input / gamble seams
| **Ability-use choice fold (F10)** — pre-resolution optional source-backed choices: find eligible allied owner, validate spend, emit resource-spend mutations, feed boons/bonus damage/pierce/forced-triggers into the one resolution | `harvester:trait:blessing-of-rebirth` ✅ wired, `sealer:trait:blessing-of-war` ✅ wired | `kernels/ability-use-choices.ts` + `content/jobs/ability-use-choice-recipes.ts`; permanent seam, still reusable for combo/faith |
| **Ability-use combo-spend hook** — spend a combo token to activate charge effects | `chanter:trait:songweave` | resource registry exists; ability-use spend seam |
| **Infuse-cost kernel hook** — cost reduction with a foe in range 2, infuse-as-slay | `spellblade:trait:conqueror-s-edge` | F0, Infuse cost seam |
| **Use ledger** — once-per-combat use + spend-2-Aether regain | `spellblade:trait:aether-deflection` (also needs the `targeted-by-ability` window, F4) | F3/F4 |
| **Movement-vacate hook** — drop an object on first vacating a space | `shade:trait:darkside` (shadow), `geomancer:trait:stone-double` (height-1 statue) | F1 |
| **Occupancy-cost rule** — phase through characters and end a movement in a space for 1 movement | `fool:trait:tumbling` | F1 (movement planner) |
| **Movement-planner elevation hook** — flying for a movement that ends lower | `colossus:trait:great-leap` | F1 |
| **Fly-ability hook** — first fly ability per round lets allies fly 1 | `chanter:trait:uplift` | F1, F3 |
| **Entity-position mutation** — swap with a shadow in range 3 | `shade:trait:meld` | F1, entity model |
| **Teleport-all-marked position choice** | `freelancer:trait:astral-binding` (with the mark-stack gate) | F1 |
| **Spatial-aura mechanic** — distance-based grants/penalties with activation and size changes | `bastion:trait:shieldmaster` (aura 1 + sturdy-until-turn-start), `stormbender:trait:pelagic-rage` (round-5 aura 2) | F1, F3, new aura registry |
| **Stance-entry gate** — permit a second stance only for this trait | `knave:trait:martial-master` | stance model |
| **Mark-stack gate + summon-damage modifier** | `freelancer:trait:astral-binding`, `harvester:trait:gardener-of-kin` | mark model |
| **Area-inclusion ally hook** — allies immune to your area effects, gain 2 vigor + a Blessing | `seer:trait:karma` | F4 (area-inclusion exists for Perseus; generalize) |
| **13-card deck bookkeeping** — draw/discard/shuffle across combats (narrative) | `seer:trait:the-wheel-of-fate`, `seer:trait:skein`, `seer:trait:foretell`, `seer:trait:bend-fate` (bend-fate also needs the gamble hook) | may stay table-facing by design |

### 1.2 Talents — 245 documented rows in `TALENT_RECIPES`

The closed classifier in `content/jobs/talent-recipes.ts` (`documentedTalentDetail`)
enumerates the exact kernel families; a talent promotes when its family's
kernel lands (exactly as the wired slay/collide tranche did):

- **finishing-blow trigger** — wired (fires against a bloodied target, the
  `deriveTriggers` rule, with per-row eligibility extensions — Party Favor
  t2). Remaining rows name their blockers: Death Blossom t1 needs the
  teleport destinations (player choices the command/protocol surface must
  carry); Stampede t1 needs a may-choice mark redirect across commands.
- **charge trigger** — slow-turn state already derives; the fold's `always`
  trigger covers unconditional augmentations whose magnitude reads the
  charged state (Dropkick t2). Two ability-behavior variants are now
  implemented **program-level**, both reading the equipped choice through
  the projected `talents` surface (`context.state.actors[id].talents
  [abilityId]`, populated by `encounterRuleState`) and gated on the talent
  (never on the charge trigger alone): Demon Cutter t2 ("Your can rush 1
  before using Demon Cutter. Charge: Rush 3 instead.") — the resolver emits
  the pre-ability rush before the attack mutations — and Draken Cross t2
  ("Charge: Increase range to 5, and all areas may be increased to medium
  blasts instead.") — on a slow turn both blasts become medium (radius 2)
  with the second-blast search extended to range 5 (the attack target stays
  capped by the generic USE_ABILITY range gate). The rest of the family
  ("Large blast", range boosts) belongs in the ability programs' charge
  clauses, the way the Chanter programs already implement them
  (`context.triggers?.has('charge')`), not the fold.
- **comeback extras** — the first program-level comeback clause is now
  implemented: Pyre t1 ("Comeback: Allies are immune to damage from this
  ability.") — the Pyre resolver reads the equipped choice and, while
  bloodied, skips allies in the blast fray and the comeback/exceed
  re-explosion. The remaining rows are modifiers (range, bonus damage,
  interrupt cost, ally immunity) whose home is the ability programs'
  comeback clauses; the fold's comeback trigger covers the grant-type rows
  (Riposte t2).
- **pre/post-ability movement** — rush-before / fly-after / dash movement
  shift hooks (F1); Demon Cutter t2's rush-before landed program-level
  above, the rest of the family still needs the hook.
- **Heroics / sacrifice economies** — the same kernels as §1.1.
- **blessing / combo spend** — the same ability-use spend seams as §1.1.
- **aura / stance / summon-entity / terrain / cover / range / shove /
  teleport modifier hooks** — the shared families in §5.
- **cure, condition-grant, bloodied gates, mark triggers** — extensions of
  existing kernels.
- **ability-specific modifier hooks** — a typed resolver for that ability.

### 1.3 Masteries — 137 units

The typed mastery-attachment mechanism is **DONE** (F8,
`kernels/mastery.ts`): `EncounterActor.masteredAbilityIds` is the durable
ownership record, a reviewed `MasteryRecipe` declares one of four attachment
kinds (fold / program-level / continuous projection / lifecycle) gated on the
shared `hasMastery(actor, abilityId)`, and the compiler audits an implemented
mastery complete. 7 of the former 144 units are now executable (Rook
Implacable Fortress, Dark Knight Infectious Hatred, Intimidate Iron Skull,
Bleak Mercy Painkiller, Warding Bolts Phantom Bolts, Gentleness Gentle
Prayer, Rampant Nail Voracious Nail). The 137 remaining units need their
**effect** overrides, not the attachment: families:

- **Round-gated timing** — ability becomes a free action / upgrades at round 4+
  (`bastion:valiant:mastery`, `bastion:endless-battlement:mastery`). F3.
- **Interrupt-rank upgrades** — Interrupt 1→2→3 (`bastion:catapult:mastery`,
  `bastion:endless-battlement:mastery`). F4.
- **Extra-trigger / repeat upgrades** — "+1 more time", once-a-turn reuse
  (`bastion:heracule:mastery`, `bastion:battering-ram:mastery`). F0/F4.
- **Value / terrain / damage overrides** — "deals 4 instead of 2", "creates a
  boulder before resolving" (`bastion:land-waster:mastery`). F0/F1.
- **Loadout gate** — mastery acquisition/equip validation already validates;
  the combat halves need the overrides above.

### 1.4 Limit Breaks — 16 units

A **resolve-spend + action-timing kernel** (`limit-break-recipes.ts`):
party/personal resolve split (spent at the beginning of the action, p.99),
the 1-action/2-action cost, end-turn and Delay variants (e.g.
`demon-slayer:limit-break` Split Heaven and Hell), and the Ultimate repeat
rule. Prerequisites F0 (damage ledgers for the resolve-cost effects) and F3
(delay/end-turn lifecycle rows already exist).

### 1.5 Job summon action suites — 6 `job-summon-rule` units

Placement ranges, ownership, the six-per-type entity cap, and survival of the
owner's defeat are wired (`content/jobs/summon-recipes.ts`, `state.companion`). Remaining:

- **Summon-trigger windows + entity action resolution** — the companions'
  own suites: seraph lash-out (Bound Spirit), great beast dash-2-bite/shove
  (Beast Master), selkie end-of-turn fly-3 (Selkie), plus the Fool bomb,
  Shade shadow/shadow-cloud, Warden beast, Harvester thrall/plant, Seer wild
  card, and Stormbender Salt Sprite placement/action suites. F1 (entity
  placement) + F3 (end-of-turn triggers) + F4 (summon windows).

## 2. Foe kernels

### 2.1 Foe traits — 590 remaining units (`content/foes/trait-recipes.ts` / `kernels/passive-projection.ts`)

The 79 fully-executable keyword rows (F5: the closed `content/foes/trait-recipes.ts`
manifest — conditions, durable Defiance, Size/Armor/Speed stats, role baselines)
plus the p.298 role baselines are wired; 36 partial rows project their wired
keywords while their Counter/Diaga/Size-footprint clause stays pending.
Everything else projects nothing. Keyword census of the full corpus (691
source units = 590 unresolved + 101 wired): immune 22, aura 42, bloodied 35,
end-of-turn 28, start-of-turn 24, start-of-round 18, resistant 18, round-gated
12, counter 10, 25%-hp 10, sacrifice 9, when-damaged 1. Kernel families:

| Kernel | Consumers (examples) | Prerequisite |
| --- | --- | --- |
| **Whole-combat condition grants** — Sturdy, Defiance, Dodge, Regeneration, Flying, Phasing, Skirmisher, Aetherwall, Slip, Rampart, Immobile as closed-ID passive rows | **DONE** — the F5 keyword kernel (`kernels/foe-trait-recipes.ts` + `content/foes/trait-recipes.ts`) wired 79 rows; Defiance is a durable combat-start grant, the rest are projections. Remaining: Counter-only rows | Counter needs a durable "damaged by an ability" damage window (F4 provenance) |
| **Conditional passive gates** — bloodied, 25%-hp, terrain, stealth, status-gated, adjacency-gated | `basic:berserker:301:trait:enrage` (+1 action while bloodied), `basic:seismatist:305:trait:earth-bond` (resistance adjacent to object/pit), `basic:hunter:302:trait:wayfinding` (evasion in difficult/dangerous), `basic:assassin:302:trait:nimble` (evasion unless suffering a status), `basic:knuckle:301:trait:heavy-armor` (resistance from adjacent) | F5, condition-set gates |
| **Aura passives** — distance-based ally/foe effects | `basic:commander:304:trait:commander-s-aura` (+1 boon), `basic:abjurer:304:trait:aura-of-shielding` (dodge) | aura kernel (§5) |
| **Per-status immunity** | 22 immunity traits | condition/status immunity provenance |
| **When-defeated / when-damaged triggers** | `basic:saint:305:trait:martyrdom` (cure allies when defeated) | F4 |
| **Resistance provenance** in the damage kernel — positional/conditional resistance | 18 traits (`basic:sledge:301:trait:bullheaded`, `earth-bond`, `heavy-armor`) | F0 (narrow typed flags, like `bypassVigor`/`ignoreArmor`/`ignoreDefiance`) |
| **Counter-granting traits** | 10 traits | F4 (Counter's "damaged by an ability" trigger) |

### 2.2 Foe abilities — 1,247 remaining (`FOE_ABILITY_RECIPES`)

Twenty-two recipes are wired as declarative data (primitives: attack, shove,
rush, dash-strike, blast, terrain, mark, swap, vigor, end-turn-stealth). The
remaining catalog needs these recipe primitives before it converts to data
rows:

- teleport / place / remove-position movement,
- summon entity + entity actions,
- delayed / held effects and end-turn sequences,
- save effects (`effect`-kind SaveWindows),
- gamble rolls,
- aura creation,
- movement-entry triggers (Party Favor-style) — **the voluntary-MOVE seam is
  wired** (`kernels/movement-triggers.ts`, Party Favor p.151 exemplar); the
  remaining bubble/mote/terrain-entry effects still need content rows, and
  forced-movement entry is a future fold,
- reactive when-damaged / defeated windows for foes,
- pierce / divine / multi-instance damage variants,
- "free action after X" multi-step sequences (Soldier Valiant's free Bash),
- **mob member state** — member-level HP/positions, "up to three members"
  sequencing, area targeting of mobs (blocked until the mob model exists).

### 2.3 Foe phases — 19 units

A **phase-recipe kernel** on the F3 lifecycle: round-start cycling
(Nocturnal I→II→III→I), bloodied-triggered transitions (`relict:i-vessel-knight:336:phase:phase-ii` — intangible on bloodied; `demon:limb-demon:417:phase:phases`), destroyed-section transitions (`imperial:veridian-weapon:401:phase:phases` — megabomb counter), and round-action rotations (`relict:iii-dread-lords:341:phase:phases`). Prerequisite F3 (round-start/turn-start gates + `round` reads exist).

### 2.4 Foe chapter rules — 116 units

**Chapter-gated recipe overrides**: availability gates ("Available from
Chapter 1/2/3") and per-chapter ability rewrites (`relict:executioner:326:chapter:2:1` — Death March becomes free when bloodied; `relict:heliolite:326:chapter:3:1` — deals fray instead; `relict:embalmer:327:chapter:2:1` — creates a grasping-dead terrain). Prerequisites F0–F5 as needed, applied as override rows on the ability recipes.

### 2.5 Foe roles and mobs

The p.298 baselines are executed (skirmisher dodge, artillery slip +
aetherwall, heavy rampart, Heavy Guard armor, Legend Juggernaut clear).
Remaining: the **mob member model** (member-level state) and any role halves
not covered by the six p.298 rows — role labels must never map beyond them.

## 3. Advancement kernels

### 3.1 Trophies — 68 units

`trophy-recipes.ts` rows by trigger family:

- **Uses** — "as 2 actions / free action / round action at the start of any
  round" commands (`relict:i-vessel-knight:336:trophy:helm-of-command`). F3.
- **Combat passives** — attack modifiers (Darklight Infuser's "attacks gain
  slay: cure yourself"), aura grants (`soul-fragment:339:trophy:the-black-book` —
  aura 2 + end-of-turn effect). F0/F4, aura kernel.
- **Expedition effects** — persistent buffs and recorded rolls
  (`soul-fragment:339:trophy:golden-mask` — d20/d10/d8/d6/d4 recording). F2/F3.

### 3.2 Camp fixtures — 16 fixtures + 85 features

A **camp-boundary kernel** (F3 camp boundary + F2): purchase/upgrade Dust
costs, gear swaps, healing, and mechanical features (`camp:aetherpearls`
networks, `camp:aethervault` dust storage, telepathic features). Narrative
features stay table-facing.

### 3.3 Reward rules — 9 units

A deterministic **reward-application kernel**: expedition XP + Dust
(`expedition-reward`), combat-dust Relic infusion (`combat-dust`), dust-cap
enforcement (`dust-cap`). Mostly bookkeeping; the deterministic reward
application is the only mechanic.

### 3.4 Bonds — 120 powers

Explicitly **stay narrative / table-facing** (Effort/Strain resources are
modeled, p.56; power outcomes are free-form). This is a boundary decision,
not a kernel — do not fabricate combat outcomes from bond prose.

### 3.5 Advancement bookkeeping

Levels, XP/AP, chapter boundaries, Job slots, Relic slots, talents, and
mastery loadouts validate; Refocus (p.113) and Relic infusion/aspect
transitions (p.245) already run as dedicated validated engine functions. The
missing halves are the combat/expedition kernels above, not more validation.

## 4. Relic kernels

### 4.1 Relic ranks — 120 units

- **Invoke kernel** (`relic-recipes.ts`): invoke = cost + effects. Families
  in the corpus: attack-tagged invokes with a trigger threshold
  (`relic:ape-god:rank:1` — "Invoke (Attack, 17+)"), when-condition invokes
  (`relic:ape-god:rank:3` — when you stun), free-action gambits
  (`relic:crimson-king:rank:3` — "Gambit: Free Action: Sacrifice 4, deal 4
  damage in range 4"). Prerequisites F0–F3.
- **Rank passive kernels**: per-status immunity (`ape-god:rank:2` — immune to
  stun), **wound-taking hook** (`crimson-king:rank:2` — d6 wound gamble with
  improvement), **sacrifice-cost override hook** (`crimson-king:rank:1/3` —
  costs reduce to sacrifice 2 or 1), stun-spread triggers (`ape-god:rank:3`),
  HP-gated passives (`crimson-king:rank:1` — 25% hp or lower). F5 + new
  wound/sacrifice seams.

### 4.2 Relic aspects — 40 units

- **Invoke augmentation** — bonus damage, extra shoves, self-shoves on a
  successful invoke (`relic:ape-god:aspect`). F0.
- **Damage-type / provenance overrides** — Counter becomes piercing
  (`relic:maiden:aspect`); needs a counter damage-type override (F4).
- **Movement exceptions** — diagonal shoves that must move further away
  (`relic:erys:aspect`). F1.
- **Condition grants on hooks** — defiance when rescued (`relic:orpheo:aspect`);
  needs a rescue hook (F3). Cost overrides mirror §4.1.
- Aspect passives are F5 recipes; the invocation halves ride the invoke
  kernel.

## 5. The shared kernel families

Most of the sections above reduce to a small set of shared contracts. Build
each once; it converts its consumers into data + fixtures:

| # | Shared kernel | Consumers (count) | Prerequisite |
| --- | --- | --- | --- |
| 1 | **Aura mechanic** — spatial distance-based grants/penalties, activation, size changes | 2 job traits + 42 foe traits + trophies + Perseus/Rook/Dervish abilities | F1 |

> **Status (landed):** the generic Aura kernel (`kernels/aura.ts`, F10 in
> rules-foundations.md) now answers membership and ephemeral projection for
> any source aura through a reviewed `AuraDefinition` row. Rows wired:
> Commander's Aura (p.304), Aura of Shielding (p.304), Rook t1, Dervish t1,
> Gentleness base + t1, Shieldmaster turn-end, Bleak Mercy combo. Still
> unresolved by design: the ability-user-presence gate over an ally-carried
> aura (Endless Battlement t1/t2), entity members/consumption (Nightmare t2),
> and attack-triggered token/resource grants (Mantra of Sealing) — see the
> blocker census.
| 2 | **Attack-path modifier gates** — distance/round/terrain/stealth/threshold reads on the existing fold | 7 job traits + ~30 talents | F6 kernel exists |
| 3 | **Conditional passive projection** — bloodied/25%/terrain/stealth/status/round gates | ~150 foe traits + relic ranks | F5 exists |

> **Status (partial):** the bloodied and at-or-under-25% gates are now generic
> authority (`kernels/hp-threshold.ts`, F11 in rules-foundations.md) with
> continuous condition/action projection and target-threshold attack
> modifiers. Rows wired: Rogue Slippery, Enrage ×9, True Enrage, Arkentech
> Hover Chair (inverted), Furious Berserk sturdy, Strigoi Blood Hunger,
> Divine Aegis t2. The terrain / stealth / status / round gates and the
> timed/aura-growth/bloodied-bonus-damage shapes remain.
| 4 | **Reactive trigger windows** — attack-miss, attack-completion, summon, targeted-by-ability (generalize), save-rolled, plus the **once-per-round job-trait reactive fold** (collide/shove/slay — F9 done, `kernels/trait-reactions.ts`, wired Dash on the Rocks) | 7 job traits + dozens of talents/abilities | F4 exists; **movement-entry on voluntary MOVE is done** (`kernels/movement-triggers.ts`, Party Favor p.151); F9 reactive-trait fold exists |
| 5 | ~~Spend / economy hooks~~ — **landed (F14)** — blessing, combo, sacrifice, Infuse-cost, and use-ledgers now ride `kernels/cost-payment.ts` + `kernels/use-ledger.ts` (validate → pay → durable mutation; lifecycle-reset use gates); remaining economy gaps are percentage-of-max sacrifice, per-ability spend limits, and the Heroics economy | 6 job traits + 4 talents + 3 relic ranks | resource registry + F14 kernels |
| 6 | **Movement kernels** — vacate, occupancy-cost, elevation-fly, pre/post movement, position-swap, teleport-all | 5 job traits + movement talents | F1 |
| 7 | **Lifecycle phase rows** — bloodied/round-gated phases, chapter-rule overrides | 19 foe phases + 116 chapter rules + masteries | F3 exists |
| 8 | **Stance / mark kernels** — multi-stance gate, mark-stack gate, mark-trigger effects | 3 job traits + talents | stance/mark models exist |
| 9 | **Damage-intent provenance** — resistance, wound-taking, counter-type overrides | 18 foe traits + 4 relic aspects | F0 exists |
| 10 | **Entity / summon kernel** — entity actions, entity-position mutation | 6 summon suites + Meld + objects | F1 |
| 11 | **Mob member model** | 1,247 foe abilities' mob subset | F1 + foe roles |
| 12 | **Wound-taking kernel** | Crimson King ranks + wound-gated content | F0 |
| 13 | **Trophy / camp / reward bookkeeping** — uses, expedition effects, reward application | 68 trophies + 101 camp + 9 rewards | F2/F3 |
| 14 | **Heroics economy** | 4 job traits + Heroic masteries/talents | F0/F3 |

## 6. Suggested build order

The build order is owned by [`rules-foundations.md`](rules-foundations.md)
§10 (derived from the source ontology, prioritized by dependencies × glossary
completeness × shared leverage × correctness/replay risk — not by census
immediate completions alone). For continuity, the mapping to the shared
families in §5:

1. ~~Resource-economy / spend kernel (family 5)~~ — **landed (F14)**: the
   cost-payment transaction kernel and generalized use-ledger kernel now own
   the economy vocabulary (sacrifice, blessing, combo, infuse, use-ledger);
   the remaining economy gaps are percentage-of-max sacrifice, per-ability
   spend limits, and the Heroics economy.
2. **Aura kernel (family 1)** — **partial**. The membership kernel + Rook
   talent 1 self-grant landed in `kernels/aura.ts` and the self-grant seam;
   the remaining work is the cross-actor content harvest (Shieldmaster,
   Pelagic Rage, 42 foe traits, Black Book trophy) over that seam.
3. **Movement kernels (family 6)** — vacate/occupancy/elevation hooks unlock
   Darkside, Stone Double, Tumbling, Great Leap, Uplift, and the
   movement talents; also the forced-movement-entry fold.
4. **Conditional passive gates (family 3)** — the ~150 gated foe traits and
   relic rank passives convert to closed-ID rows.
5. **Reactive windows (family 4 — new triggers)** — attack-miss/completion,
   summon windows, generalized targeted-by-ability; unlock the reactive job
   traits and summon action suites.
6. **Stance / mark kernels (family 8)** — multi-stance, mark-stack, mark
   triggers.
7. **Damage-intent provenance (family 9)** — resistance, wound-taking,
   counter-type overrides; unlock relic aspects + resistance foe traits.
8. **Foe recipe primitives + mob model (families 10/11)** — the remaining
   foe abilities convert to `FOE_ABILITY_RECIPES` data.
9. **Phase + chapter-rule recipes (family 7)** — the 19 phases and 116
   chapter rules become lifecycle/override rows.
10. **Relic invoke kernel + aspect passives (family 13)** — the 120 ranks
   and 40 aspects, then the trophy/camp/reward bookkeeping closes
   advancement.

Gate discipline (from `freebuff-plan.md`): a reducer improvement does not
change audit numbers on its own — only an allowlist entry plus a source-page
fixture plus a deterministic replay test does. `PHASE_TWO_READY` /
`PHASE_THREE_READY` stay `false` until the gates genuinely pass, and no
mechanic is ever inferred from trait/role prose or a role label at runtime.
