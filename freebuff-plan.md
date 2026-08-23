# Freebuff plan — foundational concepts for full content coverage

This is a planning document for completing ICON rules-execution coverage. It
reviews the two authoritative ledgers — [`docs/rules-foundations.md`] and the
**Content coverage inventory** in `TODO.md` (plus [`docs/rules-coverage.md`])
— and turns them into one ordered plan. The per-domain kernel inventory that
must exist before the `documented` rows promote lives in
[`docs/kernels-needed.md`]; the reusable building blocks (primitives) those
rows should be composed from, and the hand-rolled patterns to factor out,
live in [`docs/primitives-needed.md`]. It is **not** a coverage claim: the
audit (`npm run audit:automation`) and the phase gates remain the only
authority for "done".

[`docs/rules-foundations.md`]: docs/rules-foundations.md
[`docs/rules-coverage.md`]: docs/rules-coverage.md

---

## 1. Review — where the engine is

The source artifact is content-complete: all 501 pages are extracted,
indexed, and credited. What remains is *execution* coverage, and the audit
says it plainly:

| Measure | Count |
| --- | ---: |
| Traceable source programs | 3,275 |
| Reviewed executable programs | 303 |
| Explicitly unresolved clauses | 3,350 |

The interesting fact: the remaining 3,350 unresolved clauses are **not** 3,350
unique mechanics. They are 3,350 instances of a few dozen source behaviors,
repeated across ~1,365 foe abilities, 655 foe traits, 288 talents, 144
masteries, 120 relic ranks, and the supporting/core rules. Everything that is
already complete was completed **once** by building a shared contract, then
replayed for every instance:

- All 144 Job abilities: one `primitives/job-kit.ts` + `docs/job-template.md`, 16 thin
  program files.
- 20 reviewed foe abilities: one `FOE_ABILITY_RECIPES` table + `primitives/foe-kit.ts` +
  `docs/foe-template.md` — *zero* per-ability resolver code.
- 36 foe trait IDs: one closed manifest in `content/foes/trait-recipes.ts` /
  `kernels/passive-projection.ts`.
- Shared resources: one typed registry in `src/rules/core.ts`.

**Conclusion:** finishing coverage is not a volume problem. It is the problem
of building the remaining ~6 cross-cutting foundations below as the same kind
of durable, shared, template-driven machinery, in the order the damage/target/
save/turn contracts dictate. Once a foundation exists, its content areas
become data authoring plus fixtures — exactly what the Job and foe slices
proved.

---

## 2. The method — every foundation ships as five things

Each foundation below is "done" only when it ships together, the way
`primitives/damage-resolution.ts`, `primitives/job-kit.ts`, and `kernels/foe-recipes.ts` did:

1. **A durable typed record** (checkpoint-validated, redacted by ownership,
   bounded JSON) — the ledger entry the event log serializes and replay
   consumes.
2. **A shared pure kernel** — a framework-free function that computes the
   outcome with no side effects (like `determineDamage`,
   `applyDeterminedDamageToVitals`, `resolveAttackRoll`), used by *both*
   command construction and replay so the recorded result always matches.
3. **A declarative template / recipe** — content enters as data, never as new
   resolver code: a typed table (like `FOE_ABILITY_RECIPES`) plus a doc
   (like `docs/job-template.md` / `docs/foe-template.md`).
4. **A closed source-ID manifest** — explicit allowlist/recipe tables keyed by
   exact `sourceId`; nothing is inferred from prose, titles, or role labels at
   runtime.
5. **A matrix of replay fixtures** — the "required foundation tests" in
   `rules-foundations.md`, not just happy-path units.

Hard rule inherited from the TODO: **no new per-content resolver**. If a new
slice of content needs a resolver written for it, the foundation is missing,
not the content.

---

## 2.5 Execution status

| Foundation | Status | Evidence |
| --- | --- | --- |
| F0 Damage ledger | **Executed.** Durable `DamageLedgerEntry` record + `applyDamageLedger` consumer routing by handoff; the four split event shapes (`ACTOR_MOVED` terrain, `ATTACK_RESOLVED`, `VIGILANCE_SPENT`, `ABILITY_RESOLVED.attack`) migrated with legacy fallback; the `AttackResolutionLedger` (legal target/range/LoE, cover, attack-window choices, nested downstream damage) on new `ATTACK_RESOLVED` events; `docs/damage-template.md`; the full required matrix (`__tests__/damage-ledger.test.ts`: same blow through basic attack, VM, terrain, held, delayed/Slashed, reactive Counter, plus floor/legacy/ledger-only cases). Remaining: replay opening windows from the ledger records — the F4 trigger-provenance handoff. | `damage-ledger.ts`, `docs/damage-template.md`, `__tests__/damage-ledger.test.ts`, `rules-foundations.md` §1 |
| F1 SpatialIntent | **Executed (destination + areas).** `spatial-intent.ts` — the `SpatialIntent` destination kernel (bounds, occupancy, impassable terrain, rampart p.104; batch co-moved swaps) and `computeSpatialArea` (burst/line center legality + reach + free-center, p.95 cells + inclusion), with `applyMovement`'s place/teleport/rush/fly paths and the generic foe blast resolver routed through them; VM rushes/dashes into Fortify rampart now denied (matching the movement planner); `docs/target-template.md` (p.92 footprint matrix — area rows done); `__tests__/spatial-intent.test.ts` authority rows. Remaining: footprint (p.92) + line-of-effect + arc rows, direct gates/selectors adoption, target sets/cardinality. | `spatial-intent.ts`, `docs/target-template.md`, `__tests__/spatial-intent.test.ts`, `rules-foundations.md` §2 |
| F2 SaveWindow | **Executed.** Generalized durable record in `save-window.ts` — every save emits `windowKind` (`status-clear` / `cure-immediate` / `effect` / `movement`), the `modifiers` breakdown (source + policy boon/curse + Blessing), `threshold`, the denial `forced` flag, and the continuation `branch` AST. Status, Cure, Penumbra, VM save effects, and the Six Hells exit save all route through `resolveSaveWindow`; the movement gate records on `ACTOR_MOVED.exitSave` (p.129, no more raw d20). Sucker Punch held deliberately by kind (`effect`-only, with the re-roll recomputing the modifier from the held record); `docs/save-template.md`; replay pairs per kind in `__tests__/save-window.test.ts` (relic/legend saves construct the same `effect`-kind spec). Remaining: generic p.102 Blessing *input* per `windowId`, and the F3 lifecycle for the failed-exit lockout. | `save-window.ts`, `docs/save-template.md`, `__tests__/save-window.test.ts`, `rules-foundations.md` §3 |
| F3 TurnTransitionIntent | **Executed.** Every `TURN_ENDED` carries the durable intent: `cause`, ordered lifecycle `participants`, JSON-clean `diceWindows` (Carnevale p.150 / Monogatari p.179 gambles pre-rolled at the command boundary), and `roundAdvance`. `planTurnTransition` plans at command time; `runLifecyclePhase` executes exactly the recorded participants (bite-tested: stripping a participant suppresses the hook even when its gate still passes; legacy events without an intent fall back to the applies gates). All hand-wired hooks migrated into the closed `LIFECYCLE_RECIPES` registry incl. the `delayed` phase (Great Giorgios at its historical post-reset position); dead resolvers deleted from `encounter.ts`; `docs/lifecycle-template.md`; cause parity (voluntary / ability-tag / forced-status / rule-requested) and registry replay pairs in `__tests__/turn-transition.test.ts`. Remaining: p.102 Blessing input per `windowId`, the failed-exit lockout as a turn-start recipe, round-start/round-end recipe phases for content that needs them. | `kernels/lifecycle.ts`, `docs/lifecycle-template.md`, `__tests__/turn-transition.test.ts`, `rules-foundations.md` §4 |
| F4 TriggerWindow | **Executed.** `trigger-window.ts` — the closed `TRIGGER_WINDOW_RECIPES` registry keyed by trigger (`when-damaged` / `defeated`, ordered by p.107 specificity), `decideDamageWindow` as the single decision point shared by the VM path (`applyDamage` now routes its hold decision through it) and the split-event path (`attackEvents` records the decision on `AttackResolutionLedger.window` + the nested damage ledger at construction). `applyDamageLedger` opens the window from the recorded `DamageLedgerEntry.window` — the F0 handoff — holding the blow until the interrupt answers or the boundary drains it, with `ACTOR_DEFEATED` suppressed for a held blow and unknown triggers declined safely; `docs/trigger-template.md`; fixtures in `__tests__/trigger-window.test.ts` (when-damaged + defeated windows, VM/split parity, record-bite, closed-registry negative). Remaining: Counter/Vigilance/Sturdy promotions from the ledger records (F5), Masquerade-style deferred-effect windows as registry rows. | `trigger-window.ts`, `docs/trigger-template.md`, `__tests__/trigger-window.test.ts`, `rules-foundations.md` §5 |
| F5 Passive projection + role baselines | **Executed.** Rot mark projection (p.186) from the first slice, plus the p.298 role baselines: `FOE_ROLE_BASELINE_RECIPES` keyed by role (`skirmisher` → `dodge`, `artillery` → `slip` + `aetherwall`, `heavy` → `rampart`; mob/leader/legend none) folded into `encounterConditionSet` via `projectedRoleConditions`, the Heavy Guard armor-2 kernel mechanic (`guardArmorBonus`: self + same-side orthogonally adjacent allies), and the Legend Juggernaut round-start status/mark clear; fixtures in `__tests__/role-baseline.test.ts` (dodge prevention, slip-rampart dash, aetherwall halving, heavy rampart denial, guard-armor self/ally, juggernaut round clear, closed-registry negatives — bite-verified). Remaining: Defiance/Counter/Dodge/Sturdy/Stealth/Unstoppable still have no reviewed passive source (fixture-only until a source unit is promoted with its matrix). | `kernels/passive-projection.ts`, `docs/passive-template.md`, `__tests__/role-baseline.test.ts`, `rules-foundations.md` §6 |
| F6 Job traits | **Executed.** All 65 Job traits cataloged in the closed `JOB_TRAIT_RECIPES` inventory (22 `wired` / 43 `documented`). Wiring homes: condition projections (`JOB_TRAIT_CONDITION_RECIPES`: martial-arts dodge, shadow-arts phasing, regeneration), combat-start durable grants + companion summons (`COMBAT_START_TRAIT_RECIPES`, applied once on `ENCOUNTER_STARTED`; companions survive the owner's defeat; entity caps per type at six via `content/jobs/summon-recipes.ts`), lifecycle recipes incl. the `round-start` phase (True Horn, Blackheart status-counted vigilance, Mark of Tsumi, Godly Smite mantra tick, Furious Berserk, the round-5 rages, Hissatsu arming, Demon Edge window expiry, Bull's Strength guard clear), typed active resolvers (taunt, klingenkunst through `EXECUTE_RULE`), the **attack-path modifier kernel** (`kernels/attack-modifiers.ts`: Demon Edge slow-turn/delay arming + true strike, Hissatsu no-attack arming + boon/true strike/d10, Pulverize elevation flat +2 and exceed on 13+, Bull's Strength collide damage through `collidingShoveTargets`, shared by both attack sites), and command/kernel hooks (Path of the Aesi free Dash, Green Kenning terrain immunity). Replay executes exactly the recorded participants and `planTurnTransition` evaluates turn-start/round-start gates against the next round; fixtures in `__tests__/job-traits.test.ts` (20) + `__tests__/summons.test.ts` (7) + `__tests__/attack-modifiers.test.ts` (13), bite-verified; `docs/job-trait-template.md`. | `content/jobs/job-trait-recipes.ts`, `content/jobs/job-trait-resolvers.ts`, `content/jobs/summon-recipes.ts`, `kernels/attack-modifiers.ts`, `docs/job-trait-template.md`, `__tests__/job-traits.test.ts`, `__tests__/summons.test.ts`, `__tests__/attack-modifiers.test.ts`, `rules-foundations.md` §7 |

---

## 3. The foundational concepts

### F0 — Damage ledger: `DamageIntent → DeterminedDamage → AppliedDamage` (+ `AttackResolution`)

- **Source:** pp.89, 93–95, 102–105, 107.
- **Seam today:** `primitives/damage-resolution.ts` (pure arithmetic), `primitives/attack-resolution.ts`
  (pre-damage roll), `encounter-adapter.ts` (`EncounterDamageIntent`,
  `determineEncounterDamage`, `applyDeterminedEncounterDamage`,
  `determineAndApplyEncounterDamage`, `applyHeldDamage`, `defeatActor`,
  `prospectiveAppliedDefeat`). The split between source amounts and
  already-determined amounts is explicit; `defianceTriggered` provenance now
  survives on legacy events.
- **Done:** the durable `DamageLedgerEntry` record in `damage-ledger.ts` ties
  one damage instance to its full provenance — handoff side, source, target,
  delivery, cover/dodge exceptions, HP/vigor split, the Defiance/Defy Death
  application floor, defeat result, and interrupt-window state — and
  `applyDamageLedger` is the single replay consumer routing by handoff. The
  split event shapes (`ACTOR_MOVED` terrain, `ATTACK_RESOLVED`,
  `VIGILANCE_SPENT`, `ABILITY_RESOLVED.attack`) carry the ledger with legacy
  fallback; new `ATTACK_RESOLVED` events also carry the `AttackResolutionLedger`
  (legal target/range/LoE provenance, command-time cover, attack-window
  choices, nested downstream damage); `docs/damage-template.md` is the
  decision procedure; the `__tests__/damage-ledger.test.ts` matrix covers
  every required path.
- **Shared functions to extend:** `determineEncounterDamage` /
  `applyDeterminedEncounterDamage` remain the only two application entry
  points; every new damage path (delayed effects, relic invokes, legend
  abilities) constructs an `EncounterDamageIntent` (or a `DamageLedgerEntry`
  for serialized events), never a bare number.
- **Template:** `docs/damage-template.md` — the "which side of the handoff
  does this serialize?" decision procedure from the foundations TODO.
- **Unblocks:** the 70 `core` units, delayed/multiple-hit effects, relic
  invokes, foe abilities with damage, and every defense that still says
  "TODO: do not promote yet" (Counter's exact trigger, Dodge delivery,
  Sturdy, Defiance delivery matrices).

### F1 — Spatial gateway: `TargetQuery → SpatialIntent`

- **Source:** pp.87–92, 94, 104, 107.
- **Seam today:** `targeting.ts` (`queryDirectTarget`, `eligibleTargets`,
  `isEligibleTarget`) handles one direct target; `area-geometry.ts` supplies
  deterministic areas; `spatial-intent.ts` is the shared destination-authority
  kernel.
- **Done:** the `SpatialIntent` record + validate/apply kernel — bounds,
  occupancy (honoring batch co-moved actors), impassable terrain, and Rampart
  (p.104) decided once; `applyMovement`'s place/teleport/plain-position paths
  route through it; VM rushes/dashes into Fortify-projected rampart are now
  denied (the movement planner already enforced this for the MOVE command);
  `docs/target-template.md` (the p.92 footprint fixture matrix) and
  `__tests__/spatial-intent.test.ts` authority rows.
- **Done:** area center legality and inclusion parity — `computeSpatialArea`
  validates burst/line centers (bounds, source reach, free-center
  occupancy/passability) and derives the p.95 cells plus inclusion, with the
  generic foe blast resolver routed through it (behavior-parity verified).
- **Missing (next F1 slice):** footprint (p.92) and line-of-effect fixture
  rows, the arc shape, the direct gates and VM selectors adopting footprint
  distance, and target sets/cardinality joining the direct target.
- **Build:** complete `docs/target-template.md`'s footprint/line-of-effect
  matrix rows and extend `computeSpatialArea` to the arc shape.
- **Unblocks:** areas beyond the current set, summons/objects placement, mob
  member state, teleports/forced movement in relic/legend content, and the
  `TODO(ICON-rules, pp.87–90, 107)` movement TODOs.

### F2 — Save window: one replayable save for every kind

- **Source:** pp.94, 102, 104, 129, 143–144, 186.
- **Done:** the generalized `SaveWindow` record — `windowKind`, the
  `modifiers` breakdown, `threshold`, the denial `forced` flag, and the
  continuation `branch` AST — emitted by `resolveSaveWindow` on every `save`
  mutation. Status (`status-clear`), Cure (`cure-immediate`), Penumbra and VM
  save effects (`effect`), and the Six Hells exit save (`movement`, recorded
  on `ACTOR_MOVED.exitSave` instead of a raw command-time d20) all replay
  through one window, with a replay pair per kind in
  `__tests__/save-window.test.ts` plus modifier/denial/branch fixtures.
  Sucker Punch is extended deliberately by kind (`effect`-only, with the
  re-roll recomputing the evaluated modifier from the held `modifiers` record
  and rolling a fresh boon/curse die); `docs/save-template.md` is the
  authoring procedure. Relic and legend saves are `effect`-kind windows that
  construct the same spec when authored.
- **Missing (next slice):** generic p.102 Blessing *input* exposed per
  `windowId` (bounded transport validation + replay consumption — the record
  already persists the spend); the F3 turn-transition lifecycle for the
  failed-exit lockout; delayed/multiple-save choices in a first-class
  window/event record.
- **Unblocks:** status-dense content (talents/masteries that grant save
  bonuses), relic saves, and the p.102 Blessing economy.

### F3 — Turn boundary: `TurnTransitionIntent` + lifecycle registry

- **Source:** pp.87, 91, 94, 103–104, 107, 129, 186.
- **Seam today:** `TURN_ENDED` with a `cause` provenance; `applyTurnTransition`
  is the single ordered replay boundary (saves, passives, expiry, delayed
  marks, held windows, round reset, turn-start hooks).
- **Done:** `kernels/lifecycle.ts` — the `TurnTransitionIntent` (cause, ordered
  lifecycle participants, JSON-clean `diceWindows`, `roundAdvance`), the
  closed `LIFECYCLE_RECIPES` registry with `turn-start` / `turn-end` /
  `delayed` phases, `planTurnTransition` (command side) and
  `runLifecyclePhase` (replay side, executing exactly the recorded
  participants with a legacy applies-gate fallback). Every existing
  hand-wired hook (Carnevale detonation, Astral Chain, Dark Knight, Six
  Hells, Sidhe, Exorcism, Showdown, Warding Bolts, Assassinate, Incubus,
  Umbral Echo, Stampede, Underway, Monogatari, Chastise, Great Giorgios,
  Gallows Humor, Morrigan, Aria, Symphony, Intimidate, Strength of the Pack)
  migrated into the registry as data; the dead hand-wired resolvers were
  deleted from `encounter.ts`; cause parity + registry replay pairs in
  `__tests__/turn-transition.test.ts`; `docs/lifecycle-template.md`.
- **Remaining:** p.102 Blessing input per `windowId` (F2 carry-over), the Six
  Hells failed-exit lockout as a turn-start recipe (p.129), and explicit
  `round-start` / `round-end` recipe phases for content that needs them.
- **Unblocks:** class/job traits with lifecycle text (65 job traits),
  summons, legend phases, relic persistent effects, trophy/camp "at start of
  round/turn" effects.

### F4 — Trigger/window provenance: `DamageWindow` / `TriggerWindow`

- **Source:** p.107 (and the interrupt suites: pp.122–128, 138, 143, 151).
- **Seam today:** the interrupt-window protocols (`when-damaged`, `defeated`,
  `uses-ability`, `area-inclusion`, `targeted-by-ability`, `save-rolled`) are
  opened by reducer hooks; held damage/effects are cloned and checkpoint-
  validated; priority rules (defeated vs Masquerade, when-damaged vs
  defeated) are shared via `prospectiveAppliedDefeat`.
- **Done:** `trigger-window.ts` — the closed `TRIGGER_WINDOW_RECIPES` registry
  keyed by trigger (`when-damaged`, `defeated`, ordered by p.107
  specificity), `decideDamageWindow` as the single decision point (the VM
  path's `applyDamage` now routes its hold decision through it), and
  `openDamageWindowFromLedger` consuming the F0 ledger's `window` record at
  replay (held blows not applied; `ACTOR_DEFEATED` suppressed; unknown
  triggers declined). `attackEvents` records the decision on
  `AttackResolutionLedger.window` + the nested damage ledger; VM/split parity
  is fixture-pinned; `docs/trigger-template.md`.
- **Remaining (F5 promotions):** Counter fires from a durable damage window
  proving "damaged by an ability"; Vigilance becomes a real DamageWindow
  action with range 2 and per-trigger use; Sturdy gets its per-turn
  forced-movement ledger; deferred-effect windows (uses-ability,
  area-inclusion, targeted-by-ability, save-rolled) become registry rows
  with recorded provenance.
- **Unblocks:** the defensive/trigger-heavy content — Counter/Dodge/Sturdy
  traits, Vigilance, and every "when damaged / when a foe does X" relic and
  legend ability.

### F5 — Passive projection and role baselines: closed source-ID recipes

- **Source:** pp.104–105, 186, 298 (+ the foe trait corpus).
- **Seam today:** `kernels/passive-projection.ts` is the *only* passive-to-condition
  point: closed character trait recipes, the 36-ID Flying/Phasing manifest
  (`content/foes/trait-recipes.ts`), and — the reviewed first mark slice — Rot
  `noDefiance` suppression + REGENERATE regeneration (p.186), all folded into
  `encounterConditionSet` so every consumer sees the same set. The resource
  registry in `core.ts` is the shared-resource analog.
- **Done:** the Rot mark projection — grants (`regeneration` on the
  REGENERATE ally-mark), suppressions (`defiance` on a 25%-hp foe-mark),
  ephemeral (never written back), with positive, behavioral (turn-end vigor,
  lethal-blow defeat), and closed-registry negative fixtures; template doc
  `docs/passive-template.md`; coverage note in `docs/rules-coverage.md`.
- **Done:** the p.298 role baselines — `FOE_ROLE_BASELINE_RECIPES` keyed by
  role (`skirmisher` → `dodge`, `artillery` → `slip` + `aetherwall`, `heavy`
  → `rampart`; mob/leader/legend none), folded into `encounterConditionSet`
  via `projectedRoleConditions`; the Heavy Guard armor-2 kernel mechanic
  (`guardArmorBonus`: self + same-side orthogonally adjacent allies) and the
  Legend Juggernaut round-start clear; behavioral + closed-registry negative
  fixtures in `__tests__/role-baseline.test.ts`; template doc updated with
  the role-baseline recipe section.
- **Remaining:** the Defiance/Counter/Dodge/Sturdy/Stealth/Unstoppable
  conditions have no reviewed passive source yet — they stay fixture-only
  until a source unit is promoted with its damage/trigger/lifecycle matrix
  (never inferred from trait/role prose).
- **Unblocks:** 8 class traits, 65 job traits, 655 foe traits, 19 foe phases,
  and the role baselines that make 1,365 foe abilities behave correctly.

### F6 — Job traits: closed inventory, five wiring homes

- **Source:** the 65 Job traits across pp.120–225.
- **Seam today:** traits were named but never executed — `encounter.ts` and
  the kernel had no reviewed trait hooks, and nothing cataloged what each
  trait actually does.
- **Done:** `content/jobs/job-trait-recipes.ts` — the closed `JOB_TRAIT_RECIPES`
  inventory of all 65 traits (22 `wired` / 43 `documented`), each row
  stating its mechanic or its table-facing ruling; `EXECUTABLE_JOB_TRAIT_IDS`
  / `DOCUMENTED_JOB_TRAIT_IDS` derive from it. The five wiring homes:
  - **Condition projections** (`kernels/passive-projection.ts`
    `JOB_TRAIT_CONDITION_RECIPES`): sealer martial arts → dodge, shade
    shadow arts → phasing, colossus furious berserk / enochian embersoul →
    regeneration — folded into `encounterConditionSet`.
  - **Combat-start durable grants + companion summons**
    (`COMBAT_START_TRAIT_RECIPES`, applied once on `ENCOUNTER_STARTED`, idempotent):
    embersoul / furious berserk durable Defiance, godly smite mantra die
    seed, and the three persistent companions (beast-master great beast,
    bound-spirit seraph, selkie elemental) that survive the owner's defeat;
    `content/jobs/summon-recipes.ts` registers the six summon suites' placement ranges and
    per-owner entity caps (six per type).
  - **Lifecycle recipes** (`kernels/lifecycle.ts`, incl. the new `round-start`
    phase): true-horn sturdy round-start/turn-start halves, blackheart
    status-counted vigilance + bonus-damage (the count is recorded on
    `TurnDiceWindows` before the end-of-turn saves consume it), mark-of-tsumi
    2 piercing per marked foe + blessing, godly-smite mantra +1 per round,
    furious-berserk bloodied vigilance, and the round-5 rages (phoenix-rage
    defiance, orogenic-rage unstoppable, storm-hilt-rage marker).
  - **Active resolvers** (`content/jobs/job-trait-resolvers.ts` `JOB_TRAIT_RULE_RESOLVERS`,
    registered in `RULE_RESOLVERS`; executed via `EXECUTE_RULE`): knave taunt
    (Hatred of the user in range 3), spellblade klingenkunst (teleport 2).
  - **Command/kernel hooks**: warden path-of-the-aesi free Dash while
    Stealthy, warden green-kenning terrain-penalty immunity, the entity cap
    and companion-survival exempt in `removeOwnedEphemera`.
- **Replay semantics:** `planTurnTransition` evaluates the turn-start and
  round-start recipe gates against the **next** round (a round-gated row
  would otherwise never be recorded before the boundary advances), and
  replay executes exactly the recorded participants — the recorded list is
  the decision, never re-decided at replay (the boundary may consume a
  gate's precondition, e.g. the end-of-turn status saves Blackheart counts).
- **Fixtures:** `__tests__/job-traits.test.ts` (20) — condition projections,
  combat-start grants, every lifecycle row, the EXECUTE_RULE resolvers,
  command/kernel hooks, closed-registry negatives, replay pairs — and
  `__tests__/summons.test.ts` (7) — companion placement ranges, defeat
  survival, entity caps. Bite-verified: disabling the projection fold fails
  the three projection tests, disabling the round-start phase fails the
  mantra/rage tests, and dropping the companion exempt fails the
  survival test.
- **Remaining:** 43 documented traits need their home kernels first
  (Heroics-economy choices, spatial-aura mechanics, reactive windows, and
  the gated attack-path modifier hooks — distance/terrain/round/stealth-gated
  reads, threshold hooks, and the collide-trigger kernel).
- **Unblocks:** the job-trait row of the coverage table; the 43 documented
  rows promote through `docs/job-trait-template.md` as their kernels land.
  The attack-path modifier group (Demon Edge, Hissatsu, Pulverize, Bull's
  Strength) promoted with the shared `kernels/attack-modifiers.ts` kernel and the
  `collidingShoveTargets` collide detection (fixtures 13, bite-verified).

---

## 4. Coverage conversion — every area becomes a template

The remaining inventory rows and their path to completion. Order within each
row follows the foundation gates in §5; a row whose prerequisite foundation is
missing stays source-visible (never approximated).

| Coverage area | Units remaining | Prerequisite foundation | Template + shared kit | Fixture home |
| --- | ---: | --- | --- | --- |
| Core combat units | 70 | F0, F2, F3, F4 | `damage-ledger.ts`, save/turn templates | `__tests__/core*.test.ts` |
| Class traits | 8 | F5 | `kernels/passive-projection.ts` recipes | `__tests__/traits.test.ts` |
| Job traits | 65 | F5, F6 | passive + lifecycle + resolver recipes (`content/jobs/job-trait-recipes.ts`) | `__tests__/job-traits.test.ts`, `__tests__/summons.test.ts` |
| Talents | 288 | F0, F2, F5, F7 | `content/jobs/talent-recipes.ts` inventory + `kernels/talent-recipes.ts` trigger-effect fold (10 wired + 1 program-level) | `__tests__/talents.test.ts`, `__tests__/demon-slayer.test.ts` |
| Masteries | 144 | F0, F2, F3 | mastery recipes (often a flag on the ability recipe) | `__tests__/masteries.test.ts` |
| Limit Breaks | 16 | F3, F0 | `limit-break-recipes.ts` (resolve spend, action timing) | `__tests__/limit-breaks.test.ts` |
| Job summon rules | 6 | F1, F3 | `content/jobs/summon-recipes.ts` (entities + ownership + lifecycle) | `__tests__/summons.test.ts` |
| Relic ranks | 120 | F0, F1, F2, F3 | `relic-recipes.ts` (invoke = cost + effects) | `__tests__/relics.test.ts` |
| Relic aspects | 40 | F5 (+ character engine already covers transitions) | aspect passive recipes | `__tests__/relics.test.ts` |
| Foe abilities | 1,247 | F0, F1, F2, F3 | `FOE_ABILITY_RECIPES` rows (data only) | `__tests__/foe.test.ts` |
| Foe traits | 655 | F5 | `content/foes/trait-recipes.ts` rows | `__tests__/foe-traits.test.ts` |
| Foe roles (baselines) | 6 roles | F5 + F0 | `FoeRoleBaselineRecipe` | `__tests__/foe-traits.test.ts` |
| Foe phases | 19 | F3 | phase recipe (round/turn lifecycle) | `__tests__/foe.test.ts` |
| Foe chapter rules | 116 | F0–F5 as needed | chapter-rule recipes | `__tests__/foe.test.ts` |
| Trophies | 68 | F2, F3 | `trophy-recipes.ts` (uses/combat/expedition) | `__tests__/rewards.test.ts` |
| Camp fixtures | 16 + 85 features | F3 (camp boundary), F2 | fixture recipes | `__tests__/rewards.test.ts` |
| Reward rules | 9 | F2, F3 | reward recipes | `__tests__/rewards.test.ts` |
| Bond powers (narrative) | 120 | stays table-facing | none — keep non-authoritative | existing narrative tests |

**Executed slice — Talents (F7, 11/288 executable: 10 wired + 1 program-level):**
`content/jobs/talent-recipes.ts` — the closed 288-row inventory (two talents
per ability, exact source ids) with a wired tranche that executes through one
shared kernel, `talentTriggerMutations`
(folded into `USE_ABILITY` and `EXECUTE_RULE`; the mutations ride the ability
event, so replay is deterministic). Wired: Demon Cutter t1 (`exceed` → 6
vigor), Low Blow t2 (`comeback` → vigilance +1), Strafe Shot t1 (`exceed` →
evasion to next turn start), Blazing Bond t2 (`comeback` → defiance self +
ally), Riposte t2 (`comeback` → vigilance +1 after the stance resolves), the
**post-application slay/collide tranche** — Umbra t1 (`slay` → defiance),
Valiant t1 (`collide` → unstoppable to end of turn), Dragon Dive t1
(`collide` → collided character vulnerable) — decided by the same reactive
dry run that derives the ability's own clauses (the fold receives
`collidingShoveTargets` / `reactiveSlayTargets` from the caller; the dry run
is gated to equipped slay/collide talents via `talentReactiveTrigger`), the
**finishing-blow tranche** — the trigger fires when the ability targets a
bloodied foe (`deriveTriggers`' rule), with per-row `condition` overrides
for extended eligibility: Party Favor t2 (a dazed or blinded foe in the
blast activates the ability's Finishing Blow clause, never doubling it) —
and the **always trigger** for unconditional augmentations whose magnitude
reads state: Dropkick t2 (shove foe + self, charged/slow turns shove 2). The
actor now carries the durable `talents` map (validated by the room validator
and protocol schema); fixtures in `__tests__/talents.test.ts`
(19, bite-verified); `rules-foundations.md` §8. The first **program-level**
talent is Demon Cutter t2 (p.128, "Your can rush 1 before using Demon
Cutter. Charge: Rush 3 instead."): the Demon Cutter resolver reads the
projected `talents` surface and emits the pre-ability rush itself (gated on
the equipped choice, never on the charge trigger alone), fixtures in
`__tests__/demon-slayer.test.ts`. Remaining 277 rows stay
source-visible with their kernel need (movement/sacrifice/aura/blessing-
combo hooks; the documented finishing-blow rows — Death Blossom's teleport
choices and Stampede's may-choice mark transfer — and the `charge` family's
remaining ability-behavior variants, which belong in the ability programs'
charge clauses the way the Chanter programs already implement them, not the
fold).

---

## 5. Sequencing and gates

Build in this order; each gate is the corresponding matrix in
`rules-foundations.md` (§"Required foundation tests before promotion"):

1. **F0 Damage ledger** — nothing promotes without it. Same damage through
   basic attack, VM, terrain/Slashed, delayed effect, held damage, and
   reactive damage; a replay pair for every remaining split event shape.
2. **F1 SpatialIntent** — before areas/teleports/forced movement expand.
   Target legality parity across `USE_ABILITY`, `EXECUTE_RULE`, and VM inputs.
3. **F2 SaveWindow** — before status-dense content. A replay pair per save
   kind and its modifier/denial policy.
4. **F3 TurnTransitionIntent** — before lifecycle-heavy traits/summons/relics.
   Normal, forced, tagged, and state-requested turn-end parity.
5. **F4 TriggerWindow** — completes Counter/Vigilance/Sturdy/Dodge; unlocks
   the defensive suites.
6. **F5 Passive projection + role baselines** — a closed source-ID recipe
   plus a non-recipe exclusion assertion for each new projection.

Gate discipline (from the TODO and foundations docs):

- A reducer improvement does not change automation-audit numbers on its own.
  Audit counts change **only** when authority changes (an allowlist entry
  plus source-page fixture plus deterministic replay test).
- A foundation gate must pass before its coverage rows convert; partial
  behavior is not audit authority and stays source-visible.
- `PHASE_TWO_READY` / `PHASE_THREE_READY` stay `false` until the gates above
  genuinely pass — never flip a gate to make a demo work.
- Audit numbers in `__tests__/coverage.test.ts` come from
  `npm run audit:automation` — copy them, don't hand-compute.

---

## 6. Definition of done and anti-patterns

A foundation (or a content slice that uses it) is done when: its durable
representation is validated and replay-safe; command construction and replay
share the same kernel; its source IDs are allowlisted explicitly; its
user-visible surface is covered; and `npm test`, `npm run typecheck`,
`npm run audit:automation`, `npm run build`, and `git diff --check` pass.

Do not:

- Add an unlabeled numeric `damage` field or alternate mitigation arithmetic;
  every amount goes through the damage ledger entry points.
- Use `divine` as shorthand for a partial bypass; `bypassVigor`,
  `ignoreArmor`, and `ignoreDefiance` are distinct source exceptions.
- Turn parser-complete source text into `EXECUTE_RULE` authority without an
  allowlist entry, source-page fixture, and deterministic replay test.
- Infer a mechanic from trait/role prose or a role label at runtime — the
  manifests are closed source-ID tables.
- Silently approximate a "may / either-or" choice; resolve the first-listed
  deterministic branch and document the alternative as table-facing.
- Reuse one foundation's special case as another's shortcut (e.g. a generic
  save fallback, a "reactions: false" flag that mutes two reactions, or a
  condition count standing in for statuses).

---

## 7. The one-sentence plan

Build the six shared contracts — damage ledger, spatial gateway, save
window, turn-transition plan, trigger-window provenance, and passive/role
recipes — each as a durable record + pure kernel + declarative template +
closed source-ID manifest + replay matrix, in that order; then the 3,350
unresolved clauses reduce to data-authoring rows in the existing recipe
tables, exactly as the 144 Job abilities and 20 foe recipes already proved.
