# Rules automation coverage

The ICON 1.5 source artifact is content-complete: all 501 PDF pages are stored, credited, searchable, and indexed into 75 sections. Structured content and executable rules are separate gates.

| Area | Structured | Executable | Current scope |
| --- | --- | --- | --- |
| Character creation | Yes | Yes | Kin, Culture, Bond, action dots, Job, starting powers, and abilities |
| Advancement | Yes | Partial | Levels, chapter boundaries, XP/AP, Job slots, talents, masteries, narrative choices, and Relic slots validate; Refocus and every Relic infusion path still need dedicated transitions |
| Bonds | Yes | Partial | 12 Bonds, 36 ideals, 120 powers, Effort/Strain, Second Wind, special features, and kits; free-form narrative power outcomes remain table-facing |
| Jobs | Yes | Partial | 16 Jobs and 144 abilities with chapter, cost, range, tags, rules text, talents, masteries, traits, and Limit Breaks; every Job ability remains source-visible and reducer-blocked until it has an independently reviewed resolver and replay fixture |
| Relics | Yes | No | 40 Relics with ranks I–III, aspects, and quests; invokes and persistent effects are not automated |
| Core combat | Yes | Partial | Movement, overlapping terrain, pits, objects, Skirmisher/Flying/Phasing/Immobile movement, line of sight, basic attacks, damage order, saves, core statuses, wounds, rescue, recovery, turns, events, migration, and replay; areas, summons, marks, stances, full traits, and trigger ordering remain incomplete |
| Foes | Yes | Partial | Six source roles and 449 jobs, variants, uniques, elites, legends, components, and special entries with 1,365 abilities; standard profile construction works, but mobs and foe abilities are not executable |
| Trophies and camp fixtures | Yes | No | 20 general trophies, 16 fixtures, and 87 fixture features are typed and source-linked; their effects are not automated |
| Multiplayer transport | Yes | Engineering preview | Validated commands, authentication, permissions, revisions, persistence, reconnect, and Discord activity exist, but remain behind the rules gates |

`PHASE_TWO_READY` remains false while any gameplay-required row is partial or reference-only. Production builds therefore show the gate instead of the sandbox. The engineering sandbox is available only from a local Vite development/test server.

## Measured source-to-program coverage

`npm run audit:automation` is the machine-readable coverage report. It does not treat structured catalogs, a generic passive resolver, or reducer-only behavior as an independently executable `RuleProgram`.

For the checked-in ICON 1.5 artifact, the report is deliberately conservative:

| Measure | Count |
| --- | ---: |
| Traceable source programs | 3,261 |
| Traceable source clauses | 4,884 |
| Generic RulePrograms with no unresolved clause | 104 |
| Generic RuleProgram clauses with no unresolved text | 1,014 |
| Explicitly unresolved clauses | 3,870 |

Reducer-backed core mechanics are tested separately, but are not counted as generic VM coverage until their full typed `RuleProgram` semantics exist; any core rule without a documented reducer path remains explicitly unresolved. A compiler result with no unresolved clause is also **not** an authority permit: live `EXECUTE_RULE` accepts only the explicit independently reviewed allowlist in `automation/manual-programs.ts` (currently Skirmisher). This prevents a heuristic parser result from silently becoming a GM-executable foe or ability rule. `npm run audit:automation -- --strict` intentionally fails while any unresolved clause remains; it is a release-completeness gate, not a passing CI threshold for this incomplete rules engine.

An ability becomes executable only when it has:

1. Typed costs, targets, ranges, areas, tags, prerequisites, and usage limits.
2. Declarative effects or a named deterministic resolver.
3. Explicit hit, miss, critical, save, trigger, talent, and mastery behavior where applicable.
4. Source-page golden fixtures and event-replay tests.

No VTT path may silently approximate unresolved rules. The generic VM admits only the independently reviewed allowlist, and `USE_ABILITY` refuses every source-only Job ability while exposing its complete source text and page reference to the engineering harness.
