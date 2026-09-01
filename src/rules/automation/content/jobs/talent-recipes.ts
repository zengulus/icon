/**
 * Talent coverage content (docs/rules-foundations.md §8).
 *
 * The closed inventory of all 288 Job talents (two per ability, one per
 * chapter tier — `talent: 1` and `talent: 2`). Every row is keyed by the
 * exact source unit id (`${abilityId}:talent:${1|2}`) and states how the
 * talent executes:
 *
 * - `wired` rows register their trigger-effect into the `kernels/talent-
 *   recipes.ts` fold, which executes it through the shared trigger fold
 *   (exceed / comeback / finishing-blow pre-application triggers, slay /
 *   collide post-application triggers, and per-row condition overrides).
 *   Source fixtures live in `__tests__/talents.test.ts`.
 * - `program-level` rows are implemented by the ability's own program,
 *   which reads the equipped choice through the projected `talents` surface
 *   (`context.state.actors[id].talents[abilityId]`) and emits the variant
 *   itself — e.g. Demon Cutter t2's pre-ability rush. They are executable
 *   (audit-complete) but not fold rows; the fold must not double-apply
 *   them.
 * - `documented` rows stay source-visible (never approximated) with the
 *   exact kernel the talent needs, exactly like `JOB_TRAIT_RECIPES`.
 *
 * The registry is closed by construction: `TALENT_RECIPES` derives its keys
 * from the source manifest (`collectRuleSourceUnits`, kind `talent`), and the
 * catalog test enforces exact equality with all 288 source talents.
 * `EXECUTABLE_TALENT_IDS` derives from the wired rows — the audit authority
 * (allowlist + source fixture + replay test).
 */
import type { EncounterActor, EncounterState } from '../../../types.js';
import type { RuleSourceUnit } from '../../../source-units.js';
import { axisDirection, sameCell, squareArea } from '../../../area-geometry.js';
import type { RuleMutation } from '../../primitives/types.js';
import { affectedFoeIds, registerAreaModifierTalent, registerBonusDamageTalent, registerMarkModifierTalent, registerPassiveProjectionTalent, registerProgramLevelTalent, registerRangeModifierTalent, registerWiredTalentRecipe, type TalentRecipe, type TalentTriggerEffect } from '../../kernels/talent-recipes.js';
import type { TalentEffect } from '../../kernels/talent-recipes.js';

/** The party-favor mine's position from the ability's recorded terrain
 * mutations (the create on placement, the remove on detonation). */
const partyFavorMinePosition = (mutations: readonly RuleMutation[]): { x: number; y: number } | undefined =>
  (mutations.find((mutation) => mutation.kind === 'terrain' && mutation.terrain === 'party-favor') as Extract<RuleMutation, { kind: 'terrain' }> | undefined)?.positions[0];

/** The living, on-battlefield foes within Chebyshev adjacency (the 8
 * surrounding cells — the engine's shared ICON adjacency) of the actor.
 * Deterministic order by id. */
const adjacentFoes = (state: EncounterState, actorId: string): EncounterActor[] => {
  const actor = state.actors[actorId];
  if (!actor?.position) return [];
  const { x, y } = actor.position;
  return Object.values(state.actors)
    .filter((candidate) => candidate.id !== actorId && !candidate.defeated && candidate.position
      && candidate.side !== actor.side
      && Math.max(Math.abs(candidate.position.x - x), Math.abs(candidate.position.y - y)) <= 1)
    .sort((a, b) => a.id.localeCompare(b.id));
};

/** The wired tranche (F7): talents whose trigger-effect folds cleanly into
 * the existing F0–F6 kernels with a shared consumption point. Each row is
 * registered into the kernel fold on import. */
const WIRED_TALENT_RECIPES: Readonly<Record<string, { mechanic: string; triggerEffect: TalentTriggerEffect }>> = {
  // ICON p.126 Demon Cutter talent 1: "Exceed: Gain 6 vigor." The exceed
  // fires when the ability's attack roll totals 15+, exactly the engine's
  // exceed semantics (runtime.ts).
  'demon-slayer:demon-cutter:talent:1': {
    mechanic: 'Exceed (attack roll 15+): gain 6 vigor.',
    triggerEffect: { trigger: 'exceed', build: (actorId) => [{ kind: 'vigor', sourceActorId: actorId, actorId, amount: 6, uncapped: false }] },
  },
  // ICON p.130 Wicked Sheath talent 1: "Also shove your foe 1 for every
  // charge on the die. Collide: Your foe is stunned." The die-scaled shove
  // is in the program's on-hit effects; the Collide stun fires when the
  // shove collides the target.
  'demon-slayer:wicked-sheath:talent:1': {
    mechanic: 'Collide (shove hits obstacle): the shoved foe is stunned.',
    triggerEffect: {
      trigger: 'collide',
      build: (actorId, _targetIds, collidedIds) =>
        collidedIds.map((collidedId) => ({ kind: 'condition', sourceActorId: actorId, actorId: collidedId, conditionId: 'stunned', operation: 'apply' as const, potency: 'normal' as const })),
    },
  },
  // ICON p.139 Low Blow talent 2: "Comeback: Gain vigilance +1."
  'knave:low-blow:talent:2': {
    mechanic: 'Comeback (user bloodied): gain vigilance +1.',
    triggerEffect: { trigger: 'comeback', build: (actorId) => [{ kind: 'resource', actorId, resourceId: 'vigilance', operation: 'gain', amount: 1, minimum: 0, maximum: null }] },
  },
  // ICON p.142 Knave Riposte talent 2: "Comeback: Gain vigilance +1 after
  // Riposte resolves." The fold fires right after the ability's mutations, so
  // "after resolves" is the fold's natural timing.
  'knave:riposte:talent:2': {
    mechanic: 'Comeback (user bloodied): gain vigilance +1 after Riposte resolves.',
    triggerEffect: { trigger: 'comeback', build: (actorId) => [{ kind: 'resource', actorId, resourceId: 'vigilance', operation: 'gain', amount: 1, minimum: 0, maximum: null }] },
  },
  // ICON p.154 Strafe Shot talent 1: "Exceed: Gain evasion until the start
  // of your next turn." The turn-start duration clears at the owner's next
  // turn boundary (expireBoundaryEffects).
  'freelancer:strafe-shot:talent:1': {
    mechanic: 'Exceed (attack roll 15+): gain evasion until the start of your next turn.',
    triggerEffect: {
      trigger: 'exceed',
      build: (actorId) => [{ kind: 'condition', sourceActorId: actorId, actorId, conditionId: 'evasion', operation: 'apply', potency: 'normal', duration: { kind: 'turn-start', actor: { kind: 'self' }, turns: 1 } }],
    },
  },
  // ICON p.210 Blazing Bond talent 2: "Comeback: Grant both you and your
  // ally defiance when taking this action." The ally is the ability's target.
  'enochian:blazing-bond:talent:2': {
    mechanic: 'Comeback (user bloodied): grant the user and the bonded ally a durable defiance.',
    triggerEffect: {
      trigger: 'comeback',
      build: (actorId, targetIds) => {
        const effects: TalentEffect[] = [{ kind: 'condition', sourceActorId: actorId, actorId, conditionId: 'defiance', operation: 'apply', potency: 'normal' }];
        if (targetIds[0]) effects.push({ kind: 'condition', sourceActorId: actorId, actorId: targetIds[0], conditionId: 'defiance', operation: 'apply', potency: 'normal' });
        return effects;
      },
    },
  },
  // ICON p.122 Bastion Valiant talent 2: "If you only shove one foe, they
  // gain hatred of you after this ability resolves." The single-foe
  // predicate counts the distinct foes the ability's shove mutations
  // affected; the always trigger's post-application timing is the
  // "after this ability resolves" boundary. Hatred is a status, applied
  // through the shared condition mutation.
  'bastion:valiant:talent:2': {
    mechanic: 'If the ability shoved exactly one foe, that foe gains hatred after the ability resolves.',
    triggerEffect: {
      trigger: 'always',
      condition: ({ state, mutations, actorId }) =>
        affectedFoeIds(mutations, state, actorId, ['shove']).length === 1,
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const foes = affectedFoeIds(context.mutations, context.state, actorId, ['shove']);
        if (foes.length !== 1) return [];
        return [{ kind: 'condition', sourceActorId: actorId, actorId: foes[0], conditionId: 'hatred', operation: 'apply', potency: 'normal' }];
      },
    },
  },
  // ICON p.122 Bastion Valiant talent 1: "Collide: Become unstoppable for
  // the rest of your turn." The collide fires when one of the ability's
  // shoves collides (the shared collidingShoveTargets detection); the
  // turn-end duration clears the condition at the user's next boundary.
  'bastion:valiant:talent:1': {
    mechanic: 'Collide (one of the ability\u2019s shoves collides): become unstoppable until the end of your turn.',
    triggerEffect: {
      trigger: 'collide',
      build: (actorId) => [{ kind: 'condition', sourceActorId: actorId, actorId, conditionId: 'unstoppable', operation: 'apply', potency: 'normal', duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: 1 } }],
    },
  },
  // ICON p.163 Shade Umbra talent 1: "Slay: Gain defiance." The slay fires
  // when the ability's mutations reduce a foe to 0 HP (the post-application
  // reactive dry run shared with the reactive trigger set).
  'shade:umbra:talent:1': {
    mechanic: 'Slay (the ability defeats a foe): gain a durable defiance.',
    triggerEffect: {
      trigger: 'slay',
      build: (actorId) => [{ kind: 'condition', sourceActorId: actorId, actorId, conditionId: 'defiance', operation: 'apply', potency: 'normal' }],
    },
  },
  // ICON p.214 Geomancer Dragon Dive talent 1: "Gain Collide: Character is
  // vulnerable." Each collided character becomes vulnerable (a status,
  // applied through the shared condition mutation).
  'geomancer:dragon-dive:talent:1': {
    mechanic: 'Collide (one of the ability\u2019s shoves collides): each collided character becomes vulnerable.',
    triggerEffect: {
      trigger: 'collide',
      build: (actorId, _targetIds, collidedIds) => collidedIds.map((collidedId) => ({ kind: 'condition', sourceActorId: actorId, actorId: collidedId, conditionId: 'vulnerable', operation: 'apply', potency: 'normal' })),
    },
  },
  // ICON p.136 Colossus Dropkick talent 2: "Shove your foe 1, then shove
  // yourself 1 away from your foe. Charge: Increase shoves to 2." The shoves
  // are an unconditional augmentation of the ability (an `always` trigger);
  // the charge variant reads the user's slow-turn state (the same flag
  // `deriveTriggers` turns into the `charge` trigger) for the distance. The
  // directions are deterministic: the foe is shoved away from the user, the
  // user away from the foe.
  'colossus:dropkick:talent:2': {
    mechanic: 'Shove the foe 1 and yourself 1 away from the foe; charged (slow turn): shove 2 instead.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const actor = context.state.actors[actorId];
        const foe = context.state.actors[targetIds[0] ?? ''];
        if (!actor?.position || !foe?.position) return [];
        const charged = context.state.actors[actorId].ruleState['slow-turn'] === true;
        const distance = charged ? 2 : 1;
        const away = axisDirection(actor.position, foe.position);
        return [
          { kind: 'move', sourceActorId: actorId, actorId: foe.id, movement: 'shove', distance, positions: [], direction: away, phasing: false },
          { kind: 'move', sourceActorId: actorId, actorId, movement: 'shove', distance, positions: [], direction: { x: -away.x, y: -away.y }, phasing: false },
        ];
      },
    },
  },
  // ICON p.139 Knave Provoke talent 1: "If this ability only affects one
  // foe, they gain hatred of you." The single-foe predicate counts the
  // distinct foes the ability's damage mutations affected (the adjacent
  // foes it hit); the always trigger fires after the ability resolves.
  // Hatred is a status, applied through the shared condition mutation.
  'knave:provoke:talent:1': {
    mechanic: 'If the ability damaged exactly one foe, that foe gains hatred.',
    triggerEffect: {
      trigger: 'always',
      condition: ({ state, mutations, actorId }) =>
        affectedFoeIds(mutations, state, actorId, ['damage']).length === 1,
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const foes = affectedFoeIds(context.mutations, context.state, actorId, ['damage']);
        if (foes.length !== 1) return [];
        return [{ kind: 'condition', sourceActorId: actorId, actorId: foes[0], conditionId: 'hatred', operation: 'apply', potency: 'normal' }];
      },
    },
  },
  // ICON p.139 Knave Intimidate talent 1: "Comeback: Rush 2 instead" — the
  // user rushes 2 squares after the ability resolves while bloodied.
  'knave:intimidate:talent:1': {
    mechanic: 'Comeback (user bloodied): rush 2 instead of the normal effect.',
    triggerEffect: {
      trigger: 'comeback',
      build: (actorId) => [{ kind: 'move', sourceActorId: actorId, actorId, movement: 'rush', distance: 2, positions: [], direction: null, phasing: false }],
    },
  },
  // ICON p.196 Sealer God-Hand talent 1: "All versions of this ability gain
  // Exceed: Gain evasion until the end of your next turn." The exceed fires
  // when the ability's attack roll totals 15+; evasion is granted with a
  // turn-end duration so it expires at the user's next boundary.
  'sealer:god-hand:talent:1': {
    mechanic: 'Exceed (attack roll 15+): gain evasion until the end of your next turn.',
    triggerEffect: {
      trigger: 'exceed',
      build: (actorId) => [{ kind: 'condition', sourceActorId: actorId, actorId, conditionId: 'evasion', operation: 'apply', potency: 'normal', duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: 1 } }],
    },
  },
  // ICON p.136 Colossus Dropkick talent 1: "Comeback: Hit your foe so hard
  // that you create 2 spaces of difficult terrain in adjacent spaces after
  // this ability resolves." The comeback fires while the user is bloodied;
  // the fold creates two difficult terrain spaces in free cells adjacent
  // to the target.
  'colossus:dropkick:talent:1': {
    mechanic: 'Comeback (user bloodied): create 2 spaces of difficult terrain in adjacent spaces after this ability resolves.',
    triggerEffect: {
      trigger: 'comeback',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const { x, y } = target.position;
        const adjacent: { x: number; y: number }[] = [
          { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
        ];
        const free = adjacent.filter((c) =>
          c.x >= 0 && c.y >= 0 &&
          !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y),
        );
        return free.slice(0, 2).map((pos) => ({
          kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const,
          terrain: 'difficult', positions: [pos], height: null,
        }));
      },
    },
  },
  // ICON p.137 Colossus Massive Overhead talent 1: "Attack gains Exceed:
  // Also create a height 1 boulder object adjacent to your foe." The exceed
  // fires when the attack roll totals 15+; the fold creates a height-1
  // boulder in a free cell adjacent to the target.
  'colossus:massive-overhead:talent:1': {
    mechanic: 'Exceed (attack roll 15+): create a height 1 boulder object adjacent to your foe.',
    triggerEffect: {
      trigger: 'exceed',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const { x, y } = target.position;
        const adjacent: { x: number; y: number }[] = [
          { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
        ];
        const free = adjacent.filter((c) =>
          c.x >= 0 && c.y >= 0 &&
          !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y),
        );
        if (free.length === 0) return [];
        return [{ kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const, terrain: 'boulder', positions: [free[0]], height: 1 }];
      },
    },
  },
  // ICON p.191 Enochian Pyroclast talent 1: "Also cause a magma eruption
  // adjacent to your target, creating 2 spaces of dangerous terrain." The
  // always trigger fires on every use; the fold creates two dangerous
  // terrain spaces in free cells adjacent to the target.
  'enochian:pyroclast:talent:1': {
    mechanic: 'Always: create 2 spaces of dangerous terrain adjacent to your target.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const { x, y } = target.position;
        const adjacent: { x: number; y: number }[] = [
          { x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 },
        ];
        const free = adjacent.filter((c) =>
          c.x >= 0 && c.y >= 0 &&
          !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y),
        );
        return free.slice(0, 2).map((pos) => ({
          kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const,
          terrain: 'dangerous', positions: [pos], height: null,
        }));
      },
    },
  },
  // ICON p.157 Freelancer Showdown talent 2: "When you activate showdown,
  // gain stealth." The always trigger fires on every use of the ability;
  // stealth is granted to the user through the shared condition mutation.
  'freelancer:showdown:talent:2': {
    mechanic: 'When the ability is used, the user gains stealth.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId) => [{ kind: 'condition', sourceActorId: actorId, actorId, conditionId: 'stealth', operation: 'apply', potency: 'normal' }],
    },
  },
  // ICON p.151 Fool Party Favor talent 2: "Dazed or Blinded foes activate the
  // Finishing Blow effect." The mine's detonation is the ability's
  // finishing-blow clause ("Foes take 2 damage, twice", p.151); the talent
  // extends its eligibility to dazed or blinded foes in the blast area. The
  // fold's condition fires only when the detonation actually happened (area
  // damage is present), a dazed or blinded foe is in the blast, and the
  // ability's own clause did not already fire (a bloodied target fires it for
  // every area foe — the talent extends eligibility, it never doubles).
  'fool:party-favor:talent:2': {
    mechanic: 'A dazed or blinded foe in the blast area activates the ability\u2019s Finishing Blow effect (2 damage twice) for area foes when the ability\u2019s own clause did not.',
    triggerEffect: {
      trigger: 'finishing-blow',
      condition: ({ state, mutations }) => {
        // Only the detonation (not the placement) can activate the clause.
        if (!mutations.some((mutation) => mutation.kind === 'damage' && mutation.delivery === 'area')) return false;
        const mine = partyFavorMinePosition(mutations);
        if (!mine) return false;
        const area = squareArea(mine, 2);
        const areaFoeIds = Object.values(state.actors).filter((actor) => {
          const position = actor.position;
          return Boolean(actor.side === 'foes' && position && area.some((cell) => sameCell(cell, position)));
        }).map((actor) => actor.id);
        if (areaFoeIds.length === 0) return false;
        // The clause fires for every area foe on a bloodied target: three
        // area damage instances per foe (the base 2 plus 2 twice) are visible
        // in the ability's mutations — the talent must not double that.
        const clauseFired = areaFoeIds.some((id) => mutations.filter((mutation) =>
          mutation.kind === 'damage' && mutation.actorId === id && mutation.delivery === 'area').length >= 3);
        if (clauseFired) return false;
        return Object.values(state.actors).some((actor) => {
          const position = actor.position;
          return Boolean(position && area.some((cell) => sameCell(cell, position))
            && actor.conditions.some((condition) => condition.id === 'dazed' || condition.id === 'blind'));
        });
      },
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const mine = partyFavorMinePosition(context.mutations);
        if (!mine) return [];
        const area = squareArea(mine, 2);
        const foes = Object.values(context.state.actors).filter((actor) => {
          const position = actor.position;
          return Boolean(actor.side === 'foes' && position && !actor.defeated && area.some((cell) => sameCell(cell, position)));
        });
        return foes.flatMap((foe) => [
          { kind: 'damage', sourceActorId: actorId, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
          { kind: 'damage', sourceActorId: actorId, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'area', ignoreCover: false },
        ]);
      },
    },
  },

  // ════════════════════════════════════════════════════════════════════════
  // Terrain-create talent rows (census {terrain-create} family) — audited
  // ════════════════════════════════════════════════════════════════════════
  // 2026-08-29 adversarial audit (ICON 1.5 as authority): the F7 fold has NO
  // command-time player-input channel and fires at ability USE time, so it can
  // only represent rows whose placement is mechanically fixed, non-delayed,
  // and NOT left to a player choice. Rows whose source says "anywhere", "may",
  // "up to N" + "choose", or "after the effect expires" are therefore NOT
  // wired here — wiring them only approximated the source (about the observer
  // auto-picked cells for player choices) and has been RETRACTED so the census
  // reflects the true residual capability. Fixed-placement rows below remain
  // wired. The census {terrain-create} family is itself decomposed into precise
  // families (see scripts/canonical-class-job-census.ts).
  //
  // Architectural invariant: no source IDs in the generic placement logic.
  // Row placement uses the shared geometry (squareArea, sameCell, footprint
  // helpers) — never ad-hoc Manhattan rings.
  // ════════════════════════════════════════════════════════════════════════

  // ICON p.135 Upheaval talent 2: "The boulder bounces before landing,
  // creating a pit ANYWHERE IN FREE SPACE IN RANGE." "Anywhere" is a
  // player-chosen space, not "at the boulder's landing position." The F7
  // fold has no command-time player-input channel and cannot express a
  // player-chosen free-space placement, so this row is NOT wired. It is
  // reclassified (census {terrain-place-choice-in-range}) and awaits a
  // program-level resolver that reads the chosen cell from the command input.

  // ICON p.169 Morrigan talent 2: "After Morrigan resolves, some of the
  // winged creatures linger, creating two spaces of dangerous terrain in
  // range 2." The terrain is created at Morrigan's DELAYED resolution (the
  // start of the user's slow next turn), not at use time. The F7 fold's
  // always-trigger fires at USE and cannot express the delayed-resolve
  // timing, so this row is NOT wired (reclassified `triggered-terrain-creation`).

  // ICON p.170 Sidhe talent 1: "Also create a space of dangerous terrain
  // adjacent to your foe AFTER THE EFFECT EXPIRES." The terrain is created on
  // the toxin/effect's EXPIRY, not immediately at ability use. The F7 fold's
  // always-trigger fires at USE time and cannot express a delayed lifecycle
  // creation, so this row is NOT wired. It is reclassified (census
  // {terrain-expiry-create}) and awaits a lifecycle-level implementation.

  // ICON p.202 The Tower talent 2: "The meteor scatters debris when
  // landing, creating two spaces of difficult terrain in the area, which
  // could also be created under characters." The debris is created when the
  // END-OF-FOE-TURN meteor lands (the tower's large blast), not at use time,
  // and the area is the blast area, not a square radius. The F7 fold fires
  // at use and cannot express the landing lifecycle or the blast area, so
  // this row is NOT wired (reclassified `selectable-terrain-placement` +
  // `under-character-terrain` + `delayed-terrain`).

  // enochian:implode:talent:2 — reclassified: the pit is created by the
  // delay detonation lifecycle hook, not the ability's own mutation stream.
  // The fold cannot read lifecycle-created terrain. Program-level or
  // lifecycle-level implementation needed.

  // ICON p.225 Blitz talent 1: "When used against a BLOODIED foe, blitz
  // creates two lightning dangerous terrain spaces in FREE SPACE in range 2
  // of them." Source-exact execution requires the bloodied predicate, the
  // canonical square (Chebyshev) range 2, and a free-space (unoccupied plus
  // unimpassable) scan — none of which the no-input F7 fold can express
  // (the prior row used Manhattan radius, omitted the bloodied gate, and
  // approximated occupancy). NOT wired (reclassified `selectable-terrain-placement`).

  // ICON p.232 Tsunami talent 1: "Tsunami creates a pit in ITS CENTER SPACE
  // AFTER COMPLETING ITS MOVEMENT. The pit remains even if Tsunami moves on."
  // The prior fold read the first cell of the tsunami area (a 5x5 corner),
  // not the center, and fired at use rather than post-movement. Program-level
  // or lifecycle-level implementation needed. NOT wired (reclassified
  // `selectable-terrain-placement` + `under-character-terrain`).

  // ICON p.233 Heave-Ho talent 1: "If ONLY ONE foe is caught in the area of
  // wave, also create a pit underneath them." The prior fold picked the
  // first opponent anywhere on the map, never checking that exactly one foe
  // is in the ability's blast. The no-input fold cannot express the area
  // membership predicate, so this row is NOT wired (reclassified
  // `triggered-terrain-creation`).

  // ICON p.235 Waterspout talent 2: "If ONLY ONE foe or ally is inside the
  // waterspout, it can move 3 spaces instead, and leaves a space of difficult
  // terrain in a space it vacates." The prior fold always created difficult
  // terrain at the summon position, and the "move 3 instead" half depends on
  // the waterspout's (documented, unimplemented) movement window. NOT wired
  // (reclassified `triggered-terrain-creation`).

  // ICON p.210 Enochian Pyre talent 2: "Exceed: You may shove all characters
  // in the area 2 spaces." The exceed trigger rides the ability's attack
  // roll (the same rule the VM uses); the characters in the area are the
  // attack target (the blast center) plus every character the ability's
  // area-delivery damage affected — exactly the blast membership, since the
  // alternative talent 1 (comeback ally immunity) cannot be equipped
  // simultaneously. Each is shoved 2 away from the Pyre user.
  'enochian:pyre:talent:2': {
    mechanic: 'Exceed (attack roll 15+): shove the attack target and every character in the blast area 2 spaces away from you.',
    triggerEffect: {
      trigger: 'exceed',
      build: (actorId, targetIds, _triggerTargetIds, context): TalentEffect[] => {
        if (!context) return [];
        const source = context.state.actors[actorId];
        if (!source?.position) return [];
        const areaIds = new Set<string>(targetIds);
        for (const mutation of context.mutations) {
          if (mutation.kind === 'damage' && mutation.delivery === 'area') areaIds.add(mutation.actorId);
        }
        const results: TalentEffect[] = [];
        for (const id of areaIds) {
          const character = context.state.actors[id];
          if (!character?.position) continue;
          results.push({ kind: 'move', sourceActorId: actorId, actorId: id, movement: 'shove', distance: 2, positions: [], direction: axisDirection(source.position, character.position), phasing: false });
        }
        return results;
      },
    },
  },

  // ICON p.236 Eye of the Storm talent 1: "If there is NO CHARACTER in the
  // center space, create a pit there. The pit is also dangerous terrain."
  // The prior fold always created the pit at the target's cell and never
  // checked the explicit "no character in the center space" occupancy
  // predicate. The no-input F7 fold cannot express the occupancy check at
  // the ability's true center, so this row is NOT wired. Program-level
  // resolver implementation (gated on the equipped talent + a center
  // occupancy scan) is needed (reclassified `under-character-terrain`).

  // ── Cost-payment foundation proofs (F14, docs/rules-foundations.md §10) ──

  // ICON p.142 Knave Provoke talent 2: "You can sacrifice 2 after this
  // ability resolves to deal 2 damage again to all adjacent foes." A
  // player-chosen (optional) post-resolution sacrifice: the shared
  // sacrifice-payment mutation reduces HP as an unmitigable cost (floor 1,
  // no mitigation, no when-damaged window — the application path returns
  // before damage windows open), then every adjacent foe takes 2 normal
  // damage. The player's explicit choice is recorded in the command's
  // `talentChoices` input; the engine never assumes "yes".
  'knave:provoke:talent:2': {
    mechanic: 'Optional (player-chosen): sacrifice 2 after the ability resolves to deal 2 damage to all adjacent foes.',
    triggerEffect: {
      trigger: 'always',
      optional: true,
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const effects: TalentEffect[] = [{ kind: 'damage', sourceActorId: actorId, actorId, amount: 2, damageType: 'sacrifice', instance: 1, delivery: 'effect', ignoreCover: true }];
        for (const foe of adjacentFoes(context.state, actorId)) {
          effects.push({ kind: 'damage', sourceActorId: actorId, actorId: foe.id, amount: 2, damageType: 'normal', instance: 1, delivery: 'effect', ignoreCover: false });
        }
        return effects;
      },
    },
  },

  // ICON p.211 Enochian Pyroclast talent 2: "You may sacrifice 2 to
  // immediately shatter your target as part of this ability." Optional:
  // sacrifice 2 HP and the ability's chosen character (Pyroclast targets
  // yourself or a character in range 6) becomes shattered as part of the
  // resolution.
  'enochian:pyroclast:talent:2': {
    mechanic: 'Optional (player-chosen): sacrifice 2 to shatter the ability target as part of this ability.',
    triggerEffect: {
      trigger: 'always',
      optional: true,
      build: (actorId, targetIds) => {
        const effects: TalentEffect[] = [{ kind: 'damage', sourceActorId: actorId, actorId, amount: 2, damageType: 'sacrifice', instance: 1, delivery: 'effect', ignoreCover: true }];
        // Pyroclast's chosen character defaults to the user when none is
        // named (the resolver's own fallback).
        const targetId = targetIds[0] ?? actorId;
        effects.push({ kind: 'condition', sourceActorId: actorId, actorId: targetId, conditionId: 'shattered', operation: 'apply', potency: 'normal' });
        return effects;
      },
    },
  },

  // ICON p.211 Enochian Blackstar talent 1: "If Blackstar's special effect
  // triggers, capture your fleeing soul aether and gain 1 aether after this
  // ability resolves." Blackstar's special effect — sacrifice 50% max HP —
  // is paid by the program only before round 6; the talent mirrors that
  // exact gate and grants 1 aether after the ability resolves.
  'enochian:blackstar:talent:1': {
    mechanic: 'When Blackstar\u2019s special effect (the pre-round-6 sacrifice) triggers, gain 1 aether after the ability resolves.',
    triggerEffect: {
      trigger: 'always',
      condition: ({ state }) => state.round < 6,
      build: (actorId) => [{ kind: 'resource', actorId, resourceId: 'aether', operation: 'gain', amount: 1, minimum: 0, maximum: null }],
    },
  },

  // ICON p.180 Fool Masquerade talent 1: "If you haven't acted yet this
  // round, gain evasion after swapping until the end of your next turn."
  // The gate reads the durable once-per-round turn ledger (`turnTaken`,
  // reset at the round boundary in the same lifecycle pass that resets the
  // round ledger), so an interrupt use before the hero's own turn grants
  // evasion through the shared condition fold with an owner-scoped duration
  // — it expires at the end of the hero's next turn and no state is
  // re-decided under replay.
  'fool:masquerade:talent:1': {
    mechanic: 'If you haven\u2019t acted yet this round, gain evasion after swapping until the end of your next turn.',
    triggerEffect: {
      trigger: 'always',
      condition: ({ state, actorId }) => !state.actors[actorId].turnTaken,
      build: (actorId) => [{
        kind: 'condition',
        sourceActorId: actorId,
        actorId,
        conditionId: 'evasion',
        operation: 'apply',
        potency: 'normal',
        duration: { kind: 'turn-end', actor: { kind: 'self' }, turns: 1 },
      }],
    },
  },
};

for (const [sourceId, row] of Object.entries(WIRED_TALENT_RECIPES)) {
  registerWiredTalentRecipe(sourceId, row);
}

/** Program-level talent implementations: the ability program itself reads
 * the equipped choice (`context.state.actors[id].talents[abilityId]`) and
 * emits the variant in its own mutation stream, so the post-mutation fold
 * never sees them (and must not). Each row audits as complete through
 * `registerProgramLevelTalent`, with its source fixture and replay pair in
 * the ability's own test file. */
const PROGRAM_LEVEL_TALENT_RECIPES: Readonly<Record<string, { mechanic: string }>> = {
  // ICON p.128 Demon Cutter talent 2: "Your can rush 1 before using Demon
  // Cutter. Charge: Rush 3 instead." A pre-ability movement variant: the
  // line attack originates from the post-rush position. The program gates it
  // on the equipped talent (never on the charge trigger alone) and emits the
  // rush before the attack mutations, so the source order and the changed
  // attack origin ride the same deterministic event.
  'demon-slayer:demon-cutter:talent:2': {
    mechanic: 'Rush 1 before using Demon Cutter (charged/slow turn: rush 3 instead); the line attack originates from the post-rush position.',
  },
  // ICON p.128 Draken Cross talent 2: "Charge: Increase range to 5, and all
  // areas may be increased to medium blasts instead." The Charge trigger is
  // the gate (not Heroic — Charge and Heroic are distinct triggered effects
  // and the Talent clause says "Charge:"). The range-5 half is the shared
  // charge-gated range rule in range-recipes.ts, folded by the generic
  // USE_ABILITY/EXECUTE_RULE gate, so the ATTACK TARGET may legally be
  // chosen at range 5 on a slow turn. The program reads the equipped choice
  // and the charge trigger and, on a slow turn, upgrades BOTH blasts to
  // medium (radius 2) and extends the second-blast placement search to
  // range 5. The "may" upgrade resolves deterministically as the charged
  // reading (the player's option is only a downgrade).
  'demon-slayer:draken-cross:talent:2': {
    mechanic: 'Charge (slow turn only, never Heroic): the attack target may be chosen at range 5 through the shared charge-gated range rule, and both blasts become medium (radius 2) with the second blast centering within range 5.',
  },
  // ICON p.209 Enochian Pyre talent 1: "Comeback: Allies are immune to
  // damage from this ability." The first program-level comeback clause: the
  // Pyre resolver reads the equipped choice and, while the user is bloodied
  // (the same flag `deriveTriggers` turns into the `comeback` trigger),
  // skips allies in the ability's area damage — the blast fray and the
  // comeback/exceed re-explosion. The attack target is always a foe, and the
  // pyrotic infuse path is a separate resolver (documented).
  'enochian:pyre:talent:1': {
    mechanic: 'Comeback (user bloodied): allies are immune to this ability\u2019s area damage (the blast fray and the comeback/exceed re-explosion); the pyrotic infuse path stays a separate resolver.',
  },
  // ICON p.193 Sealer Divine Aegis talent 2: "If your ally is at 25% hp or
  // lower when marked, they also gain defiance." The mark resolver reads the
  // equipped choice and the shared quarter-HP predicate (`kernels/
  // hp-threshold.ts`) at mark time — the exact at-or-under-25% boundary.
  'sealer:divine-aegis:talent:2': {
    mechanic: 'Marking an ally at 25% hp or lower with Divine Aegis also grants them defiance (the threshold read is the shared quarter predicate).',
  },
  // ICON p.143 Knave Strongarm talent 1: "Comeback: this ability gains range
  // 2. Remove your target and place them into adjacency before activating
  // this effect." The comeback range-2 half is wired through the shared
  // range kernel (range-recipes.ts); the Strongarm program reads the
  // equipped choice and emits the remove/place reposition into a free
  // adjacent space BEFORE the spin, so the hold starts from adjacency.
  'knave:strongarm:talent:1': {
    mechanic: 'Comeback (user bloodied): the target may be chosen at range 2; the target is then removed and placed into a free adjacent space before the spin (the shared remove/place primitives through the F1 gateway).',
  },
  // ICON p.225 Spellblade Nothung talent 2: "Comeback: Increase teleport to
  // 4." A program-level comeback clause: while the user is bloodied, both of
  // the ability's player-selected teleports widen from 1 to 4 (destinations
  // stay independently chosen through the generic durable position input;
  // the second teleport is measured from the post-first position).
  'spellblade:nothung:talent:2': {
    mechanic: 'Comeback (user bloodied): both Nothung teleports widen to 4 (player-selected destinations via the generic positions input; the shared teleportMutation primitives through the F1 gateway).',
  },
  // ICON p.150 Spinning Top talent 2: "Charge: Spinning top becomes fly
  // instead." The base ability has NO Charge clause; the program reads the
  // equipped choice and only turns the dash into a fly when TII is equipped
  // AND the generic slow-turn `charge` trigger is active — a plain slow turn
  // without the talent never flies.
  'fool:spinning-top:talent:2': {
    mechanic: 'Charged (slow turn) with TII equipped: Spinning Top\u2019s dash becomes a fly instead of a rush. Without TII the rush stays ground-based even when charged.',
  },
  // ICON p.201 Chaos Tarot talent 2: "You can move Chaos Tarot's area up to
  // 2 spaces in any direction before applying the gamble effect. Charge: 4
  // spaces." The base ability has no area movement; the resolver reads the
  // equipped choice and only lets the area-center shift when TII is equipped
  // (up to 4 when charged, else 2).
  'seer:chaos-tarot:talent:2': {
    mechanic: 'TII equipped: the Chaos Tarot area-center may be moved up to 2 spaces in any direction before the gamble (up to 4 on a charged/slow turn). With no TII the area stays put.',
  },
  // ICON p.219 Terraforming talent 1: "Charge: effects can also be placed
  // in any space adjacent to the area." The base ability's OWN "Charge:
  // Choose four effects" (up from two) stays talent-independent; only the
  // adjacent-placement expansion requires TI equipped and charged.
  'geomancer:terraforming:talent:1': {
    mechanic: 'Charged (slow turn) with TI equipped: Terraforming effects may also be placed in spaces adjacent to the area. The base charge\u2019s four-effect count applies with or without the talent.',
  },
  // ICON p.219 Terraforming talent 2: "You can also create up to 3 spaces of
  // dangerous terrain in the area as a choosable effect." A SELECTABLE bullet,
  // not an automatic always rider: the resolver adds \u201cdangerous\u201d to the
  // effect palette only when TII is equipped, consumes one normal 2/Charge-4
  // choice, and the player picks 0-3 in-area spaces.
  'geomancer:terraforming:talent:2': {
    mechanic: 'TII equipped: \u201cdangerous\u201d becomes a selectable Terraforming effect (budgets one choice; the player creates 0-3 spaces of dangerous terrain, placed in the area or TI\u2019s adjacent cells).',
  },
};

for (const [sourceId, row] of Object.entries(PROGRAM_LEVEL_TALENT_RECIPES)) {
  registerProgramLevelTalent(sourceId, row.mechanic);
}

/** Continuous passive-projection talents: the mechanic is a projection the
 * shared kernel derives from current state (aura membership conditions),
 * never a fold trigger or a program-emitted variant — a durable condition
 * grant would go stale the moment membership changes. Each row audits as
 * complete through `registerPassiveProjectionTalent`, with its source
 * fixture + replay test in the aura fixtures (__tests__/aura.test.ts). */
const PASSIVE_PROJECTION_TALENT_RECIPES: Readonly<Record<string, { mechanic: string }>> = {
  // ICON p.123 Rook talent 1: "You also have counter while Rook's aura is
  // active." The Rook aura definition (jobs/aura-recipes.ts) projects counter
  // onto Rook, gated on the equipped talent.
  'bastion:rook:talent:1': {
    mechanic: 'While Rook\u2019s aura is active (the durable aura effect), Rook has counter; the projection is derived from aura membership, never a stale durable grant.',
  },
  // ICON p.179 Gentleness talent 1: "Yourself and allies inside the aura also
  // have counter in this stance." Projected through the stance-gated aura
  // definition while the talent is equipped.
  'chanter:gentleness:talent:1': {
    mechanic: 'While the Gentleness stance is held, yourself and allies inside the aura have counter (derived from stance + aura membership).',
  },
  // ICON p.178 Dervish talent 1: "A swirling aura 1 of winds surrounds you
  // after taking this ability until the start of your next turn, granting you
  // and allies inside counter." The Dervish program emits the durable aura
  // effect when the talent is equipped; the aura definition projects counter.
  'chanter:dervish:talent:1': {
    mechanic: 'Taking Dervish surrounds you with the swirling winds aura 1 until the start of your next turn; you and allies inside have counter (derived from aura membership).',
  },
};

for (const [sourceId, row] of Object.entries(PASSIVE_PROJECTION_TALENT_RECIPES)) {
  registerPassiveProjectionTalent(sourceId, row.mechanic);
}

/** Range-modifier talents: the talent's COMPLETE semantics are a listed-range
 * change on its parent ability, executed by the shared range kernel
 * (`kernels/range.ts`) at both command gates (the reviewed rules live in
 * `content/jobs/range-recipes.ts`). Each row audits as complete through
 * `registerRangeModifierTalent` with its source fixture + replay test in
 * __tests__/range.test.ts. */
const RANGE_MODIFIER_TALENT_RECIPES: Readonly<Record<string, { mechanic: string }>> = {
  // ICON p.136 Valkyrie talent 1: "Valkyrie gains range 4."
  'colossus:valkyrie:talent:1': {
    mechanic: 'Valkyrie\u2019s listed range becomes 4 through the shared effective-range authority; the attack target may be chosen at range 4.',
  },
  // ICON p.164 Incubus talent 1: "Incubus gains range 3. If you make it from
  // stealth, gains range 5."
  'shade:incubus:talent:1': {
    mechanic: 'Incubus\u2019s listed range becomes 3 (5 from stealth) through the shared effective-range authority, evaluated against the user\u2019s current stealth condition.',
  },
  // ICON p.185 Harvest talent 2: "Gains Range 2. Comeback: Range 5."
  'harvester:harvest:talent:2': {
    mechanic: 'Harvest\u2019s listed range becomes 2 (5 while the user is bloodied) through the shared effective-range authority, evaluated from current HP.',
  },
  // ICON p.194 Open the Gates talent 2: "Both versions of this ability gains
  // a range equal to the round number."
  'sealer:open-the-gates:talent:2': {
    mechanic: 'Open the Gates\u2019s listed range equals the round number through the shared effective-range authority (both the base and CENTER THE TEMPLE versions).',
  },
};

for (const [sourceId, row] of Object.entries(RANGE_MODIFIER_TALENT_RECIPES)) {
  registerRangeModifierTalent(sourceId, row.mechanic);
}

/** Bonus-damage talents (F6a): the talent's COMPLETE semantics are "this
 * ability deals bonus damage" under a source gate, executed by the bonus-
 * damage grant kernel (`kernels/bonus-damage.ts`) at the USE_ABILITY
 * boundary — the folded dice ride the ability's recorded damage roll with
 * the shared keep-highest semantics (ICON p.102). The reviewed rules live in
 * `content/jobs/bonus-damage-recipes.ts`; each row audits as complete
 * through `registerBonusDamageTalent` with its source fixture + replay test
 * in the ability's own test file. */
const BONUS_DAMAGE_TALENT_RECIPES: Readonly<Record<string, { mechanic: string }>> = {
  // ICON p.139 Low Blow talent 1: "Deals bonus damage if your foe is
  // suffering from a status."
  'knave:low-blow:talent:1': {
    mechanic: 'Low Blow\u2019s [D] damage roll gains one bonus die (ICON p.102 keep-highest) when the attack target is suffering from any status.',
  },
  // ICON p.225 Nothung talent 1: "When used against a bloodied foe, Nothung
  // deals bonus damage, and deals 1 piercing damage again to its target on
  // hit." The bonus die folds at use time; the extra 1-piercing instance is
  // emitted by the Nothung resolver under the same source condition.
  'spellblade:nothung:talent:1': {
    mechanic: 'Nothung\u2019s 2[D] attack roll gains one bonus die against a bloodied foe, and its target takes 1 piercing damage again on hit.',
  },
  // ICON p.164 Incubus talent 2: "Incubus deals bonus damage for every ally
  // of your target adjacent to your target" (scaled: one die per such ally).
  'shade:incubus:talent:2': {
    mechanic: 'Incubus\u2019s [D] attack roll gains one bonus die for every living ally of the target adjacent to the target.',
  },
  // ICON p.185 Dark Sliver talent 1: "Comeback: Deal bonus damage, and
  // increase all ranges by +1." The range half is the comeback-gated range
  // rule (range-recipes.ts); the bonus die is the same Comeback gate.
  'harvester:dark-sliver:talent:1': {
    mechanic: 'Comeback (user bloodied): Dark Sliver\u2019s [D] attack roll gains one bonus die and its listed range becomes 3.',
  },
};

for (const [sourceId, row] of Object.entries(BONUS_DAMAGE_TALENT_RECIPES)) {
  registerBonusDamageTalent(sourceId, row.mechanic);
}

/** Mark-modifier talents (F5): the talent's COMPLETE semantics are a change
 * to what an existing mark does at one of the engine's mark query points —
 * the carrier-aware mark-condition projection (with potency), the status-
 * save policy, or a turn-boundary trigger. The reviewed rows live in
 * `content/jobs/mark-modifier-recipes.ts` and `content/jobs/
 * lifecycle-recipes.ts`; each row audits as complete through
 * `registerMarkModifierTalent` with its source fixture + replay test in the
 * ability's own test file. */
const MARK_MODIFIER_TALENT_RECIPES: Readonly<Record<string, { mechanic: string }>> = {
  // ICON p.192 Grand Seal talent 1: "Bloodied foes gain +1 curse on saves
  // while marked." A mark-keyed status-save policy row (mark-modifier-
  // recipes.ts): the marked foe's saves carry the curse while it is bloodied.
  'sealer:grand-seal:talent:1': {
    mechanic: 'A foe marked by Grand Seal gains +1 curse on saves while bloodied (the mark-keyed status-save policy row reads the sealer\u2019s equipped talent 1 and the live bloodied state).',
  },
  // ICON p.192 Grand Seal talent 2: "Bloodied foes are also pacified+ while
  // marked." A carrier-aware mark-condition projection (mark-modifier-
  // recipes.ts): the marked bloodied foe has pacified with ongoing potency.
  'sealer:grand-seal:talent:2': {
    mechanic: 'A bloodied foe marked by Grand Seal is pacified+ (potency plus) while marked, derived from the carrier-aware mark-condition projection.',
  },
  // ICON p.186 Rot talent 2: "Foes that start their turn adjacent to a
  // character marked by Rot take 2 piercing damage." A turn-start lifecycle
  // trigger (lifecycle-recipes.ts) on the foe's own boundary, gated on the
  // harvester's equipped talent 2.
  'harvester:rot:talent:2': {
    mechanic: 'A foe that starts its turn adjacent to a character marked by Rot (foe-mark or REGENERATE ally-mark, owner chose talent 2) takes 2 piercing damage, once per boundary.',
  },
};

for (const [sourceId, row] of Object.entries(MARK_MODIFIER_TALENT_RECIPES)) {
  registerMarkModifierTalent(sourceId, row.mechanic);
}

/** Area-modifier talents: the talent's COMPLETE semantics are a shape/size
 * change on its parent ability's area, executed by the shared area kernel
 * (`kernels/area.ts`) inside the parent resolver (the reviewed rules live in
 * `content/jobs/area-recipes.ts`). Each row audits as complete through
 * `registerAreaModifierTalent` with its source fixture + replay test in
 * __tests__/area.test.ts. */
const AREA_MODIFIER_TALENT_RECIPES: Readonly<Record<string, { mechanic: string }>> = {
  // ICON p.158 Soul Shot talent 2: "At round 4 or greater, Soul Shot becomes
  // Line 6." The line length derives from the shared effective-area
  // authority (round gate + equipped choice) inside the Soul Shot resolver;
  // the attack target must still lie in the effective line.
  'freelancer:soul-shot:talent:2': {
    mechanic: 'Soul Shot\u2019s line extends to Line 6 from round 4 onward through the shared effective-area authority; the attack target must still lie in the effective line.',
  },
};

for (const [sourceId, row] of Object.entries(AREA_MODIFIER_TALENT_RECIPES)) {
  registerAreaModifierTalent(sourceId, row.mechanic);
}

/** Classify a documented talent by the kernel it needs. Advisory build-time
 * categorization, never parsed at runtime — the runtime fold only reads the
 * explicit `wired` rows. */
export function documentedTalentDetail(unit: RuleSourceUnit): string {
  const text = unit.rulesText;
  const needs = (pattern: RegExp, kernel: string) => (pattern.test(text) ? kernel : null);
  const kernel = needs(/slay/, 'slay-trigger kernel hook (fires after the ability defeats a foe)')
    ?? needs(/collide/, 'collide-trigger kernel hook (fires when the ability collides a character)')
    // The finishing-blow trigger is wired (fires against a bloodied target);
    // the remaining rows carry their specific blockers past the trigger.
    ?? needs(/finishing blow[^.]*teleport|teleport[^.]*finishing blow/i, 'teleport-choice input hook (the teleport destinations are player choices the command surface must carry)')
    ?? needs(/finishing blow[^.]*mark|mark[^.]*finishing blow/i, 'mark-transfer hook (a may-choice mark redirect needing cross-command mark state)')
    ?? needs(/finishing blow/i, 'finishing-blow-trigger kernel hook beyond the wired tranche (fires against a bloodied target)')
    ?? needs(/exceed/i, 'exceed-trigger kernel hook beyond the wired tranche')
    ?? needs(/comeback/i, 'comeback-trigger kernel hook beyond the wired tranche')
    ?? needs(/charge/i, 'charge-trigger kernel hook (fires while the user is slow)')
    ?? needs(/gamble/, 'gamble hook (extra dice / gamble-result branching)')
    ?? needs(/sacrifice/i, 'sacrifice hook (HP-for-effect caller choice)')
    ?? needs(/blessing/i, 'blessing-token spend hook (ability-use blessing spend)')
    ?? needs(/combo token/i, 'combo-token spend hook (base/combo version swap)')
    ?? needs(/aura/i, 'aura mechanic (spatial aura effects)')
    ?? needs(/stance/i, 'stance hook (stance-gated modifier)')
    ?? needs(/summon/i, 'summon hook (summon action/effect text)')
    ?? needs(/shadow|beast|bomb|thrall|plant|sprite/i, 'summon hook (entity-triggered effect)')
    ?? needs(/teleport/i, 'teleport-modifier hook (position choice on the ability)')
    ?? needs(/shove/i, 'shove-modifier hook (shove distance/direction choice)')
    ?? needs(/pit|difficult terrain|dangerous terrain|terrain/i, 'terrain-effect hook (creates/changes terrain or objects)')
    ?? needs(/fly|rush|dash|movement/i, 'movement-modifier hook (pre/post-ability movement)')
    ?? needs(/cover/i, 'cover mechanic (spatial cover grant)')
    ?? needs(/cure/i, 'cure hook (status-cure on a trigger)')
    ?? needs(/range/i, 'range-modifier hook (distance-gated range increase)')
    ?? needs(/vigor/i, 'vigor-grant hook (amount/circumstance)')
    ?? needs(/evasion|defiance|counter|sturdy|unstoppable|phasing|stealth|dodge|regeneration/i, 'condition-grant hook (durable condition on a trigger)')
    ?? needs(/bloodied|25% hp|hp or lower/i, 'bloodied-gate hook (conditioned on target/self hp)')
    ?? needs(/mark/i, 'mark hook (mark-stack gate or mark-triggered effect)')
    ?? 'ability-specific modifier hook (needs a typed resolver for this ability)';
  return `Table-facing: needs ${/^[aeiou]/i.test(kernel) ? 'an' : 'a'} ${kernel} before it can execute deterministically.`;
}

/** The closed 288-row inventory. Built from the source manifest passed in by
 * the caller (fixtures and the audit pass `collectRuleSourceUnits()`), so the
 * ids are exact by construction — the catalog test enforces the same 288-id
 * equality. This module deliberately does NOT import the manifest itself:
 * the catalog imports manual-programs, which imports this module, and the
 * manifest imports the catalog — a self-import here would evaluate against a
 * half-initialized catalog (the wired table above is explicit and never
 * touches the manifest). */
export function getTalentRecipes(units: readonly RuleSourceUnit[]): Readonly<Record<string, TalentRecipe>> {
  return Object.fromEntries(
    units
      .filter((unit) => unit.kind === 'talent')
      .map((unit) => {
        const wired = WIRED_TALENT_RECIPES[unit.id];
        const programLevel = PROGRAM_LEVEL_TALENT_RECIPES[unit.id];
        const passive = PASSIVE_PROJECTION_TALENT_RECIPES[unit.id];
        const rangeModifier = RANGE_MODIFIER_TALENT_RECIPES[unit.id];
        const areaModifier = AREA_MODIFIER_TALENT_RECIPES[unit.id];
        const bonusDamage = BONUS_DAMAGE_TALENT_RECIPES[unit.id];
        const markModifier = MARK_MODIFIER_TALENT_RECIPES[unit.id];
        const executable = wired ?? programLevel ?? passive ?? rangeModifier ?? areaModifier ?? bonusDamage ?? markModifier;
        return [unit.id, {
          sourceId: unit.id,
          abilityId: unit.parentId ?? '',
          name: unit.name,
          status: wired ? 'wired' as const : programLevel ? 'program-level' as const : passive ? 'passive-projection' as const : rangeModifier ? 'range-modifier' as const : areaModifier ? 'area-modifier' as const : bonusDamage ? 'bonus-damage' as const : markModifier ? 'mark-modifier' as const : 'documented' as const,
          mechanic: wired?.mechanic ?? programLevel?.mechanic ?? passive?.mechanic ?? rangeModifier?.mechanic ?? areaModifier?.mechanic ?? bonusDamage?.mechanic ?? markModifier?.mechanic ?? '',
          detail: executable ? '' : documentedTalentDetail(unit),
          ...(wired ? { triggerEffect: wired.triggerEffect } : {}),
        }];
      }),
  );
}

/** Exposed for the closed-registry fixtures: every documented row stays
 * source-visible and must never gain a guessed resolver. */
export function getDocumentedTalentIds(units: readonly RuleSourceUnit[]): ReadonlySet<string> {
  return new Set(
    Object.values(getTalentRecipes(units)).filter((recipe) => recipe.status === 'documented').map((recipe) => recipe.sourceId),
  );
}
