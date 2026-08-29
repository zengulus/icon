import type { EncounterEntity } from '../../types.js';

/** The two source entity categories (ICON p.95). */
export type EntityKind = 'summon' | 'object';

/** ICON p.95 distinguishes SUMMONS from OBJECTS with materially different rules
 * (lifecycle, intangibility, stacking). This is the CENTRAL registry that maps
 * a literal entity type to its category — the only place literal type strings
 * are interpreted; reducers/resolvers must call `entityKind`/`entityKindOf`
 * and never re-infer the category from a type name. A type not listed is a
 * summon (the conservative ephemeral default). COMPANIONS are always summons
 * regardless of type; an explicit `kind` on a mutation/entity record overrides
 * the registry. */
const OBJECT_TYPES = new Set<string>([
  'object',
  'boulder',
  'statue',
  'meteor',
  'underway',
  'shrine',
  'lightning-spike',
  'geyser',
  'waterspout',
  'aethershard',
  'magma-spire',
  'polearm',
  'greatshield',
]);

/** The source category for a literal entity type. */
export function entityKind(entityType: string): EntityKind {
  return OBJECT_TYPES.has(entityType) ? 'object' : 'summon';
}

/** The effective category of an entity record (explicit kind wins, else a
 * persistent companion is a summon, else the registry). */
export function entityKindOf(entity: Pick<EncounterEntity, 'type' | 'kind' | 'state'>): EntityKind {
  if (entity.kind !== undefined) return entity.kind;
  if (entity.state !== undefined && entity.state['companion'] === true) return 'summon';
  return entityKind(entity.type);
}