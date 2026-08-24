# Condition-Grant Handoff (MiMo harvest boundary)

Status: **seam proven, census regenerated, bulk harvest NOT yet performed.**

This document is the engineering handoff for the condition-grant blocker
family. It records the adversarial re-audit, the reusable architecture, the
representative proof, and the exact boundary for a later bulk MiMo harvest.

> Authority: AGENTS.md §3–§6, §9. The census label is never semantic
> authority; every verdict below was checked against the unit's complete
> source text and the current engine capability.

---

## 1. Semantic audit

### Original claim

The pre-pass census reported **28 `{condition-grant}` singletons** (the
highest-value implementable blocker: 28 immediate / 54 one-closer / 80
multi-closer / 162 total-containing).

### Corrected result

| Verdict | Count | Units |
|---|---|---|
| Genuine singletons (implemented) | 3 | `bastion:valiant:talent:2`, `knave:provoke:talent:1`, `freelancer:showdown:talent:2` |
| Reclassified — hidden other mechanics | 25 | see table below |
| Remaining `{condition-grant}` singletons | **0** | none — the family is implemented |

The re-audit read every claimed singleton's full source text. 25 of the 28
contained mechanics beyond a condition grant (threshold overrides, range
overrides, damage-type changes, use-ledgers, effect-counts, save curses,
mastery attachment, …). They are **not** condition-grant work.

### Exact reclassifications (25)

The corrected sets below are the units' **current** blockers: their
condition-grant component (rebound, unstoppable, defiance, evasion, phasing,
pacified, vulnerable) is now implemented, so it is intentionally absent from
the set. These match the canonical census records exactly.

| Source ID | Corrected blocker set | Source evidence |
|---|---|---|
| `bastion:heracule:mastery` | `{attack-modifier, effect-count}` | "gains rebound" (the attack-bounce modifier, same family as Trick Shot's armed rebound — NOT a condition) + "second effect triggers +1 more time" |
| `colossus:massive-overhead:mastery` | `{action-type-change}` | "grants you 4 vigor" (fixed grant — expressible via the F7 fold's `'vigor'` mutation) + "no longer ends your turn" (round-gated) |
| `knave:revenge:mastery` | `{damage-modifier, area-define}` | "deal 2 damage to all adjacent foes" after vigilance |
| `shade:umbra:mastery` | `{range-modifier}` | "range to 6 and gains unerring" |
| `sealer:sanctify:mastery` | `{area-define, action-type-change}` | "place two areas without replacing" + round-4+ 1-action |
| `seer:wish:mastery` | `{damage-preview}` | "defiance, then unstoppable" (grants — implemented) on damage-would-reduce-to-0 |
| `enochian:aethershard:mastery` | `{movement-modifier}` | "gain phasing" (grant — implemented) + "objects cost 0 spaces" |
| `spellblade:nothung:mastery` | `{damage-modifier}` | "1 piercing damage becomes divine" |
| `knave:intimidate:mastery` | *(executable — F8)* | "become unstoppable" after the stun trigger, wired through the shared mastery gate |
| `demon-slayer:soul-blade:talent:2` | `{stance-gate, attack-modifier}` | "attacks gain exceed: tick the die up by 1" |
| `knave:revenge:talent:1` | `{save-modifier, area-define}` | "attacks against adjacent allies gain +1 curse" |
| `fool:gallows-humor:talent:2` | `{effect-count, threshold-modifier}` | "deal 4 damage again to a target at 25% hp or lower" |
| `fool:masquerade:talent:1` | `{use-ledger}` | "gain evasion after swapping" (grant — implemented) gated by "haven't acted yet this round" |
| `fool:chronotemper:talent:1` | `{movement-modifier}` | "dash gains phasing and ignores movement penalties" |
| `shade:shadow-play:talent:2` | `{choice-input}` | "one of them CAN gain evasion" (grant — implemented; player choice) |
| `chanter:aria:talent:2` | `{effect-count}` | "If Aria's special effect triggers twice" (grants — implemented) |
| `harvester:crimson-bloom:talent:1` | `{damage-preview}` | "If damage would reduce an ally to 1 hp or below" (grant — implemented) |
| `sealer:trait:mantra-of-sealing` | `{aura}` | "bless all adjacent allies … grant 2 vigor" (fixed 2-vigor grant expressible; adjacency projection on attacks is the blocker) |
| `sealer:open-the-gates:talent:2` | `{range-modifier}` | "gains a range equal to the round number" |
| `seer:sisyphus:talent:1` | `{save-modifier, entity-vacate}` | "+1 curse on the save" + "pacified after being returned" (grant — implemented) |
| `enochian:trait:soulfire` | `{threshold-modifier}` | "critical threshold 18+, exceed 13+" |
| `enochian:soul-burn:talent:1` | `{effect-count}` | "struck by two or more soul embers in the same turn" (grant — implemented) |
| `enochian:aethershard:talent:2` | `{pierce, aura}` | "gain pierce against characters adjacent to Aethershards" |
| `spellblade:odinforce:talent:1` | `{effect-count, use-ledger}` | "If you end a turn without attacking, +2 bolts" |
| `spellblade:odinforce:talent:2` | `{effect-count}` | "Comeback: 4 bolts instead of 2 on refresh" |

New blocker vocabulary introduced by this audit (each is a genuine reusable
capability, not a source-ID switch): `mastery-attachment`, `effect-count`,
`threshold-modifier`, `damage-preview`, `attack-modifier`, `save-modifier`,
`movement-modifier`, `choice-input`, `pierce`.

---

## 2. Architecture — the reusable seam

### What exists (reused, not duplicated)

- `condition` RuleMutation (primitives) with `apply`/`remove`, potency, and
  the existing duration model;
- the F7 talent fold `talentTriggerMutations` (kernels) with triggers
  `exceed` / `comeback` / `slay` / `collide` / `finishing-blow` / `always`,
  per-row `condition` overrides, and a deterministic `build`;
- lifecycle expiry (`expireBoundaryEffects`, turn-start/turn-end durations);
- status vs condition distinction in the adapter (`statusIds` — hatred,
  dazed, vulnerable, … land in `actor.statuses`; stealth, defiance,
  unstoppable, … land in `actor.conditions`).

### What was added (kernels/talent-recipes.ts)

`affectedFoeIds(mutations, state, sourceActorId, kinds)` — a source-ID-free
helper that reads the ability's own recorded `shove`/`damage` mutations and
the actors' sides to answer "did this ability affect exactly one foe, and
which?" It never re-decides anything at replay: the single-foe predicate and
the target both derive from the command-boundary mutation stream, so replay
applies exactly what the command folded.

### Why it is not a callback escape hatch

- The fold is the **only** execution point; content rows declare data
  (trigger + optional condition + build), never a per-content resolver.
- `affectedFoeIds` is generic (sides + mutation kinds), lives in the kernel,
  and is reused by all three consumers.
- Substantial targeting/predicate/lifecycle logic is **not** buried in rows:
  the rows that would need it were reclassified (see §7) instead of being
  force-fitted into `build`.

---

## 3. Representative implementations (proof)

All three were wired as `always`-trigger fold rows in
`content/jobs/talent-recipes.ts` and are automation-audit complete.

| Source ID | Family proven | Mechanism | Tests |
|---|---|---|---|
| `bastion:valiant:talent:2` | post-resolution conditional **target** grant | always + `affectedFoeIds(shove)` single-foe predicate → hatred (status) on the foe | positive, 2-foe control, replay |
| `knave:provoke:talent:1` | post-resolution conditional **target** grant (damage-based) | always + `affectedFoeIds(damage)` single-foe predicate → hatred (status) | positive, 2-foe control, replay |
| `freelancer:showdown:talent:2` | simple **self** grant on use | always → stealth (condition) on the user | positive, un-equipped control, replay |

The tests also pin the status-vs-condition landing rule (hatred → `statuses`
+ `ruleState['hatred-of']`; stealth → `conditions`), which was the one real
adversarial discovery of the pass.

Coverage delta: **403 → 406 complete programs**; 1543 → 1546 complete
clauses; unsupported talents **259 → 256**; unsupported clauses 3207 → 3204.

---

## 4. Regenerated census (docs/blocker-census.json + .md)

*Current state — the canonical census is regenerated by
`npm run audit:class-job-census` (writes both JSON and Markdown). The
figures below are from the current run; the condition-grant pass's original
delta (403 → 406 complete programs) is recorded in §3 above as history.*

- Unresolved: **442** — 7 class-trait, 38 job-trait, **245 talent**, 136
  mastery, 16 limit-break.
- `condition-grant` is **absent** from every blocker set and from both
  marginal tables (implemented primitive, stripped by Phase-5 harvest).
  Remaining condition-grant-containing records: **0**.
- Top implementable blockers (fresh numbers): range-modifier 1/53,
  terrain-create 13/52, teleport 13/42, entity-create 11/33,
  mark-modifier 11/32, fly-grant 10/29.
- Residual (non-implementable): 78.

---

## 5. MiMo harvest queue

### A. SAFE BULK HARVEST (content-only, fits the seam exactly)

**None remain.** The strict census invariant (no unresolved unit may have
only-implemented blockers) guarantees no additional `{condition-grant}`-only
unit exists. The three genuine singletons are already wired.

Future safe harvests are content-only rows — **no new kernel work** — for
any talent whose COMPLETE text is:

> "on a fold trigger (`always`/`exceed`/`comeback`/`slay`/`collide`/
> `finishing-blow`), grant condition C to [self | the single affected foe |
> the trigger targets], optionally for a turn-start/turn-end duration,
> optionally gated by `affectedFoeIds` single-foe or a bloodied check."

Recipe pattern (exact shape used by the three proof rows):

```ts
'<ability>:talent:<n>': {
  mechanic: '<exact source summary>',
  triggerEffect: {
    trigger: 'always', // or the source trigger
    condition: ({ state, mutations, actorId }) =>
      affectedFoeIds(mutations, state, actorId, ['shove' | 'damage']).length === 1,
    build: (actorId, _targets, _triggerTargets, context) => {
      if (!context) return [];
      const foes = affectedFoeIds(context.mutations, context.state, actorId, ['shove']);
      if (foes.length !== 1) return [];
      return [{ kind: 'condition', sourceActorId: actorId, actorId: foes[0],
        conditionId: '<id>', operation: 'apply', potency: 'normal' }];
    },
  },
},
```

Boundaries (do NOT generalize):
- **Statuses vs conditions:** check `statusIds` in `encounter-adapter.ts`
  before choosing `conditionId`; hatred/dazed/vulnerable/… are statuses and
  assert via `actor.statuses` (+ `hatred-of`), not `actor.conditions`.
- **Do not** add triggers to the fold beyond the six existing kinds without
  a new census-reviewed reusable capability.
- **Do not** wire any unit whose text also needs a non-condition mechanic —
  reclassify it (see §6).

### B. NEEDS EXISTING OTHER PRIMITIVE

These units' remaining blockers are separate reusable primitives; convert
only after those primitives land:

- range-modifier: `sealer:open-the-gates:talent:2`, `colossus:valkyrie:talent:1`,
  `shade:incubus:talent:1`, `freelancer:trick-shot:talent:2`, `harvester:harvest:talent:2`
- mark-modifier: `sealer:grand-seal:talent:2`, `sealer:divine-aegis:talent:2`
- stance-gate: `knave:dark-knight:talent:2`
- movement-modifier: `fool:chronotemper:talent:1`

### C. NEEDS EXTENSION OF THE CONDITION-GRANT ABSTRACTION

The condition component is real, but the trigger/predicate needs one small
generic capability that does not exist yet:

| Unit | Missing generic capability |
|---|---|
| `chanter:aria:talent:2` | effect-count trigger ("special effect triggers twice") |
| `enochian:soul-burn:talent:1` | same-turn instance count gate ("two or more soul embers") |
| `harvester:crimson-bloom:talent:1` | damage-preview gate ("would reduce to 1 hp or below") |
| `fool:masquerade:talent:1` | acted-this-round ledger + after-swap timing |
| `shade:shadow-play:talent:2` | after-swap timing + choice input ("one of them CAN") |
| `seer:sisyphus:talent:1` | save-curse modifier + return-to-start lifecycle |

### D. ARCHITECTURALLY SENSITIVE (do not bulk-convert)

- **Masteries** — the typed mastery-attachment mechanism landed as F8
  (`kernels/mastery.ts` + `EncounterActor.masteredAbilityIds`), so
  `mastery-attachment` is no longer a missing primitive. The 7 former
  `{mastery-attachment}` singletons (rook, dark-knight, intimidate,
  bleak-mercy, warding-bolts, gentleness, rampant-nail) are now executable;
  the remaining masteries above stay unresolved for their **effect**
  blockers only.
- `enochian:trait:soulfire` — threshold overrides interact with the attack
  roll pipeline (critical/exceed thresholds), not a grant.
- `spellblade:nothung:mastery` — damage-type override (piercing → divine)
  lives in the damage pipeline.
- `sealer:trait:mantra-of-sealing`, `enochian:aethershard:talent:2` — aura +
  adjacency projection with a vigor/pierce payload.
- `spellblade:odinforce:talent:1`/`:2` — bolt-count overrides are
  ability-internal (program-level), not fold rows.

---

## 6. Recommendation

**MiMo should NOT start a condition-grant bulk harvest.** The pure
condition-grant tranche is exactly three units — already implemented and
tested. The remaining units that mention conditions all carry other blockers
(§5 B/C/D); converting them now would require either missing primitives or a
new generic capability, and forcing them into the fold would violate
AGENTS.md §3/§6 (no approximation, no escape hatches).

The next primitive should come from the **regenerated** census (range-modifier
leads: 16 immediate / 71 total), not from stale pre-pass numbers. The
condition-grant seam is done; harvest when a future pass lands one of the
C-family capabilities and re-scans the units above.

---

## 7. Remaining architectural blockers (condition-adjacent)

| Family | Minimum missing capability | Units |
|---|---|---|
| Mastery attachment | **DONE (F8)** — `kernels/mastery.ts`; 7 former singletons executable | remaining masteries need only their effect blockers (see the regenerated census) |
| Effect-count trigger | "when an ability's named effect fires N times" fold trigger | aria t2, soul-burn t1, gallows-humor t2, odinforce t1/t2 |
| Damage-preview gate | "if damage would reduce target to ≤X hp" predicate on the fold | crimson-bloom t1, wish mastery |
| After-swap timing | post-swap window (mirrors the existing post-resolution fold) | masquerade t1, shadow-play t2 |
| Save-curse modifier | "+N curse on the save" shared modifier | revenge t1, sisyphus t1, grand-seal t1, endless-battlement t1 |
| Acted-this-round ledger | reusable use-ledger key for "haven't acted yet this round" | masquerade t1 |
| Threshold modifier | critical/exceed threshold overrides on the attack path | soulfire (trait) |

Each is a single generic capability; none justifies a per-content resolver.
