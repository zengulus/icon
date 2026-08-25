# Rules foundations — maturity map

Authoritative map of the engine's reusable mechanical foundations: what each
is for, where it lives, how mature it actually is (verified against
implementation and tests, not aspiration), and what content it unlocks. This
file also owns the **missing kernel/primitive ledger** (it absorbed the former
`kernels-needed.md` / `primitives-needed.md`) and the **architecture-debt
ledger**.

Related documents: [`deliverables.md`](deliverables.md) (artifact status),
[`rules-coverage.md`](rules-coverage.md) (content-family coverage),
[`blocker-census.md`](blocker-census.md) (**generated** Class/Job unit graph),
[`glossary-executable-inventory.md`](glossary-executable-inventory.md)
(per-term combat-glossary detail), [`../TODO.md`](../TODO.md) (actionable
backlog).

## Maturity states

| State | Meaning |
| --- | --- |
| ABSENT | No implementation |
| SKELETON | Typed seam/data exist; no execution authority |
| PARTIAL | Executes for real consumers; known semantic holes listed |
| AUTHORITATIVE | Execution matches source semantics for its scope |
| + SOURCE-TESTED | Has independent source-page regression fixtures |
| + REPLAY-TESTED | Additionally proven durable under `applyEvents` replay |

## Foundation families

### Command/event purity — AUTHORITATIVE + REPLAY-TESTED

`executeCommand(input, command, dice)` never mutates input; it plans ordered
durable events from the pre-command snapshot; `applyEvents(input, events)`
reproduces `result.state` exactly. Enforced per-command by
`expectCommandPurity` / `expectRejectedCommandPurity`
(`__tests__/fixtures.ts`, used broadly incl. `command-purity.test.ts`).
Multi-stage commands (forced turn ends, stunned actors, end-turn requests)
plan against an intermediate applied state and append follow-up events — all
durable. Randomness is injected (`DiceSource`); gamble results are rolled once
at the command boundary and ride their events.

Known holes: none open. This contract is the project's strongest asset;
every new mechanic must preserve it (see AGENTS §6).

### Dice & randomness — AUTHORITATIVE + REPLAY-TESTED

Injected deterministic dice; scripted fixtures; boon/curse rolls; bonus-damage
"roll extra keep highest" in attack modifiers; Carnevale/Monogatari gambles
pre-recorded on events.

### Damage — AUTHORITATIVE + REPLAY-TESTED

Determine→apply split (`determineEncounterDamage` /
`applyDeterminedEncounterDamage` in `automation/kernels/encounter-adapter.ts`
+ `damage-resolution.ts` + `damage-ledger.ts`). Order per p.107
(attacker → defender flat reduction → defender multiplication). Armor
(highest wins), resistance (halve round up), weakened/vulnerable per
instance, pierce (`ignoreArmor`), divine (`ignoreDefiance` + `bypassVigor`),
vigor sinks, Defiance floor-once + turn damage-immunity (consumed durably,
p.104), Defy Death via Boiling Blood's armed effect, wounds on PC defeat,
bonus-damage instances, dangerous terrain delivery, damage provenance ledgers.
Held damage rides interrupt windows and re-applies through the same pipeline.
Fixtures: `damage-resolution.test.ts`, `conditions.test.ts`,
`hp-threshold.test.ts`, `interrupts.test.ts`.

Holes: none known at scope; new exceptions must be distinct typed flags
(never overload `divine`).

### Attacks — AUTHORITATIVE + REPLAY-TESTED

Roll + boons/curses, defense comparison, critical ≥20 (+[D], still a hit),
Exceed ≥15 triggers, auto-hit, True Strike (ignores dodge/blind/evasion/
stealth), Unerring (ignores cover/aetherwall), Evasion pre-roll d6, Dodge
delivery filtering, cover & elevation modifiers, Blind/Dazed restrictions,
shared attack-modifier kernel (talent/trait/power-die rows plug in here).
Consumed by basic attacks, VM attacks, and direct resolvers.

### Saves — PARTIAL

Normal saves with modifiers; status-save ledger recorded as mutations on
TURN_ENDED (replay needs no fresh dice); Cure paths; save-reroll windows
(`save-rolled`: Sucker Punch re-roll regenerates branch effects from AST with
the second result). Holes: save-denial breadth, save-trigger riders beyond the
wired set; DAWN-style "+1 boon on saves" remains documented.

### Targeting & target sets — AUTHORITATIVE + SOURCE-TESTED

Self/ally/foe/character/space/entity selectors; Stealth adjacency gate;
summon/object entities as targets; area targeting through shared geometry.
Tests: `targeting.test.ts`.

### Spatial geometry — AUTHORITATIVE (core)

Footprints (size-1), range bands, adjacency, LoS/LoE, burst/blast/line/cone
areas (`area.ts`, `range.ts`, shared `area-geometry.ts`). Hole: p.92 Size
footprints >1 space pending (trait rows project the stat, not the footprint).

### Movement — PARTIAL

Standard move/dash planner with difficult/dangerous/impassable/pit/slope
terrain, elevation, engagement; Flying/Phasing/Skirmisher/Intangible/Rampart
through the folded condition set; Rush; Shove with collide detection; Slashed
once-per-turn after ability moves. Holes: Teleport/Place/Swap/Remove exist
only inside individual job resolvers (see missing primitives F-P1);
movement-entry triggers fire on voluntary MOVE/DASH entry only — source text
with unqualified "enters" (Party Favor p.151, Symphony p.178) awaits the
generic forced-movement fold (AGENTS §8 boundary; do not describe as
source-complete).

### Statuses / conditions / marks / stances / auras — PARTIAL

Condition-set fold (`encounterConditionSet`) merges durable conditions with
passive projections so every kernel sees one set. Wired statuses: dazed,
stunned (stun forces turn end), weakened, vulnerable, slashed, hatred-of-X,
stealth, counter (non-recursive retaliation), defiance, dodge, sturdy,
unstoppable, slip, rampart, regeneration, bloodied derivation, sealed,
pacified, aetherwall, evasion, immobilized. Marks are durable with owners;
stances carry power dice via the power-die kernel. Auras exist for wired rows
(Rook/Dervish/Gentleness/Battlement/Shieldmaster). Holes: aura membership is
row-wired, not a general query API; several delivery matrices remain row-local.

### Resources — COMPLETE

Typed registry (`core.ts` RESOURCE_RULES / SHARED_RESOURCE_RULES): resolve,
personal-resolve, blessing, combo (cap 1), vigilance, aether, bonus-damage,
effort, strain — each with source page, cap, reset scope; reducer-enforced
clamping and encounter resets; spend validation. Tests:
`resources.test.ts`.

### Lifecycle (turn/round boundaries) — AUTHORITATIVE + REPLAY-TESTED

F3 planned-participant lifecycle: turn-start, turn-end, round-start, round-end
phases run exactly the recorded participants (no live re-inference);
boundary-duration expiry; cross-character ordering (non-turn-character first,
hostile before beneficial); party Resolve +1 exactly once per round boundary;
legend Juggernaut clear; per-round flag resets. Voluntary Slow clears at the
round reset; pending Delay survives until consumed (see scheduler below).

### Interrupt / window engine — AUTHORITATIVE for wired triggers

Windows: when-damaged, defeated, uses-ability, area-inclusion,
targeted-by-ability, save-rolled. LIFO pop (most recent first, p.107), stable
total order for simultaneous, retargeting (Masquerade), held effects cloned +
checkpoint-validated + redacted, drain-at-boundary. Deferral priority mirrors
the damage pipeline (mitigated blows don't open phantom windows). Tests:
`interrupts.test.ts`, `bastion.test.ts`, `colossus.test.ts`, `fool.test.ts`,
`knave.test.ts`. Hole: Vigilance guard/punish are commands, not windows (B5).

### Turn scheduler — AUTHORITATIVE + REPLAY-TESTED

(`turn-scheduler.ts`; stabilized 2026-08.) Pure side/phase decisions recorded
on events; controllers choose actors via TAKE_TURN/GO_SLOW; combat start is
PC-only; alternation with exhausted-side concession; Slow election belongs to
the current round (cleared at reset) while pending Delay (`mustNextTurnBeSlow`)
persists across the boundary and converts to the Charge-visible flag at the
forced turn's start; multi-turn entitlements via registered sources; next-round
planning reads next-round semantics only. Charge recognizes actual Slow turns.
Slow turns have normal action economy.

Content gap: **no production entitlement registrations** — Elite double-turn
and Legend per-player turns are unwired (TODO B2).

### Passive projection — AUTHORITATIVE + SOURCE-TESTED

Closed source-ID manifests, never runtime prose parsing: foe-trait keyword
rows (115 reviewed; 79 fully executable, 36 partial), foe role baselines
(Skirmisher/Artillery/Heavy + Guard armor + Legend Juggernaut), mark
projection (Rot → Regeneration / defiance suppression). Closed-negative tests
pin that unregistered rows stay inert (`foe-traits.test.ts`,
`role-baseline.test.ts`, `harvester.test.ts`, `passive-projection.test.ts`).

### Summons / entities / terrain objects — PARTIAL

Entity store with owner caps (six per type), companion exemption from owner
cleanup, bomb/beast/shadow/underway/portal/mist consumers, thrown weapons.
Holes: entity actions (a summon taking its own turn) are not modeled; Mob
members absent.

### Mob model — ABSENT
`createFoeFromProfile` rejects mob role. Requires member-level representation.

### Foe phase engine — SKELETON
Profiles parse phases/chapter rules; `ruleState.phaseId` seeds phase 0; no
transition logic executes.

### Combat settlement — ABSENT
`ENCOUNTER_ENDED` cleans state but grants no personal Resolve and there is no
actor→character handoff (TODO B1; roadmap P1).

### Cost/payment — AUTHORITATIVE + SOURCE-TESTED
Action costs, resource spends, resolve pools (party + personal), sacrifice,
expenditure validation (`cost-payment.ts`). Limit Break payment works; effect
bodies do not exist.

---

## Missing kernels & primitives (consolidated ledger)

Ordered by fan-out (see `blocker-census.json` `blockerFrequencies`). Each item
states responsibility, layer, likely consumers, and acceptance bar. **No
per-content resolvers**: if a content slice needs bespoke code, the missing
item is here, not in content.

| ID | Kernel/primitive | Responsibility | Layer | Consumers / examples | Acceptance |
| --- | --- | --- | --- | --- | --- |
| K-P1 | Forced-movement primitives (teleport, place, remove, swap) | Shared, Sturdy/Rampart-aware repositioning mutations replacing resolver-local copies | primitives + spatial-intent | Shade Umbra/Penumbra, Fool Masquerade, Bastion swap rows, census `{teleport}`×15 | Behavior-preserving migration of existing resolvers with unchanged golden fixtures + unit tests per primitive |
| K-P2 | Interrupt-modifier family | Change rank/add uses/retime an interrupt from content rows | modifier kernel | census `{interrupt-modifier}`×13 | One promoted trait/talent per modifier kind with source fixture |
| K-P3 | Terrain-create / entity-create recipe primitives | Generalize existing program-local creation (pits, clouds, bombs, beasts) into parameterized factories | recipe factories | Warden Mist Strider, Colossus pits, census ×13+13 | New recipe kind compiles to program + resolver; golden replay |
| K-P4 | Fly-grant / movement-modifier family | Grant flight/extra speed/rush scaling durably | modifier kernel | census `{fly-grant}`×11 | Source-exact row + negative |
| K-P5 | Mastery fold | Equipped mastery alters parent program execution (range/area/damage/repeat/duration modifiers first) | execution-time fold over `masteredAbilityIds` | 136 masteries | Fold fires only when mastery equipped; closed negative; per-row source fixtures |
| K-P6 | Talent subfamily folds | resource-management, action-type-change, charge-state, shove-modifier | talent fold extensions | ~200 remaining talents | Exact-ID slices, each with positive/negative/replay |
| K-P7 | Vigilance trigger windows | Guard/punish open from damage/adjacency triggers with once-per-trigger ledger | window protocol | p.105; Artillery Slip interplay | Trigger-driven spend replaces declared-result command; replay fixtures |
| K-P8 | Relic effect runtime | Invokes + persistent rank effects as data-first recipes | recipe layer mirroring foe recipes | 120 relic-ranks, 40 aspects | One invoke + one persistent effect source-exact before breadth |
| K-P9 | Mob member model | Member pool per actor, two-hits removal, slay suppression | encounter model | p.298 Mob | Full Mob encounter test |
| K-P10 | Foe phase engine | Trigger→phase transitions recorded durably; chapter-rule application | reducer seam + recipes | 19 phases, 116 chapter rules | Phased legend executes a transition under replay |

## Architecture-debt ledger

Debt classes: **A** correctness-threatening · **B** high-cost scaling debt ·
**C** harmless temporary debt.

| Item | Class | Notes |
| --- | --- | --- |
| `src/rules/encounter.ts` ≈2.7k lines (41 command cases + event reducer + dozens of helpers) | B | Known hotspot. Extract only along reusable seams (AGENTS §7); do not refactor for size alone |
| Content imports in orchestration: `tickGallowsHumorDie` (job lifecycle recipe) imported directly by `encounter.ts`; `cheat-time` mark special case inside `EXECUTE_RULE`; Demon Slayer delay key read by the scheduler (`DELAYED_SLOW_KEY`) | C→B | Works today, direction-safe-ish (scheduler reads an opaque ruleState key, not a source-ID switch), but each new special case erodes the content→kernel direction. Prefer registering these through the lifecycle/modifier registries when touched |
| `createFoeFromProfile` parses HP out of `traitsText` via regex | C | Fragile extraction seam; move to generated stats when extraction changes |
| Module-level mutable registries (`registerTurnEntitlementSource`, slow-eligibility, manual allowlist, lifecycle recipes) | C | Deterministic at import; observed test-only hazard: registrations leak across tests within a file (newer tests must use unique names/keys). Consider a reset hook for tests only |
| `vtt-room.ts` mixes table domain, validation, and encounter projection (≈1.2k lines) | C | Split if it grows further |
| Duplicated Lab/Sandbox fixture construction | C | BrowserVtt vs Sandbox both define `createLabFixture`; consolidate opportunistically |

Nothing currently rises to class **A**: no correctness-threatening coupling
was found between universal orchestration and source-specific IDs (the
scheduler and damage kernels stay source-ID-free).

## What NOT to abstract

The following are settled; further abstraction would be churn: the
command/event purity contract; the resource registry; the passive-projection
closed-manifest pattern; the foe declarative recipe factories; the held-window
protocol; the turn-scheduler decision-recording shape.

---

## Appendix A — historical numbering map

Code and test comments across the repository cite this document with the
foundation IDs (F0–F14) and section numbers of the pre-2026-08 rewrite. Those
references remain meaningful through this map:

| Historical ID / section | Current family |
| --- | --- |
| F1 / "Damage and defeat kernel" | Damage |
| F2 / §3 | Saves (SaveWindow) |
| F3 / §4 | Lifecycle (turn/round boundaries) |
| F4 / §5 | Interrupt / window engine (trigger provenance) |
| F5 / §6 | Passive projection (+ role baselines, HP thresholds) |
| F6 / §7 | Job-trait wiring homes, combat-start grants, summons, attack-path modifiers |
| F7 / §8 | Talent fold; gamble seam; ability-use choice seam |
| F8 / §Mastery | Mastery fold (now K-P5 under Missing kernels) |
| F9 | Reactive once-per-round folds; range semantics |
| F10 | Gamble window; ability-use choices |
| F14 / §10 item 1 | Cost/payment |
| §Area / §Range / §Aura / §"Power dice & stances" | Spatial geometry · Attacks · Statuses/stances · Power-die kernel |