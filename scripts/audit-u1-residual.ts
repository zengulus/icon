/**
 * audit-u1-residual — run the machine-derived U1 residual census over the
 * named-content program surface and fail on any inconsistency.
 *
 * The inventory (scripts/u1-residual-inventory.ts) is the ONE source of
 * truth: every site carries file/line/shape/category, and total, per-category,
 * and per-file counts are DERIVED from that site list. This runner enforces:
 *   total === sum(categories)          (no lost/miscounted sites)
 *   per-file sums === per-category sums (no cross-file drift)
 * and prints the derived census (to stdout as JSON when --json is passed),
 * so documentation can be regenerated from it rather than hand-maintained.
 *
 * Generous exit: 0 when consistent (incompleteness is inventory, not failure);
 * non-zero when the invariant breaks.
 */
import { join } from 'node:path';
import { buildU1ResidualInventory } from './u1-residual-inventory.js';

const programsRoot = join(import.meta.dirname, '..', 'src', 'rules', 'automation', 'content', 'jobs', 'programs');
const inventory = buildU1ResidualInventory(programsRoot);

const categorySum =
  inventory.categoryCounts.PURE_LIVE_REFERENCE
  + inventory.categoryCounts.CAPTURED_ID_DEREFERENCE
  + inventory.categoryCounts.DERIVED_OR_PRECEDENCE_BOUNDARY
  + inventory.categoryCounts.NON_U1_OTHER;

const perFileTotal = Object.values(inventory.perFile).reduce(
  (acc, counts) => acc + counts.PURE_LIVE_REFERENCE + counts.CAPTURED_ID_DEREFERENCE + counts.DERIVED_OR_PRECEDENCE_BOUNDARY + counts.NON_U1_OTHER,
  0,
);

const problems: string[] = [];
if (!inventory.consistent || inventory.total !== categorySum) {
  problems.push(`total (${inventory.total}) !== sum of categories (${categorySum})`);
}
if (categorySum !== perFileTotal) {
  problems.push(`sum of categories (${categorySum}) !== sum of per-file counts (${perFileTotal})`);
}

if (problems.length > 0) {
  console.error(`U1 residual census inconsistency:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ total: inventory.total, categoryCounts: inventory.categoryCounts, perFile: inventory.perFile, consistent: inventory.consistent }, null, 2));
} else {
  console.log(`U1 residual census consistent: total ${inventory.total} = PURE ${inventory.categoryCounts.PURE_LIVE_REFERENCE} + CAPTURED ${inventory.categoryCounts.CAPTURED_ID_DEREFERENCE} + BOUNDARY ${inventory.categoryCounts.DERIVED_OR_PRECEDENCE_BOUNDARY} + OTHER ${inventory.categoryCounts.NON_U1_OTHER}`);
}