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
 * Handles three import forms on a single line:
 *   import '<specifier>';          (side-effect)
 *   import ... from '<specifier>';
 *   export ... from '<specifier>';
 */
export function parseImports(code: string): string[] {
  const specs: string[] = [];
  for (const line of code.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Side-effect import: import './foo.js';
    const sideEffect = line.match(/^\s*import\s+'([^']+)'/);
    if (sideEffect) {
      if (sideEffect[1].startsWith('.') || sideEffect[1].startsWith('/'))
        specs.push(sideEffect[1]);
      continue;
    }

    // from-import: import/export ... from './foo.js';
    const fromImport = line.match(/\b(?:import|export)\b.*\bfrom\s+'([^']+)'/);
    if (fromImport) {
      if (fromImport[1].startsWith('.') || fromImport[1].startsWith('/'))
        specs.push(fromImport[1]);
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
