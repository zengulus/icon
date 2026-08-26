# ICON Remaining Work

This is the **current actionable backlog**, rebuilt from the full-repository
audit of 2026-08-25 (commit `55c7b6f` and later). It contains no completed
work except where a dependency must be explained.

Canonical document ownership:

| Question | Document |
| --- | --- |
| What is this project? What works today? | [`README.md`](README.md) |
| In what order do we build it? Phase gates? | [`docs/roadmap.md`](docs/roadmap.md) |
| What are the concrete artifacts and their completion criteria? | [`docs/deliverables.md`](docs/deliverables.md) |
| Which mechanic foundations exist and how mature are they? | [`docs/rules-foundations.md`](docs/rules-foundations.md) |
| What content can execute, at what level? | [`docs/rules-coverage.md`](docs/rules-coverage.md) |
| Machine-generated Class/Job unit dependency graph | [`docs/blocker-census.md`](docs/blocker-census.md) (**generated** — `npm run audit:class-job-census`; never hand-edit) |
| Genuine source-text contradictions only | [`docs/source-adjudications.md`](docs/source-adjudications.md) |

Status vocabulary used below: `BLOCKED` · `READY` · `PARTIAL` ·
`SOURCE/ADJUDICATION NEEDED` · `TABLE-FACING` · `DONE`.

---

## Current execution plan (ordered)

This is the canonical step-by-step execution order. It sequences the
backlog sections and roadmap priorities below; it does not replace them —
each step links to the section that owns its detail. Work proceeds one step
at a time; each step ends with a semantic audit against the step's meaning
(not merely green tests), regeneration of every generated artifact its
generator says is affected, and updated documentation recording the actual
resulting state. If evidence discovered during a step contradicts an order
assumption here, document the evidence and update this list before proceeding.

1. **Verify canonical census + full verification baseline.** — `DONE`
   (2026-08-26). Census regenerates byte-stable under strict mode; full
   baseline green.
2. **Remove temporary/debug artifacts; reconcile docs with `main`.** —
   `DONE` (2026-08-26). Deleted committed throwaway
   `scripts/page-dump.tmp.ts`; reconciled rules-foundations (K-P5 landed
   state), rules-coverage (mastery/census figures), deliverables (Slice B
   blocking statement) with the landed mastery-fold work.
3. **Decompose all remaining `{irreducible}` census entries** (78 units)
   into concrete implementable blocker families or explicitly
   non-automatable/table-facing classifications; regenerate the census
   afterward. — `DONE` (2026-08-26). All 78 audited against full source text
   in the census tool's reclassification registry: every unit now carries a
   concrete implementable blocker set (existing families reused where the
   semantics match, e.g. shove-modifier/effect-count/fly-grant; ~30 new
   named reusable families for genuinely distinct mechanics such as
   area-effect-rider, use-count-override, card-deck-system,
   enemy-ability-trigger). NONE qualified as non-automatable/table-facing.
   Census regenerated: residual 0; no non-implementable class remains.
4. **Shared spatial primitives: Teleport, Place, Remove, Swap** — `PARTIAL`
   (2026-08-26). The spatial gateway (`primitives/spatial-intent.ts`) and the
   mutation builders (`removeMutation`/`placeMutation`/`teleportMutation`)
   were already shared; this tranche landed the Swap primitive
   (`swapMutations`, `primitives/job-kit.ts`) with an explicit source-defined
   movement mode: teleporting swap (Masquerade p.151 "teleporting both" — legs
   are `movement: 'teleport'`, Rampart p.104-checked) vs remove/place swap
   (Shadow Play p.163, Redondo p.300, Chanter Purgatorio rotation — legs are
   `movement: 'place'`, never teleports). All four swap emitters migrated off
   hand-rolled place pairs; fixtures distinguish the flavors (Masquerade legs
   assert `teleport` and are Rampart-denied; Shadow Play legs assert `place`
   and cross the same boundary freely); forced moves keep voluntary-only
   movement-entry triggers and untouched turn entitlement. Remaining in step
   4: terrain-create/entity-create, then fly/movement-grant primitives; then
   promote the census `{teleport}`×15 units (step 5 discipline).
5. **Promote-after-landing discipline.** After each primitive/foundation
   lands, immediately promote every source unit whose blocker set becomes
   empty, with source-exact fixtures and replay coverage, then regenerate
   the census (this is §9 of AGENTS.md applied per-step rather than
   per-batch).
6. **Expand mastery/talent folds by regenerated census frequency**
   (roadmap P3; F2/F5–F8): reusable high-fan-out modifier families first;
   each modifier's mechanical authority lives at the existing mechanic's own
   query point (e.g. the interrupt allowance reader, the damage pipeline),
   never in a parallel mastery-specific subsystem.
7. **Close one deliberately complex player-content vertical slice end to
   end:** persistent character → encounter → talents/masteries/interrupts/
   movement/status interactions → deterministic replay → settlement →
   projected character → subsequent encounter (Slice B closure path;
   [`deliverables.md`](docs/deliverables.md)).
8. **Relic invoke/persistent-effect runtime** as typed source-traceable
   recipes (roadmap P5; F9), closing the corresponding player-complexity
   requirements.
9. **Trigger-driven Vigilance** from real damage/movement trigger records
   through the existing window protocol (B4).
10. **Foe phase transitions + chapter-rule execution**, incl. one
    source-exact phased Legend end to end (B3).
11. **Mob member-state model**: member count, hit accounting, removal,
    slay suppression, replay, and a full Mob encounter fixture (B2).

---

## Immediate correctness blockers

These precede breadth work. Each has a concrete acceptance condition.

### B1. Elite and Legend multi-turn entitlements — `DONE` (2026-08-26)

Production entitlement rows live in
`src/rules/automation/content/foes/turn-entitlement-recipes.ts`: an Elite
(`foeKind === 'elite'`, projected durably onto the actor like `roleId`) owes 2
turns per round (p.299); a Legend (`roleId === 'legend'`) owes one turn per
player character read from live encounter state each round (p.298).
The count includes DEFEATED PCs — a pinned reading of source silence, not an
adjudication (no second passage contradicts it). Acceptance matrix incl.
round-boundary refresh, Slow/Delay interaction, replay, and source-exact
Elite/Legend fixtures: `src/rules/__tests__/foe-turn-entitlements.test.ts`.
The scheduler's Slow-phase transition was repaired so a multi-turn actor whose
forced Delay turn consumed its pending flag continues the SAME round with its
leftover normal entitlement instead of ending the round early.

### B2. Mob foes cannot exist at all — `BLOCKED` on a member model

**Problem.** `createFoeFromProfile` throws `foe.mob-unsupported` for the mob
role. Mobs need member-level state (two members per player, removed after two
hits, no slay triggering) that the single-body `EncounterActor` cannot
represent.

**Acceptance condition.** A designed member representation (entity pool or
actor-with-members) with hits accounting, removal, and slay-suppression, plus
one full Mob encounter test.

### B3. Foe phases and chapter rules are inert data — `PARTIAL`

**Problem.** Profiles carry parsed `phases` and `chapterRules`
(`content/generated/foes-1.5.json`, projected in `src/rules/foes.ts`), and
`createFoeFromProfile` seeds `ruleState.phaseId` with the first phase — but
no engine reads either. Phase transitions and chapter-scaling rules never
execute.

**Acceptance condition.** A phase-transition kernel (trigger → transition,
recorded durably for replay) and chapter-rule rows wired like trait recipes;
one source-exact phased legend as the first consumer.

### B4. Vigilance is command-driven, not trigger-driven — `PARTIAL`

**Problem.** Vigilance spends run through the dedicated `SPEND_VIGILANCE`
command with declared results (fixture-grade). The p.105 triggers (ally
within range 2 takes damage / foe enters adjacency) never open a window, and
range-2 eligibility is not enforced from a trigger record.

**Acceptance condition.** Guard/punish windows open from real damage/movement
triggers through the existing window protocol (`decideDamageWindow` family),
with once-per-trigger ledger and replay fixtures.

---

## Foundational mechanics (high fan-out)

Ordered roughly by how many otherwise-valid source units they unblock (see
also `docs/blocker-census.json` `blockerFrequencies`):

| # | Foundation | Status | Unblocks (approx.) | Notes |
| --- | --- | --- | --- | --- |
| F1 | Teleport / Place / Remove / Swap as shared forced-movement primitives | PARTIAL (shared gateway + builders + Swap primitive landed 2026-08-26; emitters migrated; census promotion pending) | 15+ talents, several abilities | Census top blocker `{teleport}` |
| F2 | Interrupt-modifier family (rank change, extra uses, timing override) | PARTIAL | 13+ talents | Census `{interrupt-modifier}` |
| F3 | Terrain-create / entity-create recipe primitives | PARTIAL (job-program-local today) | 13 + 13 talents/abilities | Generalize from existing resolvers |
| F4 | Fly-grant / movement-modifier primitives | PARTIAL | 11+ | Census `{fly-grant}` |
| F5 | Mark-modifier family | PARTIAL | 11+ | |
| F6 | Damage-modifier family beyond bonus dice | PARTIAL | 11+ | |
| F7 | Mastery fold (equipped mastery alters parent ability) | PARTIAL (modifier kernel K-P5 live; 3 wired, 133 unresolved) | 133 masteries | Biggest single content family |
| F8 | Talent subfamilies: resource-management, action-type-change, charge-state, shove-modifier | PARTIAL (47/288 wired) | ~200 talents | See census frequencies |
| F9 | Relic invoke/persistent-effect runtime | NOT STARTED | 120 relic-ranks + 40 aspects | Structured catalog exists |
| F10 | Expedition scene flow (camp/interlude as playable steps around the sheet transitions) | PARTIAL (sheet transitions DONE) | cross-combat play UX | |

---

## Encounter-closure blockers

The canonical slices live in [`docs/deliverables.md`](docs/deliverables.md)
§Encounter closure. Current first unsupported dependency per slice:

- **Slice A (baseline)**: CLOSED — setup through combat exit incl. settlement.
- **Slice B (player complexity)**: blocked on mastery/talent folds (F7/F8),
  Relic runtime (F9), Vigilance windows (B4).
- **Slice C (foe complexity)**: Elite/Legend entitlements done (B1,
  2026-08-26); remaining blockers are foe traits beyond keywords (590 rows)
  and phases/chapter rules (B3).
- **Slice D (attrition chain)**: settlement + projection DONE; remaining
  blocker is camp/interlude *scene flow* around the (already implemented)
  sheet transitions.

## Player content

- **Class traits** — `PARTIAL`: Mendicant slice (Diaga/Bless/Succor) done;
  **7 unresolved** (audit `class-trait`). Classify each: passive projection /
  command-time / table-facing.
- **Job traits** — `PARTIAL`: 27/65 wired across the five wiring homes;
  **38 documented** rows remain, each carrying its kernel need. Work the
  highest-frequency kernel first (see F1–F6), then harvest rows.
- **Talents** — `PARTIAL`: 47/288 executable (fold, program-level, aura
  projection, range/area modifiers). **241 unresolved**. Do not bulk-enable;
  promote exact-ID slices per subfamily with replay fixtures.
- **Masteries** — `PARTIAL`: equipped-mastery surface is validated and
  durable; the mastery-modifier fold (K-P5: interrupt-rank, damage-type
  conversion, unlimited range) promotes 3 rows; **133 unresolved**. Broader
  promotion needs more modifier families added to the fold.
- **Limit Breaks** — `SOURCE/ADJUDICATION NEEDED` + `PARTIAL`: costs parse and
  pay through the resolve pool; the 16 limit-break effect bodies are
  unresolved. Unlock level is adjudicated at level 1
  (`docs/source-adjudications.md`). Availability gating does not exist yet.
- **Relics** — structured only (ranks, aspects, quests validate in the
  character engine; Refocus/infusion transitions are DONE). Invoke and
  persistent-effect automation is F9, not started.

## Foe content

- **Regular foes** — `PARTIAL`: standard profile construction + basic attacks
  work; **22 abilities** across 7 faction profiles execute as declarative
  recipes. Extend the recipe factory set before adding profiles (data-only +
  one fixture each).
- **Templates/factions** — remaining faction profiles need the recipe kinds
  above; prose traits stay table-facing.
- **Mob** — B2.
- **Elite** — double HP DONE; two turns per round DONE (2026-08-26, B1).
- **Legend** — HP scaling DONE; per-player turns DONE (2026-08-26, B1;
  defeated PCs counted — pinned reading of source silence); Juggernaut
  round-start clear DONE; component ability inheritance DONE.
- **Traits** — 79 keyword rows fully executable, 36 partial projections;
  **590 traceable foe-trait units** unresolved overall. Prose traits are
  table-facing by design.
- **Phases / chapter rules** — B3.

## Persistent / expedition lifecycle

- Character schema v4, import/export, migration v1→v4: `DONE`.
- Settlement & attrition handoff (`ENCOUNTER_ENDED` personal Resolve +1,
  `characterFromActor` projection of HP attrition/wounds/resolve): `DONE`
  (2026-08-25, roadmap P1).
- Camp/interlude sheet transitions (`campCharacter`, `beginInterlude`):
  `DONE`; playable camp/interlude scene flow around them: `NOT STARTED`.
- Trophies (68), camp fixtures (16), features (85), reward rules (9):
  structured/table-facing; deterministic subset needs classification before
  any automation.

## Narrative deterministic mechanics

- Zero-rating rolls, boons/curses, criticals: `DONE`.
- Effort/Strain spending and Second Wind recovery: registry + validation
  `DONE`; bond-power execution effects are `TABLE-FACING`.
- Clocks/burdens/ambitions progress trackers: `NOT STARTED`.
- Expedition structure itself: `NOT STARTED` (roadmap Phase 4).

## VTT / realtime

- Lab (`#/lab`): explicit actor selection, movement, attacks, ability use,
  persistence/reload/replay — `DONE` as a human-testing harness.
- Shared VTT route + Render authority: engineering preview, gated behind
  `PHASE_THREE_READY`; transport acceptance passes. Missing: GM tooling parity
  with Lab, reconnect UX under load, campaign invitation/session flow.
- Single-instance room manager: intentional; do not scale horizontally.

## Later polish

- Compendium search UX, token art pipeline, map asset management, mobile
  layout, sound/log filtering. Nothing here blocks rules authority.
- Animated 3D dice presentation — strictly presentation-layer staged
  roll-result choreography; requirements and the authority boundary are
  recorded in [`docs/dice-presentation.md`](docs/dice-presentation.md). Not a
  phase gate; nothing here blocks rules authority.

---

## Verification baseline (unchanged)

```sh
npm test
npm run typecheck
npm run audit:automation
npm run test:e2e
npm run build
git diff --check
# generated-content changes only:
npm run verify:extraction   # requires the supplied PDF locally
```

Observed at the B1 commit: unit 78 files / 1053 tests green; realtime
transport acceptance green (one stale phase-gate message assertion repaired —
commit `451205b` renamed the server gate message without updating the e2e
regex); browser acceptance requires Playwright's Chromium system libraries on
the host (`npx playwright install chromium`, plus e.g. libnspr4/libnss3);
architecture audit green (84 files); automation audit green with 3,103
explicitly unsupported clauses (expected while incomplete); strict
source-fidelity audit green with incompleteness reported as lowered status.
`verify:source-artifacts -- --expect-source-pdf=absent` fails only on
machines where the untracked PDF exists (it is a hosted-CI check; the default
invocation passes locally).
