# T8 — Underlay Authority Repair Tranche (2026-08-31)

Lead specialization: S9 (audit/verification) with S4 (U16 entitlement routing)
and S2 (architecture guards). This is a **rules-underlay repair tranche only**:
**zero** previously unresolved ICON source units were promoted or newly wired.

Governing invariant applied throughout:

> **AUTHORITATIVE means there is no other executing implementation of the
> semantic question inside the underlay's declared scope.** A consumer that
> independently reconstructs the same answer is a competing authority even if
> it produces identical results.

## 1. Corrected U1–U17 matrix (code-grounded, verifies current HEAD)

`ABSENT | SKELETON | PARTIAL | AUTHORITATIVE`. No intermediate states.

| Underlay | Declared authority | Classification | Code-grounded reason |
| --- | --- | --- | --- |
| U1 Reference/Binding | `primitives/reference.ts` | PARTIAL | Typed refs + LIVE/CAPTURED exist; the legacy context slots (`actorId`/`attackTargetId`/`triggerSourceId`/`damageRecipientId`) remain resolution sources, so reference binding is not yet the single executing authority everywhere. |
| U2 Role/Perspective | `primitives/roles.ts` | **AUTHORITATIVE** | Single typed vocabulary; `deriveRoles`/`relationPerspectiveId(FromContext)`/`windowResponderId`; `kernels/candidate.ts` + `kernels/aura.ts` derive the relation/member perspective through U2 (ROLE ≠ ANCHOR); `u2-perspective-authority` guard green this pass; adversarial + replay tests (`t7-u2-role-consumers.test.ts`). Established by the immediately-prior T7 tranche and re-verified here. |
| U3 Query/Candidate | `kernels/evaluate-query.ts` + `primitives/query.ts` | PARTIAL | area/persistent-instance/rule-source query domains, and ordering beyond min-distance, are un-migrated. |
| U4 Choice/Decision | `kernels/choice.ts` | PARTIAL | `ability-use-choices`/`talentChoices` folds are not (yet) validated through `resolveChoice`. |
| U5 Value/Expression | `kernels/evaluate-value.ts` | PARTIAL | inline per-resolver arithmetic; typed non-numeric values and usage reads absent. |
| U6 Predicate/Condition | `kernels/evaluate-predicate.ts` | PARTIAL | range/area gate-body folds still fold locally; the `acted-this-round` predicate reads the `attackedThisTurn` fact (a fidelity concern to resolve against source, not preserved as a claimed-complete "acted" semantics). |
| U7 Anchor/Spatial Frame | `primitives/anchor.ts` | PARTIAL | aura/teleport/creation origins not unified onto one `SpatialAnchor` authority (U6-strict reused here: specialists without a shared-anchor parity proof). |
| U8 Scope/Clock | `primitives/scope.ts` | PARTIAL | `RuleDuration`/`RuleTiming`/lifecycle-expiry/scheduler round counters still re-key temporal boundaries separately (use-ledger reset migrated in T6.1). |
| U9 Provenance/Cause | `primitives/provenance.ts` | PARTIAL | `resolution-triggers`/`damage-ledger`/movement folds still reconstruct provenance they could read. |
| U10 Fact/Resolved Outcome | `primitives/facts.ts` | **PARTIAL** (was LANDED/TRUE) | Facts are durable and consume correctly, but the strict invariant requires positively proving the recorded Fact vocabulary can represent all source-required historical distinctions — movement vs shove/rush/fly/teleport vs remove/place (which do not count as movement), movement-entry/exit triggers. That proof is not exhaustive; per the tranche "do not claim U10 complete if required historical distinctions are unavailable". Demoted conservatively. |
| U11 Flow/Sequence | `kernels/execute-flow.ts` | PARTIAL | per-resolver hand-sequenced code (open-window→U13→U4 is the sole mid-flow decision carriage). |
| U12 Continuation/Suspension | `primitives/continuation.ts` + `continuation-runtime.ts` | PARTIAL | resolver end-of-turn effects (Polaris/Carnevale), save-window AST, held-damage records still use per-source delayed logic. |
| U13 Window/Decision Point | `kernels/decision-window.ts` | **AUTHORITATIVE** (re-audited) | ONE durable `DecisionWindowRecord`; old `trigger-window.ts` and `pendingInterrupts` migrated/deleted (schema 8→9); save/interrupt/choice/held compose through it; no parallel pending-window schema owns decision semantics; `EncounterPendingInterrupt` is only a compat alias. Re-audited — retained. |
| U14 Modifier/Policy | `primitives/modifiers.ts` | PARTIAL | `RuleModifier` stat bag not folded as typed query points; attack/mastery/bonus-damage/aura reads family. |
| U15 Transaction/Atomic Commit | `primitives/transaction.ts` | **PARTIAL** (was TRUE) | `transaction.ts` is a good generic primitive (grouping/snapshot/atomicity), but the strict invariant requires proving every flow that decides "which proposed changes validate together before any commit" (cost/payment, spatial batches/swaps, exact-count creation, sacrifice+payoff, split-pool, grouped movement/flow) routes through it rather than independently implementing atomic grouping. Not exhaustively proven — demoted. |
| U16 Usage/Entitlement | `primitives/usage.ts` + `kernels/use-ledger.ts` | **PARTIAL** (was AUTHORITATIVE — false closure, see §3/§4) | The prior AUTHORITATIVE claim hid a genuine executing duplicate (`kernels/trait-reactions.ts` independently implemented the `ledger:round:*` key/availability/consume). Repaired this tranche to route through the U16 core, and the `u16-usage-ledger-routing` guard now prevents a new locally-implemented once-per-turn/round/combat ledger. Remaining: a census of actor-level once-per-round/turn trigger marks must prove each is U10/mark de-dup or content-owned state, not a second usage ledger. |
| U17 Ordering/Arbitration | `primitives/ordering.ts` | **AUTHORITATIVE** (re-audited) | Mehcanically meaningful simultaneous ordering routes through U17 policies or proven-disjoint authorities; recorded same-owner ordering is consumed from durable `resolvedOrder` ranks, never array/registration order; turn-boundary consumers landed (T6.3); the lifecycle registration-order / expiry listing-order duplicate authorities are gone. Re-audited — retained. |

## 2. Consumer census (every known consumer classified; no unknown bucket)

### U16 — Usage / Entitlement
- **MIGRATED (this tranche):** `kernels/trait-reactions.ts` F9 once-per-round
  gate → `primitives/usage.ts` (`usageKey`, `ledgerAvailable`,
  `consumeUsageMutation`); the `kernels/use-ledger.ts` adapter already
  delegated to the U16 core (prior transches). The reducer/lifecycle reset
  recipes read through `use-ledger.ts` / U8 `usagePeriodForResetBoundary`.
- **RETAINED SPECIALISTS:** `attackedThisTurn` (U10 historical resolution
  fact, explicitly NOT the one-attack entitlement — the entitlement is
  `ledger:turn:core:attack-this-turn`); scheduler/clock fields
  (`turnTaken`, `turnsTakenThisRound`); Delay flags (`slow-turn`,
  `six-hells:slow-turn`).
- **UNRESOLVED DUPLICATE candidates (the residual that keeps U16 PARTIAL):**
  actor-level once-per-round/turn trigger/de-dup marks in `encounter.ts` —
  `chain-reaction-used`, `incubus:triggered`, `stampede:triggered`
  (round-boundary reset), `gates-of-hell:vigilance-rushed`, `damage-immune`
  (turn-boundary reset), and per-source `:used`/`:charged` flags. Each
  answers "has THIS trigger already happened within scope X" and must be
  classified as U10 fact-backed de-dup (distinct concern, preserved) or U16
  usage (migrate) before U16 can be re-certified AUTHORITATIVE. These do not
  reconstruct the canonical `ledger:*` key, so they are not the worst class,
  but they are not yet proven disjoint.

### U2 — Role / Perspective (verified, no unresolved duplicate found)
- **MIGRATED (T7, verified this pass):** `kernels/candidate.ts`
  (`relationPerspectiveIdFromContext` → U3 `matchesTargetRelation`);
  `kernels/aura.ts` (`perspectiveActorId`, ROLE ≠ ANCHOR); decision-window /
  `choiceEntitledPlayer` responders (`resolveRoleSelector`, fail closed).
- **RETAINED SPECIALISTS with documented disjoint contract:** `primitives/targeting.ts`
  `matchesTargetRelation` (parameterized U3 eligibility — takes the
  perspective actor as `source`, neither owns nor guesses whose side
  establishes the relation); the save-rolled window responder (U16 interrupt
  entitlement). Negative architecture fixture proves a locally re-derived
  relation/aura perspective fails.
- **UNRESOLVED DUPLICATE:** none found in the generic layer this pass.

### U13 / U17 (re-audited; consumers already classifiable)
- U13 **MIGRATED:** save/interrupt/choice/held/deferred decision points all
  compose through the ONE `DecisionWindowRecord`; no parallel window schema
  remains. U13 retained AUTHORITATIVE.
- U17 **MIGRATED:** source-order, interrupt LIFO, same-trigger turn-order,
  turn-boundary non-active-owner-first + hostile-before-beneficial, and the
  same-owner recorded ordering decision all route through `primitives/ordering.ts`;
  registry/discovery arrays are demoted to enumeration (mechanically
  irrelevant) and cross-owner/missing-owner ties FAIL CLOSED. U17 retained
  AUTHORITATIVE.

### U10 / U15 (demoted; census best-known-so-far)
- U10: fact consumers (trigger de-dup across routes, save/damage/defeat/collide
  outcomes) read the recorded `Fact`s; movement/save representability is the
  unproven seam → PARTIAL.
- U15: `transaction.ts` primitives + the declared atomic-group instantiations
  (cost-payment, `spatialBatchId`, `countMode:exact`,
  `requiresLegalSpatialBatch`) are claimed U15 consumers but must be proven to
  route through the single grouping/snapshot/atomicity authority → PARTIAL.

## 3. False closures found

The prior transches reported **U16 AUTHORITATIVE** (T6.4a/b) and credited
**U10 and U15** as single-authority/LANDED-TRUE. Under the strict invariant:

1. **U16 = PARTIAL (concrete false closure, repaired this tranche).**
   `kernels/trait-reactions.ts` independently implemented a once-per-round
   entitlement ledger: `roundLedgerKey` reconstructed `` `ledger:round:${id}` ``,
   `roundLedgerAvailable` read `!actor.ruleState[key]` directly, and the fold
   wrote its own `{kind:'state', operation:'set', value:true}` mark. It
   reconstructed key + availability + consume exactly as the U16 authority
   owns them — a competing executing implementation even though output bytes
   matched. This is the "use of the same storage shape/key + behavior-
   equivalent code" case the tranche explicitly warns is not authority.
2. **U10 = PARTIAL (conservative demotion).** The docs claimed LANDED/TRUE;
   the tranche flags movement as a likely weak point and the invariant
   requires positive proof that later rules can distinguish all source-required
   resolved outcomes in recorded facts. Not re-proven → not AUTHORITATIVE.
3. **U15 = PARTIAL (conservative demotion).** Prior TRUE assumed the
   instantiations route through `transaction.ts`; the invariant requires
   demonstrating no flow independently answers "which changes validate
   together before commit". Not exhaustively proven → not AUTHORITATIVE.

U13 and U17 survive re-audit (no competing executing authority found) and
remain AUTHORITATIVE.

## 4. Code changes (every semantic duplicate migrated)

**`src/rules/automation/kernels/trait-reactions.ts`** — migrated the F9
once-per-round gate off its bespoke ledger onto the U16 core with no
behavioral change (behavior-preserving migration per tranche requirement 4):

- `roundLedgerKey` now returns `usageKey({ sourceId, ownerId: '', scope:
  'round' })` — byte-identical to the long-standing `ledger:round:<id>`,
  delegated to the U16 key authority (the owning authority for the STORAGE
  key format), instead of a local `` `ledger:round:${id}` `` template.
- `roundLedgerAvailable` now delegates to U16 `ledgerAvailable` (recorded
  count < one-shot cap) — availability is owned by U16, never a direct
  `ruleState[key]` read.
- The once-per-round consume now emits U16 `consumeUsageMutation` (one-shot
  `set true`), producing the identical durable mark while routing through the
  U16 consume surface.

Owning authority used: **U16 `primitives/usage.ts`** (`usageKey`,
`ledgerAvailable`, `consumeUsageMutation`).

## 5. Architecture protections (each names the exact regression it catches)

Added in `scripts/audit-architecture-core.ts`:

- **Check 7 `u16-usage-ledger-routing` (key reconstruction).** For every
  primitives/kernels file EXCEPT the two U16 authority files
  (`primitives/usage.ts`, `kernels/use-ledger.ts`), a template literal
  `ledger:${…}` (generic-key form) or `ledger:turn:/round:/combat:/any-turn:${…}`
  (hard-coded-period form such as the exact duplicate removed) is a violation.
  Catches: a new locally-implemented once-per-turn/round/combat ledger that
  rebuilds the canonical storage address instead of routing through U16 —
  the precise reintroduction of the `trait-reactions` pattern.
- **Check 8 `u16-usage-ledger-routing` (migrated-consumer symbol pin).**
  `kernels/trait-reactions.ts` must retain `usageKey`, `ledgerAvailable`, and
  `consumeUsageMutation`. Catches: the F9 fold dropping its U16 imports to
  re-derive availability/consume locally.

Each is a semantic-routing guard (owned-symbol allowlist + canonical-key
reconstruction), not a vocabulary/comment/prefix string search. Added negative
fixtures prove each guard fires on a standalone reconstruction and that the
two authority files are not flagged (no false positive).

Also verified: the existing **U2 `u2-perspective-authority`** guard (drop a
migrated consumer's U2 symbol, or aura re-deriving ally/foe from
`origin.side` / `.side ?? null`) still fires; the **`bespoke-u16-entitlement-field`**
guard still forbids actor fields that reintroduce usage entitlement.

## 6. Tests added (adversarial + replay)

`src/rules/__tests__/trait-reactions.test.ts`:
- once-per-round reactive fire still exact-once (existing, still green);
- round-boundary reset still correct (existing, still green);
- **adversarial two-owner isolation:** two heroes equipping the SAME trait
  reaction never alias the once-per-round gate (A's use does not consume B's
  independent U16 round mark);
- **adversarial key identity:** the once-per-round mark is byte-identical to
  `usageKey({scope:'round'})` (`roundLedgerKey` == `usageRoundKey`), proving
  the fold routes through the U16 key authority.
- replay exactness (existing, still green).

`src/rules/__tests__/architecture-audit.test.ts`:
- negative fixtures: a kernel reconstructing `` `ledger:round:${id}` `` is
  flagged; a primitives file reconstructing `` `ledger:${scope}:${id}` `` is
  flagged; a `trait-reactions.ts` that rebuilt locally and dropped the U16
  symbols is flagged;
- the two U16 authority files are NOT flagged for key construction (no false
  positive);
- real-codebase regression: only the two authority files construct the
  canonical `ledger:` key; the F9 fold retains its U16 symbols.

## 7. Gate state

**UNDERLAY PHASE gate: OPEN.**

The gate is OPEN because several U1–U17 contracts remain PARTIAL (U1, U3, U4,
U5, U6, U7, U8, U9, U10, U11, U12, U14, U15, U16). AUTHORITATIVE rows are
U2, U13, U17. OPEN is not inferred from the number of passing tests — it is a
direct consequence of the corrected matrix: multiple underlays have an
outstanding consumer migration or unproven-complete vocabulary.

This repair tranche does NOT declare the phase closed; its purpose is to make
"AUTHORITATIVE" mechanically enforceable (one executing authority, zero known
duplicates, guards that catch recurrence) and to remove the false closures.

## 8. Source census

**Zero** previously unresolved ICON source units were promoted, newly wired,
or reclassified in this tranche. `npm run audit:class-job-census`
regenerated byte-stable (`docs/blocker-census.json` unchanged at 427); only 4
source files changed (2 audit/kernel + 2 tests), all generic substrate. The
unresolved executable-content count is unchanged.

## 9. Next blocker (smallest coherent next tranche, from corrected evidence)

The next tranche should be chosen from the post-repair matrix, not stale
ordering. The smallest coherent next completion, by dependency and evidence, is:

**U16 — finish the usage/entitlement closure.** (a) Complete the census of
the remaining actor-level once-per-round/turn trigger marks
(`chain-reaction-used`, `incubus:triggered`, `stampede:triggered`,
`gates-of-hell:vigilance-rushed`, `damage-immune`, per-source `:used`/`:charged`)
— classify each as U10 fact-backed de-dup (retained, documented) or migrate to
a typed U16 `ledger:*` entry; (b) if a mark is genuinely once-per-round/turn
usage entitlement, migrate it and extend the guard/tests; (c) re-audit that
U16 has zero unresolved duplicates. U16 is a natural next step because this
tranche already established its single canonical-ledger authority and guard.

Alternatives with equal standing (do not run together): U10 fact-vocabulary
completeness for movement/save distinctions, or U15 proving every atomic-group
route goes through `transaction.ts`.

---

*This document is current-state and intentionally does not claim closure.*