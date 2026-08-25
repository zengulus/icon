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
 *    canonical clauses (extraction lines on the frontier pages, filtered by
 *    the scope's visible include policy). Every clause must later be covered
 *    by an obligation's passages or explicitly dispositioned irrelevant;
 *    resolution here is exhaustive and deterministic, so omitting
 *    inconvenient material from a curated obligation list cannot fake a
 *    complete boundary.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  FidelityIntegrityViolation,
  FidelityWorld,
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

function clauseId(page: number, normalized: string): string {
  return `p${page}:${createHash('sha256').update(normalized).digest('hex').slice(0, 12)}`;
}

/** Atomic clauses of one page: canonical extraction lines, normalized. Lines
 * are the smallest stable unit of the extraction; multi-column layout makes
 * finer sentence segmentation unreliable. */
export function pageClauses(corpus: CanonicalCorpus, page: number): SourceClause[] {
  const text = corpus.pageText(page);
  if (text === undefined) return [];
  return text
    .split('\n')
    .map((line) => normalizeSourceText(line))
    .filter((line) => line.length > 0)
    .map((text_) => ({ page, text: text_, sha256: createHash('sha256').update(text_).digest('hex'), id: clauseId(page, text_) }));
}

/** Resolves every scope frontier definition into its EXHAUSTIVE clause list
 * (every canonical extraction line on the declared pages — no selection
 * filter exists anymore) plus the clause IDs matched by explicit
 * dispositions.
 *
 * Subdivided dispositions are verified here against the curated obligations:
 * the clause's whitespace-stripped text must appear inside the concatenation
 * of the named obligations' passage quotes. This lets a merged extraction
 * line be accounted as several semantic pieces without pretending the line
 * itself is atomic semantics.
 *
 * Stale dispositions (matching no resolved clause), unsupported subdivisions,
 * and out-of-corpus pages are integrity violations. */
export function resolveScopeFrontiers(
  scopes: readonly ScopeDefinition[],
  corpus: CanonicalCorpus,
  obligations: readonly SourceObligation[] = [],
): { inputs: ScopeFrontierInput[]; violations: FidelityIntegrityViolation[] } {
  const inputs: ScopeFrontierInput[] = [];
  const violations: FidelityIntegrityViolation[] = [];
  const quotesById = new Map(
    obligations
      .filter((obligation) => obligation.origin.kind === 'curated')
      .map((obligation) => [obligation.id, obligation.passages.map((passage) => passage.quote).join(' ')]),
  );
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
    const irrelevantIds: string[] = [];
    for (const disposition of scope.frontier.irrelevant ?? []) {
      const normalized = normalizeSourceText(disposition.text);
      const matches = clauses.filter((clause) => clause.text === normalized);
      // Identical canonical lines (repeated table fragments) are covered by
      // the same disposition; ZERO matches is staleness.
      if (matches.length === 0) {
        violations.push({
          check: 'frontier-disposition-entry-dangling',
          detail: `scope ${scope.id}: disposition matches no frontier clause: "${disposition.text.slice(0, 80)}" — ${disposition.reason}`,
        });
        continue;
      }
      if ((disposition.kind ?? 'irrelevant') === 'subdivided') {
        const named = disposition.subdividedInto ?? [];
        const jointQuotes = named.map((id) => quotesById.get(id)).filter((quote): quote is string => quote !== undefined);
        if (jointQuotes.length !== named.length || named.length === 0) {
          violations.push({
            check: 'subdivision-unsupported',
            detail: `scope ${scope.id}: subdivided disposition names unknown/non-curated obligation(s): "${disposition.text.slice(0, 80)}"`,
          });
          continue;
        }
        // Direct concatenation (no separator): a merged extraction line is
        // the TAIL of one quoted sentence plus the HEAD of the next, so the
        // clause spans exactly the junction between the two quotes.
        const haystack = jointQuotes.map((quote) => quote.replace(/\s+/g, '')).join('');
        if (!haystack.includes(normalized.replace(/\s+/g, ''))) {
          violations.push({
            check: 'subdivision-unsupported',
            detail: `scope ${scope.id}: subdivided clause is not jointly quoted by ${named.join(', ')}: "${disposition.text.slice(0, 80)}"`,
          });
          continue;
        }
      }
      irrelevantIds.push(...matches.map((clause) => clause.id));
    }
    inputs.push({ scopeId: scope.id, clauses, irrelevantIds });
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
