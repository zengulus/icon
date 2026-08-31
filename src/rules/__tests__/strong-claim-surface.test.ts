import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkProjectClaims, classifyStrongLine } from '../fidelity/claims.js';
import type { ProjectClaim } from '../fidelity/claims.js';

// `checkProjectClaims` hands `readFile` an already-joined absolute path, so the
// helper must read it directly (mirroring the default implementation).
function readFileFor(p: string): string {
  return readFileSync(p, 'utf8');
}

// ---------------------------------------------------------------------------
// Strong-claim surface guard (surface-based classifier)
//
// Contract: strong VOCABULARY is never forbidden; strong CLAIMS on canonical
// status surfaces must be registered. These tests probe both sides of that
// boundary and the recognized bad implementations.
// ---------------------------------------------------------------------------

describe('strong-claim surface classifier: claims are guarded', () => {
  it('an unregistered "U8 is AUTHORITATIVE" is a claim', () => {
    expect(classifyStrongLine('U8 is AUTHORITATIVE.')).toBe('claim');
  });

  it('an unsupported COMPLETE/CLOSED status sentence is a claim', () => {
    expect(classifyStrongLine('U17 is COMPLETE.')).toBe('claim');
    expect(classifyStrongLine('this subsystem is CLOSED.')).toBe('claim');
  });

  it('a status heading declaring closure is a claim, even with equivalent wording', () => {
    expect(classifyStrongLine('## Scope / Clock (U8 underlay) — AUTHORITATIVE')).toBe('claim');
    expect(classifyStrongLine('## Ordering / Arbitration (U17 underlay) — LANDED/COMPLETE')).toBe('claim');
    // Equivalent marker in the heading status slot cannot dodge registration.
    expect(classifyStrongLine('## P2 — Vertical slice — **DONE 2026-08-26**')).toBe('claim');
  });

  it('lowercase / case variation of an actual status claim cannot bypass', () => {
    expect(classifyStrongLine('the advancement rules are complete and shipped.')).toBe('claim');
    expect(classifyStrongLine('the summon engine is complete and battle-ready.')).toBe('claim');
  });

  it('a named-subject copula over project vocabulary stays a claim', () => {
    expect(classifyStrongLine('The fake subsystem rules are AUTHORITATIVE.')).toBe('claim');
  });

  it('a genuine claim surface wins over unrelated prose ON THE SAME LINE', () => {
    expect(classifyStrongLine('U8 is AUTHORITATIVE; the reducer fails closed on malformed state.')).toBe('claim');
    expect(classifyStrongLine('U8 is AUTHORITATIVE; this is a closed set.')).toBe('claim');
    expect(classifyStrongLine('U8 is AUTHORITATIVE; this helper provides a complete mapping.')).toBe('claim');
    expect(classifyStrongLine('U17 is COMPLETE; setters fail closed on bad input.')).toBe('claim');
  });

  it('the by-design/architecturally qualifier is NOT a bypass (subject defines surface)', () => {
    expect(classifyStrongLine('U8 is AUTHORITATIVE by design.')).toBe('claim');
    expect(classifyStrongLine('U8 remains complete by design.')).toBe('claim');
    expect(classifyStrongLine('this subsystem is CLOSED architecturally.')).toBe('claim');
    // …but a BARE-COMMON-NOUN predicate still reads as ordinary prose, not a claim.
    expect(classifyStrongLine('...spread/alias replacement of a genuine result) are closed architecturally:')).toBe('prose');
    expect(classifyStrongLine('results are closed by design.')).toBe('prose');
  });
});

describe('strong-claim surface classifier: vocabulary definitions and prose pass', () => {
  it('"fail closed" and its variants pass without any exemption', () => {
    expect(classifyStrongLine('The reducer fails closed on equidistant ties.')).toBe('prose');
    expect(classifyStrongLine('resolvers fail closed on those clauses.')).toBe('prose');
    expect(classifyStrongLine('position reject fail-closed).')).toBe('prose');
  });

  it('"closed set", "complete mapping", and noun-modifier usage pass', () => {
    expect(classifyStrongLine('A closed set of documents.')).toBe('prose');
    expect(classifyStrongLine('complete mapping of the source page.')).toBe('prose');
    expect(classifyStrongLine('Closed source-ID manifests, never runtime prose parsing.')).toBe('prose');
    expect(classifyStrongLine('Closed-negative tests cover the projection.')).toBe('prose');
  });

  it('capability-ladder and status-vocabulary definitions pass', () => {
    expect(classifyStrongLine('(blocked < partial < executable < source-tested < replay-tested < closed)')).toBe('definition');
    expect(classifyStrongLine('Status vocabulary: `COMPLETE` · `PARTIAL` · `BLOCKED`.')).toBe('definition');
    expect(classifyStrongLine('| AUTHORITATIVE | Execution matches source semantics for its scope |')).toBe('definition');
    expect(classifyStrongLine('| 5 | Authoritative | Execution matches source semantics without hidden bypasses |')).toBe('definition');
  });

  it('a generic-class definition ("A phase is complete") passes', () => {
    expect(classifyStrongLine('Phase gates are acceptance criteria. A phase is complete when criteria are met.')).toBe('prose');
    expect(classifyStrongLine('a slice is **closed** when a legal build executes end to end.')).toBe('prose');
  });

  it('historical changelog operation descriptions and narrated events pass', () => {
    expect(classifyStrongLine('> (not inferred from T8) and found T8 U2 AUTHORITATIVE claim hid a false.')).toBe('prose');
    // "re-certified" narrates a past event; it is not a bare current-state claim.
    expect(classifyStrongLine('U2 re-certified AUTHORITATIVE by fresh audit.')).toBe('prose');
    expect(classifyStrongLine('> remain AUTHORITATIVE. Zero source units promoted.')).toBe('prose');
  });
});

describe('strong-claim surface classifier: end-to-end registration', () => {
  const emptyResult = { summary: { integrityViolations: [] }, findings: [], scopes: [] } as never;

  function repo(body: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'strong-claim-surface-'));
    mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(body)) {
      writeFileSync(join(dir, rel), content);
    }
    return dir;
  }

  it('ordinary prose in a canonical file produces zero violations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strong-claim-surface-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'TODO.md'), [
      'The reducer fails closed on equidistant ties.',
      'A closed set and a complete mapping are ordinary vocabulary.',
      'Closed-negative tests and fail-closed semantics are implementation patterns.',
      '(blocked < partial < executable < source-tested < replay-tested < closed)',
      'Status vocabulary: `COMPLETE` · `PARTIAL`.',
      'Previously the seam was believed complete.',
    ].join('\n') + '\n');
    const { violations } = checkProjectClaims(emptyResult, { root: dir, readFile: readFileFor }, []);
    expect(violations).toEqual([]);
  });

  it('an unregistered strong CLAIM outside a heading still fails (no heading bypass)', () => {
    const dir = repo({ 'TODO.md': '## Notes\n\nU8 is AUTHORITATIVE while the U8 scope is PARTIAL.\n' });
    const { violations } = checkProjectClaims(emptyResult, { root: dir, readFile: readFileFor }, []);
    expect(violations.some((v) => v.check === 'unregistered-strong-claim' && /U8 is AUTHORITATIVE/.test(v.detail))).toBe(true);
  });

  it('a registered and sufficiently evidenced strong claim passes', () => {
    const dir = repo({ 'TODO.md': 'U8 is AUTHORITATIVE.\n' });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { 'audit:u8': 'true' } }));
    const claim: ProjectClaim = {
      id: 'claim:u8',
      file: 'TODO.md',
      anchor: 'U8 is AUTHORITATIVE.',
      strength: 'authoritative',
      subject: 'U8',
      binding: { kind: 'generated-audit', command: 'audit:u8' },
    };
    const { violations, unverifiedClaims } = checkProjectClaims(
      emptyResult,
      { root: dir, readFile: readFileFor, auditResults: { 'audit:u8': 'passed' } },
      [claim],
    );
    expect(violations).toEqual([]);
    expect(unverifiedClaims).toEqual([]);
  });

  it('a registered claim stronger than its evidence fails (registration alone is never enough)', () => {
    const dir = repo({ 'TODO.md': 'U8 is AUTHORITATIVE.\n' });
    const partialScope = { scopeId: 'u8', status: 'partial' as const };
    const claim: ProjectClaim = {
      id: 'claim:u8',
      file: 'TODO.md',
      anchor: 'U8 is AUTHORITATIVE.',
      strength: 'authoritative',
      subject: 'U8',
      binding: { kind: 'fidelity-scope', scopeId: 'u8' },
    };
    const { violations } = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [partialScope] } as never,
      { root: dir, readFile: readFileFor },
      [claim],
    );
    expect(violations.some((v) => v.check === 'claim-stronger-than-evidence')).toBe(true);

    // Deleting the evidence that would have backed the claim also fails.
    const noScript = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [partialScope] } as never,
      { root: dir, readFile: readFileFor },
      [{ ...claim, binding: { kind: 'generated-audit', command: 'vanished-audit' } }],
    );
    expect(noScript.violations.some((v) => v.check === 'claim-command-missing')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mutation-style resistance: the properties that each rejected bad
// implementation would have broken.
// ---------------------------------------------------------------------------

describe('strong-claim guard: rejected bad implementations', () => {
  it('deleting the guard cannot hide a claim (classifier still surfaces claims)', () => {
    // A "deleted guard" returns prose for everything; the guard contract is
    // broken if ANY strong claim classifies as prose.
    const genuineClaims = [
      'U8 is AUTHORITATIVE.',
      'U17 is COMPLETE.',
      '## Scope / Clock (U8 underlay) — AUTHORITATIVE',
      'The fake subsystem rules are AUTHORITATIVE.',
    ];
    for (const claim of genuineClaims) {
      expect(classifyStrongLine(claim), `guard must still catch: ${claim}`).toBe('claim');
    }
  });

  it('checking only uppercase tokens cannot bypass (lowercase strong claims caught)', () => {
    expect(classifyStrongLine('u8 is authoritative.')).toBe('claim');
    expect(classifyStrongLine('u17 is complete and shipped.')).toBe('claim');
  });

  it('treating every token as a claim is rejected (prose + definitions pass)', () => {
    const prose = [
      'The reducer fails closed on ties.',
      'closed set',
      'complete mapping',
      '(blocked < partial < executable < source-tested < replay-tested < closed)',
      '| AUTHORITATIVE | Execution matches source semantics for its scope |',
      '> remain AUTHORITATIVE. Zero promotion.',
    ];
    for (const line of prose) {
      expect(classifyStrongLine(line), `must NOT be flagged: ${line}`).not.toBe('claim');
    }
  });

  it('accepting every strong statement outside a heading is rejected (prose claims fail)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strong-claim-guard-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'TODO.md'), 'U8 is AUTHORITATIVE.\n');
    const { violations } = checkProjectClaims(
      { summary: { integrityViolations: [] }, findings: [], scopes: [] } as never,
      { root: dir, readFile: readFileFor },
      [],
    );
    expect(violations.some((v) => v.check === 'unregistered-strong-claim')).toBe(true);
  });
});
