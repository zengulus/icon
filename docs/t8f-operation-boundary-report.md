# U16 / F9 Operation-Boundary Repair (T9g, 2026-08-31)

Lead specialization: **S9 audit/verification** with **S4** (U16 entitlement
routing / replay) and **S2** (rules-substrate authority boundary). The narrow
F9 corrective: the once-per-round reactive job-trait fold's ENTIRE entitlement
operation moves behind the U16 usage/entitlement ledger, so F9 can propose
effects but only U16 can turn them into an allowed once-per-round transaction.

## 1. Fresh HEAD

Worked on current `zengulus/icon` HEAD `2134c7b` (Final deepseek repair). No
U2 reopen, no source promotion, no residual U16-mark migration started.

## 2. Old F9 authority path (before)

`kernels/trait-reactions.ts` exposed a branded data object:

`oncePerRoundGate(actor, sourceId)` → `OncePerRoundGate`

```ts
interface OncePerRoundGate {
  readonly key: string;          // ledger:round:<sourceId>
  readonly available: boolean;   // U16 availability read
  readonly consume: state mutation;
  readonly identity: UsageIdentity;
  readonly [oncePerRoundGateBrand]: true;   // module-private unique-symbol brand
}
```

The brand was meant to prove "only `oncePerRoundGate` can produce a valid
plan." It was still forgeable through object spread, because spreading a real
gate preserved the hidden brand while replacing any semantic field:

```ts
const real = oncePerRoundGate(actor, sourceId);
const forged: OncePerRoundGate = { ...real, available: localAvailable, key: localKey, consume: localMutation };
```

That is an unforgeable-DATA problem. A branded result object cannot be made
unforgeable against aliasing/spread. This tranche stops trying: it moves the
semantic DECISION behind the boundary instead.

## 3. New U16 operation boundary

**`kernels/use-ledger.ts` — U16 COMMIT operation** (the semantic authority):

```ts
type OncePerRoundTransaction =
  | { available: false }
  | { available: true; mutations: readonly RuleMutation[] };

function applyOncePerRoundUsage(options: {
  actor: EncounterActor;        // typed owner identity
  sourceId: string;             // content-owned provenance
  mutations: readonly RuleMutation[];   // the caller's proposed effects
}): OncePerRoundTransaction;
```

The entire once-per-round entitlement transaction happens inside this ONE
operation. It returns either "unavailable" (emit nothing) or the COMPLETE
commit bundle = the caller's proposed effects PLUS the U16 consume mark, which
the caller commits verbatim. Nothing smaller is exposed.

The F9 fold (`kernels/trait-reactions.ts`) is now:

```text
trigger qualifies
→ F9 builds the reaction's ordinary effect mutations (proposed, provenance-stamped)
→ F9 calls applyOncePerRoundUsage({ actor, sourceId: traitId, mutations: proposed })
→ U16 checks entitlement, derives key, builds consume, groups consume with effects
→ unavailable: F9 emits nothing
→ available: F9 commits result.mutations UNCHANGED
```

The branded plan (`OncePerRoundGate`, `oncePerRoundGate`, the private
`oncePerRoundGateBrand` symbol) and the per-piece round-ledger adapters
(`roundLedgerKey`, `roundLedgerUsageSpec`, `roundLedgerAvailable`) are DELETED
from `trait-reactions.ts`. F9 exposes no gate internals to forge.

## 4. Exact ownership split

| Owners | Decision |
| --- | --- |
| **F9** (`trait-reactions.ts`) | whether the reaction trigger occurred (collide/shove/slay); the reaction's ordinary effect mutations (PROPOSED) |
| **U16** (`applyOncePerRoundUsage`) | typed owner identity (from the `actor` arg); usage scope (round); physical key derivation (`usageKey` → `ledger:round:<sourceId>`, byte-identical to before); availability check (`ledgerAvailable`); the consume mutation (`consumeUsageMutation`); grouping the consume with the allowed reaction effects into one bundle |

F9 no longer owns: whether the usage remains available, what key represents
the entitlement, or how consumption is recorded. It cannot separately decide
availability and cannot separately construct the usage-consume mutation.

The F9 fold gates on `result.available` and commits `result.mutations`
verbatim — nothing else can be the committed once-per-round transaction.

## 5. Adversarial results (the five cases)

Proven against the current HEAD fold + the `u16-usage-ledger-routing` guard
(`scripts/audit-architecture-core.ts` Checks 8/9) + unit tests.

1. **Call U16 but independently check raw/aliased `ruleState`.** The fold gates
   on `result.available`; the guard's M1 pin flags any `ruleState[` read in the
   F9 fold, and the positive `result.available` pin requires the decision to
   come from the bundle. **CAUGHT** (`trait-reactions.test.ts` adversarial-1 +
   `architecture-audit.test.ts` "keeps the operation but reads raw ruleState"). 
2. **Call U16 but independently build the usage mark.** The consume mark exists
   ONLY inside the returned bundle; F9 commits `result.mutations`. A hand-built
   `{ kind: 'state', … }` mark off-bundle is flagged by the M2 seam.
   **CAUGHT** ("keeps the operation bundle but hand-builds the state mark").
3. **Call U16 but independently reconstruct the ledger key**, incl.
   `['ledger','round',sourceId].join(':')`. The key is derived inside the
   operation and never exposed; a fold that keeps the call as a decoy but
   drives its commitment off a locally rejoined address stops committing
   `result.mutations` — flagged by the positive `result.mutations` pin.
   **CAUGHT** ("operation called as a decoy but a re-joined address drives the
   commit"). The byte address itself is unchanged (`ledger:round:<sourceId>`).
4. **Call U16 correctly as a decoy but use a fabricated owner on the actual
   path.** The operation takes the ACTOR — there is no owner parameter to
   fabricate. A `ownerId: ''` on any local typed usage call is flagged by the
   M4 seam. **CAUGHT / STRUCTURALLY IMPOSSIBLE** (M4 fixture + no-owner API).
5. **Receive a genuine U16 result and use spread/aliasing to replace entitlement
   semantics before committing.** A caller that keeps a real result but
   `{ ...result, available, mutations }` with a locally derived bundle
   hand-builds the mark (M2) and stops naming the bundle's `available` /
   `mutations` (positive pins). Solved by the API boundary (the only thing F9
   may commit is the returned bundle), NOT by another branded object.
   **CAUGHT** ("spread/alias: a genuine U16 result is spread and its
   entitlement semantics replaced").

The competing semantic path is unnecessary (the bundle already carries the
mark and the decision) or impossible (no pieces exposed to F9 to rebuild).

## 6. Replay proof

The `traitReactionsMutations` fold calls the operation ONCE at the command
boundary and returns the recorded bundle. `applyEvents` applies it without
rechecking entitlement. Tests:
- `trait-reactions.test.ts` "replay applies exactly what the command decided"
  and "replay purity: the command decides once, the reducer applies the
  recorded bundle without rechecking entitlement" — `applyEvents(state, event)`
  applied twice yields byte-identical state.
- The full suite's replay suites (U8/U10/U13/U17, encounter, usage-ledger)
  all pass; full `npm test` is green (122 files, 1880 tests).

## 7. Zero promotion / census 427

`npm run audit:class-job-census` regenerated `docs/blocker-census.{md,json}`;
still **427 unresolved source units, 0 promoted** (byte-identical generated
files — `git status` shows no census diff). No source content was promoted,
changed, or retracted. No durable key bytes changed (`ledger:<scope>:<sourceId>`
format preserved).

## 8. Gate OPEN

`#/vtt/:encounterId` remains phase-gated; this tranche changed no phase gates.
`#/lab` unaffected. U2/U13/U17 remain **AUTHORITATIVE**; U16 remains
**PARTIAL** (see §9 + the U16 semantic correction).

## 9. Next tranche — LANDED (U16 residual-marks census, 2026-08-31) + semantic correction (2026-08-31)

The residual U16-mark classification census/migration
(`chain-reaction-used`, `incubus:triggered`, `stampede:triggered`,
`gates-of-hell:vigilance-rushed`, `damage-immune`, per-source `:used`/`:charged`
flags) was executed: every genuine once-per-scope entitlement mark migrated to
a typed U16 ledger key (`chainReactionOncePerRoundKey`,
`incubusOncePerRoundKey`, `stampedeOncePerRoundKey`,
`vigilanceRushOncePerTurnKey`, `midasOncePerCombatKey`, and
`bullStrengthCollideKey(targetId)`); `damage-immune` is proven disjoint (MODE
state, negative-substitute + boundary adversarial tests) and the armed/charged/
pending flags are content mode or recorded fact, not entitlement. The follow-up
**semantic correction** then found the census had promoted U16 too early:
Bull's Strength was migrated with the wrong identity/scope (it is a
per-RECIPIENT `any-turn` gate, not an owner-relative `turn` gate), and
`monogatari:granted` is an UNRESOLVED U16 consumer (once-per-song entitlement)
blocked on the U8 source-defined lifecycle scope rather than retained content
state. U16 therefore stays **PARTIAL** until U8 supplies the generic boundary.
See `docs/u16-semantic-correction-report.md` and `docs/rules-foundations.md`
§U16.

## Validation

Typecheck ✓ · `npm test` (1880) ✓ · `npm run build` ✓ ·
`audit:architecture` (0 violations) ✓ · `audit:automation` ✓ ·
`audit:source-fidelity --strict` (no integrity violations) ✓ ·
`audit:class-job-census` (427, 0 promoted) ✓ · `audit:outcome-triggers` ✓ ·
`git diff --check` ✓.

No reusable capability was invented; the existing U16 core
(`usageKey`/`ledgerAvailable`/`consumeUsageMutation`) was composed into a
single COMMIT operation, and obsolete `OncePerRoundGate` machinery was
deleted rather than preserved.