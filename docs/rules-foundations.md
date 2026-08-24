# Rules-engine foundations

**Primary architecture authority.** This document maps the ICON 1.5 combat
ontology (core rules + Combat Glossary + Advanced Combat, the *Book of Battle*)
to the engine's primitive/kernel vocabulary. It is the source-to-foundation
index for the repository and is the reference the derived ledgers
([`kernels-needed.md`](kernels-needed.md), [`primitives-needed.md`](primitives-needed.md),
[`blocker-census.md`](blocker-census.md)) defer to.

Authority ordering (from `AGENTS.md`):

1. ICON source text — semantic authority.
2. Implementation code — execution authority.
3. Automation audit — coverage authority.
4. Documentation — never execution authority.

So this file is **not** a coverage claim and its status column never overrides
`npm run audit:automation` or the phase gates. Where this file and the docs'
older prose conflict, this file wins — it is derived first from the source
vocabulary, then validated against implementation.

---

## 1. Method

This pass derives architecture from the game's own combat ontology rather than
from unresolved talents or census blocker names. The sequence:

1. Read the core combat rules (pp.81–101), the **Combat Glossary** (the
   source-defined inventory of named reusable combat mechanics, pp.102–105),
   and **Advanced Combat** (interaction/edge-case authority, pp.106–109).
2. Decompose each named mechanic into orthogonal engine semantics (timing /
   predicate / selector / cost / state / mutation / modifier / duration /
   lifecycle / interaction).
3. Classify each against implementation: **COMPLETE / PARTIAL / MISSING /
   DUPLICATED / MISPLACED**.
4. Map every glossary term to a primitive, a kernel, or a composition.
5. Scan the content corpus (jobs, talents, masteries, limit breaks, relics,
   foes, trophies, camp/rewards) only *after* the ontology is fixed, to find
   compositions and genuinely non-glossary foundations.
6. Regenerate the blocker census and consent to a given primitive only from the
   regenerated dependency graph.

The default expectation for any unresolved source unit is that it **composes**
glossary/core vocabulary, possibly with a reusable modifier. Architecture is
never inferred from an ability name.

---

## 2. Source combat ontology

Everything below is a named mechanic with an exact source contract. Terms are
grouped by their role in the rules (state vs trigger vs operation vs modifier)
so that repeated decompositions share one vocabulary.

### 2.1 Core combat framework (pp.81, 87–90)

| Source mechanic | Contract (exact) | Page |
| --- | --- | --- |
| **Turn structure** | Move + two actions, any order; one ability with the Attack tag per turn; no repeats of any costed ability | 87, 91 |
| **Round** | All allies and foes have taken a turn; new round begins | 81 |
| **Slow Turn** | Acts after all non-slow characters; same ally/foe alternation; some abilities charge on slow turns | 87, 103 |
| **Interrupt** | Used off your turn, a set number between turns (Interrupt 1/2), one per turn, refreshed at your turn start; has a trigger; resolves before continuing the action | 91, 106 |
| **Standard Move** | Free action; move up to Speed orthogonally | 87, 103 |
| **Engagement** | Exiting a space adjacent to a hostile +1 movement | 88, 103 |
| **Orthogonal only** | All movement orthogonal unless specified | 88 |

### 2.2 Character model (p.81–82)

| Source mechanic | Contract | Page |
| --- | --- | --- |
| **Vitality (VIT)** | 25% of base max HP shorthand | 81 |
| **Hit Points (HP)** | 4× VIT; 0 = defeated | 81 |
| **Wound** | 25% of HP permanently (until interlude) off max; 4 wounds = fallen | 81, 101 |
| **Vigor** | Temporary shield over HP; damage goes to vigor first; stacks to the VIT cap; vigor surge = fill; all vigor lost at combat end | 81, 100 |
| **Defense** | To-hit must reach it | 82 |
| **Speed / Size** | Move distance; 1×1 footprint for PCs | 82 |
| **Damage die [D] / Fray** | Class die; fixed fray damage | 82, 92 |
| **Saves** | d20, success on 10+ | 82, 94 |
| **Resolve** | Party (reset each round) + personal pools; spent at the beginning of the action | 82, 99 |
| **Traits / Abilities / Talents / Mastery** | Passive scope; up to six abilities + one limit break; talents enhance abilities; mastering enhances further | 82 |
| **Bloodied** | At or under 50% of base max HP | 94, 104 |
| **Incapacitated** | At 0 HP; cannot act; statuses/marks/created effects end; summons/objects placed by it removed unless terrain/objects | 94, 104 |
| **Defeated** | At 0 HP clears all statuses/marks/stances/vigor/effects; no turn; PC gains a wound; rescue ends incapacitation and heals to full minus wounds | 101 |
| **Fallen** | 4 wounds | 101 |
| **Fleeing** | Spend 1 movement at the edge with no adjacent foe | 101 |

### 2.3 Movement and the battlefield (pp.87–90)

| Source mechanic | Contract | Page |
| --- | --- | --- |
| **Dash** | Ignore engagement; half speed at 1 action | 88, 103 |
| **Rush X** | Move X; unstoppable and immune to all damage while moving | 88, 103 |
| **Fly** | Ignore engagement, terrain, height cost, obstruction while moving | 88, 104 |
| **Teleport** | Instantly move to an unoccupied space in range X; ignore everything in between | 88, 104 |
| **Remove / place** | Not movement; no movement triggers (vigilance/rampart); removed characters skip turns | 88 |
| **Shove X** | Move involuntarily X in a straight line away; collide into characters/objects/higher elevation | 103 |
| **OBstruction** | Cannot enter a space occupied by it (foes/terrain/objects) | 103 |
| **Basic Terrain** | No effect; has elevation | 89 |
| **Difficult Terrain** | +1 to exit | 89, 103 |
| **Dangerous Terrain** | 2 piercing damage to enter/exit, ignoring armor & vigor; once per turn | 89, 103 |
| **Impassable** | Obstruction and cover, blocks line of sight | 89 |
| **Slope** | Exiting ignores one elevation level | 89 |
| **Pit** | Counts as one lower elevation | 89 |
| **Object** | Size 1–3; obstruction/cover; immune to damage unless specified; can be destroyed (10 HP, auto-hit, fail saves) | 89, 95 |
| **Terrain effect** | Modifies terrain spaces; overlaps; not removed on defeat | 95–96 |
| **Cover** | Half damage from ranged abilities; determined at application; adjacent foes ignore it; higher elevation ignores lower cover | 89, 92 |
| **Height advantage / disadvantage** | +1 boon per level attacking down; +1 curse per level attacking up | 89 |

### 2.4 Abilities, targeting, areas (pp.91–98)

| Source mechanic | Contract | Page |
| --- | --- | --- |
| **Targeting kinds** | Self / Ally / Foe / Characters / Others / Space / Object / Summon | 91–92 |
| **Range** | ≥1 space of the target's area inside the listed range; measured from the edge | 87, 92 |
| **Line of sight** | See and interact; blocked by impassable terrain + explicit LoS blockers | 92 |
| **Line of effect** | Ability must trace a clear path; blocked only by explicit sources | 107 |
| **Area patterns** | Line X, Arc X, Blast (small/medium/large), Burst X | 97 |
| **AoE / attack space** | Cover & LoS counted from origin; AoE hits all specified; attack space rolls an attack | 97 |
| **Summon** | Intangible; not a foe/ally; not marked; summon action/effect on summoner's turn; removed when summoner defeated; only free space + LoS unless specified | 95, 104 |
| **Auto-hit** | No attack roll, always a hit, never crit/miss | 102 |
| **Critical Hit** | Total 20+; +[D] base damage; still a hit | 94, 103 |
| **Exceed** | Total 15+; a triggered effect | 95, 103 |
| **Effects** | Simply happen; no roll/save; some off-turn no-cost | 94, 103 |
| **Delay** | Next turn must be slow; activates at start of that turn before all else | 95, 103 |
| **End turn** | Ability ends your turn; only one chosen if multiple | 103 |

### 2.5 Statuses (pp.104–105)

| Status | Contract |
| --- | --- |
| **Slashed** | Take 4 damage after you or an ally uses an ability that moves you; once per turn |
| **Blind** | Max range of all abilities is 2 |
| **Dazed** | +1 curse on attacks |
| **Hatred of X** | Half damage to foes other than X; ends at your turn end or if X is untargetable/immune |
| **Pacified** | Half damage; breaks when damaged by a foe's ability |
| **Sealed** | Cannot inflict statuses |
| **Shattered** | Cannot gain or benefit from vigor |
| **Stunned** | Cannot take interrupts; your next ability ends your turn, then Stunned ends |
| **Weakened** | All damage dealt reduced by 2 |
| **Vulnerable** | All damage taken increased by 1 |
| **Ongoing (+)** | Cannot be saved against, removed, or ignored until the source ends |

### 2.6 Positive effects / special states (pp.104–105)

| Effect | Contract |
| --- | --- |
| **Bloodied** | At or under 50% HP (special state) |
| **Immobile** | Cannot move, be moved, or be removed (special state) |
| **Counter** | When damaged by an ability, deal 2 damage back per applied instance |
| **Defiance** | Prevent HP below 1 once; then immune to all damage for the rest of the turn |
| **Divine** | Damage cannot be mitigated except immunity; bypasses vigor |
| **Dodge** | Immune to damage from misses, successful saves, and area effects |
| **Evasion** | d6 on attack; 4+ auto-misses, checked before the roll |
| **Flying** | Ignore terrain/height/obstruction/engagement |
| **Intangible** | Immune to foe damage/effects; no obstruction/engagement |
| **Phasing** | Pass through obstructions, not end in their space |
| **Pierce** | Ignore armor and Weakened |
| **Rampart** | Foes cannot enter/exit by dash/fly/teleport |
| **Regeneration** | If bloodied, gain 4 vigor at turn end |
| **Skirmisher** | Move diagonally; dash is full speed |
| **Stealth** | Cannot be directly targeted except from adjacency; breaks on abilities other than dash/standard move |
| **Sturdy** | Foe move/place effects move at most 1 space per turn |
| **True Strike** | Ignores dodge, blind, evasion, stealth |
| **Unerring** | Ignores cover and aetherwall |
| **Unstoppable** | Immune to statuses; cannot be moved by foes; movement ignores engagement and rampart |
| **Vigilance X** | X charges; spend for damage reduction on an ally in range 2, or damage on adjacency-break; once per trigger |
| **Vigor** | Shield over HP; see §2.2 |
| **Aura X** | Continuous ongoing effect on all in range X of an origin; only while inside |

### 2.7 Triggered effects (pp.95, 102–103)

| Trigger | Contract |
| --- | --- |
| **Chain Reaction** | Wright; when this ability damages two or more foes |
| **Charge** | When the ability is used on a slow turn |
| **Collide** | On any character shoved into an obstruction by this ability |
| **Comeback** | When the user of this ability is bloodied |
| **Heroic** | Stalwart; when its job-specific condition is fulfilled |
| **Infuse** | Wright; when Aether is spent on an ability |
| **Exceed** | On a total attack roll of 15+ |
| **Finishing Blow** | Vagabond; when this ability targets a bloodied foe |
| **Slay** | When this ability reduces a character to 0 HP |

Each unique triggered effect can only trigger **once per ability** (once per
trigger), p.95, 103, 107.

### 2.8 Other named glossary mechanics (pp.102–104)

| Mechanic | Contract |
| --- | --- |
| **Armor X** | Reduce all damage taken by X; take the highest value |
| **Bonus damage** | Roll one more [D] per instance and pick the highest |
| **Blessing** | Token; default spend = +1 boon on a save; all discarded at combat end |
| **Cure** | Gain 4 vigor, or a vigor surge if bloodied; then may save against all statuses |
| **Combo** | Base + combo version; use base → gain a combo token; use combo & have a token → combo version, discard; one token at a time; discarded at combat end |
| **Gamble** | Roll 1d6; trigger the effect on the listed result or higher |
| **Mark** | Ongoing effect; one mark per ability per character; replacing choice; ends if the placer is defeated or listed conditions |
| **Ongoing (+)** | Cannot be purged/removed/avoided until its source is ended |
| **Power Die** | A point-of-contact die, ticked up/down by conditions, discarded at 0; unique to the granting ability |
| **Rebound** | Bounce an ability off a character in range; it redirects from that character's space; does not stack |
| **Resistance** | Take half damage, rounded up |
| **Sacrifice X** | Reduce HP by X as a cost; paid at ability start; cannot be reduced/ignored/transferred/resisted; cannot go below 1; may pay even if not enough HP |
| **Stance** | Ongoing positive; one active at a time; drop by new stance or as a free action at turn start; refresh regains effects |
| **Triggered effect** | Effect that activates under a condition; each unique effect once per ability |

### 2.9 Advanced-combat interaction rules (pp.106–109)

These refine kernel contracts and must be engine semantics, not content
exceptions:

- **Adjacent** includes higher/lower elevation; a character is not adjacent to
  itself.
- **Ability stacking** — same-name abilities/effects do not stack.
- **On hit / miss / crit** — improvements only improve the attack portion;
  critical hits may trigger hit effects.
- **Damage order** — attacker effects (bonus damage) first, then defender
  reductions (armor), then defender multiplications (resistance/halving);
  halving once; vulnerable/weak per instance.
- **Interrupt/effect order** — effects in listed order; external effects before
  the actor's own; hostile before beneficial; interrupts resolve most-recent
  first and by turn order on ties.
- **Can/May** — unless an effect says may/can, it is mandatory.
- **Range increase** — only if the ability already has a listed range.
- **Shoves** — not optional; straight lines; may not shove off the edge.
- **Immunity / intangibility** — untargetable/immune characters don't trigger
  damage-reliant effects.
- **Valid spaces** — summon/teleport/place require free, unobstructed, LoS.
- **Turn breakdown** — start-of-turn endings, delay activation, actions, then
  post-ability triggers, then end-of-turn saves, then end-of-turn triggers;
  interrupts always take priority.
- **Specific tag interactions** — Blessing non-unique; Counter triggers on
  ranged and unseen; Evasion only vs attack components; Hatred not vs
  untargetable/immune; Immobile blocks all move forms; Marks per-character;
  Pacified only breaks on foe-ability damage; Stealth breaks and AoE rules;
  Unstoppable vs statuses/movement; Vigilance is an effect not interrupt;
  Vulnerable/Weakened per instance.

---

## 3. Primitive map

The **primitive layer** holds source-ID-free atomic semantics: values/state,
selectors, predicates, numbers, costs, typed mutations, typed modifiers,
durations, recorded choices/dice. Found at `automation/primitives/`.

### 3.1 Declarative VM vocabulary (`primitives/types.ts`)

The execution-complete layer. Effect kinds: attack, damage, heal, vigor,
condition, cure, move, resource, actions, terrain, entity, mark, stance,
persistent, modifier, save, if, repeat, defeat, phase, end-turn, state.
Selectors (12), number expressions (18), predicates (11), durations (8),
movement kinds (7: rush/shove/fly/teleport/place/remove/swap), shared resources
(resolve, personal-resolve, blessing, combo, vigilance, aether, bonus-damage,
effort, strain), and the trigger set (charge, comeback, finishing-blow, exceed,
heroic, infuse + reactive collide, slay + the window triggers when-damaged,
defeated, uses-ability, area-inclusion, targeted-by-ability, save-rolled).
**Every effect kind executes in `runtime.ts`; this layer is complete.**

### 3.2 Primitive inventory (status vs foundation)

"Existing" here means usable through a shared seam today; "partial" means a
hand-rolled shape that should become a recipe row; "missing" means no seam.

| Primitive | Domain | Status | Notes |
| --- | --- | --- | --- |
| VM vocabulary (effects/selectors/numbers/predicates/durations) | all | existing | §3.1 |
| **Damage resolution** (`damage-resolution.ts`) — determine + apply, HP/vigor split, armor/reduction/halving order, bypassVigor/ignoreArmor/ignoreDefiance flags | all | existing | §4 damage kernel |
| **Attack resolution** (`attack-resolution.ts`) — Evasion → d20 → boon/curse → crit/exceed; high ground; true strike | all | existing | §4 |
| **Save window** (`save-window.ts`) — kind, modifiers, threshold, denial policy, continuation branch | all | existing | F2 |
| **Spatial intent** (`spatial-intent.ts`) — bounds/occupancy/impassable/rampart authority for place/teleport/rush/fly | all | existing | F1 |
| **Line of sight / effect** (`line-of-sight.ts`) | all | existing | F1 |
| **Targeting** (`targeting.ts`) — self/ally/foe distinct, footprint range, blind/stealth | all | existing partial | single target; target sets pending |
| **Condition / status mutation** (`status-saves.ts`) | all | existing | apply/remove + status save |
| **Move mutations** (rush/shove/fly/teleport/place/remove/swap) | all | existing | via VM + spatial kernel |
| **Terrain mutations** | all | existing partial | basic/difficult/dangerous/pit/object; object destroy pending |
| **Stance mutation** | all | existing | enter/refresh/exit, exclusivity |
| **Mark mutation** | all | existing | single-mark-per-ability-owner model |
| **Resource mutations** (resolve/vigor/blessing/combo/vigilance/aether/bonus-damage) | all | existing | shared resource registry |
| Power-die stance | jobs/classes | partial | soul-blade, wicked-sheath, gallows-humor, etc. |
| Armed one-shot attack window | jobs/classes | partial | F6 kernel arm/consume |
| **Gamble** (d6 + threshold/result) | jobs/traits/relics/trophies | **existing** | `gambleD6` in `job-kit.ts`; `recordedDice` in `TurnDiceWindows` |
| Gamble extended families (dice-pool, result-override, post-roll-choice) | jobs/traits | partial | `gamble-dice-pool-modifier`, `gamble-result-override`, `post-roll-reactive-choice` |
| Sacrifice + cost override (HP payment, floor 1) | jobs/traits/relics | partial | sacrifice damage type exists; no HP-payment seam |
| Blessing/combo ability-use spend | jobs/traits | missing | registry exists; spend seam doesn't |
| Use ledger (once-per-turn/round/combat gates) | jobs | partial → **existing (once-per-round)** | the F9 reactive job-trait fold + durable round ledger (`kernels/trait-reactions.ts`); once-per-turn/combat variants still per-site |
| **Aura mechanic** (spatial membership projection) | jobs/foes/traits | **existing** | `kernels/aura.ts` — membership kernel + projection + attack modifiers + lifecycle recipes |
| Heroics economy | classes/traits | missing | |
| Infuse / Aether cost | classes/traits/relics | missing | `aether` resource exists |
| Entity / summon action suite | jobs/foes | partial | entity model exists; actions hand-authored |
| Ally-buff grant selector | jobs | partial | condition/vigor mutations exist |
| Mob member model | foes | missing | |
| Relic invoke/rank/aspect recipes | relics | missing | |

---

## 4. Kernel map

A **kernel** is a shared, framework-free engine mechanic (pure function, recipe
registry, or reducer seam) that content rows plug into. Found at
`automation/kernels/`.

| Kernel | Responsibility (source-backed) | Primitives consumed | Status |
| --- | --- | --- | --- |
| **Damage ledger** (`damage-ledger.ts`, F0) | Durable, replay-safe single damage instance; handoff provenance; defeat; interrupt-window state | damage-resolution, attack-resolution | existing |
| **Encounter damage adapter** (`encounter-adapter.ts`) | condition→intent derivation, one final halving, `defeatActor` lifecycle, reactive slay/collide dry-runs | damage, spatial | existing |
| **Spatial gateway** (F1) | one destination authority for place/teleport/rush/fly | spatial-intent, line-of-sight, targeting | existing |
| **Save window registry** (F2) | one SaveWindow record for every save; modifier/denial/branch | save-window | existing |
| **Turn lifecycle** (`lifecycle.ts`, F3) | TurnTransitionIntent; turn-end/turn-start/round-start/round-end/delayed phases | all mutations | existing |
| **Trigger windows** (`trigger-window.ts`, F4) | one decision + one replay entry; when-damaged/defeated/uses-ability/area-inclusion/targeted-by-ability/save-rolled | damage ledger windows | existing |
| **Passive projection** (`passive-projection.ts`, F5) | trait/role→condition projection fold; closed source-ID recipes | condition | existing |
| **Attack-path modifiers** (`attack-modifiers.ts`, F6) | trait attack-modifier fold (boon, exceed threshold, +damage, die) | attack, damage | existing |
| **Talent trigger-effect fold** (`talent-recipes.ts`, F7) | `talentTriggerMutations` folded into ability events; exceed/comeback/finishing-blow/slay/collide/always; condition-grant via `affectedFoeIds` | all mutations | existing (tranche) |
| **Movement-entry triggers** (`movement-triggers.ts`) | voluntary-MOVE entry seam (Party Favor exemplar) | move | partial (forced-movement entry pending) |
| **Reactive job-trait fold + round ledger** (`trait-reactions.ts`, F9) | once-per-round reactive job traits (collide/shove/slay) with a durable round-ledger gate reset at the round-start boundary | damage, resource, state, spatial | existing (Dash on the Rocks p.230 wired) |
| **Foe ability recipes** (`foe-recipes.ts`) | generic resolver factories; 22 recipe kinds | all | existing (22 kinds) |
| **Foe trait recipes** (`foe-trait-recipes.ts`) | closed foe keyword rows | condition | existing |
| **Summon recipes** (`summon-recipes.ts`) | placement ranges, per-owner caps, companion survival | entity | existing |
| **Aura membership kernel** (`aura.ts`) | generic Aura authority: origin resolution (trait/state/stance/aura-effect/entity), continuous membership from current positions through the canonical p.92 footprint range (`footprintDistance`), and ephemeral condition/modifier projection onto current members; lifecycle recipes query it with `isInAura` | spatial-intent, condition, attack | existing (Commander's Aura, Aura of Shielding, Rook t1, Dervish t1, Gentleness base+t1, Shieldmaster, Bleak Mercy) |
| **HP-threshold projection kernel** (`hp-threshold.ts`) | generic conditional-passive authority for the two canonical HP states — bloodied (at or under 50% of the wounds-adjusted maximum, p.94/p.104) and at-or-under-25% (the exact quarter mark) — answering "is this passive active" (`isAtHpThreshold`) and projecting conditions / the turn-start +actions bonus onto the owner, with an inverted gate for "loses X when bloodied"; the shared predicates also feed the VM (`quarter` predicate) and the attack-modifier fold (target-threshold bonus damage) | condition, attack, state | existing (Rogue Slippery, the Enrage family ×9, True Enrage, Arkentech Hover Chair, Furious Berserk sturdy, Strigoi Blood Hunger, Divine Aegis t2) |
| **Range / distance kernel** (`range.ts`, F12) | the single reusable authority for ICON's range family: canonical distance (`distanceBetween`/`isWithinRange`/`isExactlyRange` over the shared p.92 footprint metric), authoritative listed-range modification (`effectiveAbilityRange` folding registered `RangeModifierRule`s — fixed override, conditional override under stealth/comeback/mastery gates, dynamic round-number — at both command gates, so a range change genuinely widens target legality), and distance-gated effects (exact-range attack modifiers via the attack-modifier fold's `exactRange`/unerring, Aetherwall's outside-range-2 damage halving through the same footprint distance). Distance predicates never change targeting range, and listed-range changes never affect damage | spatial-intent, attack, damage | existing (Valkyrie t1, Incubus t1, Harvest t2, Open the Gates t2, Trigrammaton, Aetherwall) |
| **Area kernel** (`area.ts`, F13) | the reusable authority for ICON's p.97 AoE patterns. The geometry module (`area-geometry.ts`) owns the deterministic pattern math — orthogonal `lineCells`, validated orthogonal `arcCells` (a chosen path: contiguous, one-step, no self-overlap, never the user's space; never auto-shaped), and `squareArea` for burst/blast-center squares. The kernel folds registered `AreaModifierRule`s (shape and/or length override under round/talent/mastery gates) into an EFFECTIVE area descriptor (`effectiveAreaFor`) that the parent resolver reads at command time — the same discipline as the range kernel — and the reducer's target-legality gate consumes it for line-shaped abilities, so a shape/size change genuinely alters legal execution, never just metadata. Small/medium/large blast templates are visual-only in the source and deliberately NOT approximated; units needing an exact template carry the `blast-template` blocker | spatial-intent, area-geometry | existing (Soul Shot t2 line 6, Sturmreiten mastery arc 5) |

### Missing kernels named by the ontology

| Kernel | Source responsibility | Consumers |
| --- | --- | --- |
| **Resource-economy spend kernel** | blessing/combo/Infuse/sacrifice spend, use ledgers | glossary *Blessing/Combo/Sacrifice/Mark* + relic/trait rows (Gamble now existing) |
| **Heroics economy** | make-Heroic choice, lockout, half-damage penalty | glossary *Heroic* + Stalwart traits |
| **Movement-phase kernels** | vacate, occupancy-cost, elevation-fly, pre/post ability movement, position swap, teleport-all | glossary *Dash/Rush/Fly/Teleport/Place/Remove* + movement talents/foes |
| **Stance / mark trigger kernels** | multi-stance gate, mark-stack gate, mark-trigger gates | glossary *Stance/Mark* + Reactive windows |
| **Damage-intent provenance** | resistance provenance, wound-taking, counter damage-type override | glossary *Armor/Resistance/Weakened/Vulnerable* + relic aspects/foe traits |
| **Entity / summon action kernel** | companions' own suites, entity position mutation | glossary *Summon* + summon suites |
| **Mob member model** | member-level state, up to three members | foe mob subset |
| **Foe phase / chapter rule** | round-start cycling, bloodied transitions, chapter overrides | 19 phases + 116 chapter rules |
| **Relic invoke / trophy / camp / reward** | invoke cost+effects; trophy uses/passives; camp boundary; reward application | 120 ranks + 40 aspects + trophies/camp/rewards |

---

## 5. Source-term → foundation matrix

Every glossary/core term and its foundation home. Status: the audit is the only
authority for "complete"; here **existing** = a kernel/primitive seam exists
(not that all its content is wired).

| Source mechanic | Primitives | Kernel | Status | Consumers |
| --- | --- | --- | --- | --- |
| Armor / Resistance / Pierce | damage-resolution | damage ledger | existing | core + foes |
| Bonus damage / Critical / Exceed | attack-resolution | attack-modifiers, talent fold | existing | attacks, talents |
| Weakened / Vulnerable | damage-resolution | damage ledger | existing | core |
| Divine | damage-resolution (`ignoreDefiance`,`bypassVigor`) | damage ledger | existing(partial) | justice, nothung mastery |
| Attack roll / hit/miss | attack-resolution | F4 | existing | attacks |
| Save / Cure / Blessing | save-window, status-saves | F3 | existing (save), partial (blessing input) | core + lives |
| Statuses (10) | status mutation | object-position sort | existing | core + traits |
| Positive effects (18+) | condition mutation | passive-projection | existing (kept) | traits/roles |
| Special states (bloodied/immobile/incapacitated/defeated) | state | F0/F3 | existing | core |
| Move / Dash / Rush / Fly / Teleport / Shove / Place/Remove | move mutation, spatial-intent | F1, movement-triggers | existing (motion entry partial) | movement |
| Terrain (difficult/dangerous/impassable/pit/object) | terrain mutation | F1 | existing partial | classes/jobs/foes |
| Cover / LoS / LoE / Range / Height | targeting, line-of-sight, spatial | F1 | existing | targeting |
| Area patterns (line/arc/blast/burst) | area-geometry (`lineCells`/`arcCells`/`squareArea`) + area kernel | F13 | existing (line/arc/burst; blast template pending) | areas |
| Attack tag / auto-hit | VM attack | runtime | existing | attacks |
| Mark | mark mutation | F4 passive | existing | marks |
| Stance | stance mutation | F3 | existing | stances |
| Summon | entity mutation | summon-recipes | partial | summons |
| Triggered effects (charge/comeback/collide/exceed/finishing-blow/slay/heroic/infuse/chain-reaction) | VM triggers | talent fold, trigger-window | existing (charge/collide/etc.) | talents |
| **Gamble** | `gambleD6` + `TurnDiceWindows.recordedDice` | `job-kit.ts`, lifecycle | **existing** | all content gamble rolls migrated |
| Sacrifice | sacrifice damage | (cost seam) | partial | sacrifices |
| Combo / Blessing / Vigilance / Resolve | resource mutations | resource registry | partial (spend seams) | economies |
| Power Die | (die mutations) | lifecycle | partial | stance dies |
| Rebound | (attack direction) | (attack modifier) | missing | trick shot, heracule mastery |
| Aura | persistent effect | (aura kernel) | existing | auras |
| Area patterns (line/arc/burst; blast pending) | area-geometry + area kernel | F13 | existing (line/arc/burst) | areas |

---

## 6. Foundation → consumer matrix (inverse)

Answers: *"what content becomes harvestable when kernel X lands?"* Counts
derive from the canonical blocker census (regenerate before trusting a number).

| Foundation | Source mechanics served | Consumer families | Representative IDs | Status |
| --- | --- | --- | --- | --- |
| Damage ledger F0 | damage/defeat/reaction | core, basic attacks, terrain, held damage | — | existing |
| Spatial gateway F1 | targeting/range/LoS/place | VM selectors, area centers, teleport/rush/fly | — | existing |
| Save window F2 | saves/cure/blessing | status clears, relic/legend saves | — | existing |
| Turn lifecycle F3 | turn/round transitions, delay/end-turn | 45 lifecycle rows, traits, masteries | — | existing |
| Trigger windows F4 | reactive windows | when-damaged/defeated/uses-ability | — | existing |
| Passive projection F5 | condition/role baselines | 79 foe keyword rows, job traits | — | existing |
| Attack-modifier fold F6 | attack-path reads | Demon Edge/Hissatsu/Pulverize/Bull's Strength | — | existing |
| Talent fold F7 | trigger effects | 29 wired + condition-grant tranche | — | existing |
| **Aura kernel** (`aura.ts`) | Aura X membership + projection + attack modifiers | 2 job traits + 42 foe traits + trophies + Rook/Perseus/Dervish | shieldmaster, pelagic-rage, commander-s-aura | existing |
| Spend/economy hooks (missing) | Blessing/Combo/Sacrifice/Infuse/use-ledger | ~6 job traits + talents + 3 relic ranks | strive, demon-strength, crimson-king | needed (Gamble now existing) |
| Movement-phase kernels (missing) | vacate/occupancy/elevation/pre-post/swap/teleport-all | 5 job traits + movement talents/foes | darkside, stone-double, tumbling, great-leap | needed |
| Conditional passive gates (missing) | bloodied/25%/terrain/stealth/status/round | ~150 foe traits + relic ranks | berserker-enrage, earth-bond, wayfinding | needed |
| Reactive windows (missing triggers) | attack-miss/completion, summon, generalized targeted | 7 job traits + dozens of talents | cheap-trick, mantra-of-sealing, balance | needed |
| Stance/mark kernels (missing) | multi-stance, mark-stack/trigger | 3 job traits + talents | martial-master, astral-binding | needed |
| Damage-intent provenance (missing) | resistance, wound, counter-type | 18 foe traits + 4 relic aspects | bullheaded, maiden-aspect | needed |
| Entity/summon action kernel (missing) | entity actions, position mutation | 6 summon suites + Meld | bound-spirit, beast-master, meld | needed |
| Mob model (missing) | member state | foe mob subset | — | needed |
| Foe phase/chapter kernel (missing) | phase cycling, chapter override | 19 phases + 116 chapter rules | i-vessel-knight, veridian-weapon | needed |
| Relic/trophy/camp/reward (missing) | invoke/aspect/use/camp/reward | 120+40 relics, 68 trophies, 101 camp, 9 rewards | ape-god, crimson-king | needed |

---

## 7. Advanced-combat interaction matrix

Engine semantics (not content exceptions), with current handling:

| Interaction | Source rule | Engine home | Status |
| --- | --- | --- | --- |
| Counter vs attack/range/visibility | triggers on any damage instance, even unseen | damage ledger + F4 window | kept/should promote when ledger drives it |
| Dodge vs Evasion | evasion only on attack component; dodge ignores misses/AoE | attack-resolution | existing |
| Hatred vs untargetable/immune | does not apply or gain vs untargetable/immune | status (`hatred`) | existing |
| Immobile vs all move forms | blocks move/be moved/be removed | spatial-intent | existing |
| Mark ownership/replacement | one mark per ability per character | mark mutation | existing |
| Pacified break | only on foe-ability damage | status (`pacified`) | existing |
| Stealth vs target/area/movement | direct only from adjacent; AoE bypasses; dash/standard-move don't break | targeting + VM | existing |
| Unstoppable vs statuses/movement/rampart | immune to statuses & hostile movement | positive-effect | existing |
| Vigilance vs voluntary/off-turn move | breaks adjacency for any reason | F4/ledger | partial |
| Vulnerable/Weakened per instance | per separate damage instance | damage-resolution | existing |
| On hit/miss/crit scoping | only attack portion | attack path | existing |
| Damage ordering | attacker→defender reductions→defender mult+round up | damage-resolution | existing |
| Interrupt/effect ordering | most-recent first; turn order on ties; hostile before beneficial | trigger-window + lifecycle | existing |

---

## 8. Non-glossary foundations

Reusable architecture **required by the corpus** but **not explicitly named by
the Combat Glossary**. These justify foundation work the glossary alone does
not name:

1. **Generalized ability-parameter modification** — the modifier layer that
   lets masteries/talents override range, area, target count, action cost,
   interrupt rank, repeat count, damage amount/type, movement distance/type,
   trigger threshold, duration, cost, save. The glossary has no single term
   for "modify another ability," yet masteries and many talents are exactly
   that.
2. ~~Aura membership projection~~ — **existing** (`kernels/aura.ts`): continuous
   membership from current positions through the canonical p.92 footprint
   range, ephemeral condition/modifier projection onto current members, and
   lifecycle recipe integration.
3. **Delayed anchors** — record a target/effect at command time, resolve at a
   marked actor's boundary; the glossary's *Delay* is a special case, but the
   corpus (Great Giorgios, Assassinate, Showdown, etc.) needs a general anchor.
4. **Entity / summon action suites** — the companions' own actions
   (lash-out, dash-bite, fly, detonate); the glossary defines *Summon* as a
   character type but not the per-entity action suites.
5. **Mob member state** — member-level HP/positions for mob profiles.
6. **Relic invocation / uses** — the Invoke command shape (cost + trigger
   threshold) and trophy use commands.
7. **Camp / reward execution** — deterministic camp-boundary and reward
   application (mostly narrative/bookkeeping, needs a deterministic kernel).
8. **Once-per-round/combat use ledgers** — the repeated "once per round"
   gate the corpus uses heavily; the glossary has no keyword for it.

---

## 9. Dependency graph

Derived from the source ontology (not the reverse). Arrows: `↓` = depends on.

```
recorded dice (primitives: numbers, state)
        ↓
      Gamble  (threshold/result mapping + replay persistence)
        ↓
   triggered-effect kernel  (charge/collide/comeback/exceed/slay/finishing-blow/heroic/infuse/chain-reaction)
        ↓
   condition-on-trigger / terrain-on-trigger / summon-on-trigger / movement-on-trigger

predicates + selectors + typed mutations (primitives)
        ↓
   triggered-effect kernel
        ↓
   Comeback / Slay / condition-grant / terrain-grant  [F7 talent fold]

spatial authority (targeting + line-of-sight/spatial-intent) + persistent projection
        ↓
             Aura membership kernel
        ↓
             aura grants / aura-adjacent helpers

damage resolution + attack resolution + save window
        ↓
             damage ledger (F0) → trigger windows (F4) → Counter/Vigilance/Sturdy

costs + resources (resolve/vigor/blessing/combo/aether)
        ↓
             spend/economy kernel → Sacrifice / Infuse / Heroics / Combo / use-ledger
```

**Collapsing blockers:** several census blocker labels collapse into one
reusable abstraction:
- `charge-state` → **recorded-state / triggered-effect** kernel. (`gamble-state` resolved: `gambleD6` + `dice-result-modifier` + `post-roll-reactive-choice`.)
- `aura`, `cover-mechanic`, `range-modifier` → **spatial / modifier** layer.
- `sacrifice-cost`, `infuse-cost`, `blessing-spend`, `combo-spend`,
  `use-ledger`, `heroics-economy`, `resource-management` → **resource-economy /
  spend** kernel.
- `fly-grant`, `pre-ability-movement`, `movement-modifier` → **movement-phase**
  kernel.
- `mark-modifier`, `stance-gate` → **status/mark/stance** kernel.

---

## 10. Foundation build order

Prioritized by dependencies, glossary completeness, shared leverage,
elimination of duplicated content-local rules, correctness/replay risk, and
content unlock counts — **not** by census immediate completions alone.

1. **Resource-economy / spend kernel** (sacrifice, blessing, combo, infuse,
   use-ledger, heroics) — the glossary's own economy vocabulary (Gamble is now existing); the
   biggest shared leverage across job traits, talents, and relic ranks.
   **Landing:** the once-per-round reactive job-trait fold + durable round
   ledger (F9) is done — see `__tests__/trait-reactions.test.ts`; the
   spend-augment (blessing/combo/infuse) side and Press The Advantage's
   ally-choice still need the tighten-input seam.
2. ~~Aura membership kernel~~ — **existing** (`kernels/aura.ts`).
3. **Movement-phase kernels** — vacate/occupancy/elevation/pre-post movement;
   unlocks movement traits + talents + the movement-entry forced fold.
4. **Conditional passive gates** — bloodied/25%/terrain/stealth/status/round
   predicates; converts ~150 foe traits and relic passives to closed rows.
5. **Reactive windows (new triggers)** — attack-miss, attack-completion,
   summon windows, generalized targeted-by-ability; unlocks reactive job traits
   and summon suites.
6. **Stance / mark trigger kernels** — multi-stance, mark-stack, mark triggers.
7. **Damage-intent provenance** — resistance, wound-taking, counter-type
   overrides; unlocks relic aspects + resistance foe traits.
8. **Foe recipe primitives + mob model** — the remaining 1,247 foe abilities.
9. **Phase + chapter-rule kernels** — 19 phases, 116 chapter rules.
10. **Relic invoke / trophy / camp / reward** — closes advancement.

DeepSeek owns the architectural/foundation tasks; MiMo must not bulk-harvest a
family until its foundation contract is stable.

---

## 11. FOUNDATION_COMPLETE gate

`FOUNDATION_COMPLETE` is the point at which:

- every named glossary/core combat mechanic maps to a **stable** primitive/
  kernel implementation **or** an explicit intentional table-facing
  classification (AGENTS.md §10 conservative rule);
- every known unresolved source mechanic maps to (a) existing foundation
  vocabulary, (b) a specifically documented missing foundation, or (c) a
  deliberate table-facing handling;
- no large content family requires discovering a **new execution
  architecture**;
- remaining content work is predominantly bounded recipes/data;
- replay/timing/spatial authority boundaries are explicit in this document.

At `FOUNDATION_COMPLETE`, MiMo can run large harvest passes without designing
new mechanics. `PHASE_TWO_READY` / `PHASE_THREE_READY` remain `false` until the
gates genuinely pass; this document records architecture, not gate status.

---

## 12. Implementation-status ledger (compact)

The F0–F8 execution ledger, retained for continuity. This is an engineering
ledger, not a coverage claim — the automation audit and phase gates are the
only authority for "done."

- **F0 Damage + defeat kernel** — `damage-resolution.ts`/`attack-resolution.ts`;
  durable `DamageLedgerEntry` + `AttackResolutionLedger`; `defeatActor`
  lifecycle; `gainVigor` cap. Available for basic attacks, terrain, held/Slashed
  damage, Vigilance, delayed damage, Counter/Gentleness reflection.
- **F1 Target + spatial gateway** — `targeting.ts`, `spatial-intent.ts`,
  `line-of-sight.ts`; area center legality; shared destination authority.
- **F2 Save windows** — one durable `SaveWindow` per save, four kinds; modifier/
  denial/continuation branch.
- **F3 Turn lifecycle** — `TurnTransitionIntent` + closed `LIFECYCLE_RECIPES`
  (turn-end/start, round-start, delayed); slow-turn derivation.
- **F4 Trigger/window provenance** — one decision + one replay entry;
  `TRIGGER_WINDOW_RECIPES`; ledger-consumed windows.
- **F5 Passive projection + role baselines** — closed `FOE_ROLE_BASELINE_RECIPES`
  + job-trait condition recipes; feature/mark projection.
- **F6 Job traits / attack-path kernel** — closed `JOB_TRAIT_RECIPES`; five
  wiring homes; `attack-modifiers.ts` fold; plus the F9 reactive fold rows
  and Trigrammaton's exactly-range-3 row (F12). 25/65 traits wired.
- **F7 Talents fold** — closed `TALENT_RECIPES` (288); `talentTriggerMutations`
  (exceed/comeback/finishing-blow/slay/collide/always) + `affectedFoeIds`
  condition-grant; 30 wired + 5 program-level + 3 passive-projection + 4
  range-modifier (F12) + 1 area-modifier (F13; the area-carried rows — Pyre
  t2 exceed blast shove, Eye of the Storm t2 center piercing — ride the
  wired/program-level homes). 43/288 executable.
- **F8 Mastery attachment** — `kernels/mastery.ts`: the typed mastery
  attachment mechanism. `EncounterActor.masteredAbilityIds` (projected from
  `CharacterAbility.mastered`, migrated deterministically for old snapshots)
  is the durable ownership record; a reviewed `MasteryRecipe` declares one of
  four attachment kinds (fold / program-level / continuous projection /
  lifecycle) gated on the shared `hasMastery(actor, abilityId)` — the parent
  must be equipped AND mastered, so an unmastered actor behaves exactly as
  before. The compiler audits an implemented mastery as a complete program
  and an unimplemented one for its actual effect blockers; `mastery-attachment`
  is no longer a missing primitive. Wired: Rook Implacable Fortress (aura
  armor projection), Dark Knight Infectious Hatred (stance aura + turn-end
  save-or-hatred), Intimidate Iron Skull (stun-triggered unstoppable),
  Bleak Mercy Painkiller (indefinite aura + status-counted re-use), Warding
  Bolts Phantom Bolts (aura-2 hover + start-in/end-out strike), Gentleness
  Gentle Prayer (aura resize + pacify), Rampant Nail Voracious Nail
  (adjacent vulnerable + upgrade-only aura). Fixtures:
  `__tests__/mastery.test.ts`.
- **F9 Once-per-round reactive job-trait fold** — `kernels/trait-reactions.ts`
  (a `collide`/`shove`/`slay` reaction with an optional durable round ledger
  reset at the round-start boundary), folded into the ability mutation stream
  in `abilityEvents`/the rule path. Wired row: `stormbender:trait:
  dash-on-the-rocks` (p.230) — 1/round on collide, gain 1 aether + burst-1
  piercing centered on the collided character (never the ability user).
  Fixtures: `__tests__/trait-reactions.test.ts`. This is the first home of
  the once-per-round economy/reactive-trait family (`use-ledger`);
  once-per-combat and the spend-augment (blessing/combo/infuse) halves remain.
- **F10 Aura membership kernel** — `kernels/aura.ts`: the single reusable,
  source-ID-free mechanism answering which characters are inside an aura and
  what membership projects onto them. A content row registers a reviewed
  `AuraDefinition` (origin resolution, radius, relations, includes-origin,
  optional talent gate, projected conditions and attack modifiers); the kernel
  derives membership continuously from current positions through the
  canonical p.92 footprint range, so entering/leaving and origin movement
  update immediately and replay needs no membership snapshots. Projection
  feeds the existing condition fold (`encounterConditionSet`) and the shared
  attack-modifier netBoon fold — Aura never resolves attacks/saves/damage
  itself. Lifecycle recipes (Shieldmaster turn-end, Dervish expiry) ask the
  same kernel with `isInAura`. Rows: Commander's Aura (p.304, +1 boon on
  attacks), Aura of Shielding (p.304, dodge), Rook t1 counter, Dervish t1
  counter, Gentleness base (+1 curse) + t1 counter, Shieldmaster turn-end
  vigilance/sturdy, Bleak Mercy combo. Fixtures: `__tests__/aura.test.ts`.
- **F12 Range / distance kernel** — `kernels/range.ts`: one canonical
  distance (the p.92 footprint metric, shared by targeting, areas, auras, and
  the distance predicates — never a competing implementation) plus
  authoritative listed-range modification: a content row registers a
  reviewed `RangeModifierRule` (fixed override, conditional override under
  stealth/comeback/mastery gates, or the dynamic round-number value);
  `effectiveAbilityRange` folds them against current encounter state at both
  command gates (USE_ABILITY and EXECUTE_RULE) BEFORE a target is accepted,
  so "Valkyrie gains range 4" widens target legality and a lost stealth
  condition shrinks Incubus back to range 3 immediately. The exact-distance
  family (Trigrammaton's "at exactly range 3: +1 boon and unerring") and the
  distance-gated defense family (Aetherwall's "resistance against abilities
  from characters outside range 2") are NOT range-modifier rows: they ride
  the attack-modifier fold's `exactRange`/unerring seam and the damage
  halving's `targetAetherwall`/`ignoreAetherwall` intent, both reading the
  same footprint distance. Wired: Valkyrie t1 (range 4), Incubus t1 (3/5
  from stealth), Harvest t2 (2/5 Comeback), Open the Gates t2 (range = round
  number), Trigrammaton (exactly-range-3 boon + unerring), Aetherwall
  (outside-range-2 halving). Fixtures: `__tests__/range.test.ts`.
- **F13 Area kernel** — `kernels/area.ts` + `area-geometry.ts`: the reusable
  authority for ICON's p.97 AoE patterns. `arcCells` validates a player-chosen
  orthogonal arc path (contiguous, one step at a time, no self-overlap, never
  the ability user's space) and returns the exact cells — an Arc is a chosen
  path, never an auto-shaped approximation; `lineCells`/`squareArea` cover the
  orthogonal line and the burst/center squares. A content row registers a
  reviewed `AreaModifierRule` (shape and/or length override with round /
  talent / mastery gates); `effectiveAreaFor` derives the parent ability's
  EFFECTIVE area at command time and the reducer's target-legality gate for
  line-shaped abilities reads it, so a change genuinely alters legal
  execution. Blast templates are visual-only in the source and deliberately
  NOT approximated (units needing one carry `blast-template`). Rows: Soul
  Shot t2 (Line 6 from round 4), Sturmreiten mastery (Arc 5), plus the
  area-carried triggers on Pyre t2 (exceed blast shove) and Eye of the Storm
  t2 (center piercing per area character). Fixtures: `__tests__/area.test.ts`.
- **F11 HP-threshold passive projection kernel** — `kernels/hp-threshold.ts`:
  the source-ID-free authority for the canonical conditional passives
  ("while bloodied, X" / "while at or under 25% HP, X"). Bloodied is at or
  under 50% of the wounds-adjusted maximum (`maximumHp` = base − wounds×VIT),
  matching the engine's long-standing `isBloodied`; "at 25% hp or lower" is
  the exact quarter mark of the same maximum (the p.107 "% HEALTH" rule —
  percentage COSTS/DAMAGE use the base maximum — does not apply to state
  thresholds). A content row registers a reviewed `HpThresholdProjection`
  (threshold, optional inverted gate for "loses X when bloodied", projected
  conditions, +actions); activation derives continuously from authoritative
  HP, so crossing back over the threshold removes the projection immediately
  and replay persists no "bloodied active" boolean. The same predicates feed
  the VM (`quarter` predicate), the attack-modifier fold (target-threshold
  flat damage vs bloodied foes), and the turn-start action pool (Enrage).
  Rows: Rogue Slippery (evasion), Enrage ×9 (+1 action), True Enrage (+1
  action + unstoppable), Arkentech Hover Chair (inverted flying + sturdy),
  Furious Berserk (sturdy), Strigoi Blood Hunger (+2 vs bloodied), Divine
  Aegis t2 (quarter-HP defiance). Fixtures: `__tests__/hp-threshold.test.ts`.

### Explicit incomplete semantic boundaries

- Counter/Vigilance/Sturdy/Defiance promotion waits on full ledger-driven
  trigger/durable-provenance coverage (F4).
- Forced-movement entry remains an incomplete semantic boundary; one-shot
  movement-entry triggers must not double-fire, and distinct triggers must stay
  independent (AGENTS.md §8).
- Masteries are wired through the typed mastery attachment (F8) for the
  seven singleton candidates; limit-break actions remain unwired and stay
  census-visible (their blockers name the missing effect machinery, not
  `mastery-attachment`).
- Rebound (attack bounce) is not a modeled mechanic beyond Trick Shot's armed
  variant.
- Range is NOT globally complete: the listed-range family (fixed/conditional/
  dynamic override) is generic authority, but unlimited/no-maximum-range
  grants (`unlimited-range`), exact-distance predicates whose payload is not
  an existing attack modifier (damage/teleport/explosion at exactly range N),
  object-anchored distance ("in range N of that object"), per-ability
  attack-modifier attachment for talent/mastery-owned unerring, and the
  effect-redirect family all remain unresolved by design — the census exposes
  each as its own blocker family (`distance-predicate`, `unlimited-range`,
  `object-distance`, `ability-attack-modifier`, `effect-redirect`).
- Areas are NOT globally complete: the deterministic line/arc/burst geometry
  and the registered shape/length modifier seam are generic authority, but
  source-defined area semantics still unresolved include the exact
  small/medium/large blast templates (visual-only in the PDF — units naming
  a blast size carry the precise `blast-template` blocker and are never
  approximated), delivery-type conversions (Perseus t2's aura → line-5
  area, `aura-to-area-conversion`), an additional secondary area (Sturmreiten
  t2's comeback line-3 extension, `area-extension`), moving an existing
  terrain area at a turn boundary (Atherwand t2, `terrain-move-lifecycle`),
  and player-target choice inside an area (Eclipse t2, `choice-input`). The
  area kernel answers "what is this ability's effective area right now" and
  never absorbs the payload semantics of an area-carried effect.
- The seer 13-card deck mechanics may stay table-facing by design.
- Aura is NOT globally complete: source-defined aura semantics still
  unresolved include the ability-user-presence gate over an ally-carried aura
  (Endless Battlement t1/t2), entity members/consumption inside an aura
  (Nightmare t2 shadows), and attack-triggered token/resource grants to
  adjacent characters (Mantra of Sealing). Aura membership and projection
  themselves are the implemented boundary; the large-footprint origin edge
  (an origin's occupied footprint as the measured edge) follows the p.290
  member-side footprint rule and stays covered by `footprintDistance` for
  members — origin-footprint-edge aura measurement is the one geometric
  detail left to the footprint matrix.
- HP-threshold passives are NOT globally complete: only the bloodied and
  at-or-under-25% predicates are generic authority. The remaining conditional
  gates (terrain, stealth, status, round) and the deferred threshold-shaped
  units stay unresolved by design — timed intangibles on bloodied (Bicorn /
  Floatfish Aetherskin), bloodied aura-radius growth (Dungeon Jelly, Harpy),
  bloodied bonus-damage (Pariah Mutate, which needs a general bonus-damage
  projection), on-hit slashes vs bloodied foes (Fixer Iron Blade), and the
  compound Mule/Steam-Wright rows. The threshold kernel only answers "is this
  passive active"; it never absorbs its payload's semantics.

---

## 13. Documentation authority and reconciliation

- [`kernels-needed.md`](kernels-needed.md) — the kernel build ledger; mirrors
  §3/§4 here. It is the "which content promotes when kernel X lands" detail.
- [`primitives-needed.md`](primitives-needed.md) — the primitive build ledger;
  mirrors §3 here at recipe granularity. It is the "which recipe primitive is
  missing" detail.
- [`blocker-census.md`](blocker-census.md) — the live dependency graph of
  unresolved Class/Job units; regenerate after any implementation, never trust a
  stale snapshot.
- [`glossary-executable-inventory.md`](glossary-executable-inventory.md) — the
  Combat Glossary term-by-term executable-status map (the "make each glossary
  mechanic executable" gap analysis) and its prioritized implementation queue.
- [This file] is the primary source-to-foundation authority and the build-order
  arbiter. Where the derived ledgers made stale claims (e.g. range-modifier
  "documented" vs `documented`), the implementation and this ontology govern.
