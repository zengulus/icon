# Authoritative animated 3D dice presentation (future)

Status: **LATER PRESENTATION/POLISH WORK** — not scheduled, not part of any
phase gate, and deliberately excluded from readiness/coverage claims. This
document records requirements for later implementation; nothing here is
implemented and no dependency has been selected.

Cross-references: [`TODO.md`](../TODO.md) §Later polish,
[`roadmap.md`](roadmap.md) §What is deliberately NOT in any phase.

---

## Core architectural rule

ICON should eventually support high-quality animated 3D dice with
customizable appearance and a staged presentation of the authoritative roll
result. This system is **strictly presentation-only**.

The ICON rules engine remains the sole authority for:

- RNG;
- individual die outcomes;
- which dice are rolled;
- modifiers;
- kept/dropped dice;
- totals;
- comparisons and thresholds;
- success/failure classifications;
- criticals;
- `EXCEED!` and other named roll-dependent outcomes;
- riders and roll-dependent abilities;
- triggered effects;
- interrupt/window creation;
- downstream state changes;
- event ordering;
- replay semantics.

The visual dice system must consume already-resolved authoritative data.
Rendered physics must never determine, alter, reroll, reinterpret, or infer a
mechanical result.

The presentation layer must never contain rules such as:

```ts
if (total >= threshold) showExceed();
```

Instead, the authoritative engine/event stream must explicitly supply that
`EXCEED!` occurred.

## Likely future technical investigation

When this work becomes a priority, investigate a synthesis of:

- `3d-dice/dice-box` — modern runtime/rendering architecture; workers /
  OffscreenCanvas; customization and theme support;
- `3d-dice/dice-box-threejs` — predetermined visual outcomes; techniques for
  making animated dice settle on externally supplied values.

Do not select, vendor, fork, or add either dependency until that
investigation begins. They are reference implementations for a future
investigation, not current architectural authorities. The eventual integration
must sit behind an ICON-owned presentation interface so the rendering
implementation can be replaced without changing rules, event, replay, or
state semantics.

## Intended visual choreography

The target experience is not simply "roll dice → show total". The roll should
visually communicate the mechanical resolution as it is assembled:

    authoritative roll resolution
    → predetermined 3D dice animation
    → dice settle
    → individual values emerge from the dice
    → values combine into central base result
    → authoritative modifiers join
    → final authoritative result resolves
    → roll-dependent semantic callouts appear
    → authoritative triggered effects/events follow

### 1. Dice roll

Appropriate 3D dice enter and roll naturally. Their visible final faces must
exactly match the individual values already supplied by the authoritative
engine. Support where required: multiple dice; mixed die types; kept/dropped
dice; visually distinct dice roles where useful. The renderer does not roll
mechanically.

### 2. Values emerge from the dice

Once the dice settle, the relevant numeric values should visibly lift or
emerge from the dice. For multiple dice, those values should be able to move
or converge into the next stage of the presentation. Example:
`[d6 showing 5] [d6 showing 3]` → visually `5   3` → `8`. The exact arithmetic
and aggregation logic must still come from authoritative result data; the
renderer is displaying an already-resolved derivation, not calculating it
independently.

### 3. Central base result

The base roll value should become a prominent central visual element — the
focal point of the result animation. The central result treatment should
eventually be customizable through presentation/theme settings, including
where practical: highlight style; border/frame treatment; intensity; motion;
typography; thematic treatment; player/dice-set identity. This customization
must remain presentation state.

### 4. Modifiers join the result

Authoritative modifiers then enter the central composition visibly. Examples:
`13` → `13 + 4` → `17`; or `9 - 2` → `7`. Support positive modifiers, negative
modifiers, multiple modifiers, named modifiers where useful, and sequential
modifier presentation where the authoritative result data provides useful
semantic ordering. The presentation layer must not determine which modifiers
apply.

### 5. Final resolved result

The final authoritative number/result becomes visually dominant. The
presentation must retain the distinction between physical die values, base/
combined roll value, modifiers, and final result — do not collapse these into
an opaque final number when the underlying stages are meaningful.

### 6. Roll-dependent semantic callouts

After the final result resolves, display any authoritative semantic outcomes
that depend on the roll. These are first-class presentation beats, capable of
appearing prominently in the roll presentation rather than only in a combat
log. Examples include (not exhaustively):

- `EXCEED!`;
- critical result;
- miss;
- success/failure classification;
- threshold activation;
- named source-defined roll result;
- roll-dependent rider activation;
- bonus effect;
- conditional ability activation;
- any mechanic whose activation depends on an individual die value, the base
  roll, a modified result, a comparison, a threshold, or the final outcome
  classification.

Example flow: `17` → `EXCEED!` → consequential effect presentation.

The engine must explicitly provide the semantic callout identity; the renderer
must not inspect the number and infer the rule. Multiple callouts from one
roll must be representable; their ordering must come from authoritative
structured data or the event stream.

### 7. Triggered effects and downstream events

After the semantic result has been presented, the UI should be able to
visually sequence the authoritative consequences that follow from it: bonus
damage; status application; resource gain/loss; triggered ability; rider;
critical effect; `EXCEED!` effect; interrupt/window opening; reaction
opportunity; damage application; healing; movement; summoned/entity changes;
any other authoritative event causally downstream of the roll.

These events must already exist in the rules engine/event stream; the
presentation layer merely renders them. The desired conceptual chain:

    ROLL → 17 → EXCEED! → triggered rider → damage/status/etc.

so the player can visually follow **why** the resulting mechanical events
occurred.

## Structured presentation data

The eventual presentation API should consume structured authoritative result
data rather than parsing combat-log text. Illustrative shape (NOT a commitment
to introduce this exact type now):

```ts
type DicePresentation = {
  dice: Array<{
    sides: number;
    result: number;
    role?: string;
    kept?: boolean;
    appearance?: DiceAppearanceId;
  }>;
  baseValue?: number;
  modifiers?: Array<{ value: number; label?: string; sourceId?: string }>;
  finalValue?: number;
  outcome?: { kind: string; label?: string };
  callouts?: Array<{ kind: string; label: string; sourceId?: string }>;
  triggeredEventIds?: string[];
};
```

The important architectural requirement is: **presentation consumes
authoritative semantics; presentation does not reconstruct them.**

## Replay

A recorded/replayed roll must be able to reproduce the same individual visible
die values, kept/dropped state, base value, modifier sequence, final result,
semantic callouts, and triggered-event presentation ordering. The exact
physical dice trajectory does **not** need to be mechanically deterministic
(preserving identical trajectories is acceptable if easy, but is not a
game-state requirement). Authoritative replay is about result/event identity,
not visual physics identity.

## Customization

Eventually support presentation customization such as: dice colors; textures;
materials; face styling where practical; thematic dice sets; player-specific
sets; central-result highlight; callout styling; special-result presentation;
animation intensity.

Arbitrary custom 3D die geometry is **not currently a requirement**.
Appearance must remain outside authoritative character/rules state unless a
genuine future mechanic requires otherwise.

## Performance and accessibility

A future implementation should:

- lazy-load the 3D renderer where practical;
- impose minimal cost when disabled;
- support reduced motion;
- support an animation-off mode;
- provide a clean 2D/text fallback;
- tolerate WebGL/render initialization failure;
- work without changing the authoritative result if presentation fails;
- avoid blocking rules progression on animation completion.

Especially important: **mechanics must never wait on presentation-layer
physics.** A roll may already be authoritative and committed while its
animation is still playing. The UI may sequence what the player sees, but
animation must not become part of the mechanical turn-state machine.

## Priority constraints

This is later presentation/polish work. It must never displace: rules
authority; encounter closure; player/foe content coverage; multiplayer
authority; expedition/narrative integration; or higher-priority roadmap work.
It is not a phase gate, and it changes no readiness claims, coverage figures,
unsupported counts, or deliverable statuses.
