import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  auditArchitecture,
  choiceCandidateRoutingProblems,
  kernelAuthoringFacadeProblems,
  isBespokeU16FieldName,
  u1ReferenceRoutingProblems,
  u8EncounterRoutingProblems,
  parseImports,
  resolveImport,
  layerFor,
  walk,
} from '../../../scripts/audit-architecture-core.js';
import {
  buildU1ResidualInventory,
  categorizeSourceActorArgument,
  scanFileSites,
} from '../../../scripts/u1-residual-inventory.js';
import { join as joinPath } from 'node:path';

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
      '/**',
      ' * import "./also-comment.js";',
      ' */',
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

  it('extracts multiline static imports and exports', () => {
    const code = [
      'import {',
      '  occupied,',
      "} from '../primitives/job-kit.js';",
      'export {',
      '  resolveChoice,',
      "} from './choice.js';",
    ].join('\n');
    expect(parseImports(code)).toEqual(['../primitives/job-kit.js', './choice.js']);
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

  it('semantic atomicity: kernels cannot depend on job-kit for low-level semantics', () => {
    expect(kernelAuthoringFacadeProblems({
      'kernels/query.ts': "import {\n  occupied,\n} from '../primitives/job-kit.js';",
      'content/jobs/example.ts': "import { occupied } from '../../primitives/job-kit.js';",
    })).toEqual([expect.objectContaining({ check: 'kernel-authoring-facade-import', file: 'kernels/query.ts' })]);
  });

  it('semantic atomicity: U4 actor and position decisions remain routed through U3', () => {
    const routed = `
      validateActorCandidate(id);
      function resolvePositions() {
        const candidate = validatePositionCandidate(query);
        if (!candidate.legal && candidate.problem === 'out-of-bounds') throw new Error();
        if (!candidate.legal) throw new Error(candidate.problem);
      }
    `;
    expect(choiceCandidateRoutingProblems(routed)).toEqual([]);
    expect(choiceCandidateRoutingProblems("validateActorCandidate(id); import { withinGrid } from '../primitives/battlefield.js';"))
      .toEqual(expect.arrayContaining([
        'position choices do not bind the U3 validatePositionCandidate result',
        'choice kernel imports raw spatial semantics instead of U3 candidate validation',
      ]));
  });

  it('semantic atomicity: a dead U3 call cannot conceal restored local position legality', () => {
    const bypass = `
      validateActorCandidate(id);
      function resolvePositions() {
        validatePositionCandidate(query);
        if (cell.x < 0 || cell.y < 0 || cell.x >= context.state.grid.width) throw new Error('bounds');
        const range = Math.max(Math.abs(cell.x - origin.x), Math.abs(cell.y - origin.y));
        if (range > maximumRange) throw new Error('range');
      }
    `;
    expect(choiceCandidateRoutingProblems(bypass)).toEqual(expect.arrayContaining([
      'position choices do not bind the U3 validatePositionCandidate result',
      'position choices locally reinterpret U3 bounds or footprint-range legality',
    ]));
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
// U1 residual census integrity (machine-derived; one source of truth)
// ---------------------------------------------------------------------------
// The named-content U1 residual census is DERIVED from a site-level inventory
// (scripts/u1-residual-inventory.ts): every `sourceActor(` call site records
// file/line/shape/category, and total / per-category / per-file counts are
// computed from that list — never hand-maintained. These tests enforce the
// executable invariant `total === sum(all mutually exclusive categories)` and
// pin the exact repo figures, so the 242-vs-188+55 class of drift cannot
// recur. (Pre-repair prose misclassified ONE site — harvester's in-call
// captured-identity read `sourceActor(context, context.input.actorIds.target[0])`
// — as BOTH pure and captured; the machine inventory is consistent: ea9526c
// 242 = 187 + 54 + 1, current 229 = 174 + 54 + 1.)
describe('U1 residual census (machine inventory)', () => {
  const PROGRAMS_ROOT = joinPath(import.meta.dirname, '../automation/content/jobs/programs');

  it('total === sum of all mutually exclusive categories, at the repo root', () => {
    const inventory = buildU1ResidualInventory(PROGRAMS_ROOT);
    const categorySum =
      inventory.categoryCounts.PURE_LIVE_REFERENCE
      + inventory.categoryCounts.CAPTURED_ID_DEREFERENCE
      + inventory.categoryCounts.DERIVED_OR_PRECEDENCE_BOUNDARY
      + inventory.categoryCounts.NON_U1_OTHER;
    expect(inventory.consistent).toBe(true);
    expect(inventory.total).toBe(categorySum);
    expect(inventory.total).toBeGreaterThan(0);
  });

  it('sum of per-file counts equals the total (no cross-file drift)', () => {
    const inventory = buildU1ResidualInventory(PROGRAMS_ROOT);
    const perFileTotal = Object.values(inventory.perFile).reduce(
      (acc, counts) => acc + counts.PURE_LIVE_REFERENCE + counts.CAPTURED_ID_DEREFERENCE + counts.DERIVED_OR_PRECEDENCE_BOUNDARY + counts.NON_U1_OTHER,
      0,
    );
    expect(perFileTotal).toBe(inventory.total);
    // Every file present in the scan is represented per-file and vice versa.
    const fileNames = new Set(inventory.sites.map((site) => site.file));
    expect(fileNames.size).toBe(Object.keys(inventory.perFile).length);
  });

  it('pins the exact repo figures (55 = 0 + 54 + 1) so docs cannot drift from the machine', () => {
    const inventory = buildU1ResidualInventory(PROGRAMS_ROOT);
    expect(inventory.total).toBe(55);
    expect(inventory.categoryCounts).toEqual({
      PURE_LIVE_REFERENCE: 0,
      CAPTURED_ID_DEREFERENCE: 54,
      DERIVED_OR_PRECEDENCE_BOUNDARY: 1,
      NON_U1_OTHER: 0,
    });
  });

  it('census prose total matches the machine inventory (no stale prose can silently survive)', () => {
    // The fresh-residual section's intro line claims a total; it must equal
    // the machine-derived inventory total, or the prose is stale by
    // construction. This is the guard the audit:u1-residual runner enforces
    // at the doc level; this test re-asserts it from the suite so a stale
    // prose total cannot survive a docs-only commit.
    const inventory = buildU1ResidualInventory(PROGRAMS_ROOT);
    const censusText = readFileSync(joinPath(import.meta.dirname, '../../../docs/u8-u1-underlay-census.md'), 'utf8');
    const match = /A machine scan at this HEAD finds (\d+) `sourceActor\(context, …\)` call/.exec(censusText);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBe(inventory.total);
  });

  it('every site carries a machine-derived provenance string (auditable classification)', () => {
    const inventory = buildU1ResidualInventory(PROGRAMS_ROOT);
    for (const site of inventory.sites) {
      expect(site.provenance.length).toBeGreaterThan(0);
      expect(site.line).toBeGreaterThan(0);
      expect(site.shape.startsWith('sourceActor(')).toBe(true);
    }
  });

  it('classifier mutation: the harvester in-call captured read is the ONE boundary site, never double-counted', () => {
    // The pre-repair hand scan classified this site as BOTH pure and captured
    // (`188+55=243 ≠ 242`). The machine classifier must place it in exactly
    // one bucket: the DERIVED_OR_PRECEDENCE_BOUNDARY (it names recorded input
    // inside the call).
    expect(categorizeSourceActorArgument('context.actorId')).toBe('PURE_LIVE_REFERENCE');
    expect(categorizeSourceActorArgument('context.attackTargetId')).toBe('PURE_LIVE_REFERENCE');
    expect(categorizeSourceActorArgument('context.input.actorIds.target[0]')).toBe('DERIVED_OR_PRECEDENCE_BOUNDARY');
    expect(categorizeSourceActorArgument('targetId')).toBe('CAPTURED_ID_DEREFERENCE');
    expect(categorizeSourceActorArgument('allyIds[i]')).toBe('CAPTURED_ID_DEREFERENCE');
  });

  it('scanner survival: multi-line calls count as ONE site; harness, not hand grep', () => {
    const text = [
      "const source = sourceActor(context,",
      "  context.actorId);",
      'const other = sourceActor(context, targetId);',
    ].join('\n');
    const sites = scanFileSites('fixture.ts', text);
    expect(sites).toHaveLength(2);
    expect(sites[0].line).toBe(1);
    expect(sites[0].category).toBe('PURE_LIVE_REFERENCE');
    expect(sites[1].category).toBe('CAPTURED_ID_DEREFERENCE');
  });
});

describe('U1 Reference/Binding routing guard', () => {
  const valid = {
    'kernels/candidate.ts': 'resolveActorSelectorReference({ kind: \'self\' }, context);',
    'kernels/evaluate-value.ts': 'resolveActorSelectorReference(selector, context); liveActorSlot(\'damage-recipient\');',
    'kernels/execute-flow.ts': 'resolveReference(liveActorSlot(\'attack-target\'), context); capturedActor(id);',
    'kernels/foe-recipes.ts': 'resolveActorSelectorReference(selector, context);',
    'kernels/core-resolvers.ts': 'resolveActorSelectorReference(selector, context);',
    'kernels/evaluate-query.ts': 'resolveActorSelectorReference({ kind: \'self\' }, context);',
    'primitives/attack-resolution.ts': 'resolveReference(liveActorSlot(\'source\'), context);',
    'primitives/reference.ts': 'context.attackTargetId; context.input.actorIds;',
    'primitives/roles.ts': 'context.triggerSourceId;',
    'kernels/choice.ts': 'context.input.actorIds;',
  };

  it('accepts migrated consumers plus the U1/U2/U4 retained boundaries', () => {
    expect(u1ReferenceRoutingProblems(valid)).toEqual([]);
  });

  it('catches a decoy U1 call beside a restored raw slot interpreter', () => {
    expect(u1ReferenceRoutingProblems({
      ...valid,
      'kernels/candidate.ts': `${valid['kernels/candidate.ts']}\nconst target = context.attackTargetId;`,
    })).toContainEqual(expect.objectContaining({
      file: 'kernels/candidate.ts',
      detail: 'interprets a legacy reference slot outside the U1 authority',
    }));
  });

  it('catches dropped routing calls and raw source/input actor resolution', () => {
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      'kernels/evaluate-value.ts': 'const source = context.state.actors[context.actorId];',
      'kernels/core-resolvers.ts': 'const target = context.input.actorIds?.target?.[0];',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'kernels/evaluate-value.ts', detail: 'migrated consumer no longer calls U1 surface resolveActorSelectorReference' }),
      expect.objectContaining({ file: 'kernels/evaluate-value.ts', detail: 'resolves the implicit source-actor reference outside U1' }),
      expect.objectContaining({ file: 'kernels/core-resolvers.ts', detail: 'resolves recorded actor-input identities outside U1 (or U4 choice validation)' }),
    ]));
  });

  it('catches the evaluate-value actor(context, context.actorId) source-slot spelling', () => {
    // The whole-consumer audit found execute-flow's attack case reading the
    // source through the evaluate-value ``actor(context, context.actorId)``
    // helper — a third legacy spelling of ``state.actors[context.actorId]``
    // that bypassed the U1 live-slot authority. The guard now flags it the
    // same way it flags the literal deref and the job-kit convenience.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      'kernels/execute-flow.ts': 'const source = actor(context, context.actorId);',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'kernels/execute-flow.ts', detail: 'resolves the implicit source-actor reference outside U1' }),
    ]));
    // A decoy: the same helper form with an already-resolved id (not the
    // source slot) is NOT reference interpretation and must stay accepted —
    // the file still makes its pinned U1 calls.
    expect(u1ReferenceRoutingProblems({
      ...valid,
      'kernels/execute-flow.ts': `${valid['kernels/execute-flow.ts']!}\nconst foe = actor(context, resolvedId);`,
    })).toEqual([]);
  });

  // T5c — the content layer is now inside the U1 guard. The ONE content
  // reference surface is content/glue/reference-authoring.ts (composing the
  // U1 vocabulary); migrated programs must keep ROUTING through it. The
  // deliberate scope of the content scan is REFERENCE INTERPRETATION: a raw
  // `state.actors[context.…]` dereference. It deliberately does NOT ban the
  // `sourceActor(context, …)` residual (~120 calls, inventoried for
  // family-by-family migration), `context.input.actorIds` reads (U4 choice
  // identity lives at the caller), or `context.actorId` as provenance /
  // ownership / scheduling identity — those are not reference resolution.
  const validContent = {
    // The adapter must keep COMPOSING the single U1 vocabulary (constructors +
    // resolution authority), not become a second reference system.
    'content/glue/reference-authoring.ts':
      "import { liveActorSlot, liveActorBound, capturedActor, resolveReference } from '../../primitives/reference.js';"
      + "\nexport function sourceActorRef() { return liveActorSlot('source'); }",
    'content/jobs/programs/bastion-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); resolveCapturedSelectedActors(context, \'target\');',
    'content/jobs/programs/spellblade-programs.ts': 'resolveSourceActor(context); resolveAttackTarget(context); resolveTriggerTargets(context); resolveCapturedSelectedActors(context, \'target\');',
    // Non-migrated content: caller-owned U4 cardinality reads, incidental
    // provenance/ownership fields, and the inventoried sourceActor residual
    // are NOT reference interpretation.
    'content/jobs/programs/chanter-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const allyId = context.input.actorIds?.target?.[0]; const ally = allyId ? sourceActor(context, allyId) : undefined; const foeId = context.input.actorIds?.target?.[0] ?? context.attackTargetId;',
    // Migrated Knave keeps its pinned adapter surface; the retained
    // captured/precedence dereferences (plannedRush's actorId parameter,
    // Dire Parry's triggerSource ?? input chain, Strongarm's input.actorIds
    // target, passed-id loop derefs) stay inventoried at the caller.
    'content/jobs/programs/knave-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); function plannedRush(context, actorId) { return sourceActor(context, actorId); } const foeId = context.triggerSourceId ?? context.input.actorIds?.target?.[0]; const foe = foeId ? sourceActor(context, foeId) : undefined; const targetId = context.input.actorIds?.target?.[0]; const chosen = targetId ? sourceActor(context, targetId) : undefined; const passedId = "x"; const passedActor = passedId ? sourceActor(context, passedId) : undefined;',
    // Migrated Shade/Warden keep their pinned adapter surface; the remaining
    // captured-input dereferences (`input.actorIds?.[n]` → sourceActor) are
    // the inventoried U1×U4 boundary and must NOT be flagged.
    'content/jobs/programs/shade-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const triggerPosition = resolveTriggerSource(context)?.position; const selected = context.input.actorIds?.target?.[0]; const chosen = selected ? sourceActor(context, selected) : undefined;',
    'content/jobs/programs/warden-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const foeId = context.input.actorIds?.target?.[0]; const foe = foeId ? sourceActor(context, foeId) : undefined;',
    // Migrated Sealer keeps its pinned adapter surface; the U1×U4 chain reads
    // (`input.actorIds?.[0] ?? attackTargetId` → sourceActor) stay inventoried.
    'content/jobs/programs/sealer-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined;',
    // Migrated Enochian keeps its pinned adapter surface; the captured-input
    // dereferences (blazing-bond allyId, heartfire partnerId, implode/pyroclast
    // targetId from `??` chains) stay inventoried at the U1×U4 boundary.
    'content/jobs/programs/enochian-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const allyId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const ally = allyId ? sourceActor(context, allyId) : undefined;',
    // Migrated Harvester keeps its pinned adapter surface; the ONE
    // DERIVED_OR_PRECEDENCE_BOUNDARY (blood-grove's in-call
    // `input.actorIds.target[0]` center read) and the `??`-chain
    // captured dereferences stay inventoried and must NOT be flagged.
    'content/jobs/programs/harvester-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined; const center = context.input.actorIds?.target?.[0] ? sourceActor(context, context.input.actorIds.target[0])?.position : undefined; const foeId = context.triggerTargetIds?.[0] ?? context.input.actorIds?.target?.[0]; const foe = foeId ? sourceActor(context, foeId) : undefined;',
    // Migrated Demon Slayer keeps its pinned adapter surface; the retained
    // helper-parameter dereference (plannedRush's actorId) and the recorded
    // ally choice (Righteous Disdain's input.actorIds) stay inventoried.
    'content/jobs/programs/demon-slayer-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); function plannedRush(context, actorId) { return sourceActor(context, actorId); } const allyId = context.input.actorIds?.target?.[0]; const ally = allyId ? sourceActor(context, allyId) : undefined;',
    // Migrated Seer keeps its pinned adapter surface; the retained
    // `input.actorIds?.target?.[0] ?? attackTargetId` / trigger chains
    // (Chaos Tarot / Polaris / Sisyphus / Eclipse centers, Reverse Fate /
    // Wish allies) stay inventoried at the U1×U4 boundary.
    'content/jobs/programs/seer-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined; const allyId = context.input.actorIds?.target?.[0] ?? context.triggerTargetIds?.[0]; const ally = allyId ? sourceActor(context, allyId) : undefined;',
    // Migrated Fool keeps its pinned adapter surface; the retained captured
    // dereferences (Masquerade's input-selected ally, Chronotemper's
    // input-target-or-self) stay inventoried at the caller.
    'content/jobs/programs/fool-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const allyId = context.input.actorIds?.target?.[0]; const ally = allyId ? sourceActor(context, allyId) : undefined; const targetId = context.input.actorIds?.target?.[0] ?? source.id; const chosen = sourceActor(context, targetId);',
    // Migrated Geomancer keeps its pinned adapter surface; the retained
    // captured/precedence dereferences (Dragon Dive / Terraforming /
    // Realignment `input.actorIds ?? attackTargetId`, Midas
    // `input.actorIds ?? triggerTargetIds`) stay inventoried at the caller.
    'content/jobs/programs/geomancer-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined; const interruptId = context.input.actorIds?.target?.[0] ?? context.triggerTargetIds?.[0]; const interruptTarget = interruptId ? sourceActor(context, interruptId) : undefined;',
    // Migrated Stormbender keeps its pinned adapter surface; the retained
    // captured/precedence dereferences (Geyser / Deepwrath / Waterspout
    // `input.actorIds ?? attackTargetId`, Eye Of The Storm's recorded
    // center selection) stay inventoried at the caller.
    'content/jobs/programs/stormbender-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined; const centerId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const centerActor = centerId ? sourceActor(context, centerId) : undefined;',
    'content/jobs/job-trait-resolvers.ts': 'resolveSourceActor(context); resolveAttackTarget(context); mutations.push({ kind: \'condition\', sourceId: context.sourceId, sourceActorId: context.actorId, actorId: target.id });',
    'content/classes/class-resolvers.ts': 'resolveSourceActor(context); resolveAttackTarget(context); const inputTargets = context.input.actorIds?.target; if (inputTargets[0] !== context.attackTargetId) throw 0;',
  };

  it('T5c: accepts a clean content layer — adapter surface + caller-owned U4 reads + provenance plumbing', () => {
    expect(u1ReferenceRoutingProblems({ ...valid, ...validContent })).toEqual([]);
  });

  it('T5c: flags a content program that dereferences a legacy slot through state.actors', () => {
    expect(u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/classes/class-resolvers.ts': "const target = context.state.actors[context.attackTargetId];",
    })).toContainEqual(expect.objectContaining({
      file: 'content/classes/class-resolvers.ts',
      detail: expect.stringContaining('dereferences a legacy reference slot'),
    }));
  });

  it('T5c: retained CAPTURED dereferences in a migrated program stay accepted — NOT a blanket ban; only the direct dereference + pins bite', () => {
    // With every named program family migrated (Colossus closed the last
    // PURE family), the remaining `sourceActor(context, <var>)` calls are
    // ONLY the classified U1×U4 captured-identity boundary: recorded input
    // selections, recorded `??` fallbacks, loop elements, and helper
    // parameters — caller-owned cardinality/choice whose dereference is the
    // inventoried captured shape (docs/u8-u1-underlay-census.md). The guard
    // must not force a blind mechanical rewrite of those (migrated-family
    // pins + the retained-captured fixtures above prove they are accepted),
    // nor silently accept a NEW direct `state.actors[context.…]` dereference.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      // A fully-migrated family KEEPING its captured reads is clean: the
      // helper-parameter plannedFly deref and the input-selected targets are
      // caller-owned, not live-slot interpretation.
      'content/jobs/programs/colossus-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const source2 = sourceActor(context, actorId); const targetId = context.input.actorIds?.target?.[0]; const chosen = targetId ? sourceActor(context, targetId) : undefined;',
    });
    expect(problems).toEqual([]);
    // But a NEW direct dereference in the same file is still caught — the
    // accepted-residual carve-out never legitimizes state.actors[context.…].
    expect(u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/colossus-programs.ts': 'const source = resolveSourceActor(context); const target = context.state.actors[context.attackTargetId];',
    })).toContainEqual(expect.objectContaining({
      file: 'content/jobs/programs/colossus-programs.ts',
      detail: expect.stringContaining('dereferences a legacy reference slot'),
    }));
  });

  it('T5c: catches a MIGRATED Sealer program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/sealer-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/sealer-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
  });

  it('T5c: catches a MIGRATED Shade/Warden program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting the migrated LIVE slot reads drops the pinned adapter
    // accessors; the guard flags the missing calls without a lexical ban on
    // the retained captured-input dereferences.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/shade-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/shade-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
  });

  it('T5c: catches a MIGRATED Enochian program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Enochian's migrated LIVE slots drops the pinned adapter
    // accessors; the retained captured-input dereferences (the `??`-chain ids)
    // must NOT themselves be flagged — only the missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/enochian-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const allyId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const ally = allyId ? sourceActor(context, allyId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/enochian-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/enochian-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Chanter program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Chanter is the lifecycle-heavy family (Monogatari U8/U16). The revert
    // proof is the same as the other pinned families: reverting the migrated
    // LIVE slots drops the pinned accessors, while the retained
    // captured-input dereferences (allyIds from input.actorIds) alone must
    // NOT trip the pin — U1 routing, not a lexical ban.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/chanter-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const allyId = context.input.actorIds?.target?.[0]; const ally = allyId ? sourceActor(context, allyId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/chanter-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/chanter-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Knave program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Knave's migrated LIVE slots drops the pinned accessors; the
    // retained captured/precedence dereferences (plannedRush's actorId
    // parameter, Dire Parry's triggerSource ?? input chain, Strongarm's
    // input.actorIds target) must NOT themselves be flagged — only the
    // missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/knave-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; function plannedRush(context, actorId) { return sourceActor(context, actorId); } const foeId = context.triggerSourceId ?? context.input.actorIds?.target?.[0]; const foe = foeId ? sourceActor(context, foeId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/knave-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/knave-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Harvester program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Harvester's migrated LIVE slots drops the pinned accessors;
    // the retained DERIVED_OR_PRECEDENCE_BOUNDARY (blood-grove's in-call
    // input.actorIds center read) and the ??-chain captured dereferences must
    // NOT themselves be flagged — only the missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/harvester-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const center = context.input.actorIds?.target?.[0] ? sourceActor(context, context.input.actorIds.target[0])?.position : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/harvester-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/harvester-programs.ts').length).toBe(1);
  });

  it('T5c: accepts the protected DERIVED_OR_PRECEDENCE_BOUNDARY in a MIGRATED Harvester — the guard does not force a lexical rewrite of the in-call precedence read', () => {
    // The ONE repo-wide DERIVED_OR_PRECEDENCE_BOUNDARY (blood-grove center)
    // is deliberately NOT migrated in this tranche; its in-call
    // `input.actorIds.target[0]` precedence read must remain ALLOWED by the
    // guard while the migrated PURE pins still hold.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/harvester-programs.ts': 'const source = resolveSourceActor(context); const target = resolveAttackTarget(context); const center = context.input.actorIds?.target?.[0] ? sourceActor(context, context.input.actorIds.target[0])?.position : undefined;',
    });
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/harvester-programs.ts')).toEqual([]);
  });

  it('T5c: catches a MIGRATED Demon Slayer program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Demon Slayer's migrated LIVE slots drops the pinned
    // accessors; the retained helper-parameter dereference (plannedRush) and
    // the recorded ally choice (Righteous Disdain) must NOT themselves be
    // flagged — only the missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/demon-slayer-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; function plannedRush(context, actorId) { return sourceActor(context, actorId); } const allyId = context.input.actorIds?.target?.[0]; const ally = allyId ? sourceActor(context, allyId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/demon-slayer-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/demon-slayer-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Fool program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Fool's migrated LIVE slots drops the pinned accessors; the
    // retained captured dereferences (Masquerade's chosen ally,
    // Chronotemper's target-or-self) must NOT themselves be flagged — only
    // the missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/fool-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const allyId = context.input.actorIds?.target?.[0]; const ally = allyId ? sourceActor(context, allyId) : undefined; const targetId = context.input.actorIds?.target?.[0] ?? source.id; const chosen = sourceActor(context, targetId);',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/fool-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/fool-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Geomancer program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Geomancer's migrated LIVE slots drops the pinned accessors;
    // the retained captured/precedence dereferences (Dragon Dive /
    // Terraforming / Realignment input ?? attackTarget chains, Midas input ??
    // triggerTargets) must NOT themselves be flagged — only the missing pins
    // bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/geomancer-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/geomancer-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/geomancer-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Stormbender program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Stormbender's migrated LIVE slots drops the pinned accessors;
    // the retained captured/precedence dereferences (Geyser / Deepwrath /
    // Waterspout input ?? attackTarget, Eye Of The Storm's recorded center)
    // must NOT themselves be flagged — only the missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/stormbender-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/stormbender-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/stormbender-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Colossus program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Colossus's migrated LIVE slots drops the pinned accessors;
    // the retained captured dereferences (plannedFly's helper-parameter read,
    // Dropkick / Great Suplex `input.actorIds` targets) must NOT themselves
    // be flagged — only the missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/colossus-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const targetId = context.input.actorIds?.target?.[0]; const chosen = targetId ? sourceActor(context, targetId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/colossus-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/colossus-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED Seer program that reverts live-slot reads to legacy sourceActor(context, …)', () => {
    // Reverting Seer's migrated LIVE slots drops the pinned accessors; the
    // retained captured dereferences (Chaos Tarot / Polaris / Sisyphus /
    // Eclipse `input.actorIds ?? attackTargetId` chains, Reverse Fate / Wish
    // `input.actorIds ?? triggerTargetIds` allies) must NOT themselves be
    // flagged — only the missing pins bite.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/seer-programs.ts': 'const source = sourceActor(context, context.actorId); const target = context.attackTargetId ? sourceActor(context, context.attackTargetId) : undefined; const targetId = context.input.actorIds?.target?.[0] ?? context.attackTargetId; const chosen = targetId ? sourceActor(context, targetId) : undefined;',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/seer-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
    expect(problems.filter((problem) => problem.file === 'content/jobs/programs/seer-programs.ts').length).toBe(1);
  });

  it('T5c: catches a MIGRATED program that reverts to direct slot resolution (drops the adapter calls)', () => {
    // Bastion reverting to the legacy `sourceActor(context, …)` read is caught
    // by the POSITIVE routing pin (the adapter accessors stop being called) —
    // a migrated file cannot bypass U1 by restoring legacy resolution.
    const problems = u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/jobs/programs/bastion-programs.ts': 'const source = sourceActor(context, context.actorId);',
    });
    expect(problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: 'content/jobs/programs/bastion-programs.ts', detail: expect.stringContaining('no longer routes') }),
    ]));
  });

  it('T5c: catches an adapter that stops composing the U1 vocabulary', () => {
    expect(u1ReferenceRoutingProblems({
      ...valid,
      ...validContent,
      'content/glue/reference-authoring.ts': 'export function resolveSourceActor(context) { return context.state.actors[context.actorId]; }',
    })).toContainEqual(expect.objectContaining({
      file: 'content/glue/reference-authoring.ts',
      detail: expect.stringContaining('no longer composes the single U1 vocabulary'),
    }));
  });
});

describe('U8 Scope/Clock routing guard', () => {
  const valid = [
    'function durationExpiresAtBoundary(duration, boundary) {',
    '  const kindRef = clockForTiming(duration.kind);',
    '  return boundaryEquals(kindRef, boundary);',
    '}',
    'const kept = records.filter(({ duration }) => durationSurvivesCombatEnd(duration));',
  ].join('\n');

  it('accepts reducer membership that consumes the U8 authority', () => {
    expect(u8EncounterRoutingProblems(valid)).toEqual([]);
  });

  it('catches a retained decoy call plus a restored local expedition-kind interpreter', () => {
    const mutated = `${valid}\nconst kept = records.filter(({ duration }) => duration.kind === 'expedition');`;
    expect(u8EncounterRoutingProblems(mutated)).toContain('combat cleanup re-interprets duration.kind === expedition locally');
  });

  it('catches expiry or cleanup dropping its U8 call path', () => {
    expect(u8EncounterRoutingProblems("function durationExpiresAtBoundary(d, b) { return d.kind === b; }"))
      .toEqual(expect.arrayContaining([
        'combat cleanup does not call durationSurvivesCombatEnd',
        'boundary expiry no longer routes through clockForTiming and boundaryEquals',
      ]));
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

  it('U16 (F9 availability): keeps the U16 operation but reads raw ruleState for the gate — MUST FAIL', () => {
    setup();
    // The fold CALLS the U16 operation (Check 8 routing passes) but decides
    // availability from raw actor.ruleState instead of the returned `result` —
    // the M1 raw-ruleState seam and the positive `result.available` pin flag it.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { applyOncePerRoundUsage } from './use-ledger.js';",
        'export function gate(actor, sourceId, effects) {',
        '  const result = applyOncePerRoundUsage({ actor, sourceId, mutations: effects });',
        '  return !actor.ruleState["ledger:round:" + sourceId] ? result.mutations : [];',
        '  // availability read from raw ruleState, not result.available',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('ruleState'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 (F9 consume): keeps the operation bundle but hand-builds the state mark — MUST FAIL', () => {
    setup();
    // The fold CALLS the operation but never commits its returned `mutations`;
    // it persists a locally-built `{ kind: "state", ... }` mark instead — the
    // M2 seam and the positive `result.mutations` pin flag it (independent
    // consume construction).
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { applyOncePerRoundUsage } from './use-ledger.js';",
        'export function fold(actor, sourceId, effects) {',
        '  const result = applyOncePerRoundUsage({ actor, sourceId, mutations: effects });',
        '  if (!result.available) return [];',
        '  return [{ kind: "state", key: "ledger:round:" + sourceId, actorId: actor.id, operation: "set", value: true }];',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('result.mutations'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 (F9 key): rebuilds the ledger address locally via string concatenation — MUST FAIL', () => {
    setup();
    // A locally rebuilt address (`` 'ledger:' + 'round:' + sourceId ``) is a
    // competing U16 authority; the fold routes nothing through the operation, so
    // Check 7 (key reconstruction) and the symbol-routing guard both fire.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        'export function keyFor(sourceId) {',
        "  return 'ledger:' + 'round:' + sourceId;",
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('applyOncePerRoundUsage'),
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

  it('U16 adversarial-2 (LOCAL AVAILABILITY): the real gate is kept alive but the decision re-reads raw ruleState — MUST FAIL', () => {
    setup();
    // The caller CALLS the U16 authority and keeps its key, but substitutes an
    // answer derived from raw ruleState instead of `gate.available`.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { usageKey, ledgerAvailable, consumeUsageMutation } from '../primitives/usage.js';",
        'export function decide(actor, sourceId) {',
        '  const real = oncePerRoundGate(actor, sourceId);',
        '  usageKey({ sourceId, ownerId: actor.id, scope: "round" });',
        '  ledgerAvailable(actor, real.key);',
        '  consumeUsageMutation(sourceId, actor.id, real.key);',
        '  const local = !actor.ruleState[real.key];',
        '  return local; // local availability replaces gate.available',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('ruleState'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16-M5 (spread/alias): a genuine U16 result is spread and its entitlement semantics replaced before committing — MUST FAIL', () => {
    setup();
    // Even receiving a legitimate U16 result, a caller can no longer hand the
    // engine a competing once-per-round commit: spreading it and overriding
    // available/mutations with a locally built bundle hand-builds the mark (M2)
    // and stops naming the returned result (positive result.available /
    // result.mutations pins). The production fold commits only the returned
    // bundle, so replacing the semantics is exactly this — flagged. Solved by
    // the API boundary and these pins, NOT by a branded-data-object proof.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { applyOncePerRoundUsage } from './use-ledger.js';",
        'export function fold(actor, sourceId, effects) {',
        '  const result = applyOncePerRoundUsage({ actor, sourceId, mutations: effects });',
        '  const forged = { ...result };',
        '  forged.available = true;',
        '  forged.mutations = [{ kind: "state", key: ["ledger", "round", sourceId].join(":"), actorId: actor.id, operation: "set", value: true }];',
        '  return forged.mutations;',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('result.available'),
        }),
      ]),
    );
    rmSync(tmpDir, { recursive: true });
  });

  it('U16 adversarial (LOCAL KEY): the operation is called as a decoy but a re-joined storage address drives the commit — MUST FAIL', () => {
    setup();
    // A fold may keep the operation CALLED (Check 8 routing passes) yet still
    // construct its own commitment off a locally rejoined address
    // (`['ledger','round',sourceId].join(':')`). Because it never commits the
    // returned `mutations` bundle, the positive `result.mutations` pin flags it
    // — the key is behind the operation, so a competing key path is a competing
    // transaction.
    writeFileSync(
      join(tmpDir, 'kernels', 'trait-reactions.ts'),
      [
        "import { applyOncePerRoundUsage } from './use-ledger.js';",
        'export function keyFor(actor, sourceId, effects) {',
        '  const result = applyOncePerRoundUsage({ actor, sourceId, mutations: effects });',
        '  const localKey = ["ledger", "round", sourceId].join(":");',
        '  return [localKey, result.available];',
        '}',
      ].join('\n'),
    );

    const result = auditArchitecture(tmpDir);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          check: 'u16-usage-ledger-routing',
          file: 'kernels/trait-reactions.ts',
          detail: expect.stringContaining('result.mutations'),
        }),
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

  it('the once-per-round F9 fold routes the whole entitlement transaction through the U16 operation', () => {
    const traitReactions = read('kernels/trait-reactions.ts');
    // F9 commits the once-per-round gated reaction through applyOncePerRoundUsage
    // (the U16 COMMIT operation in kernels/use-ledger.ts) — never the raw core
    // symbols, never a locally rebuilt `ledger:round:<id>` key.
    expect(traitReactions).toContain('applyOncePerRoundUsage');
    expect(traitReactions).not.toMatch(/ledger:\$\{/);
    // The obsolete branded-plan machinery (OncePerRoundGate / oncePerRoundGate /
    // the private brand) is DELETED — F9 exposes no gate internals to forge.
    expect(traitReactions).not.toMatch(/OncePerRoundGate|oncePerRoundGate|oncePerRoundGateBrand/);
  });

  it('the F9 fold gates on the operation result.available and commits result.mutations verbatim', () => {
    const traitReactions = read('kernels/trait-reactions.ts');
    // The production fold decides availability from the operation's returned
    // `result.available` and commits EXACTLY the returned `result.mutations`
    // bundle (the U16 consume mark grouped with the allowed reaction effects).
    // It never recomputes availability from raw state, never rejoins the key,
    // never hand-builds the mark, and takes the ACTOR (no owner to fabricate).
    expect(traitReactions).toContain('applyOncePerRoundUsage({ actor, sourceId: traitId, mutations: proposed })');
    expect(traitReactions).toContain('result.available');
    expect(traitReactions).toContain('result.mutations');
    expect(traitReactions).toContain('out.push(...result.mutations)');
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
// Regression: U16 residual once-per-scope marks are MIGRATED to ledger keys,
// not raw ruleState booleans/counters (U16 residual-usage-state census, 2026-08-31)
// ---------------------------------------------------------------------------

describe('U16 — migrated once-per-scope marks are not reintroduced as raw ruleState', () => {
  const dir = import.meta.dirname;
  const srcDir = join(dir, '..', '..');
  const read = (rel: string) => {
    const { readFileSync } = require('node:fs');
    const path = require('node:path');
    return readFileSync(path.join(srcDir, rel), 'utf8');
  };

  it('the once-per-round marks route through the U16 ledger, never raw booleans in the reducer', () => {
    const reducer = read('rules/encounter.ts');
    expect(reducer).not.toMatch(/ruleState\['chain-reaction-used'\]/);
    expect(reducer).not.toMatch(/ruleState\['incubus:triggered'\]/);
    expect(reducer).not.toMatch(/ruleState\['stampede:triggered'\]/);
    expect(reducer).not.toMatch(/ruleState\['gates-of-hell:vigilance-rushed'\]/);
    // The Chain Reaction gate routes through the U16 typed round key.
    expect(reducer).toContain('chainReactionOncePerRoundKey');
    expect(reducer).toContain('useLedgerAvailable');
    // Round-boundary reset is unconditional and routed through U16.
    expect(reducer).toContain('refreshUsageLedgerForBoundary');
  });

  it('the content consumers route their once-per-scope gates through the U16 typed keys', () => {
    const recipes = read('rules/automation/content/jobs/lifecycle-recipes.ts');
    expect(recipes).not.toContain("'incubus:triggered'");
    expect(recipes).not.toContain("'stampede:triggered'");
    expect(recipes).toContain('incubusOncePerRoundKey');
    expect(recipes).toContain('stampedeOncePerRoundKey');
    expect(recipes).toContain('recordUsageKey');
    const demonSlayer = read('rules/automation/content/jobs/programs/demon-slayer-programs.ts');
    expect(demonSlayer).not.toContain("'gates-of-hell:vigilance-rushed'");
    expect(demonSlayer).toContain('vigilanceRushOncePerTurnKey');
    const geomancer = read('rules/automation/content/jobs/programs/geomancer-programs.ts');
    expect(geomancer).not.toContain("'midas:used'");
    expect(geomancer).toContain('midasOncePerCombatKey');
    // Bull's Strength (per-target once-per-any-turn collide) also routes
    // through the U16 target-sensitive key + operation-boundary transaction,
    // never a raw `bull-s-strength:collided` flag with a bespoke turn-end
    // clear or a guardSeen set keyed on the source id.
    const modifiers = read('rules/automation/content/jobs/attack-modifier-recipes.ts');
    expect(modifiers).not.toContain("'bull-s-strength:collided'");
    expect(modifiers).toContain('bullStrengthCollideKey');
    expect(modifiers).toContain('applyBullStrengthCollide');
    expect(modifiers).not.toContain('guardSeen');
    expect(recipes).not.toContain("'bull-s-strength:collided'"); // bespoke turn-end clear removed
  });

  it('the U16 usage kernel owns the six migrated round/turn/combat gate keys, and Bull\'s Strength is the per-target any-turn form', () => {
    const ledger = read('rules/automation/kernels/use-ledger.ts');
    expect(ledger).toContain('chainReactionOncePerRoundKey');
    expect(ledger).toContain('incubusOncePerRoundKey');
    expect(ledger).toContain('stampedeOncePerRoundKey');
    expect(ledger).toContain('vigilanceRushOncePerTurnKey');
    expect(ledger).toContain('midasOncePerCombatKey');
    // Bull's Strength is a per-RECIPIENT gate: the target suffix is part of the
    // typed U16 key and the scope is the battlefield `any-turn` window (reopens
    // at every actor's turn start), NOT an owner-relative `turn` gate.
    expect(ledger).toContain('bullStrengthCollideKey');
    expect(ledger).toContain("scope: 'any-turn'");
    expect(ledger).toContain('targetId');
    expect(ledger).not.toContain('bullStrengthOncePerTurnKey');
  });
});

// ---------------------------------------------------------------------------
// Regression: single action-cost authority (F8a merge contamination guard)
// ---------------------------------------------------------------------------

describe('single action-cost authority', () => {
  it('semantic repair: the Heroic activation KERNEL stays generic — the four named heroics live only in content recipes', () => {
    // The generic Heroic kernel composes transaction/usage/continuation
    // concepts only; Strive, Demon Strength, Wolfheart, and Spite are named
    // source semantics owned by content/jobs/heroic-activation-recipes.ts.
    // A bare `demon-strength` literal would escape the generic source-id
    // audit (no colon), so this pin reads the REAL files directly.
    const junctionDir = joinPath(import.meta.dirname, '..', 'automation');
    const kernel = readFileSync(joinPath(junctionDir, 'kernels', 'heroic-activation.ts'), 'utf8');
    const recipes = readFileSync(joinPath(junctionDir, 'content', 'jobs', 'heroic-activation-recipes.ts'), 'utf8');
    const named = ['strive', 'demon-strength', 'wolfheart', 'spite'];
    // The content side must keep owning them (the guard cannot be satisfied
    // by deleting the mechanics everywhere).
    for (const stem of named) expect(recipes.toLowerCase()).toContain(stem);
    // The kernel must stay name-free in CODE (doc prose may name the sources
    // it serves; a behavior branch or literal id must not).
    const kernelCode = kernel.split('\n').filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line)).join('\n');
    for (const stem of named) expect(kernelCode.toLowerCase()).not.toContain(stem);
    // No opaque kind-switch on named heroics — the kernel's `kind` reads are
    // generic recipe vocabulary only (continuation/gate/cost/effect kinds).
    expect(/kind\s*===?\s*['"](strive|demon-strength|wolfheart|spite)['"]/i.test(kernel)).toBe(false);
  });

  it('semantic repair: Blast geometry is template-backed — square-radius canonization cannot return', () => {
    // ICON p.97 defines Blast as three VISUAL templates, not a Chebyshev
    // radius. The exact templates live in the geometry authority
    // (`blastTemplateCells`) and every blast claim must route through them;
    // re-introducing `medium blast = squareArea(2)` in the shared vocabulary
    // or its tests regresses the repair.
    const junctionDir = joinPath(import.meta.dirname, '..');
    const geometry = readFileSync(joinPath(junctionDir, 'area-geometry.ts'), 'utf8');
    expect(geometry).toContain('blastTemplateCells');
    expect(/\bsmall blast\b[^\n]*radius 1/i.test(geometry)).toBe(false);
    expect(/\bmedium blast\b[^\n]*radius 2/i.test(geometry)).toBe(false);
    expect(/\bblastTemplateCells\s*\([^)]*\bsize\b[^)]*\)\s*\{\s*$/.test(geometry)).toBe(false);
    const areaKernel = readFileSync(joinPath(junctionDir, 'automation', 'kernels', 'area.ts'), 'utf8');
    expect(areaKernel).not.toContain('squareArea(origin, 2)');
  });

  it('semantic repair: Demon Slayer rushes advance through the shared walk authority — no local stepping loop', () => {
    // #10: Demon Cutter's Talent II rush is a recorded movement PATH through
    // `validateSpatialIntent`, and `plannedRush` accumulates over the shared
    // `walk` authority. A manually-grid-stepped `position += direction` loop
    // in the program file duplicates movement authority and must not return.
    const program = readFileSync(
      joinPath(import.meta.dirname, '..', 'automation', 'content', 'jobs', 'programs', 'demon-slayer-programs.ts'),
      'utf8',
    );
    expect(/\.x\s*\+=\s*dir(ection)?\.x|\.y\s*\+=\s*dir(ection)?\.y/.test(program)).toBe(false);
    // The one accumulation helper present must delegate every legality call
    // to the shared walk authority.
    const plannedRush = /function plannedRush[\s\S]*?^\}/m.exec(program);
    expect(plannedRush).not.toBeNull();
    expect(plannedRush![0]).toContain('walk(context');
  });

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
