import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  auditArchitecture,
  isBespokeU16FieldName,
  parseImports,
  resolveImport,
  layerFor,
  walk,
} from '../../../scripts/audit-architecture-core.js';

// ---------------------------------------------------------------------------
// parseImports
// ---------------------------------------------------------------------------

describe('parseImports', () => {
  it('extracts side-effect imports', () => {
    expect(parseImports("import './foo.js';")).toEqual(['./foo.js']);
  });

  it('extracts from-imports', () => {
    expect(parseImports("import { x } from '../kernels/runtime.js';")).toEqual([
      '../kernels/runtime.js',
    ]);
  });

  it('extracts export from-imports', () => {
    expect(parseImports("export { x } from './types.js';")).toEqual(['./types.js']);
  });

  it('ignores external packages', () => {
    expect(parseImports("import { readFileSync } from 'node:fs';")).toEqual([]);
  });

  it('ignores comment lines', () => {
    const code = [
      '// import "./bad.js";',
      "import './good.js';",
      ' * import "./also-comment.js";',
    ].join('\n');
    expect(parseImports(code)).toEqual(['./good.js']);
  });

  it('handles multiple imports on separate lines', () => {
    const code = [
      "import './a.js';",
      "import { x } from './b.js';",
      "import 'external-pkg';",
    ].join('\n');
    expect(parseImports(code)).toEqual(['./a.js', './b.js']);
  });
});

// ---------------------------------------------------------------------------
// layerFor
// ---------------------------------------------------------------------------

describe('layerFor', () => {
  const root = '/automation';

  it('classifies primitives', () => {
    expect(layerFor('/automation/primitives/types.ts', root)).toBe('primitives');
  });

  it('classifies kernels', () => {
    expect(layerFor('/automation/kernels/runtime.ts', root)).toBe('kernels');
  });

  it('classifies content', () => {
    expect(layerFor('/automation/content/registry.ts', root)).toBe('content');
  });

  it('classifies index.ts as other', () => {
    expect(layerFor('/automation/index.ts', root)).toBe('other');
  });
});

// ---------------------------------------------------------------------------
// Integration: audit the real codebase
// ---------------------------------------------------------------------------

describe('auditArchitecture (real codebase)', () => {
  const AUTOMATION = join(import.meta.dirname, '../automation');

  it('passes with no violations', () => {
    const result = auditArchitecture(AUTOMATION);
    expect(result.violations).toEqual([]);
    expect(result.checked.totalFiles).toBeGreaterThan(0);
    expect(result.checked.primitives).toBeGreaterThan(0);
    expect(result.checked.kernels).toBeGreaterThan(0);
    expect(result.checked.content).toBeGreaterThan(0);
  });

  it('T6.4/(a) U16 guard flags bespoke entitlement fields but not retained specialists', () => {
    // The migrated bespoke U16 duplicate authorities are reserved.
    expect(isBespokeU16FieldName('interruptUses')).toBe(true);
    expect(isBespokeU16FieldName('interruptUsedThisTurn')).toBe(true);
    expect(isBespokeU16FieldName('slashedTriggeredThisTurn')).toBe(true);
    expect(isBespokeU16FieldName('dangerousTerrainTriggeredThisTurn')).toBe(true);
    // T6.4a: the No Repeats array and the once-per-own-turn standard-move
    // boolean both folded onto typed ledger keys are now reserved too.
    expect(isBespokeU16FieldName('standardMoveUsed')).toBe(true);
    expect(isBespokeU16FieldName('usedAbilityIds')).toBe(true);
    // Any future actor-level `*UsedThisTurn` / `*TriggeredThisTurn` entitlement
    // boolean is also reserved (semantic duplicate authority, not naming only).
    expect(isBespokeU16FieldName('somethingUsedThisTurn')).toBe(true);
    expect(isBespokeU16FieldName('somethingTriggeredThisTurn')).toBe(true);
    // Retained SPECIALISTS must NOT be flagged: the U10 historical resolution
    // fact and the pure scheduler clock fields.
    expect(isBespokeU16FieldName('attackedThisTurn')).toBe(false);
    expect(isBespokeU16FieldName('turnTaken')).toBe(false);
    expect(isBespokeU16FieldName('turnsTakenThisRound')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Negative tests: create temporary bad structures and verify detection
// ---------------------------------------------------------------------------

describe('auditArchitecture (violation detection)', () => {
  let tmpDir: string;

  function setup() {
    tmpDir = mkdtempSync(join(tmpdir(), 'arch-audit-test-'));
    // Create the standard directory layout
    mkdirSync(join(tmpDir, 'primitives'), { recursive: true });
    mkdirSync(join(tmpDir, 'kernels'), { recursive: true });
    mkdirSync(join(tmpDir, 'content', 'glue'), { recursive: true });
    mkdirSync(join(tmpDir, 'content', 'jobs'), { recursive: true });
    writeFileSync(join(tmpDir, 'content', 'registry.ts'), '// empty registry\n');
  }

  it('detects primitives importing from kernels', () => {
    setup();
    writeFileSync(join(tmpDir, 'primitives', 'foo.ts'), "import '../kernels/bar.js';\n");
    writeFileSync(join(tmpDir, 'kernels', 'bar.ts'), 'export const x = 1;\n');

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'import-direction',
          file: 'primitives/foo.ts',
          detail: expect.stringContaining('primitives must not import from kernels'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('detects primitives importing from content', () => {
    setup();
    writeFileSync(join(tmpDir, 'primitives', 'foo.ts'), "import '../content/jobs/bar.js';\n");
    writeFileSync(join(tmpDir, 'content', 'jobs', 'bar.ts'), 'export const x = 1;\n');

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'import-direction',
          detail: expect.stringContaining('primitives must not import from content'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('detects kernels importing from content', () => {
    setup();
    writeFileSync(join(tmpDir, 'kernels', 'foo.ts'), "import '../content/jobs/bar.js';\n");
    writeFileSync(join(tmpDir, 'content', 'jobs', 'bar.ts'), 'export const x = 1;\n');

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'import-direction',
          detail: expect.stringContaining('kernels must not import from content'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('allows primitives importing from primitives', () => {
    setup();
    writeFileSync(join(tmpDir, 'primitives', 'foo.ts'), "import './bar.js';\n");
    writeFileSync(join(tmpDir, 'primitives', 'bar.ts'), 'export const x = 1;\n');

    const result = auditArchitecture(tmpDir);
    expect(result.violations.filter((v) => v.check === 'import-direction')).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });

  it('allows kernels importing from primitives', () => {
    setup();
    writeFileSync(join(tmpDir, 'kernels', 'foo.ts'), "import '../primitives/bar.js';\n");
    writeFileSync(join(tmpDir, 'primitives', 'bar.ts'), 'export const x = 1;\n');

    const result = auditArchitecture(tmpDir);
    expect(result.violations.filter((v) => v.check === 'import-direction')).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });

  it('allows content importing from kernels and primitives', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'content', 'jobs', 'foo.ts'),
      ["import '../../kernels/bar.js';", "import '../../primitives/baz.js';"].join('\n'),
    );
    writeFileSync(join(tmpDir, 'kernels', 'bar.ts'), 'export const x = 1;\n');
    writeFileSync(join(tmpDir, 'primitives', 'baz.ts'), 'export const y = 2;\n');

    const result = auditArchitecture(tmpDir);
    expect(result.violations.filter((v) => v.check === 'import-direction')).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });

  it('detects hardcoded source IDs in primitives', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'primitives', 'foo.ts'),
      "const id = 'core:standard-move';\n",
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'source-id-in-generic-layer',
          file: 'primitives/foo.ts',
          detail: expect.stringContaining('hardcoded source ID'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('detects hardcoded source IDs in kernels', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'foo.ts'),
      "const name = 'bastion:trait:strive';\n",
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'source-id-in-generic-layer',
          file: 'kernels/foo.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('does not flag type annotations as source IDs', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'primitives', 'foo.ts'),
      ['export interface Foo {', '  sourceId: string;', '}', 'const x: string = "hello";'].join(
        '\n',
      ),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations.filter((v) => v.check === 'source-id-in-generic-layer')).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });

  it('U2 guard detects anchor-derived side relation restored in aura.ts', () => {
    setup();
    // aura.ts keeps the U2 symbol (so the presence check passes) but re-derives
    // ally/foe from the spatial anchor/owner side — the ROLE ≠ ANCHOR regression.
    writeFileSync(
      join(tmpDir, 'kernels', 'aura.ts'),
      [
        'perspectiveActorId',
        'const bad = origin.side;',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u2-perspective-authority',
          file: 'kernels/aura.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U2 guard flags a migrated consumer that dropped its U2 perspective symbol', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'candidate.ts'),
      'const src = context.actorId;\n',
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u2-perspective-authority',
          file: 'kernels/candidate.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 guard detects a kernel that reconstructs the canonical usage-ledger key locally', () => {
    setup();
    // A locally-implemented once-per-round ledger: rebuild the canonical
    // `ledger:<scope>:<sourceId>` key instead of routing through usage.ts.
    writeFileSync(
      join(tmpDir, 'kernels', 'foo.ts'),
      'const k = `ledger:round:${sourceId}`;\n',
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/foo.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 guard detects a primitives file that reconstructs a usage-ledger key', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'primitives', 'foo.ts'),
      'const ping = `ledger:${scope}:${id}`;\n',
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'primitives/foo.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 guard flags a migrated consumer that dropped its U16 core symbols', () => {
    setup();
    // trait-reactions.ts rebuilt the round ledger locally and dropped the U16
    // CORE consume/availability imports.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      'const k = `ledger:round:${traitId}`;\nfunction available(a, k){ return !a.ruleState[k]; }\n',
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  // ── T8b adversarial authority-mutation guards ────────────────────────────
  // Each keeps imports/canonical-symbol presence while restoring the competing
  // semantic implementation; the guard must STILL fail (symbol-presence is not
  // authority evidence — routing must be mechanically detectable).

  it('U2-M1 (candidate): CANONICAL U2 CALLED but its result ignored — perspective read off context.actorId — MUST FAIL', () => {
    setup();
    // The authority function is genuinely CALLED (the old proof would pass), but
    // its returned perspective is discarded and the actual relation perspective
    // comes straight from the incidental `context.actorId`.
    writeFileSync(
      join(tmpDir, 'kernels', 'candidate.ts'),
      [
        "import { relationPerspectiveIdFromContext } from '../primitives/roles.js';",
        'function actingActor(context) {',
        '  const ignored = relationPerspectiveIdFromContext(context);',
        '  return context.state.actors[context.actorId];',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u2-perspective-authority',
          file: 'kernels/candidate.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U2-M2 (aura actor): CANONICAL U2 CALLED, result ignored, a locally-aliased actor.id supplies perspectiveActorId — MUST FAIL', () => {
    setup();
    // `const perspective = actor.id` is an ALIAS of the incidental id — the
    // alias-tolerant producer guard must flag it, not a spelling regex.
    writeFileSync(
      join(tmpDir, 'kernels', 'aura.ts'),
      [
        'perspectiveActorId',
        "import { auraRelationPerspectiveId } from '../primitives/roles.js';",
        "const unused = auraRelationPerspectiveId({ kind: 'actor', bearerId: 'x' });",
        'const perspective = actor.id;',
        'return { perspectiveActorId: perspective };',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u2-perspective-authority', file: 'kernels/aura.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U2-M2b (aura): U2 called + result ignored, a const-named perspectiveActorId aliased from actor.id — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'aura.ts'),
      [
        "import { auraRelationPerspectiveId } from '../primitives/roles.js';",
        "const ignored = auraRelationPerspectiveId({ kind: 'actor', bearerId: 'x' });",
        'const perspectiveActorId = actor.id;',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u2-perspective-authority', file: 'kernels/aura.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U2-M3 (aura entity): U2 called, result ignored, entity ownership aliased into perspectiveActorId — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'aura.ts'),
      [
        'perspectiveActorId',
        "import { auraRelationPerspectiveId } from '../primitives/roles.js';",
        "const unused = auraRelationPerspectiveId({ kind: 'entity', ownerId: 'x' });",
        'const owner = entity.ownerId;',
        'const semanticPerspective = owner;',
        'return { perspectiveActorId: semanticPerspective };',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u2-perspective-authority', file: 'kernels/aura.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U2-M4 (aura membership): perspectiveActorId IS U2-derived but membership compares the owner/anchor side — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'aura.ts'),
      [
        "import { auraRelationPerspectiveId } from '../primitives/roles.js';",
        "const origin = { perspectiveActorId: auraRelationPerspectiveId({ kind: 'actor', bearerId: 'x' }) };",
        'function member(state, actor) {',
        '  const ownerSide = state.actors[state.entities[origin.entityId].ownerId].side;',
        '  return actor.side === ownerSide;',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u2-perspective-authority', file: 'kernels/aura.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 (F9 availability): keeps all U16 imports but reads raw ruleState for gating — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'export function gate(actor, key) { return !actor.ruleState[key]; }',
        '// usageKey/consumeUsageMutation imported but unused; ledgerAvailable not CALLED',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('ledgerAvailable'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 (F9 consume): keeps all U16 imports but emits the state mark by hand instead of the U16 consume result — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'const mark = { kind: "state", key, operation: "set", value: true };',
        '// ledgerAvailable/consumeUsageMutation imported but not CALLED',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('consumeUsageMutation'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 (F9 key): keeps all U16 imports but rebuilds a semantically-equivalent storage address by string concatenation — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'const key = "ledger:" + "round:" + sourceId;',
        '// usageKey imported but not CALLED — the key is hand-rebuilt',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('usageKey'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 (F9): an alternate-spelling key in a NON-U16 trait-reactions override is flagged (key reconstruction)', () => {
    setup();
    // Even with the symbols used for other surfaces, a local reconstruction of
    // the canonical key address (an alternate spelling) in a non-authority file
    // is still a competing U16 authority.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'usageKey({sourceId, ownerId: "", scope: "round"});',
        'const rebuilt = `ledger:${scope}:${sourceId}`;',
        'ledgerAvailable(actor, rebuilt);',
        'consumeUsageMutation(sourceId, actorId, rebuilt);',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u16-usage-ledger-routing', file: 'kernels/trait-reactions.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16-M1 (availability): ledgerAvailable CALLED but its result ignored — the actual gate reads raw ruleState — MUST FAIL', () => {
    setup();
    // All three U16 symbols are CALLED (the old call-presence proof passes), but
    // the actual availability decision reads the actor's raw ruleState instead of
    // the U16 returned availability.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'export function gate(actor, key, sourceId) {',
        "  usageKey({ sourceId, ownerId: 'real', scope: 'round' });",
        '  ledgerAvailable(actor, key);',
        "  consumeUsageMutation(sourceId, 'actor', key);",
        '  return !actor.ruleState[key];',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u16-usage-ledger-routing', file: 'kernels/trait-reactions.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16-M2 (consume): consumeUsageMutation CALLED but its result ignored — the mark is hand-built — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'export function fold(actor, key, sourceId) {',
        '  consumeUsageMutation(sourceId, actor.id, key);',
        '  return { kind: "state", key, operation: "set", value: true };',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u16-usage-ledger-routing', file: 'kernels/trait-reactions.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16-M3 (key): usageKey CALLED but its result ignored — the actual key is locally rebuilt by concatenation — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'export function keyFor(sourceId) {',
        "  usageKey({ sourceId, ownerId: 'r', scope: 'round' });",
        "  return 'ledger:' + 'round:' + sourceId;",
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u16-usage-ledger-routing', file: 'kernels/trait-reactions.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16-M4 (owner): a decoy real-owner call exists but the ACTUAL key path uses a fabricated missing owner — MUST FAIL', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey } from '../primitives/usage.js';",
        'export function keyFor(actor, sourceId) {',
        "  usageKey({ sourceId, ownerId: actor.id, scope: 'round' }); // decoy real owner",
        "  return usageKey({ sourceId, ownerId: '', scope: 'round' }); // fabricated owner drives the actual path",
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ check: 'u16-usage-ledger-routing', file: 'kernels/trait-reactions.ts' }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 guard does not flag the two U16 authority files for key reconstruction', () => {
    setup();
    // usage.ts and use-ledger.ts are allowed to build the canonical key.
    writeFileSync(
      join(tmpDir, 'primitives', 'usage.ts'),
      'export const usageKey = (s) => `ledger:${s.scope}:${s.sourceId}`;\n',
    );
    writeFileSync(
      join(tmpDir, 'kernels', 'use-ledger.ts'),
      'export const prefix = `ledger:${p}:`;\n',
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations.filter((v) => v.check === 'u16-usage-ledger-routing')).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });

  it('detects unmapped registration modules', () => {
    setup();
    // A content file that calls registerFoo() but is NOT imported by registry.ts
    writeFileSync(
      join(tmpDir, 'content', 'jobs', 'new-recipes.ts'),
      'registerNewRecipe("test", {});\n',
    );
    // Registry only imports the empty file
    writeFileSync(join(tmpDir, 'content', 'registry.ts'), '// no imports\n');

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'registry-completeness',
          file: 'content/jobs/new-recipes.ts',
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('passes when a registration module IS imported by registry.ts', () => {
    setup();
    writeFileSync(
      join(tmpDir, 'content', 'jobs', 'recipes.ts'),
      'registerMyRecipe("test", {});\n',
    );
    writeFileSync(
      join(tmpDir, 'content', 'registry.ts'),
      "import './jobs/recipes.js';\n",
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations.filter((v) => v.check === 'registry-completeness')).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });

  it('ignores glue/ and programs/ for registry completeness', () => {
    setup();
    // glue/ files that call register* should NOT trigger registry-completeness
    writeFileSync(
      join(tmpDir, 'content', 'glue', 'manual-programs.ts'),
      'registerInterruptAllowlist("test", []);\n',
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations.filter((v) => v.check === 'registry-completeness')).toEqual([]);
    rmSync(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Regression: single U2 perspective authority (T7 consumer consolidation guard)
// ---------------------------------------------------------------------------

describe('single U2 perspective authority', () => {
  const dir = import.meta.dirname;
  const srcDir = join(dir, '..', '..');
  const read = (rel: string) => {
    const { readFileSync } = require('node:fs');
    const path = require('node:path');
    return readFileSync(path.join(srcDir, 'rules', 'automation', rel), 'utf8');
  };

  it('candidate.ts routes the relation perspective through roles.ts (U2), not an incidental field', () => {
    expect(read('kernels/candidate.ts')).toContain('relationPerspectiveIdFromContext');
  });

  it('aura.ts separates the U2 perspective role from the spatial anchor', () => {
    expect(read('kernels/aura.ts')).toContain('perspectiveActorId');
    // ROLE ≠ ANCHOR: the ally/foe relation must never re-derive from the
    // spatial anchor/owner side again (`origin.side`, `side: owner?.side ?? null`).
    // (The legit `AuraActorView.side = actor.side` factual projection is fine.)
    expect(read('kernels/aura.ts')).not.toMatch(/origin\.side\b|\.side\s*\?\?\s*null/);
  });

  it('roles.ts is the typed U2 vocabulary authority (no kernel/content imports)', () => {
    const { readFileSync } = require('node:fs');
    const path = require('node:path');
    const code = readFileSync(path.join(srcDir, 'rules', 'automation', 'primitives', 'roles.ts'), 'utf8');
    expect(code).not.toMatch(/from '[.][^']*\/kernels\//);
    expect(code).not.toMatch(/from '[.][^']*\/content\//);
  });
});

// ---------------------------------------------------------------------------
// Single U16 usage/entitlement authority (U16 consumer-routing guard)
// ---------------------------------------------------------------------------

describe('single U16 usage/entitlement authority', () => {
  const shareDir = import.meta.dirname;
  const srcDir = join(shareDir, '..', '..');
  const read = (rel: string) => {
    const { readFileSync } = require('node:fs');
    const path = require('node:path');
    return readFileSync(path.join(srcDir, 'rules', 'automation', rel), 'utf8');
  };

  it('the once-per-round F9 fold routes through U16 and does not rebuild the ledger key', () => {
    const traitReactions = read('kernels/trait-reactions.ts');
    // Uses the U16 CORE surfaces for its round gate.
    expect(traitReactions).toContain('usageKey');
    expect(traitReactions).toContain('ledgerAvailable');
    expect(traitReactions).toContain('consumeUsageMutation');
    // It must NOT reconstruct the canonical `ledger:round:<id>` key itself.
    expect(traitReactions).not.toMatch(/ledger:\$\{/);
  });

  it('only the two U16 authority files construct the canonical ledger key', () => {
    const { readdirSync, readFileSync, statSync } = require('node:fs');
    const path = require('node:path');
    const srcDir = path.resolve(import.meta.dirname ?? __dirname, '..', '..');
    const violations: string[] = [];
    function scanDir(dir: string): void {
      for (const entry of readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        if (statSync(fullPath).isDirectory()) { scanDir(fullPath); continue; }
        if (!fullPath.endsWith('.ts') || fullPath.endsWith('.test.ts')) continue;
        const rel = path.relative(srcDir, fullPath).split(path.sep).join('/');
        if (rel === 'rules/automation/primitives/usage.ts' || rel === 'rules/automation/kernels/use-ledger.ts') continue;
        const content = readFileSync(fullPath, 'utf8');
        if (/ledger:\$\{/.test(content)) {
          violations.push(`Canonical usage-ledger key reconstructed outside the U16 authority in ${rel}`);
        }
      }
    }
    scanDir(path.join(srcDir, 'rules', 'automation', 'primitives'));
    scanDir(path.join(srcDir, 'rules', 'automation', 'kernels'));
    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regression: single action-cost authority (F8a merge contamination guard)
// ---------------------------------------------------------------------------

describe('single action-cost authority', () => {
  it('production code has no second action-cost fold outside cost-payment.ts', () => {
    // The cost-payment kernel (kernels/cost-payment.ts) is the single
    // reusable authority for action-cost overrides. A prior merge
    // reintroduced kernels/action-type.ts as a parallel authority; this
    // guard prevents that from landing again.
    const { readdirSync, readFileSync, statSync } = require('node:fs');
    const path = require('node:path');
    const srcDir = path.resolve(import.meta.dirname ?? __dirname, '..', '..');
    const kernelsDir = path.join(srcDir, 'rules', 'automation', 'kernels');
    const violations: string[] = [];
    function scanDir(dir: string) {
      for (const entry of readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        if (statSync(fullPath).isDirectory()) { scanDir(fullPath); continue; }
        if (!fullPath.endsWith('.ts') || fullPath.endsWith('.test.ts')) continue;
        if (fullPath.endsWith('cost-payment.ts')) continue;
        const content = readFileSync(fullPath, 'utf8');
        if (/effectiveAbilityActionCost|registerActionTypeModifier|ActionTypeModifier/.test(content)) {
          violations.push(`Parallel action-cost authority found in ${path.relative(srcDir, fullPath)}`);
        }
      }
    }
    scanDir(kernelsDir);
    expect(violations).toEqual([]);
  });
});
