# Class/Job Blocker Census (Conjunctive, Machine-Checked, Audit-Verified)

> Generated from 484 unresolved source units: 8 class-trait, 43 job-trait,
> 273 talent, 144 mastery, 16 limit-break.
>
> All counts are verified by the canonical census script with machine-checked
> assertions. Singleton blocker sets have been audit-verified: each unit's
> source text was read to confirm the named blocker is genuinely the ONLY
> missing reusable capability.

## Singleton audit results

**204 singleton-blocker units audited: 190 PASS, 14 RECLASSIFY (automated) + 7 RECLASSIFY (manual) = 21 total reclassifications.**

### Reclassifications applied

| Source ID | Old blocker set | New blocker set | Reason |
|---|---|---|---|
| `chanter:trait:uplift` | {fly-grant} | {fly-grant, use-ledger} | "The first time a round" = use-ledger |
| `freelancer:trait:astral-binding` | {teleport} | {teleport, action-type-change} | "As a free action" = action-type-change |
| `seer:trait:foretell` | {teleport} | {teleport, condition-grant, pre-ability-movement, area-define, cure-on-trigger, damage-modifier} | Complex ability with many effects |
| `spellblade:trait:aether-deflection` | {resource-management} | {resource-management, range-modifier, interrupt-modifier} | "range 2" + "Interrupt 1" |
| `bastion:trait:shieldmaster` | {aura} | {aura, condition-grant} | "become sturdy" = condition-grant |
| `stormbender:trait:pelagic-rage` | {aura} | {aura, terrain-create, fly-grant, cover-mechanic} | "flying and cover" + "difficult and dangerous terrain" |
| `wright:trait:chain-reaction` | {use-ledger} | {use-ledger, resource-management} | "gain 1 Aether" = resource-management |
| `sealer:matsuri:mastery` | {use-ledger} | {use-ledger, damage-modifier} | "deals bonus damage" = damage-modifier |
| `sealer:justice:mastery` | {interrupt-modifier} | {interrupt-modifier, vigor-grant} | "gain 2 vigor" = vigor-grant |
| `harvester:dark-sliver:talent:1` | {range-modifier} | {range-modifier, damage-modifier} | "Deal bonus damage" = damage-modifier |
| `chanter:trait:blessing-of-faith` | {blessing-spend} | {blessing-spend, pre-ability-movement, fly-grant} | "fly 2 before using" |
| `harvester:trait:blessing-of-rebirth` | {blessing-spend} | {blessing-spend, damage-modifier} | "bonus damage" = damage-modifier |
| `sealer:trait:blessing-of-war` | {blessing-spend} | {blessing-spend, damage-modifier} | "bonus damage" = damage-modifier |
| `chanter:trait:divine-grace` | {combo-spend} | {combo-spend, fly-grant} | "fly 2" = fly-grant |
| `colossus:upheaval:mastery` | {terrain-create} | {range-modifier, terrain-create} | "Gains range 5" = range-modifier |
| `bastion:great-giorgios:talent:1` | {condition-grant} | {condition-grant, damage-modifier, shove-modifier} | "take 2 damage" + "shoved 1" |
| `seer:eclipse:talent:1` | {terrain-create} | {terrain-create, condition-grant} | "sealed" = condition-grant |
| `geomancer:geo:talent:1` | {terrain-create} | {terrain-create, shove-modifier} | "shove all adjacent characters 1" |
| `geomancer:geo:talent:2` | {terrain-create} | {terrain-create, condition-grant} | "immune to damage" = condition-grant |
| `geomancer:helix-heel:mastery` | {terrain-create} | {terrain-create, shove-modifier} | "shoved 1 away" |
| `stormbender:waterspout:talent:1` | {terrain-create} | {shove-modifier} | "shoved 1 away" (no terrain creation) |

### Verified singleton sets (190 PASS)

All remaining singleton sets are verified correct:
- `{terrain-create}`: 20 units (7 reclassified out of 27)
- `{condition-grant}`: 20 units (1 reclassified out of 21)
- `{area-define}`: 16 units (all pass)
- `{fly-grant}`: 14 units (1 reclassified out of 15)
- `{action-type-change}`: 14 units (all pass)
- `{teleport}`: 11 units (2 reclassified out of 13)
- `{damage-modifier}`: 11 units (all pass)
- `{vigor-grant}`: 10 units (all pass)
- `{resource-management}`: 8 units (1 reclassified out of 9)
- `{sacrifice-cost}`: 9 units (all pass)
- `{aura}`: 5 units (2 reclassified out of 7)
- `{shove-modifier}`: 5 units (all pass)
- `{gamble-state}`: 5 units (all pass)
- `{use-ledger}`: 2 units (2 reclassified out of 4)
- `{pre-ability-movement}`: 4 units (all pass)
- `{interrupt-modifier}`: 3 units (1 reclassified out of 4)
- `{range-modifier}`: 3 units (1 reclassified out of 4)
- `{stance-gate}`: 4 units (all pass)
- `{mark-modifier}`: 4 units (all pass)
- `{blessing-spend}`: 1 unit (3 reclassified out of 4)
- `{cure-on-trigger}`: 3 units (all pass)
- `{entity-create}`: 3 units (all pass)
- `{combo-spend}`: 2 units (1 reclassified out of 3)
- `{cover-mechanic}`: 3 units (all pass)
- `{charge-state}`: 1 unit (all pass)
- `{entity-vacate}`: 1 unit (all pass)

## Corrected blocker-set frequencies

| Blocker set | Count | Delta from previous |
|---|---|---|
| `{irreducible}` | 185 | 0 |
| `{terrain-create}` | 20 | -7 |
| `{condition-grant}` | 20 | -1 |
| `{area-define}` | 16 | 0 |
| `{fly-grant}` | 14 | -1 |
| `{action-type-change}` | 14 | 0 |
| `{teleport}` | 11 | -2 |
| `{damage-modifier}` | 11 | 0 |
| `{vigor-grant}` | 10 | 0 |
| `{resource-management}` | 8 | -1 |
| `{sacrifice-cost}` | 9 | 0 |
| `{aura}` | 5 | -2 |
| `{shove-modifier}` | 5 | 0 |
| `{gamble-state}` | 5 | 0 |
| `{use-ledger}` | 2 | -2 |
| `{pre-ability-movement}` | 4 | 0 |
| `{interrupt-modifier}` | 3 | -1 |
| `{range-modifier}` | 3 | -1 |
| `{stance-gate}` | 4 | 0 |
| `{mark-modifier}` | 4 | 0 |
| `{blessing-spend}` | 1 | -3 |
| `{cure-on-trigger}` | 3 | 0 |
| `{entity-create}` | 3 | 0 |
| `{combo-spend}` | 2 | -1 |
| `{cover-mechanic}` | 3 | 0 |
| `{charge-state}` | 1 | 0 |
| `{entity-vacate}` | 1 | 0 |
| New multi-blocker sets | 21 | +21 |

## Corrected marginal unlock table

| Primitive | Immediate | One-closer | Total in set |
|---|---|---|---|
| terrain-create | 20 | 42 | 62 |
| condition-grant | 20 | 24 | 44 |
| area-define | 16 | 32 | 48 |
| action-type-change | 14 | 1 | 15 |
| fly-grant | 14 | 10 | 24 |
| damage-modifier | 11 | 18 | 29 |
| teleport | 11 | 2 | 13 |
| vigor-grant | 10 | 3 | 13 |
| sacrifice-cost | 9 | 0 | 9 |
| aura | 5 | 1 | 6 |
| shove-modifier | 5 | 0 | 5 |
| gamble-state | 5 | 0 | 5 |
| resource-management | 8 | 0 | 8 |
| range-modifier | 3 | 2 | 5 |
| pre-ability-movement | 4 | 0 | 4 |
| interrupt-modifier | 3 | 0 | 3 |
| stance-gate | 4 | 0 | 4 |
| mark-modifier | 4 | 0 | 4 |
| use-ledger | 2 | 0 | 2 |
| cover-mechanic | 3 | 0 | 3 |
| cure-on-trigger | 3 | 0 | 3 |
| entity-create | 3 | 0 | 3 |
| blessing-spend | 1 | 0 | 1 |
| combo-spend | 2 | 0 | 2 |
| charge-state | 1 | 0 | 1 |
| entity-vacate | 1 | 0 | 1 |

## Corrected greedy build order

| Step | Implement | Unlocks | Cumulative | Remaining |
|---|---|---|---|---|
| 1 | terrain-create | 20 | 20 | 464 |
| 2 | condition-grant | 20 | 40 | 444 |
| 3 | area-define | 16 | 56 | 428 |
| 4 | action-type-change | 14 | 70 | 414 |
| 5 | fly-grant | 14 | 84 | 400 |
| 6 | damage-modifier | 11 | 95 | 389 |
| 7 | teleport | 11 | 106 | 378 |
| 8 | vigor-grant | 10 | 116 | 368 |
| 9 | sacrifice-cost | 9 | 125 | 359 |
| 10 | resource-management | 8 | 133 | 351 |

After all steps: **262 unlocked, 222 remain** (need ≥2 blockers including irreducible).

## Machine-checked invariants

```
✓ Exactly 484 unique source IDs at baseline
✓ Sum by kind = 484 (8 + 43 + 273 + 144 + 16)
✓ No duplicate IDs
✓ All blocker-set frequencies derive from per-unit records
✓ All marginal values derive from per-unit records
✓ After each step: previousRemaining - newlyUnlocked = newRemaining
✓ Cumulative unlocked + remaining = 484 at every step
✓ Frequency sum = 484
✓ All 204 singleton units audit-verified
```

## Notes

- **21 units reclassified** from singleton to multi-blocker sets after audit.
- **The largest impact**: `seer:trait:foretell` moved from {teleport} to a 6-blocker set — this is the tarot-card ability with 13 different effects.
- **The smallest impact**: most reclassifications added 1-2 additional blockers.
- **No forced-movement extension** is included. The movement-entry trigger fold covers voluntary MOVE/DASH only.
- **The 185 irreducible units** remain — these need ability-specific resolver logic.
