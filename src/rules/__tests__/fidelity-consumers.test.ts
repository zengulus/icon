import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { resolveConsumerRegistrations } from '../fidelity/consumers.js';

function audit(files: Record<string, string>, symbol = 'implementation', file = 'entry.ts') {
  const root = resolve('/tmp/icon-fidelity-consumer-fixture');
  const sources = new Map(Object.entries(files).map(([name, source]) => [resolve(root, name), source]));
  return resolveConsumerRegistrations([{ id: 'fixture', file, symbol, description: 'Export resolution fixture' }], {
    root,
    exists: (path) => sources.has(path),
    readFile: (path) => {
      const source = sources.get(path);
      if (source === undefined) throw new Error('Missing fixture module');
      return source;
    },
  });
}

describe('fidelity consumer export resolution', () => {
  it.each([
    ['line comment', '// export function implementation() {}\nexport const other = 1;'],
    ['block comment', '/* export const implementation = 1; */\nexport const other = 1;'],
    ['string', 'export const example = "export const implementation = 1";'],
    ['template literal', 'export const example = `export function implementation() {}`;'],
    ['renamed export', 'const implementation = 1; export { implementation as replacement };'],
    ['namespace member', 'export namespace nested { export const implementation = 1; }'],
    ['unbound export', 'export { implementation };'],
    ['interface', 'export interface implementation { value: number }'],
    ['type alias', 'export type implementation = number;'],
    ['ambient declaration', 'export declare function implementation(): number;'],
    ['ambient variable', 'export declare const implementation: number;'],
    ['erased const enum', 'export const enum implementation { value = 1 }'],
    ['named default under its private name', 'export default function implementation() { return 1; }'],
    ['malformed module', 'export const implementation = ;'],
    ['type-only export', 'const implementation = 1; export type { implementation };'],
  ])('rejects %s as an execution consumer', (_label, source) => {
    expect(audit({ 'entry.ts': source }).map(({ check }) => check)).toEqual(['consumer-symbol-missing']);
  });

  it.each([
    'export const implementation = 1;',
    'export async function implementation() { return 1; }',
    'export function* implementation() { yield 1; }',
    'export class implementation {}',
    'export enum implementation { value = 1 }',
    'export function implementation(value: number): number; export function implementation(value: number) { return value; }',
    'const local = 1; export { local as implementation };',
    'const implementation = 1; export { implementation };',
    'export const { implementation } = { implementation: 1 };',
  ])('accepts a real runtime export: %s', (source) => {
    expect(audit({ 'entry.ts': source })).toEqual([]);
  });

  it('resolves a named re-export through an imported alias using the public name', () => {
    const files = {
      'entry.ts': "export { middle as implementation } from './bridge.js';",
      'bridge.ts': "import { original as local } from './impl.js'; export { local as middle };",
      'impl.ts': 'export function original() { return 1; }',
    };
    expect(audit(files)).toEqual([]);
    expect(audit(files, 'middle').map(({ check }) => check)).toEqual(['consumer-symbol-missing']);
    expect(audit({ ...files, 'impl.ts': 'export const replacement = 1;' }).map(({ check }) => check))
      .toEqual(['consumer-symbol-missing']);
  });

  it.each([
    "export { implementation } from './missing.js';",
    "export type { implementation } from './impl.js';",
    "export { type implementation } from './impl.js';",
    "import type { implementation } from './impl.js'; export { implementation };",
    "import { type implementation } from './impl.js'; export { implementation };",
  ])('rejects unavailable or erased re-exports: %s', (source) => {
    expect(audit({ 'entry.ts': source, 'impl.ts': 'export const implementation = 1;' }).map(({ check }) => check))
      .toEqual(['consumer-symbol-missing']);
  });

  it('rejects an export cycle with no implementation', () => {
    expect(audit({
      'entry.ts': "export { implementation } from './bridge.js';",
      'bridge.ts': "export { implementation } from './entry.js';",
    }).map(({ check }) => check)).toEqual(['consumer-symbol-missing']);
  });

  it('accepts a default implementation by its public export name', () => {
    expect(audit({ 'entry.ts': 'export default function implementation() { return 1; }' }, 'default')).toEqual([]);
  });

  it('rejects declaration-file implementations, including behind named re-exports', () => {
    const files = {
      'entry.ts': "export { implementation } from './impl.js';",
      'impl.d.ts': 'export function implementation(): number;',
    };
    expect(audit(files).map(({ check }) => check)).toEqual(['consumer-symbol-missing']);
    expect(audit(files, 'implementation', 'impl.d.ts').map(({ check }) => check)).toEqual(['consumer-symbol-missing']);
  });

  it('rejects a syntax error in an intermediate re-export module', () => {
    expect(audit({
      'entry.ts': "export { implementation } from './bridge.js';",
      'bridge.ts': "export { implementation } from './impl.js'; const broken = ;",
      'impl.ts': 'export const implementation = 1;',
    }).map(({ check }) => check)).toEqual(['consumer-symbol-missing']);
  });

  it.each([
    "export type * from './impl.js';",
    "export * from './impl.js';",
  ])('requires explicit runtime exports throughout the alias chain: %s', (bridge) => {
    expect(audit({
      'entry.ts': "export { implementation } from './bridge.js';",
      'bridge.ts': bridge,
      'impl.ts': 'export const implementation = 1;',
    }).map(({ check }) => check)).toEqual(['consumer-symbol-missing']);
  });

  it('does not execute modules while resolving consumers', () => {
    expect(audit({ 'entry.ts': 'throw new Error("must never run"); export const implementation = 1;' })).toEqual([]);
  });

  it('does not reuse a stale export graph across audits', () => {
    expect(audit({ 'entry.ts': 'export const implementation = 1;' })).toEqual([]);
    expect(audit({ 'entry.ts': '// export const implementation = 1;' }).map(({ check }) => check))
      .toEqual(['consumer-symbol-missing']);
  });

  it('treats symbol names literally', () => {
    expect(audit({ 'entry.ts': 'export const implementation = 1;' }, '.*').map(({ check }) => check))
      .toEqual(['consumer-symbol-missing']);
    expect(() => audit({ 'entry.ts': 'export const implementation = 1;' }, '[')).not.toThrow();
  });
});
