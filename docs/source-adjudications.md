# Source Adjudications

ICON 1.5 contains a small number of internally contradictory rules
statements: two explicit passages can make mutually incompatible numerical or
procedural claims about the same mechanic. The engine must not resolve those
contradictions through whichever passage an agent happens to read, a comment
buried next to implementation, or silently choosing the interpretation that
makes a test pass.

The typed registry in `src/rules/source-adjudications.ts` is the authoritative
record of known source conflicts and the interpretation the engine currently
adopts. **This registry exists for source conflicts only.** It is not a second
rules engine, and it never overrides an unambiguous source rule.

## Authority hierarchy

    ordinary source text
        ↓
    source adjudication ONLY when source passages conflict
        ↓
    executable implementation
        ↓
    tests/audits proving implementation matches adopted semantics

- Ordinary source text is primary. An adjudication may only exist where the
  source itself conflicts.
- Implementation must agree with adopted adjudications. If executable
  behavior and the recorded adjudication disagree, one of them is wrong.
- Agents must not silently reinterpret a recorded conflict. Change the
  adjudication deliberately (with rationale) or change the implementation to
  match it — never let the two drift.

## Records

Each record carries a stable ID (`icon-1.5:<topic>:<mechanic>`), the rules
version, the conflicting passages with ICON 1.5 page numbers, the conflict
statement, the adopted reading, the rationale, the affected implementation
locations, a status, and — where the conflict pins one — a machine-readable
boundary (`{ kind: 'level' | 'xp', value }`) so engine constants and tests
can be checked against the registry without parsing prose.

| ID | Topic | Status | Boundary |
| --- | --- | --- | --- |
| `icon-1.5:advancement:mid-level-ap` | Mid-level Ability Point (XP breakpoints) | adopted | +1 AP at 7 XP |
| `icon-1.5:advancement:limit-break-level` | Limit Break unlock level | adopted | unlocks at level 1 |
| `icon-1.5:dangerous-terrain:damage-cadence` | Dangerous terrain damage cadence | adopted | once per turn |

The typed records are the authority; this table is a summary index and must
not drift into a second full copy. Add or change fields in
`src/rules/source-adjudications.ts` and keep this index consistent.

### Current records

1. **Mid-level Ability Point** — the Expeditions section (p.44) grants the
   mid-level ability/talent unlock at 5 and 10 XP; the Book of Adventure
   advancement procedure (pp.112, 240, 241) grants a single +1 AP at 7 XP,
   once per level, with a 15-tick bar and a level-up banked at 15 XP. The
   engine adopts the Book of Adventure reading: `awardXp` claims the AP at
   7 XP and banks a level at 15 XP, and `abilityPointAllowance` includes the
   claimed mid-level AP.
2. **Limit Break unlock level** — the advancement tables (pp.15, 115, 241)
   and the p.112 prose grant the Limit Break at level 1; the Resolve section
   (p.99) says level 2. The engine adopts level 1, recorded as
   `LIMIT_BREAK_UNLOCK_LEVEL` in `src/rules/character.ts`. No Limit Break
   availability gate exists yet, so this constant is the durable boundary a
   future gate must agree with.
3. **Dangerous terrain damage cadence** — the core Battlefield/Terrain rule
   (p.89) states dangerous-terrain damage may be taken "once a turn, even if
   they enter new dangerous terrain spaces"; the Harvester job sheet's
   "Relevant Rules" keyword recap (p.183) reprints the same rule as "once a
   round" (and drops the "ignoring armor and vigor" clarification and the
   new-spaces clause). These are the same mechanic with contradictory
   windows, so the contradiction is recorded. The engine adopts the general
   rule — once per turn — implemented as a per-actor `any-turn` usage mark
   (`dangerousOncePerTurnKey` in `src/rules/automation/kernels/use-ledger.ts`)
   re-opened at each turn start, matching p.89.

## Tests

`src/rules/__tests__/source-adjudications.test.ts` enforces the registry
invariants (unique IDs, rules version present, ≥2 conflicting source
references per adopted record, non-empty rationale, identified affected
locations) and pins the adopted boundaries semantically against the engine:
the AP is claimed at exactly 7 XP (not 5 or 10), a level banks at exactly
15 XP, the claim resets per level, `LIMIT_BREAK_UNLOCK_LEVEL` equals the
adjudicated level boundary, and the dangerous-terrain claim is keyed to the
`any-turn` window the adjudicated once-per-turn boundary adopts. If the
engine or a record changes one side of a boundary, the tests fail.
