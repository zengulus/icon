# Generic underlays — the blocker-census collapse map

Authoritative design document for the remaining ICON 1.5 mechanics work. It
maps every live blocker-family label in `docs/blocker-census.md` onto the
SMALL set of generic underlays the engine already owns (or needs to extend),
so that authoring a new source rule increasingly looks like assembling:

    WHEN <trigger/predicate>
    [CHOOSE <thing>]
    PAY <transaction>
    SELECT <targets>
    DO <effects/movement/terrain/entity>
    FOR <duration>
    [THEN/AT <continuation>]

rather than writing another source-specific resolver. The objective is NOT to
maximize the number of blocker-family names implemented; it is to make the
engine vocabulary small enough that most remaining ICON rules become
transcription/composition. The census should NOT turn into ~149 new
architectural primitives — most blocker names are missing COMPOSITIONS or
missing QUERY POINTS on roughly 15–20 generic underlays.

Related documents: [`rules-foundations.md`](rules-foundations.md) (foundation
maturity + missing-kernel ledger this document supersedes for sequencing),
[`blocker-census.md`](blocker-census.md) (**generated** census),
[`roadmap.md`](roadmap.md) (phase gates).

## Design test (apply before any new "primitive")

For every proposed new primitive, ask:

> Could I describe this instead as an extension or composition of:
> **choose · query · number · predicate · modifier · transaction · flow ·
> event · continuation/window · movement · area/placement · persistent
> carrier · duration · terrain/entity operation · roll · usage ledger**?

If YES, do that. Only create another top-level generic when the source
demonstrates a genuinely different kind of state or authority.

Examples of the distinction:

| BAD (bespoke) | GOOD (composition) |
| --- | --- |
| `BlessingSpend` / `AetherSpend` / `ComboSpend` kernels | `ResourceOperation(resourceId, spend/gain/…)` — the existing resource registry |
| `ChooseTeleportSquare` / `ChooseTerrainSquare` / `ChooseGambleDie` | one `ChoiceSpec` with domain extensions and constraints |
| `MorriganDelayedTerrain` / `TowerDelayedMeteor` / `GravebirthTurnEndSummon` | `PendingRuleContinuation(trigger, programStep, captured refs)` composed with terrain/create/summon |
| `FlyRangeTalentKernel` / `TeleportRangeTalentKernel` / `AuraRangeTalentKernel` | typed modifier recipes consumed by the appropriate range query points |
| `BlitzTerrainPlacementAlgorithm` | `bloodied` predicate + `Choose(position)` + `PlacementSpec` + `Terrain(create)` |
| "source leaves a player choice we cannot model, so pick nearest/first" | leave the source unresolved until CHOOSE or WINDOW can represent it |

## The underlays and the authority that owns each

The genericity is in the recipe/fold model; each query point remains typed.
"Do not build one giant modify-arbitrary-property-by-string engine."

| # | Underlay | Owning authority today | Required extension | Absorbs (blocker families) |
| --- | --- | --- | --- | --- |
| 1 | **CHOOSE** | `RuleChoice` + `RuleExecutionInput` typed buckets (`automation/primitives/types.ts`); `kernels/teleport-choice.ts` as prior art | ONE semantic validator/resolver over the buckets: domain (actor/position/direction/option/number/boolean + result-of-roll), generic cardinality (exact/min/max/up-to/distinct), constraint composition (relation/range/LoS/occupancy/terrain), required-rejects-before-costs, optional-omit-means-decline | choice-input, player-choice, post-roll-reactive-choice, gamble-result-selection, selectable-terrain-placement, direction-override, multi-target choices, optional sacrifice/gain-or-lose choices |
| 2 | **QUERY / SELECTOR** | `RuleSelector` (`selectActors`, `kernels/runtime.ts`) | source-needed generic forms: entities/objects by type+owner, terrain cells, actors-at-position, nearest/farthest, count predicates, union/intersection/difference, exclude-prior-target, carrier/owner refs | entity-distance-selection, object-distance, recipient-expansion, summon-recipient-targeting, lifecycle-target-selection, target-selector-variant, under-character selection, aura membership, mark carrier/owner, member-count scaling, rebound candidates, multi-recipient movement |
| 3 | **NUMBER / EXPRESSION** | `RuleNumber` (`evaluateNumber`) | count(query)/distance/percent/status-count/member-count/path-count/elevation/current-use where a source needs them — all as expressions, NOT new arithmetic kernels | effect-count, status-count-scaling, member-count-scaling, damage-count-scaling, traversal-count, elevation-scaling, variable-cost, sacrifice-percent, threshold calculations, target-count calculations |
| 4 | **PREDICATE / GATE** | `RulePredicate` (`evaluatePredicate`) | construct compound gates from query+count+number (`compare(count(foes-in-area),'=',1)`); add has-mark/in-stance/inside-aura/used-this-scope/first-use/attacked-this-turn/effect-active | distance-predicate, conditional-distance-stun, stance-gate, aura-user-gate, aura-count-condition, mark-gated-modifier, mark-activation-gate, held-ability-gate, turn-end-no-attack, first-use-gate, terrain-conditional-rider, path-count-predicate, flying-targeting, entry-save-gate, many "only if…" clauses |
| 5 | **MODIFIER / QUERY-POINT OVERRIDE** | specialized authorities (range kernel `kernels/range.ts`, cost-payment, attack-resolution, save window, mastery-fold, bonus-damage) + `RuleModifier` | ONE typed modifier-recipe model `{source, queryPoint, scope, operation, value, condition}` registered per query point; deterministic fold order; ownership gate; closed negatives | range-modifier, active-effect-range-modifier, unlimited-range, movement/rush/fly/teleport/dash-distance-modifier, area-extension/area-modifier, aura-range-override, damage-modifier, damage-taken-modifier, attack-modifier, ability-attack-modifier, attack-result-modifier, save-modifier, save-result-modifier, dice-result-modifier, gamble-dice-pool-modifier, threshold-modifier, trigger-threshold-override, target-count-override, use-count-override, interrupt-rank, interrupt-use-scaling, interrupt-timing, action-cost-override, action-type-change, resource-cap-override, duration-modifier, area-persistence-override, power-die, fly-benefit-rider, delivery-immunity, defense-bypass, pierce, bonus-damage-suppression, crit-suppression, condition-suppression, condition-preserve, end-turn-suppress, cover-mechanic |
| 6 | **TRANSACTION / ECONOMY** | resource registry (`core.ts` RESOURCE_RULES) + cost-payment (`kernels/cost-payment.ts`) | one command-level transaction: derive → validate together → atomically accept/reject → emit recorded mutations. Support variable cost, sacrifice-%, wound cost, movement-entry cost, cap modifiers, once-per-X gates, heroics/resolve/combo interactions | resource-management, vigor-grant, heroics-economy, variable-cost, sacrifice-percent, wound-cost, movement-entry-cost, charge-combo-activation, action-cost-override (economy face) |
| 7 | **FLOW / SEQUENCE** | `RuleProgram`/`RuleStep`/`RuleEffect` (repeat/if) + `chosenTeleportPath` planned-path prior art | ORDERED INTERMEDIATE STATE: resolve step → apply to simulated clone → next step observes resulting state → durable output; original state never mutated during planning. Generic repeat (count expr, intermediate-apply flag, stop predicate), invoke, branch | ordered-intermediate-state, repeat-mechanic, conditional-fly-repeat, fly-or-teleport-repeat, rebound, cross-ability-invoke, pre-ability-movement, pre-ability-action, save-or-stun, effect-redirect sequences |
| 8 | **EVENT / OUTCOME FACTS** | `RuleResolutionFacts` (triggers/attackTargets/collided/slain) + lifecycle recipes | extend the recorded-facts vocabulary at each mechanic's resolve point (attack-hit/miss/critical/exceed, damage-determined/applied, movement entered/exited/distance-change, status applied/removed, save rolled, mark applied/removed, entity/terrain created, effect expired) | triggered-terrain-creation, cure-on-trigger, movement-trigger, movement-trigger-suppression, defeat-trigger, mark-defeat-trigger, enemy-ability-trigger, damage-dealt-trigger, attack-miss-trigger, attack-exceed-trigger, attack-trigger-grant, ability-trigger-grant, effect-expiry-trigger, lifecycle-trigger, area-exit-trigger, distance-change-trigger, shove-trigger, collide-rider, exceed-grant, comeback-trigger, summon-triggered-area-growth, terrain-move-lifecycle, entry-save-gate, turn-end-summon, turn-start-summon, zone-regeneration |
| 9 | **CONTINUATION / SCHEDULE** | `RuleContinuationState` (executedStepIds/derivedTriggers) + lifecycle recipes | one durable "armed continuation": source/program identity, trigger spec, captured durable references, source state, expiration, ordering. DEFERRED RESOLUTION (resolve against THEN-current state) is distinct from HELD RESULT (already-determined payload); never replace A with B | delay-mechanic, delayed-terrain, turn-end-summon, turn-start-summon, mark-detonation-window, effect-expiry-trigger, zone-regeneration, delayed explosions/meteors, future-state target choices |
| 10 | **DECISION / REACTION WINDOW** | interrupt/window engine (LIFO, held effects, held damage, reroll windows, retargeting) | generalize the existing window: trigger fact → eligible sources → optional/mandatory decision → hold payload → resolve → close. NOT every trigger becomes a window | interrupt-rider, interrupt-grant, interrupt-timing, post-roll-reactive-choice, damage-preview, enemy-ability-trigger reactions, gamble-result-selection, save rerolls, future Vigilance windows |
| 11 | **SPATIAL INTENT / MOVEMENT** | spatial gateway (`primitives/spatial-intent.ts`) + movement modes in `RuleEffect.move` | movement mode as data (standard/dash/rush/shove/fly/teleport/place/remove/swap) over ONE model; MovementSpec carries mover/mode/distance/choice/phasing/batch identity/cause; movement events record cause+mode so trigger recipes qualify facts | new-shove-effect, forced-placement, fly-move-timing, fly-move-substitution, fly-multirecipient, multi-actor-teleport, range-gated-teleport, spatial-state, once-per-round-fly-grant, pre-ability-movement, movement-trigger-suppression (permission face) |
| 12 | **PLACEMENT / AREA / TEMPLATE** | `RuleArea` + area-geometry + `validateEntityCreation` paired creation-spatial contract | AreaSpec (shape/origin/range/size/anchor/follow) + PlacementSpec (candidate region, LoS, occupancy/under-character policy, count, exact-vs-up-to, player-choice placement) | area-define, blast-template, area-extension, aura-to-area-conversion, area-effect-rider, selectable-terrain-placement, under-character-terrain, moving-area-terrain, cover-mechanic placement, summon placement |
| 13 | **PERSISTENT CARRIER / INSTANCE** | marks/stances/auras/active-effects stores + passive-projection closed manifests | common lifecycle/query contracts over the specialized stores (source/owner/carrier/state/duration/activation/modifiers/triggers/stacking/anchor/expiry) | mark-gated-modifier, mark-transfer, mark-stacking, mark-activation-gate, mark-defeat-trigger, mark-detonation-window, mark-as-entity-follow, stance-gate, stance-capacity, aura-user-gate, aura-trigger-grant, aura-count-condition, active-effect-range-modifier, duration-fly-state, passive, status-reapply, infuse-permanence, condition-preserve/suppression |
| 14 | **DURATION / LIFETIME** | `RuleDuration` | source-needed forms (until named event, N turn starts/ends, until round boundary, permanence) + expiry emits an ordinary event fact | duration-modifier, duration-fly-state, infuse-permanence, area-persistence-override, effect-expiry-trigger, delayed/persistent terrain clauses |
| 15 | **TERRAIN OPERATION** | `RuleEffect.terrain` (create/remove/raise/lower) | keep terrain simple: create/remove/transform/raise/lower/move-reanchor; inputs supplied by CHOOSE+QUERY+AREA+PLACEMENT+PREDICATE+TRIGGER+CONTINUATION+DURATION | ALL terrain-* families as compositions: triggered-terrain-creation = EVENT+TERRAIN(create); delayed-terrain = CONTINUATION+TERRAIN(create); selectable-terrain-placement = CHOOSE(position)+PLACEMENT+TERRAIN(create); under-character-terrain = QUERY+placement policy+TERRAIN; moving-area-terrain = persistent AREA(anchor)+TERRAIN; terrain-conditional-rider = PREDICATE+TERRAIN; terrain-transform/conversion = TERRAIN(transform); terrain-object-substitution = IF/CHOOSE+TERRAIN/ENTITY; summon-terrain-alternation = IF/CHOOSE+ENTITY/TERRAIN; zone-regeneration = lifecycle TRIGGER+TERRAIN |
| 16 | **ENTITY / OBJECT OPERATION** | entity-creation authority (`kernels/entity-creation.ts`) + entity-kind registry | generic create/summon/update/remove/consume/interact/relocate-follow; everything else composes with query/choice/placement/lifecycle | entity-vacate, entity-consume, entity-interaction, object-interaction, shadow-summon, summon-count-boost, summon-recipient-targeting, summon-alternation, summon-triggered-area-growth, mark-as-entity-follow |
| 17 | **ROLL** | DiceSource + attack/save/gamble authorities + damage ledger | one low-level deterministic RollSpec/ledger substrate (die size, pool, keep strategy, threshold, reroll, replacement, choose-among-rolled, maximize, preview/hold, provenance); attack/save/gamble remain semantic wrappers | gamble-dice-pool-modifier, gamble-result-selection, gamble-result-override, dice-result-modifier, save-result-modifier, attack-result-modifier, damage-maximize, damage-preview, power-die, threshold-modifier (roll face), rerolls |
| 18 | **USAGE / COUNTER / LEDGER** | ad-hoc per-turn/per-round flags in encounter state | generic scoped usage ledger: key/source/owner/target/count/cap/scope/reset-event/predicate; a usage ENTITLEMENT is not a spendable RESOURCE | use-count-override, interrupt-use-scaling, once-per-round-fly-grant, first-use-gate, auto-refresh, shared-turn-ledger, turn-end-no-attack, per-round reactions, per-source attack/movement gates |
| 19 | **PERMISSION / IMMUNITY** | typed flags in the damage/attack/save authorities (ignoreArmor, bypassVigor, ignoreAetherwall, …) | treat can/cannot/ignores/immune as TYPED permission query points in the modifier/gate system; keep distinct flags where source semantics differ (never alias every bypass to Divine) | delivery-immunity, condition-suppression, condition-preserve, defense-bypass, pierce, flying-targeting, cover-mechanic, movement-trigger-suppression, held-ability-gate, bonus-damage-suppression, crit-suppression, end-turn-suppress |
| 20 | **INVOKE / GRANT ACTION** | registered program/action authority | one generic invoke(source/action, target mapping, cost policy, timing, granted-free/interrupt flag) that calls the SAME registered authority | cross-ability-invoke, ability-trigger-grant, attack-trigger-grant, interrupt-grant, pre-ability-action, some action-type-change mechanics |
| 21 | **RETARGET / RECIPIENT TRANSFORM** | interrupt retargeting (Masquerade) + `resolution-targets` effect | typed recipient transforms: replace/add/remove/redirect/choose-from-query/apply-to-resolution-facts/exclude-already-hit | effect-redirect, recipient-expansion, target-selector-variant, rebound, summon-recipient-targeting, multi-recipient fly/teleport, held-effect retargeting |
| 22 | **REPEAT / ITERATION** | `RuleEffect.repeat` | extend FLOW semantics: count expression, body, intermediate-apply flag, target-repeat permission, per-iteration choice, stop predicate, outcome facts per iteration | repeat-mechanic, conditional-fly-repeat, fly-or-teleport-repeat, rebound, effect-count, damage-count-scaling, repeat-on-slay, repeat-on-exceed |
| 23 | **CARDS / DISCRETE COLLECTION** | — (none) | one generic discrete-collection abstraction (finite identities, owned set, draw via DiceSource, hand, discard/consume, return, choose item through CHOOSE, durable recorded draw) — never stretch scalar Resource | card-deck-system, card-consumption |
| 24 | **PHASE / STATE MACHINE** | foe phase skeleton (`ruleState.phaseId`) | generic trigger-driven state machine: current phase, transition predicates/triggers, enter/exit effects, recorded transition event | foe phases (B3), chapter rules, genuinely phase-shaped source mechanics |
| 25 | **AGGREGATE / MEMBER MODEL** | — (mob rejected at construction) | member pool per actor: member count, member-level removal, hits per member, derived stats, slay suppression, member-count RuleNumber queries | B2 Mob; member-count-scaling via the ordinary NUMBER system |
| 26 | **RELIC RUNTIME** | — (structured catalog only) | a CONTENT REGISTRATION layer over the same underlays (RuleProgram/Choice/Query/Effect/Resource/Trigger/Continuation/Carrier/Duration/Modifier/Roll/Ledger); a relic invoke is another registered action; a persistent rank is another registered modifier/trigger | F9 relics (120 ranks, 40 aspects) |

## Retired labels after the underlays exist

These census labels should be RETIRED (0 unresolved occurrences) once their
underlay lands, with every record re-read against its source passage and
reclassified to either "promoted" or a precise residual composition:

- After **CHOOSE** (1): `choice-input`, `player-choice`, `post-roll-reactive-choice`, `gamble-result-selection`, `selectable-terrain-placement` (choice face), `direction-override`.
- After **QUERY+NUMBER+PREDICATE** (2/3/4): `entity-distance-selection`, `object-distance`, `distance-predicate`, `conditional-distance-stun`, `status-count-scaling`, `member-count-scaling`, `path-count-predicate`, `traversal-count`, `target-selector-variant`, `lifecycle-target-selection`, `aura-count-condition`, `aura-user-gate`, `stance-gate`, `flying-targeting`, `target-count-override`, `effect-count`, `damage-count-scaling`, `elevation-scaling`.
- After **MODIFIER** (5): the whole modifier block (range/damage/attack/save/movement/area/cost/duration/permission families listed above).
- After **FLOW** (7/22): `ordered-intermediate-state`, `repeat-mechanic`, `conditional-fly-repeat`, `fly-or-teleport-repeat`, `rebound`, `cross-ability-invoke`, `pre-ability-movement`, `pre-ability-action`, `save-or-stun`.
- After **EVENT+CONTINUATION+WINDOW** (8/9/10): the trigger block (`*-trigger`, `*-grant`, `cure-on-trigger`, `delay-*`, `mark-detonation-window`, `damage-preview`).
- After **SPATIAL** (11): `new-shove-effect`, `forced-placement`, `fly-move-*`, `multi-actor-teleport`, `range-gated-teleport`, `spatial-state`, `once-per-round-fly-grant`.
- After **AREA/PLACEMENT** (12): `area-define`, `blast-template`, `area-extension`, `area-effect-rider`, `aura-to-area-conversion`, `under-character-terrain`, `moving-area-terrain`.
- After **CARRIER+DURATION** (13/14): the mark/stance/aura block, `duration-fly-state`, `passive`, `status-reapply`, `infuse-permanence`.
- After **ROLL** (17): the gamble/dice/save-result block, `damage-maximize`, `power-die`.
- After **LEDGER** (18): `use-count-override`, `interrupt-use-scaling`, `first-use-gate`, `auto-refresh`, `shared-turn-ledger`, `turn-end-no-attack`.
- After **COLLECTION** (23): `card-deck-system`, `card-consumption`.

Already retired by prior passes (do not resurrect): `{teleport}`, `{fly-grant}`,
`{terrain-create}`, `{entity-create}`, `{mark-modifier}`, `{damage-modifier}`
(coarse), `{range-modifier}` (singleton), `{shove-modifier}`, `{charge-state}`.

## Tranche order (architectural value, not blocker-name order)

After EACH tranche: re-run strict source fidelity; regenerate
`blocker-census.json/md`; recompute marginal unlocks; re-read every newly
promotable singleton directly against ICON 1.5.pdf; promote only complete
source units; merge/reclassify coarse labels the new substrate makes
obsolete; run the full suite; ensure the census is byte-stable on a second run.

1. **CHOICE** — one choice authority over the typed input buckets; generic
   cardinality + validation; network schema parity (USE_ABILITY carries every
   supported choice form); promote the 8 `{choice-input}` singletons ONLY
   where their complete semantics are now expressible. Never fake a choice
   that occurs after a future event (those await CONTINUATION/WINDOW).
2. **QUERY + NUMBER + PREDICATE** — extend the expression algebra to kill the
   simple count/distance/status/member predicates; re-audit `effect-count`
   (a large fraction is composition, not a new primitive).
3. **MODIFIER QUERY POINTS** — normalize the FooModifier families into one
   typed modifier-recipe model consumed by the existing range/cost/attack/
   save/mastery authorities; harvest simple singletons aggressively.
4. **FLOW + ORDERED INTERMEDIATE STATE** — multi-step abilities become
   source-correct (generic repeat/invoke/branch over a simulated clone;
   command purity preserved).
5. **EVENT FACTS + CONTINUATIONS + WINDOWS** — generic delayed resolution,
   generic future choices, generic automatic triggered effects; extend the
   interrupt engine for decision windows rather than creating siblings.
6. **AREA / PLACEMENT / TERRAIN** — generic player-selected area/terrain
   placement over CHOOSE; delayed/triggered terrain become compositions;
   moving terrain uses persistent anchors; revisit the seven terrain units
   retracted in 554d8ca.
7. **USAGE + CARRIER/LIFETIME + ROLL EXTENSIONS** — generic counters, expiry
   events, mark/aura/stance common projections, result/pool transforms.
8. **Genuinely structural systems** — discrete card collection, foe phase
   state machine, Mob member model, relic registration over the existing
   runtime.

## Critical semantic boundaries (non-negotiable)

- **Pre-resolution vs post-resolution choices.** A PRE-resolution choice can
  ride the initiating command. A choice whose candidate set depends on a
  roll, damage result, movement result, future turn state, or delayed
  explosion CANNOT be supplied speculatively — it must use the generic
  continuation/window system and ask when the choice becomes meaningful.
- **DEFERRED RESOLUTION vs HELD RESULT.** "At the start of your next turn, do
  X" stores the rule continuation and resolves X against THEN-current state.
  "The already determined effect waits until this interrupt closes" stores
  the determined mutation because its amount/result is already authoritative.
  Never replace A with B (the lesson of the terrain retractions in 554d8ca).
- **Fail closed.** Missing required choices, malformed spatial contracts,
  invalid targets, unavailable resources, impossible atomic effects reject —
  they never silently degrade into a different mechanic.
- **No source-ID switches in generic code.** Source IDs live in registered
  recipe/content rows; generic kernels consume typed recipes.
- **Replay purity.** `executeCommand` stays pure; all randomness and outcome
  decisions happen once at the command/window boundary and ride recorded
  events; `applyEvents` never re-decides mechanics.
