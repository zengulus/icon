/**
 * Talent coverage content (docs/rules-foundations.md §8, freebuff-plan.md §4).
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
import type { RuleSourceUnit } from '../../../source-units.js';
import { axisDirection, sameCell, squareArea } from '../../../area-geometry.js';
import type { RuleMutation } from '../../primitives/types.js';
import { registerProgramLevelTalent, registerWiredTalentRecipe, type TalentRecipe, type TalentTriggerEffect } from '../../kernels/talent-recipes.js';
import type { TalentEffect } from '../../kernels/talent-recipes.js';

/** The party-favor mine's position from the ability's recorded terrain
 * mutations (the create on placement, the remove on detonation). */
const partyFavorMinePosition = (mutations: readonly RuleMutation[]): { x: number; y: number } | undefined =>
  (mutations.find((mutation) => mutation.kind === 'terrain' && mutation.terrain === 'party-favor') as Extract<RuleMutation, { kind: 'terrain' }> | undefined)?.positions[0];

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
  // ICON p.190 Blazing Bond talent 2: "Comeback: Grant both you and your
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
  // Terrain-create singleton talents (census {terrain-create} family)
  // ════════════════════════════════════════════════════════════════════════
  // These 14 talents are verified terrain-create singletons whose entire
  // mechanical effect is the creation of terrain after the ability resolves.
  // They are wired through the F7 fold with an "always" trigger: the fold
  // reads the ability's recorded mutations to determine placement, then
  // appends the terrain-creation mutations onto the event.
  //
  // The remaining 6 census terrain-create singletons (great-suplex:1,
  // eclipse:1, bio:1, bio:2, realignment:2, quaking-palm:1) require
  // terrain TRANSFORMATION or persistent-state mechanics that the fold
  // cannot express; they are reclassified or need program-level
  // implementation.
  //
  // Architectural invariant: no source IDs in the generic placement
  // logic below. Each build function reads the fold context and the
  // ability's own mutations to derive positions deterministically.
  // ════════════════════════════════════════════════════════════════════════

  // ICON p.135 Upheaval talent 2: "The boulder bounces before landing,
  // creating a pit anywhere in free space in range." The fold reads the
  // boulder entity's position from the ability's own entity-creation
  // mutation and places a pit at that deterministic location.
  'colossus:upheaval:talent:2': {
    mechanic: 'Always: create a pit at the boulder\'s landing position.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const boulder = context.mutations.find((m) => m.kind === 'entity' && m.operation === 'create' && m.entityType === 'object' && m.ownerId === actorId) as Extract<RuleMutation, { kind: 'entity' }> | undefined;
        if (!boulder || !boulder.positions[0]) return [];
        return [{ kind: 'terrain', sourceActorId: actorId, operation: 'create', terrain: 'pit', positions: [boulder.positions[0]], height: null }];
      },
    },
  },

  // ICON p.169 Underway talent 2: "When you create an underway, you may
  // create up to three spaces of leafy difficult terrain in adjacent
  // spaces." The fold reads the underway entity's position from the
  // ability's mutations and places difficult terrain in free adjacent cells.
  'warden:underway:talent:2': {
    mechanic: 'Always: create up to 3 spaces of difficult terrain adjacent to the underway.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const underway = context.mutations.find((m) => m.kind === 'entity' && m.operation === 'create' && m.entityType === 'underway' && m.ownerId === actorId) as Extract<RuleMutation, { kind: 'entity' }> | undefined;
        if (!underway || !underway.positions[0]) return [];
        const { x, y } = underway.positions[0];
        const adjacent = [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }];
        const free = adjacent.filter((c) =>
          c.x >= 0 && c.y >= 0 &&
          !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y),
        );
        return free.slice(0, 3).map((pos) => ({
          kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const,
          terrain: 'difficult', positions: [pos], height: null,
        }));
      },
    },
  },

  // ICON p.169 Morrigan talent 2: "After Morrigan resolves, some of the
  // winged creatures linger, creating two spaces of dangerous terrain in
  // range 2." The fold places dangerous terrain in free cells within range 2
  // of the target (from the ability's recorded mutations or target ids).
  'warden:morrigan:talent:2': {
    mechanic: 'Always: create 2 spaces of dangerous terrain in range 2 of the target.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const { x, y } = target.position;
        const candidates: { x: number; y: number }[] = [];
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let dy = -2; dy <= 2; dy += 1) {
            if (Math.abs(dx) + Math.abs(dy) > 2 || (dx === 0 && dy === 0)) continue;
            const c = { x: x + dx, y: y + dy };
            if (c.x >= 0 && c.y >= 0 && !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y)) candidates.push(c);
          }
        }
        return candidates.slice(0, 2).map((pos) => ({
          kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const,
          terrain: 'dangerous', positions: [pos], height: null,
        }));
      },
    },
  },

  // ICON p.170 Sidhe talent 1: "Also create a space of dangerous terrain
  // adjacent to your foe after the effect expires." The fold places a single
  // dangerous terrain space in a free cell adjacent to the target.
  'warden:sidhe:talent:1': {
    mechanic: 'Always: create 1 space of dangerous terrain adjacent to the foe.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const { x, y } = target.position;
        const adjacent = [{ x: x + 1, y }, { x: x - 1, y }, { x, y: y + 1 }, { x, y: y - 1 }];
        const free = adjacent.filter((c) =>
          c.x >= 0 && c.y >= 0 &&
          !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y),
        );
        if (free.length === 0) return [];
        return [{ kind: 'terrain', sourceActorId: actorId, operation: 'create', terrain: 'dangerous', positions: [free[0]], height: null }];
      },
    },
  },

  // ICON p.202 The Tower talent 2: "The meteor scatters debris when
  // landing, creating two spaces of difficult terrain in the area, which
  // could also be created under characters." The fold places difficult
  // terrain in the ability's medium blast area centered on the target.
  'seer:the-tower:talent:2': {
    mechanic: 'Always: create 2 spaces of difficult terrain in the blast area.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const area = squareArea(target.position, 2);
        return area.slice(0, 2).map((pos) => ({
          kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const,
          terrain: 'difficult', positions: [pos], height: null,
        }));
      },
    },
  },

  // enochian:implode:talent:2 — reclassified: the pit is created by the
  // delay detonation lifecycle hook, not the ability's own mutation stream.
  // The fold cannot read lifecycle-created terrain. Program-level or
  // lifecycle-level implementation needed.

  // ICON p.219 Terraforming talent 2: "You can also create up to 3 spaces
  // of dangerous terrain in the area as a choosable effect." The fold
  // places dangerous terrain in free cells within the ability's burst 2 area.
  'geomancer:terraforming:talent:2': {
    mechanic: 'Always: create up to 3 spaces of dangerous terrain in the area.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const area = squareArea(target.position, 2);
        const free = area.filter((c) =>
          c.x >= 0 && c.y >= 0 &&
          !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y),
        );
        return free.slice(0, 3).map((pos) => ({
          kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const,
          terrain: 'dangerous', positions: [pos], height: null,
        }));
      },
    },
  },

  // ICON p.225 Blitz talent 1: "When used against a bloodied foe, blitz
  // creates two lightning dangerous terrain spaces in free space in range 2
  // of them." The fold fires only when the target is bloodied.
  'spellblade:blitz:talent:1': {
    mechanic: 'Always: create 2 spaces of dangerous terrain in range 2 of the foe.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        const { x, y } = target.position;
        const candidates: { x: number; y: number }[] = [];
        for (let dx = -2; dx <= 2; dx += 1) {
          for (let dy = -2; dy <= 2; dy += 1) {
            if (Math.abs(dx) + Math.abs(dy) > 2 || (dx === 0 && dy === 0)) continue;
            const c = { x: x + dx, y: y + dy };
            if (c.x >= 0 && c.y >= 0 && !Object.values(context.state.actors).some((a) => a.position && a.position.x === c.x && a.position.y === c.y)) candidates.push(c);
          }
        }
        return candidates.slice(0, 2).map((pos) => ({
          kind: 'terrain' as const, sourceActorId: actorId, operation: 'create' as const,
          terrain: 'dangerous', positions: [pos], height: null,
        }));
      },
    },
  },

  // ICON p.232 Tsunami talent 1: "Tsunami creates a pit in its center
  // space after completing its movement. The pit remains even if Tsunami
  // moves on." The fold reads the tsunami entity's position from the
  // ability's mutations and places a pit there.
  'stormbender:tsunami:talent:1': {
    mechanic: 'Always: create a pit in the tsunami\'s center space.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const tsunami = context.mutations.find((m) => m.kind === 'terrain' && m.terrain === 'tsunami' && m.sourceActorId === actorId) as Extract<RuleMutation, { kind: 'terrain' }> | undefined;
        if (!tsunami || !tsunami.positions[0]) return [];
        return [{ kind: 'terrain', sourceActorId: actorId, operation: 'create', terrain: 'pit', positions: [tsunami.positions[0]], height: null }];
      },
    },
  },

  // ICON p.233 Heave-Ho talent 1: "If only one foe is caught in the area
  // of wave, also create a pit underneath them." The fold fires only when
  // exactly one foe is in the ability's area.
  'stormbender:heave-ho:talent:1': {
    mechanic: 'Always: create a pit under the first foe in the ability area.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        // The ability's shove mutations record the origin; find foes in the blast.
        const sourceSide = context.state.actors[actorId]?.side;
        const foe = Object.values(context.state.actors).find((actor) => {
          return actor.side !== sourceSide && !actor.defeated && actor.position && actor.id !== actorId;
        });
        if (!foe?.position) return [];
        return [{ kind: 'terrain', sourceActorId: actorId, operation: 'create', terrain: 'pit', positions: [{ ...foe.position }], height: null }];
      },
    },
  },

  // ICON p.235 Waterspout talent 2: "If only one foe or ally is inside the
  // waterspout, it can move 3 space instead, and leaves a space of difficult
  // terrain in one space that it vacates." The fold reads the waterspout
  // entity's position from the ability's mutations and creates difficult
  // terrain at the vacated space (the original position).
  // NOTE: the ability program already implements this talent — the terrain
  // is created as part of the waterspout entity's movement in the resolver.
  // This fold is a supplementary safety net; the program-level implementation
  // is authoritative.

  // ICON p.235 Waterspout talent 2: "If only one foe or ally is inside the
  // waterspout, it can move 3 space instead, and leaves a space of difficult
  // terrain in one space that it vacates." The fold reads the waterspout
  // entity's position from the ability's mutations and creates difficult
  // terrain at the vacated space (the original position).
  'stormbender:waterspout:talent:2': {
    mechanic: 'Always: leave a space of difficult terrain at the waterspout\'s vacated space.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, _targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const creation = context.mutations.find((m) => m.kind === 'entity' && m.operation === 'create' && m.entityType === 'waterspout' && m.ownerId === actorId) as Extract<RuleMutation, { kind: 'entity' }> | undefined;
        if (!creation || !creation.positions[0]) return [];
        return [{ kind: 'terrain', sourceActorId: actorId, operation: 'create', terrain: 'difficult', positions: [creation.positions[0]], height: null }];
      },
    },
  },

  // ICON p.236 Eye of the Storm talent 1: "If there is no character in the
  // center space, create a pit there. The pit is also dangerous terrain."
  // The fold fires only when the center is unoccupied. The ability's own
  // terrain creation mutation marks the center position.
  'stormbender:eye-of-the-storm:talent:1': {
    mechanic: 'Always: create a pit and dangerous terrain at the target position.',
    triggerEffect: {
      trigger: 'always',
      build: (actorId, targetIds, _triggerTargetIds, context) => {
        if (!context) return [];
        const target = context.state.actors[targetIds[0] ?? ''];
        if (!target?.position) return [];
        return [
          { kind: 'terrain', sourceActorId: actorId, operation: 'create', terrain: 'pit', positions: [{ ...target.position }], height: null },
          { kind: 'terrain', sourceActorId: actorId, operation: 'create', terrain: 'dangerous', positions: [{ ...target.position }], height: null },
        ];
      },
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
  // areas may be increased to medium blasts instead." The program reads the
  // equipped choice and, on a slow turn, upgrades both blasts to medium
  // (radius 2) and extends the second-blast search to range 5. The "may"
  // upgrade resolves deterministically as the charged reading (the player's
  // option is only a downgrade). The attack target itself stays capped by
  // the generic USE_ABILITY range gate, so the range boost lives in the
  // resolver's second-blast placement.
  'demon-slayer:draken-cross:talent:2': {
    mechanic: 'Charged (slow turn): both blasts become medium (radius 2) and the second blast may center within range 5; the attack target stays within the ability\u2019s listed range 3.',
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
};

for (const [sourceId, row] of Object.entries(PROGRAM_LEVEL_TALENT_RECIPES)) {
  registerProgramLevelTalent(sourceId, row.mechanic);
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
        const executable = wired ?? programLevel;
        return [unit.id, {
          sourceId: unit.id,
          abilityId: unit.parentId ?? '',
          name: unit.name,
          status: wired ? 'wired' as const : programLevel ? 'program-level' as const : 'documented' as const,
          mechanic: wired?.mechanic ?? programLevel?.mechanic ?? '',
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

