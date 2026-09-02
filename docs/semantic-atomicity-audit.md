# Semantic atomicity audit

Audit baseline: review of `a411f8026f77ad2a0fab1be3f5e244941bce5508`
(2026-09-01). This document is diagnostic/planning authority;
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
| Kernel imports of `job-kit.ts` | Query bounds/final-space availability and damage-roll policy | Owning battlefield/damage-roll primitives | Authoring facade as semantic provider | Medium | `MISLAYERED-HELPER` | **Tightened:** kernels import the owning surfaces; the multiline-import guard now pins this. `walk` and `firstFreeCell` were returned to `job-kit` as classified compatibility helpers rather than blessed as battlefield atoms. |
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

## Battlefield operation disposition

The p.88 distinction is controlling: allies are legal transit spaces but no
movement may finish sharing any character's space; foes, OBJECTs, and
impassable terrain obstruct ordinary transit. Fly and Teleport carry their own
policies. “Occupied by a character” is therefore not a generic movement-block
answer.

| Operation from the original extraction | One question / actual composition | Disposition |
| --- | --- | --- |
| `distance` | Chebyshev distance between two points | Keep as atomic metric. Footprint distance remains in the spatial authority. |
| `withinGrid` | Is this point inside the grid? | Keep as atomic static predicate. |
| `occupied` | Is a cell unavailable as a final character space because a live battlefield character or OBJECT occupies it? | Renamed to `finalSpaceOccupied`; defeated/off-battlefield actors do not occupy final space, and complete object regions are tested. Keep as occupancy/final-space policy, never describe it as ordinary movement obstruction. `job-kit.occupied` remains a compatibility name for content. |
| `impassable` | Is the point off-grid or impassable terrain? | Keep as an atomic static point predicate. Movement modes decide whether/how it matters. |
| `walk` | Sequential path construction plus mover footprint, phasing, actors, objects, terrain and stopping policy | Not a battlefield atom. Return it to `job-kit` as `TRANSITIONAL-COMPATIBILITY-SURFACE`; it preserves existing named-program behavior until an exact adapter to `movement.ts` exists. In particular, it is not evidence of a second authoritative Standard Move implementation. |
| `firstFreeCell` | U3 qualification followed by caller-list “first” selection | Not atomic and no generic source ordering is established. Return it to `job-kit` as compatibility debt. Its three Colossus consumers need a later source audit and explicit U3 candidate set plus U4/U17/source-defined ordering before migration. |
| `ringAround` | Eight neighboring cells in a stable presentation order | Pure grid geometry; move to `area-geometry.ts`. Its clockwise array order is data, not simultaneous-effect arbitration. |

The authoritative movement tests separately prove a p.88 ally cell is legal as
an intermediate waypoint and illegal as the final destination. This review
does not change `walk` behavior merely to make the compatibility helper look
authoritative.

## U4 choice-kind review

| Kind | U4-owned validation | External authority consumed / finding | Disposition |
| --- | --- | --- | --- |
| `actors` | Required/optional, cardinality, distinctness | U3 owns relation/range/candidate membership; current branch delegates correctly. | `ATOMIC` composition; retain guard. |
| `positions` | Required/optional and cardinality | U7 supplies origin, U5 resolves range, U3 returns legality/problem. | Corrected at `a411f80`; strengthened guard now requires the result to be consumed and bans restoration of the removed local bounds/range patterns. |
| `direction` | Required/optional capture | Current implementation only rejects `(0,0)` although its former comment claimed an axis unit vector. ICON uses context-dependent direction domains (ordinary orthogonal movement, diagonal-capable effects, and source-provided directions), so U4 must eventually validate membership in an explicit U3/domain candidate set rather than define geometry. | `TRANSITIONAL-COMPATIBILITY-SURFACE`; comment corrected, behavior unchanged pending a direction-domain/source census. |
| `option` | Required/optional plus membership in a content-declared closed set | The row supplies the candidate vocabulary. | `ATOMIC`. |
| `number` | Required/optional, finite value and declared bounds | No domain semantics are inferred. | `ATOMIC`. |
| `boolean` | Required/optional and literal boolean validation | No domain semantics are inferred. | `ATOMIC`. |
| `ordering` | Exact, distinct permutation capture | U17 supplies the pending candidate set; U4 records the entitled owner's order. | Correct U4/U17 composition. |

## U14 → U6 gate parity prerequisites

No production gate is migrated by this review. The target U6 forms below are
contracts, not currently available syntax. `exists-one(ref, predicate)` means
the reference must resolve to exactly one actor before the predicate can hold;
it cannot be implemented as `selectActors(...).every(...)`, because
`every([])` is true.

| Gate | Exact source meaning | Current `modifierGateHolds` | Proposed exact U6 predicate | Missing vocabulary | Missing/malformed behavior to preserve | Adversarial parity test |
| --- | --- | --- | --- | --- | --- | --- |
| `always` | No additional applicability clause. | `true`. | `true`. | None. | Cannot fail from absent optional view fields. | Empty/minimal view still true. |
| `stealth` | Acting character has Stealth now. | `conditionsFor(actor.id).has('stealth')`. | `has-condition(live(source), stealth)`. | Exact live-reference condition projection may need adapter unification. | Missing actor/condition projection must fail closed, not throw or infer Stealth. | Empty set false; exact Stealth true; unrelated status false. |
| `comeback` | Acting character is Bloodied (at or below half its BASE maximum — p.81; adjudication icon-1.5:combat:bloodied-base-max: wounds shrink the live max but never the threshold). | Requires finite `hp`, finite positive `maximumHp` (the fold views project `baseMaxHp`), then evaluates `hp <= maximumHp / 2`. | `bloodied(exists-one(live(source)))`. | Non-vacuous single-reference predicate and the BASE-max projection. | Missing/non-finite HP, missing/non-finite/non-positive maximum, or missing actor false. | Exact/below half of base true; above half false; missing/NaN/Infinity/zero matrix false. |
| `charge` | Modifier applies on the acting character's authoritative Slow Turn. | `actor.slowTurn === true`. | `on-turn-speed(live(source), slow)` (durable clock/state fact). | Typed slow-turn/turn-speed predicate. A `trigger('charge')` predicate is explicitly wrong. | Absent flag false; Heroic without Slow Turn false. | Slow true; false/absent false; ambient Charge trigger alone must not make it true. |
| `round-at-least` | Current combat round is at least the source constant. | Numeric `view.round >= value`. | `compare(combat-round, >=, constant(value))`. | Likely none once U5 round is available to U6 comparison. | Non-finite/malformed round must fail closed at the adapter boundary. | `value-1` false, exact value true. |
| `mastery` | Named parent ability is both equipped and mastered. | Conjunction of membership in `abilityIds` and `masteredAbilityIds`. | `all(equipped(source, ability), mastered(source, ability))`. | Typed equipped-ability and mastered-ability predicates/reference. Arbitrary rule-state keys are not parity. | Either array absent, either membership absent, or actor absent → false. | Equipped-only false; mastered-only false; both true. |
| `choice` | Player made the named optional talent-use decision for this resolution. | Membership in `selectedTalentSourceIds`. | `captured-choice-includes(choice-ref, option-ref)` over the recorded U4 result. | Typed reference to a captured U4 decision and membership predicate. A raw command-input reread or source-id boolean is forbidden. | Missing capture false; malformed capture rejects/fails closed before fold; replay consumes the same captured answer. | Same raw input without capture false; recorded matching capture true on execution and replay. |
| `self-bloodied` | Acting character is Bloodied; distinct name preserves source-row meaning. | Same calculation as `comeback`. | Same exact predicate as `comeback` (content provenance remains distinct). | Same as `comeback`. | Same as `comeback`. | Same boundary/malformed matrix as `comeback`. |
| `target-bloodied` | An existing hostile attack target is Bloodied (at or below half its BASE maximum — p.81). | Target exists, side differs, HP/max HP are finite, max HP (the target's BASE bar) is positive, and HP is at/below half. | `exists-one(attack-target, all(hostile-to(source), bloodied))`. | Non-vacuous cardinality/reference existence plus hostility composition. | Missing/allied target, missing/non-finite HP, missing/non-finite/non-positive maximum, or unresolved reference → false. | Missing/allied/malformed false; hostile exact/below half of base true; hostile healthy false. |
| `target-has-condition` | An existing hostile attack target has any status, or the named status. | Target exists, is not allied, then nonempty Set/array or exact ID membership. | `exists-one(attack-target, all(hostile-to(source), has-any-condition/has-condition(id)))`. | Non-vacuous target existence, hostility, and `has-any-condition`; normalize Set/record projections. | Missing/allied target and empty/malformed condition collection → false. | Missing false; allied with condition false; hostile matching true; hostile empty/nonmatching false. |

The characterization suite now covers every retained gate and the hostile
target matrix. Migration may remove `ModifierGate` only after every fold
adapter can supply these exact predicates while preserving registration and
fold order.

## Spatial source check and Region / ResolvedArea contract

ICON pp.92, 95, 97 and 108 distinguish footprint distance/LoS, intangible
summon obstruction, area placement, Line/Arc/Blast/Burst patterns, and valid
placement. Gran Levincross (p.224) adds a repeated region need: a chosen cross
partitions the battlefield into four sections, damages the boundary, removes
characters in it, chooses nearest free destinations by side, and persists a
movement-blocking/non-LoS-blocking wall.

The missing operation is not U18. `Region` is the canonical geometry value;
area resolution must retain semantic facts that a bare cell set erases:

```text
Region = canonical distinct set of in-grid Position cells
ResolvedArea {
  region: Region
  origin: resolved Position
  placement: { qualifyingCells, rule: listed-range-any-cell | unlisted-adjacent-any-cell }
  attackSelector: none | fixed-space(Position) | choose-character-in-region
}
RegionSpec = explicit cells | line path | arc path | burst(center,exact shape)
           | blast(exact template,center) | cross-boundary(configuration)
Region algebra = union | intersection | difference | connected components
```

For listed-range AoEs, placement is legal when **at least one pattern cell** is
in range; without listed range, at least one pattern cell must be adjacent to
the user. Center distance is not the generic placement rule. The resolved
origin is first Line cell when range is listed, the user for Arc, and the
central cell for Blast/Burst, subject to explicit source overrides. Cover,
LoS, and effects consume that preserved origin.

An AoE attack's attack space is not ordinary region membership: its occupant
receives the attack component instead of the area effect unless an effect says
it applies to all characters. Line and Arc expose U3 character candidates
intersecting the region and U4 records the chosen attack character; the choice
is not embedded in `ResolvedArea`. Blast and Burst use a fixed central space,
so U3 only resolves its occupant if any. Burst's default user exclusion is a
recipient rule, not removal of the user's cell from its Region.

Large-character design tests enforce three distinct U3/U4 compositions from
p.290: (1) a large foe using a self-origin AoE chooses one U3 footprint-origin
candidate before geometry resolves; (2) a bigger foe may opt in or out of its
own area ability during recipient resolution; and (3) every recipient is
identity-deduplicated, then a large target eligible for both attack and area
branches requires a recorded ability-owner branch choice. Attack-space
selection and recipient-branch arbitration are separate decisions;
`insideArea` alone cannot decide either.

`Region` answers **where**. Relation filters, “foes in the area”, “all except
you”, Burst's default user exclusion, and other recipient rules answer
**who** and belong in U3/effect policy. A cell is removed from Region only when
source geometry actually removes that space. The typed design contract in
`primitives/area-resolution.ts` contains no `sourceExclusions` field.

The Small/Medium/Large Blast templates are now represented exactly
(`area-geometry.ts` `blastTemplateCells`, folded through the shared spatial
gateway's `blast` shape and the Demon Slayer Comet/Draken Cross resolvers);
no Chebyshev-square/radius approximation is permitted anywhere else, and a
unit whose blast clause still lacks resolver wiring stays unresolved.
Gran Levincross remains the stress test: validate its cross boundary, derive
four connected sections, damage the boundary, remove/place into a chosen
nearest-free cell on the save-selected side, and persist a wall that blocks
movement but not LoS. These compose Region, U3, U4, save, placement, terrain,
and persistence authorities; Gran itself is not a named generic primitive.

## Compatibility retained and next tranche

Retained deliberately: `RuleSelector`, `RuleChoice` constraint fields,
`RuleNumber` input/roll forms, the `job-kit` `walk`/`firstFreeCell` compatibility
helpers, modifier gate rows, and current source-ID exemptions. The next gate
tranche begins only after the table above is representable in U6; that bounded
vocabulary-and-parity tranche is lower risk than implementing Region /
ResolvedArea first, whose geometry, U3 recipients, several U4 decisions, and
Blast templates cross more authorities. U5 roll
cleanup and content-leak migration follow only after their replay/registration
contracts are explicit.
