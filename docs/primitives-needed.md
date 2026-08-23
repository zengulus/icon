# Primitives needed for full automation coverage

The primitive counterpart of [`kernels-needed.md`](kernels-needed.md): the
reusable **building blocks** that content rows are composed from. A *kernel*
is a shared mechanic a row plugs into; a *primitive* is the small, parameterized
building block the recipe factories emit — they overlap (a kernel is usually
itself a primitive), and the hard rule is the same: **no per-content resolver.**
If a new slice of content needs resolver code, the primitive is missing, not
the content.

This is a planning document, not a coverage claim — `npm run audit:automation`
and the phase gates are the only authority for "done".

There are two layers:

1. **The declarative VM vocabulary** — `automation/primitives/types.ts`: 24 `RuleEffect`
   kinds (attack, damage, heal, vigor, condition, cure, move, resource,
   actions, terrain, entity, mark, stance, persistent, modifier, save, if,
   repeat, defeat, phase, end-turn, state), 12 selectors, 18 number
   expressions, 11 predicates, 8 duration kinds, 7 movement kinds, the shared
   resources (resolve, personal-resolve, blessing, combo, vigilance, aether,
   bonus-damage, effort, strain), and the trigger set (charge, comeback,
   finishing-blow, exceed, heroic, infuse + reactive collide, slay + the
   window triggers when-damaged, defeated, uses-ability, area-inclusion,
   targeted-by-ability, save-rolled). **Every effect kind executes in
   `runtime.ts`** — this layer is complete.
2. **The content-recipe layer** — the parameterized factories that turn a
   source unit into a program. `FOE_ABILITY_RECIPES` is the model: 10
   primitives (attack, shove, rush, vigor, mark, swap, dash-strike, blast,
   terrain, end-turn-stealth) with typed options, compiled by generic
   factories into resolvers. The job/trait/relic/mastery/advancement sides
   still hand-author most of their behaviors per ability. **This layer is
   where the primitivisation work is.**

Already-primitivised recipe layers: `LIFECYCLE_RECIPES` (turn-end /
turn-start / round-start / round-end / delayed phases), `TRIGGER_WINDOW_RECIPES`
(the six window triggers), `content/jobs/summon-recipes.ts` (placement ranges, per-owner
caps), `kernels/passive-projection.ts` (`JOB_TRAIT_CONDITION_RECIPES`,
`FOE_ROLE_BASELINE_RECIPES`, the Rot mark projection), the talent fold
(`talentTriggerMutations`: exceed / comeback / slay / collide), the F6
attack-modifier kernel (`kernels/attack-modifiers.ts`), `save-window.ts` (four kinds),
`spatial-intent.ts`, the damage ledger, and the shared resource registry.

## 1. Jobs and classes — hand-rolled patterns to primitivise

The job program files repeat the same shapes per ability; each row names the
consumer and the primitive that should replace the hand-written code.

| Primitive | Hand-rolled today (consumers) | Status |
| --- | --- | --- |
| **Power-die stance** — die size, start value, tick trigger, consume/empower, discard-at-0 | Soul Blade (`soul-blade:die`, d6@2), Wicked Sheath (`wicked-sheath:charged`, d4 + round-start tick + discard on hit), Gallows Humor (`gallows-humor:die`, d6@1 + tick on miss + empower), Umbral Echo (`umbral-echo:die`, d4@2 + turn-end refresh), Gran Reversa, Obsidian Flesh, Exorcism (d4 on a mark), Godly Smite mantra die | partial — ruleState keys + lifecycle recipes per stance |
| **Armed one-shot attack window** — consume on the next attack, expiry boundary | Massive Overhead (bonus die + pit), Trick Shot (`trick-shot:armed`, unerring + boon), Ace (`ace:armed`, exceed injection + daze + unerring), Riposte, Carnevale, Revenge (`revenge:active`); Hissatsu / Demon Edge are already the F6 kernel | partial — generalize `kernels/attack-modifiers.ts` armed-state consume into a recipe row |
| **Spatial aura** — radius, per-distance grants/penalties, activation/deactivation, entry effects | Rook, Perseus, Endless Battlement, Strength of the Pack (aura-2 stance), Sweet Torment, Dervish (+1 boon on saves), Gentleness (damage-in-aura reflection) | partial — persistent `aura` effect exists; no distance-based grants/entry |
| **Mark-trigger recipe** — turn-start / end-of-foe-turn / when-damaged / adjacency / mark-granted ability gates | Rot (projection), Exorcism (die on mark), Astral Chain, Showdown, Stampede, Intimidate, Hunt (attack modifier), Grapple (adjacency save), Cheat Time (mark grants interrupt), Chastise retribution, Incubus, Low Blow | partial — marks + lifecycle recipes exist; gate shape per mark |
| **Gamble** — d6 (or die) roll, result branching, boundary pre-roll, stacked/gamble resources | Riposte, Spinning Top, Carnevale (turn-end), Monogatari (boundary), Party Favor (detonate), Death (space choice), Stack Dice (trait), Bend Fate (trait), Golden Mask (trophy, recorded d20/d10/d8/d6/d4) | partial — `TurnDiceWindows` pre-rolls exist; no shared gamble effect |
| **Sacrifice** — HP-for-effect, flat vs percent, cost overrides | Dropkick (sacrifice 6), Takedown (sacrifice 4), Great Suplex (up to 6 + fly half), Wolfheart (25%), Inner Furnace (Infuse cost), Crimson King ranks (cost overrides) | partial — `sacrifice` damage type exists; no HP-payment seam |
| **Ability-use blessing/combo spend** — spend 1 token for a package, 3 for the bigger effect; spend combo to activate charge | Blessing of Faith / Rebirth / War (traits), Songweave (trait), Divine Grace (trait), Felicity (fly the marked ally), Umbra talent 2 | missing — resource registry exists, spend seam does not |
| **Use ledger** — once-per-turn/round/combat gates with a recorded key | Midas (`midas:used`), Sucker Punch (`sucker-punch:used`), `interruptUses`, Chain Reaction (`chain-reaction-used`), Bull's Strength guard, Aether Deflection (once per combat) | partial — per-site keys; no shared gate |
| **Movement-entry / -exit trigger hook** | Symphony motes, Warding Bolts (start inside / end outside), Fortress (foe entry damage), Grapple (save to break adjacency), Mist Strider (consume cloud), Underway (portal teleport) | **partial** — voluntary-MOVE entry wired for Party Favor mine (`kernels/movement-triggers.ts`); remaining consumers need content rows; forced-movement entry is a future fold |
| **Delay anchor** — record target at command time, resolve at the marked actor's boundary | Great Giorgios, Six Hells Trigram, Aria, Morrigan, Dragon Dive (`dragon-dive:target`), Assassinate, Showdown, Incubus, Stampede | partial — lifecycle recipes exist; anchor+resolve shape per ability |
| **Area shapes as data** — arc, cross, rotation | Diablo (cross), Pandaemonium (rearrangement rotation); arc shape pending in `computeSpatialArea` | partial — burst/line done |
| **Combo sub-action primitive** — base→combo version swap + token spend | Penumbra, The Hook, Indignation, FLEET, PURGATORIO, DAWN, CHARISM, Sweet Torment, Succubus, Flying Sleeves | partial — `combo` resource + `actionId: 'combo'` per ability |
| **Heroics economy** — make-Heroic choice, lockout, half-damage penalty | Stalwart class trigger, Strive / Demon Strength / Spite / Wolfheart (traits), Heroic masteries | missing — see kernels-needed.md §1.1 |
| **Infuse / Aether cost kernel** — spend Aether for a variant, cost reductions | Wright class trait, Conqueror's Edge, Inner Furnace, relic invokes with Aether spends | missing — `aether` resource exists |
| **Entity action primitive** — detonate, lash-out, dash-bite, fly-3, pickup, portal teleport, consume | Carnevale/Party Favor bombs, seraph, beast, selkie, Comet weapon pickup, Underway portal, Nightmare shadow consume | partial — entity model exists; actions hand-authored |
| **Ally-buff primitive** — grant stealth/vigor/blessing/dodge/aura/fly/dash to allies | Strength of the Pack, Felicity, Uplift, Gwynt, Dervish, Pandaemonium (allies +4 vigor) | partial — condition/vigor mutations exist; selector + grant shape per ability |

## 2. Foes — recipe primitives to add

The `FOE_ABILITY_RECIPES` layer is the model; the remaining 1,247 foe
abilities need these primitives before they convert to data rows:

| Primitive | Consumers (examples) | Status |
| --- | --- | --- |
| Teleport / place / remove movement | foes that reposition (Weapon Vault, teleporters) | missing in recipes (mutation exists) |
| Summon entity + entity actions | bomb, shadow, thrall, shrine, statue, geyser, meteor, waterspout, lightning-spike, underway | partial — `entity` mutation exists; no recipe kind |
| Save effects | foes with save-or-effect clauses | missing in recipes (`save` effect exists) |
| Gamble | foe gambles (Cantrix-style) | missing |
| Aura creation | Commander's Aura, Aura of Shielding, Fortress | missing in recipes (persistent `aura` exists) |
| Ally-targeting | buff ally / cure ally / swap with ally (Redondo has `swap`; the rest) | partial — `requireAllyInRange` helper exists |
| Reactive windows | when-damaged / defeated foe triggers | missing in recipes (windows exist) |
| Multi-step "free action after X" | Soldier Valiant's free Bash, Backbreaker rush-then-attack (`preRush` exists) | partial |
| Multi-instance / divine / pierce variants | Riddle's three hits, divine damage foes | partial — `hitInstances`, `damageType` exist |
| **Mob member model** | mob profiles (up to three members, member-level HP/positions, area targeting) | **missing** — blocked |

Foe-trait passives reduce to the same conditional-projection primitives as
the job/class side: bloodied / 25%-hp / terrain / stealth / status /
adjacency gates, per-status immunity (22), positional/conditional resistance
(18), counter grants (10), aura passives (42), when-defeated triggers, and
round/turn-gated grants (18+24+28) — see kernels-needed.md §2.1.

## 3. Relics — invoke and aspect primitives

The 120 ranks + 40 aspects should become a `RELIC_RANK_RECIPES` /
`RELIC_ASPECT_RECIPES` table like `FOE_ABILITY_RECIPES`, not per-relic code:

| Primitive | Consumers (examples) | Status |
| --- | --- | --- |
| Attack-tagged invoke (cost + trigger threshold) | Ape God rank 1 ("Invoke (Attack, 17+)"), most rank-1 invokes | missing |
| When-condition invoke | Ape God rank 3 (when you stun), Crimson King rank 1 (25% hp) | missing |
| Gambit free-action | Crimson King rank 3 (sacrifice 4, deal 4 in range 4) | missing |
| Passive immunity | Ape God rank 2 (immune to stun) | missing — immunity primitive |
| Wound gamble | Crimson King rank 2 (d6 to ignore a wound, +1 improvement) | missing — wound-taking hook |
| Sacrifice-cost override | Crimson King rank 1 / aspect (reduce to sacrifice 2 or 1) | missing — sacrifice seam |
| Invoke augmentation | Ape God aspect (bonus damage + shoves on invoke) | missing |
| Counter damage-type override | Maiden aspect (counter becomes piercing) | missing — provenance override |
| Movement exception | Erys aspect (diagonal shoves) | missing — movement primitive |
| Rescue hook | Orpheo aspect (defiance when rescued) | missing — rescue seam |

## 4. Advancement — trophy, camp, and reward primitives

| Primitive | Consumers | Status |
| --- | --- | --- |
| Trophy use command (free / 2-action / round-action) | Helm of Command, most trophies | missing |
| Trophy combat passive (attack modifier, aura grant, slay-cure) | Darklight Infuser, Black Book | missing — reuse §1/§2 primitives |
| Trophy expedition effect (persistent buff, recorded rolls) | Golden Mask (d20/d10/d8/d6/d4) | missing |
| Camp-boundary effects (purchase/upgrade Dust, gear swaps, healing, features) | 16 fixtures + 85 features | missing — F3 camp boundary |
| Reward application (XP + Dust award, combat-dust infusion, dust-cap) | 9 reward rules | missing — bookkeeping kernel |

## 5. The shared primitive table

The consolidated build list. A primitive is `existing` (usable today),
`partial` (a hand-rolled shape that should become a recipe row), or `missing`:

| Primitive | Domain | Status | Prerequisite |
| --- | --- | --- | --- |
| Declarative VM vocabulary (effects/selectors/numbers/predicates/durations) | all | existing | — |
| Foe recipe primitives (attack/shove/rush/vigor/mark/swap/dash-strike/blast/terrain/end-turn-stealth) | foes | existing | F0–F3 |
| Lifecycle phases | all | existing | F3 |
| Trigger windows (6) | all | existing | F4 |
| Resources | all | existing | — |
| Power-die stance | jobs/classes | partial | F3 |
| Armed one-shot attack window | jobs/classes | partial | F6 |
| Aura | jobs/foes/traits | partial | F1 |
| Mark-trigger recipes | jobs/foes | partial | mark model |
| Gamble | jobs/traits/relics/trophies | partial | F3 |
| Sacrifice + cost overrides | jobs/traits/relics | partial | F0 |
| Blessing / combo ability-use spend | jobs/traits | missing | resources |
| Use ledger | jobs | partial | F3 |
| Movement-entry/-exit hook | jobs/foes | partial | F1 |
| Delay anchor | jobs | partial | F3 |
| Area shapes (arc/cross/rotation) | jobs/foes | partial | F1 |
| Combo sub-actions | jobs | partial | resources |
| Heroics economy | classes/traits | missing | F0/F3 |
| Infuse/Aether cost | classes/traits/relics | missing | resources |
| Entity actions | jobs/foes | partial | F1 |
| Ally-buff grants | jobs | partial | F1 |
| Mob member model | foes | missing | F1 + roles |
| Relic invoke / rank / aspect recipes | relics | missing | F0–F5 |
| Trophy use / combat / expedition | advancement | missing | F2/F3 |
| Camp-boundary + reward application | advancement | missing | F3 |

## 6. Suggested build order

Aligned with `kernels-needed.md` §6; each primitive ships as a recipe row +
generic factory + fixture, and converts its consumers into data:

1. **Gamble** — the `TurnDiceWindows` pre-roll seam already exists; a shared
   gamble effect unblocks Riposte/Spinning Top/Carnevale/Monogatari/Party
   Favor/Death and later the Stack Dice trait.
2. **Power-die stance** — one recipe shape (size, start, tick, consume)
   replaces the five hand-rolled stance dies and the Exorcism/Godly Smite
   dies.
3. **Armed one-shot attack window** — generalize the F6 armed-state consume;
   folds in Massive Overhead, Trick Shot, Ace, Riposte, Carnevale.
4. **Aura** — radius + per-distance grants + entry effects; unlocks the trait
   and foe-trait aura rows (Shieldmaster, Pelagic Rage, Commander, Abjurer).
5. **Heroics economy + Infuse/Aether cost** — the class-trait triggers,
   Strive/Demon Strength/Spite/Wolfheart, and the relic invoke cost model.
6. **Sacrifice + blessing/combo spend + use ledger** — the resource economy
   primitives that unlock the spend-gated traits and Crimson King.
7. **Mark-trigger recipes + remaining movement-entry hooks + delay anchor** — the
   reactive job traits, mark abilities, and the remaining table-facing
   windows (Symphony motes, Warding Bolts, Fortress).
8. **Relic invoke / rank / aspect recipes** — the 120 ranks + 40 aspects as
   data rows.
9. **Foe recipe primitives + mob model** — the remaining 1,247 foe abilities.
10. **Trophy / camp / reward primitives** — closes advancement.

Gate discipline (from `freebuff-plan.md`): a primitive only counts when it
ships the five foundation requirements — durable record, shared factory,
declarative recipe, closed source-ID manifest, and a deterministic replay
fixture. Never write a per-content resolver; if a slice needs one, the
primitive is missing.
