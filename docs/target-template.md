# Target / spatial template

The F1 foundation routes every spatial authority through one validated
record — `SpatialIntent` in `src/rules/automation/primitives/spatial-intent.ts`. An
intent names who moves, who caused it, from where to where, and which spatial
authority applies; `validateSpatialIntent` is the single decision point for
**bounds, occupancy, impassable terrain, and Rampart**, and
`applySpatialIntent` applies only legal intents. The durable record of an
applied intent is the `RuleMutation` (`kind: 'move'`) the event log
serializes; the intent is the shared pure kernel both command construction
and replay consume.

Condition-derived authority stays with the encounter adapter (the
fortify/rampart/slip/unstoppable projection and the `immobile` denial); the
kernel folds the caller's `rampartObstructed` decision in so every
destination problem shares one validation result.

## 1. Route a new destination path

Never validate a destination inline in a resolver. Build the intent and call
the gateway:

```ts
const intent: SpatialIntent = {
  kind: 'place',                       // 'place' | 'teleport' | 'move'
  actorId: target.id,
  sourceActorId: context.actorId,
  sourceRuleId: context.sourceId,
  from: target.position,
  to: destination,
  coMovedActorIds,                     // same-declared-group mates (see below)
  rampartObstructed,                   // caller-computed (see below)
};
const result = applySpatialIntent(state, intent);
```

Rules of thumb:

- **Rampart (p.104)** blocks dashing, flying, and teleporting only. A
  teleport is denied when *entering or leaving* rampart differs; a fly/rush
  destination is denied when rampart-obstructed for the mover; placement (a
  throw, a summon, a return) and shoves are not teleports and never trigger
  it. `slip` / `unstoppable` (p.105) ignore it.
- **Occupancy exemption is group-scoped.** A move leg may ignore the
  current footprints of actors in its OWN source-declared spatial group
  (legs sharing its `spatialBatchId`) — they leave those cells in the same
  simultaneous swap. An ungrouped leg receives no exemption at all: it
  resolves independently against authoritative current occupancy, and
  actors in a different spatial batch are never treated as co-moved with
  it. There is no batch-wide "everyone who moves in this event" set.
- **Swaps are source-declared atomic destination permutations.**
  `swapMutations` tags every leg with a `spatialBatchId`; the reducer
  prevalidates only declared groups together against the same pre-swap state
  (simulated on a clone, with an injective-destination check) and applies
  every leg or none — a swap with one illegal leg (out of bounds, occupied
  by a non-group actor, Rampart-denied teleport, or a duplicate
  destination) is denied entirely, never partially applied. Ordinary
  multi-target movement without a batch id resolves per-leg, independently
  against current occupancy (`kernels/encounter-adapter.ts`
  `deniedAtomicSpatialLegIndices`).
- **Placement can return an off-battlefield actor** (e.g. Heroic
  Intervention p.122 leaves and returns in one batch) — the gateway only
  rejects missing or defeated actors, not off-field ones.
- **Areas route through `computeSpatialArea`.** A `SpatialAreaIntent`
  (shape burst/line, center, radius, reach, center-legality flags) is
  validated and resolved by the gateway: out-of-bounds or unreachable
  centers are denied, free-space centers must be unoccupied and passable,
  and the cells (p.95) plus inclusion are derived deterministically. The
  generic foe blast resolver routes through it; job resolvers may adopt it
  as they are reviewed.
- **Footprint distance (p.92) is still a TODO.** The direct gates and the
  gateway use point-cell (Chebyshev) distance until the footprint fixture
  matrix below exists; never approximate footprint range inline.

## 2. The p.92 footprint fixture matrix (required before promotion)

Any source-ID promotion that relies on F1 target authority must add the
matching row, not just a happy-path unit:

| Authority | Fixture shape | Status |
| --- | --- | --- |
| Bounds | place/teleport/rush to x/y < 0 or ≥ grid edge → denied `out-of-bounds` | done (`__tests__/spatial-intent.test.ts`) |
| Occupancy | place onto an occupied cell → denied `occupied`; a same-group swap leg applies; an ungrouped leg into a co-mover's cell → denied | done |
| Swap permutation | one illegal leg → the whole declared swap denied (every leg or none); duplicate destinations → denied; three-party rotation → all legs apply; ungrouped multi-target movement stays per-leg | done (`spatial-intent.test.ts` atomic-group matrix) |
| Impassable terrain | place onto an `impassable` grid cell → denied `impassable-terrain` | done |
| Rampart entry/exit | teleport into a fortify-projected rampart cell → denied `rampart`; slip ignores it | done |
| Rampart dash/fly | rush/fly into a rampart cell → denied; free landing applies | done |
| Immobile | a move mutation on an immobile actor → never applies | done (caller gate) |
| Area center legality | burst center out of bounds or beyond the source's reach → denied; free-space center must be unoccupied and passable | done (`computeSpatialArea`) |
| Area inclusion parity | kernel cells === `squareArea`/`lineCells`/exact `blastTemplateCells` (small = plus, medium = 3×3, large = 13-cell); inclusion matches manual filtering; foe flash-bomb blast resolver routed through the gateway's `blast` shape | done |
| Footprint range | point-cell vs footprint (p.92) parity across the direct gate, VM selectors, and areas | TODO |
| Line of effect | area/line cells through obstacles | TODO |
| Arc shape | 90-degree arc geometry and legality | TODO |
| Teleport/forced in relics/legends | destination authority for relic and legend content | TODO |

## 3. Fixtures

`__tests__/spatial-intent.test.ts` pins each matrix row through the real
reducer command surface (`RULE_MUTATIONS_APPLIED` via `applyEvents`, the same
events transport serializes), asserts the stable problem on denial, and
replays every accepted event to the identical state.

## 4. Verify

```bash
npm run typecheck
npm test
npm run build
npm run audit:automation   # unchanged — the gateway is shared authority,
                           # not EXECUTE_RULE coverage
```
