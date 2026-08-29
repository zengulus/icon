# Tranche 1 — the CHOOSE underlay (landed 2026-08-29)

First tranche of the underlay collapse plan in
[`generic-underlays.md`](generic-underlays.md). The census's largest
immediate family, `{choice-input}` (8 units), is a missing COMPOSITION, not a
missing primitive: the engine already owned every semantic question it needs.
This tranche wired them together.

## What landed

### 1. One choice authority — `src/rules/automation/kernels/choice.ts`

A single semantic validator over the existing typed `RuleExecutionInput`
buckets. Before it, reading a player choice was scattered across three
different places (`kernels/teleport-choice.ts` for positions, `selectActors`'s
`input` selector for actors, `evaluateNumber`'s `input` case for numbers),
and option/boolean choices had no shared validation at all.

The kernel's contract:

- **Required missing → reject.** `choice.<kind>-required` before any cost is
  paid, before any RNG, before any mutation. Nothing is consumed.
- **Optional missing → decline.** Returns `null`/empty; never invents a
  default. "The engine never chooses yes on the player's behalf."
- **Supplied values are validated, never interpreted.** Cardinality
  (minimum/maximum/distinct), relation (self/ally/foe/any), footprint range
  (p.92, via the shared `footprintDistance`), option membership, numeric
  bounds, direction non-zero, position in-grid.
- **No source IDs.** `key`/`label`/`kind` come from the content's
  `RuleChoice` row; the kernel never branches on a source.

`resolveChoices` validates required rows before optional ones, so a command
missing a hard requirement reports that, not whichever optional row declined.

### 2. Network schema parity — `src/rules/protocol.ts` + `src/rules/types.ts`

`StatusSaveCommandInput` (the input surface every core command carries) now
includes the full choice buckets: `positions`, `actorIds`, `directions`,
`options`, `numbers`, `booleans`, alongside the existing
`statusSaveChoices`/`abilityUseChoices`/`talentChoices`. The websocket
protocol (`USE_ABILITY`) accepts the same shape; non-ability commands
(MOVE/BASIC_ATTACK/INTERACT/RESCUE/RECOVER/END_TURN) carry only the
Blessing-decision surface they actually need. A mechanic that tests through
direct reducer calls can now be submitted by a real client — AGENTS §7's
"network protocol, reducer command types, VTT client input, and replay schema
must agree" holds for choices.

### 3. Existing specialists unchanged in authority

`kernels/teleport-choice.ts` remains the teleport authority (in-grid +
unoccupied + Rampart are domain constraints the generic row cannot express);
its violation codes are the same codes the choice kernel throws, so every
required-choice rejection reads identically at the command boundary.

## What this unlocks

Per `docs/blocker-census.md`, the `{choice-input}` family (8 immediate
singletons) is the first consumer set. A singleton is promotable ONLY when
its complete mechanical semantics — not just the choice — are now
representable; compound units stay unresolved until every blocker in their
set clears. The post-roll family (`post-roll-reactive-choice`,
`gamble-result-selection`, `damage-preview`) deliberately does NOT unlock
here: those choices ride rolls, so they belong to the WINDOW/CONTINUATION
underlays (tranche 5), not to a speculative command input.

## Tests

`src/rules/__tests__/choice.test.ts` — 23 cases over the underlay's own
semantics, independent of any one ability: positive resolution for every
kind; required-missing rejection codes; optional-decline (never a default);
cardinality edges (exactly-N, up-to-N, distinct); range edges (at-range
passes, one-past fails); invalid inputs (wrong relation, defeated target,
unknown actor, out-of-bounds, unknown option, (0,0) direction, out-of-bounds
number); composition (required rejects before optional declines). Plus
protocol fixtures proving a real websocket client can carry every bucket and
that malformed buckets are rejected before state validation.
