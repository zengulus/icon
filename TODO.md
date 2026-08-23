# ICON Companion — orchestrator handoff

This is the starting point for any future agent working in this repository. It
is a coordination and delivery guide, not a substitute for source rules or
acceptance tests.

Read, in order:

1. [`README.md`](README.md) for product and deployment boundaries.
2. [`docs/roadmap.md`](docs/roadmap.md) for phase status.
3. The subsystem-specific document named below before changing that subsystem.
4. Existing tests around the behavior before modifying implementation.

## Product invariants — do not weaken these

| Invariant | Meaning | Where to verify |
| --- | --- | --- |
| Public Lab | `#/lab` is a browser-local human-testing service at **every** phase. It uses no Supabase, Render, authentication, realtime connection, or shared checkpoint, and may deploy on GitHub Pages. | `src/App.tsx`, `src/pages/BrowserVtt.tsx`, `src/vtt/`, browser E2E |
| Authoritative VTT | `#/vtt/:encounterId` is the real shared room and remains phase-gated until release criteria are genuinely met. | `src/App.tsx`, `src/rules/catalog.ts`, `server/index.ts`, transport E2E |
| Server authority | Browser clients never write live encounter state or durable checkpoints. Render validates commands, permissions, revisions, and redaction; its service role is the checkpoint writer. | `server/rooms.ts`, `server/checkpoints.ts`, `supabase/migrations/` |
| Conservative automation | Parser output is not execution authority. A rule becomes executable only through an explicit reviewed program/recipe with source-page and replay evidence. | `docs/rules-coverage.md`, `src/rules/automation/content/glue/manual-programs.ts` |
| Replayability | Durable events and checkpoints must yield the same canonical state on replay/hydration. | `src/rules/encounter.ts`, `src/rules/vtt-room.ts`, `server/__tests__/` |
| Single live authority | The realtime room manager is deliberately single-instance. Do not horizontally scale or overlap Render deployments until there is a fenced lease/relay design. | `README.md`, `server/rooms.ts` |

`PHASE_TWO_READY` and `PHASE_THREE_READY` are intentionally `false`. Do not
flip a gate to make a route available, satisfy a test, or ship a partial
subsystem.

## System map

| Area | Start here | Supporting references |
| --- | --- | --- |
| Routes, client shells, local Lab | `src/App.tsx`, `src/pages/BrowserVtt.tsx`, `src/pages/Sandbox.tsx` | `src/vtt/`, browser E2E |
| Character creation, import, local/cloud persistence | `src/rules/character.ts`, `src/services/characters.ts`, `src/context/CharacterContext.tsx` | `src/rules/__tests__/character.test.ts`, `src/services/__tests__/characters.test.ts` |
| Shared combat state and replay | `src/rules/encounter.ts`, `src/rules/types.ts`, `src/rules/vtt-room.ts` | `src/rules/__tests__/encounter.test.ts`, `server/__tests__/rooms.test.ts` |
| Rules programs, source coverage, extraction | `src/rules/automation/`, `src/rules/source-units.ts` | [`docs/rules-coverage.md`](docs/rules-coverage.md), `scripts/audit-automation.ts` |
| Damage, target, save, and turn foundations | `src/rules/automation/kernels/encounter-adapter.ts` | [`docs/rules-foundations.md`](docs/rules-foundations.md) |
| Realtime client/server | `src/services/realtime.ts`, `server/index.ts`, `server/rooms.ts` | `scripts/e2e-realtime.mjs`, `src/services/__tests__/realtime.test.ts` |
| Checkpoints and Supabase schema | `server/checkpoints.ts`, `supabase/migrations/` | `server/__tests__/checkpoints.test.ts`, README Supabase section |
| Geometry/table/fog/annotations | `src/vtt/`, `src/rules/vtt-room.ts` | `src/vtt/__tests__/`, `src/rules/__tests__/vtt-room.test.ts` |
| Build, Pages, CI, Render | `package.json`, `vite.config.ts`, `.github/workflows/ci.yml`, `render.yaml` | README deployment sections |

## Immediate rule-engine repair queue

These are concrete replay/authority defects found after the latest damage
work. Repair them before promoting new damage, trait, or foe coverage.

1. **Persist Defiance’s application result for legacy attack/Vigilance events.**
   **Repaired.** `ATTACK_RESOLVED` and `VIGILANCE_SPENT` previously recorded an
   amount after the 1-HP Defiance floor, then replay re-inferred Defiance from
   that reduced amount, so a lethal hit could replay with Defiance still
   present and without its temporary immunity. Event construction now records
   a durable `defianceTriggered` result (`src/rules/encounter.ts`); the
   application kernel honors it via an `EncounterHeldDamage.defianceTriggered`
   override (`src/rules/automation/kernels/encounter-adapter.ts`
   `applyDeterminedEncounterDamage`); and replay passes it through for both
   event shapes. Fresh held interrupt windows never persist the flag — they
   carry the full determined amount and still re-infer. Defiance replay
   fixtures cover both event shapes (`__tests__/encounter.test.ts`,
   `__tests__/conditions.test.ts`).
2. **Open a defeated interrupt window only for an actual defeat.**
   **Repaired.** VM `applyDamage` now computes prospective applied defeat —
   the determined amount against HP+vigor, minus Defiance (p.104) and Defy
   Death (p.138) application-time floors — before arming Boiling Blood’s
   `defeated` window, mirroring the exact test the application kernel uses.
   Fixtures cover a defiant hero and an already-defy-death hero with only the
   defeated interrupt available (`__tests__/colossus.test.ts`).
3. **Do not preempt Masquerade using raw damage.**
   **Repaired.** `deferrableEffectWindow` previously let a hypothetical
   defeated/when-damaged window suppress Masquerade from the raw mutation
   amount, so armor/resistance absorption or a Defiance/Defy Death floor could
   prevent that window and leave neither interrupt. The priority check now
   mirrors the damage pipeline: it determines the blow through the shared
   kernel, lets Masquerade win when no damage window would actually open
   (including a fully mitigated amount), and uses the shared
   `prospectiveAppliedDefeat` gate before preferring a `defeated` window
   (`src/rules/automation/kernels/encounter-adapter.ts`). Window-order regressions
   cover armor mitigation, Defiance protection, and the genuinely-lethal
   control (`__tests__/fool.test.ts`).
4. **Gate Bleak Mercy on statuses, not broad conditions.**
   **Repaired.** ICON p.144 requires three or more *statuses*; the resolver
   now counts the status-only projection instead of every projected condition,
   so passive positive conditions (Counter, Defiance, Resistance) can no
   longer grant the true-strike/bypass package
   (`src/rules/automation/content/jobs/programs/knave-programs.ts`). A three-positive-conditions
   negative fixture joins the existing p.144 replay cases
   (`__tests__/knave.test.ts`).

All four repairs are closed and replay-verified. Do not reopen them by
removing replay tests, reclassifying a recorded amount as raw, weakening
Defiance/Defy Death, or changing the source text.

## Active work tracks and safe order

### 1. Rules foundations — current highest-leverage track

Read [`docs/rules-foundations.md`](docs/rules-foundations.md) fully. Work in
this order:

1. Complete durable `DamageIntent → DeterminedDamage → AppliedDamage` and
   `AttackResolution` records before promoting broad damage, defense, or role
   traits.
2. Extend `TargetQuery` into `SpatialIntent` before expanding areas,
   teleports, forced movement, or arbitrary target selectors.
3. Generalize `SaveWindow` and then the ordered turn-boundary plan. Preserve
   recorded dice and explicit choice consumption.
4. Only then add closed source-ID passive recipes (Rot/Regeneration, foe role
   baselines, Defiance/Counter/Dodge/Sturdy delivery matrices).

Rules-specific hard stops:

- A raw amount must go through `determineAndApplyEncounterDamage`; a persisted
  final amount must go through `applyDeterminedEncounterDamage`. Never add an
  unlabeled numeric damage field or alternate mitigation arithmetic.
- `bypassVigor`, `ignoreArmor`, and `ignoreDefiance` are distinct source
  exceptions. Do not use `divine` as shorthand for a partial bypass.
- Slashed applies after a self/ally **ability** move, once per turn. Lifecycle
  source/self movement must use `applyLifecycleAbilityMove`; core Move/Dash
  must not consume it.
- Do not turn parser-complete source text into `EXECUTE_RULE` authority without
  an allowlist entry, source-page fixture, and deterministic replay test.
- A reducer improvement does not change automation-audit numbers on its own.

### 2. Lab usability and local VTT acceptance

Keep the Lab useful for human testing without connecting it to backend systems.
Favor shared reducer/session/viewport behavior over duplicate simulation code.

Before claiming a Lab interaction complete, exercise its persisted browser
state, reload behavior, and deterministic reducer replay. Browser-only work
must not add an E2E identity marker, loopback websocket CSP allowance, or
backend configuration to production output.

### 3. Authoritative rooms, privacy, and durability

Treat `server/rooms.ts` and Supabase migrations as security-sensitive.

- Revalidate command ownership, role, revision, and visibility before reducer
  execution. Player input must not resolve against hidden state in a way that
  leaks identities, coordinates, terrain, or rules text.
- Keep player room/event projections redacted. New state fields need ownership
  provenance and projection tests before they can originate from hidden actors.
- Preserve checkpoint append-only/CAS semantics, strict hydration, bounded
  retention/event history, and hard-save acknowledgement only after a durable
  write succeeds.
- Treat dynamic runtime authority as single-instance until a real lease/relay
  design exists. Do not solve a scale problem by relaxing ordering or CAS.

### 4. Character/import and generated-content integrity

- Current-schema malformed or future-version records must reject/quarantine;
  they must never be silently defaulted and then overwritten on next save.
- Keep local recovery copies before repairing persisted data. Isolate bad cloud
  rows rather than discarding a healthy roster.
- Generated source artifacts are checked in. Extraction changes require the
  supplied PDF and `npm run verify:extraction`; hosted CI intentionally checks
  the no-PDF evidence path instead.

## Content coverage inventory — concrete future work

Catalog presence, a rendered rules card, or a parser-complete source unit is
not automation coverage. Consult [`docs/rules-coverage.md`](docs/rules-coverage.md)
and `npm run audit:automation` before claiming any item below is complete.

| Area | What exists now | Concrete remaining work and safe entry point |
| --- | --- | --- |
| **Job abilities** | All 16 Jobs / 144 active abilities have reviewed typed programs and replay fixtures. This does **not** release Phase 2. | Keep source-specific behavior honest while foundations are incomplete. Any new conditional behavior must use the shared damage/target/save/turn contracts, not an ability-local shortcut. Start in `src/rules/automation/content/jobs/programs/*-programs.ts` and its job fixture. |
| **Class and Job traits** | 22 Job traits are wired with engine mechanics across five wiring homes (condition projections, combat-start grants/companion summons, lifecycle recipes, active resolvers, command/kernel hooks); 43 remain documented. The audit still lists **8 class-trait** and **43 job-trait** source units unresolved. | Implement closed source-ID recipes only after their prerequisite foundation works. Do not infer a trait from title or prose. Start in `automation/passive-projection.ts`, `manual-programs.ts`, and the exact source unit/fixture. |
| **Talents and masteries** | Catalogued and validated for builds. 32 talents are executable (29 wired fold + 3 program-level); 256 remain documented. The audit lists **256 talents** and **144 masteries** unresolved. | Sort into passive projection, command-time resolution, lifecycle hook, table-facing choice, or unavailable. Promote a small exact-ID slice with source-page/replay evidence; do not bulk-enable by parser result. |
| **Limit Breaks and Job summons** | Limit Breaks structured in catalog/loadout validation; summon placement, ownership, and entity caps are wired (`summon-recipes.ts`). The audit lists **16 limit-break** units unresolved; the 6 summon-rule source units are complete. | Finish `SpatialIntent`, targeting, entities, areas, lifecycle, and ownership/projection semantics before automation. Start in `src/rules/automation/`, `src/rules/encounter.ts`, and `src/rules/vtt-room.ts`; add server redaction tests for owner-visible state. |
| **Relics** | All 40 Relics, ranks I–III, aspects, and character validation exist. The audit lists **120 relic-rank** and **40 relic-aspect** units unresolved. | Relic invokes, persistent effects, aspect transitions, and table choices must be classified individually. Do not route a Relic through generic `EXECUTE_RULE` without an explicit recipe and durable lifecycle/projection design. Start in `src/rules/catalog.ts`, `src/rules/character.ts`, and relic source units. |
| **Foe abilities** | 449 profiles/components with 1,365 catalogued abilities; 22 exact reviewed recipe abilities are active. | The remaining catalog abilities are not independent authority. The audit separately tracks **1,247 traceable foe-ability** units plus phases/chapter rules. Prefer bounded attack-tagged recipes only after target/damage contracts are ready; do not implement mobs, areas, summons, or phases through client assertions. Start in `automation/foe-recipes.ts`, `foes.ts`, and `__tests__/foe.test.ts`. |
| **Foe traits, roles, phases, and chapter rules** | The p.298 role baselines (Skirmisher/Heavy/Artillery/Legend) project through closed `FOE_ROLE_BASELINE_RECIPES`; 36 Flying/Phasing foe trait IDs project through the manifest. The audit lists **612 foe traits**, **19 foe phases**, and **116 foe chapter rules** unresolved. | Extend passive-projection closed-ID rows after damage/target/lifecycle contracts. Build exact source-ID manifests; never derive mechanics from a role label or trait text at runtime. |
| **Core combat** | Shared reducer and initial damage/attack/save/target/turn seams exist. The audit still lists **70 core** source units unresolved. | Complete the immediate repair queue and foundations before promoting Defiance, Counter, Dodge, Sturdy, Vigilance, Regeneration, broad areas, summons, and trigger ordering. See `docs/rules-foundations.md`. |
| **Bonds, powers, rewards, trophies, camp** | Character choices and content are visible/validated; narrative outcomes are table-facing. Audit backlog includes **68 trophies**, **16 camp fixtures**, **85 camp features**, and **9 reward rules**. | Keep narrative/freeform choices visible and non-authoritative until a deterministic source-backed model exists. Do not fabricate combat outcomes from descriptive text. |

When selecting a coverage slice, pick one exact source behavior whose target,
cost, timing, save/damage/movement semantics, ownership, and replay shape are
already supported. If any prerequisite is missing, leave it source-visible and
add a source-linked TODO at that prerequisite instead of approximating it.

## What not to do

- Do not relax phase gates, RLS, server-side authorization, checkpoint
  ownership, revision checks, or redaction to make a feature easier to demo.
- Do not expose a Supabase service-role secret, Discord webhook, dev-auth
  token, E2E identity path, or loopback-only CSP rule in a production build.
- Do not mutate a shared room from the browser, trust client role/actor IDs,
  or make player actions reveal hidden information through success, error,
  damage, cost, or event payloads.
- Do not use prose heuristics for traits/roles/powers, silently approximate
  unimplemented rules, or claim broad source coverage from a generic fallback.
- Do not bypass source migration/strict validation by defaulting malformed
  objects, stripping unknown data, or rewriting future rules versions.
- Do not discard unrelated changes in this intentionally dirty worktree.
  Inspect the diff first; make narrow patches and preserve concurrent work.
- Do not add a deployment, remote configuration, database migration, or
  external message outside the user-authorized scope.

## Working protocol for an orchestrator

1. **Establish scope.** Identify the affected product boundary and read its
   tests/docs before changing code. Split only independent, bounded work; do
   not let parallel edits collide in shared reducer/protocol files.
2. **Keep authority narrow.** Prefer data/validation/projection changes to UI
   claims. If a requirement needs a user choice, external configuration, or a
   release decision, report the blocker instead of assuming it.
3. **Make handoffs explicit.** For every partial implementation, leave a
   source-linked `TODO(ICON-rules, p.X)` or equivalent implementation note at
   the seam, plus a concise doc entry explaining prerequisite, safe next step,
   and what must not be inferred.
4. **Test at the boundary.** Add unit tests for pure logic, reducer replay for
   durable state, server integration for authority/redaction/checkpoints, and
   browser E2E for a user-visible flow when appropriate.
5. **Report honestly.** State what is verified, what remains gated, audit
   deltas (only if authority changed), and deployment constraints. Never call
   a phase ready merely because a focused test passes.

## Verification baseline

Run the smallest relevant test while iterating, then run the applicable final
checks:

```sh
npm test
npm run typecheck
npm run audit:automation
npm run test:e2e       # routes, realtime, auth, or room behavior
npm run build          # client/server/deployment changes
git diff --check
```

For generated-content changes, also run `npm run verify:extraction` locally
with the supplied PDF. For Supabase migration changes, add or extend a
migration test and manually review RLS/RPC authority as part of the change.

## Definition of done

A task is done only when its behavior is implemented within the correct
authority boundary, its durable representation is validated and replay-safe,
its user-visible surface is covered where relevant, its source/docs/audit
claims are truthful, and the appropriate checks above pass.
