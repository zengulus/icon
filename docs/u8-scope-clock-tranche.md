# U8 Scope / Clock — Fresh-HEAD Audit, Contract, and Landed Tranche

Historical checkpoint status: PARTIAL. Superseded by the later whole-consumer
audit and combat-cleanup repair in `u8-u1-underlay-census.md`; the residual
analysis below describes this tranche's pre-closure state.

Authority: ICON 1.5.pdf (semantic), implementation@HEAD (execution), this +
`underlay-completion-plan.md`/`generic-underlays.md` (planning only).

---

## 1. Fresh-HEAD temporal-authority census

Every independent reader/authority of temporal/lifecycle semantics found at
HEAD (commit `20562b2`), before this tranche:

| Authority | Location | What it re-keys | Migration state after this tranche |
| --- | --- | --- | --- |
| U8 Clock/Scope vocabulary | `primitives/scope.ts` | the ONE `Clock`/`BoundaryRef`/`Scope` | **the authority** |
| `RuleTiming` boundary reads | `primitives/types.ts` + `clockForTiming` | maps timing tokens to a `BoundaryRef` carrying EDGE + subject | migrated (T1 callback) |
| use-ledger reset periods | `primitives/usage.ts` (`resetBoundaryFor`, `usagePeriodForResetBoundary`) | turn/any-turn/round/combat → U8 `BoundaryRef` | migrated (T6.1) |
| lifecycle phase → boundary | `content/jobs/lifecycle-recipes.ts` `boundaryForLifecyclePhase` | `clockForTiming(phase)` for turn/round phases | migrated |
| continuation clocks | `primitives/continuation.ts` (`clockObservationForBoundary`, `scopeSatisfied`, `boundaryReached`) | deferred-rule + expiry clocks over U8 observations | migrated |
| scheduler cadence | `turn-scheduler.ts` | round advance, slow/normal, side alternation (`state.round`, `turnsTakenThisRound`) | **specialist scheduler authority** (kept; reads `state.round`), not a rule duration |
| `expireBoundaryEffects` / `expireOneBoundaryRecord` | `encounter.ts` | re-keys `duration.kind`, decrements `turns`/`rounds` on the recorded record | **reducer specialist** — recorded remaining-count on the durable record; boundary meaning now routed through U8 where the reducer declares one |
| `monogatari:granted` once-per-song | `content/jobs/lifecycle-recipes.ts` Monogatari turn-end recipe | source-defined lifecycle scope ("once per song", song = until Monogatari is used again) | **UNRESOLVED** — the generic U8 lifecycle identity needed by this consumer now EXISTS (`scope.ts`); Monogatari content wiring intentionally NOT done (per U16 boundary) |
| ENCOUNTER_ENDED expedition filter | `encounter.ts` `duration.kind === 'expedition'` | keeps only expedition-scoped effects at combat end | reducer specialist (combat cleanup cadence) |
| `attackedThisTurn` / armed / charged / pending flags | `reviewed` across kernels (Hissatsu, Carnevale, Trick Shot, Ace, Sweet Torment…) | armed/charged mode state, NOT durations | **specialist mode state** — U8 explicitly does not own "is armed" |

## 2. Sources of boundary meaning vs. recorded state

The key correctness rule this tranche preserves:

- **U8 owns "when does a scope elapse / which lifecycle boundary occurred".**
- **U8 does NOT own "is a mechanic presently armed/charged/pending".**
- **The reducer owns the durable membership of an active effect / condition.**

`expireBoundaryEffects` decrements `turns`/`rounds` on the durable active-effect
record. That remaining count is recorded reducer state (a serialized field),
whose advancement is a recorded transition — it is NOT a second interpretation
of "round". It is the reducer's persistence of "N boundaries remain". Routing
the *which-boundary-meaning* (what `turn-end` means) through `clockForTiming`
closes the interpretive duplicate; keeping the decrement on the record preserves
replay byte-identity. Full epoch-observation on active effects remains residual
(see §6) because it changes the durable schema and is riskier than the value it
adds this tranche.

## 3. Source-defined lifecycle identity (critical design requirement)

Closed in `primitives/scope.ts` (this tranche): a generic, typed identity for
"the current instance of this source-defined lifecycle owned by this
source/actor", composed from U1 References (owner, source) and a durable
instance discriminator — NOT a hard-coded `'song'` period enum member, NOT a
parallel raw-id temporal type.

It solves Monogatari's proof case generically:

- the song persists until Monogatari is used again ⇒ `until-lifecycle-replaced`;
- a character may fulfill the condition once per song ⇒ U16 consumes the
  current lifecycle instance id as the usage scope (U8 provides the instance
  identity + a "current instance" read; U16 owns the counting);
- two Chanters' songs never alias ⇒ the identity's group key includes the OWNER
  reference;
- replacing one Chanter's song advances only that owner's instance ⇒ the
  observed current instance id for (owner, source) advances, the other owner's
  stays.

Per the U16 boundary, this tranche does NOT rewire Monogatari content onto the
new identity nor recertify U16 — it supplies the generic U8 scope that was
U16's blocking gap.

## 4. U8 contract (exact)

**U8 OWNS**

1. The one typed temporal/extent vocabulary (`BoundarySpan`, `BoundaryEdge`,
   `BoundaryRef`, `Clock`, `Scope`, `ClockObservation`, `LifecycleIdentity`).
2. Which timing token names which boundary, with EDGE and actor-relative
   SUBJECT never collapsed (`clockForTiming`).
3. Whether a scope has elapsed/reached given a recorded observation —
   `boundaryReached` / `scopeSatisfied`, relative to a recorded EPOCH (never
   absolute round numbers), failing closed without the epoch.
4. Source-defined lifecycle identity and replacement semantics
   (`LifecycleIdentity`, `until-lifecycle-replaced`, current-instance read).
5. Which boundary/period a usage ledger refreshes at (`resetBoundaryFor`,
   `usagePeriodForResetBoundary`) — U16 composes it.

**U8 DOES NOT OWN**

- Turn cadence / who may act / when the round advances — the scheduler.
- Whether a mechanic is armed / pending / charged — specialist mode state.
- How many uses are left — U16 counting.
- Which concrete instances are live on an actor — the reducer membership.

**Adapters:** `RuleTiming` (mapped by `clockForTiming`), `RuleDuration`
(mapped by `scopeForDuration`), lifecycle phases (mapped by
`boundaryForLifecyclePhase`), use-ledger reset recipes, continuations.

## 5. What this tranche changes

- `primitives/scope.ts`: adds `LifecycleIdentity` (U1-composed owner + source),
  `lifecycleIdentityKey`, `lifecycleGroupKey`, `sameLifecycleInstance`, the
  `until-lifecycle-replaced` Scope form, a `lifecycles` map on
  `ClockObservation`, `currentLifecycleInstanceId`, `lifecycleReplaced`, and
  `scopeSatisfied` handling for the form. Deterministic, byte-stable, no source
  IDs, no content wiring.
- Adversarial tests lock the Mandatory Requirements (start/end edges,
  owner-relative expiry, battlefield any-turn reset, epoch-relative N, two
  owners, replace-one, replay byte-identity, fail-closed).
- `boundaryForLifecyclePhase` comment corrected (the `delayed` phase correctly
  maps to null — it is inside the turn, not a separate boundary).

No source unit is promoted. Census baseline re-measured fresh (see report §8).

## 6. Residual (why U8 stays PARTIAL)

1. **Reducer active-effect boundary decrement** (`expireBoundaryEffects`):
   the per-record `turns`/`rounds` remaining-count lives on the durable
   record. Its boundary MEANING is routed through `clockForTiming`; converting
   its storage to epoch-based observations is a durable-schema change deferred
   because it changes replay bytes and checkpoints for no semantic gain this
   tranche.
2. **Scheduler cadence** (`turn-scheduler.ts`): kept as the scheduler authority
   (reads `state.round` for cadence, not as a rule duration).
3. **Monogatari content** intentionally unmigrated (U16 boundary).

Nothing remaining is a duplicate *interpretation* of a boundary within U8's
declared contract; the residual readers are recorded-state specialists whose
boundary meaning now composes the Clock.
