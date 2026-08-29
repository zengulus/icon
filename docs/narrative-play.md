# Narrative Play Roadmap

> **Status:** planning document, not implementation or coverage authority.  
> **Source authority:** *ICON 1.5.pdf*. Page references below are to the sourcebook's printed/page-numbered PDF pages.  
> **Repository baseline reviewed:** `25fd620145fa6abe5be1cf939261eebf97cc326f`.  
> **Phase rule:** this roadmap does **not** override the generic-underlay plan. No narrative source unit should be promoted/wired as executable until the repository's **UNDERLAY PHASE COMPLETE** gate has passed. After that gate, narrative work should reuse the completed generic underlays rather than create narrative-only duplicates of reference, role, choice, query, expression, state, duration, outcome, ledger, or execution semantics.

---

## 1. Goal

Narrative play is ICON's default mode outside tactical combat: exploration, investigation, travel, conversation, downtime, and many kinds of violence all use the narrative rules unless the table deliberately enters tactical combat. The central loop is conversational: the player states what their character is trying to accomplish and chooses an Action; the GM judges **Risk** and **Effect**; dice are rolled only where the outcome is uncertain, difficult, dangerous, or contested. (*ICON 1.5*, pp. 17–19.)

A complete narrative implementation therefore needs more than a character sheet and a dice roller. It needs a shared, authoritative workflow for:

- player intent and Action selection;
- GM adjudication of Risk and Effect before the roll;
- deterministic Action and Fortune rolls;
- Push, Aid, Setup, Team Actions, Tempt Fate, Knacks, Gear, and Bond-power modifiers;
- narrative consequences and Strain;
- breaking, Burdens, and Burden invocation;
- narrative progress/failure/world clocks;
- scene/session/expedition/interlude boundaries;
- Bond features and every Bond Power;
- expedition kits, loose Gear, Dust, XP, Ambitions, and narrative advancement;
- the shared Camp and Camp Fixtures;
- GM-authored narrative combat;
- rituals and projects;
- optional expedition frameworks: Dungeon Crawl, Battle, Intrigue, and Trek;
- GM-only information and public/player projections;
- durable, replayable decisions and rolls in networked play.

The target is not to automate the GM out of narrative play. ICON deliberately leaves Risk, Effect, consequences, fictional positioning, Chapter appropriateness, and many Bond powers to human judgment. The implementation should make those judgments **explicit, fast, source-faithful, durable, and visible to the right people** rather than invent rules to replace them.

---

## 2. Definition of “Narrative Play Complete”

Narrative play can be considered complete only when a GM and players can run an expedition from beginning to end without falling out of the application for any rule-bearing state.

At minimum, the app must support this full loop:

1. Create or load a narrative character.
2. Start a session.
3. Start or resume an expedition with a clear goal, camp allowance, rewards, optional expedition rules, and player kit choices.
4. Enter scenes and resolve ordinary narrative actions.
5. Use Push, Aid, Setup, Team Actions, Tempt Fate, Gear, Bond features, and Bond Powers exactly where legal.
6. Create and advance public or hidden narrative clocks.
7. Apply GM consequences, including Strain.
8. Break characters, create Burdens, invoke Burdens, and recover from broken state at the correct boundary.
9. Run narrative combat without creating pseudo-HP monsters.
10. Camp during an expedition and apply the correct recovery/reset effects.
11. End or abandon the expedition.
12. Enter an Interlude, award expedition/quest rewards, heal Burdens, pursue Ambitions, and use Camp/fixture downtime features.
13. End a session, check XP triggers, and apply narrative advancement at legal times.
14. Launch the next expedition.
15. Persist every authoritative change and recover it after refresh/reconnect without recomputing human choices or dice.

---

## 3. Architectural rules for narrative work

### 3.1 Reuse generic underlays; do not fork the rules engine

After the generic-underlay gate passes, narrative mechanics should be content over shared generic primitives wherever the semantic shape is the same.

Examples:

- **References and roles:** “this character”, “the acting player”, “an ally being aided”, “the GM”, “the owner of a Bond effect”.
- **Choices:** player chooses Action, target, Bond-power mode, setup benefit, Team Action leader, burden actions, etc.; GM chooses consequences, oracle answers, project costs, and some Bond-power outcomes.
- **Queries/eligibility:** “another character”, “nearby”, “a willing character”, “a populated location”, “a character who witnessed this”, only where the source gives an objective query. Do not turn subjective fiction into fake geometry or inferred tags.
- **Expressions/counters/resources:** Effort, Strain, XP, Dust, session-use counters, clock ticks, special Bond counters.
- **Scope/duration:** scene/session/expedition/interlude duration and resets.
- **Outcome/execution:** roll results, selected consequences, clock changes, resource changes, and source-specific follow-up effects.

Do **not** create a second narrative-specific choice engine, use ledger, scope engine, or state machine simply because narrative play has different UI.

### 3.2 Keep narrative progress clocks distinct from generic time/scope clocks

The Book of Tales uses “clock” to mean a segmented progress/failure/world tracker. The generic U8 Clock/Scope vocabulary is temporal/lifecycle infrastructure. These are not the same object.

Use an explicit type/name such as `NarrativeClock` for segmented trackers.

A `NarrativeClock` needs, at minimum:

- stable ID;
- name;
- size/maximum;
- current progress;
- purpose/kind (challenge, failure, project, progress/world, ambition, framework-specific, or custom);
- owner/scope where relevant;
- visibility (`public`, `owner-only`, `gm-only`);
- source/reference where source-defined;
- durable history/reason for each tick/untick;
- completion behavior only where the source defines it.

Do not make “clock reached X” silently mean a duration has expired.

### 3.3 Human adjudication is first-class state

Do not try to infer:

- whether an Action is appropriate;
- Risk;
- Effect;
- Chapter appropriateness;
- whether Gear is useful;
- whether a Knack applies;
- whether a fictional condition such as trust, darkness, class status, “personally significant”, or “outnumbered” is true;
- the concrete consequence of a failed/mixed roll;
- the answer to a Bond power that explicitly asks the GM.

Represent these as **GM/player decisions** carried in the authoritative resolution.

The application may suggest source guidance, but suggestions are never silent authority.

### 3.4 Narrative UI must not expose implementation coverage

Player-facing narrative sheets and creation screens should consume a presentation projection that contains canonical IDs, display/source text, legal relationships, and page references. It must not expose `automation`, executable/structured status, blocker census state, or implementation completeness.

A player selecting a Bond Power is declaring a source character choice, not asking whether that rule currently has a program.

---

# PART I — SHARED NARRATIVE ENGINE

## 4. Scenes, sessions, expeditions, and interludes

Narrative powers frequently key off **scene**, **session**, **camp**, **expedition**, and **interlude** boundaries. These must be explicit authoritative lifecycle events.

### 4.1 Scene lifecycle

**Source:** pp. 34–35.

A scene is a contiguous sequence of events without a narrative cut; a different room/challenge/conversation/place can naturally start a new scene. The source intentionally leaves the boundary naturalistic.

Wire:

- `START_SCENE`
- `END_SCENE`
- GM-visible current scene label/notes
- durable scene ordinal/ID
- per-scene usage reset
- scene-scoped modifiers/effects
- “next scene” effects
- broken-state recovery at scene end where applicable
- event hooks for Bond features that trigger on entering a new scene

The GM should explicitly end/start scenes; the application must not guess from navigation or elapsed time.

### 4.2 Session lifecycle

**Source:** pp. 35, 44; Bond sheets pp. 56–79.

Wire:

- `START_SESSION`
- `END_SESSION`
- per-session Bond Power use ledgers
- per-session Bond features and chosen session targets
- session-end XP checklist
- session-start Bond choices where source-defined
- “rest of session” effects and their reset
- durable record of whether Burdens were invoked this session
- durable record of Ideals fulfilled/ticked
- challenge/test tracking for XP, with GM/player confirmation rather than hidden inference

### 4.3 Expedition lifecycle

**Source:** pp. 39–41; concise refresher pp. 238–239.

An expedition begins when characters leave safety with a clear goal and ends when the goal is accomplished, abandoned, paused, or no longer relevant and they return to safety.

Wire authoritative expedition state:

- expedition ID/name;
- clear goal/question;
- status: planned / active / completed / abandoned;
- selected optional framework(s);
- number of camps permitted and camps remaining;
- base rewards and extra rewards;
- quest membership, if any;
- kit/loadout choices;
- optional framework-specific state;
- GM notes/hidden data;
- public player briefing.

At expedition start:

- establish goal;
- choose optional custom rules;
- GM sets camps;
- choose tactical loadout only if tactical combat is expected;
- reset wounds/HP/Strain/Effort as the source specifies for expedition start;
- choose narrative kit;
- define rewards;
- set out. (*ICON 1.5*, pp. 40–41.)

At abandonment:

- mark expedition abandoned;
- do not silently grant completion rewards;
- preserve/record changed situation if the group later returns. (*ICON 1.5*, p. 41.)

### 4.4 Quests

**Source:** p. 41.

Wire:

- quest ID/name/goal;
- list of constituent expeditions;
- completed expedition count;
- quest status;
- extra quest XP: +1 XP per completed expedition in the quest, up to +6, on quest completion.

A quest spans multiple expeditions and may contain interludes or unrelated expeditions between its parts.

### 4.5 Interlude lifecycle

**Source:** pp. 42–43; refresher p. 239.

At interlude start:

- fully restore narrative Strain and Effort;
- restore tactical HP and Wounds;
- award completed expedition/quest rewards;
- enter downtime state.

During interlude, support:

- Heal Burdens;
- Pursue Ambitions;
- Group Ambitions;
- Camp fixture purchase/upgrades;
- Bond powers/features that modify downtime;
- freeplay;
- legal advancement/spending windows.

At interlude end:

- apply end-of-interlude effects;
- activate Camp upgrades that take effect at end of interlude where specified;
- heal any Strain taken during interlude per source guidance;
- aim toward/launch another expedition.

---

## 5. Narrative Action Roll engine

**Source:** pp. 17–20.

### 5.1 Action intent

The authoritative action workflow should begin with an explicit player intent:

- actor;
- stated goal;
- chosen Action ID;
- optional target/subject text or structured reference where source-relevant;
- optional Gear;
- proposed fictional approach;
- source-specific Bond Power/use;
- optional Push/Aid/Setup/Team Action/Tempt Fate declarations.

The player chooses the Action. The GM may suggest alternatives, but must not silently replace the player's selected Action. (*ICON 1.5*, p. 18.)

### 5.2 GM Risk and Effect

Before the roll, GM sets:

**Risk**
- Controlled
- Risky
- Desperate

**Effect**
- No Effect
- Weak
- Normal
- Powerful
- Superpowered

Default ordinary adjudication is Risky / Normal. (*ICON 1.5*, pp. 18–19.)

The UI should show both values prominently to the player **before they commit the roll**.

Support a structured explanation field such as:

- Chapter mismatch;
- fictional position;
- Gear advantage;
- threat quality;
- darkness/weather/distance;
- setup;
- Bond Power;
- other source-derived reason.

These explanations are presentation/audit aids; they are not a mandatory rules ontology.

### 5.3 Dice pool

Base dice = Action rating.

If final Action dice are 0, roll 2d6 and keep the lowest; a 0-dice roll cannot crit. (*ICON 1.5*, p. 17.)

Narrative bonus/penalty dice:

- Boon: +1d6
- Curse: -1d6
- cancel 1:1
- total additional dice capped at +2 / -2. (*ICON 1.5*, pp. 17, 20.)

Wire modifier provenance so the player and GM can see **why** each die exists:

- Push
- Aid
- Knack
- Setup
- Bond Power
- Camp Fixture
- custom expedition action
- burden penalty
- source-specific modifier
- explicit GM/source adjudication

Do not let the GM arbitrarily edit the character's dice pool as an untyped “GM bonus”; the source states that the GM does not change the number of dice a character rolls. The GM changes Risk/Effect and adjudicates fiction. (*ICON 1.5*, p. 19.)

### 5.4 Action-roll outcomes

**Source:** p. 17.

- 1–3: failure + consequences
- 4–5: success at a cost
- 6: success
- 6,6: critical success + increased Effect

Record:

- exact dice rolled;
- keep rule;
- final result;
- whether critical;
- Risk and Effect that were locked before roll;
- modifier list;
- any source-specific result transformation/reroll;
- final effective result after legal transformations;
- resolution events.

No reroll or result replacement may be regenerated on replay.

### 5.5 Effect advancement

**Source:** pp. 19, 27, 35.

Effect ladder:

`No Effect → Weak → Normal → Powerful → Superpowered`

General effect increases require base Effect of at least Weak. Ordinary increases normally stop at Powerful; Superpowered requires a source that explicitly grants it, or a critical hit from Powerful Effect. (*ICON 1.5*, p. 35.)

Narrative challenge clock progress on a successful action:

- Weak: 1 segment
- Normal: 2
- Powerful: 3
- Superpowered: 5. (*ICON 1.5*, p. 27.)

Do not automatically tick every relevant clock. GM chooses which source/story clock the action actually advances.

---

## 6. Fortune rolls and GM fortune

**Source:** pp. 20–21.

### 6.1 Player Fortune Roll

Use when the task is difficult/unclear but not particularly dangerous and has no obvious consequence.

Outcomes:

- 1–3: poor
- 4–5: expected/average
- 6: good
- 6,6: excellent

Common uses:

- gathering information;
- Recall;
- tests of ability without danger;
- research;
- long-term projects;
- Ambitions.

The GM interprets quality; the app should not fabricate information.

### 6.2 Recall / gather information

Provide a light workflow:

1. player states what they want to know;
2. chooses an Action justified by their approach;
3. roll Fortune;
4. GM enters/reveals information at appropriate quality;
5. any downstream Risk/Effect adjustment is a GM decision.

### 6.3 GM Fortune Roll

The GM may roll 0–4 dice to leave a situation to chance, usually 0–2 dice. This is the only ordinary case where the GM rolls in narrative play. (*ICON 1.5*, p. 21.)

GM Fortune should support:

- GM-only or public roll visibility;
- purpose/question;
- chosen die count;
- exact dice;
- durable result.

---

## 7. Effort, Push, Aid, Setup, and Team Actions

**Source:** pp. 19, 34.

### 7.1 Effort

Effort is a Bond-defined resource.

Wire:

- max Effort from Bond/source modifiers;
- current spent/available boxes;
- exhausted = maxed-out/spent out of Effort;
- camp/interlude full recovery;
- Second Wind recovery;
- Bond-specific Effort modifiers.

### 7.2 Push

Base rule:

- spend 1 Effort;
- gain +1 Boon on an Action roll.

Some Bond powers alter cost, grant free Push, add Effect, add extra conditions, or replace Effort cost with Strain. These need to compose with the generic Push operation rather than duplicate it.

### 7.3 Aid

Base rule:

- spend 1 Effort;
- another character gets +1 Boon;
- aider shares consequences;
- only one Aid benefit may apply to an Action;
- Aid does not stack with Setup on the same Action. (*ICON 1.5*, pp. 19, 34.)

Required authoritative data:

- aider;
- recipient/action intent;
- cost actually paid;
- source modifiers;
- shared-consequence participation.

### 7.4 Setup

A Setup is itself an Action roll with normal consequences and reduced/no Effect on its own; on success it grants the follow-up character +1 Boon **or increased Effect**. (*ICON 1.5*, pp. 19, 35.)

Wire a durable link:

`setup roll → beneficiary → next qualifying action → chosen benefit`

It must not be possible for refresh/reconnect to lose which action the Setup belongs to.

Some Bond Powers improve Setup; those should attach to the same generic Setup event.

### 7.5 Team Action

**Source:** p. 34.

Base Team Action:

- choose leader;
- leader spends 2 Effort;
- leader makes the Action roll;
- outcome/consequences are resolved as if the whole group took the Action;
- other participants do not separately roll.

Wire:

- leader choice;
- participant set;
- Action;
- leader cost;
- Bond-specific leader-cost modifiers;
- consequence group;
- source-specific Team Action bonuses.

---

## 8. Tempt Fate

**Source:** p. 20.

Workflow:

1. before/while assembling a roll, player proposes a specific negative consequence;
2. GM accepts or rejects it as fitting;
3. if accepted, player gains +1 die as if Pushed;
4. proposed consequence becomes true **regardless of roll outcome**.

Persist:

- player proposal;
- GM decision;
- accepted consequence text/structured consequence;
- die modifier;
- mandatory post-roll consequence application.

Do not make Tempt Fate a generic “+1d” button without the durable consequence.

---

## 9. Consequences and complications

**Source:** pp. 28–30.

Every final Action result except a clean 6 normally carries a consequence/complication appropriate to the fiction, with severity keyed to Risk.

Provide a GM consequence composer that can record one or more of:

- put someone in a bad spot / worsen position;
- start a ticking clock;
- tick an existing clock;
- offer a hard choice;
- impose a new obstacle/hindrance;
- make them lose initiative/opportunity/time;
- reduce Effect;
- inflict Strain;
- custom narrative consequence.

The listed moves are guidance, not an exhaustive closed enum. Store custom consequence text alongside structured consequences.

The player must see severe/hard consequences foreshadowed before the roll when appropriate. A useful UI pattern is a pre-roll **“Possible consequence”** field visible next to Risk.

---

## 10. Strain, breaking, and Burdens

**Source:** pp. 29–31.

### 10.1 Strain

Typical Strain consequence by Risk:

- Controlled: 1
- Risky: 2
- Desperate: 4
- Critical Strain: special severe case.

Strain represents narrative physical/mental stress outside tactical combat, not normal HP damage.

### 10.2 Break

A character breaks when:

- they would take Strain while already at maximum, or
- they suffer Critical Strain.

On break:

- character cannot move/act on their own for the current scene;
- they may act by spending 1 Effort first;
- a nearby character may spend that Effort for them;
- clear Strain;
- take a Burden;
- normally recover from broken at end of scene. (*ICON 1.5*, p. 30.)

With three Burdens, a character who breaks remains broken for the rest of the expedition and then must sit out the next expedition, though they can still participate in interlude/Burden healing/Ambitions. (*ICON 1.5*, p. 31.)

This state must be enforced by the narrative action gate rather than left as a note on the sheet.

### 10.3 Burden creation

On taking a Burden:

- player names/describes it;
- choose two Actions currently above 0d;
- each selected Action suffers -1d while Burden exists;
- the same Action may be selected by Burdens up to twice;
- an Action already reduced to 0d by Burdens cannot be selected again. (*ICON 1.5*, pp. 20, 30.)

Burden is represented as a filled healing clock of 4, 6, or 10 segments, later unticked during interludes. (*ICON 1.5*, p. 31.)

Persist:

- Burden ID;
- description;
- clock size/progress;
- two affected Action IDs;
- whether invoked this session.

### 10.4 Invoke Burden

A player may invoke a Burden when making an Action roll to **get into trouble**, including on a successful roll. The GM determines the consequence; if it changes the character's behavior, the GM can state the broad outcome and let the player portray it. (*ICON 1.5*, pp. 30–31.)

Wire:

- player chooses Burden;
- marks session XP trigger;
- GM records consequence/trouble;
- source-specific Bond features that interact with Burden invocation.

---

## 11. Narrative clocks

**Source:** pp. 26–28.

Support at least:

### Challenge clocks
Even-numbered source guidance: 4, 6, 8, 10, or 12 segments.

A successful action can fill segments by Effect:

- Weak 1
- Normal 2
- Powerful 3
- Superpowered 5

Clock completion means the challenge/task represented by that clock is complete; no extra “finisher” roll is required unless a different source-specific framework says otherwise.

### Failure-state clocks
Tick due to failures, complications, consequences, or explicit GM action. Allow a challenge and failure clock to coexist.

### Slow clocks
Advance 1 segment at a time when a larger activity/scene meaningfully progresses.

### Progress/world clocks
Advance due to campaign/world developments rather than direct player success. Source suggests ticking after interludes and using roughly 1/2/3 for little/normal/great progress.

### Project clocks
Longer-term project tracker, including short-session projects and some Camp/Bond mechanics.

### Visibility
Every narrative clock needs selectable visibility:

- public to table;
- selected players/owner if needed;
- GM only.

Hidden clocks must never leak name, size, progress, completion, or existence through player payloads.

---

## 12. Rituals and projects

**Source:** p. 28.

For a session-scale ritual/craft/project:

1. player describes desired goal/function;
2. GM establishes that it can work, possibly with constraints;
3. GM may choose one or more:
   - lesser version;
   - need time/space;
   - additional reagents/materials/supplies;
   - side effects;
   - sacrifice/cost such as Gear or Dust;
   - expert help;
   - Strain;
4. resolve using a narrative clock or Action roll.

Persist the GM-declared requirements so the project cannot change meaning after refresh.

Long-term/permanent projects should usually become Ambitions rather than this short-form project system.

---

## 13. Chapter-aware narrative adjudication

**Source:** pp. 21–26.

Chapter is not just a character-level gate. It sets expected scale for narrative action.

Wire a GM reference/adjudication aid, not an automatic “difficulty calculator”:

- current campaign Chapter;
- requested Action;
- quick source reference for that Action's Chapter I/II/III examples;
- optional GM note for why Effect/Risk changes.

Default source guidance:

- challenges above current Chapter often require multiple steps, help, reduced Effect, or No Effect;
- challenges below current Chapter may not require a roll;
- Superpowered Effect can push beyond ordinary capability, typically not more than one Chapter above, subject to table tone.

Pages for action-by-Chapter reference:

| Action | Source |
| --- | --- |
| Sneak | p. 23 |
| Traverse | p. 23 |
| Sense | pp. 23–24 |
| Study | p. 24 |
| Charm | pp. 24–25 |
| Command | p. 25 |
| Tinker | p. 25 |
| Excel | pp. 25–26 |
| Smash | p. 26 |
| Endure | p. 26 |

Chapter changes are a campaign/group decision and normally occur during an Interlude. (*ICON 1.5*, pp. 22–23, 240.)

---

# PART II — PLAYER SIDE

## 14. Narrative character creation

**Source:** pp. 45–46; advancement summary p. 241.

The dedicated level-0 player creation flow must support:

1. Kin;
2. Culture;
3. Bond;
4. one Bond Power;
5. +2 dots in one of the Bond's two associated Actions;
6. four additional Action dots;
7. no Action above 3 at level 0.

The source gives soft guidance for the four extra dots:

- one based on Culture/background;
- two based on personal qualities;
- one based on life experience. (*ICON 1.5*, p. 46.)

Persist canonical backend IDs, not display strings, for selectable source content.

Player-facing creation should include source page-reference affordances but no implementation/automation status.

### Creation source ranges

- Narrative character creation: pp. 45–46
- Kin: pp. 46, 48–51
- Cultures: pp. 52–54
- Bonds: pp. 55–79

---

## 15. Narrative character sheet

The player sheet needs to make all frequently-used narrative state visible without opening a compendium.

At minimum:

### Identity and source choices
- name/pronouns/portrait;
- Kin;
- Culture;
- Bond;
- level/Chapter.

### Actions
- all ten ratings;
- effective dice after Burden/source modifiers;
- explanation of modifiers;
- one-click start Action flow.

### Bond
- Ideals;
- Effort/max Effort;
- exhausted state;
- Second Wind text/state;
- Special Ability;
- owned Bond Powers;
- session/scene uses;
- chapter-scaled power text where appropriate.

### Harm
- Strain/max Strain;
- broken state;
- Burdens with size/progress/affected Actions;
- Burden-invoked-this-session state.

### Goals
- personal Ambitions: one 4, one 6, one 10 segment slot by default;
- completed/abandoned history if useful;
- group Ambitions link.

### Gear
- selected expedition Bond kit;
- custom kit;
- loose Gear collection;
- two equipped/carried loose-Gear slots by default, subject to Bond/fixture modifiers;
- Gear sharing/transfer.

### Advancement/economy
- XP;
- pending level-up;
- Dust;
- current narrative advancement choices due;
- session XP checklist.

### Source references
Every rules-bearing Bond feature, power, kit, and advancement operation should expose the relevant source page.

---

## 16. Player action composer

A good narrative UI should make the tabletop conversation easier rather than turn it into a form-heavy wizard.

Recommended player flow:

1. **What are you trying to do?** — short intent text.
2. Choose Action.
3. Select optional tools:
   - Push;
   - accepted Aid;
   - Setup benefit;
   - Gear;
   - Knack;
   - Bond Power;
   - Tempt Fate;
   - Team Action.
4. Submit intent to GM.
5. GM sets Risk/Effect and communicates likely consequence.
6. Player sees final pool and stakes.
7. Player commits the roll.
8. Result appears to table.
9. GM resolves Effect/consequence/clocks.
10. Any player follow-up choice occurs in the same durable resolution.

Do not permit a client to locally roll and merely report a number to the authority in networked play.

---

## 17. Player teamwork UI

Provide explicit workflows for:

- offer Aid;
- accept/decline Aid;
- choose whether Setup grants +1D or increased Effect;
- create Team Action;
- nominate/accept leader;
- show shared consequence participants;
- Bond-specific cost changes.

Avoid chat-only bookkeeping for who spent Effort.

---

## 18. Player Interlude UI

**Source:** pp. 42–43.

Each character should get an Interlude workspace with:

### Heal Burdens
- total 3 segments of healing to distribute;
- may forgo own healing to give another character +1 segment;
- each character may be helped only once;
- spend 2 Dust for +1 additional segment;
- Bond/Camp modifiers applied exactly.

### Pursue Ambition
- choose personal 4/6/10 Ambition or eligible group Ambition;
- scene/montage description;
- choose Action;
- Fortune roll;
- progress:
  - 1–3 → 1
  - 4–5 → 2
  - 6 → 3
  - critical → 5;
- 2 Dust → +1 segment;
- source-specific modifiers;
- completion XP:
  - 4 → 1 XP
  - 6 → 2 XP
  - 10 → 3 XP.

Changing/abandoning an Ambition clears the clock. A character only has one personal Ambition of each default length. (*ICON 1.5*, p. 43.)

### Group Ambition
- only worked on once per Interlude;
- participant gives up working on their own Ambition;
- GM controls clock length;
- completion grants 1 XP to the group. (*ICON 1.5*, pp. 42–43.)

---

## 19. Player expedition preparation

**Source:** pp. 40–41; Bond Gear p. 35.

Player-side expedition checklist:

- review expedition goal;
- review selected custom rules;
- see camps available;
- choose one Bond kit, or custom kit where legal;
- choose loose Gear to carry;
- review Camp fixtures;
- answer framework-specific player prompts;
- if tactical combat is expected, separately choose tactical loadout;
- confirm ready.

The app should present the **GM-defined** camp allowance/rewards/rules; players do not silently alter them.

---

## 20. Player Camp UI

**Source:** pp. 40, 253.

When the GM initiates Camp during an active expedition, apply:

- clear/heal all Strain;
- regain all Effort;
- heal HP;
- lose accumulated Resolve;
- other source-specific Camp effects;
- decrement camps remaining.

Do not heal Burdens by default.

Allow Camp-specific actions only where fixtures/powers permit them.

---

# PART III — GM SIDE

## 21. GM narrative table

The GM needs an authoritative table view, not just read-only character sheets.

For each player, show:

- current Action ratings;
- effective Action modifiers;
- Effort/max;
- Strain/max;
- broken state;
- Burdens and affected Actions;
- active Bond-power effects;
- session-use counters where GM needs them;
- kit/Gear;
- Ambitions;
- XP/Dust;
- Chapter.

GM-private details should stay separate from player-visible state.

---

## 22. GM Action adjudication panel

For every submitted Action intent:

### Inputs
- actor;
- stated goal;
- chosen Action;
- proposed modifiers/powers/Gear;
- current Chapter;
- relevant prior Setup/Aid;
- Burden penalties.

### GM decisions
- Risk;
- Effect;
- possible/foreshadowed consequence;
- whether a proposed Knack/Gear fictional benefit applies;
- source-specific GM choice;
- optional note.

### Output
- final player-visible dice pool;
- locked stakes;
- Roll button becomes available to the player.

The GM should have fast access to:

- Risk definitions, pp. 18–19;
- Effect definitions, pp. 18–19;
- consequences, p. 29;
- Chapter scale, pp. 21–26.

---

## 23. GM consequence resolution

After a roll, the GM needs to be able to apply a consequence without editing raw character JSON.

Operations:

- inflict Strain;
- put actor/party in bad position;
- create clock;
- tick/untick clock;
- reduce achieved Effect;
- record hard choice and selected branch;
- create narrative obstacle/fact;
- mark lost opportunity/time;
- custom consequence;
- trigger Break/Burden flow if Strain requires it.

Every mutation should carry:

- source roll/event;
- responsible GM;
- target(s);
- reason;
- before/after or event payload sufficient for replay.

---

## 24. GM clock manager

The GM should be able to:

- create public/hidden clocks;
- choose size;
- choose kind;
- tick/untick manually;
- attach a reason/event;
- reveal a hidden clock;
- complete/retire a clock;
- clone/use a source template;
- see completion history.

Framework-specific clocks should render with their semantics without becoming separate ad hoc storage types.

Examples:

- Intrigue + Tension;
- Trek leg;
- Rescue threat;
- disguise;
- supply-related;
- Battle preparation;
- Caravan wear.

---

## 25. GM narrative combat builder

**Source:** pp. 31–33.

Narrative combat is ordinary narrative play, not a stripped-down tactical encounter.

The GM needs:

- scene goal/stakes;
- one or more challenge clocks;
- optional failure clocks;
- foe/scene **qualities**: typically 2–3 strengths and 1–2 weaknesses;
- notes about fictional vulnerabilities;
- Chapter;
- optional transition button to tactical combat.

Do **not** model narrative foes as tactical actors with HP/action economy unless the table actually enters tactical combat.

Qualities inform GM Risk/Effect adjudication; they are not hidden numerical bonuses.

A narrative combat can end when the scene's objective is resolved even if individual foe clocks remain. The source explicitly warns not to use clocks as HP. (*ICON 1.5*, pp. 32–33.)

---

## 26. GM ritual/project builder

**Source:** p. 28.

Provide:

- proposed player goal;
- GM-selected constraints/costs;
- chosen Action or NarrativeClock;
- participants;
- required materials/Gear/Dust/expert/help;
- side effects;
- completion state.

The tool should make the source's “yes, but” structure easy, not present a pass/fail crafting DC system.

---

## 27. GM expedition builder

**Source:** pp. 39–41, 238.

Fields:

- goal/question;
- quest link;
- expected length;
- camp allowance;
- expected tactical combat yes/no;
- base reward;
- optional extra rewards;
- selected custom framework(s);
- player briefing;
- GM-only preparation;
- framework-specific setup;
- start/abandon/complete controls.

Default successful expedition reward:

- 6 XP;
- 3 Dust per player. (*ICON 1.5*, pp. 41, 238, 242.)

Allow extra XP, Dust, trophies, information, allies, etc. as explicit GM rewards.

---

## 28. GM Interlude manager

**Source:** pp. 42–43, 239.

GM view should:

- open Interlude;
- award expedition/quest rewards;
- approve/shape Ambitions;
- choose Ambition clock length;
- adjudicate whether an Ambition is possible, reduced, or multi-step;
- resolve group Ambitions;
- process help/healing;
- approve concrete Ambition rewards;
- process Camp purchases/upgrades;
- trigger end-of-interlude effects;
- advance Chapter where the group decides;
- close Interlude/start next expedition.

---

## 29. GM session-end manager

**Source:** p. 44; XP summary p. 240.

For every character:

- Ideals fulfilled: 0 / 1 / 2+;
- challenged/tested trigger;
- completed Ambition XP;
- invoked Burden?
- optional framework-specific XP triggers;
- Bond-specific XP grants.

The application should calculate from **confirmed trigger inputs**, not scrape chat/roll history and assume a trigger happened.

---

# PART IV — BONDS

## 30. Bond base-feature wiring

**Source:** pp. 34–35 and individual Bond sheets pp. 56–79.

Every Bond needs canonical content for:

- Bond ID/name/source;
- two starting Action choices;
- Ideals;
- max Effort;
- max Strain;
- Second Wind;
- Special Ability;
- Gear kits/custom-kit rules;
- Bond Powers;
- Gambit;
- source page references.

Do not special-case these directly in page components. They should be content definitions executed through generic narrative operations where exact representation exists.

---

## 31. Bond coverage matrix

All twelve Bonds must receive source-by-source wiring and tests.

| Bond | Sheet / base features | Powers |
| --- | ---: | ---: |
| Pathfinder | p. 56 | p. 57 |
| Seeker | p. 58 | p. 59 |
| Mighty | p. 60 | p. 61 |
| Wolf | p. 62 | p. 63 |
| Harlequin | p. 64 | p. 65 |
| Highborn | p. 66 | p. 67 |
| Mender | p. 68 | p. 69 |
| Brave | p. 70 | p. 71 |
| Broker | p. 72 | p. 73 |
| Elder | p. 74 | p. 75 |
| Outsider | p. 76 | p. 77 |
| Dreamer | p. 78 | p. 79 |

For each Bond, inventory every:

- Second Wind;
- Special Ability;
- ten Bond Powers;
- Gambit;
- kit exception;
- Effort/Strain exception;
- Chapter scaling;
- session/scene/expedition/interlude hook.

Do not mark a Bond “complete” because its static text is present.

---

## 32. Generic narrative behavior families required by Bond Powers

The Bond corpus exercises a large portion of the narrative engine. Before wiring individual powers, ensure the runtime can represent these families exactly:

### Roll modification
Examples across Bonds include:

- +1D/Knack;
- increased Effect;
- Superpowered next Action;
- free Push;
- substitute Strain for Effort;
- reroll selected die faces;
- replace/use another Action rating;
- automatic 6;
- treat next roll as critical;
- transform die faces.

### Scoped state
Need:

- next Action;
- rest of scene;
- until end of scene;
- rest of session;
- until Camp;
- expedition;
- indefinite/persistent;
- “until used again” replacement.

### Limited-use ledger
Need:

- 1/session;
- 2/session;
- once per Burden per session;
- once ever / finite lifetime uses;
- first occurrence this session;
- repeatable scene-triggered recovery.

### GM oracle/response
Powers can require:

- truthful yes/no;
- truthful additional expert detail;
- Wheel / Stone / Chaos answer;
- answer as an internal presence;
- adjudication of whether target is too strong-willed;
- determination of journey difficulty;
- selection of complication/cost.

These require a structured GM response window, not auto-generated text.

### Fictional predicates
Powers reference things such as:

- darkness;
- populated location;
- trust;
- someone being wounded;
- being outnumbered;
- highborn/lowborn status;
- age;
- violence;
- a person witnessing something;
- separation from the group;
- personally prepared tools;
- sharing a meal;
- a location previously camped at.

Do not build a universal simulator to infer these facts. Use explicit context/GM confirmation unless the state is already objectively represented.

### Persistent player-authored facts
Some powers create or rely on durable narrative facts:

- contacts/family;
- special passion Ambition;
- watched-over character;
- looked-up-to character;
- chosen terrain/movement affinity;
- chosen languages/speech category;
- remembered location;
- transformation appearance;
- unique culture/language;
- permanent/finitely replaceable power state.

These need schema support and migration.

### Interlude/Ambition/Burden modifications
Bond Powers alter:

- healing segments;
- helping others heal;
- number of Ambitions pursued;
- free special Ambitions;
- Ambition roll dice;
- bonus project ticks;
- Burden removal;
- XP on Ambition completion.

### Gear/capacity modifications
Some Bonds change:

- kit composition;
- loose Gear capacity;
- cross-Bond Gear acquisition;
- possession of temporary tools.

These must modify the generic Gear inventory rules rather than create one-off UI-only state.

---

# PART V — GEAR, XP, DUST, AND ADVANCEMENT

## 33. Narrative Gear

**Source:** pp. 35–36, 242.

Base rules:

- ordinary adventuring gear is assumed;
- each Bond provides kits;
- on an expedition, choose one Bond kit;
- custom kit is normally three items selected from Bond kits;
- loose Gear can accumulate;
- normally carry two loose-Gear pieces on an expedition;
- Gear can be shared;
- Gear improves fictional position/Risk/Effect where appropriate;
- Gear quality generally tracks Chapter.

Wire:

- canonical Gear/kit content;
- owned loose Gear;
- expedition carried slots;
- kit choice;
- custom kit;
- transfer/share;
- source/Bond capacity exceptions;
- GM adjudication hook for Gear benefit.

Avoid an invented item-weight/economy system.

---

## 34. XP

**Source:** pp. 44, 240–241.

Session/expedition XP comes from several sources:

- expedition/quest rewards;
- Ideals;
- challenge/test trigger;
- Ambitions;
- Burden invocation;
- Bond or framework-specific XP.

Maintain an XP ledger with provenance rather than only a mutable total.

### Narrative advancement by level

**Source:** p. 241.

| Level | Narrative benefit |
| ---: | --- |
| 0 | Culture + Kin; Bond; Bond +2 Action; one Bond Power; four additional Action dots |
| 1 | Gain a Bond Power and improve an Action |
| 2 | Gain a Bond Power and improve an Action |
| 3 | Gain a Bond Power |
| 4 | Improve two Actions **or** gain a Bond Power |
| 5 | Improve an Action |
| 6 | Gain a Bond Power |
| 7 | Improve an Action |
| 8 | Improve two Actions **or** gain a Bond Power |
| 9 | Gain a Bond Power |
| 10 | Improve an Action |
| 11 | Improve an Action |
| 12 | Gain a Bond Power |

The advancement UI must preserve the level-4/8 exclusive choice.

General Action restrictions include:

- level 0: no Action above 3;
- only one Action may ever reach 4. (*ICON 1.5*, pp. 34, 47.)

---

## 35. Source adjudication required: XP/AP threshold conflict

Do **not** silently reconcile this in narrative implementation.

The PDF contains an apparent conflict:

- p. 44 says characters can unlock an ability/talent when the XP bar reaches **5 or 10 XP**;
- pp. 238 and 240–241 describe the once-per-level AP breakpoint at **7 XP**.

The repository should use an existing source adjudication if one already governs this conflict; otherwise add one before wiring the corresponding advancement boundary. Do not choose whichever number is convenient in UI code.

There is also a wording difference in the session XP challenge trigger:

- p. 44: character was “challenged or tested”;
- p. 240: character “overcome a challenge”;
- individual Bond sheets repeat “challenged or tested”.

Treat canonical trigger wording/semantics as source-adjudication work if implementation behavior would differ.

---

## 36. Dust

**Source:** p. 242.

Wire:

- personal Dust;
- maximum personal carry 8;
- default expedition reward 3 Dust/player;
- GM extra Dust rewards, commonly 1–2;
- spend 2 Dust for +1 Ambition/Burden tick;
- Camp fixture/upgrades;
- shared Aethervault where purchased;
- other source-defined Camp/Bond spends.

Use transaction-style mutations with payer, recipient, reason/source, and before/after balance.

---

# PART VI — CAMP

## 37. Camp as shared campaign state

**Source:** pp. 253–260.

A Camp is a party-level sheet, not a field copied into each character.

Base Camp state:

- group name;
- 1–3 group Ambitions;
- Camp Fixtures and upgrades;
- shared resources created by fixtures;
- fixture-specific state;
- start with one fixture of the group's choice. (*ICON 1.5*, p. 253.)

Anyone may spend Dust on Camp fixtures/upgrades, subject to source rules.

Upgrades bought during Interlude take effect at the end of the Interlude. (*ICON 1.5*, p. 254.)

---

## 38. Camp Fixture coverage matrix

Every fixture and nested upgrade needs a canonical source ID, prerequisite relation, purchase cost, upgrade cost, state shape, and exact effect wiring.

| Pages | Fixtures / systems to inventory |
| --- | --- |
| p. 254 | Aetherpearls, Aethervault, Cabinet, Cauldron begins |
| p. 255 | Cauldron/flasks, Cooking Pot |
| p. 256 | Cooking upgrades, Campfire, Elixir Stone, Fishing Pole |
| p. 257 | Fishing upgrades/results, Forge, Liftstone, Portable Library begins |
| p. 258 | Portable Library, Kapkat Table, Shrine begins |
| p. 259 | Shrine upgrades, Spirit Idol, Survival Gear |
| p. 260 | Survival Gear upgrades, Thieves' Gear |

### Narrative behavior families Camp must support

#### Action-rating modifiers
Several fixtures add +1 to specified Actions subject to caps.

These should be derived modifiers, not destructive rewriting of base ratings.

#### Shared resource storage
Aethervault introduces shared Dust capacity/generation/access.

#### Gear/loadout permissions
Cabinet and related upgrades alter when Gear/abilities/jobs may be changed.

#### Consumable crafting
Cauldron/flasks require:

- recipe;
- cost or ingredient waiver;
- inventory caps;
- major-flask cap;
- narrative roll modifiers/effect boosts;
- mixed narrative/tactical effects.

Narrative roadmap owns the narrative side; tactical effects should be handed to tactical content rather than reimplemented here.

#### Custom mini-roll systems
Cooking, Fishing, and Kapkat have their own source-defined roll procedures. Treat them as explicit source mini-games over generic deterministic dice, not as Action Rolls if their source procedure differs.

#### Burden/Strain/Effort recovery
Campfire and related upgrades alter healing/recovery.

#### Wound/HP recovery
Elixir Stone bridges narrative use with tactical persistent harm.

#### Travel/teleport
Liftstone creates a source-defined narrative travel capability and recharge state.

#### Project/Ambition modifiers
Forge/Portable Library/Kapkat may affect project clocks, Ambitions, XP, or Dust.

#### GM oracle
Shrine can require GM Wheel/Stone/Chaos answers.

#### Simple companion
Spirit Idol can exist as an NPC narrative Aid source or as a simplified character. The narrative state and tactical state must share identity without inventing cross-mode behavior.

---

# PART VII — OPTIONAL EXPEDITION FRAMEWORKS

## 39. Custom rules framework

**Source:** p. 261.

The source explicitly permits:

- no custom framework;
- one framework;
- selected optional modules;
- mixing rules from different frameworks.

Therefore implementation should not encode a single `expeditionType` enum that prevents mix-and-match.

Recommended model:

- expedition has zero or more attached `ExpeditionModule` instances;
- each module owns its source-defined state/actions;
- modules may contribute:
  - clocks;
  - resources;
  - special Actions;
  - player/GM setup questions;
  - scene/leg/chamber hooks;
  - completion/failure logic.

Special expedition Actions use narrative dice but have source-defined result tables. Their outcomes must be content-driven and deterministic.

---

## 40. Dungeon Crawl

**Source:** pp. 262–269.

### Base GM/player support

Core concepts:

- hook/goal;
- map;
- chambers;
- corridors;
- points of interest;
- player setup questions;
- GM setup questions;
- optional hidden/public map;
- prepared hazards/encounters/rewards.

GM needs either:

- traditional map annotations, or
- abstract chamber graph.

Do not require tactical square dimensions for narrative dungeon maps. (*ICON 1.5*, pp. 262–264.)

### Dungeon modules

#### Haul — p. 265
- group Haul value;
- item/value-to-Haul definitions set before expedition;
- Haul Check in tense situations;
- roll d6 per Haul;
- each `1` forces tradeoff/cost/clock or abandonment of Haul.

#### Light — p. 266
- torch-dice pool;
- Torch Check when exiting chambers;
- discard torch die on 1–2;
- Take Your Time burns torch die for +1D narrative Action;
- Kindle special Action;
- out-of-light consequences.

#### Darkness variant — p. 266
- spent torch dice become darkness dice;
- Darkness Check in tense situations;
- GM consequences per `1`;
- clear darkness at Camp/dungeon exit/Interlude.

#### Wandering Encounters — pp. 266–267
- encounter clock 3–6;
- chamber-exit d6;
- 1–2 +2 ticks, 3–5 no change, 6 −1;
- reset when filled;
- GM encounter table/list;
- may be public or hidden;
- never gate required dungeon progress behind randomness.

#### Traps — p. 267
Narrative traps:
- spring only as consequence/complication of player Action;
- hard Strain consequences must be established/foreshadowed;
- Strain based on Risk, not “trap damage”.

#### Cartography — p. 267
- assigned cartographer;
- session-end +1 XP for honest attempt.

#### Depth — p. 267
- dungeon/area depth 1–4;
- maps directly to Chapter expectation;
- visible to players if used.

#### Explore — pp. 267–268
- declared number of special points of interest;
- majority/all discovery reward;
- source XP/Dust rewards.

#### Labyrinth / Navigate the Maze — p. 268
- chamber graph without fixed edges;
- GM may choose destination unless player uses Navigate;
- source-defined result table.

#### Palace of Doors — p. 268
- random d20 room routing;
- durable RNG result;
- Navigate exception.

#### Lair — p. 268
- narrative preparation around a powerful monster/lair;
- no extra mechanical state unless modules require it.

#### Megadungeon — p. 268
- graph of dungeon expeditions;
- interludes between components;
- durable links between expedition nodes.

#### Wonder — p. 269
- optional session XP trigger:
  “Did you see something glorious, wondrous, terrifying, or truly impressive?”
- GM gets last word.

---

## 41. Battle

**Source:** pp. 270–275.

### Base Battle model

Wire:

- overall stakes;
- 2, 3, or 5 Action Scenes;
- each scene: situation, setting, stakes;
- scene order/branching;
- positive/negative outcome;
- final aftermath assembled from scene outcomes.

Player setup questions and GM preparation live on p. 271.

### Battle modules

#### Battle Assets / Allied Trust / Command — pp. 272–273
- points/scenes characters cannot all attend;
- assign allied asset to unattended scenes;
- asset strength category;
- Allied Trust d6 procedure;
- Command preparation roll that modifies asset dice.

#### Field Battle — p. 273
- victory score threshold;
- count positive/resolved scenes;
- Tides of Fate optional d6 modifier.

#### Defense — p. 273
- pre-attack preparation timer;
- weak/average/strong asset clocks;
- attack triggers when timer completes.

#### Hard Choices — p. 273
- unattended scenes automatically lose; players know this.

#### Last Stand — p. 274
- forced retreat framing;
- save one thing on successful pre-final scenes;
- final-scene sacrifice decisions.

#### Musou — p. 274
- tone rule for overwhelming incidental opposition;
- no extra combat simulation needed.

#### Pit Fight — p. 274
- odd number of arena scenes;
- per-round/majority reward;
- tactical loadout swap permission between scenes if used.

#### Rescue — p. 274
- 6/8-segment threat clock;
- advances with actions/scenes/consequences;
- escalating danger each fill;
- expedition ends after third escalation.

#### Sports — pp. 274–275
- opposing score clocks;
- clock fill scores a point then resets without spill;
- optional time clock;
- Locker Room scene modifiers.

#### Trial — p. 275
- odd number of scenes;
- overall judgment by majority positive/negative outcomes.

---

## 42. Intrigue

**Source:** pp. 276–280.

### Base Intrigue

Wire:

- goal/secret being sought;
- Intrigue Clock, usually 2–5 segments;
- Tension Clock, usually 3–4;
- scene completion can advance Intrigue;
- when Intrigue fills, reveal/confront target;
- Tension advances due to decisions/actions/consequences;
- when Tension fills, trigger twist/problem/confrontation and reset/advance failure count;
- optional fail state after repeated Tension fills.

The implementation must not force a predetermined clue chain. The source explicitly allows characters to progress the clock through their own approach.

### Intrigue modules

#### Infiltration — p. 278
- Tension fill can force fight/flee/avoid detection;
- optional alarm level 0–3;
- alarm raises narrative Risk;
- can add tactical reinforcements if tactical mode is used;
- alarm 3 ends stealth.

#### Extraction — p. 278
- optional second/shorter exit Intrigue Clock;
- must be declared before expedition if extraction is intended as a challenge.

#### Masquerade — p. 279
- per-character disguise clock, 3 segments;
- Tension fills reduce disguise;
- Deep Cover;
- Rip Off the Mask;
- Cover Up transfer mechanic.

#### Heal — p. 279
- Tension represents worsening illness;
- Ameliorate scene;
- optional taking Burden to absorb suffering;
- failure-state escalation.

#### Hunt / Chase — pp. 279–280
- Intrigue completion catches quarry / escapes pursuer;
- Tension creates obstacles;
- optional repeated-Tension fail state;
- tactical quarry fight should usually be final if tactical combat is promised.

#### Negotiation — p. 280
- faction list;
- each faction gets demand/need clock;
- majority (or both sides for two-party) completion condition;
- Tension represents interference;
- failed interference may shift faction clocks;
- hostile faction can have a fail-state clock.

---

## 43. Trek

**Source:** pp. 281–286.

### Base Trek

Wire:

- destination;
- cargo/passengers/caveats;
- named dangers;
- sequence of legs;
- each leg has 1–4 segment progress clock;
- scenes/goals advance leg by 1;
- move to next leg when filled;
- player/GM setup prompts.

Average Trek has 2–3 legs; longer Treks have 4+. (*ICON 1.5*, p. 281.)

### Trek modules

#### Scout — p. 283
- one character once per leg;
- choose information sought;
- source-defined result table with risk/tradeoff.

#### Supplies and Baggage — pp. 283–284
- shared Supplies resource;
- shared Baggage list;
- advancement cost = 2 Supplies +1 per Baggage;
- advancing consumes paid Supplies;
- consequences may lose Supplies;
- actions to clear Baggage.

#### Forage — p. 284
- once per leg;
- team or designated forager;
- source-defined result table.

#### Push Through — p. 284
When short on Supplies:
- take Baggage equal to deficit (not final leg), or
- everyone takes Strain equal to needed Supplies, or
- GM offers opportunity/tradeoff/hard choice.

#### Make Things Complicated — p. 284
- GM may substitute Baggage for Strain/consequence/Burden.

#### Limited Camps — p. 284
- Camp costs 2 Supplies +1/Baggage.

#### Time Limit / Buy Time — pp. 284–285
- countdown clock;
- generally legs +2/3 segments;
- decrements on legs/tradeoffs/consequences;
- Buy Time via trouble, NPC/faction cost, or personal sacrifice.

#### Weather — p. 285
- d6 per leg;
- 1 terrible (+2 cost), 2–3 bad (+1), 4+ clear;
- mitigation through fiction can avoid cost.

#### Map Crawl / Granular movement — p. 285
- map regions as legs;
- safe/refuge endpoints;
- optional section/hex movement;
- day/night movement rates;
- Push travel via Strain/consequences.

#### Gatekeeper — p. 286
- leg locked behind meaningful challenge;
- cannot be hard “no”; barreling through should have cost.

#### Peaceful Trek — p. 286
- no combat expected.

#### There and Back Again — p. 286
- skip already-resolved return-route costs/problems.

#### Patrol — p. 286
- major tasks in legs;
- ignored tasks progress/resolve, often for worse.

#### Caravan — p. 286
- wear clock;
- +1 wear per leg;
- extra wear via consequences/tradeoffs;
- repair/heal via actions;
- condition bands;
- full + further wear = loss until recovered;
- optional random wear d6.

---

# PART VIII — NETWORK, PERSISTENCE, AND VISIBILITY

## 44. Authoritative narrative event flow

Networked narrative play should follow the same principle as tactical replay:

**decision once → durable event → deterministic projection**

Examples:

- player selects Action;
- GM sets Risk/Effect;
- player chooses Push;
- GM accepts Tempt Fate consequence;
- RNG produces dice once;
- GM selects consequence;
- player selects one offered branch;
- GM answers a Bond oracle;
- clock ticks.

Each should be recorded once and replayed, never rediscovered from current UI state.

---

## 45. GM-private versus player-visible state

Narrative play has substantial hidden information.

Support at least:

- public;
- owner/player-private;
- GM-only.

GM-only candidates include:

- hidden clocks;
- unrevealed Dungeon map nodes;
- mystery notes;
- hidden encounter tables;
- NPC secrets;
- future Battle scenes;
- Intrigue truth/confrontation;
- GM prep answers.

The server projection must remove hidden fields, not merely hide them with CSS.

---

## 46. Dice authority

All networked dice should be authoritative and replayable.

Record:

- roll kind;
- roller/initiator;
- source;
- full input dice pool;
- exact generated dice;
- keep rule;
- result;
- rerolls/transforms;
- final result.

Do not use hidden client RNG for any consequential narrative roll.

---

## 47. Local-first character persistence

Narrative character state should remain compatible with the local-first character workflow:

- character IDs remain stable;
- narrative edits commit locally first;
- cloud replication is debounced;
- narrative source IDs are canonical;
- sync metadata remains outside rules state;
- cloud acknowledgement means exact revision durability.

Shared campaign/session/expedition state, however, must use server authority once a networked table is active. Do not merge competing GM/player local campaign states by timestamp.

---

# PART IX — IMPLEMENTATION SEQUENCE

## 48. Prerequisite: UNDERLAY PHASE COMPLETE

No source-unit narrative wiring before the generic-underlay completion gate.

During the underlay phase it is acceptable to:

- finish static narrative catalogs;
- assign canonical IDs/source references;
- build non-executing UI shells;
- build level-0 selection/persistence flows;
- inventory source units;
- add roadmap/coverage tooling.

It is not acceptable to promote Bond powers or Camp/framework mechanics as executable merely to make the narrative UI look complete.

---

## 49. N0 — Canonical narrative catalogs and coverage inventory

Deliver:

- canonical Kin/Culture/Bond/BondPower/Kit/Gear IDs;
- source references;
- Bond sheets complete as structured content;
- Camp Fixture/upgrade catalog;
- custom expedition module/action catalog;
- narrative source-unit coverage manifest;
- schema migrations;
- `audit:narrative-coverage` or equivalent generated inventory.

No behavior claims.

Exit criteria:

- every source-bearing selectable narrative unit has permanent ID + page;
- no display label is used as identity;
- complete inventory covers pp. 17–79 and relevant pp. 238–286 source units.

---

## 50. N1 — Core Action vertical slice

Implement a true GM/player shared Action flow:

- intent;
- Action;
- Risk/Effect;
- Push;
- deterministic roll;
- result;
- basic consequence;
- Strain;
- durable event/replay.

Include Fortune/GM Fortune.

Exit test: two browser clients + GM can resolve a complete roll and reload into identical state.

---

## 51. N2 — Teamwork, clocks, and harm

Add:

- Aid;
- Setup;
- Team Action;
- Tempt Fate;
- narrative clocks;
- break;
- Burdens;
- Burden invocation;
- scene lifecycle.

Exit tests include:

- shared Aid consequence;
- Setup consumed exactly once;
- clock progress by Effect;
- critical Strain break;
- scene-end recovery;
- three-Burden expedition lockout.

---

## 52. N3 — Expedition / Camp / Interlude / session lifecycle

Add:

- session boundaries;
- expedition builder;
- kit/Gear prep;
- camp allowance;
- Camp action;
- expedition completion/abandon;
- quest state;
- Interlude;
- Burden healing;
- Ambitions;
- group Ambitions;
- session XP;
- Dust and narrative advancement.

Exit test: run expedition → camp → complete → interlude → ambition → session end → next expedition entirely in app.

---

## 53. N4 — Bond base features and Bond Powers

Wire source content one Bond at a time, but only on top of generic narrative operations.

Suggested order should be driven by semantic coverage rather than Bond popularity:

1. powers that use already-complete generic roll/resource/scope semantics;
2. GM oracle/choice powers;
3. persistent-state powers;
4. Interlude/Ambition powers;
5. unusual one-off mini-procedures.

For every power:

- source page;
- exact trigger/use timing;
- chooser/controller;
- target/subject;
- cost;
- scope/reset;
- effect;
- GM decision points;
- player decision points;
- persistence;
- replay;
- explicit non-executable status if exact semantics remain unrepresentable.

Exit criterion: every power on pp. 57, 59, 61, 63, 65, 67, 69, 71, 73, 75, 77, 79 accounted for.

---

## 54. N5 — Camp Fixtures

Wire pp. 253–260.

Prioritize generic/shared narrative effects first, then source mini-games:

- group sheet/purchases/prerequisites;
- action modifiers;
- recovery;
- Gear permissions;
- shared Dust;
- flasks;
- Ambition/project effects;
- Liftstone;
- oracle effects;
- Cooking/Fishing/Kapkat;
- Spirit Idol.

Where a fixture has both narrative and tactical effects, use one canonical fixture state/content record with separate mode-specific execution attachments.

---

## 55. N6 — Optional expedition frameworks

Implement modules in a reusable framework engine:

1. Dungeon Crawl, pp. 262–269
2. Battle, pp. 270–275
3. Intrigue, pp. 276–280
4. Trek, pp. 281–286

Do not hard-code four mutually exclusive modes; preserve p. 261 mix-and-match semantics.

---

## 56. N7 — Narrative combat, GM tooling, and hardening

Narrative combat should already work through N1/N2, but this tranche completes ergonomic GM tools:

- qualities;
- multi-clock encounter templates;
- narrative↔tactical transition;
- scene templates;
- source reference quick panels;
- hidden-info projection tests;
- reconnect/replay hardening;
- audit/report polish.

---

# PART X — ACCEPTANCE GATE

## 57. `NARRATIVE PLAY COMPLETE` gate

Do not call narrative play complete until all of the following are true.

### Source coverage
- Every core rule in pp. 17–44 is inventoried.
- Narrative creation/advancement in pp. 45–47 and p. 241 is covered.
- All 12 Bond sheets and all powers, pp. 56–79, are accounted for.
- Camp and all fixtures/upgrades, pp. 253–260, are accounted for.
- Optional frameworks/actions, pp. 261–286, are accounted for.
- Source conflicts have explicit adjudications.
- No exact-but-unrepresentable rule is silently approximated.

### Player flow
- Player can create a level-0 narrative character.
- Player can run ordinary Action/Fortune rolls.
- Player can Push/Aid/Setup/Team Action/Tempt Fate.
- Player can use owned Bond features and powers.
- Player can track Effort/Strain/Burdens/Ambitions/Gear/XP/Dust.
- Player can prepare for expeditions, Camp, and perform Interlude actions.
- Source page references are available.
- No implementation-coverage metadata is exposed.

### GM flow
- GM can create/end scenes and sessions.
- GM sets Risk/Effect before rolls.
- GM can foreshadow and apply consequences.
- GM can create/manage hidden/public clocks.
- GM can answer source-defined Bond prompts.
- GM can run narrative combat.
- GM can create expeditions and rewards.
- GM can manage Camps/Interludes/Chapter.
- GM can attach/mix optional expedition modules.
- GM-only information never leaks into player projections.

### Determinism and persistence
- Every RNG outcome is recorded once.
- Every player/GM choice is recorded once.
- Replay yields the same authoritative state.
- Refresh/reconnect does not lose pending Setup/Aid/choice/use state.
- Scene/session/expedition/interlude resets occur from explicit boundaries.
- Stale clients cannot overwrite newer shared narrative state.
- Character migration is lossless for known historical schemas.

### Automated tests
At minimum, add end-to-end tests for:

1. basic Action roll handshake;
2. 0-dice roll;
3. critical roll + Effect increase;
4. Push;
5. Aid + shared consequence;
6. Setup + one-time consumption;
7. Team Action;
8. Tempt Fate consequence regardless of result;
9. clock progress by Effect;
10. hidden clock projection;
11. controlled/risky/desperate Strain;
12. Break + Burden creation;
13. broken action paid by self/nearby ally;
14. scene-end broken recovery;
15. three-Burden expedition lockout;
16. Camp reset;
17. Interlude Burden healing;
18. Ambition progression and Dust spend;
19. group Ambition;
20. session XP;
21. narrative advancement choice at levels 4/8;
22. at least one GM-oracle Bond Power;
23. at least one persistent-state Bond Power;
24. at least one Interlude-modifying Bond Power;
25. Camp fixture purchase + prerequisite;
26. one source mini-game fixture;
27. one Dungeon module;
28. one Battle module;
29. one Intrigue module;
30. one Trek module;
31. narrative combat with qualities/clocks;
32. reconnect/replay during unresolved narrative choice.

### Repository verification
Run the normal repository gates, plus narrative coverage:

- `npm run audit:architecture`
- `npm run audit:automation`
- `npm run audit:source-fidelity -- --strict`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run build:server` where relevant
- `git diff --check`
- `npm run audit:class-job-census`
- narrative source coverage audit/inventory
- browser E2E for GM + player narrative flow

---

# PART XI — PAGE REFERENCE INDEX

## 58. Core narrative rules

| Topic | Pages |
| --- | --- |
| Narrative play / Action Roll | 17 |
| Actions | 17–18 |
| Risk and Effect | 18–19 |
| No Effect / Superpowered | 19 |
| Push / Aid / Setup | 19 |
| Burden dice penalties / Tempt Fate | 20 |
| Fortune / Recall | 20 |
| GM Fortune / player initiative | 21 |
| Chapter scale | 21–23 |
| Action-by-Chapter examples | 23–26 |
| Narrative clocks | 26–28 |
| Rituals and Projects | 28 |
| GM principles | 28 |
| Consequences | 29 |
| Strain | 29–30 |
| Breaks and Burdens | 30–31 |
| Narrative combat | 31–33 |
| Narrative character/Bond rules | 34–36 |
| Play example | 36–38 |
| Expeditions / Camps / Interludes | 39–43 |
| Session End | 44 |
| Narrative Character Creation | 45–46 |
| Narrative advancement | 47 |

## 59. Character source content

| Topic | Pages |
| --- | --- |
| Kin overview | 46 |
| Thrynn | 48 |
| Trogg | 49 |
| Beastfolk | 50 |
| Xixo | 51 |
| Six Great Cultures | 52–54 |
| Bonds | 55–79 |

## 60. Campaign / GM source content

| Topic | Pages |
| --- | --- |
| Book of Adventure game-flow refresher | 238–239 |
| Advancement / XP / Chapter | 240–241 |
| Rewards / Dust / Gear / Trophies | 242–244 |
| Camp | 253 |
| Camp Fixtures | 254–260 |
| Custom expedition rules overview | 261 |
| Dungeon Crawl | 262–269 |
| Battle | 270–275 |
| Intrigue | 276–280 |
| Trek | 281–286 |

---

## 61. Final implementation principle

Narrative play should feel conversational even when the application is authoritative.

The player should still be able to say:

> “I want to get across the hall without touching the floor.”

The GM should still be able to answer:

> “That sounds Controlled, with Powerful Effect because of your setup.”

The software's job is to make the rule-bearing pieces around that exchange exact:

- who chose what;
- what it cost;
- what Risk/Effect were established;
- what dice were rolled;
- what the source says;
- what consequence was chosen;
- what state changed;
- when it expires or resets;
- who is allowed to see it.

---

# PART XII — SOURCE ADJUDICATIONS AND CROSS-MODE INVARIANTS

## 62. Narrative source-adjudication ledger

Before narrative source wiring begins, reconcile every known internal source
conflict that could produce different executable behavior.

These are source questions, not implementation choices. Do not silently pick
the wording that is easiest to encode.

### Burden Action penalties

The PDF contains conflicting descriptions of how many Action ratings a new
Burden penalizes:

- p. 20 says that when a character takes a Burden, they pick **an Action**
  which suffers -1D.
- p. 30, in the detailed Breaks and Burdens rules, says to tick **two Actions**
  above 0D, both of which suffer -1D.

The current roadmap follows the detailed p. 30 rule and therefore assumes two
Actions. Record this as an explicit source adjudication before executable
wiring rather than treating the discrepancy as nonexistent.

### Setup reward

The PDF also describes Setup in two slightly different ways:

- p. 19: a successful Setup grants the beneficiary **+1 Boon or increased
  Effect**.
- p. 35: the Bond-rules summary describes Setup as granting **+1D**.

The current roadmap follows p. 19 and permits the player to choose +1D or
increased Effect. This requires an explicit source adjudication before
execution authority is claimed.

### XP / AP breakpoint

As noted above:

- p. 44 gives ability/talent unlock breakpoints at **5 and 10 XP**.
- pp. 238, 240, and 241 give the once-per-level AP breakpoint at **7 XP**.

Do not wire either breakpoint until the repository's source-adjudication
authority has resolved this.

### Chapter level cap wording

The source's level-cap wording is internally awkward:

- pp. 44 and 47 say a character cannot gain more levels than the "current
  chapter" / "current chapter number".
- pp. 240-241 explicitly define Chapters as level bands:
  Chapter I = levels 1-4, Chapter II = 5-8, Chapter III = 9-12.

Execution should use an explicit adjudicated `chapterLevelCap`, not derive a
maximum level by treating the Chapter ordinal itself as the level cap.

### Session challenge XP wording

The session trigger is also phrased differently:

- p. 44 and the individual Bond sheets: character was "challenged or tested".
- p. 240: character "overcome a challenge".

If those readings could produce different XP awards, resolve the wording
before automating the trigger.

### Adjudication rule

For every such conflict:

1. record all conflicting page references;
2. record the chosen canonical interpretation and rationale;
3. make tests cite that adjudication;
4. never conceal the conflict by normalizing the source catalog itself.

`NARRATIVE PLAY COMPLETE` requires this ledger to contain no unresolved
conflict that changes executable behavior.

---

## 63. Player initiative is a narrative invariant

**Source:** p. 21.

Narrative play does not have an NPC turn engine.

Players have the initiative. NPCs, monsters, traps, hazards, and the
environment normally act through:

- fictional positioning;
- consequences and complications of player Actions;
- clocks;
- GM-authored changes to the situation;
- explicit source-defined procedures.

The GM does not ordinarily roll for NPC Actions and should not be given a
generic "NPC Action Roll" control. The source describes GM Fortune as the
exception.

This remains true in narrative combat. Narrative foes do not acquire turns,
Action ratings, or tactical-style autonomous action merely because violence
has begun.

---

## 64. Narrative and tactical capability remain separate

**Source:** pp. 21, 31-32, 46.

Narrative capability is governed by:

- the ten narrative Actions;
- Chapter;
- Bond features and Bond Powers;
- Gear and fictional positioning;
- other explicitly narrative source rules.

Tactical Jobs and tactical abilities do **not** automatically grant equivalent
narrative capabilities.

For example, the source explicitly notes that a Spellblade's tactical
teleportation does not by itself define narrative teleport capability;
narrative movement remains constrained by Traverse, Chapter, and fictional
position (p. 46).

Therefore:

- never infer a narrative Action bonus from a tactical Job;
- never expose tactical attack/movement ranges as narrative ranges;
- never automatically convert a tactical ability into a narrative Power;
- never deny narrative magical/extraordinary action merely because a
  character lacks a matching tactical ability.

The fiction may describe the same character capability in both modes, but
the mechanical authorities remain distinct.

---

## 65. Narrative ↔ tactical transition contract

**Source:** pp. 31-32; Book of Adventure pp. 238-239.

Moving into tactical combat is a mode transition, not a conversion of one
rules model into another.

When narrative play enters tactical combat:

- preserve character identity;
- preserve persistent campaign state;
- use the character's current tactical state as defined by the tactical
  rules;
- do not convert Strain into HP damage;
- do not convert narrative clocks into foe HP;
- do not convert narrative foe qualities into tactical Traits;
- do not synthesize tactical units for narrative NPCs unless an actual
  tactical encounter requires them.

When tactical combat ends:

- return to narrative play;
- preserve any source-defined persistent tactical results such as Wounds;
- process combat-derived rewards and other cross-mode effects through their
  actual source rules;
- close or retain narrative clocks according to what happened in the fiction,
  by GM adjudication rather than mechanical conversion.

A narrative encounter may escalate into tactical combat before its narrative
clock is filled. Tactical victory likewise does not automatically fill every
narrative clock in the scene; the GM determines what the combat accomplished
in the fiction.

---

## 66. Do not over-automate clock progress

**Source:** pp. 27, 29, 36-38.

The standard clock rule says successful Actions fill segments according to
Effect. However, the source's own play example also has the GM grant progress
on a failed roll because the Action nevertheless moved the situation
forward.

Therefore the engine may calculate or suggest the normal progress associated
with Effect, but the final clock mutation remains an explicit resolution
decision unless a source-defined expedition Action gives a mandatory result.

Never encode:

    finalResult < 4 -> progress = 0

as a universal narrative invariant.

Likewise, consequences may tick failure or other clocks independently of the
Action's positive progress.

---

## 67. Gambit acquisition

**Source:** p. 35.

Narrative advancement must explicitly enforce the Bond Gambit rule:

- normally, new Bond Powers come from the character's own Bond;
- after the character has **four powers from their own Bond**, including
  their starting power, a later Power choice may instead take a Gambit;
- a Gambit is a Power from another Bond;
- a character can take a Gambit only once.

This requires provenance on acquired Bond Powers: the system must know the
power's source Bond and whether the character's cross-Bond acquisition was
their Gambit.

Do not infer eligibility merely from the total number of powers owned.

---

## 68. Second Wind is source-specific

**Source:** p. 34 and individual Bond sheets, pp. 56-79.

The general Bond rules describe Second Wind as a 1/session opportunity to
regain all Effort when its trigger occurs, but individual Bonds contain
important exceptions to that shape.

The executing authority must therefore use each Bond's actual Second Wind
definition rather than hard-code the p. 34 summary as a universal rule.

Second Wind content may vary in:

- amount of Effort restored;
- whether activation is optional;
- frequency;
- trigger;
- whether it is the character's normal route for regaining Effort at all.

---

## 69. Narrative non-goals

The narrative implementation is **not** intended to become:

- an AI GM;
- a universal simulation of fictional facts;
- an NPC turn/action engine;
- a tactical-stat generator for narrative foes;
- an automatic Risk/Effect calculator;
- a parser that decides what a player's prose "really means";
- a mechanism for importing all tactical abilities into narrative play;
- a system that resolves ambiguous source text by implementation convention.

The application owns the mechanical record.

The players and GM own the fiction.

---

## 70. Gate before N0/N1 execution

After `UNDERLAY PHASE COMPLETE`, narrative work should not immediately begin
by wiring whichever Bond Power is easiest.

The narrative implementation phase begins in this order:

1. regenerate/check the narrative source inventory;
2. settle executable source adjudications above;
3. establish canonical narrative IDs and presentation projections;
4. map required narrative operations onto the completed U1-U17 underlays and
   existing domain authorities;
5. identify any genuinely unrepresentable source rule and leave it
   non-executable rather than adding an ad hoc approximation;
6. begin N0, then N1-N7 in the order defined by this roadmap.

Any request for a new generic primitive during narrative work must first be
tested against `docs/generic-underlays.md`. Narrative play is expected to be
a major consumer of the completed underlays, not the reason to create a
parallel rules architecture.

---

## 71. Closing principle

Narrative play should feel conversational even when the application is
authoritative.

Where ICON leaves the answer to the table, preserve that freedom.

Where ICON gives a number, timing, cost, reset, choice entitlement, or
defined outcome, make it exact.
