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
 *
 * Doc-drift check (2026-09-01, census-integrity follow-up): the census prose
 * in docs/u8-u1-underlay-census.md must not silently retain a stale total.
 * The intro line of the fresh-residual section reads "A machine scan at this
 * HEAD finds <N> sourceActor(context, …) call sites"; the runner extracts N
 * and fails when it disagrees with the derived total — a stale prose total
 * can no longer survive next to a regenerated machine inventory.
 */
import { readFileSync } from 'node:fs';
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

// ---- Doc-drift check: the census prose total must match the machine. ----
const censusDoc = join(import.meta.dirname, '..', 'docs', 'u8-u1-underlay-census.md');
const censusText = readFileSync(censusDoc, 'utf8');
const proseTotalMatch = /A machine scan at this HEAD finds (\d+) `sourceActor\(context, …\)` call/.exec(censusText);

const problems: string[] = [];
if (!inventory.consistent || inventory.total !== categorySum) {
  problems.push(`total (${inventory.total}) !== sum of categories (${categorySum})`);
}
if (categorySum !== perFileTotal) {
  problems.push(`sum of categories (${categorySum}) !== sum of per-file counts (${perFileTotal})`);
}
if (!proseTotalMatch) {
  problems.push('census doc is missing the machine-scan prose line (`A machine scan at this HEAD finds <N> sourceActor(context, …) call sites`)');
} else if (Number(proseTotalMatch[1]) !== inventory.total) {
  problems.push(`census doc prose total (${proseTotalMatch[1]}) !== machine-derived total (${inventory.total})`);
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