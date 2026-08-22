# Rules automation coverage

The ICON 1.5 source artifact is content-complete: all 501 PDF pages are stored, credited, searchable, and indexed into 75 sections. Structured content and executable rules are separate gates.

| Area | Structured | Executable | Current scope |
| --- | --- | --- | --- |
| Character creation | Yes | Yes | Kin, Culture, Bond, action dots, Job, starting powers, and abilities |
| Advancement | Yes | Partial | Levels, chapter boundaries, XP/AP, Job slots, talents, masteries, narrative choices, and Relic slots validate; Refocus (p.113) and Relic infusion/aspect transitions (p.245) now run as dedicated validated engine functions with tests |
| Bonds | Yes | Partial | 12 Bonds, 36 ideals, 120 powers, Effort/Strain, Second Wind, special features, and kits; free-form narrative power outcomes remain table-facing |
| Jobs | Yes | Partial | 16 Jobs and 144 abilities with chapter, cost, range, tags, rules text, talents, masteries, traits, and Limit Breaks; the nine Bastion abilities (p.122–124), the nine Demon Slayer abilities (p.128–130), the nine Colossus abilities (p.133–138), the nine Knave abilities (p.139–144), the nine Fool abilities (p.150–152), the nine Freelancer abilities (p.153–158), the nine Shade abilities (p.159–164), the nine Warden abilities (p.165–171), and the nine Chanter abilities (p.174–181) are independently executable with typed programs, resolvers, and golden fixtures, and every other Job ability remains source-visible and reducer-blocked until it has an independently reviewed resolver and replay fixture |
| Relics | Yes | No | 40 Relics with ranks I–III, aspects, and quests; invokes and persistent effects are not automated |
| Core combat | Yes | Partial | Movement, overlapping terrain, pits, objects, Skirmisher/Flying/Phasing/Immobile movement, Rampart (dash/fly/teleport blocking with Slip/Unstoppable ignoring it), Counter retaliation, Hatred-of-X half damage with defeat clearing, Stealth adjacency targeting and break-on-use, Vigilance guard/punish spends, state-derived Charge/Comeback/Finishing Blow/Exceed/Collide/Slay triggers, cross-character effect ordering (non-turn before turn, hostile before beneficial), Chain Reaction aether, Bloodied/Regeneration, line of sight, basic attacks, damage order, saves, core statuses, wounds, rescue, recovery, turns, events, migration, and replay; areas, summons, marks, stances, and full traits remain incomplete |
| Foes | Yes | Partial | Six source roles and 449 jobs, variants, uniques, elites, legends, components, and special entries with 1,365 abilities; standard profile construction works, but mobs and foe abilities are not executable |
| Trophies and camp fixtures | Yes | No | 20 general trophies, 16 fixtures, and 87 fixture features are typed and source-linked; their effects are not automated |
| Multiplayer transport | Yes | Engineering preview | Validated commands, authentication, permissions, revisions, persistence, reconnect, and Discord activity exist, but remain behind the rules gates |

`PHASE_TWO_READY` remains false while any gameplay-required row is partial or reference-only. Production builds therefore show the gate instead of the sandbox. The engineering sandbox is available only from a local Vite development/test server.

## Measured source-to-program coverage

`npm run audit:automation` is the machine-readable coverage report. It does not treat structured catalogs, a generic passive resolver, or reducer-only behavior as an independently executable `RuleProgram`.

For the checked-in ICON 1.5 artifact, the report is deliberately conservative:

| Measure | Count |
| --- | ---: |
| Traceable source programs | 3,275 |
| Traceable source clauses | 4,866 |
| Generic RulePrograms with no unresolved clause | 185 |
| Generic RuleProgram clauses with no unresolved text | 1,242 |
| Explicitly unresolved clauses | 3,624 |

Reducer-backed core mechanics are tested separately, but are not counted as generic VM coverage until their full typed `RuleProgram` semantics exist; any core rule without a documented reducer path remains explicitly unresolved. A compiler result with no unresolved clause is also **not** an authority permit: live `EXECUTE_RULE` accepts only the explicit independently reviewed allowlist in `automation/manual-programs.ts` (currently Skirmisher plus the nine Bastion, nine Demon Slayer, nine Colossus, nine Knave, nine Fool, nine Freelancer, nine Shade, nine Warden, and nine Chanter ability programs). This prevents a heuristic parser result from silently becoming a GM-executable foe or ability rule. `npm run audit:automation -- --strict` intentionally fails while any unresolved clause remains; it is a release-completeness gate, not a passing CI threshold for this incomplete rules engine.

An ability becomes executable only when it has:

1. Typed costs, targets, ranges, areas, tags, prerequisites, and usage limits.
2. Declarative effects or a named deterministic resolver.
3. Explicit hit, miss, critical, save, trigger, talent, and mastery behavior where applicable.
4. Source-page golden fixtures and event-replay tests.

## Demon Slayer ability set (ICON p.128–130)

All nine Demon Slayer abilities are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/demon-slayer-programs.ts`, with named deterministic resolvers and source-page golden replay fixtures in `__tests__/demon-slayer.test.ts`. Lines and blasts use the shared deterministic area geometry (`area-geometry.ts`), and the delayed and round-start behaviors resolve through reducer lifecycle hooks:

- **Demon Cutter** (p.128): line-3 true-strike attack with hit/miss/critical branches, slashed target, line-area fray; Charge/Heroic repeats the area effect in a second non-overlapping line.
- **Comet** (p.128): medium blast area damage, a thrown-weapon object with rampart, no attacks while deployed, pickup by entering/exiting/starting a turn adjacent; Charge/Heroic rushes before throwing.
- **Draken Cross** (p.128): two-action small-blast attack plus a second non-overlapping small blast; Charge/Heroic adds true strike and repeats the second blast.
- **Righteous Disdain** (p.128): interrupt that splits determined damage with resistance and grants sturdy to both characters; Heroic grants 4 vigor.
- **Demon Claw** (p.129): two 1-space rushes dealing 2 damage to adjacent foes (all adjacent foes when the user has not attacked); Charge/Heroic weakens all adjacent characters after a rush.
- **Gates of Hell** (p.129): rush 2, vigilance +1 (+2 with Heroic), and counter until the start of the user's next turn; the vigilance rush is a separate action usable once per turn.
- **Soul Blade** (p.129): stance with a d6 power die starting at 2, refresh ticks it up, and the aether slash ticks it down for line-3 true-strike area damage, stance exit at 0.
- **Six Hells Trigram** (p.129): burst-2 (self) terrain effect that ends the turn, activates at the start of the user's next turn to weaken all foes inside (Heroic adds rampart and fray), and forces exiting foes to pass a save.
- **Wicked Sheath** (p.130): true-strike melee attack with fray damage and a shove on hit, a d4 power die that charges at each round start, +1 boon per tick, and die discard after any hit; Charge/Heroic rushes once per charge.

Fidelity notes are preserved on the program itself: the second areas of Demon Cutter/Draken Cross use a deterministic non-overlapping placement, and slow-turn restrictions from delay effects are recorded but not yet enforced by the reducer's action gates (the Charge trigger now fires on a slow turn, but the delayed turn itself still grants full actions). Vigilance charge spends are now fully wired (see the condition pipeline section).

## Bastion ability set (ICON p.122–124)

All nine Bastion abilities are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/bastion-programs.ts`, with named deterministic resolvers and source-page golden replay fixtures in `__tests__/bastion.test.ts`:

- **Heracule** (p.122): true-strike attack with hit/miss/critical branches, weakened, and the repeatable second-foe shove (Collide/Heroic repeats the effect).
- **Battering Ram** (p.122): adjacent shove 2 with directional control; Collide/Heroic slashes the target and refunds the action cost.
- **Land Waster** (p.122): burst 1 (target) area fray damage, away-from-target shoves, then the attack shove; Heroic widens the burst to 2.
- **Valiant** (p.122): two rushes (three with Collide/Heroic), shoving every adjacent character after each rush from the projected layout.
- **Endless Battlement** (p.122): enters the stance, records the chosen ally, grants aura 1 until the start of your next turn, plus the stance-refresh and Heroic Intervention interrupt actions — the interrupt answers a `uses-ability` window that holds a foe ability targeting the armored ally until the interrupt resolves (p.107).
- **Catapult** (p.123): interrupt shove 2 on a completing ally; Collide/Heroic grants 2 vigor and a 1-space rush.
- **Perseus** (p.123): interrupt aura 1 (2 with Heroic) for the triggering ability and the user's immunity to any part of it — the interrupt answers an `area-inclusion` window that holds an allied area effect until the immunity applies (p.107).
- **Rook** (p.123): melee attack, shove 1, and aura 1 until the end of your next turn; Collide slashes.
- **Great Giorgios** (p.124): marks a foe in range 3, ends the turn, and the reducer resolves the delayed rush/shave/damage when that foe's turn ends; Collide/Heroic adds hatred.

Fidelity notes are preserved on the program itself: the VM resolves attack rolls and damage with the dedicated reducer's cover/elevation path, aura zones and delayed end-of-turn effects are stored as typed persistent effects and marks with explicit provenance, and Collide/Heroic triggers fire only when a caller asserts them through `EXECUTE_RULE`.

## Colossus ability set (ICON p.133–138)

All nine Colossus abilities are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/colossus-programs.ts`, with named deterministic resolvers and source-page golden replay fixtures in `__tests__/colossus.test.ts`. Sacrifice, object/terrain creation, and size-2-adjacent shoves reuse the shared area geometry, and the two cross-cutting hooks are reducer lifecycle behavior:

- **Valkyrie** (p.133): fly 1 toward the target, true-strike attack with hit/miss/critical branches, weakened target; Exceed/Heroic creates a pit under the target.
- **Upheaval** (p.133): a height-1 boulder object in free space in range, shoving adjacent characters 1 away; Comeback/Heroic drops difficult terrain under every shoved character.
- **Dropkick** (p.133): fly 1, sacrifice 6, and deal `[D] + fray` to an adjacent foe; Heroic allows a rush 2.
- **Massive Overhead** (p.134): ends the turn and arms the next attack with a keep-highest bonus damage die, a pit under its target after it resolves, and (Comeback/Heroic) a small blast of 2 damage; a target already in a pit activates all exceed effects.
- **Takedown** (p.134): two-action attack that stuns both characters, with an optional sacrifice 4 to avoid the self-stun; Exceed/Heroic adds true strike and a pit.
- **Great Suplex** (p.134): pick up an adjacent foe, sacrifice up to 6, fly half that many spaces, then place the foe in a free adjacent space and deal `[D] + fray`, slashed, and stunned; Heroic sacrifices 0 hp but counts as 6.
- **Gigaton Whip** (p.135): true-strike attack with a shove 2; Collide bounces the foe (remove, fly 1, replace, fray); Exceed/Heroic smashes difficult terrain under the foe and two adjacent spaces.
- **Raging Wolf** (p.135): bloodied-gated tiered Comeback — rush 1 + fray + slashed at bloodied, fly 1 + shove all adjacent at 25% or lower, repeated at 1 hp; Heroic grants unstoppable and damage immunity.
- **Boiling Blood** (p.138): the defy-death interrupt. It arms a `defy-death` persistent effect plus bonus damage; while active, the user cannot be defeated or reduced past 1 hp, and their abilities keep an extra damage die. The effect and its bonus damage end at the end of the user's next turn or when combat ends. The interrupt answers a `defeated` window: a lethal foe blow is held until it resolves, so the character can fight on before the blow lands (p.107).

Fidelity notes are preserved on the program: "Exceed or Heroic" terrain extras fire when the caller asserts the trigger through `EXECUTE_RULE` (matching the Bastion convention), Raging Wolf's tiered effects resolve in listed order from current hp, and Massive Overhead's next-attack enhancement is a reducer hook wired into both the basic-attack and resolver paths.

## Knave ability set (ICON p.139–144)

All nine Knave abilities are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/knave-programs.ts`, with named deterministic resolvers and source-page golden replay fixtures in `__tests__/knave.test.ts`. Combo upgrades are separate actions with a `combo` resource cost, executed through `EXECUTE_RULE` (`actionId: 'combo'`); stance and mark lifecycle behavior resolves through reducer hooks:

- **Low Blow** (p.139): rush 1 toward the target, true-strike attack with hit/miss/critical branches, slashed target, and hatred when the target was already slashed; Slay/Heroic cures the user. Combo (The Hook) adds range 2 and a shove 1 toward the user.
- **Provoke** (p.139): each adjacent foe deals 1 piercing damage back to the user, then 2 damage to all adjacent foes (up to three times); Heroic widens to range 2, Slay shoves the affected foes.
- **Revenge** (p.139): attack, then unstoppable and counter until the end of the user's next turn; Slay/Heroic arms the once-per-turn damage rush. Combo (Indignation) adds true strike, vigilance per foe status (max 3), and counter.
- **Riposte** (p.140): enters the stance and arms the Dire Parry interrupt, which gambles a d6 (spendable vigilance adds dice) and deals that damage to the triggering foe — a 6 also slashes and shoves 1; Heroic grants vigor equal to the gamble.
- **Dark Knight** (p.141): enters the stance, gains sturdy and hatred+ of the closest foe (refreshed at each turn start), and grants vigilance +1 at turn end; Heroic grants 2 vigor per status.
- **Strongarm** (p.141): shoves an adjacent foe in a clockwise or counter-clockwise circle around the user, phasing through characters; each passed-through character takes 2 damage (max 3) and is shoved 1, then the foe is shoved 1. Collide weakens foes; Heroic shoves the foe extra.
- **Intimidate** (p.142): marks a foe at or beyond range 4 (range 2 with Heroic) and ends the turn; starting the next turn adjacent to the marked foe deals fray, stuns, and ends the mark.
- **Sucker Punch** (p.143): an adjacent-foe interrupt that tracks usage (once per round, once per turn). It answers a `save-rolled` window: when a foe's ability makes a save, the reducer holds the save record and its branch effects in the window (costs pay immediately), the interrupt re-rolls the save through the command layer, and the held branch is regenerated from the save effect's AST with the second result — the re-roll keeps the second result, whether it succeeds or fails. On Heroic the re-rolled save is made with +1 curse (recorded on the target and consumed by the re-roll). An unanswered window resolves the original save's branch at the turn boundary. Fixtures in `__tests__/knave.test.ts` (re-roll to failure, re-roll keeping success, Heroic curse, unanswered-window resolution).
- **Bleak Mercy** (p.144): a two-action 2[D]+fray attack that gains true strike and becomes divine (ignoring defiance, armor, and vigor) when the target has three or more statuses; Slay/Heroic cures the user and shoves all foes in range 2. Combo (Sweet Torment) adds aura 1 that stops cures and save clearing until the end of the next turn.

Fidelity notes are preserved on the program: Strongarm's circular traversal defaults to clockwise, and Riposte's "refresh when a foe damages you or an adjacent ally" and Revenge's "rush once per turn when damaged" reactive windows are reducer hooks keyed on damage events rather than explicit caller assertions.

## Fool ability set (ICON p.150–152)

All nine Fool abilities (the first Vagabond job) are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/fool-programs.ts`, with named deterministic resolvers and source-page golden replay fixtures in `__tests__/fool.test.ts`. Bombs are `bomb` entities; their detonation and Gallows Humor's power die resolve through reducer lifecycle hooks:

- **Cavaliere** (p.150): a +1-boon attack that dashes 3 with phasing (stopping only at impassable terrain or the grid edge), steps 1 to the side, and dazes the target; a Finishing Blow or Slay summons a bomb.
- **Carnevale** (p.150): summons two bombs in range 2 and arms the turn-end detonation; ending the turn without attacking gambles once and detonates every owned bomb in a small blast (characters in overlapping blasts are affected once).
- **Spinning Top** (p.150): gambles, then dashes that many +2 spaces in one direction, stopping at the first obstruction; moving the full distance grants evasion until the start of the next turn.
- **Death** (p.150): a line-6 unerring blast that gambles to choose the attack space, autohits for 2[D]+fray, deals fray along the line, and (Finishing Blow/Slay) explodes the target in a large blast; a target at 8 hp or less takes 999 divine damage instead.
- **Gallows Humor** (p.151): enters the stance with a d6 power die starting at 1; the die ticks up on stance refresh (turn start) and whenever you or an ally misses or is missed. At maximum it resets to 1 and grants bonus damage (the slay clause is caller-asserted on the empowered ability).
- **Party Favor** (p.151): throws a mine into a free space in range 3; the `detonate` sub-action (executed through `EXECUTE_RULE` at `movement-end` timing) gambles and resolves a medium blast that flies allies away, deals 2 damage to foes, blinds them on 4+, gives allies stealth on 6, and doubles foe damage on a Finishing Blow.
- **Masquerade** (p.151): an interrupt that swaps places with a willing ally in range 3, teleporting both — it answers a `targeted-by-ability` window that holds an ability aimed at the user and, after the swap, retargets the held effects to the ally (p.107).
- **Diablo** (p.151): a range-3 small-blast +1-boon unerring attack whose attack space is an edge of the cross; it blinds the target and deals 2 damage per character in the cross's end spaces to every foe in the cross.
- **Chronotemper** (p.152): marks yourself or an ally in range 2 with Cheat Time, a gamble-dash interrupt that deals 2 damage to each adjacent foe at most once per turn. The mark grants the interrupt: only the marked character can execute Cheat Time (the reducer gates ownership on the `cheat-time` mark).

Fidelity notes are preserved on the program: Carnevale's optional post-summon dash is left to the normal movement command and its turn-end detonation is taken deterministically; Party Favor's "when a character enters the space" movement trigger is a documented gap (the single-pass VM has no movement-entry hook), matching the prior movement-trigger scoping; and Gallows Humor's empower tracks the die in `ruleState` so the resolver can read it through the generic VM actor view.

## Freelancer ability set (ICON p.153–158)

All nine Freelancer abilities (the second Vagabond job, p.153–158) are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/freelancer-programs.ts` (authored from `job-kit.ts` and `docs/job-template.md`), with named deterministic resolvers and source-page golden replay fixtures in `__tests__/freelancer.test.ts`. The cross-command lifecycles resolve through reducer hooks:

- **Strafe Shot** (p.156): a range-3 +1-boon attack that dashes 1, blinds the target, dashes 1 again, and (Finishing Blow/Exceed) flurries for 2 unerring against every foe at exactly range 3.
- **Exorcism** (p.156): marks a foe with a d4 power die; at the end of any turn where the owner or the marked foe ends in range 3, the die sets to 1 or ticks up and shoots a 2-damage projectile; at maximum the die releases every projectile for 2 damage per charge and ends the mark (Finishing Blow starts the die at 1).
- **Trick Shot** (p.156): arms `trick-shot:armed` for the next ranged attack — the unerring (ignore-cover) part applies when the attack lands and the +1 boon is added by the attack resolvers (both wired); only the rebound bounce to a second target stays table-facing (the single-pass VM has no post-roll bounce window); a Finishing Blow grants stealth.
- **Astral Chain** (p.156): a two-action 2[D]+fray attack that marks the foe; at the start of the user's turn a marked foe in range 3 takes 2 unerring damage (twice at exactly range 3); Finishing Blow/Exceed flies 4.
- **Deus Ex Machina** (p.157): marks a character and grants Divine Intervention, an interrupt that teleports the marked character 1 closer (allies may decline at the table; the direction is deterministic).
- **Ace** (p.157): ends the turn, dashes 1, and enters the stance; the armed next attack triggers every exceed effect, dazes the foe, and gains unerring (the exceed injection and daze resolve in the reducer, the unerring is the ignore-cover flag); the stance refreshes after a finishing blow through a `stance-refresh` sub-action.
- **Showdown** (p.157): marks a foe in range 3 and immobilizes the user until the end of the current turn; at the end of the marked foe's next turn the user dashes 2 (within range 3) or the foe takes 2 unerring twice — four times on a Finishing Blow.
- **Warding Bolts** (p.158): an interrupt that raises a small-blast hover zone; a foe that starts a turn inside and ends it outside takes 2 unerring and is dazed.
- **Soul Shot** (p.158): a Line 3 +1-boon attack that blinds the target and splashes fray along the line (ignoring allies); passing two allies or a Finishing Blow/Exceed detonates a large blast that deals 2 (4 to blinded foes) and blinds.

Fidelity notes are preserved on the program: Trick Shot's rebound bounce is the remaining table-facing part (the +1 boon and ignore-cover unerring are wired), Ace's "unerring" is expressed as ignore-cover damage rather than a roll replacement, and Deus Ex Machina's teleport direction is deterministic (allies' right to decline is table-facing).

## Shade ability set (ICON p.159–164)

All nine Shade abilities (the third Vagabond job, p.159–164) are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/shade-programs.ts` (authored from `job-kit.ts` and `docs/job-template.md`), with named deterministic resolvers and source-page golden replay fixtures in `__tests__/shade.test.ts`. Shadows are `shadow` entities; Assassinate's delayed shot, Incubus's adjacency detonation, and Umbral Echo's turn-end refresh resolve through reducer hooks:

- **Umbra** (p.162): a range-3 +1-boon attack that teleports up to 3 toward the target and blinds the foe; a Finishing Blow summons a shadow adjacent to the target. Combo (Penumbra) teleports the foe up to 3 toward you instead — the foe can save to avoid the teleport, and blinded foes fail the save automatically (the save is rolled and recorded).
- **Harrow** (p.162): marks a character in range 3; a Finishing Blow immediately teleports the marked character 1 toward you and deals 2 if they are a foe (the once-a-round teleport trigger is a documented reactive window).
- **Death Blossom** (p.162): a two-action unerring burst-1 attack (2[D]+fray / fray) that splashes fray to every other foe in the burst; a Finishing Blow drops a pit under the target. Combo (Flying Sleeves) widens the splash to range 4.
- **Nightmare** (p.162): summons 2 shadows in range 2 and raises the aura (the consume-a-shadow evasion interrupt is a documented reactive window).
- **Shadow Play** (p.163): swaps two other characters (first in range 2, second in range 3 of the first), granting allies stealth and dazing foes.
- **Umbral Echo** (p.163): enters the stance with a d4 power die starting at 2; the turn-end refresh (no adjacent foes) ticks the die up in the reducer, while the "trigger finishing blow effects then tick down" stance rewrite is documented.
- **Assassinate** (p.163): ends the turn and marks a foe in range 3; at the end of that foe's turn the user teleports adjacent, deals 2 three times (or 2 with an adjacent ally), blinds, and flies 2 away.
- **Nocturne** (p.163): an interrupt that raises a small-blast shadow-cloud terrain effect (lasting until used again).
- **Incubus** (p.164): a +1-boon attack that marks the foe; when a foe ends a turn adjacent to the marked foe, both the marked foe and adjacent foes take 2 damage and are dazed (once per round). Combo (Succubus) deals 3 to every Incubus-marked character and teleports them 2 away.

Fidelity notes are preserved on the program: Harrow's once-a-round teleport trigger, Nightmare's consume-a-shadow evasion, and Umbral Echo's finishing-blow stance rewrite are documented reactive windows (the single-pass VM has no targeting interrupt or per-ability stance rewrite); Death Blossom's pit is a `pit` terrain effect with the shadow-cloud aspect as a tag; and Penumbra's save-to-resist is wired (a foe can save to avoid the teleport, and blinded foes fail automatically).

## Warden ability set (ICON p.165–171)

All nine Warden abilities (the fourth Vagabond job, p.165–171) are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/warden-programs.ts` (authored from `job-kit.ts` and `docs/job-template.md`), with named deterministic resolvers and source-page golden replay fixtures in `__tests__/warden.test.ts`. Beasts are `beast` entities and portals are `underway` entities; Sidhe's toxin, Stampede's spirit beast, Morrigan's delay, Strength of the Pack's refresh, and Underway's second portal resolve through reducer hooks:

- **Apex** (p.169): a range-3 +1-boon attack (hit [D]+fray, miss fray) that dazes the foe and summons a beast adjacent to them; a Finishing Blow or Charge summons a second beast and grants stealth.
- **Gwynt** (p.169): dashes 2 and deals 2 to an adjacent foe; an ally or allied summon in range 3 of the foe also dashes 2 and deals 2 if adjacent; a Finishing Blow or Charge grants both stealth.
- **Circle The Oak** (p.169): a two-action attack (hit 2[D], miss 1) that dashes 2 first and then circles the foe clockwise dealing fray per ally/summon passed (max 4); a Finishing Blow or Charge dashes 5 and shoves the foe 2.
- **Mist Strider** (p.169): creates a small-blast `mist-cloud` terrain effect in range 3 (replacing any prior cloud; foes inside are blinded); Charge creates a second cloud.
- **Stampede** (p.170): marks a foe in range 4; once per round, at the end of that foe's turn, the spirit beast charges for 2 damage, shoves the foe 1, and coalesces into a `beast` summon.
- **Strength Of The Pack** (p.170): enters a two-action aura-2 stance, summoning a beast and dashing the user and allies 1 on entry and at each turn-start refresh.
- **Underway** (p.170): creates a leafy `underway` portal in a free adjacent space; a second portal grows at the end of the user's turn.
- **Morrigan** (p.171): a Delay that ends the turn and makes the next turn slow; at the start of that turn the flock grants allies stealth and shoves foes 2 and blinds them.
- **Sidhe** (p.171): a melee +1-boon attack (hit [D], miss 1) that blinds and injects the toxin; at the end of the foe's next turn the toxin deals 6 (3 adjacent to an ally). A Finishing Blow or Charge shoves the target 2.

Fidelity notes are preserved on the program: Gwynt and Circle the Oak's optional ally dashes take deterministic toward-the-foe directions and the circular traversal counts adjacent allies clockwise; Stampede's line-from-the-edge geometry and side shoves are table-facing; and Mist Strider's consume-a-cloud-at-turn-start and Underway's portal teleport are free-action table-facing effects. Apex's "grant stealth" is honored by breaking stealth before a resolver's effects apply, so the newly granted stealth sticks.

## Chanter ability set (ICON p.174–181)

All nine Chanter abilities (the first Mendicant job, p.174–181) are independently executable end to end: typed costs, targets, ranges, tags, and hand-authored `RuleProgram`s in `automation/chanter-programs.ts` (authored from `job-kit.ts` and `docs/job-template.md`), with named deterministic resolvers and source-page golden replay fixtures in `__tests__/chanter.test.ts`. Blessings are the `blessing` resource, motes are `symphony-mote` terrain effects, and pits are `pit` terrain effects; Aria's delay, Symphony's detonations, Monogatari's tale, Chastise's retribution, and Gentleness's reflection resolve through reducer hooks:

- **Holy** (p.177): pacifies the foe and cures a character in range 2 of them; a Charge grants 3 vigor to the other characters in range 2 of the foe.
- **Holy combo (HADES)** (p.177): a medium blast that autohits fray on the target, deals fray to the other characters in the blast, and opens a pit under the target.
- **Felicity** (p.177): marks an ally in range and blesses them (two blessings on a Charge); the "spend a combo to fly the marked ally" free-action is a documented window.
- **Felicity combo (FLEET)** (p.177): blesses an ally, flies them 4 along the dominant axis toward the nearest foe, and grants 2 vigor per character passed over.
- **Pandaemonium** (p.177): autohits [D]+fray on the target, then deterministically rearranges every character in the medium blast into a different space of the area (a rotation; Charge widens to a large blast and grants allies in the area 4 vigor).
- **Pandaemonium combo (PURGATORIO)** (p.177): autohits [D]+fray, deals fray to every other character in the area, explodes every pit in the area for a medium blast fray, and opens a pit under the target.
- **Aria** (p.178): ends the turn (Delay); at the start of the user's (slow) next turn a blast centered on them resolves — foes take fray twice and are sealed (sealed or pacified foes are shoved 1 away), allies are cured — and taking two foe-ability hits while pending widens it to a large blast.
- **Dervish** (p.178): flies 1 toward the nearest foe and whisks an ally in range into a free space adjacent to where they land (a Charge chooses a second ally).
- **Dervish combo (DAWN)** (p.178): gains aura 1 until the end of the next turn; the +1 boon on saves is a documented save-window effect.
- **Symphony** (p.178): consumes up to four blessings to create non-adjacent pulsing mote spaces; a character that enters or starts a turn on a mote detonates it — a small blast centered on them (foes take fray, allies gain 2 vigor), and a triggering hero is blessed and flies 1 while a triggering foe gets a pit under them.
- **Gentleness** (p.179): enters the aura-1 stance; any character that deals damage while in the aura takes 1 divine damage (reflected directly so it cannot recurse).
- **Monogatari** (p.179): the song is gambled at the end of the user's turn (pre-rolled at the command boundary), and hero characters that complete the tale's action are blessed and may fly 2 at the end of their turn, once per song; tales 1 (Fury) and 6 (Triumph) are documented table-facing windows.
- **Chastise** (p.179): autohits fray, seals the foe, and marks the retribution — if the marked foe damages a chosen character with an ability before the end of its next turn, it takes 1 divine damage three times then; a Charge protects both the user and an ally.
- **Chastise combo (CHARISM)** (p.179): marks a foe; at the end of its next turn allies in a small blast centered on it are cured or blessed (default cure), and a pit opens under it if two or more allies were in the area.

Fidelity notes are preserved on the program: Pandaemonium's rearrangement is a deterministic rotation; the mote creation consumes up to four blessings deterministically; Monogatari's extra d6 gamble takes the higher of two Charge rolls; and Symphony's movement-entry detonation resolves on movement-end and turn-start (the single-pass VM has no movement-entry interrupt).

## Shared resource registry (ICON p.99–105, p.204)

The shared encounter resources are formalized in a single typed registry in `src/rules/core.ts` (`RESOURCE_RULES` / `SHARED_RESOURCE_RULES`). Each entry carries its source page, source-grounded rules text (so the audit traces it as a `resource` core rule), a hard ceiling, and whether it resets at encounter boundaries:

- **Resolve** (p.99): party resolve rises by 1 at the start of each round, depletes to 0 after combat, and pays Limit Break costs as any combination of party + personal resolve (spent at the beginning of the action).
- **Personal resolve** (p.99): all characters gain 1 after every combat and may gift 1 when limit breaking; it survives combat and resets to 0 only after camping.
- **Blessing** (p.102): tokens granted by abilities (Chanter Felicity/Monogatari/Chastise) and spent for powerful effects; the default +1 boon on a save is a save-window effect, and all blessings are discarded at the end of combat.
- **Combo** (p.103): using the base version of a combo ability grants one token; using the combo version discards it. Only one token may be held at once, and tokens are discarded at the end of combat.
- **Vigilance** (p.105): spend a charge to roll d6 and guard an ally or punish a foe; charges are per-encounter.
- **Aether** (p.204, Wright): starts at 0, gains 1 at the start of each of the Wright's turns, is spent on Infuse effects, and is lost after combat. Chain Reaction (p.95, Wright) grants 1 once per round after damaging two or more foes with one ability.
- **Bonus damage** (p.102): an encounter counter — when an ability gains bonus damage, roll one more [D] for each instance and pick the highest result. It resets with the other per-encounter resources.
- **Effort / Strain** (p.56, bonds): narrative character-sheet resources (caps from the active bond, 3/5 by default). Effort is spent to use bond powers and actions and recovered by Second Wind, camping, and interludes; strain is healed at camp and fully at the start of an interlude. Neither is touched by encounter boundaries.

The reducer enforces the registry: `ENCOUNTER_STARTED` and `ENCOUNTER_ENDED` clear every per-encounter resource through `perEncounterCharacterResourceIds` (personal resolve survives), `applyRuleMutation` clamps gains at each resource's registry maximum (Combo's one-token cap), and the combo-gain rule is derived in the `RULE_MUTATIONS_APPLIED` handler from the ability's program (base version of a combo ability, capped at one token; the combo version spends the token and never re-grants). Spend paths validate holdings (`resource.insufficient`, `vigilance.charges`). Source-derived golden fixtures in `__tests__/resources.test.ts` pin the registry shape, combo gain/cap/spend/discard, Aether turn-start and Chain Reaction, Vigilance spend validation, Blessing grant/spend/discard, Bonus-damage reset, and Resolve round/end behavior — each scenario replay-verified through `applyEvents`.

## Combat condition pipeline (ICON p.104–105)

The condition vocabulary shared by abilities and traits is wired into the reducer's damage, movement, targeting, and trigger-derivation paths, with source-derived golden fixtures in `__tests__/conditions.test.ts`:

- **Rampart** — foes cannot enter or exit affected spaces by dashing, flying, or teleporting; standard movement is unaffected. Rampart spaces come from rampart terrain effects and from adjacency to a character projecting rampart (the Fortify trait). **Slip** and **Unstoppable** ignore it.
- **Counter** — when damaged by an ability, deal 2 damage back per applied damage instance. Wired in both the resolver VM path and the basic-attack path; retaliation does not recurse.
- **Hatred of X** — half damage to every foe other than X, full damage against X. The hated target is tracked as `ruleState['hatred-of']` when the status is applied, and hatred ends when X is defeated (or at turn end).
- **Stealth** — cannot be directly targeted except from adjacency (True Strike ignores it), and using an attack ability breaks the user's own stealth.
- **Vigilance** — `SPEND_VIGILANCE` spends a charge to roll d6 and either reduce determined damage to an ally (`guard`) or damage a foe (`punish`). Charges come from Gates of Hell and from Fortify at turn end; rejected spends do not consume.
- **State-derived triggers** — the reducer infers `charge` (slow turn), `comeback` (user bloodied), `finishing-blow` (bloodied target), and `exceed` (attack total 15+) before a resolver runs, so those triggers no longer require the caller to assert them. Heroic and Infuse remain explicit caller choices because they gate a gambit or an aether spend.
- **Reactive Collide/Slay** — `collide` (a shove stopped by an obstruction) and `slay` (a character reduced to 0 HP) are derived after the first mutation pass: `executeRuleProgramWithReactiveTriggers` dry-runs the base mutations on a state clone, then re-resolves only the newly-qualifying trigger steps in an append pass that pays no costs and re-runs no resolver.
- **Trigger ordering** — ICON p.85 and p.107 §4 resolve an ability's effects in source-listing order, so there is no global trigger priority. `orderedSelectedSteps` enforces that simultaneously-derived triggers fire in their listed positions; reactive Collide/Slay activate after the base pass (their listed position, since a collide/slay clause follows the effect that reveals it), deterministically.
- **Cross-character effect ordering** — ICON p.107: when effects resolve at the same boundary, effects that do not belong to the turn character resolve first, then the turn character's, and hostile effects (owned by the turn character's foes) resolve before beneficial ones. `orderCrossCharacterEffects` enforces this as a stable total order (same-owner effects keep their listed order); it drives `expireBoundaryEffects` for turn-start/turn-end and the newly wired round-start/round-end duration expiry.
- **Interrupt order (LIFO)** — ICON p.107: interrupts resolve with the most recently triggered interrupt first (nested), and simultaneous same-trigger interrupts resolve in the same order as turns (turn character's side first, then alternating). `orderInterrupts` is the stable total order (most-recent-triggered first, then turn order, then registration order). Fixtures in `__tests__/interrupts.test.ts` cover the LIFO ordering, the turn-order tiebreak, and the window pop — each replay-verified through `applyEvents`.
- **Held-damage protocol** — ICON p.107: when damage from a foe has been determined but not applied and the target has an available `when-damaged` interrupt (Righteous Disdain, p.128), the reducer holds the final mitigated amount unapplied, opens the window carrying it as `heldDamage`, and resolves the interrupt before the damage applies. A **`defeated` window** extends this to lethal blows when the target has an available defeated interrupt (Boiling Blood, p.138): the blow is held, the interrupt arms defy-death, and the held blow lands clamped to 1 hp. After the interrupt's own mutations, the held damage applies — or at the end of the turn if no interrupt answers the window — unless the interrupt re-dealt damage to the held target (Righteous Disdain's split consumes it). Interrupts that grant immunity or defeat-prevention naturally prevent the re-application (`applyHeldDamage` re-runs the shared `applyDeterminedDamage` pipeline, so defeat, defiance, counter, and the Chastise/Gentleness/Aria hooks fire exactly as they would for an immediate blow).
- **Deferred-effect windows** — ICON p.107: an ability that has not resolved yet is held (its costs pay immediately) and its effects apply after the interrupt — or at the end of the turn if none answers. Three triggers are wired: **`uses-ability`** (p.122 Heroic Intervention — a foe targets the armored ally), **`area-inclusion`** (p.123 Perseus — an allied area effect includes the user, whose immunity applies first), and **`targeted-by-ability`** (p.151 Masquerade — an ability targets the user; the swap redirects the held effects to the ally via the window's `retarget`). All windows close at the turn boundary, where `resolveHeldInterruptWindows` drains the queue (resolving effects can open new windows, e.g. a deferred blow that a `when-damaged` interrupt can still answer).
- **Chain Reaction** — grants 1 Aether once per round when a Wright ability damages at least two foes, tracked per-round via `chain-reaction-used`.
- **Bloodied / Regeneration** — `isBloodied` tracks the after-wounds 50% threshold used by triggers and Comeback; Regeneration restores 4 vigor at turn end while bloodied (not while shattered).

Statuses (Blind, Dazed, Pacified, Sealed, Shattered, Stunned, Weakened, Vulnerable), positive effects (Defiance, Divine, Dodge, Evasion, Flying, Intangible, Immobile, Rampart, Skirmisher, Stealth, Sturdy, True Strike, Unstoppable), and the Piercing/Divine damage types are enforced across the basic-attack path, the resolver VM, and the movement planner; Incapacitated is expressed by the existing `defeated`/rescue model.

Interrupt order (p.107) is formalized separately: interrupts resolve with the most recently triggered interrupt first (LIFO), and simultaneous same-trigger interrupts resolve in turn order; the reducer opens `when-damaged`/`defeated` windows when damage applies and `uses-ability`/`area-inclusion`/`targeted-by-ability` windows when an ability has not resolved yet, pops the most recent window when that character interrupts, and closes all windows at the end of the turn. When the target has an available `when-damaged` interrupt, the window holds the determined damage and the interrupt resolves before it applies — the damage applies after the interrupt (or at the turn boundary) unless the interrupt re-dealt it. The held-damage flow (including the Righteous Disdain split and Boiling Blood's held lethal blow) is pinned in `__tests__/interrupts.test.ts` and `__tests__/colossus.test.ts`; the deferred-effect flows (Heroic Intervention, Perseus, Masquerade) in `__tests__/bastion.test.ts` and `__tests__/fool.test.ts`.

## Table-facing mechanics sweep

Every mechanic in the executable set that still needs a human ruling (or a caller choice) is enumerated — with its source page, what the engine resolves, and the exact ruling — in the typed `TABLE_FACING_MECHANICS` registry in `src/rules/core.ts`, pinned by `__tests__/table-facing.test.ts`. The registry is the audit for "wire or document": an ability is either independently executable or listed here with the decision a player or GM must make. `status: wired` entries have all deterministic parts resolved in the engine (only a genuinely optional sub-effect stays table-facing); `status: documented` entries are table decisions by design:

| Mechanic | Page | Status |
| --- | --- | --- |
| Carnevale — optional post-summon dash | p.150 | documented |
| Party Favor — movement-entry detonation | p.151 | documented |
| Trick Shot — rebound bounce to a second target | p.156 | wired |
| Deus Ex Machina — allies may decline the teleport | p.157 | wired |
| Harrow — once-a-round teleport trigger | p.162 | documented |
| Nightmare — consume a shadow for evasion | p.162 | documented |
| Shadow Play — Finishing Blow repeat | p.163 | documented |
| Umbral Echo — finishing-blow stance rewrite | p.163 | documented |
| Gwynt / Circle the Oak — optional ally dashes | p.169 | documented |
| Mist Strider — consume a cloud at turn start | p.169 | documented |
| Stampede — line-from-the-edge geometry / side shoves | p.170 | documented |
| Underway — portal teleport free action | p.170 | documented |
| Felicity — spend a combo to fly the marked ally | p.177 | documented |
| Dervish — +1 boon on saves in the aura | p.178 | documented |
| Symphony — mote movement-entry detonation | p.178 | documented |
| Monogatari — tales 1 (Fury) and 6 (Triumph) | p.179 | documented |
| Cover — exact edge-touch ambiguity | p.92 | documented |
| Slow turn — turn-order deferral | p.95 | documented |
| Bonds — free-form narrative power outcomes | p.56 | documented |

This sweep also closed four previously documented gaps by wiring them: **Sucker Punch Heroic's +1 curse** is consumed by the re-rolled save (p.144), **Penumbra's save-to-resist** is rolled with blinded foes failing automatically (p.162), **Chronotemper's Cheat Time** is gated on the mark that grants it (p.152), and **Trick Shot's +1 boon** is applied to the armed next attack (p.156).

No VTT path may silently approximate unresolved rules. The generic VM admits only the independently reviewed allowlist, and `USE_ABILITY` refuses every source-only Job ability while exposing its complete source text and page reference to the engineering harness.
