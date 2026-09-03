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
| U1 Reference / Binding | AUTHORITATIVE (declared scope: content reference interpretation) | 8 machine-pinned NON-reference algorithm/helper derefs (4 program + 4 fold) stay caller-owned by design — never references, so not inside the declared scope |
| U2 Role / Perspective | AUTHORITATIVE | none |
| U3 Query / Candidate | AUTHORITATIVE (tranche 25 decision) | none in scope — the six defeated-divergent VM effect scans now route through the shared query authority (tranche 25); AREA / PERSISTENT-INSTANCE / RULE-SOURCE query domains and ordering beyond the min-distance set + opt-in cell order are explicitly later-underlay (U10/U12/U16/U17) or source-gated; rushTowardFoes' direction fallback remains the flagged player-choice (U4) approximation, and the Demon Claw / God Hand self-or-ally picks are recorded-choice or fail-closed (U4/resolver), never U3-invented |
| U4 Choice / Decision | PARTIAL | (tranches 26-28, 30) Demon Claw per-step may-damage, God Hand self-or-ally, Heracule second-foe, and Holy cure + Charge all repaired as required recorded choices over the p.92 CHARACTER umbrella's ACTOR slice (self/ally/foe — no side filter; tranche 30 restored tranche 28's foe-inclusive semantics after tranche 29's friendly-only reversal failed the formal-keyword test: p.92 defines Foe inside Characters, no passage restricts cures to friendly characters, Esper III p.249 is the foe-MODE definition (fray instead of the normal cure) on an already-legal category while Mercy I's defeated grant is outside all keywords, and the "beneficial-effects-are-friendly" principle has no written home — so the attacked foe is always eligible and a missing cure recording never passes vacuous; tranche 31 corrected the claim surface: the Summon member of the umbrella is an engine-wide unreachable — ICON summons are characters (p.146) that p.95's "abilities that specify summons or characters can target or count them normally" makes targetable by character-specifying effects, but no executable summon is an actor (content creates entity-only summons; the U3 entity→actor summon bridge has no production user) — and self-inclusion rests on the p.92 Self bullet's "unless specified" (open reading; tests encode inclusion)); remaining: the placement family silently defaults the source's WHERE choice (Party Favor, Mist Strider + charge cloud, Underway portal-1 [portal-2 is an end-of-turn window], Spirit Shrine — mislabeled "Grand Seal shrine" in earlier rows, Geyser, Waterspout, Dervish placement, Dark Sliver soul-space + slay plant, Strongarm talent-1 "into adjacency" + its clockwise default, Chaos Tarot effect-3 terrain + effects 4/5 up-to-two + effect-6 "choose two" auto-applied 1+3, seer:astra terrain/meteor cells, chanter:symphony mote cells — per the p.95 "free space" + Harvester "any free space" placement conventions, each a per-unit recorded-position obligation, split across the resolver-level seam and the intent-declaration summon seam), the actor multi-selects (Dervish ally, Chaos Tarot effects 4/5 "up to two"), Demon Claw Talent I/II (documented-unresolved), plus the declared abilityUseChoices/talentChoices fold reads and window-carried choice consumers (U12/U13) |
| U5 Value / Expression | PARTIAL | U5-core dependency gate for U3 MET (tranches 22-23: the SINGLE percentOfMaximum scalar now feeds percent-base-max, the U6 bloodied/quarter predicates, and the Rot 25% read — all against the BASE maximum per adjudication icon-1.5:combat:bloodied-base-max; the tranche-22 wounds-adjusted percent-max-hp kind was RETRACTED as source-unsupported; no duplicate VM-side scalar formula remains); full authority still needs traversed/elevation/area-size/usage/non-numeric typed families + the residual content inline-arithmetic sites |
| U6 Predicate / Condition | PARTIAL | range/area gate-body consumer folding |
| U7 Anchor / Spatial Frame | AUTHORITATIVE (tranche 21 decision) | none in scope — specialist carriers (aura origin records, creationSpatial, RuleArea.origin, rebound provenance) store already-resolved frames with written non-competing boundaries; only the teleport mover footprint seam had a real gap, repaired fail-closed in tranches 20-21 |
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

Seven underlays meet the strict authority bar (U1 since the eighteenth
tranche; U7 since the twenty-first, 2026-09-02); ten remain partial. U1 is
the dependency root: it
has no underlay dependency and is consumed by U3, U5, U6, U7, U9, U10,
U12, U14, and U16 — which is why it stayed the selected next tranche until
its declared-scope authority completed. With U1 and U2 authoritative, the
next dependency-complete underlay was U7 (Anchor/Spatial Frame depends only
on U1+U2; U3 additionally waits on U5-core); the nineteenth tranche
migrated U7's LIVE actor anchor identity onto the typed U1 vocabulary, and
the twenty-first tranche closed the teleport mover footprint seam and
completed the U7 authority decision.

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
> | `4a1ff76` (post-Enochian) | 211 | 156 | 54 | 1 |
> | `3052eee` (post-Chanter) | 192 | 137 | 54 | 1 |
> | `81573a8` (post-Knave) | 175 | 120 | 54 | 1 |
> | `b6764e8` (post-Harvester) | 160 | 105 | 54 | 1 |
> | `d4d4cd9` (post-Demon Slayer) | 144 | 89 | 54 | 1 |
> | `71aeb59` (post-Seer) | 129 | 74 | 54 | 1 |
> | `582876b` (post-Fool) | 114 | 59 | 54 | 1 |
> | `ca94409` (post-Freelancer) | 100 | 45 | 54 | 1 |
> | `fe152a2` (post-Geomancer) | 86 | 31 | 54 | 1 |
> | (post-Stormbender) | 75 | 20 | 54 | 1 |
> | (post-Sealer/Shade/Warden) | 66 | 11 | 54 | 1 |
> | current HEAD (post-Colossus) | 55 | 0 | 54 | 1 |
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
A machine scan at this HEAD finds 4 `sourceActor(context, …)` call
sites across 3 named program files (multi-line calls collapse to one site;
`npm run audit:u1-residual` reproduces these figures — and now VERIFIES this
prose against the machine inventory, so a stale total cannot silently
survive here again). Classified by
MUTUALLY EXCLUSIVE semantic category (each site carries a machine-derived
provenance string):

- **U1 reference identity — pure LIVE-slot reads (0 — fully migrated)**:
  `sourceActor(context, context.actorId)` (the ability user) and
  `sourceActor(context, context.attackTargetId)` (the primary attack
  target) — the unambiguous U1 reference reads, migrated family-by-family
  across tranches 2–15 (Shade, Warden, Sealer, Enochian, Chanter, Knave,
  Harvester, Demon Slayer, Seer, Fool, Freelancer, Geomancer, Stormbender,
  Colossus) plus the final Sealer/Shade/Warden residue. All named program
  families route their live slots through the shared content-authoring
  adapter; no PURE site remains.
- **U1×U4 captured-identity dereferences (0 — fully migrated by the
  sixteenth-tranche adjudication)**: every recorded-selection dereference
  (51 sites: pure recorded reads, `??`/`?.` precedence chains, and the
  in-call Harvester center read) now resolves through the shared
  `resolveCapturedSelectedActors` surface, with each live-slot chain side
  through `resolveAttackTarget` / `resolveTriggerSource` /
  `resolveTriggerTargets`. The caller's `?.[0]`/`?.[1]` SELECT and `??`
  precedence (which recorded slot answers) stays caller-owned U4
  cardinality — the adapter deliberately has no first-element collapse and
  performs no choice.
- **NON-U1 algorithm plumbing (4 — caller-owned, reclassified by LEXICAL
  SCOPE; NOT references)**: the remaining `sourceActor(context, <var>)`
  sites deref identities the caller algorithm itself produced — the shared
  movement/planning helpers' parameters (plannedFly / plannedRush,
  colossus / demon-slayer / knave) and one derived-loop variable over an
  algorithm-built set (knave). The machine classifier (2026-09-02 repair)
  reclassifies them ONLY by lexical scope: the identifier is a parameter of
  the LEXICALLY ENCLOSING function (call inside its body) or an unshadowed
  loop variable of a lexically containing `for (const X of …)` over a
  NON-recorded iterable — never whole-file name coincidence (an unrelated
  function's same-named parameter, an earlier unrelated loop, or a
  same-name recorded-selection local leaves a site CAPTURED). The four
  SITE IDENTITIES (file + exact call shape) are pinned by test. Inventoried
  but NOT a U1 gap.
- **U9 provenance / plumbing (never migrate)**: `sourceActorId:` on emitted
  mutations, `actorId: context.actorId` commands, and `context.attackTargetId
  ?` gate tests remain at their sites.
- **Fold-surface actor derefs (43 sites outside the program census — U1
  completion audit, 2026-09-02, MIGRATED 2026-09-02, eighteenth tranche)**: `scanActorDerefs`
  enumerated every `state.actors[…]` deref in `content/jobs` (recursive,
  AST-based): **25 fact-carried** (`mark.ownerId` ×12, `mote.ownerId` ×3,
  `entity.ownerId` ×3, `candidate.ownerId` ×2,
  `mutation.sourceActorId`/`actorId` ×2, `origin.actorId`, `mine.ownerId`),
  **5 recorded-forwarded** (`targetIds[0]` / `targetIds[0] ?? ''` in
  talent/bonus-damage callbacks), **13 forwarded-identifier** (fold-carried
  ability-user ids, U12 continuation-carried `ownerId`/`targetId`, the
  algorithm-combined area set, reactive collided id, an adjacency-helper
  param), and **0 legacy-slot**. 39 of the 43 migrated through the shared
  captured-actor ops after the lifecycle adjudication (strict vs weak); the
  remaining **4 raw derefs are machine-pinned, site-identity-pinned
  NON-reference algorithm/helper plumbing** (`closestFoesOf`/`adjacentFoes`
  helper params, the algorithm-combined `areaIds` loop, the F9-derived
  reactive `collidedId`) — outside the declared U1 scope. See the
  eighteenth-tranche section below.

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

## U1 tranche executed (fresh HEAD, 2026-09-01, fifth tranche — Chanter)

### Migrated: Chanter pure LIVE-slot reference reads

`content/jobs/programs/chanter-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **19 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Chanter: 19 → 0 PURE;
CAPTURED and BOUNDARY unchanged: 54, 1; whole-repo 211 → 192 =
137 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 14 Chanter resolvers that reach the
  source: Holy, HADES, Felicity, FLEET, Pandaemonium, PURGATORIO, Aria,
  Dervish, DAWN, Symphony, Gentleness, Monogatari, Chastise, CHARISM;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Holy, HADES, Pandaemonium, PURGATORIO,
  and Chastise — identical LIVE re-read and absent-singular→undefined
  semantics.

**Deliberately NOT migrated (per-call-site U1×U4 boundary, inventoried):**
Felicity's / FLEET's `allyId = context.input.actorIds?.target?.[0]`,
Dervish's `allyIds[i]` loop-index element, and CHARISM's `foeId =
context.input.actorIds?.target?.[0] ?? context.attackTargetId` — the
`?.[0]` / loop SELECT is caller-owned U4 choice/cardinality, and only the
dereference of the chosen identity is the U1 captured-identity shape (the
next tranche family). `sourceActor(context, …)` remains imported for those
four sites; the resolvers' own range/choice gates
(`choice.actor-count` / `choice.actor-range` / `if (!target) return`) are
untouched.

### Monogatari / U8 / U16 protection (the reason this family is a proof tranche)

The migrated reads are pure slot dereferences (ability user, primary attack
target) with no lifecycle content: Monogatari's lifecycle identity (owner ×
source × U8 instance), the per-song U16 ledger keys, recipient enumeration,
once-per-song consumption, tale replacement, and the deterministic
simultaneous-song enumeration all live in `lifecycle-recipes.ts` (U8/U16
domain, outside the scanned program surface) and were NOT touched. The
`monogatariEffects` resolver records only source-owned state
(`monogatari:active` / `tale` / `charge`) on the user; its migrated source
read is a pure slot dereference and its emitted mutations are shape-
identical (proven by the resolver-level test below). No U8/U16 contract or
lifecycle code changed.

### Guard

The `u1-reference-routing` guard pins Chanter (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained captured-input
dereferences are NOT banned (no blanket lexical ban). Mutation test: a
Chanter revert to `sourceActor(context, context.actorId)` drops the pinned
calls, is caught with exactly one Chanter routing problem, and the retained
`input.actorIds`-derived `sourceActor(context, allyId)` reads alone do NOT
trigger the pin.

### Evidence

- `reference-authoring.test.ts` +4: the production Chanter Chastise resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId`; Holy keeps absent-singular → undefined (optional
  singleton semantics, `if (!target) return` guard intact); Felicity's
  `input.actorIds?.target?.[0]` captured identity still marks the chosen
  ally (caller-owned U4); and Monogatari's resolver emits the three
  source-owned lifecycle state mutations with byte-identical shape.
- the Monogatari U8×U16 adversarial matrix (`monogatari-u8-u16.test.ts`,
  14 tests) passes unchanged through the engine path — two independent
  songs, one-song-only recipients, simultaneous consumes, replace-A-does-
  not-touch-B, identical-tale separation, reversed actor insertion order,
  and exact replay without re-deciding eligibility all still hold.
- the full Chanter suite (25 tests) stays green through the engine path
  (valid-state semantics preserved; applyEvents replay identical in every
  scenario).

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, sixth tranche — Knave)

### Migrated: Knave pure LIVE-slot reference reads

`content/jobs/programs/knave-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **17 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Knave: 17 → 0 PURE; CAPTURED and
BOUNDARY unchanged: 54, 1; whole-repo 192 → 175 = 120 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 13 Knave resolvers that reach the
  source: Low Blow, The Hook, Provoke, Revenge, Indignation, Riposte,
  Dire Parry, Dark Knight, Strongarm, Intimidate, Sucker Punch, Bleak
  Mercy, Sweet Torment;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Low Blow, The Hook, Indignation, and
  Bleak Mercy — identical LIVE re-read and absent-singular→undefined
  semantics.

**Deliberately NOT migrated (per-call-site U1×U4 / caller-owned boundary,
inventoried — 6 CAPTURED sites):**

- `plannedRush(context, actorId)`'s internal `sourceActor(context, actorId)`
  — `actorId` is a HELPER PARAMETER, not the ability user's source slot;
  it is machine-classified CAPTURED and stays (no arbitrary-id adapter
  operation was invented for it);
- Dire Parry's `foeId = context.triggerSourceId ??
  context.input.actorIds?.target?.[0]` — the trigger-source/recorded-input
  precedence is meaningful caller-owned contract; only the source-actor read
  migrated;
- Strongarm's `targetId = context.input.actorIds?.target?.[0]` (chosen
  target) and its `passedId` loop dereference — recorded-input U4 choice;
- Intimidate's and Sucker Punch's `targetId = input.actorIds?.target?.[0]`
  — recorded-input U4 choice.

Dark Knight's nearest-foe read is U3 query + U4 player-choice semantics
(p.143 "If multiple foes are equidistant, you may choose") and was NOT
touched: a UNIQUE closest foe applies hatred; equidistant closest foes still
fail closed (`choice.direction-ambiguous`) with no invented id tie-break and
no object-iteration ordering.

### Guard

The `u1-reference-routing` guard pins Knave (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained captured/precedence
dereferences (plannedRush's parameter, Dire Parry's chain, Strongarm /
Intimidate / Sucker Punch input targets, passed-id loop) are NOT banned (no
blanket lexical ban). Mutation test: a Knave revert to
`sourceActor(context, context.actorId)` drops the pinned calls, is caught
with exactly one Knave routing problem, and the retained
captured/precedence reads alone do NOT trigger the pin.

### Evidence

- `reference-authoring.test.ts` +5: the production Knave Low Blow resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId` (legacy silently no-opped); Bleak Mercy keeps
  absent-singleton → no-op (optional semantics); Dark Knight still throws
  `choice.direction-ambiguous` with two equidistant foes (no tie-break
  acquired); Dire Parry's trigger-source ?? recorded-input precedence still
  resolves to the trigger source when present (caller-owned); Strongarm
  still spins the RECORDED input.actorIds target (caller-owned).
- `knave.test.ts` +1: reversing actor INSERTION order (second foe added
  before the target) produces byte-identical Low Blow outcomes and replay —
  the migrated source/attack-target reads resolve by recorded slot identity,
  never object-iteration order.
- the full Knave suite (23 tests) stays green through the engine path,
  including Dark Knight's retraction fixture, Strongarm's talent-1 gating
  matrix, and the Sucker Punch save-window suite — valid-state semantics
  preserved; replay byte-identical in every scenario.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, seventh tranche — Harvester)

### Migrated: Harvester pure LIVE-slot reference reads

`content/jobs/programs/harvester-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **15 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Harvester: 15 → 0 PURE; CAPTURED
54 and BOUNDARY 1 unchanged; whole-repo 175 → 160 = 105 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in Sow, REAP, Growing Season, Gravebirth,
  Harvest, Blood Grove, Rot, Crimson Bloom, Fairy Ring, Spirit Away, and
  Dark Sliver (11; Sow's inline `.fray` read included);
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Sow, REAP, Harvest, and Dark Sliver
  (4) — identical LIVE re-read and absent-singular→undefined semantics.

**Deliberately NOT migrated (inventoried):** the four `??`-chain captured
sites — Growing Season / Rot / Crimson Bloom `targetId =
input.actorIds?.target?.[0] ?? attackTargetId` and Spirit Away `foeId =
triggerTargetIds?.[0] ?? input.actorIds?.target?.[0]` — stay caller-owned
U4 precedence. `sourceActor(context, …)` remains imported for them.

### The protected DERIVED_OR_PRECEDENCE_BOUNDARY (NOT resolved this tranche)

Blood Grove's center read — `context.input.actorIds?.target?.[0] ?
sourceActor(context, context.input.actorIds.target[0])?.position :
undefined` — is the repo's ONE machine-classified
DERIVED_OR_PRECEDENCE_BOUNDARY. Its identity-selection provenance is an
in-call recorded-input read (the higher-priority identity is the
player-selected `input.actorIds.target[0]`; the fallback is the source's
own position, used only when the input identity is absent). The tranche
PRESERVES this expression exactly — the selection and dereference behavior
is unchanged, the classifier still reports it as ONE boundary, and no
precedence decision moved into U1. Resolving it (a per-call-site source
contract question) is a future tranche, not this one.

### Guard

The `u1-reference-routing` guard pins Harvester (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained boundary and `??`-chain
captured dereferences are NOT banned (no blanket lexical ban). Mutation
tests: a Harvester revert to `sourceActor(context, context.actorId)` drops
the pinned calls and is caught with exactly one Harvester routing problem;
and the protected boundary BY ITSELF (with the pins held) produces zero
Harvester routing problems — the guard cannot force a lexical rewrite of
an inventoried boundary.

### Evidence

- `reference-authoring.test.ts` +3: the production Harvester Sow resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId` (legacy silently no-opped); REAP keeps absent-singleton
  → no-op (optional semantics); and the Blood Grove boundary resolver
  proves BOTH precedence branches — the input-selected center wins when
  present (undergrowth grows around the chosen foe) and the source position
  is the fallback only when the input identity is absent (undergrowth grows
  around the user).
- `harvester.test.ts` +1: reversing actor INSERTION order (second foe added
  before the target) produces byte-identical Sow outcomes and replay — the
  migrated source/attack-target reads resolve by recorded slot identity,
  never object-iteration order.
- the full Harvester suite (32 tests) stays green through the engine path —
  valid-state semantics preserved; replay byte-identical in every scenario;
  the Rot projection/talent matrix and the Blood Grove boundary fixture
  unchanged.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, eighth tranche — Demon Slayer)

### Migrated: Demon Slayer pure LIVE-slot reference reads

`content/jobs/programs/demon-slayer-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **16 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Demon Slayer: 16 → 0 PURE;
CAPTURED 54 and BOUNDARY 1 unchanged; whole-repo 160 → 144 = 89 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 12 Demon Slayer resolvers that reach
  the source: Demon Cutter, Comet, Draken Cross, Righteous Disdain, Demon
  Claw, Gates of Hell, Vigilance Rush, Soul Blade enter/refresh/slash, Six
  Hells Trigram, Wicked Sheath;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Demon Cutter, Draken Cross, Soul Blade
  slash, and Wicked Sheath — identical LIVE re-read and
  absent-singular→undefined semantics.

**Deliberately NOT migrated (inventoried):** `plannedRush(context, actorId)`'s
internal `sourceActor(context, actorId)` — `actorId` is a helper PARAMETER,
not the ability-user source slot (machine-classified CAPTURED; no
arbitrary-id adapter operation invented); and Righteous Disdain's `allyId =
input.actorIds?.target?.[0]` — recorded player-choice U4 identity (the `[0]`
select and its dereference stay caller-owned). `sourceActor(context, …)`
remains imported for those two sites.

### Guard

The `u1-reference-routing` guard pins Demon Slayer (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained helper/captured sites are
NOT banned (no blanket lexical ban). Mutation test: a Demon Slayer revert to
`sourceActor(context, context.actorId)` drops the pinned calls, is caught
with exactly one Demon Slayer routing problem, and the retained
helper-parameter / recorded-ally dereferences alone do NOT trigger the pin.

### Evidence

- `reference-authoring.test.ts` +3: the production Demon Cutter resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId` (legacy silently no-opped); Comet keeps a genuinely
  targetless use as a no-op (optional singleton semantics); Righteous
  Disdain still splits damage to the RECORDED `input.actorIds` ally
  (caller-owned).
- `demon-slayer.test.ts` +1: reversing actor INSERTION order (second foe
  added before the target) produces byte-identical Demon Cutter outcomes
  and replay — the migrated source/attack-target reads resolve by recorded
  slot identity, never object-iteration order.
- the full Demon Slayer suite (24 tests) stays green through the engine
  path — the Demon Cutter talent-2 rush geometry, Draken Cross charged-blast
  matrix, Demon Claw BASE-max mastery, Gates of Hell U16 vigilance-rush
  ledger, and Soul Blade power-die lifecycle all unchanged.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, ninth tranche — Seer)

### Migrated: Seer pure LIVE-slot reference reads

`content/jobs/programs/seer-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **15 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Seer: 15 → 0 PURE; CAPTURED 54 and
BOUNDARY 1 unchanged; whole-repo 144 → 129 = 74 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 11 Seer resolvers that reach the
  source: Sleight Of Hand, Chaos Tarot, Astra, FORTUNA, Polaris, Sisyphus,
  Gran Reversa, Reverse Fate, Eclipse, Wish, The Tower;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Sleight Of Hand, Astra, FORTUNA, and
  The Tower — identical LIVE re-read and absent-singular→undefined
  semantics.

**Deliberately NOT migrated (inventoried):** Chaos Tarot, Polaris, Sisyphus,
and Eclipse keep their `targetId = input.actorIds?.target?.[0] ??
attackTargetId` SELECT chains, and Reverse Fate / Wish keep their `allyId =
input.actorIds?.target?.[0] ?? triggerTargetIds?.[0]` chains — the `??`
SELECT is caller-owned U4 precedence (which slot answers depends on the
source contract per call site); only the dereference of the chosen identity
is the captured-identity shape (next tranche family). `sourceActor(context,
…)` remains imported for those six sites.

### Guard

The `u1-reference-routing` guard pins Seer (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained captured/precedence sites
are NOT banned (no blanket lexical ban). Mutation test: a Seer revert to
`sourceActor(context, context.actorId)` drops the pinned calls, is caught
with exactly one Seer routing problem, and the retained captured
`input.actorIds ?? attackTargetId` / `?? triggerTargetIds` dereferences
alone do NOT trigger the pin.

### Evidence

- `reference-authoring.test.ts` +3: the production Sleight Of Hand resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId` (legacy silently no-opped); The Tower keeps a genuinely
  targetless use as a no-op (optional singleton semantics); Chaos Tarot's
  recorded `input.actorIds` center choice still wins over the attack target
  (caller-owned U4 precedence, source text p.201).
- `seer.test.ts` +1: reversing actor INSERTION order (second foe added
  before the target) produces byte-identical The Tower outcomes and replay
  — the migrated source/attack-target reads resolve by recorded slot
  identity, never object-iteration order.
- the full Seer suite stays green through the engine path — Chaos Tarot's
  TII-gated area movement, Astra's blessing-scaled gamble, Polaris /
  Sisyphus mark and terrain placement, Reverse Fate's power-die ticks, and
  the Wish damage window all unchanged.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, tenth tranche — Fool)

### Migrated: Fool pure LIVE-slot reference reads

`content/jobs/programs/fool-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **15 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Fool: 15 → 0 PURE; CAPTURED 54 and
BOUNDARY 1 unchanged; whole-repo 129 → 114 = 59 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` across the Fool resolvers with unambiguous
  live source slots;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` where its optional-slot contract matched.

The retained Fool sites (2 CAPTURED) stay caller-owned: Masquerade's
input-selected ally and Chronotemper's input-target-or-self dereference the
recorded player selection — U4 owns the choice, and nothing in this tranche
moved cardinality/selection into U1. No arbitrary-id accessor was added; no
source unit was promoted; valid/reachable-state semantics are preserved,
and a slot naming a missing actor fails closed under the existing U1
contract exactly as in the prior tranches.

## U1 tranche executed (fresh HEAD, 2026-09-01, twelfth tranche — Geomancer)

### Migrated: Geomancer pure LIVE-slot reference reads

`content/jobs/programs/geomancer-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **14 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Geomancer: 14 → 0 PURE;
CAPTURED 54 and BOUNDARY 1 unchanged; whole-repo 100 → 86 = 31 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 10 Geomancer resolvers that reach the
  source: Bio, BIOTIC, Dragon Dive, Geo, Helix Heel, Terraforming, Obsidian
  Flesh, Realignment, Midas, Quaking Palm;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Bio, BIOTIC, Geo, Quaking Palm —
  identical LIVE re-read and absent-singular→undefined semantics.

**Deliberately NOT migrated (per-call-site U1×U4 boundary, inventoried —
4 CAPTURED sites):** Dragon Dive's / Terraforming's / Realignment's
`targetId = input.actorIds?.target?.[0] ?? attackTargetId` and Midas's
`targetId = input.actorIds?.target?.[0] ?? triggerTargetIds?.[0]` — the
`?.[0]` / `??` SELECT is caller-owned U4 choice/cardinality (which slot
answers depends on the window contract), and only the dereference of the
chosen identity is the U1 captured-identity shape (the next tranche
family). `sourceActor(context, …)` remains imported for those four sites;
the resolvers' own range/board-state gates (`choice.actor-count`,
`choice.actor-range`, `!source.position`) are untouched.

### Guard

The `u1-reference-routing` guard pins Geomancer (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained captured/precedence
dereferences are NOT banned (no blanket lexical ban). Mutation test: a
Geomancer revert to `sourceActor(context, context.actorId)` drops the
pinned calls, is caught with exactly one Geomancer routing problem, and the
retained `input.actorIds ?? attackTargetId` / `?? triggerTargetIds`
`sourceActor(context, targetId)` reads alone do NOT trigger the pin.

### Evidence

- `reference-authoring.test.ts` +4: the production Geomancer Geo resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId` (legacy silently no-opped); Quaking Palm keeps a
  genuinely targetless use as a no-op (optional singleton semantics);
  Dragon Dive's recorded `input.actorIds` target still wins over a
  DIFFERENT recorded attack target (caller-owned U4 precedence); and
  Midas's recorded input target wins over the interrupt's trigger targets,
  becoming the held statue (caller-owned U4).
- `geomancer.test.ts` +1: reversing actor INSERTION order (second foe added
  before the target) produces byte-identical Geo outcomes and replay — the
  migrated source/attack-target reads resolve by recorded slot identity,
  never object-iteration order.
- the full Geomancer suite stays green through the engine path — Geo's
  charge blast, Terraforming's bullet budget/branches, Obsidian Flesh's
  stance die, Realignment's purge burst, Midas's U16 twice-per-combat
  ledger, and Quaking Palm's vulnerability/vibration mark all unchanged.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, thirteenth tranche — Stormbender)

### Migrated: Stormbender pure LIVE-slot reference reads

`content/jobs/programs/stormbender-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **11 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Stormbender: 11 → 0 PURE;
CAPTURED 54 and BOUNDARY 1 unchanged; whole-repo 86 → 75 = 20 + 54 + 1)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in all 9 Stormbender resolvers that reach
  the source: Rime, Tsunami, Cryo, Geyser, Gust, Heave-Ho, Deepwrath,
  Waterspout, Eye Of The Storm;
- primary attack-target reads (`context.attackTargetId ?
  sourceActor(context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Rime and Cryo — identical LIVE re-read
  and absent-singular→undefined semantics.

**Deliberately NOT migrated (per-call-site U1×U4 boundary, inventoried —
4 CAPTURED sites):** Geyser's / Deepwrath's / Waterspout's
`targetId = input.actorIds?.target?.[0] ?? attackTargetId` and Eye Of The
Storm's `centerId = input.actorIds?.target?.[0] ?? attackTargetId` — the
`?.[0]` / `??` SELECT is caller-owned U4 choice/cardinality (which slot
answers depends on the source contract per call site), and only the
dereference of the chosen identity is the U1 captured-identity shape (the
next tranche family). `sourceActor(context, …)` remains imported for those
four sites; the resolvers' own range/board-state gates
(`choice.actor-count` / `choice.actor-range` / `!source.position`) are
untouched. Eye Of The Storm stays DOCUMENTED_NON_EXECUTABLE (the
ally-center fly-4 player choice, p.236) — the migration changed no
retraction status and no ability semantics.

### Guard

The `u1-reference-routing` guard pins Stormbender (resolveSourceActor,
resolveAttackTarget) to the adapter; the retained captured/precedence
dereferences are NOT banned (no blanket lexical ban). Mutation test: a
Stormbender revert to `sourceActor(context, context.actorId)` drops the
pinned calls, is caught with exactly one Stormbender routing problem, and
the retained `input.actorIds ?? attackTargetId`
`sourceActor(context, targetId)` reads alone do NOT trigger the pin.

### Evidence

- `reference-authoring.test.ts` +3: the production Stormbender Rime resolver
  fails closed (`reference.missing-actor`) on a gated-bypass ghost
  `attackTargetId` (legacy silently no-opped); Cryo keeps a genuinely
  targetless use as a no-op (optional singleton semantics); Deepwrath's
  recorded `input.actorIds` target still wins over a DIFFERENT recorded
  attack target (caller-owned U4 precedence — the mark lands on the chosen
  identity, the out-of-range recorded attack target never participates).
- `stormbender.test.ts` +1: reversing actor INSERTION order (second foe
  added before the target) produces byte-identical Rime outcomes and replay
  — the migrated source/attack-target reads resolve by recorded slot
  identity, never object-iteration order.
- the full Stormbender suite stays green through the engine path — Rime's
  line shove/summon, Tsunami's swell origin, Cryo's shattered shove and
  aether gain, Geyser's free-space placement, Heave-Ho's interrupt wave,
  Deepwrath's mark, Waterspout's difficult terrain, and Eye Of The Storm's
  retracted fail-closed fixture all unchanged.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, fourteenth tranche — Sealer/Shade/Warden residue)

### Migrated: the last Sealer / Shade / Warden pure LIVE-slot source reads

The three already-pinned program families now route their remaining pure
live-slot references through the content-authoring adapter — **9
PURE_LIVE_REFERENCE sites removed per the machine inventory (Sealer 4 → 0,
Shade 3 → 0, Warden 2 → 0 PURE; CAPTURED 54 and BOUNDARY 1 unchanged;
whole-repo 75 → 66 = 11 + 54 + 1)**:

- Sealer source reads → `resolveSourceActor(context)` in Grand Seal,
  Sanctify, Grand Banishment, and Divine Aegis;
- Shade source reads → `resolveSourceActor(context)` in Harrow, Shadow
  Play, and Assassinate;
- Warden source reads → `resolveSourceActor(context)` in Gwynt and
  Stampede.

**Deliberately NOT migrated (per-call-site U1×U4 boundary, inventoried —
9 CAPTURED sites across the three files):** the input-selected identities
beside each migrated read — Grand Seal / Sanctify / Grand Banishment
`targetId = input.actorIds?.target?.[0] ?? attackTargetId`, Divine Aegis
`allyId = input.actorIds?.target?.[0] ?? attackTargetId`, Harrow /
Assassinate / Stampede `targetId = input.actorIds?.target?.[0]`, Shadow Play
`firstId`/`secondId = input.actorIds?.target?.[0/1]`, and Gwynt `foeId` /
`allyId = input.actorIds?.target?.[0/1]` — the `?.[0]` / `?.[1]` / `??`
SELECT is caller-owned U4 choice/cardinality (which slot answers depends on
the source contract per call site), and only the dereference of the chosen
identity is the U1 captured-identity shape (the next tranche family).
`sourceActor(context, …)` remains imported for those sites; the resolvers'
own range/board-state gates (`choice.actor-count` / `choice.actor-range` /
`!sourcePosition`) are untouched. No ability semantics, choices, movement,
geometry, triggers, lifecycle, damage, or retraction status changed —
Sealer's Open The Gates / Justice / Matsuri etc. were already migrated; the
four Sealer resolvers here were the last files' residue.

### Guard

No new pins were needed: the `u1-reference-routing` guard already pins
Sealer, Shade, and Warden (resolveSourceActor, resolveAttackTarget) to the
adapter, so a revert of any of these new reads drops the pinned calls and is
caught; the retained captured/precedence dereferences are NOT banned (no
blanket lexical ban). With this tranche, Colossus is the ONLY remaining
non-migrated named program family.

### Evidence

- `reference-authoring.test.ts` +5: the production Shade Shadow Play
  resolver fails closed (`reference.missing-actor`) on a gated-bypass ghost
  source actor (legacy would throw the misleading `choice.actor-count`);
  Shadow Play still swaps the RECORDED input identities (U4); Sealer Grand
  Seal's recorded `input.actorIds` target still wins over a DIFFERENT
  recorded attack target (U4 precedence); Sealer Sanctify keeps the
  source-center fallback for a genuinely absent optional target; and Warden
  Gwynt's recorded foe/ally selections still drive the dashes (U4).
- `sealer.test.ts` / `shade.test.ts` / `warden.test.ts` +1 each: reversing
  actor INSERTION order (an extra actor added before the target) produces
  byte-identical Grand Seal / Harrow / Gwynt outcomes and replay — the
  migrated source reads resolve by recorded slot identity, never
  object-iteration order.
- the full Sealer (24), Shade (24), and Warden (19) suites stay green
  through the engine path — all ability semantics unchanged.

No direct `state.actors[context.…]` dereference remains anywhere in content.

## U1 tranche executed (fresh HEAD, 2026-09-01, fifteenth tranche — Colossus)

### Migrated: Colossus pure LIVE-slot reference reads

`content/jobs/programs/colossus-programs.ts` routes every pure live-slot
reference through the content-authoring adapter — **11 PURE_LIVE_REFERENCE
sites removed per the machine inventory (Colossus: 11 → 0 PURE; CAPTURED 54
and BOUNDARY 1 unchanged; whole-repo 66 → 55 = 0 + 54 + 1; the named-
program PURE family is now EMPTY)**:

- source-actor reads (`sourceActor(context, context.actorId)`) →
  `resolveSourceActor(context)` in Valkyrie, Upheaval, Dropkick, Massive
  Overhead, Takedown, Great Suplex, Gigaton Whip, Boiling Blood (8);
- primary attack-target reads (`context.attackTargetId ? sourceActor(
  context, context.attackTargetId) : undefined`) →
  `resolveAttackTarget(context)` in Valkyrie, Takedown, Gigaton Whip (3) —
  identical LIVE re-read and absent-singular→undefined semantics.

The resolvers' guards tightened from `!source || !source.position` / `!target
|| !target.position` to `!source.position || !target?.position` (the
adapter's `resolveSourceActor` never returns undefined — an absent source
now fails closed with `reference.missing-actor` instead of silently
no-opping) — the exact pattern every earlier tranche used.

**Deliberately NOT migrated (per-call-site U1×U4 boundary, inventoried —
3 CAPTURED sites):** `plannedFly`'s helper-PARAMETER dereference
(`sourceActor(context, actorId)` — the caller supplies an already-resolved
identity for a movement plan; no live slot, no arbitrary-id adapter op) and
Dropkick's / Great Suplex's `targetId = input.actorIds?.target?.[0]`
recorded player selections. The `?.[0]` SELECT is caller-owned U4
choice/cardinality; only the dereference of the chosen identity is the U1
captured-identity shape (retained, inventoried with the 54).
`sourceActor(context, …)` remains imported for those three sites. No
ability semantics, choices, movement, geometry, triggers, lifecycle,
damage, or retraction status changed; Raging Wolf stays absent from the
registry; the documented Gigaton/Takedown exceed-terrain blockers are
unchanged.

### Guard

Colossus joins the `u1-reference-routing` guard's pinned families
(contentAdapterSurface: resolveSourceActor, resolveAttackTarget). Mutation
test: a Colossus revert drops the pinned calls, is caught with exactly one
Colossus routing problem, and the retained helper-parameter / input-target
dereferences alone do NOT trigger the pin.

### Evidence

- `reference-authoring.test.ts` +4: Valkyrie fails closed
  (`reference.missing-actor`) on a gated-bypass ghost `attackTargetId`
  (legacy silently no-opped); Takedown keeps a genuinely targetless use as
  a no-op (optional singleton semantics); Massive Overhead fails closed on
  a ghost source actor instead of a silent no-op; Dropkick's recorded
  `input.actorIds` target still takes the hit over a DIFFERENT recorded
  attack target (caller-owned U4 — the chosen identity is flown toward and
  damaged, the out-of-range recorded attack target never participates).
- `colossus.test.ts` +1: reversing actor INSERTION order (an extra foe added
  before the target) produces byte-identical Takedown outcomes and replay —
  the migrated source/attack-target reads resolve by recorded slot identity,
  never object-iteration order.
- the full Colossus suite (24) stays green through the engine path —
  Valkyrie's fly/weaken/pit, Upheaval's boulder shove, Dropkick's sacrifice,
  Massive Overhead's next-attack arming, Takedown's exceed true-strike and
  pit, Great Suplex's pick-up-and-drop, Gigaton Whip's collide landing, and
  Boiling Blood's defy-death all unchanged.

With this tranche, **every named program family routes its live slots
through the shared adapter — the PURE bucket is machine-empty**.

## U1 tranche executed (fresh HEAD, 2026-09-01, sixteenth tranche — U1×U4 captured-reference adjudication)

### The adjudication question

The remaining inventory after Colossus was 55 = 0 PURE + 54 CAPTURED + 1
BOUNDARY. This tranche answered one design question from the actual
U1/U4 contracts and implementation (not from the census count): does
dereferencing an identity that U4 or another caller already
selected/resolved belong to U1's Reference/Binding authority, or is
caller-owned dereference the correct terminal architecture?

The contracts draw the line at **who decides "which actor?" (U4) versus
who represents/resolves "the actor chosen earlier" (U1)** — two distinct
responsibilities, not one. Every residual site was classified by the
provenance of its argument identifier: recorded player selection
(`input.actorIds`), recorded trigger/window selection, `??`/`?.` precedence
chains, helper parameters carrying already-resolved identities, and one
derived-loop variable.

### Verdict — outcome C, split by semantic ownership

- **51 sites are genuinely U1** (20 pure recorded-input reads + 30
  precedence chains + the 1 in-call Harvester center read): the dereferenced
  identity is a durable recorded command selection — CAPTURED per U1's own
  ontology — and the shared surface (`resolveCapturedSelectedActors`,
  composing `capturedActor` through `resolveReference`) already existed and
  was pinned at bastion/spellblade. This tranche completed that decided
  surface: all 51 sites now resolve through it (live-slot chain sides
  through `resolveAttackTarget` / `resolveTriggerSource` /
  `resolveTriggerTargets`; the terminal `?? source` fallback stays an
  already-resolved actor). Ghost recorded identities now fail closed with
  `reference.missing-actor` (the U1 contract; legacy code silently
  tolerated them by no-opping). Select/cardinality/precedence stays at the
  caller (U4).
- **4 sites are correct terminal caller-owned** (colossus plannedFly,
  demon-slayer plannedRush, knave plannedRush + knave derived-loop): the
  dereferenced identity was produced by the caller algorithm itself
  (movement/planning parameters, an algorithm-built set). No reference
  intent; an arbitrary-id U1 accessor is forbidden, so no surface should
  exist. Reclassified NON_U1_OTHER by the machine classifier's new
  file-context refinement (declared parameter / loop variable of this
  file).

### Machine movement

**55 = 0 + 54 + 1 → 4 = 0 + 0 + 0 + 4 NON_U1_OTHER** (colossus 1,
demon-slayer 1, knave 2). The CAPTURED and BOUNDARY buckets are
machine-empty: every reference-shaped dereference in the named program
families now resolves through the shared adapter surface, and the four
survivors are proven non-references.

### Guard + evidence

- `u1-reference-routing` pins the newly-required adapter surface
  (`resolveCapturedSelectedActors`, plus the trigger accessors where the
  migrated chains use them) file-by-file; retained helper-parameter /
  loop derefs do not trip the pin, and a revert is caught with exactly the
  routing problem it should be (mutation-tested).
- the residual classifier gains file-context refinement: an argument is
  NON_U1_OTHER only when the identifier is a declared function parameter or
  a loop variable introduced before the site in this file (mutation-tested
  in the architecture-audit suite; the knave derived-loop over an
  algorithm-built `Set` is caught only with the file-context step, not by
  the argument shape alone).
- `reference-authoring.test.ts`: every precedence/parity fixture updated to
  the migrated shapes (assertions unchanged — behavior preserved: recorded
  input still wins over a DIFFERENT recorded attack target, absent-optional
  stays a legitimate absence), plus +2 adversarial cases — a ghost RECORDED
  input id through a migrated resolver fails closed with
  `reference.missing-actor` (legacy silently no-opped), and RECORDED order
  is decisive: flipping the recorded targetIds flips the Shadow Play swap
  (resolution never re-derives first/second from object order).
- `shade.test.ts` +1: Shadow Play under reversed actor insertion order is
  byte-identical with replay — the captured selections resolve by recorded
  identity, never object-iteration order.
- the full family suites (chanter, colossus, demon-slayer, enochian, fool,
  freelancer, geomancer, harvester, knave, sealer, seer, shade,
  stormbender, warden) stay green through the engine path — no ability
  semantics, choices, geometry, triggers, lifecycle, or damage changed,
  and no source unit was promoted.

## U1 tranche executed (fresh HEAD, 2026-09-02, seventeenth tranche — scope-aware classifier repair + fold-consumer adjudication)

### Scope-aware classifier repair

The file-context refinement previously reclassified a plain-identifier
CAPTURED site by WHOLE-FILE name coincidence: any function in the file
declaring `<id>: string` (helper-parameter) or any earlier
`for (const <id> of …)` loop in the file (loop-variable) triggered
NON_U1_OTHER. Unsound — an unrelated `function helper(…, actorId: string)`
or an earlier unrelated loop cannot turn a dereference inside ANOTHER
function into algorithm plumbing. The repair resolves the LEXICAL binding
of the identifier at the call site with the TypeScript compiler AST (an
existing project dependency):

- the nearest enclosing construct that introduces the identifier governs:
  a parameter of the lexically enclosing function (call inside its body),
  an unshadowed `for (const X of …)` that lexically contains the call over
  a NON-recorded iterable (never `input.actorIds` / `triggerTargetIds` / a
  `context.` slot), or a same-block `const`/`let` declared before the call
  — a shadowing inner recorded-selection local named like an outer helper
  param / loop variable keeps the site CAPTURED;
- constructs from unrelated functions or earlier loops are never ancestors,
  so name coincidence cannot reclassify a site.

Machine result: still 4 = 0 + 0 + 0 + 4 — the SAME four sites (colossus
plannedFly param, demon-slayer plannedRush param, knave plannedRush param,
knave derived-loop var over the wall-occupant worklist), each now with a
lexical provenance string. Tests pin the SITE IDENTITIES (file + exact
call shape), not just the number 4, and the classifier-mutation suite
covers: enclosing helper param → NON_U1; same param name in an unrelated
function → CAPTURED; enclosing loop var → NON_U1; same loop-var name in an
earlier unrelated loop → CAPTURED; shadowing in both directions → CAPTURED;
loop over a recorded selection → CAPTURED; ordinary recorded-input /
precedence shapes → U1.

### Fold-consumer adjudication

The completion audit's second content surface is now machine-inventoried:
`scanActorDerefs` enumerates EVERY `state.actors[…]` deref in `content/jobs`
(recursive, AST-based): **43 sites = 25 fact-carried + 5 recorded-forwarded
+ 13 forwarded-identifier + 0 algorithm/other + 0 legacy-slot**.

- **0 legacy-slot is load-bearing**: no fold-surface site interprets the
  legacy context bag (`context.actorId` / `attackTargetId` /
  `triggerSourceId` / …). The U1 guard's boundary holds there by machine.
- **recorded-forwarded (5)**: `targetIds[0]` / `targetIds[0] ?? ''` in
  talent / bonus-damage callbacks — recorded command selections forwarded
  by the shared fold kernel (encounter.ts reducer → `talentTriggerMutations`
  → content callback). The presence/absence decision is the CALLER's (empty
  list or the `''` sentinel = "no target"); the deref of a present id is
  captured-identity resolution against current state.
- **fact-carried (25)**: `mark.ownerId` (12), `mote.ownerId` (3),
  `entity.ownerId` (3), `candidate.ownerId` (2), `mutation.sourceActorId` /
  `mutation.actorId` (2), `origin.actorId`, `mine.ownerId` — identities
  stamped into durable facts at creation, dereferenced later to READ
  CURRENT state (owner talents, sides, positions).
- **forwarded-identifier (13)**: fold/kernel-forwarded ability-user ids
  (talent / heroic-activation callbacks, 6), U12 continuation-carried ids
  (`continuation-resolvers.ts` ×4, where the refs themselves are ALREADY
  typed `captured-actor`), the algorithm-combined area-evidence set loop
  (`areaIds`, 1), a reactive collided id (trait-reactions, 1), and the
  adjacent-foes helper param (1).

**Adjudication.** All 43 sites consume identities that were selected
(recorded command), stamped (facts/mutations), or carried (U12 refs) by
shared authorities — none is a live legacy-slot interpretation; each deref
is "resolve an already-captured identity against current state," which is
U1's captured-reference semantics. The U12 continuation family is closest
to U1 already: `continuation.refs[?]` holds the typed `captured-actor`
references and the residual deref (`ownerId ? state.actors[ownerId]`
: undefined) is presence-guarded — a REMOVED owner silently expires the
continuation, which is valid-state behavior.

## U1 tranche executed (fresh HEAD, 2026-09-02, eighteenth tranche — lifecycle adjudication + strict/weak captured-actor vocabulary + 39-site fold migration)

### Lifecycle adjudication (resolves the strict-vs-expiration contradiction)

Engine facts, verified at the reducer/lifecycle authority:

- **Defeat ≠ removal.** `defeatActor` marks `defeated: true` and keeps the
  actor in `state.actors`; `ACTOR_REMOVED`/`REMOVE_ACTOR` is setup-phase
  ONLY — during combat no actor leaves the map. A present id whose actor is
  missing mid-combat is therefore a DANGLING reference, never a lifecycle
  state;
- **Defeat cleanup strips owner-stamped ephemera.** `removeOwnedEphemera`
  removes marks, active effects, and summoned companions owned by the
  fallen (objects terrain-effects such as mines/motes survive as
  terrain/entities, but their owner read is the weak-authored case below);
- **Weak is authored, not inferred.** The only two carriers whose authors
  DECLARE a tolerant lifetime are `encounter-hooks` legacy/imported mark
  owners ("infer only when the owner is still known, never from a missing
  owner") and `lifecycle-recipes`' aura-origin `?? null` read. Every other
  fact-carried owner guarantees presence while the fact lives.

Therefore the proposed "present-but-removed → fail closed" was CORRECT for
the guaranteed-present carriers, and the contradiction with "continuations
expire" is resolved by splitting the contract TYPED, not by flags:

- **STRICT `capturedActor`** — "the remembered identity, which must still
  resolve." Absent ID (undefined / null / `''`) → `undefined`
  (caller-side presence border, exactly like the live optional
  accessors); present id + missing actor → fail closed
  `reference.missing-actor`;
- **LIFECYCLE-SENSITIVE `capturedActorWeak`** — "the actor originally
  associated with this fact, if that actor still exists." Same absent-ID
  border; present id + missing actor → `undefined` (explicit `absent`
  resolution), never an error.

Strict and weak are distinct U1 reference kinds in `primitives/reference.ts`
(`captured-actor` vs `captured-actor-weak`, whose resolution is
`resolved | absent | unresolved`); the adapter exposes
`resolveCapturedActor` / `resolveCapturedActorWeak` composing each through
the ONE `resolveReference` authority. No flags switch one accessor's
behavior; no arbitrary-ID resolver exists.

### Migrated (39 sites across 8 content files)

The previously-optional residual `state.actors[…]` derefs routethrough the shared ops. Strict (37): talent-recipes ×7 (fold ability-user + recorded
`targetIds[0]`), lifecyle-recipes ×18 (mark.ownerId / mote.ownerId,
entity-owner mark reads), continuation-resolvers ×4 (U12
`captured-actor`-carried owner/target — ABSENT ref → undefined, present id
must resolve; the defeated/onBattlefield expiry check stays caller-side on
the RESOLVED actor), mark-modifier-recipes ×2, attack-modifier-recipes ×2
(`mutation.sourceActorId`/`actorId`), bonus-damage-recipes ×1
(`targetIds[0]`), fool-programs ×1 (`mine.ownerId`). Weak (2):
encounter-hooks ×1 (legacy/imported mark owner), lifecycle-recipes ×1
(aura-origin `?? null`). The recorded-forwarded `''` legacy
ghost-tolerance (the old `targetIds[0] ?? ''` silent-`undefined`) became
fail-closed only in the strict sense: an EMPTY/`''` selection is still the
caller's presence border → `undefined` (no semantic change on valid-state
no-target paths); a present-but-ghost id now violates. All 39 keep
defeated/onBattlefield/position guards caller-side on the RESOLVED actor.

### Survivors (4 machine-pinned NON-reference derefs — provably outside U1 scope)

`scanActorDerefs(content/jobs)` now finds exactly: heroic-activation:163
and talent-recipes:46 (dependency-injected `actorId` params of the pure
local queries `closestFoesOf`/`adjacentFoes`), talent-recipes:480 (loop
var over the algorithm-combined `areaIds` Set), trait-reactions:28 (loop
var over F9-derived reactive collision ids — the trigger DECISION is F9's;
the deref is transient algorithm output, never a durable reference). All
four are pinned by SITE IDENTITY (file + line + shape), so a false positive
cannot silently swap in while keeping the count 4 (also the program census
keeps its 4 = 0 + 0 + 0 + 4, identity-pinned).

### Adversarial evidence

- `reference-authoring.test.ts` +7: absent-ID border for both ops (undefined
  / null / `''` → undefined, never error); present+present resolves the
  SAME full `EncounterActor` object (fold guards keep reading `defeated` /
  `onBattlefield` / `ruleState` off it); present+defeated still resolves;
  present+REMOVED → strict `reference.missing-actor` vs weak `undefined`
  (the adjudicated split); a present garbage id violates strict; replay
  determinism (pure function of (state, id), re-reads CURRENT state);
  actors-map insertion order never changes resolution;
- `architecture-audit.test.ts` fold-inventory pins rewritten to the migrated
  state: total 4 (family 4 forwarded-identifier, 0 legacy-slot loads),
  exact survivor identities, and the continuation family asserted
  zero-raw-derefs;
- the engine family suites (talents, trait-reactions, job-traits, U12
  continuations, fool, attack-modifiers, heroic-activation, summons,
  conditions, marks, bonus-damage, attack-modifiers) stay green through the
  engine path — valid-state ability semantics, choices, geometry,
  triggers, lifecycle, and damage unchanged; no source unit promoted.

## U1 status after the eighteenth tranche (lifecycle adjudication + strict/weak split + fold migration)

**U1 is AUTHORITATIVE within its declared scope** (content reference
interpretation: naming a thing a later rule clause refers to — LIVE,
CAPTURED, bound, strict/weak captured identities). The completion gate from
the tranche instructions is met, item by item:

1. one typed Reference/Binding vocabulary for the declared scope
   (`primitives/reference.ts` — liveActorSlot/liveActorBound/capturedActor/
   capturedActorWeak/position/bound/collection kinds);
2. one resolution authority (`resolveReference`) — every adapter accessor
   (live source/attack-target/trigger, captured selections, strict/weak
   captured actor) and every generic consumer composes it; the
   content-authoring adapter is the single content surface and is
   guard-pinned to keep composing the vocabulary;
3. LIVE vs CAPTURED semantics explicit (live re-reads current state;
   captured/selection preserves the recorded identity);
4. STRICT vs LIFECYCLE-SENSITIVE captured semantics explicit as distinct
   reference kinds — never caller flags;
5. U4 choice does not leak into U1: select/cardinality
   (`?.[0]`/`?.[1]`/`??`) and U4 identity compares stay caller-owned on
   every migrated chain (proven by the precedence and dropped-input
   fixtures);
6. algorithm-produced IDs are not references: the 4 program + 4 fold
   machine-pinned survivors are NON_U1_OTHER / algorithm plumbing with
   lexical/site-identity proof;
7. no implicit legacy slots are independently interpreted: 0
   `state.actors[context.…]` in content (guard + census), 0 legacy-slot on
   the fold surface;
8. no competing dereference authority within the declared scope: the only
   remaining raw `state.actors[…]` in content are the 8 pins above, all
   provably non-references;
9. replay preserves captured identities/values: recorded ids resolve
   against replayed state; absent/weak/defeated/removed cases are typed;
   replay-equality fixtures green;
10. architecture guards + census machinery detect realistic regressions:
   lexical-scope classifier (shadowing/name-collision proof), site-identity
   pins (no count-preserving substitution), adapter composition pin, and
   the 0-legacy-slot machine pin.

The declared-scope boundary is precise: what U1 does NOT own — U2 role
projection, U4 choice/cardinality, lifecycle expiry/cleanup (which run
caller-side on the RESOLVED actor), and algorithm-produced transient
identities (the 8 pins). Within that scope there is one vocabulary, one
authority, explicit contracts, and machine+test proof. No source unit was
promoted; no ability semantics changed; no arbitrary-ID accessor exists.

## U1 tranche executed (fresh HEAD, 2026-09-02, nineteenth tranche — U7 anchor identity onto typed U1; ResolvedReference absent-domain tightening)

U1 verification for 95a45f0 passed in full: strict vs weak captured-actor
semantics, defeat ≠ removal (engine fact), exactly two weak carrier
families, 39 migrated fold derefs, four fold-surface + four program-surface
non-reference survivors, zero legacy-slot interpretation, U4/lifecycle
ownership — all confirmed on HEAD before closing U1.

**Small U1 type cleanup (included).** `ResolvedReference<D>` previously
carried `{ kind: 'absent' }` on the OUTER union, so any reference domain
could type-theoretically resolve as absent; runtime only ever produced
absent for `captured-actor-weak`. The member is now conditional on the
actor domain (`absent` only on actor-domain references), so strict
actor/entity/position/value resolution can no longer type-theoretically
return absent. No runtime change; a type-level test pins the narrow
(actor-domain only) and a `// @ts-expect-error` probe pins that a
non-actor domain cannot expose `absent`.

**Dependency-DAG decision.** U3 was NOT selected: the plan's own DAG shows
U3 depends on U1, U2, U5-core, AND U7, while U7 depends only on U1+U2
(both authoritative). U7 (Anchor/Spatial Frame) is therefore the first
remaining dependency-complete underlay; U9 (Provenance, U1+U2) is the
parallel candidate, and the plan's phase order (T2: "U7, U3, U5, U6, U4")
puts U7 first. The U7 row's own corrective note named the seam: "Once U1
exists, live anchor identity should use the typed `Reference<T>`
vocabulary" — exactly what this tranche executes.

**What landed.** The LIVE actor anchor's identity is now the typed U1
`Reference<'actor'>` instead of the reference-style `RuleSelector`
scaffolding:

- `primitives/anchor.ts`: `SpatialAnchor` actor kind = `{ kind: 'actor';
  ref: Reference<'actor'> }`; constructors `anchorFromActorRef`,
  `defaultActorAnchor` (the acting-actor source slot), and
  `anchorFromActorSelector(selector, context?)` — the SINGLE
  selector→reference mapping via the U1 `actorReferenceForSelector`
  adapter. Fail-closed at construction: an input-keyed selector without a
  context (no recorded selection to capture) and any query-shaped selector
  (all/within/adjacent — a candidate query can never name one origin)
  return null; the kernel raises `selector.origin-invalid`.
- `kernels/candidate.ts` `resolveSpatialAnchor`: the actor case now
  resolves `anchor.ref` through the ONE `resolveReference` authority
  (zero/multi actors, missing slot, position-less actor fail closed as
  before; `selector.actor-missing` / `selector.origin-invalid`).
- Consumers (`choice.ts` `rangeOrigin`, `evaluate-query.ts` LoS/entity
  anchors, `evaluate-value.ts` `distance` endpoints) unchanged in
  behavior — only the identity carrier changed; the old selector
  re-interpretation at resolution time is gone (identity decided ONCE at
  construction, matching LIVE re-resolve vs CAPTURED-recorded semantics).
- Guard: `u1-reference-routing` pins `kernels/candidate.ts` to
  `resolveReference` (the typed-ref resolution authority) instead of the
  removed selector adapter call; the pin change is itself regression-tested
  (a restored raw `context.attackTargetId` slot is still caught).
- Tests: candidate.test.ts gains a `U7 ANCHOR construction surface` block
  (default = typed source slot; `anchorFromActorRef` preserves the
  reference verbatim; input-without-context and query-shaped selectors fail
  closed at construction), plus the prior verify-tranche type-level probe
  in reference.test.ts.

**Census.** Unchanged and consistent: U1 residual 4 = 0 PURE + 0 CAPTURED
+ 0 BOUNDARY + 4 NON_U1_OTHER (program surface); fold surface 4
forwarded-identifier pins; zero legacy-slot. Architecture audit 125 files
clean; automation audit clean; source-fidelity strict clean. Tests
2169 (+6: 2 absent-domain probes + 4 anchor construction-surface tests),
build clean. U7 remains PARTIAL:
the aura-origin, entity `creationSpatial`, `RuleArea.origin`, teleport, and
rebound-origin consumers stay specialist-owned per their documented
boundaries — this tranche only closed the LIVE actor anchor identity seam.

## U1–U7 tranche executed (fresh HEAD, 2026-09-02, twentieth tranche — U7 verification, teleport footprint-frame repair, strict-vs-weak type bound documented)

**Verdict on the nineteenth tranche: verified, no repair needed.** The DAG
claim holds (U7 depends only on U1+U2, both authoritative; U3 still waits
on U5-core AND U7 — the plan's own table), `SpatialAnchor`'s actor kind is
the typed `Reference<'actor'>`, `anchorFromActorSelector` is the single
selector→reference mapping (fail-closed at construction for query shapes
and input-without-context), `resolveSpatialAnchor` composes the ONE
`resolveReference` authority, relation perspective stays U2-owned in
`kernels/candidate.ts` (`relationPerspectiveIdFromContext`), zero source
promotion, and the specialist-origin consumers were genuinely outside the
tranche.

**Strict-vs-weak `ResolvedReference` typing — documented bound, no redesign.**
The domain-level union keeps `{ kind: 'absent' }` on the actor domain not
as sloppiness but as the runtime-widest truth: a weak member can appear
directly, INSIDE a collection, or beneath a BOUND name — none of which the
domain-level type can see. Removing `absent` from strict kinds requires
`ResolvedReferenceFor<R extends Reference>` kind-indexed resolution, a
redesign that would make every strict call site's `absent` narrowing dead
code while leaving bound/collection cases exactly as conservative — zero
runtime change for a type-only distinction. The kinds themselves are typed
(`capturedActor` vs `capturedActorWeak`) and the public accessors encode
the contract exactly (`resolveCapturedActor` rejects vs
`resolveCapturedActorWeak` maps `absent`→`undefined`). Bound documented in
`primitives/reference.ts`; runtime exclusivity already test-pinned.

**U7 residual audit — five families classified.** (A) NO genuine anchor
duplication remains: (1) aura origins — B, carrier-scan identity (durable
states), emits `position`+`size` + U2-branded `perspectiveActorId`, live
re-derivation; specialist-owned with written boundary, no migration;
(2) entity `creationSpatial` — B, record-carried RESOLVED frame for
replay, documented retained specialist; (3) `RuleArea.origin` — C, inert
declarative with no runtime consumer; (4) teleport origins — B with a REAL
gap repaired below; (5) rebound — C, provenance flag + unwired blocker;
runtime.ts `context.actorId` de-facto anchor — C, U1 source identity for
cost, not a spatial frame.

**Teleport footprint-frame repair (the one genuine gap).**
`chosenTeleportDestination` was measuring p.92 range from a degenerate
size-1 point regardless of the mover's actual footprint — for a Size-2
mover, teleport range under-reached. The legality query now threads the
mover's footprint from the already-resolved mover record
(`originSize: mover?.size ?? 1` in the shared `validatePositionLegality`
call), matching every other measurement consumer. Behavior-preserving for
all Size-1 movers (verified: spellblade/sealer/shade/harvester suites, 111
tests, green); Size-2 edge measurement proven by adversarial fixtures
(edge-adjacent cell legal, one-past illegal, point-frame would reject it).
New `u7-teleport-footprint-origin` guard in `scripts/audit-architecture-core.ts`
rejects a restored point-frame call; mutation tests pin both directions.

**Census.** U1 residual consistent at 4 = 0+0+0+4; architecture audit 125
files clean; automation clean; source-fidelity strict clean; tests 2175
(+6); build clean. U7 remains PARTIAL: aura/creation/rebound/RuleArea.origin
consumers stay specialist-owned with written boundaries (only the teleport
boundary was repaired), so the completion gate's "every declared origin kind
on the typed vocabulary" is not yet demonstrable end-to-end.

## U7 tranche executed (fresh HEAD, 2026-09-02, twenty-first tranche — teleport missing-mover fail-closed repair; U7 completion audit; AUTHORITATIVE decision)

**Verdict on tranche 20: keep, with one real correctness repair.** The
verification passed in full: the five-family U7 residual classification
(aura B carrier-scan, creationSpatial B record-carried, RuleArea.origin C
inert, teleport B-with-gap, rebound C unwired, runtime.ts actorId C U1
identity); teleport range genuinely was measured from a degenerate size-1
POINT before the fix (the legality call carried no `originSize`, so the
operator's point baseline applied regardless of the mover's footprint);
p.92 requires measurement from the edge of the mover's actual footprint
("range is measured from the edge of the origin space (or character)"); the
new Size-2 edge behavior is correct (edge-adjacent legal, one-past
illegal, point-frame would reject); Size-1 behavior is unchanged
(originSize 1 ≡ the point-cell metric); the specialist boundaries are
genuine (aura is a bearer-eligibility carrier-scan with U2-branded
perspective — never selector→frame resolution; creationSpatial is a
record-carried CAPTURED contract for replay; RuleArea.origin is inert;
rebound is an unwired provenance flag); skipping the `ResolvedReference`
kind-indexed redesign is reasonable (zero runtime change, bound/collection
cases equally conservative); and no source-unit promotion or unrelated
source semantics changed (9 files, all kernel/tests/guards/docs). ONE
issue: `originSize: mover?.size ?? 1` silently MASKS a missing mover as
Size 1 — the exact point-frame fail-open the tranche repudiates. `size` is
a REQUIRED field on `RuleActorView`/`EncounterActor`, so the fallback can
only ever fire for a missing mover: presence is conflated with Size 1.

**The repair.** `chosenTeleportDestination` now reads the mover record
fail-closed: a missing mover throws the established `selector.actor-missing`
violation BEFORE any destination legality is accepted — never an inferred
Size-1 frame. All existing callers pass already-resolved valid mover ids,
so behavior is unchanged for every real command; Size-1 and Size-2 valid
behavior is pinned by the tranche-20 fixtures. The
`u7-teleport-footprint-origin` guard was tightened to require a NON-OPTIONAL
`.size` read (`mover?.size` — any optional-chained or `?? 1` fallback — is
now REJECTED by the architecture audit), with mutation tests pinning the
masked-fallback restoration.

**Adversarial evidence.** A missing mover with a fully legal destination
input (in-grid, unoccupied, LoS-clear, within range of the point) fails
closed with `selector.actor-missing`; under the pre-repair code the same
command was ACCEPTED (the point frame executed a teleport for a mover that
does not exist).

**U7 completion audit — every remaining origin/frame consumer classified.**
(A) RESOLVES THROUGH THE U7 VOCABULARY: `candidate.ts` `rangeOrigin`;
`choice.ts` position legality (origin.size from `resolveSpatialAnchor`);
`evaluate-value.ts` `distance` endpoints (anchors/refs via
`resolveSpatialAnchor`); `evaluate-query.ts` LoS/area-adjacency anchor
reads. (B) CARRIES AN ALREADY-RESOLVED FRAME with a written boundary:
teleport-choice (resolved origin + factual mover footprint through the
shared legality operator); creationSpatial (command-time RESOLVED record
ridden by the mutation; the reducer consumes it as recorded — replay never
re-decides a captured frame; `execute-flow` fills an undeclared origin size
from the origin actor's FACTUAL size); aura origins (LIVE carrier-scan —
bearer eligibility, position+size from durable state, canonical metric;
never a selector→frame mapping, live-only so no LIVE-vs-CAPTURED
decision); foe-recipes/encounter-adapter/attack-resolution/range.ts
measurement (canonical metric over factual live records). (C) INERT OR
NON-SPATIAL: RuleArea.origin (declarative, no runtime consumer); rebound
(provenance flag + unwired blocker); `runtime.ts` `context.actorId`
(U1 source identity for cost). No duplicate implementation of origin
selection, footprint sizing, range-from-actor-as-point, entity origin
geometry, captured-vs-live re-derivation, implicit `context.actorId`
fallback, or Size-1 fallback for a multi-space actor remains in a GENERIC
measurement path. The `size?: number` `?? 1` projections on view types
(aura/foe-recipes/range views) and the `summonEntity` content-sugar
`originSize ?? 1` default (a CAPTURED-position point baseline matching
`anchorFromPosition`'s documented size-1 default; all current creators are
Size 1; flow-path creation resolves the factual origin-actor size) are
domain parameters, not frame re-interpretations — noted, not migrated.

**U7 AUTHORITATIVE — the completion-boundary decision.** U7's declared
scope (generic-underlays.md: "name every spatial relationship's frame
explicitly"; plan Non-responsibilities: not distance metric, not movement
legality, not LoS computation) is VOCABULARY + RESOLUTION + the canonical
metric. Specialist carriers store already-resolved frames for their OWN
domain questions; none independently reinterprets LIVE vs CAPTURED frame
semantics, maps a selector to a frame, or defines a second metric — so the
"every declared origin kind on the typed vocabulary" structural gate is
broader than the ownership model the ontology actually states (the plan's
own Consumers-to-migrate rows and the t8c/t8d authority proofs already
classified RuleArea.origin and creationSpatial as disjoint Q carriers).
Clarified, not redefined: the typed vocabulary is `SpatialAnchor` (actor /
entity / captured-position) + its resolution; carrier schemas are NOT
migrated to it. This is the exact ownership distinction this tranche
decides, and it does not manufacture authority — the audit above is the
fresh evidence.

**Next dependency-driven tranche — U5-core** (see the DAG section). U3's
declared gate is U1✓ + U2✓ + U5-core + U7✓; with U7 authoritative the ONLY
remaining blocker is U5-core, so U3 cannot be next. U9 (U1+U2) is
independently dependency-complete, but the canonical plan's phase order
(T2: U7/U3/U5/U6-core/U4 before T4: U9/U10) selects the T2 continuation
(U5-core, then U3) — the same phase-order tiebreak tranche 19 used to pick
U7 over U9. No source-unit promotion; underlay phase remains UNDERLAY
COMPLETION.

**Census.** Tests 2177 (+2: missing-mover fail-closed adversarial fixture;
+1 guard-restoration mutation test for the tightened optional-chained
rejection); architecture audit clean with the tightened guard; automation /
source-fidelity strict / build clean (source-fidelity.md regenerated by its
owner to register `claim:foundations:u7-authoritative`); blocker census
byte-stable (no source-unit change). U7 row moves to AUTHORITATIVE;
U1 residual unchanged at 4 = 0+0+0+4.

## U5 tranche executed (fresh HEAD, 2026-09-02, twenty-second + twenty-third tranches — the singular HP-percent scalar, then its BASE-bar correction under adjudication icon-1.5:combat:bloodied-base-max; U5-core dependency gate met)

**Audit first (no immediate migration).** The full U5 surface was
fresh-audited before editing: `RuleNumber` (constant/stat/resource/round/
input/count/count-query/distance/percent-base-max/die/damage-die/
damage-roll/if/percent/add|multiply|minimum|maximum/clamp),
`evaluateNumber` (+`integer`) in `kernels/evaluate-value.ts`, the
`count-query`/`distance` endpoints through `evaluateValueQuery` /
`resolveSpatialAnchor` (U3/U7 composed, never re-implemented), and every
inline arithmetic site found by the duplicate sweep (Math.min/max/floor/
ceil across content/kernels). Classification: (A) GENUINE U5-value
candidates — the wounds-adjusted HP-percent threshold scalar: computed
identically-but-separately by the U6 `bloodied`/`quarter` predicate
formulas (`hp <= maxHp/2`, `hp <= maxHp/4`), and DIVERGENTLY by the Rot
p.186 resolver (`hp <= Math.ceil(maxHp/4)` — one point over the exact
quarter for non-divisible maxima: 8 of 30 = 26.7% is not "25% or lower");
(B) ANOTHER UNDERLAY SUPPLYING A SCALAR — count-query (U3), distance
(U7), round (U8), usage (U16), range modifiers (U14): all consume, none
duplicated; (C) SPECIALIST SEMANTIC, NOT U5 — rollout dice (`die`/
`damage-roll` consume RECORDED rolls — the ROLL authority stays the dice
source), reducer-side threshold reads (`hp-threshold.ts`, talent-recipes
inline `isBloodied` — raw `{baseMaxHp, wounds, vitality}` surface,
documented twin of the projected bar, out of U5 scope per the plan),
damage/armor formulas (damage domain), gamble halves in sealer
JUDGEMENT / colossus Great Suplex (`floor(gamble/2)` ≡ `percent 50 floor`
+ `clamp min 1` — COMPOSABLE on the existing algebra; content-local, no
new primitive), object-stacking height, round-bounded grid steps,
sacrifice-input narrowing (U4 input bounds). Timing: `stat`/`percent`
values are LIVE re-reads; `input` is CAPTURED from command buckets;
`damage-roll` is DERIVED FROM RECORDED RESULT (no reroll); `bound` names
resolve the U1 binding. No RNG, choice, query execution, spatial geometry,
clock reconstruction, or modifier stacking exists inside the scalars.

**The one missing family + replicate — then an adjudication corrected it.**
The plan's typed-vocabulary contract says "Percent always names its base
explicitly (BASE max vs wounds-adjusted)" — `percent-base-max` (p.107
BASE) existed; the wounds-adjusted sibling (p.94/p.104 state bar) did
NOT, and its formula lived inline in three places (U6 predicates ×2, Rot
resolver ×1 with a rounding DIVERGENCE). Tranche 22 landed
`{ kind: 'percent-max-hp'; … }` + the pure
`percentOfMaximum(maxHp, percent, rounding)` behind it. TRANCHES 22→23
ADJUDICATION REPAIR: the p.81 primary HP/Wound rule defines bloodied as
"at or below 50% your **base maximum hp**" and immediately defines
wounds as "temporarily reducing your maximum HP" — so percent-of-
maximum-HP thresholds measure the BASE bar exactly like p.107 "%
HEALTH" costs/damage. The wounds-adjusted `percent-max-hp` kind had no
source-backed consumer (p.81 bloodied; p.107 costs; Rot p.186 "25% hp";
the Harvester p.183 25% gate all read base) and was REMOVED. The single
scalar is now `percentOfMaximum(baseMaximum, percent, rounding)` behind
`percent-base-max`, the U6 `bloodied`(50)/`quarter`(25) predicate
thresholds (`rounding: 'down'` reproduces the exact `hp·100 <=
baseMaxHp·percent` comparisons: `hp <= base/2` ≡ `hp <= floor(base/2)`
for integer HP), and the Rot p.186 "at 25% hp or lower" mark read —
repaired twice: the ceil divergence (8 of 30 = 26.7% is one point over
"25% or lower"; 30-max boundary fixtures pin 8-above false /
7-exactly true) AND the bar (wounds-adjusted max → base; a
wound-divergence fixture proves base 30 + one wound still quarters at
hp 7).
- `hp-threshold.ts`/`talent-recipes`/the fold bloodied gates read the
  SAME BASE bar on the raw reducer surface — the documented reducer-side
  threshold authority (out of U5 scope), never a second formula.

**U5-core DEPENDENCY GATE — MET for U3 (distinct from full U5 authority).**
The gate's six conditions all hold on the code at HEAD: every numeric
form U3 requires (constant/stat/resource/round/input/count/count-query/
distance/min/max/clamp/add/multiply/if/percent pair) is represented;
U3 never runs its own scalar evaluation (consumes `evaluateNumber`);
dynamic ranges/counts/thresholds ride U5; evaluation is pure and
side-effect free; LIVE/CAPTURED timing is explicit; no duplicate core
scalar evaluator remains in the VM value domain after this tranche.
**U5 as a whole remains PARTIAL** — full authority needs the extended
typed families (traversed-distance, elevation, area-size, U16 usage
reads, typed non-numeric values) and the residual content inline-
arithmetic sites (each composable, none an independent authority). These
two statuses are deliberately NOT collapsed.

**DAG after the tranche.** U3's declared edge is U1✓ + U2✓ + U5-core✓
(tranche 22) + U7✓ — so **U3 is now the next dependency-complete
underlay** (the plan's own T2 phase order U7 → U5-core → U3). U9 remains
the parallel-ready T4 candidate, still later in canonical phase order.
No source-unit promotion; underlay phase remains UNDERLAY COMPLETION.

**Census (22→23 combined).** Tests 2189 (+6 on 2183: tranche-22
percent-pair + predicate boundary + Rot 30-max fixtures, tranche-23
predicate fail-closed pair + wound-divergence fixture + adjudication
boundary pins); architecture / automation / source-fidelity strict /
typecheck / build clean; blocker census and source-fidelity doc
byte-stable (no source-unit promotion; the Rot repair changes only an
already-executable row's boundary semantics toward the adjudicated
BASE-max quarter). U5 row stays PARTIAL with the gate-met note; U1/U7
residuals unchanged.

**Tranche 24 — residual audit of tranche 23 (2026-09-02).** The bloodied
base-bar repair was verified end-to-end and three residuals closed: (1)
the Demon Slayer Raging Demon missing-HP percent read no longer falls
back to the wounds-adjusted bar — `baseMaximumHp(source)` fails closed
(`value.base-max-missing`) and the `encounterState ? … ??
source.maxHp : source.maxHp` fallback is removed; (2) the inline
Sturmreiten / Soul Shot `effectiveAreaFor` fold views now project the
BASE bar (`maximumHp: source.baseMaxHp`, matching the adapter), closing
the last producer whose `maximumHp` meant the wounds-adjusted live bar;
(3) adjudication `icon-1.5:combat:bloodied-base-max` now labels its two
logical parts — the conflict-resolved bloodied reading (p.81 "base
maximum hp" vs the unqualified p.94/p.104 recaps) and the DERIVED
quarter-family reading (the same base bar, derived from p.81's
VIT = 25%-of-maximum-HP definition, p.86's base-defined hp-bar
segments, and p.107's percent-health base-max policy) — citing the
derivation evidence rather than presenting the quarter extension as a
second passage conflict. Sweep confirms no remaining `maxHp / 2` /
`/ 4` percent-gate site reads the live bar; the live-bar `maxHp` reads
remaining are heal/vigor caps, the `max-hp` stat, and rescue. U5-core
gate STILL MET; **U3 remains the next dependency-complete underlay**
(the plan's T2 order U7 → U5-core → U3); U9 stays the parallel T4
candidate.

**Tranche 25 — U3 Query/Candidate audit + content-routing repair
(2026-09-02).** A fresh end-to-end U3 audit verified every substrate
claim from code (CandidateSet, evaluateActorQuery, U7 rangeOrigin
anchors, selectActors-as-thin-adapter, validateActorCandidate direct-
target base eligibility, insideArea inclusion, evaluatePositions /
validatePositionLegality / nearestCandidates, ENTITY + TERRAIN domains,
occupancy policies, LoS/LoE operators, set composition, distance-order
where requested, complete minimum-distance sets with no invented
tie-break) and classified every production question-path. The substrate
earned its declared scope with ONE residual family in content
resolvers — now repaired. (1) F1 — DEFEATED-DIVERGENT VM SCANS: the
VM view projection keeps defeated actors on-field with positions (defeat
never clears position/onBattlefield, so rescue can find "an adjacent
defeated ally"), while the reducer-side lifecycle scans filter
defeated and the U3 candidate authority excludes defeated actors by
default — but six VM-side resolver scans independently re-answered
"which actors qualify?" with a raw side/distance read and NO defeated
filter, so a defeated adjacent foe could be cured, blessed, shoved,
counted into a heroic die, or picked as a damage target. All six now
route through the ONE U3 authority (evaluateActorQuery with a U7
anchorFromPosition origin — also upgrading the point-distance scans to
the p.92 footprint metric): demon-slayer demonClaw adjacent-foe set +
Soul Blade heroic count, chanter Holy cure, bastion Heracule second-
shove set, knave Provoke adjacent foes, sealer God Hand beneficiaries.
(2) F2 — DEMON CLAW INVENTED PICK REMOVED: p.129 "Each time, you may
deal 2 damage to an adjacent foe" is the player's per-step WHICH
choice; the resolver's id-first slice(0,1) silently resolved it (and
tests only exercised the special path). With several living adjacent
foes and no recordable choice the command now FAILS CLOSED
(`choice.target-unresolved`, the Draken Cross precedent) atomically;
the special (all-adjacent) path and the single-candidate normal path
stay executable. (3) F3 — GOD HAND SELF-OR-ALLY: p.192 "bless yourself
or ally in range 2" now reads the recorded `bless-target` selection
(rides `input.actorIds`, defaults to yourself), measured from the post-
teleport LANDING cell through validateActorCandidate (alive +
on-battlefield + ally + footprint range), failing closed
(`choice.actor-range`) when a recorded ally is invalid — the old
self-first deterministic sort is gone. Demon Claw's charge/heroic
"weaken all adjacent characters" clause also routes through the U3
query. Adversarial tests (+4, 2193 total): defeated-exclusion per family
(Provoke: the defeated adjacent foe neither damages back nor is struck;
Demon Claw special: only the living foe takes the step damage),
Demon Claw single-foe hit + multi-foe fail-closed, God Hand recorded-
ally blessing + out-of-range recorded-ally rejection; every fixture
re-checks `applyEvents(state, events) === result.state`. The remaining
side-check sites are area-effect enumerations where the reducer makes
effects on defeated actors inert — mutation-log noise with no state
divergence, not selection. Sweeps confirm no VM-side selection scan
remains outside the shared query. **U3 is AUTHORITATIVE within its
declared scope** (decision): the residuals documented in §U3 —
AREA/PERSISTENT-INSTANCE/RULE-SOURCE query domains (U10/U12-scoped,
U16/U17 reads), ordering beyond the min-distance set + opt-in cell
order (source-gated first/last/nth), and rushTowardFoes' direction
fallback (U4 player choice) — are later-underlay or non-U3 by the
plan's own boundaries, not U3-owned gaps. Next dependency-complete
underlay: **U4 Choice** (DAG row U4 → U3, U2; both authoritative; U4
is the last open node of the T2 phase order U7 → U5-core → U3 → U4).

**Tranche 26 — U4 completion begins: Demon Claw + God Hand choice
repair (2026-09-02).** The U4 audit's central test — candidate
uniqueness ≠ absence of player choice — found both tranche-25
"repairs" still silently defaulted a decision the source grants. (1)
DEMON CLAW (p.129 "Each time, you MAY deal 2 damage to an adjacent
foe"): the normal path auto-hit a single adjacent foe, collapsing the
WHETHER (may) decision; the multi-foe fail-closed forced a recording
instead of honoring decline. Now each rush step reads the per-step
recorded selection (`demon-claw-damage-1`/`-2`): absent = DECLINED
(never auto-hit, never a default foe), a recorded target must be a
member of THAT step's eligible set — the one U3 foe query from the
post-movement cell plus the once-per-use exclusion — and fails closed
(`choice.actor-ineligible`) otherwise; the Special path ("deals damage
to all adjacent foes") stays mandatory with no per-step choice.
Temporally distinct per-step decisions needed NO vocabulary extension:
two captured keys validated at their own timing point, the established
God Hand / Gwynt / Draken Cross pattern. (2) GOD HAND (p.192 "bless
yourself or ally in range 2"): the absent-`bless-target` self-default
was removed — the clause is a REQUIRED either/or; missing now rejects
(`choice.actor-required`), multi rejects (`choice.actor-count`), a
recorded ally validates through U3 from the post-teleport landing
(`choice.actor-range` on invalid), recorded self is honored. Fists of
Heaven and Hell (p.192 mastery combo, NOT yet executable) repeats the
same clause and is documented as REQUIRING the identical semantics when
it lands. (3) PLUMBING GAP: the USE_ABILITY command pipeline
overwrote `input.actorIds` with only `{ target: targetIds }`, silently
dropping every other recorded actor key — per-step and bless selections
could never arrive through the normal action path; now merged
(behavior-preserving: `target` stays authoritative from targetIds, other
keys ride). Replay: every recording is validated at its timing point and
replayed from the captured input; fixtures re-verify `applyEvents`.
U3 REMAINS AUTHORITATIVE (candidate generation still comes from the
shared query/validateActorCandidate; only the selection/decline capture
changed). **U4 stays PARTIAL** with exact residuals: the placement
family still silently defaults the source's WHICH/WHERE choice —
Heracule "A different foe ... is shoved 1" (bastion), Holy "Cure a
character in range 2 of that foe" (chanter), Strongarm talent-1 "a
free adjacent space" shove destination (knave), Party Favor "a free
space in range 3" (`chosen ?? nearest` fail-open of an existing
recorded choice, fool), Grand Seal "Create a shrine in a free adjacent
space" (sealer summonEntity free-cell pick), warden/seer/stormbender/
chanter/harvester free-cell placements, plus the declared
abilityUseChoices/talentChoices fold reads and window-carried choice
consumers (U12/U13); Comet's weapon placement is A-class (source-
assigned "center space, or as close as possible", demon-slayer). Each
D-class site is a per-unit recorded-choice obligation for a follow-up
U4 placement tranche. Next: the placement/recorded-choice tranche
remains inside U4; the DAG's next dependency-complete underlay AFTER U4
completes is unchanged (U6-core is landed; U9 parallel T4).

**Tranche 27 — U4 actor-choice family: Heracule + Holy (2026-09-02).**
The full placement/adjudication audit (below) classified every
remaining executable default; the smallest coherent tranche was the
ACTOR-WHICH family, both mandatory choose-one effects in executable
units. (1) HERACULE (p.122 "A different foe in range 3 from your target
is shoved 1"): the sorted-id first pick is gone — the WHICH foe is
recorded per repetition under `her-shove-1`/`her-shove-2` and validated
as a member of the U3 eligible set (living on-battlefield foe in p.92
footprint range 3 of the target, main target excluded); absent with
eligible candidates → `choice.actor-required`, absent with none → the
effect is vacuous and the command proceeds, a recorded non-member →
`choice.actor-ineligible`. (2) HOLY (p.177 "Cure a character in range 2
of that foe"): the nearest-first pick is gone — the WHICH character is
recorded under `holy-cure` and validated against the U3 eligible set
(living ally in footprint range 2 of the foe's cell, the engine's
pre-existing ally restriction kept); same required/vacuous/ineligible
semantics. GLOBAL PLACEMENT ADJUDICATION (the audit's §5-6): p.95
"Unless specified, summons can only be placed in free space in line of
sight and range" is a LEGALITY constraint, not a chooser; the Harvester
summon rule ("it can be summoned in any free space in range 2 unless a
different range is listed") plus the game's board-game convention
establish that the ACTING PLAYER chooses among legal spaces — so every
"a free space"/"any free space"/"choosing a free space" placement is a
B-class recorded-position obligation (the exact residual list below).
Adversarial tests +2 (2196): Heracule missing-with-eligible → required,
main-target recording → ineligible, out-of-range recording → ineligible,
no-foe → vacuous; Holy missing-with-eligible → required, out-of-range
ally → ineligible, no-character → vacuous; every fixture re-verifies
`applyEvents`. U3 REMAINS AUTHORITATIVE (candidate generation unchanged;
only selection capture changed). U4 stays PARTIAL with the exact
residual list recorded in the matrix row: the placement family
(Party Favor `chosen ?? nearest` fail-open, Mist Strider base `??
sourcePosition` fail-open + charge cloud, Underway, Grand Seal, Geyser,
Waterspout, Dervish ally + placement, Dark Sliver soul-space
("choosing") + slay plant, Strongarm talent-1, Chaos Tarot effect 3),
the actor multi-selects (Dervish ally, Chaos Tarot effects 4/5 "up to
two"), Demon Claw Talent I/II (documented-unresolved), Holy Charge "of
your choice" (underspecified, reported not fixed), and the declared
folds + U12/U13 window choices.

**Tranche 28 — Holy source-fidelity repair: cure domain + Charge subset
(2026-09-02).** Adversarial re-review of tranche 27's Holy found a
candidate-domain defect that recording a choice did not fix: "Cure a
character in range 2 of that foe" (p.177) was implemented ally-only,
narrowing the p.92 target word CHARACTER ("All of the above" — Self,
Ally, Foe, Summon) without source authority. Adjudicated from: p.92's
explicit targeting vocabulary; the book's deliberate cure wording (PC
cures say "cure a character" — Mendicant Diaga "Cure a character in
range 4", Esper I "Cure a character in range 2 of your attack target",
Holy — while ally-only cures say so: foe Leader Diaga "An ally in range
4 is cured", Scion Great Holy "Allies in the area gain 3 vigor"); Esper
III ("Cures can target foes and deal fray damage to them instead of any
of its other effects") confirming the domain and defining the FOE mode
(fray damage instead of the normal cure) rather than forbidding foe
targets; Mercy I ("Your cures can target defeated characters") as the
explicit defeated-character extension, so defeated/off-board characters
stay excluded by U3 base eligibility. The engine's Mendicant Diaga
(no side filter) already implemented the same reading; Wish (p.203
"your ally") and the knave self-cures remain correctly scoped.
REPAIRS: (1) `holy-cure` is now validated against the full CHARACTER
set in footprint range 2 of the foe — self, allies, the attacked foe
itself (always eligible at distance 0), and other foes; the mandatory
choose-one never passes vacuous in a valid use (the attacked foe
guarantees a candidate), so a missing recording always fails closed
`choice.actor-required`. (2) Holy Charge ("Grant 3 vigor to all other
characters of your choice in range 2 of your foe") is the player's
recorded SUBSET over the CHARACTER domain excluding the acting character
("other": Sprigg Mischief "two other characters in range 2 of the
Sprigg" = other than the acting Sprigg; Slow Turn "Go after all other
characters"; Battle Demon's explicit additional-exclusion pattern "all
other characters other than natals"); absent/empty = the player chose
nobody, a recorded non-member → `choice.actor-ineligible`, duplicates
collapse; the old auto-grant to every same-side character in range is
gone. Not a registry adjudication — no two passages conflict (p.92
defines the vocabulary and no passage restricts cures); the reading is
recorded here as derived, the same home as the tranche-27 placement
convention. Tests +2 (2198): foe-cure of the attacked foe and of a
second foe, defeated-recipient rejection, Charge absent/empty no-grant,
recorded ally+foe subset both granted, acting-character and out-of-range
recordings reject; every fixture re-verifies `applyEvents`. U3 query
authority unchanged. U4 stays PARTIAL with the placement family + actor
multi-selects + Demon Claw Talent I/II as the exact residuals.

**Tranche 29 — Holy source-fidelity REVERSAL: the Cure domain is FRIENDLY
(2026-09-02).** Adversarial re-review of tranche 28 found its own
foe-inclusion argument did not survive the full-book relic census. The
decisive symmetry: Mercy I ("Your cures can target defeated
characters. If you do, they are rescued before being cured") is
NECESSARILY a domain GRANT — defeated characters are untargetable by
everything — and Esper III ("Cures can target foes and deal fray damage
to them instead of any of its other effects") uses the IDENTICAL
"cures can target X" construction; there is no textual basis to read
them asymmetrically. Corroboration: (a) Erenbrass Aspected ("Erenbrass
can affected foes") shows the book's relic-tier convention — friendly
effects reach foes only through an explicit "can target/affect foes"
grant; (b) the full-book Cure census (~25 distinct cure-granting
effects: PC Diaga, Holy, Gran Redempta, Wish, Tarot, Aria; foe Leader
Diaga, Scion, Saint, Blood Broker, Cantrix, Greenkeeper, Healing Brew)
contains ZERO baseline foe-cures — every one is friendly-side, and the
Esper relic arc (I heal → III weaponize with fray/true strike/pierce)
only coheres as granting the offensive option; (c) tranche 28's
"character vs ally word contrast" dissolves on re-read: p.92 defines
"Ally: an allied character other than you" and summons "don't count as
foes or allies", so "cure a character" vs "cure an ally" covers SELF and
SUMMON inclusion — not foe inclusion. REPAIRS: `holy-cure` is validated
against the FRIENDLY character set (side === source.side: self +
allies; friendly entity-summons remain an engine actor-domain gap) in
footprint range 2 of the foe — recording the attacked foe or another foe
fails closed `choice.actor-ineligible`; the no-friendly-target case is
RESTORED as genuinely vacuous (the mandatory cure cannot apply and the
command proceeds with the pacify alone — the tranche-28 claim that the
attacked foe always qualifies, so a missing choice never passes vacuous,
is exactly the foe-inclusion error); absent-with-eligible →
`choice.actor-required`. Holy Charge is the recorded subset over the
same FRIENDLY grant domain (beneficial grants never reach foes without
an explicit clause; the Scion mirror writes "Allies in the area gain 3
vigor") excluding the acting character — recording a foe now rejects.
SAME-FAMILY RESIDUAL (reported, not fixed — out of this unit's scope):
the EXECUTE_RULE direct-target gate validates non-attack class traits
(Diaga, Bless) with relation 'any' (`relation: tags.includes('attack') ?
'foe' : 'any'`, encounter.ts), so engine Diaga/Bless can currently target
foes; the Sweet Torment denial fixture encodes that path. A mendicant-
traits domain pass should decide whether the friendly-Cure/Bless domain
becomes a shared authority or per-trait gate relation. Derived reading,
not a registry adjudication (no two passages conflict). Tests net 0
(2198): foe-cure tests replaced with foe-rejection, vacuous case
restored, Charge foe-grant → rejection; every fixture re-verifies
`applyEvents`. U3 query authority unchanged. U4 stays PARTIAL with the
placement family + actor multi-selects + Demon Claw Talent I/II + the
mendicant-trait gate as the exact residuals.

**Tranche 30 — Holy source-fidelity REVERSAL (final): the p.92 CHARACTER
keyword is the formal domain; tranche 29's friendly-only reading is
RETRACTED (2026-09-02).** A fresh adversarial review under the
formal-keyword standard (a defined game term governs unless a genuine
rule establishes an exception) found tranche 29's reversal failed on
its own terms. The formal chain: p.92 defines "Characters: All of the
above" over a list that INCLUDES "Foe: A hostile character" — foe is
INSIDE the keyword by explicit definition — and Diaga (p.172), Holy
(p.177), and Esper I (p.249) invoke that keyword unqualified while the
Cure rules text (Recover; the Cure primers) defines only the effect and
never restricts side. Tranche 29's three pillars collapse on
re-examination: (a) the Esper/Mercy "parallel" conflates axes — Mercy I's
"cures can target defeated characters" grants a category in NO p.92
keyword, whereas Esper III's "Cures can target foes" concerns a category
INSIDE "Characters"; its operative clause is the FOE MODE ("deal fray
damage to them instead of any of its other effects"), and the book
writes "can target X" both for outside-keyword grants (p.92 summons
"can only be targeted if an ability can target all characters") and to
declare category legality for a new effect; (b) Erenbrass Aspected
(p.249) extends an "ally"-WORDED effect (lexically foe-exclusive) and
says nothing about "character"-worded effects; (c) the corpus-frequency
argument (no baseline foe-cure example) and the invented
"beneficial-effects-never-reach-foes" principle are conventions, not
rules, and are demoted below the defined term. REPAIRS: `holy-cure` is
validated against the FULL p.92 CHARACTER domain in footprint range 2 of
the foe (no side filter) — the attacked foe (distance 0) and other foes
are legal recipients and receive the standard cure effect today (Esper
III's fray-damage foe MODE is a documented-unresolved relic when relics
land); the mandatory choose-one never passes vacuous in a valid use, so
a missing recording always fails closed `choice.actor-required`; Holy
Charge's recorded subset is over the full character domain (foes legal;
its own words, and it is a vigor grant, not a Cure). The Diaga/Bless
gate 'any' relation is CONFIRMED source-correct ("a character in range
4") — the tranche-29 residual is retracted. Derived-formal reading (no
two passages conflict — the friendly reading is a plausible design
guess but has no written rule behind it); residual uncertainty noted in
the ledger. Tests net 0 (2198): foe-rejection/vacuous tests replaced
with foe-cure legality, vacuous removal restored, Charge foe-grant
restored; every fixture re-verifies `applyEvents`. U3 query authority
unchanged. U4 stays PARTIAL with the placement family + actor multi-
selects + Demon Claw Talent I/II as the exact residuals.

**Tranche 31 — claim-surface correction for tranche 30 (2026-09-02).** An
adversarial re-review of the tranche-30 commit confirmed the foe-cure
semantics (and strengthened them: p.95's tactical Summon gloss —
"abilities that specify summons or characters can target or count them
normally" — reconciles p.92's "can only be targeted if an ability can
target all characters" as category coverage, and p.107 intangible only
blocks damage/statuses FROM FOES, so a friendly cure/vigor grant to a
summon is not blocked) but found the commit's CLAIM SURFACE overstated
the implementation in one concrete respect and erased a prior
acknowledgment in another:

1. **"Full p.92 CHARACTER domain (All of the above: Self, Ally, Foe,
   Summon)" is not what the resolver spans.** `evaluateActorQuery` iterates
   `state.actors` only; every executable summon (Harvester thrall/plant,
   Warden beast, Seer wild card, Fool bomb, Shade shadow, salt-sprite,
   Grand Seal shrine...) is an entity created via `summonEntity` with no
   actor. The U3 `summon` operator expects the entity→actor bridge
   (`entity.state.actorId` → actor) that only test fixtures use; no
   production content creates the pair. So the Summon member of the p.92
   umbrella is unreachable — and because p.92+p.95 make summons legal
   recipients of character-specifying abilities (cure/vigor included), the
   gap is source-meaningful, not pedantic. Fail-closed holds (recording an
   entity id rejects `reference.missing-actor`; no summon-actor exists to
   be wrongly excluded), so NO behavior changes. Corrected in the code
   comment ("the ACTOR slice ... the Summon member is an engine-wide
   unreachable") and the census row; the only prior acknowledgment of the
   gap (tranche-29 ledger) is now carried forward in current-state text.
2. **Self-inclusion is an open derived-interpretation, not settled.** The
   p.92 Self bullet ("Abilities can't target yourself unless specified")
   sits beside the Summon bullet that demonstrably narrows the umbrella
   despite "All of the above" — structural symmetry suggests "a character"
   does not specify the self, and the book always spells self-inclusion
   (Recover "Cure yourself"; Chastise "Choose either yourself or an ally";
   God Hand "bless yourself or ally"; Gran Redempta "Cure yourself and
   every ally"; Holy Charge's sibling "You and allies..."). The competing
   reading (the Characters keyword itself is the specification) keeps the
   current tests (holy-cure: [hero.id] succeeds) defensible. NOT flipped —
   recorded as the open question it is, given three reversals on the
   adjacent keyword question.
3. **Holy Charge's "other" has a live second referent.** Sprigg/Slow Turn
   support "other = other than the acting character" (current code); the
   just-cured-recipient is the immediate grammatical antecedent of "all
   other characters" (the cure sentence precedes). Recorded, not resolved;
   the tactical delta (charging the character you just cured) is small and
   no sibling construction settles it.

No production behavior, tests, or counts changed (2,198); comment + docs
only. See `docs/underlay-completion-plan.md` (tranche-31 closure).

## Whole-consumer U1 audit (2026-09-01)

The census's longstanding "whole-consumer audit is NOT yet done" pointer
was executed at head. Findings, end-to-end:

1. **Every generic consumer routes through the ONE U1 resolution authority —
   except one site, now repaired.** The candidate/anchor
   (`kernels/candidate.ts`), selector/value (`kernels/evaluate-value.ts`),
   query (`kernels/evaluate-query.ts`), flow (`kernels/execute-flow.ts`),
   core resolvers, foe recipes, attack-provenance
   (`primitives/attack-resolution.ts` `directAttackDamageProvenance`), and
   damage-recipient reads all call `resolveActorSelectorReference` /
   `resolveReference` over the typed `Reference` vocabulary. The audit found
   ONE legacy bypass: `execute-flow.ts`'s flow `attack` case read the source
   through the raw kernel helper `actor(context, context.actorId)` (= the
   literal `state.actors[context.actorId]` the guard bans in its other two
   spellings), unreachable past the U2/U3 candidate gate but a competing
   interpreter of the same source slot with a different failure code
   (`selector.actor-missing`). It is migrated to
   `resolveReference(liveActorSlot('source'), context)` with the flow layer's
   own fail-closed problem code (`flow.attack-source`, the same family as
   `flow.resolution-reference` / `flow.terrain-reference`); the
   `u1-reference-routing` guard now pins ALL THREE legacy spellings
   (literal dereference, `sourceActor` convenience, and the `actor` helper
   form) so the bypass cannot silently return. Mutation + adversarial tests:
   guard mutation (created spill restored), engine test proving the flow
   attack's U1 source read is insertion-order independent and replays
   byte-identical, and a ghost-source test proving the shared candidate gate
   fails closed before any attack mutation is planned.
2. **The 54 CAPTURED + 1 BOUNDARY sites are genuinely caller-owned.** Site-
   by-site: every CAPTURED dereference resolves an identity that came from a
   recorded player selection (`input.actorIds?.[n]`), a recorded
   `?? attackTargetId` / `?? triggerTargetIds` fallback, a loop over a
   recorded selection array, or a caller-owned algorithm/helper parameter
   (`plannedRush` / `plannedFly` / a knock-back's passed-occupant loop) —
   never a re-derived-at-use-time legacy slot. The one
   DERIVED_OR_PRECEDENCE_BOUNDARY (Blood Grove's in-call
   `input.actorIds.target[0]` center read) keeps its exact input-wins /
   source-fallback precedence. No arbitrary-id accessor exists on the shared
   surface (the six adapter accessors are the whole surface, verified by the
   guard pin).
3. **No `state.actors[context.…]` dereference remains in generic or content
   code.** The generic-layer scan and the content-layer scan both pass;
   `context.actorId` reads that remain are provenance on emitted mutations
   (`sourceActorId:`), scheduling/ownership identity (cost payment, trigger
   resolution identity, U8/U12 `capturedActor` keys), or U4 choice-identity
   COMPARES — explicitly legitimate per the guard's documented semantics, and
   U2's role-frame projection is the disjoint retained boundary.

**Audit outcome: U1 remains PARTIAL, with one cause now resolved.** The
whole-consumer review found the one bypass above and repaired/pinned it,
and the Colossus tranche (below) closed the last PURE family. The single
remaining PARTIAL cause is now precise: the caller-owned U1×U4 captured-
identity dereferences (54 + the 1 boundary) remain without a shared
surface — each was deliberately left at the caller as U4
choice/cardinality, and the census does not count them as U1-complete until
a decision is made whether to give the captured-identity dereference a
shared surface or keep it permanently caller-owned. That is a scoping
decision, not a competing authority. Full suite 2146 green; census
byte-stable at 427; zero source promotion.

> SUPERSEDED by the U1×U4 captured-reference adjudication (sixteenth
tranche, 2026-09-02) and the lifecycle/strict-weak fold migration
(eighteenth tranche, 2026-09-02): the 51 recorded-selection dereferences
migrated through `resolveCapturedSelectedActors`, the 4 helper-parameter /
derived-loop sites were machine-reclassified NON_U1_OTHER, and the fold
surface's 39 captured derefs migrated through `resolveCapturedActor` /
`resolveCapturedActorWeak` after the lifecycle adjudication. U1 is now
AUTHORITATIVE within its declared scope (see the eighteenth-tranche
status section above); the only remaining raw `state.actors[…]` in content
are 8 machine-pinned NON-reference algorithm/helper sites.

## Known blocking repairs (source-quoted, not future work)

The trigger-authority gate (2026-09-01) closed the forged-assignment path but
left several clauses reachable only through seams the current substrate does
not provide. These are the precise blockers — each names the source passage,
what is wired, and the smallest missing reusable capability.

1. **Draken Cross mastery — DARK WIND DEVIL BLADE (p.128).**
   "After using this ability, you may teleport to any space of any area
   created, then all foes in any area you created with this ability are
   slashed and take 2 divine damage." Nothing of it is wired: the resolver
   tracks this use's area cells only locally, and there is no recorded
   teleport-choice seam tied to a durable list of "areas this use created".
   Missing capability: a U13-style recorded choice whose destination set is
   the durable area-cell record of the CURRENT resolution, applied through
   the shared movement authority before the status/divine-damage fold.

2. **RESOLVED 2026-09-01 — Takedown exceed true-strike half (p.135).**
   "Exceed or Heroic: Gains true strike and creates a pit under your
   target." The exceed-granted true strike now folds ON THE CURRENT attack
   through the generic staged seam (`trueStrikeOnExceed` in the shared
   attack authority, kernels/attack-resolution.ts): exceed is derived from
   the PRE-fold roll total (no circularity, no second determination), then
   the granted true strike applies before the hit/miss damage resolves —
   dodge ignored via the same shared damage provenance. NEVER a "next
   attack" grant: the earlier draft here proposed armed next-attack
   semantics, which the source does not support. The pit fires through the
   program's `exceed` trigger step (the SAME 15+ roll) and the heroic arm
   through the attack-heroic step; the resolver emits the heroic-only pit.
   Remaining under the mastery: Fierce Elbow's per-elevation-difference 2
   damage (once after the ability resolves, max three times), which needs
   the recorded attack-start elevation difference — a separate blocker.

3. **Gigaton Whip exceed half (p.137).** "Exceed or Heroic: Smash the ground
   when you land, creating difficult terrain under your foe and in two
   adjacent spaces." The heroic arm is wired; the exceed arm is unwired — it
   must derive from the ability's own 15+ roll AND its "when you land"
   geometry (under the foe plus two specific adjacent spaces) that tracks
   the collide-bounce landing, which the generic terrain step (target
   position only) cannot express. Missing capability: a terrain effect that
   keys off the collision-resolution landing cell rather than the raw
   attack-target cell.

4. **ALL resolver-local "Collide/Slay" legs (the 12 audited sites).** The
   outcome-trigger audit inventories 12 resolver-internal legs: bastion
   Heracule/Valiant "Collide or Heroic" repetition (p.122 "use again"/"rush
   1 again"), colossus Gigaton Whip collide-bounce (p.137), harvester
   REAP/Harvest/Dark Sliver Slay continuations (p.182–188), knave Slay legs
   (4 sites), spellblade Blitz Slay repeat (p.225, retained reachable via
   its `infuse` leg), and stormbender collide pit (p.233, `infuse &&`
   collide). Each resolves from the trigger set present at RESOLVER start;
   the reactive append pass derives collide/slay only from mutations ALREADY
   emitted and re-enters trigger STEPS only, never resolver code. The
   bastion Valiant and harvester REAP/Harvest legs are proven at the
   resolver contract level by direct-context clause tests (recorded facts),
   and spellblade's GRAM leg is covered through its `infuse` arm. Every
   other leg keeps a caller-assertable heroic/infuse arm EXCEPT knave line 110
   (the Slay-only shove leg after the multi-hit attack), which has NO
   caller-reachable arm and is fully dormant until the seam below lands. No
   approximation was substituted anywhere. Missing capability: a re-entrant
   resolver pass for newly derived triggers, or step-ized continuations
   (valiant's rush-then-shove chain is not yet expressible as step effects;
   Gigaton's difficult-terrain "when you land" geometry needs a
   collision-landing terrain key — see (3)).

These five are ALL deliberate retains: the trigger-authority gate never
approximated, never routed a forge through, and never changed blocker census
(427) or U1 (PARTIAL).
