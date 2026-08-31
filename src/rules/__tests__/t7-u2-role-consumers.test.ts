/**
 * t7-u2-role-consumers.test.ts — U2 ROLE / PERSPECTIVE consumer consolidation.
 *
 * The U2 vocabulary (`primitives/roles.ts`) already exists; this suite proves
 * the CONSUMERS derive semantic roles through it rather than inferring
 * source/owner/controller/chooser/perspective from incidental fields.
 *
 *  - relation reads: the self/ally/foe PERSPECTIVE is the U2 source role
 *    (`relationPerspectiveIdFromContext`), never an incidental actor id
 *    (`kernels/candidate.ts` derives it through roles so U3 eligibility
 *    compares the source's SIDE — side stays an underlying fact, U2 picks
 *    whose perspective establishes it).
 *  - aura membership: the ally/foe perspective is SEPARATE from the spatial
 *    origin (ROLE ≠ ANCHOR). An entity-origin aura's spatial origin is the
 *    entity; its ally/foe perspective is the entity's CREATOR/OWNER. An
 *    ownerless (or neutral) origin has NO derivable ally/foe — only
 *    `characters` relations apply, never a manufactured side.
 *  - window/choice responder: `windowResponderId(selector, frame)` resolves
 *    the entitled responder through U2 (subject-relative controller-of), and
 *    an underivable responder FAILS CLOSED (never a fallback to the source /
 *    active actor / session owner). Replay derives the same responder from
 *    the durable frame.
 */
import { describe, expect, it } from 'vitest';
import type { RuleExecutionContext } from '../automation/primitives/types.js';
import {
  auraRelationPerspectiveId,
  deriveRoles,
  relationPerspectiveId,
  relationPerspectiveIdFromContext,
  resolveRoleSelector,
  roleFrameFromContext,
  windowResponderId,
  type RoleFrame,
  type RoleSelector,
} from '../automation/primitives/roles.js';
import { validateActorCandidate } from '../automation/kernels/candidate.js';
import {
  auraOriginRefs,
  isAuraMember,
  membersOfAura,
  type AuraDefinition,
  type AuraStateView,
} from '../automation/kernels/aura.js';

function actor(
  id: string,
  side: 'heroes' | 'foes',
  position: { x: number; y: number } | null,
): RuleExecutionContext['state']['actors'][string] {
  return {
    id, side, position, absent: false,
  } as unknown as RuleExecutionContext['state']['actors'][string];
}

/** A minimal query context: the candidate authority needs `state.actors`
 * (with id/side/position/defeated) + `context.actorId` for the relation
 * perspective through U2. */
function queryCtx(overrides: Partial<RuleExecutionContext> = {}): RuleExecutionContext {
  return {
    state: {
      round: 1,
      grid: { width: 24, height: 24 },
      actors: {
        hero: actor('hero', 'heroes', { x: 4, y: 4 }),
        ally: actor('ally', 'heroes', { x: 6, y: 4 }),
        foe: actor('foe', 'foes', { x: 8, y: 4 }),
      },
      entities: {},
      terrainAt: () => new Set<string>(),
      elevationAt: () => 0,
      terrainEffects: [],
    },
    actorId: 'hero',
    sourceId: 'test:source',
    actionId: 'default',
    timing: 'use',
    input: {},
    dice: { die: () => 1 },
    ...overrides,
  } as RuleExecutionContext;
}

/** A minimal aura state view: actors + entities with the fields the aura
 * kernel reads (side/position/size/defeated/onBattlefield + entity
 * ownerId/type/position). */
const AURA_ACTOR = (id: string, side: 'heroes' | 'foes', position: { x: number; y: number } | null): AuraStateView['actors'][string] => ({
  id, side, position, size: 1, defeated: false, onBattlefield: true,
});

const ENTITY = (id: string, type: string, ownerId: string | null, position: { x: number; y: number }): NonNullable<AuraStateView['entities']>[string] => ({
  id, type, ownerId, position,
});

describe('U2 — relation perspective is the U2 source role (ROLE ≠ incidental actor)', () => {
  it('relationPerspectiveId derives the perspective from the SOURCE role of the durable frame', () => {
    const frame: RoleFrame = { sourceId: 'hero', targetId: 'foe' };
    expect(relationPerspectiveId(frame)).toBe('hero');
  });

  it('the context seam maps the relation perspective onto the legacy source slot (never an independent read)', () => {
    expect(relationPerspectiveIdFromContext(queryCtx())).toBe('hero');
    expect(relationPerspectiveId(roleFrameFromContext(queryCtx({ actorId: 'ally' })))).toBe('ally');
  });

  it('candidate relation eligibility compares the U2-derived source side (p.92 "another living ally")', () => {
    // hero (heroes side) is the source role → ally and foe resolve by side.
    expect(validateActorCandidate('ally', { relation: 'ally' }, queryCtx()).legal).toBe(true);
    expect(validateActorCandidate('foe', { relation: 'foe' }, queryCtx()).legal).toBe(true);
    expect(validateActorCandidate('foe', { relation: 'ally' }, queryCtx()).legal).toBe(false);
    // The same SIDE is never its own ally (self-collapse).
    expect(validateActorCandidate('hero', { relation: 'ally' }, queryCtx()).legal).toBe(false);
  });

  it('a character is never its own ally merely because its side matches (self-relation)', () => {
    const context = queryCtx();
    const map = deriveRoles(roleFrameFromContext(context));
    expect(map.roles.source).toBe('hero');
    // source == candidate id → self, never ally (p.92 requires "another").
    expect(resolveRoleSelector({ kind: 'role', role: 'source' }, map)).toBe('hero');
  });
});

describe('U2 — aura: spatial origin ≠ semantic perspective (ROLE ≠ ANCHOR)', () => {
  /** An entity-origin aura only affects `characters` (no ally/foe claim). */
  const charactersAura: AuraDefinition = {
    sourceId: 'fixture:neutral-entity',
    origin: { kind: 'entity-type', entityType: 'beacon' },
    radius: 2,
    relations: ['characters'],
    includesOrigin: false,
  };
  /** An entity-origin aura that claims `allies` relative to the entity's
   * CREATOR/OWNER. */
  const alliesAura: AuraDefinition = {
    sourceId: 'fixture:allied-entity',
    origin: { kind: 'entity-type', entityType: 'beacon' },
    radius: 2,
    relations: ['allies'],
    includesOrigin: false,
  };

  it('entity-origin aura: spatial origin is the ENTITY, ally/foe perspective is the OWNER', () => {
    // beacon at (5,5), owned by a hero (heroes side). An ally of the owner at
    // (6,5) is inside and a member; a foe at (6,5) is NOT an ally and is not
    // a member under the allies-only row.
    const view: AuraStateView = {
      actors: {
        hero: AURA_ACTOR('hero', 'heroes', { x: 9, y: 9 }),
        allyIn: AURA_ACTOR('allyIn', 'heroes', { x: 6, y: 5 }),
        foeIn: AURA_ACTOR('foeIn', 'foes', { x: 6, y: 5 }),
      },
      entities: { beacon: ENTITY('beacon', 'beacon', 'hero', { x: 5, y: 5 }) },
    };
    expect(isAuraMember(view, alliesAura, auraOriginRefs(view, alliesAura)[0]!, 'allyIn')).toBe(true);
    expect(isAuraMember(view, alliesAura, auraOriginRefs(view, alliesAura)[0]!, 'foeIn')).toBe(false);
  });

  it('entity-origin aura: the entity itself is never its own ally (no member slot)', () => {
    // membersOfAura returns only ACTORS; an entity is a spatial origin, not a
    // member. Only the allied actor inside is a member.
    const view: AuraStateView = {
      actors: {
        hero: AURA_ACTOR('hero', 'heroes', { x: 9, y: 9 }),
        allyIn: AURA_ACTOR('allyIn', 'heroes', { x: 6, y: 5 }),
      },
      entities: { beacon: ENTITY('beacon', 'beacon', 'hero', { x: 5, y: 5 }) },
    };
    expect(membersOfAura(view, alliesAura)).toEqual(['allyIn']);
  });

  it('an OWNERLESS (neutral) entity has no derivable ally/foe — only `characters` relations apply', () => {
    // Two auras centered on the same ownerless beacon: the `allies` row must
    // manufacture NOTHING (no side to interpret relative to), while the
    // `characters` row still includes actors inside.
    const view: AuraStateView = {
      actors: {
        anyIn: AURA_ACTOR('anyIn', 'heroes', { x: 6, y: 5 }),
      },
      entities: { beacon: ENTITY('beacon', 'beacon', null, { x: 5, y: 5 }) },
    };
    expect(membersOfAura(view, alliesAura)).toEqual([]);           // no ally perspective derivable
    expect(membersOfAura(view, charactersAura)).toEqual(['anyIn']); // characters relation still applies
  });

  it('actor-origin aura: the SEMANTIC perspective is the bearer (U2), routed through the U2 authority — confirmed on the origin ref', () => {
    // An actor-trait aura (Commander's Aura) — the bearer is both the U7
    // spatial anchor and the U2 perspective subject, but the perspective is
    // still obtained through the U2 authority (never derived locally).
    const actorAura: AuraDefinition = {
      sourceId: 'fixture:actor-aura',
      origin: { kind: 'actor-trait', traitId: 'commander' },
      radius: 2,
      relations: ['allies'],
      includesOrigin: true,
    };
    const view: AuraStateView = {
      actors: {
        hero: { ...AURA_ACTOR('hero', 'heroes', { x: 5, y: 5 }), traitIds: ['commander'] },
        ally: AURA_ACTOR('ally', 'heroes', { x: 6, y: 5 }),
      },
    };
    const origins = auraOriginRefs(view, actorAura);
    // The semantic perspective is the bearer hero (U2), identical to its role.
    expect(origins).toHaveLength(1);
    expect(origins[0]!.perspectiveActorId).toBe('hero');
    expect(isAuraMember(view, actorAura, origins[0]!, 'ally')).toBe(true);
    // ROLE ≠ ANCHOR is still representable: even for an actor origin, the
    // perspective actor id is a U2-derived value, not an incidental side read.
    expect(origins[0]!.actorId).toBe('hero');
  });

  it('source/anchor ≠ perspective survives for entity origins (creator != spatial origin)', () => {
    // An entity-origin aura whose owner/creator is hero, while the SPATIAL
    // origin is the beacon entity. The perspective is the owner (U2) and the
    // spatial anchor stays the entity — the two never collapse.
    const view: AuraStateView = {
      actors: {
        hero: AURA_ACTOR('hero', 'heroes', { x: 9, y: 9 }),
        allyIn: AURA_ACTOR('allyIn', 'heroes', { x: 6, y: 5 }),
      },
      entities: { beacon: ENTITY('beacon', 'beacon', 'hero', { x: 5, y: 5 }) },
    };
    const origin = auraOriginRefs(view, alliesAura)[0]!;
    // Spatial origin is the ENTITY; the ally/foe perspective is the OWNER.
    expect(origin.entityId).toBe('beacon');
    expect(origin.actorId).toBeNull();
    expect(origin.perspectiveActorId).toBe('hero');
  });

  it('replay produces the identical semantic perspective (deterministic U2 route)', () => {
    const view: AuraStateView = {
      actors: {
        hero: AURA_ACTOR('hero', 'heroes', { x: 9, y: 9 }),
        allyIn: AURA_ACTOR('allyIn', 'heroes', { x: 6, y: 5 }),
      },
      entities: { beacon: ENTITY('beacon', 'beacon', 'hero', { x: 5, y: 5 }) },
    };
    const first = auraOriginRefs(view, alliesAura)[0]!;
    const second = auraOriginRefs(view, alliesAura)[0]!;
    expect(first.perspectiveActorId).toBe(second.perspectiveActorId);
    expect(first.perspectiveActorId).toBe('hero');
    // A parameter-free pure route: the same durable facts always derive the same
    // perspective actor (the U2 authority is a pure function of the facts).
    expect(auraRelationPerspectiveId({ kind: 'entity', creatorOrOwnerId: 'hero' })).toBe('hero');
    expect(auraRelationPerspectiveId({ kind: 'entity', creatorOrOwnerId: null })).toBeNull();
    expect(auraRelationPerspectiveId({ kind: 'actor', bearerId: 'hero' })).toBe('hero');
  });

  it('ROLE ≠ ANCHOR: moving the entity spatial origin does not change the owner perspective membership', () => {
    // The ally is at the edge of the owner's Aura 2. When the ENTITY moves
    // away, membership (geometry) drops even though the owner/perspective
    // side is unchanged — proving the spatial origin is independent of the
    // perspective role.
    const view: AuraStateView = {
      actors: {
        hero: AURA_ACTOR('hero', 'heroes', { x: 9, y: 9 }),
        allyIn: AURA_ACTOR('allyIn', 'heroes', { x: 6, y: 5 }),
      },
      entities: { beacon: ENTITY('beacon', 'beacon', 'hero', { x: 5, y: 5 }) },
    };
    const near = auraOriginRefs(view, alliesAura)[0]!;
    expect(isAuraMember(view, alliesAura, near, 'allyIn')).toBe(true);
    // Move the beacon to (9,5): the ally is now distance 3 → outside.
    const movedView: AuraStateView = {
      actors: view.actors,
      entities: { beacon: ENTITY('beacon', 'beacon', 'hero', { x: 9, y: 5 }) },
    };
    const far = auraOriginRefs(movedView, alliesAura)[0]!;
    expect(isAuraMember(movedView, alliesAura, far, 'allyIn')).toBe(false);
  });
});

describe('U2 — window/choice responder derivation through the durable frame', () => {
  const targetController: RoleSelector = { kind: 'controller-of', subject: 'target' };

  it('positive: the responder for a TARGET_CONTROLLER window resolves to the TARGET controller, not the source', () => {
    const frame: RoleFrame = {
      sourceId: 'hero',
      targetId: 'foe',
      controllers: { source: 'player-a', target: 'player-b' },
    };
    expect(windowResponderId(targetController, frame)).toBe('player-b');
    // Source-controller differs from target-controller in the same resolution.
    expect(resolveRoleSelector({ kind: 'controller-of', subject: 'source' }, deriveRoles(frame))).toBe('player-a');
  });

  it('negative: an underivable responder fails closed (missing controller for a valid subject)', () => {
    const frame: RoleFrame = { sourceId: 'hero', targetId: 'foe', controllers: {} };
    expect(windowResponderId(targetController, frame)).toBeNull();
  });

  it('negative: a missing subject (no target) fails closed, never falls back to the source', () => {
    const frame: RoleFrame = { sourceId: 'hero', controllers: { target: 'player-b' } };
    expect(windowResponderId(targetController, frame)).toBeNull();
  });

  it('replay: the same durable frame derives the same responder (deterministic)', () => {
    const frame: RoleFrame = {
      sourceId: 'hero',
      targetId: 'foe',
      controllers: { target: 'player-b' },
    };
    expect(windowResponderId(targetController, frame)).toBe(windowResponderId(targetController, frame));
    expect(windowResponderId(targetController, frame)).toBe('player-b');
  });
});