# Rules automation coverage

The ICON 1.5 source artifact is content-complete: all 501 PDF pages are stored, credited, searchable, and indexed into 74 sections. Structured content and executable rules are separate gates.

| Area | Structured | Executable | Current scope |
| --- | --- | --- | --- |
| Character creation | Yes | Yes | Kin, Culture, Bond, action dots, Job, starting powers, and abilities |
| Advancement | Yes | Partial | Levels, chapter boundaries, XP/AP, Job slots, talents, masteries, narrative choices, and Relic slots validate; Refocus and every Relic infusion path still need dedicated transitions |
| Bonds | Yes | Partial | 12 Bonds, 36 ideals, 120 powers, Effort/Strain, Second Wind, special features, and kits; free-form narrative power outcomes remain table-facing |
| Jobs | Yes | Partial | 16 Jobs and 144 abilities with chapter, cost, range, tags, rules text, talents, masteries, traits, and Limit Breaks; straightforward attacks execute, complex effects remain pending source text |
| Relics | Yes | No | 40 Relics with ranks I–III, aspects, and quests; invokes and persistent effects are not automated |
| Core combat | Yes | Partial | Movement, terrain, line of sight, basic attacks, damage order, saves, core statuses, wounds, rescue, recovery, turns, events, migration, and replay; areas, summons, marks, stances, full traits, and trigger ordering remain incomplete |
| Foes | Yes | Partial | Six source roles and 445 jobs, variants, uniques, elites, legends, components, and special entries with 1,365 abilities; standard profile construction works, but mobs and foe abilities are not executable |
| Trophies and camp fixtures | Indexed | No | Available in full-text source; not yet normalized into typed catalogs |
| Multiplayer transport | Yes | Engineering preview | Validated commands, authentication, permissions, revisions, persistence, reconnect, and Discord activity exist, but remain behind the rules gates |

`PHASE_TWO_READY` remains false while any gameplay-required row is partial or reference-only. Production builds therefore show the gate instead of the sandbox. The engineering sandbox is available during local development or with `VITE_ENABLE_INCOMPLETE_VTT=true`.

An ability becomes executable only when it has:

1. Typed costs, targets, ranges, areas, tags, prerequisites, and usage limits.
2. Declarative effects or a named deterministic resolver.
3. Explicit hit, miss, critical, save, trigger, talent, and mastery behavior where applicable.
4. Source-page golden fixtures and event-replay tests.

No VTT path may silently approximate unresolved rules. The current generic resolver executes only mechanics it recognizes and retains the complete source text as pending behavior for everything else.
