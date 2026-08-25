/**
 * fidelity/provenance.ts — makes source-passage provenance and scope
 * frontiers REAL by tying them to the checked-in canonical extraction corpus
 * (`src/content/generated/icon-1.5.json`, whose bytes are SHA-pinned by
 * `scripts/verify-source-artifacts.ts`).
 *
 * Two guarantees:
 *
 * 1. PASSAGE PROVENANCE: a curated obligation's quote must appear, under
 *    deterministic normalization, inside the canonical text of its cited
 *    page. A quote therefore cannot prove itself with `sha256(quote)` alone:
 *    materially different prose fails even when its local fingerprint is
 *    recomputed. The PDF itself is never required — the pinned checked-in
 *    artifacts are sufficient for CI.
 *
 * 2. SCOPE FRONTIERS: a scope's declared frontier is resolved into atomic
 *    canonical clauses (EVERY extraction line on the frontier pages — there
 *    is no selection filter). Coverage is ATTRIBUTION-BASED: a clause counts
 *    as covered only through an explicit `attributed` entry naming the
 *    obligation that accounts for it — verified mechanically against that
 *    obligation's own passages. Containment alone is PROVENANCE, never
 *    coverage: a page-spanning quotation cannot silently sweep every clause
 *    inside it into "covered". Repeated identical occurrences have DISTINCT
 *    identities and each accounting entry covers exactly its declared
 *    occurrence count.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  FidelityIntegrityViolation,
  FidelityWorld,
  IntegrityCheck,
  OccurrenceCount,
  ScopeDefinition,
  ScopeFrontierInput,
  SourceClause,
  SourceObligation,
} from './types.js';

/** Canonical corpus path relative to the repo root. */
export const CANONICAL_CORPUS_PATH = 'src/content/generated/icon-1.5.json';

/**
 * Deterministic source-text normalization: case-folded, whitespace-collapsed,
 * typographic quotes/dashes unified. Extraction inserts line breaks inside
 * sentences; normalization makes substring verification robust to that while
 * still rejecting any change of wording.
 */
export function normalizeSourceText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Two-tier containment policy for source correspondence: exact normalized
 * substring first, then an entirely-whitespace-stripped comparison. The
 * fallback absorbs extraction artifacts like stray spaces before punctuation
 * (`"level up ."`) without accepting ANY change of wording — deleting all
 * whitespace still requires the exact character sequence of the page. */
export function sourceTextContains(haystack: string, needle: string): boolean {
  const h = normalizeSourceText(haystack);
  const n = normalizeSourceText(needle);
  if (h.includes(n)) return true;
  return h.replace(/\s+/g, '').includes(n.replace(/\s+/g, ''));
}

export interface CanonicalCorpus {
  /** Raw extracted page text (unnormalized; normalization happens at
   * point-of-use so clause extraction can still split extraction lines), or
   * undefined for pages outside the corpus. */
  pageText(page: number): string | undefined;
  pages(): readonly number[];
}

export function corpusFromPages(pages: readonly { number: number; text: string }[]): CanonicalCorpus {
  const map = new Map(pages.map((p) => [p.number, p.text]));
  return {
    pageText: (page) => map.get(page),
    pages: () => [...map.keys()].sort((a, b) => a - b),
  };
}

interface CorpusJson {
  schemaVersion: number;
  pages: { number: number; text: string }[];
}

/** Loads the checked-in canonical corpus. Throws when the artifact is absent
 * or not the expected schema — strict provenance is unavailable without it. */
export function loadCanonicalCorpus(repoRoot: string): CanonicalCorpus {
  const raw = JSON.parse(readFileSync(join(repoRoot, CANONICAL_CORPUS_PATH), 'utf8')) as CorpusJson;
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.pages)) {
    throw new Error(`${CANONICAL_CORPUS_PATH} does not have the expected schema; regenerate extraction artifacts.`);
  }
  return corpusFromPages(raw.pages);
}

/** Clause identity: page + LINE INDEX + content hash. The index is what
 * gives REPEATED identical lines distinct identities — two occurrences of the
 * same table fragment are two clauses, each needing its own accounting. */
function clauseId(page: number, lineIndex: number, normalized: string): string {
  return `p${page}:${lineIndex}:${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`;
}

/** Atomic clauses of one page: canonical extraction lines, normalized. Lines
 * are the smallest stable unit of the extraction; multi-column layout makes
 * finer sentence segmentation unreliable. */
export function pageClauses(corpus: CanonicalCorpus, page: number): SourceClause[] {
  const text = corpus.pageText(page);
  if (text === undefined) return [];
  const clauses: SourceClause[] = [];
  text.split('\n').forEach((line, lineIndex) => {
    const normalized = normalizeSourceText(line);
    if (normalized.length === 0) return;
    clauses.push({ page, text: normalized, sha256: createHash('sha256').update(normalized).digest('hex'), id: clauseId(page, lineIndex, normalized) });
  });
  return clauses;
}

/** Resolves every scope frontier definition into its EXHAUSTIVE clause list
 * (every canonical extraction line on the declared pages — no selection
 * filter exists) plus the clause IDs explicitly accounted by dispositions
 * and attributions.
 *
 * - Dispositions account for clauses this scope deliberately does NOT
 *   implement; `subdivided` entries must be jointly quoted by the named
 *   curated obligations.
 * - Attributions are explicit FRONTIER COVERAGE claims: the named obligation
 *   (same scope, curated) accounts for the matched clause(s), verified
 *   against that obligation's OWN passages. Containment alone never covers.
 * - Repeated identical occurrences have distinct identities: each entry
 *   covers exactly its declared occurrence count of still-unaccounted
 *   occurrences, in deterministic page/line order.
 *
 * Stale/over-claiming entries, unsupported subdivisions, unquoted
 * attributions, double accounting, and out-of-corpus pages are integrity
 * violations. */
export function resolveScopeFrontiers(
  scopes: readonly ScopeDefinition[],
  corpus: CanonicalCorpus,
  obligations: readonly SourceObligation[] = [],
): { inputs: ScopeFrontierInput[]; violations: FidelityIntegrityViolation[] } {
  const inputs: ScopeFrontierInput[] = [];
  const violations: FidelityIntegrityViolation[] = [];
  const curatedById = new Map(
    obligations
      .filter((obligation) => obligation.origin.kind === 'curated')
      .map((obligation) => [obligation.id, obligation]),
  );
  const stripped = (text: string): string => text.replace(/\s+/g, '');

  /** Occurrence selection shared by dispositions and attributions. Zero
   * matches, exhausted matches, or an explicit count exceeding the remaining
   * occurrences is staleness — an entry may never silently cover more than
   * it declares. */
  function selectOccurrences(
    scopeId: string,
    check: IntegrityCheck,
    entryKind: string,
    normalized: string,
    occurrences: OccurrenceCount | undefined,
    accounted: Map<string, number>,
    clausesByText: ReadonlyMap<string, SourceClause[]>,
  ): { selected: SourceClause[]; stale: boolean } {
    const all = clausesByText.get(normalized) ?? [];
    const used = accounted.get(normalized) ?? 0;
    const remaining = all.slice(used);
    if (remaining.length === 0) {
      violations.push({
        check,
        detail: `scope ${scopeId}: ${entryKind} matches no unaccounted frontier clause occurrence: "${normalized.slice(0, 80)}"`,
      });
      return { selected: [], stale: true };
    }
    const want = occurrences ?? 1;
    if (want !== 'all' && want > remaining.length) {
      violations.push({
        check,
        detail: `scope ${scopeId}: ${entryKind} declares ${want} occurrence(s) but only ${remaining.length} remain unaccounted: "${normalized.slice(0, 80)}"`,
      });
      return { selected: [], stale: true };
    }
    const selected = want === 'all' ? remaining : remaining.slice(0, want);
    accounted.set(normalized, used + selected.length);
    return { selected, stale: false };
  }

  for (const scope of scopes) {
    if (scope.frontier === undefined) continue;
    for (const page of scope.frontier.pages) {
      if (corpus.pageText(page) === undefined) {
        violations.push({ check: 'frontier-page-outside-corpus', detail: `scope ${scope.id}: frontier page ${page} is outside the canonical corpus` });
      }
    }
    // NO selection policy: every clause on every declared page is inside the
    // boundary and must later be covered or explicitly dispositioned.
    const clauses = scope.frontier.pages.flatMap((page) => pageClauses(corpus, page));
    const clausesByText = new Map<string, SourceClause[]>();
    for (const clause of clauses) {
      const list = clausesByText.get(clause.text) ?? [];
      list.push(clause);
      clausesByText.set(clause.text, list);
    }

    const irrelevantIds: string[] = [];
    const accountedIrrelevant = new Map<string, number>();
    for (const disposition of scope.frontier.irrelevant ?? []) {
      const normalized = normalizeSourceText(disposition.text);
      if ((disposition.kind ?? 'irrelevant') === 'subdivided') {
        const named = disposition.subdividedInto ?? [];
        const jointQuotes = named.map((id) => curatedById.get(id)?.passages.map((passage) => passage.quote).join(' '));
        if (named.length === 0 || jointQuotes.some((quote) => quote === undefined)) {
          violations.push({
            check: 'subdivision-unsupported',
            detail: `scope ${scope.id}: subdivided disposition names unknown/non-curated/out-of-scope obligation(s): "${disposition.text.slice(0, 80)}"`,
          });
          continue;
        }
        // Direct concatenation (no separator): a merged extraction line is
        // the TAIL of one quoted sentence plus the HEAD of the next, so the
        // clause spans exactly the junction between the two quotes.
        const haystack = jointQuotes.map((quote) => stripped(quote!)).join('');
        if (!haystack.includes(stripped(normalized))) {
          violations.push({
            check: 'subdivision-unsupported',
            detail: `scope ${scope.id}: subdivided clause is not jointly quoted by ${named.join(', ')}: "${disposition.text.slice(0, 80)}"`,
          });
          continue;
        }
      }
      const { selected } = selectOccurrences(
        scope.id,
        'frontier-disposition-entry-dangling',
        'disposition',
        normalized,
        disposition.occurrences,
        accountedIrrelevant,
        clausesByText,
      );
      irrelevantIds.push(...selected.map((clause) => clause.id));
    }

    const attributedIds: string[] = [];
    const accountedAttributed = new Map<string, number>();
    for (const attribution of scope.frontier.attributed ?? []) {
      const normalized = normalizeSourceText(attribution.text);
      const obligation = curatedById.get(attribution.obligationId);
      if (!obligation || obligation.scopeId !== scope.id) {
        violations.push({
          check: 'frontier-attribution-entry-dangling',
          detail: `scope ${scope.id}: attribution names unknown or out-of-scope obligation ${attribution.obligationId}`,
        });
        continue;
      }
      const quotes = obligation.passages.map((passage) => passage.quote).join(' ');
      const { selected } = selectOccurrences(
        scope.id,
        'frontier-attribution-entry-dangling',
        'attribution',
        normalized,
        attribution.occurrences,
        accountedAttributed,
        clausesByText,
      );
      if (selected.length === 0) continue;
      const quoted = selected.filter((clause) => sourceTextContains(quotes, clause.text));
      if (quoted.length < selected.length) {
        violations.push({
          check: 'frontier-attribution-unquoted',
          detail: `scope ${scope.id}: attribution to ${attribution.obligationId} covers clause(s) its passages do not quote: "${normalized.slice(0, 80)}"`,
        });
      }
      attributedIds.push(...quoted.map((clause) => clause.id));
    }

    const irrelevantSet = new Set(irrelevantIds);
    const doubled = [...new Set(attributedIds)].filter((id) => irrelevantSet.has(id));
    if (doubled.length > 0) {
      violations.push({
        check: 'frontier-double-accounting',
        detail: `scope ${scope.id}: ${doubled.length} clause(s) are BOTH dispositioned irrelevant and attributed to an obligation`,
      });
    }
    inputs.push({ scopeId: scope.id, clauses, irrelevantIds, attributedIds });
  }
  return { inputs, violations };
}

// ---------------------------------------------------------------------------
// Passage provenance verification
// ---------------------------------------------------------------------------

/** Verifies that every CURATED obligation passage corresponds to the
 * canonical extracted source material for its cited page. Derived-unit
 * passages are exempt: they are generated from the catalog, whose fidelity to
 * the corpus is enforced by the automation/extraction audits, and they never
 * reach strong status while unclassified anyway. */
export function verifyPassageProvenance(world: FidelityWorld, corpus: CanonicalCorpus): FidelityIntegrityViolation[] {
  const violations: FidelityIntegrityViolation[] = [];
  for (const obligation of world.obligations) {
    if (obligation.origin.kind !== 'curated') continue;
    for (const [index, passage] of obligation.passages.entries()) {
      const pageText = corpus.pageText(passage.page);
      if (pageText === undefined) {
        violations.push({
          check: 'passage-not-in-canonical-source',
          detail: `${obligation.id} passage #${index + 1}: cited page ${passage.page} is outside the canonical corpus`,
        });
        continue;
      }
      if (!sourceTextContains(pageText, passage.quote)) {
        violations.push({
          check: 'passage-not-in-canonical-source',
          detail: `${obligation.id} passage #${index + 1}: quoted text does not correspond to the canonical extraction of p.${passage.page}`,
        });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Frontier coverage computation (pure; consumed by engine.ts via inputs)
// ---------------------------------------------------------------------------

/** True when the obligation's passages cover the clause: some passage cites
 * the same page and contains the clause under the shared correspondence
 * policy. */
export function clauseCoveredBy(clause: SourceClause, obligations: readonly SourceObligation[]): boolean {
  return obligations.some((obligation) =>
    obligation.passages.some(
      (passage) => passage.page === clause.page && sourceTextContains(passage.quote, clause.text),
    ),
  );
}
