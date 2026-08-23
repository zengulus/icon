import { registerMarkConditionProjection } from '../../kernels/passive-projection.js';

/**
 * Reviewed mark-condition projections (ICON p.186).
 *
 * A mark becomes mechanically active only through a reviewed entry here,
 * keyed on the exact mark `sourceId` and `markId` plus the specific state
 * the source names.  Arbitrary mark state is never projected, and the
 * projection is ephemeral: the durable `marks` array is the record, and
 * nothing here is written back into it.
 */

/** The reviewed rot ability that owns the marks these projections interpret. */
const ROT_MARK_SOURCE_ID = 'harvester:rot';

// REGENERATE combo: the rot ally-mark projects a literal Regeneration
// condition (p.104: gain 4 vigor at turn end while bloodied) instead of
// relying on the resolver's prose comment.
registerMarkConditionProjection({
  sourceId: ROT_MARK_SOURCE_ID,
  markId: 'rot',
  matches: (mark) => mark.state.kind === 'ally',
  grants: ['regeneration'],
});

// Rot: a foe at 25% hp or lower when marked loses Defiance while marked.
registerMarkConditionProjection({
  sourceId: ROT_MARK_SOURCE_ID,
  markId: 'rot',
  matches: (mark) => mark.state.kind === 'foe' && mark.state.noDefiance === true,
  suppresses: ['defiance'],
});
