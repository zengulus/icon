# Rules-engine foundations

This is the implementation order for cross-cutting ICON mechanics. It is a
source-linked engineering ledger, not an automation-coverage claim. None of
these foundations changes the independently executable program audit or the
Phase 1/2 gates by itself.

The project currently has 387 reviewed executable programs and 3,223
unsupported clauses. `PHASE_TWO_READY` and `PHASE_THREE_READY` remain `false`.

## 0. Automation module layout (architecture)

`src/rules/automation/` is split into three layers with a one-direction
dependency rule — **content → kernels → primitives**:

- **`primitives/`** — content-agnostic vocabulary and builders with no source
  IDs: the declarative VM types (`types.ts`), the runtime compiler and
  targeting/spatial-intent seeds, the pure damage/attack/save/status-save
  kernels, and the job-kit/foe-kit program builders. Nothing here knows a
  source ID or a job name.
- **`kernels/`** — shared engine mechanics and their registry machinery, also
  free of source IDs: `encounter-adapter.ts` (damage/defeat/reactive
  pipeline), `damage-ledger.ts`, `trigger-window.ts`, `lifecycle.ts`
  (turn-transition plan/run), `passive-projection.ts` (the projection fold),
  `attack-modifiers.ts` (the trait attack-modifier fold), `talent-recipes.ts`
  (the talent trigger-effect fold), `foe-recipes.ts`
  (generic resolver factories), `runtime.ts`, `core-resolvers.ts`.
- **`content/`** — everything keyed by source IDs, referencing only the two
  layers above: `classes/` and `jobs/` (trait-condition recipes, the 45
  lifecycle rows + dice-window planners, attack-modifier and talent wired
  rows, summon suites, encounter hooks, the closed `JOB_TRAIT_RECIPES`
  inventory, the 16 job `programs/`), `foes/` (role baselines, mark recipes,
  `FOE_ABILITY_RECIPES`, the foe-trait manifest), and `glue/` (compiler,
  manual-programs, resolvers — content-aware dispatch).

**The registry seam:** content modules register their rows into kernel
registries at module scope; `content/registry.ts` imports every content
module for those side effects. Production entry points (`encounter.ts`,
`movement.ts`, `catalog.ts`, `foes.ts`) and the automation barrel import the
registry, and every test that exercises registered content does too — a
missing registry import silently undercounts complete programs in the audit
(regression-guarded by `__tests__/coverage.test.ts` and the
`npm run audit:automation` script, both of which import it first).

## 1. Damage and defeat kernel — started

Source: pp.89, 93–95, 102–105, 107.

`automation/primitives/damage-resolution.ts` now owns pure damage determination and the
HP/vigor application split. `encounter-adapter.ts` derives encounter conditions
into a typed `EncounterDamageIntent`, applies one final halving only after flat
reductions, and owns the canonical `defeatActor` lifecycle.

The determined-damage handoff carries an explicit `bypassVigor` flag: p.89
dangerous terrain is piercing damage that bypasses vigor, while piercing is
not silently treated as a global bypass rule. Historical held-damage windows
retain their former divine-only default until they are regenerated.

`automation/primitives/attack-resolution.ts` now owns the pre-damage roll itself. Basic
attacks, VM effects, job-kit resolvers, core-resolver compatibility calls, and
Bleak Mercy use its recorded Evasion → d20 → capped boon/curse → total →
critical sequence, including terrain elevation and Dazed. An Evasion success
is durably represented as a null d20/total plus its d6 result rather than a
made-up attack roll.

The same attack result now carries only the two source-backed downstream
exceptions that damage needs: high ground ignores cover against a lower target
(p.89), and True Strike ignores Dodge (p.104). They follow only the matching
attack target's direct hit/miss damage branch; they do not leak into collateral
areas or unrelated later effects.

The following replay paths now use that application kernel:

- VM damage and held damage;
- basic attacks;
- dangerous terrain and Slashed self/ally ability-movement damage;
- legacy `ABILITY_RESOLVED` records;
- Vigilance's already-determined legacy event amount;
- Great Giorgios's delayed damage;
- Counter and Gentleness reflection.

Source amounts and already-determined amounts are now intentionally distinct:
`determineAndApplyEncounterDamage()` is for direct reducer/lifecycle source
damage (terrain, Slashed, delayed Great Giorgios, Counter, and Gentleness),
while `applyDeterminedEncounterDamage()` is reserved for persisted legacy
`appliedDamage` records and held interrupt windows. This prevents both
accidental mitigation bypasses and accidental double mitigation.

`gainVigor` likewise owns the Vitality cap recorded by the checked-in p.105
source unit plus Rot/Shattered denial. Cure, generic vigor mutations,
historical Recover replay, and literal Regeneration use it. Bloodied remains
wound-aware through `isBloodied`.

### Damage ledger (F0)

`automation/kernels/damage-ledger.ts` is now the durable, replay-safe record of one
damage instance. Every new damage-carrying event shape serializes a
`DamageLedgerEntry` that declares **which side of the handoff it is**: a
`handoff: 'source'` entry (p.89 terrain, VM source amounts) replays through
`determineAndApplyEncounterDamage`; a `handoff: 'determined'` entry (basic
attack, Vigilance, legacy `ABILITY_RESOLVED`) replays through
`applyDeterminedEncounterDamage` via the shared `applyDamageLedger` consumer.
The entry carries the intent provenance (source, target, delivery,
cover/dodge exceptions), the application ledger (determined/applied amounts,
HP/vigor split), the application-time HP floor (`flooredAt1` — Defiance p.104
and Defy Death p.138, never re-inferred from a reduced amount), the defeat
result, and interrupt-window state. The four split event shapes
(`ACTOR_MOVED` terrain, `ATTACK_RESOLVED`, `VIGILANCE_SPENT`, and
`ABILITY_RESOLVED.attack`) are migrated: new events carry the ledger and
replay consumes it, historical events fall back to their documented legacy
fields. `docs/damage-template.md` is the authoring procedure, and
`__tests__/damage-ledger.test.ts` is the required matrix — the same damage
through basic attack, VM, terrain, held damage, delayed/Slashed, and reactive
Counter, plus a defiant-target floor case, a legacy-fallback case, and a
ledger-only case proving replay consumes the record.

The recorded attack roll is now the second half of the F0 ledger: new
`ATTACK_RESOLVED` events carry an `AttackResolutionLedger`
(`automation/kernels/damage-ledger.ts`) with the legal target/range/line-of-effect
provenance the direct gate validated, the command-time cover resolution, the
attack-window choices (`null` until F4), and the attack's downstream damage
instance nested inside. Replay consumes `attackResolution.damage`; historical
events keep the legacy fallback.

### Still TODO

- `TODO(ICON-rules, pp.93–105)`: source-specific damage exceptions must stay
  typed and narrow. The p.144 Bleak Mercy flags are the model: mark the
  determination exception (`ignoreArmor`) separately from application
  exceptions (`bypassVigor`, `ignoreDefiance`), persist any application flag
  in held damage, and prove that every unnamed defense still works. Do **not**
  use `divine` as a shortcut, and do not let `ignoreDefiance` bypass the
  generic `damage-immune` bit until immunity has durable origin provenance.
- `TODO(ICON-rules, pp.87–94, 107)`: target authority and trigger windows
  are not yet unified with the `AttackResolutionLedger`. The roll arithmetic
  is unified; promote Counter/Vigilance/Sturdy once the ledger drives their
  decision points (F4).
- `TODO(ICON-rules, p.104)`: do not promote Defiance, Counter, Dodge, Sturdy,
  or broad foe traits merely because one path is routed. Counter's exact
  “damaged by an ability” trigger, Dodge delivery coverage, and Sturdy's
  per-turn forced-movement ledger require the durable damage/trigger model
  (F0/F4).
- `TODO(ICON-rules, p.105)`: Vigilance must become a `DamageWindow` /
  `TriggerWindow` action. Its legacy command does not yet prove range 2,
  adjacency-breaking/damaged trigger provenance, or one use per triggering
  event.
- `Done`: The F4 trigger-window foundation now consumes `DamageLedgerEntry.window` /
  `AttackResolutionLedger.window` via `openDamageWindowFromLedger`, closing
  the ledger handoff for replay.
- `Done`: Rot's `noDefiance` mark state and its REGENERATE ally-mark branch
  now project through the closed source-ID registry in
  `automation/kernels/passive-projection.ts` (see the F5 entry below).

## 2. Target and spatial gateway — seed in place

Source: pp.87–92, 94, 104, 107.

`automation/primitives/targeting.ts` is the framework-free seed used by VM selectors and
the direct one-target gates for basic attacks, reviewed ability commands, and
reviewed raw rule commands. It makes `self` and `ally` distinct (an ally is
another living ally under p.92), excludes defeated/off-battlefield actor
inputs by default, and gives the direct gate one ordered handling of Blind,
True Strike, Stealth, point-cell range, and line of sight. This also closes
the former direct-`EXECUTE_RULE` Blind range bypass.

### Spatial gateway (F1)

`automation/primitives/spatial-intent.ts` is now the shared destination-authority
kernel: every explicit-destination VM path (`place`, `teleport`, and explicit
`rush`/`fly` positions) builds a `SpatialIntent` and routes through
`validateSpatialIntent` / `applySpatialIntent`, so bounds, occupancy,
impassable terrain, and Rampart (p.104) are decided once instead of per
resolver. The durable record of an applied intent is the serialized
`move` `RuleMutation`; the gateway consumes the caller's condition-derived
`rampartObstructed` (fortify/rampart/slip/unstoppable projection) and the
`coMovedActorIds` batch set so paired swaps validate atomically. This closes
the former unvalidated `place`/`teleport`/plain-position paths (including a
real fix: VM rushes/dashes into a Fortify-projected rampart cell are now
denied, matching the movement planner's MOVE-command rule). `docs/target-template.md`
is the authoring procedure with the p.92 footprint fixture matrix;
`__tests__/spatial-intent.test.ts` pins each authority row.

### Still TODO

- `TODO(ICON-rules, pp.87–92)`: extend the state-derived `TargetQuery` from
  one direct target to listed target sets/cardinality and all ability input
  shapes. Area center legality and inclusion parity are routed today:
`computeSpatialArea` validates a burst/line center (bounds, source reach,
free-center occupancy/passability) and derives the p.95 cells plus
inclusion, and the generic foe blast resolver consumes it.

- **Done (F1 + spatial authority pass):** the shared kernel
  (`primitives/line-of-sight.ts`) now owns line of sight (p.92: impassable
  terrain + explicitly registered LoS-blocking effects) and line of effect
  (p.109: a distinct gate blocked only by explicit sources); the reducer's
  `hasLineOfSight` delegates to it, so command gates and the VM share one
  sampler. `queryDirectTarget`, the foe `requireFoeInRange`/`requireAllyInRange`
  gates, and `computeSpatialArea`'s center reach all use the p.92 footprint
  distance (`footprintDistance` — "at least 1 space of its area within the
  listed range", measured from the edge of the origin character); area
  inclusion is footprint-aware (p.290: a large foe is inside when any of its
  spaces is hit); Burst X cells can be filtered by line of sight from the
  center (p.95). The arc shape and listed target sets/cardinality remain; see
  `docs/target-template.md` for the remaining matrix rows.
### Passive projection registry

`automation/kernels/passive-projection.ts` is now the only trait-to-condition
projection point used by the encounter adapter. It combines the closed
character trait entries with the separately audited 36-ID foe
Flying/Phasing manifest. Unknown trait text and role labels have no mechanical
effect. This registry is deliberately a staging point—not evidence that
Defiance, Counter, Regeneration, Dodge, Sturdy, or p.298 role baselines are
complete.

## 3. Save windows — generalized (F2)

Source: pp.94, 102, 104, 129, 143–144, 186.

`automation/primitives/save-window.ts` is now the one durable `SaveWindow` record every
save emits: `resolveSaveWindow` fills in the **kind** (`status-clear`,
`cure-immediate`, `effect`, `movement`), the **modifiers** breakdown
(`sourceModifier`, policy `saveBoon`/`saveCurse`, `blessing`), the
**threshold**, the denial policy (`forced` records a roll denied without a
die, e.g. Penumbra vs a blinded foe), and the **continuation branch** (the
`onSuccess`/`onFailure` AST, retained so a save-reroll interrupt regenerates
either outcome). It is used by ordinary status saves, Cure/Recover, generic
VM `save` effects, Penumbra, the legacy core Recover resolver, and — new —
the Six Hells Trigram exit save: `movementEvents` now resolves that gate
through the recorded `movement`-kind window (honoring the projected save
policy, e.g. Rot's curse) and carries the successful record on
`ACTOR_MOVED.exitSave` instead of a raw command-time d20 (p.129). Each save
has a stable `windowId`; Rot's curse applies to saves generally, while Sweet
Torment remains limited to Cure/status-clearing denial.

Sucker Punch (p.143) is extended deliberately by kind: `saveRerollWindow`
holds only `effect`-kind saves with a declarative `branch` — the only saves a
foe rolls mid-turn during an ability resolution, where an adjacent hero's
interrupt can answer within the same turn. `status-clear`/`cure-immediate`
saves resolve at turn boundaries (closed before any interrupt can answer) or
are self-rolled (Cure), and `movement` saves are command gates (the failed
Six Hells exit save rejects the move at command time, so no window exists);
their durable records are still retained for replay and future interrupt
coverage. The re-roll itself now recomputes the evaluated modifier from the
held `modifiers` record and rolls a fresh boon/curse die instead of reusing
the previous rolled value. `__tests__/save-window.test.ts` is the required
matrix — a replay pair per kind plus modifier-policy, denial-policy, and
branch-record fixtures — and `docs/save-template.md` is the authoring
procedure (relic/legend saves are `effect`-kind windows that construct the
same spec).

### Still TODO

- `TODO(ICON-rules, p.102)`: expose Blessing choices for generic saves by
  stable `windowId`, with bounded transport validation and replay consumption.
  The record already persists the `modifiers.blessing` spend; the generic
  *input* plumbing (a `saveChoices` map keyed by `windowId` on the VM
  `save` effect) is what remains. The current actor/status choice map
  intentionally remains only for known core status windows.
- `TODO(ICON-rules, p.129)`: the failed Six Hells exit save's "unable to
  exit until the start of their next turn" continuation is source-visible — a
  persistent lockout needs the F3 turn-transition lifecycle to clear it.
  Today a failed attempt is rejected deterministically and the foe may try
  again; the movement record documents the window.
- `TODO(ICON-rules)`: delayed/multiple save choices in a first-class
  window/event record are still pending; the single-save continuation branch
  is retained on every record today.

## 4. Turn transitions and lifecycle — `TurnTransitionIntent` + registry (F3, executed)

Source: pp.87, 91, 94, 103–104, 107, 129, 186.

Every `TURN_ENDED` event now carries the durable **`TurnTransitionIntent`**:
`cause` (`voluntary` / `ability-tag` / `forced-status` / `rule-requested`),
the **ordered lifecycle participants** that ran (the `LIFECYCLE_RECIPES`
rows whose `applies` gates passed at the command boundary), the **dice
windows** pre-rolled at the boundary (Carnevale detonation p.150, Monogatari
song p.179 — recorded JSON-clean so the checkpoint boundary accepts them),
and `roundAdvance`. `planTurnTransition` builds the intent at command time;
`runLifecyclePhase` executes exactly the recorded participants — replay never
re-rolls or re-decides which hooks run.

Every hand-wired hook migrated into the closed registry
(`src/rules/automation/kernels/lifecycle.ts`): turn-end (soul-blade, Dark
Knight vigilance, Exorcism, Showdown, Warding Bolts, Assassinate, Incubus,
Umbral Echo, Sidhe, Stampede, Underway, Monogatari, Chastise, Carnevale),
the **`delayed` phase** (Great Giorgios — runs after the per-actor flag
reset at its historical `resolveDelayedMarkEffects` position so its fresh
rush is on the next turn's clock), and turn-start (Six Hells Trigram, Dark
Knight hatred, Intimidate, Gallows Humor, Astral Chain, Warding Bolts,
Morrigan, Strength of the Pack, Aria, Symphony, Monogatari). The dead
hand-wired resolvers were deleted from `encounter.ts`; a hook joins the
boundary as a recipe row (see `docs/lifecycle-template.md`), never by
editing the drivers.

### Still TODO

- `TODO(ICON-rules, pp.102, 178–179)`: make lifecycle Cure callers such as
  Aria and Chastise declare whether they open a full Cure save window. They
  presently preserve historical deterministic vigor-only behavior rather than
  silently rolling unrecorded dice.
- `TODO(ICON-rules, p.129)`: the Six Hells failed-exit continuation ("unable
  to exit until the start of their next turn") can now be expressed as a
  turn-start lifecycle recipe once its state is reviewed.

## 5. Trigger/window provenance — `TriggerWindow` registry (F4, executed)

Source: p.107 (and the interrupt suites: pp.122–128, 138, 143, 151).

The interrupt-window protocol now has **one decision point and one replay
entry point** in `src/rules/automation/kernels/trigger-window.ts`:

- `TRIGGER_WINDOW_RECIPES` — the closed registry keyed by trigger
  (`when-damaged`, `defeated`), each row answering from durable provenance
  whether a window opens. Ordered so the more specific trigger wins
  (when-damaged before defeated), matching p.107.
- `decideDamageWindow` — the single decision point, shared by the single-pass
  VM path (`applyDamage` now routes its hold decision through it) and the
  split-event path (`attackEvents` records the decision on the attack's
  `AttackResolutionLedger.window` and the nested damage ledger at
  construction time).
- `openDamageWindowFromLedger` — replay opens the window from the recorded
  `DamageLedgerEntry.window`; it never re-evaluates the target's availability
  or the blow's lethality, and a held blow is not applied until the interrupt
  answers or the boundary drains it. A held `ACTOR_DEFEATED` is suppressed for
  a held blow (the interrupt decides whether the target falls); a held record
  whose trigger is outside the closed registry is declined so the damage
  still applies.

This closes the F0 handoff: the ledger's `window` record is now consumed, so
Counter's "damaged by an ability" trigger, Vigilance's range-2 attack window,
and Sturdy's per-turn forced-movement ledger can be promoted from the ledger
records (F5). See `docs/trigger-template.md` for the authoring procedure and
`__tests__/trigger-window.test.ts` for the matrix.

### Still TODO

- `TODO(ICON-rules, pp.104–107)`: promote Counter to fire only from a durable
  damage window proving "damaged by an ability" (the ledger records the
  delivery/instance provenance it needs).
- `TODO(ICON-rules, p.105)`: bind Vigilance's `guard`/`punish` uses to a real
  trigger record with range 2/adjacency and a full DamageIntent before
  promoting it.
- `TODO(ICON-rules, p.104)`: give Sturdy its per-turn forced-movement ledger
  (the movement record currently re-derives the maximum from the condition
  set at replay).

## 6. Passive projection and role baselines — closed source-ID recipes (F5, executed)

Source: pp.104–105, 186, 298 (+ the foe trait corpus).

The p.298 foe-role baselines now project through the closed
`FOE_ROLE_BASELINE_RECIPES` table in `kernels/passive-projection.ts`, keyed by
`FoeRoleId` — never parsed from `traitsText` prose:

- **Skirmisher** → `dodge` (missed attacks and area effects deal no damage).
- **Artillery** → `slip` (ignores Rampart) + `aetherwall` (halves damage from
  beyond range 2).
- **Heavy** → `rampart` (foes cannot dash/fly/teleport into spaces adjacent to
  the heavy).
- **Mob / Leader / Legend** → no condition projection.

Non-condition halves stay with their dedicated mechanics: the Heavy Guard's
armor-2 reduction is `guardArmorBonus` in the damage kernel (self + same-side
orthogonally adjacent allies, Manhattan 1), and the Legend Juggernaut clears
the legend's statuses and marks at the round-start boundary. `encounterConditionSet`
folds `projectedRoleConditions(actor.roleId)` in with the trait and mark
projections, so every consumer sees the same set.

### Still TODO

- `TODO(ICON-rules, pp.104–105)`: the Defiance, Counter, Dodge, Sturdy,
  Stealth, and Unstoppable conditions still have no reviewed passive source;
  they remain fixture-only until a source unit (trait/role/phase) is promoted
  with its damage/trigger/lifecycle matrix. Role labels must not be mapped
  beyond the p.298 rows above.
- `TODO(ICON-rules, p.298)`: the Legend Juggernaut clear is handled at the
  round boundary today; it can move into a round-start lifecycle recipe phase
  when the registry grows one.

## 7. Job traits — closed inventory, five wiring homes (F6, executed)

All 65 Job traits are cataloged in `automation/content/jobs/job-trait-recipes.ts`
(`JOB_TRAIT_RECIPES`): each row is `wired` (real engine mechanics, source
fixtures) or `documented` (source-visible ruling, never approximated). A row
is wired only when it has a durable record, a shared kernel, a declarative
recipe, a closed source-ID manifest, and a deterministic replay fixture.

The five wiring homes:

- **Condition projections** (`kernels/passive-projection.ts`
  `JOB_TRAIT_CONDITION_RECIPES`, folded into `encounterConditionSet`): Sealer
  martial arts → dodge, Shade shadow arts → phasing, Colossus furious
  berserk / Enochian embersoul → regeneration. Consumable conditions are
  never projected — Defiance is granted durably at combat start.
- **Combat-start grants + companion summons** (`COMBAT_START_TRAIT_RECIPES`,
  applied once on `ENCOUNTER_STARTED`, idempotent): Embersoul and Furious
  Berserk durable Defiance; Godly Smite mantra die seed 1; Beast Master
  great beast, Bound Spirit seraph, Selkie elemental — persistent
  companions (`state.companion`) that survive the owner's defeat, placed at
  the trait's range. The six summon suites cap active entities per owner at
  six per type (`content/jobs/summon-recipes.ts`).
- **Lifecycle recipes** (`kernels/lifecycle.ts` `LIFECYCLE_RECIPES`, incl. the
  new `round-start` phase): True Horn sturdy round-start/turn-start halves;
  Blackheart status-counted vigilance + bonus-damage at turn end (the count
  is recorded on `TurnDiceWindows` before the end-of-turn saves consume the
  statuses); Mark of Tsumi 2 piercing per marked foe + blessing at turn end;
  Godly Smite mantra +1 per round from round 2; Furious Berserk bloodied
  vigilance; Phoenix Rage / Orogenic Rage / Storm Hilt Rage from round 5.
  Replay executes exactly the recorded participants — the recorded list is
  the decision, never re-decided at replay — and `planTurnTransition`
  evaluates the turn-start/round-start gates against the **next** round so
  round-gated rows are recorded before the boundary advances.
- **Active resolvers** (`content/jobs/job-trait-resolvers.ts` `JOB_TRAIT_RULE_RESOLVERS`,
  registered in `RULE_RESOLVERS`; executed via `EXECUTE_RULE`): Knave taunt
  (Hatred of the user in range 3), Spellblade klingenkunst (teleport 2).
- **Attack-path modifier kernel** (`kernels/attack-modifiers.ts`): Demon Edge,
  Hissatsu, Pulverize, and Bull's Strength execute through shared hooks
  instead of per-site code. `traitAttackModifier(owner, elevationDiff)` is
  the single fold both attack sites read — the declarative VM
  (`runtime.ts` `case 'attack'`: boon/true-strike merge into the roll
  intent, Pulverize's +2 flat rides the damage provenance into the
  attack's direct damage, the exceed threshold feeds the roll's
  `exceedThreshold` so 13+ fires at two elevations higher) and the direct
  basic attack (`encounter.ts` `attackEvents`, plus `effectiveDamageDie`
  for Hissatsu's d10). Armed one-shot state is consumed by the attack that
  reads it (VM: mid-command view mutation so a multi-target ability only
  applies to its first roll, plus reducer-time consume; direct path:
  reducer-time consume next to `consumeMassiveOverhead`). Demon Edge
  arming rides the ability's event as recorded mutations when the ability
  triggered a slow-turn or delay (a delay tag or a `six-hells:slow-turn`
  state mutation), and the bonus-damage window expires at the end of the
  owner's next turn (turn-end recipe gated on the recorded armed round);
  Hissatsu arms at turn end when the owner did not attack (turn-end
  recipe); Bull's Strength appends collide damage through
  `bullStrengthCollideMutations` in `executeRuleProgramWithReactiveTriggers`
  (the shared `collidingShoveTargets` detection, once per turn — the guard
  is a recorded ruleState mutation, cleared by the turn-end recipe).
- **Command/kernel hooks**: Path of the Aesi free Dash while Stealthy
  (`encounter.ts` `ACTOR_MOVED`), Green Kenning terrain-penalty immunity
  (`movement.ts`), the entity cap and companion-survival exempt in
  `removeOwnedEphemera` (`encounter-adapter.ts`).

### Still TODO

- 43 of 65 traits remain `documented` — Heroics-economy choices (Strive,
  Wolfheart, Spite), spatial-aura mechanics (Shieldmaster), and reactive
  windows (Press the Advantage, Great Leap, martial-master double-stance,
  the summon lash-outs) need their home kernels first.
- `TODO(ICON-rules, p.141)`: Blackheart's legacy no-intent fallback counts
  only post-save statuses; only the recorded-window path is faithful (no
  legacy blackheart events exist, so this is inert today).

## 8. Talents — closed inventory + trigger-effect fold (F7, executed tranche)

All 288 Job talents (two per ability) are cataloged in
`automation/content/jobs/talent-recipes.ts` (`getTalentRecipes(units)` — the closed
inventory built from the source manifest, exact by construction; the catalog
test enforces the same 288-id equality). Each row is `wired` (real engine
mechanics through the shared fold), `program-level` (implemented by the
ability's own program, which reads the equipped choice through the projected
`talents` surface and emits the variant itself — executable but not a fold
row, so the fold never double-applies it), or `documented` (source-visible
ruling with the kernel it needs — classifier-backed, never approximated).
The wired table is explicit and never touches the manifest, so the module
stays out of the catalog ↔ manual-programs import cycle.

The wired tranche (10) executes through one shared kernel,
`talentTriggerMutations`, folded into `abilityEvents` and `EXECUTE_RULE` at
command time: a talent declares a `triggerEffect` and its mutations ride the
ability's RULE_MUTATIONS_APPLIED event, so replay applies exactly what the
command decided (F0 durable record). A row may declare a `condition`
override (a per-row fired check that replaces the trigger kind's default,
e.g. an extended-eligibility finishing blow), and `build` receives a fold
context (encounter state + the ability's own mutations) when it needs them.

Separate from the fold, the `program-level` talents are implemented by the
ability programs themselves, gated on the equipped choice through the
projected `talents` surface (`context.state.actors[id].talents[abilityId]`,
populated by `encounterRuleState` alongside `traitIds`):

- **Demon Cutter talent 2** (p.128, "Your can rush 1 before using Demon
  Cutter. Charge: Rush 3 instead.") — a pre-ability movement that changes
  the line attack's origin, which a post-mutation fold cannot express. The
  resolver emits the rush mutation before the attack mutations, gated on
  the talent — never on the `charge` trigger alone — with the direction a
  caller choice defaulting to the nearest-foe axis.
- **Draken Cross talent 2** (p.128, "Charge: Increase range to 5, and all
  areas may be increased to medium blasts instead.") — on a slow turn both
  blasts become medium (radius 2) and the second-blast search extends to
  range 5. The "may" upgrade resolves deterministically as the charged
  reading (the player's option is only a downgrade); the attack target
  itself stays capped by the generic USE_ABILITY range gate, so the range
  boost lives in the resolver's second-blast placement.
- **Pyre talent 1** (p.209, "Comeback: Allies are immune to damage from
  this ability.") — the first program-level comeback clause: while the
  user is bloodied (the same flag `deriveTriggers` turns into the
  `comeback` trigger), the Pyre resolver skips allies in the ability's
  area damage — the blast fray and the comeback/exceed re-explosion.

All three audit as complete (387 complete programs) with their source
fixtures and replay pairs in `__tests__/demon-slayer.test.ts` and
`__tests__/enochian.test.ts`.

- **`exceed`** — fires when the ability's produced `attack` mutation rolled
  15+ (the engine's exceed threshold, runtime.ts); Demon Cutter talent 1
  (6 vigor), Strafe Shot talent 1 (evasion until the start of your next
  turn, a `turn-start` boundary duration).
- **`comeback`** — fires while the user is bloodied (the same check as
  `deriveTriggers`); Low Blow talent 2 (vigilance +1), Blazing Bond talent 2
  (durable defiance on the user and the bonded ally), Riposte talent 2
  (vigilance +1 after the ability resolves).
- **`finishing-blow`** — fires when the ability targets a bloodied foe (the
  same check as `deriveTriggers`, ICON p.95), with per-row eligibility
  extensions via the `condition` override. Party Favor talent 2 (p.151,
  "Dazed or Blinded foes activate the Finishing Blow effect"): the mine's
  detonation is the ability's clause ("Foes take 2 damage, twice"); the
  row's condition fires only when the detonation happened (area damage is
  present), a dazed or blinded foe is in the blast, and the ability's own
  clause did not already fire — it extends eligibility, it never doubles.
- **`always`** — fires on every use of the ability (an unconditional
  augmentation whose magnitude reads the fold context). Dropkick talent 2
  (p.136, "Shove your foe 1, then shove yourself 1 away from your foe.
  Charge: Increase shoves to 2"): the shoves always fire, and the charged
  variant reads the user's slow-turn state (the same flag `deriveTriggers`
  turns into the `charge` trigger) for the distance.
- **`slay` / `collide`** — post-application triggers (ICON p.95): the
  caller passes the reactive targets (`collidedActorIds` / `slainActorIds`)
  computed from the ability's recorded mutations by the same reactive dry
  run that derives the ability's own clauses (`collidingShoveTargets` /
  `reactiveSlayTargets` in the adapter — `talentReactiveTrigger` gates the
  dry run to equipped slay/collide talents only), and the fold fires when
  the relevant set is non-empty. Valiant talent 1 (collide → unstoppable
  until the end of your turn), Umbra talent 1 (slay → defiance), Dragon
  Dive talent 1 (collide → each collided character becomes vulnerable).

The remaining finishing-blow rows stay documented with their precise
blockers: Death Blossom talent 1 (p.162, "Teleport all characters in the
area 1") needs the teleport destinations, which are player choices the
command/protocol surface deliberately does not carry (USE_ABILITY input is
restricted to Blessing choices); Stampede talent 1 (p.170, "may transfer
the mark to them") needs a may-choice mark redirect across commands. The
rest of the `charge` family (and the comeback modifier rows) stay
documented too: they are ability-behavior variants ("Rush 3 instead",
"Increase range to 5", "Large blast") that change the ability's own
resolution, so their home is the ability programs' charge variants — the
pattern the Chanter programs already follow
(`context.triggers?.has('charge')`), not the fold.

The actor now carries `talents: Record<abilityId, 1 | 2>` (projected from
the character loadout in `actorFromCharacter`; validated by the room
validator and the protocol schema). Fixtures in `__tests__/talents.test.ts`
(19): inventory exactness, each wired behavior with its control, replay
pairs, the un-equipped negative, and the documented-talent closed negative
— bite-verified (disabling the fold fails the behavior tests).

### Still TODO

- 275 of 288 talents remain `documented` — pre/post-ability movement,
  Heroics/sacrifice economies, blessing/combo spend hooks, aura mechanics,
  and the ability-specific modifier hooks each need their home kernel
  before promotion, exactly as their rows describe.
- `TODO(ICON-rules, p.85)`: the fold's exceed check reads the produced
  attack mutation's total; asserted-exceed abilities (massive overhead's
  armed pit, Ace) need the same total/assertion parity the programs already
  keep.

## Required foundation tests before promotion

Any later source-ID trait/ability promotion that relies on these systems must
add the appropriate matrix, not just a happy-path unit fixture:

- the same damage through basic attack, VM, terrain/Slashed, delayed effect,
  held damage, and reactive damage;
- target legality parity across `USE_ABILITY`, `EXECUTE_RULE`, and VM inputs;
- a replay pair for each `SaveWindow` kind and its modifier/denial policy;
- normal, forced, tagged, and state-requested turn-end parity;
- a closed source-ID passive recipe plus a non-recipe exclusion assertion.

Until those matrices exist, the relevant source text stays visible and the
automation audit remains conservative.
