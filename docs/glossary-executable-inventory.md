# Combat Glossary — executable-status inventory

The map from every named mechanic in the ICON 1.5 **Combat Glossary**
(pp.102–105, the source-defined combat vocabulary) to its execution status in
the engine, and the exact capability still needed for **fully executable
automation** (AGENTS.md §11: source-exact mechanics + audit allowlist + source
fixture + positive/negative/replay test).

This is the working gap analysis for the "make each glossary mechanic
executable" pass. It is not itself a coverage claim — `npm run audit:automation`
and the phase gates are the only authority for "executable". Where an entry is
marked PARTIAL/NOT, that does **not** grant it executable status; it stays
source-visible with the named gap.

Status legend:

- **EXECUTABLE** — runs through a verified shared kernel/reducer path with
  source fixtures and replay tests (the audit row is complete).
- **PARTIAL** — the fundamental shape exists (a typed mutation / kernel seam)
  and some consumers execute, but not every glossary-defined semantic is
  exercised by a durable, replay-safe engine path.
- **NOT** — no source-exact executable path; modeled only, or fixture-only.

---

## A. Damage and attack vocabulary

| Glossary term | Contract (page) | Implementation path | Status | Gap for FULL |
| --- | --- | --- | --- | --- |
| Armor X | Reduce all damage by X, highest wins (102) | `damage-resolution` flat reduction; Heavy/ect armor bonus | EXECUTABLE | — |
| Resistance | Half damage, round up (102) | one-final-halving in `encounter-adapter` | EXECUTABLE | — |
| Pierce | Ignore armor and Weakened (104) | `ignoreArmor` provenance flag | EXECUTABLE | — |
| Divine | Unmitigable except immunity; bypass vigor (104) | `ignoreDefiance` + `bypassVigor` typed flags | EXECUTABLE | — |
| Weakened / Vulnerable | −2 dealt / +1 taken per instance (104) | per-instance in `damage-resolution` | EXECUTABLE | — |
| Bonus damage | +1[D] per instance, pick highest (102) | `bonus-damage` resource + `attack-modifiers` | EXECUTABLE | — |
| [D] / Fray damage | class die / fixed fray (82, 92) | `job-kit`/`attack-resolution` | EXECUTABLE | — |
| Critical Hit | total 20+, +[D], still a hit (94, 103) | `attack-resolution` | EXECUTABLE | — |
| Exceed | total 15+, a triggered effect (95, 103) | VM attack roll threshold + F7 fold | EXECUTABLE | — |
| Auto-hit | no roll, always hit, never crit/miss (102) | VM `attack.autoHit` | EXECUTABLE | — |
| Damage order | attacker→defender reduction→defender mult (107) | `damage-resolution` | EXECUTABLE | — |

## B. Defensive / reactive positive effects

| Glossary term | Contract (104–105) | Implementation path | Status | Gap for FULL |
| --- | --- | --- | --- | --- |
| Defiance | floor at 1 once, then damage-immune for the turn (104) | `defeatActor`/attack preview floor + immunity | EXECUTABLE | — |
| Evasion | d6 on attack, 4+ auto-miss, before the roll (104) | `attack-resolution.evasionRoll` | EXECUTABLE | — |
| Dodge | immune to misses / successful saves / areas (104) | `damage-resolution` delivery filtering | EXECUTABLE | — |
| True Strike | ignores dodge, blind, evasion, stealth (104) | attack path | EXECUTABLE | — |
| Unerring | ignores cover and aetherwall (105) | attack path | EXECUTABLE | — |
| Regeneration | if bloodied, +4 vigor at turn end (104) | F5 condition projection + F3 turn-end `gainVigor` | EXECUTABLE | — |
| Rampart | foes can't enter/exit by dash/fly/teleport (104) | `spatial-intent.rampartObstructed` | EXECUTABLE | — |
| Flying / Phasing / Skirmisher / Intangible | movement/obstruction/engagement (104) | spatial + movement planner | EXECUTABLE | — |
| Sturdy | foe move/place ≤1 space/turn (104) | forced-movement clamp from the durable condition set | EXECUTABLE | fidelity nicety only: the ≤1 clamp is re-derived from the durable condition set at replay (deterministic, since the set is durable) |
| Counter | when damaged by an ability, deal 2 back per applied instance (104) | `retaliate` on every applied damage instance, guarded by `allowCounter` (no reaction loop) | EXECUTABLE | 6 Counter-granting foe-trait rows wired (howler, war-beast, crystalline-demon, blade-of-agony, fanged-hob; Doomcloak Flying/Sturdy/Counter/Defiance) — reflect proven in `conditions.test.ts` + `foe-traits.test.ts` |
| Vigilance X | spend charges for range-2 guard / adjacency punish, once per trigger (105) | dedicated `SPEND_VIGILANCE` reducer path (guard/punish + d6 roll + charges) | EXECUTABLE | fidelity refinement only: guard/punish are chosen by command rather than opened from a trigger record |
| Stealth | cannot be directly targeted except from adjacency; breaks on abilities (104) | `targeting` gate | EXECUTABLE | — |
| Unstoppable | immune to statuses; can't be moved by foes; ignores engagement/rampart (105) | positive-effect condition | EXECUTABLE | — |

## C. Statuses (pp.104)

| Status | Contract | Path | Status | Gap for FULL |
| --- | --- | --- | --- | --- |
| Slashed | 4 dmg after self/ally ability that moves you, once/turn | `applySlashedAfterAbilityMove` | EXECUTABLE | — |
| Blind | max range 2 | targeting (Blind-range) | EXECUTABLE | — |
| Dazed | +1 curse on attacks | attack roll | EXECUTABLE | — |
| Hatred of X | half dmg to others, ends at turn end / X untargetable-immune | `hatred-of` provenance in damage halves | EXECUTABLE | — |
| Pacified | half dmg; breaks on foe-ability damage | damage + condition break | EXECUTABLE | — |
| Sealed | cannot inflict statuses | status application gate | EXECUTABLE | — |
| Shattered | cannot gain/benefit from vigor | `gainVigor` denial | EXECUTABLE | — |
| Stunned | no interrupts; next ability ends turn; then ends | interrupt gate + forced END_TURN | EXECUTABLE | — |
| Weakened / Vulnerable | see §A | damage | EXECUTABLE | — |
| Ongoing (+) | can't be saved/removed until source ends | condition `potency: 'plus'` + ownership | EXECUTABLE | — |

## D. Movement / battlefield

| Glossary term | Contract | Path | Status | Gap for FULL |
| --- | --- | --- | --- | --- |
| Standard move / Dash / Rush / Fly / Teleport | pp.88, 103 | VM `move` + `spatial-intent` | EXECUTABLE | — |
| Shove X / Collide | move away / collide into obstruction (103, 95) | `shoveResolution` + `collidingShoveTargets` | EXECUTABLE | — |
| Engagement / Orthogonal / Obstruction | movement costs / rules (88, 103) | movement planner | EXECUTABLE | — |
| Remove / place | not movement; no movement triggers (88) | VM `place`/`remove` | EXECUTABLE | — |
| Terrain (difficult/dangerous/impassable/slope/pit/object) | pp.89, 103 | terrain kernel | EXECUTABLE | object **destroy** (10 HP, auto-hit, fail saves) is a partial seam |
| Cover | half ranged damage; at-application (92) | damage + targeting | EXECUTABLE | — |

## E. Cost / economy / triggered vocabulary

| Glossary term | Contract | Path | Status | Gap for FULL |
| --- | --- | --- | --- | --- |
| Cure | +4 vigor, surge if bloodied, save statuses (102) | `status-saves`/Recover | EXECUTABLE | — |
| Boon / Curse | ±highest d6, cancel 1:1 (82) | `rollBoonOrCurse` | EXECUTABLE | — |
| Blessing | token; default +1 boon on a save (102) | blessing resource + `save-window.modifiers` | EXECUTABLE | — |
| Combo | base→token→combo version (103) | `combo` resource + combo actions | PARTIAL | the **spend-augment** seam (spend tokens to augment/charge any ability — Songweave, blessing traits, Infuse) needs a durable spent-choice input on USE_ABILITY |
| Gamble | d6, effect on result-or-higher (103) | `gambleD6` in `job-kit` + `recordedDice` in `TurnDiceWindows` | **EXECUTABLE** | the trait-level dice-window consumers (Stack Dice, Bend Fate, Golden Mask) need a non-ability gamble hook |
| Sacrifice X | cost at start, non-mitigable, floor 1, may overpay (102) | VM `sacrifice` cost | PARTIAL | a reusable **cost-override** seam (reduce/ignore a sacrifice cost — Crimson King, Conqueror's Edge Infuse) with the exact non-mitigable/floor-1 contract as a typed modifier |
| Power Die | point-contact die, tick/discard-at-0 (103) | per-stance `ruleState` dies | PARTIAL | a shared power-die primitive (size/start/tick/consume/discard-at-0) replacing the hand-rolled stance dies |
| Mark | ongoing; one per ability per char; replace choice (103) | `mark` mutation + ownership | EXECUTABLE | mark **trigger** windows (turn-start/adjacency/etc.) remain reactive-window work |
| Stance | ongoing positive; one at a time; drop/refresh (103) | `stance` mutation | EXECUTABLE | multi-stance entry gate (Martial Master) |
| Interrupt | off-turn, ranked, one per turn, refresh at turn start (91) | F4 trigger windows + `interruptUses` | EXECUTABLE | — |
| Delay | next turn slow; activates at start (95, 103) | F3 lifecycle `delayed` phase | EXECUTABLE | — |
| End turn | ability ends your turn; one chosen (103) | reducer path | EXECUTABLE | — |
| Triggered effects (charge/collide/comeback/exceed/slay/finishing-blow/heroic/infuse/chain-reaction) | pp.95, 102–103 | VM triggers + F7 talent fold + program resolve | EXECUTABLE | heroic/infuse/chain-reaction are ability-level and only fire where a source unit wires them |
| Summon | intangible; not foe/ally; removed on defeat (95, 104) | `summon-recipes` + `entity` mutation | PARTIAL | entity **action suites** (lash-out/dash-bite/fly/detonate) need the entity-action seam |
| Aura X | continuous ongoing effect in range X of an origin (102) | `kernels/aura.ts` — membership kernel, projection, attack modifiers | **EXECUTABLE** | some compound aura consumers (entry/exit triggers, complex foe-aura interactions) remain unresolved |
| Rebound | bounce off a character in range; redirects (103) | Trick Shot armed variant only | **NOT** | a general rebound/redirection seam (origin re-placement + LoS/cover from the new origin); used by Trick Shot and Heracule mastery |

## F. Special states (p.104)

| Glossary term | Contract | Path | Status | Gap |
| --- | --- | --- | --- | --- |
| Bloodied | at or under 50% base HP (104) | `isBloodied` (wound-aware) | EXECUTABLE | — |
| Immobile | can't move, be moved, be removed (104) | `spatial-intent` | EXECUTABLE | — |
| Incapacitated / Defeated | no turn; effects/summons end; rescue (101, 104) | `defeatActor` + `removeOwnedEphemera` | EXECUTABLE | — |

---

## Prioritized implementation queue (fully executable automation)

Order by (already-blocked-on-existing-foundation) × (breadth) × (correctness/
replay risk), consistent with the ontology-first build order:

**Corrected reality:** Counter, Sturdy, and Vigilance are **already
engine-executable** (they were never fixture-only). Their remaining gap is not
an engine mechanism but **source-consumer wiring** (audit-completeness) — the
genre of work that is indeed simple but numerous. The true engine-mechanism
gaps that remain are actual subsystems, each needing a focused pass:

A. **Source-consumer wiring (simple but numerous)** — make the already-executable
glossary mechanics audit-complete by wiring granting source rows: the 6 pure
**Counter-granting foe traits** are now wired (howler, war-beast,
crystalline-demon, blade-of-agony, fanged-hob + Doomcloak); the remaining
tranche is the **Regeneration / Dodge / Stealth / Unstoppable / Flying /
Phasing / Skirmisher / Rampart** projection rows that lack a closed source-ID
recipe, and the **Vigilance-granting** trait rows. Each = a closed-id recipe
row + fixture + positive/negative/replay test.

B. **Engine mechanisms genuinely missing (subsystems):**
   1. **Power-die primitive** — one recipe shape for the hand-rolled stance dies.
   2. **Ability-use spend-augment seam** — durable spent-choice input on USE_ABILITY.
   3. **Cost-override seam** — sacrifice/Infuse cost reduction (non-mitigable/floor-1).
   4. **Rebound seam** — origin re-placement + LoS/cover from the new origin.
   5. **Entity action seams + object-destroy model** — companions' suites; destructible objects.
   6. **Mark-trigger windows** — turn-start/adjacency mark gates.

None of the B items is safely completable mid-stream; each is a focused
foundation-sized pass (the ontology build order already sequences them).

Each item ships only when it meets AGENTS.md §11 (source-exact + allowlist +
fixture + positive/negative/replay). Correctly unresolved is better than
incorrectly executable.
