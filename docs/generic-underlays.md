# Generic underlays, domain authorities, and structural subsystems

Authoritative design document for the remaining ICON 1.5 mechanics work.
This pass (2026-08-29) refines the previous underlay collapse map by
separating THREE different kinds of reusable concept that the older list
flattened into one numbered roof of ~26 peer entries:

- **A. FUNDAMENTAL UNDERLAYS** — the small semantic algebra rules compose
  from (~17, listed as U1–U17; U18/U19 are candidates, not yet promoted).
- **B. DOMAIN AUTHORITIES** — generic ICON mechanical systems built USING
  those underlays (targeting, movement, area, placement, attack, damage,
  save, resource, status, persistent instance, terrain, entity, roll,
  lifecycle).
- **C. STRUCTURAL SUBSYSTEMS** — large reusable state models that are
  neither primitive algebra nor ordinary domain operations (cards,
  mob/aggregate, foe phase state machine, relic registration).

The goal is NOT to rename files for aesthetics and NOT to build a universal
game-engine DSL. The goal is the smallest stable semantic vocabulary so that
future source rules become compositions over independently testable
operations. Genericity occurs where ICON 1.5 itself repeatedly exhibits the
same semantic operation; one source-ID name or one prose sentence is not
enough to justify a new underlay.

The objective measure of success is: **fewer independent semantic
authorities**, not more files. The blocker census should NOT turn into ~150
new architectural primitives — most census blocker names are missing
COMPOSITIONS or missing QUERY POINTS on the ~17 underlays plus the shared
domain authorities.

Related documents: [`rules-foundations.md`](rules-foundations.md) (foundation
maturity + missing-kernel ledger this document supersedes for sequencing),
[`blocker-census.md`](blocker-census.md) (**generated** census),
[`source-fidelity.md`](source-fidelity.md) (**generated** strict-fidelity
status), [`roadmap.md`](roadmap.md) (phase gates),
[`tranche-1-choice.md`](tranche-1-choice.md) (the landed CHOOSE tranche).

---

## Design test (apply before any new "underlay" or "primitive")

For every proposed new generic mechanism, ask these questions IN ORDER and do
not advance past them (the Part VII acceptance test, restated operationally):

1. Is this merely a new REFERENCE kind? → U1
2. Is this a ROLE / perspective distinction? → U2
3. Is this just a QUERY over existing things? → U3
4. Is this a CHOICE from those candidates? → U4
5. Is this a VALUE or PREDICATE expression? → U5 / U6
6. Is this a spatial ANCHOR distinction? → U7
7. Is this just a different SCOPE? → U8
8. Is this historical PROVENANCE or a FACT? → U9 / U10
9. Is this an operation in FLOW? → U11
10. Is this a delayed CONTINUATION? → U12
11. Is this a reaction WINDOW? → U13
12. Is this a typed MODIFIER / POLICY query point? → U14
13. Is this just an atomic TRANSACTION grouping? → U15
14. Is this a USAGE / entitlement count? → U16
15. Is this an ORDERING policy? → U17
16. Is it an operation of an EXISTING DOMAIN AUTHORITY? → Part B
17. Is it a genuinely new STRUCTURAL STATE MODEL? → Part C

> Could I instead describe this as composing U1–U17 under one domain
> authority in Part B, or as a structural model in Part C? If YES, do that.
> Only propose a new top-level underlay (U18 U19 …) after answering NO to
> all of the above and demonstrating a genuinely different kind of state or
> authority repeated by the source.

---

# PART A — FUNDAMENTAL UNDERLAYS

The small semantics rules are composed from. Each row answers one question
and notes (i) the owning authority today and (ii) the required extension.

## U1 Reference / Binding

Question: *"What thing/value does this later rule clause refer to?"*

Today reference is implicit across `context.actorId`, `attackTargetId`,
`triggerSourceId`, `triggerTargetIds`, `damageRecipientId`, input buckets,
`resolutionFacts`, `state` keys, entity ids, marks, terrain ids — a
proliferation that is a warning, not a design.

Required vocabulary: a typed reference capable of naming actor, entity/
object/summon, battlefield position, area, terrain effect, persistent effect,
mark/stance, resource pool, rule/action/source, roll/result, number/value,
and a COLLECTION of references. Bound names from earlier operations:

    CHOOSE a position AS landing
    QUERY adjacent foes AS nearby
    ATTACK target
    BIND slain actors AS slain

Later effects consume references; they do not add another bespoke context
field whenever a new source needs to remember something.

CRITICAL distinguishing lifetime:

- **LIVE reference** — resolve against CURRENT state when used (`at start of
  its next turn, damage adjacent characters` → retain the actor ref; query its
  then-current position).
- **CAPTURED value/reference** — preserve the source-required value/state
  from the earlier point (`at end of turn, explode at the chosen space`
  → capture the position; `return relative to your original location` →
  capture the position).

This distinction must be explicit, never inferred from whatever fields were
serialized. `RuleContinuationState` (executedStepIds/derivedTriggers) and
`RuleResolutionFacts` are the current homes; neither yet carries LIVE-vsCAPTURED refs across continuations.

Foundational for: FLOW, CONTINUATION, TARGETING, RETARGET, AREA, MOVEMENT,
ENTITY, TERRAIN, delayed effects, rebound, marks, persistent effects.

## U2 Role / Perspective

Question: *"Relative to WHOM is this being interpreted?"*

Never assume these coincide: source/ability user, owner of an effect,
controller, chooser/decision-maker, payer, target, recipient, carrier,
creator/summoner, trigger source, trigger recipient, attacker, defender,
original user, current origin. ICON repeatedly separates them.

    ally relative to SOURCE
    choice made by TARGET_CONTROLLER
    resource paid by USER
    mark owned by MARK_OWNER
    effect carried by TARGET
    spatial origin = REBOUND_ORIGIN
    effects-on-user still refer to ORIGINAL_USER

Not a stringly bag. Critical for multiplayer/VTT authority: the engine must
derive WHICH connected player is entitled to answer a ChoiceSpec from
semantic controller/chooser roles. The durable save-reroll window (Sucker
Punch p.143) decides who owns a reroll; the when-damaged/defeated/uses-
ability/area-inclusion/targeted windows (`kernels/trigger-window.ts` + the
p.107 window rules in `core.ts`) decide who answers and against whom; and the
aura kernel's bearer-vs-member distinction (`kernels/aura.ts`) is a role
boundary the engine must derive, never string-match.

## U3 Query / Candidate

Question: *"What things currently qualify?"*

The common deterministic eligibility authority UNDERNEATH both automatic
targeting and player choices:

    Query<T> -> CandidateSet<T>

Domains: actors/characters, summons, objects/entities, positions, terrain
effects/cells, areas, persistent instances, marks/stances, rule sources/
actions, rolls/results where relevant. Composable operators: all; relation
to role/reference; range; adjacency; LoS; LoE; inside/outside area;
occupying position; free/occupied space; terrain predicate; condition/
status/mark/stance predicate; alive/defeated/incapacitated; flying/intangible;
owned by / controlled by; nearest/farthest; nth/first/last where the SOURCE
defines a deterministic ordering; union/intersection/difference; exclude
prior recipients; count; distinct-by-identity.

DO NOT let CHOOSE (U4) independently implement targeting legality:

    candidates = evaluateQuery(choice.candidates, context)
    selection    = resolveChoice(choice, candidates, suppliedInput)

Then "Choose one foe in range 3" and "All foes in range 3" use the SAME
legality machinery. The PDF's targeting categories (Self, Ally, Foe, Summon,
Characters, Others, Space, Object) are ONE target vocabulary, not separate
selector engines.

Today: `selectActors` (`kernels/runtime.ts`) is a thin adapter over
`kernels/evaluate-query.ts` `evaluateActorQuery`; the direct-target command
gate (`encounter.ts::assertDirectTarget`) routes base eligibility through
`kernels/candidate.ts` while `primitives/targeting.ts` pins the
direct-target problem vocabulary (relation/range/stealth/LoS); actor
inclusion in areas is a query read (the `insideArea` operator) over the
spatial gateway's cells (`computeSpatialArea`); a mob member model does
not exist yet (`createFoeFromProfile` rejects the mob role — TODO/roadmap
B2). The specialists keep their spatial models; the eligibility
authorities still to merge behind one Query type are `nearestFoe`/
`freeCellsInRange` resolver sugar and position-domain candidate legality
(`kernels/teleport-choice.ts`).

## U4 Choice / Decision

Question: *"Which member(s)/option/value did the entitled player choose?"*

CHOOSE validates that the supplied selection is a member of the CandidateSet
and satisfies cardinality — it does NOT own candidate legality beyond that.
Landed tranche 1 (`kernels/choice.ts`, `docs/tranche-1-choice.md`).

Core dimensions: chooser role/controller; candidate domain; cardinality;
required vs optional; distinct/repetition policy; ordering if meaningful;
closed options; bounded number; direction; yes/no.

Optionality MUST correspond to source language — effects are mandatory unless
the source says "may"/"can"; never infer optionality because declining would
be convenient. Missing required choice ⇒ reject before any cost/RNG/mutation;
optional missing ⇒ decline (`null`), never a default.

CHOICE timing can differ (command-time, post-roll, after-damage, interrupt
window, delayed continuation, simultaneous-order) and all use ONE semantic
ChoiceSpec even if transport happens through different windows. A post-result
decision is not a second choice system.

Today: `kernels/choice.ts` `resolveChoice/resolveChoices`; `RuleChoice`;
`RuleExecutionInput` buckets; `kernels/teleport-choice.ts` (teleport
specialist consuming the same violation codes). Chooser/controller roles do
not yet ride the row.

## U5 Value / Expression

Question: *"What scalar/value does this rule evaluate to right now?"*

Generalizes NUMBER to typed expressions: constant, stat, resource,
count(query), distance, round, turn index, usage count, status count, entity/
member count, damage result, roll result, elevation, area size, movement
traversed, percent of BASE max HP, arithmetic, min/max/clamp, conditional.
Non-numeric values (positions, refs, colors, IMMUNITY kinds in U14) stay
typed rather than collapsing through number/string.

Percent-health uses maximum BASE HP, not wounds-adjusted max HP — the reason
expressions need explicit stat/value semantics, not resolver arithmetic.
Do NOT create `statusCountDamageKernel` / `memberCountDamageKernel` /
`missingHpQuarterKernel`; express them.

Today: `RuleNumber` + `evaluateNumber` (`kernels/runtime.ts`); `hp-threshold`.
Missing source forms: count(query), distance-between-arbitrary-refs,
percent-of-BASE-max, usage reads, status/member counts, traversed-distance,
elevation, conditional typed values.

## U6 Predicate / Condition

Question: *"Is this rule clause applicable now?"*

Builds on QUERY + VALUE + REFERENCE:

    bloodied(source)
    count(foesInArea) == 1
    distance(source,target) >= 3
    hasStatus(target, weakened)
    markExists(owner,target)
    isSlowTurn(source)
    round >= 4
    usageCount(source,key,round) == 0
    terrainAt(target) contains pit
    original entity still exists
    target has not acted this round

Avoid bespoke "gate" kernels whenever this expression algebra suffices.
Today: `RulePredicate` + `evaluatePredicate` (`kernels/runtime.ts`); missing
compound gates from query+count+number + has-mark/in-stance/inside-aura/
used-this-scope/effect-still-exists.

## U7 Anchor / Spatial Frame

Question: *"From where is this spatial rule measured/attached?"*

Entity-creation already discovered PLACEMENT REGION vs CREATOR LoS/RANGE
ORIGIN are distinct (`RuleEffect.entity.spatial`). Generalize: name every
spatial relationship's frame explicitly.

    range from <anchor>
    LoS from <anchor>
    area centered on <anchor>
    aura follows <anchor>
    return relative to <captured-anchor>
    move away from <anchor>
    shove away from <anchor>
    nearest to <anchor>

Anchor can refer to actor footprint, entity/object, chosen position, bound
position, target, area center, source, mark carrier, persistent carrier,
captured/snapshot position, current/live position. Vital for Rebound: the
rebound character's space becomes the ORIGIN for cover/LoS/etc while effects
on the original user still apply to the original user — ROLE (U2) ≠ ANCHOR
(U7). Do NOT encode both through `context.actorId`.

Today: `spatial-intent.ts` footprint/anchors; `RuleArea.origin`
(self/target/position/entity); creation-spatial contract (placement region vs
creator LoS/range); `teleport-choice` arbitrary-origin selection
(`SpatialOrigin`). A generalized `SpatialAnchor` unifies these.

## U8 Scope / Clock

Question: *"Within what temporal/usage boundary is this interpreted?"*

ONE shared vocabulary: action, ability resolution, turn, between-own-turns,
slow turn, round, combat, expedition, camp, interlude, permanent, N
occurrences of a boundary, next matching boundary, source-defined lifecycle
event. Reused by durations, usage counters, refreshes, once-per-X, costs,
interrupts, trigger de-duplication, delayed effects, resources, persistent
instances. Do NOT let Duration/UsageLedger/Interrupt-refresh/Resource-reset/
"once per round" each define their own "round".

Today: the lifecycle turn/round machinery (`kernels/lifecycle.ts`), `RuleDuration`,
use-ledger periods, `RuleTiming`. Missing: named-event and N-boundary forms and
an explicit shared Clock concept every user reads.

## U9 Provenance / Cause

Question: *"What caused this outcome?"*

Richer than `sourceId`. Dimensions: source rule/action/effect; source actor;
owner; controller; attack/effect/terrain/save; movement mode;
voluntary/forced/granted; original action; parent event/effect; trigger
chain; recipient; damage delivery; attack-target vs collateral recipient;
rebounded/redirected; teleport/place/rush/fly/shove; terrain/entity
source-created; current ability-resolution identity.

Needed because ICON semantics are causal: Pacified breaks on damage from a
FOE'S ability/action (not self/terrain); Slay means THIS ability reduced a
character to 0; Collide means shoved INTO obstruction AS PART OF THIS
ability; dangerous terrain has its own delivery; triggered effects fire once
per ability. Never reconstruct cause from current state or source names.

Today: `sourceActorId` on mutations, `RuleResolutionFacts`, attack/damage
provenance (`attackDamageProvenance`, `DamageIntent.hostile`,
`resolutionFacts` in `RuleExecutionContext`), `DeliverySourceKind` in the
movement authority. Events/mutations must carry enough provenance to answer
source questions.

## U10 Fact / Outcome

Question: *"What authoritative thing has already happened?"*

Separate FACTS (historical, recorded by this resolution) from PREDICATES
(evaluate current state). Examples: attack hit/missed/critical/exceeded;
damage determined/applied; actor damaged/defeated; source slew targets;
collide occurred; movement entered/exited/passed-through cells; actual
distance moved; moved closer/farther; status applied/removed; save rolled/
succeeded/failed; entity/terrain created/removed; effect expired; ability
resolved. Facts must be authoritative and replayable.

Triggered-effect de-duplication ("a given triggered effect only triggers once
per ability even when multiple routes would trigger it") belongs here WITH
USAGE (U16). Never rediscover a historical outcome from current state.

Today: `RuleResolutionFacts` (triggers/attackTargets/collided/slain),
`encounterAdapter` fact ledger, `resolutionFacts` already durable.
Extend the vocabulary at each authority's resolve point; the duplication gate
reads the same durable identity (U16 usage key) + a U10 fact rather than
re-deriving from current state.

## U11 Flow / Sequence

Question: *"In what order are operations executed, and what can later
operations observe?"*

The core little language. Operations: sequence; let/bind; choose; if; apply
effect; repeat/for-each; invoke; emit fact; open decision window;
suspend/continue later.

CRITICAL: every operation in a normal ordered ability sequence sees the
ACTUAL INTERMEDIATE STATE produced by preceding operations (ICON: effects
resolve in listed/explicit order):

    rush, then damage adjacent foe
    remove object, then place user in its space
    teleport, then test adjacency
    shove, then collide
    rush 1, then rush 1, each time optionally damage
    remove two actors, then place them adjacent in free spaces

Use a simulated intermediate state during command planning while preserving
the pure command/event architecture. Repeat, RETARGET, INVOKE are FLOW
OPERATIONS, not top-level underlays — retire them as peers.

Today: `RuleProgram/RuleStep/RuleEffect`, `executeRuleProgram`,
`effectsToMutations`, `orderedSelectedSteps` (`kernels/runtime.ts`). Flow
effects already out-order; intermediate state is NOT yet simulated (a later
`repeat` cannot observe a prior `move`'s result). `spatialBatchId` swap
legs and `resolution-targets` are prior art for observation+grouping.

## U12 Continuation / Suspension

Question: *"What part of this rule is armed now but resolves later?"*

Durable continuation stores: source program/action; continuation point/step;
owner/controller; triggering Clock/Fact spec; references; explicitly captured
values; source-required state; expiry/cancellation; ordering identity.

Distinguish:

- **DEFERRED RULE** — resolve later against THEN-CURRENT state.
- **HELD RESULT** — an already-determined result waits for a window to close
  (never replace A with B).

Needed for: Delay, delayed terrain, delayed explosions, next-turn effects,
armed mines, future summons, future target choices, "after next turn", mark
detonations, return-from-removed-state. ICON Delay: at the start of the slow
turn, Delay effects activate before ordinary turn activity — represent that
with Clock + Ordering, not bespoke Delay code per source.

Today: `RuleContinuationState` (executedStepIds/derivedTriggers) + lifecycle
`delayed` phase. The armed-continuation record and LIVE/CAPTURED refs are the
missing pieces (the terrible terrain retractions in 554d8ca were because
continuations were approximated).

## U13 Window / Decision Point

Question: *"Has ordinary resolution paused to permit/react to a decision?"*

One generic decision/reaction window vocabulary, specialized by typed window
kind: triggering Fact; eligible responders/query; decision maker; eligible
registered source rules; held payload; ordering policy; action/choice;
close/resume.

Use for: interrupts; post-roll rerolls; post-damage-determination decisions;
Vigilance; simultaneous-owner ordering when mechanically interactive; future
post-result choices. Do NOT turn automatic triggered effects into windows.
Interrupt priority and nesting are real, so this stays an underlay rather
than a mere EVENT recipe.

Today: `kernels/trigger-window.ts` (TRIGGER_WINDOW_RECIPES,
`openDamageWindow`, `decideDamageWindow`, LIFO held effects/held damage),
`save-window.ts`, `gamble-window.ts`, pending interrupts in encounter state.
These are already one family; they need a SINGLE decision-window record shape
covering the source-defined windows.

## U14 Modifier / Policy

Question: *"How does an attached rule alter a typed query point?"*

    ModifierRule { source, owner/reference, queryPoint, scope, operation,
                   value, predicate, priority/ordering if required }

Keep QUERY POINTS typed. Examples: listed range; internal range; area size;
movement distance; target count; action cost/type; damage dealt; damage
taken; damage die; attack boon/curse; attack threshold; save boon/curse; save
threshold; use cap; interrupt rank; duration; resource cap; permission;
immunity; cover; LoS/LoE permission; trigger permission.

PERMISSION/IMMUNITY is a typed policy/modifier query, NOT a separate underlay
— but "can/cannot/ignore/immune" stay DISTINCT typed query points, never one
collapsed boolean. Deterministic fold order; ownership gate; closed negatives
(never alias every bypass to Divine).

Today: `kernels/range.ts` (RangeModifierRule, scopes),
`kernels/area.ts` (AreaModifierRule), `kernels/cost-payment.ts`
(CostModifierRule), `attack-modifiers.ts` trait fold, `mastery-fold.ts`,
aura boon/curses, `save-window` boon/curse, damage exceptions on
`DamageIntent`/`RuleMutation`. This is the family with the most redundancy:
unify the fold discipline per query point over ONE recipe shape.

## U15 Transaction / Atomic Commit

Question: *"Which proposed state changes must validate together before any
commit?"*

Deeper than ECONOMY. Shared by: costs; resource spends; sacrifice; resolve
split across party/personal pools; atomic swaps; exact-count creation;
multi-leg required movement; possibly grouped choices/effects where source
says all-or-nothing. Lifecycle: propose intents → validate against ONE
authoritative/intermediate snapshot → if all required legs legal, emit
mutations; else reject / source-defined fallback.

Do NOT merge all validation algorithms (spatial stays spatial; payment stays
economy). The reusable underlay is ATOMIC GROUPING + COMMIT SEMANTICS.
`spatialBatchId` is prior art; creation `countMode: 'exact'` and cost-payment
`assertRuleCostsPayable` are the other instances.

## U16 Usage / Entitlement Ledger

Question: *"How many times has/may this rule be used/triggered within Scope
X?"*

Distinct from spendable RESOURCE. Represent: key/source; owner/reference;
optional target/reference; scope; count; cap; reset Clock; increment/consume;
refresh; de-duplication identity.

Use for: once-per-turn; once-per-round; N/round; N/combat; first use;
interrupt refresh; trigger once per ability; trigger once per target;
dangerous-terrain once per turn; slashed once per turn; one attack-tag
ability per turn; no-repeat ability rule; limit break once/combat; Vigilance
once per trigger. Foundational because the PDF uses scoped entitlement
everywhere.

Today: `kernels/use-ledger.ts` (turn/round/combat durable gates), F9
`roundLedgerKey`, interrupt-use counter, turn-attack/ends-used flags. Missing:
count-override caps, per-use magnitude reads ("2nd/3rd use dashes 3/2/1"),
refresh hooks, and the shared de-dup identity for trigger families.

## U17 Ordering / Arbitration

Question: *"When multiple operations are simultaneously eligible, what
determines their order?"*

Typed policies, NOT one `priority: number`: source-order; stack/LIFO;
turn-order; hostile-before-beneficial; non-active-owner-before-active-owner;
controller-choice; explicit ordered list. A policy may YIELD A CHOICE when
the source gives someone authority to order.

ICON has several: listed effect order; explicitly overridden effect order;
interrupt nesting (most-recent trigger first); same-trigger interrupt
turn-order rules; turn-boundary ordering (non-turn-character effects first,
hostile before beneficial, same-owner player determines order); Delay
ordering; turn alternation; player ordering choices. Prevents arbitrary array
iteration from becoming the game rule.

Today: `orderedSelectedSteps` (source order), lifecycle registry order,
pending-interrupt order, TRIGGER_WINDOW_RECIPES order. Ordering is scattered;
U17 gives it a home.

---

## Candidates (evaluate, do not yet promote)

**U18 Attachment / Contribution.** Recurring pattern: trait/talent/mastery/
relic/status/mark/persistent effect CONTRIBUTES mechanics to another action/
query point (talent/mastery/attack modifier, persistent-granted interrupt,
mark changes target treatment, stance grants effects). Do not maintain
separate modifier architectures solely because the category is named Talent vs
Mastery vs Trait vs Relic. A generic recipe:

    source attachment
    ownership/equipment predicate
    attachesTo query
    contributions: modifiers | extra flow steps | triggers/windows |
                   action grants | policy grants | choices

May deserve U18 if it cleanly eliminates independent fold architectures
(`mastery-fold.ts` + trait fold + talent fold + fortune). Typed contribution
kinds only — no opaque callbacks. Until the folds are actually consolidated,
keep it a candidate.

**U19 Intent.** A typed layer between FLOW and mutations:

    source rule -> Flow ops -> typed mechanical Intent -> domain authority
    validates/resolves -> durable Mutation/Event

Partial evidence exists (entity `creation-spatial` intent, `SpatialIntent`,
`resolveSaveWindow` spec). Promote only if it removes duplicated authority,
never as a ceremonial wrapper around every RuleEffect. Candidate.

---

# PART B — DOMAIN AUTHORITIES

Generic ICON mechanical systems BUILT FROM the underlays. They remain
important shared engine systems but are not peer foundational algebra. Each
is a composition:

| Authority | Composition (underlays) | Existing homes |
| --- | --- | --- |
| **Targeting** | QUERY + ROLE + ANCHOR + POLICY + LoS/LoE | `primitives/targeting.ts`, `kernels/range.ts`, `selectActors`, `spatial-intent.ts` LoS |
| **Spatial / Movement** | REFERENCE + ROLE + ANCHOR + QUERY + CHOICE + TRANSACTION + PROVENANCE | `spatial-intent.ts` gateway, movement modes, `walk`/move reducer |
| **Area / Template** | ANCHOR + QUERY + VALUE + CHOICE | `kernels/area.ts`, area-geometry, `computeSpatialArea` |
| **Placement** | ANCHOR + QUERY + CHOICE + TRANSACTION | entity `creationSpatial`, placement region, `validateEntityCreation` |
| **Attack** | QUERY + CHOICE + ROLL + MODIFIER + FACT + DAMAGE | `attack-resolution.ts`, `ordinary-attack.ts`, `attack-modifiers.ts` |
| **Damage** | VALUE + MODIFIER + PROVENANCE + TRANSACTION/ordered pipeline + FACT | `damage-resolution.ts`, `damage-ledger.ts` |
| **Save** | ROLL + MODIFIER + FACT + WINDOW | `save-window.ts`, `status-saves.ts` |
| **Resource / Economy** | VALUE + SCOPE + TRANSACTION + MODIFIER | `cost-payment.ts`, RESOURCE_RULES, fairness/party resolve |
| **Status / Condition** | PERSISTENT INSTANCE + POLICY + LIFETIME + EVENT/FACT | status/condition stores + `passive-projection.ts` |
| **Mark / Stance / Aura** | PERSISTENT INSTANCE + domain semantics using REFERENCE/ROLE/SCOPE/POLICY | aura kernel, mark records, stance records |
| **Terrain** | spatial authority using AREA/ANCHOR/QUERY/CHOICE/CONTINUATION | terrain effects + Plateau/Impassable types |
| **Entity / Object / Summon** | QUERY/PLACEMENT/LIFETIME/PROVENANCE | `entity-creation.ts`, `entity-kind.ts`, summon registry |
| **Roll** | deterministic RNG authority + recorded result | `DiceSource`, attack/save/gamble, damage ledger (ROLL may stay a narrow domain authority, not a broad underlay) |
| **Lifecycle** | SCOPE/CLOCK + FACT/PROVENANCE over boundaries | `kernels/lifecycle.ts`, `resolver-triggers.ts`, `mail/rally` ingredients |

The point of separating these: TARGETING, ATTACK, SAVE, DAMAGE, RESOURCE,
STATUS, MARK/STANCE/AURA, TERRAIN, ENTITY are SYSTEMS. They consume underlays
but are not new algebra; improvements inside them must not spawn new top-level
underlays.

---

# PART C — STRUCTURAL SUBSYSTEMS

Large reusable state models built using underlays and domain authorities;
NOT members of the same algebra:

- **CARDS / DISCRETE COLLECTION** — finite identities, owned set, draw via
  ROLL, hand/discard/consume/return, choose item through CHOOSE, durable
  recorded draw. (`card-deck-system`, `card-consumption`.)
- **MOB / AGGREGATE MEMBER MODEL** — member pool per actor, member count,
  member-level removal, hits per member, derived stats, slay suppression,
  member-count QUERY/NUMBER reads.
- **FOE PHASE STATE MACHINE** — trigger-driven phases, transition
  predicates/triggers, enter/exit effects, recorded transition EVENT.
- **RELIC REGISTRATION / RUNTIME** — primarily CONTENT REGISTRATION over the
  common runtime (a relic invoke = another registered action; a persistent
  rank = another registered modifier/trigger). NOT an underlay.

---

# Dependency / composition diagram

```
                      content/
                        recipes (source-keyed parameterization)
                             │  content rows select targets, set constants,
                             │  build typed mutations, wire attachment folds
                             ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ DOMAIN AUTHORITIES (Part B) — targeting, movement, area,     │
   │ placement, attack, damage, save, resource, status,           │
   │ mark/stance/aura, terrain, entity, roll, lifecycle           │
   └──────────────▲──────────────────────────────┬───────────────┘
                  │ consumes                     │ emits
   ┌──────────────┴──────────────────────────────▼───────────────┐
   │ FUNDAMENTAL UNDERLAYS U1–U17 (Part A)                       │
   │ reference role query choice value predicate anchor scope    │
   │ provenance fact flow continuation window modifier transact  │
   │ usage ordering                                              │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ built on
                                  ▼
                         primitives/ (pure algebra + pure helpers)
   STRUCTURAL SUBSYSTEMS (Part C) ── cards / mob / foe phases / relic
   sit beside the domain authorities and are built with the same underlays.
```

Direction preserved: `content → kernels → primitives`. No `underlays/` layer.

---

# Existing code ownership (map to real files)

**primitives/** (nouns — typed vocabulary, pure constructors/helpers):
- `types.ts` — the underlay vocabulary partition now lives here (RuleSelector,
  RuleNumber, RulePredicate, RuleChoice, RuleDuration, RuleEffect, RuleMutation,
  RuleModifier, RuleExecutionInput/Context/Result, views). Keep as a
  compatibility barrel when files split (Part "Incremental file split").
- `job-kit.ts` — content-authoring SUGAR (self/attackStep/constant/damageDie/
  selectors) + pure spatial/movement helpers (walk/freeCellsInRange/nearestFoe/
  swap/placement) + mutation builders + gambleD6. See split plan below.
- `spatial-intent.ts` — footprint geometry (§F1), the SpatialIntent movement
  gateway, area computation, creation-intent.
- `targeting.ts` — target-eligibility relation/range/stealth/LoS seeds.
- `line-of-sight.ts` — LoS/LoE view.
- `attack-resolution.ts` — framework-free AttackRoll/damage provenance.
- `damage-resolution.ts` — framework-free damage determination/apply.
- `save-window.ts` — the SaveWindowSpec/record + resolve.
- `status-saves.ts` — cure/status-save policy helpers.
- `entity-kind.ts` — summon/object registry, no string heuristics.
- `cost-payment.ts` — cost mutation builders + availability asserts (pure).
- `gamble-window.ts`, `foe-kit.ts`, `ability-use-choices.ts` — authoring/
  window sugar.

**kernels/** (verbs — authoritative evaluation against state / registries):
- `runtime.ts` — the VM: selectActors/evaluateNumber/evaluatePredicate/
  effectsToMutations/executeRuleProgram + cost fold. Too much authority in one
  file; extract per underlay (split plan below) while re-exporting.
- `choice.ts` — ONE semantic CHOOSE validator (landed tranche 1).
- `area.ts`, `range.ts`, `cost-payment.ts`, `attack-modifiers.ts`, `mastery.ts`,
  `mastery-fold.ts`, `bonus-damage.ts`, `ordinary-attack.ts`, `save-window.ts`,
  `hp-threshold.ts` — the typed modifier/recipe registries + folds.
- `entity-creation.ts`, `summon-recipes.ts` — placement/entity authority.
- `damage-ledger.ts`, `encounter-adapter.ts`, `trigger-window.ts` — durable
  facts + interrupt windows.
- `lifecycle.ts`, `resolution-triggers.ts`, `movement-triggers.ts`,
  `trait-reactions.ts`, `passive-projection.ts` — lifecycle/trigger/fact folds.
- `use-ledger.ts` — usage gates. `power-die.ts` — scalable resource die.
- `teleport-choice.ts` — teleport specialist.
- `aura.ts`, `attack-resolution.ts` — authority kernels.

**content/** (source sentences) — `registry.ts`, `jobs/`, `classes/`, `foes/`,
`glue/` compilers; everything source-ID keyed.

---

# Missing pieces (blocker-family mapping)

Every current census blocker family maps to ONE row: the underlay(s) it needs,
the domain authority that resolves it, and (for compound/foundational ones)
a structural subsystem if applicable. When a family is a pure composition of
an underlay that has already landed (e.g. `choice-input` after `kernels/
choice.ts`), it is expected to DISAPPEAR from the census, with every record
re-read against its passage. This table is the mapping; the "retired labels"
and tranche sections below state what disappears and in what order.

| Blocker family (census label) | Underlays (Part A) | Domain authority (Part B) / subsystem (Part C) |
| --- | --- | --- |
| choice-input | U4 CHOICE | targeting candidate domain (U3) |
| player-choice, post-roll-reactive-choice, gamble-result-selection | U4 + U13 WINDOW | ROLL + targeting |
| selectable-terrain-placement (choice face) | U4 + U3 + U7 | TERRAIN + placement (selectable trick: 0..N) |
| direction-override | U3 + U4 | SPATIAL/MOVEMENT (shove/line direction candidates) |
| effect-count | U5 VALUE + U11 FLOW | ability/program (repeat/extra-effect fold) |
| status-count-scaling, member-count-scaling, damage-count-scaling, traversal-count, elevation-scaling, aura-count-condition | U5 + U6 | STATUS / MOB (member model) / AURA |
| entity-distance-selection, object-distance, lifecycle-target-selection, target-selector-variant, summon-recipient-targeting | U3 QUERY + U7 ANCHOR | TARGETING / ENTITY / MOB |
| distance-predicate, conditional-distance-stun, path-count-predicate | U6 + U5 | TARGETING / DAMAGE |
| range-modifier, unlimited-range, active-effect-range-modifier, aura-range-override | U14 (range query points) | TARGETING / AURA |
| fly-distance-modifier, teleport-distance-modifier, dash-modifier, rush-modifier, movement-modifier, movement-distance-modifier | U14 (movement distance) | SPATIAL/MOVEMENT |
| attack-modifier, ability-attack-modifier, attack-result-modifier, damage-modifier, damage-taken-modifier, save-modifier, save-result-modifier, dice-result-modifier, threshold-modifier, trigger-threshold-override, target-count-override, use-count-override | U14 (typed query points) | ATTACK / DAMAGE / SAVE / ROLL / USAGE |
| pierce, defense-bypass, delivery-immunity, bonus-damage-suppression, crit-suppression, condition-suppression, condition-preserve, end-turn-suppress, turn-end-no-attack | U14 PERMISSION query points | DAMAGE / STATUS (keep distinct, no alias-to-Divine) |
| area-define, area-extension, area-modifier, area-persistence-override, area-effect-rider, aura-to-area-conversion, blast-template | U7 + U3 + U5 (AT AREA query points) | AREA/TEMPLATE |
| moving-area-terrain, terrain-move-lifecycle, zone-regeneration | U7 ANCHOR + U12 CONTINUATION | TERRAIN + LIFECYCLE |
| under-character-terrain, forced-placement | U3 + U7 + U4 | TERRAIN + PLACEMENT |
| terrain-transform, terrain-conditional-rider, terrain-object-substitution, terrain-conversion | U6 + U7 + U4 | TERRAIN + ENTITY + AREA |
| triggered-terrain-creation | U10 FACT + U12 | TERRAIN (triggered) |
| delayed-terrain | U12 CONTINUATION | TERRAIN (delayed) |
| new-shove-effect, shove-trigger, collide-rider | U11 FLOW + U10 FACT + U9 | SPATIAL/MOVEMENT (shove/collide authority) |
| movement-trigger, movement-trigger-suppression, area-exit-trigger, distance-change-trigger | U10 FACT + U16 | SPATIAL/MOVEMENT + LIFECYCLE |
| movement-entry-cost | U15 TRANSACTION + U16 | SPATIAL/MOVEMENT + ECONOMY |
| effect-redirect, recipient-expansion | U3 + U11 RETARGET | TARGETING |
| rebound | U7 ANCHOR + U2 ROLE + U11 | ATTACK (bounce) |
| pre-ability-movement, pre-ability-action, cross-ability-invoke, ordered-intermediate-state, save-or-stun | U11 FLOW + U12 + U13 | SPATIAL/MOVEMENT + SAVE |
| repeat-mechanic, conditional-fly-repeat, fly-or-teleport-repeat | U11 FLOW (repeat) | SPATIAL/MOVEMENT |
| fly-move-timing, fly-move-substitution, fly-multirecipient, once-per-round-fly-grant, fly-benefit-rider, duration-fly-state | U8 + U16 + U14 | SPATIAL/MOVEMENT + LIFECYCLE (flying-state) + USAGE |
| resource-management, heroics-economy, vigor-grant, variable-cost, sacrifice-percent, wound-cost | U15 + U8 + U5 | RESOURCE/ECONOMY |
| charge-combo-activation, combo token folds | U15 + U16 | RESOURCE/ECONOMY |
| resource-cap-override | U14 + U5 | RESOURCE/ECONOMY |
| use-count-override, interrupt-use-scaling | U16 + U8 | USAGE + interrupt window |
| first-use-gate, auto-refresh, shared-turn-ledger | U16 + U8 | USAGE + LIFECYCLE |
| interrupt-rider, interrupt-grant, interrupt-timing, interrupt-rank | U13 WINDOW + U17 + U16 | interrupt/window engine |
| mark-gated-modifier, mark-transfer, mark-stacking, mark-defeat-trigger, mark-activation-gate, mark-detonation-window, mark-as-entity-follow | U1 + U2 + U14 (POS on carrier) | PERSISTENT INSTANCE / MARK |
| stance-gate, stance-capacity, aura-user-gate, aura-trigger-grant | U2 + U14 + U3 | MARK/STANCE/AURA |
| cure-on-trigger, status-reapply, infuse-permanence, duration-modifier, effect-expiry-trigger | U10 + U12 + U8 | STATUS / PERSISTENT INSTANCE |
| passive | U8 + U14 + U10 | PERSISTENT INSTANCE (projection) |
| object-interaction, entity-consume, entity-vacate, entity-interaction, summon-alternation, summon-count-boost, shadow-summon, summon-terrain-alternation | U3 + U11 + U12 | ENTITY/OBJECT/SUMMON + TARGETING |
| attack-trigger-grant, ability-trigger-grant, attack-miss-trigger, attack-exceed-trigger, damage-dealt-trigger, defeat-trigger, enemy-ability-trigger, comeback-trigger, exceed-grant, foe-trigger-expansion, aura-trigger-grant | U10 FACT + U9 + U13 | ATTACK / LIFECYCLE |
| damage-preview, damage-maximize, gamble-dice-pool-modifier, gamble-result-override, power-die | U13 + U5 | ATTACK / DAMAGE / ROLL |
| effect-count as ability-magnitude | U5 + U11 | ability/program |
| entry-save-gate | U13 + U6 | SAVE (when-entering window) |
| card-deck-system, card-consumption | U4 CHOICE + U5 | CARDS (Part C) |
| member-count-scaling (mob) | U5 + U3 | MOB (Part C) |
| foe-trigger-expansion / phase state | U10 + U17 | FOE PHASE MACHINE (Part C) |
| blast-template (visual-only geometry) | U3 + U7 | AREA/TEMPLATE |
| infrastructure / relic | U4 + U14 (registration) | RELIC REGISTRATION (Part C) |

---

# Retired labels after the underlays land

These census labels are expected to DISAPPEAR from the census (0 unresolved
occurrences) once their underlay+authority lands, every record re-read against
its passage and reclassified to promoted or a precise residual COMPOSITION —
never bulk-promoted just because the label vanished:

- After **QUERY+CHOICE** (U3/U4): `choice-input`, `player-choice`,
  `post-roll-reactive-choice`, `gamble-result-selection`,
  `selectable-terrain-placement` (choice face), `direction-override`,
  `entity-distance-selection`, `object-distance`, `lifecycle-target-selection`,
  `target-selector-variant`, `summon-recipient-targeting`, `member-count-scaling`.
- After **VALUE+PREDICATE** (U5/U6): `effect-count`, `status-count-scaling`,
  `damage-count-scaling`, `traversal-count`, `elevation-scaling`,
  `aura-count-condition`, `distance-predicate`, `conditional-distance-stun`,
  `path-count-predicate`.
- After **MODIFIER** (U14): the modifier block === range/area/movement/attack/
  damage/save/cost/duration/permission families listed above, including
  `range-modifier`, `unlimited-range`, `active-effect-range-modifier`,
  `aura-range-override`, `*distance-modifier`, `attack-modifier`,
  `ability-attack-modifier`, `attack-result-modifier`, `damage-modifier`,
  `damage-taken-modifier`, `save-modifier`, `save-result-modifier`,
  `dice-result-modifier`, `threshold-modifier`, `trigger-threshold-override`,
  `target-count-override`, `use-count-override`, `resource-cap-override`,
  `delivery-immunity`, `defense-bypass`, `pierce`, `condition-*`,
  `end-turn-suppress`, `turn-end-no-attack`, `fly-benefit-rider`.
- After **FLOW** (U11): `repeat-mechanic`, `conditional-fly-repeat`,
  `fly-or-teleport-repeat`, `rebound`, `effect-redirect`, `recipient-expansion`,
  `cross-ability-invoke`, `pre-ability-movement`, `pre-ability-action`,
  `save-or-stun`, `ordered-intermediate-state`.
- After **FACT+CONTINUATION+WINDOW** (U10/U12/U13): the trigger block
  (`*trigger`, `*-grant`, `cure-on-trigger`, `delay-*`, `mark-detonation-window`,
  `damage-preview`), `turn-end/turn-start-summon`, `zone-regeneration`,
  `terrain-move-lifecycle`, `interrupt-rider/grant/timing/rank`,
  `enemy-ability-trigger`.
- After **SPATIAL** (U7 + movement): `new-shove-effect`, `forced-placement`,
  `fly-move-*`, `multi-actor-teleport`, `range-gated-teleport`, `spatial-state`,
  `once-per-round-fly-grant`, `movement-trigger`, `movement-entry-cost`.
- After **AREA/PLACEMENT/TERRAIN**: `area-define`, `blast-template` (one
  shared medium/small/large template authority + placement),
  `area-extension`, `area-effect-rider`, `aura-to-area-conversion`,
  `under-character-terrain`, `moving-area-terrain`, `selectable-terrain-placement`
  (placement face), `terrain-*`, `triggered-terrain-creation`, `delayed-terrain`.
- After **CARRIER+LIFETIME+SCOPE** (U1/U2/U8 + persistent instance):
  the mark/stance/aura block, `passive`, `status-reapply`, `infuse-permanence`,
  `duration-fly-state`, `duration-modifier`, `active-effect-range-modifier`.
- After **USAGE** (U16): `use-count-override`, `interrupt-use-scaling`,
  `first-use-gate`, `auto-refresh`, `shared-turn-ledger`, `turn-end-no-attack`,
  `mark-activation-gate`, `once-per-round-fly-grant` (usage face).
- After **TRANSACTION** (U15) + RESOURCE: `resource-management` (economy face),
  `heroics-economy`, `vigor-grant`, `variable-cost`, `sacrifice-percent`,
  `wound-cost`, `charge-combo-activation`, `movement-entry-cost`.
- After **ROLL** (domain): `damage-maximize`, `damage-preview`, `power-die`,
  `gamble-dice-pool-modifier`, `gamble-result-override`, `dice-result-modifier`.
- After **CARDS/MOB/PHASES/RELIC** (Part C): `card-deck-system`,
  `card-consumption`, `member-count-scaling` (mob seats), foe-phase labels,
  relic registration labels.

Already retired by prior passes (do not resurrect): `{teleport}`,
`{fly-grant}`, `{terrain-create}`, `{entity-create}`, `{mark-modifier}`,
`{condition-grant}` (coarse), `{damage-modifier}` (coarse), `{range-modifier}`
(singleton), `{shove-modifier}`, `{charge-state}`, `{mastery-attachment}`,
`{sacrifice-cost}`, `{combo-spend}`, `{blessing-spend}`, `{infuse-cost}`,
`{use-ledger}` (implemented foundations).

---

# Duplicates / consolidation targets (existing authorities)

Audit findings: several mechanisms duplicate one another and should fold onto
an underlay+authority rather than diverge:

1. **Choice vs input selectors.** `kernels/choice.ts` resolves `RuleChoice` as
   typed buckets; `selectActors`' `input` selector and `evaluateNumber`'s
   `input` case and `teleport-choice` each had their own one-off reading
   before tranche 1. The remaining drift: candidate legality must go through
   U3 (`evaluateQuery`) so CHOOSE validates a CandidateSet, not a bucket.
2. **Actor eligibility in CHOOSE vs targeting.** `matchesTargetRelation` /
   `eligibleTargets` (`primitives/targeting.ts`) define relation; `choice.ts`
   re-checks relation/range against `RuleExecutionContext`. ONE eligibility
   authority (U3) feeding both.
3. **Ability-use choices vs RuleChoice.** `RuleExecutionInput.abilityUseChoices`
   is an opaque fold payload; `RuleChoice` is a generic decision. Fold
   scan-opaque calls into the same ChoiceSpec-driven window where the decision
   is meaningful.
4. **Talent choices vs RuleChoice.** `RuleExecutionInput.talentChoices` +
   `selectedTalentSourceIds` are a source-id allowlist; `RuleChoice` generic
   option/actor choices. Both feed optional folds; unify behind U4 with the
   optional-decline contract.
5. **Status save decisions vs future Window+Choice.** `SaveWindowSpec/
   resolveSaveWindow` (status-clear, cure-immediate, effect, movement windows)
   IS a Window+Choice instance; the `abilityUseChoices`/Blessing interplay must
   route through U13, never a second hand-rolled window.
6. **Target querying scattered through job resolvers.** Many resolvers call
   `selectActors`, the spatial area result's `includedActorIds`,
   `nearestFoe`/`freeCellsInRange`/`walk` in `job-kit.ts`, and reducer-side
   area scans variously.
   Standardize on the U3 Query + spatial gateway; specialists keep only their
   spatial model.
7. **Position/origin semantics.** `creationSpatial` (region vs LoS origin),
   `RuleArea.origin`, `teleport-choice` `SpatialOrigin`, `context.actorId`,
   rebound origin — all different ANCHOR ideas. Unify on U7 `SpatialAnchor`
   (LIVE vs CAPTURED) while keeping the specialists.
8. **Usage booleans / state keys.** `useLedgerKey`, `ruleState.attacked-this-
   turn`, `turn-end no-attack`, `shared-turn-ledger`, `interrupt-uses`,
   `ledger:round:*` — all usage counts re-keyed ad hoc. Unify on U16 with reset
   Clock from U8.
9. **Trigger de-duplication.** `resolutionFacts.derivedTriggers`,
   `RuleContinuationState.executedStepIds`, `trait-reactions` ledger keys, and
   the F9 once-per-ability registries each de-duplicate. One U16 usage identity
   + U10 fact feeds them.
10. **Modifier folds by source category.** `range.ts` Rule registry, `area.ts`
    Rule registry, `cost-payment.ts` CostModifierRule, `attack-modifiers.ts`
    trait fold, `mastery-fold.ts`, `bonus-damage.ts`, aura boon/curse — SIX
    fold registries all keyed on their own query point. U14 specifies one
    recipe shape `{source, queryPoint, scope, op, value, predicate}` per typed
    query point; each kernel keeps its fold but reads the shared ModifierRule.
11. **Ordering encoded by array iteration.** `orderedSelectedSteps`,
    lifecycle registry order, pending-interrupt `order`, TRIGGER_WINDOW order —
    several implicit orderings. U17 gives typed policies + a policy→CHOICE
    seam.

---

# Incremental file split plan (do NOT execute as churn)

Split in the direction that the next semantic implementation needs, keeping
`primitives/types.ts` and `kernels/runtime.ts` as compatibility barrels so git
history and tests stay manageable. No flag-day rewrite.

**`primitives/types.ts`** → keep as `export *` barrel over new modules:
`reference.ts` (U1 refs + LIVE/CAPTURED), `roles.ts` (U2), `query.ts` (U3
Query/CandidateSet), `choice.ts` (U4), `value.ts` (U5), `predicate.ts` (U6),
`anchor.ts` (U7), `scope.ts` (U8 + Clock), `provenance.ts` (U9), `facts.ts`
(U10), `flow.ts` (U11 nodes), `continuation.ts` (U12), `windows.ts` (U13),
`modifiers.ts` (U14), `transaction.ts` (U15), `usage.ts` (U16), `ordering.ts`
(U17). The broad `RuleEffect`/`RuleMutation` unions can split last; moving the
targeting/damage/save specialist types aside first is enough.

**`kernels/runtime.ts`** → extract incrementally into semantic modules while
re-exporting the public functions:
`evaluateQuery` (from `selectActors`; U3), `evaluateValue` (U5),
`evaluatePredicate` (U6), `executeFlow`/`effectsToMutations` (U11). Cost fold
stays in `cost-payment.ts`; movement stays in the gateway.

**`primitives/job-kit.ts`** → keep AUTHORING SUGAR ONLY (`self/attackStep/
normalDamage/constant/…` re-exporting constructors). Move meaningful generic
algorithms to actual owners as touched: `walk`/`freeCellsInRange`/`nearestFoe`/
`rushTowardFoes`/`swapMutations` → spatial/movement authority; `rollDamageDice`
+ gamble → roll authority; `summonEntity`/`entityMutation` → entity-creation
authority; duration helpers → `scope.ts`. Content files import from the new
owners; job-kit stays a thin sugar barrel. Do NOT do a giant extraction purely
for file size.

**`kernels/choice.ts`** already the CHOOSE underlay (tranche 1) — extend with
chooser/controller roles (U2) and CandidateSet legality from U3, keep as the
U4 home.

---

# Tranche order (architectural value, not blocker-name order)

After EACH tranche: re-run strict source fidelity; regenerate
`blocker-census.json/md`; recompute marginal unlocks; re-read every newly
promotable singleton against ICON 1.5.pdf; promote only complete source units;
merge/reclassify coarse labels the new substrate makes obsolete; run the full
suite; ensure the census is byte-stable on a second run. Never follow a stale
greedy order — re-derive after each landing.

1. **CHOOSE (U4) — landed tranche 1** (`kernels/choice.ts`). Next: fold
   CHOOSE onto U3 QUERY so choice legality is the targeting CandidateSet, not
   a second bucket check; carry chooser/controller roles (U2) on the row for
   multiplayer authority. Promote the 8 `{choice-input}` singletons ONLY where
   complete. Post-roll/post-ability choices still await U13/U12.
2. **QUERY + VALUE + PREDICATE (U3/U5/U6)** — one Query/Candidate authority
   under both targeting and choices; the expression algebra kills simple
   count/distance/status/member predicates; re-audit `effect-count`,
   `entity-distance-selection`, `object-distance`, `status/member/count`
   families. (First big harvest.)
3. **MODIFIER QUERY POINTS (U14) + SCOPE/CLOCK (U8)** — normalize the six
   fold registries to the ModifierRule shape; add named/N-boundary Scope.
   Harvest the whole modifier block + duration/permission families including
   the `*-distance-modifier` movement set.
4. **FLOW + ORDERED INTERMEDIATE STATE (U11) + ATTACHMENT (U18 candidate)** —
   multi-step abilities become source-correct (intermediate state, generic
   repeat/invoke/branch); consolidate mastery/talent/fold attachment under the
   U18 recipe if it truly collapses them. Harvest `pre-ability-*`,
   `cross-ability-invoke`, `repeat-*`, rebound flow face.
5. **FACT + PROVENANCE (U9/U10) + CONTINUATION (U12) + WINDOW (U13) +
   ORDERING (U17)** — generic delayed resolution, generic future choices,
   generic automatic triggered effects, LIVE/CAPTURED refs through
   continuations, decision windows; trigger de-dup via U16 usage identity.
   Harvest the trigger/cont/fly-state/delay families + `damage-preview`.
6. **AREA / PLACEMENT / TERRAIN / ENTITY authorities (Part B) + ANCHOR (U7)** —
   generic player-selected area/terrain/entity placement over QUERY+CHOOSE;
   delayed/triggered terrain become compositions; moving terrain uses
   persistent anchors; placement region vs creator LoS stays separate.
   Harvest the terrain/entity/placement/area families.
7. **USAGE (U16) + TRANSACTION (U15) + RESOURCE + ROLL extensions** — generic
   counters/ledgers with reset Clocks, atomic grouping, resolve split, pooled
   rolls/rerolls, percent/traversals. Harvest economy/usage + `resource-
   management`, `heroics-economy`, `variable-cost`, `power-die`.
8. **Gen Structural subsystems (Part C)** — discrete card collection, foe
   phase state machine, Mob member model, relic registration over the existing
   runtime. Harvest `card-*`, mob-seat sizes, phase/relic labels.

---

# Critical semantic boundaries (non-negotiable)

- **Pre-resolution vs post-resolution choices.** A PRE choice rides its
  initiating command. A choice whose candidate set depends on a roll, damage
  result, movement result, future turn state, or delayed explosion CANNOT be
  supplied speculatively — it must use the generic U12/U13 continuation/window
  and ask when it becomes meaningful.
- **LIVE ref vs CAPTURED value (U1) + DEFERRED RULE vs HELD RESULT (U12).**
  "At the start of your next turn, do X" resolves X against THEN-current state
  (live refs, deferred rule). "The already determined effect waits until this
  interrupt closes" stores the determined mutation (captured/held result).
  Cover for delayed/held attacks is evaluated where damage is APPLIED — never
  capture cover at use-time. Never replace A with B (the lesson of the terrain
  retractions in 554d8ca).
- **Fail closed.** Missing required choices, malformed spatial contracts,
  invalid targets, unavailable resources, impossible atomic effects reject —
  they never silently degrade into a different mechanic. Optionality only from
  source language.
- **No source-ID switches in generic code.** Source IDs live in registered
  recipe/content rows; generic kernels consume typed recipes. No stringly role
  bag; no arbitrary property paths; no reflection-based modifiers; no
  editable-strings DSL.
- **Unify damage-permission semantics carefully.** can/cannot/ignore/immune stay
  distinct typed query points (U14/POLICY); don't alias every bypass to Divine,
  don't unify genuinely different damage bypasses.
- **Replay purity.** `executeCommand` stays pure; all randomness and outcome
  decisions happen once at the command/window boundary and ride recorded
  events; `applyEvents` never re-decides mechanics. Continuation records carry
  LIVE-vs-CAPTURED explicitly so replay never re-resolves a captured value.
- **Determinism.** random results recorded once, replayed; no hidden second
  RNG; no replay-only rule implementations; source-defined directional/choice
  order must be represented by U3 deterministic ordering, never by array
  iteration.

---

# Measure of success

Fewer independent semantic authorities; ICON source rules read as compositions
of a small number of independently testable operations. The intended
end-state:

    AS <roles/references>
    WHEN <fact/predicate>
    FROM <anchor>
    QUERY <candidates>
    [CHOOSE <selection>]
    [PAY <transaction>]
    DO <ordered flow>
    UNTIL/FOR <scope>
    [THEN <continuation>]

with the domain authorities of Part B resolving the movement/damage/attack/
save/terrain/entity mechanics. Correctly unresolved remains better than
incorrectly executable.