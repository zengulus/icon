/**
 * fidelity/consumers.ts — makes consumer registrations RESOLVABLE.
 *
 * A registration must name a real implementation file and, when a symbol is
 * declared, an actual export of that file. "src/foo.ts — someFunction" prose
 * alone proves nothing: missing modules, deleted exports, and stale
 * registrations are hard integrity failures because they mean the evidence
 * graph claims coverage of code that does not exist.
 *
 * Resolution is deliberately static text inspection (no TypeScript compiler
 * dependency): `export const/function/class/let <symbol>` in the file body.
 * The smallest robust solution for this fixed corpus.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConsumerRegistration, FidelityIntegrityViolation } from './types.js';

export interface ConsumerResolutionDeps {
  root: string;
  exists?(path: string): boolean;
  readFile?(path: string): string;
}

const EXPORT_PATTERNS = [
  (symbol: string) => new RegExp(`export\\s+const\\s+${symbol}\\b`),
  (symbol: string) => new RegExp(`export\\s+function\\s+${symbol}\\b`),
  (symbol: string) => new RegExp(`export\\s+class\\s+${symbol}\\b`),
  (symbol: string) => new RegExp(`export\\s+let\\s+${symbol}\\b`),
  // Re-exports and grouped exports.
  (symbol: string) => new RegExp(`export\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`),
  (symbol: string) => new RegExp(`export\\s+type\\s+${symbol}\\b`),
  (symbol: string) => new RegExp(`export\\s+interface\\s+${symbol}\\b`),
];

/** Resolves every registration against the repository tree. */
export function resolveConsumerRegistrations(
  consumers: readonly ConsumerRegistration[],
  deps: ConsumerResolutionDeps,
): FidelityIntegrityViolation[] {
  const violations: FidelityIntegrityViolation[] = [];
  const exists = deps.exists ?? ((path: string) => existsSync(path));
  const readFile = deps.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  for (const consumer of consumers) {
    const absolute = join(deps.root, consumer.file);
    if (!exists(absolute)) {
      violations.push({ check: 'consumer-file-missing', detail: `consumer ${consumer.id}: implementation file ${consumer.file} does not exist` });
      continue;
    }
    if (consumer.symbol === undefined) continue;
    let text: string;
    try {
      text = readFile(absolute);
    } catch {
      violations.push({ check: 'consumer-file-missing', detail: `consumer ${consumer.id}: implementation file ${consumer.file} could not be read` });
      continue;
    }
    if (!EXPORT_PATTERNS.some((pattern) => pattern(consumer.symbol!).test(text))) {
      violations.push({
        check: 'consumer-symbol-missing',
        detail: `consumer ${consumer.id}: symbol "${consumer.symbol}" is not exported from ${consumer.file} (stale registration)`,
      });
    }
  }
  return violations;
}
