# Rules-engine foundations

This is the implementation order for cross-cutting ICON mechanics. It is a
source-linked engineering ledger, not an automation-coverage claim. None of
these foundations changes the independently executable program audit or the
Phase 1/2 gates by itself.

The project currently has 303 reviewed executable programs and 3,350
unresolved clauses. `PHASE_TWO_READY` and `PHASE_THREE_READY` remain `false`.

## 1. Damage and defeat kernel — started

Source: pp.89, 93–95, 102–105, 107.

`automation/damage-resolution.ts` now owns pure damage determination and the
HP/vigor application split. `encounter-adapter.ts` derives encounter conditions
into a typed `EncounterDamageIntent`, applies one final halving only after flat
reductions, and owns the canonical `defeatActor` lifecycle.

The determined-damage handoff carries an explicit `bypassVigor` flag: p.89
dangerous terrain is piercing damage that bypasses vigor, while piercing is
not silently treated as a global bypass rule. Historical held-damage windows
retain their former divine-only default until they are regenerated.

`automation/attack-resolution.ts` now owns the pre-damage roll itself. Basic
attacks, VM effects, job-kit resolvers, core-resolver compatibility calls, and
Bleak Mercy use its recorded Evasion → d20 → capped boon/curse → total →
critical sequence, including terrain elevation and Dazed. An Evasion success
is durably represented as a null d20/total plus its d6 result rather than a
made-up attack roll.

The same attack result now carries only the two source-backed downstream
exceptions that damage needs: high ground ignores cover against a lower target
(p.89), and True Strike ignores Dodge (p.104). They follow only the matching
attack target's direct hit/miss damage branch; they do not leak into collateral
areas or unrelated later effects.

The following replay paths now use that application kernel:

- VM damage and held damage;
- basic attacks;
- dangerous terrain and Slashed self/ally ability-movement damage;
- legacy `ABILITY_RESOLVED` records;
- Vigilance's already-determined legacy event amount;
- Great Giorgios's delayed damage;
- Counter and Gentleness reflection.

Source amounts and already-determined amounts are now intentionally distinct:
`determineAndApplyEncounterDamage()` is for direct reducer/lifecycle source
damage (terrain, Slashed, delayed Great Giorgios, Counter, and Gentleness),
while `applyDeterminedEncounterDamage()` is reserved for persisted legacy
`appliedDamage` records and held interrupt windows. This prevents both
accidental mitigation bypasses and accidental double mitigation.

`gainVigor` likewise owns the Vitality cap recorded by the checked-in p.105
source unit plus Rot/Shattered denial. Cure, generic vigor mutations,
historical Recover replay, and literal Regeneration use it. Bloodied remains
wound-aware through `isBloodied`.

### Still TODO

- `TODO(ICON-rules, pp.93–107)`: evolve replay events into a complete
  `DamageIntent → DeterminedDamage → AppliedDamage` ledger, including source,
  target, delivery, cover/line-of-effect provenance, immunity, Defiance,
  interrupt-window state, and defeat result. Direct replay cannot safely open
  a new interrupt window until that provenance is durable.
- `TODO(ICON-rules, pp.93–107)`: when converting any remaining event, decide
  **which side of the handoff it serializes**. A source amount must be replayed
  through `determineAndApplyEncounterDamage`; a final amount must carry the
  complete determination provenance and use `applyDeterminedEncounterDamage`.
  Never introduce another numeric `damage` field without that designation and
  a source/replay pair covering armor, Resistance, Defiance, and vigor.
- `TODO(ICON-rules, pp.93–105)`: source-specific damage exceptions must stay
  typed and narrow. The p.144 Bleak Mercy flags are the model: mark the
  determination exception (`ignoreArmor`) separately from application
  exceptions (`bypassVigor`, `ignoreDefiance`), persist any application flag
  in held damage, and prove that every unnamed defense still works. Do **not**
  use `divine` as a shortcut, and do not let `ignoreDefiance` bypass the
  generic `damage-immune` bit until immunity has durable origin provenance.
- `TODO(ICON-rules, pp.87–94, 107)`: make the recorded attack roll one part
  of a durable `AttackResolution` ledger with legal target/range/line-of-effect
  provenance, attack-window choices, cover, and its downstream DamageIntent.
  The roll arithmetic is unified; target authority and trigger windows are
  not yet unified.
- `TODO(ICON-rules, p.104)`: do not promote Defiance, Counter, Dodge, Sturdy,
  or broad foe traits merely because one path is routed. Counter's exact
  “damaged by an ability” trigger, Dodge delivery coverage, and Sturdy's
  per-turn forced-movement ledger require the durable damage/trigger model.
- `TODO(ICON-rules, p.105)`: Vigilance must become a `DamageWindow` /
  `TriggerWindow` action. Its legacy command does not yet prove range 2,
  adjacency-breaking/damaged trigger provenance, or one use per triggering
  event.
- `TODO(ICON-rules, p.186)`: Rot's `noDefiance` mark state needs an explicit
  source-ID passive projection; its ally-mark Regenerate branch likewise must
  project a reviewed Regeneration condition instead of relying on prose.

## 2. Target and spatial gateway — seed in place

Source: pp.87–92, 94, 104, 107.

`automation/targeting.ts` is the framework-free seed used by VM selectors and
the direct one-target gates for basic attacks, reviewed ability commands, and
reviewed raw rule commands. It makes `self` and `ally` distinct (an ally is
another living ally under p.92), excludes defeated/off-battlefield actor
inputs by default, and gives the direct gate one ordered handling of Blind,
True Strike, Stealth, point-cell range, and line of sight. This also closes
the former direct-`EXECUTE_RULE` Blind range bypass.

### Still TODO

- `TODO(ICON-rules, pp.87–92)`: extend the state-derived `TargetQuery` from
  one direct target to listed target sets/cardinality, footprint/size range,
  all ability input shapes, and targetability. Point-cell distance remains a
  compatibility metric until the p.92 footprint fixture matrix exists.
- `TODO(ICON-rules, pp.87–90, 107)`: route VM movement destinations,
  teleport/place/swap, areas, and force movement through a `SpatialIntent`.
  Current named resolvers and `applyMovement` still have separate destination
  validation.
- `TODO(ICON-rules, p.298)`: add an explicit source-ID `FoeRoleBaselineRecipe`
  after the damage/target/lifecycle hooks are correct. Skirmisher Dodge,
  Heavy Guard, Artillery Slip/Aetherwall, and Legend Juggernaut must never be
  inferred from role prose at runtime.

### Passive projection registry

`automation/passive-projection.ts` is now the only trait-to-condition
projection point used by the encounter adapter. It combines the closed
character trait entries with the separately audited 36-ID foe
Flying/Phasing manifest. Unknown trait text and role labels have no mechanical
effect. This registry is deliberately a staging point—not evidence that
Defiance, Counter, Regeneration, Dodge, Sturdy, or p.298 role baselines are
complete.

## 3. Save windows — started

Source: pp.94, 102, 104, 129, 143–144, 186.

`automation/save-window.ts` now owns the replayable d20 + boon/curse result
for one save. It is used by ordinary status saves, Cure/Recover, generic VM
`save` effects, Penumbra, and the legacy core Recover resolver. Each new save
has a stable `windowId`; Rot's curse applies to saves generally, while Sweet
Torment remains limited to Cure/status-clearing denial.

### Still TODO

- `TODO(ICON-rules, p.102)`: expose Blessing choices for generic saves by
  stable `windowId`, with bounded transport validation and replay consumption.
  The current actor/status choice map intentionally remains only for known
  core status windows.
- `TODO(ICON-rules, p.129)`: make Six Hells's movement exit save a recorded
  `SaveWindow` rather than a raw command-time d20.
- `TODO(ICON-rules, p.143)`: extend Sucker Punch deliberately to each allowed
  SaveWindow kind. It currently holds only VM save branches with a reroll AST;
  status, Cure, Penumbra, and movement scope must be source-decided.
- `TODO(ICON-rules)`: retain generic save continuation branches in a
  first-class window/event record before delayed/multiple save choices are
  enabled.

## 4. Turn transitions and lifecycle — boundary seam in place

Source: pp.87, 91, 94, 103–104, 107, 129, 186.

All current end-turn causes now construct the same `TURN_ENDED` boundary and
record whether it was voluntary, ability-tagged, forced by a status, or
rule-requested. `applyTurnTransition()` is the single ordered replay boundary
for status saves, passives, expiry, delayed marks, held windows, round reset,
and turn-start hooks. This is a seam and provenance record, not yet a general
lifecycle registry.

### Still TODO

- `TODO(ICON-rules, pp.87, 91, 94, 107)`: introduce a `TurnTransitionIntent`
  and ordered boundary plan. It must capture end cause, dice/save windows,
  lifecycle participants, and replayable mutation ordering without flattening
  source-specific interrupt order.
- `TODO(ICON-rules, pp.102, 178–179)`: make lifecycle Cure callers such as
  Aria and Chastise declare whether they open a full Cure save window. They
  presently preserve historical deterministic vigor-only behavior rather than
  silently rolling unrecorded dice.

## Required foundation tests before promotion

Any later source-ID trait/ability promotion that relies on these systems must
add the appropriate matrix, not just a happy-path unit fixture:

- the same damage through basic attack, VM, terrain/Slashed, delayed effect,
  held damage, and reactive damage;
- target legality parity across `USE_ABILITY`, `EXECUTE_RULE`, and VM inputs;
- a replay pair for each `SaveWindow` kind and its modifier/denial policy;
- normal, forced, tagged, and state-requested turn-end parity;
- a closed source-ID passive recipe plus a non-recipe exclusion assertion.

Until those matrices exist, the relevant source text stays visible and the
automation audit remains conservative.
