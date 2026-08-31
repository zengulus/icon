# U16 Semantic Correction — 2026-08-31

Narrow corrective tranche following the residual-U16 census
(`docs/u16-residual-census-report.md`). The census promoted U16 to
AUTHORITATIVE too early; two classifications did not survive fresh evidence:

1. **Bull's Strength** was migrated with the wrong entitlement identity/scope
   (a single actor-local owner-relative `turn` gate, instead of a
   per-recipient battlefield `any-turn` gate).
2. **`monogatari:granted`** was retained as content state, but it answers a
   usage/entitlement question ("may this character receive the Monogatari
   fulfillment reward again during the current song?") that the current U16
   `UsagePeriod` vocabulary cannot represent. Inability to represent the scope
   is incompleteness, not disjointness.

Status entering this tranche: **U16 = PARTIAL** (deliberately — this pass
does not attempt to restore AUTHORITATIVE). No source units promoted; no
U2/U13/U17 reopen; the U8 tranche is identified but **not** started.

---

## Deliverable 1 — Fresh HEAD

```text
git rev-parse HEAD   # f483152 (U16 residual-usage-state census & migration) + this tranche's worktree
```

## Deliverable 2 — Bull's Strength: old incorrect identity/scope

ICON p.149:

> Bull's Strength: All your abilities gain collide: deal 2 damage. Characters
> can't take this damage more than once a turn.

The census migration routed the collide bonus through:

```text
source = Bull's Strength            ('core:bull-s-strength')
owner  = Bastion / trait source
target = (absent — a single actor-local gate)
scope  = owner-relative 'turn'      (refreshed only at the OWNER's own turn-start)
cap    = 1
```

That was wrong twice over:

- **Restriction belongs to the RECIPIENT.** "Characters can't take this damage
  more than once a turn" limits each character receiving the damage, not the
  Bastion. A single actor-local gate on the Bastion meant two different foes
  could not each take the bonus once in one turn (a fold test even asserted
  "two foes collide; only one damage" — since deleted).
- **Battlefield `any-turn`, not owner-relative `turn`.** The window is the
  current battlefield turn and reopens at the NEXT actor's turn start; it must
  never wait for the Bastion's own next turn.

## Deliverable 3 — Bull's Strength: corrected U16 identity

```text
source = Bull's Strength            ('core:bull-s-strength', opaque provenance)
owner  = Bastion / trait source     (the ledger storage actor — OWNER ≠ TARGET)
target = character receiving the Bull's Strength damage (U16 ':target:' key suffix)
scope  = 'any-turn' battlefield window (reopens at EVERY actor's turn start)
cap    = 1
```

Entitlement question answered:

> Has THIS target already taken Bull's Strength damage from THIS source/owner
> during the current battlefield turn?

Durable key (U16 `usageKey` with a target suffix, stored on the OWNER's
ruleState):

```text
ledger:any-turn:core:bull-s-strength:target:<targetId>
```

Owner identity is the storage actor; target identity is the key suffix — so
two different Bastions never alias and two different targets never share a
gate. The key is cleared by the shared `refreshAnyTurnLedgersForAll` sweep at
every turn boundary (the same any-turn sweep that reopens No Repeats,
one-interrupt-per-turn, Slashed, and dangerous terrain), which gives the
correct battlefield reset with no owner-turn dependency. The bespoke
turn-end/owner-turn-start clears are gone.

## Deliverable 4 — Exact production path (availability + consume)

`kernels/use-ledger.ts` (U16 adapter):

- `bullStrengthCollideKey(targetId)` — the typed per-target any-turn key
  (`usageKey({ sourceId, ownerId: '', scope: 'any-turn', targetId })`).
- `applyBullStrengthCollide({ actor, targetId, sourceId, mutations })` — the
  U16 COMMIT operation (the F9 operation-boundary pattern): the caller
  PROPOSES the 2-damage mutation; U16 owns availability (`ledgerAvailable` on
  the per-target key), the consume mark (`consumeUsageMutation`, recorded on
  the owner), and the grouping into the returned bundle. The caller can
  neither decide availability nor hand-build the consume.

`content/jobs/attack-modifier-recipes.ts` (`bullStrengthCollideMutations`,
called from `executeRuleProgramWithReactiveTriggers` in `encounter.ts`):

1. `collidedTargets = collidingShoveTargets(state, mutations)` (shared
   detection).
2. For each colliding shove whose source actor has the trait and whose target
   is alive: `key = bullStrengthCollideKey(shoved.id)`.
3. Same-command dedupe by the exact U16 identity — `planned.has(key)` (the
   full ledger key string encodes owner-storage + source + target + window).
   An ability that shoves the same character twice awards the bonus once; two
   different targets get two independent gates. This is NOT a `guardSeen`
   keyed on `source.id`, and it never substitutes for the ledger availability
   check (it only dedupes within one command before recorded consumes apply).
4. `appended.push(...applyBullStrengthCollide({ actor: source, targetId:
   shoved.id, sourceId: BULL_STRENGTH_TRAIT, mutations: [2-damage] }))`.
5. The returned damage + consume ride the recorded event; replay applies them
   verbatim and never re-decides entitlement.

Reset: `refreshAnyTurnLedgersForAll(state)` runs at every turn boundary in the
reducer (`applyTurnTransition` and the `TURN_STARTED` handler), clearing the
`ledger:any-turn:*` keys on every actor — the next actor's turn start is
sufficient.

## Deliverable 5 — Bull's Strength adversarial matrix

Coverage in `attack-modifiers.test.ts` (fold + command level) and
`u16-residual-census.test.ts` (command level, two-owner fixture):

| case | result |
| --- | --- |
| same target collides twice in one turn → exactly one Bull's Strength damage | PASS (one damage + one consume) |
| two different targets collide in one turn → each takes one | PASS (two damages, two consumes) |
| target A consumed does not block target B | PASS (A blocked, B entitled) |
| two different Bastion owners do not alias | PASS (owner A's consume leaves owner B's same-target gate open; owner B's collide fires) |
| next battlefield turn start refreshes eligibility | PASS |
| another actor's turn start is sufficient — no owner-turn dependency | PASS (hero's window reopens after the FOE's turn starts; the Bastion never takes its own turn between) |
| same command with repeated target does not double-consume | PASS (planning set keyed on the full U16 key) |
| replay reproduces exactly the recorded target-sensitive consumes/damage | PASS (`applyEvents(state, events)` byte-identical) |

Deleted/rewritten: the old "two foes collide; only one damage" assertion is
gone (it encoded the wrong identity).

## Deliverable 6 — Monogatari classification correction

ICON p.179: "Characters can only fulfill this condition once per song."

Current `monogatari:granted` is read (lifecycle turn-end recipe) as:

> may this character receive the Monogatari fulfillment reward again during
> the current song?

and is cleared when a new song (tale) is established. That is a
usage/entitlement question: U16 owns "how many times has/may this rule trigger
within Scope X?" and supports target/reference-sensitive identity; U8 owns
generic scope/clock semantics including source-defined lifecycle boundaries.

**Classification: `monogatari:granted` = UNRESOLVED U16 CONSUMER, blocked on
the U8 source-defined lifecycle scope.**

- No `'song'` U16 period is invented in this tranche.
- No migration onto `turn`, `round`, `combat`, or another approximate period.
- It is NOT called RETAINED SPECIALIST merely because the generic scope
  substrate cannot represent "song" yet.

## Deliverable 7 — Focused retained-state re-audit

Focused recheck of the retained bucket for the exact failure mode ("does this
state actually answer may/how-many-times before some reset boundary?"):

| retained | semantic question it answers | classification |
| --- | --- | --- |
| `wicked-sheath:charged` | Is the charged die armed? (consumed by the next hit) | MODE state |
| `riposte:armed`, `revenge:active`, `riposte:last-gamble` | Is the stance/next use armed? what was the last gamble value? | MODE state / recorded value |
| `hissatsu:armed`, `ace:armed`, `trick-shot:armed`, `carnevale:armed` | Is the NEXT attack armed with the extra effect? (consumed by the next attack) | MODE state — "the next attack has property X" is exactly the allowed armed pattern |
| `demon-edge:window` (+round), `massive-overhead` | Is the bonus-damage/true-strike window active? | MODE/window state |
| `morrigan:pending`, `aria:pending`, `eclipse:pending`, `implode:pending` | Is a delayed effect pending its trigger? | MODE state (delayed-effect life, consumed by its own trigger) |
| `sucker-punch:used` | (none — write-only record) | recorded fact; no production reader can block a use |
| `attackedThisTurn` | did this actor already attack (historical)? | U10 fact (the one-attack entitlement is the separate `attack-this-turn` ledger key) |
| `monogatari:granted` | may this character receive the reward again this song? | **UNRESOLVED U16 CONSUMER** (corrected) |

Each armed/charged/pending flag answers "is the mechanic armed/charged/pending
right now?", consumed by the next attack/step — never "may this use occur
again before a boundary?" — so they remain MODE state with no fallback usage
gate. The only corrected classification is `monogatari:granted`. No other
retained item is broadly migrated.

## Deliverable 8 — Corrected U16 status

**U16 = PARTIAL.**

- All currently representable `UsagePeriod`s (turn / any-turn / round /
  combat) are clean: every genuine consumer routes through the typed ledger.
- But AUTHORITATIVE requires the declared contract, not just the subset the
  implementation supports. `monogatari:granted` is a live usage-entitlement
  consumer the current U16/U8 vocabulary cannot represent; Bull's Strength
  additionally proved the census classification bar was too low.
- Do not restore AUTHORITATIVE in this tranche. A later U16 follow-up, after
  U8 supplies the generic source-defined lifecycle scope, must migrate
  `monogatari:granted` and re-run the full adversarial + census re-audit.

## Deliverable 9 — U1–U17 matrix delta

Only U16's row changed on this tranche's evidence: it returns to **PARTIAL**
(with the census's premature re-certification withdrawn). U2/U13/U17 stay
AUTHORITATIVE; U8/U14/U9/U6/U12/U4/U5/U7 stay PARTIAL. No other row changed.

## Deliverable 10 — Census 427 / zero promotion

`npm run audit:class-job-census` regenerates `docs/blocker-census.json` +
`.md` byte-stable: **427 unresolved, no promoted units**. Zero source-unit
promotion in this tranche.

## Deliverable 11 — UNDERLAY PHASE

**OPEN.** U8 Scope/Clock plus U14/U9/U6/U12/U4/U5/U7 remain PARTIAL.

## Deliverable 12 — Next tranche (identified, not started)

**U8 Scope / Clock — duration, timing, scheduler, and source-defined
lifecycle boundaries.** The U8 tranche must determine the generic
representation for boundaries such as:

- current song / next song;
- source-defined lifecycle event;
- N occurrences;
- next matching boundary;

without inventing Monogatari-specific generic architecture. Once U8 supplies
the generic scope, a later U16 follow-up can migrate `monogatari:granted` and
re-audit U16 for AUTHORITATIVE status. **Not implemented in this pass.**

---

## Validation

| check | result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npm test` (`npx vitest run`) | PASS (full suite) |
| `npm run build` | PASS |
| `npm run audit:architecture` | 0 violations |
| `npm run audit:automation` | PASS |
| `npm run audit:source-fidelity -- --strict` | PASS |
| `npm run audit:outcome-triggers` | PASS |
| `npm run verify:source-artifacts` | PASS |
| `npm run audit:class-job-census` | 427, 0 promoted, byte-stable |
| replay / adversarial | PASS (BS target matrix + census suites) |
| `git diff --check` | PASS |
