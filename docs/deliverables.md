# Deliverables

What must exist for the product to be genuinely complete, translated from
[`roadmap.md`](roadmap.md). Status vocabulary: `COMPLETE` · `PARTIAL` ·
`NOT STARTED` · `BLOCKED` · `TABLE-FACING / NOT SOFTWARE`.

| Deliverable | Status | Owner/subsystem | Completion condition |
| --- | --- | --- | --- |
| Source provenance pipeline | COMPLETE | `scripts/extract-*`, `content/generated/`, digest evidence | 501 pages extracted; pinned SHA-256; byte-for-byte regeneration with the PDF (`verify:extraction`); hosted CI validates checked-in artifacts without the PDF |
| Character rules engine | COMPLETE | `src/rules/character.ts`, `types.ts` (schema v5) | Creation/advancement validation, import/export, v1→v5 migration, strict version rejection, perspective narrative selections as permanent canonical IDs — all tested |
| Encounter command/event engine | COMPLETE (core) / PARTIAL (breadth) | `src/rules/encounter.ts`, `types.ts` | Purity contract + exact replay for every command; remaining breadth = new commands only |
| Turn scheduler | COMPLETE | `src/rules/turn-scheduler.ts` | Explicit side/phase authority, controller-chosen actors, Slow lifecycle, pending Delay, multi-turn entitlements — replay-tested |
| Damage kernel | AUTHORITATIVE | `automation/kernels/encounter-adapter.ts`, `damage-resolution`, `damage-ledger` | Determine → apply pipeline, armor/resistance/weakened/vulnerable/pierce/divine/vigor/Defiance/Defy Death, held damage, wounds on defeat |
| Attack kernel | AUTHORITATIVE | `attack-resolution`, `attack-modifiers` | Roll, boons/curses, crit ≥20, Exceed ≥15, True Strike/Unerring/Evasion/Dodge/Stealth/Cover |
| Save kernel | PARTIAL | `save-window` primitives, status-save ledger | Normal saves + reroll windows done; save-trigger breadth pending |
| Targeting & spatial kernels | AUTHORITATIVE (core) | `targeting.ts`, `area.ts`, `range.ts`, `movement.ts`, `spatial-intent` | Target sets, areas (burst/blast/line/cone), listed-range modifiers, LoS/LoE, cover, footprints; remaining source-specific range/area attachment rows stay in the census. |
| Movement & forced movement | PARTIAL | `movement.ts`, movement-triggers kernel | Standard/dash/difficult/dangerous/elevation/Flying/Rush/Shove/Collide done; Teleport/Place/Remove/Swap shared primitives; source-declared swap batches prevalidate the destination permutation against pre-swap state and apply every leg or none, while ungrouped multi-target movement resolves per-leg. Entity creation/caps are shared, but entity-specific lifecycle remains unresolved. |
| Interrupt/window engine | AUTHORITATIVE (when-damaged, defeated, uses-ability, area-inclusion, targeted-by-ability, save-rolled) | `trigger-window.ts`, held-window reducer paths | LIFO windows, retarget, held damage/effects/saves — replay-tested. Vigilance triggers BLOCKED (B4) |
| Lifecycle engine | AUTHORITATIVE | `lifecycle.ts` (F3), boundary expiry | Turn-start/end, round-start/end phases with recorded participants; cross-character ordering |
| Resource registry | COMPLETE | `core.ts` RESOURCE_RULES | All nine shared resources with source pages, caps, reset scopes; reducer-enforced |
| Turn-order content wiring | PARTIAL | entitlement/slow-eligibility registries | Elite/Legend production entitlement rows DONE (`role:elite-template`, `role:legend-turns`; B1 2026-08-26); no slow-eligibility content rows yet |
| Combat settlement | COMPLETE | `encounter.ts` settlement + `characterFromActor` projection | Personal Resolve +1 at END_ENCOUNTER; durable attrition handoff; combat1→settlement→combat2 regression (`settlement.test.ts`) |
| Player content runtime | PARTIAL | job/trait/talent/mastery/relic programs & recipes | 144/144 abilities; 27/65 Job traits; 57/288 talents; 4/136 masteries; 0/16 Limit Break effects; Relic runtime NOT STARTED. Step-6 folds remain conservative and are tracked by the regenerated Class/Job census. |
| Foe runtime | PARTIAL | `foes.ts`, foe recipes, trait projections | Profiles/roles/scaling construction + role turn entitlements done; 22 abilities executable; Mob BLOCKED; phases inert (B3) |
| Local VTT (Lab) | COMPLETE (harness) | `BrowserVtt.tsx`, `vtt/*`, `vtt-room.ts` | Setup→selection→actions→persistence→replay in-browser; phase-exempt by design |
| Realtime room authority | PARTIAL (preview) | `server/rooms.ts`, `index.ts` | Authz, redaction, revisions/CAS, checkpoints, reconnect basics, transport acceptance green; gated behind PHASE_THREE_READY |
| Checkpoint persistence & recovery | COMPLETE | `server/checkpoints.ts`, Supabase migrations | Append-only CAS snapshots, retention bounds, recovery checkpoint above corrupt revision |
| Narrative deterministic rules | PARTIAL | `character.ts`, dice, resource registry | Zero-rating rolls, boons/curses/crits, Effort/Strain accounting; camp/interlude sheet transitions DONE, playable scene flow NOT STARTED; outcomes of freeform powers TABLE-FACING |

## Encounter closure (primary completeness metric)

> A slice is **closed** when a legal player build and legal opposition execute
> from setup through combat exit with every mechanically deterministic source
> consequence represented authoritatively and nothing silently ignored.

### Slice A — Baseline encounter — *CLOSED*
PC (validCharacter-class build) vs one regular profiled foe. Exercises:
setup, combat-start PC selection, alternation, basic attacks, damage pipeline,
defeat/wounds, END_TURN boundaries, settlement exit.
**Blocking:** none. Closing test: `settlement.test.ts` round-trip.

### Slice B — Player complexity — *blocked*
PC with a Job trait (e.g., Demon Edge), wired talents, an equipped mastery, a
Relic invoke, and an interrupt (Righteous Disdain or Riposte).
**Blocking:** broad mastery/talent promotion beyond the landed K-P5 modifier-fold
tranche (P3 / Step 6), Relic runtime (P5), Vigilance windows (B4). Current
player coverage is 57/288 talents and 4/136 masteries; unresolved rows remain
source-visible in the census.

### Slice C — Foe complexity — *blocked*
Elite (double HP, two turns) or Legend (per-player turns, Juggernaut) with
keyword traits and reactive behavior.
Elite/Legend role turn entitlements are DONE (B1, 2026-08-26:
`foe-turn-entitlements.test.ts`); the slice itself stays blocked on foe
traits beyond keywords (590 rows) and phases/chapter rules (B3) — a phased
legend cannot execute its transitions yet.

### Slice D — Attrition chain — *mechanics CLOSED; scene flow open*
Combat 1 → settlement → combat 2 with HP attrition, a wound, spent personal
Resolve carrying through, camp resetting what camp resets.
Mechanically closed by P1 (`settlement.test.ts`); the remaining work is the
playable camp/interlude flow around the already-implemented sheet transitions.

Each slice gets a named integration test when it closes; the closing commit is
referenced here.
