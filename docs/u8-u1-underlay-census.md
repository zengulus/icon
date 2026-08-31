# U8 Closure and Fresh U1–U17 Residual Census (2026-09-01)

This is the evidence record for the post-U8 underlay decision. It changes no
source-unit executable status and does not replace the contracts in
`underlay-completion-plan.md`.

## U8 result

The residual audit found one competing temporal interpreter: combat cleanup
in `encounter.ts` kept only records whose duration discriminant was
`expedition`, instead of asking U8 whether the duration crosses combat end.
That path now calls `durationSurvivesCombatEnd`, which composes
`scopeForDuration` with the combat-end boundary. Ordinary duration expiry
continues to route through `clockForTiming` and `boundaryEquals`.

The scheduler's turn/round election and the reducer's remaining-occurrence
counters are retained specialists: they record cadence/state but do not
interpret Scope. Lifecycle and continuation consumers already route their
boundary questions through U8. `settlement.test.ts` proves combat-scoped
conditions/effects expire, expedition-scoped records survive, command input
is not mutated, and event replay reproduces the cleanup. The
`u8-scope-clock-routing` guard mutation-tests both U8 call paths.

Verdict: U8 meets its declared single-authority and replay contract.

## Fresh underlay matrix

| Underlay | State after audit | Smallest known residual |
| --- | --- | --- |
| U1 Reference / Binding | PARTIAL | named content resolvers still interpret implicit slots/input identities |
| U2 Role / Perspective | AUTHORITATIVE | none |
| U3 Query / Candidate | PARTIAL | area/persistent-instance/rule-source domains and residual ordering |
| U4 Choice / Decision | PARTIAL | ability/talent choice fold reads and remaining window-carried choice consumers |
| U5 Value / Expression | PARTIAL | inline resolver arithmetic and missing typed value families |
| U6 Predicate / Condition | PARTIAL | range/area gate-body consumer folding |
| U7 Anchor / Spatial Frame | PARTIAL | remaining aura/creation/rebound-origin consumers |
| U8 Scope / Clock | AUTHORITATIVE | none |
| U9 Provenance / Cause | PARTIAL | legacy trigger/damage/movement provenance reconstruction |
| U10 Fact / Outcome | PARTIAL | movement/save distinction proof remains incomplete |
| U11 Flow / Sequence | PARTIAL | hand-sequenced named resolver bodies |
| U12 Continuation / Suspension | PARTIAL | remaining resolver-delayed/save-window consumers |
| U13 Window / Decision Point | AUTHORITATIVE | none |
| U14 Modifier / Policy | PARTIAL | untyped `RuleModifier` stat-bag consumers |
| U15 Transaction / Atomic Commit | PARTIAL | exhaustive atomic-group routing proof remains incomplete |
| U16 Usage / Entitlement | COMPLETE/AUTHORITATIVE | none after Monogatari lifecycle integration |
| U17 Ordering / Arbitration | COMPLETE/AUTHORITATIVE | none |

Five underlays meet the strict authority bar; twelve remain partial. U1 is
the dependency root: it has no underlay dependency and is consumed by U3,
U5, U6, U7, U9, U10, U12, U14, and U16. It is therefore the selected next
tranche, ahead of leaf work.

## U1 tranche executed

`reference.ts` now owns the reference-shaped `RuleSelector` adapter:

- source/attack/trigger/bound selectors become LIVE U1 references;
- recorded actor input becomes an ordered collection of CAPTURED actor
  references;
- query-shaped selectors reject instead of being misrepresented as refs.

The generic candidate/anchor, selector/value, query, flow outcome and target
position, core/foe recipe, attack-provenance, and damage-recipient paths now
route through U1. The `u1-reference-routing` guard rejects restored raw slot,
implicit-source, or actor-input reference resolution in generic code; U2 role
projection and U4 choice validation are explicit disjoint boundaries.

U1 remains PARTIAL. A conservative lexical residual scan currently finds 314
direct-reference signals across 18 named content-resolver files. That number
is a migration inventory, not a semantic coverage count: many occurrences are
repeated source/provenance reads, and each resolver still requires parity
testing. The next smallest safe slice is one shared content-authoring adapter
over U1 followed by behavior-preserving migration and a fresh residual scan.

## Coverage and verification invariants

- Canonical Class/Job census: 427 unresolved (6 class-trait, 38 job-trait,
  238 talent, 129 mastery, 16 limit-break), unchanged.
- Automation audit: 3,275 programs / 4,701 clauses; 467 complete programs /
  1,604 complete clauses; 3,097 clauses remain explicitly unsupported.
- No source unit was promoted or reclassified by either tranche.
