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

> **Census-integrity repair (2026-09-01).** The counts in this section are
> now MACHINE-DERIVED from a site-level inventory
> (`scripts/u1-residual-inventory.ts`, audited by `scripts/audit-u1-residual.ts`
> + `audit:u1-residual` and the architecture-audit suite). No figure below is
> hand-maintained. The exact mutually exclusive counts at the prior commits:
>
> | Commit | Total | PURE_LIVE_REFERENCE | CAPTURED_ID_DEREFERENCE | DERIVED_OR_PRECEDENCE_BOUNDARY |
> | --- | --- | --- | --- | --- |
> | `ea9526c` (pre-Sealer) | 242 | 187 | 54 | 1 |
> | `5f0de05` (post-Sealer) | 229 | 174 | 54 | 1 |
> | current HEAD (post-Enochian) | 211 | 156 | 54 | 1 |
>
> The Sealer tranche removed exactly **13 PURE_LIVE_REFERENCE sites**
> (Sealer: 17 → 4 PURE; CAPTURED and BOUNDARY unchanged: 54, 1), so
> 242 − 13 = 229. The earlier prose figures (`242 = 188 + 55`;
> `230 = 175 + 55`) were each wrong by one in BOTH buckets for the SAME
> reason: a hand scan classified the single Harvester site
> `sourceActor(context, context.input.actorIds.target[0])` (an in-call
> captured-identity read wrapped in a `?` precedence chain) as BOTH a pure
> live-slot read (its argument starts with `context.`) and a
> captured/derived read (its argument names recorded input). It is machine-
> classified as exactly ONE boundary site, and the totals were accurate in
> the inventory sense all along. `242 = 187 + 54 + 1` was internally
> consistent; `188 + 55 = 243 ≠ 242` was the misclassification surfacing
> through two hand-maintained buckets.
>
A machine scan at this HEAD finds 211 `sourceActor(context, …)` call
sites across 14 named program files (multi-line calls collapse to one site;
`npm run audit:u1-residual` reproduces these figures). Classified by
MUTUALLY EXCLUSIVE semantic category (each site carries a machine-derived
provenance string):

- **U1 reference identity — pure LIVE-slot reads (156, migrate family-by-
  family next)**: `sourceActor(context, context.actorId)` (the ability user)
  and `sourceActor(context, context.attackTargetId)` (the primary attack
  target) — the unambiguous U1 reference reads, exactly the family Shade/
  Warden/Sealer/Enochian migrated across tranches 2–4. Remaining per-file:
  Chanter 19, Knave 17, Demon Slayer 16, Harvester 15, Seer 15, Fool 15,
  Geomancer 14, Freelancer 14, Stormbender 11, Colossus 11, Sealer 4 (chain
  sites' source reads — see boundary), Shade 3, Warden 2. Enochian 0 (this
  tranche).
- **U1×U4 boundary — captured/derived-id dereferences (54 + 1, one semantic
  decision each)**: `sourceActor(context, <var>)` where `<var>` came from an
  earlier caller-owned SELECT (`input.actorIds?.[n]`, a `??`/`?.` chain, a
  loop-index element like `allyIds[i]`, or a passed-in parameter); plus the 1
  in-call captured-identity read (Harvester line 155) — the precedence
  question is a per-call-site source-contract decision, inventoried, never
  migrated. The caller's `?.[0]`/`?.[1]`/`slice` SELECT stays U4
  cardinality (the adapter deliberately has no first-element collapse).
- **U9 provenance / plumbing (never migrate)**: `sourceActorId:` on emitted
  mutations, `actorId: context.actorId` commands, and `context.attackTargetId
  ?` gate tests remain at their sites.

## U1 tranche executed (fresh HEAD, 2026-09-01, third tranche — Sealer)

### Census-integrity repair (one source of truth)

The residual census now lives in ONE machine-derived inventory
(`scripts/u1-residual-inventory.ts` → `scripts/audit-u1-residual.ts`): every
`sourceActor(` site records file/line/shape/category/provenance, and total +
per-category + per-file counts are computed from that list. The executable
invariant `total === sum(mutually exclusive categories)` is enforced by
`npm run audit:u1-residual` and by the architecture-audit suite
(`U1 residual census (machine inventory)` — incl. the exact repo pin at
that HEAD, 229 = 174 + 54 + 1, since updated to the fresh machine figures
after each tranche, and classifier mutations proving the Harvester in-call
read is ONE boundary site). Docs must be regenerated from this inventory;
prose totals that disagree with the machine are stale by construction.

### Wording precision

Migrated-tranche descriptions say valid/reachable-state semantics are
preserved byte-for-byte, and MALFORMED/unrepresentable references now fail
closed (`reference.missing-actor`) where legacy code could silently
no-op/fall through — they never claim malformed-state behavior is
byte-identical.

### Migrated: Sealer pure LIVE-slot reference reads

`content/jobs/programs/sealer-programs.ts` routes every pure live-slot
reference through the content-authoring adapter:

- source reads → `resolveSourceActor(context)` in God Hand, Devil Hand,
  Matsuri, Spirit Shrine, Justice, JUDGEMENT, Open The Gates, and Center The
  Temple;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(…attackTargetId) : undefined`) → `resolveAttackTarget(context)`
  in God Hand, Devil Hand, Matsuri, Open The Gates, and Center The Temple.

Semantics preserved exactly: LIVE re-read of current state, absent-singular→
undefined, and the resolvers' own `if (!source.position || !target?.position)
return []` early-return guards are untouched (they gate on board state, not
reference identity). Grand Seal, Sanctify, Grand Banishment, and Divine Aegis
KEEP their `input.actorIds?.target?.[0] ?? attackTargetId` chains — caller-own-
ed U4 precedence (which slot answers depends on the source contract per call
site), inventoried with the U1×U4 boundary; only their non-chain sibling
resolvers migrated in this tranche.

### Guard

The `u1-reference-routing` guard pins Sealer (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained chain dereferences are NOT
banned. Mutation tests: a Sealer revert to
`sourceActor(context, context.actorId)` drops the pinned calls and is
caught, and the chain-shape fixture is accepted as the inventoried boundary.

### Evidence

- `reference-authoring.test.ts` +2: God Hand and Open The Gates resolvers
  fail closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId`; a Grand Seal chain site with a present input target but
  absent fallback still resolves through the caller-owned precedence (chain
  semantics untouched).
- `sealer.test.ts` (19 tests) green through the engine path — behavior-
  preserving migration proof.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, second tranche)

### Migrated: Shade + Warden pure LIVE-slot reference reads

`content/jobs/programs/shade-programs.ts` and `content/jobs/programs/
warden-programs.ts` now route every pure live-slot reference through the
content-authoring adapter:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 12 executable Shade resolvers and all 9
  Warden resolvers;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Umbra, Umbra Combo, Death Blossom, Death
  Blossom Combo, Incubus (Shade) and Apex, Circle The Oak, Sidhe (Warden);
- Nocturne's trigger-source position read (`context.triggerSourceId ?
  sourceActor(…).position : undefined`) → `resolveTriggerSource(context)?.position`
  (the `<area-center> ?? trigger ?? source` fallback chain stays caller-owned
  U7/U11 — only the trigger-source REFERENCE itself migrated).

Semantics preserved exactly: LIVE re-read of current state, absent-singular→
undefined, gates stay at the callers. Remaining in Shade (7) and Warden (5)
are only the captured-input dereferences (`input.actorIds?.[n]` →
`sourceActor`) — the inventoried U1×U4 boundary, untouched.

### Guard

The `u1-reference-routing` guard pins Shade (resolveSourceActor,
resolveAttackTarget, resolveTriggerSource) and Warden (resolveSourceActor,
resolveAttackTarget) to the adapter — a revert to
`sourceActor(context, context.actorId)` drops the pinned calls and is
caught; the retained captured-input dereferences are NOT banned (the guard
has no blanket lexical ban).

### Evidence

- `reference-authoring.test.ts` +7: production Shade/Warden resolvers fail
  closed (`reference.missing-actor`) on a gated-bypass context — a ghost
  `attackTargetId` (Umbra, Sidhe) or `triggerSourceId` (Nocturne, which must
  not degenerate into the user's own position) rejects instead of the legacy
  silent no-op;
- `shade.test.ts` / `warden.test.ts` +2: ghost attack targets are rejected at
  the command boundary (`attack.invalid-target` / `ability.invalid-target`)
  before any effect, and Umbra resolves byte-identically across two fresh
  commands on identical recorded state (`b.events` deep-equals `a.events`,
  `applyEvents` reproduces both) — decisions/RNG recorded once, never
  re-decided;
- the full Shade (19) and Warden (17) suites stay green through the engine
  path, proving the migration is behavior-preserving.

No direct `state.actors[context.…]` dereference remains anywhere in content.

The `u1-reference-routing` architecture guard now scans the content layer: it
requires the adapter to keep composing the U1 vocabulary, pins every MIGRATED
program to its adapter accessors (a revert to legacy slot resolution drops the
calls and is caught), and rejects any new direct `state.actors[context.…]`
dereference. It deliberately does not ban the inventoried
`sourceActor(context, …)` residual (that would force a blind mechanical
rewrite), `context.input.actorIds` reads (U4 identity lives at the caller) or
provenance `context.actorId` (never reference interpretation).

## U1 tranche executed (fresh HEAD, 2026-09-01, fourth tranche — Enochian)

### Migrated: Enochian pure LIVE-slot reference reads

`content/jobs/programs/enochian-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **18 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Enochian: 18 → 0 PURE;
CAPTURED and BOUNDARY unchanged: 54, 1; whole-repo 229 → 211 = 156 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 13 Enochian resolvers that reach the
  source: Pyre, PYROTIC, Elden Rune, Lance, VOLVAGA, Soul Burn, INCANDIUS,
  Blazing Bond, Heartfire, Aethershard, Implode, Pyroclast, Blackstar;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Pyre, PYROTIC, Lance, VOLVAGA, and
  Blackstar — identical LIVE re-read and absent-singular→undefined
  semantics.

**Deliberately NOT migrated (per-call-site U1×U4 boundary, inventoried):**
Blazing Bond's `allyId = context.input.actorIds?.target?.[0] ??
context.attackTargetId`, Heartfire's `partnerId = …??
context.triggerTargetIds?.[0]`, Implode's `targetId = … ?? attackTargetId`,
and Pyroclast's `targetId = … ?? attackTargetId ?? source.id` — the
`?.[0]` / `??`-precedence SELECT is caller-owned U4 choice/cardinality, and
only the dereference of the chosen identity is the U1 captured-identity
shape (the next tranche family). `sourceActor(context, …)` remains imported
for those four sites; the resolvers' own range/board-state gates
(`choice.actor-count`, `choice.actor-range`, `!source.position`) are
untouched.

### Guard

The `u1-reference-routing` guard pins Enochian (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained captured-input
dereferences are NOT banned (no blanket lexical ban). Mutation test: an
Enochian revert to `sourceActor(context, context.actorId)` drops the pinned
calls, is caught with exactly one Enochian routing problem, and the retained
`??`-chain `sourceActor(context, allyId)` reads alone do NOT trigger the pin.

### Evidence

- `reference-authoring.test.ts` +2: the production Enochian Pyre resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId` (legacy silently no-opped), and the Pyroclast resolver
  keeps the caller-owned `input.actorIds?.target?.[0]` precedence — a present
  input target wins over the `attackTargetId` fallback; the `??` chain is
  untouched by the migration.
- `enochian.test.ts` +1: reversing actor INSERTION order (second foe added
  before the target) produces byte-identical Pyre outcomes and replay — the
  migrated source/attack-target reads resolve by recorded slot identity,
  never object-iteration order.
- the full Enochian suite (17 tests) stays green through the engine path,
  proving the migration is behavior-preserving for valid/reachable state
  (applyEvents replay identical in every scenario).

## U1 status after the Enochian tranche

U1 remains PARTIAL: the shared surface is proved and pinned across eight
migrated files (Bastion, Spellblade, Shade, Warden, Sealer, Enochian,
Job-trait, Class resolvers), and the residual is a machine-derived classified
inventory — 156 pure LIVE-slot reads (next tranches) + 54 captured/derived
dereferences + 1 in-call boundary read = 211 sites, 0 direct dereferences. A
whole-consumer audit is NOT yet done, so U1 cannot claim AUTHORITATIVE: 10
program files still resolve live slots through the legacy kernel-side
convenience, and the U1×U4 captured-identity boundary has no shared surface
yet.

## Coverage and verification invariants

- Canonical Class/Job census: 427 unresolved (6 class-trait, 38 job-trait,
  238 talent, 129 mastery, 16 limit-break), unchanged.
- Automation audit: 3,275 programs / 4,701 clauses; 467 complete programs /
  1,604 complete clauses; 3,097 clauses remain explicitly unsupported.
- No source unit was promoted or reclassified by any tranche; U1 remains
  PARTIAL.
