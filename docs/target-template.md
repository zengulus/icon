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
  coMovedActorIds,                     // batch mates that vacate their cells
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
- **Occupancy honors co-moved actors.** `applyRuleMutations` passes the
  batch's move-actor set, so paired swaps and multi-target repositioning
  validate atomically; a single place onto an occupied cell is denied.
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
| Occupancy | place onto an occupied cell → denied `occupied`; co-moved swap applies | done |
| Impassable terrain | place onto an `impassable` grid cell → denied `impassable-terrain` | done |
| Rampart entry/exit | teleport into a fortify-projected rampart cell → denied `rampart`; slip ignores it | done |
| Rampart dash/fly | rush/fly into a rampart cell → denied; free landing applies | done |
| Immobile | a move mutation on an immobile actor → never applies | done (caller gate) |
| Area center legality | burst center out of bounds or beyond the source's reach → denied; free-space center must be unoccupied and passable | done (`computeSpatialArea`) |
| Area inclusion parity | kernel cells === `squareArea`/`lineCells`; inclusion matches manual filtering; foe blast resolver routed through it | done |
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
