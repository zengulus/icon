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
| Gamble (recorded d6 + result branch) | jobs/traits/relics/trophies | partial | TurnDiceWindows pre-rolls exist; no shared effect |
| Sacrifice + cost override (HP payment, floor 1) | jobs/traits/relics | partial | sacrifice damage type exists; no HP-payment seam |
| Blessing/combo ability-use spend | jobs/traits | missing | registry exists; spend seam doesn't |
| Use ledger (once-per-turn/round/combat gates) | jobs | partial → **existing (once-per-round)** | the F9 reactive job-trait fold + durable round ledger (`kernels/trait-reactions.ts`); once-per-turn/combat variants still per-site |
| Aura mechanic (spatial membership projection) | jobs/foes/traits | missing | persistent `aura` effect exists; no membership kernel |
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

### Missing kernels named by the ontology

| Kernel | Source responsibility | Consumers |
| --- | --- | --- |
| **Aura membership kernel** | spatial distance-based grants/penalties, activation/size/entry | Shieldmaster, Pelagic Rage, 42 foe traits, Black Book; glossary *Aura X* |
| **Resource-economy spend kernel** | blessing/combo/Infuse/sacrifice spend, use ledgers, gamble | glossary *Blessing/Combo/Sacrifice/Gamble/Mark* + relic/trait rows |
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
| Area patterns (line/arc/blast/burst) | spatial (`computeSpatialArea`) | F1 | existing (burst/line; arc pending) | areas |
| Attack tag / auto-hit | VM attack | runtime | existing | attacks |
| Mark | mark mutation | F4 passive | existing | marks |
| Stance | stance mutation | F3 | existing | stances |
| Summon | entity mutation | summon-recipes | partial | summons |
| Triggered effects (charge/comeback/collide/exceed/finishing-blow/slay/heroic/infuse/chain-reaction) | VM triggers | talent fold, trigger-window | existing (charge/collide/etc.) | talents |
| Gamble | (recorded dice) | TurnDiceWindows | partial | gambles |
| Sacrifice | sacrifice damage | (cost seam) | partial | sacrifices |
| Combo / Blessing / Vigilance / Resolve | resource mutations | resource registry | partial (spend seams) | economies |
| Power Die | (die mutations) | lifecycle | partial | stance dies |
| Rebound | (attack direction) | (attack modifier) | missing | trick shot, heracule mastery |
| Aura | persistent effect | (aura kernel) | missing | auras |

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
| Aura kernel (missing) | Aura X | 2 job traits + 42 foe traits + trophies + Rook/Perseus/Dervish | shieldmaster, pelagic-rage, commander-s-aura | needed |
| Spend/economy hooks (missing) | Blessing/Combo/Sacrifice/Infuse/Gamble/use-ledger | ~6 job traits + talents + 3 relic ranks | strive, demon-strength, crimson-king | needed |
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
2. **Aura membership projection** — distance-based grants with activation,
   size change, and entry effects; the glossary defines *Aura X* as an effect
   but provides no engine shape for continuous membership.
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
- `gamble-state`, `charge-state` → **recorded-state / triggered-effect** kernel.
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
   gamble, use-ledger, heroics) — the glossary's own economy vocabulary; the
   biggest shared leverage across job traits, talents, and relic ranks.
   **Landing:** the once-per-round reactive job-trait fold + durable round
   ledger (F9) is done — see `__tests__/trait-reactions.test.ts`; the
   spend-augment (blessing/combo/infuse) side and Press The Advantage's
   ally-choice still need the tighten-input seam.
2. **Aura membership kernel** — unlocks the largest browse-level family (2 job
   traits + 42 foe traits + trophies).
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
  wiring homes; `attack-modifiers.ts` fold; plus the F9 reactive fold rows.
  23/65 traits wired.
- **F7 Talents fold** — closed `TALENT_RECIPES` (288); `talentTriggerMutations`
  (exceed/comeback/finishing-blow/slay/collide/always) + `affectedFoeIds`
  condition-grant; 3 program-level. 32/288 executable.
- **F8 Mastery attachment** — every mastery needs a typed ability-recipe
  modifier hook + mastery attachment; uniformly reflected in the census
  (`mastery-attachment` on all 144).
- **F9 Once-per-round reactive job-trait fold** — `kernels/trait-reactions.ts`
  (a `collide`/`shove`/`slay` reaction with an optional durable round ledger
  reset at the round-start boundary), folded into the ability mutation stream
  in `abilityEvents`/the rule path. Wired row: `stormbender:trait:
  dash-on-the-rocks` (p.230) — 1/round on collide, gain 1 aether + burst-1
  piercing centered on the collided character (never the ability user).
  Fixtures: `__tests__/trait-reactions.test.ts`. This is the first home of
  the once-per-round economy/reactive-trait family (`use-ledger`);
  once-per-combat and the spend-augment (blessing/combo/infuse) halves remain.

### Explicit incomplete semantic boundaries

- Counter/Vigilance/Sturdy/Defiance promotion waits on full ledger-driven
  trigger/durable-provenance coverage (F4).
- Forced-movement entry remains an incomplete semantic boundary; one-shot
  movement-entry triggers must not double-fire, and distinct triggers must stay
  independent (AGENTS.md §8).
- Mastery and limit-break machinery is structurally present only through the
  blocker census; no mastery or limit break is wired.
- Rebound (attack bounce) is not a modeled mechanic beyond Trick Shot's armed
  variant.
- The seer 13-card deck mechanics may stay table-facing by design.

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
