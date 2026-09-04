# Tranche 33 — recorded use-time placement

Implementation date: 2026-09-05. This is a placement migration within the
underlay phase, not a source-unit promotion or a U4 completion claim.

## Execution contract

`resolveCapturedPositionListChoice` owns presence, cardinality, distinctness,
integer coordinates, and membership in a supplied CandidateSet. It preserves
recorded order and never pads, sorts, or defaults a choice, including singleton
sets. `evaluatePositions` owns region, terrain, spacing, and actor-placement
queries. Character footprint legality delegates to the existing F1 gateway;
creation legality delegates to `validateEntityCreation` through
`chooseEntityCreation`. The latter emits only recorded cells with the creator's
LoS/footprint frame. The shared creation allowance preserves per-owner caps:
a full cap suppresses creation without rejecting the containing ability; a
partially full cap requires only the remaining number of recorded cells.

For queries after earlier movement/removal/damage, `contextAfterMutations`
exposes the existing U11 FlowPlanner's reducer-projected snapshot. It does not
introduce another mutation applier. Dervish checks each passenger after the
preceding passenger has landed. An invalid later choice rejects the command
without stranding an earlier passenger or consuming actions/resources.

Command inputs and resulting mutations carry decisions. Replay consumes the
recorded event; it never invokes the choice planner or substitutes a candidate.

## Source passages and command inputs

The full relevant passages were read directly from `ICON 1.5.pdf`, including
p.92 range/adjacency, p.95 summons/objects, and p.108 valid creation spaces.
Position keys below live in the existing `input.positions` bucket.

| Consumer | Source | Recorded placement |
| --- | --- | --- |
| Hunter Set Trap | p.302 | `terrain-position`: one free cell within footprint range 2 |
| Cavaliere triggered bomb | pp.149–150 | `bomb-position`: one free cell within range 2 of the actual post-movement source; creation cap applies |
| Carnevale | pp.149–150 | `bomb-positions`: two distinct free cells within footprint range 2, reduced by remaining bomb capacity |
| Mist Strider | pp.169–170 | `area-center`, plus `charge-cloud` when charged: one free center each within range 3 of the source; each uses the five-cell small-blast template |
| Underway portal 1 | pp.170–171 | `portal-position`: one free adjacent cell, after replacing the user's previous portals; ordinary creator LoS applies |
| Dervish passengers | p.178 | `dervish-landing:<actorId>` for each selected passenger: one legal adjacent landing after the source's actual flight and earlier landings |
| Symphony | p.178 | `mote-positions`: distinct nonadjacent free cells anywhere; count equals consumed blessings plus two on Charge |
| Strongarm talent I | p.143 | `strongarm-adjacency`: one legal adjacent cell before the spin when Comeback applies; `input.options.direction` explicitly selects `clockwise` or `counter-clockwise` for the spin |
| Geyser | p.234 | `geyser-position`: one legal object cell within footprint range 4 and creator LoS |
| Waterspout | pp.92/235 | `waterspout-position`: existing difficult terrain in adjacency (no listed range means adjacency), with ordinary creation legality |
| Spirit Shrine | pp.192–193 | `shrine-position`: one legal adjacent object cell; selecting the existing adjacent shrine raises it, selecting another cell replaces it; object stacking uses the creation authority |
| Chaos Tarot effect 3 | p.201 | `chaos-tarot-terrain`: exactly two distinct cells in the small blast |
| Astra terrain/meteor | p.201 | `astra-terrain`: two distinct cells in the medium blast on 4+; `meteor-position`: one legal object cell in that blast on 6, with creator LoS; proximity damage uses that recorded cell |
| Blackstar terrain | pp.211–212 | `blackstar-terrain`: optional subset of zero to three cells in the large blast when Comeback/Exceed applies |

Tarot/Astra/Blackstar say terrain is created **in the area**, not only in free
spaces. Their terrain choices therefore include occupied cells. Blackstar's
“up to” remains optional. Waterspout requires existing difficult terrain and
no longer creates a terrain cell to satisfy its own prerequisite. Ordinary
mandatory placement with no valid space fails closed; no fallback cell is
invented. This is a conservative execution boundary, not a new global source
ruling about every zero-capacity ability.

## Remaining boundaries

- U4 remains partial. Dervish still has the prior actor multi-select and
  initial-flight decision gaps; this slice changes passenger landings only.
- Symphony still automatically chooses blessing holders/spend amounts. Its
  payer/quantity decision requires a separate resource-choice migration;
  the placement count now reflects the amount actually consumed.
- Underway portal 2, held/window choices, and other U12/U13 continuations
  retain their separate tranche. Automatic ordinary summons outside the
  exact table above (including Tarot's wild card) remain in the residual set.
- Existing attack/area/damage, source-specific shrine height behavior, and
  movement/detonation semantics outside the listed placement clauses are
  not recertified by this migration. In particular, using exact blast
  templates for these placement choices does not certify older resolver
  damage-area calculations.
- No selectable source identity, executable allowlist, or release gate changes.
  The Class/Job census remains 425 unresolved units.

## Verification evidence

`recorded-placement.test.ts` exercises shared list validation and production
commands: non-first choices, missing/extra/duplicate/malformed positions,
occupied and blocked cells, creator LoS, Size>1 range and landing footprints,
creation caps, shrine stacking/replacement, exact/optional terrain subsets,
post-movement and multi-passenger state, rejection purity, and event replay.
Hunter negative tests live in `foe.test.ts`. Existing ability, talent, aura,
resource, and turn-transition fixtures now record deliberate placement inputs.

The next task is a fresh U4 residual audit, followed by a bounded actor/
resource-choice or continuation tranche selected from its actual dependencies.

## Maintenance closure

The accompanying project-wide pass removes compiler-confirmed unused imports
without changing emitted JavaScript, unused UI calculations and constants,
and unreachable reducer lifecycle copies (Great Giorgios, Six Hells Trigram,
Carnevale, and their private movement helper). Active lifecycle execution
continues through the registered recipes and shared kernel.

Numeric, scaled, and trait bonus-damage rows now use the same U14 applicability
evaluator for bloodied/status gates. Nine characterization cases cover the
unchanged valid-state behavior; elevation remains a documented specialist,
and the broader U14→U6 consolidation remains open. README, roadmap, coverage,
and deliverables now describe current counts and checkpoint projections.
The obsolete schema-v3 prose claim was removed from the fidelity claim
registry and its report regenerated; no source-fidelity unit was promoted.

Final verification (2026-09-05):

- `npm test`: 2,263 tests across 133 files.
- `npm run typecheck` and `npm run build`: client and server pass.
- `npm run audit:architecture`, `npm run audit:automation`,
  `npm run audit:class-job-census`, and strict source-fidelity audit pass.
  Automation remains 469/3,275 programs without unsupported clauses;
  the Class/Job census remains 425 unresolved units.
- `npm run test:e2e`: transport acceptance and all six browser cases pass.
- `npm run verify:source-artifacts` and `npm run verify:extraction`: pinned
  PDF identity and all four generated artifacts pass byte-for-byte checks.
- `git diff --check`: clean.

This pass does not enable optional TypeScript unused-symbol enforcement:
fixture destructuring, retained signatures, compile-time type assertions, and
imports needing individual initialization review remain outside that gate.
