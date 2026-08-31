/**
 * u1-residual-inventory.ts — ONE machine-derived source of truth for the
 * named-content U1 `sourceActor(context, …)` residual census.
 *
 * Scans the production named-content program surface (content/jobs/programs/*)
 * for every `sourceActor(` CALL SITE (multi-line calls collapse to one site),
 * classifies each site into exactly one MUTUALLY EXCLUSIVE primary category,
 * and derives total + per-file + per-category counts from that same inventory.
 * The invariant `total === sum(categories)` is asserted by the consumer test,
 * and every site records its file, line, exact argument shape, and category so
 * counts are DERIVED from the site list — never maintained by hand.
 *
 * Anti-drift note (census repair, 2026-09-01): the pre-repair prose counts
 * ("242 total = 188 pure + 55 captured") were internally inconsistent because
 * a hand scan classified ONE site — harvester-programs.ts's
 * `sourceActor(context, context.input.actorIds.target[0])` (an in-call
 * captured-identity read wrapped in a `?` precedence chain) — as BOTH a
 * "pure live-slot" read (its argument starts with `context.`) AND an
 * "captured/derived" read (its argument names recorded input). The exact
 * machine-derived figures are 242 = 187 PURE + 54 CAPTURED + 1 BOUNDARY at
 * ea9526c and 229 = 174 + 54 + 1 at 5f0de05 (Sealer contributed 17→4 PURE, 13
 * removed). This script is the one source of truth that keeps those figures
 * mechanically consistent.
 *
 * Categories (semantic, mutually exclusive, per the ICON underlay ontology —
 * U1 reference identity vs U4 choice/cardinality ownership vs provenance):
 *
 *  - PURE_LIVE_REFERENCE: `sourceActor(context, context.<slot>)` where the
 *    second argument names a LIVE reference slot (`context.actorId`,
 *    `context.attackTargetId`, `context.triggerSourceId`,
 *    `context.triggerTargetIds`) whose actor is resolved against CURRENT
 *    state. Unambiguously U1 reference identity.
 *  - CAPTURED_ID_DEREFERENCE: `sourceActor(context, <plain identifier> [, …])`
 *    where the identifier was determined by an EARLIER caller-owned SELECT
 *    (`context.input.actorIds?.target?.[0]`, a `??`/`?.` chain, a loop index
 *    element like `allyIds[i]`, or a passed-in parameter). The caller's
 *    cardinality selection is U4; only the dereference is the U1
 *    captured-identity shape, not yet migrated.
 *  - DERIVED_OR_PRECEDENCE_BOUNDARY: an argument that NAMES RECORDED INPUT
 *    INSIDE the call itself (e.g. harvester line 155
 *    `context.input.actorIds.target[0]`) or carries an in-call precedence
 *    chain — the precedence question is a per-call-site source-contract
 *    decision, inventoried, not migrated.
 *  - NON_U1_OTHER: a site that is not reference resolution at all (only used
 *    if the scan surfaces one — provenance/mode plumbing).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type U1ResidualCategory =
  | 'PURE_LIVE_REFERENCE'
  | 'CAPTURED_ID_DEREFERENCE'
  | 'DERIVED_OR_PRECEDENCE_BOUNDARY'
  | 'NON_U1_OTHER';

export interface U1ResidualSite {
  file: string;
  line: number;
  shape: string;
  category: U1ResidualCategory;
  /** Machine-derived description of WHY the site is categorized as it is. */
  provenance: string;
}

export interface U1ResidualInventory {
  sites: U1ResidualSite[];
  total: number;
  categoryCounts: Record<U1ResidualCategory, number>;
  perFile: Record<string, Record<U1ResidualCategory, number>>;
  /** Assertion: total === sum(categoryCounts). */
  consistent: boolean;
}

const CATEGORY_KEYS: readonly U1ResidualCategory[] = [
  'PURE_LIVE_REFERENCE',
  'CAPTURED_ID_DEREFERENCE',
  'DERIVED_OR_PRECEDENCE_BOUNDARY',
  'NON_U1_OTHER',
];

const CALL_RE = /sourceActor\s*\(/g;
const PER_KEY: Record<U1ResidualCategory, number> = {
  PURE_LIVE_REFERENCE: 0,
  CAPTURED_ID_DEREFERENCE: 0,
  DERIVED_OR_PRECEDENCE_BOUNDARY: 0,
  NON_U1_OTHER: 0,
};

/** Classify one site given the call's SECOND ARGUMENT source text. The
 * categories are mutually exclusive and shape-based (exact argument form) so
 * the classification is auditable against the recorded shape:
 *  - `context.<live slot>` → PURE_LIVE_REFERENCE (a LIVE reference slot
 *    resolved against CURRENT state);
 *  - `context.<anything else>` (recorded input read inside the call, in-call
 *    precedence) → DERIVED_OR_PRECEDENCE_BOUNDARY;
 *  - a plain identifier / member / indexed element (caller-selected earlier) →
 *    CAPTURED_ID_DEREFERENCE;
 *  - any other expression → DERIVED_OR_PRECEDENCE_BOUNDARY (inventoried). */
export function classifySite(trimmed: string): { category: U1ResidualCategory; provenance: string } {
  if (trimmed.startsWith('context.')) {
    if (trimmed === 'context.actorId') {
      return { category: 'PURE_LIVE_REFERENCE', provenance: 'LIVE source-actor slot (context.actorId), resolved against current state' };
    }
    if (trimmed === 'context.attackTargetId') {
      return { category: 'PURE_LIVE_REFERENCE', provenance: 'LIVE attack-target slot (context.attackTargetId), resolved against current state' };
    }
    if (trimmed === 'context.triggerSourceId') {
      return { category: 'PURE_LIVE_REFERENCE', provenance: 'LIVE trigger-source slot (context.triggerSourceId), resolved against current state' };
    }
    if (trimmed === 'context.triggerTargetIds') {
      return { category: 'PURE_LIVE_REFERENCE', provenance: 'LIVE plural trigger-target slot (context.triggerTargetIds), resolved against current state' };
    }
    return {
      category: 'DERIVED_OR_PRECEDENCE_BOUNDARY',
      provenance: 'argument names recorded input / an in-call precedence chain (starts with context. but is not a LIVE slot) — per-call-site source contract, inventoried',
    };
  }
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?(?:\[\s*\w+\s*\])?$/.test(trimmed)) {
    return {
      category: 'CAPTURED_ID_DEREFERENCE',
      provenance: 'caller-selected identifier (plain identifier / member / indexed element, e.g. an input.actorIds selection or a loop element) — U4 selection stayed caller-owned; only the dereference is the U1 captured-identity shape',
    };
  }
  return {
    category: 'DERIVED_OR_PRECEDENCE_BOUNDARY',
    provenance: 'derived expression or precedence boundary — per-call-site source contract, inventoried',
  };
}

/** Categorize one site given the call's SECOND ARGUMENT source text. */
export function categorizeSourceActorArgument(arg: string): U1ResidualCategory {
  return classifySite(arg.trim()).category;
}

/** Find the matching close-paren index given the index of the OPENING paren. */
function matchingParen(text: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract the Nth comma-separated argument (1-based) of `callText` — the text
 * between the outer parens. */
function nthArgument(callText: string, n: number): string {
  let depth = 0;
  let commaCount = 0;
  let start = 0;
  for (let i = 0; i < callText.length; i += 1) {
    const ch = callText[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      commaCount += 1;
      if (commaCount === n - 1 && n > 1) start = i + 1;
      if (commaCount === n) return callText.slice(start, i).trim();
    }
  }
  return commaCount === n - 1 ? callText.slice(start).trim() : '';
}

/** Scan one file's full text for `sourceActor(...)` call sites. */
export function scanFileSites(file: string, text: string): U1ResidualSite[] {
  const sites: U1ResidualSite[] = [];
  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(text)) !== null) {
    // `match.index` is the position of `sourceActor`, whose opening paren is
    // match.index + match[0].length - 1. matchingParen counts the opening
    // paren itself, so pass the OPENING paren index (depth 1 at that point).
    const openParenIndex = match.index + match[0].length - 1;
    const closeIndex = matchingParen(text, openParenIndex);
    if (closeIndex === -1) continue;
    const openIndex = openParenIndex + 1; // first char INSIDE the call
    const callText = text.slice(openIndex, closeIndex);
    const arg = nthArgument(callText, 2);
    const line = text.slice(0, match.index).split('\n').length;
    const { category, provenance } = classifySite((arg || callText).trim());
    sites.push({
      file,
      line,
      shape: `sourceActor(${callText})`,
      category,
      provenance,
    });
    CALL_RE.lastIndex = closeIndex + 1;
  }
  return sites;
}

export function scanNamedContentPrograms(root: string): U1ResidualSite[] {
  const files = readdirSync(root).filter((name) => name.endsWith('-programs.ts'));
  const sites: U1ResidualSite[] = [];
  for (const file of files.sort()) {
    sites.push(...scanFileSites(file, readFileSync(join(root, file), 'utf8')));
  }
  return sites;
}

export function buildU1ResidualInventory(programsRoot: string): U1ResidualInventory {
  const sites = scanNamedContentPrograms(programsRoot);
  const categoryCounts: Record<U1ResidualCategory, number> = { ...PER_KEY };
  const perFile: Record<string, Record<U1ResidualCategory, number>> = {};
  for (const site of sites) {
    categoryCounts[site.category] += 1;
    perFile[site.file] ??= { ...PER_KEY };
    perFile[site.file][site.category] += 1;
  }
  const total = sites.length;
  const categorySum = CATEGORY_KEYS.reduce((acc, key) => acc + categoryCounts[key], 0);
  return { sites, total, categoryCounts, perFile, consistent: total === categorySum };
}

const programsRoot = join(import.meta.dirname, '..', 'src', 'rules', 'automation', 'content', 'jobs', 'programs');
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const inventory = buildU1ResidualInventory(programsRoot);
  console.log(JSON.stringify({ total: inventory.total, categoryCounts: inventory.categoryCounts, consistent: inventory.consistent }, null, 2));
  for (const [file, counts] of Object.entries(inventory.perFile)) {
    console.log(`${file}: ${JSON.stringify(counts)}`);
  }
}