# Underlay Completion Plan (U1–U17)

This document owns underlay acceptance obligations, dependency order, candidate
decisions, and the phase gate. It does not maintain a second implementation
history or maturity ledger.

- [Generic underlays](generic-underlays.md) owns responsibilities, vocabulary,
  the design test, and domain/structural boundaries.
- [Rules foundations](rules-foundations.md) owns current maturity and execution
  authorities; the [consumer census](u8-u1-underlay-census.md) records remaining
  migrations and retained specialist boundaries.
- [TODO](../TODO.md#current-execution-plan-ordered) owns the next task.
- [AGENTS.md](../AGENTS.md) owns authority, replay, and architecture rules.

**Active restriction:** no unresolved source unit may be wired or promoted
until §4 passes. Work during this phase extends generic substrate and migrates
existing consumers. Preserve source semantics and existing compatibility
barrels; any semantic correction requires source review and regression proof.
Regenerate the blocker census to verify changes, but do not use its greedy
ranking as a promotion order before the gate.

## 1. Per-underlay contracts

Read each acceptance obligation together with its linked ontology definition
and the current foundation/census evidence. These are requirements to verify,
not declarations that the whole underlay is implemented. Historical test counts
and tranche progress belong in existing evidence reports and Git history.

### U1 Reference / Binding

[Responsibility and vocabulary](generic-underlays.md#u1-reference--binding).

**Source evidence.** The distinction is pervasive: "Teleport X: move
instantly to an unoccupied space within range X" (p.88) consumes a
player-chosen position (a captured ref); "at the start of its next turn"
effects (p.94 statuses/durations, p.105 triggers) re-resolve the actor's
then-current state (live refs); listed-order resolution (p.85, p.107 §4)
means later clauses refer to earlier operations' outputs; "return relative
to your original location" (p.122 Heroic Intervention return; p.163 Shadow
Play; p.300 Redondo) captures a position; marks/stances/terrain effects
(p.94, p.95, p.104) are referenced by later rules (mark detonations,
terrain entry effects p.151/p.353). The proliferation of bespoke context
fields is the warning this underlay removes.

**Replay semantics.** A captured value is a durable literal once captured;
a live ref re-resolves against replay state. Replay must never re-derive a
captured value from later state. No hidden resolution paths.

**Acceptance tests.**

- Positive: bind a chosen position; a later effect resolves the captured
  position exactly (including after the actor moved); a live actor ref
  resolves its new position on a later turn.
- Negative: reference to a non-existent bound name rejects; a captured ref
  cannot be re-resolved as live.
- Boundary: empty collection ref; ref to an off-battlefield/defeated actor
  stays resolvable where the source allows (defeated actor ref for
  "when the target is defeated" clauses) and rejects where not.
- Replay: an ability that captures a position, then the actor moves, then a
  continuation explodes at the captured cell — replay produces the identical
  mutation sequence.

### U2 Role / Perspective

[Responsibility and vocabulary](generic-underlays.md#u2-role--perspective).

**Source evidence.** "Ally" is defined relative to the source ("another
living ally", p.92); marks are owned by a marker and carried by a target
(p.94); Sacrifice is paid by the user (p.102/103); Blessing tokens are
owned by the character being saved (p.102/p.172); the durable save-reroll
window decides who owns the reroll (Sucker Punch, p.143); when-damaged /
defeated / uses-ability / area-inclusion / targeted windows decide who
answers and against whom (p.105, p.107); interrupt legality is judged from
the source/controller's position (Masquerade, p.151); the aura kernel's
bearer-vs-member boundary (`kernels/aura.ts`) is a role the engine must
derive, never string-match.

**Replay semantics.** Roles are derived deterministically from recorded
state + the durable choice rows; the entitled player is a pure function of
the record, never of ambient connection state. No second decision path.

**Acceptance tests.**

- Positive: "choice made by TARGET_CONTROLLER" resolves to the target's
  controller for a `RuleChoice`; mark owner ≠ mark carrier roles resolve
  distinctly.
- Negative: a choice row whose chooser role cannot be derived rejects at the
  command boundary rather than guessing.
- Boundary: source == target == controller (self-targeted) collapses to one
  role without breaking multiplayer derivation; role ≠ anchor (rebound case)
  asserted in a fixture.
- Replay: a window whose entitled responder is derived from the recorded
  choice row replays to the same responder.

### U3 Query / Candidate

[Responsibility and vocabulary](generic-underlays.md#u3-query--candidate).

**Source evidence.** The PDF's targeting categories (Self, Ally, Foe,
Summon, Characters, Others, Space, Object — p.92) are ONE target vocabulary,
not separate selector engines; "Choose one foe in range 3" and "All foes in
range 3" share the same legality machinery; range is the p.92 footprint
metric measured from the edge of the origin space; defeated/off-battlefield
eligibility (p.94, p.107); burst areas include only spaces with LoS from
the burst center (p.95); large foes count as inside an area when any
footprint space is hit (p.290).

**Replay semantics.** Candidate evaluation reads only current state and
declared query; never RNG, never ambient order. Source-defined
first/last/nth ordering must be explicit in the query, never array
iteration order.

**Acceptance tests.**

- Positive: "all foes in range 3" == the union of one-foe-per-candidate
  choices; entity/position/terrain candidates resolve; `selectActors`
  output for each selector kind equals `evaluateQuery` output (parity
  suite over existing fixtures).
- Negative: defeated excluded by default; off-battlefield excluded;
  out-of-range excluded; relation violation.
- Boundary: at-range passes, one-past fails (footprint metric); empty
  CandidateSet for a required choice rejects at U4; large-foe area inclusion
  (any footprint cell).
- Replay: `selectActors` migration is behavior-preserving — the existing
  fixture suite replays byte-identical; `rangeOrigin` as a non-self anchor
  resolves identically on replay.

### U4 Choice / Decision

[Responsibility and vocabulary](generic-underlays.md#u4-choice--decision).

**Source evidence.** "Choose one foe in range 3" / "choose a space"
(p.88 Teleport X destination; p.92; p.95); optionality only from "may"
language; post-result decisions (p.143 reroll window, p.105 Vigilance
choice) are the same decision semantics at a different time; the 8
`{choice-input}` singletons re-read in `docs/tranche-2-query.md` all need a
durable choice window (U12/U13), not legality — the evidence the ontology's
"post-result decision is not a second choice system" point rests on.

**Replay semantics.** Choices ride the initiating command (pre choices) or
the window's durable record (post choices); replay never re-asks. The
supplied values are what execute — legality only.

**Acceptance tests.** Preserve the existing choice cases and verify: chooser-role derivation;
position choice legality through U3 (parity with `teleport-choice` where
expressible); `abilityUseChoices`/`talentChoices` fold-through cases;
window-carried `ChoiceSpec` resolution; optional-decline never defaults
(already covered, extended to window timing).

### U5 Value / Expression

[Responsibility and vocabulary](generic-underlays.md#u5-value--expression).

**Source evidence.** Bloodied/quarter thresholds are HP-percent reads
(p.94, p.104); distance predicates need distance-between-arbitrary-refs
(p.92); effect-count scaling ("for each foe in the area", p.105-style
trigger clauses) needs count(query); percent-of-BASE-max ("Sacrifice X
percent of your maximum HP", p.103; p.219 Terraforming) needs BASE HP
semantics; traversed-distance ("for every space you moved", rush/fly
abilities) needs movement-traveled reads.

**Replay semantics.** Expression evaluation is a pure function of state +
recorded input + recorded dice results; no second RNG path; percent-base
reads the durable base.

**Acceptance tests.** Positive: count(query), distance-between-refs,
percent-of-BASE-max (differs from wounds-adjusted when wounds are present),
usage reads. Negative: divide-by-zero/NaN guards; unknown stat/usage key
rejects. Boundary: quarter mark exactly; 0-count; traversal of 0.
Replay: a damage-roll expression with recipient-scoped bonus dice replays
byte-identical (existing Finesse fixture extended).

### U6 Predicate / Condition

[Responsibility and vocabulary](generic-underlays.md#u6-predicate--condition).

**Source evidence.** Bloodied/quarter gates (p.94, p.104); distance gates
(Trigrammaton "at exactly range 3", p.225-style exact-range clauses);
condition/status gates (p.94); round gates ("at round 4 or later");
usage gates ("once per round", p.99/p.105); terrain-at gates (p.104
Rampart-adjacent clauses, p.129 movement gates); "has not acted this round"
(p.129 Special).

**Replay semantics.** Predicates evaluate replay state deterministically;
the used-this-scope read consumes the durable U16 ledger + U10 facts,
never ambient flags.

**Acceptance tests.** Positive: each new predicate kind; negative: false
branches; boundary: exact-threshold comparisons (`<=` vs `<`), 0-count;
replay: a trigger step gated by a predicate that consumes a ledger entry
replays identically.

### U7 Anchor / Spatial Frame

[Responsibility and vocabulary](generic-underlays.md#u7-anchor--spatial-frame).

**Source evidence.** "Range is measured from the edge of the origin space
(or character)" (p.92); burst centers on a character or chosen space
(p.95); auras are anchored to a bearer and re-derived as it moves
(`kernels/aura.ts` origins); teleport is measured from the teleporter's
current position (p.88, and the planned-path simulation in
`teleport-choice.ts` proves sequential anchors matter); entity creation
separates placement REGION from CREATOR LoS/range ORIGIN (p.95/p.107/p.108,
`creationSpatial` contract); Rebound: the rebound character's space becomes
the ORIGIN for cover/LoS while effects on the original user still apply to
the original user.

**Replay semantics.** Anchors resolve from durable state (live) or from
captured records (captured); never from serialized convenience fields that
lose the frame; creation `creationSpatial` records are computed once at
command time and consumed as recorded by the reducer (replay never
re-decides a captured frame). Rebound fixtures prove ROLE ≠ ANCHOR on
replay.

**Acceptance tests.** Positive: non-self `rangeOrigin` actually resolves
through the anchor (a query measured from an ally's position — fixture in
`candidate.test.ts`); Size-2 footprint-edge range is measured from the
mover's footprint edge, not the anchor cell (p.92 — `battlefield.test.ts`
adversarial fixtures: edge-adjacent legal, one-past illegal, point-frame
would reject). Negative: anchor with no resolvable referent rejects;
a MISSING teleport mover rejects with `selector.actor-missing` BEFORE any
destination legality is accepted (never masked as a Size-1 point frame);
query-shaped/input-without-context anchors fail closed at construction.
Boundary: anchor to a defeated actor (source permits) vs off-board actor
(rejects); size>1 footprint anchor edges (p.92). Replay:
teleport planned-path + rebound-origin fixture replays byte-identical.
Guard: `u7-teleport-footprint-origin` rejects a restored point-frame or
optional-chained (`mover?.size`) mover read, mutation-tested both ways.

### U8 Scope / Clock

[Responsibility and vocabulary](generic-underlays.md#u8-scope--clock).

**Source evidence.** Durations ride turns/rounds/combat (p.94 statuses,
p.95 terrain/entity effects, p.107 end-of-combat cleanup); once-per-round /
once-per-turn / once-per-combat gates (p.99, p.105 Vigilance, p.129
Special); Delay resolves at the start of the slow turn before ordinary
activity (p.87 slow rounds; scheduler `delayed` phase); "at the end of your
next turn" N-boundary forms; camp/expedition reset boundaries (p.56, p.113).

**Replay semantics.** The Clock is derived from durable state
(round/turn/boundary counters + recorded events); boundary advancement is a
recorded transition (existing turn-intent machinery is prior art); replay
never re-decides whether a boundary was crossed.

**Acceptance tests.** Positive: same "round" read by a duration, a usage
gate, and a lifecycle recipe agrees; N-boundary duration; next-matching-
boundary. Negative: out-of-scope read rejects. Boundary: slow-turn vs
ordinary-turn boundary; combat-end cleanup expiry. Replay: a turn-boundary
intent with a round-gated recipe replays identically (existing
`turn-transition.test.ts` pattern extended to the Clock API). T6.1 consumer
parity + replay: `t6-u8-scope-consolidation.test.ts` proves the lifecycle
reset recipes actually route turn/round/combat reset through U8 (`scope.test.ts`
proves it matches a boundary and refreshes the right `ledger:period:*`
keys), that non-matching boundaries refresh nothing, and that a recorded
turn-boundary transition replays to an identical ledger (never
re-deciding). Combat cleanup parity/replay is proved by
`settlement.test.ts`.

### U9 Provenance / Cause

[Responsibility and vocabulary](generic-underlays.md#u9-provenance--cause).

**Source evidence.** ICON semantics are causal: Pacified breaks on damage
from a FOE'S ability/action (not self/terrain, p.94); Slay means THIS
ability reduced a character to 0 (p.103 glossary); Collide means shoved INTO
an obstruction AS PART OF THIS ability (p.102/103, p.128/p.138 recipes);
dangerous terrain has its own delivery (p.95/p.108); triggered effects fire
once per ability (p.105); unerring/cover/dodge provenance on attacks
(p.104/p.105); delivery modes distinguish hit/miss/area/effect/save-success/
terrain damage.

**Replay semantics.** Provenance is recorded at the command/window
boundary and replays verbatim; never reconstructed from current state or
source names.

**Acceptance tests.** Positive: Slay provenance restricted to THIS ability's
damage; Collide provenance includes the shove's ability id; Pacified-break
provenance distinguishes foe-ability damage from terrain damage. Negative:
non-actor delivery never opens an interrupt window (existing
`decideDamageWindow` gate). Boundary: multi-target ability — attack-target
vs collateral recipient provenance differs per damage instance. Replay:
provenance fields byte-identical across a replayed split event
(`openDamageWindowFromLedger` path).

### U10 Fact / Outcome

[Responsibility and vocabulary](generic-underlays.md#u10-fact--outcome).

**Source evidence.** Reactive triggers (Collide, Slay) are only knowable
after mutations resolve — the two-pass fold (`executeRuleProgramWithReactiveTriggers`,
`src/rules/encounter.ts`) is the current fact-derivation machinery (p.85
order, p.102/103 glossary, p.105 once-per-ability); damage windows open from
a determined-but-not-applied fact (p.107, p.128, p.138); movement-entry
triggers read entered cells (p.151, p.178, p.353); "once per ability even
when multiple routes would trigger it" (p.105).

**Replay semantics.** Facts are recorded once and consumed; replay must
consume, never rediscover. The two-pass trigger fold and the damage-window
ledger are the existing correctness bar; the fact vocabulary makes it
explicit and shared.

**Acceptance tests.** Positive: each new fact kind records at the right
resolve point; movement facts (entered/exited/actual distance) feed entry
triggers and distance-change predicates. Negative: a fact is never
re-derived from state (assert the ledger is the source on replay). Boundary:
overlapping trigger routes fire once (de-dup identity). Replay: split-event
damage window + reactive-trigger fold replay byte-identical (existing
fixtures extended to the new vocabulary).

### U11 Flow / Sequence

[Responsibility and vocabulary](generic-underlays.md#u11-flow--sequence).

**Source evidence.** p.85 "Effects resolve in the order they are listed" and
p.107 §4; ordered-intermediate-state examples throughout ability text
(rush-then-damage, remove-then-place, teleport-then-adjacency,
shove-then-collide); repeat clauses ("rush 1, then rush 1, each time
optionally damage"); the two-pass reactive fold exists because Collide/Slay
are only knowable after resolution.

**Replay semantics.** The command plans against a simulated intermediate
state; the emitted mutation sequence is what replays — replay never
re-simulates decision logic. Repeat counts, choices, and dice are recorded
at the command boundary; the recorded event carries the boundary stamps
(determined damage, resolution facts) exactly as before.

**Acceptance tests.** `t5a-u11-flow.test.ts`: rush-then-
damage observes the moved position; remove-then-place observes the vacated
space (occupying-count gate); teleport-then-adjacency; repeat iteration
N+1 sees N's state; for-each over an already-derived CandidateSet
executes deterministically (shared U3 authority derives the set, the flow
never re-queries); invoke shares the simulation; bind reaches later value
reads; emit-fact rides the flow result; an invalid intermediate leg
rejects the whole command before durable commit (no partial list, live
state untouched); zero-repeat and empty-for-each are clean no-ops; U15
swap groups stay simultaneous (legal swap applied every leg with the
follow-up read seeing the post-swap state; denied group skips every leg);
an ordered multi-step ability (with a `spatialBatchId` swap and a
dice-consuming damage roll) replays byte-identical with no new
decisions/RNG. Negative/boundary/replay all covered in that file.

### U12 Continuation / Suspension

[Responsibility and vocabulary](generic-underlays.md#u12-continuation--suspension).

**Source evidence.** ICON Delay resolves at the start of the slow turn
before ordinary activity (p.87, scheduler `delayed` phase — represent via
Clock + Ordering, not bespoke Delay code); delayed terrain/explosions
(Polaris meteor p.201-style end-of-turn effects; Carnevale p.150); "at the
start of your next turn" clauses (p.94, p.105); future summons; mark
detonations; return-from-removed-state (p.122); "at end of turn, explode at
the chosen space" (captured position); Sucker Punch holds a determined save
for the reroll window (p.143 — HELD RESULT prior art in
`rerollSaveMutations`).

**Replay semantics.** Replay resumes the record exactly; captured values
are literals; live refs re-resolve against then-current state; never
re-place A with B (held-result fixture from the terrain retraction lesson).
The resume gate is pure — no RNG, no decisions, no mutable-availability
re-checks; a due deferred rule resolves through the same `applyRuleMutations`
reducer path the event itself used.

**Acceptance tests.** `t5b-u12-continuation.test.ts`: deferred rule resolves against THEN-CURRENT state
(the Great Giorgios rush reads the owner's post-move position — the arming-
position outcome differs observably); captured value stays captured (a
captured landing survives the actor moving elsewhere); live reference stays
live (a referenced actor resolves through current state); held result is
immutable (a determined save survives suspension and resumes byte-for-byte;
Sucker Punch reroll is a separately recorded result that REPLACES the held
one, closing/no-op preserves the original); held damage represented through
the held-result vocabulary; a cancelled continuation never resumes; an
expired continuation never resumes; a missing trigger fact does not fire;
multiple continuations use their U17 ordering identity (the adversarial
array order differs from the ordering identity); full Great Giorgios flow
replays byte-identical with zero new decisions/RNG.

### U13 Window / Decision Point

[Responsibility and vocabulary](generic-underlays.md#u13-window--decision-point).

**Source evidence.** Interrupt windows on when-damaged/defeated
(p.105/p.107; the two `TRIGGER_WINDOW_RECIPES` rows cite p.107/p.128
Righteous Disdain and p.107/p.138 Boiling Blood); save-reroll window
(Sucker Punch, p.143 — same-window reroll); Vigilance trigger windows
(p.105); interrupt priority/nesting and turn-order rules (p.107);
Masquerade interrupt legality (p.151); gamble windows (p.150/p.179).

**Replay semantics.** The window opens from a recorded ledger entry /
recorded event (`openDamageWindowFromLedger`, the reducer's `applyDamage`
decision); the decision is recorded ONCE at the window boundary
(`DECISION_ANSWERED` carries the recorded mutations); replay closes/resumes
exactly the recorded record and never re-evaluates mutable availability.

**Acceptance tests.** `src/rules/__tests__/t5c-u13-decision-window.test.ts`
(17 adversarial cases): Righteous Disdain holds the determined amount and
replays it byte-for-byte (no re-mitigation); Boiling Blood opens the
defeated window only on prospective lethal damage; Sucker Punch holds the
original save exactly, rerolls once at the command boundary with the second
result replacing the first (decline preserves the first; Heroic's curse
applies only to the new roll); nested interrupts LIFO; same-trigger
turn-order (never insertion order); owner-order ambiguity yields a U4
choice (`yields-choice`); automatic triggered effects open no window;
Vigilance consumes no interrupt entitlement; a deterministic Gamble roll
creates no window while a genuine decision does; Great Giorgios may-rush is
a real decision (decline legal, accept reads THEN-CURRENT positions, no
invented destination); two same-kind windows never answer each other;
replay of held damage + save reroll is byte-identical with zero fresh
RNG/decisions.

### U14 Modifier / Policy

[Responsibility and vocabulary](generic-underlays.md#u14-modifier--policy).

**Source evidence.** Listed-range changes (Dark Sliver t2 "Sacrifice 2:
Ability gains range 6", p.187); area shape/size overrides (line→arc,
line 3→6); movement-distance modifiers (fly/dash/rush families); attack
boons/curses, save boons/curses (p.102, p.105); unerring/cover/dodge
permissions (p.104/p.105); immunity/resist/deny on damage (p.102 glossary);
use caps ("use count override"); interrupt rank; duration modifiers;
"cannot/ignore/immune" distinct (p.102, p.104).

**Replay semantics.** Fold order is deterministic (registration order);
the fold reads durable state (equip/mastery/talent/choice) at the query
point; replay folds identically; the ownership gate is a pure function of
the record.

**Acceptance tests.** Positive: one recipe shape drives range, area, cost,
attack, damage, save folds (parity fixtures); typed permission distinctness
(cannot ≠ ignore ≠ immune). Negative: unowned modifier never folds; unknown
query point rejects; wildcard bypass impossible (closed negative). Boundary:
conflicting rules at the same query point (deterministic winner); scope
filtering; predicate-gated rules flipping on/off with state. Replay:
fold-dependent attack/damage fixtures replay byte-identical.

### U15 Transaction / Atomic Commit

[Responsibility and vocabulary](generic-underlays.md#u15-transaction--atomic-commit).

**Source evidence.** Masquerade: "If you or your ally can't make a valid
teleport, this interrupt can't be made" (p.151 — `requiresLegalSpatialBatch`
prior art); swap groups every-leg-or-none (p.151, p.163, p.300); exact-count
entity creation (p.95/p.107/p.108 — `countMode: 'exact'`); costs validated
before any effect or RNG (p.99, p.102/103 — `assertRuleCostsPayable`);
resolve split across party pool + personal resolve (p.99).

**Replay semantics.** The prevalidation happens once at the command
boundary against the authoritative snapshot; the emitted mutations (all-or-
none) replay verbatim; replay never revalidates.

**Acceptance tests.** Positive: cost+swap+creation grouped commit; partial
legality rejects the whole group (Masquerade fixture); exact-count creation
fails closed. Negative: never partial-apply a denied group; no
cross-batch co-movement (existing group-scoped occupancy tests extend).
Boundary: empty group; cap-reduced success (legitimate partial per source
cap); source-defined fallback path. Replay: swap + exact-creation fixtures
replay byte-identical.

### U16 Usage / Entitlement Ledger

[Responsibility and vocabulary](generic-underlays.md#u16-usage--entitlement-ledger).

**Source evidence.** once-per-turn / once-per-round / N-per-round /
N-per-combat / first-use (p.99, p.105); "once per ability even when
multiple routes would trigger it" (p.105); once-per-target; dangerous-terrain
once per turn; slashed once per turn; one attack-tag ability per turn
(p.129 Special); no-repeat ability rule; limit break once/combat; Vigilance
once per trigger (p.105); interrupt refresh; per-use magnitude ("2nd/3rd use
dashes 3/2/1").

**Replay semantics.** The ledger decision is made once at the command
boundary and recorded as a durable state mutation (today's bar); replay
consumes the recorded marks; the de-dup identity is derived from durable
facts + keys, never re-derived from current state.

**Acceptance tests.** Positive: N-per-round cap; per-use magnitude
(2nd use = 3, 3rd use = 2, 1st = 1); refresh at boundary; once-per-trigger
across multiple routes fires once. Negative: capped use rejected;
unequipped source never consumes. Boundary: cap reduced by an override;
refresh-vs-combat boundary; shared-turn-ledger across two actors. Replay:
reactive-trigger de-dup + interrupt-use fixtures replay byte-identical.

### U17 Ordering / Arbitration

[Responsibility and vocabulary](generic-underlays.md#u17-ordering--arbitration).

**Source evidence.** Listed effect order (p.85, p.107 §4 — `orderedSelectedSteps`);
explicitly overridden effect order; interrupt nesting (most-recent trigger
first) and same-trigger turn-order rules (p.107); turn-boundary ordering
(non-turn-character effects first, hostile before beneficial, same-owner
player determines order — p.107); Delay ordering at slow-turn start (p.87);
turn alternation; player ordering choices (p.107).

**Replay semantics.** Ordering is a pure function of the recorded policy +
durable state; replay never depends on array construction order;
controller-choice ordering records the player's ordering decision.

**Acceptance tests.** Positive: hostile-before-beneficial at a
turn boundary + non-turn-owner-first (T6.3); LIFO interrupt nesting;
controller-choice ordering yields a recorded decision (T6.2); explicit-list
policy. Negative: undefined policy rejects; unorderable candidates (no
policy) reject rather than iterating silently; same-owner wrong responder
rejects; partial/duplicate/unknown/extra permutation rejects (T6.2/T6.3).
Boundary: same-owner simultaneous effects become ONE recorded decision;
empty candidate list; cross-owner + missing-owner ties fail closed (T6.3).
Replay: turn-boundary + interrupt-nesting fixtures replay with identical
ordering; the recorded same-owner order replays with zero fresh decision
and zero input-order dependence (T6.2 `t6-2-…` 30 cases, T6.3
`t6-3-turn-boundary-ordering.test.ts` 27 cases).

## 2. Candidates: U18 Attachment and U19 Intent (evaluate, do not assume)

Both remain candidates. Reopen either decision only when code evidence passes
[the design test](generic-underlays.md#design-test-apply-before-any-new-underlay-or-primitive).

### U18 Attachment / Contribution — CANDIDATE, do not promote yet

A proposed attachment record combines source ownership/equipment, an
`attachesTo` query, and contributions. Its parts already map to existing
contracts:

| Proposed part | Existing owner |
| --- | --- |
| Identity and ownership/equipment perspective | U1 references + U2 roles |
| Attachment target and contribution choice | U3 query + U4 choice |
| Modifiers and policy grants | U14 ModifierRule |
| Extra steps and action grants | U11 flow |
| Triggers, windows, held work | U12 continuation + U13 window |

Attachment registration is currently a content-authoring pattern. The shared
modifier registry and the U11/U12/U13 contribution paths are the existing
composition; armed-state consumption and cost/aura/save specialists retain
written boundaries in the foundation and consumer census.

**Decision rule:** introduce U18 only if mastery, trait, talent, or fortune
folds demonstrate a common missing record that cannot be expressed as U14
modifiers plus U11 flow and U13 windows registered from content. An equipment
predicate or registration wrapper alone does not establish a new underlay.

### U19 Intent — CANDIDATE, do not promote yet

An intent is a typed proposed operation validated before mutation, such as a
move, entity creation, attack, save, or resource spend. Existing
`SpatialIntent`, paired `creationSpatial`, and `SaveWindowSpec` are contracts
of their domain authorities; command-time validation and application of
recorded authority have distinct responsibilities.

**Decision rule:** introduce U19 only when validation of the same typed intent
is duplicated at command/reducer boundaries, the implementations can drift,
and a common intent layer removes that duplication without competing with
U15 transactions or the existing domain authority. Otherwise retain the typed
domain contracts. No wrapper is required merely to make every operation
share a common name.

Both decisions must be checked against current consumers when evaluating §4.
The gate may close with U18/U19 retained as candidates, provided that decision
and the specialist boundaries are supported by evidence.

## 3. Dependency DAG and implementation order

### 3.1 Edges (A → B: A requires B before A's contract can complete)

| Underlay | Depends on |
| --- | --- |
| U1 Reference | — |
| U2 Role | — |
| U8 Scope/Clock | — |
| U3 Query | U1, U2, U5 (core), U7 |
| U4 Choice | U3, U2 |
| U5 Value | U1, U3 (only the `count(query)` extension; the core scalar algebra precedes U3) |
| U6 Predicate | U1, U3, U5, U8, U10 (effect-still-exists) |
| U7 Anchor | U1, U2 |
| U9 Provenance | U1, U2 |
| U10 Fact | U1, U9 |
| U11 Flow | U1, U4, U6, U10, U12, U15, U17 |
| U12 Continuation | U1, U2, U8, U10, U17 |
| U13 Window | U2, U3, U4, U8, U10, U12, U16, U17 |
| U14 Modifier | U1, U2, U5, U6, U8 |
| U15 Transaction | U1, U6, U8 |
| U16 Usage | U1, U8, U10 (de-dup identity) |
| U17 Ordering | U2, U4 |

Notes.

- **U5↔U3 is the one co-evolution seam.** U3's dynamic range evaluation
  consumes `evaluateNumber` (U5 core); U5's `count(query)` consumes U3.
  Resolve by sequencing U5 core → U3 → U5 extensions; the graph stays
  acyclic at the implementation level.
- **U12→U11 is not an edge.** Flow can suspend into a continuation, so
  U11's `suspend/continue` node requires U12; U13's held payload is a U12
  continuation, so U13 requires U12 (and U11's `open-window` node requires
  U13). Order: U12 → U13 → U11's window/suspend ops. The core U11 (sequence/
  if/repeat with intermediate state) can land before U12/U13.
- **U16's de-dup identity requires U10**; the core usage ledger
  (gates/caps/reset) requires only U1+U8 and can land earlier.

### 3.2 Implementation order (objective: all underlays complete)

Use the dependency DAG to choose the smallest missing shared capability from
fresh consumer evidence. The historical T1–T6 sequence established vocabulary
and execution slices; it does not certify whole-underlay closure.

The current task is the U4 residual audit in [TODO](../TODO.md#current-execution-plan-ordered),
following [recorded placement](tranche-33-placement.md). Re-audit actor/resource,
remaining summon, and continuation choices before selecting the next migration.
For each slice, verify the prerequisite contracts, migrate consumers through
the owning authority, and reconcile the foundation/census evidence. Continue
until every condition below holds.

## 4. Phase gate

### UNDERLAY PHASE COMPLETE

The underlay phase is complete **only when all of the following hold**:

1. **U1–U17 have source-backed contracts.** Each underlay's linked ontology definition and §1 obligations
   (responsibility, source evidence with verified page references, typed
   vocabulary, replay semantics, acceptance tests) is current and true of
   the code at HEAD — not of a tranche document.
2. **One clearly owned semantic authority each.** For every U1–U17 there is
   exactly one owning module/API listed as its authority, and every location
   identified in the foundation and consumer-census evidence has either migrated
   onto it or been explicitly documented as a retained specialist with a
   written boundary.
3. **Required tests.** The acceptance tests named in each §1 row exist and
   pass: positive, negative, boundary, and replay where the underlay is
   stateful/random/timing-dependent.
4. **No known duplicate competing authority within declared scope.** The
   consumer-census migration lists are empty of unresolved duplicates: no second
   eligibility authority beside U3, no second choice validator beside U4,
   no second usage ledger beside U16, no second decision-window record
   beside U13, no second ordering source beside U17, one ModifierRule
   shape, one transaction seam, one fact ledger.
5. **The full suite is green:**
   - `npm run audit:architecture`
   - `npm run audit:automation`
   - `npm run audit:source-fidelity -- --strict`
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `git diff --check`
   - `npm run audit:class-job-census` (census must regenerate byte-stable)

   with no relevant introduced failures.
6. **Candidates decided.** U18/U19 are either promoted through the §2
   decision rules (with their own contracts appended to this document) or
   explicitly retained as candidates/patterns with the evidence recorded.
7. **Generated docs regenerated.** `docs/blocker-census.md/json`,
   `docs/source-fidelity.md` reflect the post-gate repository state.

**Only after this gate** do we regenerate the blocker census as the
wiring-order input and begin source-content wiring (exact source units,
source fixtures, positive/negative/replay tests, per §§8–10 of AGENTS.md).
Until the gate closes, the census is not regenerated for promotion purposes
and the greedy family sequence in TODO/roadmap remains superseded.

---

## 5. Verification discipline during the phase

Run the §4 suite for each rules tranche and the additional task-class checks
in [AGENTS.md](../AGENTS.md#10-verification-matrix). Regenerate generated reports
through their owning commands. Record current maturity once, in the foundation
document, and reconcile the affected consumer-census entries. A fixture change
that alters semantics requires explicit source review; green tests alone do
not establish fidelity or underlay closure.
