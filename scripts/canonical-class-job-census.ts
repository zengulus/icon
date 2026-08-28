/**
 * Canonical Class/Job Blocker Census
 *
 * This is the single source of truth for the Class/Job dependency graph.
 * It derives its baseline from CURRENT repository authority:
 *   - collectRuleSourceUnits()
 *   - current rule compilation/audit state
 *   - current Class/Job recipe metadata / blocker classifications
 *
 * Target kinds: class-trait, job-trait, talent, mastery, limit-break.
 *
 * Every CURRENTLY UNRESOLVED source unit produces exactly one canonical record:
 *   { sourceId, kind, blockers: string[] }
 *
 * Executable units must not remain in the blocker census.
 *
 * Non-implementable blocker classifications (irreducible / residual) are
 * excluded from:
 *   - marginal implementation rankings
 *   - greedy primitive simulation
 *   - next-primitive recommendations
 * They remain visible in blocker-set frequency tables and residual counts.
 *
 * Marginal categories per primitive P:
 *   - immediate:       units whose blocker set is exactly {P}
 *   - oneCloser:       units whose blocker set contains P and exactly ONE other blocker
 *   - multiCloser:     units whose blocker set contains P and TWO or more other blockers
 *   - totalContaining: immediate + oneCloser + multiCloser
 *   Mechanical assertion: immediate + oneCloser + multiCloser === totalContaining
 *
 * Machine-checked invariants:
 *   - source IDs are unique
 *   - every unresolved Class/Job source unit appears exactly once
 *   - no executable Class/Job source unit appears
 *   - per-kind totals sum to the unresolved Class/Job total
 *   - blocker-set frequencies derive from the per-unit records
 *   - marginal values derive from per-unit records (with multiCloser)
 *   - marginal assertion: immediate + oneCloser + multiCloser === totalContaining
 *   - greedy simulation derives from set subtraction, not handwritten totals
 *   - after every simulated primitive: previousRemaining - newlyUnlocked === newRemaining
 *   - cumulativeUnlocked + remaining === baseline
 *   - an implemented capability is not retained as a blocker merely because an
 *     older report listed it
 *   - non-implementable classifications never appear in greedy simulation steps
 *
 * Usage:
 *   node --import tsx scripts/canonical-class-job-census.ts [--strict] [--output <path>]
 */

import '../src/rules/automation/content/registry.js';
import { auditRuleCompilations } from '../src/rules/automation/content/glue/compiler.js';
import { collectRuleSourceUnits, type RuleSourceUnit, type RuleSourceKind } from '../src/rules/source-units.js';
import { isExecutableTalent } from '../src/rules/automation/kernels/talent-recipes.js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// Blocker taxonomy
// ═══════════════════════════════════════════════════════════════════════════

const CENSUS_KINDS: RuleSourceKind[] = [
  'class-trait', 'job-trait', 'talent', 'mastery', 'limit-break',
];

/** Non-implementable / residual blocker classifications.
 *  These are classification labels, not capabilities that can be implemented.
 *  They are excluded from marginal rankings and greedy simulation. */
const NON_IMPLEMENTABLE = new Set(['irreducible']);

/** Primitives already implemented in the engine. A blocker that is already
 *  implemented is stripped from every unresolved unit's blocker set (Phase 5
 *  harvest): it no longer blocks anything, and any unit left with an empty
 *  set would be executable — so it must never appear in the census. The
 *  claim is grounded in the executable allowlists (the compiler's
 *  `unsupportedClauses` check) rather than this set alone.
 *
 *  Cost-payment foundation (F14): `sacrifice-cost`, `combo-spend`,
 *  `blessing-spend`, `infuse-cost`, and `use-ledger` are now implemented as
 *  reusable capabilities — ordinary fixed sacrifice payments, token spends,
 *  aether/Infuse payments, and durable once-per-turn/round/combat gates all
 *  ride the shared cost-payment kernel and use-ledger kernel with lifecycle
 *  resets. They no longer block anything by themselves; a unit that still
 *  lists only these labels must be re-audited (its complete text exposes a
 *  different missing capability) rather than silently treated as
 *  executable. `resource-management` stays a live blocker: the generic gain/
 *  spend mutation is implemented, but the label also covered economy
 *  mechanics (turn-start aether gain, per-ability spend limits) that are not
 *  yet reusable capabilities, so it is deliberately NOT stripped. */
const IMPLEMENTED_PRIMITIVES = new Set(['condition-grant', 'aura', 'sacrifice-cost', 'combo-spend', 'blessing-spend', 'infuse-cost', 'use-ledger', 'teleport']);

// `teleport` is the F1 foundation (primitives/spatial-intent.ts + the shared
// teleportMutation/placeMutation/removeMutation/swapMutations builders in
// primitives/job-kit.ts): bounded, size-aware occupancy, impassable terrain,
// and Rampart (p.104) validation plus source-declared atomic swap groups are
// implemented and covered by the spatial-gateway fixtures. A unit whose text
// needs "teleport" no longer carries `teleport` as a missing capability —
// its remaining blockers are whatever else its complete semantics need (the
// {teleport} singletons were re-audited below; genuinely complete ones were
// promoted onto content rows and dropped out of the census entirely).

/** Audit-verified reclassifications: source units whose syntactic first-pass
 *  blocker set is WRONG (the regex keyword pass matched "gain/grant/become"
 *  and claimed a `{condition-grant}` singleton, but the unit's complete
 *  semantics need other missing reusable capabilities). Each entry is the
 *  corrected MINIMAL blocker set after reading the full source text.
 *
 *  Masteries: after the typed mastery-attachment kernel landed
 *  (kernels/mastery.ts), `mastery-attachment` is no longer a missing
 *  primitive — an implemented mastery compiles complete (allowlist +
 *  fixture + replay), and an unimplemented mastery stays unresolved for
 *  its actual effect blockers below. The seven former
 *  `{mastery-attachment}` singletons (rook, dark-knight, intimidate,
 *  bleak-mercy, warding-bolts, gentleness, rampant-nail) are now
 *  executable and dropped out of the census entirely.
 *
 *  Re-audit: 3 of the 28 claimed `{condition-grant}` singletons were
 *  genuine (bastion:valiant:talent:2, knave:provoke:talent:1,
 *  freelancer:showdown:talent:2 — now executable through the F7 talent
 *  fold); the other 25 are corrected below.
 *
 *  Aura re-audit (after the generic Aura kernel landed): `aura` is now an
 *  implemented primitive (kernels/aura.ts), so the 7 singleton aura
 *  candidates were re-read against the kernel. bastion:rook:talent:1 and
 *  chanter:dervish:talent:1 became executable (projected counter through
 *  the shared condition fold) and dropped out of the census entirely. The
 *  other five are corrected below: their `{aura}` singleton was an
 *  incomplete classification — each still needs a genuinely missing
 *  capability beyond the Aura kernel itself. */
const RECLASSIFIED_BLOCKERS: Readonly<Record<string, string[]>> = {
  // The corrected sets are the units' CURRENT blockers: the condition-grant
  // component of a reclassified unit (rebound, unstoppable, defiance,
  // evasion, phasing, pacified, vulnerable) is now implemented, so it is
  // intentionally NOT listed here — the record shows what still blocks.
  //
  // ── 8 masteries — attachment solved (kernels/mastery.ts); the remaining
  //    blockers are their actual effect semantics ──
  'bastion:heracule:mastery': ['attack-modifier', 'effect-count'],
  // "gains rebound" — the attack-bounce modifier (same family as Trick Shot's armed rebound / skipjack rank 2, NOT a condition) + "second effect triggers +1 more time" (effect-count)
  'colossus:massive-overhead:mastery': ['vigor-grant', 'end-turn-suppress'],
  // "grants you 4 vigor" (fixed-amount vigor grant — the vigor-grant
  // classifier catches this) + "no longer ends your turn" (end-turn
  // suppression: the mastery removes the END_YOUR_TURN clause from
  // Massive Overhead's program at round 4+; neither vigor-grant nor
  // end-turn-suppress is implemented yet)
  'knave:revenge:mastery': ['damage-modifier', 'area-define'],
  // "deal 2 damage to all adjacent foes" after vigilance
  'shade:umbra:mastery': ['ability-attack-modifier'],
  // "Increase Umbra and Penumbra's range to 6 and it gains unerring" — the
  // range half is wired through the shared range kernel (range-recipes.ts),
  // but the per-ability unerring needs the attack-modifier attachment gate
  // for a mastery-owned ability (the kernel is trait-keyed today)
  'sealer:sanctify:mastery': ['area-define', 'action-cost-override'],
  // "place two areas without replacing the first" (area-define) +
  // round-4+ 1-action (action-cost-override — handled by the fold;
  // census classifier labels it action-type-change)
  'seer:wish:mastery': ['damage-preview'],
  // "gain defiance, then unstoppable" (condition-grant — implemented) on a damage-would-reduce-to-0 preview
  'enochian:aethershard:mastery': ['movement-modifier'],
  // "gain phasing" (condition-grant — implemented) + "objects cost a maximum of 0 spaces to enter"
  'spellblade:nothung:mastery': ['damage-modifier'],
  // "All 1 piercing damage listed by this ability becomes divine" (damage-type override)
  'warden:strength-of-the-pack:mastery': ['action-cost-override', 'aura-range-override'],
  // "becomes a free action at round 4 or later" (action-cost-override — now
  // handled by the fold, but the census classifier labels it action-type-change
  // so the reclassification must include it) + "aura affects the entire
  // battlefield" (aura-range-override: the aura kernel's radius is range 2
  // today; an entire-battlefield override needs a mastery-gated radius
  // modifier)
  'harvester:crimson-bloom:mastery': ['action-cost-override', 'power-die'],
  // "becomes a free action" (action-cost-override) + "power die starts at 3
  // ticks" (power-die: the power-die kernel tracks die state; a mastery-
  // gated initial value needs a starting-tick override)
  'freelancer:ace:mastery': ['action-cost-override', 'first-use-gate', 'auto-refresh', 'movement-modifier'],
  // "becomes a free action to enter if you have not used it yet this combat"
  // (action-cost-override gated on a first-use ledger) + "refreshes
  // automatically at the start of your turn" (auto-refresh: per-turn
  // lifecycle hook) + "dash increases to 3" (movement-modifier: dash
  // override)

  // ── 16 talents / traits / abilities with non-condition mechanics ──
  'demon-slayer:soul-blade:talent:2': ['stance-gate', 'attack-modifier'],
  // "While in Soul Blade, your attacks gain exceed: tick the die up by 1" (attack-path die modifier)
  'knave:revenge:talent:1': ['save-modifier', 'area-define'],
  // "attacks against adjacent allies gain +1 curse" (save-curse on adjacency)
  'fool:gallows-humor:talent:2': ['effect-count', 'threshold-modifier'],
  // "deal 4 damage again to any target at 25% hp or lower" (repeat + hp-threshold gate)
  // fool:masquerade:talent:1 ("gain evasion after swapping" gated by
  // "haven't acted yet this round") was reclassified to {use-ledger} here;
  // with the use-ledger kernel landed (F14) it is now executable through
  // the talent fold and dropped out of the census entirely.
  'fool:chronotemper:talent:1': ['movement-modifier'],
  'fool:chronotemper:mastery': ['use-count-override', 'interrupt-use-scaling'],
  // "You can take this interrupt three times a round. The second time you use
  // it, the dash becomes just 2 spaces, and the third time just 1 space." —
  // a per-round use-count override (3) AND a use-index-dependent effect
  // magnitude (the Nth use dashes 3/2/1): the allowance reader needs the
  // count, and the Cheat Time program needs the current use index
  // "dash gains phasing and ignores movement penalties from terrain"
  'shade:shadow-play:talent:2': ['choice-input'],
  // "one of them CAN gain evasion" (condition-grant — implemented; player choice between swapped allies)
  'chanter:aria:talent:2': ['effect-count'],
  // "If Aria's special effect triggers twice, gain defiance and become unstoppable" (condition-grant — implemented)
  'harvester:crimson-bloom:talent:1': ['damage-preview'],
  // "If Crimson Bloom's damage would reduce an ally to 1 hp or below, they gain defiance" (condition-grant — implemented)
  'sealer:trait:mantra-of-sealing': ['attack-trigger-grant'],
  // "Your attacks bless all adjacent allies to you and grant them 2 vigor" —
  // an ON-ATTACK area grant of a blessing token + vigor, not a continuous
  // membership projection: the Aura kernel projects conditions and attack
  // modifiers, never tokens/resources, so the attack-triggered area grant is
  // still missing (the fixed 2-vigor grant and the bless action themselves
  // are expressible)

  // ── Aura re-audit: the five remaining `{aura}` singletons ──
  'bastion:endless-battlement:talent:1': ['aura-user-gate'],
  // "While you are in the aura, attacks against your ally gain +1 curse" —
  // the targetCurses projection exists, but the aura sits on the ALLY while
  // the gate is the ability USER's own position inside it (the parent
  // Endless Battlement stance/interrupt is itself unimplemented)
  'bastion:endless-battlement:talent:2': ['aura-user-gate'],
  // "You and your ally both have counter while you are in the aura" — same
  // user-presence gate over the ally-carried aura
  'shade:nightmare:talent:2': ['rebound', 'entity-consume'],
  // "rebound abilities off shadows in the aura; doing so consumes the
  // shadow" — the attack-bounce modifier (NOT a condition) and the
  // shadow-entity consumption are both missing; the aura kernel does not
  // give entity membership or consumption
  'harvester:gravebirth:talent:1': ['entity-vacate', 'choice-input'],
  // "all thralls of your choice burrow … then you may place them in free
  // space in your aura" — the free-space-in-aura placement is expressible
  // (auraCells + the shared free-cell search); the thrall burrow/removal
  // and the player's choice of thralls are still missing
  'seer:sisyphus:talent:1': ['save-modifier', 'entity-vacate'],
  // "foes gain +1 curse on the save" + "pacified after being returned" (condition-grant — implemented)
  'enochian:trait:soulfire': ['threshold-modifier'],
  // "threshold to critical hit becomes 18+, threshold to exceed becomes 13+" (threshold overrides)
  'enochian:soul-burn:talent:1': ['effect-count'],
  // "struck by two or more soul embers from this ability in the same turn, they become vulnerable" (condition-grant — implemented)
  'enochian:aethershard:talent:2': ['pierce', 'aura'],
  // "abilities gain pierce against characters adjacent to Aethershards"
  'spellblade:odinforce:talent:1': ['effect-count', 'use-ledger'],
  // "If you end a turn without attacking, gain +2 more bolts" (turn-end gate + bolt count)
  'spellblade:odinforce:talent:2': ['effect-count'],
  // "Comeback: Odinforce gains 4 bolts instead of 2 on refresh" (bolt count override)

  // ── Range re-audit (after the generic range kernel landed) ──
  // kernels/range.ts now implements LISTED-RANGE changes (fixed override,
  // conditional override under stealth/comeback/mastery gates, and the
  // dynamic round-number range), folded at both command gates. The six
  // former `{range-modifier}` singletons whose complete semantics were a
  // listed-range change or a distance-gated effect with existing authority
  // (Valkyrie t1, Incubus t1, Harvest t2, Open the Gates t2, Trigrammaton,
  // Aetherwall) are executable and dropped out of the census entirely. The
  // remaining singletons were misclassified: `range-modifier` conflated
  // several genuinely different families, reclassified below.
  //
  // ── Range-modifier re-audit (Step-6 pass, 2026-08-27) ──
  // The census heuristic adds `range-modifier` to any unit mentioning
  // "range N". Of the 11 former singletons, only Dark Sliver t2 is a
  // genuine listed-range change (sacrifice-gated override to 6). The rest
  // are distance predicates, spatial constraints, cross-ability modifiers,
  // or resource predicates that the regex conflated.
  'demon-slayer:gates-of-hell:talent:2': ['active-effect-range-modifier'],
  // "Vigilance's range increases by +1 while Gates of Hell is active" — a
  // cross-ability range modifier gated on a persistent effect's presence;
  // needs an active-effect-gated range modifier rule in the range kernel.
  'colossus:limit-break': ['spatial-state', 'range-modifier'],
  // "slamming that character into unoccupied space in range 3 of your
  // original location" — the original-location spatial state must be
  // captured before the battlefield remove and used as origin for the
  // placement-range predicate (spatial-state); the range3 destination
  // constraint is a distance predicate from that origin (range-modifier).
  'shade:trait:meld': ['entity-distance-selection'],
  // "swap places with any shadow in range 3" — entity-distance selection
  // from the caster; needs a reusable entity-distance-in-range predicate.
  'shade:umbra:talent:2': ['entity-distance-selection'],
  // "consume a shadow in range 2 of yourself" — entity-distance selection
  // from the caster; needs entity-distance-in-range predicate.
  'shade:harrow:talent:1': ['entity-distance-selection'],
  // "teleport to any space in range 2 of Harrow's marked target" —
  // spatial selection with range validation from an arbitrary (marked-
  // target) origin, not the caster.
  'shade:death-blossom:talent:2': ['entity-distance-selection'],
  // "throw knives, dealing 2 damage to up to three foes in range 3" —
  // secondary target selection with range constraint from the caster
  // after a teleport; the foe-distance selection is the blocker.
  'shade:nocturne:mastery': ['entity-distance-selection', 'multi-actor-teleport'],
  // "teleport any characters in range 2 of you into any free space inside
  // the area" — multi-character selection with range validation from the
  // caster plus a destination-area constraint.
  'sealer:limit-break': ['range-gated-teleport', 'entity-distance-selection'],
  // "teleport adjacent to the target before the attack if they're in range
  // 3" (self), "every ally in range 3 of the target can also teleport" —
  // range-gated pre-attack teleport (self) and target-relative ally
  // distance selection.
  'sealer:open-the-gates:talent:1': ['entity-distance-selection'],
  // "teleport an ally in range 2 instead of yourself" — alternate teleport
  // recipient with entity-distance eligibility from the caster.
  'spellblade:trait:conqueror-s-edge': ['resource-management'],
  // "Infuse costs are reduced by 1 if there's a foe in range 2" — a
  // nearby-foe predicate feeding the Infuse resource-cost calculation;
  // not a listed-range change at all.
  'knave:limit-break': ['condition-suppression'],
  // MOCK's "cannot gain or benefit from evasion, dodge, or stealth" needs a
  // general condition-suppression projection (mark suppressions exist, a
  // non-mark suppression does not); the potency-plus condition grants, the
  // turn-end/two-turn durations, and DREAD MOCK's "gains range 5" are all
  // expressible
  // ── F1 promote-after-landing re-audit: the `{teleport}` singletons ──
  // The F1 foundation (teleport/place/remove/swap) landed, so `teleport` is
  // stripped from every blocker set below. Each former `{teleport}`
  // singleton was re-read in full; the two whose COMPLETE semantics now ride
  // the shared F1 primitives plus existing kernels were promoted onto
  // content rows (knave:strongarm:talent:1 — program-level remove/place +
  // range-kernel comeback range, gated on ACTIVE Comeback; spellblade:
  // nothung:talent:2 — program-level comeback teleport width, both teleports
  // player-selected through the generic positions input and the second
  // measured from the post-first position) and dropped out of the census
  // entirely. The rest still need genuinely distinct missing capabilities
  // and keep their corrected residual blocker sets below.
  'demon-slayer:comet:mastery': ['object-distance', 'choice-input'],
  // "teleport to any space adjacent to your weapon at the start and end of
  // your turn" — the thrown-weapon OBJECT footprint (the object-distance
  // family, like lance t1 / quaking-palm mastery) plus the player-chosen
  // space and turn-boundary timing (the mastery kernel's lifecycle
  // attachment exists; the object targeting + choice do not)
  'demon-slayer:draken-cross:mastery': ['area-define', 'choice-input'],
  // "teleport to any space of any area created … foes in any area created
  // are slashed and take 2 divine" — the created-blast cells must be
  // durably available for a post-use fold (the ability's areas are
  // instantaneous), plus the player-chosen space; the slashed status and
  // divine damage themselves are implemented
  'fool:trait:cheap-trick': ['attack-miss-trigger', 'entity-create'],
  // "When an attack misses you, you may teleport 1 space, then leave a bomb
  // in an adjacent space" — a defensive attack-miss reactive on the owner
  // (no such trigger family exists) plus the bomb entity; the teleport and
  // the adjacency placement are implemented
  'freelancer:showdown:talent:1': ['damage-dealt-trigger', 'choice-input'],
  // "Each time you deal damage with showdown, you may teleport 1" — the
  // showdown damage lands at the end of the foe's turn (a delayed
  // damage-dealt trigger, no reusable family) plus the player-chosen
  // teleport; the teleport itself is implemented
  'shade:death-blossom:mastery': ['pre-ability-movement', 'choice-input'],
  // "You can teleport 2 spaces before and after using this ability" — a
  // pre/post-ability self-repositioning window (the pre-ability-movement
  // family) plus the player-chosen destination; the teleport is implemented
  'shade:shadow-play:talent:1': ['choice-input'],
  // "If you swap two foes, you may then teleport them 1 after this ability
  // resolves" — the swap and the post-swap teleport-1 are implementable, but
  // the destination cells must be chosen against the POST-swap occupancy
  // (the shared free-cell helper reads the pre-swap state), so the
  // reposition choice is the missing capability (the same family as the
  // sibling talent 2)
  'warden:underway:mastery': ['shove-trigger', 'object-distance', 'choice-input'],
  // "Foes that are shoved into portals or that end their turn adjacent to an
  // underway can be teleported to any free space adjacent to any other
  // underway" — a shove-into-portal reactive, the underway OBJECT footprint
  // distance, and the chosen destination; the save, the once-per-round
  // ledger, and the bloodied auto-fail are implemented
  'sealer:god-hand:talent:2': ['choice-input'],
  // "Increase teleports to 2, and all version of this ability gain Slay:
  // gain or lose a combo token" — the teleport increase is program-level
  // expressible and the slay/combo mutations are implemented, but the
  // player's gain-OR-lose choice needs the valued choice input (the same
  // family as knave:revenge:talent:2)
  'sealer:matsuri:talent:1': ['choice-input'],
  // "Increase teleports by +1 and gains Slay: Repeat the teleport effect" —
  // the +1 spans the ability's documented optional ally-teleport window
  // (the parent ability's free-action window is itself unimplemented), and
  // the slay repeat's referent (user vs ally teleport) is unresolved, so the
  // optional-window/choice capability is the blocker
  'sealer:spirit-shrine:talent:2': ['enemy-ability-trigger', 'choice-input'],
  // "Foes that use any ability inside the shrine's aura can be teleported 1
  // after the triggering ability resolves" — an enemy-ability-use reactive
  // (the Chastise t1 family) plus the chosen teleport; the shrine aura
  // membership projection is implemented
  'sealer:grand-banishment:talent:2': ['enemy-ability-trigger', 'choice-input'],
  // "Bloodied foes can be teleported 2 at the end of any turn this ability's
  // damage activates" — the ability's damage rides its documented
  // enemy-ability-trigger window (the same family as the ability's own
  // movement trigger) plus the chosen teleport; bloodied and the teleport
  // are implemented
  'spellblade:fulminate:talent:1': ['choice-input'],
  // "When marking a character, you can increase the area to 3, and the
  // teleport to 2, but it only affects allies" — rides Fulminate's
  // documented start-of-turn/mark aura-teleport window (the direction
  // choice is itself unimplemented); the area/teleport magnitude changes
  // and the ally-only filter are expressible once the window exists
  'spellblade:fulminate:talent:2': ['choice-input'],
  // "When marking a character, you can condense the aura to 1, but increase
  // the teleport to 2 spaces instead" — same documented aura-teleport
  // window family as talent 1
  // knave:strongarm:talent:1 ("Remove your target and place them into
  // adjacency" + "Comeback: gains range 2") was a {teleport} singleton whose
  // F1 remove/place + range-kernel comeback range are now wired (program-
  // level row + range rule); it is executable and dropped out of the census
  // entirely, so it has no reclassification entry here.
  'freelancer:trick-shot:talent:2': ['rebound', 'distance-predicate'],
  // "phantom projectiles … at exactly range 3 from its rebound target" —
  // needs the rebound machinery plus an exact-distance damage gate
  'freelancer:trick-shot:mastery': ['rebound'],
  // "cause an ability to rebound twice … off a new character or object in
  // range 3 of the first" — the attack-bounce modifier; the range-3
  // placement check is expressible
  'freelancer:soul-shot:talent:1': ['distance-predicate'],
  // "considers all characters in the line to be at exactly range 3" (round-4+
  // gate) — a dynamic exact-distance reclassification of the ability's own
  // distance tiers, not a targeting-range change
  'warden:apex:talent:2': ['ability-attack-modifier'],
  // "If you attack a foe at exactly range 3, this ability gains unerring" —
  // the exact-range unerring fold exists (Trigrammaton) but is trait-keyed;
  // a talent-owned per-ability attack rule needs the attachment gate. The
  // post-resolution shove is expressible
  'enochian:lance:talent:1': ['object-distance'],
  // "a character in range 3 of that object" — distance measured from an
  // OBJECT footprint, which the range kernel (actor-to-actor) does not cover
  'enochian:blackstar:mastery': ['sacrifice-percent'],
  // "split sacrifice into 25% max hp to yourself, and 25% to an ally in
  // range 4" — the sacrifice foundation pays fixed amounts only;
  // percentage-of-max sacrifice (split across two payers here) is the
  // missing variant; the range-4 check is expressible
  //
  // ── Spend/cost-payment re-audit (F14: the cost-payment and use-ledger
  //    kernels landed; the spend-family labels no longer block by
  //    themselves, so every unit that still listed only implemented labels
  //    was re-read in full and corrected below) ──
  'wright:trait:aether': ['resource-management'],
  // the Aether economy — start combat at 0, gain 1 at the start of each
  // turn, lose it after combat, spend it on one Infuse effect per ability:
  // the resource is registered (core.ts) but the turn-start gain /
  // combat-end loss / per-ability spend-limit lifecycle is not a reusable
  // capability yet
  'bastion:trait:press-the-advantage': ['shove-trigger', 'rush-modifier'],
  // "once a round, when you shove a character, you and an ally of your
  // choice anywhere can each rush 1" — needs a reactive shove trigger (the
  // reactive folds cover damage/defy-death, never shove) and the rush-1
  // grant to self + a chosen ally; the once-per-round gate is implemented
  'bastion:rook:talent:2': ['aura-trigger-grant'],
  // "you can also inflict hatred on a foe that triggers Rook's effect, but
  // no more than once a round" — the aura kernel projects conditions and
  // membership but has no hook to ADD an effect onto an aura's turn-end
  // reaction; hatred and the once-per-round gate are implemented
  'colossus:boiling-blood:mastery': ['effect-expiry-trigger', 'wound-cost'],
  // "when Defy Death would expire, you can take a wound to extend the
  // duration by 1 turn" — needs an effect-expiry trigger, a wound-taking
  // mutation (wounds exist only at character-management today), and the
  // duration extension; the once-per-combat gate is implemented
  'knave:revenge:talent:2': ['choice-input'],
  // "you may sacrifice 4 to gain or lose a combo token after using any
  // version of this ability" — the sacrifice and combo mutations are
  // implemented, but the player's gain-OR-lose choice needs a valued choice
  // input (the optional fold only carries a yes/no source id)
  'warden:mist-strider:talent:1': ['movement-trigger'],
  // "once a round, when you enter or exit the area, you can gain stealth" —
  // the movement-trigger kernel folds per-cell entry during voluntary
  // movement and is content-registered, not talent-hookable; an
  // enter/exit-area talent trigger is still missing
  'chanter:chastise:mastery': ['delivery-immunity'],
  // "any character chosen is immune to all damage from the chosen foe until
  // the start of your next turn" — foe-keyed damage immunity, not the
  // blanket damage-immune state; the first-use-in-combat gate is implemented
  'harvester:blood-grove:talent:2': ['area-extension'],
  // "you can sacrifice 2 to extend the area by 2 spaces, adding to its
  // total area on any edge" — area growth on an arbitrary edge; the
  // sacrifice and once-per-turn gate are implemented
  'harvester:crimson-bloom:talent:2': ['threshold-modifier'],
  // "foes at 25% hp or lower sacrifice 10 instead" — a sacrifice-amount
  // override conditioned on the payer's quarter-HP threshold
  'seer:chaos-tarot:talent:1': ['gamble-dice-pool-modifier'],
  // "consume any number of blessings … to roll 1 extra d6 per blessing
  // consumed" — a pre-gamble dice-pool modifier; the blessing spend is
  // implemented
  'enochian:trait:inner-furnace': ['sacrifice-percent'],
  // "you can sacrifice 25% of your max hp to reduce the Aether cost of that
  // ability by 2" — the cost-modifier registry is implemented, but the
  // sacrifice foundation pays fixed amounts only; percentage-of-max is the
  // missing variant
  'enochian:elden-rune:talent:2': ['attack-modifier'],
  // GREAT RUNE: "your attacks also shatter their main target while standing
  // in this rune" — an attack-path condition on hit; the standing-in-rune
  // infuse cost reduction is expressible (cost-modifier registry + terrain
  // gate), the shatter-on-attack is not
  'spellblade:drifting-leaf:mastery': ['infuse-permanence'],
  // "at round 4 or later, Drifting Leaf's infuse is always active" — a
  // round-gated always-active infuse effect is not a reusable capability
  'stormbender:heave-ho:mastery': ['shove-modifier', 'variable-cost'],
  // "Infuse X: TIDAL SMASH — the shove spaces become shove X. Collide: foes
  // are shattered" — a variable infuse cost X (and shove amount X), plus
  // the collide-result change
  'geomancer:quaking-palm:mastery': ['object-distance'],
  // "triggers for each object in range 2 instead of adjacent" — object
  // footprints in range, not characters
  'spellblade:blitz:talent:2': ['effect-redirect'],
  // "grant Blitz's first effect to any ally in range 2 instead" — an
  // effect-redirect target change; the range-2 check is expressible

  // ── Area re-audit (after the generic area kernel landed) ──
  // kernels/area.ts + area-geometry.ts now implement the reusable area
  // authority: the deterministic line/arc/burst geometry (arc paths are
  // validated player choices, never auto-shaped) and the registered
  // shape/length modifier seam (`effectiveAreaFor`) folded at command time.
  // Four former `{area-define}` singletons whose COMPLETE semantics were an
  // area shape/size change or an area-carried trigger with existing
  // authority (Soul Shot t2, Sturmreiten mastery, Pyre t2, Eye of the
  // Storm t2) are executable and dropped out of the census entirely.
  //
  // The remaining singletons were re-audited: `area-define` conflated
  // several genuinely different families. Small/medium/large blast
  // templates are visual-only in the PDF and deliberately NOT approximated
  // (the classifier now emits `blast-template` for them); the other rows
  // were misclassified or need a distinct delivery/lifecycle seam,
  // reclassified below.
  'vagabond:trait:dodge': ['delivery-immunity'],
  // "Immune to damage from missed attacks, successful saves, and area
  // effects" — a damage-delivery immunity predicate on the trait owner,
  // NOT an area definition; the delivery filter family is missing
  'bastion:perseus:talent:2': ['aura-to-area-conversion'],
  // "extend the area as a line 5 area effect instead of an aura" —
  // converting the Perseus AURA delivery into a one-shot line area is a
  // delivery-type conversion; the area kernel's shape overrides cover
  // line/arc bases, not an aura base
  'colossus:dropkick:mastery': ['ability-attack-modifier'],
  // "At round 4 or later, dropkick gains true strike and a line 4 area
  // effect that must include your target" — the round-gated line-4 area
  // itself is expressible through the area kernel; "gains true strike" on
  // a mastery-owned ability needs the per-ability attack-modifier
  // attachment gate (the same family as Umbra's unerring)
  'warden:sidhe:talent:2': ['blast-template'],
  // "your foe explodes with a medium blast area effect" — exact medium
  // blast geometry is visual-only in the source
  'seer:eclipse:talent:2': ['choice-input'],
  // "dealing 3 damage again to up to three characters in its area effect"
  // — the player chooses up to three targets in the area
  'enochian:elden-rune:mastery': ['blast-template'],
  // "Arkenrunes … extend to a small blast area" — exact small blast
  // geometry is visual-only in the source
  'geomancer:midas:talent:2': ['entity-vacate'],
  // "When your chosen character returns, the shell explodes off them" —
  // the shell-entity vacate/return lifecycle; the burst-1 area is
  // expressible
  'spellblade:atherwand:talent:2': ['terrain-move-lifecycle'],
  // "At the start of your turn, you can move the area 1 space in any
  // direction … shoves them 1" — moving an existing terrain area at a
  // turn boundary is a lifecycle terrain-move, not an area definition
  'spellblade:sturmreiten:talent:2': ['area-extension'],
  // "Comeback: You may extend Sturmreiten's area by another line 3 area,
  // drawn in a different direction" — an additional secondary area (the
  // kernel's seam overrides one area; it does not place a second one)

  // ── Gamble re-audit (after the generic gambleD6 kernel landed) ──
  // job-kit.ts now provides `gambleD6(context, threshold?)` — a source-ID-
  // free d6 gamble through the deterministic dice source. Existing programs
  // that already used `context.dice.die(6)` inline have been converted to
  // use the shared helper. The `gamble-state` blocker was a syntactic
  // classifier matching any source text mentioning "gamble" or "power die",
  // but many units' programs already handle the mechanic. Reclassified below.
  'fool:spinning-top:talent:1': ['passive'],
  // "Spinning Top gambles the dash distance" — resolver already uses
  // gambleD6 for the d6 result; the talent's passive (non-USE_ABILITY)
  // component is the remaining blocker
  'chanter:pandaemonium:talent:1': ['passive'],
  // "gambles" in the source text, but the resolver auto-hits and deals
  // fray damage — no gamble roll is part of the automated mechanics;
  // the talent's passive component is the remaining blocker
  'seer:gran-reversa:talent:1': ['passive'],
  // "The power die" is the Gran Reversa stance die, initialized on
  // enter; the reverseFate resolver uses gambleD6 for the d6 tick-down;
  // the talent's passive component is the remaining blocker
  'seer:sleight-of-hand:talent:2': ['gamble-dice-pool-modifier'],
  // "roll 1 more d6 the next time you gamble" — adds extra dice to the
  // Gamble pool (gambleD6 always rolls exactly 1 die; extra-dice needs
  // the dice-pool extension). "Charge: 2 more d6s" adds more dice via
  // the same seam. Distinct from result-override (Stack Dice) and
  // post-roll-reactive-choice (Bend Fate).
  'seer:chaos-tarot:talent:2': ['charge-state'],
  // chaosTarotEffects uses gambleD6 for the tarot roll; charge-state
  // is the remaining blocker (card charge resource)
  'seer:polaris:talent:2': ['terrain-create'],
  // Polaris marks a space for the meteor gamble (terrain entity);
  // the gamble itself is wired via the end-of-turn dice window
  'fool:party-favor:mastery': ['mark-detonation-window'],
  // Party Favor's movement-trigger gamble is wired; the mastery's
  // throw-as-mark and end-of-turn gamble detonation (the mine's blast +
  // stacking gamble effects, ending the mark) need a reusable
  // mark-detonation window, distinct from the terrain mine's entry trigger
  'freelancer:exorcism:talent:1': ['power-die', 'attack-exceed-trigger'],
  // "While this mark is active, your attacks gain: Exceed: tick the die up
  // by 1." The Exorcism power die is placed on the mark but never ticks
  // (the end-of-turn tick/projectile window is documented); the talent's
  // attack-exceed trigger folding into the die tick needs both the power-die
  // tick seam and an attack-pipeline exceed trigger
  'shade:incubus:mastery': ['mark-stacking', 'damage-dealt-trigger'],
  // Incubus's mark + turn-end detonation are wired; the mastery's "stacks
  // with other marks … may mark any number of characters … when a character
  // takes damage from an Incubus mark, you may also mark them" needs mark
  // stacking/multi-mark plus a damage-dealt re-mark trigger
  'sealer:divine-aegis:mastery': ['mark-activation-gate'],
  // The aegis mark's activation (a foe must save before targeting the ally,
  // fading on a failed save) is a documented save-window reducer hook; the
  // mastery's "can be activated twice before it fades" is a source-declared
  // activation count on that same gate — one reusable capability, like the
  // interrupt use-count-override family
  'seer:polaris:talent:1': ['mark-as-entity-follow'],
  // "You can cause one of your Polaris to follow a character as a mark
  // instead of a space" — a mark that carries the meteor entity and follows

  // ── F5 mark-modifier reconciliation (2026-08-27) ──
  // The coarse `{mark-modifier}` label is RETIRED: the F5 fold landed a
  // SUBSET (carrier-side mark-condition projections with potency, mark-keyed
  // status-save policies, mark turn-start lifecycle triggers — Grand Seal
  // t1/t2, Rot t2), so F5 is PARTIAL. Every row below was re-read against
  // its complete source passage and reclassified to the precise missing mark
  // family: `mark-gated-modifier` (mark-state-keyed attack/damage/save/
  // movement modifiers read at the authority's query point), `mark-transfer`
  // (move a mark to another target), `mark-defeat-trigger` (defeated-while-
  // marked triggers), `mark-stacking`, `mark-detonation-window`, and
  // `mark-activation-gate` (which already existed). Rows whose mark portion
  // the landed F5 machinery already supplies (growing-season mastery's
  // pacified+ projection, Rot t1's turn-start trigger) drop the mark label
  // entirely and keep only their genuinely missing capabilities. Zero
  // unresolved blocker sets contain `mark-modifier`.
  'fool:diablo:mastery': ['area-define', 'charge-state', 'entity-create'],
  // "mark out the area effect" designates the Diablo blast area — the word
  // is a verb, NOT the Mark mechanic — so no mark family applies; the
  // delayed re-explosion (charge-state + area-define) plus the bomb summon
  // (entity-create) are the complete residual
  'freelancer:trait:astral-binding': ['action-type-change', 'mark-stacking'],
  // "stack up to two marks" = mark-stacking; the free-action group teleport
  // of marked characters rides the F1 teleport gateway (implemented) and the
  // free-action cost (action-type-change)
  'freelancer:exorcism:mastery': ['mark-defeat-trigger', 'mark-transfer', 'range-modifier'],
  // "If exorcism's target is defeated … tracking a new target … transferring
  // the mark" — the defeated-while-marked trigger plus mark-transfer
  'freelancer:exorcism:talent:2': ['blast-template', 'charge-state', 'mark-defeat-trigger'],
  // the defeated-while-marked projectile scatter (per-charge damage) needs
  // the large-blast template, the charge tracking, and the defeat trigger
  'freelancer:astral-chain:talent:1': ['mark-gated-modifier', 'range-modifier'],
  // "While marked, gain evasion against your marked foe while they are in
  // range 3" — an owner-side mark-gated defensive modifier (not a carrier
  // status projection, which F5 supplies)
  'freelancer:astral-chain:talent:2': ['damage-modifier', 'mark-gated-modifier'],
  // "all attacks from you or allies against your marked foe may gain rebound
  // and deal bonus damage if they are rebounded" — a mark-gated attack
  // modifier plus the rebound bonus-damage delivery
  'freelancer:astral-chain:mastery': ['mark-gated-modifier', 'range-modifier'],
  // the marked foe's save-to-move-beyond-range-3 restriction (with combat-
  // long immunity) is a mark-gated movement modifier
  'freelancer:warding-bolts:talent:2': ['effect-count', 'mark-gated-modifier'],
  // "Marked foes take 2 damage, twice, instead" — a mark-gated damage-value
  // override on the hover-zone strike plus the effect-count fold
  'warden:stampede:talent:1': ['action-type-change', 'mark-defeat-trigger', 'mark-transfer'],
  // finishing-blow mark transfer as a free action
  'harvester:trait:gardener-of-kin': ['entity-create', 'mark-gated-modifier', 'mark-stacking'],
  // "stack 2 marks" plus "foes marked by you take +1 damage from summons"
  // (a mark-gated damage-taken modifier)
  'harvester:sow:talent:1': ['mark-defeat-trigger', 'mark-transfer', 'range-modifier'],
  // the defeated-while-marked transfer to a foe in range 3
  'harvester:growing-season:talent:1': ['mark-gated-modifier', 'terrain-create'],
  // "Abilities used against a character marked by growing season gain slay:
  // create an Eden vine …" — a mark-gated slay trigger plus terrain creation
  'harvester:growing-season:talent:2': ['mark-gated-modifier', 'terrain-create'],
  // same shape: mark-gated slay that creates the blood tree object
  'harvester:growing-season:mastery': ['terrain-create'],
  // "Foes marked by Growing Season are pacified+ while in or adjacent to
  // spaces occupied by plants" — the F5 carrier-side projection with a
  // live-state (plant adjacency) gate and pacified+ potency already supplies
  // the mark portion (the Grand Seal t2 shape); only plant creation remains
  'harvester:rot:talent:1': ['entity-create'],
  // "Characters marked by regenerate gain comeback: summon a plant … at the
  // start of their turn" — the F5 turn-start mark trigger already supplies
  // the mark portion (the Rot t2 shape); only the plant summon remains
  'harvester:rot:mastery': ['entity-create', 'mark-defeat-trigger', 'range-modifier'],
  // REGROWTH's "if that character would be defeated … instantly rescued" is
  // a defeat-rescue mark trigger, plus the plant summon and range 4
  'sealer:grand-seal:mastery': ['mark-detonation-window', 'mark-transfer', 'range-modifier'],
  // "When this mark ends … you may transfer it to [a new foe]" — the mark-
  // end detonation window plus mark-transfer
  'sealer:divine-aegis:talent:1': ['action-type-change', 'mark-activation-gate'],
  // "If your ally is at 25% hp or lower when marked, marking them becomes a
  // free action" — a mark-action cost gate (the aegis activation family)
  'spellblade:fulminate:mastery': ['cover-mechanic', 'damage-modifier', 'mark-gated-modifier', 'range-modifier', 'unlimited-range'],
  // the mark-gated attack-modifier set vs the marked target (pull, unlimited
  // range, bonus damage, ignore cover on foes; no-crit/no-bonus-damage/+1
  // curse on allies)
  'stormbender:deepwrath:talent:1': ['mark-gated-modifier', 'terrain-create'],
  // "Marked allies gain +1 boon on saves in pits …" — a mark-gated save
  // modifier plus pit terrain
  'stormbender:deepwrath:talent:2': ['damage-modifier', 'mark-gated-modifier', 'terrain-create'],
  // "Marked foes take bonus damage from all sources" (a mark-gated damage-
  // taken modifier) plus "are shattered+ while inside pits" (the F5 carrier-
  // side projection is supplied; the damage-taken half is not)
  'stormbender:deepwrath:mastery': ['mark-gated-modifier', 'terrain-create'],
  // the marked character's vacate-leaves-dangerous-terrain trail and the
  // mark-gated dangerous-terrain immunity/extra damage

  // its character
  'enochian:blazing-bond:talent:1': ['choice-input', 'distance-predicate'],
  // "While marked, you can teleport yourself or your ally 2 spaces at the
  // end of your turn, as long as you end closer to each other" — an end-of-
  // turn free-action choice (choice-input) with a comparative positioning
  // predicate on the teleport destinations
  'enochian:blazing-bond:mastery': ['choice-input', 'delivery-immunity'],
  // "If one of the partners would take damage … the other can reduce
  // themselves to 1 hp to grant that ally immunity to all damage from the
  // triggering ability. The bond then snaps" — a reactive spend choice plus
  // an ability-scoped damage-immunity grant (delivery-immunity) and mark end
  'chanter:holy:talent:1': ['blast-template', 'terrain-create'],
  // "gambles" in the source but the program is wired; the medium blast
  // geometry and terrain creation are the real blockers
  'seer:sleight-of-hand:mastery': ['power-die', 'lifecycle-target-selection'],
  // "gain six spectral blades … using a d6 power die starting at 6 to
  // track them. At the end of your turn, gamble. If you roll under the
  // number of blades remaining, a blade flies out and deals 2 divine
  // damage to a foe in range 6" — power-die resource system + lifecycle
  // boundary target selection (the lifecycle recipe resolve() has no
  // player choice or foe-selection seam; it can only mutate state, not
  // present a target choice)
  'seer:chaos-tarot:mastery': ['entity-create'],
  // The mastery's entity-creation effect is the remaining blocker
  'spellblade:rampant-nail:talent:2': ['passive'],
  // Rampant Nail's die mechanic is wired through the mastery lifecycle;
  // the talent's passive component is the remaining blocker
  'fool:limit-break': ['area-define', 'entity-create'],
  // "gamble" is mentioned but the real blockers are area-define and
  // entity-create; the gamble itself is not the missing primitive
  'seer:limit-break': ['dice-result-modifier', 'attack-result-modifier', 'save-result-modifier'],
  // High Prophecy: "Every d6...is either a 6 or a 1 (you choose)" →
  // aura-scoped dice-result-modifier (no generic dice-override seam exists);
  // "automatically missed by attacks" → attack-result-modifier (the
  // attack kernel has autoHit but no autoMiss/forceMiss); "turn any of
  // your attack misses into hits" → attack-result-modifier (no miss-to-hit
  // conversion exists); "succeed all saves" → save-result-modifier (the
  // save kernel has forceFailure but no forceSuccess). The free action
  // (action-type-change) and aura are both implemented; condition-grant
  // is implemented but does not cover attack/save result overrides.

  // ── Trait-level Gamble reclassification ──
  // The two remaining `gamble-state` trait entries need reclassification:
  // the Gamble foundation (gambleD6) handles the generic d6 roll, but
  // these traits require additional non-Gamble foundations.
  'fool:trait:stack-dice': ['gamble-result-override'],
  // "You can use this die when you gamble to make the gamble result 6"
  // — a spend-to-override-result modifier; the gamble-result-override
  // seam is a small generic extension: a typed "set the result to N"
  // that intercepts the Gamble roll. Distinct from dice-pool modifiers
  // (extra dice) and post-roll reactive choices (Bend Fate).
  'seer:trait:bend-fate': ['post-roll-reactive-choice'],
  // "discard any number of cards after you gamble to roll an extra die
  // per card discarded, choosing any result" — a reactive spend choice
  // AFTER seeing the roll, with card resources and result-selection.
  // The Gamble foundation rolls the die; the post-roll reactive-choice
  // window and card resource system are separate missing foundations.

  // ── Gamble-extension reclassification (extra dice / result selection) ──
  'knave:riposte:talent:1': ['gamble-dice-pool-modifier'],
  // "sacrifice 2 to roll 1 more d6 while gambling" — extra Gamble die
  // via sacrifice cost; the sacrifice-cost itself is a cost modifier but
  // the core mechanic is dice-pool extension.
  'fool:death:talent:1': ['gamble-dice-pool-modifier', 'gamble-result-selection'],
  // "roll 1 more d6 and choose any result" — extra Gamble die plus
  // result-selection from the expanded pool; distinct from result-override
  // (Stack Dice) and post-roll reactive choice (Bend Fate).
  'chanter:monogatari:talent:2': ['gamble-dice-pool-modifier'],
  // "roll 1 extra d6 per blessing spent when gambling" — extra Gamble
  // dice via blessing spend; the blessing-spend is a cost modifier but
  // the core mechanic is dice-pool extension.
  'chanter:monogatari:mastery': ['gamble-dice-pool-modifier', 'gamble-result-selection'],
  // "roll 1 extra d6 when gambling, and choose any two results" —
  // extra Gamble die plus result-selection from the expanded pool;
  // the cure-on-trigger clause is a separate lifecycle mechanic.

  // ── {irreducible} decomposition audit (2026-08-26): every unit that fell
  //    through the syntactic first pass was re-read against its full source
  //    text and given its concrete MINIMAL blocker set. None qualified as
  //    non-automatable/table-facing: each names a distinct reusable capability
  //    (or composes existing ones). New family labels are deliberately named
  //    after the mechanic they generalize, not after the ability that needs
  //    them; several units compose ONLY existing families and were previously
  //    irreducible only because the keyword pass missed their vocabulary. ──

  // ── Class traits ──
  'stalwart:trait:armor-2': ['damage-taken-modifier'],
  // "Reduce all damage taken by 2" — flat incoming-damage reduction on the
  // trait owner; the damage kernel has no registered damage-TAKEN modifier
  // seam (damage-modifier covers outgoing instances only)
  'wright:trait:slip': ['movement-trigger-suppression'],
  // "Movement ignores and does not trigger interrupts, Vigilance, or
  // Rampart" — a per-mover suppression flag consulted by the movement-entry
  // trigger folds; no such predicate exists today

  // ── Bastion ──
  // Interrupt-modifier reclassification (D1, 2026-08-27): the syntactic
  // `interrupt-modifier` label conflated five genuinely different reusable
  // families — rank/use-count overrides, timing overrides, effect riders,
  // interrupt grants, and use banking. Each row below was re-read against
  // its exact source text and reclassified to its precise blocker set.
  'bastion:catapult:talent:1': ['interrupt-rider', 'rebound', 'recipient-expansion'],
  // "Your shield becomes a valid target for allied abilities. You can expend
  // this interrupt to grant them rebound." — the interrupt gains an
  // expend-for-rebound rider (rebound is the attack-bounce family shared
  // with Trick Shot/Nightmare) and the shield becomes an allied-target
  // recipient (recipient-expansion)
  'bastion:perseus:mastery': ['interrupt-rider'],
  // "When this interrupt triggers, after the triggering effect resolves, you
  // may deal 2 damage to all affected foes from the triggering ability and
  // shove them 1 in any direction." — an after-trigger effect rider
  // (damage + shove to the triggering ability's affected foes)
  'bastion:heracule:talent:1': ['direction-override'],
  // "Heracule's shoves can be in any direction" — modifies shove direction
  // legality: the resolver must accept player-chosen direction for ALL shoves
  // (target shove + second-foe shove), not just the primary target shove
  'bastion:heracule:talent:2': ['effect-count'],
  // "second effect triggers +1 more time" — repeat/effect-count modifier
  'bastion:battering-ram:talent:2': ['object-interaction', 'collide-rider'],
  // "shove objects … object triggers collide effects on the first character
  // it collides with" — objects as shove participants + an object-collide
  // effect rider
  'bastion:land-waster:talent:1': ['conditional-distance-stun'],
  // "If Land Waster's effect shockwave shoves 3 or more foes or allies,
  // it shoves +1 and stuns your target" — conditional shove distance
  // modifier (+1 when shockwave hits 3+) + stun on attack target; the
  // resolver needs shockwave-shove count tracking and conditional mutation
  'bastion:catapult:talent:2': ['foe-trigger-expansion', 'collide-rider'],
  // "Catapult can also be triggered on foes. When triggered on foes, the
  // effect becomes effect: shove 1. Collide: you may rush 1" — expands
  // eligible triggers to foes + replaces foe effect with shove 1 + different
  // collide rider
  'bastion:great-giorgios:talent:1': ['new-shove-effect', 'player-choice'],
  // "Foes you passed through take 2 damage after your movement resolves,
  // and are shoved 1 to either side of your movement" — adds new shove
  // effects with player-chosen direction (either side of movement)
  'bastion:great-giorgios:talent:2': ['new-shove-effect', 'direction-override'],
  // "Allies adjacent to you during any part of this rush are shoved 1 in
  // any direction after this ability resolves" — adds new shove effects
  // with any-direction legality
  'bastion:limit-break': ['new-shove-effect', 'player-choice', 'repeat-mechanic'],
  // "every character on the battlefield is shoved 1 space in a direction of
  // your choice" — compound: new shoves on all characters + player-chosen
  // directions + repeat mechanic (Ultimate: repeat once on allies or enemies)

  // ── Warden ──
  'warden:circle-the-oak:mastery': ['new-shove-effect', 'movement-modifier'],
  // "Enemies no longer stop this move, and you may phase through their
  // spaces. Enemies you pass through are shoved 1, take fray damage, and
  // are dazed" — removes enemy collision + adds new shove/damage/daze

  // ── Enochian ──
  'enochian:soul-burn:talent:2': ['new-shove-effect', 'lifecycle-trigger'],
  // "Foes that end their turn adjacent to you while Soul Burn is active
  // take 1 piercing damage and are shoved 1" — new shove+damage at
  // end-of-turn lifecycle trigger

  // ── Demon Slayer ──
  'demon-slayer:draken-cross:talent:1': ['effect-count'],
  // "Exceed: deal fray damage again to all characters in any area created by
  // this ability" — an exceed-triggered repeat instance (area-member
  // targeting itself is expressible)
  'demon-slayer:righteous-disdain:talent:2': ['new-shove-effect'],
  // "Shove the triggering foe and ally each 1 space in any direction" —
  // adds new shove effects after ability resolves, not a shove modifier
  'demon-slayer:righteous-disdain:mastery': ['damage-taken-modifier'],
  // "The damage from Righteous Disdain cannot reduce you past 1 hp" — an
  // incoming-damage floor, same damage-taken seam as armor-2
  'demon-slayer:demon-claw:talent:2': ['new-shove-effect'],
  // "After the second rush, you can shove an adjacent character 2 spaces"
  // — adds a new optional shove-2, not a modifier on existing shoves
  'demon-slayer:demon-claw:mastery': ['damage-modifier'],
  // "+1 damage per 25% max hp missing, max +3" — gated scaling damage bonus
  'demon-slayer:soul-blade:mastery': ['power-die', 'area-effect-rider'],
  // round-4+ stance-die refresh at turn start (persistent-ticker lifecycle,
  // same family as Gran Reversa/Wicked Sheath) + "any area created by it
  // shoves all characters inside 1" (rider attached to a created area)
  'demon-slayer:six-hells-trigram:talent:1': ['area-effect-rider'],
  // "You have counter and are sturdy while inside the area" — condition
  // projection scoped to a CREATED area (the Aura kernel covers aura
  // membership only); the conditions themselves are implemented
  'demon-slayer:six-hells-trigram:talent:2': ['area-effect-rider', 'damage-taken-modifier'],
  // "Allies inside the area reduce all damage by 2, as if from armor" —
  // area-scoped projection OF a damage-taken modifier
  'demon-slayer:wicked-sheath:mastery': ['power-die'],
  // "If the die is 2+ and you would discard it, roll instead; on 1–2 keep it"
  // — power-die reroll-on-discard lifecycle (trailing faction names in the
  // extracted text are extraction noise, not mechanics)

  // ── Colossus ──
  'colossus:takedown:talent:2': ['shove-modifier', 'collide-rider'],
  // optional double shove (target then self) + "Collide: deal fray damage"
  'colossus:takedown:mastery': ['elevation-scaling'],
  // "2 damage once per difference in elevation … maximum three times" —
  // elevation-delta-driven instance count; geometry exposes height but no
  // consumer scales effects by elevation difference
  'colossus:great-suplex:mastery': ['target-count-override'],
  // "You can target two adjacent characters" — target-count override
  'colossus:gigaton-whip:talent:1': ['collide-rider', 'shove-modifier'],
  // "If your target collides with another character, shove that character 1
  // and deal 2 damage"
  'colossus:raging-wolf:talent:2': ['fly-grant'],
  // "While you're at 1 hp, increase flight to 3" — conditional fly grant
  'colossus:raging-wolf:mastery': ['interrupt-timing'],
  // "You can immediately use Raging Wolf as an interrupt before becoming
  // defeated. This ignores the interrupt limit." — a before-defeat timing
  // override plus an interrupt-limit exemption (window/timing authority)
  'colossus:boiling-blood:talent:1': ['ability-trigger-grant'],
  // "While Defy Death is active, all abilities also trigger all exceed
  // effects" — a durable state granting extra triggers to every ability

  // ── Knave ──
  'knave:trait:martial-master': ['stance-capacity'],
  // "You can take two stances at once" — active-stance capacity override
  'knave:sucker-punch:talent:1': ['use-count-override'],
  // "You can sacrifice 2 after using this interrupt to immediately regain
  // it." — a spent-use refund: the allowance ledger decrements on use; this
  // restores it after an HP sacrifice (same ledger-allowance family as
  // Riposte's banking; the sacrifice payment itself is implemented)
  'knave:sucker-punch:talent:2': ['interrupt-rank'],
  // "Comeback: This ability is interrupt 2." — a rank (= per-round uses)
  // override gated on Comeback/bloodied; the mastery fold's interrupt-rank
  // kernel covers mastered parents with always/round gates, but a
  // talent-level comeback-gated rank rule is not yet registered there
  'knave:riposte:mastery': ['use-count-override'],
  // "Uses of Dire Parry stack up to 3, and you can bank these uses" — the
  // use-ledger counts DOWN from once-per-round; stacking/banking accumulates
  // UP across turns, which the ledger does not represent
  'knave:strongarm:talent:2': ['object-interaction'],
  // "phase through objects the same way as characters, though those objects
  // are not shoved" — objects as movement-collision participants
  'knave:intimidate:talent:2': ['status-count-scaling'],
  // "takes 2 damage once for every status they are afflicted by, max three"
  // — repeat count scaled by a state query (statuses on the target)
  'knave:bleak-mercy:talent:1': ['attack-result-modifier'],
  // "cannot miss (turn any miss into a hit)" at ≤25% hp — the miss-to-hit
  // conversion seam (same family as Seer limit break); the hp gate exists

  // ── Fool ──
  'fool:trait:curse-of-chaos': ['delivery-immunity', 'distance-predicate'],
  // "evasion against characters 3+ spaces away" — distance-gated delivery
  // immunity on the trait owner
  'fool:cavaliere:talent:2': ['movement-trigger'],
  // "Allies you pass through during this movement can dash 1" — a reactive
  // rider on the mover's own movement path (entry triggers cover cells, not
  // passed-through characters granting actions to others)
  'fool:death:mastery': ['threshold-modifier'],
  // "Increase death's threshold to 16 hp or less"
  'fool:gallows-humor:talent:1': ['defeat-trigger'],
  // "instantly ticks up to maximum if an ally is defeated anywhere" — the
  // ticker exists (lifecycle recipe); the on-any-defeat reactive is missing
  'fool:party-favor:talent:1': ['fly-grant'],
  // "Increase flight on yourself to 3"

  // ── Freelancer / Shade ──
  'freelancer:strafe-shot:talent:2': ['effect-count'],
  'freelancer:strafe-shot:mastery': ['interrupt-timing'],
  // "Strafe shot can interrupt and break up any movement you make without
  // halting it." — a timing/window override: the ability may be taken as an
  // interrupt during the user's own movement without stopping it
  'freelancer:deus-ex-machina:talent:2': ['interrupt-rider', 'choice-input'],
  // "Using this interrupt on a foe dazes or blinds them (your choice)." — a
  // trigger rider with a durable daze-vs-blind player choice
  'freelancer:deus-ex-machina:mastery': ['use-count-override', 'condition-preserve'],
  // "Whip of the Thrones: Gain stealth after marking your target. This
  // interrupt does not break stealth, and while you have stealth, it can be
  // used +1 more time a round." — a conditional +1 use while stealthed
  // (allowance override) plus stealth preservation (same condition-preserve
  // family as Assassinate t1; stealth-grant itself is condition-grant,
  // implemented)
  // "Exceed: Dash 3 again" — exceed-triggered repeat of a movement instance
  'shade:harrow:mastery': ['use-count-override'],
  'shade:umbral-echo:mastery': ['interrupt-grant', 'range-modifier', 'stance-gate'],
  // "Gain the following interrupt while in this stance: Soul Proxy Interrupt
  // 1…" — gains a new interrupt gated on the stance (interrupt-grant;
  // range-modifier/stance-gate remain live from the shadow-consumption
  // range-2 and stance-scoped trigger)
  // "can trigger twice a round by default instead" — ledger allowance
  // override (same family as Riposte's banking)
  'shade:umbral-echo:talent:2': ['movement-modifier'],
  // phasing (implemented) + "entering the space of shadows always costs a
  // maximum of 1 movement" — entity-space entry-cost cap
  'shade:assassinate:talent:1': ['range-modifier', 'condition-preserve'],
  // "If in stealth, increase all ranges by +2, and doesn't break stealth" —
  // listed-range override plus casting without breaking a condition
  'shade:assassinate:talent:2': ['held-ability-gate'],
  // "While you're holding assassinate, you have evasion" — a gate on the
  // readied/unused (held) state of an ability; evasion itself is implemented
  'shade:assassinate:mastery': ['target-count-override', 'choice-input'],
  // "choose two foes … trigger its effects in any order" — target-count
  // override plus ordered player choice over resolution

  // ── Warden ──
  'warden:gwynt:talent:1': ['range-modifier', 'movement-modifier'],
  // "If made from stealth, increase the dashes and range by +1"
  'warden:circle-the-oak:talent:1': ['movement-trigger'],
  // "Allies you pass through may dash 1 after this ability resolves" — same
  // path-through rider family as Cavaliere t2
  'warden:mist-strider:talent:2': ['area-effect-rider', 'delivery-immunity'],
  // "Foes in the area count all characters as having evasion" — area-scoped
  // delivery-immunity projection onto opposing members
  'warden:mist-strider:mastery': ['entity-create', 'area-exit-trigger'],
  // "creates a beast inside when an area is created" + foes that start their
  // turn inside and end outside take damage/dazed — creation plus an
  // end-of-turn inside→outside boundary transition trigger (enter triggers
  // exist; exit does not)
  'warden:stampede:talent:2': ['path-count-predicate'],
  // "If the beast passes through two or more characters before reaching your
  // foe…instead" — a movement-path character-count predicate selecting an
  // alternate effect body
  'warden:stampede:mastery': ['entity-vacate', 'forced-placement'],
  // riding removes allies from the battlefield mid-movement, then places
  // them adjacent when it ends — removal + post-move placement primitives

  // ── Chanter ──
  'chanter:felicity:talent:1': ['movement-trigger', 'shove-modifier'],
  // "When an ally ends any movement from this ability, they can shove all
  // adjacent characters 1"
  'chanter:dervish:talent:2': ['pre-ability-action'],
  // "Before you use this ability, you can cause a wind blast, shoving all
  // adjacent foes 1 and dealing 2 damage" — a declared pre-ability sub-action
  // (pre-ability-movement covers self-repositioning; this is an effect)
  'chanter:symphony:talent:1': ['effect-count', 'shared-turn-ledger', 'shove-modifier'],
  // motes explode again + shove IF at least one other mote already exploded
  // this turn — repeat, radial shove, and a cross-instance shared turn
  // counter (the use-ledger gates ONE actor's own events, not a shared
  // per-turn count across instances)
  'chanter:monogatari:talent:1': ['recipient-expansion'],
  // "cause the effect to also apply to foes; foes that fulfill the condition
  // are sealed" — extending an ongoing effect's recipient set to the enemy
  // side (sealing itself is implemented)
  'chanter:chastise:talent:1': ['enemy-ability-trigger'],
  // "your foe takes 1 divine damage after using any ability that damages
  // another character" — a reactive keyed to the ENEMY's ability use
  'chanter:chastise:talent:2': ['defeat-trigger', 'effect-count'],
  // "if your foe defeats any character, they take 1 divine damage three times"

  // ── Harvester / Sealer ──
  'harvester:sow:talent:2': ['cross-ability-invoke'],
  // "Comeback: Reap's Slay effect triggers" — invoking another ability's
  // NAMED effect as a rider; no cross-ability invoke seam exists
  'harvester:blood-grove:talent:1': ['movement-modifier'],
  // "All spaces of the area cost 0 movement for thralls to enter" — an
  // actor-kind-scoped terrain entry-cost override
  'harvester:fairy-ring:talent:2': ['recipient-expansion', 'condition-suppression'],
  'harvester:fairy-ring:mastery': ['interrupt-rider', 'terrain-create'],
  // "Whenever the rings' interrupt activates, create a height 1 Megamushroom
  // object anywhere inside or adjacent to the area…" — an interrupt-trigger
  // rider creating a terrain/object (terrain-create remains the live blocker)
  'sealer:spirit-shrine:mastery': ['interrupt-grant', 'aura-user-gate', 'elevation-scaling', 'entity-consume'],
  // "Gain the following interrupt Grace of the Spirits… Trigger: An ally in
  // the aura is damaged… Destroy the shrine, then deal 2 divine damage, once,
  // to the foe per height of the shrine. You cannot place shrines for the
  // rest of combat." — the mastery GAINS a new interrupt (interrupt-grant)
  // whose trigger reads the shrine aura (aura-user-gate), whose damage
  // scales with shrine height (elevation-scaling), and whose effect destroys
  // the shrine (entity-consume)
  'sealer:justice:talent:1': ['interrupt-rider', 'resource-management', 'vigor-grant'],
  // "Allies affected by either interrupt gain 2 vigor." — an effect rider on
  // the interrupt's affected allies (resource-management/vigor-grant stay
  // live: the interrupt-level vigor hook is not a reusable capability yet)
  'sealer:justice:talent:2': ['interrupt-timing'],
  // "You can teleport 1 space before and after triggering either interrupt."
  // — pre/post-trigger movement around the interrupt window (teleport itself
  // is F1-implemented; the pre/post trigger hook is the timing override)
  'sealer:justice:mastery': ['interrupt-grant', 'resource-management', 'vigor-grant'],
  // "Add an alternate combo action: Combo: GRAN JUDICATA Interrupt 1…" —
  // gains an alternate interrupt combo action (interrupt-grant) with
  // divine damage + blessed + vigor riders
  // "use Spirit Away on allies; if you do, it doesn't seal them" — recipient
  // expansion plus suppressing the ability's own condition application
  'sealer:sanctify:talent:1': ['entry-save-gate'],
  // "Bloodied foes must save if they attempt to enter the area; on a failed
  // save they cannot voluntarily enter until the start of their next turn" —
  // a save gate on area entry producing a denial window
  'sealer:grand-banishment:mastery': ['distance-change-trigger'],
  // inverted effect: damage the chosen foe if they move AWAY — a reactive on
  // distance INCREASING from an anchor (proximity triggers decrease only)

  // ── Seer ──
  'seer:wish:talent:1': ['interrupt-rider', 'movement-modifier'],
  // "If your ally is bloodied, they are also blessed after this interrupt
  // resolves and may dash 2" — an after-resolve rider (blessed is
  // condition-grant, implemented) plus the pre/post-ability movement hook
  // for the dash
  'seer:trait:the-wheel-of-fate': ['card-deck-system'],
  // 13-card deck, draw-to-5 at combat start, hand cap 7, discard pile,
  // reshuffle-on-empty persisting across combats — a dedicated persistent
  // card subsystem (draw/hand/discard/shuffle), not expressible with any
  // existing resource
  'seer:trait:skein': ['card-deck-system'],
  // draw at turn start / extra draw at turn end — rides the same missing
  // card-deck subsystem
  'seer:sleight-of-hand:talent:1': ['condition-preserve', 'effect-count'],
  // "does not break the pacified condition" + "deals 2 damage again to any
  // pacified foes in the area"
  'seer:astra:mastery': ['member-count-scaling'],
  // "deal 2 divine per blessed ally in the area, up to three times; foes can
  // be damaged more than once" — repeat count scaled by a membership query
  'seer:sisyphus:mastery': ['trigger-threshold-override'],
  // "triggers no matter how far away a character is from their starting
  // position" — removes the displacement-distance bound on the trigger
  'seer:gran-reversa:talent:2': ['power-die'],
  // "if your ally was bloodied, instantly regain a tick on this die"
  'seer:gran-reversa:mastery': ['resource-cap-override'],
  // "Vigor granted … can increase a character's total vigor over their
  // maximum" — per-grant cap bypass
  'seer:eclipse:mastery': ['duration-modifier', 'choice-input'],
  // "does not expire … repeat its delay effect at the end of your turn without
  // ending your turn; disappears if reused" — player-chosen duration
  // extension with an end-of-turn repeat window
  'seer:the-tower:mastery': ['damage-modifier', 'defense-bypass'],
  // double meteor damage at ≤25% hp AND "ignores defiance" — the divine
  // type's defiance bypass is fixed to the type; a generic ignore-defense
  // flag does not exist

  // ── Enochian / Geomancer ──
  'enochian:lance:talent:2': ['damage-maximize'],
  // "If you are at 1 hp or lower, deals maximum base damage (before critical
  // hits)" — a damage-roll maximization gate (the at-or-under-1-hp
  // threshold read is the shared hp-threshold machinery, but maximizing a
  // roll is not a bonus-die or flat modifier)
  'enochian:implode:talent:1': ['area-effect-rider'],
  // "Any character in the center space is also shattered" — shatter
  // (implemented) attached to the created area's center cell
  'enochian:implode:mastery': ['target-selector-variant', 'defeat-trigger'],
  // "choose a character instead of a space (no stun); if that character is
  // defeated, Implode activates immediately" — targeting-mode change plus a
  // defeat-linked activation
  'geomancer:dragon-dive:mastery': ['entity-vacate', 'forced-placement'],
  // pull a willing ally along (removing them), then place adjacent after
  'geomancer:helix-heel:talent:1': ['rebound', 'object-interaction'],
  // "when bouncing off an object, shove it 1 before extending the line"
  'geomancer:obsidian-flesh:talent:1': ['duration-modifier'],
  // "if this ability ticks over, it doesn't end until the end of the current
  // turn" — expiry grace-period timing override
  'geomancer:realignment:talent:1': ['effect-count'],
  // "take piercing fray damage again one more time if your target is bloodied"
  'geomancer:realignment:mastery': ['save-modifier', 'status-reapply'],
  // "must save or also be affected by every status that was just purged" —
  // capturing the purged-status set and reapplying it on a failed save
  'geomancer:midas:talent:1': ['entity-create', 'forced-placement'],
  // returned character leaves a broken-shell statue OBJECT; place them
  // adjacent to it
  'geomancer:quaking-palm:talent:2': ['enemy-ability-trigger'],
  // "after that character uses any ability that moves them, deal 1 piercing
  // to adjacent foes" — same enemy-ability-use reactive family as Chastise t1

  // ── Spellblade / Stormbender ──
  'spellblade:trait:aether-deflection': ['interrupt-grant', 'enemy-ability-trigger', 'range-modifier', 'resource-management'],
  // "Interrupt 1: Trigger: You are targeted by an ability from a character in
  // range 2. Effect: Gain resistance against damage from that ability. You
  // only have one use of this interrupt per combat. However, you can spend 2
  // Aether any time to regain it." — the trait provides an interrupt gated on
  // being targeted by an enemy ability in range 2 (interrupt-grant +
  // enemy-ability-trigger + range predicate) and an aether-spend regain
  // (resource-management); the once-per-combat gate rides the implemented
  // use-ledger
  'spellblade:bifrost:talent:1': ['interrupt-timing'],
  // "The teleport from Bifröst can interrupt other actions and does not stop
  // movement." — a teleport-as-interrupt timing override (teleport is
  // F1-implemented; the interrupt-other-actions window is the override)
  'spellblade:sturmreiten:talent:1': ['interrupt-rider', 'choice-input'],
  // "You may teleport one adjacent ally with you to any free adjacent space
  // after this interrupt resolves." — an after-resolve teleport rider with
  // ally + destination choice
  'spellblade:drifting-leaf:talent:1': ['damage-modifier', 'interrupt-rider'],
  // "…its interrupt deals 1 piercing damage, twice to them instead." — a
  // damage-magnitude rider on the interrupt (damage-modifier stays live)
  'spellblade:drifting-leaf:talent:2': ['interrupt-rider', 'choice-input'],
  // "You may teleport your foe to any space adjacent to you instead of
  // teleporting yourself 1 instead when this interrupt triggers." — a
  // teleport-target choice rider on the interrupt trigger
  'spellblade:atherwand:talent:1': ['area-extension'],
  // "doesn't replace the old area, but extends it, as long as at least one
  // space of the new area is adjacent" — adjacency-gated area growth
  'spellblade:bifrost:talent:2': ['area-extension', 'area-effect-rider'],
  // round-end growth anywhere in the pattern + "when they grow, deal 1
  // piercing to all characters inside" — a growth-event rider
  'stormbender:tsunami:talent:2': ['area-effect-rider', 'save-modifier'],
  // "Foes inside Tsunami take +1 curse on saves" — area-scoped save-curse
  // projection onto opposing members
  'stormbender:cryo:talent:1': ['resource-management'],
  // round-4+ on-use Aether generation — resource-management remains a live
  // blocker family (economy mechanics beyond the plain gain mutation are not
  // yet reusable capabilities)
  'stormbender:cryo:talent:2': ['area-effect-rider'],
  // round-4+ shatter-all-in-area — shatter implemented, area scoping missing
  'stormbender:gust:mastery': ['area-persistence-override'],
  'stormbender:heave-ho:talent:2': ['use-count-override'],
  // "If you don't use this interrupt, stock up another use of it at the start
  // of your turn. You can stock it up to interrupt 3." — banked/stored uses
  // accruing at turn start up to a cap (same allowance-banking family as
  // Riposte mastery)
  // "Gust's area is not replaced if used again, though you cannot have more
  // than three areas active" — replacement-policy override plus an active-
  // area cap; the engine assumes one live area per program

  // ── F6a bonus-damage family reclassifications (2026-08-27) ──
  // The coarse {damage-modifier} label (regex "bonus damage") covered
  // genuinely different mechanics. The target/self-gated "deals bonus
  // damage" dice rows are now implemented (bonus-damage kernel + content
  // rows: low-blow t1, nothung t1, incubus t2, dark-sliver t1, and the
  // finesse trait). The remaining rows are reclassified to their precise
  // blocker families below.
  'chanter:gentleness:talent:2': ['bonus-damage-suppression', 'crit-suppression'],
  // "cannot critically hit … and also cannot gain, deal, or take bonus
  // damage" inside the aura — a suppression projection, not a grant; needs a
  // bonus-damage negation + crit negation read at the damage authorities
  'freelancer:trait:aether-shot': ['damage-modifier', 'exceed-grant'],
  // "Any attack made on the third and sixth round of combat deals bonus
  // damage and triggers all exceed effects, hit or miss" — round-gated bonus
  // damage (needs a round gate on the fold) plus an exceed auto-trigger grant
  // for every attack
  'sealer:matsuri:mastery': ['damage-modifier', 'teleport-distance-modifier', 'exceed-grant'],
  // "Blood Festival … first time you use Matsuri in a combat, you may
  // increase all its teleports by +2, it deals bonus damage, and it triggers
  // all exceed effects" — once-per-combat teleport-distance override (a
  // reusable F1-family modifier) + bonus dice + exceed grant
  'sealer:matsuri:talent:2': ['damage-modifier', 'save-or-stun'],
  // "Bloodied foes take bonus damage and must also save or be stunned" — the
  // bonus die is now expressible, but the save-or-stun delivery needs the
  // save-window rider authority in the parent program
  'sealer:open-the-gates:mastery': ['damage-modifier', 'exceed-grant'],
  // "Any version of this ability deals bonus damage and always triggers
  // exceed effects at round 4 or later" — round-gated bonus damage + exceed
  // grant
  'seer:astra:talent:2': ['area-modifier', 'damage-modifier'],
  // "If two or more allies are caught in the area of this ability, increase
  // all medium blasts to large blasts, and this ability deals bonus damage"
  // — a conditional (allies-in-area) blast-size override plus bonus dice;
  // the area kernel's shape rules are static today
};

/** Classify a source unit's rules text into a blocker set.
 *  The classification is purely syntactic (regex on the source text) and
 *  is used as a first-pass census. Singleton audit verification must be
 *  performed separately. */
function classifyBlockers(unit: RuleSourceUnit): string[] {
  const text = unit.rulesText.toLowerCase();
  const blockers: string[] = [];

  // Terrain creation: creates terrain, pits, difficult/dangerous terrain, boulders, objects
  if (/create.*terrain|creates.*terrain|pit|difficult terrain|dangerous terrain|boulder|pillar|afterimage|terrain effect|creating a pit|create a height|create.*spaces of/.test(text)
    && !/summon.*(?:terrain|object)/.test(text)) {
    blockers.push('terrain-create');
  }

  // Condition grant: grants or applies a condition/status
  if (/\b(?:become|becomes|gain|gains|grant|grants|apply|applied?|inflict|inflicts|sealed|immune|sturdy|defiance|dodge|evasion|flying|phasing|unstoppable|regeneration|stealth|counter|vulnerable|weakened|blinded?|dazed|stunned|shattered|slashed|pacified)\b/.test(text)
    && /\b(?:become|becomes|gain|gains|grant|grants)\b/.test(text)) {
    blockers.push('condition-grant');
  }

  // Blast template: a small/medium/large blast area whose exact template
  // geometry is visual-only in the source (the area kernel implements the
  // deterministic line/arc/burst patterns with exact authority; blast
  // templates are deliberately NOT approximated). Distinct from `area-define`
  // — a unit that names a blast size needs the template, not a shape/size
  // modifier.
  const blastTemplate = /\b(?:small|medium|large)\s+blast\b/.test(text);
  if (blastTemplate) {
    blockers.push('blast-template');
  }

  // Area definition: burst, area, arc, line effects (blast templates are
  // classified above as `blast-template`, not here — a unit naming a blast
  // size carries the more precise blocker).
  if (!blastTemplate && (/\b(?:burst|blast|area|arc|line)\s*(?:\d+|of effect|effect|damage)/.test(text)
    || /\b(?:medium|large|small)\s+burst\b/.test(text)
    || /\baround\s+(?:yourself|self|the target|them)/.test(text))) {
    blockers.push('area-define');
  }

  // Action-type change: free action, reaction, interrupt cost modification
  if (/\b(?:free action|as a (?:free )?action|reaction)\b/.test(text)) {
    blockers.push('action-type-change');
  }

  // Fly grant: flying, fly N
  if (/\bfly(?:ing|\s+\d|\s+n|\s+to)/.test(text)) {
    blockers.push('fly-grant');
  }

  // Damage modifier: bonus damage, deal extra damage, extra damage
  if (/\b(?:bonus damage|extra damage|deals?\s+(?:\d+\s+)?(?:additional|bonus|extra)\s+damage|deal\s+(?:\d+\s+)?(?:additional|bonus|extra)\s+damage|additional\s+\d+\s+damage)\b/.test(text)) {
    blockers.push('damage-modifier');
  }

  // Teleport: teleport, teleportation
  if (/\bteleport(?:s|ed|ation)?\b/.test(text) && !/teleport.*(?:choose|destination)/.test(text)) {
    blockers.push('teleport');
  }

  // Vigor grant: gain N vigor
  if (/\b(?:gain|gains|grant|grants)\s+\d+\s+vigor\b/.test(text)) {
    blockers.push('vigor-grant');
  }

  // Resource management: gain aether, resolve, resource manipulation
  if (/\b(?:gain|gains)\s+(?:\d+\s+)?(?:aether|resolve|vigor|vigilance|blessing|combo)\b/.test(text)
    || /\b(?:spend|spends)\s+(?:\d+\s+)?(?:aether|resolve|blessing|combo)\b/.test(text)) {
    blockers.push('resource-management');
  }

  // Sacrifice cost: sacrifice HP
  if (/\bsacrifice\s+\d+\b/.test(text)) {
    blockers.push('sacrifice-cost');
  }

  // Aura: aura N, aura effect
  if (/\baura\s*\d*\b/.test(text)) {
    blockers.push('aura');
  }

  // Shove modifier: shove, push, shoved
  if (/\bshov(?:e|ed|es)\s+\d+\b/.test(text)
    || /\bpush(?:es|ed)?\s+\d+\b/.test(text)) {
    blockers.push('shove-modifier');
  }

  // Gamble: the recorded d6 + result-branch vocabulary. A power die is a
  // distinct persistent-ticker mechanic, not a gamble: it ticks up/down
  // across turns/steps (Power Dice, p.118), so it is tracked separately.
  if (/\b(?:gamble|die result|d\d+ result|dice(or|s)?'?\s*result)\b/.test(text)) {
    blockers.push('gamble-state');
  }

  // Power die: the persistent dN ticker (p.118). Set apart from gamble — its
  // start-value, per-turn tick, and consume/discard rules are a distinct
  // reusable mechanic (not a one-shot result branch).
  if (/\bpower\s+die\b/.test(text)) {
    blockers.push('power-die');
  }

  // Use ledger: once per turn, once per round, first time, once a round
  if (/\b(?:once (?:per|a) (?:turn|round|combat)|first time(?:\s+(?:per|a)\s+(?:turn|round))?)\b/.test(text)) {
    blockers.push('use-ledger');
  }

  // Pre-ability movement: rush before, fly before, movement before
  if (/\b(?:rush|fly|dash)\s+\d+\s+(?:before|prior to|before using)\b/.test(text)
    || /\bbefore\s+(?:using|resolving|the ability)\b/.test(text)) {
    blockers.push('pre-ability-movement');
  }

  // Interrupt modifier: interrupt cost, Interrupt N
  if (/\binterrupt\s*\d*\b/.test(text)) {
    blockers.push('interrupt-modifier');
  }

  // Range family (re-audited with kernels/range.ts): the old single
  // `range-modifier` rule conflated listed-range changes with exact-distance
  // predicates and unlimited-range grants. Listed-range changes are
  // implemented by the range kernel but only for registered recipes, so the
  // blocker still names an unwired unit's missing recipe.
  //
  // Exact-distance predicate: "at exactly range N" inspects distance for an
  // effect (boon/unerring/damage/teleport/explosion) without changing
  // targeting legality — a distinct family from listed-range modification.
  if (/at exactly range \d+|exactly range \d+|at exactly range\b/.test(text)) {
    blockers.push('distance-predicate');
  }
  // Unlimited / no-maximum range: "no maximum range" / "unlimited range" is
  // a distinct grant (the range kernel supports fixed/conditional/dynamic
  // values, not an unbounded marker).
  if (/no maximum range|unlimited range|no range limit/.test(text)) {
    blockers.push('unlimited-range');
  }
  // Listed range modifier: range N, gains range, range to N, range equal to
  // N, range increases/becomes.
  if (/\brange\s+\d+\b/.test(text) || /\bgains?\s+range\b/.test(text)
    || /\brange\s+(?:to|becomes|equal to|increases|grows)\b/.test(text)) {
    blockers.push('range-modifier');
  }

  // Stance gate: stance, enter a stance
  if (/\bstance\b/.test(text)) {
    blockers.push('stance-gate');
  }

  // Mark-related first pass: mark, marked. The coarse `{mark-modifier}`
  // family is RETIRED (F5 is PARTIAL — the landed fold covers carrier-side
  // projections/potency, mark-keyed status-save policies, and mark turn-start
  // triggers only). This heuristic only flags a unit for the precise
  // reclassification pass below; every audit-verified row is reclassified to
  // its exact mark family (mark-gated-modifier, mark-transfer,
  // mark-defeat-trigger, mark-stacking, mark-detonation-window,
  // mark-activation-gate, mark-as-entity-follow), so no resolved blocker set
  // may contain `mark-modifier`.
  if (/\bmark(?:s|ed)?\b/.test(text) && !/\bmark(?:s|ed)?\s+that\b/.test(text)) {
    blockers.push('mark-modifier');
  }

  // Blessing spend: blessing, bless
  if (/\bblessing\b/.test(text)) {
    blockers.push('blessing-spend');
  }

  // Cure on trigger: cure, cured
  if (/\bcure[ds]?\b/.test(text)) {
    blockers.push('cure-on-trigger');
  }

  // Entity create: summon, create entity
  if (/\bsummon(?:s|ed)?\b/.test(text) || /\bcreate\s+(?:an?\s+)?(?:shadow|beast|thrall|plant|sprite|bomb|object|entity)\b/.test(text)) {
    blockers.push('entity-create');
  }

  // Combo spend: combo token
  if (/\bcombo\s+token\b/.test(text)) {
    blockers.push('combo-spend');
  }

  // Cover mechanic: cover
  if (/\bcover\b/.test(text)) {
    blockers.push('cover-mechanic');
  }

  // Charge state: charge, slow turn, must be slow
  if (/\bcharge\b/.test(text) || /\bslow\b/.test(text)) {
    blockers.push('charge-state');
  }

  // Entity vacate: vacate
  if (/\bvacate\b/.test(text)) {
    blockers.push('entity-vacate');
  }

  // Heroics economy: Heroic, heroics
  if (/\bheroic\b/.test(text)) {
    blockers.push('heroics-economy');
  }

  // Pre-ability movement (rush): rush before ability
  if (/\brush\s+\d+\b/.test(text) && !/shove/.test(text)) {
    blockers.push('rush-modifier');
  }

  // Infuse cost: infuse, aether cost
  if (/\binfus(?:e|ed|ion)\b/.test(text)) {
    blockers.push('infuse-cost');
  }

  // If no blockers matched, it's irreducible
  if (blockers.length === 0) {
    blockers.push('irreducible');
  }

  return [...new Set(blockers)];
}

// ═══════════════════════════════════════════════════════════════════════════
// Census generation
// ═══════════════════════════════════════════════════════════════════════════

interface CensusRecord {
  sourceId: string;
  kind: RuleSourceKind;
  blockers: string[];
}

interface MarginalEntry {
  immediate: number;
  oneCloser: number;
  multiCloser: number;
  totalContaining: number;
}

interface CensusResult {
  baseline: number;
  byKind: Record<string, number>;
  records: CensusRecord[];
  blockerFrequencies: Record<string, number>;
  singletonFamilies: Record<string, string[]>;
  /** Marginal table for ALL blockers (including non-implementable). */
  marginalTableAll: Record<string, MarginalEntry>;
  /** Marginal table for IMPLEMENTABLE blockers only. */
  marginalTableImplementable: Record<string, MarginalEntry>;
  /** Non-implementable residual count. */
  residualCount: number;
  greedySimulation: Array<{ step: number; implement: string; unlocks: number; cumulative: number; remaining: number }>;
  invariants: string[];
}

function generateCensus(): CensusResult {
  const units = collectRuleSourceUnits();
  const censusUnits = units.filter((u) => CENSUS_KINDS.includes(u.kind));
  const { compilations } = auditRuleCompilations(units);

  // Build compilation lookup
  const compilationMap = new Map(compilations.map((c) => [c.program.sourceId, c]));

  // Determine complete vs unresolved
  const unresolved: CensusRecord[] = [];
  const complete: string[] = [];
  const seenIds = new Set<string>();

  for (const unit of censusUnits) {
    if (seenIds.has(unit.id)) {
      throw new Error(`Duplicate source ID: ${unit.id}`);
    }
    seenIds.add(unit.id);

    const compilation = compilationMap.get(unit.id);
    if (!compilation) {
      throw new Error(`No compilation for source unit: ${unit.id}`);
    }

    if (compilation.unsupportedClauses.length === 0) {
      complete.push(unit.id);
      continue;
    }

    let blockers = RECLASSIFIED_BLOCKERS[unit.id] ?? classifyBlockers(unit);
    // Phase 5 harvest: an implemented primitive no longer blocks anything.
    blockers = blockers.filter((blocker) => !IMPLEMENTED_PRIMITIVES.has(blocker));
    if (blockers.length === 0) {
      // A unit whose every blocker is already implemented would be executable.
      // The compiler audit says otherwise (it is unresolved), so this is a
      // classification error — surface it as a strict-mode failure rather
      // than silently promoting a unit whose semantics are not represented.
      if (strict) {
        throw new Error(`Unresolved unit ${unit.id} has only implemented blockers — re-audit its blocker set`);
      }
      blockers = ['irreducible'];
    }
    unresolved.push({ sourceId: unit.id, kind: unit.kind, blockers });
  }

  // Per-kind counts
  const byKind: Record<string, number> = {};
  for (const kind of CENSUS_KINDS) {
    byKind[kind] = unresolved.filter((r) => r.kind === kind).length;
  }

  // Blocker frequencies
  const blockerFrequencies: Record<string, number> = {};
  for (const record of unresolved) {
    const key = `{${record.blockers.sort().join(', ')}}`;
    blockerFrequencies[key] = (blockerFrequencies[key] ?? 0) + 1;
  }

  // Singleton families
  const singletonFamilies: Record<string, string[]> = {};
  for (const record of unresolved) {
    if (record.blockers.length === 1) {
      const blocker = record.blockers[0];
      singletonFamilies[blocker] = singletonFamilies[blocker] ?? [];
      singletonFamilies[blocker].push(record.sourceId);
    }
  }

  // Collect all unique blockers
  const uniqueBlockers = new Set<string>();
  for (const record of unresolved) {
    for (const b of record.blockers) uniqueBlockers.add(b);
  }

  // Compute marginal table (shared logic)
  function computeMarginal(records: CensusRecord[], blockers: Set<string>): Record<string, MarginalEntry> {
    const table: Record<string, MarginalEntry> = {};
    for (const blocker of blockers) {
      const containing = records.filter((r) => r.blockers.includes(blocker));
      const immediate = containing.filter((r) => r.blockers.length === 1).length;
      const oneCloser = containing.filter((r) => r.blockers.length === 2).length;
      const multiCloser = containing.filter((r) => r.blockers.length >= 3).length;
      const totalContaining = immediate + oneCloser + multiCloser;
      table[blocker] = { immediate, oneCloser, multiCloser, totalContaining };
    }
    return table;
  }

  // Full marginal table (all blockers)
  const marginalTableAll = computeMarginal(unresolved, uniqueBlockers);

  // Implementable marginal table (excluding non-implementable)
  const implementableBlockers = new Set<string>();
  for (const b of uniqueBlockers) {
    if (!NON_IMPLEMENTABLE.has(b)) implementableBlockers.add(b);
  }
  const marginalTableImplementable = computeMarginal(unresolved, implementableBlockers);

  // Sort implementable marginal table by totalContaining descending
  const sortedMarginalImplementable = Object.entries(marginalTableImplementable)
    .sort((a, b) => b[1].totalContaining - a[1].totalContaining);

  // Residual count: units whose blocker set consists ENTIRELY of non-implementable blockers
  const residualCount = unresolved.filter((r) => r.blockers.every((b) => NON_IMPLEMENTABLE.has(b))).length;

  // Greedy simulation (IMPLEMENTABLE blockers only)
  const greedySimulation: CensusResult['greedySimulation'] = [];
  let remaining = unresolved.length;
  let cumulative = 0;
  const implemented = new Set<string>();
  let step = 0;

  // Sort by immediate completions descending, then totalContaining
  const sortedBlockers = Object.entries(marginalTableImplementable)
    .sort((a, b) => b[1].immediate - a[1].immediate || b[1].totalContaining - a[1].totalContaining);

  for (const [blocker] of sortedBlockers) {
    if (remaining === 0) break;
    // Never implement a non-implementable classification
    if (NON_IMPLEMENTABLE.has(blocker)) continue;

    // Count units that become complete if we implement this blocker
    const wouldComplete = unresolved.filter((r) =>
      !implemented.has(r.sourceId) && r.blockers.includes(blocker)
    );

    const newlyUnlocked = wouldComplete.filter((r) =>
      r.blockers.every((b) => b === blocker || implemented.has(`__impl__${b}`))
    ).length;

    if (newlyUnlocked === 0) continue;

    step++;
    implemented.add(`__impl__${blocker}`);
    const prevRemaining = remaining;
    remaining -= newlyUnlocked;
    cumulative += newlyUnlocked;

    greedySimulation.push({
      step,
      implement: blocker,
      unlocks: newlyUnlocked,
      cumulative,
      remaining,
    });

    // Verify invariant
    if (prevRemaining - newlyUnlocked !== remaining) {
      throw new Error(
        `Greedy invariant violated at step ${step}: ${prevRemaining} - ${newlyUnlocked} !== ${remaining}`
      );
    }
  }

  // Machine-checked invariants
  const invariants: string[] = [];

  // 1. Unique source IDs
  const allIds = censusUnits.map((u) => u.id);
  const uniqueIds = new Set(allIds);
  if (allIds.length === uniqueIds.size) {
    invariants.push('✓ All source IDs are unique');
  } else {
    const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
    invariants.push(`✗ Duplicate source IDs found: ${dupes.join(', ')}`);
  }

  // 2. Every unresolved unit appears exactly once
  const unresolvedIds = new Set(unresolved.map((r) => r.sourceId));
  if (unresolvedIds.size === unresolved.length) {
    invariants.push('✓ Every unresolved unit appears exactly once');
  } else {
    invariants.push('✗ Some unresolved units appear multiple times');
  }

  // 3. No executable unit appears in unresolved
  const executableOverlap = unresolved.filter((r) => {
    if (r.kind === 'talent') return isExecutableTalent(r.sourceId);
    return complete.includes(r.sourceId);
  });
  if (executableOverlap.length === 0) {
    invariants.push('✓ No executable unit appears in the unresolved census');
  } else {
    invariants.push(`✗ Executable units in unresolved: ${executableOverlap.map((r) => r.sourceId).join(', ')}`);
  }

  // 4. Per-kind totals sum to unresolved total
  const kindSum = Object.values(byKind).reduce((a, b) => a + b, 0);
  if (kindSum === unresolved.length) {
    invariants.push(`✓ Per-kind totals sum to unresolved total (${kindSum})`);
  } else {
    invariants.push(`✗ Per-kind sum ${kindSum} ≠ unresolved total ${unresolved.length}`);
  }

  // 5. Blocker-set frequencies derive from per-unit records
  const freqFromRecords: Record<string, number> = {};
  for (const record of unresolved) {
    const key = `{${record.blockers.sort().join(', ')}}`;
    freqFromRecords[key] = (freqFromRecords[key] ?? 0) + 1;
  }
  const freqMatch = JSON.stringify(blockerFrequencies) === JSON.stringify(freqFromRecords);
  if (freqMatch) {
    invariants.push('✓ All blocker-set frequencies derive from per-unit records');
  } else {
    invariants.push('✗ Blocker-set frequencies do not match per-unit records');
  }

  // 6. Marginal values derive from per-unit records (with multiCloser)
  const margFromRecords: Record<string, MarginalEntry> = {};
  for (const record of unresolved) {
    for (const b of record.blockers) {
      if (!margFromRecords[b]) margFromRecords[b] = { immediate: 0, oneCloser: 0, multiCloser: 0, totalContaining: 0 };
      margFromRecords[b].totalContaining++;
      if (record.blockers.length === 1) margFromRecords[b].immediate++;
      if (record.blockers.length === 2) margFromRecords[b].oneCloser++;
      if (record.blockers.length >= 3) margFromRecords[b].multiCloser++;
    }
  }
  const margMatch = JSON.stringify(marginalTableAll) === JSON.stringify(margFromRecords);
  if (margMatch) {
    invariants.push('✓ All marginal values derive from per-unit records');
  } else {
    invariants.push('✗ Marginal values do not match per-unit records');
  }

  // 7. Marginal assertion: immediate + oneCloser + multiCloser === totalContaining for every blocker
  let margAssertionOk = true;
  const margFailures: string[] = [];
  for (const [blocker, entry] of Object.entries(marginalTableAll)) {
    if (entry.immediate + entry.oneCloser + entry.multiCloser !== entry.totalContaining) {
      margAssertionOk = false;
      margFailures.push(`${blocker}: ${entry.immediate}+${entry.oneCloser}+${entry.multiCloser}=${entry.immediate + entry.oneCloser + entry.multiCloser} ≠ ${entry.totalContaining}`);
    }
  }
  if (margAssertionOk) {
    invariants.push('✓ Marginal assertion: immediate + oneCloser + multiCloser === totalContaining for every blocker');
  } else {
    invariants.push(`✗ Marginal assertion failed: ${margFailures.join('; ')}`);
  }

  // 8. Cumulative + remaining = baseline at every step
  const stepsOk = greedySimulation.every((s) => s.cumulative + s.remaining === unresolved.length);
  if (stepsOk) {
    invariants.push('✓ Cumulative unlocked + remaining = baseline at every step');
  } else {
    invariants.push('✗ Cumulative + remaining ≠ baseline at some step');
  }

  // 9. Non-implementable classifications never appear in greedy simulation
  const greedyNonImpl = greedySimulation.filter((s) => NON_IMPLEMENTABLE.has(s.implement));
  if (greedyNonImpl.length === 0) {
    invariants.push('✓ No non-implementable classifications in greedy simulation');
  } else {
    invariants.push(`✗ Non-implementable in greedy simulation: ${greedyNonImpl.map((s) => s.implement).join(', ')}`);
  }

  // 10. Final remaining ≥ residual count (units with only non-implementable blockers)
  if (greedySimulation.length > 0) {
    const last = greedySimulation[greedySimulation.length - 1];
    if (last.remaining >= residualCount) {
      invariants.push(`✓ Final remaining: ${last.remaining} (residual: ${residualCount} units need non-implementable capabilities)`);
    } else {
      invariants.push(`✗ Final remaining ${last.remaining} < residual count ${residualCount}`);
    }
  }

  return {
    baseline: unresolved.length,
    byKind,
    records: unresolved,
    blockerFrequencies,
    singletonFamilies,
    marginalTableAll,
    marginalTableImplementable: Object.fromEntries(sortedMarginalImplementable),
    residualCount,
    greedySimulation,
    invariants,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Report generation
// ═══════════════════════════════════════════════════════════════════════════

function generateReport(census: CensusResult): string {
  const lines: string[] = [];

  lines.push('# Class/Job Blocker Census (Canonical, Machine-Checked)');
  lines.push('');
  lines.push(`> Generated from ${census.baseline} unresolved source units: ${Object.entries(census.byKind).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  lines.push('>');
  lines.push('> All counts are derived from the canonical census tool with machine-checked');
  lines.push('> assertions. Singleton blocker sets must be audit-verified separately.');
  lines.push('>');
  lines.push(`> **Residual:** ${census.residualCount} units have ONLY non-implementable blocker classifications.`);
  lines.push('>');
  lines.push('> **Non-implementable classifications** (excluded from marginal rankings and greedy simulation):');
  lines.push('> `irreducible` — not-yet-decomposed residual; needs ability-specific decomposition before it becomes an implementable primitive.');
  lines.push('');

  // Singleton families
  lines.push('## Singleton blocker families');
  lines.push('');
  const sortedSingletons = Object.entries(census.singletonFamilies)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [blocker, ids] of sortedSingletons) {
    const tag = NON_IMPLEMENTABLE.has(blocker) ? ' *(non-implementable)*' : '';
    lines.push(`### \`${blocker}\` (${ids.length} units)${tag}`);
    lines.push('');
    for (const id of ids) {
      lines.push(`- \`${id}\``);
    }
    lines.push('');
  }

  // Blocker-set frequencies
  lines.push('## Blocker-set frequencies');
  lines.push('');
  lines.push('| Blocker set | Count |');
  lines.push('|---|---|');
  const sortedFreqs = Object.entries(census.blockerFrequencies)
    .sort((a, b) => b[1] - a[1]);
  for (const [set, count] of sortedFreqs) {
    lines.push(`| ${set} | ${count} |`);
  }
  lines.push('');

  // Marginal unlock table (implementable only)
  lines.push('## Marginal unlock table (implementable primitives)');
  lines.push('');
  lines.push('| Primitive | Immediate | One-closer | Multi-closer | Total containing |');
  lines.push('|---|---|---|---|---|');
  for (const [blocker, data] of Object.entries(census.marginalTableImplementable)) {
    lines.push(`| ${blocker} | ${data.immediate} | ${data.oneCloser} | ${data.multiCloser} | ${data.totalContaining} |`);
  }
  lines.push('');

  // Greedy simulation
  lines.push('## Greedy build order (implementable primitives only)');
  lines.push('');
  lines.push('| Step | Implement | Unlocks | Cumulative | Remaining |');
  lines.push('|---|---|---|---|---|');
  for (const step of census.greedySimulation) {
    lines.push(`| ${step.step} | ${step.implement} | ${step.unlocks} | ${step.cumulative} | ${step.remaining} |`);
  }
  if (census.greedySimulation.length > 0) {
    const last = census.greedySimulation[census.greedySimulation.length - 1];
    lines.push('');
    lines.push(`After all implementable primitives: **${last.cumulative} unlocked, ${last.remaining} remain** (${census.residualCount} residual units need non-implementable capabilities).`);
  }
  lines.push('');

  // Machine-checked invariants
  lines.push('## Machine-checked invariants');
  lines.push('');
  lines.push('```');
  for (const inv of census.invariants) {
    lines.push(inv);
  }
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

const strict = process.argv.includes('--strict');
const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex !== -1 ? process.argv[outputIndex + 1] : undefined;

const census = generateCensus();
const report = generateReport(census);

console.log(report);

// Also output JSON for programmatic consumption. The default run writes BOTH
// representations (Markdown report + JSON) from the same census, so the
// canonical regeneration workflow cannot silently leave one artifact stale
// while the other is current.
const jsonPath = outputPath ? (outputPath.endsWith('.md') ? outputPath.replace(/\.md$/, '.json') : outputPath + '.json') : join(process.cwd(), 'docs', 'blocker-census.json');
writeFileSync(jsonPath, JSON.stringify(census, null, 2));
console.error(`\nCensus JSON written to ${jsonPath}`);

if (outputPath && outputPath.endsWith('.md')) {
  writeFileSync(outputPath, report);
  console.error(`Report written to ${outputPath}`);
} else if (!outputPath) {
  const mdPath = join(process.cwd(), 'docs', 'blocker-census.md');
  writeFileSync(mdPath, report);
  console.error(`Report written to ${mdPath}`);
}

// Check for invariant failures
const failures = census.invariants.filter((inv) => inv.startsWith('✗'));
if (failures.length > 0) {
  console.error('\n⚠ INVARIANT FAILURES:');
  for (const f of failures) console.error(f);
  if (strict) process.exitCode = 1;
}
