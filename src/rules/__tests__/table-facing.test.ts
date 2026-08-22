import { describe, expect, it } from 'vitest';
import { TABLE_FACING_MECHANICS } from '../core.js';

describe('table-facing mechanics sweep', () => {
  it('enumerates every remaining human-ruling mechanic with a source page', () => {
    expect(TABLE_FACING_MECHANICS.length).toBeGreaterThanOrEqual(19);
    for (const entry of TABLE_FACING_MECHANICS) {
      expect(entry.id).toMatch(/^[a-z0-9-]+(:[a-z0-9-]+)+$/);
      expect(entry.sourcePage).toBeGreaterThanOrEqual(56);
      expect(entry.mechanic.length).toBeGreaterThan(10);
      expect(entry.ruling.length).toBeGreaterThan(10);
      expect(['wired', 'documented']).toContain(entry.status);
    }
  });

  it('has no duplicate ids', () => {
    const ids = TABLE_FACING_MECHANICS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers every wired deferral protocol without leaving silent table-facing gaps in the executable jobs', () => {
    const ids = new Set(TABLE_FACING_MECHANICS.map(({ id }) => id));
    // The five interrupt-window protocols (when-damaged, uses-ability, defeated,
    // area-inclusion, targeted-by-ability) and the save re-roll are all wired in
    // the reducer; none of them should be listed here as a remaining ruling.
    for (const wired of [
      'when-damaged', 'uses-ability', 'defeated', 'area-inclusion', 'targeted-by-ability', 'save-rolled',
    ]) {
      expect(ids.has(`core:${wired}-window`) || ids.has(`core:${wired}`)).toBe(false);
    }
  });
});
