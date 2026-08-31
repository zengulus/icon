# U8 → Monogatari/U16 proof-consumer integration (2026-09-01)

This is the Stage B report for the two-stage request that first hardened the
strong-claim surface guard (Stage A, `docs/strong-claim-surface-repair.md`),
then proved the U8 source-defined-lifecycle abstraction with the real Monogatari
consumer, composed with U16. Authority split preserved through the whole stage:

- **U8** (`primitives/scope.ts`) owns *which lifecycle instance is current and
  when it was replaced* — a song is a U8 lifecycle INSTANCE.
- **U16** (`primitives/usage.ts` core + `kernels/use-ledger.ts` operation)
  owns *has THIS recipient already fulfilled within THAT instance*.
- **Content** (`content/jobs/chanter-programs.ts` + `lifecycle-recipes.ts`)
  owns the concrete trigger/effect and that the scope is the current song.

No `'song'` usage period was invented. No owner/source identity lives in a magic
string. No generic primitive/kernel branches on a Monogatari source id.

## Cursor: exact Monogatari source reading (ICON 1.5.pdf p.179)

The passage establishes, in order:

1. Monogatari establishes a song;
2. that song persists until Monogatari is used again;
3. a character fulfilling the described course receives the benefit;
4. a character may fulfill the condition once per song.

No rule beyond those was inferred.

## Stage A — strong-claim surface hardening (summary)

Done first, committed separately. `primitives/scope.ts` and the reducer were
untouched by Stage A. The surface classifier catches claims, not words; a
genuine claim surface wins over unrelated prose on the same line; the blanket
`by design`/`architecturally` qualifier exemption was removed (subject/surface
meaning decides). See `docs/strong-claim-surface-repair.md`.

## Stage B — Monogatari × U8 × U16

### Required identity

The entitlement distinguishes `source/owner of the song × recipient ×
lifecycle instance`. `LifecycleGroupKey` already embeds the OWNER
(`lifecycleGroupKey(owner, source)`), so two Chanters never alias and
re-establishing one owner advances only that owner's entry.

### Generic extension to the U16 API

The smallest generic extension was added, all U16-side (no Monogatari knowledge
leaks into primitives/kernels):

- `primitives/usage.ts` — `lifecycleScopedUsageKey(sourceId, lifecycleIdentityKey)`:
  the durable U16 ledger key for a once-per-lifecycle-instance entitlement,
  derived from U8's canonical `lifecycleIdentityKey` (owner × source ×
  instance). No content constructs this key by hand.
- `kernels/use-ledger.ts` — `applyLifecycleScopedUsage({ recipient, lifecycle,
  now, sourceId, mutations })`: the ONE U16 COMMIT operation. It verifies the
  lifecycle identity is CURRENT through U8 (`lifecycleInstanceCurrent` — a
  stale/missing identity FAILS CLOSED and can never fall back to a
  turn/round/combat scope), derives the durable key, checks availability, and
  groups the consume mark with the caller's proposed effect mutations. The
  caller cannot reconstruct the key, cannot separately decide availability, and
  never emits its own consume mutation.
- `kernels/use-ledger.ts` — `currentLifecycleInstanceFor`,
  `recordLifecycleInstance`, `lifecycleObservationForGroup`: the durable
  read/write/observation boundary for the U8-composed lifecycle-instance store.

### Monogatari execution flow before → after

**Before:** Monogatari turn-end set a durable `monogatari:tale`, and
`monogatari:granted` (a raw content boolean) was set once; a *new* tale deleted
*all* `monogatari:granted` flags globally. That is exactly the alias bug this
transche removes: one Chanter's new tale reopened every Chanter's grant, and a
second recipient and a second Chanter could not be distinguished.

**After:** the turn-end recipe resolve does two separable deterministic steps:

1. **Grant branch first** — the ending hero's tale is read from the singing
   Chanter's durable ruleState, the Chanter's CURRENT U8 song instance is read
   (`currentLifecycleInstanceFor`), and the blessing is a U16
   `applyLifecycleScopedUsage` transaction keyed by `{ owner: chanter, source,
   instance }`. If the identity is not current or the recipient already
   consumed within that instance, it fails closed (no fallback, no grant).
2. **Song-establishment branch** — a freshly-gambled tale is a NEW song:
   `recordLifecycleInstance` ADVANCES the Chanter's U8 instance, yielding a
   fresh U16 ledger key so every eligible hero's once-per-song entitlement
   reopens WITHOUT a global clear. (The grant branch runs first so establishing
   the new song never also grants under the stale song.)

`monogatari:granted` has no remaining production writer or reader (the chanter
test now asserts its absence); the blessed resource mutation and the U16
consume ride the recorded TURN_ENDED event, so replay applies the recorded mint
+ grant decisions byte-identically and never re-decides entitlement.

### Multi-owner correction (2026-09-01) — the first-match song owner was wrong

**Bug found:** the grant branch selected the active song by a FIRST-MATCH read
— `Object.values(state.actors).find(...)` over actors with a durable
`monogatari:tale` — equivalent to "whichever active Chanter happens to appear
first in actor iteration". With two simultaneous Chanters, a recipient was
 evaluated against ONE arbitrary song: a recipient who fulfilled B's course
 but not A's either consumed A's entitlement (when A's tale happened to be met
 by the same state) or received nothing (when A's tale was unmet), and a
 recipient who fulfilled both songs received only one blessing. Iteration
 order changed the outcome.

**Source reading (ICON 1.5 p.179, exact cursor):** each use of Monogatari
establishes THAT Chanter's song ("The song resonates in the air until this
ability is used again"); characters completing the described course are
"blessed at the end of their turn"; "Characters can only fulfill this
condition once per song". Nothing in the passage collapses songs across
users — each Chanter's song is its own lifecycle, so the recipient must be
evaluated INDEPENDENTLY against every active applicable song.

**Fix (unchanged architecture):** the grant branch now enumerates EVERY active
song owner (`activeMonogatariSongOwners`, deterministically sorted) and runs
the SAME generic U8×U16 `applyLifecycleScopedUsage` transaction per lifecycle
identity `{ owner × source × instance }`. U8 still owns lifecycle identity and
currentness (`currentLifecycleInstanceFor` / `lifecycleInstanceCurrent`); U16
still owns availability / consume / key grouping. Content owns the concrete
song condition and reward. Identity: song A = owner A × Monogatari source ×
instance A; song B = owner B × source × instance B; entitlement =
recipient × song lifecycle identity. Consuming A never marks B consumed;
satisfying both yields both rewards; replacing A reopens only A; two songs
whose tale happens to be identical remain separate lifecycle/usage identities;
iteration order of `state.actors` cannot affect the outcome (grants commute
onto disjoint ledger keys, and enumeration is sorted). No Monogatari-specific
exception was added to U8 or U16; no second reference/usage system was built.

**Multi-owner adversarial matrix added to `monogatari-u8-u16.test.ts`:**
1. A and B both have ACTIVE songs with distinct lifecycle instances.
2. Recipient satisfies B only → receives B only (first-match read granted
   nothing when A was first).
3. Recipient satisfies both → independently consumes both entitlements (the
   pre-fix consumer granted one).
4. Consuming A does not mark B consumed, and vice versa.
5. Same recipient cannot fulfill A twice during the same A instance (even
   with B active).
6. Replacing A reopens A for that recipient without reopening or otherwise
   changing B (B's instance and B-entitlement history untouched).
7. Two Chanters singing the SAME tale still remain independent
   lifecycle/usage identities (distinct instances, distinct recipient ledger
   keys, both consumed).
8. Reversing actor insertion/iteration order produces the same semantic
   outcome.
9. Exact command replay reproduces the simultaneous two-song mint + grant
   mutations byte-identically without re-deciding eligibility.

**Scope boundary preserved:** this fixes the U8×U16 proof consumer only. The
rest of the Monogatari source unit stays unresolved exactly as before — the
Charge "roll one extra d6 and choose any result" player-choice seam, tale 1 /
6 reactive windows, and the talent/mastery clauses are NOT promoted by this
correction. `monogatari:granted`'s replacement is complete; the unit's
remaining clauses are not.

### Adversarial test matrix (`src/rules/__tests__/monogatari-u8-u16.test.ts`)

1. One recipient fulfills one song once → blessed exactly once; same-song
   repeat blocked (usage key stays at 1; instance unchanged).
2. A second recipient may fulfill the same song independently (its own ledger
   under the same instance).
3. Using Monogatari again creates/replaces the lifecycle instance; the same
   recipient may fulfill the NEW song (reopens without a global clear).
4. Two Chanters' songs never alias; replacing A's song ADVANCES A's instance
   but leaves B's instance and usage untouched.
5. Malformed/missing lifecycle identity fails closed — never falls back to a
   turn/round/combat scope.
6. Exact command replay (applyEvents over the recorded event list after each
   command) produces byte-identical state for the mint AND grant decisions and
   does not re-decide entitlement.

Aura-placement note: heroes carry `bastion:trait:shieldmaster` (aura radius 1).
Two heroes within range 1 open a legitimate same-owner U13 ordering window that
defers a turn-end recipe — correct engine behavior, but it would obscure the
Monogatari lifecycle assertions. The fixture places second heroes/allies at
Chebyshev distance ≥ 2 so the aura covers no ally and the Monogatari turn-end
resolves immediately.

## Replay result

Each command's recorded events rebuild the exact resulting state
(`applyEvents(preCommand, events) === postCommand`), including the song mint and
the once-per-song U16 consume. No lifecycle/usage eligibility decision is
re-derived on replay.

## U8 residual census at this checkpoint (later corrected)

This checkpoint correctly classified the reducer's durable turns/rounds
counters and scheduler cadence as specialist recorded-state/cadence
authorities. It did not inspect combat-end collection membership closely
enough: a later whole-consumer audit found combat cleanup directly interpreting
`duration.kind === 'expedition'`. That omission invalidates this report's
then-current "no competing temporal interpretation" conclusion. The follow-up
routes combat cleanup through `durationSurvivesCombatEnd` and records the final
U8 result in `docs/u8-u1-underlay-census.md`.

## Fresh U16 residual census

`monogatari:granted` was the SOLE UNRESOLVED U16 consumer. It is now integrated
as a generic lifecycle-scoped usage. A fresh census (grep over content for raw
`:used` / `:granted` / `:triggered` RULE-STATE readers) found NONE; every
once-per-X gate lives on typed U16 ledger keys, and the armed/pending/charged
MODE states remain content-owned state (they answer "is the next attack/effect
armed?", never "may this use occur again?"). No remaining unresolved U16
consumer and no competing usage authority. **U16 is recertified COMPLETE** by a
strict source-fidelity registered claim.

## Source-unit census delta

Source-unit census is **byte-stable at 427 unresolved, zero source promotion**.
Stage B wired an already-identified proof consumer onto substrate (U8×U16); it
did not promote, migrate, or rewire unrelated unresolved content.

## Validation

- `npm test` — 1925 passed (59 in the four targeted suites incl. the 6 new
  Stage B tests).
- typecheck, `npm run build` — pass.
- architecture audit (115 files), automation audit — pass.
- outcome-triggers audit, class/job census — pass.
- strict source-fidelity — pass (U16 recertification registered as a claim).
- `verify:source-artifacts` — valid.
- census — 427 unresolved, zero promotion.
- `git diff --check` — clean.

## Status justification

- **U8 at this checkpoint**: PARTIAL — this status is superseded by the later
  whole-consumer audit and combat-cleanup repair in
  `docs/u8-u1-underlay-census.md`.
- **U16**: COMPLETE — the sole unresolved consumer is integrated and the fresh
  residual census shows no remaining consumer or competing authority.

## Strongest next tranche implied by the fresh post-integration residual graph

This recommendation was executed by the later U8 whole-consumer audit. It
confirmed the scheduler/counter specialist classification, found and repaired
the combat-cleanup duplicate, then ran the fresh U1–U17 census. The selected
dependency-root tranche is U1; its generic-consumer slice is recorded in
`docs/u8-u1-underlay-census.md`.
