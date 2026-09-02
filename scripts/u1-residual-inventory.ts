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
 *
 * The file-context refinement (2026-09-02) is LEXICAL-SCOPE based, never
 * whole-file name coincidence: a plain-identifier site reclassifies to
 * NON_U1_OTHER only when the identifier is a parameter of the LEXICALLY
 * ENCLOSING function (call inside its body) or an unshadowed loop variable
 * of a lexically containing `for (const X of …)` over a NON-recorded
 * iterable. An unrelated function's parameter, an earlier unrelated loop,
 * or a same-name recorded-selection local leaves the site CAPTURED.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

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

/* ------------------------------------------------------------------------
 * Scope-aware refinements (2026-09-02). The U1×U4 adjudication classifies
 * two plain-identifier shapes as caller-owned ALGORITHM PLUMBING rather than
 * references:
 *  - helper-parameter: the identifier is a PARAMETER OF THE LEXICALLY
 *    ENCLOSING function (e.g. `plannedRush(context, actorId, …)` restoring
 *    its geometry from an already-resolved id) and the call lies INSIDE that
 *    function's body;
 *  - derived-loop variable: the call lies INSIDE a `for (const X of …)`
 *    body whose unshadowed loop variable is the identifier, over a
 *    NON-RECORDED iterable (an algorithm-built collection — NOT
 *    `input.actorIds`/`triggerTargetIds`/a context.slot).
 * A whole-file name coincidence does NOT reclassify a site: the call must
 * be lexically inside the binding's scope, with no nearer binding of the
 * same name (shadowing) between the binding and the call. This was the
 * classifier-repair 2026-09-02 (the previous whole-file regex could let an
 * unrelated `function helper(…, actorId: string)` or an earlier unrelated
 * `for (const X of …)` reclassify a genuine recorded-selection deref).
 */

type ScopeBinding =
  | { kind: 'param' }
  | { kind: 'loop'; iterableText: string }
  | { kind: 'local' }
  | { kind: 'none' };

function bindingNameMatches(name: ts.BindingName, id: string): boolean {
  return ts.isIdentifier(name) && name.text === id;
}

function declarationListBinds(list: ts.VariableDeclarationList | undefined, id: string): boolean {
  return list !== undefined && list.declarations.some((decl) => bindingNameMatches(decl.name, id));
}

/** True when `block` declares `id` in a `const`/`let`/`var` statement whose
 * declaration precedes the call position (a same-block binding governs a
 * reference at that position; a later declaration cannot — TDZ). */
function blockDeclaresBefore(block: ts.Block, id: string, position: number): boolean {
  for (const statement of block.statements) {
    if (ts.isVariableStatement(statement) && statement.getStart() < position && declarationListBinds(statement.declarationList, id)) {
      return true;
    }
  }
  return false;
}

/** Resolve the nearest LEXICAL binding of `id` visible at the call site by
 * walking its ancestor chain outward ENCOUNTERING the governing construct:
 *  - a same-block `const/let/var` declaration BEFORE the call (block scan),
 *  - a `for (const X of …)` loop that lexically contains the call,
 *  - a function whose parameter is the identifier and whose body contains
 *    the call (with any nearer function checked first),
 *  - a catch-clause variable binding its whole block.
 * The closest binding wins: an inner block-local shadows an outer loop
 * variable or helper parameter; a construct from an unrelated function or
 * an earlier loop is never an ancestor, so name coincidence cannot
 * reclassify a site. */
function scopeBindingOf(id: ts.Identifier): ScopeBinding {
  const start = id.getStart();
  let node: ts.Node | undefined = id.parent;
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (ts.isBlock(node) && blockDeclaresBefore(node, id.text, start)) return { kind: 'local' };
    if (ts.isForOfStatement(node)) {
      if (declarationListBinds(node.initializer as ts.VariableDeclarationList, id.text)) {
        return { kind: 'loop', iterableText: node.expression.getText().trim() };
      }
    } else if (ts.isForInStatement(node)) {
      if (declarationListBinds(node.initializer as ts.VariableDeclarationList, id.text)) {
        // for-in keys are a distinct primitive collection; conservative -
        // never reclassify on a for-in binding.
        return { kind: 'none' };
      }
    } else if (ts.isForStatement(node) && declarationListBinds(node.initializer as ts.VariableDeclarationList, id.text)) {
      return { kind: 'local' };
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined && bindingNameMatches(node.variableDeclaration.name, id.text)) {
      return { kind: 'local' };
    } else if (ts.isFunctionLike(node)) {
      const params = (node as ts.SignatureDeclaration).parameters;
      if (params.some((param) => bindingNameMatches(param.name, id.text))) return { kind: 'param' };
    }
    node = node.parent;
  }
  return { kind: 'none' };
}

/** Iterable expressions that NAME a recorded/live selection — a loop over
 * one of these is a genuine reference loop, never algorithm plumbing. */
const RECORDED_ITERABLE_RE = /actorIds|triggerTargetIds|attackTargetId|context\.input/;

/** Parse `fileText` once and map each `sourceActor(` call line to the scope
 * binding of its PLAIN-IDENTIFIER second argument (undefined otherwise). */
function lexicalSiteBindings(fileText: string): Map<number, ScopeBinding | undefined> {
  const sourceFile = ts.createSourceFile('inventory.ts', fileText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bindings = new Map<number, ScopeBinding | undefined>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText(sourceFile).trim() === 'sourceActor') {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const second = node.arguments[1];
      bindings.set(line, second !== undefined && ts.isIdentifier(second) ? scopeBindingOf(second) : undefined);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return bindings;
}

/** Refine a plain-identifier CAPTURED site using LEXICAL SCOPE (not whole-file
 * name coincidence): algorithm-plumbing derefs (helper parameters, derived
 * loop variables over non-recorded iterables) reclassify to NON_U1_OTHER;
 * everything else stays CAPTURED (the recorded-selection U1×U4 shape). */
export function refineSiteWithContext(
  site: U1ResidualSite,
  arg: string,
  fileText: string | undefined,
): U1ResidualSite {
  if (site.category !== 'CAPTURED_ID_DEREFERENCE' || fileText === undefined) return site;
  const trimmed = arg.trim();
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) return site;
  const binding = lexicalSiteBindings(fileText).get(site.line);
  if (binding === undefined) return site;
  if (binding.kind === 'param') {
    return { ...site, category: 'NON_U1_OTHER', provenance: 'helper-parameter deref of an already-resolved identity (parameter of the LEXICALLY ENCLOSING function, call inside its body) — caller-owned algorithm plumbing, not a reference; no U1 surface for arbitrary ids' };
  }
  if (binding.kind === 'loop' && !RECORDED_ITERABLE_RE.test(binding.iterableText)) {
    return { ...site, category: 'NON_U1_OTHER', provenance: 'derived-loop deref: call is lexically inside a for-of body whose unshadowed loop variable this is, over a NON-recorded iterable (algorithm-built collection) — caller-owned algorithm plumbing, not a reference; no U1 surface for arbitrary ids' };
  }
  return site;
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
    const site: U1ResidualSite = {
      file,
      line,
      shape: `sourceActor(${callText})`,
      category,
      provenance,
    };
    sites.push(refineSiteWithContext(site, arg, text));
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

/* ------------------------------------------------------------------------
 * Fold-surface actor deref inventory (2026-09-02, fold-consumer
 * adjudication). The kernel-fold-driven recipe/lifecycle/continuation
 * surfaces outside the program families dereference `state.actors[EXPR]`
 * where EXPR is a transmitted/fact-carried identity. This scanner enumerates
 * EVERY such deref site and tags its index-expression FAMILY so the
 * adjudication is machine-derived:
 *  - recorded-forwarded: EXPR indexes a recorded command selection array
 *    (`targetIds[n]`, `triggerTargetIds[n]`, `actorIds[n]`, …) forwarded by
 *    a shared fold/parameter;
 *  - fact-carried: EXPR is a member of a durable fact (`.ownerId`,
 *    `.sourceActorId`, `.actorId`, `.id` on marks/motes/mutations/…);
 *  - forwarded-identifier: EXPR is a plain identifier parameter/local
 *    carrying an identity transmitted by caller or algorithm;
 *  - algorithm/other: any other computed index;
 *  - legacy-slot: EXPR starts with `context.` — a legacy context-bag
 *    interpretation. This family MUST be 0 across the fold surface; the test
 *    pins that, because the U1 guard's whole point is that no consumer
 *    interprets the legacy slots outside the authority.
 */
export type ActorDerefFamily = 'recorded-forwarded' | 'fact-carried' | 'forwarded-identifier' | 'algorithm/other' | 'legacy-slot';

export interface ActorDerefSite {
  file: string;
  line: number;
  family: ActorDerefFamily;
  shape: string;
}

const RECORDED_INDEX_RE = /(?:targetIds|triggerTargetIds|collidedActorIds|slainActorIds|actorIds)\s*\[/;
const FACT_CARRIED_RE = /\.(?:ownerId|sourceActorId|actorId|id)\b/;
const PLAIN_IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Recursively list every `*.ts` file under `dir` (relative paths). */
function listTypeScriptFiles(dir: string): string[] {
  const names: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (name.endsWith('.ts')) names.push(full);
    else if (name !== 'node_modules' && !name.startsWith('.')) {
      let isDir = false;
      try {
        isDir = readdirSync(full).length >= 0;
      } catch {
        isDir = false;
      }
      if (isDir) names.push(...listTypeScriptFiles(full));
    }
  }
  return names;
}

/** Scan every `*.ts` file under `root` (recursively) for `state.actors[…]`
 * dereferences and tag the index-expression family. AST-based: only real
 * element accesses on the actors map; comments/strings never match. */
export function scanActorDerefs(root: string): ActorDerefSite[] {
  const files = listTypeScriptFiles(root).map((path) => ({
    file: path.slice(root.length + 1).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }));
  return scanActorDerefsIn(files);
}

/** AST element-access scan over an explicit (file, text) list — the testable
 * core of the fold-surface inventory. */
export function scanActorDerefsIn(files: ReadonlyArray<{ file: string; text: string }>): ActorDerefSite[] {
  const sites: ActorDerefSite[] = [];
  for (const { file, text } of files) {
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node): void => {
      if (ts.isElementAccessExpression(node)) {
        const base = node.expression.getText(sourceFile).trim();
        if (base === 'state.actors' || base === 'context.state.actors') {
          const index = node.argumentExpression.getText(sourceFile).trim();
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          const family: ActorDerefFamily = index.startsWith('context.')
            ? 'legacy-slot'
            : RECORDED_INDEX_RE.test(index)
              ? 'recorded-forwarded'
              : FACT_CARRIED_RE.test(index)
                ? 'fact-carried'
                : PLAIN_IDENTIFIER_RE.test(index)
                  ? 'forwarded-identifier'
                  : 'algorithm/other';
          sites.push({ file, line, family, shape: index });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return sites;
}

const programsRoot = join(import.meta.dirname, '..', 'src', 'rules', 'automation', 'content', 'jobs', 'programs');
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const inventory = buildU1ResidualInventory(programsRoot);
  console.log(JSON.stringify({ total: inventory.total, categoryCounts: inventory.categoryCounts, consistent: inventory.consistent }, null, 2));
  for (const [file, counts] of Object.entries(inventory.perFile)) {
    console.log(`${file}: ${JSON.stringify(counts)}`);
  }
}