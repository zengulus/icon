# Semantic atomicity audit

Audit baseline: `582876b64d5c4bd3d8d27cabfdbb74c004084c03` (fetched
`origin/main`, 2026-09-01). This document is diagnostic/planning authority;
ICON 1.5 is semantic authority and implementation remains execution authority.

## Conclusion

U1–U17 are sufficiently atomic. No U18+ is justified. The source repeatedly
needs their composition and existing domain authorities, not a new fundamental
question. The architecture's principal weakness is implementation surfaces
that still answer two existing questions at once.

## U1–U17 atomicity map

| Underlay | One question | Boundary/overlap challenge | Verdict |
| --- | --- | --- | --- |
| U1 Reference | What thing/value is referred to? | Supplies identity to U3/U4/U7; does not decide eligibility, choice, or metric. | `ATOMIC` |
| U2 Role | Relative to whom is a clause interpreted? | Supplies perspective/controller to U3/U4; distinct from the spatial origin. | `ATOMIC` |
| U3 Query | What currently qualifies? | Composes U1/U2/U6/U7; does not select for a player. Multiple candidate domains do not create multiple questions. | `ATOMIC` (large but correct) |
| U4 Choice | What did the entitled player choose? | Validates membership/cardinality over U3 results; must not calculate geometry or relation. | `ATOMIC` |
| U5 Value | What scalar/value evaluates now? | Composes queries and recorded results. Roll execution presently leaks into its implementation, but the question itself is atomic. | `ATOMIC` ontology; implementation partial |
| U6 Predicate | Is this clause applicable now? | Boolean composition over U1/U3/U5/U8/U10/U16; distinct from U14's alteration. | `ATOMIC` |
| U7 Anchor | From where is a spatial rule measured/attached? | Distinct from U2 perspective and from footprint metric. | `ATOMIC` |
| U8 Scope/Clock | Within what temporal boundary is this interpreted? | Defines the boundary consumed by U12/U16; does not count uses. | `ATOMIC` |
| U9 Provenance | What caused the outcome? | Historical causal identity; distinct from the authoritative occurrence in U10. | `ATOMIC` |
| U10 Fact | What authoritative thing already happened? | Records outcome; does not explain cause or schedule later flow. | `ATOMIC` |
| U11 Flow | In what listed/control-flow order do operations execute? | Ordinary sequencing; distinct from atomic commit (U15) and simultaneous arbitration (U17). | `ATOMIC` |
| U12 Continuation | What armed work resumes later? | Carries suspended work; U13 owns the pause/decision point. | `ATOMIC` |
| U13 Window | Has resolution paused for a decision/reaction? | Hosts U4/U17 decisions and U12 resumption without owning them. | `ATOMIC` |
| U14 Modifier | How does an attached rule alter a typed query point? | Applicability belongs to U6; the typed fold itself is one question. | `ATOMIC` ontology; implementation leakage |
| U15 Transaction | Which proposed changes validate and commit together? | Atomicity is not U11 order; it composes domain validators. | `ATOMIC` |
| U16 Usage | How many uses remain/occurred within a scope? | Consumes U8 scope and U9 identity; does not define either. | `ATOMIC` |
| U17 Ordering | Which eligible simultaneous operation resolves next? | Can require a U4 decision; does not own candidate eligibility or ordinary listed flow. | `ATOMIC` |

Large underlays are not split merely for having many domains. U3 remains one
eligibility question over actor/entity/position/terrain domains; U11 remains
one execution-order question over several flow nodes. Region data and foe/mob
state are respectively a domain value and structural model, not U18.

## Runtime ownership findings

| Site | Currently owns | Should own | Leaked authority | Severity | Classification | Migration |
| --- | --- | --- | --- | --- | --- | --- |
| `RuleSelector` / `evaluate-value.ts` | Reference, query, recorded input identity | Compatibility adaptation only | U1 + U3 + U4 in one union | Medium | `TRANSITIONAL-COMPATIBILITY-SURFACE` | Erode callers toward `Reference<D>`, `Query<D>`, and captured U4 values; retain adapters meanwhile. |
| `choice.ts` actor branch | Cardinality plus U3 membership | U4 over U3 | None at baseline: actor legality already called `validateActorCandidate` | Low | `ATOMIC` | Retain and guard. |
| `choice.ts` position branch | Cardinality, bounds, footprint range | U4 over U3/U7 | U3 candidate legality | High | `DUPLICATE-AUTHORITY` | **Fixed in this tranche:** `validatePositionCandidate` is shared by U3 evaluation and U4. |
| `ModifierGate` / `modifierGateHolds` | Modifier applicability | U14 fold composed with U6 predicate | Second predicate vocabulary/evaluator | High | `DUPLICATE-AUTHORITY` | Next tranche: migrate gates to a U6 predicate on `ModifierRule`; project each fold view into the one predicate evaluator; remove the switch only after range/area/mastery/permission/scaled-bonus consumers migrate. |
| `bonus-damage.ts` scaled gate fold | Scaled value plus local applicability | Damage value specialist composed with U6/U14 | A third self/target bloodied/status gate evaluator | High | `DUPLICATE-AUTHORITY` | Migrate with `ModifierGate`; a scaled value may remain a domain query, its applicability may not. |
| `area-geometry.ts` | Footprint-independent pattern geometry | Region specification/validation domain surface | No fundamental underlay leak | Low | `ATOMIC` | Keep canonical Line/Arc validation; expose results as regions. |
| `SpatialAreaIntent` / `computeSpatialArea` | Center legality, pattern derivation, LoS, actor inclusion | Region resolution; placement; U3 inclusion separately | Placement policy + region geometry + U3 query | High | `DUPLICATE-AUTHORITY` | Dedicated region tranche; return authoritative cells, then query actors through `insideArea`. |
| Resolver-local `squareArea`/`lineCells` calls | Source effect resolution plus geometry | Consume a resolved/validated region | Repeated region construction and approximate blast sizing | High | `DUPLICATE-AUTHORITY` | Migrate family-by-family after region vocabulary lands; no flag day. |
| Kernel imports of `job-kit.ts` | Query bounds/obstruction and damage-roll policy | Owning battlefield/damage-roll primitives | Authoring facade as semantic provider | Medium | `MISLAYERED-HELPER` | **Fixed in this tranche:** `battlefield.ts` and `damage-roll.ts`; `job-kit` retains compatibility wrappers. |
| `RuleNumber` `input` | Scalar expression plus recorded decision lookup | U5 over a captured U4 result | U4 identity/validation remains in compatibility evaluator | Medium | `TRANSITIONAL-COMPATIBILITY-SURFACE` | Replace with captured/bound numeric results as callers migrate. |
| `RuleNumber` `die` / `damage-die` / `damage-roll` | Scalar evaluation plus RNG/damage roll execution | U5 over recorded Roll/Damage results | Roll and damage-domain execution | High | `DUPLICATE-AUTHORITY` | Defer until command-time recording/replay trace is complete; never reroll in `applyEvents`. |
| `use-ledger.ts` named keys | Generic identity/scope/count plus named source constants | U16 over content-registered `UsageKeySpec` | Incubus, Stampede, Midas, Vigilance Rush semantics | High | `CONTENT-LEAK` | Move named key recipes to content registration, then remove audit exemptions. Core one-attack/interrupt/terrain protocol keys remain legitimate. |
| `encounter-adapter.ts` interrupt branches | Generic window detection plus Perseus/Masquerade/Sucker Punch recipes | U13/window engine over content registrations | Hardcoded source lookup and source-specific detection | High | `CONTENT-LEAK` | Move trigger/window recipes to content data before deleting exemptions. |
| Architecture source-ID exemptions | Allows reviewed kernel literals | Only protocol/core identifiers should remain | Exemptions conceal the two content leaks above | Medium | `TRANSITIONAL-COMPATIBILITY-SURFACE` | Retained until authority migrates; do not delete the guard first. |

## Suspected-boundary dispositions

- **A RuleSelector:** confirmed as transitional, not an end-state semantic
  atom. Its current adapters generally route correctly; removal would be a
  flag day.
- **B Choice legality:** refined. Actor legality was already correct; position
  bounds/range were duplicated and are now routed through U3. Teleport and
  placement specialists correctly retain obstruction/LoS/source policy.
- **C ModifierGate:** confirmed, including split Charge/bloodied/status reads.
  No partial vocabulary move was attempted in this tranche.
- **D Spatial bundling:** confirmed. Footprint geometry is correctly atomic;
  region resolution is missing. `SpatialAreaIntent` is not sufficiently
  generic because it knows only line/burst and also returns actor inclusion.
- **E job-kit:** confirmed and corrected for kernel consumers. It remains a
  legitimate content-authoring facade.
- **F U5 domain execution:** refined/confirmed. Pure arithmetic belongs in U5;
  RNG and damage-roll decisions should arrive as recorded results. Current
  deterministic `DiceSource` routing is a compatibility boundary, so moving it
  casually would risk replay.
- **G content in kernels:** confirmed for named U16 keys and interrupt/window
  branches. Perseus is an additional direct window recipe found during the
  trace (its short two-segment id is not caught by the current source-id
  scanner heuristic). Opaque `sourceId` comparison in registries/provenance is
  otherwise legitimate.

## Spatial source check and minimal region vocabulary

ICON pp.92, 95, 97 and 108 distinguish footprint distance/LoS, intangible
summon obstruction, area placement, Line/Arc/Blast/Burst patterns, and valid
placement. Gran Levincross (p.224) adds a repeated region need: a chosen cross
partitions the battlefield into four sections, damages the boundary, removes
characters in it, chooses nearest free destinations by side, and persists a
movement-blocking/non-LoS-blocking wall.

The missing operation is not U18. It is a region domain authority with the
minimum vocabulary:

```text
Region = canonical distinct set of in-grid Position cells
RegionSpec = explicit cells | line path | arc path | burst(center,radius,LoS)
           | blast(template,center) | cross-boundary(configuration)
Region algebra = union | intersection | difference | connected components
```

Pattern builders validate source constraints and produce a `Region`. Effects,
terrain, and U3 queries consume that region. Blast remains unresolved until
the exact supplied templates are representable; it must not be inferred from
small/medium/large labels. Gran Levincross requires cross-boundary validation,
derived connected components, and nearest-free U3+U4 placement composition,
not a named primitive.

## Compatibility retained and next tranche

Retained deliberately: `RuleSelector`, `RuleChoice` constraint fields,
`RuleNumber` input/roll forms, `job-kit` compatibility wrappers, modifier gate
rows, and current source-ID exemptions. The next bounded tranche should be
U14 applicability → U6 predicate composition, including the scaled
bonus-damage fold and an adversarial Charge test across every modifier query
point. The region authority follows in its own tranche; U5 roll cleanup and
content-leak migration follow only after their replay/registration contracts
are explicit.
