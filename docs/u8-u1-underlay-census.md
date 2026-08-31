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

## U1 tranche executed (fresh HEAD, 2026-09-01)

### Shared content-authoring adapter

`content/glue/reference-authoring.ts` is the ONE content-facing U1 reference
surface. It is NOT a second reference system and NOT a syntax shortcut: every
accessor composes the single U1 vocabulary (`primitives/reference.ts`
constructors + `resolveReference`) and expresses REFERENCE INTENT. The whole
surface is six typed accessors — no generic `getActor(id)` convenience
(described in `docs/rules-foundations.md` § U1):

- `resolveSourceActor(context)` — LIVE source-actor reference (never a stale
  snapshot; malformed source rejects `reference.missing-actor`);
- `resolveAttackTarget(context)` — LIVE primary attack target, `undefined`
  for a legitimately absent singular slot, fail-closed `reference.*` when the
  slot names a missing actor;
- `resolveTriggerSource(context)` — LIVE trigger source with the same
  optional-singular/absent-vs-missing discipline;
- `resolveTriggerTargets(context)` — plural trigger targets as an ORDERED
  COLLECTION (never one arbitrary first element);
- `resolveCapturedSelectedActors(context, key)` — CAPTURED command-selected
  actor identities from the recorded `input.actorIds[key]`; replay applies
  the recorded choice and never re-derives it from later state (defeated
  captured actors stay resolvable as identity);
- `resolveBoundActor(context, name)` — a BOUND actor referent, DOMAIN-verified
  (a bound position cannot satisfy an actor reference).

Query-shaped selectors stay U3; choice cardinality (`[0]`, mins/maxes) stays
U4 at the caller; `context.actorId` as provenance (`sourceActorId:` on emitted
mutations), scheduling/ownership identity, and U4 choice-identity COMPARES
(IDs compared, never dereferenced) are NOT reference resolution and remain at
their sites.

### Migrated this tranche (behavior-preserving)

- `content/jobs/programs/{bastion,spellblade}-programs.ts` — the two named
  program families' source/attack/trigger/captured reads now route through the
  adapter.
- `content/jobs/job-trait-resolvers.ts` (Taunt, Klingenkunst) and
  `content/classes/class-resolvers.ts` (Prowl, Diaga, Bless) — the six direct
  `state.actors[context.…]` dereferences are gone; the resolvers' defensive
  gates (`choice.actor-count` / `choice.actor-mismatch` / `ability.range` /
  `actor.position`) stay caller-owned, and the adapter fail-closes
  (`reference.missing-actor`) where the legacy code threw a bespoke
  `selector.actor-missing`. Prowl's silent `if (!source) return []` skip is
  strictly stricter now (fail closed).

### Fresh residual inventory (semantic classification, not a ban list)

A fresh scan at this HEAD finds ~120 remaining `sourceActor(context, …)`
calls across a dozen named program files (Shade, Knave, Geomancer, Enochian,
Warden, Seer, Stormbender, Demon Slayer, Chanter, Colossus, Harvester, Fool,
Sealer, Freelancer). Classified by semantic family:

- **U1 reference identity** (migrate next): the `sourceActor(context,
  context.<slot>)` live-slot re-reads (≈60) and the `context.input.actorIds`
  captured reads that are dereferenced into actors (Shade first/second,
  Warden pair, Chanter chosen list, etc.).
- **U4 choice-cardinality (retained, caller-owned)**: the `?.[0]`/`?.[1]`
  single-selection and `.slice(1)` shapes that SELECT the recorded choice —
  the adapter deliberately has no first-element collapse; these narrow to an
  element and then feed a U1 captured/selected read.
- **U1×U4 boundary (one semantic decision each, family-by-family)**:
  `target[0] ?? context.attackTargetId` / `?? context.triggerTargetIds?.[0]`
  priority chains (Geomancer, Enochian, Seer, Stormbender, Sealer, Freelancer,
  Harvester, Knave) — which slot answers depends on the source contract at
  each call site; migrated with its parity test, not mechanically.
- **U9 provenance / plumbing (never migrate)**: `sourceActorId:` on emitted
  mutations, `actorId: context.actorId` commands, and `context.attackTargetId
  ?` gate tests remain at their sites.

No direct `state.actors[context.…]` dereference remains anywhere in content.

The `u1-reference-routing` architecture guard now scans the content layer: it
requires the adapter to keep composing the U1 vocabulary, pins every MIGRATED
program to its adapter accessors (a revert to legacy slot resolution drops the
calls and is caught), and rejects any new direct `state.actors[context.…]`
dereference. It deliberately does not ban the inventoried
`sourceActor(context, …)` residual (that would force a blind mechanical
rewrite), `context.input.actorIds` reads (U4 identity lives at the caller) or
provenance `context.actorId` (never reference interpretation).

U1 remains PARTIAL: the shared surface is proved and pinned, and the
residual is now a classified migration inventory instead of an unexamined
lexical count.

## Coverage and verification invariants

- Canonical Class/Job census: 427 unresolved (6 class-trait, 38 job-trait,
  238 talent, 129 mastery, 16 limit-break), unchanged.
- Automation audit: 3,275 programs / 4,701 clauses; 467 complete programs /
  1,604 complete clauses; 3,097 clauses remain explicitly unsupported.
- No source unit was promoted or reclassified by either tranche.
