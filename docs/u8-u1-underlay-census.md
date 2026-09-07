# Underlay consumer census

Current consumer boundaries and unresolved work. The [foundations](rules-foundations.md)
own the authority descriptions; the [underlay plan](underlay-completion-plan.md#4-phase-gate)
owns acceptance and the source-promotion gate. Historical audits live in Git.

## Fresh underlay matrix

| Underlay | State after audit | Smallest known residual |
| --- | --- | --- |
| U1 Reference / Binding | AUTHORITATIVE (declared scope: content reference interpretation) | 8 machine-pinned NON-reference algorithm/helper derefs (4 program + 4 fold) stay caller-owned by design — never references, so not inside the declared scope |
| U2 Role / Perspective | AUTHORITATIVE | none |
| U3 Query / Candidate | AUTHORITATIVE (tranche 25 decision) | none in scope — the six defeated-divergent VM effect scans now route through the shared query authority (tranche 25); AREA / PERSISTENT-INSTANCE / RULE-SOURCE query domains and ordering beyond the min-distance set + opt-in cell order are explicitly later-underlay (U10/U12/U16/U17) or source-gated; rushTowardFoes' direction fallback remains the flagged player-choice (U4) approximation, and the Demon Claw / God Hand self-or-ally picks are recorded-choice or fail-closed (U4/resolver), never U3-invented |
| U4 Choice / Decision | PARTIAL | (tranches 26-28, 30, 32A–B) Demon Claw per-step may-damage, God Hand self-or-ally, Heracule second-foe, Holy cure + Charge, Chaos Tarot effects 4–6, Party Favor's mine, and both Dark Sliver placements now use recorded choices over U3 CandidateSets. The source-ID-free captured-position seam reads exactly zero/one recorded position and delegates bounds, full-footprint range, free-space/occupancy, and optional LoS to U3; it never selects a candidate. Party Favor rejects zero candidates; Dark Sliver keeps its pre-existing attack-only/no-rider behavior at zero soul-space candidates and its kill-without-plant behavior at zero Slay candidates. The p.92 CHARACTER umbrella's ACTOR slice remains self/ally/foe with no side filter; its Summon member remains an engine-wide unreachable because executable summons are entity-only and the U3 entity→actor bridge has no production user. Tranche 33 migrates its exact use-time placement family onto recorded U4 lists over U3/creation legality (see `tranche-33-placement.md`). Remaining: Dervish actor selection/initial flight, Symphony blessing payer/quantity choice, other automatic summons, Demon Claw Talent I/II (documented-unresolved), abilityUseChoices/talentChoices fold reads, and source-specific continuation composition. The generic U4↔U13 recorded-answer seam is complete: every RuleChoice kind retains its full JSON-clean RuleChoiceAnswer through command validation, DECISION_ANSWERED, flow resume, and held continuation resolution; optional absence is distinct from false/zero/empty string. Great Giorgios and Spite consume the typed answer. See [recorded-choice contract](recorded-choice-seam.md). |
| U5 Value / Expression | PARTIAL | U5-core dependency gate for U3 MET (tranches 22-23: the SINGLE percentOfMaximum scalar now feeds percent-base-max, the U6 bloodied/quarter predicates, and the Rot 25% read — all against the BASE maximum per adjudication icon-1.5:combat:bloodied-base-max; the tranche-22 wounds-adjusted percent-max-hp kind was RETRACTED as source-unsupported; no duplicate VM-side scalar formula remains); full authority still needs traversed/elevation/area-size/usage/non-numeric typed families + the residual content inline-arithmetic sites |
| U6 Predicate / Condition | PARTIAL | range/area gate-body consumer folding |
| U7 Anchor / Spatial Frame | AUTHORITATIVE (tranche 21 decision) | none in scope — specialist carriers (aura origin records, creationSpatial, RuleArea.origin, rebound provenance) store already-resolved frames with written non-competing boundaries; only the teleport mover footprint seam had a real gap, repaired fail-closed in tranches 20-21 |
| U8 Scope / Clock | AUTHORITATIVE | none |
| U9 Provenance / Cause | PARTIAL | legacy trigger/damage/movement provenance reconstruction |
| U10 Fact / Outcome | PARTIAL | movement/save distinction proof remains incomplete |
| U11 Flow / Sequence | PARTIAL | hand-sequenced named resolver bodies |
| U12 Continuation / Suspension | PARTIAL | remaining resolver-delayed/save-window consumers |
| U13 Window / Decision Point | AUTHORITATIVE | none |
| U14 Modifier / Policy | PARTIAL | untyped `RuleModifier` stat-bag consumers |
| U15 Transaction / Atomic Commit | PARTIAL | exhaustive atomic-group routing proof remains incomplete |
| U16 Usage / Entitlement | COMPLETE/AUTHORITATIVE | none after Monogatari lifecycle integration |
| U17 Ordering / Arbitration | COMPLETE/AUTHORITATIVE | none |


## Reference residual inventory

A machine scan at this HEAD finds 4 `sourceActor(context, …)` call
sites. `npm run audit:u1-residual` verifies this total and reports each file
and category. All four are caller-owned algorithm parameters or derived-loop
identities, not LIVE/CAPTURED reference interpretation. The fold surface has
four further pinned algorithm/helper dereferences. `architecture-audit.test.ts`
pins their identities and mutation-tests the lexical classifier.

Content reference interpretation routes through `content/glue/reference-authoring.ts`
to U1. Strict captured references reject missing actors; weak captured references
represent legitimate lifecycle expiration. U4 retains selection cardinality and
recorded-slot precedence. Provenance IDs, scheduling IDs, and identity comparisons
are not reference resolution. See the adopted lifecycle adjudication in
[source adjudications](source-adjudications.md).

## Retained specialists

- U2 owns relation/chooser perspective; U7 owns the spatial origin. Aura geometry
  cannot infer who establishes ally/foe relations.
- U3 owns candidate eligibility. U4 owns whether/which choices; U17 owns ordering.
  AREA, PERSISTENT-INSTANCE, and RULE-SOURCE domains remain later-underlay work.
- U5 consumes U3 counts, U7 distance, U8 rounds, and U16 usage. Dice execution,
  damage formulas, HP projection, and input cardinality retain their domain owners.
  The U3 prerequisite scalar algebra is present; extended U5 families remain partial.
- U7 carriers such as aura origins, `creationSpatial`, area origins, and rebound
  provenance store resolved frames. They do not establish a second anchor authority.
- U8 owns temporal interpretation. Scheduler election and remaining-occurrence
  counters retain cadence/state ownership; combat cleanup asks U8 about duration.
- U16 owns entitlement. Armed/pending/immune modes and recorded outcome facts
  remain distinct from permission to repeat a use. Song rewards compose U8 lifecycle
  identity with U16 usage independently for every owner.

## Recorded-choice boundaries and open readings

The [recorded-choice contract](recorded-choice-seam.md) describes U4/U13 answer
transport and continuation behavior. [Placement](tranche-33-placement.md) records
the current use-time placement family. Outstanding consumers are in the matrix.

Holy's cure and Charge use the p.92 CHARACTER keyword with no side filter.
The implementation reaches its actor slice only: executable summons are entities,
and no production consumer creates the entity-to-actor bridge expected by U3.
Recording an entity ID therefore fails closed. Esper III's offensive cure mode
remains unresolved content. Two derived readings remain open: whether CHARACTER
specifies self under p.92's self-targeting restriction, and whether Holy Charge's
“other” excludes the acting character (current behavior) or the just-cured recipient.
The earlier friendly-only cure interpretation and proposed Diaga/Bless restriction
are retracted; they are not current blockers.

Party Favor requires a recorded mine cell and rejects zero candidates. Dark Sliver
requires recorded soul/plant cells when candidates exist. With none, its Slay branch
preserves the kill without a plant; its soul rider preserves the attack without a
mark/entity. The latter remains an open derived reading: the source specifies a
choice but does not settle the no-space result. These policies belong to content,
not a generic U4 vacuity rule. U3 owns full-footprint range, free-space and declared
LoS checks; any clear occupied-footprint trace satisfies character LoS.

## Known blocking repairs (source-quoted, not future work)

The trigger-authority gate (2026-09-01) closed the forged-assignment path but
left several clauses reachable only through seams the current substrate does
not provide. These are the precise blockers — each names the source passage,
what is wired, and the smallest missing reusable capability.

1. **Draken Cross mastery — DARK WIND DEVIL BLADE (p.128).**
   "After using this ability, you may teleport to any space of any area
   created, then all foes in any area you created with this ability are
   slashed and take 2 divine damage." Nothing of it is wired: the resolver
   tracks this use's area cells only locally, and there is no recorded
   teleport-choice seam tied to a durable list of "areas this use created".
   Missing capability: a U13-style recorded choice whose destination set is
   the durable area-cell record of the CURRENT resolution, applied through
   the shared movement authority before the status/divine-damage fold.

2. **RESOLVED 2026-09-01 — Takedown exceed true-strike half (p.135).**
   "Exceed or Heroic: Gains true strike and creates a pit under your
   target." The exceed-granted true strike now folds ON THE CURRENT attack
   through the generic staged seam (`trueStrikeOnExceed` in the shared
   attack authority, kernels/attack-resolution.ts): exceed is derived from
   the PRE-fold roll total (no circularity, no second determination), then
   the granted true strike applies before the hit/miss damage resolves —
   dodge ignored via the same shared damage provenance. NEVER a "next
   attack" grant: the earlier draft here proposed armed next-attack
   semantics, which the source does not support. The pit fires through the
   program's `exceed` trigger step (the SAME 15+ roll) and the heroic arm
   through the attack-heroic step; the resolver emits the heroic-only pit.
   Remaining under the mastery: Fierce Elbow's per-elevation-difference 2
   damage (once after the ability resolves, max three times), which needs
   the recorded attack-start elevation difference — a separate blocker.

3. **Gigaton Whip exceed half (p.137).** "Exceed or Heroic: Smash the ground
   when you land, creating difficult terrain under your foe and in two
   adjacent spaces." The heroic arm is wired; the exceed arm is unwired — it
   must derive from the ability's own 15+ roll AND its "when you land"
   geometry (under the foe plus two specific adjacent spaces) that tracks
   the collide-bounce landing, which the generic terrain step (target
   position only) cannot express. Missing capability: a terrain effect that
   keys off the collision-resolution landing cell rather than the raw
   attack-target cell.

4. **ALL resolver-local "Collide/Slay" legs (the 12 audited sites).** The
   outcome-trigger audit inventories 12 resolver-internal legs: bastion
   Heracule/Valiant "Collide or Heroic" repetition (p.122 "use again"/"rush
   1 again"), colossus Gigaton Whip collide-bounce (p.137), harvester
   REAP/Harvest/Dark Sliver Slay continuations (p.182–188), knave Slay legs
   (4 sites), spellblade Blitz Slay repeat (p.225, retained reachable via
   its `infuse` leg), and stormbender collide pit (p.233, `infuse &&`
   collide). Each resolves from the trigger set present at RESOLVER start;
   the reactive append pass derives collide/slay only from mutations ALREADY
   emitted and re-enters trigger STEPS only, never resolver code. The
   bastion Valiant and harvester REAP/Harvest legs are proven at the
   resolver contract level by direct-context clause tests (recorded facts),
   and spellblade's GRAM leg is covered through its `infuse` arm. Every
   other leg keeps a caller-assertable heroic/infuse arm EXCEPT knave line 110
   (the Slay-only shove leg after the multi-hit attack), which has NO
   caller-reachable arm and is fully dormant until the seam below lands. No
   approximation was substituted anywhere. Missing capability: a re-entrant
   resolver pass for newly derived triggers, or step-ized continuations
   (valiant's rush-then-shove chain is not yet expressible as step effects;
   Gigaton's difficult-terrain "when you land" geometry needs a
   collision-landing terrain key — see (3)).
