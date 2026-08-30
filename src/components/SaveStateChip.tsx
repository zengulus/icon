import type { SaveState } from '../services/character-sync.js';

/**
 * Exact persistence-state chip for the creator.
 *
 * GREEN "Cloud saved": durable cloud storage has acknowledged the exact current
 *   local revision.
 * BLUE "Locally saved": the current revision is durable locally but that exact
 *   revision has not yet received cloud acknowledgement.
 *
 * Color alone never communicates persistence status: the label is always real
 * text and the chip exposes an accessible label.
 */
export function SaveStateChip({ state }: { state: SaveState }) {
  if (state === 'cloud') {
    return (
      <span className="save-state-chip cloud" role="status" aria-label="Cloud saved">
        <span className="save-state-dot" aria-hidden="true" />
        Cloud saved
      </span>
    );
  }
  return (
    <span className="save-state-chip local" role="status" aria-label="Locally saved">
      <span className="save-state-dot" aria-hidden="true" />
      Locally saved
    </span>
  );
}