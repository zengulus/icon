/**
 * Architecture audit core logic.
 *
 * Checks the one-way dependency rule:
 *   content → kernels → primitives
 *
 * Exports functions for use by both the CLI script and the test suite.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, dirname, join, extname } from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Violation {
  check: string;
  file: string;
  detail: string;
}

export interface AuditResult {
  violations: Violation[];
  checked: {
    totalFiles: number;
    primitives: number;
    kernels: number;
    content: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (extname(full) === '.ts') {
      out.push(full);
    }
  }
  return out;
}

/** Posix-style relative path regardless of host separators, so the layer
 * checks (and the exemption map keys) work identically on Windows and
 * POSIX hosts. */
function posixRelative(automationRoot: string, file: string): string {
  return relative(automationRoot, file).split(/[\\/]/).join('/');
}

/** Layer classification for a file under automation/. */
export function layerFor(file: string, automationRoot: string): 'primitives' | 'kernels' | 'content' | 'other' {
  const first = posixRelative(automationRoot, file).split('/')[0];
  if (first === 'primitives') return 'primitives';
  if (first === 'kernels') return 'kernels';
  if (first === 'content') return 'content';
  return 'other';
}

/**
 * Parse static import specifiers from .ts source code.
 * Returns the raw specifier strings (e.g. '../kernels/runtime.js').
 *
 * Handles static import/export declarations, including multiline forms:
 *   import '<specifier>';          (side-effect)
 *   import ... from '<specifier>';
 *   export ... from '<specifier>';
 */
export function parseImports(code: string): string[] {
  const source = ts.createSourceFile('architecture-audit-input.ts', code, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const specs: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier)
      && (specifier.text.startsWith('.') || specifier.text.startsWith('/'))) {
      specs.push(specifier.text);
    }
  }
  return specs;
}

/**
 * Resolve a relative import specifier to an absolute .ts file path.
 * Handles .js → .ts extension mapping and /index.ts.
 */
export function resolveImport(from: string, spec: string): string | null {
  const dir = dirname(from);
  let target = join(dir, spec);
  if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
  try { if (statSync(target).isFile()) return target; } catch { /* not found */ }
  const idx = join(target, 'index.ts');
  try { if (statSync(idx).isFile()) return idx; } catch { /* not found */ }
  return null;
}

// Hardcoded source-ID pattern: 'word:word...' inside a string literal.
// Matches strings like 'core:standard-move', 'bastion:trait:strive',
// 'basic:crusher:301:headbutt', 'vagabond:trait:skirmisher', etc.
// The pattern is: at least one colon-separated segment of [a-z0-9-]+,
// where segments are separated by colons and segments may contain hyphens.
const SOURCE_ID_RE = /['"]([a-z][a-z0-9-]*:[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)*)['"]/g;

// Known false-positive patterns inside primitives/kernels:
// - Type annotations: sourceId?: string, sourceId: string
// - Variable references: context.sourceId, event.sourceId
// - Comments and JSDoc mentioning sourceId
// - The string 'sourceId' itself as a property key
// - Template literals with ${...} containing sourceId (dynamic)
const SOURCE_ID_FALSE_POSITIVE_RE =
  /sourceId|sourceActorId|sourceRuleId|FoeRoleId|\$\{|\/\*|\/\/|import\.meta|console\.|warn\(|error\(|throw /;

// Known legitimate source IDs in kernel files. The core combat resolvers
// (core:standard-move, core:light-attack, core:heavy-attack) map reducer-
// backed rules into the shared VM; the interrupt allowlist checks reference
// reviewed interrupt sources (fool:masquerade, knave:sucker-punch) by ID.
// These are protocol-level registrations, not per-content resolvers.
const KERNEL_SOURCE_ID_EXEMPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['kernels/core-resolvers.ts', new Set(['core:standard-move', 'core:light-attack', 'core:heavy-attack'])],
  ['kernels/encounter-adapter.ts', new Set(['fool:masquerade', 'knave:sucker-punch'])],
  // The U16 usage-ledger kernel's entitlement/window gates. These are the
  // protocol-level core-mechanic gate provenance keys (p.91 one-attack /
  // one-interrupt-per-turn / No Repeats / the once-per-own-turn standard move,
  // p.116 Slashed, p.89 dangerous terrain once-per-turn) owned by the shared
  // U16 authority - not per-content resolvers, and no content/consumer may
  // reuse the vocabulary.
  ['kernels/use-ledger.ts', new Set(['core:one-interrupt-per-turn', 'core:attack-this-turn', 'core:slashed-this-turn', 'core:dangerous-terrain-this-turn', 'core:standard-move', 'core:chain-reaction', 'core:bull-s-strength', 'shade:incubus', 'warden:stampede', 'gates-of-hell:vigilance-rushed', 'geomancer:midas'])],
]);

// T6.4 (U16): exactly the raw usage/entitlement fields migrated OFF the
// EncounterActor type. Any member of this exact set (or an actor-level
// `\w*UsedThisTurn` / `\w*TriggeredThisTurn` entitlement boolean) reintroduced
// to the authoritative type must instead be routed through the U16 ledger in
// kernels/use-ledger.ts. Retained SPECIALISTS are not matches: `attackedThisTurn`
// (the U10 historical resolution fact, NOT the one-attack entitlement) and the
// scheduler/lifecycle clock fields (`turnTaken`, `turnsTakenThisRound`). The
// former raw/scheduler names `standardMoveUsed` / `usedAbilityIds` are NOT
// retained — they were MIGRATED to typed ledger keys (T6.4a, schema 12) and are
// therefore reserved bespoke names, exactly like the other migrated fields.
const RESERVED_BESPOKE_U16_FIELDS: ReadonlySet<string> = new Set([
  // T6.4: the four raw usage/entitlement fields.
  'interruptUses',
  'interruptUsedThisTurn',
  'slashedTriggeredThisTurn',
  'dangerousTerrainTriggeredThisTurn',
  // T6.4a: the No Repeats array and the once-per-own-turn standard-move
  // boolean both folded onto typed ledger keys (schema 12).
  'usedAbilityIds',
  'standardMoveUsed',
]);

/** Single source of truth for the semantic guard: does an `EncounterActor`
 * field name reintroduce a bespoke U16 usage/entitlement authority? The exact
 * migrated names plus any actor-level `\w*UsedThisTurn` / `\w*TriggeredThisTurn`
 * entitlement boolean. Retained SPECIALISTS are NOT matches: `attackedThisTurn`
 * (the U10 resolution fact, NOT the one-attack entitlement) and the
 * scheduler/lifecycle clock fields (`turnTaken`, `turnsTakenThisRound`).
 * `standardMoveUsed` / `usedAbilityIds` are NOT retained specialists — both were
 * migrated (T6.4a, schema 12) and remain reserved bespoke names.
 */
export function isBespokeU16FieldName(name: string): boolean {
  return RESERVED_BESPOKE_U16_FIELDS.has(name)
    || /^[a-zA-Z0-9_]*TriggeredThisTurn$/.test(name)
    || /^[a-zA-Z0-9_]*(?:UsedThisTurn)$/.test(name);
}

/** Concrete semantic-atomicity guard: kernels may not obtain foundational
 * operations through the content-authoring facade. */
export function kernelAuthoringFacadeProblems(codeByFile: Readonly<Record<string, string>>): Violation[] {
  const problems: Violation[] = [];
  for (const [file, code] of Object.entries(codeByFile)) {
    if (!file.startsWith('kernels/')) continue;
    if (parseImports(code).some((specifier) => /(?:^|\/)primitives\/job-kit\.js$/.test(specifier))) {
      problems.push({
        check: 'kernel-authoring-facade-import',
        file,
        detail: 'kernel imports foundational semantics from primitives/job-kit.ts; import the owning primitive/domain surface directly',
      });
    }
  }
  return problems;
}

/** U4 must validate position membership through U3, not reinterpret bounds or
 * footprint range locally. This pins the restored authority route without
 * pretending arbitrary atomicity is regex-provable. */
export function choiceCandidateRoutingProblems(choiceCode: string): string[] {
  const problems: string[] = [];
  if (!choiceCode.includes('validateActorCandidate(')) problems.push('actor choices no longer call U3 validateActorCandidate');
  const source = ts.createSourceFile('choice.ts', choiceCode, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const positionResolver = source.statements.find((statement): statement is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'resolvePositions');
  const body = positionResolver?.body?.getText(source) ?? '';
  const candidateBinding = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*validatePositionCandidate\s*\(/.exec(body)?.[1];
  if (!candidateBinding) {
    problems.push('position choices do not bind the U3 validatePositionCandidate result');
  } else {
    const escaped = candidateBinding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${escaped}\\.legal\\b`).test(body)
      || !new RegExp(`\\b${escaped}\\.problem\\b`).test(body)) {
      problems.push('position choices do not consume U3 legality and problem classification');
    }
  }
  if (parseImports(choiceCode).some((specifier) => /(?:^|\/)primitives\/(?:battlefield|spatial-intent)\.js$/.test(specifier))) {
    problems.push('choice kernel imports raw spatial semantics instead of U3 candidate validation');
  }
  if (/\b(?:withinGrid|footprintDistance)\s*\(/.test(body)
    || /\.grid\.(?:width|height)\b/.test(body)
    || /\bcell\.(?:x|y)\s*(?:<|<=|>|>=)\s*0\b/.test(body)
    || /Math\.max\s*\([\s\S]*?Math\.abs\s*\(/.test(body)) {
    problems.push('position choices locally reinterpret U3 bounds or footprint-range legality');
  }
  return problems;
}

// U2 (role/perspective) single-authority guard details.
//
// These are the CONSUMERS migrated to derive semantic relation / controller /
// chooser perspective through `primitives/roles.ts` (the U2 authority). Each
// must keep importing/using its U2 symbol; a contributor who re-derives the
// perspective from an incidental field (e.g. `context.actorId`) must drop the
// import, which this structural allowlist catches. This is NOT a global ban on
// `.side` / `ownerId` / `actorId` — those remain legitimate underlying facts
// for many non-U2 responsibilities.
const U2_PERSPECTIVE_SYMBOLS: ReadonlyMap<string, string> = new Map([
  // candidate.ts must resolve the relation perspective (whose SIDE establishes
  // self/ally/foe) through roles.ts, never straight off `context.actorId`.
  ['kernels/candidate.ts', 'relationPerspectiveIdFromContext'],
  // aura.ts must derive the SEMANTIC perspective (`perspectiveActorId` field) by
  // CALLING the U2 role-perspective authority (`auraRelationPerspectiveId`) with
  // the spatial-origin FACTS — separate from the SPATIAL anchor
  // (`actorId`/`entityId`, the U7 origin). ROLE ≠ ANCHOR.
  ['kernels/aura.ts', 'auraRelationPerspectiveId'],
]);

// The precise removed independent-perspective patterns in aura.ts: the old
// `AuraOriginRef#side` field derived ally/foe directly from the spatial anchor
// or owner (`side: owner?.side ?? null`) and the member relation compared
// `actor.side === origin.side`. The migrated authority reads
// `perspectiveActorId`, then compares `actor.side === perspective.side`. Any
// reintroduction of the anchor-derived side relation is a U2 duplicate. The legit
// `AuraActorView.side = actor.side` factual projection in the view adapters is
// NOT matched — the actor's own side is a property, not the U2 member perspective.
const AURA_ANCHOR_SIDE_RESTORE_RE = /origin\.side\b|\.side\s*\?\?\s*null/;

// T8c — alias-tolerant SEMANTIC-OWNERSHIP guard. Call-presence plus a spelling
// regex (`perspectiveActorId: actor.id`) is NOT authority proof: a contributor
// can call U2, ignore its result, and alias a local into the slot
// (`const p = actor.id; ... perspectiveActorId: p`). The guard therefore flags
// EVERY value-producing producer of the `perspectiveActorId` field in aura.ts
// (an object-literal property, a const/let/var declaration, or a member write)
// whose right-hand side is NOT the `auraRelationPerspectiveId(` call. The
// interface TYPE-ANNOTATION is exempt (it declares the type, it does not
// produce a runtime value). This is dependency enforcement for ONE semantically
// meaningful slot — no enumeration of incidental-id spellings.
const AURA_PERSPECTIVE_PRODUCER_RE =
  /(?:perspectiveActorId\s*:\s*|(?:const|let|var)\s+perspectiveActorId\s*=\s*|\.perspectiveActorId\s*=\s*)/g;

/** Every runtime producer of the `perspectiveActorId` value in aura.ts that is
 * NOT the U2 call, or an empty list when every producer routes through U2.
 * The interface field declaration (`perspectiveActorId: RelationPerspective |
 * null;`) is a type annotation and is exempted. Reads (`origin.
 * perspectiveActorId`) have no assignment and never match. */
export function nonAuthorityAuraPerspectiveProducers(code: string): string[] {
  const bad: string[] = [];
  AURA_PERSPECTIVE_PRODUCER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AURA_PERSPECTIVE_PRODUCER_RE.exec(code))) {
    const lhs = m[0];
    const rhs = code.slice(m.index + lhs.length);
    if (/^(?:string|RelationPerspective)\b/.test(rhs)) continue; // type annotation
    if (rhs.startsWith('auraRelationPerspectiveId(')) continue;   // the U2 route
    bad.push(lhs.trim());
  }
  return bad;
}

/** U8 combat-cleanup routing guard. The reducer may own durable record
 * membership, but it must ask the U8 authority whether a duration crosses the
 * combat-end boundary. A direct `duration.kind === 'expedition'` comparison is
 * the exact competing temporal interpreter removed by the U8 closure tranche.
 * Comments are excluded so contract prose cannot satisfy or trip the check. */
export function u8EncounterRoutingProblems(code: string): string[] {
  const executable = code.split('\n').filter((line) => {
    const trimmed = line.trimStart();
    return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*');
  }).join('\n');
  const problems: string[] = [];
  if (!/durationSurvivesCombatEnd\s*\(/.test(executable)) {
    problems.push('combat cleanup does not call durationSurvivesCombatEnd');
  }
  if (/duration\??\.kind\s*={2,3}\s*['"]expedition['"]/.test(executable)) {
    problems.push('combat cleanup re-interprets duration.kind === expedition locally');
  }
  if (!/function\s+durationExpiresAtBoundary[\s\S]*?clockForTiming\s*\([\s\S]*?boundaryEquals\s*\(/.test(executable)) {
    problems.push('boundary expiry no longer routes through clockForTiming and boundaryEquals');
  }
  return problems;
}

/** U1 reference-routing guard. Legacy context fields remain serialized input
 * slots, but only `primitives/reference.ts` may interpret them as references;
 * `roles.ts` may project the same facts into the disjoint U2 role frame.
 * Actor-choice bucket reads in `choice.ts` are retained U4 validation, not a
 * second reference resolver. Every migrated generic consumer must keep calling
 * the U1 surface, and raw slot/self lookups elsewhere are competing authority.
 *
 * LAYER COVERAGE: the guard scans primitives + kernels (as before) AND the
 * named content layer (`content/`, every file except the content-authoring
 * adapter itself). Content resolvers answer "what thing does a later clause
 * refer to?" — a raw dereference of a legacy slot in a content program is the
 * exact U1 residual the shared adapter exists to absorb, so content files (the
 * adapter itself excepted) may not directly interpret `sourceActor(context,
 * …)` or `…state.actors[context.…]`. This is a SEMANTIC routing pin, not a ban
 * on incidental id fields: `context.actorId` as provenance on an emitted
 * mutation (`sourceActorId:`), as scheduling/ownership identity, or as a U4
 * choice-identity COMPARE (`input.actorIds` compared but never dereferenced)
 * remains legitimate and is untouched. T5c additionally requires the content
 * adapter itself to keep composing the single U1 vocabulary (so a future
 * contributor cannot delete the adapter and route content through a bespoke
 * remap), and pins each MIGRATED named program to its adapter accessors so a
 * revert to legacy slot resolution is caught by dropping the call.
 *
 * Intentional non-goal (parity): success-path resolution is identical, but
 * MIGRATING a resolver also moves its malformed-input failure to the shared
 * `RuleProgramViolation` codes (`reference.*`) — so this release pins only the
 * two migrated programs. The remaining direct content reads are classified,
 * inventoried residual (U1 identity vs U2 role vs U4 choice validation vs U9
 * provenance vs plumbing) in docs/u8-u1-underlay-census.md, to be migrated
 * family-by-family with parity tests; the guard's content scan flags them only
 * through the MIGRATED-family pins, never as a blanket ban that would force
 * unplanned code-semantic drift. */
export function u1ReferenceRoutingProblems(
  files: Readonly<Record<string, string>>,
): Array<{ file: string; detail: string }> {
  const requiredCalls: Readonly<Record<string, readonly string[]>> = {
    'kernels/candidate.ts': ['resolveActorSelectorReference'],
    'kernels/evaluate-value.ts': ['resolveActorSelectorReference', 'liveActorSlot'],
    'kernels/execute-flow.ts': ['resolveReference', 'liveActorSlot', 'capturedActor'],
    'kernels/foe-recipes.ts': ['resolveActorSelectorReference'],
    'kernels/core-resolvers.ts': ['resolveActorSelectorReference'],
    'kernels/evaluate-query.ts': ['resolveActorSelectorReference'],
    'primitives/attack-resolution.ts': ['resolveReference', 'liveActorSlot'],
  };
  // T5c: migrated named-content programs must keep routing their actor
  // reference reads through the shared content-authoring adapter (U1 surface).
  const contentAdapterFile = 'content/glue/reference-authoring.ts';
  const contentAdapterSurface: Readonly<Record<string, readonly string[]>> = {
    'content/jobs/programs/bastion-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/programs/spellblade-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors', 'resolveTriggerTargets'],
    'content/jobs/programs/shade-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors', 'resolveTriggerSource'],
    'content/jobs/programs/warden-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/programs/sealer-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/programs/enochian-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors', 'resolveTriggerTargets'],
    'content/jobs/programs/chanter-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/programs/knave-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors', 'resolveTriggerSource'],
    'content/jobs/programs/harvester-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors', 'resolveTriggerTargets'],
    'content/jobs/programs/demon-slayer-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/programs/seer-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors', 'resolveTriggerTargets'],
    'content/jobs/programs/fool-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/programs/geomancer-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors', 'resolveTriggerTargets'],
    'content/jobs/programs/stormbender-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/programs/colossus-programs.ts': ['resolveSourceActor', 'resolveAttackTarget', 'resolveCapturedSelectedActors'],
    'content/jobs/job-trait-resolvers.ts': ['resolveSourceActor', 'resolveAttackTarget'],
    'content/classes/class-resolvers.ts': ['resolveSourceActor', 'resolveAttackTarget'],
  };
  const problems: Array<{ file: string; detail: string }> = [];

  // ---- Layer split: primitives/kernels (legacy generic scan) ----
  const genericFiles = Object.fromEntries(
    Object.entries(files).filter(([file]) => !file.startsWith('content/')),
  );
  for (const [file, code] of Object.entries(genericFiles)) {
    const executable = code.split('\n').filter((line) => {
      const trimmed = line.trimStart();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*');
    }).join('\n');
    for (const symbol of requiredCalls[file] ?? []) {
      if (!new RegExp(`\\b${symbol}\\s*\\(`).test(executable)) {
        problems.push({ file, detail: `migrated consumer no longer calls U1 surface ${symbol}` });
      }
    }
    if (file !== 'primitives/reference.ts' && file !== 'primitives/roles.ts') {
      const rawSlot = /context\s*(?:\.\s*(?:attackTargetId|triggerSourceId|triggerTargetIds|damageRecipientId)|\[\s*['"](?:attackTargetId|triggerSourceId|triggerTargetIds|damageRecipientId)['"]\s*\])/;
      if (rawSlot.test(executable)) {
        problems.push({ file, detail: 'interprets a legacy reference slot outside the U1 authority' });
      }
      // The source-slot dereference has three legacy spellings: the literal
      // ``state.actors[context.actorId]``, the job-kit ``sourceActor(context,
      // context.actorId)`` convenience, and the evaluate-value ``actor(context,
      // context.actorId)`` helper. All three resolve the implicit source-actor
      // reference; only the U1 live-slot authority may do that.
      if (/context\.state\.actors\s*\[\s*context\.actorId\s*\]|sourceActor\s*\(\s*context\s*,\s*context\.actorId\s*\)|\bactor\s*\(\s*context\s*,\s*context\.actorId\s*\)/.test(executable)) {
        problems.push({ file, detail: 'resolves the implicit source-actor reference outside U1' });
      }
    }
    if (file !== 'primitives/reference.ts' && file !== 'kernels/choice.ts'
      && /context\.input\.actorIds/.test(executable)) {
      problems.push({ file, detail: 'resolves recorded actor-input identities outside U1 (or U4 choice validation)' });
    }
  }

  // ---- Content layer: the adapter is the ONE named-content reference
  // surface. Every OTHER content file may no longer interpret references by
  // re-deriving a source actor via `sourceActor(context, …)` or dereferencing
  // a legacy slot through `.state.actors[context.…]`. The direct
  // `?.[0]`-style cardinality reads and U4 identity COMPARES stay exactly
  // where they are (they are not reference interpretation). ----
  for (const [file, code] of Object.entries(files)) {
    if (!file.startsWith('content/')) continue;
    const executable = code.split('\n').filter((line) => {
      const trimmed = line.trimStart();
      return trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*');
    }).join('\n');
    const isAdapter = file === contentAdapterFile;
    // T5c: the content adapter itself must keep COMPOSING the U1 vocabulary —
    // if it stops calling the reference constructors/resolution authority the
    // content reference surface silently becomes a second reference system.
    if (isAdapter) {
      if (!/liveActorSlot\s*\(|liveActorBound\s*\(|capturedActor\s*\(|resolveReference\s*\(/.test(executable)) {
        problems.push({ file, detail: 'content-authoring adapter no longer composes the single U1 vocabulary (primitives/reference.ts)' });
      }
      continue;
    }
    // The kernel-side `sourceActor(context, …)` convenience REMAINS the named
    // program inventory's retained U1 residual (~120 call sites, classified
    // family-by-family in docs/u8-u1-underlay-census.md; the choice-cardinality
    // `?.[0]` select and U4 identity compares are caller-owned and never
    // flagged). What is flagged is DIRECT DEREFERENCE of a legacy slot
    // (`.state.actors[context.…]`) — the exact reference interpretation the
    // adapter exists to absorb — plus (below) any regression in the MIGRATED
    // programs, whose positive routing pins prove they keep consuming the
    // adapter surface.
    if (/state\.actors\s*\[\s*context\./.test(executable)) {
      problems.push({ file, detail: 'content program dereferences a legacy reference slot (context.*) directly through state.actors instead of the U1 content-authoring adapter' });
    }
  }

  // ---- T5c: migrated programs must keep ROUTING through the adapter. A
  // revert to legacy direct slot resolution drops the adapter calls, which
  // this positive pin catches (semantic routing, not import-presence). ----
  for (const [file, symbols] of Object.entries(contentAdapterSurface)) {
    const code = files[file];
    if (code === undefined) continue; // a unit fixture may omit the program file
    const missing = symbols.filter((symbol) => !new RegExp(`\\b${symbol}\\s*\\(`).test(code));
    if (missing.length > 0) {
      problems.push({ file, detail: `migrated content program no longer routes its reference reads through the U1 content-authoring adapter (uncalled: ${missing.join(', ')}); restore the adapter accessors instead of resolving state.actors slots directly.` });
    }
  }

  return problems;
}

// U2-M4 (aura membership bypass): even with `perspectiveActorId` correctly
// U2-derived, membership must compare the side of the actor looked up by THAT
// U2-derived perspective. If membership instead derives an anchor/owner actor's
// side, the canonical consumption read disappears — a POSITIVE requirement, not
// a spelling regex.
const AURA_PERSPECTIVE_CONSUMPTION_RE = /state\.actors\[origin\.perspectiveActorId\]/;

// U2-M1 (candidate): the relation perspective (whose SIDE establishes
// self/ally/foe) must come from the U2 authority's returned value, never by
// reading the acting-actor slot off the incidental `context.actorId`. A
// contributor that calls U2 but ignores its result and reads `context.actorId`
// reintroduces exactly this read.
const CANDIDATE_INCIDENTAL_PERSPECTIVE_READ_RE = /(?:context\.)?\.state\.actors\[context\.actorId\]/;

// The U2 BRANDED-perspective typed seam (roles.ts declares `RelationPerspective`
// as a `unique symbol` brand; the authority functions return it; aura's
// `AuraOriginRef.perspectiveActorId` is typed with it). Without the brand,
// `perspectiveActorId: actor.id` stops being a compile error, so the type-level
// result-ownership proof silently disappears.
const RELATION_PERSPECTIVE_BRAND_MARKER_RE = /type\s+RelationPerspective\b[\s\S]*?\[relationPerspectiveBrand\]/;
const RELATION_PERSPECTIVE_BRAND_SYMBOL_RE = /relationPerspectiveBrand:\s*unique\s+symbol/;
const RELATION_PERSPECTIVE_RETURN_RE = /relationPerspectiveId\(frame: RoleFrame\): RelationPerspective \| null/;
const AURA_PERSPECTIVE_RETURN_RE = /auraRelationPerspectiveId\(origin: AuraPerspectiveOrigin\): RelationPerspective \| null/;
const AURA_PERSPECTIVE_FIELD_TYPE_RE = /\bperspectiveActorId:\s*RelationPerspective \| null/;

// U16 (usage/entitlement) single-authority guard details.
//
// The canonical durable key format is `ledger:<scope>:<sourceId>` and the
// availability / consume / refresh semantics are owned by `primitives/usage.ts`
// (with the `kernels/use-ledger.ts` adapter). ONLY those two files may
// construct the key (`` `ledger:${scope}:…` ``). A contributor who re-implements
// a once-per-turn/round/combat ledger elsewhere reconstructs the canonical key
// locally — e.g. the F9 fold previously derived `` `ledger:round:${sourceId}` ``
// and read/`set` it directly instead of routing through U16. That is a
// competing U16 authority even when behaviour is identical.
const U16_LEDGER_AUTHORITY_FILES: ReadonlySet<string> = new Set([
  'primitives/usage.ts',
  'kernels/use-ledger.ts',
]);

// The key-construction signal: a template literal rebuilding the canonical
// `ledger:<scope>:…` storage address. Matches both the generic interpolation
// (`` `ledger:${scope}:${sourceId}` ``) and a hard-coded period form
// (`` `ledger:round:${sourceId}` `` — the exact shape the F9 fold used to
// rebuild). Absent in every file except the U16 authority pair (verified by
// valid-files tests in the architecture suite).
// The key-construction signal: a template literal rebuilding the canonical
// `ledger:<scope>:…` storage address. Matches both the generic interpolation
// (`` `ledger:${scope}:${sourceId}` ``) and a hard-coded period form
// (`` `ledger:round:${sourceId}` ``). Absent in every file except the U16
// authority pair (verified by valid-files tests in the architecture suite).
const U16_LEDGER_KEY_RECONSTRUCTION_RE = /ledger:(?:[a-z-]+:)?\$\{/;

// T8c — a locally rebuilt canonical KEY by string CONCATENATION (U16-M3:
// `'ledger:' + 'round:' + sourceId`) is a competing authority just like the
// template-literal form; the physical storage address must be produced only by
// the U16 authority. Matches the literal-prefix concatenation (single- or
// double-quoted) — one semantic seam, not per-use spelling variants.
const U16_LEDGER_KEY_CONCAT_RE = /['"]ledger:['"]\s*\+/;

// U16/F9-corrective — the F9 fold's once-per-round result-consumption pins
// against the ONE U16 COMMIT operation (`applyOncePerRoundUsage`), plus the
// SEAMS that detect when the canonical call is retained but its RESULT is
// ignored or replaced:
//
//  - AVAILABILITY (positive): the fold must gate the gated reaction on the
//    operation's returned `result.available`; re-deciding availability from raw
//    `ruleState[` (M1) or anything else is a bypass.
//  - CONSUME (positive): the fold must commit the operation's returned
//    `result.mutations` bundle verbatim; a hand-built `{ kind: 'state', ... }`
//    mark (M2) that never touches the returned bundle is a bypass.
//  - OWNER (U16-M4): the operation takes the ACTOR (owner never exposed); a
//    future local `ownerId: ''` on any typed usage call is a fabricated/missing-
//    owner bypass the storage bytes cannot reveal.
// These are semantic-dependency pins for ONE migrated consumer (trait-reactions.ts),
// enforced as named invariants rather than an enumeration of value spellings.
const U16_F9_RAW_RULESTATE_GATE_RE = /ruleState\[/;
const U16_F9_HANDBUILT_MARK_RE = /\{[^\n]*kind:\s*['"]state['"]/;
const U16_F9_RESULT_AVAILABLE_RE = /result\.available\b/;
const U16_F9_RESULT_MUTATIONS_RE = /result\.mutations\b/;
const U16_F9_EMPTY_OWNER_RE = /ownerId:\s*['"][\s]*['"]/;

// The F9 reactive fold (`kernels/trait-reactions.ts`) was migrated to route its
// ENTIRE once-per-round entitlement transaction through the U16 COMMIT operation
// `applyOncePerRoundUsage` (`kernels/use-ledger.ts`). It must keep CALLING that
// operation; a contributor who re-derives availability / consume / key locally
// (or reverts to the old per-piece oncePerRoundGate plan) drops the call, which
// this structural allowlist catches (exactly like the U2 guard). The operation
// internally uses `usageKey` / `ledgerAvailable` / `consumeUsageMutation`, so
// F9 itself never touches the core symbols directly.
const U16_CONSUMER_SYMBOLS: ReadonlyMap<string, Set<string>> = new Map([
  ['kernels/trait-reactions.ts', new Set(['applyOncePerRoundUsage'])],
]);

// Patterns that indicate side-effect registration at module scope
const REGISTER_CALL_RE = /^\s*(?:register\w+|Object\.assign)\s*\(/;
// ---------------------------------------------------------------------------
// Main audit
// ---------------------------------------------------------------------------

/**
 * Run the full architecture audit against the given automation root.
 * Returns the structured result (violations and file counts).
 */
export function auditArchitecture(automationRoot: string): AuditResult {
  const violations: Violation[] = [];
  const files = walk(automationRoot);

  // ---- Check 1 & 2: import direction ----

  for (const file of files) {
    const layer = layerFor(file, automationRoot);
    if (layer !== 'primitives' && layer !== 'kernels') continue;

    const code = readFileSync(file, 'utf8');
    const specs = parseImports(code);

    for (const spec of specs) {
      const resolved = resolveImport(file, spec);
      if (!resolved) continue;

      const targetLayer = layerFor(resolved, automationRoot);

      if (layer === 'primitives' && targetLayer === 'kernels') {
        violations.push({
          check: 'import-direction',
          file: posixRelative(automationRoot, file),
          detail: `primitives must not import from kernels (imports ${posixRelative(automationRoot, resolved)})`,
        });
      } else if (layer === 'primitives' && targetLayer === 'content') {
        violations.push({
          check: 'import-direction',
          file: posixRelative(automationRoot, file),
          detail: `primitives must not import from content (imports ${posixRelative(automationRoot, resolved)})`,
        });
      } else if (layer === 'kernels' && targetLayer === 'content') {
        violations.push({
          check: 'import-direction',
          file: posixRelative(automationRoot, file),
          detail: `kernels must not import from content (imports ${posixRelative(automationRoot, resolved)})`,
        });
      }
    }
  }

  const genericLayerCode = Object.fromEntries(files
    .filter((file) => ['primitives', 'kernels'].includes(layerFor(file, automationRoot)))
    .map((file) => [posixRelative(automationRoot, file), readFileSync(file, 'utf8')]));
  violations.push(...kernelAuthoringFacadeProblems(genericLayerCode));

  const choiceCode = genericLayerCode['kernels/choice.ts'];
  if (choiceCode) {
    for (const detail of choiceCandidateRoutingProblems(choiceCode)) {
      violations.push({ check: 'u4-u3-candidate-routing', file: 'kernels/choice.ts', detail });
    }
  }

  // ---- Check 3: no hardcoded source IDs in primitives/kernels ----

  for (const file of files) {
    const layer = layerFor(file, automationRoot);
    if (layer !== 'primitives' && layer !== 'kernels') continue;

    const code = readFileSync(file, 'utf8');
    const lines = code.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (SOURCE_ID_FALSE_POSITIVE_RE.test(line)) continue;

      let m: RegExpExecArray | null;
      SOURCE_ID_RE.lastIndex = 0;
      while ((m = SOURCE_ID_RE.exec(line))) {
        const id = m[1];
        const colonIdx = id.indexOf(':');
        const ns = id.slice(0, colonIdx);
        const rest = id.slice(colonIdx + 1);

        // Skip very short namespaces (e.g. 'for:each', 'get:id')
        if (ns.length < 3) continue;
        // Skip single-segment IDs that look like enum values ('status:active')
        if (!rest.includes(':') && !rest.includes('-') && rest.length <= 8) continue;

        // Check known exemptions
        const relFile = posixRelative(automationRoot, file);
        const exempted = KERNEL_SOURCE_ID_EXEMPTIONS.get(relFile);
        if (exempted?.has(id)) continue;

        violations.push({
          check: 'source-id-in-generic-layer',
          file: relFile,
          detail: `hardcoded source ID '${id}' in ${layer}/ (line ${i + 1})`,
        });
      }
    }
  }

  // ---- Check 4: registration modules must be imported by registry.ts ----

  const registryPath = join(automationRoot, 'content', 'registry.ts');
  const registryCode = readFileSync(registryPath, 'utf8');
  const registrySpecs = parseImports(registryCode);
  const registryImports = new Set<string>();
  for (const spec of registrySpecs) {
    const resolved = resolveImport(registryPath, spec);
    if (resolved) registryImports.add(resolved);
  }

  // Find content modules (excluding registry.ts, glue/, and programs/)
  // that call register*() at module scope
  const contentFiles = walk(join(automationRoot, 'content')).filter((f) => {
    const rel = posixRelative(automationRoot, f);
    return (
      rel.startsWith('content/') &&
      !rel.endsWith('registry.ts') &&
      !rel.includes('/glue/') &&
      !rel.includes('/programs/')
    );
  });

  for (const file of contentFiles) {
    const code = readFileSync(file, 'utf8');
    const lines = code.split('\n');

    let hasRegistration = false;
    for (const line of lines) {
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;
      if (REGISTER_CALL_RE.test(line)) {
        hasRegistration = true;
        break;
      }
    }

    if (hasRegistration && !registryImports.has(file)) {
      violations.push({
        check: 'registry-completeness',
        file: posixRelative(automationRoot, file),
        detail: `content module calls register*() but is not imported by content/registry.ts`,
      });
    }
  }

  // ---- Check 5: no bespoke U16-equivalent entitlement fields on the actor ----
  // T6.4: U16 is the ONE authoritative usage/entitlement ledger. Past
  // versions carried these as raw `EncounterActor` fields; they are gone. This
  // check guards the AUTHORITATIVE TYPE (src/rules/types.ts) so a future
  // contributor cannot casually reintroduce a bespoke authority as an actor
  // field without an explicit allowlisted retained-specialist justification.
  // It targets semantic duplicate authority, not naming aesthetics: only
  // actor-level `*UsedThisTurn` / `*TriggeredThisTurn` entitlement booleans and
  // the exact migrated raw counters are reserved. Retained specialists
  // (`attackedThisTurn` — the U10 historical resolution fact, NOT the one-attack
  // entitlement — and the scheduler/lifecycle clock `turnTaken` /
  // `turnsTakenThisRound`) are not reservation matches and remain legitimate.
  // `standardMoveUsed` / `usedAbilityIds` are NOT retained: they were migrated
  // (T6.4a, schema 12) so they stay in the reserved set.
  const typesPath = join(automationRoot, '..', 'types.ts');
  try {
    const typesCode = readFileSync(typesPath, 'utf8');
    const actorStart = typesCode.indexOf('interface EncounterActor ');
    if (actorStart !== -1) {
      const block = typesCode.slice(actorStart);
      const openBrace = block.indexOf('{');
      const actorEnd = block.indexOf('\n}', openBrace + 1);
      const body = actorEnd === -1 ? block : block.slice(0, actorEnd);
      const member = /^\s{2}[a-zA-Z0-9_]+\??:/gm;
      let m: RegExpExecArray | null;
      member.lastIndex = 0;
      while ((m = member.exec(body))) {
        const name = m[0].trim().replace(/[?:]/g, '');
        if (isBespokeU16FieldName(name)) {
          violations.push({
            check: 'bespoke-u16-entitlement-field',
            file: 'rules/types.ts',
            detail: `EncounterActor re-exposes usage/entitlement field '${name}'; route it through the U16 ledger (kernels/use-ledger.ts) instead of a raw actor field.`,
          });
        }
      }
    }
  } catch {
    // types.ts not readable from this automation root (e.g. a unit fixture) —
    // the structural/type gate still applies at build time.
  }

  // ---- Check 6: no independent U2 perspective authority in migrated consumers ----
  // U2 (`primitives/roles.ts`) is the ONE authority for "relative to whom a
  // clause is interpreted". These consumers were migrated to route their
  // semantic relation / controller / chooser / member perspective through it.
  // This guard is narrowly scoped to those allowlisted files: it requires the
  // target U2 symbol to remain (a contributor re-deriving the perspective from
  // an incidental field has to drop the import), and forbids the exact removed
  // anchor-derived side relation in aura.ts. It is deliberately NOT a global
  // ban on `.side` / `ownerId` / `actorId` / equality compares — those facts
  // remain legitimate for many non-U2 responsibilities.
  // Symbol PRESENCE alone is insufficient authority evidence: a contributor can
  // keep the canonical U2 symbol/import and still stop using its result for the
  // semantic decision (re-deriving the perspective from `context.actorId` in
  // candidate.ts, or from the origin kind/owner in aura.ts). The guard therefore
  // requires the symbol to be genuinely CALLED (routing), not merely imported.
  for (const [relFile, symbol] of U2_PERSPECTIVE_SYMBOLS) {
    const file = join(automationRoot, relFile);
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      continue; // fixture root may omit the file
    }
    if (!code.includes(`${symbol}(`)) {
      const cameo = code.includes(symbol) ? ' (symbol present but never CALLED — resting the acting-actor/perspective read on an incidental field)' : '';
      violations.push({
        check: 'u2-perspective-authority',
        file: relFile,
        detail: `migrated U2 consumer no longer routes its relation/controller perspective through roles.ts ('${symbol}')${cameo}; restore the U2 call instead of re-deriving the perspective from an incidental field.`,
      });
    }
    // U2-M4: membership must re-derive ally/foe from the U2-derived perspective
    // actor, never from the spatial anchor/owner side.
    if (relFile === 'kernels/aura.ts' && AURA_ANCHOR_SIDE_RESTORE_RE.test(code)) {
      violations.push({
        check: 'u2-perspective-authority',
        file: relFile,
        detail: `aura.ts re-derives ally/foe from the spatial anchor/owner side instead of the U2 perspective role (perspectiveActorId); ROLE ≠ ANCHOR — only the U2 authority establishes the member relation.`,
      });
    }
    // U2-M2/M3: every producer of `perspectiveActorId`'s VALUE (in any spelling
    // — direct, const/let aliased, or member-written) must be the U2 call.
    if (relFile === 'kernels/aura.ts') {
      const badProducers = nonAuthorityAuraPerspectiveProducers(code);
      if (badProducers.length > 0) {
        violations.push({
          check: 'u2-perspective-authority',
          file: relFile,
          detail: `aura.ts produces the SEMANTIC perspective (perspectiveActorId) from a NON-U2 source (see: ${badProducers.join('; ')}) — a locally-aliased id that ignores the U2 returned result; ROLE ≠ ANCHOR — the perspective actor id must be the U2 authority's returned value (auraRelationPerspectiveId), never an incidental id or alias.`,
        });
      }
      // U2-M4: the U2-derived perspective must be the actor whose side membership
      // compares (positive consumption chain).
      if (!AURA_PERSPECTIVE_CONSUMPTION_RE.test(code)) {
        violations.push({
          check: 'u2-perspective-authority',
          file: relFile,
          detail: `aura.ts membership does not read the side of the actor looked up by the U2-derived perspective (state.actors[origin.perspectiveActorId]) — membership must route through the U2 perspective, never an anchor/owner-derived side.`,
        });
      }
    }
    // U2-M1: the candidate relation perspective must be the U2 authority's
    // returned value; reading it straight off the incidental `context.actorId`
    // (while keeping the U2 call alive) is a bypass. The scan is over
    // executable lines only (a docstring mentioning the pattern is not a bypass).
    if (relFile === 'kernels/candidate.ts') {
      const executable = code.split('\n').filter((line) => {
        const t = line.trimStart();
        return t.length > 0 && !t.startsWith('//') && !t.startsWith('*');
      }).join('\n');
      if (CANDIDATE_INCIDENTAL_PERSPECTIVE_READ_RE.test(executable)) {
        violations.push({
          check: 'u2-perspective-authority',
          file: relFile,
          detail: `candidate.ts reads the relation perspective (whose SIDE establishes self/ally/foe) directly from the incidental context.actorId, ignoring the U2 authority's returned value (relationPerspectiveIdFromContext); the relation perspective must be the U2-derived source role.`,
        });
      }
    }
  }

  // ---- Check 7: no local reconstruction of the U16 usage-ledger key ----
  // U16 (`primitives/usage.ts` + the `kernels/use-ledger.ts` adapter) is the ONE
  // authority for the durable `ledger:<scope>:<sourceId>` key AND for its
  // availability / consume / refresh semantics. Only those two files build the
  // canonical key (`` `ledger:${scope}:…` ``). A second executing usage ledger
  // reconstructed in any other primitives/kernels file is a competing U16
  // authority even when it produces identical keys/results — caught here BEFORE
  // it can silently diverge. (The `u16-perspective-authority`-style symbol
  // allowlist below separately pins the migrated trait-reactions fold to the
  // U16 CORE symbols.)
  for (const file of files) {
    const relFile = posixRelative(automationRoot, file);
    if (U16_LEDGER_AUTHORITY_FILES.has(relFile)) continue;
    const layer = layerFor(file, automationRoot);
    if (layer !== 'primitives' && layer !== 'kernels') continue;
    const code = readFileSync(file, 'utf8');
    // U16-M3: a locally reconstructed canonical key — by template literal OR
    // string concatenation — is a competing authority (the U2/U16 caller kept a
    // canonical call alive but the ACTUAL key path re-derives the address).
    if (U16_LEDGER_KEY_RECONSTRUCTION_RE.test(code) || U16_LEDGER_KEY_CONCAT_RE.test(code)) {
      violations.push({
        check: 'u16-usage-ledger-routing',
        file: relFile,
        detail: `locally reconstructs the U16 usage-ledger key ('ledger:<scope>:…'); route availability / consume / refresh through primitives/usage.ts (kernels/use-ledger.ts) instead of rebuilding the canonical ledger key.`,
      });
    }
  }

  // ---- Check 9: U16/F9-result-consumption pins (trait-reactions.ts) ----
  // Beyond requiring the U16 COMMIT operation to be CALLED, the F9 fold's seams
  // must route through that operation's RESULT: the availability decision must
  // read the returned `available` (not raw `ruleState[`), and the committed
  // mark must be the returned `mutations` bundle verbatim (never a hand-built
  // `{ kind: 'state', ... }` literal), with no fabricated `ownerId: ''` on any
  // typed usage call. Kept narrowly scoped to the ONE migrated F9 fold. These
  // are the mechanical proofs that F9 can only propose effects — U16 alone
  // turns them into an allowed once-per-round commit.
  for (const [relFile] of U16_CONSUMER_SYMBOLS) {
    const file = join(automationRoot, relFile);
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Only executable lines count — a docstring/comment mentioning `ownerId: ''`
    // or `ruleState[` is not a bypass. Filter out comment lines before testing.
    const executable = code.split('\n').filter((line) => {
      const t = line.trimStart();
      return t.length > 0 && !t.startsWith('//') && !t.startsWith('*');
    }).join('\n');
    // Positive availability consumption: the fold must gate the once-per-round
    // reaction on the operation's returned `available` (a caller re-deciding it
    // elsewhere — raw state, a local recomputation — never touches the bundle).
    if (!U16_F9_RESULT_AVAILABLE_RE.test(executable)) {
      violations.push({
        check: 'u16-usage-ledger-routing',
        file: relFile,
        detail: `F9 fold does not gate the once-per-round reaction on the U16 operation's returned availability (result.available); the entitlement decision must come from applyOncePerRoundUsage's result — never raw ruleState or a local recomputation.`,
      });
    }
    // Positive consume consumption: the fold must commit the operation's
    // returned `mutations` bundle verbatim (the mark is inside that bundle).
    if (!U16_F9_RESULT_MUTATIONS_RE.test(executable)) {
      violations.push({
        check: 'u16-usage-ledger-routing',
        file: relFile,
        detail: `F9 fold does not commit the U16 operation's returned mutations bundle (result.mutations) verbatim; the consume mark must be the U16-produced mark grouped with the allowed effects — never hand-built.`,
      });
    }
    // U16-M1: availability bypass — a gate reading the actor's raw ruleState
    // instead of the operation's returned `result.available`.
    if (U16_F9_RAW_RULESTATE_GATE_RE.test(executable)) {
      violations.push({
        check: 'u16-usage-ledger-routing',
        file: relFile,
        detail: `F9 fold reads availability from the raw actor ruleState instead of the U16 operation's returned result.available; the once-per-round gate must consume the U16 authority's returned availability.`,
      });
    }
    // U16-M2: consume bypass — a hand-built state mark that never references the
    // U16 operation's returned `mutations` bundle persists a mark independently
    // of U16 (the production fold commits result.mutations, so its only 'state'
    // mark comes from the bundle).
    if (U16_F9_HANDBUILT_MARK_RE.test(executable) && !U16_F9_RESULT_MUTATIONS_RE.test(executable)) {
      violations.push({
        check: 'u16-usage-ledger-routing',
        file: relFile,
        detail: `F9 fold hand-builds a 'state' ledger mark without committing the U16 operation's returned mutations bundle (result.mutations); the once-per-round mark must be persisted from the U16 authority's returned bundle.`,
      });
    }
    // U16-M4: owner bypass — a typed usage call with a fabricated/missing owner.
    if (U16_F9_EMPTY_OWNER_RE.test(executable)) {
      violations.push({
        check: 'u16-usage-ledger-routing',
        file: relFile,
        detail: `F9 fold passes a fabricated empty owner ('ownerId: \'\'') on a usage call; the once-per-round operation takes the ACTOR (its real owner) — never a fabricated empty owner — typed semantic identity and actor-local storage are distinct.`,
      });
    }
  }

  // ---- Check 10: U2 branded-perspective typed seam (roles.ts + aura.ts) ----
  // `Authority CALLED` is not authority proof. The strongest seam pins the TYPE
  // so an ignored result cannot be substituted by an incidental id. This guard
  // keeps the BRAND alive: roles.ts must declare the `RelationPerspective`
  // unique-symbol brand and the three authority functions must return it, and
  // aura's `AuraOriginRef.perspectiveActorId` must be typed with it. Without
  // these, `perspectiveActorId: actor.id` stops being a compile error and the
  // result-ownership typed seam silently disappears.
  const rolesPath = join(automationRoot, 'primitives', 'roles.ts');
  try {
    const rolesCode = readFileSync(rolesPath, 'utf8');
    if (!RELATION_PERSPECTIVE_BRAND_MARKER_RE.test(rolesCode) || !RELATION_PERSPECTIVE_BRAND_SYMBOL_RE.test(rolesCode)) {
      violations.push({
        check: 'u2-perspective-authority',
        file: 'primitives/roles.ts',
        detail: `roles.ts no longer declares the BRANDED RelationPerspective (a unique-symbol brand the type references); without the brand, an incidental id (actor.id/entity.ownerId alias) can be spooled into a perspectiveActorId slot and the U2 result-ownership typed seam is gone.`,
      });
    }
    if (!RELATION_PERSPECTIVE_RETURN_RE.test(rolesCode)) {
      violations.push({
        check: 'u2-perspective-authority',
        file: 'primitives/roles.ts',
        detail: `relationPerspectiveId must return the BRANDED RelationPerspective so candidate relation reads provably consume the U2 result.`,
      });
    }
    if (!AURA_PERSPECTIVE_RETURN_RE.test(rolesCode)) {
      violations.push({
        check: 'u2-perspective-authority',
        file: 'primitives/roles.ts',
        detail: `auraRelationPerspectiveId must return the BRANDED RelationPerspective so aura membership provably consumes the U2 result.`,
      });
    }
  } catch {
    // fixture root may omit roles.ts — the type gate still applies at build time
  }
  const auraPath = join(automationRoot, 'kernels', 'aura.ts');
  try {
    const auraCode = readFileSync(auraPath, 'utf8');
    if (!AURA_PERSPECTIVE_FIELD_TYPE_RE.test(auraCode)) {
      violations.push({
        check: 'u2-perspective-authority',
        file: 'kernels/aura.ts',
        detail: `AuraOriginRef.perspectiveActorId must be typed as the BRANDED RelationPerspective | null; without the brand, assigning actor.id/entity.ownerId (or an alias) compiles and the result-ownership proof is gone.`,
      });
    }
  } catch {
    // fixture root may omit aura.ts
  }

  // ---- Check 8: migrated U16 consumers must keep CALLING the U16 core ----
  // Symbol PRESENCE is insufficient authority evidence (a contributor can keep
  // the import and still bypass availability / consume / key by reading raw
  // ruleState or emitting a hand-rolled mark). This guard requires the migrated
  // fold to genuinely CALL each U16 core surface for its round gate — routing,
  // not import-presence, is what proves delegation.
  for (const [relFile, symbols] of U16_CONSUMER_SYMBOLS) {
    const file = join(automationRoot, relFile);
    let code: string;
    try {
      code = readFileSync(file, 'utf8');
    } catch {
      continue; // fixture root may omit the file
    }
    const missing = [...symbols].filter((s) => !code.includes(`${s}(`));
    const presentButUnused = [...symbols].filter((s) => !code.includes(`${s}(`) && code.includes(s));
    if (missing.length > 0) {
      violations.push({
        check: 'u16-usage-ledger-routing',
        file: relFile,
        detail: `migrated U16 consumer does not CALL the U16 core surfaces used for its usage/entitlement gate (uncalled or missing: ${missing.join(', ')})${presentButUnused.length > 0 ? `. Imported-but-unused: ${presentButUnused.join(', ')} — likely a hand-rolled availability/consume/key that bypasses the U16 authority.` : ''}; the F9 fold must route key+availability+consume through primitives/usage.ts, never rebuild them locally.`,
      });
    }
  }

  // ---- Check 11: U8 temporal consumers keep routing through Scope/Clock ----
  // encounter.ts lives one level above automation/. It owns durable reducer
  // membership and lifecycle application, but not duration interpretation.
  // Pin both executing U8 seams: ordinary boundary expiry and combat cleanup.
  const encounterPath = join(automationRoot, '..', 'encounter.ts');
  try {
    const encounterCode = readFileSync(encounterPath, 'utf8');
    for (const problem of u8EncounterRoutingProblems(encounterCode)) {
      violations.push({
        check: 'u8-scope-clock-routing',
        file: 'rules/encounter.ts',
        detail: `${problem}; route temporal extent through primitives/scope.ts instead of interpreting RuleDuration in the reducer.`,
      });
    }
  } catch {
    // A unit fixture may omit encounter.ts. The pure guard is mutation-tested
    // directly; the real-repository audit always supplies this file.
  }

  // ---- Check 12: U1 reference consumers keep routing through reference.ts ----
  // Scans primitives + kernels AS BEFORE, plus the named content layer: the
  // content-authoring adapter (content/glue/reference-authoring.ts) is now the
  // ONE content reference surface, migrated programs are pinned to it, and any
  // other content file that re-derives a source actor via sourceActor(context,
  // …) or dereferences state.actors[context.…] is caught as competing U1
  // authority. (rules/encounter.ts and other non-automation consumers keep
  // their existing U8-only pin.)
  const automationCode = Object.fromEntries(files
    .filter((file) => {
      const layer = layerFor(file, automationRoot);
      return layer === 'primitives' || layer === 'kernels' || layer === 'content';
    })
    .map((file) => [posixRelative(automationRoot, file), readFileSync(file, 'utf8')]));
  for (const problem of u1ReferenceRoutingProblems(automationCode)) {
    violations.push({
      check: 'u1-reference-routing',
      file: problem.file,
      detail: `${problem.detail}; route identity/binding/LIVE-vs-CAPTURED semantics through primitives/reference.ts.`,
    });
  }

  return {
    violations,
    checked: {
      totalFiles: files.length,
      primitives: files.filter((f) => layerFor(f, automationRoot) === 'primitives').length,
      kernels: files.filter((f) => layerFor(f, automationRoot) === 'kernels').length,
      content: files.filter((f) => layerFor(f, automationRoot) === 'content').length,
    },
  };
}
