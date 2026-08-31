# Strong-claim surface guard — fidelity-infrastructure repair

**Date:** 2026-09-01 · **Scope:** `src/rules/fidelity/claims.ts` + tests only. No ICON
rules semantics, no source-unit promotion, no U8 migration, no gameplay change.
**Census:** byte-stable at **427 unresolved, zero promotion** (fresh HEAD baseline).
**U8 status:** unchanged — PARTIAL.

---

## 1. The old guard's exact false-positive failure mode

The previous secondary guard was lexical in the wrong direction:

> strong token appears (AUTHORITATIVE / CLOSED / COMPLETE, case-insensitive) →
> the line must be covered by a registered claim anchor OR a `CLAIM_ALLOWLIST`
> **line-prefix** entry.

Because `STRONG_TOKEN` matched the words anywhere and case-insensitively, harmless
prose (every "fail closed", "closed set", "complete mapping", capability-ladder
legends, status-vocabulary legends, historical changelog operation records, generic
definitions such as "A phase is complete") required a manual allowlist row to avoid
failing the strict audit. That forced a **70-entry** `CLAIM_ALLOWLIST` whose only
justification was "this harmless line contains the word." The allowlist was
line-prefix data, not a semantic rule, and genuine status claims it happened to
contain ("U17 is COMPLETE", the U2/U17 heading sentences, P1/P2 DONE headings) were
covered by prose entries — i.e. hidden — rather than audited as claims.

## 2. The new semantic contract

Replaced:

> token appears → register or allowlist

with:

> potentially strong statement appears → **classify the surface** → only statements
> that assert project/rules authority on a canonical status surface require
> machine-verifiable registration/evidence; everything else passes as ordinary
> prose or vocabulary definition.

AUTHORITATIVE / COMPLETE / CLOSED and equivalent language remain fully usable when
accurate — the guard now catches claims, not words.

## 3. Surfaces treated as genuine strong claims

A line is a `claim` (must be registered or it is a hard `unregistered-strong-claim`)
iff `classifyStrongLine` identifies one of these canonical status surfaces:

1. **Status headings** — an ATX heading whose trailing status slot declares a state
   using an explicit marker set (AUTHORITATIVE / COMPLETE / CLOSED **and** the
   equivalence set DONE / LANDED / CANONICAL / FULL / FULLY). Markers are
   recognized case-insensitively and in the status position only, so a heading
   reworded "— DONE" or "— FULLY AUTHORITATIVE" still has to be registered whistle
   narrative/goal headings ("…first closed foe-complexity slice…") never do.
2. **Table status cells** — a markdown row where a strong word dominates its own
   cell (`| Damage kernel | AUTHORITATIVE |`) with a named subject before it.
3. **State-verb predicates over a named subject** — `<subject> <is|are|was|were|
   remains|remain|…> <STRONG>` ("U17 is COMPLETE", "this subsystem is CLOSED",
   "U2/U13/U17 remain AUTHORITATIVE"), plus `U# / P# … <STRONG>` ellipsis
   ("U17 now COMPLETE/AUTHORITATIVE"). Case-insensitive; capitalization provides no
   bypass. This is the form the canonical examples "U8 is AUTHORITATIVE" and "this
   subsystem is CLOSED" take.

## 4. How claims are tied to evidence

Occupying a surface is required but never sufficient. The claim must then be backed:

- **fidelity-scope binding** — computed scope rank must meet the required rank, or
  `claim-stronger-than-evidence` fails;
- **generated-audit binding** — a package.json script AND a recorded `passed`
  result (absent record → LEGACY/UNVERIFIED; recorded `failed` → hard violation;
  missing script → `claim-command-missing`);
- **compound / phase-gate binding** — every machine-audited requirement must hold,
  else reported LEGACY/UNVERIFIED;
- **legacy-unverified** — explicitly declared and *reported*, never silently accepted.

The prose guard protects the evidence pipeline (`source → obligations → consumers →
executed contracts → computed status → registered claim`); it does not replace it.
Deleting or weakening required evidence still fails the associated strong claim
(verified by adversarial tests — see §7).

## 5. CLAIM_ALLOWLIST removed

- **70 lexical line-prefix entries removed** (`CLAIM_ALLOWLIST` deleted outright);
  there is no replacement line-prefix database.
- Of those 70, the genuine status claims they had been hiding (U2, U17, U9, U14,
  P1, P2 canonical headings/sentences) are now **registered as audited claims**
  (six claims; U17 uses per-file restatement anchors across
  `docs/rules-foundations.md`, `TODO.md`, and `docs/roadmap.md`).

## 6. Remaining exemptions

There is **no** prose-exemption database. The only "exemptions" are the classifier's
own structural fast-outs, all documented in `claims.ts`:

- fail-closed / hyphen-adjoined modifiers ("fail closed", "fail-closed",
  "Closed-negative", "closed-manifest", "source-complete");
- noun-modifier adjectives ("closed set", "complete mapping");
- capability-ladder and status-vocabulary legends (multiple `<` steps, `status
  vocabulary:`, and definition table rows followed by "Execution matches…");
- indefinite-generic class definitions ("A phase is complete", "a slice is closed");
- negation and manner readings ("are closed architecturally");
- narrated certification events and subjectless continuation fragments
  ("U2 re-certified AUTHORITATIVE", "> remain AUTHORITATIVE…").

Each exists because it is a recognized definitional/operation form, never merely
"this harmless line contains the word."

## 7. Adversarial tests added (`src/rules/__tests__/strong-claim-surface.test.ts`, +18)

Both sides of the boundary:

- unregistered "U8 is AUTHORITATIVE" is a claim;
- unsupported COMPLETE/CLOSED status sentences and headings are claims;
- status headings with equivalent wording ("— DONE", "— LANDED/COMPLETE") are claims;
- lowercase / case variation of an actual claim cannot bypass;
- "fail closed", "closed set", "complete mapping", capability legends, status
  vocabulary, and generic-class definitions pass without any exemption;
- historical changelog operation descriptions and narrated events pass;
- ordinary prose across a canonical file produces **zero** violations;
- a strong claim written as plain prose (not a heading) still fails (no heading-only
  bypass);
- a registered + evidenced claim passes;
- a registered claim stronger than its evidence fails;
- deleting/weakening the required evidence makes the claim fail.

Mutation-style properties (each named bad implementation would break these):

- **deleting the guard**: every genuine claim still classifies as `claim`;
- **only uppercase tokens**: lowercase strong claims still classify as `claim`;
- **treating every token as a claim**: prose/definitions never classify as `claim`;
- **registration alone**: covered by the stronger-than-evidence and missing-audit
  assertions.

## 8. Validation

- `npm run typecheck` — clean
- `npm test` — **1917 passed** (incl. 18 new; prior suite green)
- `npm run audit:architecture` — passed (115 files)
- `npm run audit:automation` — passed
- `npm run audit:source-fidelity -- --strict` — **zero integrity/claim violations**;
  generated `docs/source-fidelity.md` regenerated and drift-free
- `npm run verify:source-artifacts` — source PDF + artifacts structurally valid
- `npm run audit:class-job-census` — **427 unresolved, zero promotion**
- `npm run build` — passed
- `git diff --check` — clean

## 9. Semantics confirmations

- **No gameplay/source semantics changed.** Only `claims.ts` (guard + registry) and
  the generated fidelity doc changed; the runtime, kernels, primitives, and content
  are untouched.
- **Unsupported strong status claims still fail**: "U8 is AUTHORITATIVE" /
  "U17 is COMPLETE" / a "CLOSED" heading all produce `unregistered-strong-claim`
  unless registered, and registered claims stronger than their computed evidence
  produce `claim-stronger-than-evidence`.

## 10. Next recommended tranche

Return to **U8 Scope / Clock residual migration** (per the tranche order), not
further fidelity infrastructure. The fresh audit found no dependency introduced here
that reorders that. Concretely: migrate the remaining temporal readers (`RuleDuration`,
the scheduler cadence read, the reducer's recorded remaining-count specialist) onto
the U8 authority and pursue the U16 residual (the `monogatari:granted` once-per-song
consumer) that U8's source-defined lifecycle identity recently unblocked.