# Rules & content coverage

What "coverage" means here, and the verified numbers per content family.
Counts below were measured 2026-08-25 from `npm run audit:automation`,
`npm run audit:class-job-census`, and the catalog; anything not verifiable is
marked **NEEDS RECOUNT** rather than copied from older documents.

## Capability ladder

A source unit occupies exactly one rung:

| Rung | Name | Meaning |
| --- | --- | --- |
| 0 | Absent | Not extracted/catalogued |
| 1 | Catalogued | Source identity + text stored, searchable |
| 2 | Structured | Mechanics parsed/normalized into typed data |
| 3 | Table-facing | Displayed/validated for human adjudication; deliberately not automated |
| 4 | Executable | Engine applies its deterministic mechanics |
| 5 | Authoritative | Execution matches source semantics without hidden bypasses |
| 6 | Source-tested | Independent source-page regression fixture |
| 7 | Replay-tested | Additionally proven durable under event replay |
| 8 | Encounter-ready | All dependencies implemented; works inside real combat |

Only rungs ≥5 count toward gameplay completion. The automation audit measures
rung 4+ conservatively for VM programs; reducer-backed mechanics are tested
separately and are not counted as VM coverage.

## Headline audit numbers (verified)

| Measure | Count |
| --- | ---: |
| Traceable source programs | 3,275 |
| Traceable clauses | 4,700 |
| Programs with no unsupported clause | 457 |
| Clauses with no unsupported text | 1,597 |
| Explicitly unsupported clauses | 3,103 |

`audit --strict` intentionally fails while any clause remains unresolved; it
is a release gate, not a CI threshold. A compiler result is never an
execution permit: live `EXECUTE_RULE` accepts only the reviewed allowlist
(`automation/content/glue/manual-programs.ts`).

## Per-family coverage

"Exec." = executable programs (total minus audit-unsupported). Ladder shows
the family's *typical* ceiling.

| Family | Catalogued | Structured | Exec. | Unsupported | Typical ladder |
| --- | ---: | ---: | ---: | ---: | --- |
| Core tactical rules | all | all | reducer-backed; 70 units without full VM programs | 70 | 5–7 for wired paths; remainder table-facing/pending |
| Bonds / powers | 12 / 120 | ✔ | rolls only | — | 5–6 deterministic parts; outcomes 3 (table-facing) |
| Jobs | 16 | ✔ | — | — | n/a (container) |
| Job abilities | 144 | ✔ | **144** | 0 | 7 (source+replay fixtures per suite) |
| Class traits | NEEDS RECOUNT | ✔ | Mendicant slice (Diaga, Bless, Succor) | 7 | mixed 3–6 |
| Job traits | 65 | ✔ | 27 | 38 | wired rows 6–7; rest 3 with kernel need recorded |
| Talents | 288 | ✔ | 47 | 241 | wired 6–7; rest 3 |
| Masteries | 144 (assumed; NEEDS RECOUNT) | ✔ (validated surface) | 3 via the K-P5 modifier fold (2026-08-26) | 133 | wired 6–7; rest 3 pending further fold families |
| Limit Breaks | 16 | ✔ (costs pay) | 0 effect bodies | 16 | 3–4 (payment) |
| Relics | 40 (+120 ranks, 40 aspects) | ✔ | 0 effects | 160 | 2–3; character-engine infusion/refocus transitions DONE |
| Foe profiles | 449 | ✔ | construction works | — | 5 for construction |
| Foe abilities | 1,365 catalogued | ✔ | 22 recipe-driven | 1,247 traceable units | recipes 6–7; rest 2–3 |
| Foe traits | NEEDS RECOUNT (traceable 658) | ✔ | 115 keyword rows (79 full, 36 partial) | 590 traceable units | keyword rows 6–7; prose 3 (table-facing) |
| Foe roles/baselines | 6 | ✔ | p.298 baselines projected | — | 6–7 |
| Mobs | role defined | — | 0 (rejected at creation) | — | 1 |
| Elites | ✔ | ✔ (double HP) | 2 turns/round via `role:elite-template` row (B1) | — | 6–7 for the template halves |
| Legends | ✔ | ✔ (HP scaling, Juggernaut, components, per-PC turns) | turns DONE (`role:legend-turns`, defeated PCs counted — pinned reading of source silence); phases inert | 19 phases + 116 chapter rules | 5–7 for executed halves; phases pending |
| Summons/entities | — | ✔ engine | consumers wired | — | 6 for existing entity kinds |
| Trophies | 68 | ✔ | 0 | 68 | 2–3 (table-facing by design today) |
| Camp fixtures / features | 16 / 85(+87 features counted earlier; NEEDS RECOUNT) | ✔ | 0 | 101 | 2–3 |
| Reward rules | 9 | ✔ | 0 | 9 | 2 |
| Narrative rolls | — | ✔ | zero-rating, boons/curses, crits | — | 6 |
| Character lifecycle | — | ✔ schema v4, migration v1–v4, import/export | creation→combat entry DONE; settlement + attrition handoff DONE (P1); camp/interlude sheet transitions DONE, playable scene flow NOT STARTED | — | 7 for the deterministic core |

## Mechanically unresolved vs intentionally human-adjudicated

- **Unresolved** (needs engineering): everything in
  [`TODO.md`](../TODO.md) — Mob, foe phases,
  masteries fold, talent subfamilies, relic runtime, Vigilance windows.
  (Elite/Legend role turn entitlements done 2026-08-26; settlement done at
  P1.)
- **Intentionally table-facing** (typed registry `TABLE_FACING_MECHANICS` in
  `src/rules/core.ts`, pinned by `table-facing.test.ts`, 19 entries):
  freeform bond-power outcomes, GM either/or choices in foe abilities,
  ally-consent dashes, Monogatari tales 1/6, Trick Shot's rebound, Stampede
  side-shove geometry, and similar judgment calls. These are NOT automation
  debt.

## Class/Job unit census

The machine-generated dependency graph lives in
[`blocker-census.md`](blocker-census.md) /
[`blocker-census.json`](blocker-census.json) (**generated** by
`npm run audit:class-job-census`; never hand-edit). Current shape: baseline 435 unresolved Class/Job units
(7 class-trait, 38 job-trait, 241 talent, 133 mastery, 16 limit-break); top
shared blockers are teleport (15), fly-grant (13), terrain-create (13),
entity-create (13), damage-modifier (12), interrupt-modifier (12). The former
78-unit `{irreducible}` residual was fully decomposed into concrete
implementable blocker families (2026-08-26) — the census no longer carries a
non-implementable class.
