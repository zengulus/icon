# T8c — Authority-Proof Closure Tranche (2026-08-31)

Lead specialization: S9 (audit/verification) with S2 (authority-proof
mechanism), S4 (replay/entitlement), S1 (creator/owner source semantics).
**Zero** previously unresolved ICON source units were promoted.

Purpose: make **"routes through the authority"** mean the authority's
*returned result* controls the semantic decision — not merely that the
authority function is imported or called somewhere in the file.

> **`AUTHORITY CALLED` is not equivalent to `AUTHORITY RESULT USED`.**

## 1. Fresh HEAD

Audited commit before any T8c change: **`d06e38a`** ("Deepseek unfuck 2").
The worktree already carried the in-progress creator/owner contract rename
(`creatorOrOwnerId` → `ownerId`, part of this tranche); all audit findings
below are a fresh audit of the *implementation at HEAD*, not inferred from
T8b or from T8b's prose.

## 2. Fresh-audit findings on T8b's repairs

### U2 aura — production route VERIFIED CORRECT, proof was insufficient
`auraOriginRefs` routes the perspective through U2: every origin push passes
origin FACTS into `auraRelationPerspectiveId(...)` and stores its return in
`AuraOriginRef.perspectiveActorId`; `isAuraMember` compares sides against
`state.actors[origin.perspectiveActorId]`, null → only `characters`
relations (fail closed). **Production preserved.**

**Gap found:** the *proof* was call-presence (`code.includes(symbol+"(")`) plus
two narrow spelling regexes (`perspectiveActorId: actor.id` /
`entity.ownerId`). The T8c brief's mutations — *call U2, ignore its return,
alias a local* (`const p = actor.id; ... perspectiveActorId: p`), or read
the perspective off `context.actorId`, or compare membership by an
anchor/owner side — PASS that guard. So T8b's "result used" claim was NOT
mechanically proven.

### U2 candidate — production route VERIFIED CORRECT, proof was insufficient
`actingActor` consumes `relationPerspectiveIdFromContext(context)` and uses
its return to index `context.state.actors`, throwing on null (fail closed).
No second producer supplies the relation perspective. **Production
preserved.** Same proof gap: the guard only required the symbol to be CALLED.

### U16 F9 — production route VERIFIED CORRECT, proof was insufficient
`roundLedgerKey(actor.id, traitId)` → `usageKey(roundLedgerUsageSpec(actor.id, …))`
with the REAL owner; `roundLedgerAvailable` → `ledgerAvailable`; consume →
`consumeUsageMutation`. Storage bytes unchanged (`ledger:round:<sourceId>`,
actor-local). **Production preserved** (only the typed-spec seam
`roundLedgerUsageSpec` was added so owner propagation is testable). The
proof was call-presence only; repeated-bypass, key-concat, raw-`ruleState`
gating, hand-built marks, and fabricated owners were NOT caught.

### Creator / owner contract (T8b `creatorOrOwnerId`) — resolved truthfully

1. **Does entity state distinguish creator from owner?** NO. `EncounterEntity`
   carries exactly one identity field, `ownerId` (`src/rules/types.ts`); there
   is no `creatorId` in the entity schema, the reducer adapter, or the VTT
   room projection.
2. **Does ICON require them to differ for any REPRESENTED, currently-required
   aura semantics?** NO. ICON p.95: a summon belongs to its summoner (removed
   when the summoner is defeated) — one canonical summoner/owner identity. No
   represented aura needs a creator distinct from the owner.
3. **Is `ownerId` the canonical entity creator/summoner identity?** YES — all
   content (`job-kit`, `entity-creation`, lifecycle) writes the summoning
   actor into `ownerId` and defeat-cleanup reads it back.
4. **Conclusion:** the creator/owner distinction is conceptual future
   vocabulary only, NOT mechanically represented now. Per the tranche rule we
   do **not** claim creator ≠ owner is currently representable.

**Chosen contract (single canonical identity):** `AuraPerspectiveOrigin`
entity form is `{ kind: 'entity'; ownerId: string | null }` — "the entity's
canonical owner/summoner identity". U2's declared rule for the current
engine scope: *entity-origin aura perspective = the entity's canonical
owner/summoner; ownerless → null (fail closed)*. The broader `RoleFrame`
retains separate `creatorId`/`ownerId` ROLE slots for when the source/model
actually demands the distinction, but no completeness claim "creator ≠ owner
is representable" is made anywhere in current scope.

## 3. Authority-result proof mechanism (what changed)

Design chosen, per brief §7: **a BRANDED typed seam plus dependency-enforcing
structural guards** (no spelling-regex proliferation):

1. **Branded typed result.** `primitives/roles.ts` declares
   `RelationPerspective = string & { readonly [relationPerspectiveBrand]:
   true }` (a `unique symbol` brand). `relationPerspectiveId`,
   `relationPerspectiveIdFromContext`, and `auraRelationPerspectiveId` return
   `RelationPerspective | null`, and `AuraOriginRef.perspectiveActorId` is
   typed `RelationPerspective | null`. An incidental id (`context.actorId`,
   `actor.id`, `entity.ownerId`, or any local alias of them) is NOT
   assignable to that slot — **a TYPE ERROR**. So a bypass that keeps the call
   alive but substitutes a local value cannot COMPILE into the perspective
   slot: `AUTHORITY RESULT USED` is enforced by the type system, not a regex.
   The value is still a normal string at runtime (usable as a
   `Record<string, …>` index and comparable), so no durable bytes change.
2. **Alias-tolerant producer-ownership guard (aura, `u2-perspective-
   authority`).** Every *runtime producer* of the `perspectiveActorId` value
   (an object-literal property, a `const/let/var perspectiveActorId =`, or a
   member write `.perspectiveActorId =`) must be the `auraRelationPerspectiveId(`
   call. Local aliases (`const p = actor.id; ... perspectiveActorId: p`,
   `const owner = entity.ownerId; const sp = owner; ...`) FAIL. The interface
   field's type ANNOTATION is exempted. Catches U2-M2/M3.
3. **Positive membership-consumption requirement (aura).** Membership must
   read `state.actors[origin.perspectiveActorId]` (the U2-derived perspective
   actor) — an owner/anchor-side membership bypass removes this read and
   FAILS. Catches U2-M4 (alongside the kept `origin.side` / `.side ?? null`
   ban).
4. **Candidate result-consumption ban (`candidate.ts`).** Reading the relation
   perspective off the incidental `context.actorId`
   (`state.actors[context.actorId]`) while keeping the U2 call alive FAILS.
   Catches U2-M1. `context.actorId` remains legitimate for non-relation
   responsibilities (self-selector, anchor default) — no global ban.
5. **U16 F9 result-consumption pins (trait-reactions.ts).** Beyond the
   call-form requirement: (M1) a gate reading raw `ruleState[` fails; (M2) a
   hand-built `{ kind: 'state', … }` mark that never references the U16
   consume result (`mark.*`) fails; (M3) a locally rebuilt canonical key by
   template literal OR `'ledger:' +` concatenation fails; (M4) a typed U16
   call with a fabricated `ownerId: ''` fails. Scoped to the ONE migrated F9
   fold; checked on executable (non-comment) lines.
6. **Brand-pinning (Check 10).** The audit requires the `RelationPerspective`
   brand declaration, the three functions' branded return types, and the typed
   `AuraOriginRef.perspectiveActorId` to remain — otherwise a contributor
   silently downgrading the brand would remove the type-level proof and the
   audit catches it.

## 4. Authority-result data/control paths (current HEAD)

### U2 candidate
```
relationPerspectiveIdFromContext(context)         [roles.ts U2 authority]
  → relationPerspectiveId(roleFrameFromContext(context))
  → returned RelationPerspective (null ⇒ throw, fail closed)
  → context.state.actors[perspectiveId]           ← THE consumed value
  → matchesTargetRelation(acting, actor, relation) [all eligibility]
```
Alternative semantic path: **none**. `actingActor` is the sole producer; a
`context.actorId`-sourced perspective is a type error for the branded path
and an audit violation.

### U2 aura
```
auraOriginRefs: origin FACTS
  → auraRelationPerspectiveId({kind:'actor', bearerId} |
                              {kind:'entity', ownerId})   [roles.ts U2]
  → returned RelationPerspective ⇒ AuraOriginRef.perspectiveActorId ← consumed
  → isAuraMember: state.actors[perspectiveActorId].side ← membership decision
  → null ⇒ only 'characters' relations (fail closed)
```
Alternative semantic path: **none**. The perspective FIELD is typed with the
brand, every runtime producer of its VALUE must be the U2 call, and membership
must read the U2-derived actor.

### U16 F9
```
roundLedgerUsageSpec(actor.id, traitId)                    [typed seam, real owner]
  → usageKey(spec) ⇒ roundLedgerKey                         ← THE consumed key
roundLedgerAvailable(actor, key) → ledgerAvailable → usageCount  [U16 core]
consume → consumeUsageMutation(traitId, actor.id, key); the persisted mark
          spreads mark.* (the U16 returned mutation)              [U16 core]
```
Alternative semantic path: **none** in the fold (raw-`ruleState` gate, hand-built
mark, key reconstruction, and empty-owner are all audit violations).

## 5. Creator / owner conclusion (required deliverable)

- **What ICON requires:** one canonical summoner/owner identity per summon
  (p.95). No currently-represented aura semantics require creator to differ
  from owner.
- **What current entity state represents:** a single `ownerId` per entity
  (`EncounterEntity`); `creatorId` does not exist in the schema.
- **Can creator and owner differ?** Not in current engine scope — they are
  ONE identity. The distinction is future vocabulary only.
- **What U2 now represents:** `AuraPerspectiveOrigin` entity form carries
  `ownerId` only; U2 maps entity-origin aura perspective to that canonical
  owner/summoner identity; ownerless → null.
- **Is U2's declared contract complete?** YES — for the NARROW, truthful scope
  (single canonical owner identity). No "creator ≠ owner representable" claim
  is made. No ambiguous `creatorOrOwner` prose remains.

## 6. Adversarial mutation suite

All mutations keep the canonical authority **actually called** while bypassing
its result. Reported `CAUGHT | NOT CAUGHT` with the mechanism.

| # | Mutation | Mechanism that catches it | Result |
| --- | --- | --- | --- |
| U2-M1 | candidate: U2 called, result ignored, perspective from `context.actorId` | candidate result-consumption ban on `state.actors[context.actorId]` (§3.4) | **CAUGHT** |
| U2-M2 | aura: U2 called, locally aliased `actor.id` supplies `perspectiveActorId` | alias-tolerant producer guard (§3.2) + brand type (§3.1) | **CAUGHT** |
| U2-M3 | aura: U2 called, aliased entity ownership supplies the perspective | same producer guard (§3.2) + brand type | **CAUGHT** |
| U2-M4 | membership bypass: `perspectiveActorId` U2-derived but membership uses anchor/owner side | positive consumption `state.actors[origin.perspectiveActorId]` (§3.3) + `origin.side` ban | **CAUGHT** |
| U16-M1 | `ledgerAvailable` called but gate reads raw `ruleState` | raw-`ruleState`-gate pin (§3.5) | **CAUGHT** |
| U16-M2 | `consumeUsageMutation` called but mark hand-built | hand-built-mark pin (missing `mark.*`) (§3.5) | **CAUGHT** |
| U16-M3 | `usageKey` called but key locally rebuilt (concat/template) | key-reconstruction + concat pins (§3.5) | **CAUGHT** |
| U16-M4 | decoy real-owner call, actual path uses fabricated `''` owner | empty-owner pin (§3.5) + typed-spec seam | **CAUGHT** |

All eight mutation fixtures live in `src/rules/__tests__/architecture-audit.test.ts`
(the `auditArchitecture (violation detection)` suite) and assert a violation is
raised. Additionally, `tsc --noEmit` proves the branded type rejects
`perspectiveActorId: <plain string>` (U2-M2/M3 are compile errors), pinned by a
`@ts-expect-error` compile proof in `t7-u2-role-consumers.test.ts`.

## 7. Corrected U1–U17 census (mutually exclusive buckets)

Rule applied: *a retained specialist must answer a genuinely different
semantic question; if it independently answers the underlay's question because
migration is incomplete, it is an UNRESOLVED DUPLICATE.*

| U | Semantic question | Authority | MIGRATED | RETAINED SPECIALIST (4-part proof) | UNRESOLVED DUPLICATE | Status |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | What does a reference mean? | `primitives/reference.ts` | continuation refs; candidate anchor selectors | — | legacy context-slot reads (`actorId`/`attackTargetId`/`triggerSourceId`/`damageRecipientId`) independently resolve "what does this slot mean" outside U1 | PARTIAL |
| U2 | Relative to whom? | `primitives/roles.ts` (branded `RelationPerspective`) | candidate, aura, chanter, choice, decision-window (result-proven §4) | `matchesTargetRelation` — Q: compare two given sides; disjoint: takes the perspective as INPUT, cannot derive it; no-reconstruction: has no origin-kind/owner mapping; proof: U2-M1..M4 guards + brand type | none | **AUTHORITATIVE** |
| U3 | What qualifies now? | `evaluate-query.ts`+`query.ts`+`candidate.ts` | actor candidates, direct-target gate, area inclusion, nearest | direct-target problem vocabulary — Q: given perspective+relation, is X eligible; disjoint; cannot derive perspective; guarded | terrain/entity/area/instance domains, ordering beyond min-distance | PARTIAL |
| U4 | What did the player choose? | `kernels/choice.ts` | all choice-type validations, teleport legality | teleport-choice refinements — Q: in-grid/unoccupied legality on validated output; disjoint; operates only on `resolveChoice` output; same violation-code coupling | `ability-use-choices`/`talentChoices` folds | PARTIAL |
| U5 | What scalar now? | `RuleNumber`+`evaluateNumber` | query ranges, modifier numerics | pure scalar translations at kernel boundary — Q: constant arithmetic; disjoint (context-dependent FAIL CLOSED); cannot read state; build-time pinned | inline per-resolver arithmetic; typed non-numeric values | PARTIAL |
| U6 | Does this clause apply now? | `evaluate-predicate.ts` | used-scope, effect-still-exists | — | local range/area gate-body folds (independently answer applicability) | PARTIAL |
| U7 | From where is this spatial rule measured? | `primitives/anchor.ts`+`spatial-intent.ts` | candidate range-origin, choice position range, teleport-choice origin positions (captured-position anchor via `validatePositionLegality`) | `RuleArea.origin` — Q: declarative placement shape (no runtime consumer); disjoint; `creationSpatial` contract — Q: resolved-position carried on the creation mutation for replay; disjoint; neither can reconstruct an anchor; guarded | aura origin derivation (`auraOriginRefs` measures membership from an independently-derived origin, not unified onto `SpatialAnchor`); `runtime.ts` `context.actorId`-as-anchor reads (T2+ de-dup) | PARTIAL |
| U8 | Within what boundary? | `primitives/scope.ts` | U16 reset reads | lifecycle turn/round machinery — Q: drive the encounter lifecycle; disjoint (Clock consumes outputs); guarded | `RuleDuration`/`RuleTiming`/scheduler round counters | PARTIAL |
| U9 | What caused this? | `primitives/provenance.ts` | mutation provenance at resolve points | `attackDamageProvenance`, delivery fields, `voluntary` — Q: domain-specific provenance shapes; disjoint; feed, don't re-derive; mutation tests | `resolution-triggers`/`damage-ledger`/movement folds reconstructing provenance | PARTIAL |
| U10 | What already happened? | `primitives/facts.ts` | fact recording, resolution-triggers projection | damage/held/save ledgers — Q: in-flight resolution bookkeeping; disjoint (pre-fact); consumed by fact projection; replay tests | movement/shove/rush/fly vs remove/place, save-outcome representability unproven | PARTIAL |
| U11 | What order do operations run? | `kernels/execute-flow.ts` | open-window→U13→U4 carriage | — | per-resolver hand-sequenced code (independently answers "what happens next") | PARTIAL |
| U12 | What is armed now, resolves later? | `primitives/continuation.ts` | directed/suspended continuations on `DecisionWindowRecord` | lifecycle `delayed` phase — Q: lifecycle-phase scheduling of due work; disjoint (executes, doesn't arm); guarded | resolver end-of-turn effects, save-window AST per-source delayed logic | PARTIAL |
| U13 | Has resolution paused for a decision? | `kernels/decision-window.ts` | all window kinds through ONE record | `save-window.ts`/`gamble-window.ts` — Q: produce a recorded roll; disjoint (domain primitive, not a pause-for-decision); cannot open/close windows; dedicated suites | none | **AUTHORITATIVE** |
| U14 | How does an attached rule alter a query point? | `primitives/modifiers.ts` | range/area/mastery/bonus-damage folds | `cost-payment.ts`, armed one-shot fold, aura/save boon-curse sites — Q: domain consumption of folded values; disjoint; consume only; modifier suites | `RuleModifier` stat bag not fully typed | PARTIAL |
| U15 | Which changes validate together? | `primitives/transaction.ts` | Masquerade spatial-batch gate | per-list cost-payment, spatial per-leg legality — Q: single-leg legality; disjoint (feeds the group, doesn't group); cannot snapshot/commit; transaction tests | cost-payment/spatial-swap/exact-count/sacrifice/split-pool/flow atomicity unproven | PARTIAL |
| U16 | How many uses within scope X? | `primitives/usage.ts`+`use-ledger.ts` | F9 trait-reactions (real owner, result-proven §4); reducer/lifecycle resets | `attackedThisTurn` (U10 fact, NOT the entitlement); scheduler clocks; Delay flags — Q: historical fact / lifecycle state; disjoint; cannot gate uses; census documented | residual actor-level marks: `chain-reaction-used`, `incubus:triggered`, `stampede:triggered`, `gates-of-hell:vigilance-rushed`, `damage-immune`, per-source `:used`/`:charged` | **PARTIAL** (deliberately not closed here) |
| U17 | Simultaneous order? | `primitives/ordering.ts` | runtime/lifecycle/decision-window/encounter ordering; recorded same-owner ranks | scheduler turn election (written recorded authority the policy reads); `modifiers.ts` declarative ordering field — Q: produce/declare order inputs; disjoint; cannot arbitrate; ordering suites | none | **AUTHORITATIVE** |

No consumer appears in both RETAINED SPECIALIST and UNRESOLVED DUPLICATE.

## 8. Corrected matrix

`ABSENT | SKELETON | PARTIAL | AUTHORITATIVE` — not inherited from T8b:

- **AUTHORITATIVE:** U2 (re-earned THIS time by a branded typed seam +
  structural result-ownership guards + truthful owner contract, all eight
  mutations CAUGHT), U13, U17 (re-attested; the stricter specialist test found
  no same-question implementation).
- **PARTIAL:** U1, U3, U4, U5, U6, U7, U8, U9, U10, U11, U12, U14, U15, U16.
- ABSENT / SKELETON: none.
- U16 is PARTIAL for the §12 reason (residual actor-level trigger marks still
  require classification), NOT because the F9 round-gate proof is incomplete —
  its four adversarial mutations are all CAUGHT.

## 9. Verification (exact)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npm test` | **122 files, 1870 tests passed** |
| `npm run build` | exit 0 |
| `npm run audit:architecture` | 115 files, 0 violations (incl. U2-M1..M4 and U16-M1..M4 fixtures) |
| `npm run audit:automation` | exit 0 |
| `npm run audit:source-fidelity -- --strict` | no integrity violations (claims allowlist reconciled to the re-cert U2 heading) |
| `npm run audit:outcome-triggers` | exit 0 |
| `npm run verify:source-artifacts` | valid, PDF pinned (f6ed899d…) |
| Replay suites (`t7-u2-role-consumers`, `trait-reactions`, `t3-usage`, `use-ledger`) | all pass |
| `npm run audit:class-job-census` | byte-stable, **427** unresolved |
| `git diff --check` | clean |

## 10. Source census

**Zero** source units promoted. Blocker census byte-stable at **427**
unresolved (unchanged, as mandated). Changes were generic substrate only:
`roles.ts` (branded typed seam + owner contract), `aura.ts` (typed field),
`trait-reactions.ts` (typed-spec seam), the audit guard machinery, tests, and
docs.

## 11. Gate

**UNDERLAY PHASE: OPEN** — 14 of 17 underlays remain PARTIAL per the
corrected matrix.

## 12. Next tranche (identified)

**U16 residual-marks census & migration** — LANDED (2026-08-31): each
actor-level mark (`chain-reaction-used`, `incubus:triggered`,
`stampede:triggered`, `gates-of-hell:vigilance-rushed`, `damage-immune`,
per-source `:used`/`:charged`) was classified and the genuine once-per-scope
entitlements migrated to typed U16 `ledger:*` entries (see
`docs/rules-foundations.md` §U16); U16 re-certified AUTHORITATIVE. The next
smallest underlay tranche is the U8 duration/timing/scheduler surface.

---

### Completion criterion (brief section "Completion criterion")

1. authority merely-called no longer accepted as routing proof — enforced by
   the BRANDED typed seam + structural result-consumption guards;
2. adversarial tests keep calls alive while bypassing results, and the
   bypasses are caught — all U2-M1..M4 and U16-M1..M4 are **CAUGHT**;
3. U2 aura/candidate decisions demonstrably consume U2's returned values —
   §4 control paths, type-enforced;
4. U16 F9 key/availability/consume demonstrably consume U16's returned values
   — §4 control path, pins catch each bypass;
5. real U16 owner propagation is testable despite actor-local storage — §3.5 /
   `roundLedgerUsageSpec` + typed-identity tests;
6. creator vs owner semantics represented & documented truthfully — single
   canonical owner identity, no distinctness claim;
7. every retained specialist answers a disjoint question — §7 four-part proof;
8. no consumer in both buckets — §7;
9. U2 classified from the stronger evidence — **AUTHORITATIVE**, earned by the
   branded seam + all mutations CAUGHT (PARTIAL would also have been
   acceptable per the brief);
10. zero source units promoted — §10;
11. next tranche identified but not started — §12.

**The standard: the authority's returned answer is the value the engine
actually uses.** Not "the authority was called somewhere nearby."