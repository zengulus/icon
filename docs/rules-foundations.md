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
[`source-fidelity.md`](source-fidelity.md) (**generated** strict
source-fidelity status), [`glossary-executable-inventory.md`](glossary-executable-inventory.md)
(per-term combat-glossary detail), [`../TODO.md`](../TODO.md) (actionable
backlog).

## Source-fidelity auditing (strict)

The engine's capability/closure claims are COMPUTED, not asserted. The strict
audit (`npm run audit:source-fidelity -- --strict`) derives every strong
status from the evidence graph in `src/rules/fidelity/`:

    immutable source (SHA-pinned PDF → byte-verified extraction catalogs)
        ↓  collectRuleSourceUnits() + curated decomposition
    atomic source obligations (stable semantic IDs + passage fingerprints)
        ↓
    explicit disposition (deterministic / player-choice / gm-facing /
    descriptive / table-facing / deferred / conflicted / unclassified)
        ↓
    typed consumer registration + independent semantic contract
        ↓
    proof registry (positive/boundary/negative/exhaustive/replay/integration,
    statically verified against actual test files; line coverage is not proof)
        ↓
    computed obligation status + scope ladder
    (blocked < partial < executable < source-tested < replay-tested < closed)

Key semantics:

- `unclassified` never counts as supported; it blocks closure of its scope.
  Every catalogued source unit is seeded as an unclassified unit-grain
  obligation until deliberately decomposed into curated obligations — that is
  the documented migration state for legacy coverage.
- Source conflicts are executable only via an ADOPTED record in
  `src/rules/source-adjudications.ts`, linked from the obligation.
- The audit distinguishes legitimate incompleteness (lowers status) from
  inconsistent claims of completeness (fails strict mode): dangling
  references, executable claims without consumers/contracts/proofs,
  unadjudicated conflicts used in executable paths, documentation claiming a
  stronger status than computed, generated-doc drift, or a semantic mutation
  accepted by the mutation-resistance oracle.
- The audit framework itself is tested against synthetic fixtures covering
  failure classes A–I (`src/rules/__tests__/fidelity-audit.test.ts`),
  including mutants that pass naive positive-only test suites but violate an
  exhaustive semantic contract.

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

**Scoped range authority (2026-08-28):** `kernels/range.ts` is the single
reusable listed-range authority, queryable by NAMED SCOPE — the default
`attack` scope (the ability's top-level target range, read by both command
gates through `effectiveAbilityRange`) plus source-declared INTERNAL range
scopes (placement selectors such as Dark Sliver's terrain-effect soul-space
and Slay plant placement). A reviewed rule may declare `scopes` so a
modifier like Dark Sliver talent 1's Comeback "increase all ranges by +1"
(p.185) widens the attack AND every internal placement range from one row;
the resolver queries `effectiveScopedRange` by scope key instead of
re-implementing the gate. `rangeModifierRuleScopes(sourceId)` exposes the
covered scope set for the compound-talent completeness manifest.

**Compound-talent completeness manifest (2026-08-28):** a range recipe may
mark a source unit complete by itself ONLY when the unit's complete
semantics are exclusively that range change. Compound talents (Dark Sliver
talent 1's "bonus damage + all ranges", talent 2's "Sacrifice 2 + range 6")
register an explicit composite manifest (`registerCompoundTalentCompleteness`,
`kernels/talent-recipes.ts`) naming EVERY required semantic component — the
range rule (with each required scope), the bonus-damage rule, the pre-use
augmentation — checked against the real registries. The compiler audits such
a unit complete only when every component is wired; removing any one
component (or dropping a declared range scope) fails the audit, so a loose
range-registry membership check can never overclaim a compound talent.

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
`knave.test.ts`. Hole: Vigilance guard/punish are commands, not windows (B4).

### Turn scheduler — AUTHORITATIVE + REPLAY-TESTED

(`turn-scheduler.ts`; stabilized 2026-08.) Pure side/phase decisions recorded
on events; controllers choose actors via TAKE_TURN/GO_SLOW; combat start is
PC-only; alternation with exhausted-side concession; Slow election belongs to
the current round (cleared at reset) while pending Delay (`mustNextTurnBeSlow`)
persists across the boundary and converts to the Charge-visible flag at the
forced turn's start; multi-turn entitlements via registered sources; next-round
planning reads next-round semantics only. Charge recognizes actual Slow turns.
Slow turns have normal action economy.

Production entitlement rows are registered by content
(`automation/content/foes/turn-entitlement-recipes.ts`): an Elite
(`foeKind === 'elite'`, projected durably at construction like `roleId`) owes
2 turns per round (p.299); a Legend (`roleId === 'legend'`) owes one turn per
player character re-read from live encounter state each round
(p.298) re-read from live encounter state each round, defeated PCs included —
a pinned reading of source silence (no
second passage contradicts it), deliberately not a source-adjudication
record. The Slow-phase transition continues the SAME round when the actor
whose forced Delay turn was just consumed still owes leftover normal
entitlement (multi-turn elites/legends); single-entitlement schedules never
reach that branch, so recorded legacy transitions are unaffected.

### Passive projection — AUTHORITATIVE + SOURCE-TESTED

Closed source-ID manifests, never runtime prose parsing: foe-trait keyword
rows (115 reviewed; 79 fully executable, 36 partial), foe role baselines
(Skirmisher/Artillery/Heavy + Guard armor + Legend Juggernaut), mark
projection (Rot → Regeneration / defiance suppression). Closed-negative tests
pin that unregistered rows stay inert (`foe-traits.test.ts`,
`role-baseline.test.ts`, `harvester.test.ts`, `passive-projection.test.ts`).
F5 (2026-08-27): mark-condition projections are now carrier-aware — `matches`
receives the mark's carrier and the encounter state, so a row reads live
carrier state (bloodied, defeated) and the owner's durable record (e.g. the
equipped talent choice), and status grants carry a declared potency
(`grantPotencies`, e.g. Grand Seal t2's pacified+), folded into the projected
status surface.

### Summons / entities / terrain objects — PARTIAL

Entity store with owner caps (six per type), companion exemption from owner
cleanup, bomb/beast/shadow/underway/portal/mist consumers, thrown weapons.
**Entity-creation authority** (`kernels/entity-creation.ts`): the generic
`validateEntityCreation` enforces bounds, size-aware occupancy (no owner
exemption — summoner occupies space like any character per the p.92 general
rule), impassable terrain, and optionally line-of-sight and range from a
declared origin (shared primitives LoS kernel). Origin and range are a
SOURCE-DECLARED PAIRED creation-spatial contract — one optional
`spatial: { origin, originSize, maxRange }` object on the VM `RuleEffect`
entity type and the replay-safe `creationSpatial` on the `RuleMutation`
entity kind — so "range without origin" is unrepresentable by construction.
Fail-closed at both layers regardless of typing: the runtime rejects an
origin selector that resolves to zero actors, more than one actor, or an
actor without a valid on-board position, and rejects a range-without-origin
contract; the reducer (and the kernel) reject a carried origin outside the
battlefield grid or a malformed maxRange-only contract — a malformed input
can never become unlimited creation. Range validation uses the canonical
p.92 footprint distance (L\u221e between occupied footprints), not raw
anchor-cell Chebyshev, and carries the origin actor's Size through the
contract. Mandatory vs optional creation remains a content-layer concern.

**Remaining source-fidelity limitation (Size>1 LoS):** creation LoS is
evaluated through the shared primitives LoS kernel (`line-of-sight.ts`),
which samples a straight segment from a single source space center. ICON
p.92 defines LoS from "any edge of your character's space", so a Size>1
origin's full footprint is not yet represented in LoS sampling; a generic
footprint-aware LoS query through the shared authority is future work.
Entity creation is therefore NOT described as fully Size>1 LoS-correct —
only the range half is footprint-correct today.

**Companion placement is single-authority (2026-08-28):** combat-start
companion summons (`applyCombatStartTraitEffects`, `kernels/lifecycle.ts`)
no longer pick a cell with their own legality checks (`freeCellNear`). The
lifecycle layer deterministically enumerates the ordered candidate cells
within the summon range and carries the FULL candidate list on the entity
mutation (`count: 1`); `validateEntityCreation` picks the first legal
candidate through the central bounds/footprint-occupancy/terrain/LoS/range
authority — so a Size>1 actor can never hide behind a non-anchor footprint
cell, and a LoS-blocked first candidate falls through to the next legal
cell instead of rejecting the whole summon.

**Legacy entity-event compatibility (schema 7, 2026-08-28):** the durable
entity RuleMutation previously carried `creationOrigin` /
`creationOriginSize` / `creationMaxRange`; aa736a6 collapsed them into the
paired `creationSpatial`. `migrateEncounter` is the normalization boundary:
it rewrites legacy spatial fields on entity mutations inside the migrated
event history and held interrupt windows to `creationSpatial`, so an old
event with spatial restrictions can never replay as unrestricted creation
because the reducer reads only the new shape. New command construction never
emits the legacy fields (the type has no such members), and the reducer
fail-closed: an un-migrated legacy-shaped mutation is declined, not
silently executed. The schema version stays 7 — the durable current-state
shape is unchanged; only the audit/display event history is upgraded at the
migration boundary.
Holes: entity actions (a summon taking its own turn) are not modeled; Mob
members absent.

### Mob model — ABSENT
`createFoeFromProfile` rejects mob role. Requires member-level representation.

### Foe phase engine — SKELETON
Profiles parse phases/chapter rules; `ruleState.phaseId` seeds phase 0; no
transition logic executes.

### Combat settlement — AUTHORITATIVE + REPLAY-TESTED
`ENCOUNTER_ENDED` clears per-encounter state (vigor, statuses, marks, stances,
shared resources; objects persist) and grants every player-character actor
exactly +1 personal resolve (p.99, defeated included — the source names no
exception). The durable handoff is `characterFromActor`
(`src/rules/encounter.ts`): projects HP attrition (`hpLost`, measured against
the wounds-adjusted maximum after the projected wound), wounds, and personal
resolve back onto the persistent sheet; `actorFromCharacter` re-enters combat
from that record. Camp/interlude sheet transitions: `campCharacter` heals all
strain, unticks all effort (Bond maximum), heals all HP, and resets personal
resolve (p.253/p.99; wounds persist) / `beginInterlude` additionally restores
wounds (p.56). Tests: `settlement.test.ts` (round-trip combat 1 → settlement →
combat 2, purity, replay, schema v4 migration).

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
| K-P1 | Forced-movement primitives (teleport, place, remove, swap). **DONE (2026-08-27).** Shared spatial gateway `primitives/spatial-intent.ts` (`validateSpatialIntent`/`applySpatialIntent`: bounds, size-aware occupancy, impassable terrain, Rampart p.104 with slip/unstoppable bypass) plus mutation builders `removeMutation`/`placeMutation`/`teleportMutation` and the Swap primitive `swapMutations` in `primitives/job-kit.ts`, whose explicit `SwapMovement` mode carries the source-defined distinction: a **teleporting swap** (Masquerade p.151 "teleporting both" — legs are `movement: 'teleport'`, Rampart-checked) vs a **remove/place swap** (Shadow Play p.163, Redondo p.300, Purgatorio rotation — legs are `movement: 'place'`, not teleports). All four emitters migrated; forced moves never fire movement-entry triggers and never touch turn entitlement. **Swap atomicity is SOURCE-DECLARED** — `swapMutations` tags every leg with a `spatialBatchId`, and the reducer (`kernels/encounter-adapter.ts` `deniedAtomicSpatialLegIndices`) prevalidates only declared groups: the full destination permutation against the same pre-swap state (simulated on a clone so interleaved damage/condition mutations shape the decision), applied every-leg-or-none; the permutation must be injective (no two legs on overlapping footprints). **Occupancy exemption is group-scoped (2026-08-27):** a leg may ignore the footprints of actors in its OWN declared spatial group only — ungrouped legs resolve independently against current occupancy and actors in a different batch are never co-moved with a group, in the live fold, the group prevalidation (a denial fixpoint over declared groups), and every dry run (`collidingShoveTargets`/`reactiveSlayTargets`). Masquerade's action declares `requiresLegalSpatialBatch`, so p.151's "If you or your ally can't make a valid teleport, this interrupt can't be made" rejects the command when any leg is invalid — nothing consumed, redirected, or half-applied | primitives + spatial-intent | Shade Umbra/Penumbra, Fool Masquerade, Redondo, and the promoted census rows: knave Strongarm t1 (program-level remove/place-into-adjacency + range-kernel comeback range), spellblade Nothung t2 (program-level comeback teleport width) | Landed tranche covered by fool/shade/foe suites (rampart-denied teleporting swap vs rampart-crossing remove/place swap), the spatial gateway's all-or-nothing swap matrix (out-of-bounds/occupied/duplicate-destination/rampart denials, three-party rotation, replay), and the occupancy regressions (ungrouped A-into-B's-cell while B's leg fails: denied with no overlap and replay equality; separate `spatialBatchId` groups do not exempt one another; ungrouped pairs no longer swap without a declared batch). Census: the `{teleport}` blocker family is gone — 2 units promoted, 13 reclassified to their true residual blocker sets (the teleport capability itself no longer blocks anything) |
| K-P2 | Interrupt-modifier family | Change rank/add uses/retime an interrupt from content rows | modifier kernel | census `{interrupt-modifier}`×13 | One promoted trait/talent per modifier kind with source fixture |
| K-P3 | Terrain-create / entity-create recipe primitives | **entity-create audited (2026-08-29, F3 + corrective pass):** the entity-creation authority already exists (`kernels/entity-creation.ts` `validateEntityCreation` + `entityMutation` + `freeCellsInRange`), so `entity-create` was NOT a missing primitive — the 16 `{entity-create}` singletons (coarse keyword residues) were reclassified to precise residual blockers. The shared `summonEntity` seam (primitives/job-kit.ts) now declares INTENT as a single creation mutation with an ordered candidate list + requested `count` + a PAIRED `creationSpatial {origin, originSize, maxRange}`, and the reducer's `validateEntityCreation` is the single legality/selection authority (skips bounds/occupied/impassable/LoS/footprint-range/cap candidates and picks the first `count` legal). Corrective fix: the reducer now indexes the discrete id of each cell from a `count>1` candidate-list mutation (previously all shared one `generatedId`, so only the last cell survived). Adopted by the warden beasts, seer wild-cards, and geomancer boulder. **Migration note:** pre-existing ability resolvers that still hand-roll `freeCellsInRange(index)`+`entityMutation` for ordinary summons are tracked for migration; a few are deliberate cell-dependent exceptions (Seer meteor proximity damage, Warden required portal). The `entity-create` blocker label is fully retired — **0 unresolved occurrences**, absent from the greedy simulation. 0 census promotions. **Next census-selected family (regenerated 2026-08-29): `{fly-grant}` (17 immediate)** — extracting the fly/movement-modifier grant — then `{terrain-create}` (16 immediate) under the same single authority | single authority: `entity-creation.ts` + `freeCellsInRange` + `summonEntity` | `{entity-create}` cleared (0 occurrences); next: `{fly-grant}` (17 immediate) | `summonEntity` intent + reducer candidate-fall-through tests (LoS/impassable/occupied/cap/insufficient-cells/replay) pin the mutation shape and replay |
| K-P4 | Fly-grant / movement-modifier family | Grant flight/extra speed/rush scaling durably | modifier kernel | census `{fly-grant}`×11 | Source-exact row + negative |
| K-P5 | Mastery fold | Equipped mastery alters parent program execution. **Landed (2026-08-26):** modifier kernel `kernels/mastery-fold.ts` with `interrupt-rank`, `damage-type` conversion, and `unlimited-range` families; content rows in `content/jobs/mastery-modifier-recipes.ts`; consumed at the USE_ABILITY gate, window scans, and damage-emission points. Remaining families (range/area/repeat/duration) extend the same kernel | execution-time fold over `masteredAbilityIds` (`kernels/mastery-fold.ts`) | 3 modifier-fold wired (Catapult MANGONEL, Nothung EXCALIBUR, Endless Battlement PERFECT BATTLEMENT) + 1 program-level (Demon Claw RAGING DEMON, 2026-08-27) + 3 action-cost-override (Valiant, Shadow Play, Polaris, 2026-08-28); 129 remaining | Fold fires only when mastery equipped; closed negative; per-row source fixtures (landed tranche covered by spellblade/bastion/demon-slayer suites) |
| K-P6 | Bonus-damage grant family | **Landed (2026-08-27, F6a):** `kernels/bonus-damage.ts` — source-ID-free registered grant rules (self/target-bloodied, target-status, scaled counts) folded once at the USE_ABILITY boundary into `abilityUseModifiers.bonusDamageDice`; the roll itself stays the shared keep-highest `damage-roll` / `rollDamageDice` authority (ICON p.102). Content rows in `content/jobs/bonus-damage-recipes.ts`. 4 talent rows + the Finesse class trait promoted; the coarse `{damage-modifier}` census label is gone (remaining rows reclassified: bonus-damage-suppression, damage-maximize, save-or-stun, teleport-distance-modifier, exceed-grant) | use-time fold consumed by the damage authorities | 5 executable rows + Finesse; remaining subfamilies: round-gated dice, exceed auto-grant, damage-suppression, damage-maximize, flat self-ratio | Replay: folded dice ride the recorded mutations; negative gates (talent equipped but gate inactive) |
| K-P6b | Mark-modifier fold (F5, TODO step 6). **Landed (2026-08-27):** the reusable mark-modifier capabilities at the engine's existing mark query points — carrier-aware mark-condition projections with declared grant potency (`passive-projection.ts`, folded into `encounterConditionSet` + the projected status surface), the mark-keyed status-save policy seam (`registerStatusSavePolicySource`), and turn-boundary triggers (lifecycle recipes). Content rows in `content/jobs/mark-modifier-recipes.ts` + `lifecycle-recipes.ts`. 3 units promoted (Grand Seal t1 save curse, Grand Seal t2 pacified+, Rot t2 turn-start adjacency damage); the 9 remaining former `{mark-modifier}` singletons reclassified into precise subfamilies (mark-detonation-window, mark-as-entity-follow, mark-activation-gate, mark-stacking, attack-exceed-trigger, effect-count, terrain-create, choice-input, delivery-immunity) | mark query points (condition projection, save policy, lifecycle) | 3 promoted; 22 units still contain `mark-modifier` in compound sets | Carrier-aware projection positive/negative + live-drop boundary; mark-keyed save curse asserted on a recorded save window; turn-start trigger once per boundary + replay; negative gates (wrong talent choice, not bloodied, not adjacent) |
| K-P7 | Talent subfamily folds (remaining) | **Landed (2026-08-28, F8a):** action-cost-override fold via `CostModifierRule` in `kernels/cost-payment.ts` + `content/jobs/action-cost-override-recipes.ts` (3 pure mastery overrides promoted); **shove-modifier decomposed (F8b)**: 10 pure singletons reclassified with precise blockers (direction-override, conditional-distance-stun, new-shove-effect, foe-trigger-expansion); all resolver-level — no fold consumer. Kernel removed. Compound heave-ho:mastery reclassified to variable-cost only. **charge-state reclassified**: 6 delay-mechanic units removed; the resolver-implemented charge talents had been marked wired from the raw `context.triggers?.has('charge')` trigger. A review (2026-08-29) found that caused talent effects to fire from a generic slow turn WITHOUT proving the talent equipped (Spinning Top t2 flew on any charge; Chaos Tarot area-moved / Terraforming adjacency without rank). Repaired: every talent-specific branch is now gated on `source.talents[abilityId]`. Spinning Top t2, Chaos Tarot t2 and Terraforming t1 are promoted to executable program-level (the base "Charge: Choose four effects" stays talent-independent on Terraforming). Gigaton Whip t2 stays compound/unresolved: its collide fly (2 instead, 3 on charge) is gated+ wired, but the charge "Shove 3" remains unwired (`new-shove-effect`). Wicked Sheath t1's per-charge extra shove is wired but it stays compound (`collide-rider`). Census total 416. Remaining subfamilies: resource-management | cost-payment fold over mastery-equipped + round-gate | resource-management | Exact-ID slices, each with positive/negative/replay |
| K-P8 | Vigilance trigger windows | Guard/punish open from damage/adjacency triggers with once-per-trigger ledger | window protocol | p.105; Artillery Slip interplay | Trigger-driven spend replaces declared-result command; replay fixtures |
| K-P9 | Relic effect runtime | Invokes + persistent rank effects as data-first recipes | recipe layer mirroring foe recipes | 120 relic-ranks, 40 aspects | One invoke + one persistent effect source-exact before breadth |
| K-P10 | Mob member model | Member pool per actor, two-hits removal, slay suppression | encounter model | p.298 Mob | Full Mob encounter test |
| K-P11 | Foe phase engine | Trigger→phase transitions recorded durably; chapter-rule application | reducer seam + recipes | 19 phases, 116 chapter rules | Phased legend executes a transition under replay |

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
| Settlement (was TODO B1 / roadmap P1) | Combat settlement family above |
| §Area / §Range / §Aura / §"Power dice & stances" | Spatial geometry · Attacks · Statuses/stances · Power-die kernel |